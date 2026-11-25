import { invokeMobileCommand, type MobileClient } from '../transport'

/** The only MIME types `mobile_web_save_new_file` accepts (Word, ODT, Hangul). */
export const WEB_EXPORT_MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  hwpx: 'application/haansofthwpx',
} as const

export type WebExportMime = (typeof WEB_EXPORT_MIME)[keyof typeof WEB_EXPORT_MIME]

export interface SaveNewFileParams {
  readonly suggestedName: string
  readonly mime: WebExportMime
  readonly bytes: Uint8Array
}

export interface SaveNewFileResult {
  readonly name: string
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * Writes an exported document to a new file picked with the system save dialog.
 * Unlike save-as, the open document's session, recent list entry and recovery copy stay as they
 * are, so the editor keeps saving to the original file. A dismissed dialog rejects with a
 * `MobileCommandError` whose code is `USER_CANCELLED`.
 */
export function saveNewFile(
  client: MobileClient,
  params: SaveNewFileParams,
): Promise<SaveNewFileResult> {
  return invokeMobileCommand<SaveNewFileResult>(client.transport, 'mobile_web_save_new_file', {
    suggestedName: params.suggestedName,
    mime: params.mime,
    bytesBase64: bytesToBase64(params.bytes),
  })
}
