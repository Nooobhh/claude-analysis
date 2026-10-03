import { defineConfig } from 'astro/config';

export default defineConfig({
  devToolbar: { enabled: false },
  build: { format: 'file' },
  // 检测站本地占 4321
  server: { port: 4322 },
  vite: {
    // astro dev 时把 /api 转给 wrangler dev（pnpm dev:data-worker，:8788）
    server: { proxy: { '/api': 'http://localhost:8788' } },
  },
});
