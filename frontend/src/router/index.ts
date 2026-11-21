import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const routes = [
  { path: '/handovers', alias: ['/cskh/handovers', '/crm/handovers', '/crm/cskh/handovers'], name: 'Handovers', component: () => import('@/views/HandoversView.vue'), meta: { requiresAuth: true } },
  {
    path: '/login',
    alias: ['/crm/login'],
    name: 'Login',
    component: () => import('@/views/LoginView.vue'),
    meta: { layout: 'auth' },
  },
  {
    path: '/setup',
    alias: ['/crm/setup'],
    name: 'Setup',
    component: () => import('@/views/SetupView.vue'),
    meta: { layout: 'auth' },
  },
  {
    path: '/',
    alias: ['/crm', '/crm/'],
    redirect: '/chat',
  },
  {
    path: '/dashboard',
    alias: ['/crm/dashboard', '/cskh/dashboard'],
    name: 'Dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/chat',
    alias: ['/cskh/chat', '/crm/chat', '/crm/cskh/chat'],
    name: 'Chat',
    component: () => import('@/views/ChatView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/contacts',
    alias: ['/cskh/contacts', '/crm/contacts', '/crm/cskh/contacts', '/crm/leads'],
    name: 'Contacts',
    component: () => import('@/views/ContactsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/contacts/:id',
    alias: ['/cskh/contacts/:id', '/crm/contacts/:id', '/crm/cskh/contacts/:id'],
    name: 'ContactDetail',
    component: () => import('@/views/ContactDetailView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/zalo-accounts',
    alias: ['/cskh/zalo-accounts', '/crm/zalo-accounts', '/crm/cskh/zalo-accounts'],
    name: 'ZaloAccounts',
    component: () => import('@/views/ZaloAccountsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/appointments',
    alias: ['/cskh/appointments', '/crm/appointments', '/crm/cskh/appointments'],
    name: 'Appointments',
    component: () => import('@/views/AppointmentsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/orders',
    alias: ['/cskh/orders', '/crm/orders', '/crm/cskh/orders'],
    name: 'Orders',
    component: () => import('@/views/OrdersView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/catalog',
    alias: ['/cskh/catalog', '/crm/catalog', '/crm/cskh/catalog'],
    name: 'Catalog',
    component: () => import('@/views/CatalogView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/reports',
    alias: ['/cskh/reports', '/crm/reports', '/crm/cskh/reports'],
    name: 'Reports',
    component: () => import('@/views/ReportsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/settings',
    alias: ['/cskh/ai', '/crm/cskh/ai', '/crm/settings', '/cskh/settings'],
    name: 'Settings',
    component: () => import('@/views/SettingsView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true },
  },
  {
    path: '/api-settings',
    alias: ['/crm/api-settings', '/cskh/api-settings'],
    name: 'ApiSettings',
    component: () => import('@/views/ApiSettingsView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true },
  },
  {
    path: '/attendance',
    alias: ['/cskh/attendance', '/crm/attendance', '/crm/cskh/attendance'],
    name: 'Attendance',
    component: () => import('@/views/AttendanceView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/media',
    alias: ['/cskh/media', '/crm/media', '/crm/cskh/media'],
    name: 'Media',
    component: () => import('@/views/MediaView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/NotFoundView.vue'),
  },
];

const isPortal = typeof window !== 'undefined' && ((window as any).APP_CONFIG || window.location.pathname.startsWith('/crm'));
const routerBase = isPortal ? '/crm' : '/';

export const router = createRouter({
  history: createWebHistory(routerBase),
  routes,
});

// Auth guard
router.beforeEach(async (to, _from, next) => {
  const authStore = useAuthStore();

  // Skip guard for setup and login pages
  if (to.name === 'Setup' || to.name === 'Login') {
    return next();
  }

  // Check auth for protected routes
  if (to.meta.requiresAuth) {
    if (!authStore.isAuthenticated) {
      await authStore.init();
    }

    if (!authStore.token) {
      const inPortal = typeof window !== 'undefined' && ((window as any).APP_CONFIG || window.location.pathname.startsWith('/crm'));
      if (inPortal) {
        window.location.href = '/login';
        return;
      }
      return next('/login');
    }
    
    // Check if page requires admin/owner role
    if (to.meta.requiresAdmin && !authStore.isAdmin) {
      return next('/');
    }
  }

  next();
});
