/**
 * Auth middleware — verifies JWT on protected routes.
 * JWT user shape is defined in shared/types/fastify-jwt-user.d.ts.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Bypass global header authentication for proxy file downloads
  // We verify it manually inside the route handler using the token in query parameter
  if (request.url.startsWith('/api/v1/files/download') || request.url.startsWith('/api/v1/public/brand')) {
    return;
  }

  try {
    await request.jwtVerify();
  } catch {
    reply.status(401).send({ error: 'Unauthorized' });
  }
}
