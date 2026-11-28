import { useEffect, useState } from 'react'

export const MOBILE_TABLET_BREAKPOINT_PX = 768

export interface ViewportLayoutState {
  readonly width: number
  readonly isTablet: boolean
  readonly keyboardInsetPx: number
}

function readViewportState(breakpointPx: number): ViewportLayoutState {
  if (typeof window === 'undefined') {
    return { width: 390, isTablet: false, keyboardInsetPx: 0 }
  }
  const width = window.innerWidth
  const vv = window.visualViewport
  const keyboardInsetPx = vv
    ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
    : 0
  return {
    width,
    isTablet: width >= breakpointPx,
    keyboardInsetPx,
  }
}

export function useViewportLayout(breakpointPx = MOBILE_TABLET_BREAKPOINT_PX): ViewportLayoutState {
  const [state, setState] = useState<ViewportLayoutState>(() => readViewportState(breakpointPx))

  useEffect(() => {
    if (typeof window === 'undefined') return
    const update = () => setState(readViewportState(breakpointPx))
    window.addEventListener('resize', update)
    const vv = window.visualViewport
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    update()
    return () => {
      window.removeEventListener('resize', update)
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
    }
  }, [breakpointPx])

  return state
}
