import { defineConfig } from 'vite';

// En producción la oficina la sirve server.js (estáticos de dist/ + API de Miniverse).
export default defineConfig({
  build: { outDir: 'dist', emptyOutDir: true },
});
