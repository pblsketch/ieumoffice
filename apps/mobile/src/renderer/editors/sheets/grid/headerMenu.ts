/**
 * The row and column header menu (spec 2.2, 2.8-1): insert, delete, hide,
 * show and size, on the lines that are selected. Each entry sends the Univer
 * command the desktop's header right-click menu sends (Univer's ROW_HEADER /
 * COL_HEADER menu schema in @univerjs/sheets-ui, which the desktop uses with
 * only extra entries added by apps/sheets/src/renderer/cell-context-menu.ts),
 * so the edit journal records them exactly as on the desktop.
 */
import { IUniverInstanceService, RANGE_TYPE, type IRange } from '@univerjs/core'
import { SheetsSelectionsService, getSheetCommandTarget } from '@univerjs/sheets'
import type { UniverRuntime } from '../../../../../../sheets/src/renderer/univer-state'

export type HeaderAxis = 'row' | 'column'
export type HeaderAction = 'insertBefore' | 'insertAfter' | 'remove' | 'hide' | 'show' | 'size'

/** The desktop header menu's command per axis and entry. */
export const HEADER_MENU_COMMANDS: Readonly<
  Record<HeaderAxis, Readonly<Record<HeaderAction, string>>>
> = {
  row: {
    insertBefore: 'sheet.command.insert-multi-rows-above',
    insertAfter: 'sheet.command.insert-multi-rows-after',
    remove: 'sheet.command.remove-row-confirm',
    hide: 'sheet.command.hide-row-confirm',
    show: 'sheet.command.set-selected-rows-visible',
    size: 'sheet.command.set-row-height',
  },
  column: {
    insertBefore: 'sheet.command.insert-multi-cols-before',
    insertAfter: 'sheet.command.insert-multi-cols-right',
    remove: 'sheet.command.remove-col-confirm',
    hide: 'sheet.command.hide-col-confirm',
    show: 'sheet.command.set-selected-cols-visible',
    size: 'sheet.command.set-worksheet-col-width',
  },
}

/** Univer's header menu size input bounds (px), as on the desktop. */
export const HEADER_SIZE_MIN = 2
export const HEADER_SIZE_MAX = 1000

/** The selected lines of one axis: first and last index and how many. */
export interface AxisSpan {
  readonly axis: HeaderAxis
  readonly start: number
  readonly end: number
  readonly count: number
}

function selections(runtime: UniverRuntime) {
  return runtime.univer.__getInjector().get(SheetsSelectionsService)
}

/** The current selection's lines along `axis` (the last selection, as Univer's menu reads it). */
export function currentAxisSpan(runtime: UniverRuntime, axis: HeaderAxis): AxisSpan | null {
  const range = selections(runtime).getCurrentLastSelection()?.range
  if (!range) return null
  const start = axis === 'row' ? range.startRow : range.startColumn
  const end = axis === 'row' ? range.endRow : range.endColumn
  if (start < 0 || end < start) return null
  return { axis, start, end, count: end - start + 1 }
}

/** Whether line `index` lies inside a whole-line selection of `axis`. */
export function isHeaderLineSelected(
  runtime: UniverRuntime,
  axis: HeaderAxis,
  index: number,
): boolean {
  const wanted = axis === 'row' ? RANGE_TYPE.ROW : RANGE_TYPE.COLUMN
  return (selections(runtime).getCurrentSelections() ?? []).some(({ range }) => {
    if (range.rangeType !== wanted && range.rangeType !== RANGE_TYPE.ALL) return false
    return axis === 'row'
      ? range.startRow <= index && index <= range.endRow
      : range.startColumn <= index && index <= range.endColumn
  })
}

/**
 * Makes line `index` the selection, unless `keepSelection` (the line was
 * already inside a whole-line selection before the press: the menu then acts
 * on all of those lines, as in Excel). A fresh press selects that one line
 * only, even where Univer widened its header selection to a merged cell's
 * columns (Excel selects the one line).
 */
export function selectHeaderLine(
  runtime: UniverRuntime,
  axis: HeaderAxis,
  index: number,
  keepSelection = false,
): void {
  if (keepSelection && isHeaderLineSelected(runtime, axis, index)) return
  selectHeaderLines(runtime, axis, index, index)
}

/** Selects whole lines `start`..`end` of `axis` (a header selection). */
export function selectHeaderLines(
  runtime: UniverRuntime,
  axis: HeaderAxis,
  start: number,
  end: number,
): void {
  const injector = runtime.univer.__getInjector()
  const target = getSheetCommandTarget(injector.get(IUniverInstanceService))
  if (!target) return
  const { worksheet, unitId, subUnitId } = target
  const range: IRange =
    axis === 'row'
      ? {
          startRow: start,
          endRow: end,
          startColumn: 0,
          endColumn: worksheet.getColumnCount() - 1,
          rangeType: RANGE_TYPE.ROW,
        }
      : {
          startRow: 0,
          endRow: worksheet.getRowCount() - 1,
          startColumn: start,
          endColumn: end,
          rangeType: RANGE_TYPE.COLUMN,
        }
  injector.get(SheetsSelectionsService).setSelections(unitId, subUnitId, [
    {
      range,
      primary: {
        actualRow: range.startRow,
        actualColumn: range.startColumn,
        startRow: range.startRow,
        endRow: range.startRow,
        startColumn: range.startColumn,
        endColumn: range.startColumn,
        isMerged: false,
        isMergedMainCell: false,
      },
      style: null,
    },
  ])
}

/** The size (px) the size field starts from: the first selected line's. */
export function currentLineSize(runtime: UniverRuntime, axis: HeaderAxis): number | null {
  const span = currentAxisSpan(runtime, axis)
  const target = getSheetCommandTarget(runtime.univer.__getInjector().get(IUniverInstanceService))
  if (!span || !target) return null
  return axis === 'row'
    ? target.worksheet.getRowHeight(span.start)
    : target.worksheet.getColumnWidth(span.start)
}

/** Clamps a typed size to the header menu's bounds; `null` for anything not a number. */
export function parseLineSize(text: string): number | null {
  const value = Number(text.trim())
  if (!Number.isFinite(value) || text.trim() === '') return null
  return Math.min(HEADER_SIZE_MAX, Math.max(HEADER_SIZE_MIN, Math.round(value)))
}

/** The command id and params one menu entry sends for the current selection. */
export function headerCommandFor(
  axis: HeaderAxis,
  action: HeaderAction,
  span: AxisSpan,
  size?: number,
): { readonly id: string; readonly params?: object } {
  const id = HEADER_MENU_COMMANDS[axis][action]
  // The insert commands count from `value` (the menu's "insert N" field),
  // which the desktop fills with the number of selected lines.
  if (action === 'insertBefore' || action === 'insertAfter')
    return { id, params: { value: span.count } }
  if (action === 'size') return { id, params: { value: size } }
  return { id }
}

/**
 * Runs one header menu entry on the current selection. Resolves to false when
 * there is no selection, the command refused, or an edit gate cancelled it
 * (the gate says why through the journal's message).
 */
export async function runHeaderAction(
  runtime: UniverRuntime,
  axis: HeaderAxis,
  action: HeaderAction,
  size?: number,
): Promise<boolean> {
  const span = currentAxisSpan(runtime, axis)
  if (!span) return false
  if (action === 'size' && (size === undefined || !Number.isFinite(size))) return false
  const { id, params } = headerCommandFor(axis, action, span, size)
  try {
    return (await runtime.univerAPI.executeCommand(id, params)) === true
  } catch {
    // A cancelled command (edit gate) already reported its own message.
    return false
  }
}
