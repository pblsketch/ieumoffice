/** PDFium's sandboxed WASM reads a pinned descriptor without a full-file heap copy. */
import { readSync } from 'node:fs'
import type { PdfViewPixelBitmap } from './view-worker-protocol'
import { PDF_VIEW_MAX_RENDER_PIXELS, type PdfViewTile } from '../shared/view-source'

export interface ViewPdfium {
  HEAPU8: Uint8Array
  HEAPU32: Uint32Array
  _malloc(size: number): number
  _free(pointer: number): void
  addFunction(callback: (...args: number[]) => number, signature: string): number
  removeFunction(pointer: number): void
  _FPDF_LoadCustomDocument(access: number, password: number): number
  _FPDF_CloseDocument(doc: number): void
  _FPDF_GetPageCount(doc: number): number
  _FPDF_LoadPage(doc: number, page: number): number
  _FPDF_ClosePage(page: number): void
  _PDFiumExt_OpenFormFillInfo(): number
  _PDFiumExt_CloseFormFillInfo(info: number): void
  _PDFiumExt_InitFormFillEnvironment(doc: number, info: number): number
  _PDFiumExt_ExitFormFillEnvironment(environment: number): void
  _FORM_OnAfterLoadPage(page: number, environment: number): void
  _FORM_OnBeforeClosePage(page: number, environment: number): void
  _FPDF_FFLDraw(
    environment: number,
    bitmap: number,
    page: number,
    x: number,
    y: number,
    width: number,
    height: number,
    rotation: number,
    flags: number,
  ): void
  _FPDFBitmap_Create(width: number, height: number, alpha: number): number
  _FPDFBitmap_FillRect(
    bitmap: number,
    x: number,
    y: number,
    width: number,
    height: number,
    color: number,
  ): number
  _FPDFBitmap_GetBuffer(bitmap: number): number
  _FPDFBitmap_GetStride(bitmap: number): number
  _FPDFBitmap_Destroy(bitmap: number): void
  _FPDF_RenderPageBitmap(
    bitmap: number,
    page: number,
    x: number,
    y: number,
    width: number,
    height: number,
    rotation: number,
    flags: number,
  ): void
}

export function validViewBitmapSize(width: number, height: number): boolean {
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= 32767 &&
    height <= 32767 &&
    width * height <= PDF_VIEW_MAX_RENDER_PIXELS
  )
}

export function validViewTile(width: number, height: number, tile?: PdfViewTile): boolean {
  return (
    tile === undefined ||
    !!(
      tile &&
      Number.isSafeInteger(tile.x) &&
      Number.isSafeInteger(tile.y) &&
      tile.x >= 0 &&
      tile.y >= 0 &&
      validViewBitmapSize(tile.width, tile.height) &&
      tile.x <= width - tile.width &&
      tile.y <= height - tile.height
    )
  )
}

export class PdfiumViewDocument {
  private access = 0
  private callback = 0
  private doc = 0
  private formInfo = 0
  private formEnvironment = 0
  private rasterPage?: { number: number; handle: number; widgets: boolean }

  constructor(
    private readonly m: ViewPdfium,
    fd: number,
    length: number,
    password?: string,
  ) {
    if (!Number.isSafeInteger(length) || length < 1 || length > 0xffffffff)
      throw new Error('pdf: unsupported file-backed render size')
    let passwordPtr = 0
    try {
      this.callback = m.addFunction((_param, position, target, amount) => {
        const offset = position >>> 0
        const size = amount >>> 0
        if (offset > length || size > length - offset) return 0
        try {
          let done = 0
          while (done < size) {
            const n = readSync(fd, m.HEAPU8, (target >>> 0) + done, size - done, offset + done)
            if (!n) return 0
            done += n
          }
          return 1
        } catch {
          return 0
        }
      }, 'iiiii')
      this.access = m._malloc(12)
      if (!this.access) throw new Error('pdf: cannot allocate file access')
      m.HEAPU32[this.access >>> 2] = length
      m.HEAPU32[(this.access + 4) >>> 2] = this.callback
      m.HEAPU32[(this.access + 8) >>> 2] = 0
      if (password) {
        const bytes = new TextEncoder().encode(password)
        passwordPtr = m._malloc(bytes.length + 1)
        if (!passwordPtr) throw new Error('pdf: cannot allocate render password')
        m.HEAPU8.set(bytes, passwordPtr)
        m.HEAPU8[passwordPtr + bytes.length] = 0
      }
      this.doc = m._FPDF_LoadCustomDocument(this.access, passwordPtr)
      if (!this.doc) throw new Error('pdf: cannot open file-backed render document')
    } catch (error) {
      this.close()
      throw error
    } finally {
      if (passwordPtr) {
        m.HEAPU8.fill(0, passwordPtr, passwordPtr + new TextEncoder().encode(password!).length + 1)
        m._free(passwordPtr)
      }
    }
  }

  render(
    pageNumber: number,
    width: number,
    height: number,
    rotation: number,
    widgets = false,
    tile?: PdfViewTile,
  ): PdfViewPixelBitmap {
    const m = this.m
    if (
      !this.doc ||
      !Number.isInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > m._FPDF_GetPageCount(this.doc) ||
      !validViewBitmapSize(width, height) ||
      !validViewTile(width, height, tile) ||
      ![0, 1, 2, 3].includes(rotation)
    )
      throw new Error('pdf: invalid view render request')
    if (widgets && !this.formEnvironment) {
      this.formInfo ||= m._PDFiumExt_OpenFormFillInfo()
      this.formEnvironment = m._PDFiumExt_InitFormFillEnvironment(this.doc, this.formInfo)
      if (!this.formEnvironment) throw new Error('pdf: cannot initialize thumbnail forms')
    }
    if (!tile || this.rasterPage?.number !== pageNumber) this.releaseRasterPage()
    const page = this.rasterPage?.handle ?? m._FPDF_LoadPage(this.doc, pageNumber - 1)
    if (!page) throw new Error('pdf: cannot load render page')
    if (tile && !this.rasterPage)
      this.rasterPage = { number: pageNumber, handle: page, widgets: false }
    let bitmap = 0
    try {
      if (widgets && !this.rasterPage?.widgets) {
        m._FORM_OnAfterLoadPage(page, this.formEnvironment)
        if (this.rasterPage) this.rasterPage.widgets = true
      }
      const outputWidth = tile?.width ?? width
      const outputHeight = tile?.height ?? height
      const x = -(tile?.x ?? 0)
      const y = -(tile?.y ?? 0)
      bitmap = m._FPDFBitmap_Create(outputWidth, outputHeight, 1)
      if (!bitmap) throw new Error('pdf: cannot allocate page bitmap')
      m._FPDFBitmap_FillRect(bitmap, 0, 0, outputWidth, outputHeight, 0xffffffff)
      // Widgets remain in the HTML FormLayer; other annotation appearances are drawn.
      // The reverse channel flag produces RGBA directly; bound the image cache as well.
      m._FPDF_RenderPageBitmap(bitmap, page, x, y, width, height, rotation, 0x211)
      if (widgets)
        m._FPDF_FFLDraw(this.formEnvironment, bitmap, page, x, y, width, height, rotation, 0x211)
      const stride = m._FPDFBitmap_GetStride(bitmap)
      const pointer = m._FPDFBitmap_GetBuffer(bitmap)
      const rgba = new Uint8Array(outputWidth * outputHeight * 4)
      for (let y = 0; y < outputHeight; y++)
        rgba.set(
          m.HEAPU8.subarray(pointer + y * stride, pointer + y * stride + outputWidth * 4),
          y * outputWidth * 4,
        )
      return { width: outputWidth, height: outputHeight, rgba }
    } finally {
      if (bitmap) m._FPDFBitmap_Destroy(bitmap)
      if (!tile) {
        if (widgets) m._FORM_OnBeforeClosePage(page, this.formEnvironment)
        m._FPDF_ClosePage(page)
      }
    }
  }

  close(): void {
    this.releaseRasterPage()
    if (this.formEnvironment) {
      this.m._PDFiumExt_ExitFormFillEnvironment(this.formEnvironment)
      this.formEnvironment = 0
    }
    if (this.formInfo) {
      this.m._PDFiumExt_CloseFormFillInfo(this.formInfo)
      this.formInfo = 0
    }
    if (this.doc) {
      this.m._FPDF_CloseDocument(this.doc)
      this.doc = 0
    }
    if (this.access) {
      this.m._free(this.access)
      this.access = 0
    }
    if (this.callback) {
      this.m.removeFunction(this.callback)
      this.callback = 0
    }
  }

  /** A contiguous tile batch shares one decoded page; never retain a page history. */
  releaseRasterPage(): void {
    const page = this.rasterPage
    this.rasterPage = undefined
    if (!page) return
    if (page.widgets) this.m._FORM_OnBeforeClosePage(page.handle, this.formEnvironment)
    this.m._FPDF_ClosePage(page.handle)
  }
}
