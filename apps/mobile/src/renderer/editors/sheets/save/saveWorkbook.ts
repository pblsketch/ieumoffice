/**
 * One save on the phone, in the desktop's order (the `workbook:save` handler
 * in apps/sheets/src/main/sheets-main.ts):
 *
 * 1. The save lands on a fresh staged file in the work folder, patched from
 *    the session's snapshot (the copy made at open), never from the live
 *    document: `writeWorkbookTo` → `saveWorkbookViaSidecar`, whose
 *    `assertManifestPreserved` refuses any entry the plan did not declare.
 * 2. The engine opens the staged file. If it cannot, the staged file goes,
 *    the original and the session stay, and the save fails with the reason.
 * 3. Only then is the staged file written over the original (Rust reads it
 *    from the work folder; the bytes do not cross the WebView bridge).
 * 4. The session swaps to the staged file: the next save patches what was
 *    just saved.
 *
 * A save request with nothing in it does not go through the engine at all:
 * the staged file is a byte copy of the snapshot, so the original receives
 * its own bytes back.
 *
 * A converted session (.xls, .csv) cannot write the workbook back into its
 * original's format; its save stops after step 2 and the session continues
 * on the staged `.xlsx` (the Save As step comes with the save screen).
 */
import {
  sheetsSaveToOriginal,
  sheetsTempCopy,
  sheetsTempDelete,
  sheetsTempNewPath,
  sheetsTempStat,
} from '@genoffice/mobile-bridge/sheets'
import type {
  WorkbookFile,
  WorkbookSaveRequest,
} from '../../../../../../sheets/src/shared/desktop-api'
import { callSheetsEngine, type SheetsEngineClient } from '../desktop-api/engine'
import { engineOpenResultSchema, workbookFileFromOpen } from '../desktop-api/open'
import type { MobileWorkbookSession, MobileWorkbookSessions } from '../desktop-api/sessions'
import { mobileVfs, type MobileVfs } from '../node-shims/vfs'
import { createMobileArchiveClient } from './archiveClient'
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

export interface MobileSaveOutcome {
  readonly file: WorkbookFile
  readonly touchedEntries: readonly string[]
  /** The staged file the session continues on. */
  readonly savedPath: string
  /** The original document received the saved bytes. */
  readonly wroteOriginal: boolean
  /** The request carried no change: the staged file is the snapshot's bytes. */
  readonly unchanged: boolean
  /** Bytes the in-memory layer held at most during the save (diagnostics). */
  readonly peakHeldBytes: number
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

export async function saveMobileWorkbook(
  context: MobileSaveContext,
  request: WorkbookSaveRequest,
): Promise<MobileSaveOutcome> {
  const { client, sessions } = context
  const session = sessions.get(request.sessionId)
  const document = session.document
  if (!document) throw new Error('This workbook session has no document to save to.')
  const unchanged = saveRequestChangeCount(request) === 0
  const vfs = context.vfs ?? mobileVfs

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
      await callSheetsEngine(client, 'open', { path: stagedPath, locale: context.locale }),
    )
  } catch (error) {
    await sheetsTempDelete(client, stagedPath).catch(() => undefined)
    throw new SheetsSaveUnreadableError(error instanceof Error ? error.message : String(error), {
      cause: error,
    })
  }

  // 3. The original receives the verified bytes.
  const writeBack = !document.converted
  if (writeBack) {
    try {
      await sheetsSaveToOriginal(client, document.sessionId, stagedPath)
    } catch (error) {
      await callSheetsEngine(client, 'close', { sessionId: reopened.sessionId }).catch(
        () => undefined,
      )
      await sheetsTempDelete(client, stagedPath).catch(() => undefined)
      throw error
    }
  }

  // 4. The session continues on what was saved.
  const next: MobileWorkbookSession = {
    sessionId: reopened.sessionId,
    snapshotPath: stagedPath,
    sheetNames: new Map(reopened.sheets.map((sheet) => [sheet.id, sheet.name])),
    document,
  }
  sessions.delete(session.sessionId)
  sessions.add(next)
  await callSheetsEngine(client, 'close', { sessionId: session.sessionId }).catch(() => undefined)
  await sheetsTempDelete(client, session.snapshotPath).catch(() => undefined)
  const size = (await sheetsTempStat(client, stagedPath).catch(() => null))?.size ?? 0
  return {
    file: await workbookFileFromOpen(reopened, document, { path: stagedPath, size }),
    touchedEntries,
    savedPath: stagedPath,
    wroteOriginal: writeBack,
    unchanged,
    peakHeldBytes,
  }
}
