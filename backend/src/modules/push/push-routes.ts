import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { randomUUID } from 'crypto';

export async function pushRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // GET VAPID public key
  app.get('/api/v1/push/public-key', async () => {
    return { publicKey: process.env.VAPID_PUBLIC_KEY || '' };
  });

  // POST subscribe
  app.post('/api/v1/push/subscribe', async (request, reply) => {
    const user = request.user!;
    const { endpoint, p256dh, auth } = request.body as {
      endpoint: string;
      p256dh: string;
      auth: string;
    };

    if (!endpoint || !p256dh || !auth) {
      return reply.status(400).send({ error: 'Missing subscription details' });
    }

    // Upsert subscription
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: {
        userId: user.id,
        p256dh,
        auth
      },
      create: {
        id: randomUUID(),
        userId: user.id,
        endpoint,
        p256dh,
        auth
      }
    });

    return { success: true };
  });

  // POST unsubscribe
  app.post('/api/v1/push/unsubscribe', async (request, reply) => {
    const { endpoint } = request.body as { endpoint: string };
    if (!endpoint) {
      return reply.status(400).send({ error: 'Missing endpoint' });
    }

    await prisma.pushSubscription.deleteMany({
      where: { endpoint }
    });

    return { success: true };
  });
}
