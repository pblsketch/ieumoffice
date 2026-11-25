/**
 * The mobile PDF engine: the PC save code (apps/pdf/src/main) called as is,
 * on the Node stand-ins in ./node-shims. Runs in the engine worker
 * (worker.ts) and, for tests, directly in the calling thread.
 *
 * Every operation first loads what the PC code will read synchronously
 * (PDFium, harfbuzz, the bundled fonts), then calls the PC function.
 */
import type {
  ImageEditFailure,
  SavePdfRequest,
  TextEditFailure,
  TextEditInput,
  TextEditValidation,
  TextInsertFailure,
} from '../../../../../../pdf/src/shared/ipc'
import { ensureWasm } from './assets'
import { ensureBundledFonts } from './fonts'
import { SAVE_SINK_DIR, vfsDelete, vfsGet } from './node-shims/vfs'

const savePdf = () => import('../../../../../../pdf/src/main/save-pdf')
const textEdit = () => import('../../../../../../pdf/src/main/text-edit')

/** What a save writes, plus the edits the PC code had to skip (as PC SavePdfSkips) */
export interface PdfSaveResult {
  bytes: Uint8Array
  skippedTextEdits: TextEditFailure[]
  skippedTextInserts: TextInsertFailure[]
  skippedImageEdits: ImageEditFailure[]
}

const some = (list: readonly unknown[] | undefined) => (list?.length ?? 0) > 0

/** Requests whose PC stages call PDFium (text, image and annotation-delete stages, flatten) */
export function requestNeedsPdfium(request: SavePdfRequest): boolean {
  return (
    some(request.textEdits) ||
    some(request.textInserts) ||
    some(request.imageEdits) ||
    some(request.annotDeletes) ||
    some(request.redactions) ||
    request.annotations === 'flatten'
  )
}

/** Requests whose PC stages draw text with a rebuilt font (fonts and harfbuzz) */
export function requestNeedsFonts(request: SavePdfRequest): boolean {
  return some(request.textEdits) || some(request.textInserts)
}

async function ensurePdfium(): Promise<void> {
  await ensureWasm('pdfium.wasm')
}

async function ensureTextSupport(): Promise<void> {
  await Promise.all([ensureWasm('hb-subset.wasm'), ensureBundledFonts()])
}

async function prepareFor(request: SavePdfRequest): Promise<void> {
  const loads: Promise<void>[] = []
  if (requestNeedsPdfium(request)) loads.push(ensurePdfium())
  if (requestNeedsFonts(request)) loads.push(ensureTextSupport())
  await Promise.all(loads)
}

/** A standalone Uint8Array (its own buffer), safe to transfer out of the worker */
export function ownBytes(bytes: Uint8Array): Uint8Array {
  const plain = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? plain
    : plain.slice()
}

let sinkCounter = 0

export const pdfEngineCore = {
  /**
   * The PC save (`savePdfBytesToPath`) without a file: edits applied, the
   * Save As annotation choice (`request.annotations`), the read-back
   * verification, and the source bytes unchanged when there is nothing to
   * write. The PC function writes into an in-memory sink path that is read
   * back and cleared here. Throws `save-verify-failed pages=…` like the PC.
   */
  async saveBytes(source: Uint8Array, request: SavePdfRequest): Promise<PdfSaveResult> {
    await prepareFor(request)
    const { savePdfBytesToPath } = await savePdf()
    const target = `${SAVE_SINK_DIR}/save-${++sinkCounter}.pdf`
    try {
      const skips = await savePdfBytesToPath(source, target, request)
      const bytes = vfsGet(target)
      if (!bytes) throw new Error('pdf engine: the save produced no bytes')
      return { bytes: ownBytes(bytes), ...skips }
    } finally {
      vfsDelete(target)
    }
  },

  /** PC `pdfBytesWithEditsOf`: the edited document as bytes (annotation choice ignored) */
  async applyEdits(source: Uint8Array, request: SavePdfRequest): Promise<Uint8Array> {
    await prepareFor(request)
    const { pdfBytesWithEditsOf } = await savePdf()
    return ownBytes(await pdfBytesWithEditsOf(source, request))
  },

  /** PC `saveRequestHasEdits` */
  async hasEdits(request: SavePdfRequest): Promise<boolean> {
    const { saveRequestHasEdits } = await savePdf()
    return saveRequestHasEdits(request)
  },

  /** PC `insertPdfBytes`: every page of `other` after `afterPageIndex` (-1 = front) */
  async insertPdf(
    bytes: Uint8Array,
    other: Uint8Array,
    afterPageIndex: number,
  ): Promise<{ merged: Uint8Array; count: number }> {
    const { insertPdfBytes } = await savePdf()
    const { merged, count } = await insertPdfBytes(bytes, other, afterPageIndex)
    return { merged: ownBytes(merged), count }
  },

  /** PC `insertBlankPageBytes`: a blank page after `afterPageIndex` (-1 = front) */
  async insertBlankPage(bytes: Uint8Array, afterPageIndex: number): Promise<Uint8Array> {
    const { insertBlankPageBytes } = await savePdf()
    return ownBytes(await insertBlankPageBytes(bytes, afterPageIndex))
  },

  /** PC `blankPdfBuffer`: the one-page A4 document a new PDF starts from */
  async blankPdf(): Promise<Uint8Array> {
    const { blankPdfBuffer } = await import('../../../../../../pdf/src/main/blank-pdf')
    return ownBytes(await blankPdfBuffer())
  },

  /** PC `canDrawText`: whether the chosen edit font (else a fallback) draws every char */
  async canDrawText(text: string, font?: string, bold = false, italic = false): Promise<boolean> {
    await ensureTextSupport()
    const { canDrawText } = await textEdit()
    return canDrawText(text, font, bold, italic)
  },

  /** PC `listEditFonts`: the edit-font ids that resolve to a font (all three on the phone) */
  async listEditFonts(): Promise<string[]> {
    await ensureTextSupport()
    const { listEditFonts } = await textEdit()
    return listEditFonts()
  },

  /** PC `validateTextEdits`: dry-run matching of pending text edits (PDFium) */
  async validateTextEdits(
    bytes: Uint8Array,
    edits: TextEditInput[],
  ): Promise<TextEditValidation[]> {
    await Promise.all([ensurePdfium(), ensureTextSupport()])
    const { validateTextEdits } = await textEdit()
    return validateTextEdits(bytes, edits)
  },

  /** PC `flattenAnnotsBytes`: bake annotations into page content (PDFium) */
  async flattenAnnots(bytes: Uint8Array): Promise<Uint8Array> {
    await ensurePdfium()
    const { flattenAnnotsBytes } = await import('../../../../../../pdf/src/main/annot-flatten')
    return ownBytes(await flattenAnnotsBytes(bytes))
  },

  /** PC `stripCommentAnnotsBytes`: drop comment annotations, keep links and fields */
  async stripCommentAnnots(bytes: Uint8Array): Promise<{ bytes: Uint8Array; removed: number }> {
    const { stripCommentAnnotsBytes } = await import('../../../../../../pdf/src/main/annot-strip')
    const out = await stripCommentAnnotsBytes(bytes)
    return { bytes: ownBytes(out.bytes), removed: out.removed }
  },
}

export type PdfEngineCore = typeof pdfEngineCore
export type PdfEngineOp = keyof PdfEngineCore
