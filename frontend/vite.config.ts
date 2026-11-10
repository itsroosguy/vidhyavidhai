import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function normalizeViteBase(raw?: string): string {
  const trimmed = (raw || '/').trim();
  if (!trimmed || trimmed === '/') return '/';
  const cleaned = trimmed.replace(/^\/+|\/+$/g, '');
  return cleaned ? `/${cleaned}/` : '/';
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: normalizeViteBase(env.VITE_BASE_PATH),
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
