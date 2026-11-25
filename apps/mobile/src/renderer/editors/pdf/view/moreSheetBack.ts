// Keeps the app's back stack and the browser history in step when a [⋯] More-sheet
// row opens a sheet of the PDF editor.
//
// The shell's back stack (shell/backStack.tsx) steps history back asynchronously when
// a layer closes (`history.back()`), but pushes a history entry at once when a layer
// opens (`pushState`). A row of the More sheet closes that sheet and opens the next
// one in the same tap, so the new entry is pushed while the More sheet's back step is
// still pending: depending on the engine that step is lost or lands on the new entry,
// and the stack and the history drift apart by one entry each time (later Backs then
// close the wrong layer or leave the app). Until the shell orders the two itself,
// the PDF editor opens what a More row asks for only once that back step has arrived.

/** History state key of the shell's back stack (mirrors shell/backStack.tsx). */
const BACK_LAYER_KEY = 'ieumBackLayer'
/** The shell's More sheet (EditorShell's `Sheet testId`). */
const MORE_SHEET_SELECTOR = '[data-testid="editor-more-sheet"]'
/** Opens anyway if the back step never arrives (it always does in a web view). */
export const MORE_SHEET_BACK_TIMEOUT_MS = 1000

let pending: Promise<void> | null = null

/** The More sheet is still shown and holds a history entry, so its close will step back. */
function moreSheetBackComing(win: Window): boolean {
  const state: unknown = win.history.state
  const armed = typeof state === 'object' && state !== null && BACK_LAYER_KEY in state
  return armed && win.document.querySelector(MORE_SHEET_SELECTOR) !== null
}

/**
 * Call from a More-sheet row's press, while the sheet is still in the page. Returns
 * the wait for the sheet's back step, or null when none is coming (no back stack, or
 * the press did not come from the More sheet). Later calls share the pending wait.
 */
export function noteMoreSheetBack(win: Window = window): Promise<void> | null {
  if (pending) return pending
  if (!moreSheetBackComing(win)) return null
  const wait = new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const done = () => {
      win.removeEventListener('popstate', done)
      if (timer !== null) clearTimeout(timer)
      pending = null
      resolve()
    }
    // the back stack's own listener was added first, so it has handled this pop already
    win.addEventListener('popstate', done)
    timer = setTimeout(done, MORE_SHEET_BACK_TIMEOUT_MS)
  })
  pending = wait
  return wait
}

/** Runs `open` now, or once the More sheet's pending back step has arrived. */
export function afterMoreSheetBack(open: () => void, win: Window = window): void {
  const wait = noteMoreSheetBack(win)
  if (wait) void wait.then(open)
  else open()
}
