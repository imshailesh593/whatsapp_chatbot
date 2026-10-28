import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served by the bot at /admin/. In dev, proxy API calls to a locally running bot.
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: { proxy: { '/admin/api': 'http://localhost:3000' } }
});
