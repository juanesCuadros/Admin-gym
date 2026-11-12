import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

const raizWeb = fileURLToPath(new URL('../gym-jefe-web/src', import.meta.url))

/**
 * Los estilos base se comparten con gym-jefe-web (una sola fuente de verdad).
 * Allá la tipografía se baja de Google Fonts; la estación debe verse igual sin
 * internet, así que aquí se quita esa descarga y la fuente va empaquetada
 * (@fontsource-variable/geist, ver src/estilos/escritorio.css).
 */
function sinFuentesRemotas(): Plugin {
  return {
    name: 'gymdesk-sin-fuentes-remotas',
    enforce: 'pre',
    transform(codigo, id) {
      if (!id.replace(/\\/g, '/').includes('/gym-jefe-web/src/') || !id.split('?')[0].endsWith('.css')) return null
      return { code: codigo.replace(/@import\s+url\(['"]https?:\/\/[^)]*\)\s*;?/g, ''), map: null }
    },
  }
}

export default defineConfig({
  plugins: [sinFuentesRemotas(), react()],
  resolve: {
    alias: { '@web': raizWeb },
    // Los componentes de la web usan las dependencias de este proyecto, no las suyas.
    dedupe: ['react', 'react-dom', 'lucide-react'],
  },
  // Tauri espera un puerto fijo y no debe taparse su salida.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'chrome105',
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
