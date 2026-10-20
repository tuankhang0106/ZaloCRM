<template>
  <v-card>
    <v-card-title class="text-body-1">Pipeline khách hàng</v-card-title>
    <v-card-text>
      <Doughnut v-if="chartData" :data="chartData" :options="chartOptions" style="height: 250px;" />
      <div v-else class="text-center pa-8 text-grey">Không có dữ liệu</div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTheme } from 'vuetify';
const theme = useTheme();
import { Doughnut } from 'vue-chartjs';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend);

const props = defineProps<{
  data: { status: string | null; _count: { _all: number } | number }[];
}>();

const statusColors: Record<string, string> = {
  new: '#95A59B',
  contacted: '#6D9DA5',
  interested: '#BE9B60',
  converted: '#5C9377',
  lost: '#BE7770',
};

const statusLabels: Record<string, string> = {
  new: 'Mới',
  contacted: 'Đã liên hệ',
  interested: 'Quan tâm',
  converted: 'Chuyển đổi',
  lost: 'Mất',
};

function getCount(item: { _count: { _all: number } | number }): number {
  return typeof item._count === 'number' ? item._count : item._count._all;
}

const chartData = computed(() => {
  if (!props.data?.length) return null;
  const filtered = props.data.filter(d => d.status);
  if (!filtered.length) return null;
  return {
    labels: filtered.map(d => statusLabels[d.status || ''] || d.status),
    datasets: [{
      data: filtered.map(d => getCount(d)),
      backgroundColor: filtered.map(d => statusColors[d.status || ''] || '#BDBDBD'),
    }],
  };
});

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'right' as const, labels: { color: (theme.current.value.dark ? '#DCE6DF' : '#52635A'), usePointStyle: true, boxWidth: 8, padding: 18, font: { family: 'Plus Jakarta Sans', size: 11 } } } },

}));
</script>
