import React from 'react'
import { createRoot } from 'react-dom/client'
import '@genoffice/ui/tokens.css'
import { QuickSwitcher } from './QuickSwitcher'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QuickSwitcher />
  </React.StrictMode>,
)
