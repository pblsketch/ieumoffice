/**
 * System-OCR bridge for the pdf viewer (issue #119): recognizes one rendered
 * page image via the platform helper binaries shared with pdf2docx
 * (macOS Vision / Windows.Media.Ocr). Same helper-path resolution as the
 * shell's pdf2docx-local.ts — packaged under Resources/ocr, repo-relative in
 * dev. Linux (or a build without the helper) resolves to no engine and the
 * viewer keeps today's behavior.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { recognizeHelperPng } from './ocr-helper-async'
import type { PdfOcrLine } from '../shared/ipc'

let ocrHelper: string | null | undefined

function ensureOcrHelper(): string | null {
  if (ocrHelper !== undefined) return ocrHelper
  if (process.platform !== 'darwin' && process.platform !== 'win32') return (ocrHelper = null)
  const here = dirname(fileURLToPath(import.meta.url))
  const helper = process.platform === 'darwin' ? 'vision-ocr' : 'win-ocr.exe'
  const candidates = [
    ...(process.resourcesPath ? [join(process.resourcesPath, 'ocr', helper)] : []),
    join(here, '../../../../packages/pdf2docx/ocr-helper', helper),
  ]
  ocrHelper = null
  for (const path of candidates) {
    if (existsSync(path)) {
      ocrHelper = path
      break
    }
  }
  return ocrHelper
}

export const hasOcrEngine = (): boolean => ensureOcrHelper() !== null

/** PNG (base64) → OCR lines; null only when the platform has no engine (callers
    stop trying), [] when recognition failed for this image (callers move on) */
export async function ocrPagePng(
  pngBase64: string,
  signal?: AbortSignal,
): Promise<PdfOcrLine[] | null> {
  const helper = ensureOcrHelper()
  if (!helper) return null
  let png: Uint8Array
  try {
    png = Buffer.from(pngBase64, 'base64')
  } catch {
    return []
  }
  const result = await recognizeHelperPng(helper, png, signal)
  if (!result) return []
  return result.lines.map((l) => ({
    text: l.text,
    confidence: l.confidence,
    box: [l.box.x0, l.box.y0, l.box.x1, l.box.y1],
    ...(l.chars
      ? {
          chars: l.chars.map((c) => ({
            text: c.text,
            box: [c.box.x0, c.box.y0, c.box.x1, c.box.y1] as [number, number, number, number],
          })),
        }
      : {}),
  }))
}
