/**
 * The virtual keyboard rises only for a cell edit. Univer keeps its hidden
 * cell-editor input focused whenever a cell is selected (so a hardware
 * keyboard can type into the cell), and on a phone that focus raises the
 * virtual keyboard: on open, on a tap in view mode, after a reload.
 * - `installKeyboardOnlyWhileEditing`: when Univer focuses the input while no
 *   cell is being edited, the input gets `inputmode="none"` (focus and
 *   hardware typing stay, the virtual keyboard does not come); a cell edit
 *   takes it off again and refocuses, so the keyboard comes for the edit.
 * - `holdKeyboardDuringLoad`: while a workbook (re)loads, that focus is taken
 *   back altogether.
 * Its own module so it loads without Univer.
 */
/** Univer's hidden cell-editor input (docs-ui marks it `data-u-comp="editor"`). */
function isUniverEditorInput(node: Element | null): node is HTMLElement {
  return node instanceof HTMLElement && node.dataset.uComp === 'editor'
}

/** How long after a (re)load Univer's own focus calls are undone, unless the person touches the grid first. */
const RELOAD_FOCUS_QUIET_MS = 4000

/**
 * Keeps the virtual keyboard down while a workbook (re)loads. Univer focuses
 * its hidden cell input whenever the selection is set (docs-ui
 * `setEditCell` / `addDocRanges`), which a load does several times. Right
 * after a person's tap (the system Save As dialog of an `.xls`, a CSV saved
 * as Excel) the browser still counts it as their gesture and raises the
 * keyboard. Until the person touches the grid again, or a few seconds after
 * the load, that focus is taken back unless a cell is being edited.
 * `settle()` starts the timer once the load is in; `end()` stops early.
 */
export function holdKeyboardDuringLoad(
  element: HTMLElement,
  isEditing: () => boolean,
): { settle(): void; end(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  const release = () => {
    if (isEditing()) return
    const active = document.activeElement
    if (isUniverEditorInput(active)) active.blur()
  }
  const onFocusIn = (event: FocusEvent) => {
    if (isUniverEditorInput(event.target as Element | null)) release()
  }
  const end = () => {
    document.removeEventListener('focusin', onFocusIn, true)
    element.removeEventListener('pointerdown', end, true)
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  document.addEventListener('focusin', onFocusIn, true)
  element.addEventListener('pointerdown', end, true)
  release()
  return {
    settle() {
      release()
      if (timer === null) timer = setTimeout(end, RELOAD_FOCUS_QUIET_MS)
    },
    end,
  }
}

/** The grid's handle on the keyboard rule (installKeyboardOnlyWhileEditing). */
export interface KeyboardWhileEditing {
  /** A cell edit started: the keyboard may come. */
  editingStarted(): void
  dispose(): void
}

export function installKeyboardOnlyWhileEditing(isEditing: () => boolean): KeyboardWhileEditing {
  const onFocusIn = (event: FocusEvent) => {
    const target = event.target as Element | null
    if (isUniverEditorInput(target) && !isEditing()) target.setAttribute('inputmode', 'none')
  }
  document.addEventListener('focusin', onFocusIn, true)
  return {
    editingStarted() {
      for (const input of document.querySelectorAll<HTMLElement>('[data-u-comp="editor"]')) {
        if (input.getAttribute('inputmode') !== 'none') continue
        input.removeAttribute('inputmode')
        // The virtual keyboard reads `inputmode` when the field gains focus.
        if (document.activeElement === input) {
          input.blur()
          input.focus({ preventScroll: true })
        }
      }
    },
    dispose() {
      document.removeEventListener('focusin', onFocusIn, true)
    },
  }
}
