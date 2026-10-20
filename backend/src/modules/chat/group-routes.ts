/**
 * group-routes.ts — REST API for Advanced Zalo Group Management.
 * Supports detailed group info, member add/remove, deputy promotion/demotion,
 * group settings, invite links, and pending member approval.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireZaloAccess } from '../zalo/zalo-access-middleware.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { logger } from '../../shared/utils/logger.js';
import type { Server } from 'socket.io';

export async function groupRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  /** Helper to load conversation and verify Zalo instance */
  async function getGroupContext(conversationId: string, orgId: string) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, orgId },
      include: { zaloAccount: true, contact: true },
    });

    if (!conversation) {
      throw { statusCode: 404, message: 'Cuộc trò chuyện không tồn tại' };
    }

    if (conversation.threadType !== 'group') {
      throw { statusCode: 400, message: 'Cuộc trò chuyện này không phải là nhóm chat' };
    }

    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    if (!instance?.api) {
      throw { statusCode: 400, message: 'Tài khoản Zalo quản lý nhóm chưa được kết nối' };
    }

    const threadId = conversation.externalThreadId;
    if (!threadId) {
      throw { statusCode: 400, message: 'Không tìm thấy ID nhóm Zalo (externalThreadId)' };
    }

    return { conversation, instance, threadId };
  }

  // ── 1. GET /api/v1/conversations/:id/group/info ───────────────────────────
  app.get('/api/v1/conversations/:id/group/info', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    try {
      const { conversation, instance, threadId } = await getGroupContext(id, user.orgId);

      // Fetch group info from Zalo
      const res = await instance.api.getGroupInfo(threadId);
      const info = res?.gridInfoMap?.[threadId];
      if (!info) {
        return reply.status(404).send({ error: 'Không thể lấy thông tin nhóm từ Zalo' });
      }

      // Fetch group link detail (if accessible)
      let linkDetail: any = null;
      try {
        linkDetail = await instance.api.getGroupLinkDetail(threadId);
      } catch (err: any) {
        logger.warn(`[group-routes] getGroupLinkDetail error for ${threadId}:`, err?.message || err);
      }

      const myUid = conversation.zaloAccount?.zaloUid || '';

      return {
        groupInfo: info,
        linkDetail,
        myUid,
        conversationId: id,
        groupName: conversation.contact?.fullName || info.name,
      };
    } catch (err: any) {
      logger.error('[group-routes] Get group info error:', err?.message || err);
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Lỗi khi tải thông tin nhóm' });
    }
  });

  // ── 2. POST /api/v1/conversations/:id/group/name ──────────────────────────
  app.post('/api/v1/conversations/:id/group/name', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const { name } = request.body as { name: string };

    if (!name?.trim()) {
      return reply.status(400).send({ error: 'Tên nhóm không được để trống' });
    }

    try {
      const { conversation, instance, threadId } = await getGroupContext(id, user.orgId);
      const newName = name.trim();

      await instance.api.changeGroupName(newName, threadId);

      // Update local contact record representing this group
      if (conversation.contactId) {
        await prisma.contact.update({
          where: { id: conversation.contactId },
          data: { fullName: newName },
        });
      }

      const io = (app as any).io as Server;
      io?.emit('chat:conversation-updated', { conversationId: id, groupName: newName });

      return { success: true, name: newName };
    } catch (err: any) {
      logger.error('[group-routes] Change group name error:', err?.message || err);
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Đổi tên nhóm thất bại' });
    }
  });

  // ── 3. POST /api/v1/conversations/:id/group/members/add ───────────────────
  app.post('/api/v1/conversations/:id/group/members/add', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const { memberIds } = request.body as { memberIds: string[] };

    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return reply.status(400).send({ error: 'Danh sách thành viên cần thêm không hợp lệ' });
    }

    try {
      const { instance, threadId } = await getGroupContext(id, user.orgId);
      const res = await instance.api.addUserToGroup(memberIds, threadId);
      return { success: true, result: res };
    } catch (err: any) {
      logger.error('[group-routes] Add user to group error:', err?.message || err);
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Thêm thành viên thất bại' });
    }
  });

  // ── 4. POST /api/v1/conversations/:id/group/members/remove ────────────────
  app.post('/api/v1/conversations/:id/group/members/remove', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const { memberId } = request.body as { memberId: string };

    if (!memberId) {
      return reply.status(400).send({ error: 'memberId là bắt buộc' });
    }

    try {
      const { instance, threadId } = await getGroupContext(id, user.orgId);
      const res = await instance.api.removeUserFromGroup(memberId, threadId);
      return { success: true, result: res };
    } catch (err: any) {
      logger.error('[group-routes] Remove user from group error:', err?.message || err);
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Mời thành viên rời nhóm thất bại' });
    }
  });

  // ── 5. POST /api/v1/conversations/:id/group/deputy/add ────────────────────
  app.post('/api/v1/conversations/:id/group/deputy/add', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const { memberId } = request.body as { memberId: string };

    if (!memberId) {
      return reply.status(400).send({ error: 'memberId là bắt buộc' });
    }

    try {
      const { instance, threadId } = await getGroupContext(id, user.orgId);
      await instance.api.addGroupDeputy(memberId, threadId);
      return { success: true };
    } catch (err: any) {
      logger.error('[group-routes] Add group deputy error:', err?.message || err);
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Bổ nhiệm phó nhóm thất bại' });
    }
  });

  // ── 6. POST /api/v1/conversations/:id/group/deputy/remove ─────────────────
  app.post('/api/v1/conversations/:id/group/deputy/remove', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const { memberId } = request.body as { memberId: string };

    if (!memberId) {
      return reply.status(400).send({ error: 'memberId là bắt buộc' });
    }

    try {
      const { instance, threadId } = await getGroupContext(id, user.orgId);
      await instance.api.removeGroupDeputy(memberId, threadId);
      return { success: true };
    } catch (err: any) {
      logger.error('[group-routes] Remove group deputy error:', err?.message || err);
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Hủy quyền phó nhóm thất bại' });
    }
  });

  // ── 7. POST /api/v1/conversations/:id/group/owner ─────────────────────────
  app.post('/api/v1/conversations/:id/group/owner', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const { memberId } = request.body as { memberId: string };

    if (!memberId) {
      return reply.status(400).send({ error: 'memberId là bắt buộc' });
    }

    try {
      const { instance, threadId } = await getGroupContext(id, user.orgId);
      const res = await instance.api.changeGroupOwner(memberId, threadId);
      return { success: true, result: res };
    } catch (err: any) {
      logger.error('[group-routes] Change group owner error:', err?.message || err);
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Chuyển quyền trưởng nhóm thất bại' });
    }
  });

  // ── 8. POST /api/v1/conversations/:id/group/settings ──────────────────────
  app.post('/api/v1/conversations/:id/group/settings', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const { settings } = request.body as { settings: any };

    if (!settings || typeof settings !== 'object') {
      return reply.status(400).send({ error: 'Cài đặt nhóm không hợp lệ' });
    }

    try {
      const { instance, threadId } = await getGroupContext(id, user.orgId);
      await instance.api.updateGroupSettings(settings, threadId);
      return { success: true };
    } catch (err: any) {
      logger.error('[group-routes] Update group settings error:', err?.message || err);
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Cập nhật cài đặt nhóm thất bại' });
    }
  });

  // ── 9. POST /api/v1/conversations/:id/group/link/toggle ───────────────────
  app.post('/api/v1/conversations/:id/group/link/toggle', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const { enable } = request.body as { enable: boolean };

    try {
      const { instance, threadId } = await getGroupContext(id, user.orgId);

      if (enable) {
        await instance.api.enableGroupLink(threadId);
      } else {
        await instance.api.disableGroupLink(threadId);
      }

      // Re-fetch link detail
      const detail = await instance.api.getGroupLinkDetail(threadId);
      return { success: true, linkDetail: detail };
    } catch (err: any) {
      logger.error('[group-routes] Toggle group link error:', err?.message || err);
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Thao tác liên kết nhóm thất bại' });
    }
  });

  // ── 10. GET /api/v1/conversations/:id/group/pending-members ───────────────
  app.get('/api/v1/conversations/:id/group/pending-members', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    try {
      const { instance, threadId } = await getGroupContext(id, user.orgId);
      const res = await instance.api.getPendingGroupMembers(threadId);
      return res || { users: [] };
    } catch (err: any) {
      logger.error('[group-routes] Get pending group members error:', err?.message || err);
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Không thể lấy danh sách chờ duyệt' });
    }
  });

  // ── 11. POST /api/v1/conversations/:id/group/pending-members/review ───────
  app.post('/api/v1/conversations/:id/group/pending-members/review', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const { memberIds, isApprove } = request.body as { memberIds: string[]; isApprove: boolean };

    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return reply.status(400).send({ error: 'Danh sách thành viên duyệt không hợp lệ' });
    }

    try {
      const { instance, threadId } = await getGroupContext(id, user.orgId);
      const res = await instance.api.reviewPendingMemberRequest(
        { members: memberIds, isApprove: !!isApprove },
        threadId
      );
      return { success: true, result: res };
    } catch (err: any) {
      logger.error('[group-routes] Review pending members error:', err?.message || err);
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Xử lý duyệt thành viên thất bại' });
    }
  });

  // ── 12. POST /api/v1/conversations/:id/group/leave ────────────────────────
  app.post('/api/v1/conversations/:id/group/leave', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    try {
      const { instance, threadId } = await getGroupContext(id, user.orgId);
      await instance.api.leaveGroup(threadId);
      return { success: true };
    } catch (err: any) {
      logger.error('[group-routes] Leave group error:', err?.message || err);
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Rời nhóm thất bại' });
    }
  });

  // ── 13. GET /api/v1/conversations/:id/group/board ─────────────────────────
  app.get('/api/v1/conversations/:id/group/board', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const { page, count } = request.query as { page?: string; count?: string };

    try {
      const { instance, threadId } = await getGroupContext(id, user.orgId);
      const res = await instance.api.getListBoard(
        { page: Number(page) || 1, count: Number(count) || 20 },
        threadId
      );
      return { success: true, board: res };
    } catch (err: any) {
      logger.error('[group-routes] Get list board error:', err?.message || err);
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Không thể lấy bảng tin nhóm' });
    }
  });

  // ── 14. POST /api/v1/conversations/:id/group/notes ────────────────────────
  app.post('/api/v1/conversations/:id/group/notes', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const { title, pinAct } = request.body as { title: string; pinAct?: boolean };

    if (!title || !title.trim()) {
      return reply.status(400).send({ error: 'Nội dung ghi chú không được để trống' });
    }

    try {
      const { instance, threadId } = await getGroupContext(id, user.orgId);
      const res = await instance.api.createNote(
        { title: title.trim(), pinAct: pinAct ?? true },
        threadId
      );
      return { success: true, note: res };
    } catch (err: any) {
      logger.error('[group-routes] Create note error:', err?.message || err);
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Tạo ghi chú nhóm thất bại' });
    }
  });

  // ── 15. PUT /api/v1/conversations/:id/group/notes/:topicId ─────────────────
  app.put('/api/v1/conversations/:id/group/notes/:topicId', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, topicId } = request.params as { id: string; topicId: string };
    const user = request.user!;
    const { title, pinAct } = request.body as { title: string; pinAct?: boolean };

    if (!title || !title.trim()) {
      return reply.status(400).send({ error: 'Nội dung ghi chú không được để trống' });
    }

    try {
      const { instance, threadId } = await getGroupContext(id, user.orgId);
      const res = await instance.api.editNote(
        { title: title.trim(), topicId, pinAct: !!pinAct },
        threadId
      );
      return { success: true, note: res };
    } catch (err: any) {
      logger.error('[group-routes] Edit note error:', err?.message || err);
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Chỉnh sửa ghi chú thất bại' });
    }
  });

  // ── 16. POST /api/v1/conversations/:id/group/polls ────────────────────────
  app.post('/api/v1/conversations/:id/group/polls', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const {
      question,
      options,
      expiredTime,
      allowMultiChoices,
      allowAddNewOption,
      hideVotePreview,
      isAnonymous,
    } = request.body as {
      question: string;
      options: string[];
      expiredTime?: number;
      allowMultiChoices?: boolean;
      allowAddNewOption?: boolean;
      hideVotePreview?: boolean;
      isAnonymous?: boolean;
    };

    if (!question || !question.trim()) {
      return reply.status(400).send({ error: 'Câu hỏi bình chọn không được để trống' });
    }
    const cleanOptions = (options || []).map(o => (typeof o === 'string' ? o.trim() : '')).filter(Boolean);
    if (cleanOptions.length < 2) {
      return reply.status(400).send({ error: 'Cần ít nhất 2 phương án bình chọn' });
    }

    try {
      const { instance, threadId } = await getGroupContext(id, user.orgId);
      const res = await instance.api.createPoll(
        {
          question: question.trim(),
          options: cleanOptions,
          expiredTime: expiredTime || 0,
          allowMultiChoices: !!allowMultiChoices,
          allowAddNewOption: !!allowAddNewOption,
          hideVotePreview: !!hideVotePreview,
          isAnonymous: !!isAnonymous,
        },
        threadId
      );
      return { success: true, poll: res };
    } catch (err: any) {
      logger.error('[group-routes] Create poll error:', err?.message || err);
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Tạo bình chọn thất bại' });
    }
  });

  // ── 17. GET /api/v1/conversations/:id/group/polls/:pollId ──────────────────
  app.get('/api/v1/conversations/:id/group/polls/:pollId', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, pollId } = request.params as { id: string; pollId: string };
    const user = request.user!;

    try {
      const { instance } = await getGroupContext(id, user.orgId);
      const res = await instance.api.getPollDetail(Number(pollId));
      return { success: true, poll: res };
    } catch (err: any) {
      logger.error('[group-routes] Get poll detail error:', err?.message || err);
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Không thể lấy chi tiết bình chọn' });
    }
  });

  // ── 18. POST /api/v1/conversations/:id/group/polls/:pollId/vote ────────────
  app.post('/api/v1/conversations/:id/group/polls/:pollId/vote', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, pollId } = request.params as { id: string; pollId: string };
    const user = request.user!;
    const { optionId } = request.body as { optionId: number | number[] };

    if (optionId === undefined || optionId === null) {
      return reply.status(400).send({ error: 'Phương án bình chọn không hợp lệ' });
    }

    try {
      const { instance } = await getGroupContext(id, user.orgId);
      const res = await instance.api.votePoll(Number(pollId), optionId);
      return { success: true, result: res };
    } catch (err: any) {
      logger.error('[group-routes] Vote poll error:', err?.message || err);
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Bỏ phiếu thất bại' });
    }
  });

  // ── 19. POST /api/v1/conversations/:id/group/polls/:pollId/lock ────────────
  app.post('/api/v1/conversations/:id/group/polls/:pollId/lock', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, pollId } = request.params as { id: string; pollId: string };
    const user = request.user!;

    try {
      const { instance } = await getGroupContext(id, user.orgId);
      await instance.api.lockPoll(Number(pollId));
      return { success: true };
    } catch (err: any) {
      logger.error('[group-routes] Lock poll error:', err?.message || err);
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Khóa bình chọn thất bại' });
    }
  });

  // ── 20. POST /api/v1/conversations/:id/group/polls/:pollId/options ─────────
  app.post('/api/v1/conversations/:id/group/polls/:pollId/options', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, pollId } = request.params as { id: string; pollId: string };
    const user = request.user!;
    const { options, votedOptionIds } = request.body as {
      options: { voted: boolean; content: string }[];
      votedOptionIds?: number[];
    };

    if (!Array.isArray(options) || options.length === 0) {
      return reply.status(400).send({ error: 'Danh sách phương án mới không hợp lệ' });
    }

    try {
      const { instance } = await getGroupContext(id, user.orgId);
      const res = await instance.api.addPollOptions({
        pollId: Number(pollId),
        options,
        votedOptionIds: votedOptionIds || [],
      });
      return { success: true, result: res };
    } catch (err: any) {
      logger.error('[group-routes] Add poll options error:', err?.message || err);
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Thêm phương án thất bại' });
    }
  });
}
