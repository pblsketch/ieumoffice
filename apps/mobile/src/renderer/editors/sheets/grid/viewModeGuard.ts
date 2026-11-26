/**
 * View mode does not edit. The view gate only stops a cell edit from
 * starting (mobileGrid's `BeforeSheetEditStart`); Univer has other ways to
 * change the workbook that do not go through the cell editor: the cell
 * long-press menu (insert, delete, clear, paste…), keyboard shortcuts on a
 * tablet keyboard (Delete, paste, bold), the fill handle, dragging a range,
 * the filter and validation buttons drawn in the cells.
 *
 * Two layers:
 * - Univer's long-press menu is switched off in view mode (its items are
 *   mostly edits; it comes back in edit mode);
 * - every mutation the edit journal would record (journal/editJournal.ts
 *   `journalListensTo`, the desktop's own list) is cancelled in view mode,
 *   whatever sent it. Cancelling the first mutation stops the command before
 *   it changes anything, so nothing reaches the undo stack or the journal.
 *
 * Let through in view mode:
 * - the lazy loader's own writes (`journalSuppression`) and formula results
 *   (`fromFormula`), which are not edits;
 * - zoom and freeze, the sheet-view settings the phone offers while reading
 *   (pinch zoom, More → View; Excel keeps both in the file);
 * - the AI panel's one-step undo of a run, and only that: it runs inside
 *   `withAiUndoPass`. Any other undo or redo (a tablet keyboard's Ctrl+Z or
 *   Ctrl+Y) is cancelled as a command, before it touches the undo stack, so
 *   it cannot take back earlier edits while the document is being read.
 */
import { RedoCommand, UndoCommand } from '@univerjs/core'
import { IContextMenuService } from '@univerjs/ui'
import {
  journalSuppression,
  type UniverRuntime,
} from '../../../../../../sheets/src/renderer/univer-state'
import { journalListensTo } from '../journal/editJournal'
import { pcAppConstants } from '../journal/pcJournalModules'

/** The part of Univer's context menu service the guard switches. */
export interface ContextMenuSwitch {
  enable(): void
  disable(): void
}

export interface ViewModeGuard {
  setViewMode(view: boolean): void
  dispose(): void
}

/** Undo/redo runs the AI panel's undo has open (it awaits Univer's undo, one step at a time). */
let aiUndoRuns = 0

/**
 * Runs the AI panel's undo of a run: the undo and redo commands it sends,
 * and the mutations they replay, pass the view-mode guard. Nothing else may
 * use it.
 */
export async function withAiUndoPass<T>(run: () => Promise<T>): Promise<T> {
  aiUndoRuns += 1
  try {
    return await run()
  } finally {
    aiUndoRuns -= 1
  }
}

function isUndoOrRedo(id: string | undefined): boolean {
  return id === UndoCommand.id || id === RedoCommand.id
}

/** True for a mutation id that changes the workbook and is not a sheet-view setting. */
export function isViewModeEdit(id: string): boolean {
  const C = pcAppConstants
  if (id === C.SET_ZOOM_OPERATION || id === C.SET_ZOOM_COMMAND || id === C.SET_FROZEN_MUTATION) {
    return false
  }
  // The journal's filter leaves this one out (the desktop records it inside the numfmt branch).
  return journalListensTo(id) || id === C.REMOVE_NUMFMT_MUTATION
}

function univerContextMenu(runtime: UniverRuntime): ContextMenuSwitch | null {
  try {
    return runtime.univer.__getInjector().get(IContextMenuService)
  } catch {
    // Tests boot Univer without the UI plugins.
    return null
  }
}

export function installViewModeGuard(
  runtime: UniverRuntime,
  options: { readonly initialView: boolean; readonly contextMenu?: ContextMenuSwitch | null },
): ViewModeGuard {
  let viewMode = options.initialView
  const contextMenu =
    options.contextMenu === undefined ? univerContextMenu(runtime) : options.contextMenu
  const applyMenu = () => (viewMode ? contextMenu?.disable() : contextMenu?.enable())
  applyMenu()
  const api = runtime.univerAPI
  const disposable = api.addEvent(api.Event.BeforeCommandExecute, (event) => {
    if (!viewMode || journalSuppression.active) return
    // Undo and redo themselves: cancelled before they move the stacks,
    // unless the AI panel's undo sent them.
    if (isUndoOrRedo(event.id)) {
      if (aiUndoRuns === 0) event.cancel = true
      return
    }
    const executeOptions = event.options as { fromFormula?: boolean } | undefined
    if (executeOptions?.fromFormula) return
    if (!isViewModeEdit(event.id)) return
    // Mutations carry the command that sent them (Univer's command stack).
    const trigger = (event.params as { trigger?: string } | undefined)?.trigger
    if (isUndoOrRedo(trigger) && aiUndoRuns > 0) return
    event.cancel = true
  })
  return {
    setViewMode(view) {
      viewMode = view
      applyMenu()
    },
    dispose() {
      disposable.dispose()
      contextMenu?.enable()
    },
  }
}
