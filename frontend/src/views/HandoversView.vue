<template>
  <div class="handover-page">
    <div class="d-flex align-center justify-space-between flex-wrap mb-5" style="gap:12px"><div><div class="text-caption text-medium-emphasis mb-1">TIẾP NỐI CÔNG VIỆC GIỮA HAI CA</div><h1 class="text-h5 font-weight-bold">Bàn giao ca</h1><p class="text-body-2 text-medium-emphasis mt-2">Xem việc còn lại, xác nhận nhận ca và theo dõi cập nhật của khách.</p></div><v-btn variant="outlined" prepend-icon="mdi-refresh" :loading="loading" @click="fetchList">Làm mới</v-btn></div>
    <div class="handover-overview mb-5"><v-card v-for="card in cards" :key="card.title" class="pa-4"><span class="text-caption text-medium-emphasis">{{ card.title }}</span><div class="text-h5 font-weight-bold mt-2" :class="card.color">{{ card.value }}</div></v-card></div>
    <v-tabs v-model="filter" class="mb-4" density="compact"><v-tab value="received">Ca tôi cần nhận</v-tab><v-tab value="open">Việc tôi đang xử lý</v-tab><v-tab value="sent">Đã bàn giao</v-tab><v-tab value="drafts">Bản nháp</v-tab><v-tab value="all">Tất cả của tôi</v-tab></v-tabs>
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
    <v-card v-if="!loading && !visible.length" class="pa-8 text-center"><v-icon size="36" color="primary" class="mb-3">mdi-notebook-check-outline</v-icon><p>Chưa có bản bàn giao trong mục này.</p><p class="text-caption text-medium-emphasis mt-2">Mở hội thoại → Thông tin → Tóm tắt đoạn chat để lập bàn giao.</p></v-card>
    <div v-for="h in visible" :key="h.id" class="mb-3">
      <v-card class="pa-4">
        <div class="d-flex align-center justify-space-between flex-wrap" style="gap:10px"><div><strong>{{ h.snapshot.customerName }}</strong><span class="text-caption text-medium-emphasis ml-2">{{ h.snapshot.zaloName }}</span></div><v-chip size="small" :color="h.status === 'published' ? 'warning' : 'primary'">{{ stateLabel(h) }}</v-chip></div>
        <p class="text-caption text-medium-emphasis mt-2">{{ h.authorName }} → {{ h.recipientName || 'Chưa chọn người nhận' }} · {{ dateTime(h.publishedAt || h.updatedAt) }}</p>
        <p class="text-body-2 mt-3">{{ h.requirement || 'Chưa ghi nhu cầu' }}</p>
        <div class="d-flex flex-wrap align-center mt-3" style="gap:8px"><v-chip size="small" variant="tonal">{{ h.forwardedTo ? 0 : h.tasks.filter((t: any) => !t.done).length }} việc còn lại</v-chip><v-chip v-if="isUrgent(h)" size="small" color="error">Việc gấp / quá hạn</v-chip><v-chip v-if="h.newMessageCount" size="small" color="warning">{{ h.newMessageCount }} tin mới sau bàn giao</v-chip><v-spacer /><v-btn variant="text" size="small" :to="{ path: '/chat', query: { convId: h.conversationId } }">Mở hội thoại</v-btn><v-btn color="primary" size="small" @click="open(h)">{{ h.status === 'draft' ? 'Tiếp tục soạn' : 'Xem bàn giao' }}</v-btn></div>
      </v-card>
    </div>
    <HandoverDialog v-if="chosen" :key="chosen.id" v-model="dialog" :conversation-id="chosen.conversationId" :initial-handover-id="chosen.id" @saved="fetchList" />
  </div>
</template>
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import HandoverDialog from '@/components/handovers/HandoverDialog.vue';
const auth = useAuthStore();
const list = ref<any[]>([]), loading = ref(false), error = ref(''), filter = ref('received');
const chosen = ref<any>(null), dialog = ref(false);
const mine = (h: any) => h.recipientId === auth.user?.id;
const openTasks = (h: any) => !h.forwardedTo && h.tasks.some((t: any) => !t.done);
const isUrgent = (h: any) => !h.forwardedTo && h.tasks.some((t: any) => !t.done && (t.urgent || (t.dueAt && Date.parse(t.dueAt) < Date.now())));
const visible = computed(() => list.value.filter(h => filter.value === 'received' ? mine(h) && h.status === 'published' : filter.value === 'open' ? mine(h) && h.status === 'accepted' && !h.forwardedTo && openTasks(h) : filter.value === 'sent' ? h.authorId === auth.user?.id && h.status !== 'draft' : filter.value === 'drafts' ? h.status === 'draft' : true));
const cards = computed(() => [
  { title: 'Chờ tôi nhận', value: list.value.filter(h => mine(h) && h.status === 'published').length, color: 'text-primary' },
  { title: 'Việc tôi còn phải làm', value: list.value.filter(h => mine(h) && h.status !== 'draft' && !h.forwardedTo).reduce((sum, h) => sum + h.tasks.filter((t: any) => !t.done).length, 0), color: '' },
  { title: 'Bàn giao có việc gấp / quá hạn', value: list.value.filter(h => mine(h) && h.status !== 'draft' && isUrgent(h)).length, color: 'text-error' },
]);
const stateLabel = (h: any) => h.status === 'draft' ? 'Bản nháp' : h.status === 'published' ? 'Chờ nhận ca' : h.forwardedTo ? 'Đã bàn giao tiếp' : openTasks(h) ? 'Đang xử lý' : 'Đã xử lý hết việc';
const dateTime = (v: string) => new Date(v).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' });
async function fetchList() { loading.value = true; error.value = ''; try { const res = await api.get('/shift-handovers'); list.value = res.data.handovers; } catch (e: any) { error.value = e.response?.data?.error || 'Không tải được bàn giao. Hãy thử lại.'; } finally { loading.value = false; } }
function open(h: any) { chosen.value = h; dialog.value = true; }
function onFocus() { if (!dialog.value) void fetchList(); }
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => { void fetchList(); window.addEventListener('focus', onFocus); timer = setInterval(() => { if (!document.hidden && !dialog.value) void fetchList(); }, 30000); });
onUnmounted(() => { window.removeEventListener('focus', onFocus); clearInterval(timer); });
</script>
<style scoped>
.handover-overview { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
@media(max-width:600px) { .handover-overview { grid-template-columns:1fr; } }
</style>
