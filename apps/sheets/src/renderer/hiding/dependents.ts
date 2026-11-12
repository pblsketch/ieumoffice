/**
 * Which cells lean on hidden cells.
 *
 * A formula whose result comes from hidden cells, directly or through other
 * formulas on any sheet, reads as `{{label+label}}` (no number): its value is
 * hidden, its formula text is not. A pivot table built from hidden cells is
 * the same. A formula this cannot follow — a computed reference (`INDIRECT`,
 * `OFFSET`), a defined name, a table or another workbook, a sheet it does not
 * know — counts as leaning on every mark; so does a reference into a sheet
 * whose formulas are not all known yet. Failing towards hiding is the rule.
 *
 * The references come from the tokenizer the formula audit and the streaming
 * closure already use (`parseFormulaReferences`), so what is hidden matches
 * what trace_precedents / trace_dependents see; file formulas keep their
 * references in file coordinates until save and are mapped through the
 * session's row/column changes the same way trace_dependents maps them.
 */
import type { StructuralOp } from '@genoffice/xlsx-gateway/gateway/xlsx-structure'
import { qualifierMatches } from '@genoffice/xlsx-gateway/gateway/xlsx-structure'
import { containsUnresolvedNames, parseFormulaReferences } from '../formula-closure'
import { fileRangeToScreenRange } from '../view-transform'
import {
  HIDING_MAX_COLUMN,
  HIDING_MAX_ROW,
  areaContains,
  areasIntersect,
  type HidingArea,
  type HidingSheet,
  type SheetHidingMark,
} from './marks'

/** What a formula (or pivot) reads: its areas, or 'unknown' when they cannot all be told. */
export type HidingRefs = readonly HidingArea[] | 'unknown'

/** Something whose value comes from other cells: one formula cell, or a pivot's output area. */
export interface HidingNode {
  readonly area: HidingArea
  readonly refs: HidingRefs
}

export interface FormulaRefContext {
  /** the sheets a qualifier may name, with their current names */
  readonly sheets: readonly HidingSheet[]
  /**
   * File formulas only: the sheets as the file names them (a renamed sheet
   * keeps its file name in them), and the row/column changes that map a file
   * coordinate of each sheet to the grid.
   */
  readonly fileSheets?: readonly HidingSheet[] | undefined
  readonly opsOf?: ((sheetId: string) => readonly StructuralOp[]) | undefined
}

/** functions whose reference is computed, so what they read cannot be told from the text */
const COMPUTED_REFERENCE = /(?:^|[^\p{L}\p{N}_.])(?:_XLFN\.)?(?:INDIRECT|OFFSET)\s*\(/u
const AXIS_OPEN = { row: HIDING_MAX_ROW, column: HIDING_MAX_COLUMN }

/** Unquoted parts upper-cased (references, functions and names compare without case). */
function normalizedFormula(formula: string): string {
  return formula
    .replace(/^=/, '')
    .split('"')
    .map((segment, index) => (index % 2 === 0 ? segment.toUpperCase() : segment))
    .join('"')
}

/**
 * The areas a formula reads on the grid. `fromFile` formulas resolve their
 * sheet qualifiers against the file's sheet names and are mapped through each
 * referenced sheet's session row/column changes.
 */
export function formulaRefAreas(
  formula: string,
  sheetId: string,
  context: FormulaRefContext,
  fromFile = false,
): HidingRefs {
  const text = normalizedFormula(formula)
  const outside = text
    .split('"')
    .filter((_, index) => index % 2 === 0)
    .join(' ')
  if (outside.includes('[') || COMPUTED_REFERENCE.test(outside)) return 'unknown'
  if (containsUnresolvedNames(text)) return 'unknown'
  const names = fromFile ? (context.fileSheets ?? context.sheets) : context.sheets
  const areas: HidingArea[] = []
  for (const reference of parseFormulaReferences(text)) {
    let target = sheetId
    if (reference.qualifier !== undefined) {
      const qualifier = reference.qualifier
      const sheet = names.find((candidate) => qualifierMatches(qualifier, candidate.name))
      if (!sheet) return 'unknown'
      target = sheet.id
    }
    const { token } = reference
    let rect = {
      startRow: token.startRow ?? 0,
      endRow: token.endRow ?? AXIS_OPEN.row,
      startColumn: token.startColumn ?? 0,
      endColumn: token.endColumn ?? AXIS_OPEN.column,
    }
    const ops = fromFile ? (context.opsOf?.(target) ?? []) : []
    if (ops.length > 0) {
      const mapped = fileRangeToScreenRange(ops, rect)
      // the referenced cells were deleted this session: the reference is #REF!
      if (!mapped) continue
      rect = {
        startRow: token.startRow === null ? 0 : mapped.startRow,
        endRow: token.endRow === null ? AXIS_OPEN.row : mapped.endRow,
        startColumn: token.startColumn === null ? 0 : mapped.startColumn,
        endColumn: token.endColumn === null ? AXIS_OPEN.column : mapped.endColumn,
      }
    }
    areas.push({ sheetId: target, ...rect })
  }
  return areas
}

/** the first index of a sorted list at or after `value` */
function lowerBound(list: readonly number[], value: number): number {
  let lo = 0
  let hi = list.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((list[mid] ?? 0) < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

interface SheetIndex {
  /** sorted columns that hold one-cell nodes */
  columns: number[]
  /** per column: sorted rows, and the node at each */
  rows: Map<number, { rows: number[]; nodes: HidingNode[] }>
  /** nodes that fill more than one cell (pivot outputs) */
  wide: HidingNode[]
}

export interface DependencyIndex {
  /** the labels the value at a cell leans on, or null when it leans on none */
  labelsAt(sheetId: string, row: number, column: number): ReadonlySet<string> | null
  /** the labels a formula written at a cell would lean on (a formula the index does not hold yet) */
  labelsOfFormula(refs: HidingRefs): ReadonlySet<string>
  /** whether any cell of the area holds a value leaning on hidden cells */
  hasDependentIn(area: HidingArea): boolean
}

/**
 * The dependency index of a workbook. `incompleteSheets` are sheets whose
 * formulas are not all known: a reference into one counts as leaning on every
 * mark.
 */
export function createDependencyIndex(
  marks: readonly SheetHidingMark[],
  nodes: readonly HidingNode[],
  incompleteSheets: ReadonlySet<string> = new Set(),
): DependencyIndex {
  const every = new Set(marks.map((mark) => mark.label))
  const indexes = new Map<string, SheetIndex>()
  const one = new Map<string, HidingNode[]>()
  for (const node of nodes) {
    const { sheetId, startRow, startColumn, endRow, endColumn } = node.area
    let index = indexes.get(sheetId)
    if (!index) {
      index = { columns: [], rows: new Map(), wide: [] }
      indexes.set(sheetId, index)
    }
    if (startRow !== endRow || startColumn !== endColumn) {
      index.wide.push(node)
      continue
    }
    let column = index.rows.get(startColumn)
    if (!column) {
      column = { rows: [], nodes: [] }
      index.rows.set(startColumn, column)
    }
    column.rows.push(startRow)
    column.nodes.push(node)
    const key = `${sheetId}\u0000${startRow}\u0000${startColumn}`
    one.set(key, [...(one.get(key) ?? []), node])
  }
  for (const index of indexes.values()) {
    index.columns = [...index.rows.keys()].sort((a, b) => a - b)
    for (const column of index.rows.values()) {
      const order = column.rows
        .map((_, i) => i)
        .sort((a, b) => (column.rows[a] ?? 0) - (column.rows[b] ?? 0))
      const rows = order.map((i) => column.rows[i] ?? 0)
      const ordered = order.flatMap((i) => {
        const node = column.nodes[i]
        return node ? [node] : []
      })
      column.rows = rows
      column.nodes = ordered
    }
  }

  /** the nodes inside some of the areas */
  function nodesIn(refs: readonly HidingArea[]): HidingNode[] {
    const out: HidingNode[] = []
    for (const ref of refs) {
      const index = indexes.get(ref.sheetId)
      if (!index) continue
      for (let i = lowerBound(index.columns, ref.startColumn); i < index.columns.length; i++) {
        const col = index.columns[i] ?? 0
        if (col > ref.endColumn) break
        const column = index.rows.get(col)
        if (!column) continue
        for (let j = lowerBound(column.rows, ref.startRow); j < column.rows.length; j++) {
          if ((column.rows[j] ?? 0) > ref.endRow) break
          const node = column.nodes[j]
          if (node) out.push(node)
        }
      }
      for (const node of index.wide) if (areasIntersect(node.area, ref)) out.push(node)
    }
    return out
  }

  /** the labels some references read directly, or every label when it cannot be told */
  function ownLabels(refs: HidingRefs): Set<string> {
    if (refs === 'unknown') return new Set(every)
    const labels = new Set<string>()
    for (const ref of refs) {
      if (incompleteSheets.has(ref.sheetId)) return new Set(every)
      for (const mark of marks) {
        if (mark.areas.some((area) => areasIntersect(area, ref))) labels.add(mark.label)
      }
    }
    return labels
  }

  const done = new Map<HidingNode, Set<string>>()
  const open = new Set<HidingNode>()

  /** the labels a node leans on, through other nodes too; iterative, chains run long */
  function labelsOf(start: HidingNode): Set<string> {
    const known = done.get(start)
    if (known) return known
    interface Frame {
      node: HidingNode
      inputs: HidingNode[]
      next: number
      labels: Set<string>
    }
    const enter = (node: HidingNode): Frame => {
      open.add(node)
      const labels = ownLabels(node.refs)
      const inputs = labels.size === every.size || node.refs === 'unknown' ? [] : nodesIn(node.refs)
      return { node, inputs, next: 0, labels }
    }
    const stack: Frame[] = [enter(start)]
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      if (!frame) break
      if (frame.labels.size < every.size && frame.next < frame.inputs.length) {
        const input = frame.inputs[frame.next++]
        if (!input) continue
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
    return done.get(start) ?? new Set(every)
  }

  function nodesAt(sheetId: string, row: number, column: number): HidingNode[] {
    const index = indexes.get(sheetId)
    return [
      ...(one.get(`${sheetId}\u0000${row}\u0000${column}`) ?? []),
      ...(index?.wide.filter((node) => areaContains(node.area, sheetId, row, column)) ?? []),
    ]
  }

  return {
    labelsAt(sheetId, row, column) {
      if (every.size === 0) return null
      const labels = new Set<string>()
      for (const node of nodesAt(sheetId, row, column)) {
        for (const label of labelsOf(node)) labels.add(label)
      }
      return labels.size > 0 ? labels : null
    },
    labelsOfFormula(refs) {
      if (every.size === 0) return new Set()
      const labels = ownLabels(refs)
      if (labels.size === every.size || refs === 'unknown') return labels
      for (const node of nodesIn(refs)) for (const label of labelsOf(node)) labels.add(label)
      return labels
    },
    hasDependentIn(area) {
      if (every.size === 0) return false
      return nodesIn([area]).some((node) => labelsOf(node).size > 0)
    },
  }
}
