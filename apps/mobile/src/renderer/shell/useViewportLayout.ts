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

/**
 * Keeps the root document pinned to (0, 0) so iOS WKWebView keyboard avoidance
 * cannot scroll the top app bar into the status bar or Dynamic Island.
 */
function resetRootViewportScroll(): void {
  if (typeof window === 'undefined') return
  const vv = window.visualViewport
  const drifted =
    window.scrollY !== 0 ||
    window.scrollX !== 0 ||
    (vv !== null && vv !== undefined && (vv.offsetTop !== 0 || vv.offsetLeft !== 0))
  if (drifted && typeof window.scrollTo === 'function') {
    window.scrollTo(0, 0)
  }
}

export function useViewportLayout(breakpointPx = MOBILE_TABLET_BREAKPOINT_PX): ViewportLayoutState {
  const [state, setState] = useState<ViewportLayoutState>(() => readViewportState(breakpointPx))

  useEffect(() => {
    if (typeof window === 'undefined') return
    let rafId: number | null = null
    const update = () => {
      resetRootViewportScroll()
      const next = readViewportState(breakpointPx)
      publishToRoot(next)
      setState(next)
    }
    const scheduleUpdate = () => {
      update()
      if (typeof window.requestAnimationFrame === 'function') {
        if (rafId !== null) window.cancelAnimationFrame(rafId)
        rafId = window.requestAnimationFrame(() => {
          rafId = null
          update()
        })
      }
    }
    window.addEventListener('resize', scheduleUpdate)
    window.addEventListener('scroll', update)
    document.addEventListener('focusin', scheduleUpdate)
    const vv = window.visualViewport
    vv?.addEventListener('resize', scheduleUpdate)
    vv?.addEventListener('scroll', scheduleUpdate)
    update()
    return () => {
      if (rafId !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(rafId)
      }
      window.removeEventListener('resize', scheduleUpdate)
      window.removeEventListener('scroll', update)
      document.removeEventListener('focusin', scheduleUpdate)
      vv?.removeEventListener('resize', scheduleUpdate)
      vv?.removeEventListener('scroll', scheduleUpdate)
    }
  }, [breakpointPx])

  return state
}
