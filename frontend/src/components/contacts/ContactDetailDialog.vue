<template>
  <v-dialog v-model="show" max-width="680" persistent scrollable>
    <v-card>
      <v-card-title class="d-flex align-center">
        <span>{{ isNew ? 'Thêm khách hàng' : 'Chi tiết khách hàng' }}</span>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" @click="close" />
      </v-card-title>

      <v-divider />

      <v-card-text>
        <v-row dense>
          <!-- Full name -->
          <v-col cols="12" sm="6">
            <v-text-field v-model="form.fullName" label="Họ và tên" :rules="[required]" :readonly="isAccountant" />
          </v-col>

          <!-- Phone -->
          <v-col cols="12" sm="6">
            <v-text-field v-model="form.phone" label="Số điện thoại" :readonly="isAccountant" />
          </v-col>

          <!-- Email -->
          <v-col cols="12" sm="6">
            <v-text-field v-model="form.email" label="Email" type="email" :readonly="isAccountant" />
          </v-col>

          <!-- Source -->
          <v-col cols="12" sm="6">
            <v-select
              v-model="form.source"
              :items="SOURCE_OPTIONS"
              item-title="text"
              item-value="value"
              label="Nguồn"
              clearable
              :disabled="isAccountant"
            />
          </v-col>

          <!-- Status -->
          <v-col cols="12" sm="6">
            <v-select
              v-model="form.status"
              :items="STATUS_OPTIONS"
              item-title="text"
              item-value="value"
              label="Trạng thái"
              clearable
              :disabled="isAccountant"
            />
          </v-col>

          <!-- Tags -->
          <v-col cols="12" sm="6">
            <v-combobox
              v-model="form.tags"
              label="Tags"
              multiple
              chips
              closable-chips
              clearable
              hide-details
              :disabled="isAccountant"
            />
          </v-col>

          <!-- Notes -->
          <v-col cols="12">
            <v-textarea
              v-model="userNotes"
              label="Ghi chú"
              rows="3"
              auto-grow
              :readonly="isAccountant"
            />
          </v-col>
        </v-row>
      </v-card-text>

      <v-divider />

      <v-card-actions v-if="!isAccountant">
        <v-btn
          v-if="!isNew"
          color="error"
          variant="text"
          :loading="deleting"
          @click="onDelete"
        >
          Xoá
        </v-btn>
        <v-spacer />
        <v-btn variant="text" @click="close">Huỷ</v-btn>
        <v-btn color="primary" :loading="saving" @click="onSave">Lưu</v-btn>
      </v-card-actions>
      <v-card-actions v-else>
        <v-spacer />
        <v-btn color="primary" variant="flat" @click="close">Đóng</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import type { Contact } from '@/composables/use-contacts';
import { SOURCE_OPTIONS, STATUS_OPTIONS, useContacts } from '@/composables/use-contacts';
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();
const isAccountant = computed(() => authStore.user?.role === 'accountant');

const userNotes = computed({
  get() {
    return (form.value.notes || '')
      .replace(/\[Chuyển cho Kế toán\]/g, '')
      .replace(/\[Kế toán được chat\]/g, '')
      .replace(/\n\n+/g, '\n')
      .trim();
  },
  set(val: string) {
    const hasTransfer = (form.value.notes || '').includes('[Chuyển cho Kế toán]');
    const hasChat = (form.value.notes || '').includes('[Kế toán được chat]');
    
    let base = val.trim();
    if (hasTransfer) {
      base = base ? `${base}\n[Chuyển cho Kế toán]` : '[Chuyển cho Kế toán]';
    }
    if (hasChat) {
      base = base ? `${base}\n[Kế toán được chat]` : '[Kế toán được chat]';
    }
    form.value.notes = base;
  }
});

const props = defineProps<{
  modelValue: boolean;
  contact: Contact | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [contact: Contact];
  deleted: [id: string];
}>();

const { saving, deleting, createContact, updateContact, deleteContact } = useContacts();

const show = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const isNew = computed(() => !props.contact?.id);

interface FormState {
  fullName: string;
  phone: string;
  email: string;
  source: string;
  status: string;
  nextAppointmentDate: string;
  firstContactDate: string;
  notes: string;
  tags: string[];
}

const form = ref<FormState>(emptyForm());

function emptyForm(): FormState {
  return {
    fullName: '',
    phone: '',
    email: '',
    source: '',
    status: '',
    nextAppointmentDate: '',
    firstContactDate: '',
    notes: '',
    tags: [],
  };
}

watch(() => props.contact, (c) => {
  if (c) {
    form.value = {
      fullName: c.fullName ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
      source: c.source ?? '',
      status: c.status ?? '',
      nextAppointmentDate: c.nextAppointment
        ? new Date(c.nextAppointment).toISOString().split('T')[0]
        : '',
      firstContactDate: c.firstContactDate
        ? new Date(c.firstContactDate).toISOString().split('T')[0]
        : '',
      notes: c.notes ?? '',
      tags: c.tags ?? [],
    };
  } else {
    form.value = emptyForm();
  }
}, { immediate: true, deep: true });

function required(v: string) {
  return !!v || 'Bắt buộc';
}

async function onSave() {
  const payload: Partial<Contact> = {
    fullName: form.value.fullName || null,
    phone: form.value.phone || null,
    email: form.value.email || null,
    source: form.value.source || null,
    status: form.value.status || null,
    nextAppointment: form.value.nextAppointmentDate
      ? new Date(form.value.nextAppointmentDate + 'T00:00:00').toISOString()
      : null,
    firstContactDate: form.value.firstContactDate
      ? new Date(form.value.firstContactDate + 'T00:00:00').toISOString()
      : null,
    notes: form.value.notes || null,
    tags: form.value.tags,
  };

  let result: Contact | null;
  if (isNew.value) {
    result = await createContact(payload);
  } else {
    result = await updateContact(props.contact!.id, payload);
  }
  if (result) {
    emit('saved', result);
    close();
  }
}

async function onDelete() {
  if (!props.contact?.id) return;
  const ok = await deleteContact(props.contact.id);
  if (ok) {
    emit('deleted', props.contact.id);
    close();
  }
}

function close() {
  emit('update:modelValue', false);
}
</script>
