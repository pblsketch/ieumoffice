import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/mobile-tokens.css'
import { MobileApp } from './App'

// Prevent WebKit (iOS WKWebView) from pinch-zooming the whole page chrome;
// document areas handle two-finger zoom inside their own viewports.
const blockPageGesture = (event: Event) => {
  event.preventDefault()
}
document.addEventListener('gesturestart', blockPageGesture, { passive: false })
document.addEventListener('gesturechange', blockPageGesture, { passive: false })

const rootEl = document.getElementById('root')
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <MobileApp />
    </StrictMode>,
  )
}
