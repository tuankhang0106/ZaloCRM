<template>
  <div class="chat-appointments-wrapper">
    <v-divider class="my-3" />
    <div class="d-flex align-center mb-2">
      <v-icon size="16" color="warning" class="mr-1">mdi-calendar-clock</v-icon>
      <span class="text-caption font-weight-bold">Lịch hẹn ({{ appointments.length }})</span>
      <v-spacer />
      <v-btn
        size="x-small"
        variant="tonal"
        color="primary"
        prepend-icon="mdi-open-in-new"
        class="text-none font-weight-bold mr-1"
        style="font-size: 0.68rem; height: 22px;"
        title="Mở tab Lịch hẹn"
        @click="goToAppointmentsTab"
      >
        Tab Lịch hẹn
      </v-btn>
      <v-btn
        size="x-small"
        :variant="showForm ? 'flat' : 'text'"
        :color="showForm ? 'warning' : 'primary'"
        icon
        @click="showForm = !showForm"
      >
        <v-icon size="14">{{ showForm ? 'mdi-close' : 'mdi-plus' }}</v-icon>
      </v-btn>
    </div>

    <!-- Quick create form -->
    <v-expand-transition>
      <div
        v-if="showForm"
        class="mb-3 pa-2 rounded-lg"
        style="background: rgba(var(--v-theme-warning), 0.08); border: 1px solid rgba(var(--v-theme-warning), 0.25);"
      >
        <div class="d-flex align-center justify-space-between mb-2">
          <span class="text-caption font-weight-bold text-warning d-flex align-center">
            <v-icon start size="14">mdi-calendar-plus</v-icon>
            Tạo lịch hẹn mới
          </span>
          <v-chip size="x-small" color="primary" variant="tonal" style="font-size: 0.65rem;">
            Đồng bộ Tab Lịch hẹn
          </v-chip>
        </div>

        <v-alert
          v-if="errorMessage"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-2 py-1 px-2"
          style="font-size: 0.72rem;"
          closable
          @click:close="errorMessage = ''"
        >
          {{ errorMessage }}
        </v-alert>

        <v-alert
          v-if="successMessage"
          type="success"
          variant="tonal"
          density="compact"
          class="mb-2 py-1 px-2"
          style="font-size: 0.72rem;"
        >
          {{ successMessage }}
        </v-alert>

        <v-row dense class="mb-1">
          <v-col cols="7">
            <v-text-field
              v-model="createForm.date"
              label="Ngày hẹn *"
              type="date"
              density="compact"
              variant="outlined"
              hide-details
            />
          </v-col>
          <v-col cols="5">
            <v-text-field
              v-model="createForm.time"
              label="Giờ hẹn"
              type="time"
              density="compact"
              variant="outlined"
              hide-details
            />
          </v-col>
        </v-row>

        <v-select
          v-model="createForm.type"
          :items="APPOINTMENT_TYPE_OPTIONS"
          item-title="text"
          item-value="value"
          label="Loại lịch hẹn"
          density="compact"
          variant="outlined"
          hide-details
          class="mb-2"
        />

        <v-text-field
          v-model="createForm.notes"
          label="Ghi chú lịch hẹn"
          placeholder="Nội dung tư vấn, hẹn gặp..."
          density="compact"
          variant="outlined"
          hide-details
          class="mb-2"
        />

        <div class="d-flex" style="gap: 6px;">
          <v-btn
            size="small"
            color="warning"
            variant="flat"
            class="flex-grow-1 font-weight-bold text-none"
            :loading="creating"
            :disabled="!createForm.date"
            @click="submitCreate"
          >
            Lưu & Chuyển vào Lịch hẹn
          </v-btn>
          <v-btn
            size="small"
            variant="text"
            class="text-none"
            @click="showForm = false"
          >
            Đóng
          </v-btn>
        </div>
      </div>
    </v-expand-transition>

    <!-- Appointment list -->
    <div
      v-for="apt in appointments"
      :key="apt.id"
      class="mb-2 pa-2 rounded-lg border-sm"
      style="background: rgba(var(--v-theme-surface), 0.7); border-color: rgba(var(--v-border-color), 0.15) !important;"
    >
      <!-- View mode -->
      <div v-if="editingId !== apt.id" class="d-flex flex-column" style="gap: 4px;">
        <div class="d-flex align-center justify-space-between">
          <div class="d-flex align-center flex-wrap" style="gap: 4px;">
            <v-chip
              size="x-small"
              :color="statusColor(apt.status)"
              variant="flat"
              class="font-weight-bold px-1"
              style="height: 18px; font-size: 0.65rem;"
            >
              {{ statusLabel(apt.status) }}
            </v-chip>
            <v-chip
              size="x-small"
              color="primary"
              variant="outlined"
              class="px-1"
              style="height: 18px; font-size: 0.65rem;"
            >
              {{ typeLabel(apt.type) }}
            </v-chip>
          </div>
          <div class="d-flex align-center">
            <v-btn icon size="x-small" variant="text" color="primary" @click="startEdit(apt)">
              <v-icon size="13">mdi-pencil</v-icon>
            </v-btn>
          </div>
        </div>

        <div class="text-caption font-weight-bold d-flex align-center text-foreground" style="font-size: 0.76rem;">
          <v-icon size="13" color="warning" class="mr-1">mdi-clock-outline</v-icon>
          {{ formatAptDate(apt.appointmentDate) }}
          <span v-if="apt.appointmentTime" class="ml-1 text-primary">({{ apt.appointmentTime }})</span>
        </div>

        <div v-if="apt.notes" class="text-caption text-medium-emphasis pl-4" style="font-size: 0.7rem; line-height: 1.3;">
          {{ apt.notes }}
        </div>
      </div>

      <!-- Edit mode -->
      <div v-else class="pa-1">
        <div class="text-caption font-weight-bold text-primary mb-2">Chỉnh sửa lịch hẹn</div>
        <v-row dense class="mb-1">
          <v-col cols="7">
            <v-text-field
              v-model="editForm.date"
              label="Ngày"
              type="date"
              density="compact"
              variant="outlined"
              hide-details
            />
          </v-col>
          <v-col cols="5">
            <v-text-field
              v-model="editForm.time"
              label="Giờ"
              type="time"
              density="compact"
              variant="outlined"
              hide-details
            />
          </v-col>
        </v-row>
        <v-select
          v-model="editForm.type"
          :items="APPOINTMENT_TYPE_OPTIONS"
          item-title="text"
          item-value="value"
          label="Loại lịch hẹn"
          density="compact"
          variant="outlined"
          hide-details
          class="mb-1"
        />
        <v-select
          v-model="editForm.status"
          :items="statusOptions"
          item-title="title"
          item-value="value"
          label="Trạng thái"
          density="compact"
          variant="outlined"
          hide-details
          class="mb-1"
        />
        <v-text-field
          v-model="editForm.notes"
          label="Ghi chú"
          density="compact"
          variant="outlined"
          hide-details
          class="mb-2"
        />
        <div class="d-flex" style="gap: 6px;">
          <v-btn size="small" color="warning" class="flex-grow-1 font-weight-bold" :loading="saving" @click="submitEdit(apt.id)">Lưu</v-btn>
          <v-btn size="small" variant="text" @click="editingId = null">Hủy</v-btn>
        </div>
      </div>
    </div>

    <div v-if="appointments.length === 0 && !showForm" class="text-caption text-center py-2" style="opacity: 0.6; font-size: 0.72rem;">
      Chưa có lịch hẹn nào cho khách hàng này.
      <div class="mt-1">
        <a href="#" class="text-primary text-decoration-none font-weight-medium" @click.prevent="showForm = true">
          + Bấm để thêm lịch hẹn
        </a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/index';
import { APPOINTMENT_TYPE_OPTIONS } from '@/composables/use-appointments';

export interface Appointment {
  id: string;
  appointmentDate: string;
  appointmentTime: string | null;
  type: string | null;
  status: string;
  notes: string | null;
}

const props = defineProps<{
  contactId: string;
  appointments: Appointment[];
}>();

const emit = defineEmits<{
  refresh: [];
}>();

const router = useRouter();

const showForm = ref(false);
const creating = ref(false);
const saving = ref(false);
const editingId = ref<string | null>(null);
const errorMessage = ref('');
const successMessage = ref('');

const createForm = reactive({
  date: new Date().toISOString().split('T')[0],
  time: '09:00',
  type: 'consultation',
  notes: '',
});

const editForm = reactive({
  date: '',
  time: '',
  type: 'consultation',
  notes: '',
  status: 'scheduled',
});

const statusOptions = [
  { title: 'Sắp tới', value: 'scheduled' },
  { title: 'Hoàn thành', value: 'completed' },
  { title: 'Đã hủy', value: 'cancelled' },
  { title: 'Không đến', value: 'no_show' },
];

function statusColor(s: string): string {
  switch (s) {
    case 'scheduled': return 'blue';
    case 'completed': return 'success';
    case 'cancelled': return 'grey';
    case 'no_show': return 'error';
    default: return 'grey';
  }
}

function statusLabel(s: string): string {
  return statusOptions.find(o => o.value === s)?.title || s;
}

function typeLabel(t: string | null): string {
  if (!t) return 'Lịch hẹn';
  return APPOINTMENT_TYPE_OPTIONS.find(o => o.value === t)?.text || t;
}

function formatAptDate(d: string): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('vi-VN', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function goToAppointmentsTab() {
  router.push('/appointments');
}

function startEdit(apt: Appointment) {
  editingId.value = apt.id;
  editForm.date = apt.appointmentDate
    ? new Date(apt.appointmentDate).toISOString().split('T')[0]
    : '';
  editForm.time = apt.appointmentTime ?? '09:00';
  editForm.type = apt.type || 'consultation';
  editForm.notes = apt.notes ?? '';
  editForm.status = apt.status;
}

async function submitCreate() {
  errorMessage.value = '';
  successMessage.value = '';

  if (!createForm.date || !props.contactId) {
    errorMessage.value = 'Vui lòng chọn ngày hẹn!';
    return;
  }

  creating.value = true;
  try {
    await api.post('/appointments', {
      contactId: props.contactId,
      appointmentDate: new Date(createForm.date + 'T' + (createForm.time || '09:00') + ':00').toISOString(),
      appointmentTime: createForm.time || '09:00',
      type: createForm.type,
      notes: createForm.notes || null,
      status: 'scheduled',
    });

    successMessage.value = 'Đã tạo lịch hẹn thành công và truyền vào tab Lịch hẹn!';
    emit('refresh');

    setTimeout(() => {
      showForm.value = false;
      successMessage.value = '';
      createForm.notes = '';
    }, 1500);
  } catch (err: any) {
    console.error('Create appointment error:', err);
    errorMessage.value = err.response?.data?.error || 'Không thể tạo lịch hẹn. Vui lòng thử lại!';
  } finally {
    creating.value = false;
  }
}

async function submitEdit(appointmentId: string) {
  saving.value = true;
  try {
    await api.put(`/appointments/${appointmentId}`, {
      appointmentDate: editForm.date
        ? new Date(editForm.date + 'T' + (editForm.time || '09:00') + ':00').toISOString()
        : undefined,
      appointmentTime: editForm.time || null,
      type: editForm.type,
      notes: editForm.notes || null,
      status: editForm.status,
    });
    editingId.value = null;
    emit('refresh');
  } catch (err) {
    console.error('Update appointment error:', err);
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.chat-appointments-wrapper {
  user-select: none;
}
</style>
