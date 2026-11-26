/**
 * Owned by mobile v1 track T3 (pdf tools).
 *
 * Holds the PDF tools (merge, split, convert and similar) Tauri command wrappers, built on
 * `invokeMobileCommand` from `../transport` with `client.transport`, so the track does not
 * widen `MobileClient`. The root `src/index.ts` does not re-export this module.
 *
 * A tool result lives only in WebView memory. Sharing it or saving a copy never touches the
 * open document session, the recent documents list or recovery copies.
 */
import { invokeMobileCommand, type MobileClient } from '../transport'

export interface PdfToolResultPayload {
  readonly name: string
  /** One of `application/pdf`, `text/plain`, `application/zip`; Rust rejects anything else. */
  readonly mime: string
  readonly bytes: Uint8Array
}

/** Bytes per `btoa` call; a multiple of 3 so no chunk but the last needs padding. */
const BASE64_CHUNK = 0x6000 * 3

/**
 * Encodes bytes as standard base64 without Node `Buffer`. Each chunk is a multiple of three
 * bytes, so encoding chunks separately and joining them equals encoding the whole array, and
 * no single `String.fromCharCode` call receives a huge argument list.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    const chunk = bytes.subarray(i, i + BASE64_CHUNK)
    let binary = ''
    for (let j = 0; j < chunk.length; j += 0x2000) {
      binary += String.fromCharCode(...chunk.subarray(j, j + 0x2000))
    }
    parts.push(btoa(binary))
  }
  return parts.join('')
}

function toCommandArgs(p: PdfToolResultPayload): Record<string, unknown> {
  return {
    suggestedName: p.name,
    mime: p.mime,
    bytesBase64: bytesToBase64(p.bytes),
  }
}

/** Sends a tool result to the OS share sheet without saving it. */
export function sharePdfToolResult(
  client: MobileClient,
  p: PdfToolResultPayload,
): Promise<{ ok: boolean }> {
  return invokeMobileCommand<{ ok: boolean }>(
    client.transport,
    'mobile_pdf_tools_share',
    toCommandArgs(p),
  )
}

/**
 * Saves a copy of a tool result where the person picks in the system save dialog. A closed
 * dialog rejects with a `MobileCommandError` whose code is `USER_CANCELLED`.
 */
export function savePdfToolResultCopy(
  client: MobileClient,
  p: PdfToolResultPayload,
): Promise<{ name: string }> {
  return invokeMobileCommand<{ name: string }>(
    client.transport,
    'mobile_pdf_tools_save_copy',
    toCommandArgs(p),
  )
}
