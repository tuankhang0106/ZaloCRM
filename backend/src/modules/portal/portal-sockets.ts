import type { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../../shared/database/prisma-client.js';
import { config } from '../../config/index.js';

export function securePortalSockets(io: Server) {
  io.use(async (socket, next) => {
    try {
      const user = jwt.verify(String(socket.handshake.auth?.token || ''), config.jwtSecret) as any;
      if (!user.portal || !user.orgId || !user.id) throw new Error();
      if (!await prisma.user.findFirst({ where: { id: user.id, orgId: user.orgId, isActive: true } })) throw new Error();
      socket.data.user = user;
      const accounts = await prisma.zaloAccount.findMany({ where: { orgId: user.orgId, ...(['owner','admin','accountant'].includes(user.role) ? {} : { access: { some: { userId: user.id } } }) }, select: { id: true } });
      socket.data.accountIds = new Set(accounts.map(account => account.id));
      for (const account of accounts) socket.join(`account:${account.id}`);
      socket.join(`user:${user.id}`);
      const expiry = setTimeout(() => socket.disconnect(true), Math.max(1, user.exp * 1000 - Date.now()));
      socket.on('disconnect', () => clearTimeout(expiry));
      next();
    } catch { next(new Error('Phiên kết nối Zalo hết hạn hoặc không có quyền.')); }
  });
  // Legacy producers emit globally. Route every data event to an authorized room instead.
  const emitToRoom = async (event: string, data: any, rest: any[]) => {
    if (event === 'appointment:reminder' && data?.assignedUserId) { io.to(`user:${data.assignedUserId}`).emit(event, data, ...rest); return; }
    let accountId = data?.accountId;
    if (!accountId && data?.conversationId) {
      accountId = (await prisma.conversation.findUnique({ where: { id: data.conversationId }, select: { zaloAccountId: true } }))?.zaloAccountId;
    }
    if (accountId) io.to(`account:${accountId}`).emit(event, data, ...rest);
  };
  (io as any).emit = (event: string, data: any, ...rest: any[]) => { void emitToRoom(event, data, rest).catch(() => {}); return true; };
  io.on('connection', socket => {
    socket.on('org:join', () => {});
    socket.on('zalo:subscribe', async (data: any) => {
      const user = socket.data.user;
      const allowed = await prisma.zaloAccount.findFirst({ where: { id: data?.accountId, orgId: user.orgId, ...(['owner','admin','accountant'].includes(user.role) ? {} : { access: { some: { userId: user.id } } }) } });
      if (allowed) socket.join(`account:${allowed.id}`);
    });
    socket.on('zalo:unsubscribe', () => {});
  });
}
