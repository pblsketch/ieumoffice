/**
 * Document-scoped two-finger pinch-zoom helper shared by mobile editors whose
 * viewports do not already run their own pinch recognizer (HWP reading/page
 * views, EPUB, Markdown, HTML). Only the document surface zooms; app chrome
 * (top bar, toolbars, sheets) stays at 1x.
 */

export interface PinchZoomOptions {
  /** Reads the document's current zoom factor when two fingers touch down. */
  readonly getScale: () => number
  readonly min: number
  readonly max: number
  /** Rounding precision (decimal places, default 2). */
  readonly decimals?: number
  /** Called while fingers move (at most once per animation frame). */
  readonly onPreview?: (scale: number, ratio: number) => void
  /** Called once when the pinch ends if the scale changed. */
  readonly onCommit: (scale: number) => void
}

/** Clamped zoom factor for a two-finger spread from `startDistance` to `distance`. */
export function computePinchScale(
  startScale: number,
  startDistance: number,
  distance: number,
  min: number,
  max: number,
  decimals = 2,
): number {
  if (!Number.isFinite(startScale) || !Number.isFinite(startDistance) || startDistance <= 0) {
    return Math.min(max, Math.max(min, Number.isFinite(startScale) ? startScale : min))
  }
  const raw = startScale * (distance / startDistance)
  const clamped = Math.min(max, Math.max(min, raw))
  const factor = 10 ** decimals
  return Math.round(clamped * factor) / factor
}

function touchDistance(touches: TouchList): number {
  const a = touches[0]
  const b = touches[1]
  if (!a || !b) return 0
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

/**
 * Attaches two-finger pinch-zoom listeners to a document container or iframe
 * `Document`. Returns a cleanup function that detaches all listeners.
 */
export function attachPinchZoom(
  target: Document | HTMLElement,
  options: PinchZoomOptions,
): () => void {
  const decimals = options.decimals ?? 2
  let pinch: { startScale: number; startDistance: number; currentScale: number } | null = null
  let rafId = 0

  const flushPreview = () => {
    rafId = 0
    if (!pinch) return
    const ratio = pinch.startScale > 0 ? pinch.currentScale / pinch.startScale : 1
    options.onPreview?.(pinch.currentScale, ratio)
  }

  const onStart = (event: Event) => {
    const touchEvent = event as TouchEvent
    if (!touchEvent.touches || touchEvent.touches.length !== 2) return
    const dist = touchDistance(touchEvent.touches)
    if (dist <= 0) return
    const startScale = options.getScale()
    pinch = { startScale, startDistance: dist, currentScale: startScale }
  }

  const onMove = (event: Event) => {
    if (!pinch) return
    const touchEvent = event as TouchEvent
    if (!touchEvent.touches || touchEvent.touches.length !== 2) return
    touchEvent.preventDefault()
    const next = computePinchScale(
      pinch.startScale,
      pinch.startDistance,
      touchDistance(touchEvent.touches),
      options.min,
      options.max,
      decimals,
    )
    if (next === pinch.currentScale) return
    pinch.currentScale = next
    if (typeof requestAnimationFrame === 'function') {
      if (!rafId) rafId = requestAnimationFrame(flushPreview)
    } else {
      flushPreview()
    }
  }

  const onEnd = (event: Event) => {
    if (!pinch) return
    const touchEvent = event as TouchEvent
    if (touchEvent.touches && touchEvent.touches.length >= 2) return
    const finished = pinch
    pinch = null
    if (rafId && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
    if (finished.currentScale !== finished.startScale) {
      options.onCommit(finished.currentScale)
    } else {
      options.onPreview?.(finished.startScale, 1)
    }
  }

  const onGesture = (event: Event) => {
    event.preventDefault()
  }

  target.addEventListener('touchstart', onStart, { passive: true })
  target.addEventListener('touchmove', onMove, { passive: false })
  target.addEventListener('touchend', onEnd)
  target.addEventListener('touchcancel', onEnd)
  target.addEventListener('gesturestart', onGesture, { passive: false })
  target.addEventListener('gesturechange', onGesture, { passive: false })

  return () => {
    if (rafId && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
    pinch = null
    target.removeEventListener('touchstart', onStart)
    target.removeEventListener('touchmove', onMove)
    target.removeEventListener('touchend', onEnd)
    target.removeEventListener('touchcancel', onEnd)
    target.removeEventListener('gesturestart', onGesture)
    target.removeEventListener('gesturechange', onGesture)
  }
}
