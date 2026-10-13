<template>
  <div
    class="chat-tasks-panel d-flex flex-column"
    style="width: 320px; border-left: 1px solid rgba(0,0,0,0.12); height: 100%; overflow: hidden; flex-shrink: 0;"
  >
    <!-- Header -->
    <div class="pa-3 d-flex align-center" style="border-bottom: 1px solid rgba(0,0,0,0.12); flex-shrink: 0;">
      <v-icon icon="mdi-clipboard-list-outline" class="mr-2" color="primary" />
      <span class="font-weight-medium">Việc cần xử lý</span>
      <v-spacer />
      <v-btn icon size="small" variant="text" @click="$emit('close')">
        <v-icon>mdi-close</v-icon>
      </v-btn>
    </div>

    <!-- Tasks List Area -->
    <div class="flex-grow-1 overflow-y-auto pa-2">
      <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-3" />

      <!-- Success Empty State -->
      <div v-if="!loading && tasks.length === 0" class="text-center pa-8 d-flex flex-column align-center justify-center fill-height">
        <div class="success-orb mb-4 d-flex align-center justify-center">
          <v-icon size="48" color="success">mdi-check-all</v-icon>
        </div>
        <div class="font-weight-bold text-h6 text-success">Đã hoàn thành!</div>
        <p class="text-body-2 text-grey mt-2">
          Tuyệt vời! Bạn không còn cuộc hội thoại nào chưa báo giá hoặc cần xử lý.
        </p>
      </div>

      <!-- Task Items -->
      <template v-else-if="tasks.length > 0">
        <div
          v-for="task in tasks"
          :key="task.id"
          class="task-card pa-3 mb-2 rounded-lg cursor-pointer d-flex align-center transition-all"
          @click="$emit('select', task.id)"
        >
          <!-- Avatar -->
          <v-avatar size="40" color="grey-lighten-2" class="mr-3 flex-shrink-0">
            <v-img v-if="task.contact?.avatarUrl" :src="task.contact.avatarUrl" />
            <v-icon v-else icon="mdi-account" />
          </v-avatar>

          <!-- Info -->
          <div class="flex-grow-1 overflow-hidden mr-2">
            <div class="d-flex align-center justify-space-between">
              <span class="font-weight-medium text-truncate text-body-2">{{ task.contact?.fullName || 'Khách hàng' }}</span>
            </div>
            <div class="text-caption text-grey text-truncate">
              {{ task.zaloAccount?.displayName || 'Zalo' }}
            </div>
            <!-- Elapsed/Overdue status -->
            <div class="mt-1 d-flex align-center">
              <v-chip
                v-if="isOverdue(task)"
                color="error"
                size="x-small"
                variant="flat"
                class="px-1 font-weight-bold animate-pulse"
                style="height: 18px;"
              >
                ⚠️ Quá hạn ({{ getElapsedTime(task) }})
              </v-chip>
              <v-chip
                v-else
                color="warning"
                size="x-small"
                variant="tonal"
                class="px-1"
                style="height: 18px;"
              >
                ⏳ Chờ {{ getElapsedTime(task) }}
              </v-chip>
            </div>
          </div>

          <!-- Complete Button -->
          <v-btn
            icon
            size="small"
            color="success"
            variant="text"
            title="Đánh dấu hoàn thành"
            class="flex-shrink-0"
            :loading="completingId === task.id"
            @click.stop="completeTask(task.id)"
          >
            <v-icon size="24">mdi-check-circle</v-icon>
          </v-btn>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { api } from '@/api/index';
import { io } from 'socket.io-client';

const emit = defineEmits<{
  select: [convId: string];
  close: [];
}>();

interface TaskItem {
  id: string;
  lastMessageAt: string | null;
  contact: {
    fullName: string | null;
    avatarUrl: string | null;
  } | null;
  zaloAccount: {
    displayName: string | null;
  } | null;
}

const tasks = ref<TaskItem[]>([]);
const loading = ref(false);
const completingId = ref<string | null>(null);
let socket: any = null;

async function fetchTasks() {
  loading.value = true;
  try {
    const res = await api.get('/conversations/uncompleted');
    tasks.value = res.data.conversations;
  } catch (err) {
    console.error('Failed to fetch uncompleted tasks:', err);
  } finally {
    loading.value = false;
  }
}

async function completeTask(convId: string) {
  completingId.value = convId;
  try {
    await api.patch(`/conversations/${convId}/quote-settings`, {
      quoteCompleted: true,
    });
    // Immediately filter out locally for snappy feel (Socket will also trigger update)
    tasks.value = tasks.value.filter(t => t.id !== convId);
  } catch (err) {
    console.error('Failed to complete task:', err);
  } finally {
    completingId.value = null;
  }
}

function isOverdue(task: TaskItem): boolean {
  if (!task.lastMessageAt) return false;
  const diffMs = Date.now() - new Date(task.lastMessageAt).getTime();
  return diffMs > 24 * 60 * 60 * 1000;
}

function getElapsedTime(task: TaskItem): string {
  if (!task.lastMessageAt) return '';
  const diffMs = Date.now() - new Date(task.lastMessageAt).getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  if (diffMins < 60) return `${diffMins} phút`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} giờ`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} ngày`;
}

onMounted(() => {
  fetchTasks();
  // Listen for socket events to keep list synced real-time
  socket = io({ transports: ['websocket', 'polling'] });
  socket.on('chat:message', () => fetchTasks());
  socket.on('conversation:quote-update', () => fetchTasks());
});

onUnmounted(() => {
  socket?.disconnect();
});
</script>

<style scoped>
.task-card {
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: rgba(var(--v-theme-surface), 0.4);
  transition: all 0.2s ease-in-out;
}
.task-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(var(--v-theme-primary), 0.12);
  border-color: rgba(var(--v-theme-primary), 0.3);
  background: rgba(var(--v-theme-surface), 0.8);
}
.success-orb {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  background: rgba(76, 175, 80, 0.1);
  box-shadow: 0 0 20px rgba(76, 175, 80, 0.2);
}
.transition-all {
  transition: all 0.2s ease-in-out;
}
@keyframes pulse {
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.05); opacity: 0.8; }
  100% { transform: scale(1); opacity: 1; }
}
.animate-pulse {
  animation: pulse 1.5s infinite;
}
</style>
