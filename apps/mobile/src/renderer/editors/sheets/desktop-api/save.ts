/**
 * The save side of the phone's desktop API: the methods the desktop
 * renderer's save and export flows call (`handleSave` in
 * apps/sheets/src/renderer/save-actions.ts with `stageEditsForSave` for large
 * edit sets, `handleExportCsv` in csv-export.ts, `handleExportOds` in
 * ods-export.ts). Each does what the desktop main process's handler of the
 * same channel does first: parse the input with the shared schema and refuse
 * an unknown session. Large edit sets are reassembled by the desktop's own
 * `SaveEditsTransferStore`.
 *
 * Where the desktop shows a native dialog the phone does: Save As goes to the
 * system save dialog with the name filled in (`.xlsx`, or `.xlsm` for a macro
 * workbook), CSV and ODS copies go to a new document picked there, and the
 * desktop's questions are the save area's sheets (`save/prompts.ts`). The
 * save itself is `saveMobileWorkbook` (loaded on first save).
 *
 * A failure the phone adds (the original changed since it was opened, a file
 * too large for the phone's file bridge, the reopen check, the password lock)
 * is thrown with the phone's own sentence, as the desktop main process throws
 * its already translated `errDiskChanged`; the desktop renderer shows it as
 * it is. Engine sentences pass through to its `localizeSaveError`.
 */
import { normalizeLang } from '@genoffice/i18n'
import {
  sheetsTempDelete,
  sheetsTempNewPath,
  sheetsWriteCopy,
} from '@genoffice/mobile-bridge/sheets'
import { isMobileCommandError } from '@genoffice/mobile-bridge/transport'
import { SaveEditsTransferStore } from '../../../../../../sheets/src/main/save-edits-transfer'
import {
  saveEditsChunkArraySchema,
  workbookExportCsvRequestSchema,
  workbookExportOdsRequestSchema,
  workbookSaveEditsAbortSchema,
  workbookSaveEditsBeginSchema,
  workbookSaveEditsChunkSchema,
  workbookSaveRequestSchema,
  workbookSaveResultSchema,
  type DesktopApi,
  type WorkbookSaveRequest,
} from '../../../../../../sheets/src/shared/desktop-api'
import { translateMobile } from '../../../i18n'
import { saveFailureKind, saveFailureMessage, type SheetsSaveFailureKind } from '../save/failures'
import { odsCopyName, recoveryTitle } from '../save/names'
import { UTF8_BOM, sheetsWriteRecovery, writeWorkFolderText } from '../save/nativeCommands'
import { sheetsSavePrompts } from '../save/prompts'
import type { SheetsEngineClient } from './engine'
import type { MobileWorkbookSessions } from './sessions'

export type MobileDesktopSaveApi = Pick<
  DesktopApi,
  | 'saveWorkbookEdits'
  | 'beginSaveEditsTransfer'
  | 'sendSaveEditsChunk'
  | 'abortSaveEditsTransfer'
  | 'writeWorkbookRecovery'
  | 'exportCsv'
  | 'exportOds'
>

export interface MobileSaveApiOptions {
  /** UI language the reopen passes to the engine (the open used the same). */
  readonly locale: () => string
  /** Called after each finished save (prototype diagnostics). */
  readonly onSaved?: (outcome: import('../save/saveWorkbook').MobileSaveOutcome) => void
}

/** Each save API's transfer store, so the save area can take a transferred request too. */
const transferStores = new WeakMap<MobileWorkbookSessions, SaveEditsTransferStore>()

/**
 * The desktop main process's `resolveTransferredEdits`: a request whose
 * edits were uploaded in chunks gets them back (taken once).
 */
export function resolveTransferredRequest(
  sessions: MobileWorkbookSessions,
  request: WorkbookSaveRequest,
): WorkbookSaveRequest {
  if (request.editsTransferId === undefined) return request
  if (request.edits.length > 0) throw new Error('Save request mixes inline and transferred edits.')
  const store = transferStores.get(sessions)
  if (!store) throw new Error('Unknown save transfer.')
  return { ...request, edits: store.take(request.editsTransferId, request.sessionId) }
}

/** The last save failure of each engine session (read once by the document). */
const failures = new Map<string, SheetsSaveFailureKind>()

export function takeSaveFailure(engineSessionId: string): SheetsSaveFailureKind | undefined {
  const kind = failures.get(engineSessionId)
  failures.delete(engineSessionId)
  return kind
}

export function createMobileSaveApi(
  client: SheetsEngineClient,
  sessions: MobileWorkbookSessions,
  options: MobileSaveApiOptions,
): MobileDesktopSaveApi {
  // One store per session list: the app builds this API again on each open.
  const transfers = transferStores.get(sessions) ?? new SaveEditsTransferStore()
  transferStores.set(sessions, transfers)
  const translate = (key: Parameters<typeof translateMobile>[1]) =>
    translateMobile(normalizeLang(options.locale()), key)
  const context = () => ({ client, sessions, locale: options.locale() })

  return {
    async saveWorkbookEdits(input) {
      const request = resolveTransferredRequest(sessions, workbookSaveRequestSchema.parse(input))
      sessions.get(request.sessionId)
      // An explicit target is the desktop's MCP save, which the phone does not have.
      if (request.targetPath !== undefined) return { canceled: true }
      const { saveMobileWorkbook } = await import('../save/saveWorkbook')
      failures.delete(request.sessionId)
      try {
        const outcome = await saveMobileWorkbook(context(), request, {
          kind: request.mode === 'save-as' ? 'save-as' : 'original',
        })
        options.onSaved?.(outcome)
        return workbookSaveResultSchema.parse({
          canceled: false,
          file: outcome.file,
          touchedEntries: [...outcome.touchedEntries],
        })
      } catch (error) {
        const kind = saveFailureKind(error)
        // The system save dialog closed: what the desktop answers for its own dialog.
        if (kind === 'cancelled') return { canceled: true }
        failures.set(request.sessionId, kind)
        throw new Error(saveFailureMessage(error, translate), { cause: error })
      }
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

    /**
     * The desktop writes the recovery copy through the save writer (no
     * reopen, no session swap); so does the phone, into the work folder,
     * and Rust keeps it. None for a workbook opened with a password.
     */
    async writeWorkbookRecovery(input) {
      const request = resolveTransferredRequest(sessions, workbookSaveRequestSchema.parse(input))
      const session = sessions.has(request.sessionId) ? sessions.get(request.sessionId) : null
      const document = session?.document
      if (!document || document.unlocked) return { ok: false }
      const { stageWorkbookCopy } = await import('../save/saveWorkbook')
      let staged: string | null = null
      try {
        staged = (await stageWorkbookCopy(context(), request)).path
        await sheetsWriteRecovery(client, {
          docKey: document.docKey,
          title: recoveryTitle(document),
          path: staged,
        })
        return { ok: true }
      } catch (error) {
        console.warn('[sheets] recovery copy failed:', error)
        return { ok: false }
      } finally {
        if (staged !== null) await sheetsTempDelete(client, staged).catch(() => undefined)
      }
    },

    /**
     * The desktop's CSV export handler: the formula warning first (keep the
     * formulas through an Excel file instead, go on, or cancel), then a new
     * document with UTF-8 and a BOM so Excel reads it back.
     */
    async exportCsv(input) {
      const request = workbookExportCsvRequestSchema.parse(input)
      if (request.hasFormulas) {
        const answer = await sheetsSavePrompts().askCsvFormulaLoss()
        if (answer === 'xlsx') return { canceled: true, saveAsXlsxInstead: true }
        if (answer === 'cancel') return { canceled: true }
      }
      const { path } = await sheetsTempNewPath(client, 'csv')
      try {
        await writeWorkFolderText(client, path, `${UTF8_BOM}${request.content}`)
        const written = await sheetsWriteCopy(client, path, request.fileName, 'text/csv')
        return { canceled: false, path: written.name }
      } catch (error) {
        if (isMobileCommandError(error) && error.code === 'USER_CANCELLED') {
          return { canceled: true }
        }
        throw new Error(saveFailureMessage(error, translate), { cause: error })
      } finally {
        await sheetsTempDelete(client, path).catch(() => undefined)
      }
    },

    /**
     * The desktop's ODS export handler: refused for a workbook opened with a
     * password (decision 0119); the pending edits go into a private copy,
     * which becomes the verified ODS (`save/odsExport.ts`).
     */
    async exportOds(input) {
      const request = workbookExportOdsRequestSchema.parse(input)
      const pending =
        request.workbook === undefined || request.workbook.sessionId !== request.sessionId
          ? undefined
          : resolveTransferredRequest(sessions, request.workbook)
      const session = sessions.get(request.sessionId)
      if (session.document?.unlocked) return { canceled: true, reason: 'encrypted' }
      const { stageWorkbookCopy } = await import('../save/saveWorkbook')
      const { exportOdsCopy } = await import('../save/odsExport')
      let copy: string | null = null
      try {
        const source = pending ? (copy = (await stageWorkbookCopy(context(), pending)).path) : null
        const outcome = await exportOdsCopy(client, {
          sourcePath: source ?? session.snapshotPath,
          confirmLoss: (count) => sheetsSavePrompts().confirmOdsLoss(count),
          deliver: async (odsPath) =>
            (
              await sheetsWriteCopy(
                client,
                odsPath,
                odsCopyName(session.document?.name ?? 'Book1.xlsx'),
                'application/vnd.oasis.opendocument.spreadsheet',
              )
            ).name,
        })
        if (outcome.status === 'exported') {
          return { canceled: false, path: outcome.name, ...outcome.result }
        }
        if (outcome.status === 'canceled') return { canceled: true, reason: 'canceled' }
        if (outcome.status === 'unreadable') return { canceled: true, reason: 'unreadable' }
        console.warn('[sheets] ODS export failed:', outcome.message)
        return { canceled: true, reason: 'failed' }
      } catch (error) {
        throw new Error(saveFailureMessage(error, translate), { cause: error })
      } finally {
        if (copy !== null) await sheetsTempDelete(client, copy).catch(() => undefined)
      }
    },
  }
}
