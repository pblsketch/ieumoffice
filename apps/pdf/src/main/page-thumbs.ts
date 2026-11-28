/**
 * Chunked PDFium page thumbnail and DPI page rasterizers (PDF tools v2).
 * Uses the lightweight BlankPagesPdfium interface so both the main process
 * and the structure-job utilityProcess share the same implementation.
 */
import type { BlankPagesPdfium } from './blank-pages'

export interface PageThumbItem {
  /** 1-based page number */
  page: number
  /** displayed page width in points */
  widthPt: number
  /** displayed page height in points */
  heightPt: number
  width: number
  height: number
  /** tightly-packed BGRA pixels (width * height * 4) */
  bgra: Uint8Array
}

export interface RenderThumbsResult {
  pageCount: number
  thumbs: PageThumbItem[]
}

export interface RenderedDpiPage {
  /** 1-based page number */
  page: number
  width: number
  height: number
  /** tightly-packed BGRA pixels (width * height * 4) */
  bgra: Uint8Array
}

export interface RenderPagesAtDpiResult {
  pageCount: number
  pages: RenderedDpiPage[]
}

/** FPDF_ANNOT: include annotation appearances in rendered bitmaps */
const RENDER_FLAGS = 0x01
/** Safety cap on a single rendered side in pixels to protect 8 GB PCs */
const MAX_RENDER_SIDE_PX = 8192

function extractTightBgra(
  heap: Uint8Array,
  ptr: number,
  width: number,
  height: number,
  stride: number,
): Uint8Array {
  const rowBytes = width * 4
  const out = new Uint8Array(rowBytes * height)
  if (stride === rowBytes) {
    out.set(heap.subarray(ptr, ptr + rowBytes * height))
    return out
  }
  for (let y = 0; y < height; y++) {
    const srcStart = ptr + y * stride
    out.set(heap.subarray(srcStart, srcStart + rowBytes), y * rowBytes)
  }
  return out
}

function renderOnePageBgra(
  m: BlankPagesPdfium,
  page: number,
  width: number,
  height: number,
): Uint8Array | null {
  const bitmap = m._FPDFBitmap_Create(width, height, 0)
  if (!bitmap) return null
  try {
    m._FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff)
    m._FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, RENDER_FLAGS)
    const stride = m._FPDFBitmap_GetStride(bitmap)
    const ptr = m._FPDFBitmap_GetBuffer(bitmap)
    return extractTightBgra(m.HEAPU8, ptr, width, height, stride)
  } finally {
    m._FPDFBitmap_Destroy(bitmap)
  }
}

/**
 * Render 1-based inclusive page range `[startPage, endPage]` as thumbnails
 * sized to `longSide` pixels (default 200).
 */
export function renderPageThumbs(
  m: BlankPagesPdfium,
  doc: number,
  options: { startPage: number; endPage: number; longSide?: number },
  onProgress?: (done: number, total: number) => void,
): RenderThumbsResult {
  const pageCount = m._FPDF_GetPageCount(doc)
  if (pageCount <= 0) return { pageCount: 0, thumbs: [] }
  const longSide = Math.max(16, Math.min(options.longSide ?? 200, 1024))
  const start = Math.max(1, Math.min(Math.floor(options.startPage), pageCount))
  const end = Math.max(start, Math.min(Math.floor(options.endPage), pageCount))
  const total = end - start + 1
  const thumbs: PageThumbItem[] = []

  for (let p = start; p <= end; p++) {
    const page = m._FPDF_LoadPage(doc, p - 1)
    if (!page) {
      onProgress?.(p - start + 1, total)
      continue
    }
    try {
      const widthPt = m._FPDF_GetPageWidthF(page)
      const heightPt = m._FPDF_GetPageHeightF(page)
      const scale = longSide / Math.max(widthPt, heightPt, 1)
      const width = Math.max(1, Math.round(widthPt * scale))
      const height = Math.max(1, Math.round(heightPt * scale))
      const bgra = renderOnePageBgra(m, page, width, height)
      if (bgra) {
        thumbs.push({ page: p, widthPt, heightPt, width, height, bgra })
      }
    } finally {
      m._FPDF_ClosePage(page)
      onProgress?.(p - start + 1, total)
    }
  }
  return { pageCount, thumbs }
}

/**
 * Render a specific list of 1-based page numbers at `dpi` (150/200/300) into
 * tightly-packed BGRA buffers. Callers invoke this in small page chunks so
 * high-DPI exports stay bounded in memory on 8 GB machines.
 */
export function renderPdfPagesAtDpi(
  m: BlankPagesPdfium,
  doc: number,
  options: { pages: readonly number[]; dpi: 150 | 200 | 300 },
  onProgress?: (done: number, total: number) => void,
): RenderPagesAtDpiResult {
  const pageCount = m._FPDF_GetPageCount(doc)
  const validPages = options.pages.filter((p) => Number.isInteger(p) && p >= 1 && p <= pageCount)
  const scaleBase = options.dpi / 72
  const pages: RenderedDpiPage[] = []

  for (let i = 0; i < validPages.length; i++) {
    const pageNum = validPages[i]!
    const page = m._FPDF_LoadPage(doc, pageNum - 1)
    if (!page) {
      onProgress?.(i + 1, validPages.length)
      continue
    }
    try {
      const widthPt = m._FPDF_GetPageWidthF(page)
      const heightPt = m._FPDF_GetPageHeightF(page)
      const rawW = Math.max(1, Math.round(widthPt * scaleBase))
      const rawH = Math.max(1, Math.round(heightPt * scaleBase))
      const clamp = Math.min(1, MAX_RENDER_SIDE_PX / Math.max(rawW, rawH))
      const width = Math.max(1, Math.round(rawW * clamp))
      const height = Math.max(1, Math.round(rawH * clamp))
      const bgra = renderOnePageBgra(m, page, width, height)
      if (bgra) {
        pages.push({ page: pageNum, width, height, bgra })
      }
    } finally {
      m._FPDF_ClosePage(page)
      onProgress?.(i + 1, validPages.length)
    }
  }
  return { pageCount, pages }
}
