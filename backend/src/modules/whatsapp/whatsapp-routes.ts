import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireRole } from '../auth/role-middleware.js';
import { whatsappPool } from './whatsapp-pool.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

export async function whatsappRoutes(app: FastifyInstance): Promise<void> {
  // All routes require auth
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/whatsapp-accounts — list WhatsApp accounts with status
  app.get('/api/v1/whatsapp-accounts', async (request: FastifyRequest) => {
    const user = request.user!;
    const accounts = await prisma.zaloAccount.findMany({
      where: {
        orgId: user.orgId,
        channel: 'whatsapp',
      },
      select: {
        id: true,
        zaloUid: true,
        displayName: true,
        avatarUrl: true,
        phone: true,
        status: true,
        channel: true,
        lastConnectedAt: true,
        createdAt: true,
        owner: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return accounts.map((a) => ({
      ...a,
      liveStatus: whatsappPool.getStatus(a.id),
      qrCode: whatsappPool.getQr(a.id),
    }));
  });

  // POST /api/v1/whatsapp-accounts — initiate new WhatsApp QR login
  app.post<{ Body: { displayName?: string } }>(
    '/api/v1/whatsapp-accounts',
    async (request: FastifyRequest<{ Body: { displayName?: string } }>, reply: FastifyReply) => {
      const user = request.user!;
      const { displayName } = request.body ?? {};

      // Create a pending WhatsApp account
      const account = await prisma.zaloAccount.create({
        data: {
          orgId: user.orgId,
          ownerUserId: user.id,
          displayName: displayName || 'WhatsApp Business',
          channel: 'whatsapp',
          status: 'qr_pending',
        },
      });

      // Start WhatsApp connection and generate QR
      try {
        const result = await whatsappPool.initWhatsApp(account.id, user.orgId, user.id);
        return reply.status(201).send({
          id: account.id,
          displayName: account.displayName,
          status: result.status,
          qrCode: result.qrCode,
        });
      } catch (err: any) {
        logger.error(`[whatsapp-routes] Init failed for account ${account.id}:`, err);
        return reply.status(500).send({
          error: `Không thể tạo phiên kết nối WhatsApp: ${err.message}`,
        });
      }
    }
  );

  // GET /api/v1/whatsapp-accounts/:id/debug — inspect live browser DOM & optional auto-dismiss/sync
  app.get<{ Params: { id: string }; Querystring?: { dismiss?: string; sync?: string } }>(
    '/api/v1/whatsapp-accounts/:id/debug',
    async (request: FastifyRequest<{ Params: { id: string }; Querystring?: { dismiss?: string; sync?: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const { dismiss, sync } = (request.query || {}) as any;
      const inst = (whatsappPool as any).instances.get(id);
      if (!inst || !inst.client) return reply.send({ error: 'No instance' });
      const page = inst.client.pupPage;
      if (!page) return reply.send({ error: 'No pupPage' });

      let dismissed = false;
      if (dismiss === 'true' || dismiss === '1') {
        dismissed = await whatsappPool.autoDismissModals(page);
      }

      let syncResult = null;
      if (sync === 'true' || sync === '1') {
        syncResult = await whatsappPool.syncRecentChats(id, request.user?.orgId).catch((e: any) => ({ error: e.message }));
      }

      const info = await page
        .evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]')).map((el: any) => ({
            tag: el.tagName,
            text: el.innerText,
            role: el.getAttribute('role'),
          }));
          return {
            title: document.title,
            url: window.location.href,
            hasCanvas: Boolean(document.querySelector('canvas')),
            text: document.body.innerText.substring(0, 400),
            buttons,
          };
        })
        .catch((e: any) => ({ error: e.message }));
      return reply.send({ status: inst.status, dismissed, syncResult, info });
    }
  );

  // POST /api/v1/whatsapp-accounts/:id/sync — manually trigger sync of recent chats & messages
  app.post<{ Params: { id: string }; Body?: { limitChats?: number; limitMsgs?: number } }>(
    '/api/v1/whatsapp-accounts/:id/sync',
    async (request: FastifyRequest<{ Params: { id: string }; Body?: { limitChats?: number; limitMsgs?: number } }>, reply: FastifyReply) => {
      const user = request.user!;
      const { id } = request.params;
      const { limitChats, limitMsgs } = request.body ?? {};

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId, channel: 'whatsapp' },
      });
      if (!account) return reply.status(404).send({ error: 'Tài khoản không tồn tại' });

      try {
        const result = await whatsappPool.syncRecentChats(
          id,
          user.orgId,
          typeof limitChats === 'number' ? limitChats : 50,
          typeof limitMsgs === 'number' ? limitMsgs : 20
        );
        return reply.send({
          success: true,
          message: `Đồng bộ thành công ${result.syncedChats} cuộc trò chuyện và ${result.syncedMessages} tin nhắn`,
          data: result,
        });
      } catch (err: any) {
        logger.error(`[whatsapp-routes] Sync failed for account ${id}:`, err);
        return reply.status(500).send({ error: `Đồng bộ thất bại: ${err.message}` });
      }
    }
  );

  // GET /api/v1/whatsapp-accounts/:id/qr — poll current QR code
  app.get<{ Params: { id: string } }>(
    '/api/v1/whatsapp-accounts/:id/qr',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, channel: 'whatsapp' },
      });
      if (!account) return reply.status(404).send({ error: 'Tài khoản không tồn tại' });

      const status = whatsappPool.getStatus(id);
      const qrCode = whatsappPool.getQr(id);

      return reply.send({
        id,
        status,
        qrCode,
      });
    }
  );

  // POST /api/v1/whatsapp-accounts/:id/login — re-generate QR code for existing account
  app.post<{ Params: { id: string } }>(
    '/api/v1/whatsapp-accounts/:id/login',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const user = request.user!;
      const { id } = request.params;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, channel: 'whatsapp' },
      });
      if (!account) return reply.status(404).send({ error: 'Tài khoản không tồn tại' });

      const result = await whatsappPool.initWhatsApp(id, user.orgId, user.id, true);
      return reply.send({
        id,
        status: result.status,
        qrCode: result.qrCode,
      });
    }
  );

  // POST /api/v1/whatsapp-accounts/:id/disconnect — disconnect account
  app.post<{ Params: { id: string } }>(
    '/api/v1/whatsapp-accounts/:id/disconnect',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, channel: 'whatsapp' },
      });
      if (!account) return reply.status(404).send({ error: 'Tài khoản không tồn tại' });

      await whatsappPool.disconnect(id);
      return reply.send({ success: true, message: 'Đã ngắt kết nối WhatsApp' });
    }
  );

  // DELETE /api/v1/whatsapp-accounts/:id — delete account record
  app.delete<{ Params: { id: string } }>(
    '/api/v1/whatsapp-accounts/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, channel: 'whatsapp' },
      });
      if (!account) return reply.status(404).send({ error: 'Tài khoản không tồn tại' });

      await whatsappPool.disconnect(id);
      await prisma.zaloAccount.delete({ where: { id } });

      return reply.send({ success: true, message: 'Đã xóa tài khoản WhatsApp' });
    }
  );
}

