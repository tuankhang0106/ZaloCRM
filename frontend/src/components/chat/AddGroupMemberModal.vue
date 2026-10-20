<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="520"
    scrollable
  >
    <v-card rounded="xl" class="d-flex flex-column add-group-member-dialog">
      <!-- Header -->
      <v-card-title class="d-flex align-center justify-space-between pa-4 border-b">
        <div class="d-flex align-center" style="gap: 10px;">
          <v-avatar size="34" color="primary" variant="tonal" rounded="lg">
            <v-icon color="primary" size="20">mdi-account-multiple-plus</v-icon>
          </v-avatar>
          <div>
            <div class="text-subtitle-1 font-weight-bold" style="line-height: 1.2;">Thêm Thành Viên Vào Nhóm</div>
            <div class="text-caption text-medium-emphasis">Chọn liên hệ từ danh bạ CRM để mời vào nhóm chat</div>
          </div>
        </div>
        <v-btn icon="mdi-close" variant="text" size="small" @click="$emit('update:modelValue', false)" />
      </v-card-title>

      <!-- Search & Filter -->
      <div class="pa-3 border-b">
        <v-text-field
          v-model="searchQuery"
          placeholder="Tìm tên hoặc số điện thoại..."
          variant="outlined"
          density="compact"
          prepend-inner-icon="mdi-magnify"
          hide-details
          clearable
          rounded="lg"
          @input="onSearchInput"
        />
      </div>

      <!-- Member List -->
      <v-card-text class="pa-3 overflow-y-auto" style="max-height: 380px;">
        <div v-if="loading" class="text-center py-6">
          <v-progress-circular indeterminate size="28" color="primary" />
          <div class="text-caption text-medium-emphasis mt-2">Đang tải danh sách liên hệ...</div>
        </div>

        <div v-else-if="availableContacts.length === 0" class="text-center py-8 text-medium-emphasis">
          <v-icon icon="mdi-account-search-outline" size="36" class="mb-2" />
          <div class="text-body-2">Không tìm thấy liên hệ nào phù hợp có Zalo UID</div>
        </div>

        <div v-else class="d-flex flex-column" style="gap: 6px;">
          <div
            v-for="contact in availableContacts"
            :key="contact.id"
            class="member-select-item pa-2.5 rounded-lg border d-flex align-center cursor-pointer transition-all"
            :class="{ 'item-selected': selectedIds.has(contact.zaloUid || '') }"
            @click="toggleSelect(contact.zaloUid || '')"
          >
            <v-checkbox-btn
              :model-value="selectedIds.has(contact.zaloUid || '')"
              color="primary"
              density="compact"
              class="mr-2 flex-shrink-0"
              @click.stop="toggleSelect(contact.zaloUid || '')"
            />
            <v-avatar size="36" color="primary" variant="tonal" class="mr-3 flex-shrink-0">
              <v-img v-if="contact.avatarUrl" :src="contact.avatarUrl" cover />
              <span v-else class="font-weight-bold text-caption">{{ (contact.fullName || 'K')[0] }}</span>
            </v-avatar>
            <div class="flex-grow-1 overflow-hidden">
              <div class="text-body-2 font-weight-bold text-truncate">{{ contact.fullName || 'Chưa đặt tên' }}</div>
              <div class="text-caption text-medium-emphasis text-truncate">{{ contact.phone || 'Chưa có SĐT' }}</div>
            </div>
          </div>
        </div>

        <v-alert
          v-if="errorMessage"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-3 text-caption"
          closable
          @click:close="errorMessage = ''"
        >
          {{ errorMessage }}
        </v-alert>
      </v-card-text>

      <!-- Actions -->
      <v-card-actions class="pa-4 border-t d-flex justify-space-between align-center">
        <div class="text-caption font-weight-medium text-medium-emphasis">
          Đã chọn: <strong class="text-primary">{{ selectedIds.size }}</strong> liên hệ
        </div>
        <div class="d-flex" style="gap: 8px;">
          <v-btn
            variant="outlined"
            rounded="lg"
            @click="$emit('update:modelValue', false)"
            :disabled="submitting"
          >
            Hủy
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            rounded="lg"
            prepend-icon="mdi-account-plus"
            :loading="submitting"
            :disabled="selectedIds.size === 0"
            @click="handleAddMembers"
          >
            Thêm vào nhóm ({{ selectedIds.size }})
          </v-btn>
        </div>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { api } from '@/api';

const props = defineProps<{
  modelValue: boolean;
  conversationId: string;
  existingMemberIds?: string[];
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
  (e: 'added'): void;
}>();

const searchQuery = ref('');
const loading = ref(false);
const submitting = ref(false);
const errorMessage = ref('');

interface ContactItem {
  id: string;
  fullName: string;
  phone?: string;
  avatarUrl?: string;
  zaloUid?: string;
}

const contacts = ref<ContactItem[]>([]);
const selectedIds = ref<Set<string>>(new Set());

let searchTimeout: any = null;
function onSearchInput() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    fetchContacts();
  }, 350);
}

async function fetchContacts() {
  loading.value = true;
  try {
    const res = await api.get('/contacts', {
      params: {
        search: searchQuery.value.trim(),
        limit: 50,
      },
    });
    contacts.value = res.data?.contacts || res.data?.data || [];
  } catch (err) {
    contacts.value = [];
  } finally {
    loading.value = false;
  }
}

const availableContacts = computed(() => {
  const existing = new Set(props.existingMemberIds || []);
  return contacts.value.filter(c => c.zaloUid && !existing.has(c.zaloUid));
});

function toggleSelect(uid: string) {
  if (!uid) return;
  if (selectedIds.value.has(uid)) {
    selectedIds.value.delete(uid);
  } else {
    selectedIds.value.add(uid);
  }
}

async function handleAddMembers() {
  if (selectedIds.value.size === 0) return;
  errorMessage.value = '';
  submitting.value = true;

  try {
    await api.post(`/conversations/${props.conversationId}/group/members/add`, {
      memberIds: Array.from(selectedIds.value),
    });
    emit('added');
    emit('update:modelValue', false);
    selectedIds.value.clear();
  } catch (err: any) {
    errorMessage.value = err.response?.data?.error || err.message || 'Thêm thành viên thất bại';
  } finally {
    submitting.value = false;
  }
}

watch(
  () => props.modelValue,
  (val) => {
    if (val) {
      selectedIds.value.clear();
      errorMessage.value = '';
      if (contacts.value.length === 0) {
        fetchContacts();
      }
    }
  }
);

onMounted(() => {
  if (props.modelValue) {
    fetchContacts();
  }
});
</script>

<style scoped>
.add-group-member-dialog {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}

.member-select-item {
  background: rgba(var(--v-theme-surface-variant), 0.2);
  border-color: rgba(var(--v-border-color), 0.12) !important;
  transition: all 0.2s ease;
}

.member-select-item:hover {
  background: rgba(var(--v-theme-primary), 0.06);
  border-color: rgba(var(--v-theme-primary), 0.3) !important;
}

.item-selected {
  background: rgba(var(--v-theme-primary), 0.1) !important;
  border-color: rgb(var(--v-theme-primary)) !important;
}
</style>
