/**
 * friendRequestStore.ts
 * Database-backed store for pending incoming Zalo friend requests.
 * Persists across server restarts unlike the old in-memory approach.
 */
import { prisma } from '../../shared/database/prisma-client.js';

export interface PendingFriendRequest {
  senderUid: string;
  senderName: string;
  senderAvatar: string;
  message: string;
  receivedAt: number;
}

export const friendRequestStore = {
  async add(accountId: string, orgId: string, req: PendingFriendRequest) {
    await prisma.pendingFriendRequest.upsert({
      where: { accountId_senderUid: { accountId, senderUid: req.senderUid } },
      update: {
        senderName: req.senderName,
        senderAvatar: req.senderAvatar,
        message: req.message,
      },
      create: {
        accountId,
        orgId,
        senderUid: req.senderUid,
        senderName: req.senderName,
        senderAvatar: req.senderAvatar,
        message: req.message,
        receivedAt: new Date(req.receivedAt),
      },
    });
  },

  async get(accountId: string): Promise<PendingFriendRequest[]> {
    const rows = await prisma.pendingFriendRequest.findMany({
      where: { accountId },
      orderBy: { receivedAt: 'asc' },
    });
    return rows.map(r => ({
      senderUid: r.senderUid,
      senderName: r.senderName,
      senderAvatar: r.senderAvatar,
      message: r.message,
      receivedAt: r.receivedAt.getTime(),
    }));
  },

  async remove(accountId: string, senderUid: string) {
    await prisma.pendingFriendRequest.deleteMany({
      where: { accountId, senderUid },
    });
  },

  async count(accountId: string): Promise<number> {
    return prisma.pendingFriendRequest.count({ where: { accountId } });
  },
};
