/**
 * Notification routes — computed on-the-fly notifications for the authenticated user.
 * Sources: unreplied conversations, today/tomorrow appointments, disconnected Zalo accounts.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { zaloPool } from '../zalo/zalo-pool.js';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  detail: string;
  priority: string;
  createdAt: string;
}

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/v1/notifications', async (request) => {
    const user = request.user!;
    const notifications: NotificationItem[] = [];

    // 1. Unreplied conversations > 5 min
    const fiveMinAgo = new Date(Date.now() - 5 * 60000);
    const unreplied = await prisma.conversation.count({
      where: {
        orgId: user.orgId,
        isReplied: false,
        lastMessageAt: { lt: fiveMinAgo },
        OR: [
          { threadType: 'user' },
          { isCustomer: true }
        ]
      },
    });
    if (unreplied > 0) {
      notifications.push({
        id: 'unreplied',
        type: 'warning',
        priority: 'high',
        title: `${unreplied} cuộc trò chuyện chưa trả lời`,
        detail: 'Có tin nhắn chưa phản hồi quá 5 phút',
        createdAt: new Date().toISOString(),
      });
    }

    // 2. Today's appointments
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const todayApts = await prisma.appointment.findMany({
      where: {
        orgId: user.orgId,
        appointmentDate: { gte: todayStart, lt: todayEnd },
        status: 'scheduled',
      },
      include: { contact: { select: { fullName: true } } },
      take: 5,
    });
    for (const apt of todayApts) {
      notifications.push({
        id: `apt-${apt.id}`,
        type: 'info',
        priority: 'medium',
        title: `Lịch hẹn: ${apt.contact?.fullName || 'KH'}`,
        detail: `${apt.appointmentTime || ''} - ${apt.notes || 'Tái khám'}`,
        createdAt: apt.appointmentDate.toISOString(),
      });
    }

    // 3. Tomorrow's appointments
    const tomorrowStart = new Date(todayEnd);
    const tomorrowEnd = new Date(tomorrowStart);
    tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

    const tmrApts = await prisma.appointment.count({
      where: {
        orgId: user.orgId,
        appointmentDate: { gte: tomorrowStart, lt: tomorrowEnd },
        status: 'scheduled',
      },
    });
    if (tmrApts > 0) {
      notifications.push({
        id: 'tmr-apts',
        type: 'info',
        priority: 'low',
        title: `${tmrApts} lịch hẹn ngày mai`,
        detail: 'Chuẩn bị cho ngày mai',
        createdAt: new Date().toISOString(),
      });
    }

    // 4. Disconnected Zalo accounts
    const accounts = await prisma.zaloAccount.findMany({
      where: { orgId: user.orgId },
      select: { id: true, displayName: true },
    });
    for (const acc of accounts) {
      const status = zaloPool.getStatus(acc.id);
      if (status !== 'connected') {
        notifications.push({
          id: `zalo-${acc.id}`,
          type: 'error',
          priority: 'high',
          title: `Zalo "${acc.displayName}" mất kết nối`,
          detail: `Trạng thái: ${status}`,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // 5. Quote/Task overdue conversations > 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const overdueQuotes = await prisma.conversation.findMany({
      where: {
        orgId: user.orgId,
        quoteCompleted: false,
        isReplied: false,
        lastMessageAt: { lt: twentyFourHoursAgo },
        OR: [
          { threadType: 'user' },
          { isCustomer: true }
        ]
      },
      include: { contact: { select: { fullName: true } } },
      take: 5,
    });
    for (const q of overdueQuotes) {
      notifications.push({
        id: `quote-${q.id}`,
        type: 'warning',
        priority: 'high',
        title: `Quá hạn báo giá: ${q.contact?.fullName || 'Khách hàng'}`,
        detail: 'Chưa đánh dấu hoàn thành/báo giá quá 24h kể từ tin nhắn cuối',
        createdAt: q.lastMessageAt ? q.lastMessageAt.toISOString() : new Date().toISOString(),
      });
    }

    return { notifications };
  });
}
