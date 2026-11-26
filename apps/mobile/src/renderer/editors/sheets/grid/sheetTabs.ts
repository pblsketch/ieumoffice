/**
 * Sheet switching, adding and renaming for the phone's sheet switcher. Each
 * change is the Univer command the desktop's sheet bar sends, so the edit
 * journal records it as on the desktop; an added sheet gets its name from the
 * desktop's own naming hook (apps/sheets/src/renderer/new-sheet-name.ts,
 * installed with the grid): the lowest free `SheetN` in every UI language.
 */
import { nameCharacterCheck } from '@univerjs/core'
import type { UniverRuntime } from '../../../../../../sheets/src/renderer/univer-state'

export const INSERT_SHEET_COMMAND = 'sheet.command.insert-sheet'
export const SET_SHEET_NAME_COMMAND = 'sheet.command.set-worksheet-name'

export interface SheetTab {
  readonly id: string
  readonly name: string
}

export interface SheetTabsState {
  readonly tabs: readonly SheetTab[]
  readonly activeId: string | null
}

/** The visible sheets in order and the active one (hidden sheets have no tab, as on the desktop). */
export function readSheetTabs(runtime: UniverRuntime): SheetTabsState {
  const workbook = runtime.univerAPI.getActiveWorkbook()
  if (!workbook) return { tabs: [], activeId: null }
  const tabs = workbook
    .getSheets()
    .filter((sheet) => !sheet.isSheetHidden())
    .map((sheet) => ({ id: sheet.getSheetId(), name: sheet.getSheetName() }))
  return { tabs, activeId: workbook.getActiveSheet()?.getSheetId() ?? null }
}

export function sameSheetTabs(a: SheetTabsState, b: SheetTabsState): boolean {
  if (a.activeId !== b.activeId || a.tabs.length !== b.tabs.length) return false
  return a.tabs.every(
    (tab, index) => tab.id === b.tabs[index]?.id && tab.name === b.tabs[index]?.name,
  )
}

export function activateSheet(runtime: UniverRuntime, sheetId: string): void {
  const workbook = runtime.univerAPI.getActiveWorkbook()
  const sheet = workbook?.getSheetBySheetId(sheetId)
  if (workbook && sheet) workbook.setActiveSheet(sheet)
}

/**
 * Adds a sheet after the last one and shows it. The command goes out without
 * a name, like the sheet bar's [+]; the desktop hook names it. Resolves with
 * the new sheet's name, or null when an edit gate refused it.
 */
export async function addSheet(runtime: UniverRuntime): Promise<string | null> {
  const workbook = runtime.univerAPI.getActiveWorkbook()
  if (!workbook) return null
  const before = new Set(workbook.getSheets().map((sheet) => sheet.getSheetId()))
  const done = await runtime.univerAPI.executeCommand(INSERT_SHEET_COMMAND, {
    unitId: workbook.getId(),
    index: workbook.getSheets().length,
    sheet: {},
  })
  if (!done) return null
  const added = workbook.getSheets().find((sheet) => !before.has(sheet.getSheetId()))
  if (!added) return null
  workbook.setActiveSheet(added)
  return added.getSheetName()
}

export type SheetNameProblem = 'empty' | 'invalid' | 'taken'

/**
 * Excel's sheet name rules, as Univer's sheet bar checks them before it
 * renames (`nameCharacterCheck` and the workbook's case-insensitive
 * duplicate check, with the desktop's case-change fix installed).
 */
export function sheetNameProblem(
  runtime: UniverRuntime,
  sheetId: string,
  name: string,
): SheetNameProblem | null {
  if (name.trim() === '') return 'empty'
  if (!nameCharacterCheck(name)) return 'invalid'
  const workbook = runtime.univerAPI.getActiveWorkbook()
  if (!workbook) return null
  const lower = name.toLowerCase()
  const taken = workbook
    .getSheets()
    .some((sheet) => sheet.getSheetId() !== sheetId && sheet.getSheetName().toLowerCase() === lower)
  return taken ? 'taken' : null
}

/** Renames a sheet; resolves false when the name breaks a rule or a gate refused it. */
export async function renameSheet(
  runtime: UniverRuntime,
  sheetId: string,
  name: string,
): Promise<boolean> {
  if (sheetNameProblem(runtime, sheetId, name) !== null) return false
  const workbook = runtime.univerAPI.getActiveWorkbook()
  if (!workbook) return false
  if (workbook.getSheetBySheetId(sheetId)?.getSheetName() === name) return true
  return (
    (await runtime.univerAPI.executeCommand(SET_SHEET_NAME_COMMAND, {
      unitId: workbook.getId(),
      subUnitId: sheetId,
      name,
    })) === true
  )
}
