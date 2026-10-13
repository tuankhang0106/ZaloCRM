<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="560"
    scrollable
  >
    <v-card rounded="xl" class="d-flex flex-column forward-dialog-card" style="max-height: 85vh;">
      <!-- Header -->
      <v-card-title class="d-flex align-center justify-space-between pa-4 border-b">
        <div class="d-flex align-center" style="gap: 8px;">
          <v-icon color="primary" size="22">mdi-share</v-icon>
          <span class="text-subtitle-1 font-weight-bold">Chuyển tiếp tin nhắn</span>
        </div>
        <v-btn icon="mdi-close" variant="text" size="small" @click="$emit('update:modelValue', false)" />
      </v-card-title>

      <!-- Message Preview Box -->
      <div v-if="targetMessages.length === 1" class="pa-3 bg-surface-variant-opacity border-b">
        <div class="text-caption font-weight-bold mb-1 d-flex align-center" style="color: rgba(var(--v-theme-on-surface), 0.7); gap: 4px;">
          <v-icon size="14">mdi-message-text-outline</v-icon>
          <span>Nội dung chuyển tiếp:</span>
        </div>
        
        <!-- Image Preview -->
        <div v-if="getImageUrl(targetMessages[0])" class="forward-preview-image d-flex align-center pa-2 rounded-lg" style="background: rgba(var(--v-theme-surface), 0.8); border: 1px solid rgba(var(--v-border-color), 0.12); gap: 12px;">
          <img :src="getImageUrl(targetMessages[0])!" alt="Ảnh chuyển tiếp" class="forward-img-thumb rounded" />
          <div class="flex-grow-1 text-truncate">
            <div class="text-body-2 font-weight-medium">[Hình ảnh]</div>
            <div v-if="getImageCaption(targetMessages[0])" class="text-caption text-truncate" style="opacity: 0.75;">
              {{ getImageCaption(targetMessages[0]) }}
            </div>
          </div>
        </div>

        <!-- File Preview -->
        <div v-else-if="getFileInfo(targetMessages[0])" class="d-flex align-center pa-2 rounded-lg" style="background: rgba(var(--v-theme-surface), 0.8); border: 1px solid rgba(var(--v-border-color), 0.12); gap: 10px;">
          <v-icon color="info" size="24">mdi-file-document-outline</v-icon>
          <div class="flex-grow-1 text-truncate">
            <div class="text-body-2 font-weight-medium text-truncate">{{ getFileInfo(targetMessages[0])!.name }}</div>
            <div class="text-caption" style="opacity: 0.7;">{{ getFileInfo(targetMessages[0])!.size }}</div>
          </div>
        </div>

        <!-- Text Preview -->
        <div v-else class="forward-preview-text pa-2.5 px-3 rounded-lg text-body-2" style="background: rgba(var(--v-theme-surface), 0.8); border: 1px solid rgba(var(--v-border-color), 0.12); max-height: 120px; overflow-y: auto; white-space: pre-wrap; word-break: break-word;">
          {{ targetMessages[0].content }}
        </div>
      </div>

      <!-- Multiple Messages Preview Box -->
      <div v-else-if="targetMessages.length > 1" class="pa-3 bg-surface-variant-opacity border-b">
        <div class="d-flex align-center pa-2.5 rounded-lg" style="background: rgba(var(--v-theme-surface), 0.8); border: 1px solid rgba(var(--v-border-color), 0.12); gap: 10px;">
          <v-icon color="primary" size="24">mdi-checkbox-multiple-marked-outline</v-icon>
          <div class="text-body-2 font-weight-medium">
            Chuyển tiếp <strong>{{ targetMessages.length }}</strong> tin nhắn đã chọn
          </div>
        </div>
      </div>

      <!-- Search Input -->
      <div class="pa-3 border-b">
        <v-text-field
          v-model="searchQuery"
          placeholder="Tìm tên khách hàng, số điện thoại, nhóm..."
          prepend-inner-icon="mdi-magnify"
          variant="outlined"
          density="compact"
          hide-details
          rounded="lg"
          clearable
          autocomplete="off"
        />
      </div>

      <!-- Conversations Selection List -->
      <v-card-text class="pa-0 flex-grow-1 overflow-y-auto" style="min-height: 220px; max-height: 340px;">
        <v-progress-linear v-if="loadingConvs" indeterminate color="primary" />

        <div v-if="filteredConversations.length === 0 && !loadingConvs" class="pa-8 text-center text-medium-emphasis">
          <v-icon size="36" class="mb-2" style="opacity: 0.5;">mdi-account-search-outline</v-icon>
          <div class="text-body-2">Không tìm thấy cuộc trò chuyện phù hợp</div>
        </div>

        <v-list v-else lines="two" class="py-1">
          <v-list-item
            v-for="conv in filteredConversations"
            :key="conv.id"
            :value="conv.id"
            class="px-4 py-2 cursor-pointer conversation-select-item"
            :class="{ 'selected-conv': selectedConvIds.includes(conv.id) }"
            @click="toggleSelection(conv.id)"
          >
            <!-- Checkbox -->
            <template #prepend>
              <v-checkbox-btn
                :model-value="selectedConvIds.includes(conv.id)"
                color="primary"
                class="mr-2"
                density="compact"
              />
              <v-avatar size="36" class="mr-3">
                <v-img v-if="getAvatar(conv)" :src="getAvatar(conv) || ''" :alt="getDisplayName(conv)" />
                <span v-else class="font-weight-bold text-white text-caption" :style="{ backgroundColor: getStaffColor(getDisplayName(conv)) }">
                  {{ (getDisplayName(conv) || '?')[0].toUpperCase() }}
                </span>
              </v-avatar>
            </template>

            <!-- Title & Subtitle -->
            <v-list-item-title class="font-weight-medium text-body-2 d-flex align-center" style="gap: 6px;">
              <span class="text-truncate">{{ getDisplayName(conv) }}</span>
              <v-chip
                v-if="conv.threadType === 'group'"
                size="x-small"
                variant="tonal"
                color="info"
                class="px-1.5"
                style="height: 18px; font-size: 0.65rem;"
              >
                Nhóm
              </v-chip>
            </v-list-item-title>

            <v-list-item-subtitle class="text-caption mt-0.5 text-medium-emphasis text-truncate">
              {{ conv.contact?.phone || conv.zaloAccount?.displayName || 'Cuộc trò chuyện Zalo' }}
            </v-list-item-subtitle>
          </v-list-item>
        </v-list>
      </v-card-text>

      <!-- Optional Extra Message Input -->
      <div class="pa-3 border-t bg-surface-variant-opacity">
        <v-textarea
          v-model="extraText"
          placeholder="Lời nhắn kèm (không bắt buộc)..."
          variant="outlined"
          density="compact"
          rows="1"
          max-rows="3"
          auto-grow
          hide-details
          rounded="lg"
        />
      </div>

      <!-- Footer Buttons -->
      <v-card-actions class="pa-3 px-4 border-t d-flex align-center justify-space-between">
        <div class="text-caption text-medium-emphasis font-weight-medium">
          <span v-if="selectedConvIds.length > 0">Đã chọn: <strong>{{ selectedConvIds.length }}</strong> hội thoại</span>
          <span v-else>Chọn người nhận để chuyển tiếp</span>
        </div>
        <div class="d-flex align-center" style="gap: 8px;">
          <v-btn
            variant="text"
            rounded="lg"
            :disabled="forwarding"
            @click="$emit('update:modelValue', false)"
          >
            Hủy
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            rounded="lg"
            prepend-icon="mdi-send"
            :loading="forwarding"
            :disabled="selectedConvIds.length === 0 || targetMessages.length === 0"
            @click="handleForward"
          >
            Chuyển tiếp
          </v-btn>
        </div>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { Message, Conversation } from '@/composables/use-chat';
import { api } from '@/api/index';

const props = defineProps<{
  modelValue: boolean;
  message?: Message | null;
  messages?: Message[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'forward-success': [count: number];
}>();

const targetMessages = computed<Message[]>(() => {
  if (props.messages && props.messages.length > 0) {
    return props.messages;
  }
  if (props.message) {
    return [props.message];
  }
  return [];
});

const conversations = ref<Conversation[]>([]);
const loadingConvs = ref(false);
const searchQuery = ref('');
const selectedConvIds = ref<string[]>([]);
const extraText = ref('');
const forwarding = ref(false);

watch(() => props.modelValue, (isOpen) => {
  if (isOpen) {
    selectedConvIds.value = [];
    extraText.value = '';
    searchQuery.value = '';
    loadConversations();
  }
});

async function loadConversations() {
  loadingConvs.value = true;
  try {
    const res = await api.get('/conversations', { params: { limit: 100 } });
    conversations.value = res.data.conversations || [];
  } catch (err) {
    console.error('Failed to load conversations for forward:', err);
  } finally {
    loadingConvs.value = false;
  }
}

const filteredConversations = computed(() => {
  if (!searchQuery.value?.trim()) return conversations.value;
  const q = searchQuery.value.trim().toLowerCase();
  return conversations.value.filter((c: Conversation) => {
    const name = getDisplayName(c).toLowerCase();
    const phone = (c.contact?.phone || '').toLowerCase();
    const acc = (c.zaloAccount?.displayName || '').toLowerCase();
    return name.includes(q) || phone.includes(q) || acc.includes(q);
  });
});

function toggleSelection(id: string) {
  const idx = selectedConvIds.value.indexOf(id);
  if (idx >= 0) {
    selectedConvIds.value.splice(idx, 1);
  } else {
    selectedConvIds.value.push(id);
  }
}

function getDisplayName(c: Conversation): string {
  if (c.contact?.fullName) return c.contact.fullName;
  if (c.groupName) return c.groupName;
  return c.contact?.phone || 'Khách hàng';
}

function getAvatar(c: Conversation): string | null {
  return c.contact?.avatarUrl || null;
}

function getImageUrl(msg: Message | null): string | null {
  if (!msg) return null;
  if (msg.contentType === 'image' && msg.content) {
    if (msg.content.startsWith('http')) return msg.content;
    try {
      const p = JSON.parse(msg.content);
      return p.href || p.thumb || p.hdUrl || null;
    } catch {}
  }
  if (msg.content?.startsWith('{')) {
    try {
      const p = JSON.parse(msg.content);
      const href = p.href || p.thumb || '';
      if (href && /\.(jpg|jpeg|png|webp|gif)/i.test(href)) return href;
    } catch {}
  }
  return null;
}

function getImageCaption(msg: Message | null): string | null {
  if (!msg?.content || !msg.content.startsWith('{')) return null;
  try {
    const p = JSON.parse(msg.content);
    return p.title || p.caption || p.description || null;
  } catch {}
  return null;
}

function getFileInfo(msg: Message | null): { name: string; size: string } | null {
  if (!msg?.content?.startsWith('{')) return null;
  try {
    const p = JSON.parse(msg.content);
    const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
    if (params?.fileExt || params?.fType === 1) {
      const bytes = parseInt(params.fileSize || '0');
      const size = bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
      return { name: p.title || `file.${params.fileExt || 'unknown'}`, size };
    }
  } catch {}
  return null;
}

function getStaffColor(name: string | null | undefined): string {
  if (!name) return '#007AFF';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = ['#0284C7', '#2563EB', '#D97706', '#7C3AED', '#059669', '#E11D48', '#EA580C', '#0D9488'];
  return colors[Math.abs(hash) % colors.length];
}

async function handleForward() {
  if (targetMessages.value.length === 0 || selectedConvIds.value.length === 0) return;
  forwarding.value = true;
  try {
    let totalForwarded = 0;
    for (let i = 0; i < targetMessages.value.length; i++) {
      const msg = targetMessages.value[i];
      const isLast = i === targetMessages.value.length - 1;
      const res = await api.post('/conversations/forward', {
        targetConversationIds: selectedConvIds.value,
        messageId: msg.id,
        extraText: isLast && extraText.value?.trim() ? extraText.value.trim() : undefined,
      });
      totalForwarded += res.data?.forwardedCount || selectedConvIds.value.length;
    }
    emit('forward-success', totalForwarded);
    emit('update:modelValue', false);
  } catch (err) {
    console.error('Forward failed:', err);
  } finally {
    forwarding.value = false;
  }
}
</script>

<style scoped>
.forward-dialog-card {
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.22) !important;
}

.conversation-select-item {
  transition: background-color 0.15s ease;
}

.conversation-select-item:hover {
  background-color: rgba(var(--v-theme-primary), 0.04);
}

.selected-conv {
  background-color: rgba(var(--v-theme-primary), 0.08) !important;
}

.forward-img-thumb {
  width: 52px;
  height: 52px;
  object-fit: cover;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.bg-surface-variant-opacity {
  background-color: rgba(var(--v-theme-surface-variant), 0.35);
}
</style>
