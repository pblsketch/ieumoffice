/**
 * Keeps the cell being edited above the keyboard: when editing starts and
 * whenever the visible area changes while it lasts (the keyboard slides in
 * after the editor opens), the grid scrolls by what `revealScrollDelta` asks.
 */
import { IEditorBridgeService } from '@univerjs/sheets-ui'
import type { UniverRuntime } from '../../../../../../sheets/src/renderer/univer-state'
import { revealScrollDelta, visibleBottom } from './revealCell'

/** Univer's relative scroll (adds to the current scroll offset, in unscaled sheet px). */
const SCROLL_RELATIVE_COMMAND = 'sheet.command.set-scroll-relative'

function cssPx(name: string): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name)
  const number = Number.parseFloat(value)
  return Number.isFinite(number) ? number : 0
}

/** One reveal pass. Returns the client px it asked the grid to scroll (0 when none). */
export function revealEditedCell(runtime: UniverRuntime, element: HTMLElement): number {
  const state = runtime.univer.__getInjector().get(IEditorBridgeService).getEditCellState()
  if (!state) return 0
  const { position, canvasOffset, scaleY } = state
  const viewport = window.visualViewport
  const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight
  const delta = revealScrollDelta({
    cellTop: canvasOffset.top + position.startY,
    cellBottom: canvasOffset.top + position.endY,
    viewTop: element.getBoundingClientRect().top,
    viewBottom: visibleBottom({
      visualViewportBottom: viewportBottom,
      keyboardInset: cssPx('--m-kb'),
      keyboardBarHeight: cssPx('--m-kbbar-h'),
    }),
  })
  if (delta === 0) return 0
  void runtime.univerAPI.executeCommand(SCROLL_RELATIVE_COMMAND, {
    offsetY: delta / (scaleY || 1),
  })
  return delta
}

export function installEditReveal(runtime: UniverRuntime, element: HTMLElement): () => void {
  const api = runtime.univerAPI
  let editing = false
  let frame = 0
  const schedule = () => {
    if (!editing || frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!editing) return
      try {
        revealEditedCell(runtime, element)
      } catch {
        // No edit state yet (the editor is still opening); the next resize retries.
      }
    })
  }
  const started = api.addEvent(api.Event.SheetEditStarted, () => {
    editing = true
    schedule()
  })
  const ended = api.addEvent(api.Event.SheetEditEnded, () => {
    editing = false
  })
  window.visualViewport?.addEventListener('resize', schedule)
  window.addEventListener('resize', schedule)
  return () => {
    if (frame) cancelAnimationFrame(frame)
    started.dispose()
    ended.dispose()
    window.visualViewport?.removeEventListener('resize', schedule)
    window.removeEventListener('resize', schedule)
  }
}
