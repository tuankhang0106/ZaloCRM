<template>
  <div class="media-view-container pa-4 pa-md-6">
    <!-- Header Page -->
    <div class="d-flex flex-column flex-sm-row align-sm-center justify-space-between mb-6" style="gap: 16px;">
      <div>
        <h1 class="text-h5 font-weight-bold d-flex align-center" style="gap: 10px;">
          <v-icon color="primary" size="28">mdi-image-multiple-outline</v-icon>
          Kho hình ảnh sản phẩm
        </h1>
        <p class="text-caption text-medium-emphasis mb-0 mt-1">
          Lưu trữ ảnh sản phẩm, bảng giá, feedback để gửi nhanh cho khách hàng qua Zalo
        </p>
      </div>

      <div class="d-flex align-center flex-wrap" style="gap: 10px;">
        <v-btn
          variant="tonal"
          prepend-icon="mdi-folder-plus-outline"
          class="text-none font-weight-bold"
          rounded="lg"
          @click="openCreateFolderDialog"
        >
          Thêm Album
        </v-btn>

        <v-btn
          color="primary"
          variant="flat"
          prepend-icon="mdi-cloud-upload-outline"
          class="text-none font-weight-bold"
          rounded="lg"
          :loading="uploading"
          @click="triggerFileInput"
        >
          Tải ảnh lên
        </v-btn>
        <input
          type="file"
          ref="fileInputRef"
          class="d-none"
          accept="image/*"
          multiple
          @change="handleFileUpload"
        />
      </div>
    </div>

    <!-- Main Grid Content -->
    <v-row>
      <!-- Left Column: Folders / Albums -->
      <v-col cols="12" md="3" lg="3">
        <v-card rounded="xl" border class="pa-3 elevation-0 mb-4 bg-surface">
          <div class="d-flex align-center justify-space-between px-2 py-1 mb-2">
            <span class="text-subtitle-2 font-weight-bold text-uppercase" style="letter-spacing: 0.05em; font-size: 0.75rem !important;">
              Album / Thư mục
            </span>
            <v-chip size="x-small" color="primary" variant="flat">
              {{ folders.length + 2 }}
            </v-chip>
          </div>

          <v-list density="compact" nav class="pa-0">
            <!-- All items -->
            <v-list-item
              :active="selectedFolderId === 'all'"
              rounded="lg"
              class="mb-1"
              @click="selectFolder('all')"
            >
              <template #prepend>
                <v-icon size="20" class="mr-3" color="primary">mdi-image-multiple</v-icon>
              </template>
              <v-list-item-title class="font-weight-medium">Tất cả ảnh</v-list-item-title>
              <template #append>
                <span class="text-caption font-weight-bold text-medium-emphasis">{{ totalAll }}</span>
              </template>
            </v-list-item>

            <!-- Uncategorized -->
            <v-list-item
              :active="selectedFolderId === 'null'"
              rounded="lg"
              class="mb-1"
              @click="selectFolder('null')"
            >
              <template #prepend>
                <v-icon size="20" class="mr-3" color="grey">mdi-folder-open-outline</v-icon>
              </template>
              <v-list-item-title class="font-weight-medium">Chưa phân loại</v-list-item-title>
              <template #append>
                <span class="text-caption font-weight-bold text-medium-emphasis">{{ totalUncategorized }}</span>
              </template>
            </v-list-item>

            <v-divider class="my-2" />

            <!-- Custom Folders -->
            <v-list-item
              v-for="folder in folders"
              :key="folder.id"
              :active="selectedFolderId === folder.id"
              rounded="lg"
              class="mb-1 folder-list-item"
              @click="selectFolder(folder.id)"
            >
              <template #prepend>
                <v-avatar size="10" :color="folder.color || 'primary'" class="mr-3" />
              </template>
              <v-list-item-title class="font-weight-medium text-truncate">
                {{ folder.name }}
              </v-list-item-title>

              <template #append>
                <span class="text-caption font-weight-bold text-medium-emphasis mr-1">
                  {{ folder._count?.items || 0 }}
                </span>

                <!-- Folder Actions Menu -->
                <v-menu location="right">
                  <template #activator="{ props: menuProps }">
                    <v-btn
                      v-bind="menuProps"
                      icon="mdi-dots-vertical"
                      size="x-small"
                      variant="text"
                      density="comfortable"
                      class="folder-actions-btn"
                      @click.stop
                    />
                  </template>
                  <v-list density="compact" rounded="lg" class="elevation-4">
                    <v-list-item
                      prepend-icon="mdi-pencil-outline"
                      title="Sửa album"
                      @click="openEditFolderDialog(folder)"
                    />
                    <v-list-item
                      prepend-icon="mdi-delete-outline"
                      title="Xóa album"
                      class="text-error"
                      @click="deleteFolder(folder)"
                    />
                  </v-list>
                </v-menu>
              </template>
            </v-list-item>
          </v-list>
        </v-card>
      </v-col>

      <!-- Right Column: Media Grid & Actions -->
      <v-col cols="12" md="9" lg="9">
        <v-card rounded="xl" border class="pa-4 pa-sm-5 elevation-0 bg-surface">
          <!-- Filter Toolbar -->
          <div class="d-flex flex-column flex-sm-row align-sm-center justify-space-between mb-4" style="gap: 12px;">
            <div class="d-flex align-center flex-grow-1" style="max-width: 380px;">
              <v-text-field
                v-model="searchQuery"
                placeholder="Tìm ảnh theo tên..."
                prepend-inner-icon="mdi-magnify"
                variant="outlined"
                density="compact"
                hide-details
                rounded="lg"
                clearable
                @update:model-value="debounceSearch"
              />
            </div>

            <div class="d-flex align-center" style="gap: 8px;">
              <!-- Multi-select toggle -->
              <v-btn
                :variant="selectMode ? 'flat' : 'outlined'"
                :color="selectMode ? 'primary' : undefined"
                size="small"
                rounded="lg"
                class="text-none font-weight-bold"
                prepend-icon="mdi-checkbox-multiple-marked-outline"
                @click="toggleSelectMode"
              >
                {{ selectMode ? 'Hủy chọn' : 'Chọn nhiều' }}
              </v-btn>

              <!-- Batch Delete Button -->
              <v-btn
                v-if="selectMode && selectedItemIds.length > 0"
                color="error"
                variant="flat"
                size="small"
                rounded="lg"
                class="text-none font-weight-bold animate-pulse"
                prepend-icon="mdi-delete"
                :loading="deletingBatch"
                @click="deleteSelectedItems"
              >
                Xóa ({{ selectedItemIds.length }})
              </v-btn>

              <!-- Batch Move Folder -->
              <v-btn
                v-if="selectMode && selectedItemIds.length > 0"
                variant="tonal"
                size="small"
                rounded="lg"
                class="text-none font-weight-bold"
                prepend-icon="mdi-folder-move-outline"
                @click="openBatchMoveDialog"
              >
                Chuyển album
              </v-btn>
            </div>
          </div>

          <!-- Active Folder Breadcrumb / Counter -->
          <div class="d-flex align-center justify-space-between mb-4 px-1">
            <span class="text-caption font-weight-bold text-medium-emphasis">
              Đang xem: <span class="text-high-emphasis">{{ currentFolderName }}</span> ({{ total }} ảnh)
            </span>

            <span v-if="selectMode" class="text-caption text-primary font-weight-bold">
              Đã chọn: {{ selectedItemIds.length }} / {{ items.length }}
            </span>
          </div>

          <!-- Upload Progress Linear -->
          <v-progress-linear
            v-if="uploading"
            indeterminate
            color="primary"
            rounded
            height="4"
            class="mb-4"
          />

          <!-- Loading State -->
          <div v-if="loading" class="text-center py-12">
            <v-progress-circular indeterminate color="primary" size="48" />
            <p class="text-caption text-medium-emphasis mt-3">Đang tải danh sách ảnh...</p>
          </div>

          <!-- Empty State -->
          <div
            v-else-if="items.length === 0"
            class="text-center py-16 px-4 d-flex flex-column align-center justify-center border-dashed rounded-xl"
            style="border-color: rgba(var(--v-theme-on-surface), 0.12);"
          >
            <v-avatar size="64" color="primary" variant="tonal" class="mb-3">
              <v-icon size="32" color="primary">mdi-image-plus-outline</v-icon>
            </v-avatar>
            <h3 class="text-subtitle-1 font-weight-bold mb-1">Chưa có hình ảnh nào</h3>
            <p class="text-caption text-medium-emphasis mb-4" style="max-width: 360px;">
              {{ searchQuery ? 'Không tìm thấy ảnh nào khớp với từ khóa' : 'Hãy tải lên ảnh sản phẩm hoặc catalogue để bắt đầu sử dụng' }}
            </p>
            <v-btn
              color="primary"
              variant="flat"
              prepend-icon="mdi-cloud-upload-outline"
              rounded="lg"
              class="text-none font-weight-bold"
              @click="triggerFileInput"
            >
              Tải ảnh lên ngay
            </v-btn>
          </div>

          <!-- Media Items Grid -->
          <div v-else class="media-grid">
            <v-card
              v-for="item in items"
              :key="item.id"
              rounded="lg"
              border
              class="media-card elevation-0"
              :class="{
                'media-card-selected': selectedItemIds.includes(item.id),
                'cursor-pointer': selectMode
              }"
              @click="handleCardClick(item)"
            >
              <!-- Thumbnail Container -->
              <div class="media-thumb-wrapper">
                <v-img
                  :src="item.url"
                  :alt="item.name"
                  cover
                  aspect-ratio="1"
                  loading="lazy"
                  class="media-thumbnail"
                >
                  <template #placeholder>
                    <div class="d-flex align-center justify-center fill-height bg-grey-lighten-4">
                      <v-progress-circular indeterminate size="20" width="2" color="primary" />
                    </div>
                  </template>
                  <template #error>
                    <div class="d-flex flex-column align-center justify-center fill-height bg-grey-lighten-4 text-grey">
                      <v-icon size="24" color="grey">mdi-image-broken-variant</v-icon>
                    </div>
                  </template>
                </v-img>

                <!-- Checkbox overlay in select mode -->
                <div v-if="selectMode" class="media-check-overlay" @click.stop="toggleSelectItem(item.id)">
                  <v-checkbox-btn
                    :model-value="selectedItemIds.includes(item.id)"
                    color="primary"
                    density="compact"
                  />
                </div>

                <!-- Hover Quick View Action Button -->
                <div v-else class="media-hover-overlay">
                  <v-btn
                    icon="mdi-eye-outline"
                    size="small"
                    color="white"
                    variant="flat"
                    class="elevation-2"
                    @click.stop="previewImage(item)"
                  />
                </div>
              </div>

              <!-- Media Card Info Footer -->
              <div class="pa-2 d-flex flex-column" style="gap: 4px;">
                <div class="d-flex align-center justify-space-between">
                  <span class="text-caption font-weight-bold text-truncate flex-grow-1 mr-1" :title="item.name">
                    {{ item.name }}
                  </span>

                  <!-- Context Menu -->
                  <v-menu location="bottom end">
                    <template #activator="{ props: menuProps }">
                      <v-btn
                        v-bind="menuProps"
                        icon="mdi-dots-vertical"
                        size="x-small"
                        variant="text"
                        density="compact"
                        class="text-medium-emphasis"
                        @click.stop
                      />
                    </template>
                    <v-list density="compact" rounded="lg" class="elevation-4">
                      <v-list-item
                        prepend-icon="mdi-eye-outline"
                        title="Xem phóng to"
                        @click="previewImage(item)"
                      />
                      <v-list-item
                        prepend-icon="mdi-pencil-outline"
                        title="Đổi tên ảnh"
                        @click="openEditMediaDialog(item)"
                      />
                      <v-list-item
                        prepend-icon="mdi-folder-move-outline"
                        title="Chuyển album"
                        @click="openMoveItemDialog(item)"
                      />
                      <v-list-item
                        prepend-icon="mdi-content-copy"
                        title="Sao chép link"
                        @click="copyImageUrl(item.url)"
                      />
                      <v-divider class="my-1" />
                      <v-list-item
                        prepend-icon="mdi-delete-outline"
                        title="Xóa ảnh"
                        class="text-error"
                        @click="deleteSingleItem(item)"
                      />
                    </v-list>
                  </v-menu>
                </div>

                <div class="d-flex align-center justify-space-between text-caption text-medium-emphasis" style="font-size: 0.7rem !important;">
                  <span>{{ formatFileSize(item.size) }}</span>
                  <span v-if="item.folder" class="folder-tag text-truncate" :style="{ color: item.folder.color || 'inherit' }">
                    📁 {{ item.folder.name }}
                  </span>
                </div>
              </div>
            </v-card>
          </div>

          <!-- Pagination -->
          <div v-if="totalPages > 1" class="d-flex justify-center mt-6">
            <v-pagination
              v-model="page"
              :length="totalPages"
              density="comfortable"
              rounded="lg"
              @update:model-value="fetchMedia"
            />
          </div>
        </v-card>
      </v-col>
    </v-row>

    <!-- Dialog: Create / Edit Folder -->
    <v-dialog v-model="folderDialog.show" max-width="420">
      <v-card rounded="xl" class="pa-4">
        <v-card-title class="text-subtitle-1 font-weight-bold px-0 pt-0">
          {{ folderDialog.isEdit ? 'Chỉnh sửa Album' : 'Tạo Album mới' }}
        </v-card-title>
        <v-card-text class="px-0 py-2">
          <v-text-field
            v-model="folderDialog.name"
            label="Tên Album *"
            placeholder="Ví dụ: Áo thun mùa hè, Bảng giá 2026..."
            variant="outlined"
            density="comfortable"
            rounded="lg"
            class="mb-3"
            autofocus
            @keydown.enter="saveFolder"
          />

          <div class="mb-2">
            <span class="text-caption font-weight-medium text-medium-emphasis mb-1 d-block">
              Màu biểu tượng:
            </span>
            <div class="d-flex align-center" style="gap: 8px;">
              <v-avatar
                v-for="color in folderColors"
                :key="color"
                size="24"
                :color="color"
                class="cursor-pointer border-sm"
                :style="{
                  border: folderDialog.color === color ? '2px solid white' : 'none',
                  boxShadow: folderDialog.color === color ? '0 0 6px ' + color : 'none',
                  transform: folderDialog.color === color ? 'scale(1.2)' : 'none',
                  transition: 'all 0.15s ease'
                }"
                @click="folderDialog.color = color"
              />
            </div>
          </div>
        </v-card-text>
        <v-card-actions class="px-0 pb-0 justify-end">
          <v-btn variant="text" rounded="lg" @click="folderDialog.show = false">Hủy</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            rounded="lg"
            class="font-weight-bold"
            :loading="folderDialog.saving"
            :disabled="!folderDialog.name.trim()"
            @click="saveFolder"
          >
            Lưu Album
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog: Edit Media (Rename / Change Folder) -->
    <v-dialog v-model="editMediaDialog.show" max-width="420">
      <v-card rounded="xl" class="pa-4">
        <v-card-title class="text-subtitle-1 font-weight-bold px-0 pt-0">
          Đổi thông tin ảnh
        </v-card-title>
        <v-card-text class="px-0 py-2">
          <v-text-field
            v-model="editMediaDialog.name"
            label="Tên hiển thị *"
            variant="outlined"
            density="comfortable"
            rounded="lg"
            class="mb-3"
            @keydown.enter="saveEditMedia"
          />
          <v-select
            v-model="editMediaDialog.folderId"
            :items="folderSelectOptions"
            item-title="title"
            item-value="value"
            label="Thuộc Album"
            variant="outlined"
            density="comfortable"
            rounded="lg"
          />
        </v-card-text>
        <v-card-actions class="px-0 pb-0 justify-end">
          <v-btn variant="text" rounded="lg" @click="editMediaDialog.show = false">Hủy</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            rounded="lg"
            class="font-weight-bold"
            :loading="editMediaDialog.saving"
            @click="saveEditMedia"
          >
            Lưu thay đổi
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog: Batch Move Items -->
    <v-dialog v-model="batchMoveDialog.show" max-width="420">
      <v-card rounded="xl" class="pa-4">
        <v-card-title class="text-subtitle-1 font-weight-bold px-0 pt-0">
          Chuyển {{ selectedItemIds.length }} ảnh sang Album
        </v-card-title>
        <v-card-text class="px-0 py-2">
          <v-select
            v-model="batchMoveDialog.targetFolderId"
            :items="folderSelectOptions"
            item-title="title"
            item-value="value"
            label="Chọn Album đích *"
            variant="outlined"
            density="comfortable"
            rounded="lg"
          />
        </v-card-text>
        <v-card-actions class="px-0 pb-0 justify-end">
          <v-btn variant="text" rounded="lg" @click="batchMoveDialog.show = false">Hủy</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            rounded="lg"
            class="font-weight-bold"
            :loading="batchMoveDialog.saving"
            @click="confirmBatchMove"
          >
            Chuyển ngay
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog: Preview Image Fullscreen -->
    <v-dialog v-model="previewDialog.show" max-width="900" content-class="elevation-0">
      <div class="text-center" @click="previewDialog.show = false" style="cursor: pointer;">
        <img
          :src="previewDialog.url"
          :alt="previewDialog.name"
          style="max-width: 100%; max-height: 85vh; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.6);"
        />
        <div class="text-caption mt-2 font-weight-medium" style="color: #eee;">
          {{ previewDialog.name }} • Nhấn bất kỳ đâu để đóng
        </div>
      </div>
    </v-dialog>

    <!-- Toast Notification -->
    <v-snackbar v-model="toast.show" :color="toast.color" timeout="3000" location="top right">
      {{ toast.text }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { mediaApi, type MediaFolder, type MediaItem } from '@/api/media';

const folders = ref<MediaFolder[]>([]);
const items = ref<MediaItem[]>([]);
const total = ref(0);
const totalAll = ref(0);
const totalUncategorized = ref(0);
const page = ref(1);
const limit = 36;
const totalPages = ref(1);

const selectedFolderId = ref<string>('all');
const searchQuery = ref('');
const loading = ref(false);
const uploading = ref(false);
const deletingBatch = ref(false);

const selectMode = ref(false);
const selectedItemIds = ref<string[]>([]);
const fileInputRef = ref<HTMLInputElement | null>(null);

const folderColors = ['#00B074', '#1E88E5', '#FB8C00', '#E53935', '#8E24AA', '#00ACC1', '#43A047'];

const toast = ref({ show: false, text: '', color: 'success' });
function showToast(text: string, color: 'success' | 'error' | 'warning' = 'success') {
  toast.value = { show: true, text, color };
}

// ── Folder Management ────────────────────────────────────────────────────────
const folderDialog = ref({
  show: false,
  isEdit: false,
  folderId: '',
  name: '',
  color: '#00B074',
  saving: false,
});

function openCreateFolderDialog() {
  folderDialog.value = {
    show: true,
    isEdit: false,
    folderId: '',
    name: '',
    color: '#00B074',
    saving: false,
  };
}

function openEditFolderDialog(folder: MediaFolder) {
  folderDialog.value = {
    show: true,
    isEdit: true,
    folderId: folder.id,
    name: folder.name,
    color: folder.color || '#00B074',
    saving: false,
  };
}

async function saveFolder() {
  if (!folderDialog.value.name.trim()) return;
  folderDialog.value.saving = true;
  try {
    if (folderDialog.value.isEdit) {
      await mediaApi.updateFolder(folderDialog.value.folderId, {
        name: folderDialog.value.name.trim(),
        color: folderDialog.value.color,
      });
      showToast('Đã cập nhật Album thành công');
    } else {
      await mediaApi.createFolder({
        name: folderDialog.value.name.trim(),
        color: folderDialog.value.color,
      });
      showToast('Đã tạo Album mới thành công');
    }
    folderDialog.value.show = false;
    await fetchFolders();
  } catch (err: any) {
    showToast(err.response?.data?.error || 'Lưu Album thất bại', 'error');
  } finally {
    folderDialog.value.saving = false;
  }
}

async function deleteFolder(folder: MediaFolder) {
  if (!confirm(`Bạn có chắc muốn xóa album "${folder.name}"? (Các ảnh trong album sẽ được chuyển về "Chưa phân loại")`)) return;
  try {
    await mediaApi.deleteFolder(folder.id);
    showToast('Đã xóa album thành công');
    if (selectedFolderId.value === folder.id) {
      selectedFolderId.value = 'all';
    }
    await fetchFolders();
    await fetchMedia();
  } catch (err: any) {
    showToast(err.response?.data?.error || 'Xóa album thất bại', 'error');
  }
}

const currentFolderName = computed(() => {
  if (selectedFolderId.value === 'all') return 'Tất cả ảnh';
  if (selectedFolderId.value === 'null') return 'Chưa phân loại';
  const found = folders.value.find((f) => f.id === selectedFolderId.value);
  return found ? found.name : 'Album';
});

const folderSelectOptions = computed(() => {
  const list = [{ title: 'Chưa phân loại', value: 'null' }];
  folders.value.forEach((f) => {
    list.push({ title: f.name, value: f.id });
  });
  return list;
});

function selectFolder(folderId: string) {
  selectedFolderId.value = folderId;
  page.value = 1;
  fetchMedia();
}

// ── Media Fetching & Upload ──────────────────────────────────────────────────
let searchTimer: any = null;
function debounceSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    fetchMedia();
  }, 350);
}

async function fetchFolders() {
  try {
    const res = await mediaApi.getFolders();
    folders.value = res.folders;
    totalUncategorized.value = res.totalUncategorized;
    totalAll.value = res.totalAll;
  } catch (err) {
    console.error('Failed to fetch folders:', err);
  }
}

async function fetchMedia() {
  loading.value = true;
  try {
    const res = await mediaApi.getMedia({
      folderId: selectedFolderId.value,
      search: searchQuery.value,
      page: page.value,
      limit,
    });
    items.value = res.items;
    total.value = res.total;
    totalPages.value = res.totalPages;
  } catch (err) {
    console.error('Failed to fetch media:', err);
    showToast('Tải danh sách ảnh thất bại', 'error');
  } finally {
    loading.value = false;
  }
}

function triggerFileInput() {
  if (fileInputRef.value) {
    fileInputRef.value.value = '';
    fileInputRef.value.click();
  }
}

function optimizeImageBeforeUpload(file: File): Promise<File> {
  // Only optimize JPEG, PNG, WebP if > 400KB
  if (!file.type.startsWith('image/') || file.type.includes('svg') || file.type.includes('gif') || file.size < 400 * 1024) {
    return Promise.resolve(file);
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1920;
        let width = img.width;
        let height = img.height;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(file);

        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob && blob.size < file.size) {
              const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
              const optimizedFileName = `${baseName}.jpg`;
              resolve(new File([blob], optimizedFileName, { type: 'image/jpeg' }));
            } else {
              resolve(file);
            }
          },
          'image/jpeg',
          0.85
        );
      };
      img.onerror = () => resolve(file);
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

async function handleFileUpload(e: Event) {
  const target = e.target as HTMLInputElement;
  const files = target.files;
  if (!files || files.length === 0) return;

  uploading.value = true;
  try {
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      const optimizedFile = await optimizeImageBeforeUpload(files[i]);
      formData.append('files', optimizedFile);
    }
    if (selectedFolderId.value && selectedFolderId.value !== 'all' && selectedFolderId.value !== 'null') {
      formData.append('folderId', selectedFolderId.value);
    }

    const res = await mediaApi.uploadMedia(formData);
    showToast(`Đã tải lên ${res.count} hình ảnh thành công!`);
    await fetchFolders();
    await fetchMedia();
  } catch (err: any) {
    showToast(err.response?.data?.error || 'Tải ảnh lên thất bại', 'error');
  } finally {
    uploading.value = false;
  }
}

// ── Multi-select & Batch Actions ─────────────────────────────────────────────
function toggleSelectMode() {
  selectMode.value = !selectMode.value;
  if (!selectMode.value) {
    selectedItemIds.value = [];
  }
}

function handleCardClick(item: MediaItem) {
  if (selectMode.value) {
    toggleSelectItem(item.id);
  } else {
    previewImage(item);
  }
}

function toggleSelectItem(id: string) {
  const idx = selectedItemIds.value.indexOf(id);
  if (idx >= 0) {
    selectedItemIds.value.splice(idx, 1);
  } else {
    selectedItemIds.value.push(id);
  }
}

async function deleteSelectedItems() {
  if (!confirm(`Bạn có chắc muốn xóa ${selectedItemIds.value.length} hình ảnh đã chọn?`)) return;
  deletingBatch.value = true;
  try {
    for (const id of selectedItemIds.value) {
      await mediaApi.deleteMedia(id);
    }
    showToast(`Đã xóa ${selectedItemIds.value.length} ảnh`);
    selectedItemIds.value = [];
    selectMode.value = false;
    await fetchFolders();
    await fetchMedia();
  } catch (err) {
    showToast('Xóa ảnh thất bại', 'error');
  } finally {
    deletingBatch.value = false;
  }
}

const batchMoveDialog = ref({
  show: false,
  targetFolderId: 'null',
  saving: false,
});

function openBatchMoveDialog() {
  batchMoveDialog.value = {
    show: true,
    targetFolderId: 'null',
    saving: false,
  };
}

async function confirmBatchMove() {
  batchMoveDialog.value.saving = true;
  try {
    const target = batchMoveDialog.value.targetFolderId === 'null' ? null : batchMoveDialog.value.targetFolderId;
    for (const id of selectedItemIds.value) {
      await mediaApi.updateMedia(id, { folderId: target });
    }
    showToast(`Đã chuyển ${selectedItemIds.value.length} ảnh sang album mới`);
    batchMoveDialog.value.show = false;
    selectedItemIds.value = [];
    selectMode.value = false;
    await fetchFolders();
    await fetchMedia();
  } catch (err) {
    showToast('Chuyển album thất bại', 'error');
  } finally {
    batchMoveDialog.value.saving = false;
  }
}

// ── Single Item Actions ──────────────────────────────────────────────────────
const editMediaDialog = ref({
  show: false,
  itemId: '',
  name: '',
  folderId: 'null',
  saving: false,
});

function openEditMediaDialog(item: MediaItem) {
  editMediaDialog.value = {
    show: true,
    itemId: item.id,
    name: item.name,
    folderId: item.folderId || 'null',
    saving: false,
  };
}

function openMoveItemDialog(item: MediaItem) {
  openEditMediaDialog(item);
}

async function saveEditMedia() {
  if (!editMediaDialog.value.name.trim()) return;
  editMediaDialog.value.saving = true;
  try {
    await mediaApi.updateMedia(editMediaDialog.value.itemId, {
      name: editMediaDialog.value.name.trim(),
      folderId: editMediaDialog.value.folderId === 'null' ? null : editMediaDialog.value.folderId,
    });
    showToast('Đã lưu thông tin ảnh');
    editMediaDialog.value.show = false;
    await fetchFolders();
    await fetchMedia();
  } catch (err) {
    showToast('Cập nhật ảnh thất bại', 'error');
  } finally {
    editMediaDialog.value.saving = false;
  }
}

async function deleteSingleItem(item: MediaItem) {
  if (!confirm(`Bạn có chắc muốn xóa ảnh "${item.name}"?`)) return;
  try {
    await mediaApi.deleteMedia(item.id);
    showToast('Đã xóa ảnh');
    await fetchFolders();
    await fetchMedia();
  } catch (err) {
    showToast('Xóa ảnh thất bại', 'error');
  }
}

// ── Preview & Copy ───────────────────────────────────────────────────────────
const previewDialog = ref({
  show: false,
  url: '',
  name: '',
});

function previewImage(item: MediaItem) {
  previewDialog.value = {
    show: true,
    url: item.url,
    name: item.name,
  };
}

function copyImageUrl(url: string) {
  const fullUrl = window.location.origin + url;
  navigator.clipboard.writeText(fullUrl);
  showToast('Đã sao chép liên kết hình ảnh');
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

onMounted(() => {
  fetchFolders();
  fetchMedia();
});
</script>

<style scoped>
.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 14px;
}

@media (min-width: 600px) {
  .media-grid {
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 16px;
  }
}

.media-card {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
  border-color: rgba(var(--v-theme-on-surface), 0.08) !important;
}

.media-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12) !important;
}

.media-card-selected {
  border: 2px solid rgb(var(--v-theme-primary)) !important;
  background: rgba(var(--v-theme-primary), 0.04);
}

.media-thumb-wrapper {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.media-thumbnail {
  transition: transform 0.3s ease;
}

.media-card:hover .media-thumbnail {
  transform: scale(1.05);
}

.media-hover-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.media-card:hover .media-hover-overlay {
  opacity: 1;
}

.media-check-overlay {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 2;
}

.folder-list-item .folder-actions-btn {
  opacity: 0;
  transition: opacity 0.15s ease;
}

.folder-list-item:hover .folder-actions-btn {
  opacity: 1;
}

.folder-tag {
  font-weight: 500;
  max-width: 90px;
}
</style>
