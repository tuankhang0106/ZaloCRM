<template>
  <v-card class="pa-8 login-card" elevation="0">
    <div class="text-center mb-8">
      <v-img :src="orgLogo || defaultLogo" alt="Logo" width="64" height="64" class="mx-auto mb-4" contain />
      <h1 class="text-h5 font-weight-bold">
        <template v-if="orgName === 'ZaloCRM'">
          Zalo<span style="color: #00B074;">CRM</span>
        </template>
        <template v-else>
          {{ orgName }}
        </template>
      </h1>
      <p class="text-medium-emphasis text-caption mt-1">Quản lý kết nối. Chăm sóc tận tâm.</p>
    </div>

    <div class="login-heading"><h2>Chào mừng trở lại</h2><p>Đăng nhập để tiếp tục công việc của bạn.</p></div>
    <v-form @submit.prevent="handleLogin">
      <v-text-field
        v-model="email"
        label="Email"
        type="email" autocomplete="username"
        prepend-inner-icon="mdi-email-outline"
        required
        class="mb-3"
      />
      <v-text-field
        v-model="password"
        label="Mật khẩu"
        type="password" autocomplete="current-password"
        prepend-inner-icon="mdi-lock-outline"
        required
        class="mb-5"
      />
      <v-btn type="submit" color="primary" block size="large" :loading="loading" rounded="xl" style="color: white !important;">
        <v-icon start>mdi-login</v-icon>
        Đăng nhập
      </v-btn>
    </v-form>

    <v-alert v-if="error" type="error" class="mt-4" density="compact" closable variant="tonal">
      {{ error }}
    </v-alert>
  </v-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/api/index';
import defaultLogo from '@/assets/logo_default.png';

const email = ref('');
const password = ref('');
const loading = ref(false);
const error = ref('');
const router = useRouter();
const authStore = useAuthStore();

const orgLogo = ref<string | null>(null);
const orgName = ref('ZaloCRM');

async function fetchBrand() {
  try {
    const res = await api.get('/public/brand');
    orgName.value = res.data.name || 'ZaloCRM';
    orgLogo.value = res.data.logo || null;
    if (orgLogo.value) {
      updateFavicon(orgLogo.value);
    }
  } catch (err) {
    console.error('Failed to fetch brand settings:', err);
  }
}

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
  
  if (orgName.value && orgName.value !== 'ZaloCRM') {
    document.title = `${orgName.value} - Đăng nhập`;
  }
}

onMounted(async () => {
  // Fetch dynamic brand (logo + orgName) first
  fetchBrand();

  // If already authenticated, skip login page
  if (authStore.token) {
    try {
      await authStore.fetchProfile();
      if (authStore.isAuthenticated) {
        router.replace('/');
        return;
      }
    } catch {}
  }
  // Check if first-time setup needed
  try {
    const needs = await authStore.checkSetup();
    if (needs) router.replace('/setup');
  } catch {}
});

async function handleLogin() {
  loading.value = true;
  error.value = '';
  try {
    await authStore.login(email.value, password.value);
    router.push('/');
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Đăng nhập thất bại';
  } finally {
    loading.value = false;
  }
}
</script>
