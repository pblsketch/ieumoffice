/**
 * The edit journal on the phone: every grid edit lands in the session's
 * `editJournal` (apps/sheets/src/renderer/edit-journal.ts, used as it is), so
 * the desktop's save flow (`handleSave` → `toSave*`) sends everything that
 * changed. T8 (grid) and T9 (toolbar) only send Univer commands; this records
 * what they do.
 *
 * The desktop records from two listeners inside its App component
 * (apps/sheets/src/renderer/App.tsx: the `CommandExecuted` journal listener,
 * `journalDisposable`, and the `BeforeCommandExecute` edit gate,
 * `structuralDisposable`). They are not exported, so this file re-states
 * them: the same mutation names (from app-constants.ts), the same order of
 * checks and the same `record*` calls, with the desktop's own helpers.
 * `tests/sheets-pc-journal-modules.test.ts` fails when the desktop listener
 * text changes, so a change there is noticed and carried over.
 *
 * Left out, because the phone has no such screen yet (each is listed in
 * editors/sheets/README-slots.md):
 * - chart and sparkline live sync, threaded comments, page-break overlay,
 *   lazy visual refresh, AI change marks (desktop-only screens);
 * - demo mode (the phone always has a lazy workbook);
 * - copy-sheet: the phone does not offer it, so the gate cancels it (the
 *   desktop journals it as a duplicate with stream aliases);
 * - the full-load offer and the large-filter path of the sort/filter gate:
 *   the gate cancels with the desktop's message instead;
 * - the conditional-format rule gate (conditional formats are view-only in 1판).
 */
import type { IRange } from '@univerjs/core'
import {
  isSheetRemoved,
  journalSize,
  recordCfChange,
  recordDefinedNamesChange,
  recordDvChange,
  recordFilterChange,
  recordNoteChange,
  recordPageSetup,
  recordRemoveNumfmt,
  recordSetNumfmt,
  recordSetRangeValues,
  recordSheetHidden,
  recordSheetInsert,
  recordSheetOrderChange,
  recordSheetRemove,
  recordSheetRename,
  recordSheetTabColor,
  recordStructuralOp,
  shiftVisualForStructuralOp,
  type StructuralJournalOp,
} from '../../../../../../sheets/src/renderer/edit-journal'
import { shiftPinnedCells } from '../../../../../../sheets/src/renderer/formula-closure'
import {
  collectCellFormulaTexts,
  quadraticFormulaError,
} from '../../../../../../sheets/src/renderer/formula-cost'
import { t } from '../../../../../../sheets/src/renderer/i18n/locale'
import { resetLargeFilter } from '../../../../../../sheets/src/renderer/large-filter-state'
import {
  moveOutlineEntries,
  shiftOutlineEntries,
} from '../../../../../../sheets/src/renderer/outline-model'
import { mapProtectedRanges } from '../../../../../../sheets/src/renderer/protected-ranges'
import { sharedFormulaResolverFor } from '../../../../../../sheets/src/renderer/shared-formula-journal'
import {
  journalSuppression,
  lazySheetScreenExtent,
  type LazyWorkbookState,
  type UniverRuntime,
} from '../../../../../../sheets/src/renderer/univer-state'
import { netAxisDelta } from '../../../../../../sheets/src/renderer/view-transform'
import { columnLabel } from '@genoffice/xlsx-gateway/domain/cell-address'
import { pcLoadBudget, pcUniverSync } from '../grid/pcGridModules'
import {
  pcAppConstants,
  pcLargeFilter,
  pcPlanOperations,
  pcReorderGate,
  pcUniverSyncJournal,
} from './pcJournalModules'

export interface EditJournalOptions {
  /** After each recorded edit, with the journal's size (`journalSize`). */
  readonly onRecorded?: (pending: number) => void
  /** A gate refused a command; the desktop shows the same text in its status bar. */
  readonly onMessage?: (message: string) => void
  /**
   * The loader's progress after a structural edit (the visible range is read
   * again: "streaming…", "indexing…"). It is the same load the viewport
   * streamer runs, so its lines go where the streamer's go, not to `onMessage`.
   */
  readonly onStatus?: (message: string) => void
}

type LazyRef = { current: LazyWorkbookState | null }

/** Installs the journal listener and the edit gate on `runtime`. Returns the uninstaller. */
export function installEditJournal(
  runtime: UniverRuntime,
  lazyWorkbookRef: LazyRef,
  options: EditJournalOptions = {},
): () => void {
  const recorded = installJournalListener(runtime, lazyWorkbookRef, options)
  const gate = installEditGate(runtime, lazyWorkbookRef, options)
  return () => {
    recorded()
    gate()
  }
}

/**
 * The command ids the journal listener records (App.tsx `journalDisposable`'s
 * first filter, in its order). The view-mode guard (grid/viewModeGuard.ts)
 * reads the same list, so "an edit" means the same thing in both places.
 */
export function journalListensTo(id: string): boolean {
  const C = pcAppConstants
  return (
    id === C.SET_RANGE_VALUES_MUTATION ||
    id === C.SET_NUMFMT_MUTATION ||
    C.ROW_COLUMN_MUTATIONS[id] !== undefined ||
    C.MERGE_MUTATIONS[id] !== undefined ||
    C.AXIS_ATTR_MUTATIONS[id] !== undefined ||
    C.SHEET_LIFECYCLE_MUTATIONS.has(id) ||
    id === C.REORDER_RANGE_MUTATION ||
    C.FILTER_MUTATIONS.has(id) ||
    C.CF_MUTATIONS.has(id) ||
    C.DV_MUTATIONS.has(id) ||
    C.DEFINED_NAME_MUTATIONS.has(id) ||
    C.NOTE_MUTATIONS.has(id) ||
    id === C.MOVE_RANGE_MUTATION ||
    id === C.MOVE_ROWS_MUTATION ||
    id === C.SET_FROZEN_MUTATION ||
    id === C.TOGGLE_GRIDLINES_MUTATION ||
    id === C.SET_RIGHT_TO_LEFT_MUTATION ||
    id === C.SET_ZOOM_OPERATION ||
    id === C.SET_ZOOM_COMMAND
  )
}

/** App.tsx `journalDisposable` (CommandExecuted). */
function installJournalListener(
  runtime: UniverRuntime,
  lazyWorkbookRef: LazyRef,
  options: EditJournalOptions,
): () => void {
  const C = pcAppConstants
  const setStatus = (message: string) => options.onStatus?.(message)
  const setPendingEdits = (pending: number) => options.onRecorded?.(pending)
  const api = runtime.univerAPI
  const disposable = api.addEvent(api.Event.CommandExecuted, (event) => {
    if (journalSuppression.active) return
    // The formula engine re-applies cached results with these execution
    // options; they are derived state, never user edits.
    const executeOptions = event.options as { fromFormula?: boolean } | undefined
    if (executeOptions?.fromFormula) return
    const rowColumn = C.ROW_COLUMN_MUTATIONS[event.id]
    const merge = C.MERGE_MUTATIONS[event.id]
    const axisAttr = C.AXIS_ATTR_MUTATIONS[event.id]
    if (!journalListensTo(event.id)) return
    const state = lazyWorkbookRef.current
    if (!state) return
    const params = event.params as
      | {
          unitId?: string
          subUnitId?: string
          cellValue?: unknown
          range?: IRange
          ranges?: IRange[]
          order?: Record<number, number>
          name?: string
          sheet?: { id?: string; name?: string }
        }
      | undefined
    if (params?.unitId !== `file-${state.file.sha256}`) return
    if (C.SHEET_LIFECYCLE_MUTATIONS.has(event.id)) {
      if (event.id === 'sheet.mutation.insert-sheet') {
        const { id, name } = params.sheet ?? {}
        if (typeof id === 'string' && typeof name === 'string') {
          recordSheetInsert(state.editJournal, id, name)
        }
      } else if (event.id === 'sheet.mutation.remove-sheet') {
        if (typeof params.subUnitId === 'string') {
          recordSheetRemove(state.editJournal, params.subUnitId)
        }
      } else if (event.id === 'sheet.mutation.set-worksheet-order') {
        recordSheetOrderChange(state.editJournal)
      } else if (event.id === 'sheet.mutation.set-worksheet-hidden') {
        const hidden = (params as { hidden?: number | boolean }).hidden
        if (typeof params.subUnitId === 'string' && hidden !== undefined) {
          const originallyHidden =
            state.file.sheets.find((sheet) => sheet.id === params.subUnitId)?.hidden ?? false
          recordSheetHidden(
            state.editJournal,
            params.subUnitId,
            hidden === true || hidden === 1,
            originallyHidden,
          )
        }
      } else if (event.id === 'sheet.mutation.set-tab-color') {
        if (typeof params.subUnitId === 'string') {
          recordSheetTabColor(
            state.editJournal,
            params.subUnitId,
            (params as { color?: unknown }).color,
            state.file.sheets.find((sheet) => sheet.id === params.subUnitId)?.tabColor,
          )
        }
      } else if (typeof params.subUnitId === 'string' && typeof params.name === 'string') {
        const originalName = state.file.sheets.find((sheet) => sheet.id === params.subUnitId)?.name
        recordSheetRename(state.editJournal, params.subUnitId, params.name, originalName)
      }
      setPendingEdits(journalSize(state.editJournal))
      return
    }
    // Move-range carries its sheet ids inside from/to, not at top level.
    if (event.id === C.MOVE_RANGE_MUTATION) {
      const move = event.params as
        | {
            from?: { subUnitId?: string; value?: unknown }
            to?: { subUnitId?: string; value?: unknown }
            fromRange?: IRange
            toRange?: IRange
          }
        | undefined
      const fromSheet = move?.from?.subUnitId ?? params.subUnitId
      const toSheet = move?.to?.subUnitId ?? params.subUnitId
      const fromRange = move?.fromRange ?? pcUniverSyncJournal.matrixBounds(move?.from?.value)
      const toRange = move?.toRange ?? pcUniverSyncJournal.matrixBounds(move?.to?.value)
      if (fromSheet && fromRange) {
        pcUniverSyncJournal.journalRangeSnapshot(runtime, state, fromSheet, fromRange)
      }
      if (toSheet && toRange) {
        pcUniverSyncJournal.journalRangeSnapshot(runtime, state, toSheet, toRange)
      }
      setPendingEdits(journalSize(state.editJournal))
      return
    }
    // Workbook-level: defined-name mutations carry no subUnitId.
    if (C.DEFINED_NAME_MUTATIONS.has(event.id)) {
      recordDefinedNamesChange(state.editJournal)
      setPendingEdits(journalSize(state.editJournal))
      return
    }
    // The sheets-note mutations name their sheet `sheetId`, not `subUnitId`.
    if (C.NOTE_MUTATIONS.has(event.id)) {
      const noteSheetId = (params as { sheetId?: string }).sheetId ?? params.subUnitId
      if (noteSheetId) {
        recordNoteChange(state.editJournal, noteSheetId)
        setPendingEdits(journalSize(state.editJournal))
      }
      return
    }
    if (!params.subUnitId) return
    if (axisAttr) {
      const attrParams = event.params as {
        ranges?: IRange[]
        rowHeight?: number | Record<number, number>
        colWidth?: number | Record<number, number>
        autoHeightInfo?: number | Record<number, number>
      }
      const uniform = axisAttr.axis === 'row' ? attrParams.rowHeight : attrParams.colWidth
      const toFileSize = (pixels: number): number =>
        axisAttr.axis === 'row'
          ? Math.round(pixels * 0.75 * 100) / 100
          : C.pixelsToCharacterWidth(pixels)
      for (const range of attrParams.ranges ?? []) {
        const start = axisAttr.axis === 'row' ? range.startRow : range.startColumn
        const end = axisAttr.axis === 'row' ? range.endRow : range.endColumn
        if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) continue
        if (end - start >= 100_000) continue
        const sizeKind = axisAttr.axis === 'row' ? 'set-row-size' : 'set-col-size'
        if (axisAttr.kind === 'hidden') {
          recordStructuralOp(state.editJournal, params.subUnitId, {
            kind: axisAttr.axis === 'row' ? 'set-rows-hidden' : 'set-cols-hidden',
            start,
            end,
            hidden: axisAttr.hidden === true,
          })
        } else if (axisAttr.kind === 'auto-size') {
          // Setting an explicit height ALSO emits this mutation with
          // autoHeightInfo=0 (auto off); only auto ON resets the height.
          const info = attrParams.autoHeightInfo
          if (typeof info === 'number') {
            if (info === 1) {
              recordStructuralOp(state.editJournal, params.subUnitId, {
                kind: sizeKind,
                start,
                end,
                size: null,
              })
            }
          } else if (info && typeof info === 'object') {
            for (let line = start; line <= end; line += 1) {
              if (info[line] !== 1) continue
              recordStructuralOp(state.editJournal, params.subUnitId, {
                kind: sizeKind,
                start: line,
                end: line,
                size: null,
              })
            }
          }
        } else if (typeof uniform === 'number') {
          recordStructuralOp(state.editJournal, params.subUnitId, {
            kind: sizeKind,
            start,
            end,
            size: toFileSize(uniform),
          })
        } else if (uniform && typeof uniform === 'object') {
          // Per-line sizes (undo restores): one op per line in the range.
          for (let line = start; line <= end; line += 1) {
            const pixels = uniform[line]
            if (typeof pixels !== 'number') continue
            recordStructuralOp(state.editJournal, params.subUnitId, {
              kind: sizeKind,
              start: line,
              end: line,
              size: toFileSize(pixels),
            })
          }
        }
      }
      setPendingEdits(journalSize(state.editJournal))
      return
    }
    if (C.FILTER_MUTATIONS.has(event.id)) {
      recordFilterChange(state.editJournal, params.subUnitId)
      if (
        event.id === 'sheet.mutation.set-filter-range' &&
        pcLargeFilter.isLargeFilterSheet(state, params.subUnitId)
      ) {
        const worksheet = api.getActiveWorkbook()?.getSheetBySheetId(params.subUnitId)
        if (worksheet) pcLargeFilter.extendLargeFilterRange(runtime, state, worksheet)
      }
      if (event.id === 'sheet.mutation.remove-filter') {
        resetLargeFilter(state, params.subUnitId)
      }
      setPendingEdits(journalSize(state.editJournal))
      return
    }
    if (C.CF_MUTATIONS.has(event.id)) {
      recordCfChange(state.editJournal, params.subUnitId)
      setPendingEdits(journalSize(state.editJournal))
      return
    }
    if (C.DV_MUTATIONS.has(event.id)) {
      recordDvChange(state.editJournal, params.subUnitId)
      setPendingEdits(journalSize(state.editJournal))
      return
    }
    if (event.id === C.SET_FROZEN_MUTATION) {
      // Recording from the mutation keeps the journal in step with Univer's
      // undo/redo of the freeze.
      const freeze = event.params as
        { subUnitId?: string; ySplit?: number; xSplit?: number } | undefined
      if (freeze?.subUnitId && !isSheetRemoved(state.editJournal, freeze.subUnitId)) {
        recordPageSetup(state.editJournal, freeze.subUnitId, {
          frozenRows: Math.max(0, freeze.ySplit ?? 0),
          frozenColumns: Math.max(0, freeze.xSplit ?? 0),
        })
        setPendingEdits(journalSize(state.editJournal))
      }
      return
    }
    if (event.id === C.TOGGLE_GRIDLINES_MUTATION) {
      const gridlines = event.params as { subUnitId?: string; showGridlines?: number } | undefined
      if (
        gridlines?.subUnitId &&
        gridlines.showGridlines !== undefined &&
        !isSheetRemoved(state.editJournal, gridlines.subUnitId)
      ) {
        recordPageSetup(state.editJournal, gridlines.subUnitId, {
          showGridlines: gridlines.showGridlines === 1,
        })
        setPendingEdits(journalSize(state.editJournal))
      }
      return
    }
    if (event.id === C.SET_RIGHT_TO_LEFT_MUTATION) {
      const rtl = event.params as { subUnitId?: string; rightToLeft?: number } | undefined
      if (
        rtl?.subUnitId &&
        rtl.rightToLeft !== undefined &&
        !isSheetRemoved(state.editJournal, rtl.subUnitId)
      ) {
        recordPageSetup(state.editJournal, rtl.subUnitId, {
          rightToLeft: rtl.rightToLeft === 1,
        })
        setPendingEdits(journalSize(state.editJournal))
      }
      return
    }
    if (event.id === C.SET_ZOOM_OPERATION || event.id === C.SET_ZOOM_COMMAND) {
      // On mobile, sheet zoom is view-only state and never marks the workbook dirty.
      return
    }
    if (event.id === C.REORDER_RANGE_MUTATION) {
      if (params.range) {
        pcUniverSyncJournal.journalRangeSnapshot(
          runtime,
          state,
          params.subUnitId,
          params.range,
          params.order,
        )
        setPendingEdits(journalSize(state.editJournal))
      }
      return
    }
    if (rowColumn || event.id === C.MOVE_ROWS_MUTATION) {
      let structuralOp: StructuralJournalOp
      if (rowColumn) {
        const range = params.range
        if (!range) return
        const index = rowColumn.axis === 'row' ? range.startRow : range.startColumn
        const count =
          rowColumn.axis === 'row'
            ? range.endRow - range.startRow + 1
            : range.endColumn - range.startColumn + 1
        if (count <= 0) return
        structuralOp = { kind: rowColumn.kind, index, count }
      } else {
        const move = event.params as { sourceRange?: IRange; targetRange?: IRange } | undefined
        if (!move?.sourceRange || !move.targetRange) return
        const index = move.sourceRange.startRow
        const count = move.sourceRange.endRow - move.sourceRange.startRow + 1
        const before = move.targetRange.startRow
        if (count <= 0 || (before >= index && before <= index + count)) return
        structuralOp = { kind: 'move-rows', index, count, before }
      }
      const structuralSheetId = params.subUnitId
      // Refs are matched by live sheet name (they follow renames).
      const structuralSheetName =
        api.getActiveWorkbook()?.getSheetBySheetId(structuralSheetId)?.getSheetName() ??
        state.file.sheets.find((sheet) => sheet.id === structuralSheetId)?.name
      // Undo of a filled insert must still cancel the insert: drop the fill
      // op so the inverse remove meets the insert itself.
      if (rowColumn && rowColumn.kind.startsWith('remove')) {
        const ops = state.editJournal.structuralOps.get(structuralSheetId)
        const fill = ops?.[ops.length - 1]
        const insert = ops?.[ops.length - 2]
        const rows = rowColumn.axis === 'row'
        if (
          fill &&
          insert &&
          'level' in fill &&
          fill.kind === (rows ? 'set-rows-outline' : 'set-cols-outline') &&
          'index' in insert &&
          insert.kind === (rows ? 'insert-rows' : 'insert-cols') &&
          insert.index === structuralOp.index &&
          insert.count === structuralOp.count &&
          fill.start === structuralOp.index &&
          fill.end === structuralOp.index + structuralOp.count - 1
        ) {
          ops.pop()
        }
      }
      recordStructuralOp(state.editJournal, structuralSheetId, structuralOp, structuralSheetName)
      if (structuralOp.kind === 'move-rows') {
        const outline = pcUniverSync.sheetOutline(state, structuralSheetId)
        moveOutlineEntries(
          outline.rows,
          structuralOp.index,
          structuralOp.count,
          structuralOp.before,
        )
        outline.version += 1
      }
      if (rowColumn) {
        const outline = pcUniverSync.sheetOutline(state, structuralSheetId)
        const filled = shiftOutlineEntries(
          rowColumn.axis === 'row' ? outline.rows : outline.cols,
          structuralOp.index,
          rowColumn.kind.startsWith('insert') ? structuralOp.count : -structuralOp.count,
        )
        if (filled > 0) {
          recordStructuralOp(state.editJournal, structuralSheetId, {
            kind: rowColumn.axis === 'row' ? 'set-rows-outline' : 'set-cols-outline',
            start: structuralOp.index,
            end: structuralOp.index + structuralOp.count - 1,
            level: filled,
          })
        }
        outline.version += 1
      }
      // The in-memory copy of the file's visuals follows the shift (the save
      // shifts the file's own anchors independently).
      state.file.visuals.forEach((visual, at) => {
        state.file.visuals[at] = shiftVisualForStructuralOp(
          visual,
          structuralSheetId,
          structuralSheetName,
          structuralOp,
        )
      })
      // Allow-edit ranges are kept in screen space.
      const protectedRanges = state.sheetProtectedRanges.get(structuralSheetId)
      if (protectedRanges && protectedRanges.length > 0) {
        state.sheetProtectedRanges.set(
          structuralSheetId,
          mapProtectedRanges(protectedRanges, [structuralOp]),
        )
      }
      // Univer shifted its installed cells itself, but the loaded-range
      // bookkeeping and frozen strip are stale: refetch the viewport through
      // the updated coordinate mapping (moves are gated to loaded sheets).
      if (structuralOp.kind !== 'move-rows') {
        state.loadedRanges.delete(params.subUnitId)
        state.frozenStripKeys.delete(params.subUnitId)
      }
      // Pinned closure values shift with the model; pinned formulas are dropped.
      const pinnedClosure = state.closure.pinned.get(params.subUnitId)
      if (pinnedClosure && 'index' in structuralOp) {
        const shifted = shiftPinnedCells(pinnedClosure, structuralOp)
        for (const [key, cell] of [...shifted]) {
          if (cell.f !== undefined) shifted.delete(key)
        }
        state.closure.pinned.set(params.subUnitId, shifted)
      }
      // The recalc fallback reads the on-disk file; structural edits desync
      // every coordinate, so its overlays must not re-apply.
      state.recalc.overlay.clear()
      state.recalc.formulaCells.clear()
      const activeSheet = api.getActiveWorkbook()?.getActiveSheet()
      if (activeSheet?.getSheetId() === params.subUnitId) {
        void pcUniverSyncJournal.loadVisibleRange(runtime, lazyWorkbookRef, activeSheet, setStatus)
      }
      setPendingEdits(journalSize(state.editJournal))
      return
    }
    if (merge) {
      for (const range of params.ranges ?? []) {
        if (range.endRow < range.startRow || range.endColumn < range.startColumn) continue
        recordStructuralOp(state.editJournal, params.subUnitId, {
          kind: merge,
          range: {
            startRow: range.startRow,
            endRow: range.endRow,
            startColumn: range.startColumn,
            endColumn: range.endColumn,
          },
        })
      }
      setPendingEdits(journalSize(state.editJournal))
      return
    }
    // A >20k-cell paste (and its undo/redo) splits into chunks that run as
    // plain mutations; only a chunk's local re-run (onlyLocal) is skipped.
    const chunkOptions = event.options as { onlyLocal?: boolean } | undefined
    if (
      (event.params as { __splitChunk__?: boolean } | undefined)?.__splitChunk__ &&
      chunkOptions?.onlyLocal
    ) {
      return
    }
    const entries =
      event.id === C.SET_NUMFMT_MUTATION
        ? recordSetNumfmt(state.editJournal, params.subUnitId, params as never)
        : event.id === C.REMOVE_NUMFMT_MUTATION
          ? recordRemoveNumfmt(state.editJournal, params.subUnitId, params as never)
          : recordSetRangeValues(
              state.editJournal,
              params.subUnitId,
              params.cellValue,
              sharedFormulaResolverFor(runtime, params.subUnitId),
            )
    if (entries.length === 0) return
    setPendingEdits(journalSize(state.editJournal))
  })
  return () => disposable.dispose()
}

/** App.tsx `structuralDisposable` (BeforeCommandExecute): the edit gates the journal relies on. */
function installEditGate(
  runtime: UniverRuntime,
  lazyWorkbookRef: LazyRef,
  options: EditJournalOptions,
): () => void {
  const C = pcAppConstants
  const setMessage = (message: string) => options.onMessage?.(message)
  const api = runtime.univerAPI
  const activeSheetId = () => api.getActiveWorkbook()?.getActiveSheet()?.getSheetId()
  const disposable = api.addEvent(api.Event.BeforeCommandExecute, (event) => {
    const state = lazyWorkbookRef.current
    if (journalSuppression.active || !state) return
    const subUnitIdOf = () =>
      (event.params as { subUnitId?: string } | undefined)?.subUnitId ?? activeSheetId()
    if (event.id === C.SET_RANGE_VALUES_COMMAND || event.id === C.SET_RANGE_VALUES_MUTATION) {
      // Quadratic array-criteria formulas freeze the formula engine for
      // minutes; block them at the edit gate.
      const executeOptions = event.options as { fromFormula?: boolean } | undefined
      if (executeOptions?.fromFormula) return
      const params = event.params as
        { subUnitId?: string; value?: unknown; cellValue?: unknown } | undefined
      const formulas = collectCellFormulaTexts(params?.value ?? params?.cellValue)
      if (formulas.length > 0) {
        const subUnitId = params?.subUnitId ?? activeSheetId()
        const hostName =
          state.file.sheets.find((candidate) => candidate.id === subUnitId)?.name ?? ''
        const costSheets = state.file.sheets.map((candidate) => ({
          name: candidate.name,
          rows: candidate.rowCount,
          columns: candidate.columnCount,
        }))
        if (
          formulas.some((formula) => quadraticFormulaError(formula, hostName, costSheets) !== null)
        ) {
          event.cancel = true
          setMessage(t('appFormulaTooExpensive'))
        }
      }
      return
    }
    if (C.STRUCTURAL_EDIT_COMMAND_PATTERN.test(event.id)) {
      // Sheets carrying pivot tables cannot shift: the baked pivot output
      // would desync from its definition.
      const subUnitId = subUnitIdOf()
      const sheet = state.file.sheets.find((candidate) => candidate.id === subUnitId)
      if (sheet && sheet.pivotRanges.length > 0) {
        event.cancel = true
        setMessage(t('appPivotSheetNoStructural'))
        return
      }
      // The save aborts when a formula references only the deleted span;
      // reject the removal up front.
      if (sheet && /^sheet\.command\.remove-(row|col)/.test(event.id)) {
        const uiWorkbook = api.getActiveWorkbook()
        const range =
          (event.params as { range?: IRange } | undefined)?.range ??
          uiWorkbook?.getActiveRange()?.getRange()
        if (range && uiWorkbook) {
          const removeOp = event.id.includes('remove-row')
            ? {
                op: 'delete_rows' as const,
                sheetId: sheet.id,
                row: range.startRow + 1,
                count: range.endRow - range.startRow + 1,
              }
            : {
                op: 'delete_cols' as const,
                sheetId: sheet.id,
                column: columnLabel(range.startColumn),
                count: range.endColumn - range.startColumn + 1,
              }
          if (pcPlanOperations.structuralDeleteFormulaErrorSync(state, uiWorkbook, removeOp)) {
            event.cancel = true
            setMessage(t('appDeleteSpanFormulas'))
            return
          }
        }
      }
      return
    }
    if (
      C.SORT_COMMAND_PATTERN.test(event.id) ||
      C.FILTER_COMMAND_PATTERN.test(event.id) ||
      event.id === C.OPEN_FILTER_PANEL_OPERATION ||
      event.id === C.MOVE_RANGE_COMMAND ||
      event.id === C.MOVE_ROWS_COMMAND ||
      C.RANGE_SHIFT_COMMAND_PATTERN.test(event.id)
    ) {
      const subUnitId = subUnitIdOf()
      const isAddedSheet = subUnitId !== undefined && state.editJournal.sheets.added.has(subUnitId)
      const isFilter =
        C.FILTER_COMMAND_PATTERN.test(event.id) || event.id === C.OPEN_FILTER_PANEL_OPERATION
      const cellCounts = pcLoadBudget.workbookCellCounts(state.file.sheets)
      // Filtering only hides rows; it needs the complete data, which the
      // desktop offers to load (the phone says why it cannot filter yet).
      if (isFilter && !isAddedSheet && !state.flags.preloadComplete) {
        event.cancel = true
        const verdict = pcReorderGate.fullLoadGate({
          formulaMode: state.formulaMode,
          preloadRunning: state.flags.preloadRunning,
          cellCounts,
        })
        setMessage(t(verdict === 'loading' ? 'appFullLoadRunning' : 'appSortRangeTooLarge'))
        return
      }
      if (!isFilter) {
        // move-rows journals as a structural op, not a cell snapshot
        const ranges =
          event.id === C.MOVE_ROWS_COMMAND
            ? []
            : pcReorderGate.reorderCommandRanges(
                event.id,
                event.params,
                api.getActiveWorkbook()?.getActiveRange()?.getRange(),
                subUnitId === undefined ? null : lazySheetScreenExtent(state, subUnitId),
              )
        const verdict = pcReorderGate.reorderGate({
          formulaMode: state.formulaMode,
          preloadComplete: state.flags.preloadComplete,
          preloadRunning: state.flags.preloadRunning,
          isAddedSheet,
          cellCounts,
          rangeCells: pcReorderGate.largestRangeCells(ranges),
          rangeHasStreamedFormulas: () =>
            subUnitId !== undefined &&
            pcReorderGate.rangeHasStreamedFormulas(state, subUnitId, ranges),
        })
        if (verdict !== 'allow') {
          event.cancel = true
          if (verdict === 'loading') setMessage(t('appFullLoadRunning'))
          else if (verdict === 'valueModeFormulas') setMessage(t('appSortValueModeFormulas'))
          else setMessage(t('appSortRangeTooLarge'))
          return
        }
      }
      if (
        (event.id === C.MOVE_RANGE_COMMAND ||
          event.id === C.MOVE_ROWS_COMMAND ||
          C.RANGE_SHIFT_COMMAND_PATTERN.test(event.id)) &&
        state.file.sheets.find((candidate) => candidate.id === subUnitId)?.pivotRanges.length
      ) {
        event.cancel = true
        setMessage(t('appPivotSheetNoMove'))
      }
      return
    }
    if (event.id === C.AUTO_FILL_COMMAND && !state.flags.preloadComplete) {
      // Dragging a fill into an unstreamed region would overwrite data the
      // person never saw.
      const target = (event.params as { targetRange?: IRange } | undefined)?.targetRange
      const subUnitId = subUnitIdOf()
      const sheet = state.file.sheets.find((candidate) => candidate.id === subUnitId)
      const loaded = subUnitId === undefined ? undefined : state.loadedRanges.get(subUnitId)
      const ops =
        subUnitId === undefined ? [] : (state.editJournal.structuralOps.get(subUnitId) ?? [])
      const beyondRow = sheet === undefined ? 0 : sheet.rowCount + netAxisDelta(ops, 'row')
      const beyondColumn = sheet === undefined ? 0 : sheet.columnCount + netAxisDelta(ops, 'column')
      const covered =
        target !== undefined &&
        (target.startRow >= beyondRow ||
          target.startColumn >= beyondColumn ||
          (loaded !== undefined &&
            target.startRow >= loaded.startRow &&
            target.endRow <= loaded.endRow &&
            target.startColumn >= loaded.startColumn &&
            target.endColumn <= loaded.endColumn))
      if (!covered) {
        event.cancel = true
        setMessage(t('appAutofillStreaming'))
      }
      return
    }
    if (C.DV_EDIT_COMMAND_PATTERN.test(event.id)) {
      const subUnitId = subUnitIdOf()
      const isAddedSheet = subUnitId !== undefined && state.editJournal.sheets.added.has(subUnitId)
      // The save rewrites the whole section from Univer's model, so the
      // file's own rules must be in the model before any edit.
      if (!isAddedSheet && (subUnitId === undefined || !state.appliedDvSheets.has(subUnitId))) {
        event.cancel = true
        setMessage(t('appDvNeedsIndexed'))
      }
      return
    }
    if (
      C.STRUCTURE_LOCK_COMMANDS.has(event.id) &&
      pcUniverSyncJournal.workbookStructureLocked(state)
    ) {
      event.cancel = true
      setMessage(t('appWorkbookStructureLocked'))
      return
    }
    // The phone offers no sheet duplication (the desktop journals it with
    // stream aliases this listener does not keep).
    if (event.id === C.COPY_SHEET_COMMAND) {
      event.cancel = true
      return
    }
    if (C.BLOCKED_COMMAND_PATTERN.test(event.id)) {
      event.cancel = true
      setMessage(t('appMoveRowsColsUnsaved'))
    }
  })
  return () => disposable.dispose()
}
