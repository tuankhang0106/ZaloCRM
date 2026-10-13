<template>
  <v-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" max-width="680" scrollable>
    <v-card rounded="xl" class="d-flex flex-column" style="max-height: 82vh;">
      <!-- Modal Header -->
      <v-card-title class="d-flex align-center justify-space-between pa-4 border-b">
        <div class="d-flex align-center" style="gap: 8px;">
          <v-icon color="primary" size="24">mdi-image-multiple</v-icon>
          <span class="text-subtitle-1 font-weight-bold">Kho ảnh sản phẩm</span>
        </div>
        <v-btn icon="mdi-close" variant="text" size="small" @click="$emit('update:modelValue', false)" />
      </v-card-title>

      <!-- Filter Bar: Search + Folder Chips -->
      <div class="pa-3 border-b bg-surface-variant-opacity">
        <div class="d-flex align-center mb-2" style="gap: 8px;">
          <v-text-field
            v-model="searchQuery"
            placeholder="Tìm theo tên ảnh..."
            prepend-inner-icon="mdi-magnify"
            variant="outlined"
            density="compact"
            hide-details
            rounded="lg"
            clearable
            @update:model-value="debounceSearch"
          />
        </div>

        <!-- Folder Pills -->
        <div class="d-flex align-center overflow-x-auto py-1" style="gap: 6px;">
          <v-chip
            size="small"
            :color="selectedFolderId === 'all' ? 'primary' : undefined"
            :variant="selectedFolderId === 'all' ? 'flat' : 'outlined'"
            class="font-weight-medium cursor-pointer"
            @click="selectFolder('all')"
          >
            Tất cả ({{ totalAll }})
          </v-chip>

          <v-chip
            size="small"
            :color="selectedFolderId === 'null' ? 'primary' : undefined"
            :variant="selectedFolderId === 'null' ? 'flat' : 'outlined'"
            class="font-weight-medium cursor-pointer"
            @click="selectFolder('null')"
          >
            Chưa phân loại ({{ totalUncategorized }})
          </v-chip>

          <v-chip
            v-for="folder in folders"
            :key="folder.id"
            size="small"
            :color="selectedFolderId === folder.id ? 'primary' : undefined"
            :variant="selectedFolderId === folder.id ? 'flat' : 'outlined'"
            class="font-weight-medium cursor-pointer"
            @click="selectFolder(folder.id)"
          >
            <v-avatar start size="8" :color="folder.color || 'primary'" class="mr-1" />
            {{ folder.name }} ({{ folder._count?.items || 0 }})
          </v-chip>
        </div>
      </div>

      <!-- Media Grid View Body -->
      <v-card-text class="pa-3 flex-grow-1 overflow-y-auto">
        <!-- Loading -->
        <div v-if="loading" class="text-center py-10">
          <v-progress-circular indeterminate color="primary" size="36" />
          <p class="text-caption text-medium-emphasis mt-2">Đang tải kho ảnh...</p>
        </div>

        <!-- Empty -->
        <div v-else-if="items.length === 0" class="text-center py-12 text-medium-emphasis">
          <v-icon size="40" class="mb-2" color="grey">mdi-image-search-outline</v-icon>
          <div class="text-subtitle-2 font-weight-bold">Không có hình ảnh nào</div>
          <div class="text-caption">Hãy tải ảnh lên kho từ mục "Kho hình ảnh" trên thanh menu.</div>
        </div>

        <!-- Thumbnails Grid -->
        <div v-else class="picker-grid">
          <div
            v-for="item in items"
            :key="item.id"
            class="picker-card"
            :class="{ 'picker-card-selected': selectedItemIds.includes(item.id) }"
            @click="toggleSelectItem(item.id)"
          >
            <v-img :src="item.url" cover aspect-ratio="1" loading="lazy" class="picker-thumb">
              <template #placeholder>
                <div class="d-flex align-center justify-center fill-height bg-grey-lighten-4">
                  <v-progress-circular indeterminate size="16" width="2" color="primary" />
                </div>
              </template>
              <template #error>
                <div class="d-flex align-center justify-center fill-height bg-grey-lighten-4 text-grey">
                  <v-icon size="20" color="grey">mdi-image-broken-variant</v-icon>
                </div>
              </template>
            </v-img>

            <!-- Selection Indicator -->
            <div class="picker-check" :class="{ 'picker-check-active': selectedItemIds.includes(item.id) }">
              <v-icon v-if="selectedItemIds.includes(item.id)" size="14" color="white">mdi-check</v-icon>
            </div>

            <!-- Title tooltip bar -->
            <div class="picker-caption text-truncate px-1" :title="item.name">
              {{ item.name }}
            </div>
          </div>
        </div>
      </v-card-text>

      <!-- Bottom Actions & Caption -->
      <v-card-actions class="pa-3 border-t d-flex flex-column align-stretch bg-surface" style="gap: 10px;">
        <!-- Optional Message Caption -->
        <v-text-field
          v-model="captionText"
          placeholder="Nhập lời nhắn kèm ảnh (tùy chọn)..."
          variant="outlined"
          density="compact"
          hide-details
          rounded="lg"
        />

        <div class="d-flex align-center justify-space-between">
          <span class="text-caption font-weight-bold" :class="selectedItemIds.length > 0 ? 'text-primary' : 'text-medium-emphasis'">
            {{ selectedItemIds.length > 0 ? `Đã chọn ${selectedItemIds.length} ảnh` : 'Chưa chọn ảnh nào' }}
          </span>

          <div class="d-flex align-center" style="gap: 8px;">
            <v-btn variant="text" rounded="lg" size="small" @click="$emit('update:modelValue', false)">
              Hủy
            </v-btn>

            <v-btn
              color="primary"
              variant="flat"
              rounded="lg"
              size="small"
              class="font-weight-bold px-4"
              prepend-icon="mdi-send"
              :disabled="selectedItemIds.length === 0"
              :loading="sending"
              @click="handleSendMedia"
            >
              Gửi qua Zalo ({{ selectedItemIds.length }})
            </v-btn>
          </div>
        </div>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { mediaApi, type MediaFolder, type MediaItem } from '@/api/media';

const props = defineProps<{
  modelValue: boolean;
  conversationId: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
  (e: 'sent'): void;
}>();

const folders = ref<MediaFolder[]>([]);
const items = ref<MediaItem[]>([]);
const totalAll = ref(0);
const totalUncategorized = ref(0);
const selectedFolderId = ref('all');
const searchQuery = ref('');
const loading = ref(false);
const sending = ref(false);

const selectedItemIds = ref<string[]>([]);
const captionText = ref('');

let searchTimer: any = null;
function debounceSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    fetchMedia();
  }, 300);
}

function selectFolder(id: string) {
  selectedFolderId.value = id;
  fetchMedia();
}

function toggleSelectItem(id: string) {
  const idx = selectedItemIds.value.indexOf(id);
  if (idx >= 0) {
    selectedItemIds.value.splice(idx, 1);
  } else {
    selectedItemIds.value.push(id);
  }
}

async function fetchFolders() {
  try {
    const res = await mediaApi.getFolders();
    folders.value = res.folders;
    totalUncategorized.value = res.totalUncategorized;
    totalAll.value = res.totalAll;
  } catch (err) {
    console.error('Failed to fetch folders in picker:', err);
  }
}

async function fetchMedia() {
  loading.value = true;
  try {
    const res = await mediaApi.getMedia({
      folderId: selectedFolderId.value,
      search: searchQuery.value,
      limit: 60,
    });
    items.value = res.items;
  } catch (err) {
    console.error('Failed to fetch media in picker:', err);
  } finally {
    loading.value = false;
  }
}

async function handleSendMedia() {
  if (selectedItemIds.value.length === 0 || !props.conversationId) return;

  sending.value = true;
  try {
    await mediaApi.sendMediaToChat(props.conversationId, {
      mediaItemIds: selectedItemIds.value,
      caption: captionText.value,
    });
    selectedItemIds.value = [];
    captionText.value = '';
    emit('update:modelValue', false);
    emit('sent');
  } catch (err) {
    console.error('Failed to send media to chat:', err);
    alert('Gửi ảnh thất bại. Vui lòng kiểm tra trạng thái Zalo.');
  } finally {
    sending.value = false;
  }
}

watch(
  () => props.modelValue,
  (val) => {
    if (val) {
      selectedItemIds.value = [];
      captionText.value = '';
      fetchFolders();
      fetchMedia();
    }
  }
);
</script>

<style scoped>
.picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 10px;
}

.picker-card {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.15s ease;
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.picker-card:hover {
  transform: scale(1.02);
}

.picker-card-selected {
  border-color: rgb(var(--v-theme-primary)) !important;
  box-shadow: 0 0 8px rgba(var(--v-theme-primary), 0.4);
}

.picker-thumb {
  width: 100%;
  aspect-ratio: 1;
}

.picker-check {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.8);
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.picker-check-active {
  background: rgb(var(--v-theme-primary)) !important;
  border-color: rgb(var(--v-theme-primary)) !important;
}

.picker-caption {
  font-size: 0.65rem;
  font-weight: 500;
  text-align: center;
  padding: 3px 2px;
  background: rgba(var(--v-theme-surface), 0.85);
}
</style>
