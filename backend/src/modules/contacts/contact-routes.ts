/**
 * contact-routes.ts — REST API for CRM contact management.
 * Supports list, detail, create, update, delete, pipeline view, and tag updates.
 * All routes require JWT auth and are scoped to user's org.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';

type QueryParams = Record<string, string>;

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/contacts — list with filters and pagination ───────────────
  app.get('/api/v1/contacts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const {
        page = '1',
        limit = '50',
        search = '',
        source = '',
        status = '',
        assignedUserId = '',
        accountantOnly = '',
      } = request.query as QueryParams;

      const where: any = { orgId: user.orgId };
      if (source) where.source = source;
      if (status) where.status = status;
      if (assignedUserId) where.assignedUserId = assignedUserId;

      const andConditions: any[] = [];

      if (user.role === 'accountant') {
        const accountantKeywords = [
          'kế toán',
          'ketoan',
          user.email.toLowerCase(),
          user.id
        ];
        andConditions.push({
          notes: { contains: '[Chuyển cho Kế toán]', mode: 'insensitive' as const },
          OR: accountantKeywords.map(keyword => ({
            notes: { contains: keyword, mode: 'insensitive' as const }
          }))
        });
      } else if (accountantOnly === 'true') {
        andConditions.push({
          OR: [
            { notes: { contains: '[Chuyển cho Kế toán]', mode: 'insensitive' as const } },
            {
              metadata: {
                path: ['customerCode'],
                not: null
              }
            }
          ]
        });
      }

      if (search) {
        andConditions.push({
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
            { email: { contains: search, mode: 'insensitive' } },
          ]
        });
      }

      if (andConditions.length > 0) {
        where.AND = andConditions;
      }

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      const [contacts, total] = await Promise.all([
        prisma.contact.findMany({
          where,
          include: {
            assignedUser: { select: { id: true, fullName: true, email: true } },
            _count: { select: { conversations: true, appointments: true } },
          },
          orderBy: { updatedAt: 'desc' },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.contact.count({ where }),
      ]);

      return { contacts, total, page: pageNum, limit: limitNum };
    } catch (err) {
      logger.error('[contacts] List error:', err);
      return reply.status(500).send({ error: 'Failed to fetch contacts' });
    }
  });

  // ── GET /api/v1/contacts/pipeline — kanban grouped by generic status ──────
  app.get('/api/v1/contacts/pipeline', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const orgId = user.orgId;

      const pipeline = await prisma.contact.groupBy({
        by: ['status'],
        where: { orgId, status: { not: null } },
        _count: true,
      });

      // Fetch contacts per status for kanban cards (limit 20 per column)
      const statuses = pipeline.map((g) => g.status ?? 'unknown');
      const contactsByStatus: Record<string, any[]> = {};

      await Promise.all(
        statuses.map(async (st) => {
          const where: any = { orgId, status: st ?? null };
          if (user.role === 'accountant') {
            const accountantKeywords = [
              'kế toán',
              'ketoan',
              user.email.toLowerCase(),
              user.id
            ];
            where.OR = accountantKeywords.map(keyword => ({
              notes: { contains: keyword, mode: 'insensitive' as const }
            }));
          }
          const contacts = await prisma.contact.findMany({
            where,
            select: {
              id: true,
              fullName: true,
              phone: true,
              email: true,
              avatarUrl: true,
              status: true,
              nextAppointment: true,
              assignedUser: { select: { id: true, fullName: true } },
            },
            orderBy: { updatedAt: 'desc' },
            take: 20,
          });
          contactsByStatus[st ?? 'unknown'] = contacts;
        }),
      );

      const result = pipeline.map((g) => ({
        status: g.status ?? 'unknown',
        count: g._count,
        contacts: contactsByStatus[g.status ?? 'unknown'] ?? [],
      }));

      return { pipeline: result };
    } catch (err) {
      logger.error('[contacts] Pipeline error:', err);
      return reply.status(500).send({ error: 'Failed to fetch pipeline' });
    }
  });

  // ── GET /api/v1/contacts/:id — detail with appointments + conversation count
  app.get('/api/v1/contacts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const contact = await prisma.contact.findFirst({
        where: { id, orgId: user.orgId },
        include: {
          assignedUser: { select: { id: true, fullName: true, email: true } },
          appointments: {
            orderBy: { appointmentDate: 'desc' },
            take: 20,
            include: { assignedUser: { select: { id: true, fullName: true } } },
          },
          orders: {
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: { createdBy: { select: { id: true, fullName: true } } },
          },
          conversations: {
            orderBy: { lastMessageAt: 'desc' },
            take: 10,
            select: { id: true, threadType: true, lastMessageAt: true, unreadCount: true, zaloAccountId: true },
          },
          _count: { select: { conversations: true, appointments: true, orders: true } },
        },
      });

      if (!contact) return reply.status(404).send({ error: 'Contact not found' });

      // Apply accountant check
      if (user.role === 'accountant') {
        const notesStr = (contact.notes || '').toLowerCase();
        const hasTransfer = notesStr.includes('[chuyển cho kế toán]');
        const accountantKeywords = [
          'kế toán',
          'ketoan',
          user.email.toLowerCase(),
          user.id
        ];
        const hasAccess = hasTransfer && accountantKeywords.some(keyword => 
          notesStr.includes(keyword)
        );
        if (!hasAccess) {
          return reply.status(403).send({ error: 'Không có quyền truy cập thông tin khách hàng này' });
        }
      }

      return contact;
    } catch (err) {
      logger.error('[contacts] Detail error:', err);
      return reply.status(500).send({ error: 'Failed to fetch contact' });
    }
  });

  // ── POST /api/v1/contacts — create new contact ────────────────────────────
  app.post('/api/v1/contacts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (user.role === 'accountant') {
        return reply.status(403).send({ error: 'Kế toán không được phép tạo khách hàng mới.' });
      }
      const body = request.body as Record<string, any>;

      const contact = await prisma.contact.create({
        data: {
          orgId: user.orgId,
          fullName: body.fullName,
          phone: body.phone,
          email: body.email,
          zaloUid: body.zaloUid,
          avatarUrl: body.avatarUrl,
          source: body.source,
          sourceDate: body.sourceDate ? new Date(body.sourceDate) : undefined,
          status: body.status ?? 'new',
          nextAppointment: body.nextAppointment ? new Date(body.nextAppointment) : undefined,
          assignedUserId: body.assignedUserId,
          notes: body.notes,
          tags: body.tags ?? [],
          metadata: body.metadata ?? {},
        },
      });

      // 🚀 Auto Re-link: connect any conversation for this Zalo UID currently without contactId
      if (contact.zaloUid) {
        await prisma.conversation.updateMany({
          where: { orgId: user.orgId, externalThreadId: contact.zaloUid, contactId: null },
          data: { contactId: contact.id },
        });
      }

      return reply.status(201).send(contact);
    } catch (err) {
      logger.error('[contacts] Create error:', err);
      return reply.status(500).send({ error: 'Failed to create contact' });
    }
  });

  // ── PUT /api/v1/contacts/:id — update CRM fields ─────────────────────────
  app.put('/api/v1/contacts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      if (user.role === 'accountant') {
        const contact = await prisma.contact.findFirst({
          where: { id, orgId: user.orgId },
          select: { notes: true }
        });
        const notesStr = (contact?.notes || '').toLowerCase();
        const hasTransfer = notesStr.includes('[chuyển cho kế toán]');
        const accountantKeywords = [
          'kế toán',
          'ketoan',
          user.email.toLowerCase(),
          user.id
        ];
        const hasAccess = hasTransfer && accountantKeywords.some(keyword => 
          notesStr.includes(keyword)
        );
        if (!hasAccess) {
          return reply.status(403).send({ error: 'Kế toán không có quyền chỉnh sửa khách hàng này.' });
        }
      }
      const body = request.body as Record<string, any>;

      const existing = await prisma.contact.findFirst({ where: { id, orgId: user.orgId }, select: { id: true, fullName: true, notes: true, metadata: true } });
      if (!existing) return reply.status(404).send({ error: 'Contact not found' });

      let newFullName = body.fullName;
      const tag = '[Chuyển cho Kế toán]';
      const codeRegex = / - [A-Z]+[0-9]+$/;
      const hasCode = codeRegex.test(body.fullName || existing.fullName || '');

      const existingMeta = existing.metadata && typeof existing.metadata === 'object' ? (existing.metadata as any) : {};
      const bodyMeta = body.metadata && typeof body.metadata === 'object' ? (body.metadata as any) : {};

      if (body.generateCode === true) {
        // Generate customer code
        let zaloAccountId = body.metadata?.zaloAccountId;
        if (!zaloAccountId) {
          const lastConv = await prisma.conversation.findFirst({
            where: { contactId: id, orgId: user.orgId },
            orderBy: { lastMessageAt: 'desc' },
            select: { zaloAccountId: true }
          });
          zaloAccountId = lastConv?.zaloAccountId;
        }

        let prefix = 'KH';
        if (zaloAccountId) {
          const za = await prisma.zaloAccount.findFirst({
            where: { id: zaloAccountId, orgId: user.orgId },
            select: { displayName: true }
          });
          if (za) {
            const nameLower = (za.displayName || '').toLowerCase().replace(/\s+/g, '');
            if (nameLower.includes('adameva')) {
              prefix = 'AE';
            } else if (nameLower.includes('cgdp') || nameLower.includes('c-g-d-p') || nameLower.includes('cgd')) {
              prefix = 'CGDP';
            } else if (nameLower.includes('chuyengiadongphuc') || nameLower.includes('cgia')) {
              prefix = 'CGIA';
            }
          }
        }

        // Count contacts transferred in the current month for this organization
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        const monthContacts = await prisma.contact.findMany({
          where: {
            orgId: user.orgId
          },
          select: { fullName: true, metadata: true }
        });

        // Calculate sequence count by scanning active and historical customerCodes in the current month
        let maxSequence = 0;
        const currentYY = String(now.getFullYear()).slice(-2);
        const currentMM = String(now.getMonth() + 1).padStart(2, '0');

        const parseCodeSeq = (code: string) => {
          if (!code) return;
          const match = code.match(/([0-9]{2})([0-9]{2})([0-9]{2})([0-9]+)$/);
          if (match) {
            const year = match[1];
            const month = match[2];
            const seq = parseInt(match[4], 10);
            if (year === currentYY && month === currentMM) {
              if (seq > maxSequence) {
                maxSequence = seq;
              }
            }
          }
        };

        for (const c of monthContacts) {
          const meta = c.metadata && typeof c.metadata === 'object' ? (c.metadata as any) : {};
          
          if (meta.customerCode) {
            parseCodeSeq(meta.customerCode);
          }
          
          if (c.fullName) {
            parseCodeSeq(c.fullName);
          }
          
          if (Array.isArray(meta.history)) {
            for (const h of meta.history) {
              if (h.customerCode) {
                parseCodeSeq(h.customerCode);
              }
            }
          }
        }

        const sequence = maxSequence + 1;
        const yy = String(now.getFullYear()).slice(-2);
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const seqStr = String(sequence).padStart(2, '0');
        const customerCode = `${prefix}${yy}${mm}${dd}${seqStr}`;

        const baseName = (body.fullName || existing.fullName || '').replace(codeRegex, '').trim();
        newFullName = `${baseName} - ${customerCode}`;

        if (!body.metadata || typeof body.metadata !== 'object') {
          body.metadata = {};
        }
        body.metadata.customerCode = customerCode;
      }

      const updateData: any = {
        fullName: newFullName,
        phone: body.phone,
        email: body.email,
        avatarUrl: body.avatarUrl,
        source: body.source,
        sourceDate: body.sourceDate ? new Date(body.sourceDate) : undefined,
        status: body.status,
        nextAppointment: body.nextAppointment ? new Date(body.nextAppointment) : undefined,
        assignedUserId: body.assignedUserId,
        notes: body.notes,
        tags: body.tags,
        metadata: body.metadata,
      };
      if (body.firstContactDate !== undefined) {
        updateData.firstContactDate = body.firstContactDate ? new Date(body.firstContactDate) : null;
      }

      const updated = await prisma.contact.update({
        where: { id },
        data: updateData,
        include: {
          assignedUser: { select: { id: true, fullName: true, email: true } },
          appointments: { orderBy: { appointmentDate: 'desc' }, take: 10 },
          _count: { select: { conversations: true } },
        },
      });

      // 🚀 Auto Re-link: connect any conversation for this Zalo UID currently without contactId
      const targetZaloUid = updated.zaloUid || existingMeta.zaloUid;
      if (targetZaloUid) {
        await prisma.conversation.updateMany({
          where: { orgId: user.orgId, externalThreadId: targetZaloUid, contactId: null },
          data: { contactId: updated.id },
        });
      }

      return updated;
    } catch (err) {
      logger.error('[contacts] Update error:', err);
      return reply.status(500).send({ error: 'Failed to update contact' });
    }
  });

  // ── PUT /api/v1/contacts/:id/tags — update tags only ─────────────────────
  app.put('/api/v1/contacts/:id/tags', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (user.role === 'accountant') {
        return reply.status(403).send({ error: 'Kế toán không được phép chỉnh sửa thẻ khách hàng.' });
      }
      const { id } = request.params as { id: string };
      const { tags } = request.body as { tags: string[] };

      if (!Array.isArray(tags)) return reply.status(400).send({ error: 'tags must be an array' });

      const existing = await prisma.contact.findFirst({ where: { id, orgId: user.orgId }, select: { id: true } });
      if (!existing) return reply.status(404).send({ error: 'Contact not found' });

      const updated = await prisma.contact.update({ where: { id }, data: { tags } });
      return updated;
    } catch (err) {
      logger.error('[contacts] Update tags error:', err);
      return reply.status(500).send({ error: 'Failed to update tags' });
    }
  });

  // ── DELETE /api/v1/contacts/bulk & POST /api/v1/contacts/bulk-delete ─────
  const handleBulkDelete = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (user.role === 'accountant') {
        return reply.status(403).send({ error: 'Kế toán không được phép xóa khách hàng.' });
      }
      const { ids } = request.body as { ids: string[] };

      if (!Array.isArray(ids) || ids.length === 0) {
        return reply.status(400).send({ error: 'ids must be a non-empty array' });
      }

      // 1. Unlink conversations first to prevent FK constraint errors
      await prisma.conversation.updateMany({
        where: { contactId: { in: ids }, orgId: user.orgId },
        data: { contactId: null },
      });

      // 2. Delete contacts (appointments and orders cascade delete automatically)
      const res = await prisma.contact.deleteMany({
        where: { id: { in: ids }, orgId: user.orgId },
      });

      return { success: true, count: res.count };
    } catch (err) {
      logger.error('[contacts] Bulk delete error:', err);
      return reply.status(500).send({ error: 'Failed to bulk delete contacts' });
    }
  };

  app.delete('/api/v1/contacts/bulk', handleBulkDelete);
  app.post('/api/v1/contacts/bulk-delete', handleBulkDelete);

  // ── DELETE /api/v1/contacts/:id ───────────────────────────────────────────
  app.delete('/api/v1/contacts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (user.role === 'accountant') {
        return reply.status(403).send({ error: 'Kế toán không được phép xóa khách hàng.' });
      }
      const { id } = request.params as { id: string };

      const existing = await prisma.contact.findFirst({ where: { id, orgId: user.orgId }, select: { id: true } });
      if (!existing) return reply.status(404).send({ error: 'Contact not found' });

      // Unlink conversations first
      await prisma.conversation.updateMany({
        where: { contactId: id, orgId: user.orgId },
        data: { contactId: null },
      });

      await prisma.contact.delete({ where: { id } });
      return { success: true };
    } catch (err) {
      logger.error('[contacts] Delete error:', err);
      return reply.status(500).send({ error: 'Failed to delete contact' });
    }
  });

  // ── POST /api/v1/contacts/auto-relink — Scan and repair unlinked conversations ──
  app.post('/api/v1/contacts/auto-relink', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const contacts = await prisma.contact.findMany({
        where: { orgId: user.orgId, zaloUid: { not: null } },
        select: { id: true, zaloUid: true, fullName: true },
      });

      let totalRelinked = 0;
      for (const contact of contacts) {
        if (!contact.zaloUid) continue;
        const res = await prisma.conversation.updateMany({
          where: {
            orgId: user.orgId,
            externalThreadId: contact.zaloUid,
            contactId: null,
          },
          data: { contactId: contact.id },
        });
        totalRelinked += res.count;
      }

      logger.info(`[contacts] Auto-relink completed: ${totalRelinked} conversations reconnected.`);
      return { success: true, reconnected: totalRelinked };
    } catch (err) {
      logger.error('[contacts] Auto-relink error:', err);
      return reply.status(500).send({ error: 'Failed to auto-relink conversations' });
    }
  });
}
