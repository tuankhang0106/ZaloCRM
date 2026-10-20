import { api } from './index';

export const zaloExtendedApi = {
  // ── 1. Catalogs & Products ──────────────────────────────────────────────
  getCatalogs: (accountId: string, limit = 50) =>
    api.get(`/zalo-accounts/${accountId}/catalogs`, { params: { limit } }),
  createCatalog: (accountId: string, catalogName: string) =>
    api.post(`/zalo-accounts/${accountId}/catalogs`, { catalogName }),
  updateCatalog: (accountId: string, catalogId: string, catalogName: string) =>
    api.put(`/zalo-accounts/${accountId}/catalogs/${catalogId}`, { catalogName }),
  deleteCatalog: (accountId: string, catalogId: string) =>
    api.delete(`/zalo-accounts/${accountId}/catalogs/${catalogId}`),

  getProducts: (accountId: string, catalogId: string, limit = 100) =>
    api.get(`/zalo-accounts/${accountId}/catalogs/${catalogId}/products`, { params: { limit } }),
  createProduct: (accountId: string, catalogId: string, data: { productName: string; price: string; description?: string; photos?: any[] }) =>
    api.post(`/zalo-accounts/${accountId}/catalogs/${catalogId}/products`, data),
  updateProduct: (accountId: string, catalogId: string, productId: string, data: { productName: string; price: string; description?: string; photos?: any[] }) =>
    api.put(`/zalo-accounts/${accountId}/catalogs/${catalogId}/products/${productId}`, data),
  deleteProduct: (accountId: string, catalogId: string, productId: string) =>
    api.delete(`/zalo-accounts/${accountId}/catalogs/${catalogId}/products/${productId}`),

  // ── 2. Auto-Replies & Quick Messages ────────────────────────────────────
  getAutoReplies: (accountId: string) =>
    api.get(`/zalo-accounts/${accountId}/auto-replies`),
  createAutoReply: (accountId: string, data: { content: string; isEnable?: boolean; startTime?: number; endTime?: number; scope?: any }) =>
    api.post(`/zalo-accounts/${accountId}/auto-replies`, data),
  updateAutoReply: (accountId: string, replyId: string | number, data: { content: string; isEnable?: boolean; startTime?: number; endTime?: number; scope?: any }) =>
    api.put(`/zalo-accounts/${accountId}/auto-replies/${replyId}`, data),
  deleteAutoReply: (accountId: string, replyId: string | number) =>
    api.delete(`/zalo-accounts/${accountId}/auto-replies/${replyId}`),

  getQuickMessages: (accountId: string) =>
    api.get(`/zalo-accounts/${accountId}/quick-messages`),
  createQuickMessage: (accountId: string, data: { keyword: string; title: string; media?: any }) =>
    api.post(`/zalo-accounts/${accountId}/quick-messages`, data),
  updateQuickMessage: (accountId: string, msgId: string | number, data: { keyword: string; title: string; media?: any }) =>
    api.put(`/zalo-accounts/${accountId}/quick-messages/${msgId}`, data),
  deleteQuickMessage: (accountId: string, msgId: string | number) =>
    api.delete(`/zalo-accounts/${accountId}/quick-messages/${msgId}`),

  // ── 3. Labels & Alias ───────────────────────────────────────────────────
  getLabels: (accountId: string) =>
    api.get(`/zalo-accounts/${accountId}/labels`),
  updateLabels: (accountId: string, labels: any) =>
    api.post(`/zalo-accounts/${accountId}/labels`, { labels }),
  getAliases: (accountId: string) =>
    api.get(`/zalo-accounts/${accountId}/friends/alias-list`),
  setAlias: (accountId: string, userZaloUid: string, alias: string) =>
    api.post(`/zalo-accounts/${accountId}/friends/alias`, { userZaloUid, alias }),
  removeAlias: (accountId: string, userZaloUid: string) =>
    api.delete(`/zalo-accounts/${accountId}/friends/alias/${userZaloUid}`),

  // ── 4. Friend Requests & Relationships ──────────────────────────────────
  getSentFriendRequests: (accountId: string) =>
    api.get(`/zalo-accounts/${accountId}/friends/sent-requests`),
  getReceivedFriendRequests: (accountId: string) =>
    api.get(`/zalo-accounts/${accountId}/friends/received-requests`),
  getFriendRequestStatus: (accountId: string, userZaloUid: string) =>
    api.get(`/zalo-accounts/${accountId}/friends/request-status/${userZaloUid}`),
  undoFriendRequest: (accountId: string, userZaloUid: string) =>
    api.post(`/zalo-accounts/${accountId}/friends/undo-request`, { userZaloUid }),
  removeFriend: (accountId: string, userZaloUid: string) =>
    api.post(`/zalo-accounts/${accountId}/friends/remove`, { userZaloUid }),
  blockUser: (accountId: string, userZaloUid: string) =>
    api.post(`/zalo-accounts/${accountId}/friends/block`, { userZaloUid }),
  unblockUser: (accountId: string, userZaloUid: string) =>
    api.post(`/zalo-accounts/${accountId}/friends/unblock`, { userZaloUid }),
  blockViewFeed: (accountId: string, userZaloUid: string, isBlock = true) =>
    api.post(`/zalo-accounts/${accountId}/friends/block-feed`, { userZaloUid, isBlock }),
  getLastOnline: (accountId: string, userZaloUid: string) =>
    api.get(`/zalo-accounts/${accountId}/friends/last-online/${userZaloUid}`),
  getOnlineFriends: (accountId: string) =>
    api.get(`/zalo-accounts/${accountId}/friends/onlines`),
  getCloseFriends: (accountId: string) =>
    api.get(`/zalo-accounts/${accountId}/friends/close-friends`),

  // ── 5. Advanced Group Controls ──────────────────────────────────────────
  changeGroupAvatar: (accountId: string, groupId: string, avatarSource: any) =>
    api.post(`/zalo-accounts/${accountId}/groups/${groupId}/avatar`, { avatarSource }),
  disperseGroup: (accountId: string, groupId: string) =>
    api.post(`/zalo-accounts/${accountId}/groups/${groupId}/disperse`),
  joinGroupLink: (accountId: string, link: string) =>
    api.post(`/zalo-accounts/${accountId}/groups/join-link`, { link }),
  getGroupLinkInfo: (accountId: string, link: string) =>
    api.post(`/zalo-accounts/${accountId}/groups/link-info`, { link }),
  inviteUsersToGroups: (accountId: string, members: string[], groupIds: string[]) =>
    api.post(`/zalo-accounts/${accountId}/groups/invite-users`, { members, groupIds }),
  getGroupBlockedMembers: (accountId: string, groupId: string, page = 1) =>
    api.get(`/zalo-accounts/${accountId}/groups/${groupId}/blocked-members`, { params: { page } }),
  addGroupBlockedMember: (accountId: string, groupId: string, memberId: string) =>
    api.post(`/zalo-accounts/${accountId}/groups/${groupId}/block-member`, { memberId }),
  removeGroupBlockedMember: (accountId: string, groupId: string, memberId: string) =>
    api.post(`/zalo-accounts/${accountId}/groups/${groupId}/unblock-member`, { memberId }),
  upgradeGroupToCommunity: (accountId: string, groupId: string) =>
    api.post(`/zalo-accounts/${accountId}/groups/${groupId}/upgrade-community`),

  // ── 6. Conversation Controls ────────────────────────────────────────────
  setPinConversation: (accountId: string, pinned: boolean, threadId: string, threadType: 'user' | 'group' = 'user') =>
    api.post(`/zalo-accounts/${accountId}/conversations/pin`, { pinned, threadId, threadType }),
  getPinnedConversations: (accountId: string) =>
    api.get(`/zalo-accounts/${accountId}/conversations/pin`),
  setMuteConversation: (accountId: string, threadId: string, threadType: 'user' | 'group' = 'user', duration = -1) =>
    api.post(`/zalo-accounts/${accountId}/conversations/mute`, { threadId, threadType, duration }),
  getMuteConversations: (accountId: string) =>
    api.get(`/zalo-accounts/${accountId}/conversations/mute`),
  getArchivedChats: (accountId: string) =>
    api.get(`/zalo-accounts/${accountId}/conversations/archived`),
  deleteZaloChat: (accountId: string, threadId: string, threadType: 'user' | 'group' = 'user', lastMessage?: any) =>
    api.post(`/zalo-accounts/${accountId}/conversations/delete`, { threadId, threadType, lastMessage }),
  getAutoDeleteChat: (accountId: string) =>
    api.get(`/zalo-accounts/${accountId}/conversations/auto-delete`),
  setAutoDeleteChat: (accountId: string, threadId: string, threadType: 'user' | 'group' = 'user', ttl = 0) =>
    api.post(`/zalo-accounts/${accountId}/conversations/auto-delete`, { threadId, threadType, ttl }),
  addUnreadMark: (accountId: string, threadId: string, threadType: 'user' | 'group' = 'user') =>
    api.post(`/zalo-accounts/${accountId}/conversations/unread-mark`, { threadId, threadType }),
  removeUnreadMark: (accountId: string, threadId: string, threadType: 'user' | 'group' = 'user') =>
    api.delete(`/zalo-accounts/${accountId}/conversations/unread-mark`, { data: { threadId, threadType } }),

  // ── 7. Profile & Settings ───────────────────────────────────────────────
  changeAccountAvatar: (accountId: string, avatarSource: any) =>
    api.post(`/zalo-accounts/${accountId}/profile/avatar`, { avatarSource }),
  getAvatarList: (accountId: string) =>
    api.get(`/zalo-accounts/${accountId}/profile/avatars`),
  reuseAvatar: (accountId: string, photoId: string) =>
    api.post(`/zalo-accounts/${accountId}/profile/reuse-avatar`, { photoId }),
  deleteAvatar: (accountId: string, photoId: string) =>
    api.delete(`/zalo-accounts/${accountId}/profile/avatar/${photoId}`),
  updateProfile: (accountId: string, profile: { name?: string; dob?: string; gender?: number }) =>
    api.post(`/zalo-accounts/${accountId}/profile/update`, profile),
  updateBio: (accountId: string, bio: string) =>
    api.post(`/zalo-accounts/${accountId}/profile/bio`, { bio }),
  getBizAccount: (accountId: string) =>
    api.get(`/zalo-accounts/${accountId}/biz-account`),
  getSettings: (accountId: string) =>
    api.get(`/zalo-accounts/${accountId}/settings`),
  updateSettings: (accountId: string, settings: any) =>
    api.post(`/zalo-accounts/${accountId}/settings`, { settings }),

  // ── 8. Chat Interactions ────────────────────────────────────────────────
  addReaction: (conversationId: string, data: { zaloMsgId: string; cliMsgId?: string; reaction: string }) =>
    api.post(`/conversations/${conversationId}/reaction`, data),
  getStickers: (accountId: string) =>
    api.get(`/zalo-accounts/${accountId}/stickers`),
  getStickersDetail: (accountId: string, cateId: string | number) =>
    api.get(`/zalo-accounts/${accountId}/stickers/${cateId}`),
  searchSticker: (accountId: string, keyword: string) =>
    api.post(`/zalo-accounts/${accountId}/stickers/search`, { keyword }),
  sendSticker: (conversationId: string, sticker: { id: number; cateId: number; type: number }) =>
    api.post(`/conversations/${conversationId}/send-sticker`, { sticker }),
  sendVoice: (conversationId: string, data: { voiceUrl: string; ttl?: number }) =>
    api.post(`/conversations/${conversationId}/send-voice`, data),
  sendLink: (conversationId: string, data: { link: string; msg?: string; ttl?: number }) =>
    api.post(`/conversations/${conversationId}/send-link`, data),
  parseLink: (conversationId: string, link: string) =>
    api.post(`/conversations/${conversationId}/parse-link`, { link }),
  votePoll: (conversationId: string, pollId: string | number, optionIds: number | number[]) =>
    api.post(`/conversations/${conversationId}/polls/${pollId}/vote`, { optionIds }),
  addPollOptions: (conversationId: string, pollId: string | number, options: Array<{ content: string; voted?: boolean }>) =>
    api.post(`/conversations/${conversationId}/polls/${pollId}/options`, { options }),
};
