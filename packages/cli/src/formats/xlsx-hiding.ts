import JSZip from 'jszip'
import { PRODUCT_NAME } from '@genoffice/i18n'
import { isHidingName } from '@genoffice/agent-core/hiding-name'
import {
  createXlsxRedactor,
  formulaReferences,
  xlsxHidingMarksOf,
  type XlsxArea,
  type XlsxDefinedName,
  type XlsxDependent,
  type XlsxHidingMark,
  type XlsxRedactor,
} from '@genoffice/file-parse'
import { unreadableHiding } from '../hiding'

/**
 * Hidden cells of a workbook (민감정보 가리기) on the command line.
 *
 * The mark is a defined name `IeumHide[<n>]_<label>`; hiding is complete, as in
 * the app: a cell inside reads as `{{label-NN}}` whatever it holds (a value,
 * nothing, a formula's text), and a cell whose formula leans on hidden cells,
 * through other cells or not, reads as `{{label+label}}` with its formula text
 * left visible. The rules and the numbering are the ones the app uses for a
 * workbook read as another file's material (@genoffice/file-parse); this file
 * only finds, in the package's XML, what those rules need: the marks, and what
 * every formula and pivot table reads.
 *
 * A formula this reader cannot follow counts as leaning on every mark, so the
 * hiding errs on the side of hiding more. A mark that cannot be resolved fails
 * the read and the edit (closed).
 */

export interface WorkbookHiding {
  marks: XlsxHidingMark[]
  sheetNames: string[]
  redactor: XlsxRedactor
  dependents: XlsxDependent[]
}

function decode(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`).exec(attrs)
  return m ? decode(m[2]!) : undefined
}

function letters(label: string): number {
  let index = 0
  for (const ch of label.toUpperCase()) index = index * 26 + (ch.charCodeAt(0) - 64)
  return index - 1
}

function cellOf(ref: string): { row: number; col: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(ref)
  return m ? { row: Number(m[2]) - 1, col: letters(m[1]!) } : null
}

/** `A1` or `A1:C9` on one sheet */
function areaOf(ref: string, sheet: number): XlsxArea | null {
  const [a, b = a] = ref.split(':')
  const from = cellOf(a ?? '')
  const to = cellOf(b ?? '')
  if (!from || !to) return null
  return {
    sheet,
    r1: Math.min(from.row, to.row),
    c1: Math.min(from.col, to.col),
    r2: Math.max(from.row, to.row),
    c2: Math.max(from.col, to.col),
  }
}

function resolvePart(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = base.split('/').slice(0, -1)
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop()
    else if (piece !== '.') parts.push(piece)
  }
  return parts.join('/')
}

async function text(zip: JSZip, path: string): Promise<string | undefined> {
  const entry =
    zip.file(path) ??
    zip.file(new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'))[0]
  return entry ? entry.async('string') : undefined
}

/** relationship targets of a part, by type suffix */
async function relsOf(
  zip: JSZip,
  part: string,
): Promise<Array<{ id: string; type: string; target: string }>> {
  const xml = await text(zip, part.replace(/([^/]+)$/, '_rels/$1.rels'))
  if (!xml) return []
  return [...xml.matchAll(/<Relationship\b([^>]*)\/?>/g)]
    .map((m) => ({
      id: attr(m[1]!, 'Id') ?? '',
      type: attr(m[1]!, 'Type') ?? '',
      target: attr(m[1]!, 'Target') ?? '',
      external: (attr(m[1]!, 'TargetMode') ?? '').toLowerCase() === 'external',
    }))
    .filter((rel) => !rel.external)
    .map(({ id, type, target }) => ({ id, type, target: resolvePart(part, target) }))
}

/** Every formula cell and pivot table of one sheet, as what each reads. */
async function sheetDependents(
  zip: JSZip,
  path: string,
  sheet: number,
  sheetNames: readonly string[],
): Promise<XlsxDependent[]> {
  const xml = (await text(zip, path)) ?? ''
  const out: XlsxDependent[] = []
  const shared = new Map<
    string,
    { at: { row: number; col: number }; refs: XlsxDependent['refs']; range: XlsxArea | null }
  >()
  const children: Array<{ si: string; area: XlsxArea }> = []
  for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const body = c[2]
    if (!body || !/<f\b/.test(body)) continue
    const at = cellOf(attr(c[1]!, 'r') ?? '')
    if (!at) {
      // a formula cell with no address: what it fills cannot be told
      throw unreadableHiding(new Error('a formula cell has no address'))
    }
    const own: XlsxArea = { sheet, r1: at.row, c1: at.col, r2: at.row, c2: at.col }
    const f = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(body)!
    const fAttrs = f[1] ?? ''
    const formula = f[2] !== undefined ? decode(f[2]) : ''
    const type = attr(fAttrs, 't') ?? ''
    const ref = attr(fAttrs, 'ref')
    const si = attr(fAttrs, 'si')
    if (type === 'shared' && si !== undefined && !formula) {
      children.push({ si, area: own })
      continue
    }
    const filled =
      (type === 'array' || type === 'dataTable') && ref ? (areaOf(ref, sheet) ?? own) : own
    const refs =
      type === 'dataTable' || !formula ? 'unknown' : formulaReferences(formula, sheet, sheetNames)
    out.push({ area: filled, refs })
    if (type === 'shared' && si !== undefined) {
      shared.set(si, { at, refs, range: ref ? areaOf(ref, sheet) : null })
    }
  }
  // a cell of a shared formula reads its master's references moved by its own
  // offset; what any cell of the group can read is a superset that is enough
  for (const child of children) {
    const master = shared.get(child.si)
    if (!master || master.refs === 'unknown' || !master.range) {
      out.push({ area: child.area, refs: 'unknown' })
      continue
    }
    const down = Math.max(0, master.range.r2 - master.at.row)
    const right = Math.max(0, master.range.c2 - master.at.col)
    out.push({
      area: child.area,
      refs: master.refs.map((r) => ({ ...r, r2: r.r2 + down, c2: r.c2 + right })),
    })
  }
  for (const rel of await relsOf(zip, path)) {
    if (!rel.type.endsWith('/pivotTable')) continue
    const pivot = (await text(zip, rel.target)) ?? ''
    const location = /<location\b([^>]*)/.exec(pivot)
    const area = location ? areaOf(attr(location[1]!, 'ref') ?? '', sheet) : null
    if (!area) throw unreadableHiding(new Error('the place of a pivot table cannot be read'))
    // a pivot table's source is not followed: it leans on every mark
    out.push({ area, refs: 'unknown' })
  }
  return out
}

/** The hiding of an .xlsx / .xlsm; null when it has no mark. Throws (closed) on a mark it cannot resolve. */
export async function workbookHidingOf(bytes: Uint8Array): Promise<WorkbookHiding | null> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    return null
  }
  const workbookPath = 'xl/workbook.xml'
  const workbook = await text(zip, workbookPath)
  if (!workbook) return null
  const names: XlsxDefinedName[] = []
  for (const m of workbook.matchAll(
    /<(?:[\w.-]+:)?definedName\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?definedName>/g,
  )) {
    const local = attr(m[1]!, 'localSheetId')
    names.push({
      name: attr(m[1]!, 'name') ?? '',
      ref: decode(m[2]!),
      ...(local !== undefined && /^\d+$/.test(local) ? { localSheetId: Number(local) } : {}),
    })
  }
  if (!names.some((n) => isHidingName(n.name))) return null
  const sheets = [...workbook.matchAll(/<(?:[\w.-]+:)?sheet\b([^>]*?)\/?>/g)].map((m) => ({
    name: attr(m[1]!, 'name') ?? '',
    rid: attr(m[1]!, 'r:id') ?? '',
  }))
  const sheetNames = sheets.map((s) => s.name)
  let marks: XlsxHidingMark[]
  try {
    marks = xlsxHidingMarksOf(names, sheetNames)
  } catch (err) {
    throw unreadableHiding(err)
  }
  if (!marks.length) return null
  const rels = new Map((await relsOf(zip, workbookPath)).map((r) => [r.id, r.target]))
  const dependents: XlsxDependent[] = []
  for (const [index, sheet] of sheets.entries()) {
    const path = rels.get(sheet.rid)
    if (path) dependents.push(...(await sheetDependents(zip, path, index, sheetNames)))
  }
  const redactor = createXlsxRedactor(
    marks,
    dependents,
    sheets.map(() => Infinity),
  )
  return { marks, sheetNames, redactor, dependents }
}

/** Whether two areas share a cell. */
export function overlaps(a: XlsxArea, b: XlsxArea): boolean {
  return a.sheet === b.sheet && a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2
}

/** The labels of the marks an area reaches. */
export function labelsIn(hiding: WorkbookHiding, area: XlsxArea): string[] {
  return hiding.marks.filter((m) => m.areas.some((a) => overlaps(a, area))).map((m) => m.label)
}

/** The labels a computed cell in the area leans on (formula, pivot table). */
export function dependentLabelsIn(hiding: WorkbookHiding, area: XlsxArea): string[] {
  const labels = new Set<string>()
  for (const node of hiding.dependents) {
    if (!overlaps(node.area, area)) continue
    if (hiding.redactor.hidden(node.area.sheet, node.area.r1, node.area.c1)) continue
    const read = hiding.redactor.cell(node.area.sheet, node.area.r1, node.area.c1, '')
    const inner = /^\{\{(.*)\}\}$/.exec(read)?.[1]
    if (inner) for (const label of inner.split('+')) labels.add(label)
  }
  return [...labels]
}

/**
 * The cells of a read grid as a model may read them, in place: a hidden cell's
 * value and formula become its `{{label-NN}}`, a cell leaning on hidden cells
 * keeps its formula and reads `{{label}}` for its value.
 */
export function maskGrid(
  hiding: WorkbookHiding,
  sheetName: string,
  origin: { row: number; column: number },
  rows: Array<Array<string | number | boolean | null>>,
  formulas: Record<string, string>,
  address: (row: number, column: number) => string,
): void {
  const wanted = sheetName.toLowerCase()
  const sheet = hiding.sheetNames.findIndex((name) => name.toLowerCase() === wanted)
  if (sheet < 0) return
  rows.forEach((cells, r) => {
    cells.forEach((value, k) => {
      const row = origin.row + r
      const column = origin.column + k
      const text = value === null ? '' : String(value)
      const read = hiding.redactor.cell(sheet, row, column, text)
      if (read === text) return
      cells[k] = read
      if (hiding.redactor.hidden(sheet, row, column)) delete formulas[address(row, column)]
    })
  })
}

/** Ops that change how cells look, not what they hold: allowed over hidden cells. */
const LOOK_ONLY = new Set([
  'format_range',
  'unmerge_cells',
  'set_row_height',
  'set_col_width',
  'set_rows_hidden',
  'set_cols_hidden',
  'set_freeze',
  'set_page_setup',
  'set_sheet_hidden',
  'move_sheet',
  'protect_sheet',
  'clear_filter',
  'clear_conditional_formats',
  'edit_chart',
  'add_image',
  'add_shape',
  'add_sheet',
  'add_sparkline',
])

/** Ops that take a whole sheet: refused on a sheet that hides something. */
const WHOLE_SHEET = new Set(['delete_sheet', 'rename_sheet', 'duplicate_sheet'])

function rangeArea(value: unknown, sheet: number): XlsxArea | null {
  if (typeof value !== 'string') return null
  const ref = value.trim().replace(/^.*!/, '').replace(/\$/g, '')
  const column = /^([A-Za-z]{1,3}):([A-Za-z]{1,3})$/.exec(ref)
  if (column) {
    const a = letters(column[1]!)
    const b = letters(column[2]!)
    return { sheet, r1: 0, c1: Math.min(a, b), r2: 1_048_575, c2: Math.max(a, b) }
  }
  const row = /^(\d+):(\d+)$/.exec(ref)
  if (row) {
    const a = Number(row[1]) - 1
    const b = Number(row[2]) - 1
    return { sheet, r1: Math.min(a, b), c1: 0, r2: Math.max(a, b), c2: 16_383 }
  }
  return areaOf(ref, sheet)
}

/** a destination given as its top-left cell spans the source's size */
function sized(target: XlsxArea | null, source: XlsxArea | null): XlsxArea | null {
  if (!target || !source || target.r1 !== target.r2 || target.c1 !== target.c2) return target
  return {
    ...target,
    r2: target.r1 + (source.r2 - source.r1),
    c2: target.c1 + (source.c2 - source.c1),
  }
}

/**
 * The labels an op of `sheet apply` would reach in a way the person keeps for
 * themselves: writing, clearing, moving, copying, sorting, filtering or
 * deleting hidden cells, freezing to values what leans on them, or touching a
 * hiding name. Decided from the op alone, never from what the cells hold, so a
 * refusal tells nothing about the hidden values. Empty when the op may run.
 */
export function sheetOpHiddenLabels(
  hiding: WorkbookHiding,
  op: Record<string, unknown>,
  defaultSheet: string | undefined,
): string[] {
  const name = typeof op.op === 'string' ? op.op : ''
  if (LOOK_ONLY.has(name)) return []
  if (name === 'add_defined_name' || name === 'delete_defined_name') {
    const target = typeof op.name === 'string' ? op.name : ''
    if (!isHidingName(target)) return []
    const label = hiding.marks.find((m) => m.name.toLowerCase() === target.toLowerCase())?.label
    return [label ?? hiding.marks[0]!.label]
  }
  const sheetIndex = (value: unknown): number => {
    const wanted = (typeof value === 'string' ? value : (defaultSheet ?? '')).toLowerCase()
    const found = hiding.sheetNames.findIndex((n) => n.toLowerCase() === wanted)
    return found >= 0 ? found : wanted ? -1 : 0
  }
  const sheet = sheetIndex(op.sheetId)
  const sourceSheet = op.sourceSheetId !== undefined ? sheetIndex(op.sourceSheetId) : sheet
  const sheetLabels = (index: number): string[] =>
    hiding.marks.filter((m) => m.areas.some((a) => a.sheet === index)).map((m) => m.label)
  if (WHOLE_SHEET.has(name)) return sheetLabels(sheet)
  const areas: XlsxArea[] = []
  const add = (area: XlsxArea | null) => {
    if (area) areas.push(area)
  }
  switch (name) {
    case 'delete_rows': {
      const row = Number(op.row) - 1
      const count = Number(op.count) || 1
      if (Number.isInteger(row)) add({ sheet, r1: row, c1: 0, r2: row + count - 1, c2: 16_383 })
      break
    }
    case 'delete_cols': {
      const column = typeof op.column === 'string' ? letters(op.column.replace(/\$/g, '')) : -1
      const count = Number(op.count) || 1
      if (column >= 0) add({ sheet, r1: 0, c1: column, r2: 1_048_575, c2: column + count - 1 })
      break
    }
    case 'insert_rows':
    case 'insert_cols':
      // the hiding names move with the cells (the gateway shifts defined names)
      return []
    case 'set_range': {
      const start = rangeArea(op.start ?? op.range, sheet)
      const values = Array.isArray(op.values) ? (op.values as unknown[][]) : []
      const width = Math.max(1, ...values.map((r) => (Array.isArray(r) ? r.length : 1)))
      add(
        op.range !== undefined
          ? rangeArea(op.range, sheet)
          : start && { ...start, r2: start.r1 + values.length - 1, c2: start.c1 + width - 1 },
      )
      break
    }
    case 'fill_range':
    case 'copy_range':
    case 'move_range': {
      const source = rangeArea(op.source, sourceSheet)
      add(source)
      add(sized(rangeArea(op.target, sheet), source))
      break
    }
    case 'find_replace':
      // a search over a range that holds hidden cells is refused whatever it
      // would find, so the refusal does not tell whether the words are there
      add(
        op.range !== undefined
          ? rangeArea(op.range, sheet)
          : { sheet, r1: 0, c1: 0, r2: 1_048_575, c2: 16_383 },
      )
      break
    default:
      for (const key of [
        'address',
        'range',
        'cell',
        'anchorCell',
        'source',
        'target',
        'dataRange',
        'sourceRange',
      ]) {
        const area = rangeArea(
          op[key],
          key === 'source' || key === 'sourceRange' ? sourceSheet : sheet,
        )
        add(area)
      }
  }
  // no sheet named and no default: the op could land on any sheet
  const anywhere = op.sheetId === undefined && !defaultSheet
  const scoped = anywhere
    ? areas.flatMap((area) => hiding.sheetNames.map((_, index) => ({ ...area, sheet: index })))
    : areas
  const labels = new Set(scoped.flatMap((area) => labelsIn(hiding, area)))
  if (name === 'convert_to_values') {
    for (const area of scoped)
      for (const label of dependentLabelsIn(hiding, area)) labels.add(label)
  }
  return [...labels]
}

/**
 * Findings of `sheet check` as a model may read them: a finding about a hidden
 * cell, or one leaning on hidden cells, keeps its code and place but not the
 * words that quote the cell; quoted excerpts of other cells go too.
 */
export function concealIssues<
  T extends { message: string; context?: string; sheet?: string; cell?: string; range?: string },
>(hiding: WorkbookHiding, issues: readonly T[]): T[] {
  return issues.map((issue) => {
    const sheet = hiding.sheetNames.findIndex(
      (n) => n.toLowerCase() === (issue.sheet ?? '').toLowerCase(),
    )
    const area = sheet >= 0 ? rangeArea(issue.cell ?? issue.range, sheet) : null
    const reached =
      !!area && (labelsIn(hiding, area).length > 0 || dependentLabelsIn(hiding, area).length > 0)
    const { context: _context, ...rest } = issue
    if (!reached) return (issue.context && /"/.test(issue.context) ? rest : issue) as T
    return {
      ...rest,
      message:
        `a finding about a cell the workbook hides from AI; open the workbook in ${PRODUCT_NAME} to see it`,
    } as T
  })
}
