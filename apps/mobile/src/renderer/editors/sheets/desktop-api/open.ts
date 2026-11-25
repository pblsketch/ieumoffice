import {
  sheetsCopySessionToTemp,
  sheetsTempDelete,
  sheetsTempNewPath,
  sheetsTempWriteBytes,
} from '@genoffice/mobile-bridge/sheets'
import type { MobileDocSession } from '@genoffice/mobile-bridge/transport'
import {
  workbookFileSchema,
  type WorkbookFile,
} from '../../../../../../sheets/src/shared/desktop-api'
import { callSheetsEngine, type SheetsEngineClient } from './engine'
import type { MobileWorkbookSessions } from './sessions'

/** The engine's `open` answer: everything but the digest and the read-only flag (as on the desktop). */
const engineOpenResultSchema = workbookFileSchema.omit({ sha256: true, readOnly: true })

export interface OpenMobileWorkbookInput {
  readonly session: MobileDocSession
  /** UI language passed to the engine as on the desktop (`getUiLang()`). */
  readonly locale: string
  /** A recovery copy (base64 .xlsx) to open instead of the session's file. */
  readonly recoveryBytesBase64?: string
}

/** Formats the engine converts to a fresh .xlsx before opening (`convert_workbook`). */
const CONVERTED_EXTS = new Set(['xls'])

/**
 * Opens the active document in the engine, the phone's counterpart of the
 * desktop main process's `openWorkbookPath`: a working copy in the T1 work
 * folder (the desktop "snapshot"), `.xls` converted to `.xlsx` first, then the
 * engine's `open` on that copy.
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
    snapshot = await sheetsCopySessionToTemp(client, session.sessionId, ext)
  }
  const needsSaveAs = input.recoveryBytesBase64 === undefined && CONVERTED_EXTS.has(ext)
  if (needsSaveAs) {
    const { path: targetPath } = await sheetsTempNewPath(client, 'xlsx')
    try {
      await callSheetsEngine(client, 'convert_workbook', { path: snapshot.path, targetPath })
    } finally {
      await sheetsTempDelete(client, snapshot.path).catch(() => undefined)
    }
    snapshot = { path: targetPath, size: snapshot.size }
  }
  try {
    const opened = engineOpenResultSchema.parse(
      await callSheetsEngine(client, 'open', { path: snapshot.path, locale: input.locale }),
    )
    sessions.add({
      sessionId: opened.sessionId,
      snapshotPath: snapshot.path,
      sheetNames: new Map(opened.sheets.map((sheet) => [sheet.id, sheet.name])),
    })
    return workbookFileSchema.parse({
      ...opened,
      sha256: await sessionIdentityDigest(session, snapshot.path),
      fileBytes: snapshot.size,
      readOnly: !session.writable,
      needsSaveAs,
    })
  } catch (error) {
    await sheetsTempDelete(client, snapshot.path).catch(() => undefined)
    throw error
  }
}

async function sessionIdentityDigest(session: MobileDocSession, path: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${session.docKey}\n${session.sessionId}\n${path}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
