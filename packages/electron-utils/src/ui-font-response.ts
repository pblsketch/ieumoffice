/// The main-process answer to a renderer's UI-font URL
/// (uiFontUrl in @genoffice/ui/ui-fonts): shared by installRendererProtocol
/// (default session for the shell and every editor) and the diagram tab's
/// isolated session. Node only (reads the file); no Electron.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { uiFontFileOf } from '@genoffice/ui/ui-fonts'

const FONT_MIME: Readonly<Record<string, string>> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
}

/**
 * The listed UI font file the URL names, read from `dir` when asked for, or 404
 * when the folder lacks it (the renderer's font stack then falls back to OS
 * fonts). Null for every other URL, which the scheme's module roots own.
 */
export async function uiFontResponse(
  url: string,
  dir: string,
  read: (path: string) => Promise<Uint8Array> = readFile,
): Promise<Response | null> {
  const file = uiFontFileOf(url)
  if (!file) return null
  let bytes: Uint8Array
  try {
    bytes = await read(join(dir, file))
  } catch {
    return new Response(null, { status: 404 })
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': FONT_MIME[file.split('.').pop()?.toLowerCase() ?? ''] ?? 'font/sfnt',
      'Content-Length': String(bytes.byteLength),
      // @font-face fetches cross-origin scheme URLs (and dev-server origins) in CORS mode
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
