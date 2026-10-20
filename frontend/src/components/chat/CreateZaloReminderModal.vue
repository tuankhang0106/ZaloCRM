<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="520"
    scrollable
  >
    <v-card rounded="xl" class="d-flex flex-column create-reminder-dialog">
      <!-- Header -->
      <v-card-title class="d-flex align-center justify-space-between pa-4 border-b">
        <div class="d-flex align-center" style="gap: 10px;">
          <v-avatar size="34" color="warning" variant="tonal" rounded="lg">
            <v-icon color="warning" size="20">mdi-calendar-clock</v-icon>
          </v-avatar>
          <div>
            <div class="text-subtitle-1 font-weight-bold" style="line-height: 1.2;">Tạo Lịch Nhắc Hẹn Zalo Native</div>
            <div class="text-caption text-medium-emphasis">Tạo nhắc hẹn chính thức trên Zalo và tự động đồng bộ CRM</div>
          </div>
        </div>
        <v-btn icon="mdi-close" variant="text" size="small" @click="$emit('update:modelValue', false)" />
      </v-card-title>

      <v-card-text class="pa-4 overflow-y-auto" style="max-height: 75vh;">
        <!-- Quick Presets -->
        <div class="mb-3">
          <div class="text-caption font-weight-bold text-medium-emphasis mb-1.5">Gợi ý thời gian nhanh:</div>
          <div class="d-flex flex-wrap" style="gap: 6px;">
            <v-chip
              v-for="preset in quickPresets"
              :key="preset.label"
              size="small"
              variant="tonal"
              color="primary"
              class="font-weight-medium"
              @click="applyPreset(preset.minutes)"
            >
              {{ preset.label }}
            </v-chip>
          </div>
        </div>

        <v-form ref="formRef" @submit.prevent="handleCreate">
          <!-- Title -->
          <v-text-field
            v-model="form.title"
            label="Nội dung nhắc hẹn *"
            placeholder="VD: Nhắc lịch tư vấn gói dịch vụ..."
            variant="outlined"
            density="compact"
            prepend-inner-icon="mdi-bell-outline"
            :rules="[v => !!v?.trim() || 'Vui lòng nhập nội dung nhắc hẹn']"
            class="mb-3"
          />

          <!-- Date & Time Row -->
          <div class="d-flex" style="gap: 12px;">
            <v-text-field
              v-model="dateStr"
              label="Ngày nhắc hẹn *"
              type="date"
              variant="outlined"
              density="compact"
              prepend-inner-icon="mdi-calendar"
              :min="minDateStr"
              class="mb-3 flex-grow-1"
            />
            <v-text-field
              v-model="timeStr"
              label="Giờ nhắc hẹn *"
              type="time"
              variant="outlined"
              density="compact"
              prepend-inner-icon="mdi-clock-outline"
              class="mb-3 flex-grow-1"
            />
          </div>

          <!-- Emoji Icon Picker -->
          <div class="mb-3">
            <div class="text-caption font-weight-bold text-medium-emphasis mb-1.5">Biểu tượng:</div>
            <div class="d-flex flex-wrap" style="gap: 8px;">
              <div
                v-for="e in emojiOptions"
                :key="e"
                class="emoji-btn d-flex align-center justify-center rounded-lg cursor-pointer transition-all"
                :class="{ 'emoji-selected': form.emoji === e }"
                @click="form.emoji = e"
              >
                <span style="font-size: 1.25rem;">{{ e }}</span>
              </div>
            </div>
          </div>

          <!-- Repeat mode -->
          <v-select
            v-model="form.repeat"
            :items="repeatOptions"
            item-title="label"
            item-value="value"
            label="Lặp lại"
            variant="outlined"
            density="compact"
            prepend-inner-icon="mdi-repeat"
            class="mb-3"
          />

          <!-- Live Reminder Preview -->
          <div class="reminder-preview-box pa-3 rounded-xl border mt-1">
            <div class="d-flex align-center justify-space-between mb-2">
              <span class="text-caption font-weight-bold d-flex align-center text-warning" style="gap: 4px;">
                <v-icon size="14">mdi-calendar-check</v-icon>
                Xem trước nhắc hẹn Zalo
              </span>
              <v-chip size="x-small" color="warning" variant="flat" class="font-weight-bold">Zalo Native</v-chip>
            </div>
            <div class="d-flex align-center pa-2.5 rounded-lg border" style="background: rgb(var(--v-theme-surface));">
              <div class="emoji-preview mr-3 text-h5 flex-shrink-0">
                {{ form.emoji }}
              </div>
              <div class="flex-grow-1 overflow-hidden">
                <div class="text-body-2 font-weight-bold text-truncate">{{ form.title.trim() || 'Nội dung nhắc hẹn' }}</div>
                <div class="text-caption text-medium-emphasis mt-0.5">
                  <v-icon size="12" class="mr-1">mdi-clock-outline</v-icon>
                  {{ formattedReminderTime }}
                </div>
              </div>
            </div>
          </div>
        </v-form>

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
          color="warning"
          variant="flat"
          rounded="lg"
          prepend-icon="mdi-calendar-plus"
          :loading="submitting"
          @click="handleCreate"
        >
          Tạo nhắc hẹn Zalo
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api } from '@/api';

const props = defineProps<{
  modelValue: boolean;
  conversationId: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
  (e: 'sent', msg: any): void;
}>();

const formRef = ref<any>(null);
const submitting = ref(false);
const errorMessage = ref('');

const form = ref({
  title: '',
  emoji: '⏰',
  repeat: 0,
});

const emojiOptions = ['⏰', '📅', '💼', '📞', '🚗', '🩺', '🎁', '⭐'];

const repeatOptions = [
  { label: 'Không lặp lại', value: 0 },
  { label: 'Hàng ngày', value: 1 },
  { label: 'Hàng tuần', value: 2 },
  { label: 'Hàng tháng', value: 3 },
];

const quickPresets = [
  { label: '+15 phút', minutes: 15 },
  { label: '+1 giờ', minutes: 60 },
  { label: '+3 giờ', minutes: 180 },
  { label: 'Ngày mai 9:00', minutes: -9 },
  { label: 'Ngày mai 14:00', minutes: -14 },
];

const dateStr = ref('');
const timeStr = ref('');

const minDateStr = computed(() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});

function initDefaultTime() {
  const target = new Date(Date.now() + 60 * 60 * 1000); // 1 hour ahead
  dateStr.value = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
  timeStr.value = `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`;
}

function applyPreset(minutes: number) {
  let target: Date;
  if (minutes > 0) {
    target = new Date(Date.now() + minutes * 60 * 1000);
  } else if (minutes === -9) {
    // Tomorrow at 9:00
    target = new Date();
    target.setDate(target.getDate() + 1);
    target.setHours(9, 0, 0, 0);
  } else {
    // Tomorrow at 14:00
    target = new Date();
    target.setDate(target.getDate() + 1);
    target.setHours(14, 0, 0, 0);
  }
  dateStr.value = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
  timeStr.value = `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`;
}

const computedTimestamp = computed(() => {
  if (!dateStr.value || !timeStr.value) return 0;
  const d = new Date(`${dateStr.value}T${timeStr.value}:00`);
  return d.getTime();
});

const formattedReminderTime = computed(() => {
  const ts = computedTimestamp.value;
  if (!ts) return 'Chưa chọn thời gian';
  return new Date(ts).toLocaleString('vi-VN', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
});

async function handleCreate() {
  errorMessage.value = '';
  if (formRef.value) {
    const valid = await formRef.value.validate();
    if (!valid.valid) return;
  }

  const startTime = computedTimestamp.value;
  if (!startTime || startTime <= Date.now()) {
    errorMessage.value = 'Thời gian nhắc hẹn phải lớn hơn thời gian hiện tại!';
    return;
  }

  submitting.value = true;
  try {
    const payload = {
      title: form.value.title.trim(),
      startTime,
      emoji: form.value.emoji,
      repeat: form.value.repeat,
    };

    const res = await api.post(`/conversations/${props.conversationId}/create-zalo-reminder`, payload);
    emit('sent', res.data?.data);
    emit('update:modelValue', false);
  } catch (err: any) {
    errorMessage.value = err.response?.data?.error || err.message || 'Không thể tạo nhắc hẹn Zalo';
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  initDefaultTime();
});
</script>

<style scoped>
.create-reminder-dialog {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}

.emoji-btn {
  width: 38px;
  height: 38px;
  background: rgba(var(--v-theme-surface-variant), 0.25);
  border: 1px solid rgba(var(--v-border-color), 0.12);
}

.emoji-btn:hover {
  background: rgba(var(--v-theme-primary), 0.08);
  border-color: rgba(var(--v-theme-primary), 0.4);
}

.emoji-selected {
  background: rgba(var(--v-theme-warning), 0.15) !important;
  border-color: rgb(var(--v-theme-warning)) !important;
  box-shadow: 0 0 0 1px rgb(var(--v-theme-warning));
}

.reminder-preview-box {
  background: rgba(var(--v-theme-surface-variant), 0.25);
  border-color: rgba(var(--v-border-color), var(--v-border-opacity)) !important;
}
</style>
