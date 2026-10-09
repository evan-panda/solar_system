import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works at any URL prefix on your server.
  base: './',
  build: { chunkSizeWarningLimit: 1000 },
});
