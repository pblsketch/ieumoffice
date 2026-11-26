/**
 * One save on the phone, in the desktop's order (the `workbook:save` handler
 * in apps/sheets/src/main/sheets-main.ts):
 *
 * 1. The save lands on a fresh staged file in the work folder, patched from
 *    the session's snapshot (the copy made at open), never from the live
 *    document: `writeWorkbookTo` → `saveWorkbookViaSidecar`, whose
 *    `assertManifestPreserved` refuses any entry the plan did not declare.
 * 2. The engine opens the staged file (with the phone's short-date pattern,
 *    as the desktop passes its OS one). If it cannot, the staged file goes,
 *    the original and the session stay, and the save fails with the reason.
 * 3. Only then does a place the person sees change: the original (Rust
 *    refuses it when another app changed it since it was opened, like the
 *    desktop's `errDiskChanged`), or, for Save As, a new document picked in
 *    the system save dialog. A workbook opened with a password is locked
 *    again with that password first (`sheetsEncrypt`, work-folder file to
 *    file); the plain file never leaves the work folder. Rust reads the file
 *    from the work folder; the bytes do not cross the WebView bridge.
 * 4. The session swaps to the staged file: the next save patches what was
 *    just saved. After Save As, the session's document is the new file.
 *
 * Steps 1–2 touch only the work folder and step 3 is a single Rust call, so
 * an app sent to the background or ended during a save leaves the original
 * either as it was or as the verified result (the work folder is emptied at
 * the next start).
 *
 * A save request with nothing in it does not go through the engine save at
 * all: the staged file is a byte copy of the snapshot, so the original
 * receives its own bytes back. (A workbook opened with a password is then
 * not written at all: its original already holds those bytes, locked.)
 *
 * A converted session (.xls, .csv) cannot write the workbook back into its
 * original's format: a plain save stops after step 2 and the session
 * continues on the staged `.xlsx`; its first real save is a Save As.
 */
import {
  sheetsEncrypt,
  sheetsSaveToOriginal,
  sheetsTempCopy,
  sheetsTempDelete,
  sheetsTempNewPath,
  sheetsTempStat,
} from '@genoffice/mobile-bridge/sheets'
import type { MobileDocSession } from '@genoffice/mobile-bridge/transport'
import type {
  WorkbookFile,
  WorkbookSaveRequest,
} from '../../../../../../sheets/src/shared/desktop-api'
import { callSheetsEngine, type SheetsEngineClient } from '../desktop-api/engine'
import { engineOpenResultSchema, workbookFileFromOpen } from '../desktop-api/open'
import type {
  MobileWorkbookDocument,
  MobileWorkbookSession,
  MobileWorkbookSessions,
} from '../desktop-api/sessions'
import { mobileVfs, type MobileVfs } from '../node-shims/vfs'
import { createMobileArchiveClient } from './archiveClient'
import { SheetsLockError } from './failures'
import { sheetsSaveAs } from './nativeCommands'
import { phoneShortDateFormat } from './shortDate'
import { ensureWorkFolder } from './workFolder'
import { writeWorkbookTo } from './writeWorkbookTo'

/** The engine could not open the saved workbook; the original was not touched. */
export class SheetsSaveUnreadableError extends Error {
  readonly reason: string

  constructor(reason: string, options?: { cause?: unknown }) {
    super(
      `The saved workbook could not be opened again, so the original file was left as it was. [${reason}]`,
      options,
    )
    this.name = 'SheetsSaveUnreadableError'
    this.reason = reason
  }
}

export interface MobileSaveContext {
  readonly client: SheetsEngineClient
  readonly sessions: MobileWorkbookSessions
  /** UI language for the engine's `open` (as the first open used). */
  readonly locale: string
  readonly vfs?: MobileVfs
}

/** Where a save goes: over the original, or a new document (Save As). */
export type MobileSaveTarget = { readonly kind: 'original' } | { readonly kind: 'save-as' }

export interface MobileSaveOutcome {
  readonly file: WorkbookFile
  readonly touchedEntries: readonly string[]
  /** The staged file the session continues on. */
  readonly savedPath: string
  /** The original document (or, for Save As, the new one) received the saved bytes. */
  readonly wroteOriginal: boolean
  /** The request carried no change: the staged file is the snapshot's bytes. */
  readonly unchanged: boolean
  /** Bytes the in-memory layer held at most during the save (diagnostics). */
  readonly peakHeldBytes: number
  /** Save As: the app's new document session. */
  readonly savedAs?: MobileDocSession
}

/**
 * The changes a save request carries: what the desktop renderer's `handleSave`
 * counts (save-actions.ts), plus recalculated formula values and pivot output
 * growth, which change saved bytes too.
 */
export function saveRequestChangeCount(request: WorkbookSaveRequest): number {
  return (
    request.edits.length +
    (request.bulkConstantFills?.length ?? 0) +
    request.structuralOps.length +
    request.chartEdits.length +
    request.sheetOps.length +
    request.filterStates.length +
    request.hyperlinkEdits.length +
    request.cfStates.length +
    request.dvStates.length +
    request.pageSetupStates.length +
    request.noteStates.length +
    request.pivotCacheRefreshPaths.length +
    request.pivotRefreshUpdates.length +
    request.sheetProtections.length +
    (request.definedNamesState === null ? 0 : 1) +
    (request.workbookProtectionState === null ? 0 : 1) +
    (request.themeState === null ? 0 : 1) +
    request.protectedRangeStates.length +
    request.visualAdditions.length +
    request.visualEdits.length +
    request.tableAdditions.length +
    (request.tableEdits?.length ?? 0) +
    request.pivotAdditions.length +
    request.sparklineAdditions.length +
    request.formulaValues.length
  )
}

/**
 * The name the Save As dialog starts with: the document's name with `.xlsx`
 * (an `.xls` or `.csv` becomes `name.xlsx`), or `.xlsm` for a macro workbook,
 * which keeps its macro format (sheets-main.ts `macroEnabled`).
 */
export function saveAsSuggestion(document: Pick<MobileWorkbookDocument, 'name'>): string {
  const stem = document.name.replace(/\.[^.]*$/, '') || 'Book1'
  return /\.xlsm$/i.test(document.name) ? `${stem}.xlsm` : `${stem}.xlsx`
}

/** Save As answers, by the engine session the save swapped to (read once by the document). */
const savedAsSessions = new Map<string, MobileDocSession>()

export function takeSavedAsSession(engineSessionId: string): MobileDocSession | undefined {
  const session = savedAsSessions.get(engineSessionId)
  savedAsSessions.delete(engineSessionId)
  return session
}

/**
 * The workbook as edited, in a fresh work-folder file: the snapshot's bytes
 * when nothing changed, else the desktop save writer's output (as the
 * desktop writes a private copy for an ODS export, a template or the
 * recovery copy). Nothing else changes: no reopen, no session swap.
 */
export async function stageWorkbookCopy(
  context: MobileSaveContext,
  request: WorkbookSaveRequest,
): Promise<{ readonly path: string; readonly unchanged: boolean }> {
  const { client, sessions } = context
  const session = sessions.get(request.sessionId)
  const unchanged = saveRequestChangeCount(request) === 0
  const { path } = await sheetsTempNewPath(client, 'xlsx')
  try {
    if (unchanged) {
      await sheetsTempCopy(client, session.snapshotPath, path)
    } else {
      const vfs = context.vfs ?? mobileVfs
      await ensureWorkFolder(client, vfs)
      await writeWorkbookTo(createMobileArchiveClient(client, vfs), session, request, path)
    }
  } catch (error) {
    await sheetsTempDelete(client, path).catch(() => undefined)
    throw error
  }
  return { path, unchanged }
}

/**
 * Locks the plain workbook at `plainPath` with `password` into a new
 * work-folder file (the engine library's `encrypt`, ECMA-376 agile like the
 * desktop's `encryptOoxml`). Throws `SheetsLockError` when it cannot.
 */
export async function lockWorkbookCopy(
  client: SheetsEngineClient,
  plainPath: string,
  password: string,
): Promise<string> {
  // An empty password is one the closed document dropped: never lock with it.
  if (password === '') throw new SheetsLockError('The workbook was closed.')
  const { path } = await sheetsTempNewPath(client, 'xlsx')
  let answer: Awaited<ReturnType<typeof sheetsEncrypt>>
  try {
    answer = await sheetsEncrypt(client, plainPath, path, password)
  } catch (error) {
    await sheetsTempDelete(client, path).catch(() => undefined)
    throw new SheetsLockError(error instanceof Error ? error.message : String(error))
  }
  if (!answer.ok) {
    await sheetsTempDelete(client, path).catch(() => undefined)
    throw new SheetsLockError(answer.error.message)
  }
  return path
}

export async function saveMobileWorkbook(
  context: MobileSaveContext,
  request: WorkbookSaveRequest,
  target: MobileSaveTarget = { kind: 'original' },
): Promise<MobileSaveOutcome> {
  const { client, sessions } = context
  const session = sessions.get(request.sessionId)
  const document = session.document
  if (!document) throw new Error('This workbook session has no document to save to.')
  const unchanged = saveRequestChangeCount(request) === 0
  const vfs = context.vfs ?? mobileVfs
  // Taken now: closing the document empties it (forgetWorkbookPassword), and
  // a save already running still locks its result with the real password.
  const password = document.unlocked?.password
  if (password === '') throw new SheetsLockError('The workbook was closed.')

  // 1. The staged file, patched from the snapshot.
  const { path: stagedPath } = await sheetsTempNewPath(client, 'xlsx')
  let touchedEntries: readonly string[] = []
  let peakHeldBytes = 0
  try {
    if (unchanged) {
      await sheetsTempCopy(client, session.snapshotPath, stagedPath)
    } else {
      await ensureWorkFolder(client, vfs)
      vfs.resetPeak()
      const mutation = await writeWorkbookTo(
        createMobileArchiveClient(client, vfs),
        session,
        request,
        stagedPath,
      )
      peakHeldBytes = vfs.stats().peakBytes
      touchedEntries = mutation.touchedEntries
    }
  } catch (error) {
    await sheetsTempDelete(client, stagedPath).catch(() => undefined)
    throw error
  }

  // 2. The engine must open it before anything the person sees changes.
  let reopened: ReturnType<typeof engineOpenResultSchema.parse>
  try {
    reopened = engineOpenResultSchema.parse(
      await callSheetsEngine(client, 'open', {
        path: stagedPath,
        locale: context.locale,
        shortDateFormat: phoneShortDateFormat(),
      }),
    )
  } catch (error) {
    await sheetsTempDelete(client, stagedPath).catch(() => undefined)
    throw new SheetsSaveUnreadableError(error instanceof Error ? error.message : String(error), {
      cause: error,
    })
  }

  // 3. The original (or the new document) receives the verified bytes,
  // locked again first when the workbook was opened with a password.
  const saveAs = target.kind === 'save-as'
  const write = saveAs || (!document.converted && !(unchanged && document.unlocked))
  let savedAs: MobileDocSession | undefined
  let lockedPath: string | null = null
  if (write) {
    try {
      const source =
        password !== undefined
          ? (lockedPath = await lockWorkbookCopy(client, stagedPath, password))
          : stagedPath
      if (saveAs) {
        savedAs = await sheetsSaveAs(client, {
          sessionId: document.sessionId,
          path: source,
          suggestedName: saveAsSuggestion(document),
        })
      } else {
        await sheetsSaveToOriginal(client, document.sessionId, source)
      }
    } catch (error) {
      await callSheetsEngine(client, 'close', { sessionId: reopened.sessionId }).catch(
        () => undefined,
      )
      await sheetsTempDelete(client, stagedPath).catch(() => undefined)
      throw error
    } finally {
      if (lockedPath !== null) await sheetsTempDelete(client, lockedPath).catch(() => undefined)
    }
  }

  // 4. The session continues on what was saved.
  const nextDocument: MobileWorkbookDocument = savedAs
    ? {
        sessionId: savedAs.sessionId,
        name: savedAs.name,
        docKey: savedAs.docKey,
        writable: savedAs.writable,
        converted: false,
        ...(document.unlocked ? { unlocked: document.unlocked } : {}),
      }
    : document
  const next: MobileWorkbookSession = {
    sessionId: reopened.sessionId,
    snapshotPath: stagedPath,
    sheetNames: new Map(reopened.sheets.map((sheet) => [sheet.id, sheet.name])),
    document: nextDocument,
    ...(session.owner ? { owner: session.owner } : {}),
  }
  sessions.delete(session.sessionId)
  // The document was closed while this save ran: its close already ran on the
  // old session, so the session swapped in goes too instead of staying behind.
  const orphaned = session.owner?.closed === true
  if (!orphaned) {
    sessions.add(next)
    if (savedAs) savedAsSessions.set(reopened.sessionId, savedAs)
  }
  await callSheetsEngine(client, 'close', { sessionId: session.sessionId }).catch(() => undefined)
  await sheetsTempDelete(client, session.snapshotPath).catch(() => undefined)
  if (orphaned) {
    await callSheetsEngine(client, 'close', { sessionId: reopened.sessionId }).catch(
      () => undefined,
    )
    await sheetsTempDelete(client, stagedPath).catch(() => undefined)
  }
  const size = (await sheetsTempStat(client, stagedPath).catch(() => null))?.size ?? 0
  return {
    file: await workbookFileFromOpen(reopened, nextDocument, { path: stagedPath, size }),
    touchedEntries,
    savedPath: stagedPath,
    wroteOriginal: write,
    unchanged,
    peakHeldBytes,
    ...(savedAs ? { savedAs } : {}),
  }
}
