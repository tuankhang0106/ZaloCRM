<template>
  <div>
    <div class="d-flex align-center mb-4 flex-wrap gap-2">
      <h1 class="text-h4">Báo cáo</h1>
      <v-spacer />
      <v-text-field
        v-model="dateFrom"
        label="Từ ngày"
        type="date"
        density="compact"
        variant="outlined"
        style="max-width: 180px;"
        class="mr-2"
        hide-details
      />
      <v-text-field
        v-model="dateTo"
        label="Đến ngày"
        type="date"
        density="compact"
        variant="outlined"
        style="max-width: 180px;"
        class="mr-2"
        hide-details
      />
      <v-btn color="primary" prepend-icon="mdi-refresh" :loading="loading" @click="fetchReport">Xem</v-btn>
      <v-btn color="success" prepend-icon="mdi-file-excel" class="ml-2" :loading="exporting" @click="exportExcel">Xuất Excel</v-btn>
    </div>

    <v-tabs v-model="tab" class="mb-4">
      <v-tab value="messages">Tin nhắn</v-tab>
      <v-tab value="contacts">Khách hàng</v-tab>
      <v-tab value="appointments">Lịch hẹn</v-tab>
      <v-tab value="kpi">Hiệu suất Nhân viên</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <v-window-item value="messages">
        <v-data-table
          :headers="msgHeaders"
          :items="msgData"
          :loading="loading"
          no-data-text="Không có dữ liệu"
        />
      </v-window-item>
      <v-window-item value="contacts">
        <!-- Summary Cards by Zalo Account -->
        <v-row class="mb-4" dense v-if="contactZaloSummaries.length > 0">
          <!-- Total Card -->
          <v-col cols="12" sm="6" md="3">
            <v-card class="pa-4 bg-surface-variant elevation-2 rounded-xl" style="background: rgba(var(--v-theme-success), 0.1) !important; border: 1px solid rgba(var(--v-theme-success), 0.3) !important;">
              <div class="d-flex align-center">
                <v-avatar color="success" size="48" class="mr-3">
                  <v-icon color="white">mdi-account-group-outline</v-icon>
                </v-avatar>
                <div>
                  <div class="text-caption text-grey">Tổng khách hàng mới</div>
                  <div class="text-h6 font-weight-bold text-success">{{ totalNewContacts }} KH</div>
                </div>
              </div>
            </v-card>
          </v-col>
          <!-- Zalo Account Cards -->
          <v-col
            v-for="item in contactZaloSummaries"
            :key="item.zaloName"
            cols="12"
            sm="6"
            md="3"
          >
            <v-card class="pa-4 bg-surface-variant elevation-2 rounded-xl" style="background: rgba(var(--v-theme-surface), 0.7) !important; border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)) !important;">
              <div class="d-flex align-center">
                <v-avatar color="primary" size="48" class="mr-3">
                  <v-icon color="white" v-if="item.zaloName !== 'Tạo thủ công'">mdi-account-box-outline</v-icon>
                  <v-icon color="white" v-else>mdi-account-plus-outline</v-icon>
                </v-avatar>
                <div>
                  <div class="text-caption text-grey text-truncate" style="max-width: 140px;" :title="item.zaloName">{{ item.zaloName }}</div>
                  <div class="text-h6 font-weight-bold">{{ item.count }} KH</div>
                </div>
              </div>
            </v-card>
          </v-col>
        </v-row>

        <v-data-table
          :headers="contactHeaders"
          :items="contactData"
          :loading="loading"
          no-data-text="Không có dữ liệu"
        />
      </v-window-item>
      <v-window-item value="appointments">
        <v-data-table
          :headers="aptHeaders"
          :items="aptData"
          :loading="loading"
          no-data-text="Không có dữ liệu"
        />
      </v-window-item>
      <v-window-item value="kpi">
        <!-- Summary KPI Cards -->
        <v-row class="mb-4" dense>
          <v-col cols="12" md="4">
            <v-card class="pa-4 rounded-xl elevation-2">
              <div class="d-flex align-center">
                <v-avatar color="primary" size="48" class="mr-3">
                  <v-icon color="white">mdi-flash</v-icon>
                </v-avatar>
                <div>
                  <div class="text-caption text-grey">Phản hồi nhanh nhất</div>
                  <div class="text-h6 font-weight-bold">{{ fastestStaff }}</div>
                </div>
              </div>
            </v-card>
          </v-col>
          <v-col cols="12" md="4">
            <v-card class="pa-4 rounded-xl elevation-2">
              <div class="d-flex align-center">
                <v-avatar color="success" size="48" class="mr-3">
                  <v-icon color="white">mdi-message-processing-outline</v-icon>
                </v-avatar>
                <div>
                  <div class="text-caption text-grey">Tương tác nhiều nhất</div>
                  <div class="text-h6 font-weight-bold">{{ mostActiveStaff }}</div>
                </div>
              </div>
            </v-card>
          </v-col>
          <v-col cols="12" md="4">
            <v-card class="pa-4 rounded-xl elevation-2">
              <div class="d-flex align-center">
                <v-avatar color="warning" size="48" class="mr-3">
                  <v-icon color="white">mdi-trophy-outline</v-icon>
                </v-avatar>
                <div>
                  <div class="text-caption text-grey">Doanh số cao nhất</div>
                  <div class="text-h6 font-weight-bold">{{ topSalesStaff }}</div>
                </div>
              </div>
            </v-card>
          </v-col>
        </v-row>

        <!-- KPI Data Table -->
        <v-card class="rounded-xl elevation-2">
          <v-data-table
            :headers="kpiHeaders"
            :items="kpiData"
            :loading="loading"
            no-data-text="Không có dữ liệu hiệu suất"
          >
            <template #item.fullName="{ item }">
              <div class="font-weight-bold">{{ item.fullName }}</div>
              <div class="text-caption text-grey">{{ item.email }}</div>
            </template>
            <template #item.avgResponseTime="{ item }">
              <span v-if="item.avgResponseTime !== null" class="font-weight-bold" :class="responseTimeClass(item.avgResponseTime)">
                {{ formatResponseTime(item.avgResponseTime) }}
              </span>
              <span v-else class="text-grey">—</span>
            </template>
            <template #item.conversionRate="{ item }">
              <div class="d-flex align-center">
                <span class="font-weight-bold mr-2">{{ item.conversionRate }}%</span>
                <v-progress-linear :model-value="item.conversionRate" color="primary" height="6" rounded />
              </div>
            </template>
            <template #item.totalRevenue="{ item }">
              <span class="font-weight-bold text-success">{{ formatVND(item.totalRevenue) }}</span>
            </template>
          </v-data-table>
        </v-card>
      </v-window-item>
    </v-window>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { api } from '@/api';

// Date defaults: last 30 days
const today = new Date();
const prior = new Date(today);
prior.setDate(prior.getDate() - 30);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

const dateFrom = ref(fmt(prior));
const dateTo = ref(fmt(today));
const tab = ref('messages');
const loading = ref(false);
const exporting = ref(false);

const msgData = ref<{ date: string; sent: number; received: number }[]>([]);
const contactData = ref<{ label: string; count: number }[]>([]);
const aptData = ref<{ label: string; count: number }[]>([]);
const kpiData = ref<any[]>([]);
const contactZaloSummaries = ref<{ zaloName: string; count: number }[]>([]);

const totalNewContacts = computed(() => {
  return contactZaloSummaries.value.reduce((sum, item) => sum + item.count, 0);
});

const msgHeaders = [
  { title: 'Ngày', key: 'date' },
  { title: 'Đã gửi', key: 'sent' },
  { title: 'Đã nhận', key: 'received' },
];

const contactHeaders = [
  { title: 'Phân loại', key: 'label' },
  { title: 'Số lượng', key: 'count' },
];

const aptHeaders = [
  { title: 'Phân loại', key: 'label' },
  { title: 'Số lượng', key: 'count' },
];

const kpiHeaders = [
  { title: 'Nhân viên', key: 'fullName', sortable: true },
  { title: 'Số tin nhắn đã gửi', key: 'messagesSent', sortable: true, align: 'center' as const },
  { title: 'Thời gian phản hồi TB', key: 'avgResponseTime', sortable: true, align: 'center' as const },
  { title: 'Khách hàng đang chăm', key: 'totalContacts', sortable: true, align: 'center' as const },
  { title: 'Tỷ lệ chốt đơn', key: 'conversionRate', sortable: true },
  { title: 'Doanh số (VND)', key: 'totalRevenue', sortable: true, align: 'end' as const },
];

function formatVND(value: number) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);
}

function formatResponseTime(seconds: number) {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

function responseTimeClass(seconds: number) {
  if (seconds < 5 * 60) return 'text-success'; // Under 5 mins
  if (seconds < 15 * 60) return 'text-warning'; // Under 15 mins
  return 'text-error'; // 15 mins or more
}

const fastestStaff = computed(() => {
  const list = kpiData.value.filter(u => u.avgResponseTime !== null && u.messagesSent > 0);
  if (list.length === 0) return 'Chưa có';
  const fastest = list.reduce((a, b) => (a.avgResponseTime < b.avgResponseTime ? a : b));
  return `${fastest.fullName} (${formatResponseTime(fastest.avgResponseTime)})`;
});

const mostActiveStaff = computed(() => {
  const list = kpiData.value.filter(u => u.messagesSent > 0);
  if (list.length === 0) return 'Chưa có';
  const active = list.reduce((a, b) => (a.messagesSent > b.messagesSent ? a : b));
  return `${active.fullName} (${active.messagesSent} tin)`;
});

const topSalesStaff = computed(() => {
  const list = kpiData.value.filter(u => u.totalRevenue > 0);
  if (list.length === 0) return 'Chưa có';
  const top = list.reduce((a, b) => (a.totalRevenue > b.totalRevenue ? a : b));
  return `${top.fullName} (${formatVND(top.totalRevenue)})`;
});

async function fetchReport() {
  loading.value = true;
  try {
    const params = { from: dateFrom.value, to: dateTo.value };
    if (tab.value === 'messages') {
      const res = await api.get('/reports/messages', { params });
      msgData.value = res.data.data || res.data;
    } else if (tab.value === 'contacts') {
      const res = await api.get('/reports/contacts', { params });
      const raw = res.data;
      const rows: { label: string; count: number }[] = [];
      const days = Array.isArray(raw.newPerDay) ? raw.newPerDay : [];
      
      // Calculate totals per Zalo account
      const sums: Record<string, number> = {};
      for (const d of days) {
        const key = d.zaloName || 'Tạo thủ công';
        sums[key] = (sums[key] || 0) + Number(d.count ?? 0);
      }
      
      // Convert to array and sort: named Zalo accounts first, "Tạo thủ công" last
      contactZaloSummaries.value = Object.entries(sums)
        .map(([zaloName, count]) => ({ zaloName, count }))
        .sort((a, b) => {
          if (a.zaloName === 'Tạo thủ công') return 1;
          if (b.zaloName === 'Tạo thủ công') return -1;
          return b.count - a.count;
        });

      for (const d of days) {
        const suffix = d.zaloName ? ` - ${d.zaloName}` : ' - Tạo thủ công';
        rows.push({ label: `Mới ${d.date}${suffix}`, count: Number(d.count ?? 0) });
      }
      for (const s of (raw.byStatus ?? [])) {
        rows.push({ label: `Trạng thái: ${s.status}`, count: Number(s.count ?? 0) });
      }
      contactData.value = rows;
    } else if (tab.value === 'appointments') {
      const res = await api.get('/reports/appointments', { params });
      const raw = res.data;
      const rows: { label: string; count: number }[] = [];
      for (const s of (raw.byStatus ?? [])) {
        rows.push({ label: `Trạng thái: ${s.status}`, count: Number(s.count ?? 0) });
      }
      for (const t of (raw.byType ?? [])) {
        rows.push({ label: `Loại: ${t.type ?? '—'}`, count: Number(t.count ?? 0) });
      }
      aptData.value = rows;
    } else if (tab.value === 'kpi') {
      const res = await api.get('/reports/kpi', { params });
      kpiData.value = res.data.data || [];
    }
  } catch (err) {
    console.error('Report fetch error:', err);
  } finally {
    loading.value = false;
  }
}

async function exportExcel() {
  if (tab.value === 'kpi') {
    alert('Xuất Excel cho báo cáo Hiệu suất Nhân viên sẽ được bổ sung sau!');
    return;
  }
  exporting.value = true;
  try {
    const res = await api.get('/reports/export', {
      params: { type: tab.value, from: dateFrom.value, to: dateTo.value },
      responseType: 'blob',
    });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${tab.value}-${dateFrom.value}-${dateTo.value}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Export error:', err);
  } finally {
    exporting.value = false;
  }
}

// Auto-fetch when tab changes
watch(tab, () => fetchReport());

// Initial load
fetchReport();
</script>
