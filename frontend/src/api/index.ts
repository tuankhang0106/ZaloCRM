import axios from 'axios';

export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    if ((window as any).APP_CONFIG || window.location.pathname.startsWith('/crm')) {
      return '/api/zalo';
    }
  }
  return '/api/v1';
}

const api = axios.create({
  baseURL: getApiBaseUrl(),
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  // Dynamically update baseURL if running in portal mode
  const currentBase = getApiBaseUrl();
  if (config.baseURL !== currentBase && (!config.url || !config.url.startsWith('http'))) {
    config.baseURL = currentBase;
  }

  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let isRedirecting = false;

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !isRedirecting) {
      const isPortal = typeof window !== 'undefined' && ((window as any).APP_CONFIG || window.location.pathname.startsWith('/crm'));
      if (isPortal) {
        isRedirecting = true;
        localStorage.removeItem('token');
        window.location.href = '/login';
        return Promise.reject(error);
      }
      const path = window.location.pathname;
      if (path !== '/login' && path !== '/setup') {
        isRedirecting = true;
        localStorage.removeItem('token');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

export { api };
