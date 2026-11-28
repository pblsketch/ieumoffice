import { useEffect, useRef, useState, type PointerEvent } from 'react'

/** Sideways travel (px) that turns the slide. */
const SWIPE_PX = 48
/** Movement (px) below which a touch is a tap. */
const TAP_SLOP_PX = 10
const MAX_ZOOM = 4
/** Zoom at or under this counts as back at 1×. */
const ZOOM_SNAP = 1.02

export interface SlideView {
  readonly zoom: number
  readonly x: number
  readonly y: number
}

const UNZOOMED: SlideView = { zoom: 1, x: 0, y: 0 }

export interface SlideGestureOptions {
  /** Two-finger zoom and, while zoomed, dragging to pan (the reading view; not the show) */
  readonly zoomable: boolean
  /**
   * Where a tap turns: 'edges' (left quarter back, right quarter on) or 'anywhere' (left
   * third back, the rest on — the show)
   */
  readonly tapZones: 'edges' | 'anywhere'
  readonly onNext: () => void
  readonly onPrev: () => void
  /** Size of the slide on screen, to keep a pan inside it */
  readonly slideWidth: number
  readonly slideHeight: number
  /** A change (the slide index) goes back to 1× */
  readonly resetKey: unknown
}

export interface SlideGestures {
  readonly view: SlideView
  readonly handlers: {
    onPointerDown(e: PointerEvent<HTMLElement>): void
    onPointerMove(e: PointerEvent<HTMLElement>): void
    onPointerUp(e: PointerEvent<HTMLElement>): void
    onPointerCancel(e: PointerEvent<HTMLElement>): void
  }
}

interface Point {
  readonly x: number
  readonly y: number
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Swipe and tap to turn slides; pinch to zoom, and while zoomed a one-finger drag pans
 * instead of turning. Back at 1× swipes turn again.
 */
export function useSlideGestures(options: SlideGestureOptions): SlideGestures {
  const [view, setView] = useState<SlideView>(UNZOOMED)
  const viewRef = useRef(view)
  viewRef.current = view
  const optionsRef = useRef(options)
  optionsRef.current = options

  const pointers = useRef(new Map<number, Point>())
  // the gesture since the first finger went down
  const gesture = useRef<{ start: Point; moved: boolean; multi: boolean } | null>(null)
  const pinch = useRef<{ dist: number; zoom: number } | null>(null)
  const pan = useRef<{ from: Point; x: number; y: number } | null>(null)

  useEffect(() => {
    setView(UNZOOMED)
  }, [options.resetKey])

  const clampPan = (zoom: number, x: number, y: number): SlideView => {
    const { slideWidth, slideHeight } = optionsRef.current
    const maxX = ((zoom - 1) * slideWidth) / 2
    const maxY = ((zoom - 1) * slideHeight) / 2
    return {
      zoom,
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    }
  }

  const point = (e: PointerEvent<HTMLElement>): Point => ({ x: e.clientX, y: e.clientY })

  const startPan = (from: Point) => {
    pan.current = { from, x: viewRef.current.x, y: viewRef.current.y }
  }

  const end = (e: PointerEvent<HTMLElement>, cancelled: boolean) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.delete(e.pointerId)
    const left = [...pointers.current.values()]
    if (left.length === 1) {
      // a pinch ended with one finger still down: that finger pans from here
      pinch.current = null
      startPan(left[0]!)
      return
    }
    if (left.length > 0) return
    const g = gesture.current
    gesture.current = null
    pinch.current = null
    pan.current = null
    if (!g || cancelled || g.multi || viewRef.current.zoom > ZOOM_SNAP) return
    const { onNext, onPrev, tapZones } = optionsRef.current
    const dx = e.clientX - g.start.x
    const dy = e.clientY - g.start.y
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) onNext()
      else onPrev()
      return
    }
    if (g.moved) return
    const rect = e.currentTarget.getBoundingClientRect()
    const rel = rect.width > 0 ? (g.start.x - rect.left) / rect.width : 0.5
    if (tapZones === 'anywhere') {
      if (rel < 1 / 3) onPrev()
      else onNext()
    } else if (rel < 0.25) onPrev()
    else if (rel > 0.75) onNext()
  }

  return {
    view,
    handlers: {
      onPointerDown(e) {
        const p = point(e)
        pointers.current.set(e.pointerId, p)
        e.currentTarget.setPointerCapture?.(e.pointerId)
        if (pointers.current.size === 1) {
          gesture.current = { start: p, moved: false, multi: false }
          startPan(p)
          return
        }
        if (gesture.current) gesture.current.multi = true
        if (pointers.current.size === 2 && optionsRef.current.zoomable) {
          const [a, b] = [...pointers.current.values()]
          pinch.current = { dist: Math.max(1, distance(a!, b!)), zoom: viewRef.current.zoom }
          pan.current = null
        }
      },
      onPointerMove(e) {
        if (!pointers.current.has(e.pointerId)) return
        const p = point(e)
        pointers.current.set(e.pointerId, p)
        const g = gesture.current
        if (g && distance(p, g.start) > TAP_SLOP_PX) g.moved = true
        if (pinch.current && pointers.current.size >= 2) {
          const [a, b] = [...pointers.current.values()]
          const zoom = Math.min(
            MAX_ZOOM,
            Math.max(1, (pinch.current.zoom * distance(a!, b!)) / pinch.current.dist),
          )
          setView((prev) => (zoom <= ZOOM_SNAP ? UNZOOMED : clampPan(zoom, prev.x, prev.y)))
          return
        }
        const from = pan.current
        if (pointers.current.size === 1 && from && viewRef.current.zoom > ZOOM_SNAP) {
          setView(
            clampPan(viewRef.current.zoom, from.x + p.x - from.from.x, from.y + p.y - from.from.y),
          )
        }
      },
      onPointerUp: (e) => end(e, false),
      onPointerCancel: (e) => end(e, true),
    },
  }
}
