/**
 * Opening a workbook session for one document (loaded in `open()`, before
 * the grid chunk). Installs the phone's `window.desktopApi` the reused PC
 * modules call, and opens the document in the in-process engine.
 *
 * One document at a time is the app's rule, but `open()` runs before the
 * session switch, which the person may still cancel ("keep editing"): the
 * previous workbook's engine session stays until App disposes that document.
 * Each opened workbook closes only its own session and files (`close()`).
 */
import type { MobileClient, MobileDocSession } from '@genoffice/mobile-bridge/transport'
import { sheetsTempClear, sheetsTempDelete } from '@genoffice/mobile-bridge/sheets'
import type { WorkbookFile } from '../../../../../sheets/src/shared/desktop-api'
import {
  MobileWorkbookSessions,
  createMobileDesktopApi,
  installMobileDesktopApi,
  openMobileWorkbook,
  type MobileWorkbookDocument,
  type MobileWorkbookUnlockedCopy,
} from './desktop-api'

export interface OpenedSheetsWorkbook {
  readonly file: WorkbookFile
  /** The document behind the engine session (writable, converted, unlocked). */
  readonly document: MobileWorkbookDocument
  /** Opened with a password (the decrypted copy is in the work folder only). */
  readonly unlocked: boolean
  /** Closes the engine session and deletes its working copy. Runs once. */
  close(): Promise<void>
}

/** Every engine session this app holds, as the desktop main process keeps them. */
export const sheetsSessions = new MobileWorkbookSessions()
let installedFor: Pick<MobileClient, 'transport'> | null = null

/** Workbooks opened and not closed yet (their files must stay). */
const live = new Set<OpenedSheetsWorkbook>()

function uiLang(): string {
  return document.documentElement.lang || 'en'
}

function desktopApiFor(client: MobileClient) {
  const api = createMobileDesktopApi(client, sheetsSessions, { locale: uiLang })
  if (installedFor !== client) {
    installMobileDesktopApi(api)
    installedFor = client
  }
  return api
}

export interface OpenSheetsWorkbookInput {
  readonly client: MobileClient
  readonly session: MobileDocSession
  readonly recoveryBytesBase64?: string
  readonly unlock?: (copy: {
    readonly path: string
    readonly ext: string
  }) => Promise<MobileWorkbookUnlockedCopy | null>
}

export async function openSheetsWorkbook(
  input: OpenSheetsWorkbookInput,
): Promise<OpenedSheetsWorkbook> {
  const api = desktopApiFor(input.client)
  // Leftovers of this run (an open that failed half-way) go before the next
  // open, but only while no workbook is open; the app start empties the work
  // folder anyway (SheetsState::new on the Rust side).
  if (live.size === 0 && sheetsSessions.ids().length === 0) {
    await sheetsTempClear(input.client).catch(() => undefined)
  }
  const tempFiles: string[] = []
  let file: WorkbookFile
  try {
    file = await openMobileWorkbook(input.client, sheetsSessions, {
      session: input.session,
      locale: uiLang(),
      ...(input.recoveryBytesBase64 === undefined
        ? {}
        : { recoveryBytesBase64: input.recoveryBytesBase64 }),
      ...(input.unlock === undefined ? {} : { unlock: input.unlock }),
      onTempFile: (path) => tempFiles.push(path),
    })
  } catch (error) {
    // openMobileWorkbook deletes what it made on its own failures; this also
    // covers a cancel in between (the password prompt).
    for (const path of tempFiles) await sheetsTempDelete(input.client, path).catch(() => undefined)
    throw error
  }
  const document = sheetsSessions.get(file.sessionId).document
  if (!document) throw new Error('Unknown workbook session.')
  let closing: Promise<void> | null = null
  const opened: OpenedSheetsWorkbook = {
    file,
    document,
    unlocked: document.unlocked !== undefined,
    close() {
      closing ??= (async () => {
        live.delete(opened)
        // The session's working copy may have moved on (each save swaps it);
        // closeWorkbook deletes whichever one the session holds now.
        await api.closeWorkbook(file.sessionId)
        for (const path of tempFiles) {
          await sheetsTempDelete(input.client, path).catch(() => undefined)
        }
      })()
      return closing
    },
  }
  live.add(opened)
  return opened
}

/** Workbooks still open (tests and diagnostics). */
export function liveSheetsWorkbooks(): number {
  return live.size
}
