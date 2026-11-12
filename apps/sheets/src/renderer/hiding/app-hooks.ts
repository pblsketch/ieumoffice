/**
 * The hiding hooks of the editor's AI skill, built from the App's refs. Kept
 * out of App.tsx so the wiring there stays one line.
 */
import { readSheetFeatures, type WorkbookReadContext } from '../ai/workbook-readers'
import type { WorkbookSkillHiding } from '../ai/workbook-skill'
import { planFileTableRegistrations } from '../file-tables'
import { fileRangeToScreenRange } from '../view-transform'
import type { HidingArea } from './marks'
import { prepareSheetHiding, sheetHidingState } from './view'

/** The area a table covers now (file tables mapped through the session's row/column changes). */
export function tableAreaOf(
  ctx: WorkbookReadContext,
  sheetId: string,
  tableName: string,
): HidingArea | null {
  const state = ctx.lazyWorkbookRef.current
  if (!state) return null
  const wanted = tableName.toLowerCase()
  const added = state.editJournal.tableAdds.find(
    (table) => table.sheetId === sheetId && table.name.toLowerCase() === wanted,
  )
  if (added) return { sheetId, ...added.area }
  const file = planFileTableRegistrations(state.file.sheets).find(
    (table) => table.sheetId === sheetId && table.tableName.toLowerCase() === wanted,
  )
  if (!file) return null
  const ops = state.editJournal.structuralOps.get(sheetId) ?? []
  const mapped = ops.length > 0 ? fileRangeToScreenRange(ops, file.range) : file.range
  return mapped ? { sheetId, ...mapped } : null
}

export function sheetSkillHiding(context: () => WorkbookReadContext): WorkbookSkillHiding {
  return {
    state: () => sheetHidingState(context()),
    prepare: () => prepareSheetHiding(context()),
    readSheetFeatures: (sheetId, view) => readSheetFeatures(context(), sheetId, view),
    operation: {
      tableArea: (sheetId, tableName) => tableAreaOf(context(), sheetId, tableName),
    },
  }
}
