/**
 * User management routes — CRUD for users within an org.
 * All routes require authentication via authMiddleware.
 * Role-based access: owner > admin > member.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from './auth-middleware.js';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { logger } from '../../shared/utils/logger.js';

export async function userRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/users — list all users in org
  app.get('/api/v1/users', async (request: FastifyRequest) => {
    const user = request.user!;
    const users = await prisma.user.findMany({
      where: { orgId: user.orgId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        teamId: true,
        createdAt: true,
        team: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return { users };
  });

  // POST /api/v1/users — create user (owner/admin only)
  app.post('/api/v1/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    if (!['owner', 'admin'].includes(currentUser.role)) {
      return reply.status(403).send({ error: 'Không có quyền' });
    }

    const { email, fullName, password, role = 'member', teamId } = request.body as any;
    if (!email || !fullName || !password) {
      return reply.status(400).send({ error: 'Email, họ tên, mật khẩu là bắt buộc' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) return reply.status(400).send({ error: 'Email đã tồn tại' });

    if (role === 'owner') return reply.status(400).send({ error: 'Không thể tạo thêm owner' });
    if (role === 'admin' && currentUser.role !== 'owner') {
      return reply.status(403).send({ error: 'Chỉ owner có thể tạo admin' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        orgId: currentUser.orgId,
        email: normalizedEmail,
        fullName,
        passwordHash,
        role,
        teamId: teamId || null,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    logger.info(`User created: ${user.email} by ${currentUser.email}`);
    return user;
  });

  // PUT /api/v1/users/:id — update user info
  app.put('/api/v1/users/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    const { id } = request.params as { id: string };

    // Member can only edit themselves
    if (!['owner', 'admin'].includes(currentUser.role) && currentUser.id !== id) {
      return reply.status(403).send({ error: 'Không có quyền' });
    }

    // Get target user to check their role
    const targetUser = await prisma.user.findUnique({ where: { id, orgId: currentUser.orgId } });
    if (!targetUser) return reply.status(404).send({ error: 'Không tìm thấy người dùng' });

    // Admin cannot edit owner or other admin accounts
    if (currentUser.role === 'admin' && id !== currentUser.id) {
      if (targetUser.role === 'owner' || targetUser.role === 'admin') {
        return reply.status(403).send({ error: 'Admin không có quyền chỉnh sửa tài khoản Owner hoặc Admin khác' });
      }
    }

    const { fullName, email, role, teamId, isActive } = request.body as any;

    if (id === currentUser.id && role && role !== currentUser.role) {
      return reply.status(400).send({ error: 'Không thể thay đổi role của chính mình' });
    }

    // Prevent changing owner's role
    if (targetUser.role === 'owner' && role && role !== 'owner') {
      return reply.status(403).send({ error: 'Không thể thay đổi role của Owner' });
    }

    const updateData: any = {};
    if (fullName !== undefined) updateData.fullName = fullName;
    if (email !== undefined) {
      const normalizedEmail = email.toLowerCase().trim();
      const existing = await prisma.user.findFirst({
        where: {
          email: normalizedEmail,
          NOT: { id }
        }
      });
      if (existing) return reply.status(400).send({ error: 'Email đã tồn tại' });
      updateData.email = normalizedEmail;
    }
    if (role !== undefined && currentUser.role === 'owner') updateData.role = role;
    if (teamId !== undefined) updateData.teamId = teamId || null;
    if (isActive !== undefined && currentUser.role === 'owner') updateData.isActive = isActive;

    const user = await prisma.user.update({
      where: { id, orgId: currentUser.orgId },
      data: updateData,
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        teamId: true,
      },
    });

    return user;
  });

  // PUT /api/v1/users/:id/password — reset password
  app.put('/api/v1/users/:id/password', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    const { id } = request.params as { id: string };
    const { password } = request.body as { password: string };

    if (!password || password.length < 6) {
      return reply.status(400).send({ error: 'Mật khẩu tối thiểu 6 ký tự' });
    }

    // User can always change their own password
    if (currentUser.id === id) {
      const passwordHash = await bcrypt.hash(password, 10);
      await prisma.user.update({ where: { id, orgId: currentUser.orgId }, data: { passwordHash } });
      return { success: true };
    }

    // Only owner/admin can change others' passwords
    if (!['owner', 'admin'].includes(currentUser.role)) {
      return reply.status(403).send({ error: 'Không có quyền' });
    }

    // Get target user
    const targetUser = await prisma.user.findUnique({ where: { id, orgId: currentUser.orgId } });
    if (!targetUser) return reply.status(404).send({ error: 'Không tìm thấy người dùng' });

    // Admin can only change passwords of members (not owner, not other admins)
    if (currentUser.role === 'admin') {
      if (targetUser.role === 'owner') {
        return reply.status(403).send({ error: 'Admin không có quyền đổi mật khẩu của Owner' });
      }
      if (targetUser.role === 'admin') {
        return reply.status(403).send({ error: 'Admin không có quyền đổi mật khẩu của Admin khác' });
      }
    }

    // Owner cannot have their password changed by anyone except themselves (handled above)
    if (targetUser.role === 'owner') {
      return reply.status(403).send({ error: 'Không thể đổi mật khẩu của Owner' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id, orgId: currentUser.orgId },
      data: { passwordHash },
    });

    logger.info(`Password reset for ${targetUser.email} by ${currentUser.email} (${currentUser.role})`);
    return { success: true };
  });


  // DELETE /api/v1/users/:id — deactivate user (owner only)
  app.delete('/api/v1/users/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    if (currentUser.role !== 'owner') {
      return reply.status(403).send({ error: 'Chỉ owner có quyền xóa nhân viên' });
    }

    const { id } = request.params as { id: string };
    if (id === currentUser.id) {
      return reply.status(400).send({ error: 'Không thể xóa chính mình' });
    }

    await prisma.user.update({
      where: { id, orgId: currentUser.orgId },
      data: { isActive: false },
    });

    return { success: true };
  });
}
