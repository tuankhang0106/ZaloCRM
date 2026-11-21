import wwebjs from 'whatsapp-web.js';
const { Client, LocalAuth } = wwebjs;

// Patch Client.prototype.initialize to gracefully retry inject on Execution context was destroyed
const origInit = (Client as any).prototype.initialize;
(Client as any).prototype.initialize = async function (this: any) {
  const origInject = this.inject.bind(this);
  this.inject = async function () {
    let retries = 5;
    while (retries > 0) {
      try {
        return await origInject();
      } catch (err: any) {
        if (err && String(err).includes('Execution context was destroyed') && --retries > 0) {
          logger.info('[whatsapp] Execution context was destroyed during inject, retrying in 1s...');
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        throw err;
      }
    }
  };
  return origInit.apply(this, arguments);
};
import QRCode from 'qrcode';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type { Server } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { config } from '../../config/index.js';
import { logger } from '../../shared/utils/logger.js';
import { handleIncomingMessage, type IncomingMessage } from '../chat/message-handler.js';
import {
  extractRawMsgId,
  getSerializedMsgKey,
  buildCandidateSerializedIds,
  classifyWhatsAppMediaType,
  detectImageFormatFromBuffer,
  isLikelyTinyWhatsAppThumb,
  shouldIgnoreWhatsAppCaption,
} from './whatsapp-media-helpers.js';

interface WhatsAppInstance {
  client: any;
  status: 'connected' | 'disconnected' | 'qr_pending' | 'connecting';
  qrCode?: string; // Data URL format
  displayName?: string;
  phone?: string;
  lastActivity: Date;
  canvasObserverTimer?: ReturnType<typeof setInterval>;
  canvasObserverStopTimer?: ReturnType<typeof setTimeout>;
}

function getChromeExecutablePath(): string | undefined {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const candidates = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export class WhatsAppAccountPool {
  private instances = new Map<string, WhatsAppInstance>();
  private io: Server | null = null;
  private sessionsRoot: string;

  constructor() {
    const defaultSessionsDir = process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA || 'C:\\Users\\KHANG\\AppData\\Local', 'PortalWhatsAppSessions')
      : path.resolve(process.cwd(), 'sessions/whatsapp');
    this.sessionsRoot = process.env.WHATSAPP_SESSIONS_DIR || defaultSessionsDir;
    if (!fs.existsSync(this.sessionsRoot)) {
      fs.mkdirSync(this.sessionsRoot, { recursive: true });
    }
  }

  public setIO(io: Server): void {
    this.io = io;
  }

  public getStatus(accountId: string): string {
    const inst = this.instances.get(accountId);
    return inst ? inst.status : 'disconnected';
  }

  public getQr(accountId: string): string | undefined {
    return this.instances.get(accountId)?.qrCode;
  }

  /**
   * Initialize or connect a WhatsApp account by accountId via WhatsApp Web (Chromium)
   */
  public async initWhatsApp(
    accountId: string,
    orgId: string,
    ownerUserId: string,
    forceNew: boolean = false
  ): Promise<{ qrCode?: string; status: string }> {
    const existing = this.instances.get(accountId);
    if (existing) {
      if (existing.status === 'connected') {
        return { status: 'connected' };
      }

      if (!forceNew && existing.status === 'qr_pending' && existing.qrCode) {
        return { qrCode: existing.qrCode, status: 'qr_pending' };
      }

      // Clean up previous client and observers
      if (existing.canvasObserverTimer) {
        clearInterval(existing.canvasObserverTimer);
        existing.canvasObserverTimer = undefined;
      }
      if (existing.canvasObserverStopTimer) {
        clearTimeout(existing.canvasObserverStopTimer);
        existing.canvasObserverStopTimer = undefined;
      }
      try {
        await existing.client.destroy();
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 600));
      this.instances.delete(accountId);
    }

    const sessionDir = path.join(this.sessionsRoot, `session-${accountId}`);

    // If account is not yet connected or forceNew is requested, wipe the session folder so Chrome starts completely fresh without corrupted database state
    const accRecord = await prisma.zaloAccount.findUnique({ where: { id: accountId } });
    const isAlreadyConnected = accRecord?.status === 'connected';

    if (fs.existsSync(sessionDir)) {
      if (!isAlreadyConnected || forceNew) {
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true, maxRetries: 3 });
        } catch (e) {
          logger.warn(`[whatsapp:${accountId}] Failed removing session dir:`, e);
        }
      } else {
        const lockFiles = [
          'lockfile',
          'SingletonLock',
          'SingletonCookie',
          'SingletonSocket',
          'DevToolsActivePort',
        ];
        for (const lf of lockFiles) {
          const p = path.join(sessionDir, lf);
          if (fs.existsSync(p)) {
            try {
              fs.unlinkSync(p);
            } catch (e) {}
          }
        }
      }
    }

    const executablePath = getChromeExecutablePath();
    const inst: WhatsAppInstance = {
      client: null,
      status: 'connecting',
      lastActivity: new Date(),
    };
    this.instances.set(accountId, inst);

    let qrResolver: ((qrUrl: string) => void) | null = null;
    const qrPromise = new Promise<string>((resolve) => {
      qrResolver = resolve;
    });

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: accountId,
        dataPath: this.sessionsRoot,
      }),
      puppeteer: {
        headless: true,
        executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-default-apps',
        ],
      },
    });

    inst.client = client;

    // Event: QR received directly from web.whatsapp.com
    client.on('qr', async (qr: string) => {
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, {
          margin: 2,
          scale: 8,
          errorCorrectionLevel: 'M',
          color: { dark: '#000000', light: '#ffffff' },
        });
        inst.qrCode = qrDataUrl;
        inst.status = 'qr_pending';

        if (qrResolver) {
          qrResolver(qrDataUrl);
          qrResolver = null;
        }

        try {
          const acc = await prisma.zaloAccount.findUnique({ where: { id: accountId } });
          if (!acc) {
            logger.warn(`[whatsapp:${accountId}] Account deleted from database. Terminating client.`);
            await inst.client?.destroy().catch(() => {});
            this.instances.delete(accountId);
            return;
          }
          await prisma.zaloAccount.update({
            where: { id: accountId },
            data: { status: 'qr_pending' },
          });
        } catch (e: any) {
          logger.warn(`[whatsapp:${accountId}:status] error:`, e?.message || e);
        }

        if (this.io) {
          this.io.emit('whatsapp:qr', {
            accountId,
            qrCode: qrDataUrl,
          });
          this.io.to(`account:${accountId}`).emit('whatsapp:qr', {
            accountId,
            qrCode: qrDataUrl,
          });
        }
        logger.info(`[whatsapp:${accountId}] Official WhatsApp Web QR code generated successfully`);
      } catch (qrErr) {
        logger.error(`[whatsapp:${accountId}] QR generation error:`, qrErr);
      }
    });

    // Event: Authenticated
    client.on('authenticated', () => {
      logger.info(`[whatsapp:${accountId}] Session authenticated successfully on WhatsApp Web`);
      if (client.pupPage) {
        void this.ensureWwebjsPatched(client.pupPage);
      }
    });

    // Event: Ready (Client is fully logged in)
    client.on('ready', async () => {
      inst.status = 'connected';
      inst.qrCode = undefined;
      inst.lastActivity = new Date();
      if (inst.canvasObserverTimer) {
        clearInterval(inst.canvasObserverTimer);
        inst.canvasObserverTimer = undefined;
      }
      if (inst.canvasObserverStopTimer) {
        clearTimeout(inst.canvasObserverStopTimer);
        inst.canvasObserverStopTimer = undefined;
      }
      if (client.pupPage) {
        await this.ensureWwebjsPatched(client.pupPage);
      }

      const info = client.info;
      const userJid = info?.wid?._serialized || '';
      const phone = info?.wid?.user || '';
      const displayName = info?.pushname || `WhatsApp (+${phone})`;

      inst.phone = phone;
      inst.displayName = displayName;

      let avatarUrl: string | null = null;
      try {
        if (client.getProfilePicUrl) {
          avatarUrl = await client.getProfilePicUrl(userJid);
        }
      } catch (e: any) {
        logger.debug(`[whatsapp:${accountId}] Failed getting profile pic:`, e?.message || e);
      }

      try {
        await prisma.zaloAccount.update({
          where: { id: accountId },
          data: {
            status: 'connected',
            channel: 'whatsapp',
            zaloUid: userJid,
            displayName,
            phone,
            ...(avatarUrl ? { avatarUrl } : {}),
            lastConnectedAt: new Date(),
          },
        });
      } catch (e) {
        logger.error(`[whatsapp:${accountId}] Failed updating DB status to connected:`, e);
      }

      if (this.io) {
        this.io.emit('whatsapp:connected', {
          accountId,
          displayName,
          phone,
        });
        this.io.to(`account:${accountId}`).emit('whatsapp:connected', {
          accountId,
          displayName,
          phone,
        });
      }
      logger.info(`[whatsapp:${accountId}] Connected successfully as ${displayName} (+${phone})`);

      // 🚀 Auto-dismiss any splash modals / update prompts ("Có gì mới trên WhatsApp Web", "Bật thông báo", etc.)
      if (client.pupPage) {
        await this.autoDismissModals(client.pupPage);
        let dismissTries = 10;
        const modalTimer = setInterval(async () => {
          if (!client.pupPage || --dismissTries <= 0) {
            clearInterval(modalTimer);
            return;
          }
          await this.autoDismissModals(client.pupPage);
        }, 3000);
      }

      // 🚀 Automatically sync recent chats and message history from mobile to CRM
      void this.syncRecentChats(accountId, orgId, 50, 20).catch((err) => {
        logger.error(`[whatsapp:${accountId}] Auto-sync recent chats failed:`, err);
      });
    });

    // Event: Disconnected / Logged out
    client.on('disconnected', async (reason: string) => {
      logger.warn(`[whatsapp:${accountId}] WhatsApp Web disconnected, reason: ${reason}`);
      inst.status = 'disconnected';
      inst.qrCode = undefined;
      if (inst.canvasObserverTimer) {
        clearInterval(inst.canvasObserverTimer);
        inst.canvasObserverTimer = undefined;
      }
      if (inst.canvasObserverStopTimer) {
        clearTimeout(inst.canvasObserverStopTimer);
        inst.canvasObserverStopTimer = undefined;
      }

      try {
        await prisma.zaloAccount.update({
          where: { id: accountId },
          data: { status: 'disconnected' },
        });
      } catch (e: any) {
        logger.warn(`[whatsapp:${accountId}:disconnected] error:`, e?.message || e);
      }

      if (this.io) {
        this.io.emit('whatsapp:disconnected', { accountId });
        this.io.to(`account:${accountId}`).emit('whatsapp:disconnected', { accountId });
      }
    });

    // Event: Revoke for everyone (Mobile -> CRM)
    client.on('message_revoke_everyone', async (after: any, before: any) => {
      try {
        const revokedSerialized = getSerializedMsgKey(before) || getSerializedMsgKey(after);
        const revokedRemote =
          before?.id?.remote?._serialized || before?.id?.remote ||
          after?.id?.remote?._serialized || after?.id?.remote || '';
        const revokedId = extractRawMsgId(
          before?.id?.id || after?.id?.id || before?._data?.id?.id || after?._data?.id?.id || revokedSerialized,
        );
        logger.info(`[whatsapp:${accountId}] ⚡ Message revoked for everyone from mobile: ID=${revokedId}, serialized=${revokedSerialized}`);

        if (!revokedId && !revokedSerialized) return;

        const lookupIds = buildCandidateSerializedIds(
          revokedSerialized || revokedId,
          revokedRemote,
          Boolean(before?.fromMe ?? after?.fromMe),
        );

        const existing = await prisma.message.findFirst({
          where: {
            conversation: { zaloAccountId: accountId },
            zaloMsgId: { in: lookupIds },
          },
          include: { conversation: true },
        });

        if (existing) {
          await prisma.message.update({
            where: { id: existing.id },
            data: { isDeleted: true, deletedAt: new Date() },
          });

          if (this.io) {
            this.io.emit('chat:message-undo', {
              accountId,
              messageId: existing.id,
              zaloMsgId: existing.zaloMsgId,
              conversationId: existing.conversationId,
            });
            this.io.emit('chat:deleted', {
              accountId,
              messageId: existing.id,
              conversationId: existing.conversationId,
            });
            this.io.to(`conversation:${existing.conversationId}`).emit('message:deleted', {
              id: existing.id,
              conversationId: existing.conversationId,
            });
          }
        }
      } catch (err: any) {
        logger.error(`[whatsapp:${accountId}] message_revoke_everyone error:`, err?.message || err);
      }
    });

    client.on('message_revoke_me', async (msg: any) => {
      try {
        const revokedSerialized = getSerializedMsgKey(msg);
        const revokedId = extractRawMsgId(msg?.id?.id || msg?._data?.id?.id || revokedSerialized);
        if (!revokedId && !revokedSerialized) return;

        const lookupIds = buildCandidateSerializedIds(
          revokedSerialized || revokedId,
          msg?.id?.remote?._serialized || msg?.id?.remote || (msg?.fromMe ? msg?.to : msg?.from),
          Boolean(msg?.fromMe),
        );

        const existing = await prisma.message.findFirst({
          where: {
            conversation: { zaloAccountId: accountId },
            zaloMsgId: { in: lookupIds },
          },
          include: { conversation: true },
        });

        if (existing) {
          await prisma.message.update({
            where: { id: existing.id },
            data: { isDeleted: true, deletedAt: new Date() },
          });

          if (this.io) {
            this.io.emit('chat:message-undo', {
              accountId,
              messageId: existing.id,
              zaloMsgId: existing.zaloMsgId,
              conversationId: existing.conversationId,
            });
          }
        }
      } catch (err: any) {
        logger.warn(`[whatsapp:${accountId}] message_revoke_me error:`, err?.message || err);
      }
    });

    // Event: Inbound & Outbound messages synchronization
    client.on('message_create', async (msg: any) => {
      try {
      if (!msg) return;
      const isSelf = Boolean(msg.fromMe);
      const isGroup = msg.from?.endsWith('@g.us') || msg.to?.endsWith('@g.us');
      const remoteJid = isGroup
        ? (msg.from?.endsWith('@g.us') ? msg.from : msg.to)
        : (isSelf ? msg.to : msg.from);

      if (!remoteJid || remoteJid === 'status@broadcast') return;

      // Reconstruct msg.id._serialized if wwebjs object serialization stripped prototype getters
      const serializedKey = getSerializedMsgKey(msg) || buildCandidateSerializedIds(
        msg?.id?.id || msg?._data?.id?.id || '',
        remoteJid,
        isSelf,
        isGroup ? (msg?.id?.participant?._serialized || msg?.id?.participant || msg?.author) : undefined,
      )[0];
      const rawMsgId = extractRawMsgId(msg?.id?.id || msg?._data?.id?.id || serializedKey);

      if (serializedKey && msg.id && (!msg.id._serialized || msg.id._serialized === 'undefined')) {
        try {
          msg.id._serialized = serializedKey;
        } catch {
          try {
            msg.id = { ...msg.id, _serialized: serializedKey };
          } catch {}
        }
      }

      // Handle message revoke event received as message with type 'revoked'
      if (msg.type === 'revoked') {
        const revokedRawId = extractRawMsgId(
          msg.protocolMessageKey?.id || msg.id?.id || msg._data?.protocolMessageKey?.id || serializedKey,
        );
        const revokedSerialized = msg.protocolMessageKey?._serialized || serializedKey;
        if (revokedRawId || revokedSerialized) {
          const lookupIds = buildCandidateSerializedIds(revokedSerialized || revokedRawId, remoteJid, isSelf);
          const existing = await prisma.message.findFirst({
            where: {
              conversation: { zaloAccountId: accountId },
              zaloMsgId: { in: lookupIds },
            },
            include: { conversation: true },
          });
          if (existing) {
            await prisma.message.update({
              where: { id: existing.id },
              data: { isDeleted: true, deletedAt: new Date() },
            });
            if (this.io) {
              this.io.emit('chat:message-undo', {
                accountId,
                messageId: existing.id,
                zaloMsgId: existing.zaloMsgId,
                conversationId: existing.conversationId,
              });
              this.io.to(`conversation:${existing.conversationId}`).emit('message:deleted', {
                id: existing.id,
                conversationId: existing.conversationId,
              });
            }
          }
        }
        return;
      }

      // Check if message was already created by CRM (outgoing message from this system)
      if (isSelf && (rawMsgId || serializedKey)) {
        const selfLookupIds = buildCandidateSerializedIds(serializedKey || rawMsgId, remoteJid, true);
        const existing = await prisma.message.findFirst({
          where: {
            conversation: { zaloAccountId: accountId },
            zaloMsgId: { in: selfLookupIds },
          },
          select: { id: true },
        });
        if (existing) {
          return;
        }
      }

      let content = msg.body || '';
      let contentType = 'text';
      const attachments: any[] = [];

      const rawThumbB64 =
        (typeof msg.body === 'string' && msg.body.startsWith('/9j/') ? msg.body.trim() : '') ||
        (typeof msg._data?.body === 'string' && msg._data.body.startsWith('/9j/') ? msg._data.body.trim() : '') ||
        (typeof msg._data?.preview === 'string' && msg._data.preview.startsWith('/9j/') ? msg._data.preview.trim() : '');

      const mediaCategory = classifyWhatsAppMediaType(
        { type: msg.type, hasMedia: msg.hasMedia, body: msg.body },
        rawThumbB64,
      );

      if (mediaCategory === 'voice') {
        contentType = 'voice';
        try {
          const media = await this.downloadMediaSafe(inst, msg);

          if (media?.data) {
            let ext = 'ogg';
            if (media.mimetype?.includes('mp4') || media.mimetype?.includes('m4a')) ext = 'm4a';
            else if (media.mimetype?.includes('mpeg') || media.mimetype?.includes('mp3')) ext = 'mp3';
            else if (media.mimetype?.includes('aac')) ext = 'aac';
            else if (media.mimetype?.includes('wav')) ext = 'wav';
            else if (media.mimetype?.includes('ogg') || media.mimetype?.includes('opus')) ext = 'ogg';

            const idSlug = (rawMsgId || 'v').replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'v';
            const filename = `wa_voice_${Date.now()}_${idSlug}.${ext}`;
            const mediaDir = path.join(path.resolve(config.uploadDir), 'media');
            await fs.promises.mkdir(mediaDir, { recursive: true });
            const filepath = path.join(mediaDir, filename);
            const voiceBuf = Buffer.from(media.data, 'base64');
            await fs.promises.writeFile(filepath, voiceBuf);
            const mediaUrl = `/uploads/media/${filename}`;

            const durationSec = Number(msg.duration || 0);
            const m = Math.floor(durationSec / 60);
            const s = Math.floor(durationSec % 60);
            const durationText = `${m}:${s < 10 ? '0' : ''}${s}`;

            content = JSON.stringify({
              href: mediaUrl,
              localUrl: mediaUrl,
              voiceUrl: mediaUrl,
              action: 'voice',
              duration: durationSec,
              durationText,
              params: {
                duration: durationSec * 1000,
                durationText,
                fileSize: voiceBuf.length,
                m4a: mediaUrl,
                href: mediaUrl,
                url: mediaUrl,
              },
            });

            attachments.push({
              type: 'voice',
              url: mediaUrl,
              href: mediaUrl,
              localUrl: mediaUrl,
              duration: durationSec,
              durationText,
            });
          } else {
            content = '[Tin nhắn thoại]';
          }
        } catch (e: any) {
          logger.warn(`[whatsapp:${accountId}] downloadMedia voice failed:`, e?.message || e);
          content = '[Tin nhắn thoại]';
        }
      } else if (mediaCategory === 'image') {
        contentType = 'image';
        try {
          let media: any = null;
          if (msg.hasMedia || msg.type === 'image' || msg.type === 'sticker' || Boolean(msg.directPath || msg._data?.directPath)) {
            media = await this.downloadMediaSafe(inst, msg);
          }

          let imgBuffer: Buffer | null = null;
          if (media?.data) {
            imgBuffer = Buffer.from(media.data, 'base64');
          } else if (rawThumbB64) {
            imgBuffer = Buffer.from(rawThumbB64, 'base64');
          }

          if (imgBuffer && imgBuffer.length > 0) {
            const { ext } = detectImageFormatFromBuffer(imgBuffer, media?.mimetype);
            const idSlug = (rawMsgId || 'img').replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'img';
            const prefix = msg.type === 'sticker' ? 'wa_sticker' : 'wa';
            const filename = `${prefix}_${Date.now()}_${idSlug}.${ext}`;
            const mediaDir = path.join(path.resolve(config.uploadDir), 'media');
            await fs.promises.mkdir(mediaDir, { recursive: true });
            const filepath = path.join(mediaDir, filename);
            await fs.promises.writeFile(filepath, imgBuffer);
            const mediaUrl = `/uploads/media/${filename}`;

            const rawCap =
              msg.type === 'sticker'
                ? ''
                : (typeof msg.caption === 'string' && msg.caption) ||
                  (typeof msg._data?.caption === 'string' && msg._data.caption) ||
                  (typeof msg.body === 'string' ? msg.body : '');
            const caption = !shouldIgnoreWhatsAppCaption(rawCap) ? rawCap.trim() : '';

            content = JSON.stringify({
              href: mediaUrl,
              localUrl: mediaUrl,
              thumb: mediaUrl,
              hdUrl: mediaUrl,
              ...(caption ? { title: caption, caption } : {}),
            });

            attachments.push({
              type: 'image',
              url: mediaUrl,
              href: mediaUrl,
              localUrl: mediaUrl,
            });
          } else {
            const rawCap = msg.caption || msg._data?.caption;
            content = !shouldIgnoreWhatsAppCaption(rawCap) ? rawCap.trim() : '[Hình ảnh]';
          }
        } catch (e: any) {
          logger.warn(`[whatsapp:${accountId}] downloadMedia failed:`, e?.message || e);
          const rawCap = msg.caption || msg._data?.caption;
          content = !shouldIgnoreWhatsAppCaption(rawCap) ? rawCap.trim() : '[Hình ảnh]';
        }
      } else if (mediaCategory === 'file') {
        contentType = 'file';
        try {
          const media = await this.downloadMediaSafe(inst, msg);
          const docBuf = media?.data ? Buffer.from(media.data, 'base64') : Buffer.alloc(0);
          if (docBuf.length > 0) {
            const origName = (media?.filename || msg._data?.filename || (!shouldIgnoreWhatsAppCaption(msg.body) ? msg.body : '') || '').trim();
            let safeDocName = origName
              ? origName.replace(/[^a-zA-Z0-9._-]/g, '_')
              : `${(rawMsgId || 'doc').replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'doc'}.${media?.mimetype?.includes('pdf') ? 'pdf' : 'bin'}`;
            if (/\.(php\d*|phtml|phar|html?|svgz?|m?js|jsp|aspx?|exe|sh|bash|bat|cmd|ps1|py|rb|pl|cgi)$/i.test(safeDocName)) {
              safeDocName = safeDocName.replace(/\.[^.]+$/, '.bin');
            }
            const filename = `wa_doc_${Date.now()}_${safeDocName}`;
            const mediaDir = path.join(path.resolve(config.uploadDir), 'media');
            await fs.promises.mkdir(mediaDir, { recursive: true });
            const filepath = path.join(mediaDir, filename);
            await fs.promises.writeFile(filepath, docBuf);
            const mediaUrl = `/uploads/media/${filename}`;
            const bufLen = docBuf.length;
            const fileSizeStr = bufLen > 1048576 ? `${(bufLen / 1048576).toFixed(1)} MB` : `${Math.round(bufLen / 1024)} KB`;
            const displayTitle = origName || 'Tài liệu';
            const extMatch = displayTitle.match(/\.([a-zA-Z0-9]+)$/);
            content = JSON.stringify({
              title: displayTitle,
              href: mediaUrl,
              localUrl: mediaUrl,
              params: JSON.stringify({
                fileSize: String(bufLen),
                fileSizeStr,
                ...(extMatch ? { fileExt: extMatch[1].toLowerCase() } : {}),
              }),
            });
            attachments.push({
              type: 'file',
              url: mediaUrl,
              href: mediaUrl,
              localUrl: mediaUrl,
              name: displayTitle,
              size: fileSizeStr,
            });
          } else {
            content = !shouldIgnoreWhatsAppCaption(msg.body) ? msg.body : '[Tài liệu]';
          }
        } catch (e: any) {
          content = !shouldIgnoreWhatsAppCaption(msg.body) ? msg.body : '[Tài liệu]';
        }
      } else if (mediaCategory === 'video') {
        contentType = 'video';
        try {
          const media = await this.downloadMediaSafe(inst, msg);
          if (media?.data) {
            const vidBuf = Buffer.from(media.data, 'base64');
            const idSlug = (rawMsgId || 'vid').replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'vid';
            const filename = `wa_vid_${Date.now()}_${idSlug}.mp4`;
            const mediaDir = path.join(path.resolve(config.uploadDir), 'media');
            await fs.promises.mkdir(mediaDir, { recursive: true });
            const filepath = path.join(mediaDir, filename);
            await fs.promises.writeFile(filepath, vidBuf);
            const mediaUrl = `/uploads/media/${filename}`;
            const rawCap = msg.caption || msg._data?.caption;
            const caption = !shouldIgnoreWhatsAppCaption(rawCap) ? rawCap.trim() : '';
            content = JSON.stringify({
              href: mediaUrl,
              localUrl: mediaUrl,
              videoUrl: mediaUrl,
              thumb: '',
              ...(caption ? { title: caption, caption } : {}),
            });
            attachments.push({
              type: 'video',
              url: mediaUrl,
              href: mediaUrl,
              localUrl: mediaUrl,
            });
          } else {
            const rawCap = msg.caption || msg._data?.caption || msg.body;
            content = !shouldIgnoreWhatsAppCaption(rawCap) ? rawCap.trim() : '[Video]';
          }
        } catch (e: any) {
          const rawCap = msg.caption || msg._data?.caption || msg.body;
          content = !shouldIgnoreWhatsAppCaption(rawCap) ? rawCap.trim() : '[Video]';
        }
      }

      const contactPhone = (isGroup ? (isSelf ? '' : msg.author) : remoteJid)?.split('@')[0] || '';
      let senderName = isSelf ? 'Bạn' : (contactPhone ? `+${contactPhone}` : 'Khách hàng WhatsApp');
      let senderAvatar: string | undefined;
      if (!isSelf) {
        try {
          const contact = await msg.getContact();
          senderName = contact.pushname || contact.name || senderName;
          try {
            senderAvatar = await contact.getProfilePicUrl();
          } catch {}
        } catch (e: any) {
          logger.warn(`[whatsapp:${accountId}:contact] error:`, e?.message || e);
        }
      }

      const incoming: any = {
        accountId,
        senderUid: isGroup ? (msg.author || remoteJid) : (isSelf ? msg.from : remoteJid),
        senderName,
        senderAvatar,
        content,
        contentType,
        msgId: rawMsgId || serializedKey || `wa_${Date.now()}`,
        timestamp: msg.timestamp ? msg.timestamp * 1000 : Date.now(),
        isSelf,
        threadId: remoteJid,
        threadType: isGroup ? 'group' : 'user',
        attachments,
        channel: 'whatsapp',
        senderPhone: !isSelf && contactPhone ? (contactPhone.startsWith('84') ? '0' + contactPhone.slice(2) : `+${contactPhone}`) : undefined,
      };

      try {
        const result = await handleIncomingMessage(incoming);
        if (result && result.message && ((result as any).isNew || (result as any).isLinked) && this.io) {
          const payload = {
            ...result.message,
            channel: 'whatsapp',
            conversationId: result.conversationId,
          };
          this.io.to(`org:${orgId}`).emit('message:new', payload);
          this.io.to(`conversation:${result.conversationId}`).emit('message:new', payload);
          this.io.emit('chat:message', {
            accountId,
            message: result.message,
            conversationId: result.conversationId,
            isNew: (result as any).isNew,
          });
          if ((result as any).isNew) {
            this.io.to(`org:${orgId}`).emit('conversation:updated', {
              id: result.conversationId,
              lastMessageAt: payload.sentAt,
              unreadCount: isSelf ? 0 : 1,
              channel: 'whatsapp',
            });
          }
        }
      } catch (err) {
        logger.error(`[whatsapp:${accountId}] Error handling message_create:`, err);
      }
      } catch (err: any) {
        logger.error(`[whatsapp:${accountId}] Unhandled message_create error:`, err?.message || err);
      }
    });

    // Event: WhatsApp Message Reaction (Customer or Self react)
    client.on('message_reaction', async (reaction: any) => {
      try {
        if (!reaction || !reaction.msgId) return;
        const msgSerialized = reaction.msgId?._serialized || getSerializedMsgKey({ id: reaction.msgId });
        const rawKey = extractRawMsgId(String(reaction.msgId.id || msgSerialized || reaction.msgId));
        const remoteKey = reaction.msgId?.remote?._serialized || reaction.msgId?.remote || reaction.senderId || '';
        const lookupIds = buildCandidateSerializedIds(
          msgSerialized || rawKey,
          typeof remoteKey === 'string' ? remoteKey : undefined,
        );
        const emoji = reaction.reaction || '';
        const senderId = String(reaction.senderId || '');
        const isSelf = Boolean(senderId && inst.phone && senderId.includes(inst.phone));

        const targetMessage = await prisma.message.findFirst({
          where: {
            conversation: { zaloAccountId: accountId },
            OR: [
              { zaloMsgId: { in: lookupIds } },
              ...(rawKey ? [{ id: rawKey }] : []),
            ],
          },
          include: { conversation: true },
        });

        if (!targetMessage) return;

        let attList: any[] = [];
        if (targetMessage.attachments) {
          if (typeof targetMessage.attachments === 'string') {
            try { attList = JSON.parse(targetMessage.attachments); } catch { attList = []; }
          } else if (Array.isArray(targetMessage.attachments)) {
            attList = [...targetMessage.attachments];
          }
        }
        attList = attList.filter((a: any) => a && a.type !== 'reaction');
        if (emoji) {
          attList.push({
            type: 'reaction',
            reaction: emoji,
            senderUid: senderId,
            isSelf,
            updatedAt: Date.now(),
          });
        }

        await prisma.message.update({
          where: { id: targetMessage.id },
          data: { attachments: attList as any },
        });

        const io = this.io;
        if (io) {
          const payload = {
            accountId,
            messageId: targetMessage.id,
            zaloMsgId: targetMessage.zaloMsgId || rawKey,
            conversationId: targetMessage.conversationId,
            reaction: emoji || null,
            senderUid: senderId,
            isSelf,
          };
          io.emit('chat:reaction', payload);
          io.to(`account:${accountId}`).emit('chat:reaction', payload);
          io.to(`org:${targetMessage.conversation.orgId}`).emit('chat:reaction', payload);
        }
      } catch (err: any) {
        logger.error(`[whatsapp:${accountId}] message_reaction error:`, err?.message || err);
      }
    });

    // Initialize browser instance asynchronously
    client.initialize().catch((err: any) => {
      const msg = err?.message || String(err);
      // Execution context was destroyed occurs when WhatsApp Web navigates or registers its service worker
      // wwebjs listens to framenavigated and automatically re-injects, so do not disconnect
      if (msg.includes('Execution context was destroyed')) {
        logger.info(`[whatsapp:${accountId}] Page navigated during WhatsApp Web boot (expected), waiting for frame re-injection...`);
        return;
      }
      logger.error(`[whatsapp:${accountId}] WhatsApp Web initialize error:`, err);
      inst.status = 'disconnected';
      if (qrResolver) {
        qrResolver = null;
      }
    });

    // Active DOM canvas observer: grabs the real QR code canvas directly from web.whatsapp.com
    const clearObserverTimers = () => {
      if (inst.canvasObserverTimer) {
        clearInterval(inst.canvasObserverTimer);
        inst.canvasObserverTimer = undefined;
      }
      if (inst.canvasObserverStopTimer) {
        clearTimeout(inst.canvasObserverStopTimer);
        inst.canvasObserverStopTimer = undefined;
      }
    };

    const canvasObserver = setInterval(async () => {
      if (inst.status === 'connected') {
        clearObserverTimers();
        return;
      }
      try {
        if (!client.pupPage || client.pupPage.isClosed()) return;

        // Check if chat pane is visible (meaning user already scanned and authenticated)
        const isLoggedIn = await client.pupPage
          .evaluate(() => Boolean(document.querySelector('#pane-side, [data-testid="chat-list"]')))
          .catch(() => false);

        if (isLoggedIn) {
          inst.status = 'connected';
          inst.qrCode = undefined;
          clearObserverTimers();

          try {
            await prisma.zaloAccount.update({
              where: { id: accountId },
              data: { status: 'connected', lastConnectedAt: new Date() },
            });
          } catch (e: any) {
            logger.warn(`[whatsapp:${accountId}:canvasObserver] error:`, e?.message || e);
          }

          if (this.io) {
            this.io.emit('whatsapp:connected', { accountId });
            this.io.to(`account:${accountId}`).emit('whatsapp:connected', { accountId });
          }
          logger.info(`[whatsapp:${accountId}] Detected WhatsApp Web login via DOM chat list`);
          return;
        }

        // If WhatsApp Web prompts "A database error occurred" or "relink", auto-click "Scan to log in"
        await client.pupPage
          .evaluate(() => {
            const elements = Array.from(document.querySelectorAll('button, [role="button"], a, span, div'));
            const target = elements.find((el: any) => {
              const txt = (el.innerText || '').trim().toLowerCase();
              return txt === 'scan to log in' || txt === 'quét để đăng nhập' || txt === 'relink your device';
            });
            if (target) {
              (target as any).click();
            }
          })
          .catch(() => {});

        // Grab QR code from canvas
        const qrCanvasUrl = await client.pupPage
          .evaluate(() => {
            const canvas = document.querySelector('canvas');
            return canvas ? canvas.toDataURL('image/png') : null;
          })
          .catch(() => null);

        if (qrCanvasUrl && qrCanvasUrl !== inst.qrCode) {
          inst.qrCode = qrCanvasUrl;
          inst.status = 'qr_pending';

          if (qrResolver) {
            qrResolver(qrCanvasUrl);
            qrResolver = null;
          }

          try {
            await prisma.zaloAccount.update({
              where: { id: accountId },
              data: { status: 'qr_pending' },
            });
          } catch (e: any) {
            logger.warn(`[whatsapp:${accountId}:canvasObserver] error:`, e?.message || e);
          }

          if (this.io) {
            this.io.emit('whatsapp:qr', {
              accountId,
              qrCode: qrCanvasUrl,
            });
            this.io.to(`account:${accountId}`).emit('whatsapp:qr', {
              accountId,
              qrCode: qrCanvasUrl,
            });
          }
          logger.info(`[whatsapp:${accountId}] Direct canvas QR code captured successfully`);
        }
      } catch (e: any) {
        logger.warn(`[whatsapp:${accountId}:canvasObserver] error:`, e?.message || e);
      }
    }, 1000);

    inst.canvasObserverTimer = canvasObserver;

    // Stop observer after 3 minutes if not connected
    inst.canvasObserverStopTimer = setTimeout(() => {
      clearObserverTimers();
    }, 180000);

    // Wait up to 2 seconds for QR to generate so initial response returns quickly without gateway timeouts
    try {
      const initialQr = await Promise.race([
        qrPromise,
        new Promise<null>((r) => setTimeout(() => r(null), 2000)),
      ]);
      if (initialQr) {
        return { qrCode: initialQr, status: 'qr_pending' };
      }
    } catch (e) {}

    return {
      qrCode: inst.qrCode,
      status: inst.status,
    };
  }

  private normalizeJid(toJid: string): string {
    let jid = toJid || '';
    if (jid && !jid.includes('@')) {
      let clean = jid.replace(/\D/g, '');
      if (clean.startsWith('0')) clean = '84' + clean.slice(1);
      jid = `${clean}@c.us`;
    } else if (jid.endsWith('@s.whatsapp.net')) {
      jid = jid.replace('@s.whatsapp.net', '@c.us');
    }
    return jid;
  }

  /**
   * Ensure window.WWebJS.getMessageModel inside Chromium preserves msg.id._serialized
   * and normalized remote/participant fields even if Utils.js was loaded before disk patching.
   */
  private async ensureWwebjsPatched(page: any): Promise<void> {
    if (!page || (typeof page.isClosed === 'function' && page.isClosed())) return;
    try {
      await page.evaluate(() => {
        const wweb = (window as any).WWebJS;
        if (!wweb || typeof wweb.getMessageModel !== 'function') return;
        if (wweb.getMessageModel.__patchedSerializedKey) return;
        const origGetMessageModel = wweb.getMessageModel.bind(wweb);
        const wrapped = async function (message: any) {
          const model = await origGetMessageModel(message);
          if (model && model.id) {
            const origId = message?.id;
            const remoteStr =
              typeof origId?.remote === 'object'
                ? origId.remote?._serialized
                : (typeof model.id.remote === 'object' ? model.id.remote?._serialized : model.id.remote);
            const partStr =
              typeof origId?.participant === 'object'
                ? origId.participant?._serialized
                : (typeof model.id.participant === 'object' ? model.id.participant?._serialized : model.id.participant);
            const fromMeVal = typeof model.id.fromMe === 'boolean' ? model.id.fromMe : origId?.fromMe;
            const rawId = model.id.id || origId?.id;
            const serialized =
              (typeof origId?._serialized === 'string' && origId._serialized && origId._serialized !== 'undefined' ? origId._serialized : null) ||
              (typeof model.id._serialized === 'string' && model.id._serialized && model.id._serialized !== 'undefined' ? model.id._serialized : null) ||
              (typeof fromMeVal === 'boolean' && remoteStr && rawId
                ? `${fromMeVal}_${remoteStr}_${rawId}${partStr ? `_${partStr}` : ''}`
                : undefined);
            if (serialized && (!model.id._serialized || model.id._serialized === 'undefined')) {
              model.id = Object.assign({}, model.id, {
                ...(remoteStr ? { remote: remoteStr } : {}),
                ...(partStr ? { participant: partStr } : {}),
                _serialized: serialized,
              });
            }
          }
          return model;
        };
        (wrapped as any).__patchedSerializedKey = true;
        wweb.getMessageModel = wrapped;
      });
    } catch {
      // Ignore transient page navigation errors
    }
  }

  /**
   * Extract full-resolution media directly from WhatsApp Web's internal stores inside Chromium.
   */
  private async extractMediaFromBrowserPage(
    client: any,
    rawOrSerializedId: string,
    threadId?: string | null,
    isSelf?: boolean,
    expectedMsgType?: string,
    declaredSize?: number,
    rawThumbB64?: string,
    allowThumbFallback: boolean = false,
  ): Promise<{ data: string; mimetype?: string; filename?: string; filesize?: number; isThumb?: boolean } | null> {
    const page = client?.pupPage;
    if (!page || (typeof page.isClosed === 'function' && page.isClosed())) return null;

    await this.ensureWwebjsPatched(page);
    const normThread = threadId ? this.normalizeJid(threadId) : '';
    const rawId = extractRawMsgId(rawOrSerializedId);
    const candidateIds = buildCandidateSerializedIds(rawOrSerializedId, normThread, isSelf);
    if (candidateIds.length === 0) return null;

    try {
      const pageRes = await page.evaluate(
        async (
          cands: string[],
          targetRawId: string,
          targetThread: string,
          shouldFallbackThumb: boolean,
        ) => {
          try {
            const safeRequire = (name: string) => {
              try {
                return typeof (window as any).require === 'function' ? (window as any).require(name) : null;
              } catch {
                return null;
              }
            };

            const bufToBase64 = async (ab: ArrayBuffer): Promise<string> => {
              const wweb = (window as any).WWebJS;
              if (wweb && typeof wweb.arrayBufferToBase64Async === 'function') {
                return await wweb.arrayBufferToBase64Async(ab);
              }
              return await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                  const res = String(reader.result || '');
                  const idx = res.indexOf(',');
                  resolve(idx >= 0 ? res.slice(idx + 1) : res);
                };
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(new Blob([ab]));
              });
            };

            const collections = safeRequire('WAWebCollections');
            const Msg = collections?.Msg || (window as any).Store?.Msg;
            const Chat = collections?.Chat || (window as any).Store?.Chat;

            const matchesAnyId = (m: any): boolean => {
              if (!m?.id) return false;
              const ser = m.id._serialized;
              const id = m.id.id;
              if (ser && cands.includes(ser)) return true;
              if (id && id === targetRawId) return true;
              if (ser && targetRawId && ser.endsWith(`_${targetRawId}`)) return true;
              return false;
            };

            let targetMsg: any = null;
            if (Msg?.get) {
              for (const cand of cands) {
                targetMsg = Msg.get(cand);
                if (targetMsg) break;
              }
            }

            if (!targetMsg) {
              const msgModels = Msg?.getModelsArray ? Msg.getModelsArray() : Msg?.models;
              if (Array.isArray(msgModels)) {
                targetMsg = msgModels.find(matchesAnyId) || null;
              }
            }

            if (!targetMsg && targetThread && Chat) {
              try {
                const chat = Chat.get?.(targetThread) || (await Chat.find?.(targetThread));
                const chatMsgs = chat?.msgs?.getModelsArray ? chat.msgs.getModelsArray() : chat?.msgs?.models;
                if (Array.isArray(chatMsgs)) {
                  targetMsg = chatMsgs.find(matchesAnyId) || null;
                }
              } catch {}
            }

            if (!targetMsg && Msg?.getMessagesById) {
              for (const cand of cands) {
                try {
                  const fetched = await Msg.getMessagesById([cand]);
                  const first = fetched?.messages?.[0] || (Array.isArray(fetched) ? fetched[0] : null);
                  if (first) {
                    targetMsg = first;
                    break;
                  }
                } catch {}
              }
            }

            if (!targetMsg && Chat) {
              const chatModels = Chat.getModelsArray ? Chat.getModelsArray() : Chat.models;
              if (Array.isArray(chatModels)) {
                for (const c of chatModels) {
                  const cm = c?.msgs?.getModelsArray ? c.msgs.getModelsArray() : c?.msgs?.models;
                  if (Array.isArray(cm)) {
                    targetMsg = cm.find(matchesAnyId) || null;
                    if (targetMsg) break;
                  }
                }
              }
            }

            if (!targetMsg) return null;

            const hasUsableBlob = () =>
              Boolean(
                targetMsg.mediaData?.mediaBlob ||
                  targetMsg.mediaObject?.mediaBlob ||
                  targetMsg.mediaData?.renderableUrl,
              );

            if (targetMsg.downloadMedia && (targetMsg.mediaData?.mediaStage !== 'RESOLVED' || !hasUsableBlob())) {
              try {
                await targetMsg.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1 });
              } catch {}
            }

            for (let w = 0; w < 35; w++) {
              if (hasUsableBlob()) break;
              const stage = String(targetMsg.mediaData?.mediaStage || '');
              if (stage.includes('ERROR')) break;
              await new Promise((resolve) => setTimeout(resolve, 200));
            }

            // A. mediaBlob / mediaObject.mediaBlob
            const blob = targetMsg.mediaData?.mediaBlob || targetMsg.mediaObject?.mediaBlob;
            if (blob) {
              try {
                const buf = await blob.arrayBuffer();
                if (buf && buf.byteLength > 0) {
                  const data = await bufToBase64(buf);
                  return {
                    data,
                    mimetype: targetMsg.mimetype || targetMsg.mediaData?.mimetype || targetMsg.mediaObject?.mimetype,
                    filename: targetMsg.filename || targetMsg.mediaData?.filename,
                    filesize: targetMsg.size || buf.byteLength,
                    msgType: targetMsg.type,
                  };
                }
              } catch {}
            }

            // B. renderableUrl
            if (targetMsg.mediaData?.renderableUrl) {
              try {
                const resp = await fetch(targetMsg.mediaData.renderableUrl);
                const buf = await resp.arrayBuffer();
                if (buf && buf.byteLength > 0) {
                  const data = await bufToBase64(buf);
                  return {
                    data,
                    mimetype: targetMsg.mimetype || targetMsg.mediaData.mimetype,
                    filename: targetMsg.filename || targetMsg.mediaData?.filename,
                    filesize: targetMsg.size || buf.byteLength,
                    msgType: targetMsg.type,
                  };
                }
              } catch {}
            }

            // C. Direct CDN download + decryption via WAWebDownloadManager
            try {
              const mockQpl = new Proxy({}, { get: () => function (this: any) { return this; } });
              const directPath = targetMsg.directPath || targetMsg.mediaData?.directPath;
              const encFilehash = targetMsg.encFilehash || targetMsg.mediaData?.encFilehash;
              const filehash = targetMsg.filehash || targetMsg.mediaData?.filehash;
              const mediaKey = targetMsg.mediaKey || targetMsg.mediaData?.mediaKey;
              const mediaKeyTimestamp = targetMsg.mediaKeyTimestamp || targetMsg.mediaData?.mediaKeyTimestamp;
              const type = targetMsg.type || targetMsg.mediaData?.type;
              const mimetype = targetMsg.mimetype || targetMsg.mediaData?.mimetype;

              const dm = safeRequire('WAWebDownloadManager')?.downloadManager || (window as any).Store?.DownloadManager;
              if (dm && directPath && filehash) {
                const dec = await dm.downloadAndMaybeDecrypt({
                  directPath,
                  encFilehash,
                  filehash,
                  mediaKey,
                  mediaKeyTimestamp,
                  type,
                  mimetype,
                  signal: new AbortController().signal,
                  downloadQpl: mockQpl,
                });
                if (dec && dec.byteLength > 0) {
                  const data = await bufToBase64(dec);
                  return {
                    data,
                    mimetype: mimetype || targetMsg.mimetype,
                    filename: targetMsg.filename,
                    filesize: targetMsg.size || dec.byteLength,
                    msgType: targetMsg.type,
                  };
                }
              }
            } catch {}

            if (shouldFallbackThumb) {
              const fallbackThumb =
                typeof targetMsg.body === 'string' && targetMsg.body.startsWith('/9j/')
                  ? targetMsg.body
                  : typeof targetMsg._data?.body === 'string' && targetMsg._data.body.startsWith('/9j/')
                    ? targetMsg._data.body
                    : null;
              if (fallbackThumb) {
                return {
                  data: fallbackThumb,
                  mimetype: 'image/jpeg',
                  filename: 'thumb.jpg',
                  filesize: 0,
                  msgType: targetMsg.type,
                  isThumb: true,
                };
              }
            }

            return null;
          } catch {
            return null;
          }
        },
        candidateIds,
        rawId,
        normThread,
        allowThumbFallback,
      );

      if (!pageRes?.data) return null;

      const buf = Buffer.from(pageRes.data, 'base64');
      const fmt = detectImageFormatFromBuffer(buf, pageRes.mimetype);
      const effectiveMsgType = expectedMsgType || pageRes.msgType;
      const isThumb =
        Boolean((pageRes as any).isThumb) ||
        isLikelyTinyWhatsAppThumb({
          msgType: effectiveMsgType,
          buf,
          ext: fmt.ext,
          declaredSize: declaredSize || pageRes.filesize,
          dataB64: pageRes.data,
          rawThumbB64,
        });

      return {
        data: pageRes.data,
        mimetype: pageRes.mimetype || fmt.mime,
        filename: pageRes.filename,
        filesize: pageRes.filesize || buf.length,
        isThumb,
      };
    } catch {
      return null;
    }
  }

  /**
   * Resolve a serialized WhatsApp message ID candidate inside Chromium store when replying/quoting
   */
  private async resolveQuotedSerializedId(inst: WhatsAppInstance, jid: string, quotedMessageId: string): Promise<string> {
    const cands = buildCandidateSerializedIds(quotedMessageId, jid);
    if (cands.length === 0) return quotedMessageId;
    const rawId = extractRawMsgId(quotedMessageId);
    try {
      if (inst.client?.pupPage && !(typeof inst.client.pupPage.isClosed === 'function' && inst.client.pupPage.isClosed())) {
        const resolved = await inst.client.pupPage.evaluate((candidates: string[], targetRaw: string, targetJid: string) => {
          try {
            const safeRequire = (name: string) => {
              try {
                return typeof (window as any).require === 'function' ? (window as any).require(name) : null;
              } catch {
                return null;
              }
            };
            const collections = safeRequire('WAWebCollections');
            const Msg = collections?.Msg || (window as any).Store?.Msg;
            const Chat = collections?.Chat || (window as any).Store?.Chat;
            for (const cand of candidates) {
              const found = Msg?.get?.(cand);
              if (found?.id?._serialized) return found.id._serialized;
            }
            const chat = targetJid ? Chat?.get?.(targetJid) : null;
            const cm = chat?.msgs?.getModelsArray ? chat.msgs.getModelsArray() : chat?.msgs?.models;
            if (Array.isArray(cm)) {
              const hit = cm.find(
                (m: any) =>
                  (m?.id?._serialized && candidates.includes(m.id._serialized)) ||
                  (targetRaw && m?.id?.id === targetRaw),
              );
              if (hit?.id?._serialized) return hit.id._serialized;
            }
          } catch {}
          return null;
        }, cands, rawId, jid);
        if (typeof resolved === 'string' && resolved) return resolved;
      }
    } catch {}
    return cands[0];
  }

  /**
   * Send an outgoing WhatsApp message to a customer or group
   */
  public async sendMessage(
    accountId: string,
    toJid: string,
    content: string,
    attachments?: any[],
    options?: { quotedMessageId?: string }
  ): Promise<{ id: string; success: boolean }> {
    const inst = this.instances.get(accountId);
    if (!inst || inst.status !== 'connected' || !inst.client) {
      throw new Error('Tài khoản WhatsApp chưa kết nối hoặc đã mất phiên');
    }

    const jid = this.normalizeJid(toJid);
    let sendOpts: Record<string, any> | undefined;
    if (options?.quotedMessageId) {
      const quotedId = await this.resolveQuotedSerializedId(inst, jid, options.quotedMessageId);
      sendOpts = { quotedMessageId: quotedId };
    }

    let sent: any;
    try {
      sent = sendOpts
        ? await inst.client.sendMessage(jid, content, sendOpts)
        : await inst.client.sendMessage(jid, content);
    } catch (err) {
      if (sendOpts?.quotedMessageId) {
        logger.warn(`[whatsapp:${accountId}] sendMessage with quote failed, retrying without quote:`, (err as any)?.message || err);
        sent = await inst.client.sendMessage(jid, content);
      } else {
        throw err;
      }
    }

    return {
      id: sent?.id?.id || `wa_out_${Date.now()}`,
      success: true,
    };
  }

  /**
   * On-demand download of media for a specific WhatsApp message ID
   */
  public async downloadMediaByMsgId(
    accountId: string,
    msgId: string,
    threadId?: string | null,
    isSelf?: boolean,
  ): Promise<{ data: string; mimetype?: string; filename?: string; filesize?: number; isThumb?: boolean } | null> {
    const inst = this.instances.get(accountId);
    if (!inst || !inst.client || !inst.client.pupPage) return null;

    return await this.extractMediaFromBrowserPage(
      inst.client,
      msgId,
      threadId,
      isSelf,
      undefined,
      undefined,
      undefined,
      true,
    );
  }

  /**
   * Send media (image/document/file) to a WhatsApp customer or group
   */
  public async sendMedia(
    accountId: string,
    toJid: string,
    filePathOrBuffer: string | Buffer,
    filename: string,
    mimeType?: string,
    caption?: string,
    sendOptions?: { quotedMessageId?: string }
  ): Promise<{ id: string; success: boolean }> {
    const inst = this.instances.get(accountId);
    if (!inst || inst.status !== 'connected' || !inst.client) {
      throw new Error('Tài khoản WhatsApp chưa kết nối hoặc đã mất phiên');
    }

    const jid = this.normalizeJid(toJid);

    let media: any;
    if (typeof filePathOrBuffer === 'string') {
      media = (wwebjs as any).MessageMedia.fromFilePath(filePathOrBuffer);
      if (filename) media.filename = filename;
      if (mimeType) media.mimetype = mimeType;
    } else {
      const b64 = filePathOrBuffer.toString('base64');
      const mime = mimeType || 'image/jpeg';
      media = new (wwebjs as any).MessageMedia(mime, b64, filename);
    }

    const options: any = {};
    if (caption && caption.trim()) {
      options.caption = caption.trim();
    }
    if (sendOptions?.quotedMessageId) {
      options.quotedMessageId = await this.resolveQuotedSerializedId(inst, jid, sendOptions.quotedMessageId);
    }

    let sent: any;
    try {
      sent = await inst.client.sendMessage(jid, media, options);
    } catch (err) {
      if (options.quotedMessageId) {
        logger.warn(`[whatsapp:${accountId}] sendMedia with quote failed, retrying without quote:`, (err as any)?.message || err);
        const fallbackOpts = { ...options };
        delete fallbackOpts.quotedMessageId;
        sent = await inst.client.sendMessage(jid, media, fallbackOpts);
      } else {
        throw err;
      }
    }
    const sentId = extractRawMsgId(sent?.id?.id || sent?.id?._serialized) || `wa_out_${Date.now()}`;

    return {
      id: sentId,
      success: true,
    };
  }

  /**
   * Send reaction to a WhatsApp message
   */
  public async sendReaction(accountId: string, threadId: string, msgId: string, emoji: string): Promise<any> {
    const inst = this.instances.get(accountId);
    if (!inst || !inst.client || inst.status !== 'connected') {
      throw new Error('Tài khoản WhatsApp chưa kết nối');
    }
    const client = inst.client;
    const jid = this.normalizeJid(threadId);
    const rawId = extractRawMsgId(msgId);
    const candidateIds = buildCandidateSerializedIds(msgId, jid);
    try {
      await this.ensureWwebjsPatched(client.pupPage);
      const chat = await client.getChatById(jid);
      const messages = await chat.fetchMessages({ limit: 50 });
      const target = messages.find(
        (m: any) =>
          (m.id?._serialized && candidateIds.includes(m.id._serialized)) ||
          (m.id?.id && m.id.id === rawId),
      );
      if (target) {
        return await target.react(emoji || '');
      }
      if (client.pupPage) {
        return await client.pupPage.evaluate(
          async (cands: string[], targetRawId: string, targetJid: string, reactionText: string) => {
            const safeRequire = (name: string) => {
              try {
                return typeof (window as any).require === 'function' ? (window as any).require(name) : null;
              } catch {
                return null;
              }
            };
            const collections = safeRequire('WAWebCollections');
            const Msg = collections?.Msg || (window as any).Store?.Msg;
            const Chat = collections?.Chat || (window as any).Store?.Chat;
            const Reactions = (window as any).Store?.Reactions || safeRequire('WAWebSendReactionMsgAction');
            const matchesAnyId = (m: any) =>
              Boolean(
                (m?.id?._serialized && cands.includes(m.id._serialized)) ||
                  (m?.id?.id && m.id.id === targetRawId),
              );

            let msg: any = null;
            if (Msg?.get) {
              for (const cand of cands) {
                msg = Msg.get(cand);
                if (msg) break;
              }
            }
            if (!msg) {
              const models = Msg?.getModelsArray ? Msg.getModelsArray() : Msg?.models;
              if (Array.isArray(models)) msg = models.find(matchesAnyId) || null;
            }
            if (!msg && targetJid && Chat) {
              const c = Chat.get?.(targetJid) || (await Chat.find?.(targetJid).catch(() => null));
              const cm = c?.msgs?.getModelsArray ? c.msgs.getModelsArray() : c?.msgs?.models;
              if (Array.isArray(cm)) msg = cm.find(matchesAnyId) || null;
            }
            if (!msg && Msg?.getMessagesById) {
              for (const cand of cands) {
                try {
                  const fetched = await Msg.getMessagesById([cand]);
                  msg = fetched?.messages?.[0];
                  if (msg) break;
                } catch {}
              }
            }
            if (msg && Reactions?.sendReactionToMsg) {
              return await Reactions.sendReactionToMsg(msg, reactionText);
            }
          },
          candidateIds,
          rawId,
          jid,
          emoji || '',
        );
      }
    } catch (e: any) {
      logger.warn(`[whatsapp:${accountId}] sendReaction error:`, e?.message || e);
      throw e;
    }
  }

  /**
   * Safely download message media with multiple fallbacks:
   * 1. Standard msg.downloadMedia() (rejecting micro-thumbnails if full resolution is obtainable)
   * 2. Browser page evaluation checking mediaBlob, renderableUrl, and WAWebDownloadManager
   */
  private async downloadMediaSafe(
    inst: WhatsAppInstance,
    msg: any
  ): Promise<{ data: string; mimetype?: string; filename?: string; filesize?: number; isThumb?: boolean } | null> {
    if (!msg) return null;

    const rawThumbB64 =
      (typeof msg.body === 'string' && msg.body.startsWith('/9j/') ? msg.body.trim() : '') ||
      (typeof msg._data?.body === 'string' && msg._data.body.startsWith('/9j/') ? msg._data.body.trim() : '') ||
      (typeof msg._data?.preview === 'string' && msg._data.preview.startsWith('/9j/') ? msg._data.preview.trim() : '');

    const msgSerialized = getSerializedMsgKey(msg);
    const rawId = extractRawMsgId(msg?.id?.id || msg?._data?.id?.id || msgSerialized);
    const remoteJid =
      msg?.id?.remote?._serialized ||
      msg?.id?.remote ||
      (msg?.fromMe ? msg?.to : msg?.from) ||
      '';
    const declaredSize = Number(msg?._data?.size || msg?.size || 0);

    let lastResortMedia: { data: string; mimetype?: string; filename?: string; filesize?: number; isThumb?: boolean } | null = null;

    await this.ensureWwebjsPatched(inst?.client?.pupPage);

    // Try standard msg.downloadMedia() first (now with valid _serialized key)
    for (let i = 0; i < 3; i++) {
      try {
        const media = await msg.downloadMedia();
        if (media?.data) {
          const buf = Buffer.from(media.data, 'base64');
          const fmt = detectImageFormatFromBuffer(buf, media.mimetype);
          const isTinyThumb = isLikelyTinyWhatsAppThumb({
            msgType: msg.type,
            buf,
            ext: fmt.ext,
            declaredSize,
            dataB64: media.data,
            rawThumbB64,
          });
          if (!isTinyThumb) {
            return { ...media, mimetype: media.mimetype || fmt.mime, isThumb: false };
          }
          lastResortMedia = { ...media, mimetype: media.mimetype || fmt.mime, isThumb: true };
        }
      } catch (err: any) {
        logger.debug(`[whatsapp] downloadMedia try ${i + 1} err:`, err?.message || err);
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    // Direct browser page extraction fallback with all candidate serialized keys
    const pageRes = await this.extractMediaFromBrowserPage(
      inst?.client,
      msgSerialized || rawId,
      remoteJid,
      Boolean(msg.fromMe),
      msg.type,
      declaredSize,
      rawThumbB64,
      false,
    );
    if (pageRes?.data) {
      if (!pageRes.isThumb) {
        return pageRes;
      }
      if (!lastResortMedia) {
        lastResortMedia = pageRes;
      }
    }

    if (lastResortMedia) {
      return lastResortMedia;
    }

    // Ultimate fallback: return embedded thumbnail only when full resolution failed
    if (rawThumbB64) {
      return {
        data: rawThumbB64,
        mimetype: 'image/jpeg',
        filename: 'thumb.jpg',
        filesize: Buffer.from(rawThumbB64, 'base64').length,
        isThumb: true,
      };
    }

    return null;
  }

  /**
   * Send voice note (PTT / audio waveform) to WhatsApp
   */
  public async sendVoice(
    accountId: string,
    threadId: string,
    voiceBufferOrPath: string | Buffer,
    mimetype?: string
  ): Promise<{ id: string; success: boolean }> {
    const inst = this.instances.get(accountId);
    if (!inst || !inst.client || inst.status !== 'connected') {
      throw new Error('Tài khoản WhatsApp chưa kết nối');
    }
    const jid = this.normalizeJid(threadId);

    let media: any;
    if (typeof voiceBufferOrPath === 'string' && fs.existsSync(voiceBufferOrPath)) {
      media = (wwebjs as any).MessageMedia.fromFilePath(voiceBufferOrPath);
    } else {
      const buf = Buffer.isBuffer(voiceBufferOrPath) ? voiceBufferOrPath : Buffer.from(voiceBufferOrPath, 'base64');
      media = new (wwebjs as any).MessageMedia(mimetype || 'audio/ogg; codecs=opus', buf.toString('base64'), 'voice.ogg');
    }

    const sent = await inst.client.sendMessage(jid, media, { sendAudioAsVoice: true });
    const sentId = extractRawMsgId(sent?.id?.id || sent?.id?._serialized) || `wa_voice_${Date.now()}`;
    return { id: sentId, success: true };
  }

  /**
   * Revoke (undo / delete for everyone) a WhatsApp message (CRM -> Mobile)
   */
  public async revokeMessage(accountId: string, threadId: string, msgId: string): Promise<boolean> {
    const inst = this.instances.get(accountId);
    if (!inst || !inst.client || inst.status !== 'connected') {
      throw new Error('Tài khoản WhatsApp chưa kết nối');
    }
    const client = inst.client;
    const jid = this.normalizeJid(threadId);
    const rawId = extractRawMsgId(msgId);
    const candidateIds = buildCandidateSerializedIds(msgId, jid);

    try {
      if (client.pupPage) {
        await this.ensureWwebjsPatched(client.pupPage);
        const revoked = await client.pupPage.evaluate(async (cands: string[], targetRawId: string, targetJid: string) => {
          try {
            const safeRequire = (name: string) => {
              try {
                return typeof (window as any).require === 'function' ? (window as any).require(name) : null;
              } catch {
                return null;
              }
            };
            const collections = safeRequire('WAWebCollections');
            const Msg = collections?.Msg || (window as any).Store?.Msg;
            const Chat = collections?.Chat || (window as any).Store?.Chat;
            const Cmd = safeRequire('WAWebCmd')?.Cmd;

            if (!Msg || !Cmd) return false;

            const matchesAnyId = (m: any): boolean => {
              const ser = m?.id?._serialized;
              const id = m?.id?.id;
              return Boolean((ser && cands.includes(ser)) || (id && id === targetRawId) || (ser && targetRawId && ser.endsWith(`_${targetRawId}`)));
            };

            let msg: any = null;
            for (const cand of cands) {
              msg = Msg.get?.(cand);
              if (msg) break;
            }
            if (!msg) {
              const models = Msg.getModelsArray ? Msg.getModelsArray() : Msg.models;
              if (Array.isArray(models)) msg = models.find(matchesAnyId) || null;
            }

            if (!msg && targetJid && Chat) {
              const chat = Chat.get?.(targetJid) || (await Chat.find?.(targetJid).catch(() => null));
              const chatMsgs = chat?.msgs?.getModelsArray ? chat.msgs.getModelsArray() : chat?.msgs?.models;
              if (Array.isArray(chatMsgs)) {
                msg = chatMsgs.find(matchesAnyId) || null;
              }
            }

            if (!msg && Msg.getMessagesById) {
              for (const cand of cands) {
                try {
                  const fetched = await Msg.getMessagesById([cand]);
                  msg = fetched?.messages?.[0];
                  if (msg) break;
                } catch {}
              }
            }

            if (!msg && Chat) {
              const chatModels = Chat.getModelsArray ? Chat.getModelsArray() : Chat.models;
              if (Array.isArray(chatModels)) {
                for (const c of chatModels) {
                  const cm = c?.msgs?.getModelsArray ? c.msgs.getModelsArray() : c?.msgs?.models;
                  if (Array.isArray(cm)) {
                    msg = cm.find(matchesAnyId) || null;
                    if (msg) break;
                  }
                }
              }
            }

            if (!msg) return false;

            const chat = (Chat?.get(msg.id?.remote) || (await Chat?.find(msg.id?.remote))) || (targetJid ? (Chat?.get(targetJid) || await Chat?.find(targetJid)) : null);
            if (!chat) return false;

            const isVersion3000 = (window as any).WWebJS?.compareWwebVersions((window as any).Debug?.VERSION || '2.3000.0', '>=', '2.3000.0');
            if (isVersion3000) {
              await Cmd.sendRevokeMsgs(chat, { list: [msg], type: 'message' }, { clearMedia: true });
            } else {
              await Cmd.sendRevokeMsgs(chat, [msg], { clearMedia: true, type: msg.id?.fromMe ? 'Sender' : 'Admin' });
            }
            return true;
          } catch {
            return false;
          }
        }, candidateIds, rawId, jid);

        if (revoked) return true;
      }

      // Fallback: standard getMessageById across candidates
      if (typeof client.getMessageById === 'function') {
        for (const cand of candidateIds) {
          try {
            const msg = await client.getMessageById(cand);
            if (msg && typeof msg.delete === 'function') {
              await msg.delete(true);
              return true;
            }
          } catch {}
        }
      }

      return false;
    } catch (e: any) {
      logger.warn(`[whatsapp:${accountId}] revokeMessage error:`, e?.message || e);
      return false;
    }
  }

  /**
   * Disconnect WhatsApp instance
   */
  public async disconnect(accountId: string): Promise<void> {
    const inst = this.instances.get(accountId);
    if (inst) {
      if (inst.canvasObserverTimer) {
        clearInterval(inst.canvasObserverTimer);
        inst.canvasObserverTimer = undefined;
      }
      if (inst.canvasObserverStopTimer) {
        clearTimeout(inst.canvasObserverStopTimer);
        inst.canvasObserverStopTimer = undefined;
      }
      try {
        await inst.client.logout();
      } catch (e: any) {
        logger.warn(`[whatsapp:${accountId}:disconnect] logout error:`, e?.message || e);
      }
      try {
        await inst.client.destroy();
      } catch (e: any) {
        logger.warn(`[whatsapp:${accountId}:disconnect] destroy error:`, e?.message || e);
      }
      this.instances.delete(accountId);
    }

    try {
      await prisma.zaloAccount.update({
        where: { id: accountId },
        data: { status: 'disconnected' },
      });
    } catch (e: any) {
      // Account may have already been purged from database
    }
  }

  /**
   * Dismiss any blocking modals or splash banners on WhatsApp Web
   * (e.g. "Có gì mới trên WhatsApp Web", "Bật thông báo", "Làm mới", "Tiếp tục", etc.)
   */
  public async autoDismissModals(page: any): Promise<boolean> {
    if (!page || (typeof page.isClosed === 'function' && page.isClosed())) return false;
    try {
      let anyClicked = false;
      for (let pass = 0; pass < 3; pass++) {
        const clicked = await page.evaluate(() => {
          let acted = false;
          const clickEl = (el: HTMLElement) => {
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            el.click();
          };
          const buttons = Array.from(document.querySelectorAll('button, [role="button"], a')) as HTMLElement[];
          for (const btn of buttons) {
            const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
            if (
              text === 'ok' ||
              text === 'tiếp tục' ||
              text === 'continue' ||
              text === 'làm mới' ||
              text === 'refresh' ||
              text === 'update' ||
              text === 'got it' ||
              text === 'hiểu rồi' ||
              text === 'đồng ý' ||
              text === 'bật'
            ) {
              clickEl(btn);
              acted = true;
            }
          }
          const closeBtns = Array.from(
            document.querySelectorAll('[data-testid="popup-controls-ok"], [data-testid="x"], [data-icon="x"], [aria-label="Đóng"], [aria-label="Close"]')
          ) as HTMLElement[];
          for (const btn of closeBtns) {
            clickEl(btn);
            acted = true;
          }
          return acted;
        });
        if (clicked) {
          anyClicked = true;
          await new Promise((r) => setTimeout(r, 600));
        } else {
          break;
        }
      }
      if (anyClicked) {
        logger.info('[whatsapp] Automatically dismissed modal/banner dialog on WhatsApp Web');
      }
      return anyClicked;
    } catch (e: any) {
      logger.debug(`[whatsapp] autoDismissModals error: ${e?.message || e}`);
      return false;
    }
  }

  /**
   * Fetch recent chats and recent message history from WhatsApp Web client and sync to CRM database
   */
  public async syncRecentChats(
    accountId: string,
    orgId?: string,
    limitChats = 50,
    limitMsgs = 20
  ): Promise<{ syncedChats: number; syncedMessages: number }> {
    const inst = this.instances.get(accountId);
    if (!inst || !inst.client) {
      throw new Error('Tài khoản WhatsApp chưa kết nối');
    }
    const client = inst.client;

    if (!orgId) {
      const acc = await prisma.zaloAccount.findUnique({ where: { id: accountId } });
      if (!acc) throw new Error('Không tìm thấy tài khoản trong cơ sở dữ liệu');
      orgId = acc.orgId;
    }

    if (client.pupPage) {
      await this.ensureWwebjsPatched(client.pupPage);
      await this.autoDismissModals(client.pupPage);
    }

    logger.info(`[whatsapp:${accountId}] Starting recent chats sync (limitChats=${limitChats}, limitMsgs=${limitMsgs})...`);

    let rawChatList: any[] = [];
    try {
      rawChatList = await client.getChats();
    } catch (err: any) {
      logger.warn(`[whatsapp:${accountId}] client.getChats() error:`, err?.message || err);
    }

    // Fallback: If client.getChats() returns 0 or throws (due to WhatsApp Web internal Store changes),
    // extract chats directly from Chromium page context via WAWebCollections or #pane-side DOM!
    if (!rawChatList || rawChatList.length === 0) {
      try {
        logger.info(`[whatsapp:${accountId}] Trying Chromium page context fallback for chats...`);
        const extracted = await client.pupPage.evaluate(() => {
          const safeRequire = (name: string) => {
            try { return typeof (window as any).require === 'function' ? (window as any).require(name) : null; } catch { return null; }
          };
          const collections = safeRequire('WAWebCollections');
          const ChatStore = collections?.Chat || (window as any).Store?.Chat;
          let list: any[] = [];
          if (ChatStore) {
            const arr = typeof ChatStore.getModelsArray === 'function' ? ChatStore.getModelsArray() : (ChatStore.models || []);
            list = arr.map((c: any) => ({
              id: c.id?._serialized || (typeof c.id === 'object' ? `${c.id?.user || c.id?.id}@${c.id?.server || 'c.us'}` : String(c.id || '')),
              name: c.name || c.formattedTitle || '',
              isGroup: Boolean(c.isGroup),
              unreadCount: typeof c.unreadCount === 'number' ? c.unreadCount : 0,
              timestamp: c.t || Math.floor(Date.now() / 1000),
            }));
          }
          if (!list || list.length === 0) {
            // Second fallback: Extract from #pane-side DOM
            const pane = document.querySelector('#pane-side');
            if (pane) {
              const items = Array.from(pane.querySelectorAll('[role="listitem"], [data-testid="cell-frame-container"]'));
              list = items.map((el: any) => {
                const titleEl = el.querySelector('[title]');
                const name = titleEl?.getAttribute('title') || titleEl?.innerText || '';
                const text = el.innerText || '';
                const lines = text.split('\n').filter(Boolean);
                const unreadMatch = lines.find((l: string) => /^\d+$/.test(l.trim()));
                return {
                  id: null,
                  name: name || lines[0] || 'WhatsApp Chat',
                  isGroup: text.includes('~') || lines.length > 3,
                  unreadCount: unreadMatch ? parseInt(unreadMatch, 10) : 0,
                  timestamp: Math.floor(Date.now() / 1000),
                  lastSnippet: lines.slice(1, 3).join(' '),
                };
              });
            }
          }
          return list;
        });

        logger.info(`[whatsapp:${accountId}] Chromium page context extracted ${extracted?.length || 0} chats`);
        if (extracted && extracted.length > 0) {
          rawChatList = extracted;
        }
      } catch (fallbackErr: any) {
        logger.error(`[whatsapp:${accountId}] pupPage evaluate fallback error:`, fallbackErr?.message || fallbackErr);
      }
    }

    let syncedChats = 0;
    let syncedMessages = 0;

    const chatSlice = rawChatList.slice(0, limitChats);
    for (const chat of chatSlice) {
      try {
        const rawId = typeof chat.id === 'string' ? chat.id : (chat.id?._serialized || '');
        let remoteJid = rawId;

        // If no remoteJid (DOM fallback), generate or find matching conversation
        if (!remoteJid) {
          const chatName = chat.name || 'WhatsApp Chat';
          const existing = await prisma.conversation.findFirst({
            where: { zaloAccountId: accountId, channel: 'whatsapp', contact: { fullName: chatName } },
          });
          remoteJid = existing?.externalThreadId || `wa_chat_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        }

        if (remoteJid === 'status@broadcast') continue;

        const isGroup = Boolean(chat.isGroup || remoteJid.endsWith('@g.us'));
        const contactPhone = (isGroup ? '' : remoteJid).split('@')[0] || '';
        let chatName = chat.name || chat.formattedTitle || '';
        const unreadCount = Number(chat.unreadCount || 0);

        let contactAvatar: string | undefined;
        let contactId: string | null = null;

        if (isGroup) {
          if (!chatName) chatName = 'Nhóm WhatsApp';
          // Upsert Contact for group so it displays the group name in CRM list
          const existingGroupContact = await prisma.contact.findFirst({
            where: {
              orgId,
              channel: 'whatsapp',
              OR: [
                { whatsappJid: remoteJid },
                { fullName: chatName },
              ],
            },
          });
          if (existingGroupContact) {
            contactId = existingGroupContact.id;
            if (chatName && existingGroupContact.fullName !== chatName) {
              await prisma.contact.update({
                where: { id: existingGroupContact.id },
                data: { fullName: chatName, whatsappJid: remoteJid },
              });
            }
          } else {
            const newGroupContact = await prisma.contact.create({
              data: {
                id: randomUUID(),
                orgId,
                channel: 'whatsapp',
                whatsappJid: remoteJid,
                fullName: chatName,
                metadata: { isGroup: true },
                status: 'new',
              },
            });
            contactId = newGroupContact.id;
          }
        } else {
          // Resolve 1-on-1 contact name: prioritize contact.name / pushname / shortName over raw phone number!
          let contactObj: any = null;
          if (typeof chat.getContact === 'function') {
            try {
              contactObj = await chat.getContact();
              contactAvatar = await contactObj.getProfilePicUrl().catch(() => undefined);
            } catch {}
          }

          const rawCandidate =
            contactObj?.name ||
            contactObj?.pushname ||
            contactObj?.shortName ||
            contactObj?.verifiedName ||
            (chat.name && chat.name !== contactPhone ? chat.name : '') ||
            (chat.formattedTitle && chat.formattedTitle !== contactPhone ? chat.formattedTitle : '');

          const resolvedName = rawCandidate && rawCandidate.trim() ? rawCandidate.trim() : (contactPhone ? `+${contactPhone}` : 'Khách hàng WhatsApp');
          chatName = resolvedName;

          // Upsert Contact in database
          const existingContact = await prisma.contact.findFirst({
            where: {
              orgId,
              channel: 'whatsapp',
              OR: [
                { whatsappJid: remoteJid },
                ...(contactPhone
                  ? [
                      { phone: contactPhone },
                      { phone: contactPhone.startsWith('84') ? '0' + contactPhone.slice(2) : `+${contactPhone}` },
                    ]
                  : []),
              ],
            },
          });

          if (existingContact) {
            contactId = existingContact.id;
            const updateData: any = {};
            if (contactAvatar && !existingContact.avatarUrl) {
              updateData.avatarUrl = contactAvatar;
            }
            // Update to real name if previously it was just a phone number or default name
            if (resolvedName && !resolvedName.startsWith('+') && existingContact.fullName !== resolvedName) {
              updateData.fullName = resolvedName;
            }
            if (Object.keys(updateData).length > 0) {
              await prisma.contact.update({
                where: { id: existingContact.id },
                data: updateData,
              });
            }
          } else {
            const newContact = await prisma.contact.create({
              data: {
                id: randomUUID(),
                orgId,
                channel: 'whatsapp',
                whatsappJid: remoteJid,
                phone: contactPhone ? (contactPhone.startsWith('84') ? '0' + contactPhone.slice(2) : `+${contactPhone}`) : null,
                fullName: chatName,
                avatarUrl: contactAvatar || null,
                status: 'new',
              },
            });
            contactId = newContact.id;
          }
        }

        // Upsert Conversation
        let conversation = await prisma.conversation.findFirst({
          where: {
            zaloAccountId: accountId,
            externalThreadId: remoteJid,
          },
        });

        const lastMsgDate = chat.timestamp ? new Date(chat.timestamp * 1000) : new Date();

        if (conversation) {
          conversation = await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              unreadCount,
              lastMessageAt: lastMsgDate,
              ...(contactId && !conversation.contactId ? { contactId } : {}),
            },
          });
        } else {
          conversation = await prisma.conversation.create({
            data: {
              id: randomUUID(),
              orgId,
              zaloAccountId: accountId,
              contactId,
              channel: 'whatsapp',
              threadType: isGroup ? 'group' : 'user',
              externalThreadId: remoteJid,
              lastMessageAt: lastMsgDate,
              unreadCount,
              isReplied: true,
            },
          });
        }

        syncedChats++;

        // Fetch recent messages for this chat
        let msgs: any[] = [];
        let chatInstance = chat;
        if (typeof chat.fetchMessages !== 'function' && client.getChatById && remoteJid && remoteJid.includes('@')) {
          try {
            chatInstance = await client.getChatById(remoteJid);
          } catch {}
        }

        if (typeof chatInstance.fetchMessages === 'function') {
          try {
            msgs = await chatInstance.fetchMessages({ limit: limitMsgs });
          } catch (fetchErr: any) {
            logger.warn(`[whatsapp:${accountId}] fetchMessages failed for ${remoteJid}:`, fetchErr?.message || fetchErr);
          }
        }

        // Fallback 1: via pupPage evaluate
        if ((!msgs || msgs.length === 0) && client.pupPage && remoteJid && remoteJid.includes('@')) {
          try {
            const pageMsgs = await client.pupPage.evaluate(async (jid: string, maxMsgs: number) => {
              const safeRequire = (name: string) => {
                try { return typeof (window as any).require === 'function' ? (window as any).require(name) : null; } catch { return null; }
              };
              const collections = safeRequire('WAWebCollections');
              const ChatStore = collections?.Chat || (window as any).Store?.Chat;
              const chatModel = ChatStore?.get?.(jid);
              if (!chatModel) return [];

              try {
                if (typeof chatModel.loadEarlierMsgs === 'function') {
                  await chatModel.loadEarlierMsgs();
                } else {
                  const convMsgs = safeRequire('WAWebChatLoadEarlierMsgs') || (window as any).Store?.ConversationMsgs;
                  if (convMsgs?.loadEarlierMsgs) {
                    await convMsgs.loadEarlierMsgs(chatModel);
                  }
                }
              } catch {}

              const msgList = typeof chatModel.msgs?.getModelsArray === 'function'
                ? chatModel.msgs.getModelsArray()
                : (chatModel.msgs?.models || chatModel.msgs?._models || []);

              return msgList.slice(-maxMsgs).map((m: any) => ({
                id: m.id?._serialized || (typeof m.id === 'object' ? `${m.id?.fromMe}_${m.id?.remote?._serialized || m.id?.remote}_${m.id?.id}` : String(m.id || '')),
                body: m.body || m.caption || '',
                fromMe: Boolean(m.fromMe || m.id?.fromMe),
                type: m.type || 'chat',
                hasMedia: Boolean(m.hasMedia || m.type === 'image' || m.type === 'video' || m.type === 'document' || m.type === 'audio' || m.type === 'ptt'),
                timestamp: m.t || Math.floor(Date.now() / 1000),
                author: m.author?._serialized || m.author || (m.from?._serialized || m.from || ''),
                pushname: m.sender?.pushname || m.pushname || '',
              }));
            }, remoteJid, limitMsgs);

            if (pageMsgs && pageMsgs.length > 0) {
              msgs = pageMsgs;
            }
          } catch (evalErr: any) {
            logger.debug(`[whatsapp:${accountId}] page msg eval error: ${evalErr?.message || evalErr}`);
          }
        }

        // Fallback 2: if fetchMessages returned empty, use chat.lastMessage if present
        if ((!msgs || msgs.length === 0) && (chat.lastMessage || chat._data?.lastMessage)) {
          const lm = chat.lastMessage || chat._data?.lastMessage;
          msgs = [lm];
        }

        // Fallback 3: for messages: if chat has lastSnippet
        if ((!msgs || msgs.length === 0) && chat.lastSnippet) {
          const sentAt = lastMsgDate;
          const snippetId = `wa_snp_${Date.now()}_${Math.random().toString(36).substring(7)}`;
          await prisma.message.create({
            data: {
              id: randomUUID(),
              conversationId: conversation.id,
              zaloMsgId: snippetId,
              senderType: 'contact',
              senderUid: remoteJid,
              senderName: chatName,
              content: chat.lastSnippet,
              contentType: 'text',
              attachments: '[]',
              sentAt,
            },
          }).catch(() => {});
          syncedMessages++;
        }

        for (const msg of msgs) {
          try {
            if (['e2e_notification', 'notification_template', 'call_log', 'gp2', 'protocol'].includes(msg.type)) {
              continue;
            }

            const isSelf = Boolean(msg.fromMe);
            const serializedKey = getSerializedMsgKey(msg) || buildCandidateSerializedIds(
              msg?.id?.id || msg?._data?.id?.id || '',
              remoteJid,
              isSelf,
              isGroup ? (msg?.id?.participant?._serialized || msg?.id?.participant || msg?.author) : undefined,
            )[0];
            const rawMsgId = extractRawMsgId(msg?.id?.id || msg?._data?.id?.id || serializedKey);

            // Check if message already exists
            const candidateIds = buildCandidateSerializedIds(serializedKey || rawMsgId, remoteJid, isSelf);
            const exists = await prisma.message.findFirst({
              where: {
                conversationId: conversation.id,
                OR: [
                  { zaloMsgId: { in: candidateIds } },
                  ...(rawMsgId ? [{ zaloMsgId: rawMsgId }] : []),
                ],
              },
            });

            if (exists) continue;

            let content = msg.body || '';
            let contentType = 'text';
            const attachments: any[] = [];

            if (msg.hasMedia) {
              if (msg.type === 'image') contentType = 'image';
              else if (msg.type === 'video') contentType = 'video';
              else if (msg.type === 'audio' || msg.type === 'ptt') contentType = 'voice';
              else if (msg.type === 'document') contentType = 'file';
              else contentType = 'file';
              if (!content) {
                content =
                  contentType === 'image'
                    ? '[Hình ảnh]'
                    : contentType === 'video'
                    ? '[Video]'
                    : contentType === 'voice'
                    ? '[Ghi âm]'
                    : '[Tài liệu]';
              }
            }

            const senderAuthor = isGroup ? (isSelf ? '' : (msg.author?._serialized || msg.author || msg.from?._serialized || msg.from || '')) : remoteJid;
            const senderPhone = senderAuthor ? senderAuthor.split('@')[0] : '';
            const msgSenderName = isSelf ? 'Bạn' : (msg.pushname || (senderPhone ? `+${senderPhone}` : chatName));
            const sentAt = msg.timestamp ? new Date(msg.timestamp * 1000) : new Date();

            await prisma.message.create({
              data: {
                id: randomUUID(),
                conversationId: conversation.id,
                zaloMsgId: serializedKey || rawMsgId || `wa_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                senderType: isSelf ? 'self' : 'contact',
                senderUid: isGroup ? (msg.author || remoteJid) : (isSelf ? (inst.phone || 'self') : remoteJid),
                senderName: msgSenderName,
                content,
                contentType,
                attachments: attachments.length ? JSON.stringify(attachments) : '[]',
                sentAt,
              },
            });

            syncedMessages++;
          } catch (msgErr: any) {
            logger.warn(`[whatsapp:${accountId}] Error syncing message:`, msgErr?.message || msgErr);
          }
        }

        // Notify frontends via Socket.IO
        if (this.io) {
          this.io.to(`org:${orgId}`).emit('conversation:updated', {
            id: conversation.id,
            lastMessageAt: conversation.lastMessageAt,
            unreadCount: conversation.unreadCount,
            channel: 'whatsapp',
          });
        }
      } catch (chatErr: any) {
        logger.error(`[whatsapp:${accountId}] Error syncing chat:`, chatErr);
      }
    }

    logger.info(`[whatsapp:${accountId}] Sync completed: ${syncedChats} chats, ${syncedMessages} messages`);
    if (this.io) {
      this.io.to(`org:${orgId}`).emit('refresh-conversations');
    }

    return { syncedChats, syncedMessages };
  }

  /**
   * Fetch and save recent messages for a specific WhatsApp chat into the database on demand
   */
  public async fetchChatMessages(accountId: string, remoteJid: string, limit = 30): Promise<number> {
    const inst = this.instances.get(accountId);
    if (!inst || !inst.client) return 0;
    const client = inst.client;

    try {
      let chat: any = null;
      if (typeof client.getChatById === 'function') {
        chat = await client.getChatById(remoteJid).catch(() => null);
      }
      if (!chat) {
        const chats = await client.getChats().catch(() => []);
        chat = chats.find((c: any) => (c.id?._serialized || c.id) === remoteJid);
      }

      let msgs: any[] = [];
      if (chat && typeof chat.fetchMessages === 'function') {
        msgs = await chat.fetchMessages({ limit }).catch(() => []);
      }

      // Fallback 1: via pupPage evaluate
      if ((!msgs || msgs.length === 0) && client.pupPage) {
        try {
          const pageMsgs = await client.pupPage.evaluate(async (jid: string, maxMsgs: number) => {
            const safeRequire = (name: string) => {
              try { return typeof (window as any).require === 'function' ? (window as any).require(name) : null; } catch { return null; }
            };
            const collections = safeRequire('WAWebCollections');
            const ChatStore = collections?.Chat || (window as any).Store?.Chat;
            const chatModel = ChatStore?.get?.(jid);
            if (!chatModel) return [];

            try {
              if (typeof chatModel.loadEarlierMsgs === 'function') {
                await chatModel.loadEarlierMsgs();
              } else {
                const convMsgs = safeRequire('WAWebChatLoadEarlierMsgs') || (window as any).Store?.ConversationMsgs;
                if (convMsgs?.loadEarlierMsgs) {
                  await convMsgs.loadEarlierMsgs(chatModel);
                }
              }
            } catch {}

            const msgList = typeof chatModel.msgs?.getModelsArray === 'function'
              ? chatModel.msgs.getModelsArray()
              : (chatModel.msgs?.models || chatModel.msgs?._models || []);

            return msgList.slice(-maxMsgs).map((m: any) => ({
              id: m.id?._serialized || (typeof m.id === 'object' ? `${m.id?.fromMe}_${m.id?.remote?._serialized || m.id?.remote}_${m.id?.id}` : String(m.id || '')),
              body: m.body || m.caption || '',
              fromMe: Boolean(m.fromMe || m.id?.fromMe),
              type: m.type || 'chat',
              hasMedia: Boolean(m.hasMedia || m.type === 'image' || m.type === 'video' || m.type === 'document' || m.type === 'audio' || m.type === 'ptt'),
              timestamp: m.t || Math.floor(Date.now() / 1000),
              author: m.author?._serialized || m.author || (m.from?._serialized || m.from || ''),
              pushname: m.sender?.pushname || m.pushname || '',
            }));
          }, remoteJid, limit);

          if (pageMsgs && pageMsgs.length > 0) {
            msgs = pageMsgs;
          }
        } catch {}
      }

      // Fallback 2: chat.lastMessage
      if ((!msgs || msgs.length === 0) && (chat?.lastMessage || chat?._data?.lastMessage)) {
        msgs = [chat.lastMessage || chat._data?.lastMessage];
      }

      if (!msgs || msgs.length === 0) return 0;

      const conversation = await prisma.conversation.findFirst({
        where: { zaloAccountId: accountId, externalThreadId: remoteJid },
        include: { contact: true },
      });
      if (!conversation) return 0;

      const isGroup = remoteJid.endsWith('@g.us') || Boolean(chat?.isGroup);
      const chatName = conversation.contact?.fullName || chat?.name || 'Khách hàng';

      let count = 0;
      for (const msg of msgs) {
        try {
          if (['e2e_notification', 'notification_template', 'call_log', 'gp2', 'protocol'].includes(msg.type)) continue;

          const isSelf = Boolean(msg.fromMe);
          const serializedKey = typeof msg.id === 'string' ? msg.id : (msg.id?._serialized || '');
          const rawMsgId = extractRawMsgId(msg?.id?.id || msg?._data?.id?.id || serializedKey);
          const zaloMsgId = serializedKey || rawMsgId || `wa_${Date.now()}_${Math.random().toString(36).substring(7)}`;

          const candidateIds = buildCandidateSerializedIds(serializedKey || rawMsgId, remoteJid, isSelf);
          const exists = await prisma.message.findFirst({
            where: {
              conversationId: conversation.id,
              OR: [
                { zaloMsgId: { in: candidateIds } },
                ...(rawMsgId ? [{ zaloMsgId: rawMsgId }] : []),
              ],
            },
          });
          if (exists) continue;

          let content = msg.body || '';
          let contentType = 'text';
          if (msg.hasMedia) {
            if (msg.type === 'image') contentType = 'image';
            else if (msg.type === 'video') contentType = 'video';
            else if (msg.type === 'audio' || msg.type === 'ptt') contentType = 'voice';
            else if (msg.type === 'document') contentType = 'file';
            else contentType = 'file';
            if (!content) {
              content = contentType === 'image' ? '[Hình ảnh]' : contentType === 'video' ? '[Video]' : contentType === 'voice' ? '[Ghi âm]' : '[Tài liệu]';
            }
          }

          const senderAuthor = isGroup ? (isSelf ? '' : (msg.author?._serialized || msg.author || msg.from?._serialized || msg.from || '')) : remoteJid;
          const senderPhone = senderAuthor ? senderAuthor.split('@')[0] : '';
          const msgSenderName = isSelf ? 'Bạn' : (msg.pushname || (senderPhone ? `+${senderPhone}` : chatName));
          const sentAt = msg.timestamp ? new Date(msg.timestamp * 1000) : new Date();

          await prisma.message.create({
            data: {
              id: randomUUID(),
              conversationId: conversation.id,
              zaloMsgId,
              senderType: isSelf ? 'self' : 'contact',
              senderUid: isSelf ? null : senderAuthor,
              senderName: msgSenderName,
              content,
              contentType,
              attachments: '[]',
              sentAt,
            },
          });
          count++;
        } catch {}
      }

      return count;
    } catch (err: any) {
      logger.warn(`[whatsapp:${accountId}] fetchChatMessages error for ${remoteJid}:`, err?.message || err);
      return 0;
    }
  }

  /**
   * Auto reconnect all existing connected WhatsApp accounts on server startup
   */
  public async autoReconnectAll(): Promise<void> {
    try {
      const waAccounts = await prisma.zaloAccount.findMany({
        where: { channel: 'whatsapp', status: 'connected' },
      });

      for (const acc of waAccounts) {
        logger.info(`[whatsapp] Auto-reconnecting WhatsApp Web account: ${acc.displayName || acc.id}`);
        this.initWhatsApp(acc.id, acc.orgId, acc.ownerUserId).catch((err) => {
          logger.warn(`[whatsapp] Failed to auto-reconnect ${acc.id}:`, err);
        });
      }
    } catch (e) {
      logger.error('[whatsapp] Auto-reconnect all error:', e);
    }
  }
}

export const whatsappPool = new WhatsAppAccountPool();
