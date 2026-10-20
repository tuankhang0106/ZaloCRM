<template>
  <v-dialog v-model="opened" max-width="940" scrollable persistent>
    <v-card class="handover-dialog">
      <v-card-title class="handover-title"><div><div class="handover-eyebrow">SỔ BÀN GIAO CA · KHÔNG DÙNG AI</div><strong>Tóm tắt đoạn chat</strong><div class="text-caption text-medium-emphasis mt-1">{{ payload?.snapshot.customerName || 'Hội thoại' }}</div></div><v-btn icon="mdi-close" variant="text" aria-label="Đóng tóm tắt đoạn chat" :disabled="busy" @click="close" /></v-card-title>
      <v-tabs v-model="tab" density="compact" class="handover-tabs"><v-tab value="overview">Tổng quan</v-tab><v-tab value="edit">Soạn bàn giao</v-tab><v-tab value="history">Lịch sử</v-tab></v-tabs>
      <v-card-text>
        <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />
        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3">{{ error }}</v-alert>
        <v-alert v-if="success" type="success" variant="tonal" density="compact" class="mb-3">{{ success }}</v-alert>
        <template v-if="payload">
          <template v-if="tab === 'overview'">
            <div v-if="selected" class="handover-meta mb-4"><div><v-chip size="small" :color="selected.status === 'published' ? 'warning' : 'primary'">{{ stateLabel(selected.status) }}</v-chip><p class="text-caption mt-2">{{ selected.authorName }} → {{ selected.recipientName || 'Chưa chọn người nhận' }} · {{ dateTime(selected.publishedAt || selected.updatedAt) }}</p></div><v-btn size="small" variant="outlined" :disabled="busy" @click="refresh">Làm mới</v-btn></div>
            <v-alert v-if="selected?.newMessageCount" variant="tonal" type="warning" density="compact" class="mb-4">Có {{ selected.newMessageCount }} tin mới được lưu sau lúc bàn giao. Hãy kiểm tra hội thoại trước khi xử lý.</v-alert>
            <template v-if="selected && selected.status !== 'draft'">
              <div class="handover-field-grid">
                <section v-for="field in readFields" :key="field.key" class="handover-reading"><h3>{{ field.title }}</h3><p>{{ selected[field.key] || 'Chưa ghi nhận' }}</p></section>
              </div>
              <section class="handover-reading mt-3"><h3>Việc ca sau cần làm</h3>
                <div v-for="task in selected.tasks" :key="task.id" class="handover-task" :class="{ 'handover-task--done': task.done }">
                  <v-checkbox-btn :model-value="task.done" :disabled="!canUpdateTasks || busy" :aria-label="'Hoàn thành: ' + task.title" @update:model-value="updateTask(task, !!$event)" />
                  <div class="flex-grow-1"><p>{{ task.title }}</p><span class="text-caption" :class="overdue(task) ? 'text-error' : 'text-medium-emphasis'">{{ task.dueAt ? dateTime(task.dueAt) : 'Chưa đặt hạn' }}{{ overdue(task) ? ' · Quá hạn' : '' }}</span></div><v-chip v-if="task.urgent" size="x-small" color="error">Gấp</v-chip>
                </div>
              </section>
              <p v-if="selected.forwardedTo" class="text-caption text-primary my-3">Việc còn lại đã được chuyển sang bản bàn giao tiếp theo; xem bản mới trong Lịch sử.</p>
              <div v-if="selected.acceptedAt" class="text-caption text-medium-emphasis my-3">{{ selected.recipientName }} đã nhận lúc {{ dateTime(selected.acceptedAt) }}.</div>
              <v-btn v-if="canAccept" color="primary" class="mt-3" :loading="busy" prepend-icon="mdi-check-circle-outline" @click="accept">Xác nhận nhận ca</v-btn>
              <v-btn v-if="canUpdateTasks && !selected.forwardedTo && !selected.tasks.every((t: any) => t.done)" class="mt-3 ml-2" variant="outlined" :disabled="busy" @click="startNew(selected)">Chuyển việc còn lại sang ca tiếp theo</v-btn>
            </template>
            <v-alert v-else variant="tonal" type="info" density="compact" class="mb-4">Chưa có bản bàn giao đã gửi. Dữ liệu dưới đây lấy trực tiếp từ hệ thống; hãy bổ sung và xác nhận tại “Soạn bàn giao”.</v-alert>
            <section class="handover-source mt-5">
              <div class="handover-section-head"><h3>Dữ liệu {{ selected?.status !== 'draft' && selected ? 'tại lúc bàn giao' : 'hiện tại' }}</h3><span class="text-caption text-medium-emphasis">{{ dateTime(source.capturedAt) }}</span></div>
              <div class="handover-stats"><div><span>Trạng thái</span><strong>{{ statusLabel(source.status) }}</strong></div><div><span>Tài khoản</span><strong>{{ source.zaloName }}</strong></div></div>
              <p class="handover-source-note">{{ source.notes || 'Chưa có ghi chú đã lưu.' }}</p>
              <h4>Lịch hẹn đã lưu · tối đa 10 lịch chưa hoàn tất</h4><p v-if="!source.appointments?.length" class="text-caption text-medium-emphasis">Chưa có lịch hẹn.</p><p v-for="a in source.appointments" :key="a.id" class="text-caption mb-2">{{ dateOnly(a.appointmentDate) }} {{ a.appointmentTime || '' }} · {{ a.type || 'Nhắc hẹn' }}{{ a.notes ? ' — ' + a.notes : '' }}</p>
              <h4>Phiếu nhu cầu · tối đa 10 phiếu gần nhất</h4><p v-if="!source.needs?.length" class="text-caption text-medium-emphasis">Chưa có phiếu nhu cầu.</p>
              <div v-for="need in source.needs" :key="need.id" class="handover-need"><strong>{{ need.code }}</strong> · {{ needState(need.status) }}<p>{{ need.requirement || 'Chưa ghi nhu cầu' }}</p><p>Tổng {{ currency(need.totalAmount) }} · Cọc Sales khai báo {{ currency(need.depositAmount) }} (chưa xác nhận thực nhận)</p></div>
            </section>
            <v-expansion-panels class="mt-4" variant="accordion"><v-expansion-panel title="Đối chiếu 8 tin nhắn gần nhất đã lưu"><v-expansion-panel-text><p class="text-caption text-medium-emphasis mb-3">Chỉ là trích đoạn để đối chiếu, không phải tóm tắt tự động. Ảnh, file và thoại chưa được đọc nội dung.</p><div v-for="m in source.recentMessages" :key="m.id" class="handover-excerpt"><span>{{ dateTime(m.sentAt) }} · {{ m.senderType === 'self' ? 'Nhân viên' : m.senderName || 'Khách hàng' }}</span><p>{{ m.contentType === 'text' ? m.content : '[' + m.contentType + ' — xem trong hội thoại]' }}</p></div></v-expansion-panel-text></v-expansion-panel></v-expansion-panels>
          </template>
          <template v-if="tab === 'edit'">
            <p class="text-body-2 text-medium-emphasis mb-4">Ghi ngắn gọn những gì ca sau cần nắm. Hệ thống tự đính kèm trạng thái, lịch hẹn và phiếu nhu cầu khi bạn gửi.</p>
            <v-alert v-if="!payload.recipients.length" type="warning" variant="tonal" density="compact" class="mb-4">Chưa có người khác đủ quyền nhận ca trên tài khoản này. Bạn vẫn có thể lưu nháp; admin cần cấp quyền cho người ca sau để gửi bàn giao.</v-alert>
            <v-select v-model="form.recipientId" :items="payload.recipients" item-title="fullName" item-value="id" label="Người quản lý ca sau *" clearable />
            <div class="handover-field-grid"><v-textarea v-for="field in editFields" :key="field.key" v-model="form[field.key]" :label="field.title" :placeholder="field.placeholder" rows="2" auto-grow max-rows="5" maxlength="3000" /></div>
            <div class="handover-section-head mb-2"><h3>Việc ca sau cần làm *</h3><v-btn size="small" prepend-icon="mdi-plus" variant="tonal" :disabled="form.tasks.length >= 30" @click="addTask">Thêm việc</v-btn></div>
            <div v-for="(task, index) in form.tasks" :key="task.id" class="handover-task-edit">
              <div class="d-flex align-center" style="gap:8px"><v-text-field v-model="task.title" :label="'Việc ' + (Number(index) + 1)" maxlength="300" hide-details /><v-btn icon="mdi-close" variant="text" size="small" aria-label="Xóa việc bàn giao" @click="form.tasks.splice(index, 1)" /></div>
              <div class="d-flex align-center mt-2" style="gap:12px"><v-text-field v-model="task.dueAt" type="datetime-local" label="Hạn xử lý" hide-details /><v-checkbox v-model="task.urgent" label="Gấp" hide-details density="compact" /></div>
            </div>
            <p v-if="form.carriedFromId" class="text-caption text-medium-emphasis">Đã mang việc chưa hoàn tất từ bản bàn giao trước. Bạn cần kiểm tra lại và xác nhận nội dung trước khi gửi.</p>
            <div class="d-flex flex-wrap mt-4" style="gap:8px"><v-btn variant="outlined" :disabled="busy" @click="startNew()">Tạo bản mới</v-btn><v-spacer /><v-btn variant="tonal" :loading="busy" @click="save('draft')">Lưu nháp</v-btn><v-btn color="primary" :loading="busy" :disabled="!payload.recipients.length" prepend-icon="mdi-account-arrow-right-outline" @click="save('publish')">Xác nhận bàn giao</v-btn></div>
          </template>
          <template v-if="tab === 'history'">
            <p v-if="!payload.handovers.length" class="text-medium-emphasis">Chưa có bản bàn giao.</p>
            <v-list class="bg-transparent" lines="two"><v-list-item v-for="h in payload.handovers" :key="h.id" :title="h.authorName + ' → ' + (h.recipientName || 'Bản nháp')" :subtitle="dateTime(h.publishedAt || h.updatedAt) + ' · ' + stateLabel(h.status)" @click="selectRecord(h)"><template #prepend><v-icon class="mr-3" color="primary">mdi-notebook-outline</v-icon></template></v-list-item></v-list>
            <section v-if="selected" class="handover-reading mt-4"><h3>Lịch sử thao tác</h3><p v-for="(event, i) in selected.events" :key="i" class="text-caption mb-2">{{ dateTime(event.at) }} · {{ event.userName || 'Nhân viên' }} · {{ eventLabel(event) }}</p></section>
          </template>
        </template>
      </v-card-text>
      <v-card-actions class="px-5 py-3 border-t"><span class="text-caption text-medium-emphasis">{{ tab === 'edit' ? 'Bản nháp chỉ mình bạn thấy.' : 'Nội dung do nhân viên xác nhận, không gửi tới AI.' }}</span><v-spacer /><v-btn variant="text" :disabled="busy" @click="close">Đóng</v-btn></v-card-actions>
    </v-card>
  </v-dialog>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { CUSTOMER_STATUS_LIST } from '@/constants/customer-statuses';
const opened = defineModel<boolean>({ default: false });
const props = defineProps<{ conversationId: string; initialHandoverId?: string }>();
const emit = defineEmits<{ saved: [] }>();
const auth = useAuthStore();
const tab = ref('overview'), payload = ref<any>(null), selectedId = ref('');
const loading = ref(false), busy = ref(false), error = ref(''), success = ref('');
const empty = () => ({ id: crypto.randomUUID(), version: 0, recipientId: '', requirement: '', agreements: '', workDone: '', waitingOn: '', important: '', tasks: [] as any[], carriedFromId: '' });
const form = ref<any>(empty()), baseline = ref('');
const selected = computed(() => payload.value?.handovers.find((h: any) => h.id === selectedId.value));
const source = computed(() => selected.value && selected.value.status !== 'draft' ? selected.value.snapshot : payload.value?.snapshot || {});
const canAccept = computed(() => selected.value?.recipientId === auth.user?.id && selected.value?.status === 'published');
const canUpdateTasks = computed(() => selected.value?.recipientId === auth.user?.id && !!selected.value?.acceptedAt && !selected.value?.forwardedTo);
const readFields = [{ key: 'requirement', title: 'Nhu cầu hiện tại' }, { key: 'agreements', title: 'Đã thống nhất với khách' }, { key: 'workDone', title: 'Đã xử lý trong ca' }, { key: 'waitingOn', title: 'Đang chờ ai / chờ gì' }, { key: 'important', title: 'Lưu ý quan trọng' }];
const editFields = readFields.map(f => ({ ...f, title: f.title + (['requirement', 'workDone'].includes(f.key) ? ' *' : ''), placeholder: ({ requirement: 'Khách cần sản phẩm / dịch vụ gì?', agreements: 'Giá, mẫu, thời gian và cam kết đã chốt…', workDone: 'Đã gửi báo giá, gọi khách, xử lý việc gì…', waitingOn: 'Đang chờ khách, kế toán hay nhà cung cấp?', important: 'Điều ca sau không được bỏ sót…' } as any)[f.key] }));
const dateTime = (value: string) => value ? new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }) : '—';
const dateOnly = (value: string) => value ? new Date(value).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—';
const currency = (value: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value || 0);
const statusLabel = (value: string) => CUSTOMER_STATUS_LIST.find(s => s.id === value || s.aliases.includes(value))?.label || 'Chưa phân loại';
const stateLabel = (value: string) => ({ draft: 'Bản nháp', published: 'Chờ nhận ca', accepted: 'Đã nhận ca' } as any)[value] || value;
const needState = (value: string) => ({ draft: 'Bản nháp', pending_connection: 'Chờ kết nối CRM', sent: 'Đã gửi CRM' } as any)[value] || value;
const overdue = (task: any) => !task.done && task.dueAt && new Date(task.dueAt).getTime() < Date.now();
const eventLabel = (e: any) => e.type === 'task_updated' ? e.done ? 'Đánh dấu việc đã xong' : 'Mở lại việc' : ({ draft_saved: 'Lưu nháp', published: 'Xác nhận bàn giao', accepted: 'Xác nhận nhận ca', forwarded: 'Chuyển việc sang ca tiếp theo' } as any)[e.type] || e.type;
const localDate = (value: string | null) => { if (!value) return ''; const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
function fill(h: any) { form.value = JSON.parse(JSON.stringify(h)); form.value.tasks = h.tasks.map((t: any) => ({ ...t, dueAt: localDate(t.dueAt) })); baseline.value = JSON.stringify(form.value); }
function confirmDiscard() { return JSON.stringify(form.value) === baseline.value || confirm('Bỏ các thay đổi bàn giao chưa lưu?'); }
function startNew(previous?: any) {
  if (!confirmDiscard()) return;
  form.value = empty();
  if (!previous && payload.value?.snapshot.needs?.[0]?.requirement) form.value.requirement = payload.value.snapshot.needs[0].requirement;
  if (previous) { for (const f of readFields) form.value[f.key] = previous[f.key] || ''; form.value.carriedFromId = previous.id; form.value.tasks = previous.tasks.filter((t: any) => !t.done).map((t: any) => ({ ...t, id: crypto.randomUUID(), dueAt: localDate(t.dueAt), done: false })); }
  baseline.value = JSON.stringify(form.value); tab.value = 'edit'; error.value = ''; success.value = '';
}
function addTask() { form.value.tasks.push({ id: crypto.randomUUID(), title: '', dueAt: '', urgent: false, done: false }); }
async function refresh() {
  loading.value = true; error.value = '';
  try { const res = await api.get(`/conversations/${props.conversationId}/shift-handovers`); payload.value = res.data; if (!selectedId.value || !res.data.handovers.some((h: any) => h.id === selectedId.value)) selectedId.value = res.data.handovers.find((h: any) => h.status !== 'draft')?.id || ''; }
  catch (e: any) { error.value = e.response?.data?.error || 'Không tải được bản bàn giao. Hãy thử lại.'; }
  finally { loading.value = false; }
}
function selectRecord(h: any) { if (!confirmDiscard()) return; selectedId.value = h.id; if (h.status === 'draft' && h.authorId === auth.user?.id) { fill(h); tab.value = 'edit'; } else tab.value = 'overview'; }
async function save(intent: 'draft' | 'publish') {
  if (busy.value) return;
  error.value = ''; success.value = '';
  if (intent === 'publish' && (!form.value.recipientId || !form.value.requirement.trim() || !form.value.workDone.trim() || !form.value.tasks.length)) { error.value = 'Chọn người nhận, điền nhu cầu, việc đã làm và ít nhất một việc ca sau cần xử lý.'; return; }
  if (form.value.tasks.some((t: any) => !t.title.trim())) { error.value = 'Vui lòng điền tên cho từng việc cần làm.'; return; }
  busy.value = true;
  try { const data = { ...form.value, intent, tasks: form.value.tasks.map((t: any) => ({ ...t, dueAt: t.dueAt ? new Date(t.dueAt).toISOString() : null })) }; const res = await api.post(`/conversations/${props.conversationId}/shift-handovers`, data); fill(res.data.handover); selectedId.value = res.data.handover.id; await refresh(); if (intent === 'publish') tab.value = 'overview'; success.value = res.data.message; emit('saved'); }
  catch (e: any) { error.value = e.response?.data?.error || 'Không lưu được bàn giao. Nội dung đang nhập vẫn được giữ.'; }
  finally { busy.value = false; }
}
async function mutate(path: string, data: any, method: 'post' | 'patch') {
  if (busy.value) return;
  busy.value = true; error.value = ''; success.value = '';
  try { await api[method](`/conversations/${props.conversationId}/shift-handovers/${selected.value.id}/${path}`, { version: selected.value.version, ...data }); await refresh(); emit('saved'); }
  catch (e: any) { error.value = e.response?.data?.error || 'Không cập nhật được. Hãy làm mới và thử lại.'; }
  finally { busy.value = false; }
}
function accept() { return mutate('accept', {}, 'post'); }
function updateTask(task: any, done: boolean) { return mutate('tasks', { taskId: task.id, done }, 'patch'); }
function close() { if (confirmDiscard()) opened.value = false; }
watch(opened, async value => { if (!value) return; form.value = empty(); baseline.value = JSON.stringify(form.value); payload.value = null; selectedId.value = props.initialHandoverId || ''; error.value = ''; success.value = ''; tab.value = 'overview'; await refresh(); const draft = payload.value?.handovers.find((h: any) => h.status === 'draft' && h.authorId === auth.user?.id); if (draft) fill(draft); else if (payload.value?.snapshot.needs?.[0]?.requirement) { form.value.requirement = payload.value.snapshot.needs[0].requirement; baseline.value = JSON.stringify(form.value); } }, { immediate: true });
</script>
<style scoped>
.handover-title { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; white-space:normal; }
.handover-title > div { min-width:0; }
.handover-title > .v-btn { flex-shrink:0; }
.handover-title .text-caption { font-size:12px !important; }
.handover-eyebrow { font-size:10px; letter-spacing:1px; color:rgb(var(--v-theme-primary)); margin-bottom:6px; }
.handover-tabs { flex:0 0 40px; }
.handover-tabs :deep(.v-tab) { text-transform:none; min-width:0; padding-inline:14px; font-size:12px; }
.handover-field-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.handover-field-grid > :last-child:nth-child(odd) { grid-column:1 / -1; }
.handover-reading, .handover-source { border:1px solid rgba(var(--v-theme-on-surface),.1); padding:16px; border-radius:12px; }
.handover-reading h3, .handover-source h3 { font-size:12px; margin-bottom:8px; color:rgb(var(--v-theme-primary)); }
.handover-reading p, .handover-source-note { white-space:pre-wrap; font-size:13px; overflow-wrap:anywhere; line-height:1.7; }
.handover-source h4 { font-size:11px; margin:16px 0 8px; }
.handover-source-note { margin-top:12px; }
.handover-meta, .handover-section-head { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; }
.handover-section-head h3 { font-size:12px; }
.handover-stats { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.handover-stats span { display:block; font-size:10px; opacity:.65; }
.handover-stats strong { font-size:12px; }
.handover-task { display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid rgba(var(--v-theme-on-surface),.07); }
.handover-task p { margin:0; }
.handover-task :deep(.v-selection-control) { flex:0 0 auto; }
.handover-task--done p { text-decoration:line-through; opacity:.6; }
.handover-task-edit { padding:12px; margin-bottom:10px; border:1px solid rgba(var(--v-theme-on-surface),.1); border-radius:10px; }
.handover-excerpt { padding:10px 0; border-bottom:1px solid rgba(var(--v-theme-on-surface),.08); }
.handover-excerpt span { font-size:10px; opacity:.65; }
.handover-excerpt p, .handover-need { font-size:12px; white-space:pre-wrap; overflow-wrap:anywhere; }
.handover-need { margin-bottom:10px; }
@media(max-width:600px) { .handover-field-grid { grid-template-columns:1fr; } .handover-dialog :deep(.v-card-text) { padding:16px; } }
</style>
