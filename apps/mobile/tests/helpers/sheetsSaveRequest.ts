import type { WorkbookSaveRequest } from '../../../sheets/src/shared/desktop-api'

/** A save request with nothing in it, shaped as the desktop renderer builds one. */
export function emptySaveRequest(sessionId: string): WorkbookSaveRequest {
  return {
    sessionId,
    mode: 'save',
    edits: [],
    bulkConstantFills: [],
    structuralOps: [],
    chartEdits: [],
    visualEdits: [],
    visualAdditions: [],
    tableAdditions: [],
    tableEdits: [],
    pivotAdditions: [],
    sheetOps: [],
    sheetOrder: [],
    filterStates: [],
    hyperlinkEdits: [],
    cfStates: [],
    dvStates: [],
    pageSetupStates: [],
    noteStates: [],
    formulaValues: [],
    pivotCacheRefreshPaths: [],
    pivotRefreshUpdates: [],
    sheetProtections: [],
    sparklineAdditions: [],
    definedNamesState: null,
    themeState: null,
    workbookProtectionState: null,
    protectedRangeStates: [],
  }
}

/** One typed value in a cell (`sheetId` as the engine's open answer names it). */
export function valueEdit(
  sessionId: string,
  sheetId: string,
  row: number,
  column: number,
  value: string,
) {
  const request = emptySaveRequest(sessionId)
  return {
    ...request,
    edits: [{ sheetId, row, column, writeValue: true, value }],
  } satisfies WorkbookSaveRequest
}
