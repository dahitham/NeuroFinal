import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // the accessibility engine is shared with the Chrome extension, so the Reading Studio preview and the
    // extension apply settings with exactly the same code
    alias: { '@ext': path.resolve(here, '../extension/content') },
  },
  server: { port: 5173, strictPort: true, fs: { allow: [path.resolve(here, '..')] } },
  preview: { port: 4173 },
  test: { environment: 'jsdom', globals: true, include: ['tests/**/*.test.{js,jsx}'] },
});
