/**
 * Owned by mobile v1 track T1 (sheets).
 *
 * Holds the spreadsheet (xlsx, xlsm, xls, csv) Tauri command wrappers, built on
 * `invokeMobileCommand` from `../transport` with `client.transport`, so the track does not
 * widen `MobileClient`. The root `src/index.ts` does not re-export this module.
 *
 * The phone runs the desktop spreadsheet engine in-process: `sheetsEngineRequest` sends the
 * same request object the desktop client writes to the sidecar's stdin and resolves with the
 * same response object (`ok: false` responses resolve too, as on the desktop). The
 * `sheetsTemp*` helpers move file contents between the WebView and the app's T1 work folder;
 * every path they and the engine requests name must lie inside that folder.
 */
import { invokeMobileCommand, type MobileClient } from '../transport'

/** Same as `PROTOCOL_VERSION` in the engine and the desktop sidecar client. */
export const SHEETS_ENGINE_PROTOCOL_VERSION = 1

/** One engine request: `version`, `requestId`, `command` and that command's fields, flat. */
export interface SheetsEngineRequest {
  readonly version: number
  readonly requestId: string
  readonly command: string
  readonly [field: string]: unknown
}

export interface SheetsEngineErrorBody {
  readonly code: string
  readonly message: string
}

/** One engine response, shaped like the desktop sidecar's stdout line. */
export interface SheetsEngineResponse<T = unknown> {
  readonly version: number
  readonly requestId: string
  readonly ok: boolean
  readonly result?: T
  readonly error?: SheetsEngineErrorBody
}

export interface SheetsTempPath {
  readonly path: string
}

export interface SheetsWorkingCopy {
  readonly path: string
  readonly size: number
}

export interface SheetsOk {
  readonly ok: boolean
}

/** Sends one engine request (an object, or an already serialized protocol line). */
export function sheetsEngineRequest<T = unknown>(
  client: Pick<MobileClient, 'transport'>,
  request: SheetsEngineRequest | string,
): Promise<SheetsEngineResponse<T>> {
  const line = typeof request === 'string' ? request : JSON.stringify(request)
  return invokeMobileCommand(client.transport, 'mobile_sheets_request', { line })
}

/** Copies the active document into a fresh working copy in the work folder. */
export function sheetsCopySessionToTemp(
  client: Pick<MobileClient, 'transport'>,
  sessionId: string,
  ext: string,
): Promise<SheetsWorkingCopy> {
  return invokeMobileCommand(client.transport, 'mobile_sheets_copy_session_to_temp', {
    sessionId,
    ext,
  })
}

/** Creates an empty folder in the work folder (e.g. the `outputDir` of `read_entries`). */
export function sheetsTempCreateDir(
  client: Pick<MobileClient, 'transport'>,
): Promise<SheetsTempPath> {
  return invokeMobileCommand(client.transport, 'mobile_sheets_temp_create_dir')
}

/** A fresh, not yet existing file path in the work folder. */
export function sheetsTempNewPath(
  client: Pick<MobileClient, 'transport'>,
  ext: string,
): Promise<SheetsTempPath> {
  return invokeMobileCommand(client.transport, 'mobile_sheets_temp_new_path', { ext })
}

export function sheetsTempReadText(
  client: Pick<MobileClient, 'transport'>,
  path: string,
): Promise<string> {
  return invokeMobileCommand(client.transport, 'mobile_sheets_temp_read_text', { path })
}

/** Resolves with the file's bytes as base64. */
export function sheetsTempReadBytes(
  client: Pick<MobileClient, 'transport'>,
  path: string,
): Promise<string> {
  return invokeMobileCommand(client.transport, 'mobile_sheets_temp_read_bytes', { path })
}

export function sheetsTempWriteText(
  client: Pick<MobileClient, 'transport'>,
  path: string,
  text: string,
): Promise<SheetsOk> {
  return invokeMobileCommand(client.transport, 'mobile_sheets_temp_write_text', { path, text })
}

export function sheetsTempWriteBytes(
  client: Pick<MobileClient, 'transport'>,
  path: string,
  bytesBase64: string,
): Promise<SheetsOk> {
  return invokeMobileCommand(client.transport, 'mobile_sheets_temp_write_bytes', {
    path,
    bytesBase64,
  })
}

/** Deletes a file or folder in the work folder (already gone counts as deleted). */
export function sheetsTempDelete(
  client: Pick<MobileClient, 'transport'>,
  path: string,
): Promise<SheetsOk> {
  return invokeMobileCommand(client.transport, 'mobile_sheets_temp_delete', { path })
}

/** Empties the work folder. Only when no workbook is open. */
export function sheetsTempClear(client: Pick<MobileClient, 'transport'>): Promise<SheetsOk> {
  return invokeMobileCommand(client.transport, 'mobile_sheets_temp_clear')
}
