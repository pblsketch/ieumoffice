/**
 * Open a PDF in a PDFium module the caller loaded (the PC job process reads
 * the wasm from disk, the mobile engine from the app bundle), hand the open
 * document to a function and always close it and give its memory back.
 */

/** the PDFium calls opening and closing a document needs */
export interface PdfiumDocModule {
  HEAPU8: Uint8Array
  _malloc(size: number): number
  _free(ptr: number): void
  _FPDF_LoadMemDocument(ptr: number, size: number, password: number): number
  _FPDF_CloseDocument(doc: number): void
  _FPDF_GetLastError(): number
}

/** FPDF_ERR_PASSWORD */
const ERR_PASSWORD = 4

/** PDFium did not open the document; never carries the password */
export class PdfiumOpenError extends Error {
  constructor(readonly code: 'wrong-password' | 'unreadable') {
    super(
      code === 'wrong-password'
        ? 'the password does not open this PDF'
        : 'PDFium could not read the PDF',
    )
  }
}

/**
 * Open `bytes` (with `password`, or none when null), run `fn` on the open
 * document and close it again, also when `fn` throws. PDFium reads the file
 * from its own heap for as long as the document is open, so the copy is freed
 * only after closing; the password's copy is wiped and freed once it opened.
 */
export async function withPdfiumDocument<T>(
  m: PdfiumDocModule,
  bytes: Uint8Array,
  password: string | null,
  fn: (doc: number) => T | Promise<T>,
): Promise<T> {
  const ptr = m._malloc(bytes.length)
  if (!ptr) throw new PdfiumOpenError('unreadable')
  let doc = 0
  try {
    m.HEAPU8.set(bytes, ptr)
    let pwPtr = 0
    let pwLength = 0
    if (password !== null) {
      const pw = new TextEncoder().encode(`${password}\0`)
      pwPtr = m._malloc(pw.length)
      if (!pwPtr) throw new PdfiumOpenError('unreadable')
      pwLength = pw.length
      m.HEAPU8.set(pw, pwPtr)
    }
    try {
      doc = m._FPDF_LoadMemDocument(ptr, bytes.length, pwPtr)
    } finally {
      if (pwPtr) {
        m.HEAPU8.fill(0, pwPtr, pwPtr + pwLength)
        m._free(pwPtr)
      }
    }
    if (!doc) {
      throw new PdfiumOpenError(
        m._FPDF_GetLastError() === ERR_PASSWORD ? 'wrong-password' : 'unreadable',
      )
    }
    return await fn(doc)
  } finally {
    if (doc) m._FPDF_CloseDocument(doc)
    m._free(ptr)
  }
}
