import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/mobile-tokens.css'
import { MobileApp } from './App'

const rootEl = document.getElementById('root')
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <MobileApp />
    </StrictMode>,
  )
}
