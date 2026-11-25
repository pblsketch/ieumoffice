import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'

/** How long a press must last to count as a long press. */
export const LONG_PRESS_MS = 500
/** A finger that moves further than this (CSS px) is scrolling, not pressing. */
const MOVE_TOLERANCE = 10

export interface LongPressHandlers {
  readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void
  readonly onPointerMove: (event: PointerEvent<HTMLElement>) => void
  readonly onPointerUp: () => void
  readonly onPointerCancel: () => void
  readonly onPointerLeave: () => void
  readonly onContextMenu: (event: MouseEvent<HTMLElement>) => void
}

export interface LongPress {
  readonly handlers: LongPressHandlers
  /** True once for the click that ends a long press, so that click does not also open the row. */
  consumeClick(): boolean
}

/**
 * Long press on a row: a held pointer (or the web view's context-menu gesture) calls
 * `onLongPress` once. Moving the finger cancels it.
 */
export function useLongPress(onLongPress: () => void, enabled: boolean): LongPress {
  const callbackRef = useRef(onLongPress)
  callbackRef.current = onLongPress
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const firedRef = useRef(false)

  const stopTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    startRef.current = null
  }

  useEffect(() => stopTimer, [])

  const fire = () => {
    stopTimer()
    if (firedRef.current) return
    firedRef.current = true
    callbackRef.current()
  }

  const handlers: LongPressHandlers = {
    onPointerDown: (event) => {
      firedRef.current = false
      if (!enabled) return
      stopTimer()
      startRef.current = { x: event.clientX, y: event.clientY }
      timerRef.current = setTimeout(fire, LONG_PRESS_MS)
    },
    onPointerMove: (event) => {
      const start = startRef.current
      if (!start) return
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE) {
        stopTimer()
      }
    },
    onPointerUp: stopTimer,
    onPointerCancel: stopTimer,
    onPointerLeave: stopTimer,
    onContextMenu: (event) => {
      if (!enabled) return
      event.preventDefault()
      fire()
    },
  }

  return {
    handlers,
    consumeClick: () => {
      if (!firedRef.current) return false
      firedRef.current = false
      return true
    },
  }
}
