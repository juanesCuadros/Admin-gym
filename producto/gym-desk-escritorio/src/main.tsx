import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getCurrentWindow } from '@tauri-apps/api/window'
// Tokens y componentes compartidos con el sistema web (una sola fuente de verdad).
import '@web/index.css'
import '@web/styles/components.css'
// Tipografía empaquetada: la estación se ve igual sin internet.
import '@fontsource-variable/geist'
import './estilos/escritorio.css'
import './estilos/pantalla-tv.css'
import App from './App'
import { PantallaBienvenida } from './pages/PantallaBienvenida'

// La segunda ventana (TV de recepción) solo muestra la bienvenida; no abre sesión ni sincroniza.
let esPantallaTv = false
try {
  esPantallaTv = getCurrentWindow().label === 'bienvenida'
} catch {
  esPantallaTv = false
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {esPantallaTv ? <PantallaBienvenida /> : <App />}
  </StrictMode>,
)
