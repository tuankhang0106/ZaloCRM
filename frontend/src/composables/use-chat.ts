import { ref, computed, watch } from 'vue';
import { api } from '@/api/index';
import { io, Socket } from 'socket.io-client';
import { getSocketServerUrl } from '@/utils/socket-helper';
import type { Contact } from '@/composables/use-contacts';

function playNotificationSound() {
  // Check if sound notifications are muted in localStorage
  if (localStorage.getItem('crm-sound-enabled') === 'false') return;

  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    // Soft double-chime (sine wave)
    const playTone = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      
      // Soft exponential decay
      gain.gain.setValueAtTime(0.12, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(start);
      osc.stop(start + duration);
    };
    
    const now = ctx.currentTime;
    // Beautiful digital chime: C5 (523.25Hz) then E5 (659.25Hz)
    playTone(523.25, now, 0.22);
    playTone(659.25, now + 0.08, 0.32);
    
    // Close context after tones are done to prevent resource leaks
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 600);
  } catch (err) {
    console.warn('[sound] Playback failed:', err);
  }
}

interface ZaloAccount {
  id: string;
  displayName: string | null;
  status?: string;
  channel?: string;
}

interface ConversationMessage {
  content: string | null;
  contentType: string;
  senderType: string;
  sentAt: string;
  isDeleted: boolean;
}

export interface Conversation {
  id: string;
  channel?: string;
  threadType: 'user' | 'group';
  groupName?: string | null;
  contact: Contact | null;
  zaloAccount: ZaloAccount | null;
  lastMessageAt: string | null;
  unreadCount: number;
  isReplied: boolean;
  isCustomer: boolean;
  quoteCompleted: boolean;
  quoteCompletedByName?: string | null;
  messages?: ConversationMessage[];
  aiMuted?: boolean;
  isMuted?: boolean;
}

export interface Message {
  id: string;
  content: string | null;
  contentType: string;
  senderType: string;
  senderName: string | null;
  sentAt: string;
  isDeleted: boolean;
  zaloMsgId: string | null;
  attachments?: any;
  metadata?: any;
  status?: 'sending' | 'sent' | 'failed';
  repliedBy?: {
    id: string;
    fullName: string;
    role: string;
  } | null;
}

export function useChat() {
  const conversations = ref<Conversation[]>([]);
  const selectedConvId = ref<string | null>(null);
  const messages = ref<Message[]>([]);
  const loadingConvs = ref(false);
  const loadingMsgs = ref(false);
  const loadingMoreMsgs = ref(false);
  const hasMoreMessages = ref(true);
  const sendingMsg = ref(false);
  const searchQuery = ref('');
  const accountFilter = ref<string | null>(null);
  const threadTypeFilter = ref<'user' | 'group' | null>(null);
  const categoryFilter = ref<string | null>(null);
  const statusFilter = ref<string | null>(null);
  const unreadMode = ref(false);
  const tasksMode = ref(false);
  const trackedMode = ref(false);
  watch(selectedConvId, (newId) => {
    if (newId) {
      localStorage.setItem('crm-active-conv-id', newId);
    } else {
      localStorage.removeItem('crm-active-conv-id');
    }
  });
  let socket: Socket | null = null;
  let refreshInterval: any = null;

  const selectedConv = computed(() =>
    conversations.value.find(c => c.id === selectedConvId.value) || null,
  );

  async function fetchConversations() {
    loadingConvs.value = true;
    try {
      const res = await api.get('/conversations', {
        params: {
          limit: 100,
          search: searchQuery.value,
          accountId: accountFilter.value || undefined,
          threadType: threadTypeFilter.value || undefined,
          category: categoryFilter.value || undefined,
          status: statusFilter.value || undefined,
          unreadOnly: unreadMode.value ? 'true' : undefined,
          uncompletedOnly: tasksMode.value ? 'true' : (trackedMode.value ? 'tracked' : undefined)
        },
      });
      conversations.value = res.data.conversations;
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    } finally {
      loadingConvs.value = false;
    }
  }

  async function selectConversation(convId: string) {
    selectedConvId.value = convId;
    await fetchMessages(convId);
    // Fetch full conversation detail to populate contact CRM fields
    try {
      const convDetail = await api.get(`/conversations/${convId}`);
      const conv = conversations.value.find(c => c.id === convId);
      if (conv && convDetail.data.contact) {
        conv.contact = convDetail.data.contact;
      }
    } catch {
      // Non-critical — panel will show partial data from list
    }
    // Mark as read
    try {
      await api.post(`/conversations/${convId}/mark-read`);
      const conv = conversations.value.find(c => c.id === convId);
      if (conv) conv.unreadCount = 0;
      window.dispatchEvent(new Event('crm:unread-changed'));
    } catch {
      // Ignore mark-read errors
    }
  }

  async function fetchMessages(convId: string, limit = 50) {
    loadingMsgs.value = true;
    hasMoreMessages.value = true;
    try {
      const res = await api.get(`/conversations/${convId}/messages`, {
        params: { limit },
      });
      messages.value = res.data.messages || [];
      const total = res.data.total ?? 0;
      hasMoreMessages.value = total > messages.value.length || messages.value.length >= limit;
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    } finally {
      loadingMsgs.value = false;
    }
  }

  async function loadMoreMessages(): Promise<boolean> {
    if (!selectedConvId.value || loadingMoreMsgs.value || !hasMoreMessages.value) return false;
    const oldestMsg = messages.value[0];
    if (!oldestMsg) return false;

    loadingMoreMsgs.value = true;
    try {
      const res = await api.get(`/conversations/${selectedConvId.value}/messages`, {
        params: {
          limit: 30,
          before: oldestMsg.sentAt,
        },
      });
      const olderMessages = res.data.messages || [];
      if (olderMessages.length > 0) {
        messages.value = [...olderMessages, ...messages.value];
        hasMoreMessages.value = olderMessages.length >= 30;
        return true;
      } else {
        hasMoreMessages.value = false;
        return false;
      }
    } catch (err) {
      console.error('Failed to load more messages:', err);
      return false;
    } finally {
      loadingMoreMsgs.value = false;
    }
  }

  async function sendMessage(content: string, quoteMessageId?: string) {
    if (!selectedConvId.value || !content.trim()) return;
    const convId = selectedConvId.value;
    const text = content.trim();

    // 1. OPTIMISTIC UPDATE: Render immediately on screen (0ms delay)
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    let quoteAttachment: any = null;
    if (quoteMessageId) {
      const q = messages.value.find(m => m.id === quoteMessageId);
      if (q) {
        quoteAttachment = {
          type: 'quote',
          fromD: q.senderName || (q.senderType === 'self' ? 'Bạn' : 'Khách hàng'),
          msg: q.content || '',
          quoteMessageId: q.id,
        };
      }
    }

    const optimisticMsg: Message = {
      id: tempId,
      content: text,
      contentType: 'text',
      senderType: 'self',
      senderName: 'Bạn',
      sentAt: new Date().toISOString(),
      isDeleted: false,
      zaloMsgId: null,
      attachments: quoteAttachment ? [quoteAttachment] : [],
      status: 'sending',
    };

    messages.value.push(optimisticMsg);

    // Update conversation lastMessageAt in sidebar list optimistically
    const targetConv = conversations.value.find(c => c.id === convId);
    if (targetConv) {
      targetConv.lastMessageAt = optimisticMsg.sentAt;
      targetConv.isReplied = true;
    }

    sendingMsg.value = true;
    try {
      const res = await api.post(`/conversations/${convId}/messages`, {
        content: text,
        quoteMessageId,
      });

      const alreadyExistsIdx = messages.value.findIndex(m =>
        m.id === res.data.id || (res.data.zaloMsgId && m.zaloMsgId === res.data.zaloMsgId)
      );
      const tempIdx = messages.value.findIndex(m => m.id === tempId);

      if (alreadyExistsIdx !== -1) {
        messages.value[alreadyExistsIdx] = { ...res.data, status: 'sent' };
        if (tempIdx !== -1 && tempIdx !== alreadyExistsIdx) {
          messages.value.splice(tempIdx, 1);
        }
      } else if (tempIdx !== -1) {
        messages.value[tempIdx] = { ...res.data, status: 'sent' };
      } else {
        messages.value.push({ ...res.data, status: 'sent' });
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      const found = messages.value.find(m => m.id === tempId);
      if (found) {
        found.status = 'failed';
      }
      throw err;
    } finally {
      sendingMsg.value = false;
    }
  }

  async function forwardMessage(targetConversationIds: string[], messageId: string, extraText?: string) {
    const res = await api.post('/conversations/forward', {
      targetConversationIds,
      messageId,
      extraText,
    });
    return res.data;
  }

  async function recallMessage(messageId: string) {
    if (!selectedConvId.value) return;
    try {
      const res = await api.post(`/conversations/${selectedConvId.value}/messages/${messageId}/undo`);
      if (res.data?.success === false || res.data?.error) {
        throw new Error(res.data?.error || res.data?.zaloWarning || 'Thu hồi tin nhắn thất bại');
      }
      const msg = messages.value.find(m => m.id === messageId);
      if (msg) {
        msg.isDeleted = true;
      }
      return res.data;
    } catch (err: any) {
      const errMsg = err?.response?.data?.error || err?.response?.data?.zaloWarning || err?.message || 'Không thể thu hồi tin nhắn';
      console.error('[recallMessage] Error:', errMsg);
      throw new Error(errMsg);
    }
  }

  async function deleteMessageForMe(messageId: string) {
    if (!selectedConvId.value) return;
    const res = await api.post(`/conversations/${selectedConvId.value}/messages/${messageId}/delete-for-me`);
    const idx = messages.value.findIndex(m => m.id === messageId);
    if (idx !== -1) {
      messages.value.splice(idx, 1);
    }
    return res.data;
  }

  async function sendFile(file: File, caption?: string) {
    if (!selectedConvId.value) return;
    const convId = selectedConvId.value;
    const isImg = file.type.startsWith('image/');
    const localPreview = URL.createObjectURL(file);
    const tempId = `temp_file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Optimistic item for photo/file
    const optimisticMsg: Message = {
      id: tempId,
      content: isImg
        ? JSON.stringify({
            href: localPreview,
            thumb: localPreview,
            hdUrl: localPreview,
            ...(caption?.trim() ? { title: caption.trim(), caption: caption.trim() } : {}),
          })
        : JSON.stringify({
            title: file.name,
            href: localPreview,
            params: JSON.stringify({ fileSize: String(file.size), fileExt: file.name.split('.').pop() || '' }),
          }),
      contentType: isImg ? 'image' : 'file',
      senderType: 'self',
      senderName: 'Bạn',
      sentAt: new Date().toISOString(),
      isDeleted: false,
      zaloMsgId: null,
      status: 'sending',
    };
    messages.value.push(optimisticMsg);

    sendingMsg.value = true;
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (caption && caption.trim()) {
        formData.append('content', caption.trim());
      }
      const res = await api.post(`/conversations/${convId}/messages`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const alreadyExistsIdx = messages.value.findIndex(m =>
        m.id === res.data.id || (res.data.zaloMsgId && m.zaloMsgId === res.data.zaloMsgId)
      );
      const tempIdx = messages.value.findIndex(m => m.id === tempId);

      if (alreadyExistsIdx !== -1) {
        messages.value[alreadyExistsIdx] = { ...res.data, status: 'sent' };
        if (tempIdx !== -1 && tempIdx !== alreadyExistsIdx) {
          messages.value.splice(tempIdx, 1);
        }
      } else if (tempIdx !== -1) {
        messages.value[tempIdx] = { ...res.data, status: 'sent' };
      } else {
        messages.value.push({ ...res.data, status: 'sent' });
      }
    } catch (err) {
      console.error('Failed to send file:', err);
      const found = messages.value.find(m => m.id === tempId);
      if (found) {
        found.status = 'failed';
      }
      throw err;
    } finally {
      sendingMsg.value = false;
    }
  }

  function initSocket() {
    const socketUrl = getSocketServerUrl();
    socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socket.on('connect', () => {
      console.log('[socket] Connected to', socketUrl || 'origin');
    });

    socket.on('chat:message', (data: { message: Message; conversationId: string }) => {
      // Add to messages if viewing this conversation
      if (data.conversationId === selectedConvId.value) {
        // If an optimistic message from self is pending, match and replace it!
        // 1. Exact content match
        // 2. Media match by contentType (image/file)
        const pendingIdx = messages.value.findIndex(m => {
          if (!m.id.startsWith('temp_') && m.status !== 'sending') return false;
          if (m.senderType !== 'self') return false;
          if (m.content === data.message.content) return true;
          if ((m.contentType === 'image' || m.contentType === 'file') && m.contentType === data.message.contentType) {
            return true;
          }
          return false;
        });

        const existsIdx = messages.value.findIndex(m =>
          m.id === data.message.id ||
          (data.message.zaloMsgId && m.zaloMsgId === data.message.zaloMsgId)
        );

        if (pendingIdx !== -1) {
          if (existsIdx !== -1 && existsIdx !== pendingIdx) {
            messages.value[existsIdx] = { ...data.message, status: 'sent' };
            messages.value.splice(pendingIdx, 1);
          } else {
            messages.value[pendingIdx] = { ...data.message, status: 'sent' };
          }
        } else {
          if (existsIdx === -1) {
            messages.value.push({ ...data.message, status: 'sent' });
          } else {
            Object.assign(messages.value[existsIdx], data.message, { status: 'sent' });
          }
        }
      }

      // Play soft digital double-chime if the message is from a customer and not muted
      if (data.message.senderType !== 'self') {
        const targetConv = conversations.value.find(c => c.id === data.conversationId);
        if (!targetConv?.isMuted) {
          playNotificationSound();
        }
      }

      // Refresh conversation list to update last message / unread count
      fetchConversations();
    });

    socket.on('chat:deleted', (data: { msgId: string }) => {
      const msg = messages.value.find(m => m.zaloMsgId === data.msgId);
      if (msg) {
        msg.isDeleted = true;
      }
    });

    socket.on('chat:message-undo', (data: { messageId?: string; zaloMsgId?: string }) => {
      const msg = messages.value.find(m => (data.messageId && m.id === data.messageId) || (data.zaloMsgId && m.zaloMsgId === data.zaloMsgId));
      if (msg) {
        msg.isDeleted = true;
      }
    });

    socket.on('chat:message-deleted', (data: { messageId: string }) => {
      const idx = messages.value.findIndex(m => m.id === data.messageId);
      if (idx !== -1) {
        messages.value.splice(idx, 1);
      }
    });

    socket.on('chat:reaction', (data: {
      accountId?: string;
      messageId?: string;
      zaloMsgId?: string;
      conversationId?: string;
      reaction: string | null;
      icon?: string;
      senderUid?: string;
      isSelf?: boolean;
    }) => {
      const msg = messages.value.find(m =>
        (data.messageId && m.id === data.messageId) ||
        (data.zaloMsgId && m.zaloMsgId === data.zaloMsgId)
      );

      if (msg) {
        let attList: any[] = [];
        if (msg.attachments) {
          if (typeof msg.attachments === 'string') {
            try { attList = JSON.parse(msg.attachments); } catch { attList = []; }
          } else if (Array.isArray(msg.attachments)) {
            attList = [...msg.attachments];
          } else if (typeof msg.attachments === 'object') {
            attList = [msg.attachments];
          }
        }

        attList = attList.filter((a: any) => a && a.type !== 'reaction');
        if (data.reaction) {
          attList.push({
            type: 'reaction',
            reaction: data.reaction,
            icon: data.icon,
            senderUid: data.senderUid,
            isSelf: data.isSelf,
          });
        }
        msg.attachments = attList;
      }

      window.dispatchEvent(new CustomEvent('crm:message-reaction', { detail: data }));
    });

    socket.on('conversation:quote-update', (data: { conversationId: string; isCustomer: boolean; quoteCompleted: boolean; quoteCompletedByName?: string | null }) => {
      const convIndex = conversations.value.findIndex(c => c.id === data.conversationId);
      if (convIndex !== -1) {
        if (tasksMode.value && data.quoteCompleted) {
          // Remove from tasks list in real-time!
          conversations.value.splice(convIndex, 1);
          if (selectedConvId.value === data.conversationId) {
            selectedConvId.value = null;
          }
        } else {
          const conv = conversations.value[convIndex];
          conv.isCustomer = data.isCustomer;
          conv.quoteCompleted = data.quoteCompleted;
          conv.quoteCompletedByName = data.quoteCompletedByName;
        }
      } else if (tasksMode.value && data.isCustomer && !data.quoteCompleted) {
        // Reload list to add new customer tasks that were marked incomplete
        fetchConversations();
      }
    });

    socket.on('conversation:ai-update', (data: { conversationId: string; aiMuted: boolean }) => {
      const convIndex = conversations.value.findIndex(c => c.id === data.conversationId);
      if (convIndex !== -1) {
        conversations.value[convIndex].aiMuted = data.aiMuted;
      }
    });

    socket.on('conversation:mute-update', (data: { conversationId: string; isMuted: boolean }) => {
      const conv = conversations.value.find(c => c.id === data.conversationId);
      if (conv) {
        conv.isMuted = data.isMuted;
      }
    });

    // Reconnection handlers: auto catch-up when network recovers
    socket.on('connect', () => {
      fetchConversations();
      if (selectedConvId.value) {
        fetchMessages(selectedConvId.value);
      }
    });

    socket.on('reconnect', () => {
      fetchConversations();
      if (selectedConvId.value) {
        fetchMessages(selectedConvId.value);
      }
    });

    socket.on('zalo:connected', () => {
      fetchConversations();
      if (selectedConvId.value) {
        fetchMessages(selectedConvId.value);
      }
    });

    socket.on('zalo:sync-completed', () => {
      fetchConversations();
      if (selectedConvId.value) {
        fetchMessages(selectedConvId.value);
      }
    });

    // Browser online detection — instant sync when internet recovers
    const handleOnline = () => {
      fetchConversations();
      if (selectedConvId.value) {
        fetchMessages(selectedConvId.value);
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
    }

    // Background polling heartbeat every 20s to guarantee real-time sync even if network packets drop
    refreshInterval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchConversations();
      }
    }, 20000);
  }

  function destroySocket() {
    socket?.disconnect();
    socket = null;
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  }

  async function toggleMute(convId: string, isMuted: boolean) {
    try {
      const res = await api.patch(`/conversations/${convId}/mute`, { isMuted });
      const conv = conversations.value.find(c => c.id === convId);
      if (conv) {
        conv.isMuted = res.data.isMuted;
      }
      return res.data.isMuted;
    } catch (err) {
      console.error('Failed to toggle mute status:', err);
      throw err;
    }
  }

  async function updateQuoteSettings(convId: string, settings: { isCustomer?: boolean; quoteCompleted?: boolean }) {
    try {
      const res = await api.patch(`/conversations/${convId}/quote-settings`, settings);
      const convIndex = conversations.value.findIndex(c => c.id === convId);
      if (convIndex !== -1) {
        if (tasksMode.value && res.data.quoteCompleted) {
          // Instantly slice it out locally for immediate snappy feel
          conversations.value.splice(convIndex, 1);
          if (selectedConvId.value === convId) {
            selectedConvId.value = null;
          }
        } else {
          const conv = conversations.value[convIndex];
          conv.isCustomer = res.data.isCustomer;
          conv.quoteCompleted = res.data.quoteCompleted;
          conv.quoteCompletedByName = res.data.quoteCompletedByName;
        }
      }
    } catch (err) {
      console.error('Failed to update quote settings:', err);
    }
  }

  return {
    conversations,
    selectedConvId,
    selectedConv,
    messages,
    loadingConvs,
    loadingMsgs,
    loadingMoreMsgs,
    hasMoreMessages,
    sendingMsg,
    searchQuery,
    accountFilter,
    threadTypeFilter,
    categoryFilter,
    statusFilter,
    unreadMode,
    tasksMode,
    trackedMode,
    fetchConversations,
    selectConversation,
    loadMoreMessages,
    sendMessage,
    forwardMessage,
    recallMessage,
    deleteMessageForMe,
    sendFile,
    initSocket,
    destroySocket,
    toggleMute,
    updateQuoteSettings,
  };
}
