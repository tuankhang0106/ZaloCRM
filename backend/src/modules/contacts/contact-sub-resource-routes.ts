/**
 * contact-sub-resource-routes.ts — Sub-resource endpoints for contacts.
 * Provides appointments scoped to a specific contact.
 * All routes require JWT auth and are scoped to the user's org.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';

import { extractConversationAssets } from '../chat/chat-routes.js';

export async function contactSubResourceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/contacts/:id/appointments — appointments for contact ───────
  app.get('/api/v1/contacts/:id/appointments', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const appointments = await prisma.appointment.findMany({
        where: { contactId: id, orgId: user.orgId },
        orderBy: { appointmentDate: 'desc' },
        take: 20,
      });

      return { appointments };
    } catch (err) {
      logger.error('[contacts] Appointments by contact error:', err);
      return reply.status(500).send({ error: 'Failed to fetch appointments' });
    }
  });

  // ── GET /api/v1/contacts/:id/assets — media, files, and links for contact ──
  app.get('/api/v1/contacts/:id/assets', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      // Find conversations for this contact
      const conversations = await prisma.conversation.findMany({
        where: { contactId: id, orgId: user.orgId },
        select: { id: true },
      });

      if (conversations.length === 0) {
        return { images: [], files: [], links: [] };
      }

      const conversationIds = conversations.map(c => c.id);
      const messages = await prisma.message.findMany({
        where: {
          conversationId: { in: conversationIds },
          isDeleted: false,
          OR: [
            { contentType: { in: ['image', 'file', 'link', 'video'] } },
            { content: { contains: 'http' } },
            { content: { contains: '"href":' } },
            { content: { contains: '"thumb":' } },
          ],
        },
        orderBy: { sentAt: 'desc' },
        select: {
          id: true,
          contentType: true,
          content: true,
          senderType: true,
          senderName: true,
          sentAt: true,
          attachments: true,
        },
      });

      return extractConversationAssets(messages);
    } catch (err) {
      logger.error('[contacts] Assets by contact error:', err);
      return reply.status(500).send({ error: 'Failed to fetch contact assets' });
    }
  });
}
