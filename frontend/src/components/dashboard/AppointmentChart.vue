<template>
  <v-card>
    <v-card-title class="text-body-1">Trạng thái lịch hẹn</v-card-title>
    <v-card-text>
      <Pie v-if="chartData" :data="chartData" :options="chartOptions" style="height: 250px;" />
      <div v-else class="text-center pa-8 text-grey">Không có dữ liệu</div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTheme } from 'vuetify';
const theme = useTheme();
import { Pie } from 'vue-chartjs';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend);

const props = defineProps<{
  data: { status: string; _count: { _all: number } | number }[];
}>();

const statusColors: Record<string, string> = {
  'scheduled': '#6D9DA5',
  'completed': '#5C9377',
  'cancelled': '#95A59B',
  'no_show': '#BE7770',
};

const statusLabels: Record<string, string> = {
  'scheduled': 'Đã lên lịch',
  'completed': 'Hoàn thành',
  'cancelled': 'Đã hủy',
  'no_show': 'Vắng mặt',
};

function getCount(item: { _count: { _all: number } | number }): number {
  return typeof item._count === 'number' ? item._count : item._count._all;
}

const chartData = computed(() => {
  if (!props.data?.length) return null;
  return {
    labels: props.data.map(d => statusLabels[d.status] || d.status),
    datasets: [{
      data: props.data.map(d => getCount(d)),
      backgroundColor: props.data.map(d => statusColors[d.status] || '#BDBDBD'),
    }],
  };
});

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'right' as const, labels: { color: (theme.current.value.dark ? '#DCE6DF' : '#52635A'), usePointStyle: true, boxWidth: 8, padding: 18, font: { family: 'Plus Jakarta Sans', size: 11 } } } },

}));
</script>
