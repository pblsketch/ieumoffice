/**
 * Chunked PDF print & share bridge (`@genoffice/mobile-bridge/print`).
 *
 * Streams generated PDF bytes to Rust in 3 MiB chunks (4 MiB base64) so large PDFs never hit
 * WebView OOM or Android's 20M-char plugin string limit. Always ties staging to the active
 * `sessionId` so Rust enforces encrypted/distribution document refusals independently.
 */
import { invokeMobileCommand, type MobileClient } from '../transport'

/** 3 MiB raw bytes per chunk -> 4 MiB base64, well below IPC limits and multiple of 3. */
export const PRINT_STAGE_CHUNK_BYTES = 3 * 1024 * 1024

/** Hard upper bound mirrored from Rust `MAX_PRINT_PDF_BYTES`. */
export const MAX_PRINT_PDF_BYTES = 32 * 1024 * 1024

export type PdfStageTarget = 'print' | 'share'

const BASE64_SLICE = 0x6000 * 3

function encodeChunkBase64(bytes: Uint8Array): string {
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += BASE64_SLICE) {
    const slice = bytes.subarray(i, i + BASE64_SLICE)
    let binary = ''
    for (let j = 0; j < slice.length; j += 0x2000) {
      binary += String.fromCharCode(...slice.subarray(j, j + 0x2000))
    }
    parts.push(btoa(binary))
  }
  return parts.join('')
}

const KNOWN_DOC_EXT_RE =
  /\.(?:hwp|hwpx|md|markdown|txt|html|htm|xlsx|xlsm|xls|csv|pdf|pptx|epub|docx|odt)$/i

/** Replaces a known document extension with `.pdf` while preserving dots in versioned names. */
export function pdfSuggestedName(originalName: string): string {
  const trimmed = originalName.trim()
  if (!trimmed) return 'document.pdf'
  const replaced = trimmed.replace(KNOWN_DOC_EXT_RE, '')
  return `${replaced || 'document'}.pdf`
}

async function stageAndExecute(
  client: MobileClient,
  sessionId: string,
  suggestedName: string,
  bytes: Uint8Array,
  target: PdfStageTarget,
): Promise<void> {
  const { stageId } = await invokeMobileCommand<{ stageId: string }>(
    client.transport,
    'mobile_print_stage_begin',
    {
      sessionId,
      suggestedName: pdfSuggestedName(suggestedName),
      target,
      expectedBytes: bytes.byteLength,
    },
  )

  try {
    for (let offset = 0; offset < bytes.byteLength; offset += PRINT_STAGE_CHUNK_BYTES) {
      const chunk = bytes.subarray(offset, offset + PRINT_STAGE_CHUNK_BYTES)
      await invokeMobileCommand<{ written: number }>(
        client.transport,
        'mobile_print_stage_append',
        {
          stageId,
          chunkBase64: encodeChunkBase64(chunk),
        },
      )
    }
    await invokeMobileCommand<{ ok: boolean }>(client.transport, 'mobile_print_stage_finish', {
      stageId,
      sessionId,
    })
  } catch (err) {
    await invokeMobileCommand<{ ok: boolean }>(client.transport, 'mobile_print_stage_abort', {
      stageId,
    }).catch(() => {})
    throw err
  }
}

/** Stages generated PDF bytes and opens the OS print sheet (Android PrintManager / iOS Print). */
export function printPdfBytes(
  client: MobileClient,
  params: {
    readonly sessionId: string
    readonly suggestedName: string
    readonly bytes: Uint8Array
  },
): Promise<void> {
  return stageAndExecute(client, params.sessionId, params.suggestedName, params.bytes, 'print')
}

/** Stages generated PDF bytes and opens the OS share sheet with MIME `application/pdf`. */
export function sharePdfBytes(
  client: MobileClient,
  params: {
    readonly sessionId: string
    readonly suggestedName: string
    readonly bytes: Uint8Array
  },
): Promise<void> {
  return stageAndExecute(client, params.sessionId, params.suggestedName, params.bytes, 'share')
}

/** Prints an unmodified PDF session directly from disk without routing bytes through the WebView. */
export async function printSessionPdf(client: MobileClient, sessionId: string): Promise<void> {
  await invokeMobileCommand<{ ok: boolean }>(client.transport, 'mobile_print_session_pdf', {
    sessionId,
  })
}
