/**
 * Zalo account management routes.
 * All endpoints require authentication via authMiddleware.
 */
import type { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireRole } from '../auth/role-middleware.js';
import { zaloPool } from './zalo-pool.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { Prisma } from '@prisma/client';
import { logger } from '../../shared/utils/logger.js';
import { friendRequestStore } from './friend-request-store.js';

export async function zaloRoutes(app: FastifyInstance): Promise<void> {
  // All routes in this plugin require auth
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/zalo-accounts — list accounts with live status from pool
  app.get('/api/v1/zalo-accounts', async (request) => {
    const user = request.user!;
    const accounts = await prisma.zaloAccount.findMany({
      where: { orgId: user.orgId },
      select: {
        id: true,
        zaloUid: true,
        displayName: true,
        avatarUrl: true,
        phone: true,
        status: true,
        lastConnectedAt: true,
        createdAt: true,
        owner: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Merge live status from pool
    return accounts.map((a) => ({
      ...a,
      liveStatus: zaloPool.getStatus(a.id),
    }));
  });

  // POST /api/v1/zalo-accounts — create a new account record
  app.post<{ Body: { displayName?: string } }>(
    '/api/v1/zalo-accounts',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const user = request.user!;
      const { displayName } = request.body ?? {};

      const account = await prisma.zaloAccount.create({
        data: {
          orgId: user.orgId,
          ownerUserId: user.id,
          displayName: displayName ?? null,
          status: 'qr_pending',
        },
      });

      return reply.status(201).send(account);
    },
  );

  // POST /api/v1/zalo-accounts/:id/login — initiate QR login
  app.post<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id/login',
    async (request, reply) => {
      const { id } = request.params;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) {
        return reply.status(404).send({ error: 'Account not found' });
      }

      // Fire-and-forget — QR delivered via Socket.IO
      zaloPool.loginQR(id).catch(() => {
        // errors are emitted via socket; no need to crash here
      });

      return { message: 'QR login initiated — subscribe to account:' + id + ' socket room' };
    },
  );

  // POST /api/v1/zalo-accounts/:id/reconnect — force reconnect using saved session
  app.post<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id/reconnect',
    async (request, reply) => {
      const { id } = request.params;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) {
        return reply.status(404).send({ error: 'Account not found' });
      }

      const session = account.sessionData as {
        cookie: any;
        imei: string;
        userAgent: string;
      } | null;

      if (!session?.imei) {
        return reply.status(400).send({ error: 'No saved session — please login with QR first' });
      }

      // Fire-and-forget — result emitted via Socket.IO
      zaloPool.reconnect(id, session).catch(() => {});

      return { message: 'Reconnect initiated' };
    },
  );

  // POST /api/v1/zalo-accounts/:id/disconnect — disconnect live session and clear credentials, preserve history
  app.post<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id/disconnect',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const { id } = request.params;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) {
        return reply.status(404).send({ error: 'Account not found' });
      }

      zaloPool.disconnect(id);
      await prisma.zaloAccount.update({
        where: { id },
        data: {
          status: 'disconnected',
          sessionData: Prisma.DbNull,
        },
      });

      zaloPool.getIO()?.emit('zalo:disconnected', { accountId: id });
      return { success: true, message: 'Đã ngắt kết nối tài khoản Zalo. Lịch sử chat được giữ nguyên.' };
    },
  );

  // GET /api/v1/zalo-accounts/:id/stats — count conversations and messages
  app.get<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id/stats',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const { id } = request.params;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) {
        return reply.status(404).send({ error: 'Account not found' });
      }

      const conversationCount = await prisma.conversation.count({
        where: { zaloAccountId: id },
      });

      const messageCount = await prisma.message.count({
        where: {
          conversation: {
            zaloAccountId: id,
          },
        },
      });

      return { conversationCount, messageCount };
    },
  );

  // DELETE /api/v1/zalo-accounts/:id — disconnect and delete/deactivate record
  app.delete<{ Params: { id: string }; Querystring: { purge?: string } }>(
    '/api/v1/zalo-accounts/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const { id } = request.params;
      const { purge } = request.query;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) {
        return reply.status(404).send({ error: 'Account not found' });
      }

      zaloPool.disconnect(id);

      if (purge === 'true') {
        // Hard purge: permanently remove account and cascade delete all conversations & messages
        await prisma.zaloAccount.delete({ where: { id } });
        return reply.status(200).send({ message: 'Tài khoản và toàn bộ lịch sử đã bị xóa vĩnh viễn' });
      } else {
        // Safe disconnect / clear session, keep conversation history intact
        await prisma.zaloAccount.update({
          where: { id },
          data: {
            status: 'disconnected',
            sessionData: Prisma.DbNull,
          },
        });
        return reply.status(200).send({ message: 'Tài khoản đã ngắt kết nối an toàn. Toàn bộ lịch sử chat được bảo toàn.' });
      }
    },
  );

  // GET /api/v1/zalo-accounts/:id/status — live status from pool
  app.get<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id/status',
    async (request, reply) => {
      const { id } = request.params;
      const user = request.user!;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true, status: true },
      });
      if (!account) {
        return reply.status(404).send({ error: 'Account not found' });
      }

      return { accountId: id, liveStatus: zaloPool.getStatus(id) };
    },
  );

  // POST /api/v1/zalo/search-phone — search phone number on Zalo
  app.post<{ Body: { phone: string; accountId: string } }>(
    '/api/v1/zalo/search-phone',
    async (request, reply) => {
      const user = request.user!;
      const { phone, accountId } = request.body;

      if (!phone || !accountId) {
        return reply.status(400).send({ error: 'Vui lòng cung cấp số điện thoại và tài khoản Zalo' });
      }

      // Verify account belongs to user org
      const account = await prisma.zaloAccount.findFirst({
        where: { id: accountId, orgId: user.orgId },
      });
      if (!account) {
        return reply.status(404).send({ error: 'Tài khoản Zalo không hợp lệ hoặc không thuộc hệ thống của bạn' });
      }

      const api = zaloPool.getApi(accountId);
      if (!api) {
        return reply.status(400).send({ error: `Tài khoản Zalo "${account.displayName}" đang bị ngắt kết nối` });
      }

      try {
        const result = await api.findUser(phone);
        if (!result || !result.uid) {
          return reply.status(404).send({ error: 'Số điện thoại này chưa đăng ký Zalo hoặc chặn tìm kiếm' });
        }
        return result;
      } catch (err: any) {
        const errMsg = err.message || '';
        if (errMsg.includes('không hợp lệ') || errMsg.includes('216') || errMsg.includes('error')) {
          return reply.status(404).send({ error: 'Số điện thoại này chưa đăng ký Zalo hoặc chặn tìm kiếm' });
        }
        return reply.status(500).send({ error: err.message || 'Lỗi khi tìm kiếm số điện thoại trên Zalo' });
      }
    }
  );

  // GET /api/v1/zalo-accounts/:accountId/friend-requests — fetch recommendations directly from Zalo API
  app.get<{ Params: { accountId: string } }>(
    '/api/v1/zalo-accounts/:accountId/friend-requests',
    async (request, reply) => {
      const user = request.user!;
      const { accountId } = request.params;

      const account = await prisma.zaloAccount.findFirst({ where: { id: accountId, orgId: user.orgId } });
      if (!account) return reply.status(404).send({ error: 'Tài khoản Zalo không hợp lệ' });

      const api = zaloPool.getApi(accountId);
      if (!api) return reply.status(400).send({ error: `Tài khoản Zalo đang bị ngắt kết nối` });

      try {
        const recommendations = await api.getFriendRecommendations();
        const items = recommendations?.recommItems || [];
        const pendingRequests = items
          .filter((item: any) => item.dataInfo?.recommType === 2)
          .map((item: any) => ({
            uid: item.dataInfo.userId,                                          // Zalo UID của người gửi
            displayName: item.dataInfo.displayName || item.dataInfo.zaloName || 'Người dùng Zalo', // Tên hiển thị
            avatar: item.dataInfo.avatar || '',                                 // Link ảnh đại diện
            message: item.dataInfo.recommInfo?.message || '',                  // Lời nhắn kết bạn
          }));
        return { requests: pendingRequests };
      } catch (err: any) {
        logger.error('[zalo] getFriendRecommendations error:', err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi lấy danh sách lời mời từ Zalo' });
      }
    }
  );

  // POST /api/v1/zalo-accounts/:accountId/accept-friend-request — Accept friend request and sync DB
  app.post<{ Params: { accountId: string }; Body: { uid: string; displayName?: string; avatar?: string } }>(
    '/api/v1/zalo-accounts/:accountId/accept-friend-request',
    async (request, reply) => {
      const user = request.user!;
      const { accountId } = request.params;
      const { uid, displayName, avatar } = request.body;

      if (!uid) return reply.status(400).send({ error: 'Thiếu uid' });

      const account = await prisma.zaloAccount.findFirst({ where: { id: accountId, orgId: user.orgId } });
      if (!account) return reply.status(404).send({ error: 'Tài khoản Zalo không hợp lệ' });

      const api = zaloPool.getApi(accountId);
      if (!api) return reply.status(400).send({ error: `Tài khoản Zalo đang bị ngắt kết nối` });

      try {
        await api.acceptFriendRequest(uid);

        // Upsert Contact
        let contact = await prisma.contact.findFirst({ where: { zaloUid: uid, orgId: user.orgId } });
        if (!contact) {
          contact = await prisma.contact.create({
            data: {
              id: crypto.randomUUID(),
              orgId: user.orgId,
              zaloUid: uid,
              fullName: displayName || 'Khách hàng Zalo',
              avatarUrl: avatar || null,
            },
          });
        } else {
          contact = await prisma.contact.update({
            where: { id: contact.id },
            data: {
              fullName: displayName || contact.fullName,
              avatarUrl: avatar || contact.avatarUrl,
            },
          });
        }

        // Upsert Conversation
        let conversation = await prisma.conversation.findFirst({
          where: { zaloAccountId: accountId, externalThreadId: uid },
        });
        if (!conversation) {
          conversation = await prisma.conversation.create({
            data: {
              id: crypto.randomUUID(),
              orgId: user.orgId,
              zaloAccountId: accountId,
              contactId: contact.id,
              threadType: 'user',
              externalThreadId: uid,
              lastMessageAt: new Date(),
              unreadCount: 0,
              isReplied: false,
            },
          });
        }

        logger.info(`[zalo] Accepted friend request from ${uid}, conversationId: ${conversation.id}`);
        // Clean from DB pending store if exists
        await friendRequestStore.remove(accountId, uid);
        return { success: true, conversationId: conversation.id };
      } catch (err: any) {
        logger.error('[zalo] Accept friend request error:', err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi chấp nhận kết bạn' });
      }
    }
  );

  // POST /api/v1/zalo-accounts/:accountId/reject-friend-request — Reject friend request
  app.post<{ Params: { accountId: string }; Body: { uid: string } }>(
    '/api/v1/zalo-accounts/:accountId/reject-friend-request',
    async (request, reply) => {
      const user = request.user!;
      const { accountId } = request.params;
      const { uid } = request.body;

      if (!uid) return reply.status(400).send({ error: 'Thiếu uid' });

      const account = await prisma.zaloAccount.findFirst({ where: { id: accountId, orgId: user.orgId } });
      if (!account) return reply.status(404).send({ error: 'Tài khoản Zalo không hợp lệ' });

      const api = zaloPool.getApi(accountId);
      if (!api) return reply.status(400).send({ error: `Tài khoản Zalo đang bị ngắt kết nối` });

      try {
        await api.rejectFriendRequest(uid);
        // Clean from DB pending store if exists
        await friendRequestStore.remove(accountId, uid);
        return { success: true };
      } catch (err: any) {
        logger.error('[zalo] Reject friend request error:', err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi từ chối kết bạn' });
      }
    }
  );

  // GET /api/v1/zalo/pending-friend-requests/:accountId — list pending incoming friend requests
  app.get<{ Params: { accountId: string } }>(
    '/api/v1/zalo/pending-friend-requests/:accountId',
    async (request, reply) => {
      const user = request.user!;
      const { accountId } = request.params;

      const account = await prisma.zaloAccount.findFirst({ where: { id: accountId, orgId: user.orgId } });
      if (!account) return reply.status(404).send({ error: 'Tài khoản Zalo không hợp lệ' });

      return { requests: await friendRequestStore.get(accountId) };
    }
  );

  // POST /api/v1/zalo/add-friend — send friend request and create contact/conversation
  app.post<{ Body: { uid: string; phone: string; name: string; avatar?: string; message: string; accountId: string; skipAddFriend?: boolean } }>(
    '/api/v1/zalo/add-friend',
    async (request, reply) => {
      const user = request.user!;
      const { uid, phone, name, avatar, message, accountId, skipAddFriend } = request.body;

      if (!uid || !accountId || !name) {
        return reply.status(400).send({ error: 'Thiếu thông tin uid, tên hoặc accountId' });
      }

      // Verify account belongs to user org
      const account = await prisma.zaloAccount.findFirst({
        where: { id: accountId, orgId: user.orgId },
      });
      if (!account) {
        return reply.status(404).send({ error: 'Tài khoản Zalo không hợp lệ' });
      }

      const api = zaloPool.getApi(accountId);
      if (!api) {
        return reply.status(400).send({ error: `Tài khoản Zalo "${account.displayName}" đang bị ngắt kết nối` });
      }

      try {
        // CRITICAL: Zalo uses hashed UIDs per account pair.
        // The UID from findUser(accountA) ≠ UID from findUser(accountB) for same person.
        // We must re-lookup using the SENDING account to get the correct UID.
        let realUid = uid;
        let realName = name;
        let realAvatar = avatar;

        if (phone) {
          // Normalize phone to 84xxx format for Zalo API
          const normalizedPhoneForZalo = phone.startsWith('0') ? '84' + phone.slice(1) : phone;
          try {
            const userInfo = await api.findUser(normalizedPhoneForZalo);
            if (userInfo?.uid) {
              realUid = userInfo.uid;
              realName = userInfo.display_name || userInfo.zalo_name || name;
              realAvatar = userInfo.avatar || avatar;
              logger.info(`[zalo] Re-looked up UID for phone ${phone}: ${uid} → ${realUid} via account ${accountId}`);
            }
          } catch (lookupErr: any) {
            logger.warn(`[zalo] Could not re-lookup UID for phone ${phone}: ${lookupErr.message}. Using original UID.`);
          }
        }

        if (skipAddFriend) {
          // Just send message to user (without adding friend)
          if (message) {
            try {
              await api.sendMessage({ msg: message.trim() }, realUid, 0);
            } catch (err: any) {
              const errMsg = err.message || '';
              if (errMsg.includes('người lạ') || errMsg.includes('lạ') || errMsg.includes('block') || errMsg.includes('chặn')) {
                return reply.status(400).send({ error: 'Người này chặn nhận tin nhắn từ người lạ. Vui lòng chọn chế độ Kết bạn Zalo.' });
              }
              throw err;
            }
          }
        } else {
          // Send the friend request on Zalo
          try {
            await api.sendFriendRequest(message || '', realUid);
          } catch (err: any) {
            const errCode = err.code;
            // Catch code 114 (already friends/invalid) or 225 (already friends) — treat as success
            if (errCode === 114 || errCode === 225) {
              logger.info(`[zalo] sendFriendRequest already friends (code ${errCode}), continuing to open chat.`);
            } else {
              throw err;
            }
          }
        }

        // 2. Database Upsert Contact
        // Normalize phone format for local DB first
        let normalizedPhone = phone || null;
        if (normalizedPhone && normalizedPhone.startsWith('84')) {
          normalizedPhone = '0' + normalizedPhone.slice(2);
        }

        // Use realUid (re-looked up from sending account) as the key
        let contact = await prisma.contact.findFirst({
          where: { OR: [{ zaloUid: realUid, orgId: user.orgId }, ...(normalizedPhone ? [{ phone: normalizedPhone, orgId: user.orgId }] : [])] },
        });

        if (!contact) {
          contact = await prisma.contact.create({
            data: {
              id: crypto.randomUUID(),
              orgId: user.orgId,
              zaloUid: realUid,
              fullName: realName,
              avatarUrl: realAvatar || null,
              phone: normalizedPhone,
            },
          });
        } else {
          // Update details if contact existed
          contact = await prisma.contact.update({
            where: { id: contact.id },
            data: {
              fullName: realName,
              zaloUid: realUid,
              avatarUrl: realAvatar || contact.avatarUrl,
              phone: normalizedPhone || contact.phone,
            },
          });
        }

        // 3. Find or Create Conversation (use realUid as the thread ID for this account)
        let conversation = await prisma.conversation.findFirst({
          where: { zaloAccountId: accountId, externalThreadId: realUid },
        });

        if (!conversation) {
          conversation = await prisma.conversation.create({
            data: {
              id: crypto.randomUUID(),
              orgId: user.orgId,
              zaloAccountId: accountId,
              contactId: contact.id,
              threadType: 'user',
              externalThreadId: realUid,
              lastMessageAt: new Date(),
              unreadCount: 0,
              isReplied: true,
            },
          });
        } else {
          // Update last message timestamp
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { lastMessageAt: new Date(), isReplied: true }
          });
        }

        // 4. Save the message in DB
        if (message) {
          await prisma.message.create({
            data: {
              id: crypto.randomUUID(),
              conversationId: conversation.id,
              senderType: 'self',
              senderName: account.displayName || 'AI',
              content: message,
              contentType: 'text',
              sentAt: new Date(),
            },
          });
        }

        return { success: true, conversationId: conversation.id };
      } catch (err: any) {
        logger.error('[zalo] Add friend error:', err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi xử lý yêu cầu Zalo' });
      }
    }
  );

  // POST /api/v1/zalo/accept-friend-request — accept an incoming friend request
  app.post<{ Body: { senderUid: string; senderName?: string; senderAvatar?: string; accountId: string } }>(
    '/api/v1/zalo/accept-friend-request',
    async (request, reply) => {
      const user = request.user!;
      const { senderUid, senderName, senderAvatar, accountId } = request.body;

      if (!senderUid || !accountId) {
        return reply.status(400).send({ error: 'Thiếu senderUid hoặc accountId' });
      }

      const account = await prisma.zaloAccount.findFirst({ where: { id: accountId, orgId: user.orgId } });
      if (!account) return reply.status(404).send({ error: 'Tài khoản Zalo không hợp lệ' });

      const api = zaloPool.getApi(accountId);
      if (!api) return reply.status(400).send({ error: `Tài khoản Zalo đang bị ngắt kết nối` });

      try {
        await api.acceptFriendRequest(senderUid);

        // Upsert Contact
        let contact = await prisma.contact.findFirst({ where: { zaloUid: senderUid, orgId: user.orgId } });
        if (!contact) {
          contact = await prisma.contact.create({
            data: {
              id: crypto.randomUUID(),
              orgId: user.orgId,
              zaloUid: senderUid,
              fullName: senderName || 'Khách hàng Zalo',
              avatarUrl: senderAvatar || null,
            },
          });
        } else {
          contact = await prisma.contact.update({
            where: { id: contact.id },
            data: {
              fullName: senderName || contact.fullName,
              avatarUrl: senderAvatar || contact.avatarUrl,
            },
          });
        }

        // Upsert Conversation
        let conversation = await prisma.conversation.findFirst({
          where: { zaloAccountId: accountId, externalThreadId: senderUid },
        });
        if (!conversation) {
          conversation = await prisma.conversation.create({
            data: {
              id: crypto.randomUUID(),
              orgId: user.orgId,
              zaloAccountId: accountId,
              contactId: contact.id,
              threadType: 'user',
              externalThreadId: senderUid,
              lastMessageAt: new Date(),
              unreadCount: 0,
              isReplied: false,
            },
          });
        }

        logger.info(`[zalo] Accepted friend request from ${senderUid}, conversationId: ${conversation.id}`);
        // Remove from pending store (DB)
        await friendRequestStore.remove(accountId, senderUid);
        return { success: true, conversationId: conversation.id };
      } catch (err: any) {
        logger.error('[zalo] Accept friend request error:', err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi chấp nhận kết bạn' });
      }
    }
  );

  // POST /api/v1/zalo/reject-friend-request — reject an incoming friend request
  app.post<{ Body: { senderUid: string; accountId: string } }>(
    '/api/v1/zalo/reject-friend-request',
    async (request, reply) => {
      const user = request.user!;
      const { senderUid, accountId } = request.body;

      if (!senderUid || !accountId) {
        return reply.status(400).send({ error: 'Thiếu senderUid hoặc accountId' });
      }

      const account = await prisma.zaloAccount.findFirst({ where: { id: accountId, orgId: user.orgId } });
      if (!account) return reply.status(404).send({ error: 'Tài khoản Zalo không hợp lệ' });

      const api = zaloPool.getApi(accountId);
      if (!api) return reply.status(400).send({ error: `Tài khoản Zalo đang bị ngắt kết nối` });

      try {
        await api.rejectFriendRequest(senderUid);
        // Remove from pending store (DB)
        await friendRequestStore.remove(accountId, senderUid);
        return { success: true };
      } catch (err: any) {
        logger.error('[zalo] Reject friend request error:', err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi từ chối kết bạn' });
      }
    }
  );

  // GET /api/v1/zalo-accounts/:id/groups — Lấy danh sách nhóm chat Zalo của tài khoản
  app.get<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id/groups',
    async (request, reply) => {
      const { id } = request.params;
      const user = request.user!;
      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) {
        return reply.status(404).send({ error: 'Không tìm thấy tài khoản Zalo' });
      }
      // Truy vấn các cuộc hội thoại là nhóm từ database
      const groups = await prisma.conversation.findMany({
        where: {
          zaloAccountId: id,
          threadType: 'group',
          orgId: user.orgId,
        },
        include: {
          contact: {
            select: {
              fullName: true,
              zaloUid: true,
              avatarUrl: true
            }
          }
        },
        orderBy: { lastMessageAt: 'desc' }
      });
      // Định dạng lại kết quả trả về
      const formattedGroups = groups.map(g => ({
        id: g.id,
        fullName: g.contact?.fullName || 'Nhóm không tên',
        zaloUid: g.externalThreadId || g.contact?.zaloUid || '',
        avatarUrl: g.contact?.avatarUrl || ''
      })).filter(g => g.zaloUid); // Chỉ giữ các nhóm có Zalo ID hợp lệ
      return { groups: formattedGroups };
    }
  );

  // POST /api/v1/zalo-accounts/:id/groups/:groupId/add-member — Thêm khách hàng vào nhóm
  app.post<{ Params: { id: string; groupId: string }; Body: { userZaloUid: string } }>(
    '/api/v1/zalo-accounts/:id/groups/:groupId/add-member',
    async (request, reply) => {
      const { id, groupId } = request.params;
      const { userZaloUid } = request.body;
      const user = request.user!;
      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) {
        return reply.status(404).send({ error: 'Không tìm thấy tài khoản Zalo' });
      }
      const api = zaloPool.getApi(id); // Lấy instance Zalo live
      if (!api) {
        return reply.status(400).send({ error: 'Tài khoản Zalo chưa kết nối' });
      }
      if (!userZaloUid) {
        return reply.status(400).send({ error: 'Zalo UID của thành viên là bắt buộc' });
      }
      try {
        const res = await api.addUserToGroup(userZaloUid, groupId);
        
        // Kiểm tra xem Zalo API có trả về lỗi thành viên không
        if (res && Array.isArray(res.errorMembers) && res.errorMembers.includes(userZaloUid)) {
          const detail = res.error_data?.[userZaloUid] || [];
          const errMsg = detail.join(', ') || 'Zalo từ chối thêm thành viên này vào nhóm.';
          return reply.status(400).send({ error: `Không thể thêm vào nhóm: ${errMsg}` });
        }
        return { success: true, detail: res };
      } catch (err: any) {
        logger.error(`[zalo:${id}] addUserToGroup error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi hệ thống khi thêm thành viên vào nhóm.' });
      }
    }
  );

  // POST /api/v1/zalo-accounts/:id/create-group — Tạo nhóm chat Zalo mới
  app.post<{ Params: { id: string }; Body: { name: string; members: string[] } }>(
    '/api/v1/zalo-accounts/:id/create-group',
    async (request, reply) => {
      const { id } = request.params;
      const { name, members } = request.body;
      const user = request.user!;
      if (!name?.trim()) {
        return reply.status(400).send({ error: 'Tên nhóm không được để trống.' });
      }
      if (!Array.isArray(members) || members.length === 0) {
        return reply.status(400).send({ error: 'Danh sách thành viên không được để trống.' });
      }
      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!account) {
        return reply.status(404).send({ error: 'Không tìm thấy tài khoản Zalo' });
      }
      const api = zaloPool.getApi(id);
      if (!api) {
        return reply.status(400).send({ error: 'Tài khoản Zalo chưa kết nối' });
      }
      try {
        // 1. Gọi API Zalo tạo nhóm
        const res = await api.createGroup({ name: name.trim(), members });
        
        if (!res?.groupId) {
          return reply.status(400).send({ error: 'Không thể tạo nhóm (Zalo API không trả về ID nhóm).' });
        }
        const newGroupId = res.groupId;
        // 2. Tạo bản ghi Contact đại diện cho nhóm
        let groupContact = await prisma.contact.findFirst({
          where: { zaloUid: newGroupId, orgId: user.orgId }
        });
        if (!groupContact) {
          groupContact = await prisma.contact.create({
            data: {
              id: crypto.randomUUID(),
              orgId: user.orgId,
              zaloUid: newGroupId,
              fullName: name.trim(),
              avatarUrl: null
            }
          });
        }
        // 3. Tạo bản ghi Conversation nhóm để hiện lên danh sách chat
        let groupConversation = await prisma.conversation.findFirst({
          where: { externalThreadId: newGroupId, zaloAccountId: id, orgId: user.orgId },
          include: { contact: true, zaloAccount: true }
        });
        if (!groupConversation) {
          groupConversation = await prisma.conversation.create({
            data: {
              id: crypto.randomUUID(),
              orgId: user.orgId,
              zaloAccountId: id,
              contactId: groupContact.id,
              threadType: 'group',
              externalThreadId: newGroupId,
              unreadCount: 0,
              isReplied: true,
              lastMessageAt: new Date()
            },
            include: { contact: true, zaloAccount: true }
          });
        }
        return {
          success: true,
          conversation: groupConversation
        };
      } catch (err: any) {
        logger.error(`[zalo:${id}] createGroup error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi hệ thống khi tạo nhóm.' });
      }
    }
  );
}

