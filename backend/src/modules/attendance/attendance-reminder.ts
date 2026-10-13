/**
 * attendance-reminder.ts — Cron job that runs daily at 19:00 Vietnam time (12:00 UTC)
 * to remind employees who checked in but forgot to check out.
 */
import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { getVnLocalDate } from './attendance-service.js';
import { sendPushNotification } from '../../shared/services/push-notification.js';

export function startAttendanceReminder(): void {
  // 19:00 VN time is 12:00 UTC, we schedule for 19:00 VN time using the timezone option.
  cron.schedule(
    '0 19 * * *',
    async () => {
      logger.info('[attendance-reminder] Checking forgotten check-outs...');

      try {
        const today = getVnLocalDate();

        // Find all users who checked in today but have no check-out timestamp
        const missingCheckOuts = await prisma.attendance.findMany({
          where: {
            date: today,
            checkInAt: { not: null },
            checkOutAt: null,
          },
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
              },
            },
          },
        });

        logger.info(`[attendance-reminder] Found ${missingCheckOuts.length} users with missing check-outs.`);

        for (const record of missingCheckOuts) {
          const user = record.user;
          const title = 'Nhắc nhở check-out 🕒';
          const body = `Chào ${user.fullName}, ZaloCRM nhắc bạn: Đừng quên bấm check-out ra về hôm nay nhé!`;

          await sendPushNotification(user.id, title, body, '/attendance');
          logger.info(`[attendance-reminder] Sent push reminder to user ${user.fullName} (${user.id})`);
        }

        logger.info(`[attendance-reminder] Finished running forgotten check-out reminders.`);
      } catch (err) {
        logger.error('[attendance-reminder] Cron job error:', err);
      }
    },
    {
      timezone: 'Asia/Ho_Chi_Minh',
    }
  );

  logger.info('[attendance-reminder] Forgotten check-out reminder cron started (daily 19:00 Asia/Ho_Chi_Minh)');
}
