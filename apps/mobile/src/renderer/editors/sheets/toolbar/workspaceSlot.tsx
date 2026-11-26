/**
 * The toolbar area's share of the editor screen (owned by XLS-T9): the edit toolbar groups ([셀 서식][행·열][정렬·필터][삽입]) and their format sheets.
 * Empty until that task fills it; SheetsWorkspace already calls it.
 */
import type { SheetsWorkspaceSlot } from '../workspace/slots'

export const useToolbarWorkspaceItems: SheetsWorkspaceSlot = () => ({})
