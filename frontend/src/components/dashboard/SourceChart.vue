<template>
  <v-card>
    <v-card-title class="text-body-1">Nguồn khách hàng</v-card-title>
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
  data: { source: string; _count: { _all: number } | number }[];
}>();

const sourceColors: Record<string, string> = {
  'FB': '#6D9DA5',
  'TT': '#52635A',
  'GT': '#BE9B60',
  'CN': '#A2BC9B',
};

function getCount(item: { _count: { _all: number } | number }): number {
  return typeof item._count === 'number' ? item._count : item._count._all;
}

const chartData = computed(() => {
  if (!props.data?.length) return null;
  return {
    labels: props.data.map(d => d.source),
    datasets: [{
      data: props.data.map(d => getCount(d)),
      backgroundColor: props.data.map(d => sourceColors[d.source] || '#BDBDBD'),
    }],
  };
});

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'right' as const, labels: { color: (theme.current.value.dark ? '#DCE6DF' : '#52635A'), usePointStyle: true, boxWidth: 8, padding: 18, font: { family: 'Plus Jakarta Sans', size: 11 } } } },

}));
</script>
