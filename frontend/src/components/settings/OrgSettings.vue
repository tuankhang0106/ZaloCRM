<template>
  <div style="max-width: 480px;">
    <div class="text-h6 mb-4">Thông tin tổ chức</div>

    <v-card variant="outlined" class="pa-4">
      <!-- Organization Logo Section -->
      <div class="d-flex flex-column align-center mb-6">
        <div class="text-subtitle-2 mb-2 text-medium-emphasis">Logo tổ chức</div>
        
        <v-avatar size="96" rounded="lg" class="elevation-3 mb-3 border position-relative overflow-hidden">
          <v-img v-if="logoPreview" :src="logoPreview" alt="Logo Preview" />
          <div
            v-else
            class="d-flex align-center justify-center fill-height"
            style="background: linear-gradient(135deg, #00B074, #044523);"
          >
            <v-icon size="40" color="white">mdi-robot</v-icon>
          </div>
        </v-avatar>

        <div class="d-flex gap-2" v-if="authStore.isOwner">
          <input
            type="file"
            ref="fileInput"
            accept="image/png, image/jpeg, image/svg+xml"
            style="display: none;"
            @change="onFileSelected"
          />
          <v-btn
            variant="outlined"
            size="small"
            prepend-icon="mdi-upload"
            :disabled="saving"
            @click="triggerFileInput"
          >
            Chọn ảnh
          </v-btn>
          <v-btn
            v-if="logoPreview"
            variant="text"
            color="error"
            size="small"
            prepend-icon="mdi-delete-outline"
            :disabled="saving"
            @click="clearLogo"
          >
            Xóa Logo
          </v-btn>
        </div>
        <div class="text-caption text-medium-emphasis mt-2">
          Hỗ trợ PNG, JPG, SVG (Tối đa 1MB)
        </div>
      </div>

      <v-text-field
        v-model="orgName"
        label="Tên tổ chức"
        :disabled="!authStore.isOwner || saving"
        variant="outlined"
        class="mb-3"
      />
      <v-alert v-if="error" type="error" density="compact" class="mb-3">{{ error }}</v-alert>
      <v-alert v-if="saved" type="success" density="compact" class="mb-3">Đã lưu thông tin thành công!</v-alert>
      
      <v-btn
        v-if="authStore.isOwner"
        color="primary"
        block
        size="large"
        :loading="saving"
        :disabled="!orgName.trim()"
        @click="handleSave"
      >
        Lưu thay đổi
      </v-btn>
      <p v-else class="text-medium-emphasis text-body-2 text-center">
        Chỉ chủ sở hữu mới có thể chỉnh sửa thông tin tổ chức.
      </p>
    </v-card>

    <!-- Company IP Configuration Card -->
    <v-card variant="outlined" class="pa-4 mt-6">
      <div class="text-subtitle-1 mb-2 font-weight-bold">
        <v-icon start color="primary" class="mr-1">mdi-ip-network</v-icon>
        Cấu hình IP văn phòng
      </div>
      <p class="text-caption text-medium-emphasis mb-4">
        Nhập các địa chỉ IP của văn phòng công ty (phân tách bằng dấu phẩy) để đối chiếu, so sánh khi nhân viên chấm công.
      </p>
      
      <v-text-field
        v-model="officeIp"
        label="Địa chỉ IP công ty"
        placeholder="Ví dụ: 113.161.42.5, 14.232.122.9"
        :disabled="!authStore.isAdmin || savingIp"
        variant="outlined"
        class="mb-3"
        hint="Để trống nếu không giới hạn IP chấm công"
        persistent-hint
      />

      <v-alert v-if="ipError" type="error" density="compact" class="mb-3">{{ ipError }}</v-alert>
      <v-alert v-if="ipSaved" type="success" density="compact" class="mb-3">Đã lưu cấu hình IP thành công!</v-alert>

      <v-btn
        v-if="authStore.isAdmin"
        color="primary"
        block
        size="large"
        :loading="savingIp"
        @click="handleSaveIp"
      >
        Lưu cấu hình IP
      </v-btn>
      <p v-else class="text-medium-emphasis text-body-2 text-center mt-2">
        Chỉ Quản trị viên mới có thể chỉnh sửa cấu hình IP công ty.
      </p>
    </v-card>

    <!-- Work Hours Configuration Card -->
    <v-card variant="outlined" class="pa-4 mt-6">
      <div class="text-subtitle-1 mb-2 font-weight-bold">
        <v-icon start color="primary" class="mr-1">mdi-clock-outline</v-icon>
        Cấu hình giờ chấm công
      </div>
      <p class="text-caption text-medium-emphasis mb-4">
        Thiết lập mốc thời gian chuẩn để xác định nhân viên đi muộn hoặc về sớm.
      </p>
      
      <v-row dense>
        <v-col cols="6">
          <v-text-field
            v-model="checkInLimitTime"
            label="Giờ bắt đầu muộn (Check-in)"
            type="time"
            :disabled="!authStore.isAdmin || savingTime"
            variant="outlined"
            hint="Mặc định: 08:05"
            persistent-hint
          />
        </v-col>
        <v-col cols="6">
          <v-text-field
            v-model="checkOutLimitTime"
            label="Giờ về chuẩn (Check-out)"
            type="time"
            :disabled="!authStore.isAdmin || savingTime"
            variant="outlined"
            hint="Mặc định: 17:30"
            persistent-hint
          />
        </v-col>
      </v-row>

      <v-alert v-if="timeError" type="error" density="compact" class="mb-3 mt-3">{{ timeError }}</v-alert>
      <v-alert v-if="timeSaved" type="success" density="compact" class="mb-3 mt-3">Đã lưu cấu hình giờ thành công!</v-alert>

      <v-btn
        v-if="authStore.isAdmin"
        color="primary"
        block
        size="large"
        :loading="savingTime"
        @click="handleSaveTime"
        class="mt-3"
      >
        Lưu cấu hình giờ
      </v-btn>
      <p v-else class="text-medium-emphasis text-body-2 text-center mt-2">
        Chỉ Quản trị viên mới có thể chỉnh sửa cấu hình giờ chấm công.
      </p>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/api/index';
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();
const orgName = ref('');
const logoPreview = ref<string | null>(null);
const logoBase64 = ref<string | null>(null);
const logoCleared = ref(false);

const fileInput = ref<HTMLInputElement | null>(null);
const saving = ref(false);
const error = ref('');
const saved = ref(false);

// IP settings state
const officeIp = ref('');
const savingIp = ref(false);
const ipError = ref('');
const ipSaved = ref(false);

// Work hours settings state
const checkInLimitTime = ref('08:05');
const checkOutLimitTime = ref('17:30');
const savingTime = ref(false);
const timeError = ref('');
const timeSaved = ref(false);

async function fetchOrg() {
  try {
    const res = await api.get('/organization');
    orgName.value = res.data.name ?? '';
    if (res.data.logo) {
      logoPreview.value = res.data.logo;
      logoBase64.value = res.data.logo;
    }
  } catch {
    // silently ignore — endpoint may not exist yet
  }
}

async function fetchOfficeIp() {
  try {
    const res = await api.get('/organization/office-ip');
    officeIp.value = res.data.officeIp ?? '';
  } catch (err) {
    console.error('Failed to fetch office IP:', err);
  }
}

function triggerFileInput() {
  if (fileInput.value) {
    fileInput.value.click();
  }
}

function onFileSelected(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  if (file.size > 1024 * 1024) {
    error.value = 'Kích thước tệp tin vượt quá 1MB!';
    return;
  }

  error.value = '';
  const reader = new FileReader();
  reader.onload = (e) => {
    const base64Str = e.target?.result as string;
    logoPreview.value = base64Str;
    logoBase64.value = base64Str;
    logoCleared.value = false;
  };
  reader.readAsDataURL(file);
}

function clearLogo() {
  logoPreview.value = null;
  logoBase64.value = null;
  logoCleared.value = true;
  if (fileInput.value) {
    fileInput.value.value = '';
  }
}

async function handleSave() {
  saving.value = true;
  error.value = '';
  saved.value = false;
  try {
    let logoValue: string | null | undefined = undefined;
    if (logoCleared.value) {
      logoValue = null;
    } else if (logoBase64.value) {
      logoValue = logoBase64.value;
    }

    await api.put('/organization', { 
      name: orgName.value.trim(),
      logo: logoValue
    });
    
    saved.value = true;
    setTimeout(() => { 
      saved.value = false; 
      window.location.reload();
    }, 1500);
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Lỗi lưu thông tin tổ chức';
  } finally {
    saving.value = false;
  }
}

async function handleSaveIp() {
  savingIp.value = true;
  ipError.value = '';
  ipSaved.value = false;
  try {
    const res = await api.put('/organization/office-ip', { 
      officeIp: officeIp.value.trim() 
    });
    ipSaved.value = true;
    officeIp.value = res.data.officeIp ?? '';
    setTimeout(() => { 
      ipSaved.value = false; 
    }, 2000);
  } catch (err: any) {
    ipError.value = err.response?.data?.error || 'Lỗi lưu cấu hình IP';
  } finally {
    savingIp.value = false;
  }
}

async function fetchWorkHours() {
  try {
    const res = await api.get('/organization/work-hours');
    checkInLimitTime.value = res.data.checkInTime ?? '08:05';
    checkOutLimitTime.value = res.data.checkOutTime ?? '17:30';
  } catch (err) {
    console.error('Failed to fetch work hours:', err);
  }
}

async function handleSaveTime() {
  savingTime.value = true;
  timeError.value = '';
  timeSaved.value = false;
  try {
    const res = await api.put('/organization/work-hours', { 
      checkInTime: checkInLimitTime.value,
      checkOutTime: checkOutLimitTime.value,
    });
    timeSaved.value = true;
    checkInLimitTime.value = res.data.checkInTime ?? '08:05';
    checkOutLimitTime.value = res.data.checkOutTime ?? '17:30';
    setTimeout(() => { 
      timeSaved.value = false; 
    }, 2000);
  } catch (err: any) {
    timeError.value = err.response?.data?.error || 'Lỗi lưu cấu hình giờ chấm công';
  } finally {
    savingTime.value = false;
  }
}

onMounted(() => {
  fetchOrg();
  fetchOfficeIp();
  fetchWorkHours();
});
</script>
