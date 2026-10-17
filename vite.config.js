import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

export default defineConfig({
  plugins: [react()],
  // Versi ditanam saat build: tampil walau server lama/mati, dan tidak pernah memanggil API.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5180, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3200' } },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
