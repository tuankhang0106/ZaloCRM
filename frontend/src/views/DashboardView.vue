<template>
  <div class="dashboard-page">
    <div class="dashboard-heading">
      <div>
        <div class="eyebrow">Không gian kinh doanh</div>
        <h1>Tổng quan hoạt động</h1>
        <p>Theo dõi kết nối, khách hàng và hiệu quả kinh doanh của bạn.</p>
      </div>
      <div class="dashboard-actions">
        <v-btn to="/reports" variant="outlined" prepend-icon="mdi-chart-box-outline">Xem báo cáo</v-btn>
        <v-btn to="/chat" color="primary" prepend-icon="mdi-message-text-outline">Mở hộp thư</v-btn>
      </div>
    </div>
    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />

    <div class="dashboard-section-title">Chỉ số chăm sóc khách hàng</div>
    <KpiCards :kpi="kpi" class="mb-4" />

    <!-- Order KPI cards -->
    <v-row class="mb-4 order-summary">
      <v-col cols="12" sm="6">
        <v-card variant="outlined">
          <v-card-text class="text-center pa-3">
            <v-icon icon="mdi-cart-outline" color="primary" size="28" class="mb-1" />
            <div><div class="text-h5 font-weight-bold">{{ orderStats?.totalOrders ?? '—' }}</div>
            <div class="text-caption text-grey">Đơn hàng mới</div></div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" sm="6">
        <v-card variant="outlined">
          <v-card-text class="text-center pa-3">
            <v-icon icon="mdi-calendar-today" color="orange" size="28" class="mb-1" />
            <div><div class="text-h6 font-weight-bold">{{ formatVND(orderStats?.todayRevenue ?? 0) }}</div>
            <div class="text-caption text-grey">Doanh thu hôm nay</div></div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <div class="dashboard-section-title">Phân tích hoạt động</div>
    <v-row class="mb-4">
      <v-col cols="12" md="8">
        <MessageVolumeChart :data="messageVolume" />
      </v-col>
      <v-col cols="12" md="4">
        <PipelineChart :data="pipeline" />
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12" md="6">
        <SourceChart :data="sources" />
      </v-col>
      <v-col cols="12" md="6">
        <AppointmentChart :data="appointments" />
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import KpiCards from '@/components/dashboard/KpiCards.vue';
import MessageVolumeChart from '@/components/dashboard/MessageVolumeChart.vue';
import PipelineChart from '@/components/dashboard/PipelineChart.vue';
import SourceChart from '@/components/dashboard/SourceChart.vue';
import AppointmentChart from '@/components/dashboard/AppointmentChart.vue';
import { useDashboard } from '@/composables/use-dashboard';

const {
  kpi, messageVolume, pipeline, sources, appointments,
  orderStats, loading, fetchAll,
} = useDashboard();

function formatVND(n: number) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);
}

onMounted(() => fetchAll());
</script>
