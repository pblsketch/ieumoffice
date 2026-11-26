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
  /** Where the copy's time went (diagnostics): native read, base64 decode, write. */
  readonly readMs?: number
  readonly decodeMs?: number
  readonly writeMs?: number
}

export interface SheetsTempStat {
  readonly size: number
  readonly isFile: boolean
  readonly isDir: boolean
}

export interface SheetsOriginalWritten {
  readonly ok: boolean
  readonly size: number
}

export interface SheetsCopyWritten {
  /** The name the person gave the copy in the system save dialog. */
  readonly name: string
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

/** The engine library's answer to a password request (`engine-lib/src/crypto.rs`). */
export type SheetsCryptoAnswer<T> =
  | { readonly ok: true; readonly result: T }
  | { readonly ok: false; readonly error: SheetsEngineErrorBody }

/**
 * Failure codes of a password request: `wrong_password` (ask again),
 * `unsupported` (an encryption this app cannot open), `damaged` (the
 * integrity check failed), `not_encrypted`, `io`, `invalid_request`.
 */
export type SheetsCryptoErrorCode =
  'wrong_password' | 'unsupported' | 'damaged' | 'not_encrypted' | 'io' | 'invalid_request'

export interface SheetsEncryptionProbe {
  readonly encrypted: boolean
  /** Encrypted in a way this app can decrypt. */
  readonly supported: boolean
  /** `ooxml` (an encrypted .xlsx/.xlsm package), `xls` (Excel 97-2003) or `other`. */
  readonly document: 'ooxml' | 'xls' | 'other'
}

function sheetsCrypto<T>(
  client: Pick<MobileClient, 'transport'>,
  request: Readonly<Record<string, unknown>>,
): Promise<SheetsCryptoAnswer<T>> {
  return invokeMobileCommand(client.transport, 'mobile_sheets_crypto', {
    line: JSON.stringify(request),
  })
}

/** Whether a file in the work folder is password protected, and whether the app can open it. */
export function sheetsProbeEncryption(
  client: Pick<MobileClient, 'transport'>,
  path: string,
): Promise<SheetsCryptoAnswer<SheetsEncryptionProbe>> {
  return sheetsCrypto(client, { op: 'probe', path })
}

/**
 * Decrypts `source` into the new file `target` (both in the work folder; the
 * plain workbook never crosses the bridge). `document` tells what came out:
 * an OOXML package, or a plain `.xls` still to convert.
 */
export function sheetsDecrypt(
  client: Pick<MobileClient, 'transport'>,
  source: string,
  target: string,
  password: string,
): Promise<SheetsCryptoAnswer<{ readonly document: 'ooxml' | 'xls' }>> {
  return sheetsCrypto(client, { op: 'decrypt', source, target, password })
}

/** Encrypts the plain workbook package `source` into the new file `target` (ECMA-376 agile, as the desktop). */
export function sheetsEncrypt(
  client: Pick<MobileClient, 'transport'>,
  source: string,
  target: string,
  password: string,
): Promise<SheetsCryptoAnswer<Record<string, never>>> {
  return sheetsCrypto(client, { op: 'encrypt', source, target, password })
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

/** The work folder's own path (the stand-in for `os.tmpdir()` of the save code). */
export function sheetsTempRoot(client: Pick<MobileClient, 'transport'>): Promise<SheetsTempPath> {
  return invokeMobileCommand(client.transport, 'mobile_sheets_temp_root')
}

/** Creates a folder (and missing parents) inside the work folder. */
export function sheetsTempMkdir(
  client: Pick<MobileClient, 'transport'>,
  path: string,
): Promise<SheetsOk> {
  return invokeMobileCommand(client.transport, 'mobile_sheets_temp_mkdir', { path })
}

/** Moves a file inside the work folder, replacing the target. */
export function sheetsTempRename(
  client: Pick<MobileClient, 'transport'>,
  from: string,
  to: string,
): Promise<SheetsOk> {
  return invokeMobileCommand(client.transport, 'mobile_sheets_temp_rename', { from, to })
}

/** Copies a file inside the work folder, replacing the target. */
export function sheetsTempCopy(
  client: Pick<MobileClient, 'transport'>,
  from: string,
  to: string,
): Promise<SheetsOk> {
  return invokeMobileCommand(client.transport, 'mobile_sheets_temp_copy', { from, to })
}

/** Size and kind of what is at a path in the work folder; `null` when nothing is. */
export function sheetsTempStat(
  client: Pick<MobileClient, 'transport'>,
  path: string,
): Promise<SheetsTempStat | null> {
  return invokeMobileCommand(client.transport, 'mobile_sheets_temp_stat', { path })
}

/**
 * A file's bytes (or `length` bytes from `offset`) as raw bytes. The command
 * answers with a raw IPC response (an `ArrayBuffer` in the WebView), so no
 * base64 or JSON copy of the content is made on the way.
 */
export async function sheetsTempReadRaw(
  client: Pick<MobileClient, 'transport'>,
  path: string,
  range?: { readonly offset?: number; readonly length?: number },
): Promise<Uint8Array> {
  const answer = await invokeMobileCommand<ArrayBuffer | ArrayBufferView | readonly number[]>(
    client.transport,
    'mobile_sheets_temp_read_raw',
    {
      path,
      ...(range?.offset === undefined ? {} : { offset: range.offset }),
      ...(range?.length === undefined ? {} : { length: range.length }),
    },
  )
  // Checked by tag, not instanceof: the buffer may come from another realm (a test host, a frame).
  if (Object.prototype.toString.call(answer) === '[object ArrayBuffer]') {
    return new Uint8Array(answer as ArrayBuffer)
  }
  if (ArrayBuffer.isView(answer)) {
    return new Uint8Array(answer.buffer, answer.byteOffset, answer.byteLength)
  }
  // A transport that serializes raw answers as a number list.
  return Uint8Array.from(answer as readonly number[])
}

/** Appends UTF-8 text to a file in the work folder (created if missing). */
export function sheetsTempAppendText(
  client: Pick<MobileClient, 'transport'>,
  path: string,
  text: string,
): Promise<SheetsOk> {
  return invokeMobileCommand(client.transport, 'mobile_sheets_temp_append_text', { path, text })
}

/** Appends base64 bytes to a file in the work folder (created if missing). */
export function sheetsTempAppendBytes(
  client: Pick<MobileClient, 'transport'>,
  path: string,
  bytesBase64: string,
): Promise<SheetsOk> {
  return invokeMobileCommand(client.transport, 'mobile_sheets_temp_append_bytes', {
    path,
    bytesBase64,
  })
}

/** Lowercase hex SHA-256 of a file in the work folder. */
export function sheetsTempSha256(
  client: Pick<MobileClient, 'transport'>,
  path: string,
): Promise<string> {
  return invokeMobileCommand(client.transport, 'mobile_sheets_temp_sha256', { path })
}

/**
 * Writes a verified save (a file in the work folder) over the active
 * session's original document. Call it only after the manifest check and the
 * engine's reopen of that file passed.
 */
export function sheetsSaveToOriginal(
  client: Pick<MobileClient, 'transport'>,
  sessionId: string,
  path: string,
): Promise<SheetsOriginalWritten> {
  return invokeMobileCommand(client.transport, 'mobile_sheets_save_to_original', {
    sessionId,
    path,
  })
}

/**
 * Writes a file in the work folder as a new document the person places in the
 * system save dialog (an export copy). The active session stays as it is.
 */
export function sheetsWriteCopy(
  client: Pick<MobileClient, 'transport'>,
  path: string,
  suggestedName: string,
  mime: string,
): Promise<SheetsCopyWritten> {
  return invokeMobileCommand(client.transport, 'mobile_sheets_write_copy', {
    path,
    suggestedName,
    mime,
  })
}
