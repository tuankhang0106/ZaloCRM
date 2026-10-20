import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5174,
    proxy: {
      '/api': 'http://127.0.0.1:3080',
      '/uploads': 'http://127.0.0.1:3080',
      '/socket.io': {
        target: 'http://127.0.0.1:3080',
        ws: true,
      },
    },
  },
});
