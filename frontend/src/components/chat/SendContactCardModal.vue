<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="520"
    scrollable
  >
    <v-card rounded="xl" class="d-flex flex-column send-contact-card-dialog">
      <!-- Header -->
      <v-card-title class="d-flex align-center justify-space-between pa-4 border-b">
        <div class="d-flex align-center" style="gap: 10px;">
          <v-avatar size="34" color="info" variant="tonal" rounded="lg">
            <v-icon color="info" size="20">mdi-card-account-phone-outline</v-icon>
          </v-avatar>
          <div>
            <div class="text-subtitle-1 font-weight-bold" style="line-height: 1.2;">Gửi Danh Thiếp Zalo</div>
            <div class="text-caption text-medium-emphasis">Chia sẻ thông tin liên hệ trực tiếp vào khung chat</div>
          </div>
        </div>
        <v-btn icon="mdi-close" variant="text" size="small" @click="$emit('update:modelValue', false)" />
      </v-card-title>

      <v-card-text class="pa-4 overflow-y-auto" style="max-height: 75vh;">
        <!-- Tabs: Pick from CRM or Manual input -->
        <v-tabs v-model="activeTab" density="compact" color="primary" class="mb-3 border-b">
          <v-tab value="crm" prepend-icon="mdi-account-search-outline" class="text-none">
            Chọn từ danh bạ CRM
          </v-tab>
          <v-tab value="manual" prepend-icon="mdi-pencil-outline" class="text-none">
            Nhập số điện thoại khác
          </v-tab>
        </v-tabs>

        <!-- TAB 1: CRM Search & Pick -->
        <div v-if="activeTab === 'crm'">
          <v-text-field
            v-model="searchQuery"
            placeholder="Tìm theo tên hoặc số điện thoại..."
            variant="outlined"
            density="compact"
            prepend-inner-icon="mdi-magnify"
            clearable
            hide-details
            class="mb-3"
            @input="onSearchInput"
          />

          <div v-if="searching" class="text-center py-4">
            <v-progress-circular indeterminate size="24" color="primary" />
            <div class="text-caption text-medium-emphasis mt-2">Đang tìm danh bạ...</div>
          </div>

          <div v-else-if="contactResults.length === 0" class="text-center py-5 text-medium-emphasis">
            <v-icon icon="mdi-account-off-outline" size="32" class="mb-1" />
            <div class="text-caption">Không tìm thấy liên hệ nào. Bạn có thể chuyển sang tab nhập thủ công.</div>
          </div>

          <div v-else class="contact-list-container d-flex flex-column" style="gap: 6px; max-height: 240px; overflow-y: auto;">
            <div
              v-for="contact in contactResults"
              :key="contact.id"
              class="contact-item pa-2.5 rounded-lg border d-flex align-center cursor-pointer transition-all"
              :class="{ 'contact-selected': selectedContact?.id === contact.id }"
              @click="selectContact(contact)"
            >
              <v-avatar size="36" color="primary" variant="tonal" class="mr-2.5 flex-shrink-0">
                <v-img v-if="contact.avatarUrl" :src="contact.avatarUrl" cover />
                <span v-else class="font-weight-bold text-caption">{{ (contact.fullName || 'K')[0] }}</span>
              </v-avatar>
              <div class="flex-grow-1 overflow-hidden">
                <div class="text-body-2 font-weight-bold text-truncate">{{ contact.fullName || 'Chưa đặt tên' }}</div>
                <div class="text-caption text-medium-emphasis text-truncate">{{ contact.phone || 'Chưa có SĐT' }}</div>
              </div>
              <v-icon v-if="selectedContact?.id === contact.id" color="primary" size="20">
                mdi-check-circle
              </v-icon>
            </div>
          </div>
        </div>

        <!-- TAB 2: Manual input -->
        <div v-else>
          <v-text-field
            v-model="manualForm.contactName"
            label="Họ và tên *"
            placeholder="VD: Nguyễn Văn A"
            variant="outlined"
            density="compact"
            prepend-inner-icon="mdi-account"
            class="mb-3"
          />

          <v-text-field
            v-model="manualForm.phoneNumber"
            label="Số điện thoại Zalo *"
            placeholder="VD: 0987654321"
            variant="outlined"
            density="compact"
            prepend-inner-icon="mdi-phone"
            class="mb-3"
          />

          <v-text-field
            v-model="manualForm.contactUserId"
            label="Zalo User ID (nếu có)"
            placeholder="Tùy chọn: ID người dùng Zalo"
            variant="outlined"
            density="compact"
            prepend-inner-icon="mdi-identifier"
            class="mb-2"
          />
        </div>

        <!-- Card Preview -->
        <div v-if="canPreview" class="preview-box pa-3 rounded-xl border mt-3">
          <div class="text-caption font-weight-bold text-medium-emphasis mb-2 d-flex align-center" style="gap: 4px;">
            <v-icon size="14">mdi-eye-outline</v-icon>
            Xem trước danh thiếp gửi đi
          </div>
          <div class="d-flex align-center pa-2.5 rounded-lg border card-rendered" style="background: rgb(var(--v-theme-surface));">
            <v-avatar size="40" color="primary" class="mr-3 flex-shrink-0">
              <v-img v-if="previewData.avatar" :src="previewData.avatar" cover />
              <span v-else class="text-caption font-weight-bold text-white">{{ (previewData.name || 'U')[0] }}</span>
            </v-avatar>
            <div class="flex-grow-1 overflow-hidden">
              <div class="text-body-2 font-weight-bold text-truncate">{{ previewData.name }}</div>
              <div class="text-caption text-medium-emphasis text-truncate">{{ previewData.phone || 'Danh thiếp Zalo' }}</div>
            </div>
            <v-chip size="x-small" color="primary" variant="tonal" class="font-weight-bold ml-2">
              Danh thiếp
            </v-chip>
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

      <v-card-actions class="pa-4 border-t d-flex justify-end" style="gap: 8px;">
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
          prepend-icon="mdi-send"
          :loading="submitting"
          :disabled="!canSubmit"
          @click="handleSend"
        >
          Gửi danh thiếp
        </v-btn>
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
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
  (e: 'sent', msg: any): void;
}>();

const activeTab = ref<'crm' | 'manual'>('crm');
const searchQuery = ref('');
const searching = ref(false);
const submitting = ref(false);
const errorMessage = ref('');

interface ContactItem {
  id: string;
  fullName: string;
  phone?: string;
  avatarUrl?: string;
  zaloUid?: string;
  zaloId?: string;
}

const contactResults = ref<ContactItem[]>([]);
const selectedContact = ref<ContactItem | null>(null);

const manualForm = ref({
  contactName: '',
  phoneNumber: '',
  contactUserId: '',
  avatar: '',
});

let searchTimeout: any = null;

function onSearchInput() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    fetchContacts();
  }, 350);
}

async function fetchContacts() {
  searching.value = true;
  try {
    const res = await api.get('/contacts', {
      params: {
        search: searchQuery.value.trim(),
        limit: 25,
      },
    });
    contactResults.value = res.data?.contacts || res.data?.data || [];
  } catch (err) {
    contactResults.value = [];
  } finally {
    searching.value = false;
  }
}

function selectContact(c: ContactItem) {
  selectedContact.value = c;
}

const previewData = computed(() => {
  if (activeTab.value === 'crm' && selectedContact.value) {
    return {
      name: selectedContact.value.fullName,
      phone: selectedContact.value.phone,
      avatar: selectedContact.value.avatarUrl,
    };
  }
  return {
    name: manualForm.value.contactName.trim() || 'Họ và tên',
    phone: manualForm.value.phoneNumber.trim() || 'Số điện thoại',
    avatar: manualForm.value.avatar,
  };
});

const canPreview = computed(() => {
  if (activeTab.value === 'crm') return !!selectedContact.value;
  return !!manualForm.value.contactName.trim() || !!manualForm.value.phoneNumber.trim();
});

const canSubmit = computed(() => {
  if (activeTab.value === 'crm') {
    return !!selectedContact.value && (!!selectedContact.value.phone || !!selectedContact.value.zaloId);
  }
  return !!manualForm.value.contactName.trim() && !!manualForm.value.phoneNumber.trim();
});

async function handleSend() {
  errorMessage.value = '';
  submitting.value = true;

  try {
    let payload = {
      contactUserId: '',
      phoneNumber: '',
      contactName: '',
      avatar: '',
    };

    if (activeTab.value === 'crm' && selectedContact.value) {
      payload = {
        contactUserId: selectedContact.value.zaloUid || selectedContact.value.zaloId || '',
        phoneNumber: selectedContact.value.phone || '',
        contactName: selectedContact.value.fullName || 'Liên hệ',
        avatar: selectedContact.value.avatarUrl || '',
      };
    } else {
      payload = {
        contactUserId: manualForm.value.contactUserId.trim(),
        phoneNumber: manualForm.value.phoneNumber.trim(),
        contactName: manualForm.value.contactName.trim(),
        avatar: manualForm.value.avatar.trim(),
      };
    }

    const res = await api.post(`/conversations/${props.conversationId}/send-card`, payload);
    emit('sent', res.data?.data);
    emit('update:modelValue', false);
  } catch (err: any) {
    errorMessage.value = err.response?.data?.error || err.message || 'Không thể gửi danh thiếp';
  } finally {
    submitting.value = false;
  }
}

watch(
  () => props.modelValue,
  (val) => {
    if (val && contactResults.value.length === 0) {
      fetchContacts();
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
.send-contact-card-dialog {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}

.contact-item {
  background: rgba(var(--v-theme-surface-variant), 0.2);
  border-color: rgba(var(--v-border-color), 0.12) !important;
  transition: all 0.2s ease;
}

.contact-item:hover {
  background: rgba(var(--v-theme-primary), 0.06);
  border-color: rgba(var(--v-theme-primary), 0.3) !important;
}

.contact-selected {
  background: rgba(var(--v-theme-primary), 0.1) !important;
  border-color: rgb(var(--v-theme-primary)) !important;
}

.preview-box {
  background: rgba(var(--v-theme-surface-variant), 0.25);
  border-color: rgba(var(--v-border-color), var(--v-border-opacity)) !important;
}
</style>
