/**
 * Opening a workbook session for the grid (loaded in `open()`, before the
 * grid chunk). Installs the phone's `window.desktopApi` the reused PC grid
 * modules call, and opens the document in the in-process engine.
 */
import type { MobileClient, MobileDocSession } from '@genoffice/mobile-bridge/transport'
import { sheetsTempClear } from '@genoffice/mobile-bridge/sheets'
import type { WorkbookFile } from '../../../../../sheets/src/shared/desktop-api'
import {
  MobileWorkbookSessions,
  createMobileDesktopApi,
  installMobileDesktopApi,
  missingDesktopApiMethods,
  openMobileWorkbook,
} from './desktop-api'
import { installSheetsSaveProbeHook, rememberSaveOutcome } from './save/debugHook'

export interface OpenedSheetsWorkbook {
  readonly file: WorkbookFile
  /** Closes the engine session and drops its working copy. */
  close(): Promise<void>
}

const sessions = new MobileWorkbookSessions()
let installedFor: Pick<MobileClient, 'transport'> | null = null

function uiLang(): string {
  return document.documentElement.lang || 'en'
}

function desktopApiFor(client: MobileClient) {
  const api = createMobileDesktopApi(client, sessions, {
    locale: uiLang,
    onSaved: rememberSaveOutcome,
  })
  if (installedFor !== client) {
    installMobileDesktopApi(api)
    installSheetsSaveProbeHook(client)
    installedFor = client
    // Diagnostics for the prototype drivers: which desktop methods the reused modules asked for.
    ;(window as unknown as Record<string, unknown>).__ieumSheetsDesktopApiMisses =
      missingDesktopApiMethods
  }
  return api
}

export async function openSheetsWorkbook(input: {
  readonly client: MobileClient
  readonly session: MobileDocSession
  readonly recoveryBytesBase64?: string
}): Promise<OpenedSheetsWorkbook> {
  const api = desktopApiFor(input.client)
  // One document at a time: the previous workbook's session and working copy go first.
  for (const id of sessions.ids()) await api.closeWorkbook(id)
  await sheetsTempClear(input.client).catch(() => undefined)
  const lang = uiLang()
  const file = await openMobileWorkbook(input.client, sessions, {
    session: input.session,
    locale: lang,
    ...(input.recoveryBytesBase64 === undefined
      ? {}
      : { recoveryBytesBase64: input.recoveryBytesBase64 }),
  })
  return {
    file,
    close: () => api.closeWorkbook(file.sessionId),
  }
}
