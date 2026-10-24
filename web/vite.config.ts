import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy: forward /api to the local Surety server. The Origin header is
// dropped so the server's same-origin defense sees a non-browser request;
// CSRF and (in hosted mode) session auth still apply unchanged.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('origin'));
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
