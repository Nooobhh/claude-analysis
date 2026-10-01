import { defineConfig } from 'astro/config';

export default defineConfig({
  devToolbar: { enabled: false },
  // 输出 privacy.html 而不是 privacy/index.html，/privacy 不再 307 到 /privacy/
  build: { format: 'file' },
  vite: {
    // astro dev 时把 /api 转给 wrangler dev（pnpm dev:worker，默认 :8787）
    server: { proxy: { '/api': 'http://localhost:8787' } },
  },
});
