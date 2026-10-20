<template>
  <v-card>
    <v-card-title class="text-body-1">Tin nhắn theo ngày</v-card-title>
    <v-card-text>
      <Bar v-if="chartData" :data="chartData" :options="chartOptions" style="height: 250px;" />
      <div v-else class="text-center pa-8 text-grey">Không có dữ liệu</div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTheme } from 'vuetify';
const theme = useTheme();
import { Bar } from 'vue-chartjs';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const props = defineProps<{
  data: { date: string; sent: number; received: number }[];
}>();

const chartData = computed(() => {
  if (!props.data?.length) return null;
  return {
    labels: props.data.map(d => d.date.slice(5)), // MM-DD
    datasets: [
      { label: 'Đã gửi', data: props.data.map(d => d.sent), backgroundColor: '#39765F', borderRadius: 4 },
      { label: 'Đã nhận', data: props.data.map(d => d.received), backgroundColor: '#A2BC9B', borderRadius: 4 },
    ],
  };
});

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'top' as const, labels: { color: (theme.current.value.dark ? '#DCE6DF' : '#52635A'), usePointStyle: true, boxWidth: 8, padding: 18, font: { family: 'Plus Jakarta Sans', size: 11 } } } },
  scales: { x: { grid: { display: false }, ticks: { color: (theme.current.value.dark ? '#DCE6DF' : '#52635A') } }, y: { beginAtZero: true, grid: { color: theme.current.value.dark ? '#ffffff0d' : '#173e3210' }, ticks: { color: (theme.current.value.dark ? '#DCE6DF' : '#52635A'), precision: 0 } } },
}));
</script>
