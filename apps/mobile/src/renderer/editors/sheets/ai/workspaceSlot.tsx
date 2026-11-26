/**
 * The ai area's share of the editor screen (owned by XLS-T11): the [AI] entry, shown only while AI is on.
 * Empty until that task fills it; SheetsWorkspace already calls it.
 */
import type { SheetsWorkspaceSlot } from '../workspace/slots'

export const useAiWorkspaceItems: SheetsWorkspaceSlot = () => ({})
