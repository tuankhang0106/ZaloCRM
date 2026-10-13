/**
 * ZaloAccountPool — singleton that manages live Zalo SDK instances.
 * Handles QR login, session reconnect, message listener lifecycle,
 * and credential persistence to the database.
 *
 * Note: zca-js is imported via createRequire because its TypeScript
 * declarations don't expose named exports in ESM mode.
 */
import { createRequire } from 'module';
import type { Server } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { attachZaloListener, type UserInfoCacheEntry } from './zalo-listener-factory.js';
import { emitWebhook } from '../api/webhook-service.js';
import { handleIncomingMessage } from '../chat/message-handler.js';
import { detectContentType } from './zalo-message-helpers.js';

// zca-js has no reliable ESM type exports — load via CJS interop
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Zalo } = require('zca-js') as { Zalo: new (opts: { logging: boolean; selfListen?: boolean }) => any };

interface ZaloCredentials {
  cookie: any;
  imei: string;
  userAgent: string;
}

interface ZaloInstance {
  zalo: any;
  api: any;
  status: 'connected' | 'disconnected' | 'qr_pending' | 'connecting';
  displayName?: string;
  zaloUid?: string;
  lastActivity: Date;
}

class ZaloAccountPool {
  private instances = new Map<string, ZaloInstance>();
  private io: Server | null = null;
  // Shared user-info cache passed into each listener context
  private userInfoCache = new Map<string, UserInfoCacheEntry>();
  // Circuit breaker: track disconnect timestamps per account
  private disconnectHistory = new Map<string, number[]>();

  constructor() {
    this.startKeepAlive();
  }

  // Periodic Keep-Alive heartbeat (every 2 minutes) to prevent idle timeouts
  private startKeepAlive(): void {
    setInterval(async () => {
      for (const [accountId, instance] of this.instances.entries()) {
        if (instance.status === 'connected' && instance.api) {
          try {
            if (typeof instance.api.keepAlive === 'function') {
              await instance.api.keepAlive();
            } else if (instance.zaloUid && typeof instance.api.getUserInfo === 'function') {
              await instance.api.getUserInfo(instance.zaloUid);
            }
            instance.lastActivity = new Date();
          } catch (e: any) {
            logger.debug(`[zalo:${accountId}] Keep-alive heartbeat:`, e?.message || e);
          }
        }
      }
    }, 2 * 60 * 1000);
  }

  // Actively sync recent messages from Zalo server for an account
  async syncMessages(accountId: string): Promise<boolean> {
    const inst = this.instances.get(accountId);
    if (!inst?.api || inst.status !== 'connected') {
      return false;
    }
    try {
      if (inst.api.listener) {
        inst.api.listener.requestOldMessages(0); // User threads
        inst.api.listener.requestOldMessages(1); // Group threads
      }

      // Also proactively sync recent messages for active groups using getGroupChatHistory (getrecentv2)
      if (inst.api.getGroupChatHistory) {
        const groupConvs = await prisma.conversation.findMany({
          where: { zaloAccountId: accountId, threadType: 'group' },
          select: { externalThreadId: true },
        });

        (async () => {
          for (const conv of groupConvs) {
            if (!conv.externalThreadId) continue;
            try {
              const res = await inst.api.getGroupChatHistory(conv.externalThreadId, 25);
              const msgs = res?.groupMsgs || [];
              for (const m of msgs) {
                const senderUid = String(m.data?.uidFrom || '');
                const rawContent = m.data?.content;
                const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent || '');
                const contentType = detectContentType(m.data?.msgType, rawContent);
                const isSelf = Boolean(m.isSelf || senderUid === inst.zaloUid || senderUid === '0');

                const saved = await handleIncomingMessage({
                  accountId,
                  senderUid,
                  senderName: m.data?.dName || '',
                  content,
                  contentType,
                  msgId: String(m.data?.msgId || ''),
                  timestamp: parseInt(m.data?.ts || String(Date.now())),
                  isSelf,
                  threadId: conv.externalThreadId,
                  threadType: 'group',
                });

                if (saved) {
                  this.io?.emit('chat:message', {
                    accountId,
                    message: saved.message,
                    conversationId: saved.conversationId,
                  });
                }
              }
            } catch (err: any) {
              logger.warn(`[zalo:${accountId}] Proactive group history sync failed for ${conv.externalThreadId}:`, err?.message || err);
            }
          }
        })().catch(() => {});
      }

      // Emit sync-completed event to all connected clients
      this.io?.emit('zalo:sync-completed', { accountId });
      return true;
    } catch (e: any) {
      logger.warn(`[zalo:${accountId}] syncMessages failed:`, e?.message || e);
    }
    return false;
  }

  setIO(io: Server): void {
    this.io = io;
  }

  getIO(): Server | null {
    return this.io;
  }

  // Initiate QR-based login; emits QR events to frontend via Socket.IO
  async loginQR(accountId: string): Promise<void> {
    const zalo = new Zalo({ logging: false, selfListen: true });
    this.instances.set(accountId, { zalo, api: null, status: 'qr_pending', lastActivity: new Date() });

    try {
      const api = await zalo.loginQR({}, (event: any) => {
        switch (event.type) {
          case 0: // QRCodeGenerated
            this.io?.to(`account:${accountId}`).emit('zalo:qr', { accountId, qrImage: event.data.image });
            break;
          case 1: // QRCodeExpired
            this.io?.to(`account:${accountId}`).emit('zalo:qr-expired', { accountId });
            event.actions?.retry();
            break;
          case 2: // QRCodeScanned
            this.io?.to(`account:${accountId}`).emit('zalo:scanned', {
              accountId,
              displayName: event.data.display_name,
              avatar: event.data.avatar,
            });
            break;
          case 4: // GotLoginInfo
            this.saveCredentials(accountId, {
              cookie: event.data.cookie,
              imei: event.data.imei,
              userAgent: event.data.userAgent,
            });
            break;
        }
      });

      const instance = this.instances.get(accountId)!;
      instance.api = api;
      instance.status = 'connected';
      instance.lastActivity = new Date();

      const ownId = await api.getOwnId();
      instance.zaloUid = ownId;

      // Fetch own profile info for avatar
      try {
        const userInfo = await api.getUserInfo(ownId);
        const profiles = userInfo?.changed_profiles || {};
        const profile = profiles[ownId] || profiles[`${ownId}_0`];
        if (profile?.avatar) {
          await prisma.zaloAccount.update({
            where: { id: accountId },
            data: { avatarUrl: profile.avatar, displayName: profile.zaloName || profile.zalo_name || profile.displayName || instance.displayName },
          });
        }
      } catch {}

      this.attachListener(accountId, api);
      this.io?.emit('zalo:connected', { accountId, zaloUid: ownId });
      await this.updateAccountDB(accountId, 'connected', ownId);
      this.syncMessages(accountId).catch((e) => logger.warn(`[zalo:${accountId}] Initial sync failed:`, e?.message || e));
      // Emit webhook (orgId lookup is async, fire-and-forget)
      prisma.zaloAccount.findUnique({ where: { id: accountId }, select: { orgId: true } })
        .then((rec) => rec && emitWebhook(rec.orgId, 'zalo.connected', { accountId }))
        .catch(() => {});
    } catch (err) {
      const instance = this.instances.get(accountId);
      if (instance) instance.status = 'disconnected';
      this.io?.emit('zalo:error', { accountId, error: String(err) });
      throw err;
    }
  }

  // Reconnect using previously saved session credentials
  async reconnect(accountId: string, credentials: ZaloCredentials): Promise<void> {
    const inst = this.instances.get(accountId);
    if (inst?.status === 'connected' || inst?.status === 'connecting') {
      logger.info(`[zalo:${accountId}] Reconnect skipped: already ${inst.status}`);
      return;
    }

    const zalo = new Zalo({ logging: false, selfListen: true });
    this.instances.set(accountId, { zalo, api: null, status: 'connecting', lastActivity: new Date() });

    try {
      const api = await zalo.login({
        cookie: credentials.cookie,
        imei: credentials.imei,
        userAgent: credentials.userAgent,
      });

      const instance = this.instances.get(accountId)!;
      instance.api = api;
      instance.status = 'connected';
      instance.lastActivity = new Date();

      const ownId = await api.getOwnId();
      instance.zaloUid = ownId;

      // Fetch own profile info for avatar
      try {
        const userInfo = await api.getUserInfo(ownId);
        const profiles = userInfo?.changed_profiles || {};
        const profile = profiles[ownId] || profiles[`${ownId}_0`];
        if (profile?.avatar) {
          await prisma.zaloAccount.update({
            where: { id: accountId },
            data: { avatarUrl: profile.avatar, displayName: profile.zaloName || profile.zalo_name || profile.displayName || instance.displayName },
          });
        }
      } catch {}

      this.attachListener(accountId, api);
      await this.updateAccountDB(accountId, 'connected', ownId);
      this.io?.emit('zalo:connected', { accountId, zaloUid: ownId });
      this.syncMessages(accountId).catch((e) => logger.warn(`[zalo:${accountId}] Reconnect catch-up sync failed:`, e?.message || e));
      prisma.zaloAccount.findUnique({ where: { id: accountId }, select: { orgId: true } })
        .then((rec) => rec && emitWebhook(rec.orgId, 'zalo.connected', { accountId }))
        .catch(() => {});
    } catch (err: any) {
      const errStr = String(err).toLowerCase();
      const isAuthError =
        errStr.includes('cookie') ||
        errStr.includes('session') ||
        errStr.includes('expired') ||
        errStr.includes('invalid_credential') ||
        errStr.includes('1000') ||
        errStr.includes('kickconnection') ||
        errStr.includes('unauthorized');

      const instance = this.instances.get(accountId);
      if (isAuthError) {
        logger.error(`[zalo:${accountId}] Reconnect authentication error, requiring QR login:`, err);
        if (instance) instance.status = 'qr_pending';
        await this.updateAccountDB(accountId, 'qr_pending', null);
        this.io?.emit('zalo:reconnect-failed', { accountId, error: 'Phiên đăng nhập hết hạn, cần quét QR lại' });
      } else {
        logger.warn(`[zalo:${accountId}] Reconnect network error, will keep trying:`, err?.message || err);
        if (instance) instance.status = 'disconnected';
        await this.updateAccountDB(accountId, 'disconnected', null);
        setTimeout(() => this.autoReconnect(accountId), 10000);
      }
    }
  }

  // Delegate listener setup to zalo-listener-factory
  private async attachListener(accountId: string, api: any): Promise<void> {
    // Fetch orgId from DB so it can be passed to the listener context
    const rec = await prisma.zaloAccount.findUnique({ where: { id: accountId }, select: { orgId: true } });
    const orgId = rec?.orgId || '';

    attachZaloListener({
      accountId,
      orgId,
      api,
      io: this.io,
      userInfoCache: this.userInfoCache,
      onDisconnected: (id) => {
        const inst = this.instances.get(id);
        if (inst) inst.status = 'disconnected';
        this.updateAccountDB(id, 'disconnected', null);
        // Emit webhook for disconnect (fire-and-forget)
        prisma.zaloAccount.findUnique({ where: { id }, select: { orgId: true } })
          .then((rec) => rec && emitWebhook(rec.orgId, 'zalo.disconnected', { accountId: id }))
          .catch(() => {});

        // Fast auto-reconnect: starts in 3s, backoff up to 30s
        const now = Date.now();
        const key = `dc_${id}`;
        const history = (this.disconnectHistory.get(key) || []).filter(t => now - t < 5 * 60_000);
        history.push(now);
        this.disconnectHistory.set(key, history);

        const retryDelay = Math.min(3000 * Math.pow(1.5, Math.max(0, history.length - 1)), 30000);
        logger.info(`[zalo:${id}] Scheduling auto-reconnect in ${(retryDelay / 1000).toFixed(1)}s (recent drops: ${history.length})`);
        setTimeout(() => this.autoReconnect(id), retryDelay);
      },
    });
  }

  // Persist session credentials to DB
  private saveCredentials(accountId: string, credentials: ZaloCredentials): void {
    prisma.zaloAccount
      .update({ where: { id: accountId }, data: { sessionData: credentials as any } })
      .catch((err) => logger.error(`[zalo:${accountId}] saveCredentials error:`, err));
  }

  // Sync account status and zaloUid to DB
  private async updateAccountDB(accountId: string, status: string, zaloUid: string | null): Promise<void> {
    try {
      await prisma.zaloAccount.update({
        where: { id: accountId },
        data: {
          status,
          ...(zaloUid !== null ? { zaloUid } : {}),
          ...(status === 'connected' ? { lastConnectedAt: new Date() } : {}),
        },
      });
    } catch (err) {
      logger.error(`[zalo:${accountId}] updateAccountDB error:`, err);
    }
  }

  // Auto-reconnect using saved session from DB
  private async autoReconnect(accountId: string): Promise<void> {
    const inst = this.instances.get(accountId);
    // Skip if already reconnected or manually disconnected
    if (inst?.status === 'connected') return;

    try {
      const account = await prisma.zaloAccount.findUnique({
        where: { id: accountId },
        select: { sessionData: true },
      });
      const session = account?.sessionData as ZaloCredentials | null;
      if (session?.imei) {
        logger.info(`[zalo:${accountId}] Auto-reconnecting...`);
        await this.reconnect(accountId, session);
      } else {
        logger.warn(`[zalo:${accountId}] No saved session, cannot auto-reconnect`);
        this.io?.emit('zalo:reconnect-failed', { accountId, error: 'No saved session' });
      }
    } catch (err) {
      logger.error(`[zalo:${accountId}] Auto-reconnect failed:`, err);
      // Retry again in 15 seconds
      setTimeout(() => this.autoReconnect(accountId), 15_000);
    }
  }

  // Stop listener and remove from pool
  disconnect(accountId: string): void {
    const instance = this.instances.get(accountId);
    if (instance?.api?.listener) {
      try { instance.api.listener.stop(); } catch (err) {
        logger.warn(`[zalo:${accountId}] Error stopping listener:`, err);
      }
    }
    this.instances.delete(accountId);
  }

  getStatus(accountId: string): string {
    return this.instances.get(accountId)?.status ?? 'disconnected';
  }

  getAllStatuses(): Record<string, string> {
    const statuses: Record<string, string> = {};
    for (const [id, inst] of this.instances) statuses[id] = inst.status;
    return statuses;
  }

  // Return raw API instance for direct SDK calls (e.g. public API send message)
  getApi(accountId: string): any | null {
    const inst = this.instances.get(accountId);
    return inst?.status === 'connected' ? inst.api : null;
  }

  getInstance(accountId: string): ZaloInstance | undefined {
    return this.instances.get(accountId);
  }
}

export const zaloPool = new ZaloAccountPool();
