/**
 * Mirrors of the PDF editor's page work in apps/pdf/src/main/save-pdf.ts, for
 * the phone's tools engine. That file is shared with upstream GenOffice and
 * leans on Node, so it stays where it is and the PC keeps calling it; these
 * copies take the same steps and write the same bytes for the same input:
 * - mergePdfInOrder = mergePdfBytes(first, others), reading one file at a time
 * - extractPdfPages = extractPagesBytes
 * - rotateAllPdfPages = applySaveRequest with only a rotation for every page
 * - removePdfPages = applySaveRequest with only deletedPages
 * tests/mirror-pages.test.ts runs each next to its original: when upstream
 * changes one, that test fails and the copy here is changed to match.
 */
import { PDFBool, PDFDocument, PDFName, degrees } from 'pdf-lib'
import { readPdfTextWith, type PdfTextPdfium } from './mirror-text'
import type { PageEngine } from './tools'

/**
 * Append the pages of every input after the first's, in order, as
 * mergePdfBytes(first, others) does. Inputs are asked for one at a time, so
 * the caller can read each file only when it is its turn.
 */
export async function mergePdfInOrder(
  inputs: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): Promise<{ merged: Uint8Array; appended: number }> {
  let dst: PDFDocument | null = null
  let appended = 0
  for await (const bytes of inputs) {
    if (!dst) {
      dst = await PDFDocument.load(bytes, { updateMetadata: false })
      continue
    }
    const src = await PDFDocument.load(bytes, { updateMetadata: false })
    const copied = await dst.copyPages(src, src.getPageIndices())
    for (const p of copied) dst.addPage(p)
    appended += copied.length
  }
  if (!dst) throw new Error('no input')
  return { merged: await dst.save({ useObjectStreams: false }), appended }
}

/** Extract the given pages (original indices) into bytes of a new PDF, as extractPagesBytes does */
export async function extractPdfPages(bytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { updateMetadata: false })
  const out = await PDFDocument.create()
  const valid = pages.filter((p) => p >= 0 && p < src.getPageCount())
  const copied = await out.copyPages(src, valid)
  for (const p of copied) out.addPage(p)
  return out.save({ useObjectStreams: false })
}

/**
 * Turn every page clockwise by `delta`: the steps applySaveRequest takes for
 * a request whose only change is a rotation of each page.
 */
export async function rotateAllPdfPages(
  bytes: Uint8Array,
  delta: 90 | 180 | 270,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(bytes, { updateMetadata: false })
  const pages = pdfDoc.getPages()
  for (const page of pages) {
    page.setRotation(degrees((page.getRotation().angle + delta) % 360))
  }
  refreshFieldAppearances(pdfDoc)
  return pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false })
}

/**
 * Remove the given pages (original indices), always keeping one: the steps
 * applySaveRequest takes for a request whose only change is deletedPages.
 */
export async function removePdfPages(bytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(bytes, { updateMetadata: false })
  // applySaveRequest reads the page list before its stages; kept for the same steps
  pdfDoc.getPages()
  // descending, so the indices still name the original pages
  for (const idx of [...pages].sort((a, b) => b - a)) {
    if (idx >= 0 && idx < pdfDoc.getPageCount() && pdfDoc.getPageCount() > 1) pdfDoc.removePage(idx)
  }
  refreshFieldAppearances(pdfDoc)
  return pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false })
}

/**
 * Copied from save-pdf.ts: pdf-lib's save-time appearance pass aborts on the
 * first field whose text Helvetica cannot encode (CJK values), leaving every
 * other dirty field without /AP. Regenerate per field instead and only set
 * NeedAppearances for the ones that fail, so viewers rebuild those alone.
 */
function refreshFieldAppearances(pdfDoc: PDFDocument): void {
  if (!pdfDoc.catalog.has(PDFName.of('AcroForm'))) return
  const form = pdfDoc.getForm()
  const font = form.getDefaultFont()
  let needAppearances = false
  for (const field of form.getFields()) {
    if (!field.needsAppearancesUpdate()) continue
    // Same per-type dispatch pdf-lib's own save pass uses (check boxes and radios ignore the font)
    try {
      field.defaultUpdateAppearances(font)
    } catch {
      needAppearances = true
    }
  }
  if (needAppearances) form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True)
}

/**
 * A page engine made of the mirrors, for the phone. PDFium is loaded by the
 * caller and only when text is read. The later tools (N-up, page size, page
 * split) are left out, so the runner refuses them as unsupported.
 */
export function mirrorPageEngine(loadPdfium: () => Promise<PdfTextPdfium>): PageEngine {
  return {
    mergePdfBytes: (first, others) => mergePdfInOrder([first, ...others]),
    extractPagesBytes: extractPdfPages,
    rotateAllPages: rotateAllPdfPages,
    removePages: removePdfPages,
    readText: async (bytes) => readPdfTextWith(await loadPdfium(), bytes),
  }
}
