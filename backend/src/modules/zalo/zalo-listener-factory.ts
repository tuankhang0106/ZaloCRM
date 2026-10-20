/**
 * zalo-listener-factory.ts — sets up zca-js listener events for one Zalo account.
 * Handles message routing, user-info caching, group detection, and undo events.
 * Extracted from ZaloAccountPool to keep zalo-pool.ts under 200 lines.
 */
import type { Server } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { handleIncomingMessage, handleMessageUndo } from '../chat/message-handler.js';
import { detectContentType, updateContactAvatar } from './zalo-message-helpers.js';
import { sendPushNotificationForMessage } from '../../shared/services/push-notification.js';
import { friendRequestStore } from './friend-request-store.js';

// Cached user info entry with 5-minute TTL
export interface UserInfoCacheEntry {
  zaloName: string;
  avatar: string;
  phone?: string;
  cachedAt: number;
}

const USER_INFO_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Fetch zaloName + avatar from API with a per-pool in-memory cache
async function resolveZaloName(
  api: any,
  uid: string,
  cache: Map<string, UserInfoCacheEntry>,
): Promise<{ zaloName: string; avatar: string }> {
  const cached = cache.get(uid);
  if (cached && Date.now() - cached.cachedAt < USER_INFO_CACHE_TTL_MS) {
    return { zaloName: cached.zaloName, avatar: cached.avatar };
  }

  try {
    const result = await api.getUserInfo(uid);
    const profiles = result?.changed_profiles || {};
    const profile = profiles[uid] || profiles[`${uid}_0`];
    if (profile) {
      const entry: UserInfoCacheEntry = {
        zaloName:
          profile.zaloName ||
          profile.zalo_name ||
          profile.displayName ||
          profile.display_name ||
          '',
        avatar: profile.avatar || '',
        phone: profile.phoneNumber || '',
        cachedAt: Date.now(),
      };
      cache.set(uid, entry);
      return { zaloName: entry.zaloName, avatar: entry.avatar };
    }
  } catch (err) {
    logger.warn(`[zalo] getUserInfo failed for ${uid}:`, err);
  }
  return { zaloName: '', avatar: '' };
}

// Fetch group display name from the zca-js API
async function resolveGroupName(api: any, groupId: string): Promise<string> {
  try {
    const result = await api.getGroupInfo(groupId);
    const info = result?.gridInfoMap?.[groupId];
    return info?.name || '';
  } catch (err) {
    logger.warn(`[zalo] getGroupInfo failed for ${groupId}:`, err);
    return '';
  }
}

export interface ListenerContext {
  accountId: string;
  orgId: string;
  api: any;
  io: Server | null;
  userInfoCache: Map<string, UserInfoCacheEntry>;
  onDisconnected: (accountId: string) => void;
}

function extractQuoteData(data: any): any[] {
  const q = data?.quote;
  if (!q) return [];
  const msgText = typeof q.msg === 'string' ? q.msg : '';
  let attachStr = '';
  if (typeof q.attach === 'string') attachStr = q.attach;
  else if (q.attach) attachStr = JSON.stringify(q.attach);

  return [{
    type: 'quote',
    ownerId: String(q.ownerId || ''),
    fromD: String(q.fromD || ''),
    msg: msgText,
    attach: attachStr,
    cliMsgType: q.cliMsgType,
    globalMsgId: String(q.globalMsgId || q.cliMsgId || ''),
  }];
}

async function processZaloMessage(
  ctx: ListenerContext,
  message: any,
  threadTypeHint?: any
): Promise<any | null> {
  const { accountId, api, io, userInfoCache } = ctx;
  const isGroup = threadTypeHint === 1 || message.type === 1;
  const ownUid = String(api.getContext?.()?.uid || '');
  const senderUid = String(message.data?.uidFrom || '');

  // Determine isSelf accurately:
  const isSelf = Boolean(
    message.isSelf ||
    (ownUid && senderUid === ownUid) ||
    senderUid === '0' ||
    message.data?.uidFrom === '0'
  );

  // Determine threadId accurately:
  let threadId = String(message.threadId || '');
  if (isGroup) {
    threadId = String(message.data?.idTo || message.threadId || '');
  } else {
    if (isSelf) {
      threadId = String(message.data?.idTo || message.threadId || '');
    } else {
      threadId = String(message.data?.uidFrom || message.threadId || '');
    }
  }

  // Resolve display name — prefer zaloName from API over dName
  let senderName: string = message.data?.dName || '';
  if (!isSelf && senderUid && api.getUserInfo) {
    const userInfo = await resolveZaloName(api, senderUid, userInfoCache);
    if (userInfo.zaloName) senderName = userInfo.zaloName;
    if (userInfo.avatar) updateContactAvatar(senderUid, userInfo.avatar);
  }

  // Resolve group name for group threads
  let groupName: string | undefined;
  if (isGroup && threadId) {
    groupName = await resolveGroupName(api, threadId);
  }

  const rawContent = message.data?.content;
  const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent || '');
  const contentType = detectContentType(message.data?.msgType, rawContent);

  const result = await handleIncomingMessage({
    accountId,
    senderUid,
    senderName,
    content,
    contentType,
    msgId: String(message.data?.msgId || ''),
    timestamp: parseInt(message.data?.ts || String(Date.now())),
    isSelf,
    threadId,
    threadType: isGroup ? 'group' : 'user',
    groupName,
    attachments: extractQuoteData(message.data),
  });

  if (result) {
    io?.emit('chat:message', {
      accountId,
      message: result.message,
      conversationId: result.conversationId,
    });
    return result;
  }
  return null;
}

/**
 * Convert Zalo reaction code to Unicode emoji
 */
export function reactionCodeToEmoji(code: string | undefined | null): string | null {
  if (!code) return null;
  const c = code.trim();
  switch (c) {
    case '/-heart':
    case 'heart':
    case 'HEART':
      return '❤️';
    case '/-strong':
    case 'like':
    case 'LIKE':
      return '👍';
    case ':>':
    case 'haha':
    case 'HAHA':
      return '😆';
    case ':o':
    case ':-o':
    case 'wow':
    case 'WOW':
      return '😮';
    case ':-(( ':
    case ':-(':
    case ':-(((':
    case 'cry':
    case 'CRY':
    case 'sad':
    case 'SAD':
      return '😭';
    case ':-h':
    case 'angry':
    case 'ANGRY':
      return '😡';
    case '/-weak':
    case 'dislike':
    case 'DISLIKE':
      return '👎';
    case ':-*':
      return '😘';
    case ":')":
      return '😂';
    case '/-rose':
      return '🌹';
    case '/-break':
      return '💔';
    case '_()_':
      return '🙏';
    case '/-shit':
      return '💩';
    case '/-bd':
      return '🎂';
    case '/-ok':
      return '👌';
    case '/-v':
      return '✌️';
    case '/-thanks':
      return '🙏';
    case ';xx':
      return '🥰';
    case ';-)':
      return '😉';
    case '/-loveu':
      return '🤟';
    case ':))':
      return '😃';
    case ';-d':
      return '😄';
    case 'b-)':
      return '😎';
    case 'x-)':
      return '😏';
    case '':
    case 'NONE':
      return null;
    default:
      return c;
  }
}

export async function processZaloReaction(ctx: ListenerContext, reactionObject: any): Promise<void> {
  const { accountId, io, api } = ctx;
  if (!reactionObject) return;

  const data = reactionObject.data || reactionObject;
  let content = data.content;
  if (typeof content === 'string') {
    try {
      content = JSON.parse(content);
    } catch {
      content = null;
    }
  }

  const rMsg = Array.isArray(content?.rMsg) ? content.rMsg : [];
  if (rMsg.length === 0) return;

  const rawIcon = content?.rIcon ?? '';
  const emoji = reactionCodeToEmoji(rawIcon);
  const senderUid = String(data.uidFrom || '');
  const isSelf = Boolean(
    reactionObject.isSelf ||
    data.uidFrom === '0' ||
    (api.getContext?.()?.uid && senderUid === String(api.getContext().uid))
  );

  for (const item of rMsg) {
    const gMsgID = String(item.gMsgID || '');
    const cMsgID = String(item.cMsgID || '');
    if (!gMsgID && !cMsgID) continue;

    // Search message in DB for this Zalo account
    const message = await prisma.message.findFirst({
      where: {
        conversation: { zaloAccountId: accountId },
        OR: [
          ...(gMsgID ? [{ zaloMsgId: gMsgID }] : []),
          ...(cMsgID ? [{ zaloMsgId: cMsgID }] : []),
          ...(gMsgID ? [{ id: gMsgID }] : []),
        ],
      },
      include: {
        conversation: { select: { id: true, orgId: true } },
      },
    });

    if (!message) {
      logger.debug(`[zalo:${accountId}] Reaction target msg not found in DB (gMsgID=${gMsgID}, cMsgID=${cMsgID})`);
      continue;
    }

    // Parse existing attachments
    let attList: any[] = [];
    if (message.attachments) {
      if (typeof message.attachments === 'string') {
        try { attList = JSON.parse(message.attachments); } catch { attList = []; }
      } else if (Array.isArray(message.attachments)) {
        attList = [...message.attachments];
      } else if (typeof message.attachments === 'object') {
        attList = [message.attachments];
      }
    }

    // Filter out previous reaction from this sender or general reaction
    attList = attList.filter((att) => {
      if (!att || typeof att !== 'object') return true;
      if (att.type === 'reaction') {
        if (senderUid && att.senderUid) {
          return att.senderUid !== senderUid;
        }
        return false;
      }
      return true;
    });

    if (emoji) {
      attList.push({
        type: 'reaction',
        reaction: emoji,
        icon: rawIcon,
        senderUid,
        isSelf,
        updatedAt: Date.now(),
      });
    }

    await prisma.message.update({
      where: { id: message.id },
      data: {
        attachments: attList as any,
      },
    });

    logger.info(`[zalo:${accountId}] Reaction updated on msg ${message.id} (zaloMsgId=${message.zaloMsgId}): ${emoji || 'REMOVED'} by ${senderUid} (isSelf=${isSelf})`);

    // Broadcast real-time event to connected frontend clients
    io?.emit('chat:reaction', {
      accountId,
      messageId: message.id,
      zaloMsgId: message.zaloMsgId || gMsgID,
      conversationId: message.conversationId,
      reaction: emoji, // emoji string or null
      icon: rawIcon,
      senderUid,
      isSelf,
    });
  }
}

/**
 * Attach all zca-js listener events for the given account.
 * Calls listener.start() with retryOnClose: false at the end.
 */
export function attachZaloListener(ctx: ListenerContext): void {
  const { accountId, orgId, api, io, userInfoCache, onDisconnected } = ctx;
  const listener = api.listener;

  listener.on('connected', () => {
    logger.info(`[zalo:${accountId}] Listener socket connected`);
    io?.emit('zalo:connected', { accountId });
  });

  // Request old messages and reactions once cipher handshake is confirmed
  listener.on('cipher_key', () => {
    logger.info(`[zalo:${accountId}] Listener cipher key established. Requesting catch-up old messages and reactions...`);
    setTimeout(() => {
      try {
        listener.requestOldMessages(0); // User threads
        listener.requestOldMessages(1); // Group threads
        if (typeof listener.requestOldReactions === 'function') {
          listener.requestOldReactions(0);
          listener.requestOldReactions(1);
        }
      } catch (e: any) {
        logger.warn(`[zalo:${accountId}] Failed to request old messages/reactions:`, e.message);
      }
    }, 500);
  });

  listener.on('old_messages', async (oldMsgs: any[], threadType: any) => {
    if (!Array.isArray(oldMsgs) || oldMsgs.length === 0) return;
    logger.info(`[zalo:${accountId}] Catch-up: received ${oldMsgs.length} old messages (threadType: ${threadType})`);

    for (const m of oldMsgs) {
      try {
        await processZaloMessage(ctx, m, threadType);
      } catch (err) {
        logger.error(`[zalo:${accountId}] Error processing catch-up old message:`, err);
      }
    }
  });

  // Catch-up old reactions
  listener.on('old_reactions', async (reactionObjects: any[], isGroup: boolean) => {
    if (!Array.isArray(reactionObjects) || reactionObjects.length === 0) return;
    logger.info(`[zalo:${accountId}] Catch-up: received ${reactionObjects.length} old reactions (isGroup: ${isGroup})`);
    for (const r of reactionObjects) {
      try {
        await processZaloReaction(ctx, r);
      } catch (err) {
        logger.error(`[zalo:${accountId}] Error processing catch-up old reaction:`, err);
      }
    }
  });

  listener.on('message', async (message: any) => {
    try {
      const result = await processZaloMessage(ctx, message);
      if (result) {
        // Trigger Web Push Notification for authorized users (fire-and-forget, non-blocking)
        sendPushNotificationForMessage(accountId, result.message, result.conversationId).catch((e) => {
          logger.error('[zalo-listener-factory] Failed to dispatch push notification:', e);
        });
      }
    } catch (err) {
      logger.error(`[zalo:${accountId}] Message handler error:`, err);
    }
  });

  // Real-time reactions from đối phương (or self)
  listener.on('reaction', async (reactionObject: any) => {
    try {
      await processZaloReaction(ctx, reactionObject);
    } catch (err) {
      logger.error(`[zalo:${accountId}] Reaction handler error:`, err);
    }
  });

  listener.on('undo', async (data: any) => {
    const msgId = data.data?.msgId || data.msgId;
    if (msgId) {
      await handleMessageUndo(accountId, String(msgId));
      io?.emit('chat:deleted', { accountId, msgId: String(msgId) });
    }
  });

  listener.on('closed', (code: number, reason: string) => {
    logger.warn(`[zalo:${accountId}] Listener closed: ${code} ${reason}`);
    onDisconnected(accountId);
    io?.emit('zalo:disconnected', { accountId, code, reason });
  });

  listener.on('error', (err: any) => {
    logger.error(`[zalo:${accountId}] Listener error:`, err);
  });

  listener.on('friend_event', async (event: any) => {
    try {
      const eventType = event.type ?? event.eventType;

      // Only handle incoming friend REQUEST (type=2) that are NOT self-sent
      if (eventType !== 2) return;
      if (event.isSelf === true) return; // skip if we sent the request ourselves

      // Sender UID is in event.data.fromUid (confirmed from zca-js source)
      const senderUid = String(event.data?.fromUid || event.actorId || '');
      if (!senderUid) {
        logger.warn(`[zalo:${accountId}] friend_event REQUEST missing fromUid, event keys: ${Object.keys(event || {}).join(',')}, data keys: ${Object.keys(event?.data || {}).join(',')}`);
        return;
      }

      // Message attached to friend request (if any)
      const friendMsg = event.data?.msg || event.data?.content || event.data?.message || '';

      // Sender name/avatar from event data (Zalo sometimes sends displayName directly)
      let senderName = event.data?.displayName || event.data?.dName || event.data?.title || '';
      let senderAvatar = event.data?.avatar || event.data?.avatarUrl || '';

      // Also try getUserInfo for more reliable data
      if (api.getUserInfo) {
        try {
          const info = await resolveZaloName(api, senderUid, userInfoCache);
          if (info.zaloName) senderName = info.zaloName;
          if (info.avatar) senderAvatar = info.avatar;
        } catch (_) {}
      }

      const pending = {
        senderUid,
        senderName: senderName || 'Người dùng Zalo',
        senderAvatar,
        message: typeof friendMsg === 'string' ? friendMsg : (friendMsg ? JSON.stringify(friendMsg) : ''),
        receivedAt: Date.now(),
      };

      // Persist to DB (survives server restarts)
      await friendRequestStore.add(accountId, orgId, pending);
      const count = await friendRequestStore.count(accountId);

      logger.info(`[zalo:${accountId}] ✅ Friend REQUEST from ${senderUid} (${pending.senderName}), total pending: ${count}`);

      io?.emit('zalo:friend_request', {
        accountId,
        ...pending,
        pendingCount: count,
      });
    } catch (err) {
      logger.error(`[zalo:${accountId}] friend_event handler error:`, err);
    }
  });

  listener.start({ retryOnClose: true });
}
