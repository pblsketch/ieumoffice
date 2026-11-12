/**
 * What a person does with sensitive-info hiding in the grid: hide a column or
 * a cell range, and stop hiding. Each mark is a workbook-scope defined name
 * created through Univer's name table, so it rides the existing defined-names
 * save path and its undo; the journal marks the names dirty from the name
 * mutation itself.
 *
 * A column hidden from its header hides the column below the header: the
 * header cell is the column's first cell with a value, when that value is text
 * and some value sits below it. The stored range is the exact boundary; the
 * header is judged once, when the mark is made, and stays visible to the AI.
 */
import { nextHidingName } from '@genoffice/agent-core/hiding-name'
import type { CellScalar } from '@genoffice/xlsx-gateway/domain/workbook.types'
import type { UniverRuntime } from '../univer-state'
import {
  HIDING_MAX_COLUMN,
  HIDING_MAX_ROW,
  areasIntersect,
  formatHidingReference,
  hidingSheetsOf,
  liveDefinedNames,
  readHidingMarks,
  type HidingArea,
} from './marks'

/** How many top cells of a column the header judgement reads. */
export const HEADER_SCAN_ROWS = 200

function filled(value: CellScalar | undefined): boolean {
  return value !== null && value !== undefined && value !== ''
}

/**
 * Where hiding a whole column starts: the row below its header, or 0 when the
 * column has none. `values` are the column's top cells, row 0 first.
 */
export function columnHideStart(values: readonly (CellScalar | undefined)[]): number {
  const first = values.findIndex(filled)
  if (first < 0) return 0
  const head = values[first]
  if (typeof head !== 'string' || !Number.isNaN(Number(head.trim()))) return 0
  return values.slice(first + 1).some(filled) ? first + 1 : 0
}

/** The header text of a column hidden below its header, offered as the label. */
export function columnHeaderText(values: readonly (CellScalar | undefined)[]): string {
  const start = columnHideStart(values)
  const head = start > 0 ? values[start - 1] : undefined
  return typeof head === 'string' ? head.trim() : ''
}

export interface SelectionArea {
  readonly area: HidingArea
  /** the selection covers whole columns (a column header was clicked) */
  readonly wholeColumns: boolean
}

interface RangeLike {
  getRange(): {
    startRow: number
    endRow: number
    startColumn: number
    endColumn: number
    rangeType?: number
  }
}

/** Univer's RANGE_TYPE.COLUMN */
const RANGE_TYPE_COLUMN = 2

/** The ranges selected on the active sheet, as hiding areas. */
export function selectedAreas(runtime: UniverRuntime | null): SelectionArea[] {
  const workbook = runtime?.univerAPI.getActiveWorkbook()
  const sheet = workbook?.getActiveSheet()
  if (!workbook || !sheet) return []
  const sheetId = sheet.getSheetId()
  const rowCount = sheet.getMaxRows()
  const list = (
    sheet as unknown as {
      getSelection(): { getActiveRangeList(): RangeLike[] } | null
    }
  )
    .getSelection()
    ?.getActiveRangeList()
  const ranges: RangeLike[] = list?.length
    ? list
    : (() => {
        const active = workbook.getActiveRange() as unknown as RangeLike | null
        return active ? [active] : []
      })()
  return ranges.map((range) => {
    const bounds = range.getRange()
    const wholeColumns =
      bounds.rangeType === RANGE_TYPE_COLUMN ||
      (bounds.startRow === 0 && bounds.endRow >= rowCount - 1)
    return {
      wholeColumns,
      area: {
        sheetId,
        startRow: wholeColumns ? 0 : bounds.startRow,
        endRow: wholeColumns ? HIDING_MAX_ROW : bounds.endRow,
        startColumn: bounds.startColumn,
        endColumn: Math.min(bounds.endColumn, HIDING_MAX_COLUMN),
      },
    }
  })
}

export interface HideTarget {
  readonly areas: readonly HidingArea[]
  /** offered as the label: the header text of a hidden column, else empty */
  readonly seed: string
}

/**
 * What hiding the selection hides. Whole columns lose their header row: each
 * column is judged on its own top cells (`readColumn`).
 */
export async function hideTargetOf(
  selection: readonly SelectionArea[],
  readColumn: (sheetId: string, column: number) => Promise<readonly (CellScalar | undefined)[]>,
): Promise<HideTarget | null> {
  if (selection.length === 0) return null
  const areas: HidingArea[] = []
  let seed = ''
  for (const { area, wholeColumns } of selection) {
    if (!wholeColumns) {
      areas.push(area)
      continue
    }
    for (let column = area.startColumn; column <= area.endColumn; column += 1) {
      const values = await readColumn(area.sheetId, column)
      const start = columnHideStart(values)
      if (!seed) seed = columnHeaderText(values)
      const previous = areas[areas.length - 1]
      // neighbouring columns that start on the same row stay one area
      if (
        previous &&
        previous.sheetId === area.sheetId &&
        previous.endColumn === column - 1 &&
        previous.startRow === start &&
        previous.endRow === HIDING_MAX_ROW
      ) {
        areas[areas.length - 1] = { ...previous, endColumn: column }
      } else {
        areas.push({
          sheetId: area.sheetId,
          startRow: start,
          endRow: HIDING_MAX_ROW,
          startColumn: column,
          endColumn: column,
        })
      }
    }
  }
  return { areas, seed }
}

interface DefinedNameFacade {
  getName(): string
  setRef(ref: string): void
  delete(): void
}

interface WorkbookNames {
  insertDefinedName(name: string, ref: string): void
  getDefinedNames(): DefinedNameFacade[]
}

function workbookNames(runtime: UniverRuntime): WorkbookNames | null {
  return runtime.univerAPI.getActiveWorkbook() as unknown as WorkbookNames | null
}

/** Make a mark for these areas; returns its defined name. */
export function createHidingMark(
  runtime: UniverRuntime,
  areas: readonly HidingArea[],
  label: string,
  lang: string,
): string | null {
  const workbook = workbookNames(runtime)
  if (!workbook || areas.length === 0) return null
  const existing = liveDefinedNames(runtime).map((defined) => defined.name)
  const name = nextHidingName(label, lang, existing)
  workbook.insertDefinedName(name, formatHidingReference(areas, hidingSheetsOf(runtime)))
  return name
}

/** `a` minus `b`: up to four rectangles. */
export function subtractArea(a: HidingArea, b: HidingArea): HidingArea[] {
  if (!areasIntersect(a, b)) return [a]
  const out: HidingArea[] = []
  if (a.startRow < b.startRow) out.push({ ...a, endRow: b.startRow - 1 })
  if (a.endRow > b.endRow) out.push({ ...a, startRow: b.endRow + 1 })
  const top = Math.max(a.startRow, b.startRow)
  const bottom = Math.min(a.endRow, b.endRow)
  if (a.startColumn < b.startColumn) {
    out.push({ ...a, startRow: top, endRow: bottom, endColumn: b.startColumn - 1 })
  }
  if (a.endColumn > b.endColumn) {
    out.push({ ...a, startRow: top, endRow: bottom, startColumn: b.endColumn + 1 })
  }
  return out
}

/**
 * Stop hiding what the selection covers: marks wholly inside it go, marks it
 * cuts keep the rest. Returns how many marks changed.
 */
export function removeHiding(runtime: UniverRuntime, selection: readonly HidingArea[]): number {
  const workbook = workbookNames(runtime)
  const marks = readHidingMarks(runtime, null)
  if (!workbook || !marks.ok) return 0
  const sheets = hidingSheetsOf(runtime)
  let changed = 0
  for (const mark of marks.marks) {
    let rest = [...mark.areas]
    for (const cut of selection) rest = rest.flatMap((area) => subtractArea(area, cut))
    if (rest.length === mark.areas.length && rest.every((area, i) => area === mark.areas[i])) {
      continue
    }
    const facade = workbook.getDefinedNames().find((defined) => defined.getName() === mark.name)
    if (!facade) continue
    if (rest.length === 0) facade.delete()
    else facade.setRef(formatHidingReference(rest, sheets))
    changed += 1
  }
  return changed
}
