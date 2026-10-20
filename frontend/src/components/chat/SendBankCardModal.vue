<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="560"
    scrollable
  >
    <v-card rounded="xl" class="d-flex flex-column send-bank-card-dialog">
      <!-- Header -->
      <v-card-title class="d-flex align-center justify-space-between pa-4 border-b">
        <div class="d-flex align-center" style="gap: 10px;">
          <v-avatar size="34" color="primary" variant="tonal" rounded="lg">
            <v-icon color="primary" size="20">mdi-credit-card-fast-outline</v-icon>
          </v-avatar>
          <div>
            <div class="text-subtitle-1 font-weight-bold" style="line-height: 1.2;">Gửi Thẻ Ngân Hàng & VietQR</div>
            <div class="text-caption text-medium-emphasis">Gửi thông tin chuyển khoản chuẩn Napas247 cho khách hàng</div>
          </div>
        </div>
        <v-btn icon="mdi-close" variant="text" size="small" @click="$emit('update:modelValue', false)" />
      </v-card-title>

      <v-card-text class="pa-4 overflow-y-auto" style="max-height: 75vh;">
        <!-- Saved Accounts Selector -->
        <div v-if="savedAccounts.length > 0" class="mb-4">
          <div class="text-caption font-weight-bold text-medium-emphasis mb-2 d-flex align-center justify-space-between">
            <span class="d-flex align-center" style="gap: 4px;">
              <v-icon size="14">mdi-bookmark-outline</v-icon>
              Tài khoản mẫu đã lưu
            </span>
            <span class="text-caption" style="font-size: 0.72rem;">{{ savedAccounts.length }} mẫu</span>
          </div>
          <div class="d-flex flex-wrap" style="gap: 8px;">
            <v-chip
              v-for="(acc, idx) in savedAccounts"
              :key="idx"
              variant="tonal"
              size="small"
              class="font-weight-medium"
              closable
              @click="applySavedAccount(acc)"
              @click:close.stop="removeSavedAccount(idx)"
            >
              <v-icon start size="14">mdi-bank</v-icon>
              {{ acc.bankShortName || acc.bankName }} - {{ acc.numAccBank }}
            </v-chip>
          </div>
        </div>

        <v-form ref="formRef" @submit.prevent="handleSend">
          <!-- Bank Select -->
          <v-autocomplete
            v-model="form.binBank"
            :items="popularBanks"
            item-title="title"
            item-value="bin"
            label="Ngân hàng thụ hưởng *"
            placeholder="Chọn hoặc tìm ngân hàng..."
            variant="outlined"
            density="compact"
            prepend-inner-icon="mdi-bank"
            :rules="[v => !!v || 'Vui lòng chọn ngân hàng']"
            class="mb-3"
            @update:model-value="onBankChanged"
          />

          <!-- Account Number -->
          <v-text-field
            v-model="form.numAccBank"
            label="Số tài khoản thụ hưởng *"
            placeholder="Nhập số tài khoản ngân hàng..."
            variant="outlined"
            density="compact"
            prepend-inner-icon="mdi-numeric"
            :rules="[v => !!v?.trim() || 'Vui lòng nhập số tài khoản']"
            class="mb-3"
          />

          <!-- Account Name -->
          <v-text-field
            v-model="form.nameAccBank"
            label="Tên chủ tài khoản *"
            placeholder="NGUYEN VAN A (viết hoa không dấu)"
            variant="outlined"
            density="compact"
            prepend-inner-icon="mdi-account"
            :rules="[v => !!v?.trim() || 'Vui lòng nhập tên chủ tài khoản']"
            class="mb-3"
            @input="form.nameAccBank = form.nameAccBank.toUpperCase()"
          />

          <div class="row-inputs d-flex" style="gap: 12px;">
            <!-- Amount -->
            <v-text-field
              v-model="formattedAmount"
              label="Số tiền (VNĐ)"
              placeholder="VD: 500,000 (tùy chọn)"
              variant="outlined"
              density="compact"
              prepend-inner-icon="mdi-cash"
              class="mb-3 flex-grow-1"
              @input="onAmountInput"
            />

            <!-- Note / Content -->
            <v-text-field
              v-model="form.note"
              label="Nội dung chuyển khoản"
              placeholder="VD: TT DON HANG 102"
              variant="outlined"
              density="compact"
              prepend-inner-icon="mdi-text-short"
              class="mb-3 flex-grow-1"
            />
          </div>

          <!-- Save template checkbox -->
          <v-checkbox
            v-model="saveForNextTime"
            label="Lưu tài khoản này vào danh sách mẫu dùng lại"
            density="compact"
            hide-details
            color="primary"
            class="mb-3"
          />

          <!-- Live VietQR Preview -->
          <div v-if="isValidForQr" class="qr-preview-box pa-3 rounded-xl border mt-2">
            <div class="d-flex align-center justify-space-between mb-2">
              <span class="text-caption font-weight-bold d-flex align-center text-primary" style="gap: 4px;">
                <v-icon size="14">mdi-qrcode-scan</v-icon>
                Xem trước mã VietQR sẽ gửi
              </span>
              <v-chip size="x-small" color="primary" variant="flat" class="font-weight-bold">Napas 247</v-chip>
            </div>
            <div class="d-flex align-center justify-center py-2">
              <img
                :src="previewQrUrl"
                alt="VietQR Preview"
                class="rounded-lg border"
                style="max-width: 200px; height: auto; box-shadow: 0 4px 16px rgba(0,0,0,0.06);"
                loading="lazy"
              />
            </div>
            <div class="text-center text-caption text-medium-emphasis mt-1">
              {{ selectedBankName }} • {{ form.numAccBank }} • {{ form.nameAccBank }}
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
          color="primary"
          variant="flat"
          rounded="lg"
          prepend-icon="mdi-send"
          :loading="submitting"
          @click="handleSend"
        >
          Gửi thẻ ngân hàng
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
const saveForNextTime = ref(true);

const form = ref({
  binBank: '970436', // Default Vietcombank
  bankName: 'Vietcombank',
  numAccBank: '',
  nameAccBank: '',
  amount: 0,
  note: '',
});

const formattedAmount = ref('');

interface BankItem {
  bin: string;
  shortName: string;
  name: string;
  title: string;
}

const popularBanks: BankItem[] = [
  { bin: '970436', shortName: 'Vietcombank', name: 'Ngoại thương Việt Nam', title: 'Vietcombank (VCB) - 970436' },
  { bin: '970422', shortName: 'MBBank', name: 'Quân đội', title: 'MBBank (MB) - 970422' },
  { bin: '970407', shortName: 'Techcombank', name: 'Kỹ thương Việt Nam', title: 'Techcombank (TCB) - 970407' },
  { bin: '970415', shortName: 'VietinBank', name: 'Công thương Việt Nam', title: 'VietinBank (CTG) - 970415' },
  { bin: '970418', shortName: 'BIDV', name: 'Đầu tư và Phát triển Việt Nam', title: 'BIDV - 970418' },
  { bin: '970416', shortName: 'ACB', name: 'Á Châu', title: 'ACB - Á Châu - 970416' },
  { bin: '970432', shortName: 'VPBank', name: 'Việt Nam Thịnh Vượng', title: 'VPBank - 970432' },
  { bin: '970423', shortName: 'TPBank', name: 'Tiên Phong', title: 'TPBank - 970423' },
  { bin: '970403', shortName: 'Sacombank', name: 'Sài Gòn Thương Tín', title: 'Sacombank - 970403' },
  { bin: '970441', shortName: 'VIB', name: 'Quốc Tế', title: 'VIB - Quốc Tế - 970441' },
  { bin: '970405', shortName: 'Agribank', name: 'Nông nghiệp và Phát triển Nông thôn', title: 'Agribank - 970405' },
  { bin: '970437', shortName: 'HDBank', name: 'Phát triển TP.HCM', title: 'HDBank - 970437' },
  { bin: '970426', shortName: 'MSB', name: 'Hàng Hải', title: 'MSB - Hàng Hải - 970426' },
  { bin: '970443', shortName: 'SHB', name: 'Sài Gòn - Hà Nội', title: 'SHB - 970443' },
  { bin: '970448', shortName: 'OCB', name: 'Phương Đông', title: 'OCB - Phương Đông - 970448' },
  { bin: '970440', shortName: 'SeABank', name: 'Đông Nam Á', title: 'SeABank - 970440' },
  { bin: '970428', shortName: 'NamABank', name: 'Nam Á', title: 'NamABank - 970428' },
  { bin: '970429', shortName: 'SCB', name: 'Sài Gòn', title: 'SCB - 970429' },
  { bin: '970454', shortName: 'VietCapitalBank', name: 'Bản Việt (BVBank)', title: 'BVBank - 970454' },
];

interface SavedBankAcc {
  binBank: string;
  bankName: string;
  bankShortName: string;
  numAccBank: string;
  nameAccBank: string;
}

const savedAccounts = ref<SavedBankAcc[]>([]);

function loadSavedAccounts() {
  try {
    const raw = localStorage.getItem('crm_saved_bank_accounts');
    if (raw) {
      savedAccounts.value = JSON.parse(raw);
    }
  } catch {}
}

function saveAccountToStorage(acc: SavedBankAcc) {
  try {
    const existing = savedAccounts.value.filter(
      a => !(a.binBank === acc.binBank && a.numAccBank === acc.numAccBank)
    );
    existing.unshift(acc);
    savedAccounts.value = existing.slice(0, 8); // max 8 saved
    localStorage.setItem('crm_saved_bank_accounts', JSON.stringify(savedAccounts.value));
  } catch {}
}

function removeSavedAccount(idx: number) {
  savedAccounts.value.splice(idx, 1);
  localStorage.setItem('crm_saved_bank_accounts', JSON.stringify(savedAccounts.value));
}

function applySavedAccount(acc: SavedBankAcc) {
  form.value.binBank = acc.binBank;
  form.value.bankName = acc.bankName;
  form.value.numAccBank = acc.numAccBank;
  form.value.nameAccBank = acc.nameAccBank;
}

function onBankChanged(bin: string) {
  const found = popularBanks.find(b => b.bin === bin);
  if (found) {
    form.value.bankName = found.shortName;
  }
}

function onAmountInput(e: any) {
  const val = String(e.target.value || '').replace(/\D/g, '');
  const num = parseInt(val, 10) || 0;
  form.value.amount = num;
  formattedAmount.value = num > 0 ? num.toLocaleString('vi-VN') : '';
}

const selectedBankName = computed(() => {
  const b = popularBanks.find(item => item.bin === form.value.binBank);
  return b ? b.shortName : form.value.bankName;
});

const isValidForQr = computed(() => {
  return form.value.binBank && form.value.numAccBank?.trim() && form.value.nameAccBank?.trim();
});

const previewQrUrl = computed(() => {
  if (!isValidForQr.value) return '';
  const bin = form.value.binBank;
  const num = form.value.numAccBank.trim();
  const amt = form.value.amount || 0;
  const note = encodeURIComponent(form.value.note || '');
  const name = encodeURIComponent(form.value.nameAccBank.trim());
  return `https://img.vietqr.io/image/${bin}-${num}-compact2.png?amount=${amt}&addInfo=${note}&accountName=${name}`;
});

async function handleSend() {
  errorMessage.value = '';
  if (formRef.value) {
    const valid = await formRef.value.validate();
    if (!valid.valid) return;
  }

  submitting.value = true;
  try {
    const payload = {
      binBank: form.value.binBank,
      numAccBank: form.value.numAccBank.trim(),
      nameAccBank: form.value.nameAccBank.trim(),
      bankName: selectedBankName.value,
      amount: form.value.amount || 0,
      note: form.value.note?.trim() || '',
    };

    const res = await api.post(`/conversations/${props.conversationId}/send-bank-card`, payload);

    if (saveForNextTime.value) {
      saveAccountToStorage({
        binBank: payload.binBank,
        bankName: payload.bankName,
        bankShortName: selectedBankName.value,
        numAccBank: payload.numAccBank,
        nameAccBank: payload.nameAccBank,
      });
    }

    emit('sent', res.data?.data);
    emit('update:modelValue', false);
  } catch (err: any) {
    errorMessage.value = err.response?.data?.error || err.message || 'Không thể gửi thẻ ngân hàng';
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  loadSavedAccounts();
});
</script>

<style scoped>
.send-bank-card-dialog {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}

.qr-preview-box {
  background: rgba(var(--v-theme-surface-variant), 0.25);
  border-color: rgba(var(--v-border-color), var(--v-border-opacity)) !important;
}
</style>
