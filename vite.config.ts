import { defineConfig } from 'vite';

export default defineConfig({
  // 相對路徑：GitHub Pages 的子路徑 /happyFarm/ 與本機預覽都能用
  base: './',
  server: { port: 5188, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
