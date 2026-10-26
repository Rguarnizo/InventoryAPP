import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En desarrollo, /api y /uploads se envían al backend (por defecto localhost:8000)
const backend = process.env.VITE_BACKEND_URL ?? 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router', '@tanstack/react-query'],
          mantine: ['@mantine/core', '@mantine/hooks', '@mantine/notifications', '@mantine/modals', '@mantine/dropzone'],
          icons: ['@tabler/icons-react'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': backend,
      '/uploads': backend,
    },
  },
});
