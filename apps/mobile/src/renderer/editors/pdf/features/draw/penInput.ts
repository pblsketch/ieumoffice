// Pen and finger on the drawing layer (spec 3.5). Before any pen has touched the
// screen, a finger draws. Once a pointer of type "pen" has been used, the pen draws
// and a finger moves the view (one finger scrolls, two fingers zoom) — unless the
// "draw with finger too" switch is on. Both facts stay on this device only.
// While a pen is down, finger contacts (a resting palm) never draw.

/** localStorage key of the remembered pen state (device only, never in a document). */
export const PEN_PREFS_KEY = 'ieum-mobile-pdf-pen-input'

export interface PenPrefs {
  /** A pen has been used on this device. */
  readonly penSeen: boolean
  /** The "draw with finger too" switch. */
  readonly fingerDraws: boolean
}

export const DEFAULT_PEN_PREFS: PenPrefs = { penSeen: false, fingerDraws: false }

type PrefsStorage = Pick<Storage, 'getItem' | 'setItem'>

function deviceStorage(): PrefsStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

/** The remembered state; anything unreadable counts as never set. */
export function loadPenPrefs(storage: PrefsStorage | null = deviceStorage()): PenPrefs {
  try {
    const raw = storage?.getItem(PEN_PREFS_KEY)
    if (!raw) return DEFAULT_PEN_PREFS
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return DEFAULT_PEN_PREFS
    const record = value as Record<string, unknown>
    return { penSeen: record.penSeen === true, fingerDraws: record.fingerDraws === true }
  } catch {
    return DEFAULT_PEN_PREFS
  }
}

export function savePenPrefs(prefs: PenPrefs, storage: PrefsStorage | null = deviceStorage()) {
  try {
    storage?.setItem(
      PEN_PREFS_KEY,
      JSON.stringify({ penSeen: prefs.penSeen, fingerDraws: prefs.fingerDraws }),
    )
  } catch {
    // not remembered: the next start asks the pen again
  }
}

/** Whether a finger draws under these prefs (otherwise it moves the view). */
export const fingerDrawsWith = (prefs: PenPrefs): boolean => !prefs.penSeen || prefs.fingerDraws

/**
 * - `draw`: this pointer draws (capture it, no scrolling).
 * - `pass`: not ours; the view scrolls or zooms with it.
 * - `block`: swallowed without drawing or scrolling (a palm while the pen is down).
 */
export type PointerRoute = 'draw' | 'pass' | 'block'

export interface PointerDecision {
  readonly route: PointerRoute
  /** The stroke in progress must be dropped (a pen came down over a palm, or a second finger). */
  readonly abortLive: boolean
}

export interface PenInputRouter {
  /** A pointer went down on the drawing layer. */
  down(pointerId: number, pointerType: string): PointerDecision
  /** A pointer went up or was cancelled anywhere (idempotent). */
  up(pointerId: number): void
  /** A pen touches the screen right now. */
  penDown(): boolean
  prefs(): PenPrefs
  setFingerDraws(on: boolean): void
}

export interface PenInputRouterOptions {
  readonly initial?: PenPrefs
  /** Called with the new prefs whenever they change (remember them, re-render). */
  readonly onChange?: (prefs: PenPrefs) => void
}

/** The pen/finger state machine. One per editor, shared by every page layer. */
export function createPenInputRouter(options: PenInputRouterOptions = {}): PenInputRouter {
  let prefs = options.initial ?? DEFAULT_PEN_PREFS
  const pens = new Set<number>()
  const touches = new Set<number>()
  /** The pointer that is drawing now, if any. */
  let drawing: { id: number; type: string } | null = null

  const update = (next: PenPrefs) => {
    if (next.penSeen === prefs.penSeen && next.fingerDraws === prefs.fingerDraws) return
    prefs = next
    options.onChange?.(prefs)
  }
  const decide = (route: PointerRoute, abortLive = false): PointerDecision => ({
    route,
    abortLive,
  })

  return {
    down(pointerId, pointerType) {
      if (pointerType === 'pen') {
        pens.add(pointerId)
        update({ ...prefs, penSeen: true })
        if (drawing && drawing.type !== 'touch') return decide('block')
        // a palm that landed first was drawing: the pen wins
        const abortLive = drawing !== null
        drawing = { id: pointerId, type: pointerType }
        return decide('draw', abortLive)
      }
      if (pointerType === 'touch') {
        touches.add(pointerId)
        if (pens.size > 0) return decide('block')
        if (!fingerDrawsWith(prefs)) return decide('pass')
        if (drawing || touches.size > 1) {
          // a second finger: this is a zoom, not a stroke
          const abortLive = drawing !== null
          drawing = null
          return decide('pass', abortLive)
        }
        drawing = { id: pointerId, type: pointerType }
        return decide('draw')
      }
      // mouse (and anything else precise): draws like a pen without changing the prefs
      if (drawing) return decide('block')
      drawing = { id: pointerId, type: pointerType }
      return decide('draw')
    },
    up(pointerId) {
      pens.delete(pointerId)
      touches.delete(pointerId)
      if (drawing?.id === pointerId) drawing = null
    },
    penDown: () => pens.size > 0,
    prefs: () => prefs,
    setFingerDraws(on) {
      update({ ...prefs, fingerDraws: on })
    },
  }
}
