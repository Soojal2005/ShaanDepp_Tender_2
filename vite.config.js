import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Source artwork lives in src/bg; copying large files in there must not crash the dev server.
    watch: { ignored: ['**/src/bg/**'] },
    proxy: {
      '/api': 'http://localhost:4000'
    }
  }
});
