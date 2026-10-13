<template>
  <v-app :class="{ 'liquid-bg': isDark }">
    <!-- Sticky alarm banner if Zalo accounts are disconnected -->
    <v-system-bar
      v-if="disconnectedAccounts.length > 0"
      color="error"
      class="justify-center font-weight-bold text-white px-4"
      height="38"
      style="z-index: 1009; background: linear-gradient(90deg, #d32f2f, #ff5722) !important;"
    >
      <v-icon icon="mdi-alert-circle" class="mr-2 animate-pulse" color="white" />
      <span class="text-caption font-weight-bold">
        CẢNH BÁO: Phát hiện Zalo [ {{ disconnectedAccounts.map(a => a.displayName || 'Zalo').join(', ') }} ] bị mất kết nối!
      </span>
      <v-btn
        color="white"
        variant="flat"
        size="x-small"
        class="ml-3 font-weight-bold text-error px-2 rounded-pill"
        style="height: 22px; font-size: 0.68rem;"
        to="/zalo-accounts"
      >
        KẾT NỐI LẠI
      </v-btn>
    </v-system-bar>

    <!-- Top bar — glass effect -->
    <v-app-bar density="comfortable" flat>
      <v-app-bar-nav-icon
        @click="toggleSidebar"
        :title="!mobile && rail ? 'Mở rộng sidebar (Ctrl+B)' : 'Thu gọn sidebar (Ctrl+B)'"
      />

      <!-- Custom Brand Logo + Title (Synchronized with Login Branding, supporting custom uploaded logos) -->
      <div class="d-flex align-center" :style="{ gap: mobile ? '6px' : '12px', marginLeft: mobile ? '4px' : '12px' }">
        <img v-if="orgLogo" :src="orgLogo" alt="Logo" :style="{ width: mobile ? '28px' : '32px', height: mobile ? '28px' : '32px', objectFit: 'contain' }" />
        <img v-else :src="defaultLogo" alt="Logo" :style="{ width: mobile ? '28px' : '32px', height: mobile ? '28px' : '32px', objectFit: 'contain' }" />
        <v-app-bar-title v-if="!mobile" class="ml-0">
          <span class="font-weight-bold" style="font-family: 'Plus Jakarta Sans', sans-serif; letter-spacing: -0.5px;">
            <template v-if="orgName === 'ZaloCRM'">
              Zalo<span style="color: #00B074;">CRM</span>
            </template>
            <template v-else>
              {{ orgName }}
            </template>
          </span>
        </v-app-bar-title>
      </div>

      <!-- Global search (Hidden on mobile) -->
      <GlobalSearch v-if="!mobile" class="mx-2" />

      <v-spacer />

      <!-- Online User Status Indicator (Hidden on mobile to save space) -->
      <div
        v-if="authStore.user && !mobile"
        class="d-flex align-center px-3 py-1 rounded-pill mr-3"
        style="border: 1px solid #4CAF50; background: rgba(76, 175, 80, 0.1); box-shadow: 0 0 4px rgba(76, 175, 80, 0.2);"
      >
        <span
          class="status-dot mr-2"
          style="width: 6px; height: 6px; border-radius: 50%; background: #4CAF50; display: inline-block; box-shadow: 0 0 6px #4CAF50;"
        ></span>
        <span class="text-caption font-weight-bold text-success" style="letter-spacing: 0.2px; font-family: 'Plus Jakarta Sans', sans-serif;">
          {{ authStore.user.fullName }}
        </span>
      </div>

      <!-- Time Attendance Status in Top Bar -->
      <div v-if="authStore.user" class="d-flex align-center mr-3" style="gap: 8px;">
        <template v-if="attendanceStatus">
          <!-- Already Checked out -->
          <v-chip
            v-if="attendanceStatus.checkOutAt"
            size="small"
            color="default"
            variant="flat"
            prepend-icon="mdi-clock-check-outline"
            title="Đã hoàn thành chấm công ngày hôm nay"
          >
            Đã Về ({{ formatTimeShort(attendanceStatus.checkOutAt) }})
          </v-chip>
          <!-- Checked in, not Checked out yet -->
          <template v-else>
            <v-chip
              size="small"
              :color="getCheckInColorClass(attendanceStatus.checkInStatus)"
              variant="flat"
              prepend-icon="mdi-fingerprint"
              to="/attendance"
              title="Đã check-in hôm nay. Bấm để xem chi tiết lịch sử."
              class="cursor-pointer"
            >
              {{ isLate(attendanceStatus.checkInStatus) ? 'Muộn' : 'Đúng Giờ' }} ({{ formatTimeShort(attendanceStatus.checkInAt) }})
            </v-chip>
            <v-btn
              color="error"
              size="x-small"
              variant="flat"
              prepend-icon="mdi-logout-variant"
              title="Check-out ra về"
              @click="handleManualCheckOut"
              class="px-2"
              height="28"
            >
              {{ mobile ? '' : 'Check-out' }}
            </v-btn>
          </template>
        </template>
        <!-- Not checked in yet -->
        <v-chip
          v-else
          size="small"
          color="warning"
          variant="flat"
          prepend-icon="mdi-fingerprint-off"
          title="Chưa thực hiện chấm công ngày hôm nay"
        >
          Chưa Check-in
        </v-chip>
      </div>

      <NotificationBell />
      <!-- Theme Switcher Menu in Top Bar -->
      <v-menu transition="slide-y-transition" open-on-hover close-delay="100">
        <template #activator="{ props }">
          <v-btn icon variant="text" v-bind="props">
            <v-icon color="primary">mdi-palette-outline</v-icon>
          </v-btn>
        </template>
        <v-list density="compact" rounded="xl" width="220" class="elevation-10 mt-1 pa-2">
          <v-list-subheader class="text-uppercase font-weight-bold text-caption pb-1">Chọn Giao Diện</v-list-subheader>
          
          <v-list-item
            v-for="item in themeOptions"
            :key="item.id"
            @click="changeTheme(item.id)"
            :active="currentTheme === item.id"
            rounded="lg"
            class="mb-1"
          >
            <template #prepend>
              <v-avatar size="24" :color="item.color" class="mr-2 border-sm">
                <v-icon v-if="currentTheme === item.id" size="14" color="white">mdi-check</v-icon>
              </v-avatar>
            </template>
            <v-list-item-title class="font-weight-bold text-body-2">{{ item.title }}</v-list-item-title>
          </v-list-item>

          <v-divider class="my-1" />

          <!-- Restore Defaults list item -->
          <v-list-item
            @click="resetToOriginalDefaults"
            rounded="lg"
            class="mb-1 text-error"
          >
            <template #prepend>
              <v-avatar size="24" class="mr-2 border-sm bg-error-lighten-5">
                <v-icon size="14" color="error">mdi-refresh</v-icon>
              </v-avatar>
            </template>
            <v-list-item-title class="font-weight-bold text-body-2 text-error">Khôi phục mặc định</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
      
      <!-- Push Notification Toggle -->
      <v-btn
        v-if="notificationsSupported"
        icon
        variant="text"
        @click="toggleNotifications"
        :title="notificationsEnabled ? 'Tắt thông báo đẩy' : 'Bật thông báo đẩy'"
        class="mr-1"
      >
        <v-icon :color="notificationsEnabled ? 'primary' : 'grey'">
          {{ notificationsEnabled ? 'mdi-bell-ring-outline' : 'mdi-bell-off-outline' }}
        </v-icon>
      </v-btn>

      <!-- Sound Mute/Unmute Toggle -->
      <v-btn
        icon
        variant="text"
        @click="toggleSound"
        :title="soundEnabled ? 'Tắt âm thanh thông báo' : 'Bật âm thanh thông báo'"
      >
        <v-icon :color="soundEnabled ? 'primary' : 'grey'">
          {{ soundEnabled ? 'mdi-volume-high' : 'mdi-volume-off' }}
        </v-icon>
      </v-btn>

      <v-btn icon variant="text" @click="logout">
        <v-icon>mdi-logout</v-icon>
      </v-btn>
    </v-app-bar>

    <!-- Sidebar navigation (evondevKit Smart Grouping & Rail Tooltip) -->
    <v-navigation-drawer
      v-model="drawer"
      :rail="!mobile && rail"
      :permanent="!mobile"
      :temporary="mobile"
      :width="260"
      :rail-width="68"
      style="z-index: 1009;"
      class="custom-app-sidebar"
    >
      <v-list density="compact" nav class="px-2 py-2">
        <div v-for="(group, gIdx) in filteredMenuGroups" :key="group.title" class="mb-3">
          <!-- Subheader when expanded -->
          <div
            v-if="!rail || mobile"
            class="text-uppercase font-weight-bold px-3 py-1 menu-group-header"
          >
            {{ group.title }}
          </div>
          <!-- Divider when collapsed in rail mode (between groups) -->
          <v-divider v-else-if="gIdx > 0" class="my-2 mx-2 opacity-20" />

          <template v-for="item in group.items" :key="item.path">
            <!-- Rail mode: Wrap item in tooltip -->
            <v-tooltip
              v-if="!mobile && rail"
              location="right"
              open-delay="60"
              content-class="custom-nav-tooltip"
            >
              <template #activator="{ props: tipProps }">
                <v-list-item
                  v-bind="tipProps"
                  :active="isMenuItemActive(item)"
                  :prepend-icon="item.icon"
                  rounded="xl"
                  class="mb-1 nav-item"
                  @click="navigateTo(item.path)"
                >
                  <!-- Badge dot indicator for collapsed rail mode -->
                  <template #append v-if="(item.badge === 'tasks' && taskCount > 0) || (item.badge === 'tracked' && trackedCount > 0)">
                    <span
                      class="rail-badge-dot"
                      :class="item.badge === 'tasks' ? 'bg-error' : 'bg-warning'"
                    />
                  </template>
                </v-list-item>
              </template>
              <div class="d-flex align-center" style="gap: 6px;">
                <span>{{ item.title }}</span>
                <v-badge
                  v-if="item.badge === 'tasks' && taskCount > 0"
                  :content="taskCount"
                  color="error"
                  inline
                />
                <v-badge
                  v-if="item.badge === 'tracked' && trackedCount > 0"
                  :content="trackedCount"
                  color="warning"
                  inline
                />
              </div>
            </v-tooltip>

            <!-- Expanded mode or Mobile -->
            <v-list-item
              v-else
              :active="isMenuItemActive(item)"
              :prepend-icon="item.icon"
              :title="item.title"
              rounded="xl"
              class="mb-1 nav-item"
              @click="navigateTo(item.path)"
            >
              <template #append v-if="item.badge === 'tasks' && taskCount > 0">
                <v-badge
                  :content="taskCount"
                  color="error"
                  inline
                  class="ml-2 animate-pulse"
                />
              </template>
              <template #append v-if="item.badge === 'tracked' && trackedCount > 0">
                <v-badge
                  :content="trackedCount"
                  color="warning"
                  inline
                  class="ml-2 animate-pulse"
                />
              </template>
            </v-list-item>
          </template>
        </div>
      </v-list>

      <!-- Theme Switcher & Collapse Toggle Footer -->
      <template #append>
        <div class="sidebar-footer-section pa-2 border-t">
          <v-list density="compact" nav class="pa-0 mb-1">
            <!-- Collapsed (Rail) Mode Theme Switcher -->
            <v-menu v-if="!mobile && rail" transition="slide-x-transition" open-on-hover location="right">
              <template #activator="{ props }">
                <v-tooltip text="Đổi giao diện" location="right" open-delay="60" content-class="custom-nav-tooltip">
                  <template #activator="{ props: tipProps }">
                    <v-list-item
                      prepend-icon="mdi-palette-outline"
                      v-bind="{ ...props, ...tipProps }"
                      rounded="xl"
                      class="mb-1 nav-item"
                    />
                  </template>
                  <span>Đổi giao diện</span>
                </v-tooltip>
              </template>
              <v-list density="compact" rounded="xl" width="180" class="elevation-10 pa-2">
                <v-list-item
                  v-for="item in themeOptions"
                  :key="item.id"
                  @click="changeTheme(item.id)"
                  :active="currentTheme === item.id"
                  rounded="lg"
                  class="mb-1"
                >
                  <template #prepend>
                    <v-avatar size="18" :color="item.color" class="mr-2">
                      <v-icon v-if="currentTheme === item.id" size="10" color="white">mdi-check</v-icon>
                    </v-avatar>
                  </template>
                  <v-list-item-title class="font-weight-bold text-caption">{{ item.title }}</v-list-item-title>
                </v-list-item>

                <v-divider class="my-1" />

                <v-list-item
                  @click="resetToOriginalDefaults"
                  rounded="lg"
                  class="mb-1 text-error"
                >
                  <template #prepend>
                    <v-avatar size="18" class="mr-2 border-sm bg-error-lighten-5">
                      <v-icon size="10" color="error">mdi-refresh</v-icon>
                    </v-avatar>
                  </template>
                  <v-list-item-title class="font-weight-bold text-caption text-error">Mặc định</v-list-item-title>
                </v-list-item>
              </v-list>
            </v-menu>

            <!-- Expanded Mode Theme Switcher -->
            <v-list-item
              v-else
              prepend-icon="mdi-palette-outline"
              title="Giao diện"
              rounded="xl"
              class="mb-1"
            >
              <template #append>
                <div class="d-flex align-center ml-2" style="gap: 5px;">
                  <v-tooltip v-for="item in themeOptions" :key="item.id" :text="item.title" location="top">
                    <template #activator="{ props }">
                      <v-avatar
                        v-bind="props"
                        size="18"
                        class="cursor-pointer border-sm theme-color-dot"
                        :style="{
                          border: currentTheme === item.id ? '2px solid white' : '1px solid rgba(255,255,255,0.2)',
                          boxShadow: currentTheme === item.id ? '0 0 6px ' + item.color : 'none',
                          transform: currentTheme === item.id ? 'scale(1.15)' : 'none',
                          transition: 'all 0.2s ease'
                        }"
                        :color="item.color"
                        @click="changeTheme(item.id)"
                      >
                        <v-icon v-if="currentTheme === item.id" size="9" color="white">mdi-check</v-icon>
                      </v-avatar>
                    </template>
                  </v-tooltip>
                </div>
              </template>
            </v-list-item>
          </v-list>

          <!-- Sidebar Collapse Toggle Button -->
          <v-list v-if="!mobile" density="compact" nav class="pa-0">
            <v-tooltip
              v-if="rail"
              text="Mở rộng thanh bên (Ctrl+B)"
              location="right"
              open-delay="60"
              content-class="custom-nav-tooltip"
            >
              <template #activator="{ props: tipProps }">
                <v-list-item
                  v-bind="tipProps"
                  prepend-icon="mdi-chevron-double-right"
                  @click.stop="rail = false"
                  rounded="xl"
                  class="nav-collapse-btn"
                />
              </template>
              <span>Mở rộng thanh bên (Ctrl+B)</span>
            </v-tooltip>
            <v-list-item
              v-else
              prepend-icon="mdi-chevron-double-left"
              title="Thu gọn thanh bên"
              @click.stop="rail = true"
              rounded="xl"
              class="nav-collapse-btn"
            >
              <template #append>
                <span class="text-caption text-medium-emphasis font-weight-medium px-1 py-0.5 rounded border" style="font-size: 0.65rem !important;">
                  Ctrl+B
                </span>
              </template>
            </v-list-item>
          </v-list>
        </div>
      </template>
    </v-navigation-drawer>

    <!-- Main content -->
    <v-main>
      <v-container fluid>
        <slot />
      </v-container>
    </v-main>

    <!-- Friend Request Toast Notification -->
    <v-snackbar
      v-model="showFriendRequestToast"
      color="purple-darken-3"
      timeout="8000"
      location="top right"
      max-width="360"
    >
      <div class="d-flex align-center" style="gap: 10px;">
        <v-avatar size="36" color="grey-darken-3">
          <v-img v-if="latestFriendRequest?.senderAvatar" :src="latestFriendRequest.senderAvatar" />
          <v-icon v-else color="white" size="20">mdi-account-plus</v-icon>
        </v-avatar>
        <div>
          <p class="text-subtitle-2 font-weight-bold text-white mb-0">Lời mời kết bạn mới!</p>
          <p class="text-caption text-grey-lighten-2 mb-0">{{ latestFriendRequest?.senderName }} muốn kết bạn</p>
        </div>
      </div>
      <template #actions>
        <v-btn color="white" variant="text" size="small" class="text-none font-weight-bold" @click="goToZaloAccounts">
          Xem
        </v-btn>
      </template>
    </v-snackbar>

  </v-app>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { useTheme, useDisplay } from 'vuetify';
import { useAuthStore } from '@/stores/auth';
import { useRouter, useRoute } from 'vue-router';
import NotificationBell from '@/components/NotificationBell.vue';
import GlobalSearch from '@/components/GlobalSearch.vue';
import { useZaloAccounts } from '@/composables/use-zalo-accounts';
import { io } from 'socket.io-client';
import { api } from '@/api/index';
import defaultLogo from '@/assets/logo_default.png';

const theme = useTheme();
const { mobile } = useDisplay();
const authStore = useAuthStore();
const router = useRouter();
const route = useRoute();

function isMenuItemActive(item: MenuItem): boolean {
  if (item.path.includes('?')) {
    return route.fullPath === item.path;
  }
  if (item.path === '/chat') {
    return route.path === '/chat' && !route.query.mode;
  }
  return route.path === item.path;
}

function navigateTo(path: string) {
  router.push(path);
  handleMenuClick();
}

const drawer = ref(true);
const rail = ref(localStorage.getItem('crm-sidebar-rail') === 'true');

watch(rail, (newVal) => {
  localStorage.setItem('crm-sidebar-rail', String(newVal));
});

function toggleSidebar() {
  if (mobile.value) {
    drawer.value = !drawer.value;
  } else {
    rail.value = !rail.value;
  }
}


function handleKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
    const target = e.target as HTMLElement;
    if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
    e.preventDefault();
    toggleSidebar();
  }
}

const soundEnabled = ref(localStorage.getItem('crm-sound-enabled') !== 'false');

function toggleSound() {
  soundEnabled.value = !soundEnabled.value;
  localStorage.setItem('crm-sound-enabled', String(soundEnabled.value));
}

const notificationsSupported = ref('Notification' in window);
const notificationsEnabled = ref(
  'Notification' in window && Notification.permission === 'granted' && localStorage.getItem('crm-notifications-enabled') !== 'false'
);

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');
 
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
 
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  
  try {
    const registration = await navigator.serviceWorker.ready;
    
    const keyRes = await api.get('/push/public-key');
    if (!keyRes.data.publicKey) {
      console.warn('VAPID public key is empty or not configured on backend.');
      return;
    }
    
    const applicationServerKey = urlBase64ToUint8Array(keyRes.data.publicKey);
    
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey
    });
    
    const keyJson = subscription.toJSON();
    await api.post('/push/subscribe', {
      endpoint: subscription.endpoint,
      p256dh: keyJson.keys?.p256dh,
      auth: keyJson.keys?.auth
    });
    
    console.log('[push] Push subscription registered successfully.');
  } catch (err) {
    console.error('[push] Failed to register push subscription:', err);
  }
}

async function unsubscribeFromPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    
    if (subscription) {
      await api.post('/push/unsubscribe', { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
      console.log('[push] Unsubscribed successfully.');
    }
  } catch (err) {
    console.error('[push] Failed to unsubscribe:', err);
  }
}

function toggleNotifications() {
  if (!('Notification' in window)) return;
  
  if (Notification.permission === 'granted') {
    const val = localStorage.getItem('crm-notifications-enabled') !== 'false';
    const nextVal = !val;
    localStorage.setItem('crm-notifications-enabled', String(nextVal));
    notificationsEnabled.value = nextVal;
    
    if (nextVal) {
      subscribeToPush();
    } else {
      unsubscribeFromPush();
    }
  } else if (Notification.permission === 'denied') {
    alert('Bạn đã chặn thông báo trên trình duyệt. Vui lòng vào cài đặt trang web của trình duyệt để cho phép nhận thông báo.');
  } else {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        localStorage.setItem('crm-notifications-enabled', 'true');
        notificationsEnabled.value = true;
        subscribeToPush();
      } else {
        localStorage.setItem('crm-notifications-enabled', 'false');
        notificationsEnabled.value = false;
      }
    });
  }
}

function playLayoutNotificationSound() {
  if (localStorage.getItem('crm-sound-enabled') === 'false') return;

  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    const playTone = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.12, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration);
    };
    
    const now = ctx.currentTime;
    playTone(523.25, now, 0.22);
    playTone(659.25, now + 0.08, 0.32);
    
    // Close context after tones are done to prevent resource leaks
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 600);
  } catch (err) {
    console.warn('[sound] Playback failed:', err);
  }
}

function showLocalNotification(title: string, body: string, conversationId: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  
  const options = {
    body: body,
    icon: '/logo_pwa_192.png',
    badge: '/logo_pwa_192.png',
    tag: 'zalo-crm-msg',
    renotify: true,
    data: {
      url: `/chat?convId=${conversationId}`
    }
  };
  
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then((reg) => {
      reg.showNotification(title, options);
    }).catch(() => {
      const n = new Notification(title, options);
      n.onclick = () => {
        window.focus();
        router.push(`/chat?convId=${conversationId}`);
        n.close();
      };
    });
  } else {
    const n = new Notification(title, options);
    n.onclick = () => {
      window.focus();
      router.push(`/chat?convId=${conversationId}`);
      n.close();
    };
  }
}


// Multi-theme reactive states
const currentTheme = ref(localStorage.getItem('crm-theme') || 'dark-obsidian');
const isDark = ref(currentTheme.value !== 'light-apple');

const themeOptions = [
  { id: 'emerald-care', title: 'Emerald Care', color: '#00B074' },
  { id: 'dark-obsidian', title: 'Obsidian Tech', color: '#00F2FF' },
  { id: 'light-apple', title: 'Apple Light', color: '#09090B' },
];

function resetToOriginalDefaults() {
  localStorage.removeItem('crm-custom-color');
  localStorage.setItem('crm-theme', 'dark-obsidian');
  currentTheme.value = 'dark-obsidian';
  
  clearCustomColorStyles();

  // Restore all presets to their default styles
  resetThemeDefaults('emerald-care');
  resetThemeDefaults('dark-obsidian');
  resetThemeDefaults('light-apple');
  
  // Apply theme
  theme.global.name.value = 'dark-obsidian';
  isDark.value = true;
  localStorage.setItem('theme', 'dark');
  
  applyGradientVariables('dark-obsidian');
}

function clearCustomColorStyles() {
  if (typeof document === 'undefined') return;
  const styleEl = document.getElementById('custom-theme-styles');
  if (styleEl) {
    styleEl.remove();
  }
}



const defaultColors: Record<string, Record<string, string>> = {
  'emerald-care': {
    background: '#021a0e',
    surface: '#042c17',
    'surface-variant': '#063c20',
    'surface-light': '#0a542d',
    primary: '#00B074',
    secondary: '#044523',
    accent: '#00B074',
  },
  'dark-obsidian': {
    background: '#0A192F',
    surface: '#112240',
    'surface-variant': '#172A45',
    'surface-light': '#203756',
    primary: '#00F2FF',
    secondary: '#0084FF',
    accent: '#00F2FF',
  },
  'light-apple': {
    background: '#F4F4F5',
    surface: '#FFFFFF',
    'surface-variant': '#E4E4E7',
    'surface-light': '#D4D4D8',
    primary: '#09090B',
    secondary: '#71717A',
    accent: '#09090B',
  }
};

function resetThemeDefaults(themeName: string) {
  if (!theme.themes.value[themeName] || !defaultColors[themeName]) return;
  const colors = defaultColors[themeName];
  for (const [key, value] of Object.entries(colors)) {
    theme.themes.value[themeName].colors[key] = value;
  }
}

function applyGradientVariables(themeName: string) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (themeName === 'dark-obsidian') {
    root.style.setProperty('--theme-gradient-1', '#004d7a');
    root.style.setProperty('--theme-gradient-2', '#008fb3');
  } else if (themeName === 'emerald-care') {
    root.style.setProperty('--theme-gradient-1', '#023015');
    root.style.setProperty('--theme-gradient-2', '#035c27');
  } else if (themeName === 'light-apple') {
    root.style.setProperty('--theme-gradient-1', 'transparent');
    root.style.setProperty('--theme-gradient-2', 'transparent');
  }
}

function changeTheme(themeName: string) {
  currentTheme.value = themeName;
  localStorage.setItem('crm-theme', themeName);

  // Clear custom color since a preset is selected!
  localStorage.removeItem('crm-custom-color');

  clearCustomColorStyles();

  // Restore preset default colors in Vuetify
  resetThemeDefaults(themeName);

  // Apply theme name
  theme.global.name.value = themeName;

  // Sync isDark
  isDark.value = themeName !== 'light-apple';
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light');

  applyGradientVariables(themeName);
}

const orgLogo = ref<string | null>(null);
const orgName = ref('ZaloCRM');

const { accounts, fetchAccounts, setupSocket } = useZaloAccounts();
const taskCount = ref(0);
const trackedCount = ref(0);
let globalSocket: any = null;

const disconnectedAccounts = computed(() => {
  return accounts.value.filter(acc => (acc.liveStatus || acc.status) !== 'connected');
});

function updateFavicon(logoUrl: string | null) {
  if (typeof document === 'undefined') return;
  
  // Standard icon
  let link: HTMLLinkElement | null = document.querySelector("link[rel*='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = logoUrl || '/favicon.svg';
}

async function fetchOrgInfo() {
  try {
    const res = await api.get('/organization');
    orgName.value = res.data.name || 'ZaloCRM';
    orgLogo.value = res.data.logo || null;
    if (typeof document !== 'undefined') {
      document.title = orgName.value;
      updateFavicon(orgLogo.value);
    }
  } catch (err) {
    console.error('Failed to fetch organization details:', err);
  }
}

async function fetchTaskCount() {
  try {
    const res = await api.get('/conversations/uncompleted');
    taskCount.value = res.data.conversations?.length || 0;
    trackedCount.value = res.data.trackedCount || 0;
    
    // Update PWA App Icon Badge count in real-time (sum of both badges)
    if ('setAppBadge' in navigator) {
      const totalBadge = taskCount.value + trackedCount.value;
      if (totalBadge > 0) {
        (navigator as any).setAppBadge(totalBadge).catch(() => {});
      } else {
        (navigator as any).clearAppBadge().catch(() => {});
      }
    }
  } catch (err) {
    console.error('Failed to fetch task count:', err);
    taskCount.value = 0;
    trackedCount.value = 0;
  }
}

function handleMenuClick() {
  if (mobile.value) {
    drawer.value = false;
  }
}

// ── Time Attendance Script Logic ───────────────────────────────────────────
const attendanceStatus = ref<any>(null);

async function fetchAttendanceStatus() {
  if (!authStore.isAuthenticated) return;
  try {
    const res = await api.get('/attendance/status');
    if (res.data && res.data.id) {
      attendanceStatus.value = res.data;
    } else {
      attendanceStatus.value = null;
      // Auto check-in if authenticated and not checked-in today yet
      await autoCheckIn();
    }
  } catch (err) {
    console.error('Failed to fetch attendance status:', err);
  }
}

async function autoCheckIn() {
  try {
    const res = await api.post('/attendance/check-in');
    attendanceStatus.value = res.data;
  } catch (err) {
    console.error('Auto check-in failed:', err);
  }
}

async function handleManualCheckOut() {
  try {
    const res = await api.post('/attendance/check-out');
    attendanceStatus.value = res.data;
    alert('Check-out thành công!');
  } catch (err: any) {
    alert(err.response?.data?.error || 'Check-out thất bại!');
  }
}

function formatTimeShort(dateStr: string) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function getCheckInColorClass(status: string) {
  if (!status) return 'success';
  if (status.startsWith('on_time')) return 'success';
  if (status.startsWith('late')) return 'warning';
  return 'success';
}

function isLate(status: string) {
  return status && status.startsWith('late');
}

onMounted(() => {
  // Sync initial theme
  theme.global.name.value = currentTheme.value;
  
  // Clear any residual custom color stylesheet if not using custom color anymore
  clearCustomColorStyles();
  
  applyGradientVariables(currentTheme.value);
  
  fetchOrgInfo();
  fetchAttendanceStatus();
  fetchAccounts();
  setupSocket();
  fetchTaskCount();


  // Auto-request notifications if supported and not asked yet
  if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          localStorage.setItem('crm-notifications-enabled', 'true');
          notificationsEnabled.value = true;
          subscribeToPush();
        }
      });
    }, 3000);
  } else if ('Notification' in window && Notification.permission === 'granted' && localStorage.getItem('crm-notifications-enabled') !== 'false') {
    setTimeout(() => {
      subscribeToPush();
    }, 2000);
  }

  globalSocket = io({ transports: ['websocket', 'polling'] });
  globalSocket.on('chat:message', (data: any) => {
    fetchTaskCount();
    
    if (data && data.message && data.message.senderType !== 'self') {
      const onChatPage = router.currentRoute.value.path === '/chat';
      
      if (!onChatPage && soundEnabled.value) {
        playLayoutNotificationSound();
      }
      
      const activeConvId = localStorage.getItem('crm-active-conv-id');
      const isViewingActiveConv = onChatPage && (activeConvId === data.conversationId);
      
      if (document.hidden || !isViewingActiveConv) {
        if (notificationsEnabled.value && localStorage.getItem('crm-notifications-enabled') !== 'false') {
          const title = data.message.senderName || 'Tin nhắn mới';
          let body = '';
          if (data.message.contentType === 'text') {
            body = data.message.content || '';
          } else {
            const typeMap: Record<string, string> = {
              image: '📷 Hình ảnh',
              sticker: '🏷️ Sticker',
              video: '🎥 Video',
              voice: '🎤 Tin nhắn thoại',
              file: '📎 Tệp đính kèm',
              link: '🔗 Liên kết',
            };
            body = typeMap[data.message.contentType] || '[Tin nhắn mới]';
          }
          showLocalNotification(title, body, data.conversationId);
        }
      }
    }
  });
  globalSocket.on('zalo:friend_request', (data: any) => {
    latestFriendRequest.value = data;
    showFriendRequestToast.value = true;
    // Play notification sound
    if (soundEnabled.value) playLayoutNotificationSound();
  });

  globalSocket.on('conversation:quote-update', () => {
    fetchTaskCount();
  });
  globalSocket.on('org:update', () => {
    fetchOrgInfo();
  });

  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
  if (globalSocket) {
    globalSocket.disconnect();
  }
});

interface MenuItem {
  title: string;
  icon: string;
  path: string;
  badge?: 'tasks' | 'tracked';
  adminOnly?: boolean;
  allowedForAccountant?: boolean;
}

interface MenuGroup {
  title: string;
  items: MenuItem[];
}

const menuGroups: MenuGroup[] = [
  {
    title: 'Tổng quan',
    items: [
      { title: 'Dashboard', icon: 'mdi-view-dashboard-outline', path: '/dashboard', allowedForAccountant: true },
      { title: 'Báo cáo', icon: 'mdi-chart-arc', path: '/reports', allowedForAccountant: true },
    ],
  },
  {
    title: 'Kinh doanh & CSKH',
    items: [
      { title: 'Tin nhắn', icon: 'mdi-message-text-outline', path: '/chat', allowedForAccountant: true },
      { title: 'Việc cần xử lý', icon: 'mdi-clipboard-text-play-outline', path: '/chat?mode=tasks', badge: 'tasks', allowedForAccountant: false },
      { title: 'Đơn hàng đang theo dõi', icon: 'mdi-clipboard-text-clock-outline', path: '/chat?mode=tracked', badge: 'tracked', allowedForAccountant: true },
      { title: 'Khách hàng', icon: 'mdi-account-group-outline', path: '/contacts', allowedForAccountant: true },
      { title: 'Kho hình ảnh', icon: 'mdi-image-multiple-outline', path: '/media', allowedForAccountant: true },
      { title: 'Lịch hẹn', icon: 'mdi-calendar-clock-outline', path: '/appointments', allowedForAccountant: false },
      { title: 'Đơn hàng', icon: 'mdi-cart-outline', path: '/orders', allowedForAccountant: true },
      { title: 'Tài khoản Zalo', icon: 'mdi-cellphone-link', path: '/zalo-accounts', allowedForAccountant: false },
    ],
  },
  {
    title: 'Hệ thống',
    items: [
      { title: 'Chấm công', icon: 'mdi-clock-check-outline', path: '/attendance', allowedForAccountant: true },
      { title: 'Nhân viên', icon: 'mdi-account-cog-outline', path: '/settings', adminOnly: true, allowedForAccountant: false },
      { title: 'API & Webhook', icon: 'mdi-api', path: '/api-settings', adminOnly: true, allowedForAccountant: false },
    ],
  },
];

const filteredMenuGroups = computed(() => {
  return menuGroups
    .map((group) => {
      const items = group.items.filter((item) => {
        if (item.adminOnly && !authStore.isAdmin) return false;
        if (authStore.user?.role === 'accountant' && !item.allowedForAccountant) return false;
        return true;
      });
      return { ...group, items };
    })
    .filter((group) => group.items.length > 0);
});

function logout() {
  authStore.logout();
  router.push('/login');
}

// ── Friend Request Toast Notification ────────────────────────────────────────
const showFriendRequestToast = ref(false);
const latestFriendRequest = ref<any>(null);

function goToZaloAccounts() {
  showFriendRequestToast.value = false;
  router.push('/zalo-accounts');
}

</script>

<style scoped>
@keyframes pulse {
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.15); opacity: 0.7; }
  100% { transform: scale(1); opacity: 1; }
}
.animate-pulse {
  animation: pulse 1.5s infinite;
  display: inline-block;
}
.pulse-menu-red {
  color: #ff5252 !important;
}
.pulse-menu-orange {
  color: #ff9800 !important;
}

/* ── evondevKit Sidebar Optimizations ── */
.menu-group-header {
  letter-spacing: 0.08em;
  font-size: 0.68rem !important;
  color: rgba(var(--v-theme-on-surface), 0.55);
  user-select: none;
}
.rail-badge-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  position: absolute;
  top: 9px;
  right: 12px;
  box-shadow: 0 0 6px currentColor;
}
.custom-nav-tooltip {
  font-weight: 600 !important;
  font-size: 0.78rem !important;
  letter-spacing: 0.2px !important;
  padding: 6px 12px !important;
  border-radius: 8px !important;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3) !important;
}
.nav-item {
  transition: all 0.18s ease-in-out;
}
.nav-collapse-btn {
  transition: all 0.2s ease;
  opacity: 0.85;
}
.nav-collapse-btn:hover {
  opacity: 1;
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.sidebar-footer-section {
  border-color: rgba(var(--v-theme-on-surface), 0.08) !important;
}
</style>
