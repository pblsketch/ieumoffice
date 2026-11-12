/**
 * Sensitive-info hiding on the AI path of the spreadsheet editor.
 *
 * `withSheetHiding` wraps the workbook skill's readers and writers. Every read
 * tool sees a hidden cell as `{{label-NN}}` — its value, an empty cell, its
 * formula text and its note alike — and a cell leaning on hidden cells as
 * `{{label+label}}` with its formula text still shown. find_cells never
 * matches a hidden value; aggregate_range refuses a range that holds hidden or
 * leaning cells. `hidingOperationError` refuses every operation that would
 * write into, delete, copy out, key on or rename what is hidden; the model may
 * still write formulas that read hidden cells (only a person sees the result).
 *
 * A workbook without hiding marks passes through untouched. One whose marks
 * cannot be resolved fails closed: nothing of it is read.
 *
 * T9 (terminal / MCP) reuses `maskSheetCells`, `hidingOperationError` and
 * `sheetHidingState`/`prepareSheetHiding` from this folder.
 */
import {
  columnLabel,
  formatAddress,
  parseAddress,
} from '@genoffice/xlsx-gateway/domain/cell-address'
import {
  copyTargetBounds,
  type WorkbookOperation,
} from '@genoffice/xlsx-gateway/domain/workbook-dsl'
import { isHidingName } from '@genoffice/agent-core/hiding-name'
import type { CellScalar, ChangePlan } from '@genoffice/xlsx-gateway/domain/workbook.types'
import { buildMatcher } from '../ai/workbook-search'
import type {
  ActiveSheetInfo,
  CreateDocumentToolRequest,
  FindCellsMatch,
  SheetsSkillDeps,
  TraceCellSample,
} from '../ai/tools'
import { HIDING_MAX_COLUMN, HIDING_MAX_ROW, parseHidingReference, type HidingArea } from './marks'
import { dependentText, type SheetHidingState, type SheetHidingView } from './view'

/** What the model is told when the workbook's hiding marks cannot be followed. */
export const HIDING_UNAVAILABLE =
  'This workbook holds sensitive-info hiding marks that cannot be resolved (a deleted sheet, ' +
  '#REF!, or a name the editor cannot follow), so none of its content may be read. Tell the ' +
  'user to fix or remove the broken marks in Formulas › Name Manager.'

/** The refusal text of an operation that would reach hidden content. */
export function hiddenRefusal(what: string): string {
  return (
    `Rejected: ${what} touches cells hidden by sensitive-info hiding ({{…}}). Hidden cells cannot ` +
    'be written, deleted, copied, sorted, filtered or keyed on, and their values cannot be ' +
    'frozen into other cells. Formulas may read them (only the user sees the result).'
  )
}

export interface ReadCell {
  readonly value: CellScalar
  readonly formula?: string | undefined
  readonly rawValue?: CellScalar | undefined
}

function point(address: string): { row: number; column: number } | null {
  try {
    return parseAddress(address.trim().toUpperCase().replace(/\$/g, ''))
  } catch {
    return null
  }
}

/** One cell as the model may read it. */
export function maskSheetCell<T extends ReadCell>(
  view: SheetHidingView,
  sheetId: string,
  address: string,
  cell: T,
): T {
  if (!view.active) return cell
  const at = point(address)
  if (!at) return cell
  const label = view.hiddenLabel(sheetId, at.row, at.column)
  if (label !== null) {
    const raw = cell.rawValue !== undefined ? cell.rawValue : cell.value
    const text = view.placeholder(label, raw)
    // the formula text of a hidden cell is hidden too; other fields (an address) stay
    const { formula: _formula, ...rest } = cell
    return {
      ...rest,
      value: text,
      ...('rawValue' in cell ? { rawValue: text } : {}),
    } as unknown as T
  }
  const labels = view.dependentLabels(sheetId, at.row, at.column, cell.formula)
  if (!labels) return cell
  const text = dependentText(labels)
  return { ...cell, value: text, ...('rawValue' in cell ? { rawValue: text } : {}) }
}

/** A batch of cells of one sheet as the model may read them. */
export function maskSheetCells<T extends ReadCell>(
  view: SheetHidingView,
  sheetId: string,
  cells: Record<string, T>,
): Record<string, T> {
  if (!view.active) return cells
  const out: Record<string, T> = {}
  for (const [address, cell] of Object.entries(cells)) {
    out[address] = maskSheetCell(view, sheetId, address, cell)
  }
  return out
}

/** A range of an operation as an area of a sheet (A1, A1:B2, B:B, 2:5); null when unreadable. */
export function opArea(sheetId: string, range: string): HidingArea | null {
  const areas = parseHidingReference(range, [{ id: sheetId, name: '' }], sheetId)
  return areas?.length === 1 ? (areas[0] ?? null) : null
}

function rowsArea(sheetId: string, row: number, count: number): HidingArea {
  return {
    sheetId,
    startRow: row - 1,
    endRow: Math.min(row - 2 + count, HIDING_MAX_ROW),
    startColumn: 0,
    endColumn: HIDING_MAX_COLUMN,
  }
}

function columnsArea(sheetId: string, column: string, count: number): HidingArea | null {
  const first = opArea(sheetId, `${column}1`)
  if (!first) return null
  return {
    sheetId,
    startRow: 0,
    endRow: HIDING_MAX_ROW,
    startColumn: first.startColumn,
    endColumn: Math.min(first.startColumn + count - 1, HIDING_MAX_COLUMN),
  }
}

function sheetArea(sheetId: string): HidingArea {
  return {
    sheetId,
    startRow: 0,
    endRow: HIDING_MAX_ROW,
    startColumn: 0,
    endColumn: HIDING_MAX_COLUMN,
  }
}

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const item of value) strings(item, out)
  else if (value && typeof value === 'object')
    for (const item of Object.values(value)) strings(item, out)
  return out
}

export interface HidingOperationContext {
  /** the area a table covers now, or null when unknown */
  readonly tableArea?: ((sheetId: string, tableName: string) => HidingArea | null) | undefined
}

/**
 * Why a batch may not run, or null. Every operation is checked; the first
 * refusal wins and nothing of the batch is applied.
 */
export function hidingOperationError(
  operations: readonly WorkbookOperation[],
  view: SheetHidingView,
  context: HidingOperationContext = {},
): string | null {
  if (!view.active) return null
  const sheetHasMarks = (sheetId: string): boolean => view.touchesHidden(sheetArea(sheetId))
  /** an unreadable range on a sheet that holds marks is refused (fail closed) */
  const area = (sheetId: string, range: string): HidingArea | null | 'unreadable' => {
    const parsed = opArea(sheetId, range)
    if (parsed) return parsed
    return sheetHasMarks(sheetId) ? 'unreadable' : null
  }
  const hidden = (target: HidingArea | null | 'unreadable'): boolean =>
    target === 'unreadable' || (target !== null && view.touchesHidden(target))
  const leaning = (target: HidingArea | null | 'unreadable'): boolean =>
    target === 'unreadable' || (target !== null && view.hasDependentIn(target))

  for (const op of operations) {
    switch (op.op) {
      case 'set_cell':
      case 'set_formula':
      case 'clear_cell':
      case 'set_hyperlink':
      case 'set_note':
        if (hidden(area(op.sheetId, op.address))) return hiddenRefusal(`${op.op} ${op.address}`)
        break
      case 'set_range': {
        const anchor = op.range ?? op.start ?? 'A1'
        const start = opArea(op.sheetId, anchor)
        const rows = op.values.length
        const columns = Math.max(...op.values.map((row) => row.length))
        const target: HidingArea | 'unreadable' = start
          ? {
              sheetId: op.sheetId,
              startRow: start.startRow,
              startColumn: start.startColumn,
              endRow: Math.max(start.endRow, start.startRow + rows - 1),
              endColumn: Math.max(start.endColumn, start.startColumn + columns - 1),
            }
          : 'unreadable'
        if (hidden(target)) return hiddenRefusal(`set_range ${anchor}`)
        break
      }
      case 'clear_range':
      case 'find_replace':
      case 'merge_cells':
      case 'set_data_validation':
        if (hidden(area(op.sheetId, op.range))) return hiddenRefusal(`${op.op} ${op.range}`)
        break
      case 'convert_to_values': {
        const target = area(op.sheetId, op.range)
        if (hidden(target) || leaning(target)) return hiddenRefusal(`convert_to_values ${op.range}`)
        break
      }
      case 'fill_range': {
        const source = area(op.sourceSheetId ?? op.sheetId, op.source)
        if (hidden(source)) return hiddenRefusal(`fill_range from ${op.source}`)
        if (hidden(area(op.sheetId, op.target)))
          return hiddenRefusal(`fill_range into ${op.target}`)
        break
      }
      case 'copy_range':
      case 'move_range': {
        // a copy may freeze formulas into values, so a leaning source is refused too
        const source = area(op.sourceSheetId ?? op.sheetId, op.source)
        if (hidden(source) || leaning(source)) return hiddenRefusal(`${op.op} from ${op.source}`)
        let target: HidingArea | 'unreadable'
        try {
          target = { sheetId: op.sheetId, ...copyTargetBounds(op) }
        } catch {
          target = 'unreadable'
        }
        if (hidden(target)) return hiddenRefusal(`${op.op} into ${op.target}`)
        break
      }
      case 'delete_rows':
        if (view.touchesHidden(rowsArea(op.sheetId, op.row, op.count))) {
          return hiddenRefusal(`delete_rows ${op.row}`)
        }
        break
      case 'delete_cols': {
        const columns = columnsArea(op.sheetId, op.column, op.count)
        if (!columns || view.touchesHidden(columns))
          return hiddenRefusal(`delete_cols ${op.column}`)
        break
      }
      case 'delete_sheet':
      case 'duplicate_sheet':
        if (sheetHasMarks(op.sheetId))
          return hiddenRefusal(`${op.op} (the sheet holds hidden cells)`)
        break
      case 'delete_table_row':
      case 'delete_table_column': {
        const table = context.tableArea?.(op.sheetId, op.tableName) ?? null
        if (table ? view.touchesHidden(table) : sheetHasMarks(op.sheetId)) {
          return hiddenRefusal(`${op.op} in ${op.tableName}`)
        }
        break
      }
      case 'add_defined_name':
      case 'delete_defined_name':
        if (isHidingName(op.name)) {
          return (
            `Rejected: ${op.name} is a sensitive-info hiding mark. Only the user creates, ` +
            'changes or removes hiding marks.'
          )
        }
        break
      case 'sort_range': {
        const range = area(op.sheetId, op.range)
        if (hidden(range)) return hiddenRefusal(`sort_range ${op.range}`)
        const key =
          range === null || range === 'unreadable' ? null : columnsArea(op.sheetId, op.byColumn, 1)
        const keyCells =
          key && range && range !== 'unreadable'
            ? { ...key, startRow: range.startRow, endRow: range.endRow }
            : null
        if (keyCells && view.hasDependentIn(keyCells)) {
          return hiddenRefusal(`sort_range keyed on ${op.byColumn}`)
        }
        break
      }
      case 'set_filter_criteria': {
        const column = columnsArea(op.sheetId, op.column, 1)
        if (!column || view.touchesHidden(column) || view.hasDependentIn(column)) {
          return hiddenRefusal(`set_filter_criteria on ${op.column}`)
        }
        break
      }
      case 'add_conditional_format': {
        const range = area(op.sheetId, op.range)
        if (hidden(range) || leaning(range)) {
          return hiddenRefusal(`add_conditional_format ${op.range}`)
        }
        for (const text of strings(op.rule)) {
          if (text.startsWith('=') && view.formulaLabels(op.sheetId, text).size > 0) {
            return hiddenRefusal('add_conditional_format with a formula reading hidden cells')
          }
        }
        break
      }
      case 'add_pivot': {
        const source = area(op.sheetId, op.sourceRange)
        if (hidden(source) || leaning(source))
          return hiddenRefusal(`add_pivot from ${op.sourceRange}`)
        if (hidden(area(op.targetSheetId ?? op.sheetId, op.targetCell))) {
          return hiddenRefusal(`add_pivot into ${op.targetCell}`)
        }
        break
      }
      default:
        break
    }
  }
  return null
}

/** Why create_document may not export a sheet, or null. */
export function hidingCreateDocumentError(
  request: CreateDocumentToolRequest,
  view: SheetHidingView,
  activeSheetId: string,
): string | null {
  if (!view.active || (request.type !== 'xlsx' && request.type !== 'csv')) return null
  const sheet = sheetArea(request.sheetId ?? activeSheetId)
  if (view.touchesHidden(sheet) || view.hasDependentIn(sheet)) {
    return hiddenRefusal('create_document (a new file would copy the sheet)')
  }
  return null
}

function sheetIdByName(info: ActiveSheetInfo, name: string): string | undefined {
  return info.sheets.find((sheet) => sheet.name === name)?.id
}

/** The sheet a trace reference label names ("Data!A1:B2" or "A1:B2"). */
function sheetOfLabel(info: ActiveSheetInfo, label: string, fallback: string): string {
  const bang = label.lastIndexOf('!')
  if (bang < 0) return fallback
  const name = label
    .slice(0, bang)
    .replace(/^'(.*)'$/, '$1')
    .replace(/''/g, "'")
  return sheetIdByName(info, name) ?? fallback
}

export interface SheetHidingHooks {
  /** the hiding state of the open workbook now */
  readonly state: () => SheetHidingState
  /** read_sheet_features with notes, validation lists and filter values of hidden cells hidden */
  readonly readSheetFeatures: (sheetId: string | undefined, view: SheetHidingView) => string
  readonly operation?: HidingOperationContext | undefined
}

/**
 * The sheet overview as the model may read it: header names come from the
 * first row of the selection's sheet, so they are dropped while anything in
 * that row is hidden. During a run the selection may sit on a sheet other than
 * the active one; an overview that does not say which sheet is checked against
 * the first row of every sheet with a mark.
 */
export function withoutHiddenHeaders<
  T extends Pick<ActiveSheetInfo, 'sheetId' | 'selectionColumns' | 'selectionSheetId'>,
>(view: SheetHidingView, info: T): T {
  if (!view.active || !info.selectionColumns?.length) return info
  const sheetIds =
    info.selectionSheetId !== undefined
      ? [info.selectionSheetId]
      : [info.sheetId, ...view.marks.flatMap((mark) => mark.areas.map((a) => a.sheetId))]
  const headerHidden = sheetIds.some((sheetId) =>
    view.touchesHidden({
      sheetId,
      startRow: 0,
      endRow: 0,
      startColumn: 0,
      endColumn: HIDING_MAX_COLUMN,
    }),
  )
  if (!headerHidden) return info
  const { selectionColumns: _hidden, ...rest } = info
  return rest as T
}

/** A plan's before/after values as the model may read them. */
function maskPlan(plan: ChangePlan, view: SheetHidingView): ChangePlan {
  if (!view.active || plan.cellChanges.length === 0) return plan
  return {
    ...plan,
    cellChanges: plan.cellChanges.map((change) => ({
      ...change,
      before: maskSheetCell(view, change.sheetId, change.address, change.before),
    })),
  }
}

/**
 * The skill's readers and writers with hiding applied. Reads of a workbook
 * whose marks cannot be resolved fail; the skill wrapper keeps those from
 * reaching the model at all (see `hidingSkillGate`).
 */
export function withSheetHiding(deps: SheetsSkillDeps, hooks: SheetHidingHooks): SheetsSkillDeps {
  const viewOrThrow = (): SheetHidingView => {
    const state = hooks.state()
    if (!state.ok) throw new Error(HIDING_UNAVAILABLE)
    return state.view
  }
  const activeId = (): string => deps.getActiveSheetInfo().sheetId
  const wrapped: SheetsSkillDeps = {
    ...deps,
    getActiveSheetInfo() {
      return withoutHiddenHeaders(viewOrThrow(), deps.getActiveSheetInfo())
    },
    readCells(addresses, sheetId) {
      const view = viewOrThrow()
      const cells = deps.readCells(addresses, sheetId)
      return maskSheetCells(view, sheetId ?? activeId(), cells)
    },
    readSheetFeatures(sheetId) {
      return hooks.readSheetFeatures(sheetId, viewOrThrow())
    },
    async findCells(options) {
      const view = viewOrThrow()
      const outcome = await deps.findCells(options)
      if (!view.active || outcome.error) return outcome
      const info = deps.getActiveSheetInfo()
      const matcher = buildMatcher({ ...options, lookIn: 'formulas', errorsOnly: false })
      const matches: FindCellsMatch[] = []
      for (const match of outcome.matches) {
        const sheetId = sheetIdByName(info, match.sheetName)
        const at = point(match.address)
        // a match the hiding cannot place is dropped
        if (sheetId === undefined || !at) continue
        if (view.hiddenLabel(sheetId, at.row, at.column) !== null) continue
        const labels = view.dependentLabels(sheetId, at.row, at.column, match.formula)
        if (!labels) {
          matches.push(match)
          continue
        }
        // a leaning cell may match on its formula text only, never on its value
        const formulaHit =
          !options.errorsOnly &&
          options.lookIn !== 'values' &&
          matcher.ok &&
          matcher.test(undefined, match.formula)
        if (formulaHit) matches.push({ ...match, value: dependentText(labels) })
      }
      return { ...outcome, matches }
    },
    async tracePrecedents(sheetId, address) {
      const view = viewOrThrow()
      const outcome = await deps.tracePrecedents(sheetId, address)
      if (!view.active || outcome.error) return outcome
      const info = deps.getActiveSheetInfo()
      const target = sheetId ?? info.sheetId
      const at = point(address)
      const label = at ? view.hiddenLabel(target, at.row, at.column) : null
      if (label !== null) {
        return { refs: [], value: view.placeholder(label, outcome.value ?? null) }
      }
      const self = maskSheetCell(view, target, address, {
        value: outcome.value ?? null,
        formula: outcome.formula,
      })
      return {
        ...outcome,
        value: self.value,
        refs: outcome.refs.map((ref) => {
          const refSheet = sheetOfLabel(info, ref.label, target)
          return {
            ...ref,
            samples: ref.samples.map((sample): TraceCellSample =>
              maskSheetCell(view, refSheet, sample.address, sample),
            ),
          }
        }),
      }
    },
    async traceDependents(sheetId, address) {
      const view = viewOrThrow()
      const outcome = await deps.traceDependents(sheetId, address)
      if (!view.active || outcome.error) return outcome
      const info = deps.getActiveSheetInfo()
      return {
        ...outcome,
        dependents: outcome.dependents.map((dependent) => {
          const depSheet = sheetIdByName(info, dependent.sheetName) ?? info.sheetId
          const at = point(dependent.address)
          const label = at ? view.hiddenLabel(depSheet, at.row, at.column) : null
          if (label !== null) {
            return { ...dependent, formula: '', value: view.placeholder(label, dependent.value) }
          }
          const masked = maskSheetCell(view, depSheet, dependent.address, {
            value: dependent.value,
            formula: dependent.formula,
          })
          return { ...dependent, value: masked.value }
        }),
      }
    },
    proposeOperations(operations, summary) {
      const view = viewOrThrow()
      const refusal = hidingOperationError(operations, view, hooks.operation)
      if (refusal) return { ok: false, error: refusal }
      const outcome = deps.proposeOperations(operations, summary)
      if (!outcome.ok) return outcome
      return { ...outcome, plan: maskPlan(outcome.plan, view) }
    },
  }
  if (deps.aggregateRange) {
    const aggregate = deps.aggregateRange
    wrapped.aggregateRange = async (sheetId, range) => {
      const view = viewOrThrow()
      if (view.active) {
        const area: HidingArea = { sheetId: sheetId ?? activeId(), ...range }
        if (view.touchesHidden(area) || view.hasDependentIn(area)) {
          return {
            ok: false,
            error:
              'Refused: this range holds cells hidden by sensitive-info hiding (or values computed ' +
              'from them), so no statistics are given for it. Aggregate a range without them.',
          }
        }
      }
      return aggregate(sheetId, range)
    }
  }
  if (deps.createDocument) {
    const create = deps.createDocument
    wrapped.createDocument = async (request) => {
      const view = viewOrThrow()
      const refusal = hidingCreateDocumentError(request, view, activeId())
      if (refusal) return { ok: false, error: refusal }
      return create(request)
    }
  }
  return wrapped
}

/** A context note telling the model where the hidden ranges are and what it may not do. */
export function hidingContextNote(
  view: SheetHidingView,
  sheets: ActiveSheetInfo['sheets'],
): string {
  if (!view.active) return ''
  const name = (sheetId: string): string =>
    sheets.find((sheet) => sheet.id === sheetId)?.name ?? sheetId
  const lines = view.marks.map((mark) => {
    const ranges = mark.areas
      .map((area) => {
        const from = formatAddress(area.startRow, area.startColumn)
        const to =
          area.endRow >= HIDING_MAX_ROW
            ? columnLabel(area.endColumn)
            : formatAddress(area.endRow, area.endColumn)
        return `${name(area.sheetId)}!${from}:${to}`
      })
      .join(', ')
    return `- {{${mark.label}}}: ${ranges}`
  })
  return [
    'Sensitive-info hiding: the user hid these ranges from you. Their cells read as {{label-NN}} ' +
      '(the same value always has the same number), and cells computed from them read as ' +
      '{{label+label}}. You cannot write, delete, copy, sort or filter them, or turn formulas that ' +
      'read them into values; you may write formulas that read them (only the user sees the result). ' +
      'Never guess or ask for the hidden values.',
    ...lines,
  ].join('\n')
}
