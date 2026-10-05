import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // In development the page calls /api on its own address and Vite passes it to the local server.
  server: { proxy: { '/api': 'http://localhost:4000' } },
});
