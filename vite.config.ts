import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The service worker builds its page map from this manifest, so it caches the
  // chunks Rollup actually emitted rather than guessing from file names.
  build: { manifest: true },
  server: { port: 5183 },
});
