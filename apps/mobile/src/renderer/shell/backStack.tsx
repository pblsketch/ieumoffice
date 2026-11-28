import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'

/**
 * One back stack for the whole app (design system 5.11).
 *
 * Every layer that "Back" should close (a sheet, edit mode, the editor screen,
 * settings) holds one browser history entry. Android's system Back makes the
 * web view go back one entry, which fires `popstate`; the top layer then runs
 * its `onBack`. On iOS there is no system Back, and the on-screen [‹] buttons
 * call the same handlers directly.
 *
 * A layer stays armed until its owner deactivates it, so an `onBack` that asks
 * first (for example "save changes?") and is cancelled keeps the layer.
 *
 * `history.back()` is answered later, by a `popstate`, while `pushState` takes
 * effect at once. A layer opened while such a back is still on its way would
 * have its new entry popped instead (closing one sheet and opening another in
 * the same tap, or a screen remounting), and the stack and the history would
 * drift apart until Back leaves the app. So a layer opened while backs are
 * pending gets its entry only after the last of them has arrived.
 */
export interface BackStack {
  push(onBack: () => void): number
  remove(id: number): void
  depth(): number
}

interface Layer {
  readonly id: number
  readonly onBack: () => void
}

const HISTORY_KEY = 'ieumBackLayer'

export function createBackStack(win: Window): BackStack {
  const layers: Layer[] = []
  let seq = 0
  // history.back() calls made by remove() whose popstate has not arrived yet
  let ignorePops = 0
  // layers opened while those backs were pending; they get their entries afterwards
  let unarmed: number[] = []

  const arm = (id: number) => {
    win.history.pushState({ [HISTORY_KEY]: id }, '')
  }

  win.addEventListener('popstate', () => {
    if (ignorePops > 0) {
      ignorePops -= 1
      if (ignorePops === 0 && unarmed.length > 0) {
        const waiting = unarmed
        unarmed = []
        for (const id of waiting) arm(id)
      }
      return
    }
    const top = layers[layers.length - 1]
    if (!top) return
    // The pop consumed this layer's entry; re-arm it so the layer keeps its
    // entry until the owner really closes it (remove() then pops it).
    arm(top.id)
    top.onBack()
  })

  return {
    push(onBack) {
      seq += 1
      const id = seq
      layers.push({ id, onBack })
      if (ignorePops > 0) unarmed.push(id)
      else arm(id)
      return id
    },
    remove(id) {
      const index = layers.findIndex((layer) => layer.id === id)
      if (index < 0) return
      layers.splice(index, 1)
      // A layer that never got its entry has nothing to pop.
      const waiting = unarmed.indexOf(id)
      if (waiting >= 0) {
        unarmed.splice(waiting, 1)
        return
      }
      // Entries are interchangeable; dropping any one keeps the count aligned.
      ignorePops += 1
      win.history.back()
    },
    depth() {
      return layers.length
    },
  }
}

const noopStack: BackStack = {
  push: () => 0,
  remove: () => {},
  depth: () => 0,
}

const BackStackContext = createContext<BackStack>(noopStack)

/** The mounted BackStackProvider's stack, shared with detached `createRoot` overlays (e.g. password sheets). */
let activeBackStack: BackStack = noopStack

export function BackStackProvider({ children }: { readonly children: ReactNode }) {
  const stackRef = useRef<BackStack | null>(null)
  if (stackRef.current === null) {
    stackRef.current = typeof window === 'undefined' ? noopStack : createBackStack(window)
  }
  const stack = stackRef.current
  // Register synchronously so detached roots mounted immediately after render share this stack.
  activeBackStack = stack
  useEffect(() => {
    activeBackStack = stack
    return () => {
      if (activeBackStack === stack) activeBackStack = noopStack
    }
  }, [stack])
  return <BackStackContext.Provider value={stack}>{children}</BackStackContext.Provider>
}

/** Provides the app's active back stack to a detached `createRoot` overlay. */
export function ActiveBackStackPortal({ children }: { readonly children: ReactNode }) {
  const stackRef = useRef<BackStack>(activeBackStack)
  return <BackStackContext.Provider value={stackRef.current}>{children}</BackStackContext.Provider>
}

/** While `active`, Back (system or [‹]) runs `onBack`; layers opened later close first. */
export function useBackLayer(active: boolean, onBack: () => void): void {
  const stack = useContext(BackStackContext)
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  useEffect(() => {
    if (!active) return
    const id = stack.push(() => onBackRef.current())
    return () => stack.remove(id)
  }, [active, stack])
}
