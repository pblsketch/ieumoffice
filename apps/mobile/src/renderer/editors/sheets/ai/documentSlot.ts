/**
 * The spreadsheet's AI run (owned by XLS-T11): the desktop's workbook tools
 * with the phone's limits (spec 2.6). Until that task fills it there is no
 * run, so the document has no `createAiRun` (the AI entry stays hidden while
 * AI is off, which is the mobile default).
 *
 * A workbook opened with a password runs AI like any other document
 * (owner's decision): do not turn it off for `opened.unlocked`.
 */
import type { EditorAiContext, EditorAiRun } from '../../editorKind'
import type { SheetsDocumentContext } from '../workspace/slots'

export type SheetsAiRunFactory = (
  context: SheetsDocumentContext,
  ai: EditorAiContext,
) => Promise<EditorAiRun>

export const createSheetsAiRun: SheetsAiRunFactory | undefined = undefined
