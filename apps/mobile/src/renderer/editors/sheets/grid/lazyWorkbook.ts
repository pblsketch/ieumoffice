/**
 * Opening a streamed workbook in the phone's Univer, step for step what the
 * desktop's `openLazyWorkbook` (apps/sheets/src/renderer/App.tsx) does with the
 * same exported helpers: skeleton, notes, defined names, the first visible
 * window, then the formula closure (or a full load for small workbooks).
 *
 * The desktop builds its `LazyWorkbookState` inline in the App component (not
 * exported), so `createLazyWorkbookState` repeats that literal here. Desktop
 * steps the phone skips for now: template fonts, charts and pictures, file
 * tables, threaded comments, pivot definitions.
 */
import type { WorkbookFile } from '../../../../../../sheets/src/shared/desktop-api'
import { createEditJournal } from '../../../../../../sheets/src/renderer/edit-journal'
import type {
  LazyWorkbookState,
  UniverRuntime,
} from '../../../../../../sheets/src/renderer/univer-state'
import { pcFullLoad, pcLoadBudget, pcOutlineActions, pcUniverSync } from './pcGridModules'

const {
  activateFormulaClosure,
  applyDefinedNames,
  applyWorkbookNotes,
  clearLazyState,
  loadVisibleRange,
  loadWorkbookSkeleton,
  recalcOverBudgetAtOpen,
  sheetOutline,
} = pcUniverSync
const { opensInFormulaMode, workbookCellCounts } = pcLoadBudget
const { startFullLoad } = pcFullLoad
const { loadRowOutlines } = pcOutlineActions

/** The desktop's initial lazy state for `file` (App.tsx `openLazyWorkbook`). */
export function createLazyWorkbookState(file: WorkbookFile): LazyWorkbookState {
  const cellCounts = workbookCellCounts(file.sheets)
  const state: LazyWorkbookState = {
    file,
    generation: Date.now(),
    loadedRanges: new Map(),
    streamAliases: new Map(),
    loadingKeys: new Map(),
    retryTimers: new Map(),
    appliedMerges: new Map(),
    appliedRowKeys: new Map(),
    measuredWrapRows: new Map(),
    rowColStyleKeys: new Map(),
    sheetProtections: new Map(),
    sheetPageBreaks: new Map(),
    sheetFilePageSetups: new Map(),
    sheetProtectedRanges: new Map(),
    uninstalledDefinedNames: new Set(),
    appliedCfSheets: new Set(),
    appliedFilterSheets: new Set(),
    appliedDvSheets: new Set(),
    decorationsPendingSheets: new Set(),
    hyperlinkTargets: new Map(),
    frozenStripKeys: new Map(),
    filterOrigins: new Map(),
    restoredFilterSpans: new Map(),
    showFormulaSheets: new Set(
      file.sheets.filter((sheet) => sheet.showFormulas).map((sheet) => sheet.id),
    ),
    formulaMode: opensInFormulaMode(cellCounts),
    editJournal: createEditJournal(),
    flags: { preloadComplete: false, preloadRunning: false },
    closure: { status: 'idle', pinned: new Map() },
    formulaText: new Map(),
    formulaTextTruncated: new Set(),
    sharedFormulaGroups: new Map(),
    cachedFormulaValues: new Map(),
    pivotDefinitions: new Map(),
    hiddenFileRows: new Map(),
    hiddenRowsCoveredThrough: new Map(),
    outline: new Map(),
    recalc: {
      timer: null,
      generation: 0,
      failures: 0,
      engineOverBudget: recalcOverBudgetAtOpen(file.fileBytes, cellCounts.gridCells),
      formulaCells: new Map(),
      overlay: new Map(),
      follow: new Map(),
      running: false,
      lastRunAt: 0,
    },
  }
  // Column outline levels arrive with the sheet metadata; seed them now.
  for (const sheet of file.sheets) {
    for (const columnWidth of sheet.columnWidths) {
      if (columnWidth.outlineLevel === undefined && !columnWidth.collapsed) continue
      const cols = sheetOutline(state, sheet.id).cols
      const endColumn = Math.min(columnWidth.endColumn, sheet.columnCount - 1)
      for (let column = columnWidth.startColumn; column <= endColumn; column += 1) {
        cols.set(column, {
          level: columnWidth.outlineLevel ?? 0,
          collapsed: columnWidth.collapsed ?? false,
        })
      }
    }
  }
  return state
}

/**
 * Installs `file` into the runtime and streams its first window. Resolves
 * once that window is in (or failed, reported through `setMessage`).
 */
export function openLazyWorkbookOnPhone(
  runtime: UniverRuntime,
  lazyWorkbookRef: { current: LazyWorkbookState | null },
  file: WorkbookFile,
  setMessage: (message: string) => void,
): Promise<void> {
  clearLazyState(lazyWorkbookRef.current)
  const state = createLazyWorkbookState(file)
  lazyWorkbookRef.current = state
  void loadRowOutlines(state, lazyWorkbookRef)
  loadWorkbookSkeleton(runtime, file)
  applyWorkbookNotes(runtime, file)
  applyDefinedNames(runtime, file, state)
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      const worksheet = runtime.univerAPI.getActiveWorkbook()?.getActiveSheet()
      if (!worksheet) {
        resolve()
        return
      }
      try {
        worksheet.scrollToCell(0, 0)
      } catch {
        // Before the scroll controller exists the view is at the origin anyway.
      }
      void loadVisibleRange(runtime, lazyWorkbookRef, worksheet, setMessage).then(
        () => resolve(),
        (error: unknown) => {
          setMessage(error instanceof Error ? error.message : String(error))
          resolve()
        },
      )
      if (state.formulaMode) {
        void startFullLoad(runtime, lazyWorkbookRef, setMessage)
      } else {
        // Deferred so the first paint and the first window win the engine.
        setTimeout(() => {
          void activateFormulaClosure(runtime, lazyWorkbookRef, setMessage)
        }, 1500)
      }
    })
  })
}

/** Streams the window around the viewport after a scroll or a sheet switch (desktop wiring). */
export function installViewportStreaming(
  runtime: UniverRuntime,
  lazyWorkbookRef: { current: LazyWorkbookState | null },
  setMessage: (message: string) => void,
): () => void {
  const scroll = runtime.univerAPI.addEvent(runtime.univerAPI.Event.Scroll, (params) => {
    const start = params as { sheetViewStartRow?: number; sheetViewStartColumn?: number }
    void loadVisibleRange(
      runtime,
      lazyWorkbookRef,
      params.worksheet,
      setMessage,
      typeof start.sheetViewStartRow === 'number' && typeof start.sheetViewStartColumn === 'number'
        ? { row: start.sheetViewStartRow, column: start.sheetViewStartColumn }
        : undefined,
      true,
    )
  })
  const sheet = runtime.univerAPI.addEvent(
    runtime.univerAPI.Event.ActiveSheetChanged,
    ({ activeSheet }) => {
      void loadVisibleRange(runtime, lazyWorkbookRef, activeSheet, setMessage)
    },
  )
  return () => {
    scroll.dispose()
    sheet.dispose()
  }
}
