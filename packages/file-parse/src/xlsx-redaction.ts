import { isHidingName, parseHidingName } from '@genoffice/agent-core/hiding-name'
import { createValueNumbering, dependentPlaceholder } from '@genoffice/agent-core/hiding-values'
import { RedactionMarkError } from './redaction-error'

/**
 * Hidden cells of a workbook, read as another file's material.
 *
 * The mark is a defined name `IeumHide[<n>]_<label>` whose reference is the
 * hidden range (@genoffice/agent-core/hiding-name). Hiding is complete: every
 * cell inside reads as `{{label-NN}}` whatever it holds (a value, nothing, a
 * formula's text), one number per value and an empty cell counted as one
 * value, numbered afresh on every read. A cell whose formula leans on hidden
 * cells, through other cells or not, reads as `{{label+label}}`; so does a
 * pivot table built from them, and a formula this reader cannot follow
 * (INDIRECT, OFFSET, a defined name, a table or another workbook) counts as
 * leaning on every mark. The text reader does not read notes, validation
 * lists, charts or pivot caches at all, so nothing of theirs can leave.
 *
 * A mark whose reference cannot be resolved (a deleted sheet, `#REF!`, a
 * formula) throws, and the workbook is not read.
 */

/** Excel's grid: the last row and column a reference can name */
export const XLSX_MAX_ROW = 1_048_575
export const XLSX_MAX_COL = 16_383

/** A rectangle of one sheet, 0-based and inclusive. */
export interface XlsxArea {
  sheet: number
  r1: number
  c1: number
  r2: number
  c2: number
}

export interface XlsxHidingMark {
  name: string
  label: string
  areas: XlsxArea[]
}

export interface XlsxDefinedName {
  name: string
  ref: string
  /** the sheet a sheet-scoped name belongs to */
  localSheetId?: number
}

/**
 * Something whose value comes from other cells: a formula cell (one cell), an
 * array formula or a pivot table (the cells it fills). `refs` is what it reads,
 * or 'unknown' when that cannot be told.
 */
export interface XlsxDependent {
  area: XlsxArea
  refs: XlsxArea[] | 'unknown'
}

const SHEET = String.raw`(?:'((?:[^']|'')+)'|([\p{L}\p{N}_.]+))!`
const CELL = String.raw`\$?[A-Za-z]{1,3}\$?\d{1,7}`
const COLUMN = String.raw`\$?[A-Za-z]{1,3}`
const ROW = String.raw`\$?\d{1,7}`
const REFERENCE = String.raw`(?:(${CELL})(?::(${CELL}))?|(${COLUMN}):(${COLUMN})|(${ROW}):(${ROW}))`

/** a reference in a formula: not inside a longer name, not a function, not a sheet prefix */
const FORMULA_REF = new RegExp(
  String.raw`(?<![\p{L}\p{N}_.$!'\\])(?:${SHEET})?${REFERENCE}(?![\p{L}\p{N}_.(!\[])`,
  'gu',
)
/** one area of a defined name's reference, whole */
const NAME_AREA = new RegExp(String.raw`^(?:${SHEET})?${REFERENCE}$`, 'u')

const STRING_LITERAL = /"(?:[^"]|"")*"/g
const ERROR_LITERAL =
  /#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|GETTING_DATA|SPILL!|CALC!|FIELD!|BLOCKED!|CONNECT!|BUSY!|UNKNOWN!|PYTHON!)/gi
const IDENTIFIER = /(?<![\p{L}\p{N}_.$\\])[\p{L}_\\][\p{L}\p{N}_.\\?]*/gu
/** functions whose reference is computed, so what they read cannot be told from the text */
const COMPUTED_REFERENCE = new Set(['INDIRECT', 'OFFSET'])

function letters(label: string): number {
  let index = 0
  for (const ch of label.toUpperCase()) index = index * 26 + (ch.charCodeAt(0) - 64)
  return index - 1
}

function cellOf(text: string): { row: number; col: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(text)
  if (!m) return null
  const row = Number(m[2]) - 1
  const col = letters(m[1]!)
  return row >= 0 && row <= XLSX_MAX_ROW && col <= XLSX_MAX_COL ? { row, col } : null
}

function sheetIndexer(sheetNames: readonly string[]): (name: string) => number {
  const byName = new Map(sheetNames.map((name, i) => [name.toLowerCase(), i]))
  return (name) => byName.get(name.toLowerCase()) ?? -1
}

/** The area one matched reference names, or null when it names none (out of the grid). */
function areaOf(m: RegExpExecArray | RegExpMatchArray, sheet: number): XlsxArea | null {
  const [, , , from, to, colFrom, colTo, rowFrom, rowTo] = m
  if (from !== undefined) {
    const a = cellOf(from)
    const b = to === undefined ? a : cellOf(to)
    if (!a || !b) return null
    return {
      sheet,
      r1: Math.min(a.row, b.row),
      c1: Math.min(a.col, b.col),
      r2: Math.max(a.row, b.row),
      c2: Math.max(a.col, b.col),
    }
  }
  if (colFrom !== undefined && colTo !== undefined) {
    const a = letters(colFrom.replace('$', ''))
    const b = letters(colTo.replace('$', ''))
    if (Math.max(a, b) > XLSX_MAX_COL) return null
    return { sheet, r1: 0, c1: Math.min(a, b), r2: XLSX_MAX_ROW, c2: Math.max(a, b) }
  }
  const a = Number(rowFrom!.replace('$', '')) - 1
  const b = Number(rowTo!.replace('$', '')) - 1
  if (Math.min(a, b) < 0 || Math.max(a, b) > XLSX_MAX_ROW) return null
  return { sheet, r1: Math.min(a, b), c1: 0, r2: Math.max(a, b), c2: XLSX_MAX_COL }
}

function sheetNameOf(m: RegExpExecArray | RegExpMatchArray): string | undefined {
  if (m[1] !== undefined) return m[1].replace(/''/g, "'")
  return m[2]
}

/** a defined name's reference split into its areas, commas inside quoted sheet names kept */
function splitAreas(ref: string): string[] {
  const parts: string[] = []
  let current = ''
  let quoted = false
  for (const ch of ref) {
    if (ch === "'") quoted = !quoted
    if (ch === ',' && !quoted) {
      parts.push(current)
      current = ''
    } else current += ch
  }
  parts.push(current)
  return parts.map((part) => part.trim())
}

/**
 * The hiding marks among a workbook's defined names, each resolved to the
 * areas it hides. Throws when a mark names something that is not a plain
 * range of a sheet the workbook has.
 */
export function xlsxHidingMarksOf(
  names: readonly XlsxDefinedName[],
  sheetNames: readonly string[],
): XlsxHidingMark[] {
  const sheetOf = sheetIndexer(sheetNames)
  const marks: XlsxHidingMark[] = []
  for (const defined of names) {
    if (!isHidingName(defined.name)) continue
    const label = parseHidingName(defined.name)!.label
    const areas: XlsxArea[] = []
    for (const part of splitAreas(defined.ref.trim().replace(/^=/, ''))) {
      const m = NAME_AREA.exec(part)
      const sheetName = m ? sheetNameOf(m) : undefined
      const sheet =
        sheetName !== undefined
          ? sheetOf(sheetName)
          : defined.localSheetId !== undefined && defined.localSheetId < sheetNames.length
            ? defined.localSheetId
            : -1
      const area = m && sheet >= 0 ? areaOf(m, sheet) : null
      if (!area) {
        throw new RedactionMarkError(
          `the range of the hiding name ${defined.name} cannot be resolved`,
        )
      }
      areas.push(area)
    }
    marks.push({ name: defined.name, label, areas })
  }
  return marks
}

/**
 * The areas a formula reads, or 'unknown' when they cannot all be told from
 * its text: a computed reference, a defined name or variable, a structured or
 * external reference, a sheet the workbook does not have.
 */
export function formulaReferences(
  formula: string,
  sheet: number,
  sheetNames: readonly string[],
): XlsxArea[] | 'unknown' {
  const text = formula.replace(/^=/, '').replace(STRING_LITERAL, '""').replace(ERROR_LITERAL, ' ')
  if (text.includes('[')) return 'unknown'
  const sheetOf = sheetIndexer(sheetNames)
  const areas: XlsxArea[] = []
  for (const m of text.matchAll(FORMULA_REF)) {
    const name = sheetNameOf(m)
    const target = name === undefined ? sheet : sheetOf(name)
    const area = target >= 0 ? areaOf(m, target) : null
    if (!area) return 'unknown'
    areas.push(area)
  }
  const rest = text.replace(FORMULA_REF, (ref) => ' '.repeat(ref.length))
  for (const m of rest.matchAll(IDENTIFIER)) {
    const after = rest.slice(m.index! + m[0].length).trimStart()
    const word = m[0].toUpperCase().replace(/^_XL(?:FN|WS)\./, '')
    if (after.startsWith('(')) {
      if (COMPUTED_REFERENCE.has(word)) return 'unknown'
    } else if (word !== 'TRUE' && word !== 'FALSE') return 'unknown'
  }
  return areas
}

const intersects = (a: XlsxArea, b: XlsxArea) =>
  a.sheet === b.sheet && a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2

const contains = (a: XlsxArea, sheet: number, row: number, col: number) =>
  a.sheet === sheet && a.r1 <= row && row <= a.r2 && a.c1 <= col && col <= a.c2

/** the first index of a sorted list at or after `value` */
function lowerBound(list: readonly number[], value: number): number {
  let lo = 0
  let hi = list.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (list[mid]! < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

interface SheetIndex {
  /** sorted columns that hold one-cell dependents */
  columns: number[]
  /** per column: sorted rows, and the dependent at each */
  rows: Map<number, { rows: number[]; nodes: XlsxDependent[] }>
  /** dependents that fill more than one cell */
  wide: XlsxDependent[]
}

export interface XlsxRedactor {
  /** the text a cell reads as: its label when hidden or leaning on hidden cells, else `text` */
  cell(sheet: number, row: number, col: number, text: string): string
  /** whether a position is inside a hiding mark */
  hidden(sheet: number, row: number, col: number): boolean
}

/**
 * What the text reader writes for each cell. `lastRows[sheet]` is the last row
 * the reader parsed of that sheet (Infinity when it parsed all of it): a
 * reference past it reads cells nobody looked at, so it counts as unknown.
 */
export function createXlsxRedactor(
  marks: readonly XlsxHidingMark[],
  dependents: readonly XlsxDependent[],
  lastRows: readonly number[],
): XlsxRedactor {
  const numbering = createValueNumbering()
  const every = new Set(marks.map((mark) => mark.label))
  const indexes = new Map<number, SheetIndex>()
  const one = new Map<string, XlsxDependent[]>()
  for (const node of dependents) {
    const { sheet, r1, c1, r2, c2 } = node.area
    let index = indexes.get(sheet)
    if (!index) {
      index = { columns: [], rows: new Map(), wide: [] }
      indexes.set(sheet, index)
    }
    if (r1 !== r2 || c1 !== c2) {
      index.wide.push(node)
      continue
    }
    let column = index.rows.get(c1)
    if (!column) {
      column = { rows: [], nodes: [] }
      index.rows.set(c1, column)
    }
    column.rows.push(r1)
    column.nodes.push(node)
    const key = `${sheet}:${r1}:${c1}`
    one.set(key, [...(one.get(key) ?? []), node])
  }
  for (const index of indexes.values()) {
    index.columns = [...index.rows.keys()].sort((a, b) => a - b)
    for (const column of index.rows.values()) {
      const order = column.rows.map((_, i) => i).sort((a, b) => column.rows[a]! - column.rows[b]!)
      column.rows = order.map((i) => column.rows[i]!)
      column.nodes = order.map((i) => column.nodes[i]!)
    }
  }

  const markOf = (sheet: number, row: number, col: number): XlsxHidingMark | undefined =>
    marks.find((mark) => mark.areas.some((area) => contains(area, sheet, row, col)))

  /** what one dependent reads that is itself a dependent */
  function inputsOf(refs: readonly XlsxArea[]): XlsxDependent[] {
    const out: XlsxDependent[] = []
    for (const ref of refs) {
      const index = indexes.get(ref.sheet)
      if (!index) continue
      for (let i = lowerBound(index.columns, ref.c1); i < index.columns.length; i++) {
        const col = index.columns[i]!
        if (col > ref.c2) break
        const column = index.rows.get(col)!
        for (let j = lowerBound(column.rows, ref.r1); j < column.rows.length; j++) {
          if (column.rows[j]! > ref.r2) break
          out.push(column.nodes[j]!)
        }
      }
      for (const node of index.wide) if (intersects(node.area, ref)) out.push(node)
    }
    return out
  }

  /** the labels a dependent reads directly, or every label when it cannot be told */
  function ownLabels(node: XlsxDependent): Set<string> {
    if (node.refs === 'unknown') return new Set(every)
    const labels = new Set<string>()
    for (const ref of node.refs) {
      if (ref.r2 > (lastRows[ref.sheet] ?? -1)) return new Set(every)
      for (const mark of marks) {
        if (mark.areas.some((area) => intersects(area, ref))) labels.add(mark.label)
      }
    }
    return labels
  }

  const done = new Map<XlsxDependent, Set<string>>()
  const open = new Set<XlsxDependent>()

  /** the labels a dependent leans on, through other dependents too; iterative, chains run long */
  function labelsOf(start: XlsxDependent): Set<string> {
    const known = done.get(start)
    if (known) return known
    interface Frame {
      node: XlsxDependent
      inputs: XlsxDependent[]
      next: number
      labels: Set<string>
    }
    const enter = (node: XlsxDependent): Frame => {
      open.add(node)
      const labels = ownLabels(node)
      const inputs =
        labels.size === every.size || node.refs === 'unknown' ? [] : inputsOf(node.refs)
      return { node, inputs, next: 0, labels }
    }
    const stack: Frame[] = [enter(start)]
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!
      if (frame.labels.size < every.size && frame.next < frame.inputs.length) {
        const input = frame.inputs[frame.next++]!
        const finished = done.get(input)
        if (finished) for (const label of finished) frame.labels.add(label)
        // a circular reference: what goes round cannot be told, so it leans on everything
        else if (open.has(input)) for (const label of every) frame.labels.add(label)
        else stack.push(enter(input))
        continue
      }
      stack.pop()
      open.delete(frame.node)
      done.set(frame.node, frame.labels)
      const parent = stack[stack.length - 1]
      if (parent) for (const label of frame.labels) parent.labels.add(label)
    }
    return done.get(start)!
  }

  return {
    hidden: (sheet, row, col) => markOf(sheet, row, col) !== undefined,
    cell(sheet, row, col, text) {
      const mark = markOf(sheet, row, col)
      if (mark) return numbering.placeholder(mark.label, text)
      const index = indexes.get(sheet)
      const nodes = [
        ...(one.get(`${sheet}:${row}:${col}`) ?? []),
        ...(index?.wide.filter((node) => contains(node.area, sheet, row, col)) ?? []),
      ]
      const labels = new Set<string>()
      for (const node of nodes) for (const label of labelsOf(node)) labels.add(label)
      return labels.size > 0 ? dependentPlaceholder(labels) : text
    },
  }
}

/** One area written the way a defined name or a pivot source writes it: `A1:B2`, `B:B`, `2:5`. */
export function areaOfReference(ref: string, sheet: number): XlsxArea | null {
  const m = new RegExp(`^${REFERENCE}$`, 'u').exec(ref.trim())
  return m
    ? areaOf(['', undefined, undefined, ...m.slice(1)] as unknown as RegExpMatchArray, sheet)
    : null
}
