/**
 * zalo-sync-routes.ts — Endpoints to sync Zalo friends/contacts to CRM contacts.
 * Requires owner or admin role.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireRole } from '../auth/role-middleware.js';
import { zaloPool } from './zalo-pool.js';
import { logger } from '../../shared/utils/logger.js';
import { randomUUID } from 'node:crypto';

export async function zaloSyncRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // Sync all friends from a Zalo account to contacts
  app.post('/api/v1/zalo-accounts/:id/sync-contacts', { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const instance = zaloPool.getInstance(id);
      if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

      try {
        const result = await instance.api.getAllFriends();
        // getAllFriends returns object with profiles
        const friends = Object.values(result || {}) as any[];
        let created = 0, updated = 0;

        for (const friend of friends) {
          const uid = friend.userId || friend.uid || '';
          if (!uid) continue;

          const zaloName = friend.zaloName || friend.zalo_name || friend.displayName || friend.display_name || '';
          const avatar = friend.avatar || '';
          const phone = friend.phoneNumber || '';

          const existing = await prisma.contact.findFirst({
            where: { zaloUid: uid, orgId: user.orgId },
          });

          let contactId: string;
          if (existing) {
            await prisma.contact.update({
              where: { id: existing.id },
              data: {
                fullName: zaloName || existing.fullName,
                avatarUrl: avatar || existing.avatarUrl,
                phone: phone || existing.phone,
              },
            });
            contactId = existing.id;
            updated++;
          } else {
            const newContact = await prisma.contact.create({
              data: {
                id: randomUUID(),
                orgId: user.orgId,
                zaloUid: uid,
                fullName: zaloName || 'Unknown',
                avatarUrl: avatar || null,
                phone: phone || null,
              },
            });
            contactId = newContact.id;
            created++;
          }

          // 🚀 Auto Re-link: connect any conversations for this Zalo UID currently without contactId
          await prisma.conversation.updateMany({
            where: {
              orgId: user.orgId,
              externalThreadId: uid,
              contactId: null,
            },
            data: { contactId },
          });
        }

        logger.info(`[sync] Zalo contacts: ${created} created, ${updated} updated`);
        return { success: true, created, updated, total: friends.length };
      } catch (err) {
        logger.error('[sync] Zalo contacts error:', err);
        return reply.status(500).send({ error: 'Sync failed: ' + String(err) });
      }
    }
  );

  // Sync recent chat messages from Zalo server
  app.post('/api/v1/zalo-accounts/:id/sync-messages', async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const account = await prisma.zaloAccount.findFirst({
      where: { id, orgId: user.orgId },
    });
    if (!account) return reply.status(404).send({ error: 'Không tìm thấy tài khoản Zalo' });

    const synced = await zaloPool.syncMessages(id);
    if (!synced) {
      return reply.status(400).send({ error: 'Tài khoản Zalo chưa kết nối hoặc không thể đồng bộ lúc này' });
    }

    return {
      success: true,
      message: 'Đang đồng bộ tin nhắn gần đây từ Zalo về hệ thống...',
    };
  });
}
