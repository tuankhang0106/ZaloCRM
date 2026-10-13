/**
 * zalo-health-check.ts — Cron-based health monitor for Zalo account connections.
 * Runs every 5 minutes to detect disconnected accounts and auto-reconnect them.
 * Also runs a daily session refresh at 04:00 UTC to keep cookies fresh.
 */
import cron from 'node-cron';
import { Prisma } from '@prisma/client';
import { zaloPool } from './zalo-pool.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

export function startZaloHealthCheck(): void {
  // Every 1 minute: monitor connections and immediately auto-reconnect if network drops
  cron.schedule('* * * * *', async () => {
    try {
      const accounts = await prisma.zaloAccount.findMany({
        where: {
          sessionData: { not: Prisma.JsonNull },
          status: { not: 'qr_pending' },
        },
        select: { id: true, displayName: true, sessionData: true },
      });

      for (const acc of accounts) {
        const status = zaloPool.getStatus(acc.id);
        if (status !== 'connected' && status !== 'connecting' && status !== 'qr_pending') {
          const session = acc.sessionData as any;
          if (session?.imei) {
            logger.info(`[health-check] Account disconnected. Auto-reconnecting ${acc.displayName || acc.id}...`);
            zaloPool.reconnect(acc.id, session).catch((err) => {
              logger.warn(`[health-check] Reconnect failed for ${acc.id}:`, err);
            });
          }
        }
      }
    } catch (err) {
      logger.error('[health-check] Error during health check:', err);
    }
  });

  // Daily session refresh at 20:00 UTC (03:00 AM VN — midnight maintenance window)
  cron.schedule('0 20 * * *', async () => {
    logger.info('[health-check] Midnight session refresh starting...');
    try {
      const accounts = await prisma.zaloAccount.findMany({
        where: {
          sessionData: { not: Prisma.JsonNull },
          status: { not: 'qr_pending' },
        },
        select: { id: true, sessionData: true },
      });

      for (const acc of accounts) {
        const session = acc.sessionData as any;
        if (session?.imei) {
          // Disconnect then reconnect to force cookie refresh
          zaloPool.disconnect(acc.id);
          await new Promise((r) => setTimeout(r, 5000));
          zaloPool.reconnect(acc.id, session).catch((err) => {
            logger.warn(`[health-check] Daily refresh failed for ${acc.id}:`, err);
          });
        }
        // Stagger reconnects by 10 seconds per account to avoid rate limits
        await new Promise((r) => setTimeout(r, 10000));
      }
    } catch (err) {
      logger.error('[health-check] Error during daily refresh:', err);
    }
  });

  logger.info('[health-check] Zalo health check started (every 5 min + daily refresh at 04:00 UTC)');
}
