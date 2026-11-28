/**
 * Batch local OCR for scanned PDFs (PDF tools v2): renders target pages via
 * PDFium, runs the platform OS OCR engine (Windows.Media.Ocr / macOS Vision),
 * and bakes invisible (render mode 3) searchable text lines into a copy of the
 * PDF via the shared ocr-bake and text-edit pipelines.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { PDFDocument } from 'pdf-lib'
import type { OcrEngine } from '../../../../packages/pdf2docx/src/ocr'
import type { TextInsertInput } from '../shared/ipc'
import { buildOcrBakeInserts, ocrLinesToWords } from '../shared/ocr-bake'
import type { PageGeom } from '../shared/page-geom'
import type { BlankPagesPdfium } from './blank-pages'
import { applyTextInserts, loadPdfium, withDocument } from './text-edit'

export interface OcrPdfOptions {
  /** 1-based page numbers to process; omitted = all pages */
  pages?: number[]
  /** re-recognize pages that already contain visible text (default: false) */
  reocrExisting?: boolean
  /** raster DPI for OCR rendering (default: 200, tunable) */
  dpi?: number
  /** cap rendered image longest side in pixels (default: 2400, tunable) */
  maxLongSide?: number
  /** password when the source PDF is encrypted */
  password?: string
  onProgress?: (done: number, total: number) => void
}

export interface OcrPdfResult {
  bytes: Uint8Array
  ocredPages: number
  skippedPages: number
}

const DEFAULT_OCR_DPI = 200
const DEFAULT_MAX_LONG_SIDE = 2400
const RENDER_FLAGS = 0x01

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length, false)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false)
  return out
}

/** Encode a BGRA bitmap to RGB PNG bytes (no Electron/nativeImage dependency) */
function encodeBgraToPng(
  bgra: Uint8Array,
  width: number,
  height: number,
  stride: number,
): Uint8Array {
  const ihdr = new Uint8Array(13)
  const idv = new DataView(ihdr.buffer)
  idv.setUint32(0, width, false)
  idv.setUint32(4, height, false)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB

  const rowStride = 1 + width * 3
  const raw = new Uint8Array(rowStride * height)
  for (let y = 0; y < height; y++) {
    const srcRow = y * stride
    const dstRow = y * rowStride
    raw[dstRow] = 0 // filter: None
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 4
      const d = dstRow + 1 + x * 3
      raw[d] = bgra[s + 2]!
      raw[d + 1] = bgra[s + 1]!
      raw[d + 2] = bgra[s]!
    }
  }

  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const c1 = pngChunk('IHDR', ihdr)
  const c2 = pngChunk('IDAT', new Uint8Array(deflateSync(raw, { level: 3 })))
  const c3 = pngChunk('IEND', new Uint8Array(0))
  const out = new Uint8Array(sig.length + c1.length + c2.length + c3.length)
  let off = 0
  for (const part of [sig, c1, c2, c3]) {
    out.set(part, off)
    off += part.length
  }
  return out
}

function hasVisibleText(m: BlankPagesPdfium, page: number): boolean {
  const text = m._FPDFText_LoadPage(page)
  if (!text) return false
  try {
    const count = m._FPDFText_CountChars(text)
    for (let i = 0; i < count; i++) {
      const code = m._FPDFText_GetUnicode(text, i)
      if (code > 0x20 && code !== 0xa0 && code !== 0xfffe && code !== 0xfeff) return true
    }
    return false
  } finally {
    m._FPDFText_ClosePage(text)
  }
}

/** Check whether a platform OS OCR helper binary is available on this machine */
export function hasOcrEngineHelper(candidates?: readonly string[]): boolean {
  if (candidates) return candidates.some((p) => existsSync(p))
  if (process.platform !== 'darwin' && process.platform !== 'win32') return false
  const here = dirname(fileURLToPath(import.meta.url))
  const helper = process.platform === 'darwin' ? 'vision-ocr' : 'win-ocr.exe'
  const paths = [
    ...(process.resourcesPath ? [join(process.resourcesPath, 'ocr', helper)] : []),
    join(here, '../../../../packages/pdf2docx/ocr-helper', helper),
  ]
  return paths.some((p) => existsSync(p))
}

/**
 * Run local OS OCR over target pages of `bytes` and bake recognized lines as
 * invisible searchable text objects (render mode 3). Returns original `bytes`
 * untouched when `ocredPages === 0`.
 */
export async function ocrPdfBytes(
  bytes: Uint8Array,
  ocrEngine: OcrEngine,
  options: OcrPdfOptions = {},
  pdfiumModule?: BlankPagesPdfium,
): Promise<OcrPdfResult> {
  const reocrExisting = options.reocrExisting === true
  const dpi = options.dpi ?? DEFAULT_OCR_DPI
  const maxLongSide = options.maxLongSide ?? DEFAULT_MAX_LONG_SIDE

  // Read unrotated page geometry (MediaBox/CropBox + /Rotate) via pdf-lib
  const metaDoc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  const metaPages = metaDoc.getPages()
  const geoms: PageGeom[] = metaPages.map((p) => {
    const crop = p.getCropBox()
    const rot = ((p.getRotation().angle % 360) + 360) % 360
    return { pw: crop.width, ph: crop.height, rot, x0: crop.x, y0: crop.y }
  })

  const m = (pdfiumModule ?? (await loadPdfium())) as unknown as BlankPagesPdfium
  const inserts: TextInsertInput[] = []
  let ocredPages = 0
  let skippedPages = 0

  await withDocument(
    m as unknown as Parameters<typeof withDocument>[0],
    bytes,
    async (doc) => {
      const pageCount = m._FPDF_GetPageCount(doc)
      const targetPages =
        options.pages && options.pages.length > 0
          ? [...new Set(options.pages)].filter(
              (p) => Number.isInteger(p) && p >= 1 && p <= pageCount,
            )
          : Array.from({ length: pageCount }, (_, i) => i + 1)

      for (let i = 0; i < targetPages.length; i++) {
        const pageNum = targetPages[i]!
        const pageIdx = pageNum - 1
        const page = m._FPDF_LoadPage(doc, pageIdx)
        if (!page) {
          options.onProgress?.(i + 1, targetPages.length)
          continue
        }
        try {
          if (!reocrExisting && hasVisibleText(m, page)) {
            skippedPages++
            continue
          }
          const widthPt = m._FPDF_GetPageWidthF(page)
          const heightPt = m._FPDF_GetPageHeightF(page)
          const rawW = Math.max(1, Math.round((widthPt * dpi) / 72))
          const rawH = Math.max(1, Math.round((heightPt * dpi) / 72))
          const clamp = Math.min(1, maxLongSide / Math.max(rawW, rawH))
          const width = Math.max(1, Math.round(rawW * clamp))
          const height = Math.max(1, Math.round(rawH * clamp))
          const bitmap = m._FPDFBitmap_Create(width, height, 0)
          if (!bitmap) continue
          let png: Uint8Array
          try {
            m._FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff)
            m._FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, RENDER_FLAGS)
            const stride = m._FPDFBitmap_GetStride(bitmap)
            const ptr = m._FPDFBitmap_GetBuffer(bitmap)
            const view = m.HEAPU8.subarray(ptr, ptr + stride * height)
            png = encodeBgraToPng(view, width, height, stride)
          } finally {
            m._FPDFBitmap_Destroy(bitmap)
          }
          const ocrResult = ocrEngine(png, { widthPt, heightPt })
          if (!ocrResult || ocrResult.lines.length === 0) continue
          const geom = geoms[pageIdx] ?? { pw: widthPt, ph: heightPt, rot: 0 }
          const words = ocrLinesToWords(ocrResult.lines, geom)
          if (words.length === 0) continue
          const pageInserts = buildOcrBakeInserts(pageIdx, words, geom)
          if (pageInserts.length > 0) {
            inserts.push(...pageInserts)
            ocredPages++
          }
        } finally {
          m._FPDF_ClosePage(page)
          options.onProgress?.(i + 1, targetPages.length)
        }
      }
    },
    options.password,
  )

  if (ocredPages === 0 || inserts.length === 0) {
    return { bytes, ocredPages: 0, skippedPages }
  }

  const baked = await applyTextInserts(bytes, inserts)
  return { bytes: baked.bytes, ocredPages, skippedPages }
}
