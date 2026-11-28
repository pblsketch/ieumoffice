/**
 * The PDF tools window's work, without Electron. The rules and the runner are
 * shared with the phone in @genoffice/pdf-ops; this file keeps every name it
 * exported for its importers, and adds what belongs to the PC: the read cap,
 * the PDF job process's work, and the page engine made of the PDF editor's
 * own functions (apps/pdf/src/main: save-pdf.ts for pages, read-text.ts), so
 * a file made here matches the same command in the editor. No AI, no network,
 * and the source bytes are only read.
 */
import { PDFDocument } from 'pdf-lib'
import {
  runPdfTool as runSharedPdfTool,
  runSplitPdfTool as runSharedSplitPdfTool,
  type FoundBlankPages,
  type ImageRecoder,
  type PageEngine,
  type PdfToolId,
  type PdfToolOptions,
} from '@genoffice/pdf-ops'
import {
  applySaveRequest,
  extractPagesBytes,
  mergePagesBytes,
  mergePdfBytes,
  setPageSizeBytes,
  splitPagesBytes,
} from '../../../../pdf/src/main/save-pdf'
import { readPdfText } from '../../../../pdf/src/main/read-text'
import type { StructureJob } from '../pdf-structure/protocol'

export {
  DEFAULT_ANNOT_KINDS,
  MAX_PASSWORD_BYTES,
  PdfToolRefusal,
  checkOptions,
  encryptedPageCount,
  inspectImage,
  inspectPdf,
  isPdfToolId,
  outputNames,
  pagesToText,
  readBookmarksBytes,
  splitPlanFromOptions,
  toolAccepts,
  toolInputKind,
  toolMinInputs,
  toolOutputExtension,
  toolTakesMany,
} from '@genoffice/pdf-ops'
export type { CheckedOptions, FoundBlankPages, InspectResult, PageEngine } from '@genoffice/pdf-ops'

/** Bytes one run may read in total, the editor's merge cap */
export const MAX_TOOL_INPUT_BYTES = 1024 * 1024 * 1024

/** Tools that run in the PDF job process (qpdf, PDFium repair) rather than here */
export function toolRunsAsJob(tool: PdfToolId): tool is 'encrypt' | 'decrypt' | 'repair' {
  return tool === 'encrypt' || tool === 'decrypt' || tool === 'repair'
}

/** The empty save request the editor's page functions take, a change added per tool */
const NO_EDITS = { path: '', markups: [], drawings: [], formValues: [], stamps: [] }

/**
 * The PC's page engine: the PDF editor's own functions. Rotation and page
 * removal are the editor's save with only that change, as they always were.
 */
export const pcPageEngine: PageEngine = {
  mergePdfBytes: (first, others) => mergePdfBytes(first, others),
  extractPagesBytes: (bytes, pages) => extractPagesBytes(bytes, pages),
  async rotateAllPages(bytes, delta) {
    const count = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount()
    const applied = await applySaveRequest(bytes, {
      ...NO_EDITS,
      rotations: Array.from({ length: count }, (_, pageIndex) => ({ pageIndex, delta })),
    })
    return applied.bytes
  },
  async removePages(bytes, deletedPages) {
    // the editor's own page removal on save, which keeps bookmarks and forms
    const applied = await applySaveRequest(bytes, { ...NO_EDITS, deletedPages })
    return applied.bytes
  },
  readText: (bytes) => readPdfText(bytes),
  mergePagesBytes: (bytes, options) => mergePagesBytes(bytes, options),
  setPageSizeBytes: (bytes, w, h) => setPageSizeBytes(bytes, w, h),
  splitPagesBytes: (bytes, perPage) => splitPagesBytes(bytes, perPage),
}

/** What a long tool needs from the window: Chromium's picture code, progress, a stop */
export interface PcRunDeps {
  /** the PC engine when left out */
  engine?: PageEngine
  recode?: ImageRecoder
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}
export type RunDeps = PcRunDeps

/** Run the split tool and return output bytes paired with computed filenames and warnings */
export function runSplitPdfTool(
  first: Uint8Array,
  sourceName: string,
  options: PdfToolOptions,
  deps: PcRunDeps = {},
): Promise<{ parts: Uint8Array[]; names: string[]; oversizedPages: number[] }> {
  return runSharedSplitPdfTool(first, sourceName, options, deps)
}

/** Run `tool` on `inputs` (already checked); one file, or one per part for split */
export function runPdfTool(
  tool: PdfToolId,
  inputs: Uint8Array[],
  options: PdfToolOptions,
  deps: PcRunDeps = {},
): Promise<Uint8Array[]> {
  return runSharedPdfTool(tool, inputs, options, { ...deps, engine: deps.engine ?? pcPageEngine })
}

/** The blank-pages job's answer, checked; null when it is not that shape */
export function foundBlankPagesOf(value: unknown): FoundBlankPages | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.pageCount !== 'number' || !Array.isArray(v.candidates)) return null
  const candidates: FoundBlankPages['candidates'] = []
  for (const raw of v.candidates as unknown[]) {
    if (!raw || typeof raw !== 'object') return null
    const c = raw as Record<string, unknown>
    if (typeof c.page !== 'number' || !Number.isInteger(c.page)) return null
    if (c.page < 1 || c.page > v.pageCount) return null
    if (c.reason !== 'empty' && c.reason !== 'nearly-white') return null
    let thumb: FoundBlankPages['candidates'][number]['thumb'] = null
    if (c.thumb) {
      const t = c.thumb as Record<string, unknown>
      const { width, height, bgra } = t
      if (typeof width !== 'number' || typeof height !== 'number') return null
      if (!(bgra instanceof Uint8Array) || bgra.length !== width * height * 4) return null
      thumb = { width, height, bgra }
    }
    candidates.push({ page: c.page, reason: c.reason, thumb })
  }
  return { pageCount: v.pageCount, candidates }
}

/** The PDF job process's work for a tool that runs there, on the file at `path` */
export function jobFor(
  tool: 'encrypt' | 'decrypt' | 'repair',
  path: string,
  options: PdfToolOptions,
): StructureJob {
  const source = { pdfPath: path }
  if (tool === 'repair') return { op: 'repair', source }
  if (tool === 'decrypt') return { op: 'decrypt', source, password: options.password ?? '' }
  return {
    op: 'encrypt',
    source,
    userPassword: options.password ?? '',
    ...(options.restrict && options.permissionPassword
      ? { ownerPassword: options.permissionPassword }
      : {}),
  }
}

/** The bytes a tool job answered with; null when it is not that shape */
export function jobBytesOf(value: unknown): Uint8Array | null {
  const bytes = (value as { bytes?: unknown } | null)?.bytes
  return bytes instanceof Uint8Array && bytes.length > 0 ? bytes : null
}
