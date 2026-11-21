import 'dotenv/config';
import { portalBridgeRoutes } from './modules/portal/portal-bridge.js';
import { securePortalSockets } from './modules/portal/portal-sockets.js';
/**
 * Main application entry point.
 * Bootstraps Fastify server with all plugins, Socket.IO, and route handlers.
 * The process never exits — all errors are caught and logged.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Prisma } from '@prisma/client';
import { config } from './config/index.js';
import { prisma } from './shared/database/prisma-client.js';
import { logger } from './shared/utils/logger.js';
import { authRoutes } from './modules/auth/auth-routes.js';
import { zaloRoutes } from './modules/zalo/zalo-routes.js';
import { chatRoutes } from './modules/chat/chat-routes.js';
import { groupRoutes } from './modules/chat/group-routes.js';
import { contactRoutes } from './modules/contacts/contact-routes.js';
import { contactSubResourceRoutes } from './modules/contacts/contact-sub-resource-routes.js';
import { appointmentRoutes } from './modules/contacts/appointment-routes.js';
import { startAppointmentReminder } from './modules/contacts/appointment-reminder.js';
import { decryptData } from './utils/crypto.js';
import { dashboardRoutes } from './modules/dashboard/dashboard-routes.js';
import { reportRoutes } from './modules/dashboard/report-routes.js';
import { userRoutes } from './modules/auth/user-routes.js';
import { teamRoutes } from './modules/auth/team-routes.js';
import { orgRoutes } from './modules/auth/org-routes.js';
import { zaloAccessRoutes } from './modules/zalo/zalo-access-routes.js';
import { zaloSyncRoutes } from './modules/zalo/zalo-sync-routes.js';
import { zaloPool } from './modules/zalo/zalo-pool.js';
import { whatsappPool } from './modules/whatsapp/whatsapp-pool.js';
import { whatsappRoutes } from './modules/whatsapp/whatsapp-routes.js';
import { registerZaloSocketHandlers } from './modules/zalo/zalo-socket.js';
import { notificationRoutes } from './modules/notifications/notification-routes.js';
import { searchRoutes } from './modules/search/search-routes.js';
import { startZaloHealthCheck } from './modules/zalo/zalo-health-check.js';
import { publicApiRoutes } from './modules/api/public-api-routes.js';
import { webhookSettingsRoutes } from './modules/api/webhook-settings-routes.js';
import { handoverRoutes } from './modules/handovers/handover-routes.js';
import { customerNeedRoutes } from './modules/customer-needs/customer-need-routes.js';
import { orderRoutes } from './modules/orders/order-routes.js';
import { pushRoutes } from './modules/push/push-routes.js';
import fs from 'fs';
import { mediaRoutes } from './modules/media/media-routes.js';
import { zaloExtendedRoutes } from './modules/zalo/zalo-extended-routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function bootstrap() {
  const app = Fastify({ logger: false, trustProxy: true });

  // Support empty JSON body without FST_ERR_CTP_EMPTY_JSON_BODY error
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      const str = typeof body === 'string' ? body : (body ? body.toString('utf-8') : '');
      if (!str || str.trim() === '') {
        return done(null, {});
      }
      return done(null, JSON.parse(str));
    } catch (err: any) {
      return done(err, undefined);
    }
  });

  // ── Plugins ──────────────────────────────────────────────────────────────

  const allowedOrigins = process.env.PORTAL_ALLOWED_ORIGINS
    ? process.env.PORTAL_ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : [config.appUrl, 'https://omni.chuoicungung.vn', 'https://portal.chuoicungung.vn', 'https://zalo.tahomart.vn', 'http://localhost:5173', 'http://localhost:5174'];

  await app.register(cors, {
    origin: config.isProduction ? allowedOrigins : true,
    credentials: true,
  });

  await app.register(fastifyJwt, {
    secret: config.jwtSecret,
  });

  await app.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024,
    },
  });

  // Rate limiting with higher limits and per-key tracking
  await app.register(rateLimit, {
    max: 1000,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      const apiKey = request.headers['x-api-key'] as string;
      if (apiKey) {
        return `api:${apiKey}`;
      }
      return request.ip;
    },
  });

  // Serve uploaded media files
  const uploadDir = path.resolve(config.uploadDir);
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  await app.register(fastifyStatic, {
    root: uploadDir,
    prefix: '/uploads/',
    decorateReply: !config.isProduction,
    maxAge: '7d',
    immutable: true,
  });

  // Serve compiled frontend assets in production
  if (config.isProduction && process.env.PORTAL_MANAGED !== 'true') {
    await app.register(fastifyStatic, {
      root: path.join(__dirname, '../static'),
      prefix: '/',
    });
  }

  // ── Socket.IO ─────────────────────────────────────────────────────────────

  const io = new Server(app.server, {
    cors: {
      origin: '*',
      credentials: true,
    },
  });

  // Attach io to app so route handlers can emit events
  app.decorate('io', io);

  // Pass io to zalo pool and whatsapp pool for real-time event emission
  zaloPool.setIO(io);
  whatsappPool.setIO(io);

  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id}`);
    socket.on('disconnect', () => {
      logger.debug(`Socket disconnected: ${socket.id}`);
    });
  });

  // Register Zalo / Portal Socket.IO event handlers
  if (process.env.PORTAL_MANAGED === 'true') securePortalSockets(io);
  else registerZaloSocketHandlers(io);

  // ── Routes ────────────────────────────────────────────────────────────────

  await app.register(portalBridgeRoutes);
  if (process.env.PORTAL_MANAGED !== 'true') await app.register(authRoutes);
  else {
    app.get(
      '/api/v1/profile',
      { preHandler: (await import('./modules/auth/auth-middleware.js')).authMiddleware },
      async (request) => {
        const user = await prisma.user.findUnique({
          where: { id: request.user!.id },
          include: { org: true },
        });
        return user
          ? {
              id: user.id,
              email: user.email,
              fullName: user.fullName,
              orgId: user.orgId,
              role: request.user!.role,
              org: user.org,
            }
          : null;
      }
    );
  }

  await app.register(zaloRoutes);
  await app.register(chatRoutes);
  await app.register(groupRoutes);
  await app.register(contactRoutes);
  await app.register(contactSubResourceRoutes);
  await app.register(appointmentRoutes);
  await app.register(dashboardRoutes);
  await app.register(reportRoutes);
  await app.register(userRoutes);
  await app.register(teamRoutes);
  await app.register(orgRoutes);
  await app.register(zaloAccessRoutes);
  await app.register(zaloSyncRoutes);
  await app.register(notificationRoutes);
  await app.register(searchRoutes);
  await app.register(publicApiRoutes);
  await app.register(webhookSettingsRoutes);
  await app.register(orderRoutes);
  await app.register(customerNeedRoutes);
  await app.register(handoverRoutes);
  await app.register(pushRoutes);
  await app.register(mediaRoutes);
  await app.register(zaloExtendedRoutes);
  await app.register(whatsappRoutes);

  // Liveness/readiness probes (support both /health and /api/v1/health)
  const healthHandler = async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'connected', timestamp: new Date().toISOString() };
    } catch {
      return { status: 'error', db: 'disconnected', timestamp: new Date().toISOString() };
    }
  };
  app.get('/health', healthHandler);
  app.get('/api/v1/health', healthHandler);

  // API version banner
  app.get('/api/v1/status', async () => {
    return { version: '1.0.0', name: 'Zalo CRM' };
  });

  // SPA fallback — serve index.html for non-API routes in production
  if (config.isProduction && process.env.PORTAL_MANAGED !== 'true') {
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'not_found' });
      }
      return reply.sendFile('index.html');
    });
  }

  // ── Error handler ─────────────────────────────────────────────────────────

  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    logger.error('Request error:', error.message);
    reply.status(error.statusCode ?? 500).send({
      error: error.message || 'Internal Server Error',
    });
  });

  // ── Start ─────────────────────────────────────────────────────────────────

  try {
    await app.listen({ port: config.port, host: config.host });
    logger.info(`Zalo CRM running on http://${config.host}:${config.port}`);
    logger.info(`Environment: ${config.nodeEnv}`);

    // Ensure database composite indexes & columns exist for ultra-fast query performance
    try {
      await prisma.$executeRawUnsafe(
        'CREATE INDEX IF NOT EXISTS idx_messages_conv_sent ON messages (conversation_id, sent_at DESC);'
      );
      await prisma.$executeRawUnsafe(
        'CREATE INDEX IF NOT EXISTS idx_messages_zalo_msg_id ON messages (zalo_msg_id);'
      );
      await prisma.$executeRawUnsafe(
        "ALTER TABLE zalo_accounts ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'zalo';"
      );
      await prisma.$executeRawUnsafe(
        "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'zalo';"
      );
      await prisma.$executeRawUnsafe(
        "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'zalo';"
      );
      await prisma.$executeRawUnsafe(
        "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS whatsapp_jid TEXT;"
      );
      logger.info('[database] Composite indexes and columns checked/created successfully');
    } catch (idxErr) {
      logger.warn('[database] Composite index setup notice:', idxErr);
    }

    if (process.env.ZALO_AUTOCONNECT !== 'false') {
      startAppointmentReminder(io);
      startZaloHealthCheck();
    }
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }

  // Also auto-reconnect connected WhatsApp sessions
  whatsappPool.autoReconnectAll().catch((err) => {
    logger.warn('Auto-reconnect WhatsApp accounts failed:', err);
  });

  // Reconnect Zalo accounts that have saved sessions (staggered to avoid rate limits)
  try {
    const accounts = await prisma.zaloAccount.findMany({
      where: {
        ...(process.env.ZALO_AUTOCONNECT === 'false' ? { id: '__disabled__' } : {}),
        sessionData: { not: Prisma.JsonNull },
        status: { not: 'qr_pending' },
      },
      select: { id: true, sessionData: true },
    });
    logger.info(`Attempting reconnect for ${accounts.length} Zalo account(s)`);
    for (const account of accounts) {
      const session = decryptData<{
        cookie: any;
        imei: string;
        userAgent: string;
      }>(account.sessionData);
      if (session?.imei) {
        // Stagger reconnects: random 20-50 seconds between each account to mimic human logins
        const randomDelay = Math.floor(Math.random() * (50000 - 20000 + 1)) + 20000;
        await new Promise((r) => setTimeout(r, randomDelay));
        zaloPool.reconnect(account.id, session).catch((err) => {
          logger.warn(`Auto-reconnect failed for account ${account.id}:`, err);
        });
      }
    }
  } catch (err) {
    logger.error('Failed to load accounts for reconnect:', err);
  }
}

// Keep process alive — log but never crash on unhandled errors
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
});

bootstrap();
