/**
 * Hiding marks follow hidden values a person moves inside the workbook.
 *
 * Copying or cutting hidden cells and pasting them elsewhere in the same
 * workbook, dragging them, or sorting rows so hidden values land on other
 * rows: the new places are added to the mark. Places are only ever added,
 * never taken away — an undo that moves the values back then still finds them
 * hidden, and hiding a little too much is the safe side. Pasting into another
 * workbook carries values only (that tab has its own marks).
 *
 * A mark's reference that would grow past what a defined name can hold is
 * widened to one box per sheet instead.
 */
import { CommandType, ICommandService, type IRange } from '@univerjs/core'
import type { UniverRuntime } from '../univer-state'
import { matrixBounds } from '../univer-sync'
import {
  areasIntersect,
  formatHidingReference,
  hidingSheetsOf,
  readHidingMarks,
  type HidingArea,
  type SheetHidingMark,
} from './marks'

/** Excel's limit on a defined name's formula is 8192 characters; stay clear of it. */
const MAX_REFERENCE_LENGTH = 8000

function intersection(a: HidingArea, b: HidingArea): HidingArea | null {
  if (!areasIntersect(a, b)) return null
  return {
    sheetId: a.sheetId,
    startRow: Math.max(a.startRow, b.startRow),
    endRow: Math.min(a.endRow, b.endRow),
    startColumn: Math.max(a.startColumn, b.startColumn),
    endColumn: Math.min(a.endColumn, b.endColumn),
  }
}

function contains(outer: HidingArea, inner: HidingArea): boolean {
  return (
    outer.sheetId === inner.sheetId &&
    outer.startRow <= inner.startRow &&
    inner.endRow <= outer.endRow &&
    outer.startColumn <= inner.startColumn &&
    inner.endColumn <= outer.endColumn
  )
}

/** Fewer, larger rectangles: drop contained ones, join neighbours that line up. */
export function normalizeAreas(areas: readonly HidingArea[]): HidingArea[] {
  let list = areas.filter(
    (area, i) =>
      !areas.some(
        (other, j) => j !== i && contains(other, area) && (j < i || !contains(area, other)),
      ),
  )
  let joined = true
  while (joined) {
    joined = false
    outer: for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i]
        const b = list[j]
        if (!a || !b || a.sheetId !== b.sheetId) continue
        const sameColumns = a.startColumn === b.startColumn && a.endColumn === b.endColumn
        const sameRows = a.startRow === b.startRow && a.endRow === b.endRow
        let merged: HidingArea | null = null
        if (sameColumns && (b.startRow === a.endRow + 1 || a.startRow === b.endRow + 1)) {
          merged = {
            ...a,
            startRow: Math.min(a.startRow, b.startRow),
            endRow: Math.max(a.endRow, b.endRow),
          }
        } else if (
          sameRows &&
          (b.startColumn === a.endColumn + 1 || a.startColumn === b.endColumn + 1)
        ) {
          merged = {
            ...a,
            startColumn: Math.min(a.startColumn, b.startColumn),
            endColumn: Math.max(a.endColumn, b.endColumn),
          }
        }
        if (merged) {
          list = [...list.slice(0, i), merged, ...list.slice(i + 1, j), ...list.slice(j + 1)]
          joined = true
          break outer
        }
      }
    }
  }
  return list
}

/** One box per sheet around the areas. */
function boxes(areas: readonly HidingArea[]): HidingArea[] {
  const bySheet = new Map<string, HidingArea>()
  for (const area of areas) {
    const box = bySheet.get(area.sheetId)
    bySheet.set(
      area.sheetId,
      box
        ? {
            sheetId: area.sheetId,
            startRow: Math.min(box.startRow, area.startRow),
            endRow: Math.max(box.endRow, area.endRow),
            startColumn: Math.min(box.startColumn, area.startColumn),
            endColumn: Math.max(box.endColumn, area.endColumn),
          }
        : area,
    )
  }
  return [...bySheet.values()]
}

/**
 * Where the hidden parts of `source` land when it is pasted over `target`
 * (repeated as tiles when the target is a multiple of the source).
 */
export function followCopy(
  marks: readonly SheetHidingMark[],
  source: HidingArea,
  target: HidingArea,
): Map<string, HidingArea[]> {
  const out = new Map<string, HidingArea[]>()
  const height = source.endRow - source.startRow + 1
  const width = source.endColumn - source.startColumn + 1
  const tilesDown = Math.max(1, Math.floor((target.endRow - target.startRow + 1) / height))
  const tilesAcross = Math.max(1, Math.floor((target.endColumn - target.startColumn + 1) / width))
  for (const mark of marks) {
    const added: HidingArea[] = []
    for (const area of mark.areas) {
      const part = intersection(area, source)
      if (!part) continue
      for (let down = 0; down < tilesDown; down += 1) {
        for (let across = 0; across < tilesAcross; across += 1) {
          const rowShift = target.startRow + down * height - source.startRow
          const columnShift = target.startColumn + across * width - source.startColumn
          added.push({
            sheetId: target.sheetId,
            startRow: part.startRow + rowShift,
            endRow: part.endRow + rowShift,
            startColumn: part.startColumn + columnShift,
            endColumn: part.endColumn + columnShift,
          })
        }
      }
    }
    if (added.length > 0) out.set(mark.name, added)
  }
  return out
}

/**
 * Where hidden values land after a row reorder of `range` (a sort):
 * `order[row]` is the old row whose cells now sit on `row`.
 */
export function followReorder(
  marks: readonly SheetHidingMark[],
  sheetId: string,
  range: IRange,
  order: Readonly<Record<number, number>>,
): Map<string, HidingArea[]> {
  const out = new Map<string, HidingArea[]>()
  const span: HidingArea = { sheetId, ...range }
  for (const mark of marks) {
    const added: HidingArea[] = []
    for (const area of mark.areas) {
      const part = intersection(area, span)
      if (!part) continue
      for (const [row, from] of Object.entries(order)) {
        const newRow = Number(row)
        if (from < part.startRow || from > part.endRow) continue
        // a value moving inside the hidden rows stays hidden already
        if (newRow >= part.startRow && newRow <= part.endRow) continue
        added.push({ ...part, startRow: newRow, endRow: newRow })
      }
    }
    if (added.length > 0) out.set(mark.name, normalizeAreas(added))
  }
  return out
}

interface DefinedNameFacade {
  getName(): string
  setRef(ref: string): void
}

/** Add areas to the marks named; returns how many marks grew. */
export function addToMarks(
  runtime: UniverRuntime,
  additions: ReadonlyMap<string, HidingArea[]>,
): number {
  if (additions.size === 0) return 0
  const marks = readHidingMarks(runtime, null)
  if (!marks.ok) return 0
  const workbook = runtime.univerAPI.getActiveWorkbook() as unknown as {
    getDefinedNames(): DefinedNameFacade[]
  } | null
  if (!workbook) return 0
  const sheets = hidingSheetsOf(runtime)
  let grown = 0
  for (const mark of marks.marks) {
    const added = additions.get(mark.name)
    if (!added?.length) continue
    const fresh = added.filter((area) => !mark.areas.some((own) => contains(own, area)))
    if (fresh.length === 0) continue
    let areas = normalizeAreas([...mark.areas, ...fresh])
    let ref = formatHidingReference(areas, sheets)
    if (ref.length > MAX_REFERENCE_LENGTH) {
      areas = boxes(areas)
      ref = formatHidingReference(areas, sheets)
    }
    workbook
      .getDefinedNames()
      .find((defined) => defined.getName() === mark.name)
      ?.setRef(ref)
    grown += 1
  }
  return grown
}

interface MoveParams {
  from?: { subUnitId?: string; value?: unknown }
  to?: { subUnitId?: string; value?: unknown }
  fromRange?: IRange
  toRange?: IRange
  subUnitId?: string
  unitId?: string
}

interface SelectionRange {
  getRange(): IRange
}

function activeArea(runtime: UniverRuntime): HidingArea | null {
  const workbook = runtime.univerAPI.getActiveWorkbook()
  const sheet = workbook?.getActiveSheet()
  const range = workbook?.getActiveRange() as unknown as SelectionRange | null | undefined
  if (!sheet || !range) return null
  return { sheetId: sheet.getSheetId(), ...range.getRange() }
}

const PASTE_IGNORED = new Set(['sheet.command.paste-col-width', 'sheet.command.paste-format'])

/** Watch copies, pastes, moves and sorts of the open workbook. */
export function installHidingFollow(runtime: UniverRuntime): { dispose(): void } {
  const injector = runtime.univer.__getInjector()
  let copied: { unitId: string; area: HidingArea } | null = null
  const later = (additions: Map<string, HidingArea[]>): void => {
    if (additions.size === 0) return
    // name edits are commands of their own: run them after this one settles
    setTimeout(() => addToMarks(runtime, additions), 0)
  }
  const marksNow = (): readonly SheetHidingMark[] => {
    const marks = readHidingMarks(runtime, null)
    return marks.ok ? marks.marks : []
  }
  const listener = injector.get(ICommandService).onCommandExecuted((command) => {
    const unitId = runtime.univerAPI.getActiveWorkbook()?.getId()
    if (!unitId) return
    if (command.id === 'sheet.command.copy' || command.id === 'sheet.command.cut') {
      const area = activeArea(runtime)
      copied = area ? { unitId, area } : null
      return
    }
    if (command.id.startsWith('sheet.command.paste') && !PASTE_IGNORED.has(command.id)) {
      const target = activeArea(runtime)
      if (!copied || copied.unitId !== unitId || !target) return
      const marks = marksNow()
      if (marks.length > 0) later(followCopy(marks, copied.area, target))
      return
    }
    if (command.type !== CommandType.MUTATION) return
    if (command.id === 'sheet.mutation.move-range') {
      const params = (command.params ?? {}) as MoveParams
      if (params.unitId && params.unitId !== unitId) return
      const fromSheet = params.from?.subUnitId ?? params.subUnitId
      const toSheet = params.to?.subUnitId ?? params.subUnitId
      if (!fromSheet || !toSheet) return
      const marks = marksNow()
      if (marks.length === 0) return
      if (params.fromRange && params.toRange) {
        later(
          followCopy(
            marks,
            { sheetId: fromSheet, ...params.fromRange },
            { sheetId: toSheet, ...params.toRange },
          ),
        )
        return
      }
      // without the exact ranges the shift cannot be told: hide the whole landing block
      const from = matrixBounds(params.from?.value)
      const to = matrixBounds(params.to?.value)
      if (!from || !to) return
      const source: HidingArea = { sheetId: fromSheet, ...from }
      const landing: HidingArea = { sheetId: toSheet, ...to }
      later(
        new Map(
          marks
            .filter((mark) => mark.areas.some((area) => areasIntersect(area, source)))
            .map((mark) => [mark.name, [landing]]),
        ),
      )
      return
    }
    if (command.id === 'sheet.mutation.reorder-range') {
      const params = (command.params ?? {}) as {
        unitId?: string
        subUnitId?: string
        range?: IRange
        order?: Record<number, number>
      }
      if (params.unitId && params.unitId !== unitId) return
      if (!params.subUnitId || !params.range || !params.order) return
      const marks = marksNow()
      if (marks.length > 0)
        later(followReorder(marks, params.subUnitId, params.range, params.order))
    }
  })
  return {
    dispose() {
      listener.dispose()
    },
  }
}
