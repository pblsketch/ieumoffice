/**
 * Tap, double tap and long press judged by movement and time (spec 2.8-1).
 *
 * Univer counts a double click from two pointer-downs close in time and only
 * compares the two *start* points, so two quick swipes that begin near the
 * same spot read as a double tap and open the cell editor (prototype:
 * device-large-fast-swipes-opened-cell-editor.png). This judge keeps the
 * whole first gesture: only a short, still press followed soon by a second
 * press near it is a double tap.
 */

/** A press that moves farther than this (CSS px) is a swipe, not a tap. */
export const TAP_SLOP_PX = 10
/** A press held longer than this is not a tap (Univer's long-press menu starts at 500 ms). */
export const TAP_MAX_MS = 350
/** The second press must start within this long after the first one lifted. */
export const DOUBLE_TAP_GAP_MS = 300
/** And this close (CSS px) to where the first one started. */
export const DOUBLE_TAP_DISTANCE_PX = 24
/** A still press this long on a row or column header opens the line menu. */
export const LONG_PRESS_MS = 500

/** One finger gesture from press to lift. */
export interface PressRecord {
  readonly x: number
  readonly y: number
  readonly downAt: number
  /** Largest distance from the start point seen so far. */
  readonly travel: number
  /** `null` while the finger is still down. */
  readonly upAt: number | null
}

/** True when a finished press was a tap (short and still). */
export function isTap(press: PressRecord): boolean {
  if (press.upAt === null) return false
  return press.travel <= TAP_SLOP_PX && press.upAt - press.downAt <= TAP_MAX_MS
}

/**
 * True when a press starting at (x, y) at `downAt` completes a double tap
 * with the press before it.
 */
export function isDoubleTap(
  previous: PressRecord | null,
  next: { readonly x: number; readonly y: number; readonly downAt: number },
): boolean {
  if (!previous || previous.upAt === null || !isTap(previous)) return false
  const gap = next.downAt - previous.upAt
  if (gap < 0 || gap > DOUBLE_TAP_GAP_MS) return false
  return Math.hypot(next.x - previous.x, next.y - previous.y) <= DOUBLE_TAP_DISTANCE_PX
}

/**
 * Follows the primary finger: `down`, `move` and `up` update the current
 * press; `lastDoubleTap` says whether the latest press started as the second
 * half of a double tap (Univer asks for the cell editor at that press-down).
 */
export class PressTracker {
  private previous: PressRecord | null = null
  private current: PressRecord | null = null
  private doubleTap = false

  down(x: number, y: number, at: number): void {
    // A press that never lifted (cancelled) does not count as a tap.
    const before = this.current && this.current.upAt !== null ? this.current : null
    this.previous = before
    this.doubleTap = isDoubleTap(before, { x, y, downAt: at })
    this.current = { x, y, downAt: at, travel: 0, upAt: null }
  }

  move(x: number, y: number): void {
    const press = this.current
    if (!press || press.upAt !== null) return
    const travel = Math.max(press.travel, Math.hypot(x - press.x, y - press.y))
    if (travel !== press.travel) this.current = { ...press, travel }
  }

  up(at: number): void {
    const press = this.current
    if (!press || press.upAt !== null) return
    this.current = { ...press, upAt: at }
  }

  /** The finger left without a lift (system gesture, second finger): no tap. */
  cancel(): void {
    this.current = null
    this.previous = null
    this.doubleTap = false
  }

  /** Whether the press now down (or just lifted) began as a double tap. */
  get lastDoubleTap(): boolean {
    return this.doubleTap
  }

  /** The press now down or just lifted. */
  get press(): PressRecord | null {
    return this.current
  }
}

/** Whether a still finger has been down long enough for the long-press menu. */
export function isLongPress(press: PressRecord, now: number): boolean {
  return press.upAt === null && press.travel <= TAP_SLOP_PX && now - press.downAt >= LONG_PRESS_MS
}
