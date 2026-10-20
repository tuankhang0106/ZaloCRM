<template>
  <v-menu
    v-model="menuOpen"
    location="top start"
    :close-on-content-click="false"
    open-on-hover
    open-delay="150"
    close-delay="300"
    offset="8"
    transition="slide-y-reverse-transition"
  >
    <template #activator="{ props: menuProps }">
      <v-btn
        v-bind="menuProps"
        :icon="menuOpen ? 'mdi-message-flash' : 'mdi-message-flash-outline'"
        variant="text"
        color="warning"
        density="comfortable"
        title="Tin nhắn nhanh (Rê chuột hoặc bấm để chọn mẫu)"
        class="quick-reply-trigger-btn"
      />
    </template>

    <v-card
      class="quick-replies-card rounded-xl border elevation-10"
      width="390"
      max-height="480"
    >
      <!-- Header -->
      <div class="pa-3 pb-2 d-flex align-center border-bottom justify-space-between">
        <div class="d-flex align-center" style="gap: 6px;">
          <v-icon color="warning" size="20">mdi-message-flash-outline</v-icon>
          <span class="font-weight-bold text-subtitle-2">Tin nhắn nhanh</span>
          <v-chip size="x-small" color="warning" variant="tonal" class="ml-1 font-weight-bold">
            {{ filteredReplies.length }}
          </v-chip>
        </div>
        <div class="d-flex align-center" style="gap: 4px;">
          <v-btn
            size="x-small"
            variant="tonal"
            color="primary"
            prepend-icon="mdi-plus"
            class="text-none font-weight-bold"
            @click="openAddDialog"
          >
            Thêm mẫu
          </v-btn>
          <v-btn
            icon="mdi-close"
            size="x-small"
            variant="text"
            density="compact"
            @click="menuOpen = false"
          />
        </div>
      </div>

      <!-- Search input -->
      <div class="pa-2 pb-1">
        <v-text-field
          v-model="searchQuery"
          placeholder="Tìm mẫu tin nhắn..."
          prepend-inner-icon="mdi-magnify"
          density="compact"
          variant="solo-filled"
          hide-details
          clearable
          rounded="lg"
          class="quick-search-input text-caption"
        />
      </div>

      <!-- List of quick replies -->
      <div class="quick-replies-list overflow-y-auto px-2 py-1" style="max-height: 320px;">
        <div v-if="filteredReplies.length === 0" class="pa-6 text-center text-medium-emphasis text-caption">
          <v-icon icon="mdi-text-box-search-outline" size="32" class="mb-2 opacity-50" />
          <div>Không tìm thấy mẫu tin nhắn phù hợp</div>
        </div>

        <div
          v-for="(item, index) in filteredReplies"
          :key="item.id"
          :draggable="!searchQuery.trim()"
          class="quick-reply-item pa-2 mb-1 rounded-lg cursor-pointer transition-fast"
          :class="{
            'is-dragging': draggedIndex === index,
            'drag-over': dragOverIndex === index && draggedIndex !== index,
          }"
          @click="selectReply(item.content)"
          @dragstart="onDragStart(index, $event)"
          @dragover="onDragOver(index, $event)"
          @dragleave="onDragLeave(index)"
          @drop="onDrop(index, $event)"
          @dragend="onDragEnd"
        >
          <div class="d-flex align-center justify-space-between mb-1" style="gap: 8px;">
            <div class="d-flex align-center flex-grow-1 overflow-hidden" style="gap: 4px;">
              <v-icon
                v-if="!searchQuery.trim()"
                size="16"
                class="drag-handle flex-shrink-0"
                title="Kéo thả để sắp xếp thứ tự"
                @click.stop
              >
                mdi-drag-vertical
              </v-icon>
              <span class="font-weight-bold text-caption text-primary text-truncate flex-grow-1" :title="item.title">
                {{ item.title }}
              </span>
            </div>
            <div class="quick-reply-actions d-flex align-center flex-shrink-0" @dragstart.stop.prevent>
              <!-- Nút chỉnh sửa -->
              <v-btn
                icon
                size="x-small"
                variant="text"
                class="action-btn action-btn-edit"
                title="Chỉnh sửa mẫu này"
                @click.stop="openEditDialog(item)"
              >
                <v-icon size="16">mdi-pencil-outline</v-icon>
              </v-btn>
              <!-- Nút xóa -->
              <v-btn
                icon
                size="x-small"
                variant="text"
                class="action-btn action-btn-delete"
                title="Xóa mẫu này"
                @click.stop="deleteReply(item.id)"
              >
                <v-icon size="16">mdi-delete-outline</v-icon>
              </v-btn>
            </div>
          </div>
          <div class="text-caption text-medium-emphasis quick-reply-content" style="line-height: 1.35;">
            {{ item.content }}
          </div>
        </div>
      </div>
    </v-card>
  </v-menu>

  <!-- Add New Quick Reply Dialog -->
  <v-dialog v-model="showAddDialog" max-width="480" persistent>
    <v-card class="rounded-xl pa-2">
      <v-card-title class="d-flex align-center justify-space-between text-subtitle-1 font-weight-bold">
        <div class="d-flex align-center" style="gap: 8px;">
          <v-icon color="warning">mdi-plus-circle</v-icon>
          <span>Thêm mẫu tin nhắn nhanh</span>
        </div>
        <v-btn icon="mdi-close" variant="text" size="small" @click="showAddDialog = false" />
      </v-card-title>

      <v-card-text class="pt-2">
        <v-text-field
          v-model="newReplyTitle"
          label="Tiêu đề mẫu (Ví dụ: Chào khách, Báo giá...)"
          variant="outlined"
          density="compact"
          rounded="lg"
          class="mb-3"
          :error-messages="titleError"
        />
        <v-textarea
          v-model="newReplyContent"
          label="Nội dung tin nhắn *"
          variant="outlined"
          density="compact"
          rows="4"
          auto-grow
          rounded="lg"
          placeholder="Nhập nội dung tin nhắn sẽ gửi cho khách hàng..."
          :error-messages="contentError"
        />
      </v-card-text>

      <v-card-actions class="px-4 pb-3">
        <v-spacer />
        <v-btn variant="text" @click="showAddDialog = false">Hủy</v-btn>
        <v-btn color="primary" variant="flat" class="px-4 font-weight-bold" @click="saveNewReply">
          Lưu mẫu
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- Edit Quick Reply Dialog -->
  <v-dialog v-model="showEditDialog" max-width="480" persistent>
    <v-card class="rounded-xl pa-2">
      <v-card-title class="d-flex align-center justify-space-between text-subtitle-1 font-weight-bold">
        <div class="d-flex align-center" style="gap: 8px;">
          <v-icon color="info">mdi-pencil</v-icon>
          <span>Chỉnh sửa mẫu tin nhắn</span>
        </div>
        <v-btn icon="mdi-close" variant="text" size="small" @click="showEditDialog = false" />
      </v-card-title>

      <v-card-text class="pt-2">
        <v-text-field
          v-model="editReplyTitle"
          label="Tiêu đề mẫu"
          variant="outlined"
          density="compact"
          rounded="lg"
          class="mb-3"
          :error-messages="editTitleError"
        />
        <v-textarea
          v-model="editReplyContent"
          label="Nội dung tin nhắn *"
          variant="outlined"
          density="compact"
          rows="5"
          auto-grow
          rounded="lg"
          placeholder="Nhập nội dung tin nhắn sẽ gửi cho khách hàng..."
          :error-messages="editContentError"
        />
      </v-card-text>

      <v-card-actions class="px-4 pb-3">
        <v-spacer />
        <v-btn variant="text" @click="showEditDialog = false">Hủy</v-btn>
        <v-btn color="primary" variant="flat" class="px-4 font-weight-bold" @click="saveEditReply">
          Lưu thay đổi
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

export interface QuickReplyItem {
  id: string;
  title: string;
  content: string;
  isDefault?: boolean;
}

const emit = defineEmits<{
  select: [content: string];
  'send-instant': [content: string];
}>();

const menuOpen = ref(false);
const searchQuery = ref('');

// Add dialog state
const showAddDialog = ref(false);
const newReplyTitle = ref('');
const newReplyContent = ref('');
const titleError = ref('');
const contentError = ref('');

// Edit dialog state
const showEditDialog = ref(false);
const editingItem = ref<QuickReplyItem | null>(null);
const editReplyTitle = ref('');
const editReplyContent = ref('');
const editTitleError = ref('');
const editContentError = ref('');

const DEFAULT_REPLIES: QuickReplyItem[] = [
  {
    id: 'default-1',
    title: 'Chào hỏi ban đầu',
    content: 'Dạ em chào anh/chị ạ! Em có thể hỗ trợ gì cho mình hôm nay ạ?',
    isDefault: true,
  },
  {
    id: 'default-2',
    title: 'Gửi bảng giá & mẫu có sẵn',
    content: 'Dạ em gửi anh/chị xem bảng giá và các mẫu mới nhất có sẵn bên em ạ. Anh/chị xem ưng mẫu nào báo em tư vấn chi tiết nhé!',
    isDefault: true,
  },
  {
    id: 'default-3',
    title: 'Tư vấn size & form áo',
    content: 'Dạ anh/chị cho em xin chiều cao và cân nặng để em chọn size chuẩn và form ôm/suông đẹp nhất cho mình nha!',
    isDefault: true,
  },
  {
    id: 'default-4',
    title: 'Xin thông tin lên đơn',
    content: 'Dạ anh/chị cho em xin Số điện thoại + Địa chỉ nhận hàng cụ thể để em lên đơn và đóng gói gửi sớm cho mình ạ.',
    isDefault: true,
  },
  {
    id: 'default-5',
    title: 'Xác nhận đơn thành công',
    content: 'Dạ em đã tạo đơn hàng thành công cho mình rồi ạ! Bên em đang tiến hành đóng gói và sẽ gửi mã vận đơn cho anh/chị theo dõi ngay nhé.',
    isDefault: true,
  },
  {
    id: 'default-6',
    title: 'Kiểm tra kho hàng',
    content: 'Dạ anh/chị đợi em một chút, em đang kiểm tra số lượng thực tế trong kho và báo lại ngay cho mình nhé ạ!',
    isDefault: true,
  },
  {
    id: 'default-7',
    title: 'Lời cảm ơn khách hàng',
    content: 'Dạ em cảm ơn anh/chị rất nhiều đã tin tưởng và ủng hộ bên em ạ! Chúc anh/chị một ngày thật nhiều niềm vui và may mắn!',
    isDefault: true,
  },
];

const quickReplies = ref<QuickReplyItem[]>([]);

function loadReplies() {
  const saved = localStorage.getItem('crm-quick-replies');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        quickReplies.value = parsed;
        return;
      }
    } catch {}
  }
  quickReplies.value = [...DEFAULT_REPLIES];
  saveToStorage();
}

function saveToStorage() {
  localStorage.setItem('crm-quick-replies', JSON.stringify(quickReplies.value));
}

const filteredReplies = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return quickReplies.value;
  return quickReplies.value.filter(
    r => r.title.toLowerCase().includes(q) || r.content.toLowerCase().includes(q)
  );
});

function selectReply(content: string) {
  emit('select', content);
  menuOpen.value = false;
}

// ── Drag & Drop reordering ──────────────────────────────────────────────
const draggedIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);

function onDragStart(index: number, event: DragEvent) {
  if (searchQuery.value.trim()) return;
  draggedIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  }
}

function onDragOver(index: number, event: DragEvent) {
  if (searchQuery.value.trim() || draggedIndex.value === null) return;
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
  dragOverIndex.value = index;
}

function onDragLeave(index: number) {
  if (dragOverIndex.value === index) {
    dragOverIndex.value = null;
  }
}

function onDrop(dropIndex: number, event: DragEvent) {
  event.preventDefault();
  if (
    searchQuery.value.trim() ||
    draggedIndex.value === null ||
    draggedIndex.value === dropIndex
  ) {
    draggedIndex.value = null;
    dragOverIndex.value = null;
    return;
  }

  const items = [...quickReplies.value];
  const [movedItem] = items.splice(draggedIndex.value, 1);
  if (movedItem) {
    items.splice(dropIndex, 0, movedItem);
    quickReplies.value = items;
    saveToStorage();
  }

  draggedIndex.value = null;
  dragOverIndex.value = null;
}

function onDragEnd() {
  draggedIndex.value = null;
  dragOverIndex.value = null;
}



// ── Add new ─────────────────────────────────────────────────────────────
function openAddDialog() {
  newReplyTitle.value = '';
  newReplyContent.value = '';
  titleError.value = '';
  contentError.value = '';
  showAddDialog.value = true;
}

function saveNewReply() {
  titleError.value = '';
  contentError.value = '';

  const title = newReplyTitle.value.trim();
  const content = newReplyContent.value.replace(/^[\r\n]+/, '').trimEnd();

  if (!content) {
    contentError.value = 'Vui lòng nhập nội dung tin nhắn';
    return;
  }

  const finalTitle = title || (content.length > 30 ? content.slice(0, 30) + '...' : content);

  quickReplies.value.unshift({
    id: 'custom-' + Date.now(),
    title: finalTitle,
    content,
    isDefault: false,
  });

  saveToStorage();
  showAddDialog.value = false;
}

// ── Edit existing ───────────────────────────────────────────────────────
function openEditDialog(item: QuickReplyItem) {
  editingItem.value = item;
  editReplyTitle.value = item.title;
  editReplyContent.value = item.content;
  editTitleError.value = '';
  editContentError.value = '';
  showEditDialog.value = true;
}

function saveEditReply() {
  if (!editingItem.value) return;
  editTitleError.value = '';
  editContentError.value = '';

  const title = editReplyTitle.value.trim();
  const content = editReplyContent.value.replace(/^[\r\n]+/, '').trimEnd();

  if (!content) {
    editContentError.value = 'Vui lòng nhập nội dung tin nhắn';
    return;
  }

  const finalTitle = title || (content.length > 30 ? content.slice(0, 30) + '...' : content);

  const idx = quickReplies.value.findIndex(r => r.id === editingItem.value?.id);
  if (idx !== -1) {
    quickReplies.value[idx] = {
      ...quickReplies.value[idx],
      title: finalTitle,
      content,
    };
    saveToStorage();
  }

  showEditDialog.value = false;
  editingItem.value = null;
}

// ── Delete ──────────────────────────────────────────────────────────────
function deleteReply(id: string) {
  quickReplies.value = quickReplies.value.filter(r => r.id !== id);
  saveToStorage();
}

onMounted(() => {
  loadReplies();
});
</script>

<style scoped>
.quick-reply-trigger-btn {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.quick-reply-trigger-btn:hover {
  transform: scale(1.1);
}

.quick-replies-card {
  backdrop-filter: blur(16px);
  overflow: hidden;
}

.quick-reply-item {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity, 0.1));
  background: rgba(var(--v-theme-surface), 0.5);
  transition: all 0.2s ease;
  position: relative;
}

.quick-reply-item:hover {
  background: rgba(var(--v-theme-primary), 0.08);
  border-color: rgba(var(--v-theme-primary), 0.35);
  transform: translateX(2px);
}

.quick-reply-item.is-dragging {
  opacity: 0.35 !important;
  transform: scale(0.98);
  border: 1.5px dashed rgba(var(--v-theme-primary), 0.7) !important;
  background: rgba(var(--v-theme-primary), 0.05) !important;
}

.quick-reply-item.drag-over {
  border-color: #1976d2 !important;
  background-color: rgba(25, 118, 210, 0.12) !important;
  box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.3) inset !important;
  transform: translateY(-2px);
}

.drag-handle {
  cursor: grab;
  color: rgba(var(--v-theme-on-surface), 0.35);
  transition: color 0.15s ease, transform 0.15s ease;
  user-select: none;
}

.quick-reply-item:hover .drag-handle {
  color: rgba(var(--v-theme-primary), 0.85);
}

.drag-handle:active {
  cursor: grabbing;
}

.quick-reply-content {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  word-break: break-word;
  white-space: pre-wrap;
  tab-size: 4;
}

.quick-reply-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  opacity: 0.75;
  transition: opacity 0.2s ease;
}

.quick-reply-item:hover .quick-reply-actions {
  opacity: 1;
}

.action-btn {
  width: 26px !important;
  height: 26px !important;
  min-width: 26px !important;
  max-width: 26px !important;
  border-radius: 6px !important;
  padding: 0 !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
  background-color: transparent !important;
}

.action-btn-edit {
  color: #1976d2 !important;
}

.action-btn-edit:hover {
  background-color: rgba(25, 118, 210, 0.12) !important;
  color: #1565c0 !important;
  transform: scale(1.1);
}

.action-btn-delete {
  color: #e53935 !important;
}

.action-btn-delete:hover {
  background-color: rgba(229, 57, 53, 0.12) !important;
  color: #c62828 !important;
  transform: scale(1.1);
}

/* Scrollbar refinement */
.quick-replies-list::-webkit-scrollbar {
  width: 4px;
}
.quick-replies-list::-webkit-scrollbar-thumb {
  background: rgba(var(--v-theme-primary), 0.2);
  border-radius: 4px;
}
</style>
