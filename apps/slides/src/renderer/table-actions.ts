/**
 * Table editing actions extracted from App.tsx: row/column structure, merge/split,
 * resize, cell text commit, Tab/arrow navigation, multi-cell selection formatting,
 * clipboard TSV copy/cut/paste, and range merging.
 * Functions read the latest App state through ActionCtx.
 */
import type { RenderSlide, TableRenderNode } from '@genoffice/pptx-render'
import type { EditParagraph } from '../shared/ipc'
import type { ActionCtx, EditingCellState } from './action-context'
import { FIT_WIDTH } from './app-constants'
import { batched } from './history-batch'
import { t } from './i18n/locale'
import {
  adjacentTableCell,
  buildPatchedCellParagraphs,
  cellsToTsv,
  makeTableCellSelection,
  selectAllTableCells,
  tableMergeRangePlan,
  type CellCoord,
  type CellNavDir,
  type CellParagraphPatch,
} from './table-selection'

let cellSessionSeq = 1
export function nextCellSession(): number {
  return cellSessionSeq++
}

/** Serialize async table cell writes so a blur commit finishes before a subsequent edit lands. */
let cellCommitTail: Promise<unknown> = Promise.resolve()
function enqueueCellWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = cellCommitTail.then(fn, fn)
  cellCommitTail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export async function tableStructureOp(
  ctx: ActionCtx,
  sourceId: string,
  kind: 'insert-row' | 'delete-row' | 'insert-col' | 'delete-col',
  index: number,
  before?: boolean,
): Promise<void> {
  const r = await window.slidesApi.tableStructure({
    slideIndex: ctx.current,
    sourceId,
    kind,
    index,
    ...(before ? { before: true } : {}),
  })
  if (r) {
    ctx.applySlide(ctx.current, r.slide)
    ctx.setSelectedIds([r.sourceId])
    ctx.setEditingCell(null)
    ctx.setTableSelection?.(null)
  } else {
    ctx.setStatus(
      kind.startsWith('delete')
        ? t('appStatusTableDeleteLimit')
        : t('appStatusTableMergedUnsupported'),
    )
  }
}

export async function tableMergeOp(
  ctx: ActionCtx,
  sourceId: string,
  kind: 'merge-right' | 'merge-down' | 'split',
  row: number,
  col: number,
): Promise<void> {
  const r = await window.slidesApi.tableMerge({
    slideIndex: ctx.current,
    sourceId,
    kind,
    row,
    col,
  })
  if (r) {
    ctx.applySlide(ctx.current, r.slide)
    ctx.setSelectedIds([r.sourceId])
    ctx.setEditingCell(null)
    ctx.setTableSelection?.(null)
  } else {
    ctx.setStatus(t('appStatusMergeFailed'))
  }
}

/** Merge a contiguous single-row or single-column multi-cell selection in one undo step. */
export async function mergeSelectedCells(
  ctx: ActionCtx,
  sourceId: string,
  cells: readonly CellCoord[],
): Promise<void> {
  const tbl = ctx.slide?.nodes.find((n) => n.sourceId === sourceId)
  if (!tbl || tbl.type !== 'table') return
  const plan = tableMergeRangePlan(tbl, cells)
  if (!plan) {
    ctx.setStatus(t('appStatusMergeFailed'))
    return
  }
  const slideIndex = ctx.current
  const res = await batched(async () => {
    let curId = sourceId
    let lastSlide: RenderSlide | null = null
    for (let i = 0; i < plan.steps; i++) {
      const r = await window.slidesApi.tableMerge({
        slideIndex,
        sourceId: curId,
        kind: plan.kind,
        row: plan.anchor.row,
        col: plan.anchor.col,
      })
      if (!r) return null
      curId = r.sourceId
      lastSlide = r.slide
    }
    return lastSlide ? { slide: lastSlide, sourceId: curId } : null
  })
  if (res) {
    ctx.applySlide(slideIndex, res.slide)
    ctx.setSelectedIds([res.sourceId])
    ctx.setEditingCell(null)
    ctx.setTableSelection?.(null)
  } else {
    ctx.setStatus(t('appStatusMergeFailed'))
  }
}

export async function onTableColResize(
  ctx: ActionCtx,
  sourceId: string,
  col: number,
  wPx: number,
): Promise<void> {
  const updated = await window.slidesApi.setTableColWidth({
    slideIndex: ctx.current,
    sourceId,
    col,
    wPx,
    fitWidthPx: FIT_WIDTH,
  })
  if (updated) ctx.applySlide(ctx.current, updated)
}

export async function onTableRowResize(
  ctx: ActionCtx,
  sourceId: string,
  row: number,
  hPx: number,
): Promise<void> {
  const updated = await window.slidesApi.setTableRowHeight({
    slideIndex: ctx.current,
    sourceId,
    row,
    hPx,
    fitWidthPx: FIT_WIDTH,
  })
  if (updated) ctx.applySlide(ctx.current, updated)
}

/**
 * Commit one cell's text edit. Only clears editingCell if it still matches the session
 * that initiated the commit, preventing an async blur commit from closing a newly opened cell.
 */
export async function commitCellEdit(
  ctx: ActionCtx,
  paragraphs: EditParagraph[],
  target?: EditingCellState,
): Promise<void> {
  const cell = target ?? ctx.editingCell
  if (!cell) return
  const slideIndex = ctx.current
  const session = cell.session
  const updated = await enqueueCellWrite(() =>
    window.slidesApi.editTableCell({
      slideIndex,
      sourceId: cell.sourceId,
      row: cell.row,
      col: cell.col,
      paragraphs,
    }),
  )
  if (updated) ctx.applySlide(slideIndex, updated)
  ctx.setEditingCell((cur) => (cur && cur.session === session ? null : cur))
}

/** Save changed paragraphs for a cell without closing whatever new cell/selection follows. */
export async function commitCellSilently(
  ctx: ActionCtx,
  cell: Pick<EditingCellState, 'sourceId' | 'row' | 'col'>,
  paragraphs: EditParagraph[] | null,
): Promise<RenderSlide | null> {
  if (!paragraphs) return null
  const slideIndex = ctx.current
  const updated = await enqueueCellWrite(() =>
    window.slidesApi.editTableCell({
      slideIndex,
      sourceId: cell.sourceId,
      row: cell.row,
      col: cell.col,
      paragraphs,
    }),
  )
  if (updated) ctx.applySlide(slideIndex, updated)
  return updated
}

/** Cell Tab/Shift+Tab: commit the current cell (if content changed) and jump to the next/previous cell;
 * Tab on the last cell auto-adds a row and enters its first cell. */
export async function navigateCell(
  ctx: ActionCtx,
  paragraphs: EditParagraph[] | null,
  dir: 1 | -1,
): Promise<void> {
  const { editingCell, slide, current } = ctx
  if (!editingCell || !slide) return
  const tbl = slide.nodes.find((n) => n.sourceId === editingCell.sourceId)
  if (!tbl || tbl.type !== 'table') return
  const cells = [...tbl.cells].sort((a, b) => a.row - b.row || a.col - b.col)
  const idx = cells.findIndex((c) => c.row === editingCell.row && c.col === editingCell.col)
  const next = cells[idx + dir]
  if (next) {
    // Open the next cell immediately so typing never stalls on IPC; commit the old cell in order
    ctx.setTableSelection(null)
    ctx.setEditingCell({
      sourceId: editingCell.sourceId,
      row: next.row,
      col: next.col,
      selectAll: true,
      session: nextCellSession(),
    })
    await commitCellSilently(ctx, editingCell, paragraphs)
    return
  }
  await commitCellSilently(ctx, editingCell, paragraphs)
  if (dir > 0) {
    // Tab on the last cell: add a row and enter its first cell
    const lastRow = Math.max(...cells.map((c) => c.row))
    const r = await enqueueCellWrite(() =>
      window.slidesApi.tableStructure({
        slideIndex: current,
        sourceId: editingCell.sourceId,
        kind: 'insert-row',
        index: lastRow,
      }),
    )
    if (r) {
      ctx.applySlide(current, r.slide)
      ctx.setSelectedIds([r.sourceId])
      ctx.setTableSelection(null)
      const firstCol = Math.min(...cells.filter((c) => c.row === lastRow).map((c) => c.col))
      ctx.setEditingCell({
        sourceId: r.sourceId,
        row: lastRow + 1,
        col: firstCol,
        session: nextCellSession(),
      })
    }
  }
  // Shift+Tab on the first cell: stay in place
}

/** Arrow key at cell text edge: commit current cell (if changed) and move to the adjacent cell. */
export function navigateCellArrow(
  ctx: ActionCtx,
  paragraphs: EditParagraph[] | null,
  dir: CellNavDir,
): boolean {
  const { editingCell, slide } = ctx
  if (!editingCell || !slide) return false
  const tbl = slide.nodes.find((n) => n.sourceId === editingCell.sourceId)
  if (!tbl || tbl.type !== 'table') return false
  const next = adjacentTableCell(tbl, editingCell, dir)
  if (!next) return false
  ctx.setTableSelection(null)
  ctx.setEditingCell({
    sourceId: editingCell.sourceId,
    row: next.row,
    col: next.col,
    caret: { place: dir === 'left' || dir === 'up' ? 'end' : 'start' },
    session: nextCellSession(),
  })
  void commitCellSilently(ctx, editingCell, paragraphs)
  return true
}

/** Shift+Arrow past cell text edge: commit and switch to multi-cell selection including the neighbor. */
export function extendCellSelectionFromEdit(
  ctx: ActionCtx,
  paragraphs: EditParagraph[] | null,
  dir: CellNavDir,
): boolean {
  const { editingCell, slide } = ctx
  if (!editingCell || !slide) return false
  const tbl = slide.nodes.find((n) => n.sourceId === editingCell.sourceId)
  if (!tbl || tbl.type !== 'table') return false
  const next = adjacentTableCell(tbl, editingCell, dir)
  if (!next) return false
  const anchor = { row: editingCell.row, col: editingCell.col }
  ctx.setEditingCell(null)
  ctx.setSelectedIds([tbl.sourceId])
  ctx.setTableSelection(makeTableCellSelection(tbl, anchor, next))
  void commitCellSilently(ctx, editingCell, paragraphs)
  return true
}

/** Second Ctrl/Cmd+A inside cell editor: commit and select all cells of the table. */
export function selectAllCellsFromEdit(ctx: ActionCtx, paragraphs: EditParagraph[] | null): void {
  const { editingCell, slide } = ctx
  if (!editingCell || !slide) return
  const tbl = slide.nodes.find((n) => n.sourceId === editingCell.sourceId)
  if (!tbl || tbl.type !== 'table') return
  const sel = selectAllTableCells(tbl)
  if (!sel) return
  ctx.setEditingCell(null)
  ctx.setSelectedIds([tbl.sourceId])
  ctx.setTableSelection(sel)
  void commitCellSilently(ctx, editingCell, paragraphs)
}

/** Apply a run/paragraph/clear patch to the given cells of a table as a single undo step. */
export async function applyPatchToTableCells(
  ctx: ActionCtx,
  sourceId: string,
  cells: readonly CellCoord[],
  patch: CellParagraphPatch,
): Promise<void> {
  if (!ctx.slide || !cells.length) return
  const tbl = ctx.slide.nodes.find((n) => n.sourceId === sourceId)
  if (!tbl || tbl.type !== 'table') return
  const slideIndex = ctx.current
  const scale = ctx.slide.scale
  const plan: Array<{ row: number; col: number; paragraphs: EditParagraph[] }> = []
  for (const coord of cells) {
    const cell = tbl.cells.find((c) => c.row === coord.row && c.col === coord.col)
    if (!cell) continue
    const paragraphs = buildPatchedCellParagraphs(cell, scale, patch)
    if (paragraphs) plan.push({ row: cell.row, col: cell.col, paragraphs })
  }
  if (!plan.length) return
  const last = await enqueueCellWrite(() =>
    batched(async () => {
      let updated: RenderSlide | null = null
      for (const item of plan) {
        updated =
          (await window.slidesApi.editTableCell({
            slideIndex,
            sourceId,
            row: item.row,
            col: item.col,
            paragraphs: item.paragraphs,
          })) ?? updated
      }
      return updated
    }),
  )
  if (last) ctx.applySlide(slideIndex, last)
}

/** Clear text of all currently selected table cells without deleting the table. */
export async function clearSelectedTableCells(ctx: ActionCtx): Promise<void> {
  const sel = ctx.tableSelection
  if (!sel || !sel.cells.length) return
  await applyPatchToTableCells(ctx, sel.sourceId, sel.cells, { clearText: true })
}

/** Set vertical text anchor on one or many cells as a single undo step. */
export async function setTableCellsAnchor(
  ctx: ActionCtx,
  sourceId: string,
  cells: readonly CellCoord[],
  anchor: 'top' | 'middle' | 'bottom',
): Promise<void> {
  if (!cells.length) return
  const slideIndex = ctx.current
  const last = await enqueueCellWrite(() =>
    batched(async () => {
      let updated: RenderSlide | null = null
      for (const c of cells) {
        updated =
          (await window.slidesApi.setTableCellAnchor({
            slideIndex,
            sourceId,
            row: c.row,
            col: c.col,
            anchor,
          })) ?? updated
      }
      return updated
    }),
  )
  if (last) ctx.applySlide(slideIndex, last)
}

/** Copy selected table cells' text as TSV to the OS clipboard. */
export async function copySelectedTableCells(ctx: ActionCtx): Promise<boolean> {
  const sel = ctx.tableSelection
  if (!sel || !ctx.slide) return false
  const tbl = ctx.slide.nodes.find((n) => n.sourceId === sel.sourceId)
  if (!tbl || tbl.type !== 'table') return false
  const tsv = cellsToTsv(tbl, sel.cells)
  try {
    await navigator.clipboard.writeText(tsv)
    ctx.setHasClipboard(true)
    return true
  } catch {
    return false
  }
}

/** Cut selected table cells: copy as TSV, then clear their text. */
export async function cutSelectedTableCells(ctx: ActionCtx): Promise<boolean> {
  const ok = await copySelectedTableCells(ctx)
  if (ok) await clearSelectedTableCells(ctx)
  return ok
}

/** Paste a 2D text grid into a table starting at `startCell`, wrapping within table bounds. */
export async function pasteGridIntoTable(
  ctx: ActionCtx,
  sourceId: string,
  startCell: CellCoord,
  grid: string[][],
): Promise<boolean> {
  if (!ctx.slide || !grid.length) return false
  const tbl = ctx.slide.nodes.find((n) => n.sourceId === sourceId)
  if (!tbl || tbl.type !== 'table') return false
  const slideIndex = ctx.current
  const table = tbl as TableRenderNode

  // Map distinct logical row/col indices from rendered cells so merged tables paste cleanly
  const rowIds = [...new Set(table.cells.map((c) => c.row))].sort((a, b) => a - b)
  const startRowPos = rowIds.indexOf(startCell.row)
  if (startRowPos < 0) return false
  const startRowCells = table.cells
    .filter((c) => c.row === startCell.row)
    .sort((a, b) => a.col - b.col)
  const startColPos = startRowCells.findIndex((c) => c.col === startCell.col)
  if (startColPos < 0) return false

  const plan: Array<{ row: number; col: number; paragraphs: EditParagraph[] }> = []
  const touched: CellCoord[] = []
  for (let dr = 0; dr < grid.length; dr++) {
    const targetRow = rowIds[startRowPos + dr]
    if (targetRow === undefined) break
    const rowCells = table.cells.filter((c) => c.row === targetRow).sort((a, b) => a.col - b.col)
    const vals = grid[dr]!
    for (let dc = 0; dc < vals.length; dc++) {
      const targetCell = rowCells[startColPos + dc]
      if (!targetCell) break
      const paragraphs: EditParagraph[] = vals[dc]!.split('\n').map((line) => ({
        runs: [{ text: line }],
      }))
      plan.push({ row: targetCell.row, col: targetCell.col, paragraphs })
      touched.push({ row: targetCell.row, col: targetCell.col })
    }
  }
  if (!plan.length) return false

  const last = await enqueueCellWrite(() =>
    batched(async () => {
      let updated: RenderSlide | null = null
      for (const item of plan) {
        updated =
          (await window.slidesApi.editTableCell({
            slideIndex,
            sourceId,
            row: item.row,
            col: item.col,
            paragraphs: item.paragraphs,
          })) ?? updated
      }
      return updated
    }),
  )
  if (last) {
    ctx.applySlide(slideIndex, last)
    const nextTbl = last.nodes.find((n) => n.sourceId === sourceId)
    if (nextTbl?.type === 'table' && touched.length > 1) {
      ctx.setEditingCell(null)
      ctx.setTableSelection(
        makeTableCellSelection(nextTbl, touched[0]!, touched[touched.length - 1]!),
      )
    }
  }
  return true
}
