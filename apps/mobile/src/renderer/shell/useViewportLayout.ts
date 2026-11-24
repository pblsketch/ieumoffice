import { useEffect, useState } from 'react'

/**
 * Window size classes of the mobile design system, judged by the web view's
 * own width (not the device model), so split screen and foldables switch at once.
 * compact < 600 <= medium < 840 <= expanded < 1200 <= large
 */
export type MobileWindowClass = 'compact' | 'medium' | 'expanded' | 'large'

export const MOBILE_WINDOW_MEDIUM_PX = 600
export const MOBILE_WINDOW_EXPANDED_PX = 840
export const MOBILE_WINDOW_LARGE_PX = 1200

/** From this width the editor docks side panels (expanded and up). */
export const MOBILE_TABLET_BREAKPOINT_PX = MOBILE_WINDOW_EXPANDED_PX

export interface ViewportLayoutState {
  readonly width: number
  readonly windowClass: MobileWindowClass
  readonly isTablet: boolean
  readonly keyboardInsetPx: number
}

export function windowClassForWidth(width: number): MobileWindowClass {
  if (width >= MOBILE_WINDOW_LARGE_PX) return 'large'
  if (width >= MOBILE_WINDOW_EXPANDED_PX) return 'expanded'
  if (width >= MOBILE_WINDOW_MEDIUM_PX) return 'medium'
  return 'compact'
}

function readViewportState(breakpointPx: number): ViewportLayoutState {
  if (typeof window === 'undefined') {
    return { width: 390, windowClass: 'compact', isTablet: false, keyboardInsetPx: 0 }
  }
  const width = window.innerWidth
  const vv = window.visualViewport
  const keyboardInsetPx = vv
    ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
    : 0
  return {
    width,
    windowClass: windowClassForWidth(width),
    isTablet: width >= breakpointPx,
    keyboardInsetPx,
  }
}

/** Publishes the layout to CSS: `data-window` on <html> and `--m-kb` (keyboard height). */
function publishToRoot(state: ViewportLayoutState): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (root.dataset.window !== state.windowClass) root.dataset.window = state.windowClass
  root.style.setProperty('--m-kb', `${state.keyboardInsetPx}px`)
}

export function useViewportLayout(breakpointPx = MOBILE_TABLET_BREAKPOINT_PX): ViewportLayoutState {
  const [state, setState] = useState<ViewportLayoutState>(() => readViewportState(breakpointPx))

  useEffect(() => {
    if (typeof window === 'undefined') return
    const update = () => {
      const next = readViewportState(breakpointPx)
      publishToRoot(next)
      setState(next)
    }
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
