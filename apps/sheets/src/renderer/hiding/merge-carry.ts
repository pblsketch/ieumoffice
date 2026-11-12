/**
 * Sensitive-info hiding through "merge workbooks" (the ribbon's Merge and the
 * AI's merge_attached_workbooks): the hiding marks of a source workbook come
 * along and keep hiding the same cells on the merged sheets.
 *
 * Merging imports formulas as their computed values, so a source cell that
 * leans on hidden cells would arrive as a plain value nothing hides any more.
 * A source like that — or one whose marks cannot be resolved, whose formulas
 * cannot all be read, or that holds a pivot table next to its marks — is not
 * merged at all. Sources without marks merge exactly as before.
 */
import type { WorkbookFile } from '../../shared/desktop-api'
import { indexedFormulas, SharedFormulaLookup } from '../shared-formula-index'
import type { UniverRuntime } from '../univer-state'
import { createDependencyIndex, formulaRefAreas, type HidingNode } from './dependents'
import { createHidingMark } from './actions'
import {
  formatHidingReference,
  hidingSheetsOf,
  resolveHidingMarks,
  type HidingArea,
  type HidingSheet,
  type SheetHidingMark,
} from './marks'

/** A source workbook that cannot be merged without its hidden cells leaving their marks. */
export class HidingCarryRefused extends Error {
  constructor(readonly fileName: string) {
    super(`The hidden cells of ${fileName} cannot be carried into this workbook.`)
    this.name = 'HidingCarryRefused'
  }
}

/** The hiding marks of a source workbook, or null when it has none; throws when they cannot be carried. */
export function sourceHidingMarks(file: WorkbookFile): SheetHidingMark[] | null {
  const sheets: HidingSheet[] = file.sheets.map((sheet) => ({ id: sheet.id, name: sheet.name }))
  const marks = resolveHidingMarks(
    file.definedNames.map((defined) => ({
      name: defined.name,
      formula: defined.formula,
      localSheetId: defined.sheetIndex === undefined ? undefined : sheets[defined.sheetIndex]?.id,
    })),
    sheets,
  )
  if (!marks.ok) throw new HidingCarryRefused(file.name)
  return marks.marks.length > 0 ? [...marks.marks] : null
}

type ReadFormulas = Window['desktopApi']['readWorkbookFormulas']

/** Every formula of a source sheet; waits for the source to finish indexing. */
async function sourceFormulas(
  file: WorkbookFile,
  sheetId: string,
  read: ReadFormulas,
): Promise<{ row: number; column: number; formula: string }[]> {
  const deadline = Date.now() + 120_000
  for (;;) {
    const result = await read({ sessionId: file.sessionId, sheetId })
    if (result.truncated) throw new HidingCarryRefused(file.name)
    if (result.indexingComplete) {
      return indexedFormulas(result.cells, new SharedFormulaLookup(result.sharedGroups))
    }
    if (Date.now() > deadline) throw new HidingCarryRefused(file.name)
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
}

/**
 * Check that a marked source can be merged: nothing in it leans on its hidden
 * cells. Throws `HidingCarryRefused` otherwise.
 */
export async function checkSourceCarriable(
  file: WorkbookFile,
  marks: readonly SheetHidingMark[],
  read: ReadFormulas = (request) => window.desktopApi.readWorkbookFormulas(request),
): Promise<void> {
  const sheets: HidingSheet[] = file.sheets.map((sheet) => ({ id: sheet.id, name: sheet.name }))
  if (file.sheets.some((sheet) => sheet.pivotRanges.length > 0 || sheet.pivotTables.length > 0)) {
    throw new HidingCarryRefused(file.name)
  }
  const nodes: HidingNode[] = []
  for (const sheet of file.sheets) {
    for (const cell of await sourceFormulas(file, sheet.id, read)) {
      nodes.push({
        area: {
          sheetId: sheet.id,
          startRow: cell.row,
          endRow: cell.row,
          startColumn: cell.column,
          endColumn: cell.column,
        },
        refs: formulaRefAreas(cell.formula, sheet.id, { sheets }),
      })
    }
  }
  const index = createDependencyIndex(marks, nodes)
  if (
    nodes.some((node) =>
      index.labelsAt(node.area.sheetId, node.area.startRow, node.area.startColumn),
    )
  ) {
    throw new HidingCarryRefused(file.name)
  }
}

/**
 * Re-creates a source's marks on the merged sheets as they arrive. Call
 * `sheetAdded` right after each source sheet's new sheet exists and before its
 * values are written.
 */
export function createHidingCarry(
  runtime: UniverRuntime,
  marks: readonly SheetHidingMark[],
  lang: string,
): { sheetAdded(sourceSheetId: string, newSheetId: string): void } {
  const placed = new Map<string, { name: string; areas: HidingArea[] }>()
  return {
    sheetAdded(sourceSheetId, newSheetId) {
      for (const mark of marks) {
        const moved = mark.areas
          .filter((area) => area.sheetId === sourceSheetId)
          .map((area) => ({ ...area, sheetId: newSheetId }))
        if (moved.length === 0) continue
        const existing = placed.get(mark.name)
        if (!existing) {
          const name = createHidingMark(runtime, moved, mark.label, lang)
          if (!name) throw new Error(`Could not carry ${mark.name}.`)
          placed.set(mark.name, { name, areas: moved })
          continue
        }
        existing.areas.push(...moved)
        const workbook = runtime.univerAPI.getActiveWorkbook() as unknown as {
          getDefinedNames(): { getName(): string; setRef(ref: string): void }[]
        } | null
        workbook
          ?.getDefinedNames()
          .find((defined) => defined.getName() === existing.name)
          ?.setRef(formatHidingReference(existing.areas, hidingSheetsOf(runtime)))
      }
    },
  }
}
