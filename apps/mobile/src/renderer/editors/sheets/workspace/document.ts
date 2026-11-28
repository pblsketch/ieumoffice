/**
 * One opened spreadsheet (`EditorDocument`), put together from the slots
 * (slots.ts): save, share and recovery from `save/documentSlot.ts`, the AI
 * run from `ai/documentSlot.ts`, the screen from `SheetsWorkspace.tsx`.
 *
 * Rules kept here whatever the slots do (spec 5.1, 5.2):
 * - a workbook opened with a password writes no recovery copy (the plain
 *   workbook must not land outside the work folder) and keeps AI available;
 *   it is not marked `encrypted` (that flag means "cannot be edited");
 * - `dispose()` (closed or replaced) tears down the grid, closes the engine
 *   session the document uses now (each save swaps it; a save still running
 *   closes the one it swaps in), deletes its working copy and drops the
 *   password, once.
 */
import type { EditorDocument, EditorHost } from '../../editorKind'
import { createSheetsAiRun } from '../ai/documentSlot'
import { createSheetsSaveActions } from '../save/documentSlot'
import type { OpenedSheetsWorkbook } from '../session'
import { createSheetsWorkspace } from './SheetsWorkspace'
import type { SheetsDocumentContext, SheetsGridAccess } from './slots'

export function startSheetsDocument(
  host: EditorHost,
  opened: OpenedSheetsWorkbook,
): EditorDocument {
  const grid: SheetsGridAccess = { grid: null, handle: null }
  const context: SheetsDocumentContext = { host, opened, grid }
  const saveActions = createSheetsSaveActions(context)
  const aiRun = createSheetsAiRun
  let disposed = false
  return {
    ...saveActions,
    exportPdfScope: 'sheet',
    async writeRecovery(doc) {
      if (opened.unlocked) return
      await saveActions.writeRecovery?.(doc)
    },
    ...(aiRun ? { createAiRun: (ai) => aiRun(context, ai) } : {}),
    Workspace: createSheetsWorkspace(host, opened, grid),
    dispose() {
      if (disposed) return
      disposed = true
      grid.handle = null
      grid.grid?.dispose()
      grid.grid = null
      void opened.close()
    },
  }
}
