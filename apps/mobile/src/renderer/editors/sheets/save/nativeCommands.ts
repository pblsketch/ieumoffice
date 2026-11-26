/**
 * The save area's Tauri commands that the shared sheets bridge does not wrap
 * (commands/sheets.rs): each one names a file in the T1 work folder and Rust
 * reads it there, so a workbook's bytes never cross the WebView bridge.
 */
import {
  invokeMobileCommand,
  type MobileClient,
  type MobileDocSession,
} from '@genoffice/mobile-bridge/transport'
import {
  sheetsTempAppendBytes,
  sheetsTempAppendText,
  sheetsTempWriteBytes,
  sheetsTempWriteText,
} from '@genoffice/mobile-bridge/sheets'
import { bytesToBase64 } from '../node-shims/buffer'
import { FLUSH_CHUNK_BYTES } from '../node-shims/vfs'

type Client = Pick<MobileClient, 'transport'>

/** Written first in a CSV file, so Excel reads it back as UTF-8 (as the desktop writes it). */
export const UTF8_BOM = String.fromCharCode(0xfeff)

/**
 * Saves a verified workbook in the work folder as a new document the person
 * places in the system save dialog. The new document becomes the app's
 * active session (its id, name and writability are in the answer).
 */
export function sheetsSaveAs(
  client: Client,
  input: { readonly sessionId: string; readonly path: string; readonly suggestedName: string },
): Promise<MobileDocSession> {
  return invokeMobileCommand(client.transport, 'mobile_sheets_save_as', { ...input })
}

/** Hands a work-folder file to the system share sheet. */
export function sheetsShareFile(
  client: Client,
  input: { readonly sessionId: string; readonly path: string; readonly suggestedName: string },
): Promise<{ readonly ok: boolean }> {
  return invokeMobileCommand(client.transport, 'mobile_sheets_share_file', { ...input })
}

/** Keeps a work-folder workbook as the document's recovery copy (an `.xlsx`). */
export function sheetsWriteRecovery(
  client: Client,
  input: { readonly docKey: string; readonly title: string; readonly path: string },
): Promise<{ readonly ok: boolean }> {
  return invokeMobileCommand(client.transport, 'mobile_sheets_write_recovery', { ...input })
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

/**
 * Writes text into a work-folder file in pieces (one IPC message each), so a
 * large CSV never travels as one string. A piece never ends inside a
 * surrogate pair.
 */
export async function writeWorkFolderText(
  client: Client,
  path: string,
  text: string,
): Promise<void> {
  let at = 0
  let first = true
  do {
    let end = Math.min(text.length, at + FLUSH_CHUNK_BYTES)
    if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) end -= 1
    const piece = text.slice(at, end)
    if (first) await sheetsTempWriteText(client, path, piece)
    else await sheetsTempAppendText(client, path, piece)
    first = false
    at = end
  } while (at < text.length)
}

/** Writes bytes (a PDF) into a work-folder file in pieces of `FLUSH_CHUNK_BYTES`. */
export async function writeWorkFolderBytes(
  client: Client,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  const step = FLUSH_CHUNK_BYTES
  await sheetsTempWriteBytes(client, path, bytesToBase64(bytes.subarray(0, step)))
  for (let at = step; at < bytes.byteLength; at += step) {
    await sheetsTempAppendBytes(client, path, bytesToBase64(bytes.subarray(at, at + step)))
  }
}
