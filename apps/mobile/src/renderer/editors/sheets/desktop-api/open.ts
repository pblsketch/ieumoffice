import {
  sheetsCopySessionToTemp,
  sheetsTempDelete,
  sheetsTempNewPath,
  sheetsTempWriteBytes,
  type SheetsWorkingCopy,
} from '@genoffice/mobile-bridge/sheets'
import type { MobileDocSession } from '@genoffice/mobile-bridge/transport'
import {
  workbookFileSchema,
  type WorkbookFile,
} from '../../../../../../sheets/src/shared/desktop-api'
import { callSheetsEngine, type SheetsEngineClient } from './engine'
import type { MobileWorkbookDocument, MobileWorkbookSessions } from './sessions'

/** The engine's `open` answer: everything but the digest and the read-only flag (as on the desktop). */
export const engineOpenResultSchema = workbookFileSchema.omit({ sha256: true, readOnly: true })

export interface OpenMobileWorkbookInput {
  readonly session: MobileDocSession
  /** UI language passed to the engine as on the desktop (`getUiLang()`). */
  readonly locale: string
  /** A recovery copy (base64 .xlsx) to open instead of the session's file. */
  readonly recoveryBytesBase64?: string
}

/** The last working copy made at open, with where its time went (prototype diagnostics). */
export let lastWorkingCopy: (SheetsWorkingCopy & { readonly totalMs: number }) | null = null

/**
 * Formats opened through a fresh .xlsx copy, as on the desktop: `.xls` through
 * the desktop's legacy conversion (the engine's `convert_workbook`, or the
 * gateway's HTML import for a web page named `.xls`), `.csv` through the
 * gateway's CSV import.
 */
const CONVERTED_EXTS = new Set(['xls', 'csv'])

/**
 * Opens the active document in the engine, the phone's counterpart of the
 * desktop main process's `openWorkbookPath`: a working copy in the T1 work
 * folder (the desktop "snapshot", the base every save patches), `.xls` and
 * `.csv` converted to `.xlsx` first, then the engine's `open` on that copy.
 *
 * `sha256` is not the file digest on the phone: the WebView never holds the
 * bytes of a large workbook. It is a SHA-256 over the session identity, used
 * where the desktop uses the digest as the Univer unit id (`file-<sha>`).
 */
export async function openMobileWorkbook(
  client: SheetsEngineClient,
  sessions: MobileWorkbookSessions,
  input: OpenMobileWorkbookInput,
): Promise<WorkbookFile> {
  const { session } = input
  const ext = session.ext.toLowerCase()
  let snapshot: { path: string; size: number }
  if (input.recoveryBytesBase64 !== undefined) {
    const { path } = await sheetsTempNewPath(client, 'xlsx')
    await sheetsTempWriteBytes(client, path, input.recoveryBytesBase64)
    snapshot = { path, size: Math.floor((input.recoveryBytesBase64.length * 3) / 4) }
  } else {
    const started = Date.now()
    const copied = await sheetsCopySessionToTemp(client, session.sessionId, ext)
    lastWorkingCopy = { ...copied, totalMs: Date.now() - started }
    snapshot = { path: copied.path, size: copied.size }
  }
  const needsSaveAs = input.recoveryBytesBase64 === undefined && CONVERTED_EXTS.has(ext)
  if (needsSaveAs) {
    const { path: targetPath } = await sheetsTempNewPath(client, 'xlsx')
    try {
      // Loaded on first use: the gateway's import code and JSZip stay out of
      // the open chunk for .xlsx files.
      const { convertToXlsxForOpen } = await import('../convert/convertForOpen')
      await convertToXlsxForOpen(client, {
        ext,
        sourcePath: snapshot.path,
        targetPath,
        locale: input.locale,
      })
    } catch (error) {
      await sheetsTempDelete(client, targetPath).catch(() => undefined)
      throw error
    } finally {
      await sheetsTempDelete(client, snapshot.path).catch(() => undefined)
    }
    snapshot = { path: targetPath, size: snapshot.size }
  }
  const document: MobileWorkbookDocument = {
    sessionId: session.sessionId,
    name: session.name,
    docKey: session.docKey,
    writable: session.writable,
    converted: needsSaveAs,
  }
  try {
    const opened = engineOpenResultSchema.parse(
      await callSheetsEngine(client, 'open', { path: snapshot.path, locale: input.locale }),
    )
    sessions.add({
      sessionId: opened.sessionId,
      snapshotPath: snapshot.path,
      sheetNames: new Map(opened.sheets.map((sheet) => [sheet.id, sheet.name])),
      document,
    })
    return await workbookFileFromOpen(opened, document, snapshot)
  } catch (error) {
    await sheetsTempDelete(client, snapshot.path).catch(() => undefined)
    throw error
  }
}

/**
 * The `WorkbookFile` the grid gets for an engine session: the engine's answer
 * with the document's own name (the engine reports its working copy's file
 * name), the session identity digest, the read-only flag and whether the
 * first save must go elsewhere.
 */
export async function workbookFileFromOpen(
  opened: ReturnType<typeof engineOpenResultSchema.parse>,
  document: MobileWorkbookDocument,
  snapshot: { readonly path: string; readonly size: number },
): Promise<WorkbookFile> {
  return workbookFileSchema.parse({
    ...opened,
    name: document.name,
    sha256: await sessionIdentityDigest(document, snapshot.path),
    fileBytes: snapshot.size,
    readOnly: !document.writable,
    needsSaveAs: document.converted,
  })
}

async function sessionIdentityDigest(
  document: Pick<MobileWorkbookDocument, 'docKey' | 'sessionId'>,
  path: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${document.docKey}\n${document.sessionId}\n${path}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
