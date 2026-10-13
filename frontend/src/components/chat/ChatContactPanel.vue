<template>
  <div
    class="chat-contact-panel d-flex flex-column"
    style="width: 320px; border-left: 1px solid rgba(0,0,0,0.12); height: 100%; overflow: hidden; flex-shrink: 0;"
  >
    <!-- Header -->
    <div class="pa-3 d-flex align-center flex-shrink-0" style="border-bottom: 1px solid rgba(0,0,0,0.12);">
      <v-icon icon="mdi-account-details" class="mr-2" color="primary" />
      <span class="font-weight-bold text-subtitle-2">Thông tin khách hàng</span>
      <v-spacer />
      <v-btn icon size="small" variant="text" @click="$emit('close')">
        <v-icon>mdi-close</v-icon>
      </v-btn>
    </div>

    <!-- Navigation Tabs for Panel -->
    <v-tabs v-model="activePanelTab" density="compact" grow color="primary" class="border-b bg-surface flex-shrink-0">
      <v-tab value="info" class="text-caption font-weight-bold text-none">
        <v-icon start size="15">mdi-account-circle-outline</v-icon>
        Thông tin
      </v-tab>
      <v-tab value="storage" class="text-caption font-weight-bold text-none">
        <v-icon start size="15">mdi-folder-multiple-image</v-icon>
        File & Link
        <v-chip v-if="storageCounts.total > 0" size="x-small" color="primary" variant="flat" class="ml-1 px-1 font-weight-bold" style="height: 16px; font-size: 0.62rem;">
          {{ storageCounts.total }}
        </v-chip>
      </v-tab>
    </v-tabs>

    <!-- Tab 1: Thông tin khách hàng (Form & Settings) -->
    <div v-show="activePanelTab === 'info'" class="pa-3 flex-grow-1 overflow-y-auto">
      <v-text-field v-model="form.fullName" label="Họ tên" density="compact" variant="outlined" class="mb-2" hide-details />
      <v-text-field v-model="form.phone" label="Số điện thoại" density="compact" variant="outlined" class="mb-2" hide-details />
      <v-text-field v-model="form.email" label="Email" type="email" density="compact" variant="outlined" class="mb-2" hide-details />

      <v-select v-model="form.source" label="Nguồn" :items="SOURCE_OPTIONS" item-title="text" item-value="value"
        density="compact" variant="outlined" clearable class="mb-2" hide-details />

      <v-combobox v-model="form.tags" label="Tags" multiple chips closable-chips
        density="compact" variant="outlined" class="mb-2" hide-details />

      <div class="d-flex align-center mb-1">
        <span class="text-caption font-weight-medium">Ghi chú</span>
        <v-spacer />
        <v-select
          v-model="summaryDays"
          :items="DAY_OPTIONS"
          item-title="text"
          item-value="value"
          density="compact"
          variant="plain"
          hide-details
          class="mr-2 summary-days-select text-caption"
          style="max-width: 100px; font-size: 0.7rem;"
        />
        <v-btn
          size="x-small"
          variant="text"
          color="primary"
          prepend-icon="mdi-sparkles"
          :loading="summarizing"
          :disabled="!props.conversationId"
          @click="summarizeChat"
        >
          Tóm tắt AI
        </v-btn>
      </div>
      <v-textarea v-model="userNotes" placeholder="Ghi chú về khách hàng..." rows="3" auto-grow
        density="compact" variant="outlined" class="mb-3" hide-details />

      <v-btn color="primary" block :loading="saving" class="mb-2" @click="saveContact">Lưu thông tin</v-btn>

      <!-- Thêm vào nhóm Zalo Button -->
      <v-btn
        v-if="props.contact?.zaloUid"
        color="primary"
        variant="tonal"
        prepend-icon="mdi-account-multiple-plus-outline"
        class="font-weight-bold mb-3 text-none"
        block
        @click="openAddToGroupDialog"
      >
        Thêm vào nhóm Zalo
      </v-btn>

      <v-alert v-if="saveSuccess" type="success" density="compact" class="mb-3" closable @click:close="saveSuccess = false">
        Đã lưu thành công!
      </v-alert>
      <v-alert v-if="saveError" type="error" density="compact" class="mb-3" closable @click:close="saveError = false">
        Lưu thất bại, thử lại!
      </v-alert>

      <v-divider class="mb-4" style="opacity: 0.12;" />

      <!-- Accountant Transfer Action Panel -->
      <!-- Accountant Transfer Action Panel -->
      <div class="mb-3">
        <!-- If not transferred to Accountant, only show the "Chuyển cho Kế toán" button to non-accountant users -->
        <template v-if="!(form.notes || '').includes('[Chuyển cho Kế toán]')">
          <v-btn
            v-if="authStore.user?.role !== 'accountant'"
            color="success"
            variant="tonal"
            prepend-icon="mdi-account-arrow-right"
            class="font-weight-bold"
            block
            @click="toggleAccountantTransfer(true)"
          >
            Chuyển cho Kế toán
          </v-btn>
        </template>
        <!-- If transferred, show status banner to all authorized users (including Kế toán) -->
        <template v-else>
          <!-- Status Banner -->
          <div class="d-flex align-center px-3 py-2 rounded mb-1" style="background: rgba(0, 176, 116, 0.08); border: 1px solid rgba(0, 176, 116, 0.15);">
            <v-icon icon="mdi-account-check-outline" color="success" class="mr-2" size="20" />
            <span class="text-caption font-weight-bold text-success">Đã chuyển cho Kế toán</span>
            <v-spacer />
            <v-chip
              v-slot:append
              v-if="(form.notes || '').includes('[Kế toán được chat]')"
              size="x-small"
              color="primary"
              variant="flat"
              class="font-weight-bold"
            >
              ĐƯỢC CHAT
            </v-chip>
            <v-chip
              v-slot:append
              v-else
              size="x-small"
              color="warning"
              variant="outlined"
              class="font-weight-bold"
            >
              CHỈ ĐỌC
            </v-chip>
          </div>

          <!-- Transfer tracking information -->
          <div v-if="form.metadata?.transferredByName" class="px-2 mb-2 text-caption text-grey-darken-1" style="font-size: 0.72rem; line-height: 1.35;">
            <div class="mb-1">
              <v-icon icon="mdi-account-edit-outline" size="12" class="mr-1" />
              Chuyển bởi: <span class="font-weight-bold text-foreground">{{ form.metadata.transferredByName }}</span>
            </div>
            <div class="mb-1">
              <v-icon icon="mdi-clock-outline" size="12" class="mr-1" />
              Thời gian: <span class="font-weight-bold text-foreground">{{ formatTransferTime(form.metadata.transferredAt) }}</span>
            </div>
            <div v-if="form.metadata?.deliveryDate" class="mb-1 d-flex align-center flex-wrap" style="gap: 4px;">
              <v-icon icon="mdi-calendar-range" size="12" class="mr-1" />
              Ngày giao hàng: <span class="font-weight-bold text-foreground mr-1">{{ formatDate(form.metadata.deliveryDate) }}</span>
              <v-chip
                size="x-small"
                :color="getDeliveryDaysRemaining(form.metadata.deliveryDate).color"
                class="font-weight-bold px-1"
                style="height: 18px;"
              >
                <v-icon start :icon="getDeliveryDaysRemaining(form.metadata.deliveryDate).icon" size="10" class="mr-1" />
                {{ getDeliveryDaysRemaining(form.metadata.deliveryDate).text }}
              </v-chip>
            </div>
            <!-- Accountant Status Toggle/View -->
            <div class="mt-2 d-flex align-center justify-space-between flex-wrap" style="gap: 6px;">
              <span class="font-weight-bold">Đối soát:</span>
              <!-- Accountant or Admin can Toggle Status -->
              <v-btn
                v-if="authStore.user?.role === 'accountant' || authStore.isAdmin"
                :color="form.metadata.accountantStatus === 'completed' ? 'success' : 'warning'"
                variant="tonal"
                size="x-small"
                class="font-weight-bold px-2"
                style="height: 22px; font-size: 0.65rem;"
                :prepend-icon="form.metadata.accountantStatus === 'completed' ? 'mdi-check-decagram' : 'mdi-alert-decagram-outline'"
                @click="toggleAccountantCompletion"
              >
                {{ form.metadata.accountantStatus === 'completed' ? 'Đã hoàn thành' : 'Chưa hoàn thành?' }}
              </v-btn>
              <!-- Member Staff can only view Status -->
              <v-chip
                v-else
                :color="form.metadata.accountantStatus === 'completed' ? 'success' : 'warning'"
                size="x-small"
                variant="flat"
                class="font-weight-bold"
                style="font-size: 0.65rem; height: 22px;"
              >
                {{ form.metadata.accountantStatus === 'completed' ? 'Kế toán Đã hoàn thành' : 'Kế toán Đang xử lý' }}
              </v-chip>
            </div>
            <!-- Completed metadata details if completed -->
            <div v-if="form.metadata.accountantStatus === 'completed' && form.metadata.accountantCompletedByName" class="mt-1" style="font-size: 0.68rem; opacity: 0.85;">
              <v-icon icon="mdi-check-all" size="10" color="success" class="mr-1" />
              Xác nhận: <span class="text-success font-weight-bold">{{ form.metadata.accountantCompletedByName }}</span> lúc {{ formatTransferTime(form.metadata.accountantCompletedAt) }}
            </div>
          </div>

          <!-- Action Buttons (Only shown to non-accountant users) -->
          <div v-if="authStore.user?.role !== 'accountant'" class="d-flex flex-column" style="gap: 8px;">
            <v-btn
              v-if="form.metadata?.accountantStatus === 'completed'"
              color="success"
              variant="flat"
              prepend-icon="mdi-plus-circle"
              class="font-weight-bold text-none"
              size="small"
              style="font-size: 0.75rem;"
              block
              @click="startNewOrderCycle"
            >
              Bắt đầu đơn mới
            </v-btn>
            <div v-else class="d-flex" style="gap: 8px;">
              <v-btn
                color="warning"
                variant="tonal"
                prepend-icon="mdi-undo"
                class="font-weight-bold flex-grow-1 text-none"
                size="small"
                style="font-size: 0.75rem;"
                @click="toggleAccountantTransfer(false)"
              >
                Thu hồi
              </v-btn>
              <v-btn
                v-if="!(form.notes || '').includes('[Kế toán được chat]')"
                color="primary"
                variant="flat"
                prepend-icon="mdi-chat-outline"
                class="font-weight-bold flex-grow-1 text-none"
                size="small"
                style="font-size: 0.75rem;"
                @click="toggleAccountantChat(true)"
              >
                Cho phép chat
              </v-btn>
              <v-btn
                v-else
                color="error"
                variant="flat"
                prepend-icon="mdi-chat-off-outline"
                class="font-weight-bold flex-grow-1 text-none"
                size="small"
                style="font-size: 0.75rem;"
                @click="toggleAccountantChat(false)"
              >
                Hủy quyền chat
              </v-btn>
            </div>
          </div>
        </template>

        <!-- Reconciliation History (Timeline / Dropdown log) - Always visible if history exists -->
        <div v-if="form.metadata?.history && form.metadata.history.length > 0" class="px-2 mb-3 pt-2 mt-2" style="border-top: 1px dashed rgba(255, 255, 255, 0.1);">
          <div class="d-flex align-center justify-space-between cursor-pointer" @click="showHistory = !showHistory">
            <span class="text-caption font-weight-bold text-grey-lighten-1 d-flex align-center" style="font-size: 0.7rem;">
              <v-icon icon="mdi-history" size="14" class="mr-1" color="primary" />
              Lịch sử đối soát trước ({{ form.metadata.history.length }})
            </span>
            <v-icon :icon="showHistory ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="16" color="grey" />
          </div>
          
          <v-expand-transition>
            <div v-show="showHistory" class="mt-2 d-flex flex-column" style="max-height: 140px; overflow-y: auto; gap: 6px;">
              <div 
                v-for="(h, idx) in [...form.metadata.history].reverse()" 
                :key="idx" 
                class="bg-surface-variant rounded pa-2 border-sm"
                style="border-color: rgba(255,255,255,0.05) !important;"
              >
                <div class="d-flex align-center justify-space-between mb-1">
                  <span class="text-success font-weight-bold d-flex align-center" style="font-size: 0.65rem;">
                    <v-icon icon="mdi-check-circle" size="12" color="success" class="mr-1" />
                    Đã đối soát
                  </span>
                  <span class="text-grey-darken-1" style="font-size: 0.6rem;">#{{ form.metadata.history.length - idx }}</span>
                </div>
                <div style="font-size: 0.65rem; line-height: 1.4; opacity: 0.85;">
                  <div>• Chuyển bởi: <span class="font-weight-bold text-foreground">{{ h.transferredByName }}</span> lúc {{ formatTransferTime(h.transferredAt) }}</div>
                  <div v-if="h.deliveryDate">• Ngày giao hàng: <span class="font-weight-bold text-foreground">{{ formatDate(h.deliveryDate) }}</span></div>
                  <div>• Xác nhận: <span class="text-success font-weight-bold">{{ h.accountantCompletedByName }}</span> lúc {{ formatTransferTime(h.accountantCompletedAt) }}</div>
                </div>
              </div>
            </div>
          </v-expand-transition>
        </div>
      </div>



      <!-- Appointments sub-component -->
      <ChatAppointments
        v-if="props.contactId"
        :contact-id="props.contactId"
        :appointments="contactAppointments"
        @refresh="reloadAppointments"
      />
    </div>

    <!-- Tab 2: File & Phương tiện (Chat Media, Files & Clickable Links Storage) -->
    <div v-show="activePanelTab === 'storage'" class="flex-grow-1 overflow-hidden d-flex flex-column" style="height: calc(100% - 90px);">
      <ChatMediaStorage
        :conversation-id="props.conversationId"
        :contact-id="props.contactId"
        :zalo-account-id="props.conversation?.zaloAccountId"
        @update:counts="handleStorageCountsUpdate"
      />
    </div>

    <!-- Add to Zalo Group Dialog -->
    <v-dialog v-model="addToGroupDialog.show" max-width="450" persistent>
      <v-card class="rounded-xl border pa-4">
        <v-card-title class="d-flex align-center justify-space-between border-bottom pb-3 px-0">
          <span class="font-weight-bold text-subtitle-1 text-high-emphasis d-flex align-center">
            <v-icon color="primary" class="mr-2">mdi-account-multiple-plus</v-icon>
            Thêm vào nhóm Zalo
          </span>
          <v-btn icon="mdi-close" variant="text" size="small" @click="closeAddToGroupDialog" />
        </v-card-title>
        <v-card-text class="pt-4 px-0">
          <v-alert
            v-if="addToGroupDialog.error"
            type="error"
            variant="tonal"
            density="compact"
            class="mb-3"
            closable
            @click:close="addToGroupDialog.error = ''"
          >
            {{ addToGroupDialog.error }}
          </v-alert>
          <!-- Thanh tìm kiếm nhóm -->
          <v-text-field
            v-model="addToGroupDialog.search"
            placeholder="Tìm kiếm nhóm..."
            prepend-inner-icon="mdi-magnify"
            variant="outlined"
            density="compact"
            class="mb-3"
            hide-details
            clearable
          />
          <!-- Trạng thái Loading -->
          <div v-if="addToGroupDialog.loading" class="d-flex flex-column align-center justify-center py-8">
            <v-progress-circular indeterminate color="primary" class="mb-2" />
            <span class="text-caption text-medium-emphasis">Đang tải danh sách nhóm...</span>
          </div>
          <!-- Danh sách nhóm -->
          <div v-else class="groups-list-container" style="max-height: 250px; overflow-y: auto;">
            <v-list v-if="filteredGroups.length > 0" class="pa-0">
              <v-list-item
                v-for="group in filteredGroups"
                :key="group.zaloUid"
                @click="addToGroupDialog.selectedGroupId = group.zaloUid"
                class="rounded-lg mb-1"
                :style="addToGroupDialog.selectedGroupId === group.zaloUid ? { borderLeft: '3px solid rgb(var(--v-theme-primary))', background: 'rgba(var(--v-theme-on-surface), 0.05)' } : {}"
              >
                <template #prepend>
                  <v-avatar size="36" color="grey-lighten-2" class="mr-2">
                    <v-img v-if="group.avatarUrl" :src="group.avatarUrl" />
                    <v-icon v-else icon="mdi-account-group" />
                  </v-avatar>
                </template>
                <v-list-item-title class="font-weight-bold text-high-emphasis text-body-2">
                  {{ group.fullName }}
                </v-list-item-title>
                <template #append>
                  <v-radio
                    :model-value="addToGroupDialog.selectedGroupId"
                    :value="group.zaloUid"
                    color="primary"
                    readonly
                  />
                </template>
              </v-list-item>
            </v-list>
            <div v-else class="text-center py-8 text-medium-emphasis text-caption">
              Không tìm thấy nhóm nào.
            </div>
          </div>
        </v-card-text>
        <v-card-actions class="px-0 pt-3 border-top mt-2">
          <v-spacer />
          <v-btn variant="text" class="rounded-xl font-weight-bold px-4 text-none" @click="closeAddToGroupDialog">
            Hủy
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            class="rounded-xl font-weight-bold px-6 text-none"
            :loading="addToGroupDialog.submitting"
            :disabled="!addToGroupDialog.selectedGroupId"
            @click="submitAddToGroup"
          >
            Thêm vào nhóm
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>


<script setup lang="ts">
import { SOURCE_OPTIONS } from '@/composables/use-contacts';
import type { Contact } from '@/composables/use-contacts';
import { useChatContactPanel } from '@/composables/use-chat-contact-panel';
import ChatAppointments from './ChatAppointments.vue';
import ChatMediaStorage from './ChatMediaStorage.vue';
import { useAuthStore } from '@/stores/auth';

import { ref, computed, reactive } from 'vue';
import { api } from '@/api/index';

const props = defineProps<{
  contactId: string | null;
  contact: Contact | null;
  conversationId: string | null;
  conversation?: any;
}>();

const emit = defineEmits<{ close: []; saved: [] }>();

const {
  form, saving, saveSuccess, saveError,
  contactAppointments,
  saveContact, reloadAppointments,
} = useChatContactPanel(
  () => props.contactId,
  () => props.contact,
  () => emit('saved'),
);

const activePanelTab = ref<'info' | 'storage'>('info');
const storageCounts = ref({ images: 0, files: 0, links: 0, total: 0 });

function handleStorageCountsUpdate(counts: any) {
  storageCounts.value = counts;
}

const summarizing = ref(false);
const summaryDays = ref(7);
const showHistory = ref(false);

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('vi-VN');
}

function getDeliveryDaysRemaining(deliveryDateStr: string | null | undefined): { days: number; text: string; color: string; icon: string } {
  if (!deliveryDateStr) return { days: 0, text: '—', color: 'grey', icon: '' };
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const delivery = new Date(deliveryDateStr + 'T00:00:00');
  
  const diffTime = delivery.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) {
    const overdue = Math.abs(diffDays);
    return {
      days: diffDays,
      text: `Trễ ${overdue} ngày`,
      color: 'error',
      icon: 'mdi-alert-circle'
    };
  } else if (diffDays === 0) {
    return {
      days: diffDays,
      text: 'Giao hôm nay!',
      color: 'warning',
      icon: 'mdi-clock-alert'
    };
  } else {
    return {
      days: diffDays,
      text: `Còn ${diffDays} ngày`,
      color: 'success',
      icon: 'mdi-clock-outline'
    };
  }
}


const DAY_OPTIONS = [
  { text: 'Tất cả', value: 0 },
  { text: '1 ngày', value: 1 },
  { text: '3 ngày', value: 3 },
  { text: '7 ngày', value: 7 },
  { text: '30 ngày', value: 30 },
];



async function summarizeChat() {
  if (!props.conversationId) return;
  summarizing.value = true;
  try {
    const res = await api.post(`/conversations/${props.conversationId}/summarize`, {
      days: summaryDays.value
    });
    if (res.data?.summary) {
      const timeLabel = summaryDays.value > 0 ? `${summaryDays.value} ngày` : 'toàn bộ';
      const prefix = `--- Tóm tắt AI (${timeLabel} - ${new Date().toLocaleDateString('vi-VN')}) ---\n${res.data.summary}\n\n`;
      form.notes = prefix + form.notes;
    }
  } catch (err: any) {
    alert(err.response?.data?.error || 'Không thể tạo tóm tắt bằng AI. Vui lòng kiểm tra GEMINI_API_KEY trong file .env');
  } finally {
    summarizing.value = false;
  }
}

const authStore = useAuthStore();

async function toggleAccountantTransfer(transfer: boolean) {
  const tag = '[Chuyển cho Kế toán]';
  const chatTag = '[Kế toán được chat]';
  
  form.metadata = form.metadata || {};
  form.metadata.history = form.metadata.history || [];

  if (transfer) {
    // If previous reconciliation is completed, archive it first!
    if (form.metadata.accountantStatus === 'completed') {
      const historyItem = {
        customerCode: form.metadata.customerCode || '',
        transferredByName: form.metadata.transferredByName || 'Staff',
        transferredAt: form.metadata.transferredAt,
        accountantCompletedByName: form.metadata.accountantCompletedByName || 'Kế toán',
        accountantCompletedAt: form.metadata.accountantCompletedAt,
        deliveryDate: form.metadata.deliveryDate
      };
      form.metadata.history.push(historyItem);
      delete form.metadata.customerCode;
    }

    if (!(form.notes || '').includes(tag)) {
      form.notes = (form.notes || '').trim() 
        ? `${form.notes.trim()}\n${tag}` 
        : tag;
    }

    // Set tracking details
    form.metadata.transferredByName = authStore.user?.fullName || 'Staff';
    form.metadata.transferredAt = new Date().toISOString();
    form.metadata.accountantStatus = 'pending';
    form.metadata.zaloAccountId = props.conversation?.zaloAccountId || null;
    
    // Clear completed fields of active cycle
    delete form.metadata.accountantCompletedByName;
    delete form.metadata.accountantCompletedAt;
  } else {
    // If active reconciliation is completed, archive it so it is not lost!
    if (form.metadata.accountantStatus === 'completed') {
      const historyItem = {
        transferredByName: form.metadata.transferredByName || 'Staff',
        transferredAt: form.metadata.transferredAt,
        accountantCompletedByName: form.metadata.accountantCompletedByName || 'Kế toán',
        accountantCompletedAt: form.metadata.accountantCompletedAt,
        deliveryDate: form.metadata.deliveryDate
      };
      form.metadata.history.push(historyItem);
    }

    form.notes = (form.notes || '')
      .replace(tag, '')
      .replace(chatTag, '')
      .replace(/\n\n+/g, '\n')
      .trim();

    // Clear active tracking details
    delete form.metadata.transferredByName;
    delete form.metadata.transferredAt;
    delete form.metadata.accountantStatus;
    delete form.metadata.accountantCompletedByName;
    delete form.metadata.accountantCompletedAt;
    delete form.metadata.deliveryDate;
  }
  
  // Instantly save to the backend!
  await saveContact();
}

async function toggleAccountantChat(allow: boolean) {
  const tag = '[Kế toán được chat]';
  if (allow) {
    if (!(form.notes || '').includes(tag)) {
      form.notes = (form.notes || '').trim() 
        ? `${form.notes.trim()}\n${tag}` 
        : tag;
    }
  } else {
    form.notes = (form.notes || '')
      .replace(tag, '')
      .replace(/\n\n+/g, '\n')
      .trim();
  }
  
  // Instantly save to the backend!
  await saveContact();
}

function formatTransferTime(isoStr: string | null | undefined): string {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

async function toggleAccountantCompletion() {
  form.metadata = form.metadata || {};
  if (form.metadata.accountantStatus === 'completed') {
    form.metadata.accountantStatus = 'pending';
    delete form.metadata.accountantCompletedByName;
    delete form.metadata.accountantCompletedAt;
  } else {
    form.metadata.accountantStatus = 'completed';
    form.metadata.accountantCompletedByName = authStore.user?.fullName || 'Kế toán';
    form.metadata.accountantCompletedAt = new Date().toISOString();
  }
  
  // Instantly save to the backend!
  await saveContact();
}

async function startNewOrderCycle() {
  form.metadata = form.metadata || {};
  form.metadata.history = form.metadata.history || [];

  // Archive active completed transfer to history
  const historyItem = {
    customerCode: form.metadata.customerCode || '',
    transferredByName: form.metadata.transferredByName || 'Staff',
    transferredAt: form.metadata.transferredAt,
    accountantCompletedByName: form.metadata.accountantCompletedByName || 'Kế toán',
    accountantCompletedAt: form.metadata.accountantCompletedAt,
    deliveryDate: form.metadata.deliveryDate
  };
  form.metadata.history.push(historyItem);

  // Clear active transfer fields
  delete form.metadata.transferredByName;
  delete form.metadata.transferredAt;
  delete form.metadata.accountantStatus;
  delete form.metadata.accountantCompletedByName;
  delete form.metadata.accountantCompletedAt;
  delete form.metadata.deliveryDate;
  delete form.metadata.customerCode;

  // Clear tags from notes
  const tag = '[Chuyển cho Kế toán]';
  const chatTag = '[Kế toán được chat]';
  form.notes = (form.notes || '')
    .replace(tag, '')
    .replace(chatTag, '')
    .replace(/\n\n+/g, '\n')
    .trim();

  // Instantly save to the backend!
  await saveContact();
}

const userNotes = computed({
  get() {
    return (form.notes || '')
      .replace(/\[Chuyển cho Kế toán\]/g, '')
      .replace(/\[Kế toán được chat\]/g, '')
      .replace(/\n\n+/g, '\n')
      .trim();
  },
  set(val: string) {
    const hasTransfer = (form.notes || '').includes('[Chuyển cho Kế toán]');
    const hasChat = (form.notes || '').includes('[Kế toán được chat]');
    
    let base = val.trim();
    if (hasTransfer) {
      base = base ? `${base}\n[Chuyển cho Kế toán]` : '[Chuyển cho Kế toán]';
    }
    if (hasChat) {
      base = base ? `${base}\n[Kế toán được chat]` : '[Kế toán được chat]';
    }
    form.notes = base;
  }
});

// ── Zalo Group Management ───────────────────────────────────────────────────
const addToGroupDialog = reactive({
  show: false,
  loading: false,
  submitting: false,
  search: '',
  groups: [] as Array<{ id: string; fullName: string; zaloUid: string; avatarUrl?: string }>,
  selectedGroupId: '',
  error: '',
});

const filteredGroups = computed(() => {
  const query = addToGroupDialog.search.toLowerCase().trim();
  if (!query) return addToGroupDialog.groups;
  return addToGroupDialog.groups.filter(g =>
    g.fullName.toLowerCase().includes(query)
  );
});

function openAddToGroupDialog() {
  addToGroupDialog.show = true;
  fetchGroups();
}

function closeAddToGroupDialog() {
  addToGroupDialog.show = false;
  addToGroupDialog.selectedGroupId = '';
  addToGroupDialog.search = '';
  addToGroupDialog.error = '';
}

async function fetchGroups() {
  if (!props.conversation?.zaloAccountId) return;
  addToGroupDialog.loading = true;
  addToGroupDialog.error = '';
  try {
    const res = await api.get(`/zalo-accounts/${props.conversation.zaloAccountId}/groups`);
    addToGroupDialog.groups = res.data.groups || [];
  } catch (err: any) {
    console.error('Failed to fetch Zalo groups:', err);
    addToGroupDialog.error = 'Không thể tải danh sách nhóm chat.';
  } finally {
    addToGroupDialog.loading = false;
  }
}

async function submitAddToGroup() {
  if (!props.conversation?.zaloAccountId || !props.contact?.zaloUid || !addToGroupDialog.selectedGroupId) return;
  
  addToGroupDialog.submitting = true;
  addToGroupDialog.error = '';
  
  try {
    await api.post(`/zalo-accounts/${props.conversation.zaloAccountId}/groups/${addToGroupDialog.selectedGroupId}/add-member`, {
      userZaloUid: props.contact.zaloUid
    });
    
    saveSuccess.value = true;
    setTimeout(() => { saveSuccess.value = false; }, 3000);
    
    closeAddToGroupDialog();
  } catch (err: any) {
    console.error('Failed to add member to Zalo group:', err);
    const apiErr = err.response?.data?.error || 'Không thể thêm khách hàng vào nhóm.';
    addToGroupDialog.error = apiErr;
  } finally {
    addToGroupDialog.submitting = false;
  }
}
</script>
