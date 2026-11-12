import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Tokens y componentes compartidos con el sistema web (una sola fuente de verdad).
import '@web/index.css'
import '@web/styles/components.css'
// Tipografía empaquetada: la estación se ve igual sin internet.
import '@fontsource-variable/geist'
import './estilos/escritorio.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
