import webpush from 'web-push';
import { prisma } from '../database/prisma-client.js';
import { logger } from '../utils/logger.js';

// Setup VAPID details
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:contact@adameva.vn';
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  logger.info('[push] Web Push VAPID details configured successfully.');
} else {
  logger.warn('[push] Web Push VAPID keys are missing. Push notifications will not be sent.');
}

export async function sendPushNotificationForMessage(accountId: string, message: any, conversationId: string) {
  if (!vapidPublicKey || !vapidPrivateKey) return;
  
  try {
    // Check if conversation is muted
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { isMuted: true },
    });
    if (conv?.isMuted) {
      return; // Skip push notification for muted conversation
    }

    // 1. Find the owner and organization of this Zalo account
    const account = await prisma.zaloAccount.findUnique({
      where: { id: accountId },
      select: { ownerUserId: true, orgId: true }
    });
    
    if (!account) {
      logger.error(`[push] Zalo account ${accountId} not found, skipping push.`);
      return;
    }
    
    // 2. Find all other users who have access to this Zalo account via ACL
    const accesses = await prisma.zaloAccountAccess.findMany({
      where: { zaloAccountId: accountId },
      select: { userId: true }
    });
    
    // 3. Combine owner, ACL users, and all active admins/owners of the organization
    const userIds = new Set<string>();
    userIds.add(account.ownerUserId);
    for (const a of accesses) {
      userIds.add(a.userId);
    }
    
    const admins = await prisma.user.findMany({
      where: {
        orgId: account.orgId,
        role: { in: ['owner', 'admin'] },
        isActive: true
      },
      select: { id: true }
    });
    for (const admin of admins) {
      userIds.add(admin.id);
    }
    
    // 4. Find all active push subscriptions for these users
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId: { in: Array.from(userIds) } }
    });
    
    if (subscriptions.length === 0) {
      return;
    }
    
    // 3. Prepare payload
    const title = message.senderName || 'Tin nhắn mới';
    let body = '';
    if (message.contentType === 'text') {
      body = message.content || '';
    } else {
      const typeMap: Record<string, string> = {
        image: '📷 Hình ảnh',
        sticker: '🏷️ Sticker',
        video: '🎥 Video',
        voice: '🎤 Tin nhắn thoại',
        file: '📎 Tệp đính kèm',
        link: '🔗 Liên kết',
      };
      body = typeMap[message.contentType] || '[Tin nhắn mới]';
    }
    
    const payload = JSON.stringify({
      title,
      body,
      conversationId,
      url: `/chat?convId=${conversationId}`
    });
    
    logger.info(`[push] Sending push notifications for message to ${subscriptions.length} devices.`);
    
    // 4. Send pushes
    for (const sub of subscriptions) {
      try {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth
          }
        };
        
        await webpush.sendNotification(pushSubscription, payload);
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          logger.info(`[push] Removing expired subscription for user ${sub.userId} endpoint ${sub.endpoint}`);
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          logger.error(`[push] Failed to send notification to user ${sub.userId}:`, err);
        }
      }
    }
  } catch (err) {
    logger.error('[push] Error in sendPushNotificationForMessage:', err);
  }
}

export async function sendPushNotification(userId: string, title: string, body: string, url?: string) {
  if (!vapidPublicKey || !vapidPrivateKey) return;

  try {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId }
    });

    if (subscriptions.length === 0) {
      return;
    }

    const payload = JSON.stringify({
      title,
      body,
      url: url || '/'
    });

    for (const sub of subscriptions) {
      try {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth
          }
        };
        await webpush.sendNotification(pushSubscription, payload);
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          logger.info(`[push] Removing expired subscription for user ${sub.userId} endpoint ${sub.endpoint}`);
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          logger.error(`[push] Failed to send notification to user ${sub.userId}:`, err);
        }
      }
    }
  } catch (err) {
    logger.error('[push] Error in sendPushNotification:', err);
  }
}

