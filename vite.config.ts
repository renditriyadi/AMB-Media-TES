import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        ignored: [
          '**/server/data/**',
          '**/data/**',
          '**/media-cache/**',
          '**/.playwright-browsers/**',
          '**/.playwright-profiles/**',
          '**/.playwright-profiles-vids/**',
          '**/.playwright-profiles*/**',
          '**/tmp/**',
          '**/*.json',
          '**/*.txt',
          '**/*.md',
          '**/*.ps1',
          '**/*.cmd',
          '**/*.bat',
          '**/*.sh',
          '**/logs/**',
          '**/docs/**',
          '**/Studio/**',
          '**/cli gemin mode/**',
          '**/debug-tes-gemini/**',
          '**/ffmpeg/**',
          '**/dola-script2/**',
          '**/scripts-dola/**',
          '**/script-*/**',
          '**/scripts/**',
          '**/ektension-*/**',
          '**/Extension-*/**',
        ],
      },
    },
  };
});
