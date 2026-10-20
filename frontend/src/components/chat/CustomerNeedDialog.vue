<template>
  <v-dialog v-model="opened" max-width="960" scrollable persistent>
    <v-card class="need-dialog">
      <v-card-title class="d-flex align-center justify-space-between">
        <div><div class="text-caption text-medium-emphasis">BÀN GIAO SALES → KẾ TOÁN</div><span>Tạo nhu cầu khách hàng</span></div>
        <v-btn icon="mdi-close" variant="text" aria-label="Đóng form nhu cầu" :disabled="saving" @click="close" />
      </v-card-title>
      <v-card-text>
        <v-alert variant="tonal" type="info" density="compact" class="mb-4">Phiếu được lưu tại ZaloCRM. CRM chưa có API tiếp nhận, nên kế toán chưa nhận được phiếu ở giai đoạn này.</v-alert>
        <div class="need-context mb-5"><span><strong>{{ organizationName }}</strong> · {{ salesName }}</span><v-chip size="small" :color="status === 'draft' ? 'default' : 'warning'">{{ status === 'draft' ? 'Bản nháp' : 'Chờ kết nối CRM' }}</v-chip></div>
        <v-select v-if="history.length" :items="historyOptions" :model-value="form.id" label="Phiếu đã lưu của hội thoại" hide-details class="mb-4" @update:model-value="loadExisting" />
        <v-btn v-if="history.length" variant="text" size="small" prepend-icon="mdi-plus" class="mb-4" @click="newForm">Tạo phiếu mới</v-btn>
        <v-form ref="formRef" @submit.prevent="save('send')">
          <div class="need-section-title">01 · Khách hàng & yêu cầu</div>
          <v-row dense>
            <v-col cols="12" sm="6"><v-text-field v-model="form.customerName" label="Tên khách hàng *" :rules="[required]" /></v-col>
            <v-col cols="12" sm="6"><v-text-field v-model="form.phone" label="Số điện thoại *" :rules="[required]" /></v-col>
            <v-col cols="12" sm="6"><v-text-field v-model="form.closedDate" type="date" label="Ngày chốt đơn *" :rules="[required]" /></v-col>
            <v-col cols="12" sm="6"><v-select v-model="form.priority" :items="[{ title: 'Bình thường', value: 'normal' }, { title: 'Cần xử lý gấp', value: 'urgent' }]" label="Mức ưu tiên" /></v-col>
            <v-col cols="12"><v-textarea v-model="form.requirement" rows="2" label="Nhu cầu khách hàng *" placeholder="Khách đặt gì, mục đích sử dụng, yêu cầu cần kế toán nắm…" :rules="[required]" /></v-col>
          </v-row>
          <div class="need-section-title">02 · Sản phẩm & mẫu mã</div>
          <div v-for="(item, index) in form.items" :key="index" class="need-item mb-3">
            <div class="d-flex align-center justify-space-between mb-2"><strong class="text-caption">Sản phẩm {{ index + 1 }}</strong><v-btn icon="mdi-delete-outline" variant="text" size="x-small" :disabled="form.items.length === 1" aria-label="Xóa sản phẩm" @click="form.items.splice(index, 1)" /></div>
            <v-row dense>
              <v-col cols="12" sm="6"><v-text-field v-model="item.name" label="Tên sản phẩm *" :rules="[required]" /></v-col>
              <v-col cols="12" sm="6"><v-text-field v-model="item.specification" label="Mẫu mã / màu / size / chất liệu" /></v-col>
              <v-col cols="6" sm="3"><v-text-field v-model.number="item.quantity" type="number" min="0.01" step="any" label="Số lượng *" :rules="[positive]" /></v-col>
              <v-col cols="6" sm="3"><v-text-field v-model="item.unit" label="Đơn vị tính" /></v-col>
              <v-col cols="12" sm="6"><v-text-field v-model.number="item.unitPrice" type="number" min="0" label="Đơn giá (VND) *" :rules="[nonnegative]" /></v-col>
            </v-row>
          </div>
          <v-btn variant="tonal" size="small" prepend-icon="mdi-plus" class="mb-4" @click="form.items.push(blankItem())">Thêm sản phẩm</v-btn>
          <v-textarea v-model="form.referenceLinks" rows="2" label="Liên kết mẫu duyệt / bảng size / chứng từ" placeholder="Dán liên kết tài liệu, mỗi liên kết một dòng. Cần cấp quyền cho kế toán." />
          <div class="need-section-title">03 · Giá trị đơn & tiền cọc</div>
          <v-row dense>
            <v-col cols="6"><v-text-field v-model.number="form.extraCharges" type="number" min="0" label="VAT / phí thêm (VND)" :rules="[nonnegative]" /></v-col>
            <v-col cols="6"><v-text-field v-model.number="form.discount" type="number" min="0" label="Giảm giá (VND)" :rules="[nonnegative]" /></v-col>
            <v-col cols="12" sm="6"><v-text-field v-model.number="form.depositAmount" type="number" min="0" label="Khách đã cọc (VND) *" :rules="[nonnegative]" /></v-col>
            <v-col cols="12" sm="6"><v-text-field v-model="form.depositDate" type="date" label="Ngày khách đặt cọc" :rules="form.depositAmount > 0 ? [required] : []" /></v-col>
            <v-col cols="12" sm="6"><v-select v-model="form.paymentMethod" :items="['Chuyển khoản', 'Tiền mặt', 'Khác']" label="Phương thức thanh toán" :rules="form.depositAmount > 0 ? [required] : []" /></v-col>
            <v-col cols="12" sm="6"><v-text-field v-model="form.receivingAccount" label="Tài khoản / người nhận tiền" /></v-col>
            <v-col cols="12"><v-text-field v-model="form.transactionReference" label="Mã giao dịch / nội dung chuyển khoản" /></v-col>
          </v-row>
          <div class="need-totals mb-2"><span>Tổng giá trị <strong>{{ currency(total) }}</strong></span><span>Đã cọc khai báo <strong>{{ currency(form.depositAmount) }}</strong></span><span>Còn lại dự kiến <strong>{{ currency(total - Number(form.depositAmount || 0)) }}</strong></span></div>
          <p class="text-caption text-medium-emphasis mb-5">Tiền cọc do Sales khai báo, chưa được kế toán xác nhận thực nhận.</p>
          <div class="need-section-title">04 · Giao hàng & ghi chú</div>
          <v-row dense>
            <v-col cols="12" sm="6"><v-text-field v-model="form.deliveryDate" type="date" label="Ngày giao dự kiến" /></v-col>
            <v-col cols="12" sm="6"><v-text-field v-model="form.recipient" label="Người nhận / điện thoại nhận hàng" /></v-col>
            <v-col cols="12"><v-text-field v-model="form.deliveryAddress" label="Địa chỉ giao hàng" /></v-col>
            <v-col cols="12" sm="6"><v-textarea v-model="form.customerNote" rows="3" label="Ghi chú / cam kết với khách hàng" /></v-col>
            <v-col cols="12" sm="6"><v-textarea v-model="form.internalNote" rows="3" label="Ghi chú nội bộ cho kế toán" /></v-col>
          </v-row>
        </v-form>
        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-3">{{ error }}</v-alert>
        <v-alert v-if="message" type="success" variant="tonal" density="compact" class="mt-3">{{ message }}</v-alert>
      </v-card-text>
      <v-card-actions class="pa-4 border-t" style="flex-wrap: wrap; gap: 8px;">
        <span class="text-caption text-medium-emphasis mr-auto">{{ code || 'Phiếu mới' }} · {{ status === 'draft' ? 'Chưa gửi' : 'Kế toán chưa nhận' }}</span>
        <v-btn variant="outlined" :disabled="saving" @click="save('draft')">Lưu nháp</v-btn>
        <v-btn color="primary" variant="flat" prepend-icon="mdi-send-outline" :loading="saving" @click="save('send')">Lưu phiếu chờ gửi CRM</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
const opened = defineModel<boolean>({ default: false });
const props = defineProps<{ conversationId: string; customerName?: string | null; phone?: string | null }>();
const auth = useAuthStore();
const organizationName = computed(() => auth.user?.orgName || 'Doanh nghiệp hiện tại');
const salesName = computed(() => auth.user?.fullName || 'Sales');
const blankItem = () => ({ name: '', specification: '', quantity: 1, unit: '', unitPrice: 0 });
const today = () => new Date().toLocaleDateString('sv-SE');
const initial = () => ({ id: crypto.randomUUID(), customerName: props.customerName || '', phone: props.phone || '', closedDate: today(), priority: 'normal', requirement: '', items: [blankItem()], referenceLinks: '', extraCharges: 0, discount: 0, depositAmount: 0, depositDate: '', paymentMethod: '', receivingAccount: '', transactionReference: '', deliveryDate: '', recipient: '', deliveryAddress: '', customerNote: '', internalNote: '' });
const form = ref(initial());
const formRef = ref();
const saving = ref(false), error = ref(''), message = ref(''), code = ref(''), status = ref('draft');
const baseline = ref('');
const history = ref<any[]>([]);
const historyOptions = computed(() => history.value.map(n => ({ title: `${n.code} · ${n.status === 'draft' ? 'Bản nháp' : 'Chờ kết nối CRM'}`, value: n.id })));
const total = computed(() => form.value.items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0) + Number(form.value.extraCharges || 0) - Number(form.value.discount || 0));
const currency = (value: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(value) || 0);
const required = (v: unknown) => !!String(v ?? '').trim() || 'Bắt buộc';
const nonnegative = (v: unknown) => (v !== '' && v !== null && Number.isFinite(Number(v)) && Number(v) >= 0) || 'Nhập số tiền hợp lệ';
const positive = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0) || 'Số lượng phải lớn hơn 0';
function newForm() { form.value = initial(); code.value = ''; status.value = 'draft'; error.value = ''; message.value = ''; formRef.value?.resetValidation(); baseline.value = JSON.stringify(form.value); }
function loadExisting(id: string) { const need = history.value.find(n => n.id === id); if (!need) return; form.value = { ...initial(), ...JSON.parse(JSON.stringify(need)) }; code.value = need.code; status.value = need.status; baseline.value = JSON.stringify(form.value); message.value = ''; error.value = ''; }
async function refresh() { const res = await api.get(`/conversations/${props.conversationId}/customer-needs`); history.value = res.data.needs || []; }
watch(opened, async value => { if (value) { newForm(); try { await refresh(); if (history.value[0]) loadExisting(history.value[0].id); } catch { error.value = 'Không tải được phiếu đã lưu. Vui lòng đóng và thử lại.'; } } });
async function save(intent: 'draft' | 'send') {
  error.value = ''; message.value = '';
  if (intent === 'send' && !(await formRef.value?.validate())?.valid) { error.value = 'Vui lòng kiểm tra các mục bắt buộc trong form.'; return; }
  saving.value = true;
  try { const res = await api.post(`/conversations/${props.conversationId}/customer-needs`, { ...form.value, intent }); code.value = res.data.need.code; status.value = res.data.need.status; message.value = res.data.message; baseline.value = JSON.stringify(form.value); await refresh(); }
  catch (e: any) { error.value = e.response?.data?.error || 'Không lưu được phiếu. Vui lòng thử lại; dữ liệu đang nhập vẫn được giữ.'; }
  finally { saving.value = false; }
}
function close() { if (JSON.stringify(form.value) !== baseline.value && !confirm('Đóng form? Thông tin chưa lưu sẽ bị mất.')) return; opened.value = false; }
</script>
<style scoped>
.need-dialog > .v-card-title { gap: 8px; white-space: normal; font-size: 20px !important; }
.need-dialog > .v-card-title > div { min-width: 0; }
.need-dialog > .v-card-title .text-caption { font-size: 10px !important; letter-spacing: 1px; margin-bottom: 4px; }
.need-dialog > .v-card-title > .v-btn { flex-shrink: 0; }
.need-context { display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px; padding:12px 16px; background:rgba(var(--v-theme-primary),.06); border-radius:10px; font-size:12px; }
.need-section-title { font-size:12px; font-weight:700; letter-spacing:.5px; margin:12px 0 18px; color:rgb(var(--v-theme-primary)); }
.need-item { padding:14px; border:1px solid rgba(var(--v-theme-on-surface),.12); border-radius:12px; }
.need-totals { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; padding:16px; background:rgba(var(--v-theme-primary),.06); border-radius:10px; font-size:11px; }
.need-totals strong { display:block; font-size:16px; margin-top:6px; }
@media(max-width:600px) { .need-totals { grid-template-columns:1fr; } }
</style>
