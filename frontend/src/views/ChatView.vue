<template>
  <div class="chat-container d-flex" >
    <!-- Conversation list — resizable (hidden on mobile if chat active) -->
    <div
      v-show="!mobile || !selectedConvId"
      class="chat-panel-left"
      :style="mobile ? { width: '100%' } : { width: leftWidth + 'px' }"
    >
      <ConversationList
        :conversations="visibleConversations"
        :account-id="accountFilter"
        @filter-account="onFilterAccount"
        :action="typeof route.query.action === 'string' ? route.query.action : undefined"
        :active-tab="activeConversationTab"
        @change-tab="changeConversationTab"
        @action-handled="clearAccountAction"
        :selected-id="selectedConvId"
        :loading="loadingConvs"
        v-model:search="searchQuery"
        @select="selectConversation"
        @refresh-conversations="fetchConversations"
        @toggle-mute="handleToggleMute"
        :mode="(route.query.mode as string) || ''"
      />
      <!-- Resize handle (only on desktop) -->
      <div v-if="!mobile" class="resize-handle" @mousedown="startResize('left', $event)" />
    </div>

    <!-- Message thread — flexible center (hidden on mobile if no active chat) -->
    <MessageThread
      v-if="!mobile || selectedConvId"
      :conversation="selectedConv"
      :messages="messages"
      :loading="loadingMsgs"
      :sending="sendingMsg"
      @send="sendMessage"
      @send-file="sendFile"
      @recall-message="recallMessage"
      @delete-message-for-me="deleteMessageForMe"
      @toggle-mute="handleToggleMute"
      @toggle-contact-panel="showContactPanel = !showContactPanel"
      :show-contact-panel="showContactPanel"
      :is-mobile="mobile"
      @back="selectedConvId = null"
      @group-updated="fetchConversations()"
      @contact-updated="fetchConversations()"
      style="flex: 1; min-width: 300px; height: 100%;"
    />

    <!-- Contact panel — resizable (desktop only) -->
    <div v-if="!mobile && showContactPanel && selectedConv" class="chat-panel-right" :style="{ width: rightWidth + 'px' }">
      <div class="resize-handle resize-handle-left" @mousedown="startResize('right', $event)" />
      <ChatContactPanel
        :contact-id="selectedConv.contact?.id || null"
        :contact="selectedConv.contact || null"
        :conversation-id="selectedConv.id"
        :conversation="selectedConv"
        @close="showContactPanel = false"
        @saved="fetchConversations()"
        @toggle-mute="handleToggleMute(selectedConv.id, !selectedConv.isMuted)"
      />
    </div>

    <!-- Contact panel — navigation drawer overlay (mobile only) -->
    <v-navigation-drawer
      v-if="mobile && showContactPanel && selectedConv"
      v-model="showContactPanel"
      location="right"
      temporary
      width="340"
      style="z-index: 1008;"
    >
      <ChatContactPanel
        :contact-id="selectedConv.contact?.id || null"
        :contact="selectedConv.contact || null"
        :conversation-id="selectedConv.id"
        :conversation="selectedConv"
        @close="showContactPanel = false"
        @saved="fetchConversations()"
        @toggle-mute="handleToggleMute(selectedConv.id, !selectedConv.isMuted)"
      />
    </v-navigation-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue';
import { useDisplay } from 'vuetify';
import { useRoute, useRouter } from 'vue-router';
import ConversationList from '@/components/chat/ConversationList.vue';
import MessageThread from '@/components/chat/MessageThread.vue';
import ChatContactPanel from '@/components/chat/ChatContactPanel.vue';
import { useChat } from '@/composables/use-chat';

const route = useRoute();
const router = useRouter();
const { mobile } = useDisplay();

const {
  conversations, selectedConvId, selectedConv, messages,
  loadingConvs, loadingMsgs, sendingMsg, searchQuery, accountFilter,
  tasksMode, trackedMode, unreadMode, categoryFilter, statusFilter, threadTypeFilter,
  fetchConversations, selectConversation, sendMessage, sendFile,
  recallMessage, deleteMessageForMe,
  initSocket, destroySocket, toggleMute,
} = useChat();

async function handleToggleMute(convId: string, isMuted: boolean) {
  try {
    await toggleMute(convId, isMuted);
  } catch (err) {
    console.error('Failed to toggle mute:', err);
  }
}


function onFilterAccount(accountId: string | null) {
  const { accountId: _account, convId: _conv, ...query } = route.query;
  router.replace({ path: '/chat', query: accountId ? { ...query, accountId } : query });
}

const showContactPanel = ref(true);

// Resizable panel widths (restored from localStorage)
const leftWidth = ref(parseInt(localStorage.getItem('chat-left-width') || '320'));
const rightWidth = ref(parseInt(localStorage.getItem('chat-right-width') || '320'));

let resizing: 'left' | 'right' | null = null;
let startX = 0;
let startWidth = 0;

function startResize(panel: 'left' | 'right', e: MouseEvent) {
  resizing = panel;
  startX = e.clientX;
  startWidth = panel === 'left' ? leftWidth.value : rightWidth.value;
  document.addEventListener('mousemove', onResize);
  document.addEventListener('mouseup', stopResize);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}

function onResize(e: MouseEvent) {
  if (!resizing) return;
  const diff = e.clientX - startX;
  if (resizing === 'left') {
    leftWidth.value = Math.max(200, Math.min(500, startWidth + diff));
  } else {
    rightWidth.value = Math.max(250, Math.min(500, startWidth - diff));
  }
}

function stopResize() {
  if (resizing) {
    localStorage.setItem('chat-left-width', String(leftWidth.value));
    localStorage.setItem('chat-right-width', String(rightWidth.value));
  }
  resizing = null;
  document.removeEventListener('mousemove', onResize);
  document.removeEventListener('mouseup', stopResize);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
}

onMounted(async () => {
  initSocket();
  const initialConvId = route.query.convId as string;
  if (initialConvId) {
    await fetchConversations();
    selectConversation(initialConvId);
  }
});
onUnmounted(() => { destroySocket(); });

const activeConversationTab = computed(() => {
  if (['unread', 'personal', 'group'].includes(String(route.query.tab))) return String(route.query.tab);
  return route.query.mode === 'unread' ? 'unread' : 'all';
});
function changeConversationTab(tab: string) {
  const { tab: _tab, mode, ...query } = route.query;
  router.replace({ path: '/chat', query: {
    ...query, ...(mode && mode !== 'unread' ? { mode } : {}), ...(tab !== 'all' ? { tab } : {}),
  } });
}
function clearAccountAction(action: string) {
  if (route.query.action !== action) return;
  const { action: _action, ...query } = route.query;
  router.replace({ path: '/chat', query });
}

const visibleConversations = computed(() => {
  let list = unreadMode.value
    ? conversations.value.filter(c => c.unreadCount > 0 || c.id === selectedConvId.value)
    : conversations.value;
  if (statusFilter.value) {
    list = list.filter(c => {
      const cStatus = c.contact?.status || 'new';
      if (statusFilter.value === 'completed') {
        return cStatus === 'completed' || cStatus === 'vip';
      }
      return cStatus === statusFilter.value;
    });
  }
  return list;
});

// Keep account and mode filters in sync with navigation.
watch(
  () => [route.query.mode, route.query.accountId, route.query.category, route.query.status, activeConversationTab.value],
  ([newMode, accountId, category, status, tab]) => {
    threadTypeFilter.value = tab === 'personal' ? 'user' : tab === 'group' ? 'group' : null;
    categoryFilter.value = typeof category === 'string' ? category : null;
    statusFilter.value = typeof status === 'string' ? status : null;
    accountFilter.value = typeof accountId === 'string' ? accountId : null;
    unreadMode.value = tab === 'unread';
    tasksMode.value = newMode === 'tasks';
    trackedMode.value = newMode === 'tracked';
    fetchConversations();
  },
  { immediate: true }
);

// Watch route query to auto-select conversation when query param changes
watch(
  () => route.query.convId,
  (newConvId) => {
    if (newConvId && newConvId !== selectedConvId.value) {
      selectConversation(newConvId as string);
    }
  }
);


let searchTimeout: ReturnType<typeof setTimeout>;
watch(searchQuery, () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => fetchConversations(), 300);
});
</script>

<style scoped>
.chat-container {
  margin: 0;
  height: 100%;
  min-height: 0;
}

.chat-panel-left {
  position: relative;
  flex-shrink: 0;
  min-width: 200px;
  max-width: 500px;
  background: rgba(var(--v-theme-surface), 0.7) !important;
  border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)) !important;
  backdrop-filter: blur(12px);
}

.chat-panel-right {
  position: relative;
  flex-shrink: 0;
  min-width: 250px;
  max-width: 500px;
  background: rgba(var(--v-theme-surface), 0.7) !important;
  border-left: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)) !important;
  backdrop-filter: blur(12px);
}

/* Resize handle — thin vertical line on the edge */
.resize-handle {
  position: absolute;
  top: 0;
  right: -2px;
  width: 5px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
  background: transparent;
  transition: background 0.2s;
}

.resize-handle:hover,
.resize-handle:active {
  background: rgba(var(--v-theme-primary), 0.35);
}

.resize-handle-left {
  right: auto;
  left: -2px;
}
</style>
