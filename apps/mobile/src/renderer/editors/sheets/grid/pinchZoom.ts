import type { UniverRuntime } from '../../../../../../sheets/src/renderer/univer-state'

/** Univer's own zoom bounds (SetZoomRatioCommand accepts 0.1 to 4). */
const MIN_ZOOM = 0.1
const MAX_ZOOM = 4

/** The zoom a pinch asks for: the start zoom scaled by how far the fingers spread. */
export function pinchZoomRatio(startZoom: number, startDistance: number, distance: number): number {
  if (startDistance <= 0) return startZoom
  const next = startZoom * (distance / startDistance)
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 100) / 100))
}

function touchDistance(touches: TouchList): number {
  const a = touches[0]
  const b = touches[1]
  if (!a || !b) return 0
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

/**
 * Two-finger zoom over the grid. Univer's mobile plugins scroll with one
 * finger but have no pinch, so this layer catches two-finger touches before
 * Univer (capture phase) and sets the sheet zoom, one update per frame.
 */
export function installPinchZoom(element: HTMLElement, runtime: UniverRuntime): () => void {
  let pinch: { startZoom: number; startDistance: number } | null = null
  let pending: number | null = null
  let frame = 0

  const activeSheet = () => runtime.univerAPI.getActiveWorkbook()?.getActiveSheet() ?? null

  let cancelling = false
  const onStart = (event: TouchEvent) => {
    if (cancelling || event.touches.length !== 2) return
    const sheet = activeSheet()
    if (!sheet) return
    pinch = { startZoom: sheet.getZoom(), startDistance: touchDistance(event.touches) }
    event.stopPropagation()
    // Univer saw the first finger alone: end its gesture (its long-press timer
    // would otherwise open the cell menu mid-pinch, since the moves stop here).
    cancelling = true
    try {
      event.target?.dispatchEvent(
        new TouchEvent('touchcancel', {
          bubbles: true,
          cancelable: true,
          touches: [],
          targetTouches: [],
          changedTouches: [...event.touches],
        }),
      )
    } finally {
      cancelling = false
    }
  }
  const onMove = (event: TouchEvent) => {
    if (!pinch) return
    event.preventDefault()
    event.stopPropagation()
    if (event.touches.length !== 2) return
    pending = pinchZoomRatio(pinch.startZoom, pinch.startDistance, touchDistance(event.touches))
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      const sheet = activeSheet()
      if (sheet && pending !== null && pending !== sheet.getZoom()) sheet.zoom(pending)
    })
  }
  const onEnd = (event: TouchEvent) => {
    if (cancelling) return
    if (pinch) {
      // The pinch's own end must not reach Univer as a tap.
      event.stopPropagation()
      if (event.touches.length === 0) pinch = null
    }
  }

  element.addEventListener('touchstart', onStart, { capture: true, passive: true })
  element.addEventListener('touchmove', onMove, { capture: true, passive: false })
  element.addEventListener('touchend', onEnd, { capture: true })
  element.addEventListener('touchcancel', onEnd, { capture: true })
  return () => {
    if (frame) cancelAnimationFrame(frame)
    element.removeEventListener('touchstart', onStart, { capture: true })
    element.removeEventListener('touchmove', onMove, { capture: true })
    element.removeEventListener('touchend', onEnd, { capture: true })
    element.removeEventListener('touchcancel', onEnd, { capture: true })
  }
}
