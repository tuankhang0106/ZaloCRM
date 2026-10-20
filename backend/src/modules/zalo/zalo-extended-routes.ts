/**
 * zalo-extended-routes.ts — Full suite of extended Zalo APIs.
 * Integrates all missing Zalo capabilities:
 * - Product Catalog & Products
 * - Auto-Reply & Zalo Quick Messages
 * - Labels & Friend Alias
 * - Friend Requests Management & Blocking
 * - Advanced Group Operations & Blocked Members
 * - Conversation Controls (Pin, Mute, Auto-delete, Hidden chats, Unread marks)
 * - Profile & Zalo Business Settings
 * - Chat Interactions (Reactions, Stickers, Voice, Link preview, Seen/Delivered, Poll vote)
 */
import { createRequire } from 'module';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { zaloPool } from './zalo-pool.js';
import { logger } from '../../shared/utils/logger.js';
import { reactionCodeToEmoji } from './zalo-listener-factory.js';

const require = createRequire(import.meta.url);
const { ThreadType, Reactions, MuteDuration, ChatTTL } = require('zca-js');

// Map emoji/friendly names to zca-js reaction codes
function resolveReaction(input: string): string {
  if (!input) return Reactions.NONE || '';
  const norm = input.trim();
  switch (norm) {
    case '❤️':
    case 'heart':
    case 'HEART':
      return Reactions.HEART || '/-heart';
    case '👍':
    case 'like':
    case 'LIKE':
      return Reactions.LIKE || '/-strong';
    case '😆':
    case '😂':
    case 'haha':
    case 'HAHA':
      return Reactions.HAHA || ':>';
    case '😮':
    case 'wow':
    case 'WOW':
      return Reactions.WOW || ':o';
    case '😭':
    case '😢':
    case 'cry':
    case 'CRY':
    case 'sad':
    case 'SAD':
      return Reactions.CRY || ':-(( ';
    case '😡':
    case 'angry':
    case 'ANGRY':
      return Reactions.ANGRY || ':-h';
    case '👎':
    case 'dislike':
      return Reactions.DISLIKE || '/-weak';
    case 'none':
    case 'NONE':
    case 'remove':
      return Reactions.NONE || '';
    default:
      return norm;
  }
}

async function getConnectedZaloApi(accountId: string, orgId: string, reply: FastifyReply) {
  const account = await prisma.zaloAccount.findFirst({
    where: { id: accountId, orgId },
  });
  if (!account) {
    reply.status(404).send({ error: 'Không tìm thấy tài khoản Zalo' });
    return null;
  }
  const api = zaloPool.getApi(accountId);
  if (!api) {
    reply.status(400).send({ error: 'Tài khoản Zalo chưa kết nối hoặc đang offline' });
    return null;
  }
  return { account, api };
}

export async function zaloExtendedRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ══════════════════════════════════════════════════════════════════════════
  // 1. PRODUCT CATALOG & PRODUCTS (Zalo Shop / Catalog)
  // ══════════════════════════════════════════════════════════════════════════

  // GET catalogs
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/v1/zalo-accounts/:id/catalogs',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      try {
        const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
        const data = await res.api.getCatalogList({ limit });
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] getCatalogList error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi lấy danh mục sản phẩm Zalo' });
      }
    }
  );

  // POST create catalog
  app.post<{ Params: { id: string }; Body: { catalogName: string } }>(
    '/api/v1/zalo-accounts/:id/catalogs',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      if (!req.body?.catalogName?.trim()) {
        return reply.status(400).send({ error: 'Tên danh mục không được để trống' });
      }
      try {
        const data = await res.api.createCatalog(req.body.catalogName.trim());
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] createCatalog error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi tạo danh mục sản phẩm Zalo' });
      }
    }
  );

  // PUT update catalog
  app.put<{ Params: { id: string; catalogId: string }; Body: { catalogName: string } }>(
    '/api/v1/zalo-accounts/:id/catalogs/:catalogId',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      try {
        const data = await res.api.updateCatalog({
          catalogId: req.params.catalogId,
          catalogName: req.body?.catalogName?.trim(),
        });
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] updateCatalog error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi cập nhật danh mục' });
      }
    }
  );

  // DELETE catalog
  app.delete<{ Params: { id: string; catalogId: string } }>(
    '/api/v1/zalo-accounts/:id/catalogs/:catalogId',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      try {
        const data = await res.api.deleteCatalog(req.params.catalogId);
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] deleteCatalog error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi xóa danh mục' });
      }
    }
  );

  // GET products in catalog
  app.get<{ Params: { id: string; catalogId: string }; Querystring: { limit?: string } }>(
    '/api/v1/zalo-accounts/:id/catalogs/:catalogId/products',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      try {
        const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
        const data = await res.api.getProductCatalogList({ catalogId: req.params.catalogId, limit });
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] getProductCatalogList error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi lấy danh sách sản phẩm' });
      }
    }
  );

  // POST create product
  app.post<{
    Params: { id: string; catalogId: string };
    Body: { productName: string; price: string; description?: string; photos?: any[] };
  }>('/api/v1/zalo-accounts/:id/catalogs/:catalogId/products', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    try {
      const { productName, price, description = '', photos = [] } = req.body;
      const data = await res.api.createProductCatalog({
        catalogId: req.params.catalogId,
        productName,
        price: String(price || '0'),
        description,
        photos,
      });
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] createProductCatalog error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi tạo sản phẩm' });
    }
  });

  // PUT update product
  app.put<{
    Params: { id: string; catalogId: string; productId: string };
    Body: { productName: string; price: string; description?: string; photos?: any[] };
  }>('/api/v1/zalo-accounts/:id/catalogs/:catalogId/products/:productId', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    try {
      const { productName, price, description = '', photos = [] } = req.body;
      const data = await res.api.updateProductCatalog({
        catalogId: req.params.catalogId,
        productId: req.params.productId,
        productName,
        price: String(price || '0'),
        description,
        photos,
      });
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] updateProductCatalog error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi cập nhật sản phẩm' });
    }
  });

  // DELETE product
  app.delete<{ Params: { id: string; catalogId: string; productId: string } }>(
    '/api/v1/zalo-accounts/:id/catalogs/:catalogId/products/:productId',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      try {
        const data = await res.api.deleteProductCatalog({
          catalogId: req.params.catalogId,
          productIds: req.params.productId,
        });
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] deleteProductCatalog error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi xóa sản phẩm' });
      }
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // 2. AUTO-REPLY & QUICK MESSAGES GỐC ZALO
  // ══════════════════════════════════════════════════════════════════════════

  // GET auto-replies
  app.get<{ Params: { id: string } }>('/api/v1/zalo-accounts/:id/auto-replies', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    try {
      const data = await res.api.getAutoReplyList();
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] getAutoReplyList error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi lấy danh sách tin nhắn tự động' });
    }
  });

  // POST create auto-reply
  app.post<{
    Params: { id: string };
    Body: { content: string; isEnable?: boolean; startTime?: number; endTime?: number; scope?: any };
  }>('/api/v1/zalo-accounts/:id/auto-replies', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    try {
      const { content, isEnable = true, startTime = 0, endTime = 86400, scope } = req.body;
      const data = await res.api.createAutoReply({
        content,
        isEnable,
        startTime,
        endTime,
        ...(scope ? { scope } : {}),
      });
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] createAutoReply error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi tạo tin nhắn tự động' });
    }
  });

  // PUT update auto-reply
  app.put<{
    Params: { id: string; replyId: string };
    Body: { content: string; isEnable?: boolean; startTime?: number; endTime?: number; scope?: any };
  }>('/api/v1/zalo-accounts/:id/auto-replies/:replyId', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    try {
      const { content, isEnable = true, startTime = 0, endTime = 86400, scope } = req.body;
      const data = await res.api.updateAutoReply({
        id: parseInt(req.params.replyId, 10),
        content,
        isEnable,
        startTime,
        endTime,
        ...(scope ? { scope } : {}),
      });
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] updateAutoReply error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi cập nhật tin nhắn tự động' });
    }
  });

  // DELETE auto-reply
  app.delete<{ Params: { id: string; replyId: string } }>(
    '/api/v1/zalo-accounts/:id/auto-replies/:replyId',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      try {
        const data = await res.api.deleteAutoReply(parseInt(req.params.replyId, 10));
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] deleteAutoReply error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi xóa tin nhắn tự động' });
      }
    }
  );

  // GET Zalo native quick messages
  app.get<{ Params: { id: string } }>('/api/v1/zalo-accounts/:id/quick-messages', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    try {
      const data = await res.api.getQuickMessageList();
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] getQuickMessageList error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi lấy tin nhắn nhanh Zalo' });
    }
  });

  // POST create Zalo native quick message
  app.post<{ Params: { id: string }; Body: { keyword: string; title: string; media?: any } }>(
    '/api/v1/zalo-accounts/:id/quick-messages',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      try {
        const { keyword, title, media } = req.body;
        const data = await res.api.addQuickMessage({ keyword, title, media });
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] addQuickMessage error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi tạo tin nhắn nhanh Zalo' });
      }
    }
  );

  // PUT update Zalo native quick message
  app.put<{ Params: { id: string; msgId: string }; Body: { keyword: string; title: string; media?: any } }>(
    '/api/v1/zalo-accounts/:id/quick-messages/:msgId',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      try {
        const { keyword, title, media } = req.body;
        const data = await res.api.updateQuickMessage({ keyword, title, media });
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] updateQuickMessage error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi cập nhật tin nhắn nhanh Zalo' });
      }
    }
  );

  // DELETE Zalo native quick message
  app.delete<{ Params: { id: string; msgId: string } }>(
    '/api/v1/zalo-accounts/:id/quick-messages/:msgId',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      try {
        const data = await res.api.removeQuickMessage(parseInt(req.params.msgId, 10));
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] removeQuickMessage error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi xóa tin nhắn nhanh Zalo' });
      }
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // 3. LABELS & FRIEND ALIAS (Nhãn Zalo PC & Biệt danh)
  // ══════════════════════════════════════════════════════════════════════════

  // GET Zalo PC Labels
  app.get<{ Params: { id: string } }>('/api/v1/zalo-accounts/:id/labels', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    try {
      const data = await res.api.getLabels();
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] getLabels error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi lấy danh sách nhãn Zalo' });
    }
  });

  // POST update Zalo PC Labels
  app.post<{ Params: { id: string }; Body: { labels: any } }>(
    '/api/v1/zalo-accounts/:id/labels',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      try {
        const data = await res.api.updateLabels(req.body.labels);
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] updateLabels error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi cập nhật nhãn Zalo' });
      }
    }
  );

  // GET Friend Aliases
  app.get<{ Params: { id: string } }>('/api/v1/zalo-accounts/:id/friends/alias-list', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    try {
      const data = await res.api.getAliasList();
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] getAliasList error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi lấy danh sách biệt danh' });
    }
  });

  // POST set/change Friend Alias
  app.post<{ Params: { id: string }; Body: { userZaloUid: string; alias: string } }>(
    '/api/v1/zalo-accounts/:id/friends/alias',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      const { userZaloUid, alias } = req.body;
      if (!userZaloUid) return reply.status(400).send({ error: 'userZaloUid là bắt buộc' });
      try {
        const data = await res.api.changeFriendAlias(alias || '', userZaloUid);
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] changeFriendAlias error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi đổi biệt danh bạn bè' });
      }
    }
  );

  // DELETE Friend Alias
  app.delete<{ Params: { id: string; userZaloUid: string } }>(
    '/api/v1/zalo-accounts/:id/friends/alias/:userZaloUid',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      try {
        const data = await res.api.removeFriendAlias(req.params.userZaloUid);
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] removeFriendAlias error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi xóa biệt danh bạn bè' });
      }
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // 4. FRIEND REQUESTS, ONLINE STATUS & USER CONTROLS
  // ══════════════════════════════════════════════════════════════════════════

  // GET sent friend requests (lời mời đã gửi)
  app.get<{ Params: { id: string } }>('/api/v1/zalo-accounts/:id/friends/sent-requests', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    try {
      const data = await res.api.getSentFriendRequest();
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] getSentFriendRequest error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi lấy danh sách lời mời đã gửi' });
    }
  });

  // GET received friend requests (lời mời đã nhận)
  app.get<{ Params: { id: string } }>('/api/v1/zalo-accounts/:id/friends/received-requests', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    try {
      const data = await res.api.getReceivedFriendRequests();
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] getReceivedFriendRequests error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi lấy danh sách lời mời đã nhận' });
    }
  });

  // GET relationship status with a user
  app.get<{ Params: { id: string; userZaloUid: string } }>(
    '/api/v1/zalo-accounts/:id/friends/request-status/:userZaloUid',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      try {
        const data = await res.api.getFriendRequestStatus(req.params.userZaloUid);
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] getFriendRequestStatus error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi kiểm tra trạng thái kết bạn' });
      }
    }
  );

  // POST undo sent friend request (thu hồi lời mời kết bạn)
  app.post<{ Params: { id: string }; Body: { userZaloUid: string } }>(
    '/api/v1/zalo-accounts/:id/friends/undo-request',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      const { userZaloUid } = req.body;
      if (!userZaloUid) return reply.status(400).send({ error: 'userZaloUid là bắt buộc' });
      try {
        const data = await res.api.undoFriendRequest(userZaloUid);
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] undoFriendRequest error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi thu hồi lời mời kết bạn' });
      }
    }
  );

  // POST unfriend (hủy kết bạn)
  app.post<{ Params: { id: string }; Body: { userZaloUid: string } }>(
    '/api/v1/zalo-accounts/:id/friends/remove',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      const { userZaloUid } = req.body;
      if (!userZaloUid) return reply.status(400).send({ error: 'userZaloUid là bắt buộc' });
      try {
        const data = await res.api.removeFriend(userZaloUid);
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] removeFriend error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi hủy kết bạn' });
      }
    }
  );

  // POST block user
  app.post<{ Params: { id: string }; Body: { userZaloUid: string } }>(
    '/api/v1/zalo-accounts/:id/friends/block',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      const { userZaloUid } = req.body;
      if (!userZaloUid) return reply.status(400).send({ error: 'userZaloUid là bắt buộc' });
      try {
        const data = await res.api.blockUser(userZaloUid);
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] blockUser error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi chặn người dùng' });
      }
    }
  );

  // POST unblock user
  app.post<{ Params: { id: string }; Body: { userZaloUid: string } }>(
    '/api/v1/zalo-accounts/:id/friends/unblock',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      const { userZaloUid } = req.body;
      if (!userZaloUid) return reply.status(400).send({ error: 'userZaloUid là bắt buộc' });
      try {
        const data = await res.api.unblockUser(userZaloUid);
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] unblockUser error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi bỏ chặn người dùng' });
      }
    }
  );

  // POST block/unblock view feed
  app.post<{ Params: { id: string }; Body: { userZaloUid: string; isBlock?: boolean } }>(
    '/api/v1/zalo-accounts/:id/friends/block-feed',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      const { userZaloUid, isBlock = true } = req.body;
      if (!userZaloUid) return reply.status(400).send({ error: 'userZaloUid là bắt buộc' });
      try {
        const data = await res.api.blockViewFeed(userZaloUid, isBlock);
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] blockViewFeed error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi chặn xem nhật ký' });
      }
    }
  );

  // GET last online of user
  app.get<{ Params: { id: string; userZaloUid: string } }>(
    '/api/v1/zalo-accounts/:id/friends/last-online/:userZaloUid',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      try {
        const data = await res.api.lastOnline(req.params.userZaloUid);
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] lastOnline error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi lấy thời gian online' });
      }
    }
  );

  // GET online friends
  app.get<{ Params: { id: string } }>('/api/v1/zalo-accounts/:id/friends/onlines', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    try {
      const data = await res.api.getFriendOnlines();
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] getFriendOnlines error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi lấy bạn bè đang online' });
    }
  });

  // GET close friends
  app.get<{ Params: { id: string } }>('/api/v1/zalo-accounts/:id/friends/close-friends', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    try {
      const data = await res.api.getCloseFriends();
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] getCloseFriends error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi lấy bạn thân' });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5. ADVANCED GROUP MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════

  // POST change group avatar
  app.post<{ Params: { id: string; groupId: string }; Body: { avatarSource: any } }>(
    '/api/v1/zalo-accounts/:id/groups/:groupId/avatar',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      if (!req.body?.avatarSource) {
        return reply.status(400).send({ error: 'avatarSource không được để trống' });
      }
      try {
        const data = await res.api.changeGroupAvatar(req.body.avatarSource, req.params.groupId);
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] changeGroupAvatar error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi đổi avatar nhóm' });
      }
    }
  );

  // POST disperse group (giải tán nhóm)
  app.post<{ Params: { id: string; groupId: string } }>(
    '/api/v1/zalo-accounts/:id/groups/:groupId/disperse',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      try {
        const data = await res.api.disperseGroup(req.params.groupId);
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] disperseGroup error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi giải tán nhóm' });
      }
    }
  );

  // POST join group via link
  app.post<{ Params: { id: string }; Body: { link: string } }>(
    '/api/v1/zalo-accounts/:id/groups/join-link',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      if (!req.body?.link?.trim()) {
        return reply.status(400).send({ error: 'Đường dẫn tham gia nhóm là bắt buộc' });
      }
      try {
        const data = await res.api.joinGroupLink(req.body.link.trim());
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] joinGroupLink error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi tham gia nhóm bằng link' });
      }
    }
  );

  // POST get group info from invite link
  app.post<{ Params: { id: string }; Body: { link: string } }>(
    '/api/v1/zalo-accounts/:id/groups/link-info',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      if (!req.body?.link?.trim()) {
        return reply.status(400).send({ error: 'Đường dẫn nhóm là bắt buộc' });
      }
      try {
        const data = await res.api.getGroupLinkInfo(req.body.link.trim());
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] getGroupLinkInfo error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi lấy thông tin nhóm từ link' });
      }
    }
  );

  // POST invite multiple users to groups
  app.post<{ Params: { id: string }; Body: { members: string[]; groupIds: string[] } }>(
    '/api/v1/zalo-accounts/:id/groups/invite-users',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      const { members, groupIds } = req.body;
      if (!Array.isArray(members) || members.length === 0) {
        return reply.status(400).send({ error: 'Danh sách thành viên không được trống' });
      }
      if (!Array.isArray(groupIds) || groupIds.length === 0) {
        return reply.status(400).send({ error: 'Danh sách nhóm không được trống' });
      }
      try {
        const data = await res.api.inviteUserToGroups(members, groupIds);
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] inviteUserToGroups error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi mời thành viên vào nhóm' });
      }
    }
  );

  // GET blocked members of a group
  app.get<{ Params: { id: string; groupId: string }; Querystring: { page?: string } }>(
    '/api/v1/zalo-accounts/:id/groups/:groupId/blocked-members',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      try {
        const page = req.query.page ? parseInt(req.query.page, 10) : 1;
        const data = await res.api.getGroupBlockedMember(req.params.groupId, page);
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] getGroupBlockedMember error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi lấy danh sách bị chặn của nhóm' });
      }
    }
  );

  // POST add blocked member in group
  app.post<{ Params: { id: string; groupId: string }; Body: { memberId: string } }>(
    '/api/v1/zalo-accounts/:id/groups/:groupId/block-member',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      if (!req.body?.memberId) return reply.status(400).send({ error: 'memberId là bắt buộc' });
      try {
        const data = await res.api.addGroupBlockedMember(req.body.memberId, req.params.groupId);
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] addGroupBlockedMember error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi chặn thành viên trong nhóm' });
      }
    }
  );

  // POST remove blocked member in group
  app.post<{ Params: { id: string; groupId: string }; Body: { memberId: string } }>(
    '/api/v1/zalo-accounts/:id/groups/:groupId/unblock-member',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      if (!req.body?.memberId) return reply.status(400).send({ error: 'memberId là bắt buộc' });
      try {
        const data = await res.api.removeGroupBlockedMember(req.body.memberId, req.params.groupId);
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] removeGroupBlockedMember error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi bỏ chặn thành viên trong nhóm' });
      }
    }
  );

  // POST upgrade group to community
  app.post<{ Params: { id: string; groupId: string } }>(
    '/api/v1/zalo-accounts/:id/groups/:groupId/upgrade-community',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      try {
        const data = await res.api.upgradeGroupToCommunity(req.params.groupId);
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] upgradeGroupToCommunity error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi nâng cấp nhóm lên cộng đồng' });
      }
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // 6. CONVERSATION CONTROLS (PIN, MUTE, AUTO-DELETE, ARCHIVED, UNREAD)
  // ══════════════════════════════════════════════════════════════════════════

  // POST pin/unpin conversation
  app.post<{
    Params: { id: string };
    Body: { pinned: boolean; threadId: string; threadType?: 'user' | 'group' };
  }>('/api/v1/zalo-accounts/:id/conversations/pin', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    const { pinned, threadId, threadType = 'user' } = req.body;
    if (!threadId) return reply.status(400).send({ error: 'threadId là bắt buộc' });
    try {
      const type = threadType === 'group' ? ThreadType.Group : ThreadType.User;
      const data = await res.api.setPinnedConversations(pinned, threadId, type);
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] setPinnedConversations error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi ghim/bỏ ghim hội thoại' });
    }
  });

  // GET pinned conversations
  app.get<{ Params: { id: string } }>('/api/v1/zalo-accounts/:id/conversations/pin', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    try {
      const data = await res.api.getPinConversations();
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] getPinConversations error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi lấy danh sách ghim' });
    }
  });

  // POST mute conversation
  app.post<{
    Params: { id: string };
    Body: { threadId: string; threadType?: 'user' | 'group'; duration?: number };
  }>('/api/v1/zalo-accounts/:id/conversations/mute', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    const { threadId, threadType = 'user', duration = -1 } = req.body;
    if (!threadId) return reply.status(400).send({ error: 'threadId là bắt buộc' });
    try {
      const type = threadType === 'group' ? ThreadType.Group : ThreadType.User;
      const data = await res.api.setMute({ threadId, type, duration });
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] setMute error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi tắt thông báo' });
    }
  });

  // GET mute list
  app.get<{ Params: { id: string } }>('/api/v1/zalo-accounts/:id/conversations/mute', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    try {
      const data = await res.api.getMute();
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] getMute error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi lấy danh sách tắt thông báo' });
    }
  });

  // GET archived conversations
  app.get<{ Params: { id: string } }>('/api/v1/zalo-accounts/:id/conversations/archived', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    try {
      const data = await res.api.getArchivedChatList();
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] getArchivedChatList error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi lấy danh sách lưu trữ' });
    }
  });

  // POST delete chat conversation on Zalo
  app.post<{
    Params: { id: string };
    Body: { threadId: string; threadType?: 'user' | 'group'; lastMessage?: any };
  }>('/api/v1/zalo-accounts/:id/conversations/delete', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    const { threadId, threadType = 'user', lastMessage } = req.body;
    if (!threadId) return reply.status(400).send({ error: 'threadId là bắt buộc' });
    try {
      const type = threadType === 'group' ? ThreadType.Group : ThreadType.User;
      const data = await res.api.deleteChat(threadId, type, lastMessage);
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] deleteChat error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi xóa cuộc trò chuyện trên Zalo' });
    }
  });

  // GET auto delete chat setting
  app.get<{ Params: { id: string } }>('/api/v1/zalo-accounts/:id/conversations/auto-delete', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    try {
      const data = await res.api.getAutoDeleteChat();
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] getAutoDeleteChat error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi lấy cài đặt tin nhắn tự xóa' });
    }
  });

  // POST update auto delete chat setting
  app.post<{
    Params: { id: string };
    Body: { threadId: string; threadType?: 'user' | 'group'; ttl: number };
  }>('/api/v1/zalo-accounts/:id/conversations/auto-delete', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    const { threadId, threadType = 'user', ttl = 0 } = req.body;
    if (!threadId) return reply.status(400).send({ error: 'threadId là bắt buộc' });
    try {
      const type = threadType === 'group' ? ThreadType.Group : ThreadType.User;
      const data = await res.api.updateAutoDeleteChat(ttl, threadId, type);
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] updateAutoDeleteChat error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi cài đặt tin nhắn tự xóa' });
    }
  });

  // POST mark conversation as unread on Zalo
  app.post<{
    Params: { id: string };
    Body: { threadId: string; threadType?: 'user' | 'group' };
  }>('/api/v1/zalo-accounts/:id/conversations/unread-mark', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    const { threadId, threadType = 'user' } = req.body;
    if (!threadId) return reply.status(400).send({ error: 'threadId là bắt buộc' });
    try {
      const type = threadType === 'group' ? ThreadType.Group : ThreadType.User;
      const data = await res.api.addUnreadMark(threadId, type);
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] addUnreadMark error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi đánh dấu chưa đọc' });
    }
  });

  // DELETE remove unread mark on Zalo
  app.delete<{
    Params: { id: string };
    Body: { threadId: string; threadType?: 'user' | 'group' };
  }>('/api/v1/zalo-accounts/:id/conversations/unread-mark', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    const { threadId, threadType = 'user' } = req.body;
    if (!threadId) return reply.status(400).send({ error: 'threadId là bắt buộc' });
    try {
      const type = threadType === 'group' ? ThreadType.Group : ThreadType.User;
      const data = await res.api.removeUnreadMark(threadId, type);
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] removeUnreadMark error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi bỏ đánh dấu chưa đọc' });
    }
  });

  // GET unread marks
  app.get<{ Params: { id: string } }>('/api/v1/zalo-accounts/:id/conversations/unread-mark', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    try {
      const data = await res.api.getUnreadMark();
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] getUnreadMark error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi lấy danh sách chưa đọc' });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 7. PROFILE, AVATAR & BUSINESS SETTINGS
  // ══════════════════════════════════════════════════════════════════════════

  // POST change account avatar
  app.post<{ Params: { id: string }; Body: { avatarSource: any } }>(
    '/api/v1/zalo-accounts/:id/profile/avatar',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      if (!req.body?.avatarSource) {
        return reply.status(400).send({ error: 'avatarSource không được để trống' });
      }
      try {
        const data = await res.api.changeAccountAvatar(req.body.avatarSource);
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] changeAccountAvatar error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi đổi avatar tài khoản' });
      }
    }
  );

  // GET avatar history
  app.get<{ Params: { id: string } }>('/api/v1/zalo-accounts/:id/profile/avatars', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    try {
      const data = await res.api.getAvatarList();
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] getAvatarList error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi lấy lịch sử avatar' });
    }
  });

  // POST reuse previous avatar
  app.post<{ Params: { id: string }; Body: { photoId: string } }>(
    '/api/v1/zalo-accounts/:id/profile/reuse-avatar',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      if (!req.body?.photoId) return reply.status(400).send({ error: 'photoId là bắt buộc' });
      try {
        const data = await res.api.reuseAvatar(req.body.photoId);
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] reuseAvatar error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi dùng lại avatar cũ' });
      }
    }
  );

  // DELETE avatar photo
  app.delete<{ Params: { id: string; photoId: string } }>(
    '/api/v1/zalo-accounts/:id/profile/avatar/:photoId',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      try {
        const data = await res.api.deleteAvatar(req.params.photoId);
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] deleteAvatar error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi xóa ảnh avatar' });
      }
    }
  );

  // POST update profile (name, dob, gender)
  app.post<{ Params: { id: string }; Body: { name?: string; dob?: string; gender?: number } }>(
    '/api/v1/zalo-accounts/:id/profile/update',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      try {
        const data = await res.api.updateProfile({ profile: req.body });
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] updateProfile error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi cập nhật thông tin cá nhân' });
      }
    }
  );

  // POST update bio
  app.post<{ Params: { id: string }; Body: { bio: string } }>(
    '/api/v1/zalo-accounts/:id/profile/bio',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      try {
        const data = await res.api.updateProfileBio(req.body?.bio || '');
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] updateProfileBio error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi cập nhật tiểu sử' });
      }
    }
  );

  // GET Zalo Business account info
  app.get<{ Params: { id: string } }>('/api/v1/zalo-accounts/:id/biz-account', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    try {
      const data = await res.api.getBizAccount();
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] getBizAccount error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi lấy thông tin Zalo Business' });
    }
  });

  // GET Zalo settings
  app.get<{ Params: { id: string } }>('/api/v1/zalo-accounts/:id/settings', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    try {
      const data = await res.api.getSettings();
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] getSettings error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi lấy cài đặt Zalo' });
    }
  });

  // POST update Zalo settings
  app.post<{ Params: { id: string }; Body: { settings: any } }>(
    '/api/v1/zalo-accounts/:id/settings',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      try {
        const data = await res.api.updateSettings(req.body.settings);
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] updateSettings error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi cập nhật cài đặt Zalo' });
      }
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // 8. CHAT INTERACTIONS (REACTIONS, STICKERS, VOICE, LINK PREVIEW, POLLS)
  // ══════════════════════════════════════════════════════════════════════════

  // POST add reaction to message
  app.post<{
    Params: { conversationId: string };
    Body: { zaloMsgId: string; cliMsgId?: string; reaction: string };
  }>('/api/v1/conversations/:conversationId/reaction', async (req, reply) => {
    const user = req.user!;
    const { zaloMsgId, cliMsgId, reaction } = req.body;
    if (!zaloMsgId) return reply.status(400).send({ error: 'zaloMsgId là bắt buộc' });

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.conversationId, orgId: user.orgId },
    });
    if (!conversation) return reply.status(404).send({ error: 'Không tìm thấy cuộc trò chuyện' });

    const api = zaloPool.getApi(conversation.zaloAccountId);
    if (!api) return reply.status(400).send({ error: 'Tài khoản Zalo chưa kết nối' });

    try {
      const targetThreadId = conversation.externalThreadId || conversation.contactId;
      if (!targetThreadId) return reply.status(400).send({ error: 'Thiếu externalThreadId' });

      const icon = resolveReaction(reaction);
      const isGroup = conversation.threadType === 'group';

      const data = await api.addReaction(icon, {
        data: {
          msgId: String(zaloMsgId),
          cliMsgId: String(cliMsgId || zaloMsgId),
        },
        threadId: targetThreadId,
        type: isGroup ? ThreadType.Group : ThreadType.User,
      });

      // Update reaction in DB immediately and broadcast real-time event
      try {
        const emoji = reactionCodeToEmoji(icon);
        const targetMessage = await prisma.message.findFirst({
          where: {
            conversationId: conversation.id,
            OR: [
              { zaloMsgId: String(zaloMsgId) },
              ...(cliMsgId ? [{ zaloMsgId: String(cliMsgId) }] : []),
              { id: String(zaloMsgId) },
            ],
          },
        });

        if (targetMessage) {
          let attList: any[] = [];
          if (targetMessage.attachments) {
            if (typeof targetMessage.attachments === 'string') {
              try { attList = JSON.parse(targetMessage.attachments); } catch { attList = []; }
            } else if (Array.isArray(targetMessage.attachments)) {
              attList = [...targetMessage.attachments];
            } else if (typeof targetMessage.attachments === 'object') {
              attList = [targetMessage.attachments];
            }
          }

          const ownUid = String(api.getContext?.()?.uid || '0');
          attList = attList.filter((att) => {
            if (!att || typeof att !== 'object') return true;
            if (att.type === 'reaction') {
              if (att.senderUid && ownUid) return att.senderUid !== ownUid;
              return false;
            }
            return true;
          });

          if (emoji) {
            attList.push({
              type: 'reaction',
              reaction: emoji,
              icon,
              senderUid: ownUid,
              isSelf: true,
              updatedAt: Date.now(),
            });
          }

          await prisma.message.update({
            where: { id: targetMessage.id },
            data: { attachments: attList as any },
          });

          const io = zaloPool.getIO();
          io?.emit('chat:reaction', {
            accountId: conversation.zaloAccountId,
            messageId: targetMessage.id,
            zaloMsgId: targetMessage.zaloMsgId || String(zaloMsgId),
            conversationId: conversation.id,
            reaction: emoji,
            icon,
            senderUid: ownUid,
            isSelf: true,
          });
        }
      } catch (dbErr) {
        logger.warn(`[extended:reaction] Failed to update reaction in DB:`, dbErr);
      }

      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:reaction] addReaction error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi thả cảm xúc tin nhắn' });
    }
  });

  // GET all stickers
  app.get<{ Params: { id: string } }>('/api/v1/zalo-accounts/:id/stickers', async (req, reply) => {
    const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
    if (!res) return;
    try {
      const data = await res.api.getStickers();
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:${req.params.id}] getStickers error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi lấy kho sticker' });
    }
  });

  // GET sticker detail by category id
  app.get<{ Params: { id: string; cateId: string } }>(
    '/api/v1/zalo-accounts/:id/stickers/:cateId',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      try {
        const data = await res.api.getStickersDetail(parseInt(req.params.cateId, 10));
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] getStickersDetail error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi lấy chi tiết sticker' });
      }
    }
  );

  // POST search sticker by keyword
  app.post<{ Params: { id: string }; Body: { keyword: string } }>(
    '/api/v1/zalo-accounts/:id/stickers/search',
    async (req, reply) => {
      const res = await getConnectedZaloApi(req.params.id, req.user!.orgId, reply);
      if (!res) return;
      try {
        const data = await res.api.searchSticker(req.body?.keyword || '');
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:${req.params.id}] searchSticker error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi tìm sticker' });
      }
    }
  );

  // POST send sticker in conversation
  app.post<{
    Params: { conversationId: string };
    Body: { sticker: { id: number; cateId: number; type: number } };
  }>('/api/v1/conversations/:conversationId/send-sticker', async (req, reply) => {
    const user = req.user!;
    const { sticker } = req.body;
    if (!sticker?.id) return reply.status(400).send({ error: 'Thông tin sticker không hợp lệ' });

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.conversationId, orgId: user.orgId },
    });
    if (!conversation) return reply.status(404).send({ error: 'Không tìm thấy cuộc trò chuyện' });

    const api = zaloPool.getApi(conversation.zaloAccountId);
    if (!api) return reply.status(400).send({ error: 'Tài khoản Zalo chưa kết nối' });

    const targetThreadId = conversation.externalThreadId || conversation.contactId;
    if (!targetThreadId) return reply.status(400).send({ error: 'Thiếu externalThreadId' });

    try {
      const isGroup = conversation.threadType === 'group';
      const data = await api.sendSticker(sticker, targetThreadId, isGroup ? ThreadType.Group : ThreadType.User);
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:sticker] sendSticker error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi gửi sticker' });
    }
  });

  // POST send voice in conversation
  app.post<{
    Params: { conversationId: string };
    Body: { voiceUrl: string; ttl?: number };
  }>('/api/v1/conversations/:conversationId/send-voice', async (req, reply) => {
    const user = req.user!;
    const { voiceUrl, ttl = 0 } = req.body;
    if (!voiceUrl) return reply.status(400).send({ error: 'voiceUrl là bắt buộc' });

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.conversationId, orgId: user.orgId },
    });
    if (!conversation) return reply.status(404).send({ error: 'Không tìm thấy cuộc trò chuyện' });

    const api = zaloPool.getApi(conversation.zaloAccountId);
    if (!api) return reply.status(400).send({ error: 'Tài khoản Zalo chưa kết nối' });

    const targetThreadId = conversation.externalThreadId || conversation.contactId;
    if (!targetThreadId) return reply.status(400).send({ error: 'Thiếu externalThreadId' });

    try {
      const isGroup = conversation.threadType === 'group';
      const data = await api.sendVoice({ voiceUrl, ttl }, targetThreadId, isGroup ? ThreadType.Group : ThreadType.User);
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:voice] sendVoice error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi gửi voice memo' });
    }
  });

  // POST send link with rich preview
  app.post<{
    Params: { conversationId: string };
    Body: { link: string; msg?: string; ttl?: number };
  }>('/api/v1/conversations/:conversationId/send-link', async (req, reply) => {
    const user = req.user!;
    const { link, msg = '', ttl = 0 } = req.body;
    if (!link) return reply.status(400).send({ error: 'link là bắt buộc' });

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.conversationId, orgId: user.orgId },
    });
    if (!conversation) return reply.status(404).send({ error: 'Không tìm thấy cuộc trò chuyện' });

    const api = zaloPool.getApi(conversation.zaloAccountId);
    if (!api) return reply.status(400).send({ error: 'Tài khoản Zalo chưa kết nối' });

    const targetThreadId = conversation.externalThreadId || conversation.contactId;
    if (!targetThreadId) return reply.status(400).send({ error: 'Thiếu externalThreadId' });

    try {
      const isGroup = conversation.threadType === 'group';
      const data = await api.sendLink({ link, msg, ttl }, targetThreadId, isGroup ? ThreadType.Group : ThreadType.User);
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:link] sendLink error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi gửi link preview' });
    }
  });

  // POST parse link preview metadata
  app.post<{ Params: { conversationId: string }; Body: { link: string } }>(
    '/api/v1/conversations/:conversationId/parse-link',
    async (req, reply) => {
      const user = req.user!;
      const conversation = await prisma.conversation.findFirst({
        where: { id: req.params.conversationId, orgId: user.orgId },
      });
      if (!conversation) return reply.status(404).send({ error: 'Không tìm thấy cuộc trò chuyện' });

      const api = zaloPool.getApi(conversation.zaloAccountId);
      if (!api) return reply.status(400).send({ error: 'Tài khoản Zalo chưa kết nối' });

      try {
        const data = await api.parseLink(req.body?.link);
        return { success: true, data };
      } catch (err: any) {
        logger.error(`[extended:link] parseLink error:`, err);
        return reply.status(500).send({ error: err.message || 'Lỗi khi parse link preview' });
      }
    }
  );

  // POST vote on group poll
  app.post<{
    Params: { conversationId: string; pollId: string };
    Body: { optionIds: number | number[] };
  }>('/api/v1/conversations/:conversationId/polls/:pollId/vote', async (req, reply) => {
    const user = req.user!;
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.conversationId, orgId: user.orgId },
    });
    if (!conversation) return reply.status(404).send({ error: 'Không tìm thấy cuộc trò chuyện' });

    const api = zaloPool.getApi(conversation.zaloAccountId);
    if (!api) return reply.status(400).send({ error: 'Tài khoản Zalo chưa kết nối' });

    try {
      const pollId = parseInt(req.params.pollId, 10);
      const data = await api.votePoll(pollId, req.body.optionIds);
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:poll] votePoll error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi bình chọn poll' });
    }
  });

  // POST add options to existing poll
  app.post<{
    Params: { conversationId: string; pollId: string };
    Body: { options: Array<{ content: string; voted?: boolean }> };
  }>('/api/v1/conversations/:conversationId/polls/:pollId/options', async (req, reply) => {
    const user = req.user!;
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.conversationId, orgId: user.orgId },
    });
    if (!conversation) return reply.status(404).send({ error: 'Không tìm thấy cuộc trò chuyện' });

    const api = zaloPool.getApi(conversation.zaloAccountId);
    if (!api) return reply.status(400).send({ error: 'Tài khoản Zalo chưa kết nối' });

    try {
      const pollId = parseInt(req.params.pollId, 10);
      const data = await api.addPollOptions(pollId, req.body.options);
      return { success: true, data };
    } catch (err: any) {
      logger.error(`[extended:poll] addPollOptions error:`, err);
      return reply.status(500).send({ error: err.message || 'Lỗi khi thêm phương án bình chọn' });
    }
  });
}
