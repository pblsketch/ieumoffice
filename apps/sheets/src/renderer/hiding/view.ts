/**
 * The hiding view of the open workbook: which cells the model reads as
 * `{{label-NN}}` (inside a mark) or `{{label+label}}` (leaning on one).
 *
 * One numbering per open document: the same value keeps its number for as
 * long as the workbook is open, so the model can tell rows apart without
 * learning the values. The numbers are never written to the file.
 *
 * The view is built fresh for each read from the live name table, the edit
 * journal and the file's formula index (fetched once per session by
 * `prepareSheetHiding`, since the file under a session never changes; session
 * edits come from the journal). A sheet whose formula index is not known yet
 * counts as leaning on every mark. A workbook without hiding names costs
 * nothing: the view is inactive and every read passes through untouched.
 */
import { parseRange } from '@genoffice/xlsx-gateway/domain/cell-address'
import type { StructuralOp } from '@genoffice/xlsx-gateway/gateway/xlsx-structure'
import {
  createValueNumbering,
  dependentPlaceholder,
  type HiddenCellValue,
  type ValueNumbering,
} from '@genoffice/agent-core/hiding-values'
import { SharedFormulaLookup, indexedFormulas } from '../shared-formula-index'
import { fileRangeToScreenRange, fileToScreen } from '../view-transform'
import type { LazyWorkbookState } from '../univer-state'
import type { WorkbookReadContext } from '../ai/workbook-readers'
import {
  createDependencyIndex,
  formulaRefAreas,
  type DependencyIndex,
  type FormulaRefContext,
  type HidingNode,
} from './dependents'
import {
  HIDING_MAX_COLUMN,
  HIDING_MAX_ROW,
  areasIntersect,
  hidingSheetsOf,
  markAt,
  readHidingMarks,
  type HidingArea,
  type HidingSheet,
  type SheetHidingMark,
} from './marks'

interface FileFormulaCell {
  readonly row: number
  readonly column: number
  readonly formula: string
  /** a legacy array formula's filled range (`<f t="array" ref>`), file coordinates */
  readonly arrayRef?: string | undefined
}

interface FileFormulaIndex {
  readonly cells: readonly FileFormulaCell[]
  readonly complete: boolean
}

export interface SheetHidingSession {
  /** one numbering per open document */
  readonly numbering: ValueNumbering
  /** the file's formulas per sheet id; a file never changes under its session */
  readonly fileFormulas: Map<string, FileFormulaIndex>
  /** sheets whose index is being fetched */
  readonly fetching: Map<string, Promise<void>>
}

const sessions = new WeakMap<object, SheetHidingSession>()

/** The hiding session of a document (its lazy state, or the demo adapter). */
export function sheetHidingSessionOf(key: object): SheetHidingSession {
  let session = sessions.get(key)
  if (!session) {
    session = { numbering: createValueNumbering(), fileFormulas: new Map(), fetching: new Map() }
    sessions.set(key, session)
  }
  return session
}

export interface SheetHidingView {
  /** false when the workbook has no hiding marks: reads pass through untouched */
  readonly active: boolean
  readonly marks: readonly SheetHidingMark[]
  /** the label hiding a cell, or null */
  hiddenLabel(sheetId: string, row: number, column: number): string | null
  /** what the model reads for a hidden cell holding `value` */
  placeholder(label: string, value: HiddenCellValue): string
  /**
   * The labels the value at a cell leans on, or null. `liveFormula` is the
   * cell's formula as the grid has it, used when the index does not hold it.
   */
  dependentLabels(
    sheetId: string,
    row: number,
    column: number,
    liveFormula?: string | undefined,
  ): ReadonlySet<string> | null
  /** the labels a formula written on a sheet leans on */
  formulaLabels(sheetId: string, formula: string): ReadonlySet<string>
  /** whether any cell of the area is hidden */
  touchesHidden(area: HidingArea): boolean
  /** the marks covering some cell of the area */
  marksTouching(area: HidingArea): SheetHidingMark[]
  /** whether any cell of the area holds a value that leans on hidden cells */
  hasDependentIn(area: HidingArea): boolean
}

export type SheetHidingState =
  | { readonly ok: true; readonly view: SheetHidingView }
  /** a hiding name cannot be resolved: nothing of this workbook may go to the model */
  | { readonly ok: false; readonly names: readonly string[] }

const INACTIVE: SheetHidingView = {
  active: false,
  marks: [],
  hiddenLabel: () => null,
  placeholder: (label) => `{{${label}}}`,
  dependentLabels: () => null,
  formulaLabels: () => new Set(),
  touchesHidden: () => false,
  marksTouching: () => [],
  hasDependentIn: () => false,
}

/** Build a view from marks and dependency nodes (pure; the tests drive this). */
export function createSheetHidingView(
  marks: readonly SheetHidingMark[],
  numbering: ValueNumbering,
  nodes: readonly HidingNode[],
  incompleteSheets: ReadonlySet<string>,
  context: FormulaRefContext,
): SheetHidingView {
  if (marks.length === 0) return INACTIVE
  const index: DependencyIndex = createDependencyIndex(marks, nodes, incompleteSheets)
  const labelsOrNull = (labels: ReadonlySet<string>): ReadonlySet<string> | null =>
    labels.size > 0 ? labels : null
  const view: SheetHidingView = {
    active: true,
    marks,
    hiddenLabel: (sheetId, row, column) => markAt(marks, sheetId, row, column)?.label ?? null,
    placeholder: (label, value) => numbering.placeholder(label, value),
    dependentLabels(sheetId, row, column, liveFormula) {
      const known = index.labelsAt(sheetId, row, column)
      if (known) return known
      if (!liveFormula) return null
      return labelsOrNull(index.labelsOfFormula(formulaRefAreas(liveFormula, sheetId, context)))
    },
    formulaLabels: (sheetId, formula) =>
      index.labelsOfFormula(formulaRefAreas(formula, sheetId, context)),
    touchesHidden: (area) =>
      marks.some((mark) => mark.areas.some((own) => areasIntersect(own, area))),
    marksTouching: (area) =>
      marks.filter((mark) => mark.areas.some((own) => areasIntersect(own, area))),
    hasDependentIn: (area) => index.hasDependentIn(area),
  }
  return view
}

/** `{{label+label}}`: the marker of a value leaning on hidden cells */
export function dependentText(labels: Iterable<string>): string {
  return dependentPlaceholder(labels)
}

function sheetExtentArea(sheetId: string, row: number, column: number): HidingArea {
  return {
    sheetId,
    startRow: row,
    endRow: HIDING_MAX_ROW,
    startColumn: column,
    endColumn: HIDING_MAX_COLUMN,
  }
}

/**
 * Functions whose result spills over the cells beside and below them. A
 * spilled cell holds a plain value in the grid, so the formula's node covers
 * everything to the right of and below it: hiding too much is the safe way.
 */
const SPILLING =
  /(?:^|[^\p{L}\p{N}_.])(?:_XLFN\.|_XLWS\.)?(?:FILTER|SORT|SORTBY|UNIQUE|SEQUENCE|RANDARRAY|TRANSPOSE|TEXTSPLIT|VSTACK|HSTACK|TAKE|DROP|CHOOSECOLS|CHOOSEROWS|TOCOL|TOROW|WRAPROWS|WRAPCOLS|EXPAND|XLOOKUP|MMULT|FREQUENCY)\s*\(/iu

function formulaNode(
  sheetId: string,
  row: number,
  column: number,
  formula: string,
  context: FormulaRefContext,
  fromFile: boolean,
  arrayArea?: HidingArea,
): HidingNode {
  const refs = formulaRefAreas(formula, sheetId, context, fromFile)
  const area =
    arrayArea ??
    (SPILLING.test(formula)
      ? sheetExtentArea(sheetId, row, column)
      : { sheetId, startRow: row, endRow: row, startColumn: column, endColumn: column })
  return { area, refs }
}

function mappedArea(
  ops: readonly StructuralOp[],
  sheetId: string,
  rect: { startRow: number; endRow: number; startColumn: number; endColumn: number },
): HidingArea | null {
  const mapped = ops.length > 0 ? fileRangeToScreenRange(ops, rect) : rect
  return mapped ? { sheetId, ...mapped } : null
}

function parseArea(ref: string): {
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
} | null {
  try {
    return parseRange(ref.replace(/\$/g, '').toUpperCase())
  } catch {
    return null
  }
}

/** Formula and pivot nodes of a lazily opened workbook, as far as they are known now. */
function lazyNodes(
  state: LazyWorkbookState,
  session: SheetHidingSession,
  sheets: readonly HidingSheet[],
): { nodes: HidingNode[]; incomplete: Set<string>; context: FormulaRefContext } {
  const fileSheets: HidingSheet[] = state.file.sheets.map((sheet) => ({
    id: sheet.id,
    name: sheet.name,
  }))
  const opsOf = (sheetId: string): readonly StructuralOp[] =>
    state.editJournal.structuralOps.get(sheetId) ?? []
  const context: FormulaRefContext = { sheets, fileSheets, opsOf }
  const nodes: HidingNode[] = []
  const incomplete = new Set<string>()
  for (const sheet of sheets) {
    const shadowed = new Set<string>()
    for (const entry of state.editJournal.cells.get(sheet.id)?.values() ?? []) {
      if (!entry.hasValue) continue
      shadowed.add(`${entry.row}:${entry.column}`)
      if (entry.formula) {
        nodes.push(formulaNode(sheet.id, entry.row, entry.column, entry.formula, context, false))
      }
    }
    const meta = state.file.sheets.find((candidate) => candidate.id === sheet.id)
    if (!meta) continue
    const index = session.fileFormulas.get(sheet.id)
    if (!index?.complete) incomplete.add(sheet.id)
    if (!index) continue
    const ops = opsOf(sheet.id)
    for (const cell of index.cells) {
      const row = fileToScreen(ops, 'row', cell.row)
      const column = fileToScreen(ops, 'column', cell.column)
      if (row === null || column === null) continue
      if (shadowed.has(`${row}:${column}`)) continue
      const arrayRect = cell.arrayRef ? parseArea(cell.arrayRef) : null
      const arrayArea = arrayRect ? mappedArea(ops, sheet.id, arrayRect) : null
      nodes.push(
        formulaNode(sheet.id, row, column, cell.formula, context, true, arrayArea ?? undefined),
      )
    }
  }
  // pivot outputs come from their source range; one whose source is unknown leans on every mark
  for (const meta of state.file.sheets) {
    if (!sheets.some((sheet) => sheet.id === meta.id)) continue
    const ops = opsOf(meta.id)
    const covered: HidingArea[] = []
    for (const pivot of meta.pivotTables) {
      const outputRect = parseArea(pivot.outputRef)
      const output = outputRect ? mappedArea(ops, meta.id, outputRect) : null
      if (!output) continue
      covered.push(output)
      const definition = state.pivotDefinitions.get(pivot.path)
      const source = definition
        ? state.file.sheets.find(
            (candidate) => candidate.name.toLowerCase() === definition.sourceSheet.toLowerCase(),
          )
        : undefined
      const sourceRect = definition ? parseArea(definition.sourceRef) : null
      const sourceArea =
        source && sourceRect ? mappedArea(opsOf(source.id), source.id, sourceRect) : null
      nodes.push({ area: output, refs: sourceArea ? [sourceArea] : 'unknown' })
    }
    for (const range of meta.pivotRanges) {
      const output = mappedArea(ops, meta.id, range)
      if (!output || covered.some((area) => areasIntersect(area, output))) continue
      nodes.push({ area: output, refs: 'unknown' })
    }
  }
  for (const pivot of state.editJournal.pivotAdds) {
    nodes.push({
      area: { sheetId: pivot.sheetId, ...pivot.location },
      refs: [{ sheetId: pivot.sourceSheetId, ...pivot.sourceArea }],
    })
  }
  return { nodes, incomplete, context }
}

/** Formula nodes of the in-memory demo workbook (always complete). */
function demoNodes(
  ctx: WorkbookReadContext,
  sheets: readonly HidingSheet[],
): { nodes: HidingNode[]; context: FormulaRefContext } {
  const context: FormulaRefContext = { sheets }
  const nodes: HidingNode[] = []
  for (const sheet of ctx.adapterRef.current.getSnapshot().sheets) {
    for (const [address, cell] of Object.entries(sheet.cells)) {
      if (!cell.formula) continue
      const point = parseArea(address)
      if (!point) continue
      nodes.push(
        formulaNode(sheet.id, point.startRow, point.startColumn, cell.formula, context, false),
      )
    }
  }
  return { nodes, context }
}

/**
 * The hiding state of the open workbook now. Never throws: a workbook that
 * cannot be analysed fails closed through `ok: false`.
 */
export function sheetHidingState(ctx: WorkbookReadContext): SheetHidingState {
  const runtime = ctx.univerRef.current
  const state = ctx.lazyWorkbookRef.current
  const marks = readHidingMarks(runtime, state)
  if (!marks.ok) return { ok: false, names: marks.names }
  if (marks.marks.length === 0) return { ok: true, view: INACTIVE }
  const sheets = hidingSheetsOf(runtime)
  try {
    if (state) {
      const session = sheetHidingSessionOf(state)
      const { nodes, incomplete, context } = lazyNodes(state, session, sheets)
      return {
        ok: true,
        view: createSheetHidingView(marks.marks, session.numbering, nodes, incomplete, context),
      }
    }
    const session = sheetHidingSessionOf(ctx.adapterRef.current)
    const { nodes, context } = demoNodes(ctx, sheets)
    return {
      ok: true,
      view: createSheetHidingView(marks.marks, session.numbering, nodes, new Set(), context),
    }
  } catch {
    return { ok: false, names: marks.marks.map((mark) => mark.name) }
  }
}

/**
 * Fetch the file's formula index for every sheet of a workbook that holds
 * hiding marks, once per session. Sheets whose index is still incomplete are
 * fetched again next time. Without marks this does nothing.
 */
export async function prepareSheetHiding(ctx: WorkbookReadContext): Promise<void> {
  const state = ctx.lazyWorkbookRef.current
  if (!state) return
  const marks = readHidingMarks(ctx.univerRef.current, state)
  if (marks.ok && marks.marks.length === 0) return
  const session = sheetHidingSessionOf(state)
  await Promise.all(
    state.file.sheets.map((sheet) => {
      if (session.fileFormulas.get(sheet.id)?.complete) return Promise.resolve()
      const running = session.fetching.get(sheet.id)
      if (running) return running
      const fetch = (async () => {
        try {
          const result = await window.desktopApi.readWorkbookFormulas({
            sessionId: state.file.sessionId,
            sheetId: sheet.id,
          })
          const shared = new SharedFormulaLookup(result.sharedGroups)
          const arrays = new Map(
            result.cells
              .filter((cell) => cell.formula && cell.arrayRef)
              .map((cell) => [`${cell.row}:${cell.column}`, cell.arrayRef]),
          )
          const cells: FileFormulaCell[] = indexedFormulas(result.cells, shared).map((cell) => ({
            ...cell,
            arrayRef: arrays.get(`${cell.row}:${cell.column}`),
          }))
          session.fileFormulas.set(sheet.id, {
            cells,
            complete: result.indexingComplete && !result.truncated,
          })
        } catch {
          // left unknown: references into this sheet lean on every mark
        } finally {
          session.fetching.delete(sheet.id)
        }
      })()
      session.fetching.set(sheet.id, fetch)
      return fetch
    }),
  )
}
