/**
 * The sensitive-info hiding marks of the open workbook, read from its defined
 * names.
 *
 * A mark is a defined name `IeumHide[<n>]_<label>` (file contract, see
 * `@genoffice/agent-core/hiding-name`) whose reference is the hidden range:
 * whole columns below a header (`'Sheet'!$B$2:$B$1048576`), whole columns
 * (`'Sheet'!$B:$B`) or cell ranges (`'Sheet'!$C$3:$D$9`), several areas joined
 * by commas. Univer keeps the reference current as rows, columns and sheets
 * change, so the live name table is the source; names the engine could not
 * install (`uninstalledDefinedNames`) only live in the file.
 *
 * A mark this reader cannot resolve to plain ranges of sheets the workbook has
 * (a deleted sheet, `#REF!`, a formula, a name Univer refused) fails closed:
 * the workbook reports `ok: false` and nothing of it goes to the model.
 */
import { columnLabel } from '@genoffice/xlsx-gateway/domain/cell-address'
import { isHidingName, parseHidingName } from '@genoffice/agent-core/hiding-name'
import type { LazyWorkbookState, UniverRuntime } from '../univer-state'

/** Excel's grid: the last row and column a reference can name (0-based). */
export const HIDING_MAX_ROW = 1_048_575
export const HIDING_MAX_COLUMN = 16_383

/** One rectangle of one sheet, 0-based and inclusive, in the grid's current coordinates. */
export interface HidingArea {
  readonly sheetId: string
  readonly startRow: number
  readonly endRow: number
  readonly startColumn: number
  readonly endColumn: number
}

export interface SheetHidingMark {
  /** the defined name, exactly as the workbook has it */
  readonly name: string
  /** the label the model reads (`{{label-NN}}`) */
  readonly label: string
  readonly areas: readonly HidingArea[]
}

export type SheetHidingMarks =
  | { readonly ok: true; readonly marks: readonly SheetHidingMark[] }
  /** some hiding name cannot be resolved: nothing of this workbook may be sent */
  | { readonly ok: false; readonly names: readonly string[] }

export interface HidingSheet {
  readonly id: string
  readonly name: string
}

export interface HidingDefinedName {
  readonly name: string
  readonly formula: string
  /** Univer's scope: a sheet id, or 'AllDefaultWorkbook' / undefined for the workbook */
  readonly localSheetId?: string | undefined
}

const SHEET = String.raw`(?:'((?:[^']|'')+)'|([\p{L}\p{N}_.]+))!`
const CELL = String.raw`\$?([A-Za-z]{1,3})\$?(\d{1,7})`
const AREA = new RegExp(
  String.raw`^(?:${SHEET})?(?:${CELL}(?::${CELL})?|\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})|\$?(\d{1,7}):\$?(\d{1,7}))$`,
  'u',
)

function columnIndex(letters: string): number {
  let index = 0
  for (const ch of letters.toUpperCase()) index = index * 26 + (ch.charCodeAt(0) - 64)
  return index - 1
}

/** a reference split at the commas that separate areas (commas inside quoted sheet names stay) */
function splitAreas(ref: string): string[] {
  const parts: string[] = []
  let current = ''
  let quoted = false
  for (const ch of ref) {
    if (ch === "'") quoted = !quoted
    if (ch === ',' && !quoted) {
      parts.push(current.trim())
      current = ''
    } else current += ch
  }
  parts.push(current.trim())
  return parts
}

function inGrid(row: number, column: number): boolean {
  return row >= 0 && row <= HIDING_MAX_ROW && column >= 0 && column <= HIDING_MAX_COLUMN
}

/**
 * The areas a hiding name's reference covers, or null when any part of it is
 * not a plain range of a sheet the workbook has. `scopeSheetId` resolves an
 * unqualified area (a sheet-scoped name).
 */
export function parseHidingReference(
  ref: string,
  sheets: readonly HidingSheet[],
  scopeSheetId?: string,
): HidingArea[] | null {
  const text = ref.trim().replace(/^=/, '')
  if (!text) return null
  const areas: HidingArea[] = []
  for (const part of splitAreas(text)) {
    const m = AREA.exec(part)
    if (!m) return null
    const sheetName = m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2]
    const sheetId =
      sheetName === undefined
        ? scopeSheetId
        : sheets.find((sheet) => sheet.name.toLowerCase() === sheetName.toLowerCase())?.id
    if (sheetId === undefined || !sheets.some((sheet) => sheet.id === sheetId)) return null
    let area: HidingArea
    if (m[3] !== undefined && m[4] !== undefined) {
      const r1 = Number(m[4]) - 1
      const c1 = columnIndex(m[3])
      const r2 = m[6] !== undefined ? Number(m[6]) - 1 : r1
      const c2 = m[5] !== undefined ? columnIndex(m[5]) : c1
      if (!inGrid(r1, c1) || !inGrid(r2, c2)) return null
      area = {
        sheetId,
        startRow: Math.min(r1, r2),
        endRow: Math.max(r1, r2),
        startColumn: Math.min(c1, c2),
        endColumn: Math.max(c1, c2),
      }
    } else if (m[7] !== undefined && m[8] !== undefined) {
      const c1 = columnIndex(m[7])
      const c2 = columnIndex(m[8])
      if (!inGrid(0, c1) || !inGrid(0, c2)) return null
      area = {
        sheetId,
        startRow: 0,
        endRow: HIDING_MAX_ROW,
        startColumn: Math.min(c1, c2),
        endColumn: Math.max(c1, c2),
      }
    } else {
      const r1 = Number(m[9]) - 1
      const r2 = Number(m[10]) - 1
      if (!inGrid(r1, 0) || !inGrid(r2, 0)) return null
      area = {
        sheetId,
        startRow: Math.min(r1, r2),
        endRow: Math.max(r1, r2),
        startColumn: 0,
        endColumn: HIDING_MAX_COLUMN,
      }
    }
    areas.push(area)
  }
  return areas
}

function quotedSheetName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`
}

/** One area as a defined name writes it, absolute, sheet-qualified. */
export function formatHidingArea(area: HidingArea, sheets: readonly HidingSheet[]): string {
  const sheet = sheets.find((candidate) => candidate.id === area.sheetId)
  if (!sheet) throw new Error(`Unknown sheet: ${area.sheetId}`)
  const from = `$${columnLabel(area.startColumn)}$${area.startRow + 1}`
  const to = `$${columnLabel(area.endColumn)}$${area.endRow + 1}`
  return `${quotedSheetName(sheet.name)}!${from === to ? from : `${from}:${to}`}`
}

/** A hiding name's whole reference: its areas joined by commas. */
export function formatHidingReference(
  areas: readonly HidingArea[],
  sheets: readonly HidingSheet[],
): string {
  return areas.map((area) => formatHidingArea(area, sheets)).join(',')
}

/**
 * The marks among a workbook's defined names. `uninstalled` lists names that
 * live only in the file (the engine refused them); a hiding name among them
 * cannot be followed, so the workbook fails closed.
 */
export function resolveHidingMarks(
  names: readonly HidingDefinedName[],
  sheets: readonly HidingSheet[],
  uninstalled: Iterable<string> = [],
): SheetHidingMarks {
  const broken: string[] = [...uninstalled].filter(isHidingName)
  const marks: SheetHidingMark[] = []
  for (const defined of names) {
    if (!isHidingName(defined.name)) continue
    const scope =
      defined.localSheetId !== undefined && defined.localSheetId !== 'AllDefaultWorkbook'
        ? defined.localSheetId
        : undefined
    const areas = parseHidingReference(defined.formula, sheets, scope)
    const parsed = parseHidingName(defined.name)
    if (!areas || !parsed) {
      broken.push(defined.name)
      continue
    }
    marks.push({ name: defined.name, label: parsed.label, areas })
  }
  return broken.length > 0 ? { ok: false, names: broken } : { ok: true, marks }
}

interface UniverNameLike {
  getName(): string
  getFormulaOrRefString(): string
  getLocalSheetId(): string | undefined
}

/** The sheets of the open workbook, in tab order. */
export function hidingSheetsOf(runtime: UniverRuntime | null): HidingSheet[] {
  const workbook = runtime?.univerAPI.getActiveWorkbook()
  if (!workbook) return []
  return workbook
    .getSheets()
    .map((sheet) => ({ id: sheet.getSheetId(), name: sheet.getSheetName() }))
}

/** The live defined names of the open workbook (empty when none is open). */
export function liveDefinedNames(runtime: UniverRuntime | null): HidingDefinedName[] {
  const workbook = runtime?.univerAPI.getActiveWorkbook() as unknown as
    { getDefinedNames(): UniverNameLike[] } | null | undefined
  if (!workbook) return []
  return workbook.getDefinedNames().map((defined) => ({
    name: defined.getName(),
    formula: defined.getFormulaOrRefString(),
    localSheetId: defined.getLocalSheetId(),
  }))
}

/** The marks of the open workbook, read from Univer's name table now. */
export function readHidingMarks(
  runtime: UniverRuntime | null,
  state: Pick<LazyWorkbookState, 'uninstalledDefinedNames'> | null,
): SheetHidingMarks {
  return resolveHidingMarks(
    liveDefinedNames(runtime),
    hidingSheetsOf(runtime),
    state?.uninstalledDefinedNames ?? [],
  )
}

/** Whether the workbook holds any hiding name at all, resolvable or not. */
export function workbookHasHidingNames(
  runtime: UniverRuntime | null,
  state: Pick<LazyWorkbookState, 'uninstalledDefinedNames'> | null,
): boolean {
  return (
    liveDefinedNames(runtime).some((defined) => isHidingName(defined.name)) ||
    [...(state?.uninstalledDefinedNames ?? [])].some(isHidingName)
  )
}

export function areasIntersect(a: HidingArea, b: HidingArea): boolean {
  return (
    a.sheetId === b.sheetId &&
    a.startRow <= b.endRow &&
    b.startRow <= a.endRow &&
    a.startColumn <= b.endColumn &&
    b.startColumn <= a.endColumn
  )
}

export function areaContains(
  area: HidingArea,
  sheetId: string,
  row: number,
  column: number,
): boolean {
  return (
    area.sheetId === sheetId &&
    area.startRow <= row &&
    row <= area.endRow &&
    area.startColumn <= column &&
    column <= area.endColumn
  )
}

/** The mark that hides a cell, if any. */
export function markAt(
  marks: readonly SheetHidingMark[],
  sheetId: string,
  row: number,
  column: number,
): SheetHidingMark | undefined {
  return marks.find((mark) => mark.areas.some((area) => areaContains(area, sheetId, row, column)))
}

/** The marks that cover any cell of an area. */
export function marksTouching(
  marks: readonly SheetHidingMark[],
  area: HidingArea,
): SheetHidingMark[] {
  return marks.filter((mark) => mark.areas.some((own) => areasIntersect(own, area)))
}
