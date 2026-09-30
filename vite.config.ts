import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5188, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
