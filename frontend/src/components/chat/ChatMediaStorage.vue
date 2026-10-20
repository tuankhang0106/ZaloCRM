<template>
  <div class="chat-media-storage d-flex flex-column h-100">
    <!-- Toolbar: Search & Refresh -->
    <div class="pa-2 border-b bg-surface">
      <div class="d-flex align-center gap-1 mb-2">
        <v-text-field
          v-model="searchQuery"
          placeholder="Tìm tên tệp, liên kết..."
          density="compact"
          variant="outlined"
          prepend-inner-icon="mdi-magnify"
          hide-details
          clearable
          class="flex-grow-1 search-input"
          style="font-size: 0.75rem;"
        />
        <v-btn
          icon="mdi-refresh"
          size="small"
          variant="text"
          :loading="loading"
          title="Làm mới kho lưu trữ"
          @click="fetchAssets"
        />
      </div>

      <!-- Filter chips: Tất cả / Khách gửi / Tôi gửi (rời nhau - Image 2) -->
      <div class="d-flex align-center justify-space-between flex-wrap" style="gap: 6px;">
        <div class="d-flex align-center" style="gap: 6px;">
          <button
            type="button"
            class="media-filter-btn"
            :class="{ active: filterSender === 'all' }"
            @click="filterSender = 'all'"
          >
            Tất cả
          </button>
          <button
            type="button"
            class="media-filter-btn"
            :class="{ active: filterSender === 'contact' }"
            @click="filterSender = 'contact'"
          >
            Khách gửi
          </button>
          <button
            type="button"
            class="media-filter-btn"
            :class="{ active: filterSender === 'self' }"
            @click="filterSender = 'self'"
          >
            Tôi gửi
          </button>
        </div>

        <span class="text-caption text-medium-emphasis" style="font-size: 0.65rem;">
          Tổng: {{ totalCount }}
        </span>
      </div>
    </div>

    <!-- Sub-tabs: Ảnh | Tệp tin | Liên kết -->
    <v-tabs
      v-model="activeSubTab"
      density="compact"
      grow
      color="primary"
      class="border-b bg-surface-variant-subtle"
    >
      <v-tab value="images" class="text-caption font-weight-bold text-none px-1" style="font-size: 0.72rem;">
        <v-icon start size="14">mdi-image-multiple-outline</v-icon>
        Ảnh ({{ filteredImages.length }})
      </v-tab>
      <v-tab value="files" class="text-caption font-weight-bold text-none px-1" style="font-size: 0.72rem;">
        <v-icon start size="14">mdi-file-document-outline</v-icon>
        Tệp ({{ filteredFiles.length }})
      </v-tab>
      <v-tab value="links" class="text-caption font-weight-bold text-none px-1" style="font-size: 0.72rem;">
        <v-icon start size="14">mdi-link-variant</v-icon>
        Link ({{ filteredLinks.length }})
      </v-tab>
    </v-tabs>

    <!-- Content Area -->
    <div class="flex-grow-1 overflow-y-auto pa-2" style="min-height: 0;">
      <!-- Loading indicator -->
      <div v-if="loading" class="d-flex flex-column align-center justify-center py-8">
        <v-progress-circular indeterminate color="primary" size="28" width="2" class="mb-2" />
        <span class="text-caption text-medium-emphasis" style="font-size: 0.7rem;">Đang tải phương tiện...</span>
      </div>

      <template v-else>
        <!-- ══════════════ TAB 1: IMAGES ══════════════ -->
        <div v-if="activeSubTab === 'images'">
          <div v-if="filteredImages.length > 0" class="image-grid">
            <div
              v-for="img in filteredImages"
              :key="img.id"
              class="image-grid-item rounded-lg overflow-hidden border cursor-pointer position-relative"
              @click="openLightbox(img)"
            >
              <v-img
                :src="img.thumbUrl || img.url"
                cover
                aspect-ratio="1"
                class="bg-grey-lighten-3 image-thumb"
              >
                <template #placeholder>
                  <div class="d-flex align-center justify-center fill-height bg-surface-variant">
                    <v-progress-circular indeterminate size="16" width="2" color="primary" />
                  </div>
                </template>
              </v-img>

              <!-- Sender Badge Overlay -->
              <div class="sender-overlay px-1 d-flex align-center justify-space-between">
                <span
                  class="badge-sender-mini"
                  :class="img.senderType === 'self' ? 'badge-self' : 'badge-contact'"
                >
                  {{ img.senderType === 'self' ? 'Tôi' : 'Khách' }}
                </span>
                <span class="text-white text-caption font-weight-light" style="font-size: 0.58rem; text-shadow: 0 1px 2px rgba(0,0,0,0.8);">
                  {{ formatShortTime(img.sentAt) }}
                </span>
              </div>
            </div>
          </div>

          <div v-else class="empty-state text-center py-8 text-medium-emphasis">
            <v-icon size="40" color="grey" class="mb-2 opacity-50">mdi-image-off-outline</v-icon>
            <div class="text-caption font-weight-medium">Không tìm thấy hình ảnh nào</div>
            <div class="text-caption opacity-70" style="font-size: 0.68rem;">Hình ảnh gửi và nhận trong chat sẽ xuất hiện ở đây</div>
          </div>
        </div>

        <!-- ══════════════ TAB 2: FILES ══════════════ -->
        <div v-else-if="activeSubTab === 'files'">
          <div v-if="filteredFiles.length > 0" class="d-flex flex-column" style="gap: 8px;">
            <div
              v-for="file in filteredFiles"
              :key="file.id"
              class="file-item-card pa-2 rounded-lg border d-flex align-center"
            >
              <!-- Extension Icon -->
              <v-avatar size="36" :color="getFileTypeColor(file.extension)" class="mr-2 rounded-lg flex-shrink-0">
                <v-icon size="20" color="white">{{ getFileTypeIcon(file.extension) }}</v-icon>
              </v-avatar>

              <!-- File Info -->
              <div class="flex-grow-1 overflow-hidden mr-1">
                <div class="text-caption font-weight-bold text-truncate text-foreground" :title="file.name" style="font-size: 0.74rem;">
                  {{ file.name }}
                </div>
                <div class="d-flex align-center flex-wrap" style="gap: 4px; font-size: 0.65rem;">
                  <span v-if="file.size" class="text-medium-emphasis font-weight-medium">{{ file.size }}</span>
                  <span class="text-medium-emphasis">•</span>
                  <span
                    class="font-weight-bold"
                    :class="file.senderType === 'self' ? 'text-primary' : 'text-warning'"
                  >
                    {{ file.senderType === 'self' ? 'Tôi gửi' : (file.senderName || 'Khách gửi') }}
                  </span>
                  <span class="text-medium-emphasis">• {{ formatShortTime(file.sentAt) }}</span>
                </div>
              </div>

              <!-- Download Button -->
              <v-btn
                icon="mdi-download"
                size="x-small"
                variant="tonal"
                color="primary"
                class="flex-shrink-0"
                title="Tải tệp này về"
                @click.stop="downloadFile(file.href)"
              />
            </div>
          </div>

          <div v-else class="empty-state text-center py-8 text-medium-emphasis">
            <v-icon size="40" color="grey" class="mb-2 opacity-50">mdi-file-hidden</v-icon>
            <div class="text-caption font-weight-medium">Không tìm thấy tài liệu nào</div>
            <div class="text-caption opacity-70" style="font-size: 0.68rem;">Tệp Word, Excel, PDF, ZIP... sẽ xuất hiện ở đây</div>
          </div>
        </div>

        <!-- ══════════════ TAB 3: LINKS ══════════════ -->
        <div v-else-if="activeSubTab === 'links'">
          <div v-if="filteredLinks.length > 0" class="d-flex flex-column" style="gap: 8px;">
            <div
              v-for="link in filteredLinks"
              :key="link.id"
              class="link-item-card pa-2 rounded-lg border d-flex flex-column"
            >
              <div class="d-flex align-center justify-space-between mb-1">
                <v-chip
                  size="x-small"
                  color="primary"
                  variant="tonal"
                  class="font-weight-bold px-1"
                  style="height: 18px; font-size: 0.62rem;"
                >
                  <v-icon start icon="mdi-web" size="10" class="mr-1" />
                  {{ link.domain || 'Liên kết' }}
                </v-chip>

                <div class="d-flex align-center" style="gap: 4px;">
                  <v-btn
                    icon="mdi-content-copy"
                    size="x-small"
                    variant="text"
                    color="grey"
                    style="width: 20px; height: 20px;"
                    title="Sao chép đường dẫn"
                    @click="copyToClipboard(link.url)"
                  />
                  <v-btn
                    icon="mdi-open-in-new"
                    size="x-small"
                    variant="text"
                    color="primary"
                    style="width: 20px; height: 20px;"
                    title="Mở trong tab mới"
                    :href="link.url"
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                </div>
              </div>

              <!-- Clickable Link Title/URL -->
              <a
                :href="link.url"
                target="_blank"
                rel="noopener noreferrer"
                class="link-title text-caption font-weight-bold text-decoration-none text-primary line-clamp-2 mb-1"
                :title="link.title || link.url"
                style="font-size: 0.74rem; line-height: 1.35; word-break: break-all;"
              >
                {{ link.title || link.url }}
              </a>

              <div v-if="link.description" class="text-caption text-medium-emphasis line-clamp-1 mb-1" style="font-size: 0.68rem;">
                {{ link.description }}
              </div>

              <!-- Meta Footer -->
              <div class="d-flex align-center justify-space-between text-caption text-medium-emphasis pt-1 border-t" style="font-size: 0.62rem;">
                <span>
                  Được gửi bởi:
                  <strong :class="link.senderType === 'self' ? 'text-primary' : 'text-warning'">
                    {{ link.senderType === 'self' ? 'Tôi' : (link.senderName || 'Khách') }}
                  </strong>
                </span>
                <span>{{ formatShortTime(link.sentAt) }}</span>
              </div>
            </div>
          </div>

          <div v-else class="empty-state text-center py-8 text-medium-emphasis">
            <v-icon size="40" color="grey" class="mb-2 opacity-50">mdi-link-off</v-icon>
            <div class="text-caption font-weight-medium">Không tìm thấy liên kết nào</div>
            <div class="text-caption opacity-70" style="font-size: 0.68rem;">Đường link chia sẻ trong trò chuyện sẽ hiển thị ở đây</div>
          </div>
        </div>
      </template>
    </div>

    <!-- Image Lightbox Modal -->
    <v-dialog v-model="lightbox.show" max-width="800" persistent>
      <v-card class="rounded-xl overflow-hidden bg-black">
        <div class="pa-2 d-flex align-center justify-space-between bg-grey-darken-4">
          <div class="d-flex align-center">
            <v-chip size="x-small" :color="lightbox.item?.senderType === 'self' ? 'primary' : 'warning'" variant="flat" class="mr-2">
              {{ lightbox.item?.senderType === 'self' ? 'Tôi gửi' : (lightbox.item?.senderName || 'Khách gửi') }}
            </v-chip>
            <span class="text-caption text-grey-lighten-1">{{ formatFullTime(lightbox.item?.sentAt) }}</span>
          </div>
          <div class="d-flex align-center" style="gap: 4px;">
            <v-btn
              icon="mdi-download"
              size="small"
              variant="text"
              color="white"
              title="Tải ảnh về"
              @click="downloadImage(lightbox.item?.url)"
            />
            <v-btn
              icon="mdi-close"
              size="small"
              variant="text"
              color="white"
              @click="lightbox.show = false"
            />
          </div>
        </div>

        <div class="d-flex align-center justify-center pa-2" style="max-height: 75vh; overflow: auto; background: rgba(0,0,0,0.95);">
          <img
            :src="lightbox.item?.url"
            alt="Preview"
            style="max-width: 100%; max-height: 70vh; object-fit: contain; border-radius: 8px;"
          />
        </div>

        <div v-if="lightbox.item?.caption" class="pa-3 bg-grey-darken-4 text-caption text-white">
          {{ lightbox.item.caption }}
        </div>
      </v-card>
    </v-dialog>

    <!-- Copy Toast Snackbar -->
    <v-snackbar v-model="copiedToast" timeout="2000" location="bottom center" color="success" density="compact">
      Đã sao chép liên kết vào bộ nhớ tạm!
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { api } from '@/api/index';

export interface ExtractedMedia {
  id: string;
  url: string;
  thumbUrl?: string;
  caption?: string | null;
  senderType: string;
  senderName: string | null;
  sentAt: string | Date;
}

export interface ExtractedFile {
  id: string;
  name: string;
  size: string;
  href: string;
  extension: string;
  senderType: string;
  senderName: string | null;
  sentAt: string | Date;
}

export interface ExtractedLink {
  id: string;
  url: string;
  title: string;
  description?: string;
  domain: string;
  senderType: string;
  senderName: string | null;
  sentAt: string | Date;
}

const props = withDefaults(defineProps<{
  conversationId: string | null;
  contactId: string | null;
  zaloAccountId?: string | null;
  initialTab?: 'images' | 'files' | 'links';
}>(), {
  initialTab: 'images'
});

const emit = defineEmits<{
  'update:counts': [counts: { images: number; files: number; links: number; total: number }];
}>();

const loading = ref(false);
const activeSubTab = ref<'images' | 'files' | 'links'>(props.initialTab || 'images');
const filterSender = ref<'all' | 'contact' | 'self'>('all');
const searchQuery = ref('');
const copiedToast = ref(false);

watch(() => props.initialTab, (newTab) => {
  if (newTab) activeSubTab.value = newTab;
});

const assets = ref<{
  images: ExtractedMedia[];
  files: ExtractedFile[];
  links: ExtractedLink[];
}>({
  images: [],
  files: [],
  links: [],
});

const lightbox = ref<{
  show: boolean;
  item: ExtractedMedia | null;
}>({
  show: false,
  item: null,
});

const totalCount = computed(() => {
  return assets.value.images.length + assets.value.files.length + assets.value.links.length;
});

// ── Filtered Collections ───────────────────────────────────────────────────
const filteredImages = computed(() => {
  let list = assets.value.images;
  if (filterSender.value === 'contact') {
    list = list.filter(i => i.senderType !== 'self');
  } else if (filterSender.value === 'self') {
    list = list.filter(i => i.senderType === 'self');
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase();
    list = list.filter(i => (i.caption || '').toLowerCase().includes(q));
  }
  return list;
});

const filteredFiles = computed(() => {
  let list = assets.value.files;
  if (filterSender.value === 'contact') {
    list = list.filter(f => f.senderType !== 'self');
  } else if (filterSender.value === 'self') {
    list = list.filter(f => f.senderType === 'self');
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase();
    list = list.filter(f => f.name.toLowerCase().includes(q) || f.extension.toLowerCase().includes(q));
  }
  return list;
});

const filteredLinks = computed(() => {
  let list = assets.value.links;
  if (filterSender.value === 'contact') {
    list = list.filter(l => l.senderType !== 'self');
  } else if (filterSender.value === 'self') {
    list = list.filter(l => l.senderType === 'self');
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase();
    list = list.filter(l => l.url.toLowerCase().includes(q) || (l.title || '').toLowerCase().includes(q) || (l.domain || '').toLowerCase().includes(q));
  }
  return list;
});

// ── Fetch Assets ───────────────────────────────────────────────────────────
async function fetchAssets() {
  if (!props.conversationId && !props.contactId) {
    assets.value = { images: [], files: [], links: [] };
    return;
  }

  loading.value = true;
  try {
    let endpoint = '';
    if (props.conversationId) {
      endpoint = `/conversations/${props.conversationId}/assets`;
    } else if (props.contactId) {
      endpoint = `/contacts/${props.contactId}/assets`;
    }

    const res = await api.get(endpoint);
    assets.value = {
      images: res.data.images || [],
      files: res.data.files || [],
      links: res.data.links || [],
    };

    emit('update:counts', {
      images: assets.value.images.length,
      files: assets.value.files.length,
      links: assets.value.links.length,
      total: totalCount.value,
    });
  } catch (err) {
    console.error('Failed to fetch conversation assets:', err);
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.conversationId, props.contactId],
  () => {
    fetchAssets();
  },
  { immediate: true }
);

// ── Helpers ────────────────────────────────────────────────────────────────
function openLightbox(img: ExtractedMedia) {
  lightbox.value.item = img;
  lightbox.value.show = true;
}

function getFileTypeIcon(ext: string): string {
  const e = (ext || '').toLowerCase();
  if (['pdf'].includes(e)) return 'mdi-file-pdf-box';
  if (['xls', 'xlsx', 'csv'].includes(e)) return 'mdi-file-excel-box';
  if (['doc', 'docx'].includes(e)) return 'mdi-file-word-box';
  if (['ppt', 'pptx'].includes(e)) return 'mdi-file-powerpoint-box';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) return 'mdi-folder-zip';
  if (['txt'].includes(e)) return 'mdi-file-document-outline';
  return 'mdi-file';
}

function getFileTypeColor(ext: string): string {
  const e = (ext || '').toLowerCase();
  if (['pdf'].includes(e)) return '#F44336';
  if (['xls', 'xlsx', 'csv'].includes(e)) return '#2E7D32';
  if (['doc', 'docx'].includes(e)) return '#1976D2';
  if (['ppt', 'pptx'].includes(e)) return '#E64A19';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) return '#FF8F00';
  return '#607D8B';
}

function downloadFile(url: string) {
  if (!url) return;
  const token = localStorage.getItem('token') || '';
  if (props.zaloAccountId && (url.includes('dlfl.vn') || url.includes('zalo') || url.includes('zdn.vn') || url.includes('asyncfile'))) {
    const proxyUrl = `/api/v1/files/download?url=${encodeURIComponent(url)}&accountId=${props.zaloAccountId}&token=${token}`;
    window.open(proxyUrl, '_blank');
  } else {
    window.open(url, '_blank');
  }
}

function downloadImage(url?: string) {
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.download = 'image.jpg';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function copyToClipboard(text: string) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    copiedToast.value = true;
  }).catch(() => {});
}

function formatShortTime(d: string | Date | undefined): string {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
  });
}

function formatFullTime(d: string | Date | undefined): string {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<style scoped>
.chat-media-storage {
  font-size: 0.8rem;
  margin: 0 !important;
  padding: 0 !important;
}
.media-filter-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 23px;
  padding: 0 10px;
  border-radius: 12px;
  font-size: 0.66rem;
  font-weight: 500;
  border: 1px solid rgba(var(--v-border-color), 0.28);
  background: rgba(var(--v-theme-surface), 0.85);
  color: rgba(var(--v-theme-on-surface), 0.78);
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}
.media-filter-btn:hover {
  background: rgba(var(--v-theme-primary), 0.08);
  border-color: rgba(var(--v-theme-primary), 0.35);
  color: rgb(var(--v-theme-primary));
}
.media-filter-btn.active {
  background: rgba(var(--v-theme-primary), 0.14);
  border-color: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-primary));
  font-weight: 700;
}
.image-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.image-grid-item {
  aspect-ratio: 1;
  overflow: hidden;
  border-color: rgba(var(--v-border-color), 0.15) !important;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.image-grid-item:hover {
  transform: scale(1.02);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}
.image-thumb {
  width: 100%;
  height: 100%;
}
.sender-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.85) 0%, transparent 100%);
  padding: 4px 4px 2px;
}
.badge-sender-mini {
  font-size: 0.55rem;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 4px;
  text-transform: uppercase;
}
.badge-self {
  background: rgb(var(--v-theme-primary));
  color: white;
}
.badge-contact {
  background: #FF9800;
  color: white;
}
.file-item-card, .link-item-card {
  background: rgba(var(--v-theme-surface), 0.6);
  border-color: rgba(var(--v-border-color), 0.15) !important;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.file-item-card:hover, .link-item-card:hover {
  background: rgba(var(--v-theme-surface), 0.95);
  border-color: rgba(var(--v-theme-primary), 0.4) !important;
}
.line-clamp-1 {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.bg-surface-variant-subtle {
  background: rgba(var(--v-theme-surface-variant), 0.2);
}
</style>
