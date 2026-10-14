import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 3002,
    host: true,
    proxy: {
      // En desarrollo, super-admin-api corre en el puerto 8002 (infra/docker-compose.dev.yml)
      '/api/v1': {
        target: 'http://localhost:8002',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
