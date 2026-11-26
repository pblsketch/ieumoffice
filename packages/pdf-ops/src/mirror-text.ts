/**
 * Mirror of the PC's text reader, apps/pdf/src/main/read-text.ts
 * `readPdfText`, for the mobile engine. That file is shared with upstream
 * GenOffice and leans on Node (Buffer) and the PC's own PDFium singleton, so
 * it stays where it is; this copy takes the PDFium module from the caller and
 * gives the same document, character for character, for the same input and
 * options. tests/mirror-text.test.ts runs both side by side: when upstream
 * changes readPdfText, that test fails and this file is changed to match.
 *
 * Where the PC decodes with Buffer, this reads bytes directly: ASCII tags are
 * written byte by byte, and UTF-16LE is turned into characters one 16-bit
 * code unit at a time. TextDecoder is not used for UTF-16: it replaces an
 * unpaired surrogate with U+FFFD, where Buffer keeps the code unit.
 */
import { withPdfiumDocument, type PdfiumDocModule } from './pdfium'

/** the PDFium calls reading text needs */
export interface PdfTextPdfium extends PdfiumDocModule {
  HEAPF64: Float64Array
  _FPDF_GetPageCount(doc: number): number
  _FPDF_LoadPage(doc: number, index: number): number
  _FPDF_ClosePage(page: number): void
  _FPDF_GetPageWidthF(page: number): number
  _FPDF_GetPageHeightF(page: number): number
  _FPDF_GetMetaText(doc: number, tag: number, buffer: number, bufferLen: number): number
  _FPDFText_LoadPage(page: number): number
  _FPDFText_ClosePage(textPage: number): void
  _FPDFText_CountChars(textPage: number): number
  /** embedpdf's build drops buffer_size: it copies exactly `count` chars into `buffer` */
  _FPDFText_GetText(textPage: number, startIndex: number, count: number, buffer: number): number
  _FPDFText_GetCharOrigin(textPage: number, index: number, x: number, y: number): number
  _FPDFText_GetFontSize(textPage: number, index: number): number
  _FPDFText_IsGenerated(textPage: number, index: number): number
}

export interface PdfPageText {
  /** 1-based page number */
  page: number
  /** page size in PDF points */
  widthPt: number
  heightPt: number
  /** code units pdfium reports for this page's text layer (0 for scanned pages) */
  chars: number
  /** extracted text with \n line breaks; empty when the page has no text layer */
  text: string
  hasTextLayer: boolean
}

export interface PdfTextDoc {
  pageCount: number
  /** document info dictionary entries worth showing an agent ('' entries omitted) */
  info: { title?: string; author?: string }
  pages: PdfPageText[]
  /** the charBudget ran out before the requested span was fully extracted */
  truncated: boolean
}

export interface ReadPdfTextOptions {
  /** 1-based inclusive; default 1 */
  fromPage?: number
  /** 1-based inclusive; default pageCount */
  toPage?: number
  /** explicit 1-based pages to extract (unsorted ok); overrides fromPage/toPage */
  pages?: readonly number[]
  /** stop extracting once the accumulated text reaches this many chars */
  charBudget?: number
  /** user password for an encrypted file */
  password?: string
}

/** Characters from UTF-16LE bytes, one per 16-bit code unit (Buffer's 'utf16le': an odd last byte is dropped) */
function utf16le(bytes: Uint8Array): string {
  const units = bytes.length >> 1
  let out = ''
  // in slices, so a long page does not pass too many arguments at once
  const SLICE = 8192
  for (let start = 0; start < units; start += SLICE) {
    const end = Math.min(units, start + SLICE)
    const codes = new Array<number>(end - start)
    for (let i = start; i < end; i++) codes[i - start] = bytes[i * 2]! | (bytes[i * 2 + 1]! << 8)
    out += String.fromCharCode(...codes)
  }
  return out
}

/** `text` as bytes, one per character (Buffer's 'latin1'; the tags are ASCII) */
function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
  return out
}

/**
 * Metadata read: the tag is an ASCII BYTESTRING, the value comes back UTF-16LE
 * with the byte length (NUL included) as the return value.
 */
function metaText(m: PdfTextPdfium, doc: number, tag: string): string {
  const tagBytes = latin1(`${tag}\0`)
  const tagPtr = m._malloc(tagBytes.length)
  if (!tagPtr) return ''
  try {
    m.HEAPU8.set(tagBytes, tagPtr)
    const size = m._FPDF_GetMetaText(doc, tagPtr, 0, 0)
    if (size <= 2) return ''
    const buf = m._malloc(size)
    if (!buf) return ''
    try {
      const written = m._FPDF_GetMetaText(doc, tagPtr, buf, size)
      if (written <= 0) return ''
      return utf16le(m.HEAPU8.subarray(buf, buf + written)).replace(/\0+$/, '')
    } finally {
      m._free(buf)
    }
  } finally {
    m._free(tagPtr)
  }
}

/** whole textpage text (UTF-16LE, pdfium uses \r\n line breaks) normalized to \n */
function pageText(m: PdfTextPdfium, textPage: number, count: number): string {
  if (count <= 0) return ''
  // pdfium writes count chars plus a UTF-16 NUL terminator
  const buf = m._malloc((count + 1) * 2)
  if (!buf) return ''
  try {
    const written = m._FPDFText_GetText(textPage, 0, count, buf)
    if (written <= 0) return ''
    const raw = utf16le(m.HEAPU8.subarray(buf, buf + written * 2))
    return joinSameLineBreaks(m, textPage, count, raw)
      .replace(/\0+$/, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trimEnd()
  } finally {
    m._free(buf)
  }
}

/**
 * pdfium starts a new line whenever a glyph begins left of where the previous one ended,
 * so PDFs that place kerned glyphs that way come back a few characters per line
 * ("테\n스\n트"). A generated break whose neighbours share a baseline and run left to
 * right is dropped again; a wide gap on the same line (a table cell) becomes a space.
 * Same rule as read-text.ts and the CLI's `pdf read` (packages/cli/src/formats/pdf.ts).
 */
function joinSameLineBreaks(
  m: PdfTextPdfium,
  textPage: number,
  count: number,
  text: string,
): string {
  // GetText writes one UTF-16 unit per char index; bail out when that does not hold
  if (text.replace(/\0+$/, '').length !== count) return text
  const xy = m._malloc(16)
  if (!xy) return text
  try {
    const origin = (i: number): [number, number] => {
      m._FPDFText_GetCharOrigin(textPage, i, xy, xy + 8)
      return [m.HEAPF64[xy >> 3]!, m.HEAPF64[(xy >> 3) + 1]!]
    }
    let out = ''
    for (let i = 0; i < count; i++) {
      const isBreak =
        text[i] === '\r' &&
        text[i + 1] === '\n' &&
        i > 0 &&
        i + 2 < count &&
        m._FPDFText_IsGenerated(textPage, i) === 1
      if (!isBreak) {
        out += text[i]
        continue
      }
      const [px, py] = origin(i - 1)
      const [nx, ny] = origin(i + 2)
      const size = Math.min(
        m._FPDFText_GetFontSize(textPage, i - 1),
        m._FPDFText_GetFontSize(textPage, i + 2),
      )
      if (size > 0 && Math.abs(ny - py) < size * 0.3 && nx > px) {
        if (nx - px > size * 2) out += ' '
        i += 1
        continue
      }
      out += text[i]
    }
    return out
  } finally {
    m._free(xy)
  }
}

/** The text of an open document: read-text.ts `readPdfText`'s `extract`, unchanged */
function extract(m: PdfTextPdfium, doc: number, options: ReadPdfTextOptions): PdfTextDoc {
  const pageCount = m._FPDF_GetPageCount(doc)
  const from = Math.max(1, Math.min(options.fromPage ?? 1, pageCount))
  const to = Math.max(from, Math.min(options.toPage ?? pageCount, pageCount))
  const wanted = options.pages
    ? [...new Set(options.pages.filter((p) => p >= 1 && p <= pageCount))].sort((a, b) => a - b)
    : Array.from({ length: to - from + 1 }, (_, i) => from + i)
  const budget = options.charBudget ?? Number.POSITIVE_INFINITY

  const info: { title?: string; author?: string } = {}
  const title = metaText(m, doc, 'Title')
  if (title) info.title = title
  const author = metaText(m, doc, 'Author')
  if (author) info.author = author

  const pages: PdfPageText[] = []
  let spent = 0
  let truncated = false
  for (const index of wanted) {
    if (truncated) break
    const page = m._FPDF_LoadPage(doc, index - 1)
    if (!page) {
      pages.push({
        page: index,
        widthPt: 0,
        heightPt: 0,
        chars: 0,
        text: '',
        hasTextLayer: false,
      })
      continue
    }
    try {
      const widthPt = m._FPDF_GetPageWidthF(page)
      const heightPt = m._FPDF_GetPageHeightF(page)
      const textPage = m._FPDFText_LoadPage(page)
      if (!textPage) {
        pages.push({
          page: index,
          widthPt,
          heightPt,
          chars: 0,
          text: '',
          hasTextLayer: false,
        })
        continue
      }
      try {
        const chars = m._FPDFText_CountChars(textPage)
        // The budget is already spent, also when it ran out exactly on the
        // previous page's boundary: report the truncation and stop rather than
        // emitting this unread page as an empty one.
        if (spent >= budget) {
          truncated = true
          break
        }
        let text = pageText(m, textPage, chars)
        if (spent + text.length > budget) {
          text = text.slice(0, Math.max(0, budget - spent))
          truncated = true
        }
        spent += text.length
        pages.push({ page: index, widthPt, heightPt, chars, text, hasTextLayer: chars > 0 })
      } finally {
        m._FPDFText_ClosePage(textPage)
      }
    } finally {
      m._FPDF_ClosePage(page)
    }
  }
  return { pageCount, info, pages, truncated }
}

/**
 * Extract text from `bytes` (a whole PDF file) with the caller's PDFium
 * module. Page span is clamped to the document; extraction stops early (with
 * `truncated`) once charBudget is spent. A file PDFium cannot open rejects
 * with PdfiumOpenError (readPdfText rejects too, with a plain Error).
 *
 * The module is not shared with other work while this runs: the caller keeps
 * one PDFium call at a time (the PC serializes them with chainPdfium).
 */
export function readPdfTextWith(
  m: PdfTextPdfium,
  bytes: Uint8Array,
  options: ReadPdfTextOptions = {},
): Promise<PdfTextDoc> {
  // read-text.ts (through text-edit.ts withDocument) passes no password for '' too
  const password = options.password ? options.password : null
  return withPdfiumDocument(m, bytes, password, (doc) => extract(m, doc, options))
}
