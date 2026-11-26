/**
 * Keeping the virtual keyboard down while a workbook (re)loads (see
 * `holdKeyboardDuringLoad`). Its own module so it loads without Univer.
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
