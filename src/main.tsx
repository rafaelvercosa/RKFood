import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// Fontes embutidas no app (funcionam sem internet, no modo offline).
import '@fontsource/atkinson-hyperlegible/400'
import '@fontsource/atkinson-hyperlegible/700'
import '@fontsource/big-shoulders-display/800'
import './index.css'
import { installClickSound } from './lib/clickSound'
import { applyTheme } from './lib/theme'

applyTheme()
installClickSound()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// PWA: permite "instalar" na tela inicial do celular/tablet.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
