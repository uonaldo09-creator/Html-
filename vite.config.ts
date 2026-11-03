import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@assets': path.resolve(__dirname, 'attached_assets'),
      },
    },
    server: {
      // HMR and file watching can be disabled via DISABLE_HMR to prevent
      // flickering during agent-driven edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    test: {
      include: ['src/tests/**/*.test.ts'],
      setupFiles: ['./src/tests/setup.ts'],
    },
  };
});
