import { defineConfig } from 'astro/config';

export default defineConfig({
  devToolbar: { enabled: false },
  build: { format: 'file' },
  // 检测站本地占 4321
  server: { port: 4322 },
});
