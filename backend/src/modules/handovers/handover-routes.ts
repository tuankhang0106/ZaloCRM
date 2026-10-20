import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';

const PREFIX = 'shift_handover:';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown, max = 3000) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const parse = (row: { valuePlain: string | null } | null) => row?.valuePlain ? JSON.parse(row.valuePlain) : null;
type Task = { id: string; title: string; dueAt: string | null; urgent: boolean; done: boolean };
type Fields = { requirement: string; agreements: string; workDone: string; waitingOn: string; important: string; tasks: Task[] };
export function normalizeHandover(body: any): Fields {
  if (!body || typeof body !== 'object') throw new Error('Nội dung bàn giao không hợp lệ');
  if (!Array.isArray(body.tasks) || body.tasks.length > 30) throw new Error('Tối đa 30 việc cần làm');
  const ids = new Set<string>();
  const tasks = body.tasks.map((task: any) => {
    if (!task || !uuid.test(task.id) || ids.has(task.id)) throw new Error('Mã công việc không hợp lệ hoặc trùng');
    ids.add(task.id);
    if (!text(task.title, 300)) throw new Error('Vui lòng nhập nội dung việc cần làm');
    if (task.dueAt && (typeof task.dueAt !== 'string' || !Number.isFinite(Date.parse(task.dueAt)))) throw new Error('Thời hạn không hợp lệ');
    return { id: task.id, title: text(task.title, 300), dueAt: task.dueAt ? new Date(task.dueAt).toISOString() : null, urgent: task.urgent === true, done: false };
  });
  return { requirement: text(body.requirement), agreements: text(body.agreements), workDone: text(body.workDone), waitingOn: text(body.waitingOn), important: text(body.important), tasks };
}

export async function handoverRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);
  async function access(request: FastifyRequest, reply: FastifyReply, write = false) {
    const user = request.user;
    if (!['owner', 'admin', 'member'].includes(user.role)) { reply.code(403).send({ error: 'Không có quyền bàn giao ca' }); return null; }
    const { id } = request.params as { id: string };
    const conv = await prisma.conversation.findFirst({ where: { id, orgId: user.orgId }, include: { contact: true, zaloAccount: { select: { displayName: true } } } });
    if (!conv) { reply.code(404).send({ error: 'Không tìm thấy hội thoại' }); return null; }
    if (user.role === 'member') {
      const permission = await prisma.zaloAccountAccess.findFirst({ where: { zaloAccountId: conv.zaloAccountId, userId: user.id } });
      if (!permission || (write && !['chat', 'admin'].includes(permission.permission))) { reply.code(403).send({ error: 'Không đủ quyền trên tài khoản Zalo này' }); return null; }
    }
    return conv;
  }
  async function recipients(orgId: string, zaloAccountId: string) {
    return prisma.user.findMany({ where: { orgId, isActive: true, OR: [
      { role: { in: ['owner', 'admin'] } },
      { role: 'member', zaloAccess: { some: { zaloAccountId, permission: { in: ['chat', 'admin'] } } } },
    ] }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } });
  }
  async function records(orgId: string, conversationId: string) {
    const rows = await prisma.appSetting.findMany({ where: { orgId, settingKey: { startsWith: `${PREFIX}${conversationId}:` } }, orderBy: { createdAt: 'desc' } });
    return rows.map(parse).filter(Boolean);
  }
  async function newCount(conversationId: string, at: string) {
    return prisma.message.count({ where: { conversationId, isDeleted: false, createdAt: { gt: new Date(at) } } });
  }
  async function context(conv: any) {
    const [appointments, needRows, recentMessages] = await Promise.all([
      conv.contactId ? prisma.appointment.findMany({ where: { orgId: conv.orgId, contactId: conv.contactId, status: 'scheduled' }, orderBy: { appointmentDate: 'asc' }, take: 10, select: { id: true, appointmentDate: true, appointmentTime: true, type: true, notes: true } }) : [],
      prisma.appSetting.findMany({ where: { orgId: conv.orgId, settingKey: { startsWith: `customer_need:${conv.id}:` } }, orderBy: { createdAt: 'desc' }, take: 10 }),
      prisma.message.findMany({ where: { conversationId: conv.id, isDeleted: false }, orderBy: [{ sentAt: 'desc' }, { id: 'desc' }], take: 8, select: { id: true, sentAt: true, contentType: true, content: true, senderType: true, senderName: true } }),
    ]);
    return {
      capturedAt: new Date().toISOString(), customerName: conv.contact?.fullName || 'Khách hàng', phone: conv.contact?.phone || '',
      status: conv.contact?.status || '', notes: conv.contact?.notes || '', zaloName: conv.zaloAccount?.displayName || 'Zalo',
      appointments, needs: needRows.map(parse).filter(Boolean).map((n: any) => ({ id: n.id, code: n.code, requirement: n.requirement, totalAmount: n.totalAmount, depositAmount: n.depositAmount, depositStatus: n.depositStatus, status: n.status, deliveryDate: n.deliveryDate })),
      recentMessages: recentMessages.reverse().map(m => ({ ...m, content: m.contentType === 'text' ? (m.content || '').slice(0, 500) : null })),
    };
  }
  app.get('/api/v1/conversations/:id/shift-handovers', async (request, reply) => {
    const conv = await access(request, reply); if (!conv) return;
    const [all, snapshot, people] = await Promise.all([records(request.user.orgId, conv.id), context(conv), recipients(request.user.orgId, conv.zaloAccountId)]);
    const handovers = all.filter((h: any) => h.status !== 'draft' || h.authorId === request.user.id);
    for (const h of handovers) {
      h.forwardedTo = handovers.find((n: any) => n.status !== 'draft' && n.carriedFromId === h.id)?.id || h.forwardedTo || null;
      if (h.publishedAt) h.newMessageCount = await newCount(conv.id, h.publishedAt);
    }
    return { snapshot, recipients: people.filter(p => p.id !== request.user.id), handovers };
  });
  app.post('/api/v1/conversations/:id/shift-handovers', async (request, reply) => {
    const conv = await access(request, reply, true); if (!conv) return;
    const body = request.body as any;
    if (!uuid.test(body?.id || '') || !['draft', 'publish'].includes(body?.intent)) return reply.code(400).send({ error: 'Mã hoặc thao tác không hợp lệ' });
    let fields; try { fields = normalizeHandover(body); } catch (err) { return reply.code(400).send({ error: (err as Error).message }); }
    const publish = body.intent === 'publish';
    if (publish && (!fields.requirement || !fields.workDone || !fields.tasks.length)) return reply.code(400).send({ error: 'Bàn giao cần nhu cầu, việc đã làm và ít nhất một việc cho ca sau' });
    const orgId = request.user.orgId, settingKey = `${PREFIX}${conv.id}:${body.id}`;
    const existing = await prisma.appSetting.findUnique({ where: { orgId_settingKey: { orgId, settingKey } } });
    const prev = parse(existing);
    if (prev && prev.authorId !== request.user.id) return reply.code(403).send({ error: 'Chỉ tác giả được sửa bản nháp' });
    // The published payload is immutable; retries return the already-published record.
    if (prev && prev.status !== 'draft') return { handover: prev, message: 'Bản bàn giao đã gửi, không thay đổi nội dung' };
    if ((prev?.version || 0) !== body.version) return reply.code(409).send({ error: 'Phiếu đã thay đổi ở nơi khác. Hãy tải lại trước khi lưu.' });
    const people = await recipients(orgId, conv.zaloAccountId);
    const recipient = people.find(p => p.id === body.recipientId && p.id !== request.user.id);
    if (publish && !recipient) return reply.code(400).send({ error: 'Chọn người ca sau có quyền xử lý hội thoại này' });
    let carryRow: any = null;
    if (publish && body.carriedFromId) {
      const earlier = await records(orgId, conv.id);
      const previous = earlier.find((h: any) => h.id === body.carriedFromId);
      if (!previous || previous.recipientId !== request.user.id || !previous.acceptedAt) return reply.code(403).send({ error: 'Chỉ người đã nhận ca được chuyển tiếp việc còn lại' });
      carryRow = await prisma.appSetting.findUnique({ where: { orgId_settingKey: { orgId, settingKey: `${PREFIX}${conv.id}:${previous.id}` } } });
      if (previous.forwardedTo || earlier.some((h: any) => h.status !== 'draft' && h.carriedFromId === previous.id)) return reply.code(409).send({ error: 'Việc đã được chuyển sang bản tiếp theo. Hãy tải lại.' });
    }
    const author = await prisma.user.findUnique({ where: { id: request.user.id }, select: { fullName: true } });
    const now = new Date().toISOString();
    const handover = { ...fields, id: body.id, orgId, conversationId: conv.id, zaloAccountId: conv.zaloAccountId,
      authorId: request.user.id, authorName: author?.fullName || request.user.email,
      recipientId: recipient?.id || '', recipientName: recipient?.fullName || '',
      status: publish ? 'published' : 'draft', version: (prev?.version || 0) + 1, createdAt: prev?.createdAt || now, updatedAt: now,
      publishedAt: publish ? now : null, acceptedAt: null, acceptedBy: null,
      snapshot: await context(conv), carriedFromId: text(body.carriedFromId, 36),
      events: [...(prev?.events || []), { type: publish ? 'published' : 'draft_saved', userId: request.user.id, userName: author?.fullName, at: now }],
    };
    try {
      await prisma.$transaction(async tx => {
        if (carryRow) {
          const prior = parse(carryRow);
          prior.forwardedTo = handover.id; prior.version++; prior.updatedAt = now;
          prior.events.push({ type: 'forwarded', userId: request.user.id, userName: author?.fullName, at: now });
          const changed = await tx.appSetting.updateMany({ where: { id: carryRow.id, valuePlain: carryRow.valuePlain }, data: { valuePlain: JSON.stringify(prior) } });
          if (!changed.count) throw Object.assign(new Error('Bản bàn giao trước vừa thay đổi. Hãy tải lại.'), { code: 'HANDOVER_CONFLICT' });
        }
        if (existing) {
          const changed = await tx.appSetting.updateMany({ where: { id: existing.id, valuePlain: existing.valuePlain }, data: { valuePlain: JSON.stringify(handover) } });
          if (!changed.count) throw Object.assign(new Error('Phiếu vừa được cập nhật. Hãy tải lại.'), { code: 'HANDOVER_CONFLICT' });
        } else {
          await tx.appSetting.create({ data: { orgId, settingKey, valuePlain: JSON.stringify(handover) } });
        }
      });
    } catch (err: any) {
      if (['P2002', 'HANDOVER_CONFLICT'].includes(err.code)) return reply.code(409).send({ error: 'Phiếu đã thay đổi hoặc được lưu đồng thời. Hãy tải lại.' });
      throw err;
    }
    return { handover, message: publish ? 'Đã bàn giao. Người ca sau xem tại Bàn giao ca.' : 'Đã lưu nháp riêng cho bạn' };
  });
  async function mutate(request: FastifyRequest, reply: FastifyReply, accept: boolean) {
    const conv = await access(request, reply, true); if (!conv) return;
    const { handoverId } = request.params as { handoverId: string };
    const orgId = request.user.orgId, settingKey = `${PREFIX}${conv.id}:${handoverId}`;
    const row = await prisma.appSetting.findUnique({ where: { orgId_settingKey: { orgId, settingKey } } });
    const h = parse(row);
    if (!h || !row || h.status === 'draft') return reply.code(404).send({ error: 'Không tìm thấy bản bàn giao' });
    if (h.recipientId !== request.user.id) return reply.code(403).send({ error: 'Chỉ người được bàn giao được xác nhận và cập nhật việc' });
    if (h.forwardedTo || (await records(orgId, conv.id)).some((n: any) => n.status !== 'draft' && n.carriedFromId === h.id)) return reply.code(409).send({ error: 'Việc đã được bàn giao tiếp. Hãy cập nhật ở bản mới.' });
    const body = (request.body || {}) as any;
    if (accept && h.acceptedAt) return { handover: h };
    if (body.version !== h.version) return reply.code(409).send({ error: 'Bản bàn giao đã thay đổi. Hãy tải lại.' });
    const now = new Date().toISOString();
    if (accept) { h.acceptedAt = now; h.acceptedBy = request.user.id; h.status = 'accepted'; }
    else {
      if (!h.acceptedAt) return reply.code(400).send({ error: 'Hãy nhận bàn giao trước khi cập nhật việc' });
      const task = h.tasks.find((t: Task) => t.id === body.taskId);
      if (!task || typeof body.done !== 'boolean') return reply.code(400).send({ error: 'Công việc không hợp lệ' });
      task.done = body.done; task.completedAt = body.done ? now : null;
    }
    h.version++; h.updatedAt = now;
    h.events.push({ type: accept ? 'accepted' : 'task_updated', userId: request.user.id, userName: h.recipientName, taskId: accept ? undefined : body.taskId, done: accept ? undefined : body.done, at: now });
    const changed = await prisma.appSetting.updateMany({ where: { id: row.id, valuePlain: row.valuePlain }, data: { valuePlain: JSON.stringify(h) } });
    if (!changed.count) return reply.code(409).send({ error: 'Có cập nhật đồng thời. Hãy tải lại.' });
    return { handover: h };
  }
  app.post('/api/v1/conversations/:id/shift-handovers/:handoverId/accept', (request, reply) => mutate(request, reply, true));
  app.patch('/api/v1/conversations/:id/shift-handovers/:handoverId/tasks', (request, reply) => mutate(request, reply, false));

  app.get('/api/v1/shift-handovers', async (request, reply) => {
    const user = request.user;
    if (!['owner', 'admin', 'member'].includes(user.role)) return reply.code(403).send({ error: 'Không có quyền bàn giao ca' });
    const accountAccess = user.role === 'member' ? await prisma.zaloAccountAccess.findMany({ where: { userId: user.id }, select: { zaloAccountId: true } }) : null;
    const allowed = accountAccess ? new Set(accountAccess.map(a => a.zaloAccountId)) : null;
    const rows = await prisma.appSetting.findMany({ where: { orgId: user.orgId, settingKey: { startsWith: PREFIX } } });
    const all = rows.map(parse).filter((h: any) => h && (!allowed || allowed.has(h.zaloAccountId)) && (h.status !== 'draft' || h.authorId === user.id) && (h.authorId === user.id || h.recipientId === user.id));
    const forwarded = new Map(all.filter((h: any) => h.status !== 'draft' && h.carriedFromId).map((h: any) => [h.carriedFromId, h.id]));
    const inbox = [];
    for (const h of all) {
      h.forwardedTo = forwarded.get(h.id) || h.forwardedTo || null;
      if (h.publishedAt) h.newMessageCount = await newCount(h.conversationId, h.publishedAt);
      inbox.push(h);
    }
    inbox.sort((a, b) => {
      const rank = (h: any) => h.status === 'published' && h.recipientId === user.id ? 0 : !h.forwardedTo && h.tasks.some((t: Task) => !t.done && (t.urgent || (t.dueAt && new Date(t.dueAt) < new Date()))) ? 1 : 2;
      return rank(a) - rank(b) || (b.publishedAt || b.updatedAt).localeCompare(a.publishedAt || a.updatedAt);
    });
    return { handovers: inbox };
  });
}
