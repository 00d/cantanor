import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3331,
  },
  build: {
    target: 'esnext',
  },
});
