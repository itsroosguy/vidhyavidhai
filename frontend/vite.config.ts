import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [react(), tailwindcss()],
    server: {
      host: true,
      port: 5173,
      allowedHosts: ['.local'],
    },
    build: {
      target: 'esnext',
      sourcemap: false,
    },
  };
});
