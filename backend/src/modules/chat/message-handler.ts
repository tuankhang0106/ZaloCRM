/**
 * message-handler.ts — persists incoming Zalo messages to the database.
 * Called from zalo-pool's startListener on every 'message' / 'undo' event.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { randomUUID } from 'node:crypto';
import { emitWebhook } from '../api/webhook-service.js';
import { zaloPool } from '../zalo/zalo-pool.js';

// Cooldown cache to prevent spamming Zalo groups: conversationId -> timestamp of last notification
const alertCooldowns = new Map<string, number>();
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

// Asynchronously send a notification alert to the designated Zalo group
function triggerGroupAlert(
  orgId: string,
  zaloAccountId: string,
  zaloAccountName: string,
  customerName: string,
  messageContent: string,
  conversationId: string
) {
  // Fire-and-forget, wrapped in try/catch to be 100% resilient
  Promise.resolve().then(async () => {
    try {
      // 1. Fetch group settings
      const alertGroupIdSetting = await prisma.appSetting.findFirst({
        where: { orgId, settingKey: 'ai_alert_group_id' }
      });
      const alertGroupId = alertGroupIdSetting?.valuePlain;

      if (!alertGroupId || !alertGroupId.trim()) {
        return; // No group alert configured
      }

      // 🚀 Smart group routing: Find a connected Zalo account in this org that is actually a member of the alert group
      const groupConversation = await prisma.conversation.findFirst({
        where: {
          orgId,
          externalThreadId: alertGroupId,
          threadType: 'group'
        },
        select: { zaloAccountId: true }
      });

      const senderAccountId = groupConversation?.zaloAccountId || zaloAccountId;

      // 2. Get active Zalo API instance of the member account
      const api = zaloPool.getApi(senderAccountId);
      if (!api) {
        logger.warn(`[group-alert] Zalo account ${senderAccountId} not connected, cannot send alert`);
        return;
      }

      // 3. Construct message
      const snippet = messageContent.length > 150 ? `${messageContent.slice(0, 150)}...` : messageContent;
      const alertMsg = `🔔 [Zalo CRM] Chị ơi, có khách mới "${customerName}" vừa nhắn vào Zalo "${zaloAccountName}":\n"${snippet}"\n👉 Vui lòng vào CRM để xử lý phản hồi nhé!`;

      // 4. Send group message (type = 1 for Group)
      await api.sendMessage({ msg: alertMsg }, alertGroupId, 1);
      logger.info(`[group-alert] Sent customer alert for "${customerName}" to group ${alertGroupId}`);
    } catch (err) {
      logger.error('[group-alert] Error sending notification:', err);
    }
  });
}

export interface IncomingMessage {
  accountId: string;
  senderUid: string;
  senderName: string;       // zaloName (from cache or dName fallback)
  content: string;
  contentType: string;      // text, image, sticker, video, voice, gif, link, file
  msgId: string;
  timestamp: number;        // epoch ms
  isSelf: boolean;
  threadId: string;         // For user: contact UID. For group: group ID
  threadType: 'user' | 'group'; // user or group conversation
  groupName?: string;       // group name if group message
  attachments?: any[];
}

export interface HandleMessageResult {
  message: {
    id: string;
    conversationId: string;
    zaloMsgId: string | null;
    senderType: string;
    senderUid: string | null;
    senderName: string | null;
    content: string | null;
    contentType: string;
    attachments: any;
    isDeleted: boolean;
    deletedAt: Date | null;
    sentAt: Date;
    repliedByUserId: string | null;
    createdAt: Date;
  };
  conversationId: string;
  orgId: string;
  contactId: string | null;
}

export async function handleIncomingMessage(
  msg: IncomingMessage,
): Promise<HandleMessageResult | null> {
  try {
    const account = await prisma.zaloAccount.findUnique({
      where: { id: msg.accountId },
      select: { orgId: true, ownerUserId: true, displayName: true },
    });
    if (!account) return null;

    // Check if conversation exists and what its isReplied status is before upserting/updating
    let isNewConversation = false;
    let wasReplied = true;
    const existingConversation = await prisma.conversation.findFirst({
      where: { zaloAccountId: msg.accountId, externalThreadId: msg.threadId },
      select: { id: true, isReplied: true },
    });
    if (!existingConversation) {
      isNewConversation = true;
    } else {
      wasReplied = existingConversation.isReplied;
    }

    const contactId = await upsertContact(msg, account.orgId);

    const conversation = await findOrCreateConversation(msg, account.orgId, contactId);

    const sentAt = new Date(msg.timestamp);
    let message;

    if (msg.isSelf) {
      // 🚀 Fix race condition: delay webhook processing by 500ms to allow concurrent DB writes
      // from chat-routes.ts or ai-service.ts to fully commit before checking for existence.
      await new Promise((resolve) => setTimeout(resolve, 500));

      const trimmedContent = msg.content ? msg.content.trim() : '';

      // Find a recently sent message in the database (within last 60 seconds)
      // to link the real zaloMsgId and details to the optimistic/API message sent via CRM
      const sixtySecondsAgo = new Date(Date.now() - 60 * 1000);
      const existingMessage = await prisma.message.findFirst({
        where: {
          conversationId: conversation.id,
          senderType: 'self',
          OR: [
            ...(msg.msgId ? [{ zaloMsgId: msg.msgId }] : []),
            { zaloMsgId: null, content: trimmedContent, sentAt: { gte: sixtySecondsAgo } },
            // Also deduplicate recently sent media message
            { zaloMsgId: null, contentType: msg.contentType, sentAt: { gte: sixtySecondsAgo } },
            { zaloMsgId: null, content: { contains: '"href":""' }, sentAt: { gte: sixtySecondsAgo } },
          ],
        },
        orderBy: { sentAt: 'desc' },
      });

      if (existingMessage) {
        message = await prisma.message.update({
          where: { id: existingMessage.id },
          data: {
            zaloMsgId: msg.msgId || null,
            content: msg.content, // Update to the real Zalo content with CDN URLs
            contentType: msg.contentType || existingMessage.contentType,
            attachments: (msg.attachments && msg.attachments.length > 0 ? msg.attachments : existingMessage.attachments) as any,
          },
          include: {
            repliedBy: { select: { id: true, fullName: true, role: true } },
          },
        });
        logger.info(`[message-handler] Deduplicated and linked message ${msg.msgId} to existing DB message ${existingMessage.id}`);
      }
    }

    if (!message) {
      if (msg.msgId) {
        const existingByZaloId = await prisma.message.findFirst({
          where: {
            conversationId: conversation.id,
            zaloMsgId: msg.msgId,
          },
          include: {
            repliedBy: { select: { id: true, fullName: true, role: true } },
          },
        });
        if (existingByZaloId) {
          await updateConversationAfterMessage(conversation.id, sentAt, msg.isSelf, true);
          return {
            message: existingByZaloId,
            conversationId: conversation.id,
            orgId: account.orgId,
            contactId,
          };
        }
      }

      const trimmedContent = msg.content ? msg.content.trim() : '';
      message = await prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId: conversation.id,
          zaloMsgId: msg.msgId || null,
          senderType: msg.isSelf ? 'self' : 'contact',
          senderUid: msg.senderUid,
          senderName: msg.senderName || null,
          content: trimmedContent,
          contentType: msg.contentType || 'text',
          attachments: msg.attachments ?? [],
          sentAt,
        },
        include: {
          repliedBy: { select: { id: true, fullName: true, role: true } },
        },
      });
    }

    await updateConversationAfterMessage(conversation.id, sentAt, msg.isSelf);

    // Track first outbound contact date — set once when agent sends first message
    if (msg.isSelf && contactId) {
      prisma.contact.updateMany({
        where: { id: contactId, firstContactDate: null },
        data: { firstContactDate: new Date(msg.timestamp) },
      }).catch(() => {});
    }

    // Emit webhook for message event (fire-and-forget)
    emitWebhook(account.orgId, msg.isSelf ? 'message.sent' : 'message.received', {
      messageId: message.id,
      conversationId: conversation.id,
      senderUid: msg.senderUid,
      content: msg.content,
      contentType: msg.contentType,
      sentAt: message.sentAt,
    });

    // Trigger Zalo Group Notification Alert in background if new customer inquiry
    if (!msg.isSelf && msg.threadType === 'user' && (isNewConversation || wasReplied)) {
      const lastAlertTime = alertCooldowns.get(conversation.id) || 0;
      const now = Date.now();
      if (now - lastAlertTime > ALERT_COOLDOWN_MS) {
        alertCooldowns.set(conversation.id, now);
        triggerGroupAlert(
          account.orgId,
          msg.accountId,
          account.displayName || 'Không rõ',
          msg.senderName || 'Khách hàng',
          msg.content || '[Tin nhắn hình ảnh/tệp đính kèm]',
          conversation.id
        );
      }
    }

    return {
      message,
      conversationId: conversation.id,
      orgId: account.orgId,
      contactId,
    };
  } catch (err) {
    logger.error('[message-handler] handleIncomingMessage error:', err);
    return null;
  }
}

// Upsert contact — handles both user and group conversations
async function upsertContact(msg: IncomingMessage, orgId: string): Promise<string | null> {
  // Group messages: create/update a "contact" record representing the group
  if (msg.threadType === 'group') {
    const groupUid = msg.threadId;
    let groupContact = await prisma.contact.findFirst({
      where: { zaloUid: groupUid, orgId },
      select: { id: true, fullName: true },
    });

    if (!groupContact) {
      groupContact = await prisma.contact.create({
        data: {
          id: randomUUID(),
          orgId,
          zaloUid: groupUid,
          fullName: msg.groupName || 'Nhóm',
          metadata: { isGroup: true },
        },
        select: { id: true, fullName: true },
      });
      // Emit webhook for new contact created
      emitWebhook(orgId, 'contact.created', { contactId: groupContact.id, fullName: groupContact.fullName });
    } else if (msg.groupName && groupContact.fullName !== msg.groupName) {
      await prisma.contact.update({
        where: { id: groupContact.id },
        data: { fullName: msg.groupName },
      });
    }
    return groupContact.id;
  }

  // User messages
  const contactUid = msg.isSelf ? msg.threadId : msg.senderUid;
  if (!contactUid) return null;

  let contact = await prisma.contact.findFirst({
    where: { zaloUid: contactUid, orgId },
    select: { id: true, fullName: true },
  });

  if (!contact) {
    contact = await prisma.contact.create({
      data: {
        id: randomUUID(),
        orgId,
        zaloUid: contactUid,
        fullName: msg.isSelf ? 'Khách hàng' : (msg.senderName || 'Khách hàng'),
      },
      select: { id: true, fullName: true },
    });
    // Emit webhook for new contact created
    emitWebhook(orgId, 'contact.created', { contactId: contact.id, fullName: contact.fullName });
  } else if (!msg.isSelf && msg.senderName && contact.fullName !== msg.senderName) {
    await prisma.contact.update({
      where: { id: contact.id },
      data: { fullName: msg.senderName },
    });
  }

  return contact.id;
}

// Find or create conversation — externalThreadId = threadId for both user and group
async function findOrCreateConversation(
  msg: IncomingMessage,
  orgId: string,
  contactId: string | null,
) {
  const externalThreadId = msg.threadId;

  // If contactId was not passed, look up if a matching Contact exists by zaloUid
  if (!contactId && externalThreadId) {
    const matched = await prisma.contact.findFirst({
      where: { zaloUid: externalThreadId, orgId },
      select: { id: true },
    });
    if (matched) contactId = matched.id;
  }

  const existing = await prisma.conversation.findFirst({
    where: { zaloAccountId: msg.accountId, externalThreadId },
    select: { id: true, contactId: true },
  });

  if (existing) {
    // 🚀 Auto Re-link: Reconnect conversation to contact if contactId is currently missing
    if (!existing.contactId && contactId) {
      await prisma.conversation.update({
        where: { id: existing.id },
        data: { contactId },
      });
      logger.info(`[message-handler] Auto re-linked conversation ${existing.id} to contact ${contactId}`);
    }
    return existing;
  }

  return prisma.conversation.create({
    data: {
      id: randomUUID(),
      orgId,
      zaloAccountId: msg.accountId,
      contactId: msg.threadType === 'user' ? contactId : contactId,
      threadType: msg.threadType,
      externalThreadId,
      lastMessageAt: new Date(msg.timestamp),
      unreadCount: msg.isSelf ? 0 : 1,
      isReplied: msg.isSelf,
    },
    select: { id: true },
  });
}

// Update conversation metadata after a new message
async function updateConversationAfterMessage(
  conversationId: string,
  sentAt: Date,
  isSelf: boolean,
  isExisting = false
): Promise<void> {
  const currentConv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { lastMessageAt: true },
  });

  const shouldUpdateTimestamp = !currentConv?.lastMessageAt || sentAt.getTime() >= currentConv.lastMessageAt.getTime();

  const updateData: any = {};
  if (shouldUpdateTimestamp) {
    updateData.lastMessageAt = sentAt;
  }

  if (!isExisting) {
    if (isSelf) {
      updateData.isReplied = true;
      updateData.unreadCount = 0;
    } else {
      updateData.unreadCount = { increment: 1 };
      updateData.isReplied = false;
      updateData.quoteCompleted = false;
    }
  }

  if (Object.keys(updateData).length > 0) {
    await prisma.conversation.update({ where: { id: conversationId }, data: updateData });
  }
}

// Soft-delete a message by its Zalo message ID
export async function handleMessageUndo(accountId: string, zaloMsgId: string): Promise<void> {
  try {
    await prisma.message.updateMany({
      where: { zaloMsgId: String(zaloMsgId) },
      data: { isDeleted: true, deletedAt: new Date() },
    });
    logger.info(`[message-handler] Undo message ${zaloMsgId} for account ${accountId}`);
  } catch (err) {
    logger.error('[message-handler] handleMessageUndo error:', err);
  }
}
