import { useEffect, useState } from 'react'
import type { DriveApi, DriveUiState } from '../../shared/drive-api'

declare global {
  interface Window {
    /** Google Drive (decision 0033; src/preload/index.ts) */
    aiOfficeDrive?: DriveApi
  }
}

/** The live Drive state from the main process; null until it answers */
export function useDriveState(): DriveUiState | null {
  const [state, setState] = useState<DriveUiState | null>(null)
  useEffect(() => {
    const api = window.aiOfficeDrive
    if (!api) {
      setState({ state: 'unavailable' })
      return
    }
    let live = true
    void api.state().then(
      (s) => live && setState(s),
      () => live && setState({ state: 'unavailable' }),
    )
    const off = api.onStateChanged((s) => setState(s))
    return () => {
      live = false
      off()
    }
  }, [])
  return state
}

export function DriveNavIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5.6 2h4.8l3.9 6.7-2.4 4.3H4.1L1.7 8.7z M5.6 2l3.9 6.7h4.8 M10.4 2 4.1 13"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}
