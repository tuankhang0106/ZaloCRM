import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api } from '@/api/index';

interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
  orgId: string;
  orgName: string;
  avatarUrl?: string | null;
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const token = ref(localStorage.getItem('token') || '');
  const needsSetup = ref(false);

  const isAuthenticated = computed(() => !!token.value && !!user.value);
  const isOwner = computed(() => user.value?.role === 'owner');
  const isAdmin = computed(() => ['owner', 'admin'].includes(user.value?.role || ''));

  async function checkSetup() {
    const res = await api.get('/setup/status');
    needsSetup.value = res.data.needsSetup;
    return res.data.needsSetup;
  }

  async function setup(data: { orgName: string; fullName: string; email: string; password: string }) {
    const res = await api.post('/setup', data);
    token.value = res.data.token;
    user.value = res.data.user;
    localStorage.setItem('token', res.data.token);
  }

  async function login(email: string, password: string) {
    const res = await api.post('/auth/login', { email, password });
    token.value = res.data.token;
    localStorage.setItem('token', res.data.token);
    // Login response is partial — fetch full profile immediately
    await fetchProfile();
  }

  async function fetchProfile() {
    try {
      const res = await api.get('/profile');
      const d = res.data;
      // Map API response to User interface (org.name → orgName)
      user.value = {
        id: d.id,
        email: d.email,
        fullName: d.fullName || d.full_name || '',
        role: d.role,
        orgId: d.orgId || d.org_id || '',
        orgName: d.org?.name || d.orgName || '',
      };
    } catch (err: any) {
      // Only logout on 401 (invalid token) — not on network errors
      if (err?.response?.status === 401) {
        logout();
      }
    }
  }

  function logout() {
    token.value = '';
    user.value = null;
    localStorage.removeItem('token');
    const isPortal = typeof window !== 'undefined' && ((window as any).APP_CONFIG || window.location.pathname.startsWith('/crm'));
    if (isPortal) {
      const csrfToken = (window as any).APP_CONFIG?.csrfToken || '';
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = '/logout';
      if (csrfToken) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = '_token';
        input.value = csrfToken;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    }
  }

  async function init() {
    // 1. Try bootstrap from portal if embedded in portal
    if (typeof window !== 'undefined') {
      const appConfig = (window as any).APP_CONFIG;
      if (appConfig?.session?.token) {
        token.value = appConfig.session.token;
        if (appConfig.session.user) {
          user.value = {
            id: appConfig.session.user.id,
            email: appConfig.session.user.email,
            fullName: appConfig.session.user.fullName || appConfig.session.user.full_name || '',
            role: appConfig.session.user.role || 'staff',
            orgId: appConfig.session.user.orgId || appConfig.session.user.org_id || '',
            orgName: appConfig.session.user.orgName || appConfig.session.user.org?.name || 'CRM',
          };
        }
        localStorage.setItem('token', token.value);
        return;
      }

      if (appConfig || window.location.pathname.startsWith('/crm')) {
        try {
          const res = await fetch('/api/zalo/bootstrap', {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
          });
          if (res.ok) {
            const d = await res.json();
            if (d?.token) {
              token.value = d.token;
              if (d.user) {
                user.value = {
                  id: d.user.id,
                  email: d.user.email,
                  fullName: d.user.fullName || d.user.full_name || '',
                  role: d.user.role || 'staff',
                  orgId: d.user.orgId || d.user.org_id || '',
                  orgName: d.user.orgName || d.user.org?.name || 'CRM',
                };
              }
              localStorage.setItem('token', token.value);
              return;
            }
          }
        } catch (e) {
          console.warn('[auth] Failed to bootstrap portal session:', e);
        }
      }
    }

    if (token.value) {
      await fetchProfile();
    }
  }

  return { user, token, needsSetup, isAuthenticated, isOwner, isAdmin, checkSetup, setup, login, fetchProfile, logout, init };
});
