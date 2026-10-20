<template>
  <v-app class="crm-shell" :class="{ 'liquid-bg': isDark }">
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

    <!-- Top bar — Clean executive header -->
    <v-app-bar density="comfortable" flat class="crm-topbar">
      <v-app-bar-nav-icon
        @click="toggleSidebar"
        :title="!mobile && rail ? 'Mở rộng sidebar (Ctrl+B)' : 'Thu gọn sidebar (Ctrl+B)'"
      />

      <!-- Custom Brand Logo + Title -->
      <div class="d-flex align-center" :style="{ gap: mobile ? '6px' : '10px', marginLeft: mobile ? '4px' : '8px' }">
        <img v-if="orgLogo" :src="orgLogo" alt="Logo" :style="{ width: mobile ? '28px' : '32px', height: mobile ? '28px' : '32px', objectFit: 'contain' }" />
        <img v-else :src="defaultLogo" alt="Logo" :style="{ width: mobile ? '28px' : '32px', height: mobile ? '28px' : '32px', objectFit: 'contain' }" />
        <v-app-bar-title v-if="!mobile" class="ml-0">
          <span class="font-weight-bold" style="font-family: 'Plus Jakarta Sans', sans-serif; letter-spacing: -0.4px; font-size: 1.05rem;">
            <template v-if="orgName === 'ZaloCRM'">
              Zalo<span style="color: #72B99A;">CRM</span>
            </template>
            <template v-else>
              {{ orgName }}
            </template>
          </span>
        </v-app-bar-title>
      </div>

      <v-spacer />
    </v-app-bar>

    <!-- Sidebar navigation -->
    <v-navigation-drawer
      v-model="drawer"
      :rail="!mobile && rail"
      :permanent="!mobile"
      :temporary="mobile"
      :width="225"
      :rail-width="68"
      style="z-index: 1009;"
      class="custom-app-sidebar"
      @mouseenter="onSidebarMouseEnter"
      @mouseleave="onSidebarMouseLeave"
    >
      <section class="connected-accounts" aria-label="Tài khoản kết nối">
        <div class="connections-heading" :class="{ 'connections-heading--rail': rail && !mobile }">
          <span v-if="!rail || mobile" class="menu-group-header">TÀI KHOẢN KẾT NỐI <span class="connection-total">{{ accounts.length }}</span></span>
          <v-btn v-if="authStore.isAdmin" icon="mdi-plus" size="x-small" variant="tonal" color="primary" title="Thêm tài khoản Zalo" aria-label="Thêm tài khoản Zalo" @click="navigateTo('/zalo-accounts?add=1')" />
        </div>
        <v-list density="compact" nav class="account-list pa-0">
          <v-list-item v-for="account in accounts" :key="account.id" class="connected-account" :active="route.path === '/chat' && sidebarAccountId === account.id" :title="!rail || mobile ? account.displayName || 'Tài khoản Zalo' : undefined" @click="selectSidebarAccount(account.id)">
            <template #prepend>
              <span class="account-avatar">
                <img v-if="account.avatarUrl" :src="account.avatarUrl" alt="" class="account-avatar-img" />
                <span v-else>{{ (account.displayName || 'Z').trim().charAt(0).toUpperCase() }}</span>
                <i :class="['account-status', { 'account-status--online': (account.liveStatus || account.status) === 'connected' }]" />
              </span>
            </template>
            <v-tooltip activator="parent" location="right" :disabled="!rail || mobile">{{ account.displayName || 'Tài khoản Zalo' }}</v-tooltip>
          </v-list-item>
        </v-list>
      </section>

      <v-list density="compact" nav class="px-2 pt-2.5 pb-2 sidebar-navigation">
        <div v-for="group in filteredMenuGroups" :key="group.title" class="mb-2">
          <button v-if="group.title === 'Tổng quan'" class="system-group-toggle menu-group-header" :aria-expanded="overviewExpanded" aria-controls="sidebar-overview-items" :aria-label="overviewExpanded ? 'Thu gọn Tổng quan' : 'Mở rộng Tổng quan'" @click="overviewExpanded = !overviewExpanded">
            <span v-if="!rail || mobile">TỔNG QUAN</span><v-icon v-else size="18">mdi-view-dashboard-outline</v-icon>
            <v-icon size="16">{{ overviewExpanded ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
          </button>
          <button v-else-if="group.title === 'Hệ thống'" class="system-group-toggle menu-group-header" :aria-expanded="systemExpanded" aria-controls="sidebar-system-items" @click="systemExpanded = !systemExpanded" :aria-label="systemExpanded ? 'Thu gọn Hệ thống' : 'Mở rộng Hệ thống'" :title="systemExpanded ? 'Thu gọn Hệ thống' : 'Mở rộng Hệ thống'">
            <span v-if="!rail || mobile">HỆ THỐNG</span><v-icon v-else size="18">mdi-cog-outline</v-icon>
            <v-icon size="16">{{ systemExpanded ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
          </button>
          <div v-else-if="!rail || mobile" class="text-uppercase font-weight-bold px-3 py-1 menu-group-header" style="font-size: 0.72rem; letter-spacing: 0.6px;">{{ group.title }}</div>
          <v-divider v-else class="my-2 mx-2 opacity-20" />

          <div v-show="group.title === 'Hệ thống' ? systemExpanded : group.title === 'Tổng quan' ? overviewExpanded : true" :id="group.title === 'Hệ thống' ? 'sidebar-system-items' : group.title === 'Tổng quan' ? 'sidebar-overview-items' : undefined">
            <v-list-item v-for="item in group.items" :key="item.path" :active="isMenuItemActive(item)" :title="!rail || mobile ? item.title : undefined" class="mb-1 nav-item" :class="{ 'category-nav-item': item.categoryColor }" @click="navigateTo(item.path)">
              <template #prepend>
                <v-icon :icon="item.icon" :style="{ color: item.color || item.categoryColor }" size="19" />
              </template>
              <template #append v-if="menuBadge(item) > 0">
                <span v-if="!mobile && rail" class="rail-badge-dot bg-primary" />
                <span v-else class="nav-count" :class="{ 'nav-count--warning': item.badge === 'tracked' }">{{ menuBadge(item) > 99 ? '99+' : menuBadge(item) }}</span>
              </template>
              <v-tooltip activator="parent" location="right" :disabled="!rail || mobile">{{ item.title }}<span v-if="menuBadge(item)"> · {{ menuBadge(item) }}</span></v-tooltip>
            </v-list-item>

            <!-- System Controls (Merged from image 1) -->
            <template v-if="group.title === 'Hệ thống'">
              <!-- User Profile & Attendance Card (Expanded view) -->
              <div v-if="authStore.user && (!rail || mobile)" class="system-user-box pa-1.5 mb-1.5 rounded-lg">
                <!-- User name & Online badge -->
                <div class="d-flex align-center justify-space-between mb-2">
                  <div class="d-flex align-center" style="gap: 8px;">
                    <span class="user-avatar-badge">
                      <img v-if="userAvatarUrl" :src="userAvatarUrl" alt="" class="user-avatar-img" />
                      <span v-else>{{ (authStore.user.fullName || 'U').charAt(0).toUpperCase() }}</span>
                    </span>
                    <div style="min-width: 0;">
                      <div class="d-flex align-center" style="gap: 5px;">
                        <span class="user-online-dot" />
                        <span class="text-body-2 font-weight-bold text-truncate" style="letter-spacing: -0.2px;">{{ authStore.user.fullName }}</span>
                      </div>
                      <span class="text-caption text-medium-emphasis" style="font-size: 11px;">{{ authStore.isAdmin ? 'Quản trị viên' : 'Nhân viên' }}</span>
                    </div>
                  </div>
                </div>

                <!-- Attendance Status & Actions -->
                <div class="system-attendance-wrap d-flex align-center" style="gap: 6px;">
                  <template v-if="attendanceStatus">
                    <v-chip
                      v-if="attendanceStatus.checkOutAt"
                      size="x-small"
                      color="default"
                      variant="flat"
                      prepend-icon="mdi-clock-check-outline"
                      class="flex-grow-1 justify-center font-weight-medium"
                      title="Đã hoàn thành chấm công hôm nay"
                    >
                      Đã Về ({{ formatTimeShort(attendanceStatus.checkOutAt) }})
                    </v-chip>
                    <template v-else>
                      <v-chip
                        size="x-small"
                        :color="getCheckInColorClass(attendanceStatus.checkInStatus)"
                        variant="flat"
                        prepend-icon="mdi-fingerprint"
                        to="/attendance"
                        title="Đã check-in. Bấm để xem chi tiết lịch sử."
                        class="cursor-pointer flex-grow-1 justify-center font-weight-medium"
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
                        height="24"
                        style="font-size: 11px;"
                      >
                        Check-out
                      </v-btn>
                    </template>
                  </template>
                  <v-chip
                    v-else
                    size="x-small"
                    color="warning"
                    variant="flat"
                    prepend-icon="mdi-fingerprint-off"
                    to="/attendance"
                    class="cursor-pointer flex-grow-1 justify-center font-weight-medium"
                    title="Chưa check-in ngày hôm nay"
                  >
                    Chưa Check-in
                  </v-chip>
                </div>
              </div>

              <!-- Quick Control Dock (Notifications, Theme, Push, Sound, Logout) -->
              <div v-if="!rail || mobile" class="system-quick-dock d-flex align-center justify-space-around py-1 px-1 mb-2">
                <!-- Notification Bell -->
                <div class="dock-btn-wrap" title="Thông báo">
                  <NotificationBell />
                </div>

                <!-- Theme Switcher Menu -->
                <v-menu transition="slide-y-transition" open-on-hover close-delay="100">
                  <template #activator="{ props }">
                    <v-btn icon size="small" variant="text" v-bind="props" title="Đổi chủ đề" aria-label="Đổi chủ đề">
                      <v-icon size="18" color="primary">mdi-palette-outline</v-icon>
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
                    <v-list-item @click="resetToOriginalDefaults" rounded="lg" class="mb-1 text-error">
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
                  size="small"
                  variant="text"
                  @click="toggleNotifications"
                  :title="notificationsEnabled ? 'Tắt thông báo đẩy' : 'Bật thông báo đẩy'"
                  aria-label="Thông báo đẩy"
                >
                  <v-icon size="18" :color="notificationsEnabled ? 'primary' : 'grey'">
                    {{ notificationsEnabled ? 'mdi-bell-ring-outline' : 'mdi-bell-off-outline' }}
                  </v-icon>
                </v-btn>

                <!-- Sound Toggle -->
                <v-btn
                  icon
                  size="small"
                  variant="text"
                  @click="toggleSound"
                  :title="soundEnabled ? 'Tắt âm thanh' : 'Bật âm thanh'"
                  aria-label="Âm thanh"
                >
                  <v-icon size="18" :color="soundEnabled ? 'primary' : 'grey'">
                    {{ soundEnabled ? 'mdi-volume-high' : 'mdi-volume-off' }}
                  </v-icon>
                </v-btn>

                <!-- Logout Button -->
                <v-btn icon size="small" variant="text" @click="logout" title="Đăng xuất" aria-label="Đăng xuất">
                  <v-icon size="18" color="error">mdi-logout</v-icon>
                </v-btn>
              </div>

              <!-- Rail compact controls when sidebar is rail mode -->
              <template v-if="rail && !mobile">
                <v-list-item
                  role="button"
                  tabindex="0"
                  prepend-icon="mdi-logout"
                  title="Đăng xuất"
                  class="mb-1 nav-item text-error"
                  aria-label="Đăng xuất"
                  @click="logout"
                >
                  <v-tooltip activator="parent" location="right">Đăng xuất</v-tooltip>
                </v-list-item>
              </template>

              <!-- Rail collapse toggle item -->
              <v-list-item
                v-if="!mobile"
                role="button"
                :prepend-icon="rail ? 'mdi-chevron-double-right' : 'mdi-chevron-double-left'"
                :title="!rail ? 'Thu gọn thanh bên' : undefined"
                class="nav-collapse-btn"
                :aria-label="rail ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'"
                @click="rail = !rail"
              >
                <template #append v-if="!rail"><span class="sidebar-shortcut">Ctrl+B</span></template>
                <v-tooltip activator="parent" location="right" :disabled="!rail">Mở rộng thanh bên (Ctrl+B)</v-tooltip>
              </v-list-item>
            </template>
          </div>
        </div>
      </v-list>
    </v-navigation-drawer>

    <!-- Main content -->
    <v-main>
      <v-container fluid class="crm-content" :class="{ 'crm-content--chat': route.path === '/chat' }">
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
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { CUSTOMER_STATUS_LIST } from '@/constants/customer-statuses';
import { useTheme, useDisplay } from 'vuetify';
import { useAuthStore } from '@/stores/auth';
import { useRouter, useRoute } from 'vue-router';
import NotificationBell from '@/components/NotificationBell.vue';
import { useZaloAccounts } from '@/composables/use-zalo-accounts';
import { io } from 'socket.io-client';
import { api } from '@/api/index';
import defaultLogo from '@/assets/logo_only.png';

const theme = useTheme();
const { mobile } = useDisplay();
const authStore = useAuthStore();
const router = useRouter();
const route = useRoute();

function isMenuItemActive(item: MenuItem): boolean {
  if (item.path === '/chat?mode=unread' && route.path === '/chat' && route.query.tab === 'unread') return true;
  if (item.path.includes('?')) {
    return route.path === item.path.split('?')[0] && [...new URLSearchParams(item.path.split('?')[1]).entries()].every(([key, value]) => route.query[key] === value);
  }
  if (item.path === '/chat') {
    return route.path === '/chat' && !route.query.mode && !route.query.accountId && !route.query.category && !route.query.status && route.query.tab !== 'unread';
  }
  return route.path === item.path;
}

function navigateTo(path: string) {
  router.push(path);
  handleMenuClick();
}

const drawer = ref(true);
// Mặc định là thu gọn sidebar (Image 1)
const rail = ref(true);
let collapseTimer: ReturnType<typeof setTimeout> | null = null;

function onSidebarMouseEnter() {
  if (mobile.value) return;
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }
  rail.value = false;
}

function onSidebarMouseLeave() {
  if (mobile.value) return;
  if (collapseTimer) {
    clearTimeout(collapseTimer);
  }
  collapseTimer = setTimeout(() => {
    rail.value = true;
    collapseTimer = null;
  }, 3000);
}

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
const currentTheme = ref(localStorage.getItem('crm-theme') || 'light-apple');
const isDark = ref(currentTheme.value !== 'light-apple');

const themeOptions = [
  { id: 'emerald-care', title: 'Ngọc lục bảo', color: '#72B99A' },
  { id: 'dark-obsidian', title: 'Xanh đá trầm', color: '#8CBAC4' },
  { id: 'light-apple', title: 'Sáng thanh lịch', color: '#1D5140' },
];

function resetToOriginalDefaults() {
  localStorage.removeItem('crm-custom-color');
  localStorage.setItem('crm-theme', 'light-apple');
  currentTheme.value = 'light-apple';
  
  clearCustomColorStyles();

  // Restore all presets to their default styles
  resetThemeDefaults('emerald-care');
  resetThemeDefaults('dark-obsidian');
  resetThemeDefaults('light-apple');
  
  // Apply theme
  theme.global.name.value = 'light-apple';
  isDark.value = false;
  localStorage.setItem('theme', 'light');
  
  applyGradientVariables('light-apple');
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
    background: '#101E1B',
    surface: '#182B26',
    'surface-variant': '#233B33',
    'surface-light': '#304A40',
    primary: '#72B99A',
    secondary: '#A6B6AD',
    accent: '#72B99A',
  },
  'dark-obsidian': {
    background: '#111C24',
    surface: '#1A2933',
    'surface-variant': '#253742',
    'surface-light': '#314652',
    primary: '#8CBAC4',
    secondary: '#9DAFBD',
    accent: '#8CBAC4',
  },
  'light-apple': {
    background: '#F5F5F1',
    surface: '#FFFFFF',
    'surface-variant': '#E9ECE7',
    'surface-light': '#D9DFD8',
    primary: '#1D5140',
    secondary: '#67756D',
    accent: '#1D5140',
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
const unreadCount = ref(0);
const systemExpanded = ref(false);
const overviewExpanded = ref(false);
const sidebarAccountId = computed(() => typeof route.query.accountId === 'string' ? route.query.accountId : null);
function selectSidebarAccount(accountId: string | null) {
  const { accountId: _account, convId: _conv, action: _action, ...query } = route.path === '/chat' ? route.query : {};
  router.push({ path: '/chat', query: accountId ? { ...query, accountId } : query });
  handleMenuClick();
}
function menuBadge(item: MenuItem) {
  return item.badge === 'unread' ? unreadCount.value : item.badge === 'tracked' ? trackedCount.value : 0;
}
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
  link.href = logoUrl || '/logo_only.png';
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
    const [res, unread] = await Promise.all([api.get('/conversations/uncompleted'), api.get('/conversations', { params: { unreadOnly: 'true', limit: 1 } })]);
    unreadCount.value = unread.data.total || 0;
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

  window.addEventListener('crm:accounts-changed', fetchAccounts);
  window.addEventListener('crm:unread-changed', fetchTaskCount);
  globalSocket.on('conversation:quote-update', () => {
    fetchTaskCount();
  });
  globalSocket.on('org:update', () => {
    fetchOrgInfo();
  });

  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('crm:accounts-changed', fetchAccounts);
  window.removeEventListener('crm:unread-changed', fetchTaskCount);
  if (globalSocket) {
    globalSocket.disconnect();
  }
});

interface MenuItem {
  title: string;
  icon: string;
  path: string;
  badge?: 'unread' | 'tracked';
  adminOnly?: boolean;
  allowedForAccountant?: boolean;
  categoryColor?: string;
  color?: string;
}

interface MenuGroup {
  title: string;
  items: MenuItem[];
}

const userAvatarUrl = computed(() => {
  return authStore.user?.avatarUrl || accounts.value[0]?.avatarUrl || '';
});

const menuGroups: MenuGroup[] = [
  {
    title: 'Tổng quan',
    items: [
      { title: 'Dashboard', icon: 'mdi-view-dashboard-outline', path: '/dashboard', color: '#10B981', allowedForAccountant: true },
      { title: 'Báo cáo', icon: 'mdi-chart-arc', path: '/reports', color: '#8B5CF6', allowedForAccountant: true },
    ],
  },
  {
    title: 'Kinh doanh & CSKH',
    items: [
      { title: 'Tất cả hội thoại', icon: 'mdi-message-text-outline', path: '/chat', color: '#059669', allowedForAccountant: true },
      { title: 'Danh bạ KH', icon: 'mdi-account-group-outline', path: '/contacts', color: '#2563EB', allowedForAccountant: true },
      { title: 'Kho hình ảnh', icon: 'mdi-image-multiple-outline', path: '/media', color: '#EC4899', allowedForAccountant: true },
      { title: 'Catalog', icon: 'mdi-book-open-page-variant-outline', path: '/catalog', color: '#D97706', allowedForAccountant: true },
      { title: 'Lịch hẹn', icon: 'mdi-calendar-clock-outline', path: '/appointments', color: '#7C3AED', allowedForAccountant: false },
      { title: 'Đơn hàng', icon: 'mdi-cart-outline', path: '/orders', color: '#EA580C', allowedForAccountant: true },
    ],
  },
  {
    title: 'Trạng thái',
    items: CUSTOMER_STATUS_LIST.map(status => ({
      title: status.label,
      icon: status.icon,
      path: '/chat?status=' + encodeURIComponent(status.id),
      categoryColor: status.color,
      allowedForAccountant: true,
    })),
  },
  {
    title: 'Hệ thống',
    items: [
      { title: 'Chấm công', icon: 'mdi-clock-check-outline', path: '/attendance', color: '#0D9488', allowedForAccountant: true },
      { title: 'Nhân viên', icon: 'mdi-account-cog-outline', path: '/settings', color: '#64748B', adminOnly: true, allowedForAccountant: false },
      { title: 'API & Webhook', icon: 'mdi-api', path: '/api-settings', color: '#0284C7', adminOnly: true, allowedForAccountant: false },
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
.account-avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 9px;
  object-fit: cover;
  display: block;
}
.user-avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  display: block;
}

/* Sidebar compact optimizations: remove wide spacer & shift text close to icon */
.custom-app-sidebar :deep(.v-list-item__spacer),
.sidebar-navigation :deep(.v-list-item__spacer) {
  display: none !important;
  width: 0 !important;
  min-width: 0 !important;
  margin: 0 !important;
}

/* Di chuyển text qua phải một chút và căn đều cân đối 2 bên (Image 2) */
.sidebar-navigation :deep(.v-list-item__prepend) {
  margin-inline-end: 14px !important;
}
.sidebar-navigation :deep(.v-list-item__prepend > .v-icon) {
  margin: 0 !important;
}
.sidebar-navigation :deep(.v-list-item) {
  padding-inline-start: 14px !important;
  padding-inline-end: 12px !important;
  padding-block: 4px !important;
  min-height: 38px !important;
  margin-bottom: 3px !important;
  border-radius: 9px !important;
}
.sidebar-navigation :deep(.v-list-item-title) {
  font-size: 0.855rem !important;
  letter-spacing: -0.1px !important;
  white-space: nowrap !important;
  padding-left: 2px !important;
}

.custom-app-sidebar .connections-heading {
  padding: 6px 12px 4px 12px !important;
  min-height: 30px !important;
}
.custom-app-sidebar .connected-accounts {
  padding-bottom: 4px !important;
}
.custom-app-sidebar .account-list :deep(.v-list-item) {
  padding-inline: 10px !important;
  min-height: 36px !important;
}
.custom-app-sidebar .system-group-toggle {
  padding: 6px 12px !important;
  min-height: 32px !important;
  border-radius: 8px !important;
}

/* ── Rail Mode: Kích thước cân đối, vừa vặn để luôn thấy icon Cài đặt ở đáy ── */
.v-navigation-drawer--rail .connected-accounts {
  padding-bottom: 2px !important;
  margin-bottom: 2px !important;
}
.v-navigation-drawer--rail .connections-heading {
  padding: 4px 6px 2px !important;
  min-height: 24px !important;
}
.v-navigation-drawer--rail .account-list :deep(.v-list-item) {
  min-height: 38px !important;
  margin-bottom: 5px !important;
}
.v-navigation-drawer--rail .sidebar-navigation {
  padding-top: 6px !important;
  padding-bottom: 8px !important;
  padding-inline: 6px !important;
}
.v-navigation-drawer--rail .sidebar-navigation div.mb-2 {
  margin-bottom: 3px !important;
}
.v-navigation-drawer--rail .sidebar-navigation :deep(.v-list-item) {
  min-height: 40px !important;
  margin-bottom: 5px !important;
  margin-inline: 4px !important;
  padding-inline: 0 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  border-radius: 11px !important;
}
.v-navigation-drawer--rail .sidebar-navigation :deep(.v-list-item__prepend) {
  margin-inline-end: 0 !important;
}
.v-navigation-drawer--rail .sidebar-navigation :deep(.v-list-item__prepend > .v-icon) {
  font-size: 21px !important;
}
.v-navigation-drawer--rail .system-group-toggle {
  min-height: 38px !important;
  margin-bottom: 5px !important;
  margin-inline: 4px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  border-radius: 10px !important;
}
.v-navigation-drawer--rail .v-divider {
  margin-block: 6px !important;
  margin-inline: 6px !important;
}
.custom-app-sidebar :deep(.v-navigation-drawer__content) {
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--v-theme-primary), 0.2) transparent;
}
.custom-app-sidebar :deep(.v-navigation-drawer__content::-webkit-scrollbar) {
  width: 4px;
}
.custom-app-sidebar :deep(.v-navigation-drawer__content::-webkit-scrollbar-thumb) {
  background: rgba(var(--v-theme-primary), 0.2);
  border-radius: 4px;
}
</style>
