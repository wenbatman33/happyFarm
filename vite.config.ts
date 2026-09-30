import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
  // 相對路徑：GitHub Pages 的子路徑 /happyFarm/ 與本機預覽都能用
  base: './',
  server: { port: 5188, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  // 版本字串（設定頁顯示；Service Worker 也用它當快取名稱）
  define: { __APP_VERSION__: JSON.stringify(`${pkg.version}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`) },
});
