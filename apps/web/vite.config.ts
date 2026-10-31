import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // three.js gets its own chunk so browsers can cache it across releases.
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 5173,
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
});
