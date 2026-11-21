import type { FastifyInstance, FastifyRequest } from 'fastify';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config/index.js';

export async function portalBridgeRoutes(app: FastifyInstance) {
  const trusted = async (request: FastifyRequest) => {
    const expected = Buffer.from(process.env.PORTAL_BRIDGE_TOKEN || '');
    const supplied = Buffer.from(String(request.headers['x-portal-bridge-token'] || ''));
    if (!expected.length || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw Object.assign(new Error('Unauthorized bridge'), { statusCode: 401 });
    }
  };
  app.post('/internal/portal/session', { preHandler: trusted }, async request => {
    const body = request.body as any;
    if (!body || !/^[0-9a-f-]{36}$/i.test(body.orgId) || !Number.isSafeInteger(body.user?.id) || !['owner','admin','member','accountant'].includes(body.user?.role) || !body.brandName || !/^[0-9a-f]{16}$/.test(body.installation)) {
      throw Object.assign(new Error('Invalid portal identity'), { statusCode: 400 });
    }
    const org = await prisma.organization.upsert({ where: { id: body.orgId }, create: { id: body.orgId, name: String(body.brandName).slice(0,200) }, update: {} });
    async function provision(actor: any) {
      if (!Number.isSafeInteger(actor.id) || !['owner','admin','member','accountant'].includes(actor.role)) throw new Error('Invalid staff identity');
      const settingKey = `portal_user:${body.installation}:${actor.id}`;
      const existing = await prisma.appSetting.findUnique({ where: { orgId_settingKey: { orgId: org.id, settingKey } } });
      let user = existing?.valuePlain ? await prisma.user.findFirst({ where: { id: existing.valuePlain, orgId: org.id } }) : null;
      if (!user && actor.email) user = await prisma.user.findFirst({ where: { orgId: org.id, email: String(actor.email).trim().toLowerCase() } });
      if (!user) {
        user = await prisma.user.upsert({
          where: { email: `portal-${body.installation}-${actor.id}-${body.brandId}@integration.local` },
          create: { orgId: org.id, email: `portal-${body.installation}-${actor.id}-${body.brandId}@integration.local`, fullName: String(actor.name).slice(0,200), role: actor.role, passwordHash: `!portal-only:${randomBytes(32).toString('hex')}` },
          update: { orgId: org.id, fullName: String(actor.name).slice(0,200), role: actor.role, isActive: true },
        });
      } else {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            orgId: org.id,
            fullName: String(actor.name).slice(0, 200),
            role: actor.role,
            isActive: true,
          },
        });
      }
      await prisma.appSetting.upsert({ where: { orgId_settingKey: { orgId: org.id, settingKey } }, create: { orgId: org.id, settingKey, valuePlain: user.id }, update: { valuePlain: user.id } });
      return user;
    }
    const activeStaffIds = new Set<string>();
    for (const staff of (Array.isArray(body.staff) ? body.staff.slice(0,500) : [])) {
      const p = await provision(staff);
      activeStaffIds.add(p.id);
    }
    const user = await provision(body.user);
    activeStaffIds.add(user.id);

    // Clean up stale portal dummy users from this organization
    try {
      await prisma.user.deleteMany({
        where: {
          orgId: org.id,
          email: { startsWith: `portal-${body.installation}-` },
          id: { notIn: Array.from(activeStaffIds) },
        },
      });
    } catch {
      // non-blocking cleanup
    }
    const payload = { id: user.id, email: user.email, role: body.user.role, orgId: org.id, portal: true };
    const token = app.jwt.sign(payload as any, { expiresIn: '24h' });
    return { token, user: { ...payload, fullName: body.user.name, orgName: body.brandName }, expiresAt: Date.now() + 23 * 3600 * 1000 };
  });

  app.post('/internal/portal/handoff/ack', { preHandler: trusted }, async request => {
    const { orgId, conversationId, id, receipt, portalUrl } = request.body as any;
    if (!receipt || receipt.sourceId !== id || receipt.sourceOrgId !== orgId || !Number.isSafeInteger(receipt.id)) throw Object.assign(new Error('Invalid receipt'), { statusCode: 400 });
    const settingKey = `customer_need:${conversationId}:${id}`;
    const where = { orgId_settingKey: { orgId, settingKey } };
    const row = await prisma.appSetting.findUnique({ where });
    if (!row?.valuePlain) throw Object.assign(new Error('Need not found'), { statusCode: 404 });
    const need = JSON.parse(row.valuePlain);
    if (need.status === 'sent') return { need };
    if (need.status !== 'pending_delivery') throw Object.assign(new Error('Need is not ready'), { statusCode: 409 });
    const sent = { ...need, status: 'sent', portalId: receipt.id, portalStatus: receipt.status, portalUrl, sentAt: new Date().toISOString(), deliveryError: null };
    const updated = await prisma.appSetting.updateMany({ where: { id: row.id, valuePlain: row.valuePlain }, data: { valuePlain: JSON.stringify(sent) } });
    if (!updated.count) throw Object.assign(new Error('Concurrent handoff update; retry'), { statusCode: 409 });
    return { need: sent, message: 'Portal đã nhận phiếu. Kế toán tiếp nhận tại mục Nhu cầu từ Sales.' };
  });

  app.get('/internal/portal/latest-unread', { preHandler: trusted }, async () => {
    const unread = await prisma.conversation.findMany({
      where: { unreadCount: { gt: 0 } },
      include: {
        contact: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            phone: true,
          },
        },
        zaloAccount: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 5,
    });
    return { conversations: unread };
  });

  app.get('/api/v1/portal-assets/*', { preHandler: authMiddleware }, async (request, reply) => {
    const filename = (request.params as any)['*'] as string;
    if (!filename || filename.includes('..') || !/^media\/[a-zA-Z0-9_.-]+$/.test(filename)) {
      return reply.code(404).send({ error: 'Not found' });
    }
    const baseDir = path.resolve(config.uploadDir);
    const file = path.resolve(baseDir, filename);
    if (!file.startsWith(baseDir + path.sep)) {
      return reply.code(404).send({ error: 'Not found' });
    }
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(file);
    } catch {
      return reply.code(404).send({ error: 'Not found' });
    }
    if (!stat.isFile()) {
      return reply.code(404).send({ error: 'Not found' });
    }

    const uploadUrl = `/uploads/${filename}`;
    const item = await prisma.mediaItem.findFirst({ where: { orgId: request.user.orgId, url: uploadUrl } }).catch(() => null);
    if (!item) {
      const baseName = path.basename(filename);
      const [msgMatch, contactMatch, accountMatch] = await Promise.all([
        prisma.$queryRaw<Array<{ id: string }>>`
          SELECT m.id FROM messages m
          INNER JOIN conversations c ON c.id = m.conversation_id
          WHERE c.org_id = ${request.user.orgId}
            AND (m.content LIKE ${'%' + baseName + '%'} OR m.attachments::text LIKE ${'%' + baseName + '%'})
          LIMIT 1
        `.catch(() => []),
        prisma.contact.findFirst({
          where: { orgId: request.user.orgId, avatarUrl: { contains: baseName } },
          select: { id: true },
        }).catch(() => null),
        prisma.zaloAccount.findFirst({
          where: { orgId: request.user.orgId, avatarUrl: { contains: baseName } },
          select: { id: true },
        }).catch(() => null),
      ]);
      if ((!msgMatch || msgMatch.length === 0) && !contactMatch && !accountMatch) {
        return reply.code(404).send({ error: 'Not found' });
      }
    }

    const ext = path.extname(filename).toLowerCase().replace('.', '');
    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
      ogg: 'audio/ogg',
      opus: 'audio/ogg',
      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
      aac: 'audio/aac',
      wav: 'audio/wav',
      mp4: 'video/mp4',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    reply.type(item?.mimeType || mimeMap[ext] || 'application/octet-stream');
    reply.header('Cache-Control', 'private, max-age=86400, no-transform');
    return reply.send(fs.createReadStream(file));
  });
}
