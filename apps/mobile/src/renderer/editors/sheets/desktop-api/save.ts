/**
 * The save side of the phone's desktop API: the methods the desktop
 * renderer's save flow (`handleSave` in apps/sheets/src/renderer/save-actions.ts,
 * with `stageEditsForSave` for large edit sets) calls. Each does what the
 * desktop main process's handler of the same channel does first: parse the
 * input with the shared schema and refuse an unknown session. Large edit sets
 * are reassembled by the desktop's own `SaveEditsTransferStore`.
 *
 * The save itself is `saveMobileWorkbook` (loaded on first save). The phone
 * has no Save As dialog yet: a Save As or an explicit target path answers
 * `{ canceled: true }`, as the desktop does when the dialog is dismissed.
 */
import { SaveEditsTransferStore } from '../../../../../../sheets/src/main/save-edits-transfer'
import {
  saveEditsChunkArraySchema,
  workbookSaveEditsAbortSchema,
  workbookSaveEditsBeginSchema,
  workbookSaveEditsChunkSchema,
  workbookSaveRequestSchema,
  workbookSaveResultSchema,
  type DesktopApi,
  type WorkbookSaveRequest,
} from '../../../../../../sheets/src/shared/desktop-api'
import type { SheetsEngineClient } from './engine'
import type { MobileWorkbookSessions } from './sessions'

export type MobileDesktopSaveApi = Pick<
  DesktopApi,
  'saveWorkbookEdits' | 'beginSaveEditsTransfer' | 'sendSaveEditsChunk' | 'abortSaveEditsTransfer'
>

export interface MobileSaveApiOptions {
  /** UI language the reopen passes to the engine (the open used the same). */
  readonly locale: () => string
  /** Called after each finished save (prototype diagnostics). */
  readonly onSaved?: (outcome: import('../save/saveWorkbook').MobileSaveOutcome) => void
}

export function createMobileSaveApi(
  client: SheetsEngineClient,
  sessions: MobileWorkbookSessions,
  options: MobileSaveApiOptions,
): MobileDesktopSaveApi {
  const transfers = new SaveEditsTransferStore()

  /** The desktop main process's `resolveTransferredEdits`. */
  function resolveTransferredEdits(request: WorkbookSaveRequest): WorkbookSaveRequest {
    if (request.editsTransferId === undefined) return request
    if (request.edits.length > 0)
      throw new Error('Save request mixes inline and transferred edits.')
    const edits = transfers.take(request.editsTransferId, request.sessionId)
    return { ...request, edits }
  }

  return {
    async saveWorkbookEdits(input) {
      const request = resolveTransferredEdits(workbookSaveRequestSchema.parse(input))
      sessions.get(request.sessionId)
      if (request.mode === 'save-as' || request.targetPath !== undefined) {
        return { canceled: true }
      }
      const { saveMobileWorkbook } = await import('../save/saveWorkbook')
      const outcome = await saveMobileWorkbook(
        { client, sessions, locale: options.locale() },
        request,
      )
      options.onSaved?.(outcome)
      return workbookSaveResultSchema.parse({
        canceled: false,
        file: outcome.file,
        touchedEntries: [...outcome.touchedEntries],
      })
    },

    async beginSaveEditsTransfer(input) {
      const request = workbookSaveEditsBeginSchema.parse(input)
      if (!sessions.has(request.sessionId)) throw new Error('Unknown workbook session.')
      transfers.begin(request)
    },

    async sendSaveEditsChunk(input) {
      const request = workbookSaveEditsChunkSchema.parse(input)
      transfers.addChunk({
        sessionId: request.sessionId,
        transferId: request.transferId,
        seq: request.seq,
        edits: saveEditsChunkArraySchema.parse(JSON.parse(request.editsJson)),
      })
    },

    async abortSaveEditsTransfer(input) {
      const request = workbookSaveEditsAbortSchema.parse(input)
      transfers.discard(request.transferId, request.sessionId)
    },
  }
}
