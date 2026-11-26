/**
 * The PDF tools' rules and runner, shared by the PC tools window
 * (apps/shell/src/main/pdf-tools) and the phone's tools screen: what each
 * tool takes, what a picked file is, which options a tool reads, the names of
 * what it writes, and running it on bytes. No AI, no network, and the source
 * bytes are only read.
 *
 * Page work that the PDF editor's own code does (merge, extract, rotate,
 * remove pages, read text) goes through a PageEngine the caller fills: the PC
 * with apps/pdf/src/main/save-pdf.ts and read-text.ts, which are shared with
 * upstream GenOffice and stay where they are; the phone with the mirrors in
 * mirror-pages.ts and mirror-text.ts, which tests hold to the same bytes.
 */
import { PDFDocument } from 'pdf-lib'
import { stripAnnotsBytes } from './annot-strip'
import { compressPdfBytes, type ImageRecoder } from './compress'
import { imagesToPdfBytes, readImageInfo } from './images'
import { overlayPdfBytes } from './overlay'
import { duplexMergeBytes } from './print-prep'
import { executeSplitPlan, readPdfBookmarks } from './split'
import type { PdfToolId, PdfToolOptions } from './tool-ids'
import {
  PAPER_POINTS,
  MARGIN_POINTS,
  PdfToolRefusal,
  type InspectResult,
  DEFAULT_ANNOT_KINDS,
  splitPlanFromOptions,
  pagesToText,
} from './tool-rules'
import { type SplitBookmarkEntry, type SplitOutputOptions } from './split-plan'

/** Read document bookmarks (/Outlines) from PDF bytes */
export async function readBookmarksBytes(bytes: Uint8Array): Promise<SplitBookmarkEntry[]> {
  return readPdfBookmarks(bytes)
}

/** A picked picture counts as one page, or is not a JPEG or PNG */
export function inspectImage(bytes: Uint8Array): InspectResult {
  return readImageInfo(bytes) ? { ok: true, pages: 1 } : { ok: false, problem: 'not-image' }
}

/** Page count of a password-protected PDF (the page tree itself is not encrypted); 0 if unknown */
export async function encryptedPageCount(bytes: Uint8Array): Promise<number> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
    return doc.getPageCount()
  } catch {
    return 0
  }
}

/** Page count of a PDF, or why the tools cannot use it */
export async function inspectPdf(bytes: Uint8Array): Promise<InspectResult> {
  try {
    // read past the encryption check only to learn that the file is encrypted:
    // the page functions refuse such a file, so the tools never run on it
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
    if (doc.isEncrypted) return { ok: false, problem: 'encrypted' }
    const pages = doc.getPageCount()
    return pages > 0 ? { ok: true, pages } : { ok: false, problem: 'unreadable' }
  } catch {
    return { ok: false, problem: 'unreadable' }
  }
}

// ---------------------------------------------------------------------------
// Running a tool

/**
 * The page work the PDF editor's own code does. The PC fills this with
 * apps/pdf/src/main/save-pdf.ts and read-text.ts; the phone with
 * mirrorPageEngine. The optional ones are for tools the phone does not offer
 * yet: a tool whose function is missing refuses with "unsupported".
 */
export interface PageEngine {
  mergePdfBytes(
    first: Uint8Array,
    others: Uint8Array[],
  ): Promise<{ merged: Uint8Array; appended: number }>
  extractPagesBytes(bytes: Uint8Array, pages: number[]): Promise<Uint8Array>
  rotateAllPages(bytes: Uint8Array, delta: 90 | 180 | 270): Promise<Uint8Array>
  removePages(bytes: Uint8Array, pages: number[]): Promise<Uint8Array>
  readText(bytes: Uint8Array): Promise<{ pages: { text: string }[] }>
  mergePagesBytes?(
    bytes: Uint8Array,
    o: { perSheet: number; direction: 'horizontal' | 'vertical'; separator: boolean },
  ): Promise<Uint8Array>
  setPageSizeBytes?(bytes: Uint8Array, w: number, h: number): Promise<Uint8Array>
  splitPagesBytes?(bytes: Uint8Array, perPage: 2 | 4 | 9): Promise<Uint8Array>
}

/** What a tool needs from its caller: the page engine, picture code, progress, a stop */
export interface RunDeps {
  engine: PageEngine
  recode?: ImageRecoder
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

/** Run the split tool and return output bytes paired with computed filenames and warnings */
export async function runSplitPdfTool(
  first: Uint8Array,
  sourceName: string,
  options: PdfToolOptions,
  deps: Omit<RunDeps, 'engine'> & { engine?: PageEngine } = {},
): Promise<{ parts: Uint8Array[]; names: string[]; oversizedPages: number[] }> {
  const doc = await PDFDocument.load(first, { updateMetadata: false })
  const plan = splitPlanFromOptions(options, doc.getPageCount())
  const output: SplitOutputOptions = {
    ...(options.splitPrefix ? { prefix: options.splitPrefix } : {}),
    ...(options.splitPattern ? { pattern: options.splitPattern } : {}),
    ...(options.splitCreateSubfolder !== undefined
      ? { createSubfolder: options.splitCreateSubfolder }
      : {}),
  }
  try {
    const result = await executeSplitPlan(first, plan, {
      sourceName,
      output,
      ...(deps.onProgress ? { onProgress: deps.onProgress } : {}),
      ...(deps.signal ? { signal: deps.signal } : {}),
    })
    return {
      parts: result.parts.map((p) => p.bytes),
      names: result.parts.map((p) => p.name),
      oversizedPages: result.oversizedPages,
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'split: no-bookmarks') {
      throw new PdfToolRefusal('no-bookmarks')
    }
    throw err
  }
}

/** The engine's function for a later tool, or a refusal when this engine has none */
function needs<T>(fn: T | undefined, tool: PdfToolId): T {
  if (!fn) throw new Error(`unsupported: ${tool}`)
  return fn
}

/** Run `tool` on `inputs` (already checked); one file, or one per part for split */
export async function runPdfTool(
  tool: PdfToolId,
  inputs: Uint8Array[],
  options: PdfToolOptions,
  deps: RunDeps,
): Promise<Uint8Array[]> {
  const [first, ...rest] = inputs
  if (!first) throw new Error('no input')
  const { engine } = deps
  switch (tool) {
    case 'merge':
      return [(await engine.mergePdfBytes(first, rest)).merged]
    case 'split':
      return (await runSplitPdfTool(first, 'document.pdf', options, deps)).parts
    case 'extract': {
      const pages = (options.pages ?? '').split(',').map((p) => Number(p) - 1)
      return [await engine.extractPagesBytes(first, pages)]
    }
    case 'reverse': {
      const count = (await PDFDocument.load(first, { updateMetadata: false })).getPageCount()
      return [
        await engine.extractPagesBytes(
          first,
          Array.from({ length: count }, (_, i) => count - 1 - i),
        ),
      ]
    }
    case 'nup': {
      const mergePages = needs(engine.mergePagesBytes, tool)
      return [
        await mergePages.call(engine, first, {
          perSheet: options.perSheet ?? 2,
          direction: options.direction ?? 'horizontal',
          separator: options.separator ?? false,
        }),
      ]
    }
    case 'rotate':
      return [await engine.rotateAllPages(first, options.rotation ?? 90)]
    case 'pageSize': {
      const setPageSize = needs(engine.setPageSizeBytes, tool)
      const paper = PAPER_POINTS[options.paper ?? 'A4']
      return [await setPageSize.call(engine, first, paper.w, paper.h)]
    }
    case 'splitPages': {
      const splitPages = needs(engine.splitPagesBytes, tool)
      return [await splitPages.call(engine, first, options.perPage ?? 2)]
    }
    case 'imagesToPdf': {
      const paper = options.imagePaper ?? 'A4'
      return [
        await imagesToPdfBytes(inputs, {
          paper: paper === 'image' ? null : PAPER_POINTS[paper],
          marginPt: MARGIN_POINTS[options.margin ?? 'small'],
        }),
      ]
    }
    case 'duplex':
      // both sides of every sheet: two pages, or two times what N-up puts on a side
      return [await duplexMergeBytes(inputs, 2 * (options.sheetPages ?? 1))]
    case 'overlay': {
      const background = inputs[1]
      if (!background) throw new Error('no background')
      const pages = options.applyPages
        ? options.applyPages.split(',').map((p) => Number(p) - 1)
        : null
      return [
        await overlayPdfBytes(first, background, {
          behind: options.layer !== 'front',
          backgroundPage: (options.backgroundPage ?? 1) - 1,
          pages,
        }),
      ]
    }
    case 'encrypt':
    case 'decrypt':
    case 'repair':
      // these run apart (the PC's PDF job process, the phone's engine worker)
      throw new Error(`${tool} runs as a job`)
    case 'compress': {
      if (!deps.recode) throw new Error('no picture code')
      const made = await compressPdfBytes(first, options.compressLevel ?? 'medium', deps.recode, {
        ...(deps.onProgress ? { onProgress: deps.onProgress } : {}),
        ...(deps.signal ? { signal: deps.signal } : {}),
      })
      // a file that did not get smaller is not worth a copy
      if (made.bytes.length >= first.length) throw new PdfToolRefusal('not-smaller')
      return [made.bytes]
    }
    case 'blankPages': {
      // the editor's own page removal on save, which keeps bookmarks and forms
      const deletedPages = (options.removePages ?? '').split(',').map((p) => Number(p) - 1)
      return [await engine.removePages(first, deletedPages)]
    }
    case 'stripAnnots': {
      const pages = options.applyPages
        ? options.applyPages.split(',').map((p) => Number(p) - 1)
        : null
      const stripped = await stripAnnotsBytes(first, {
        kinds: options.annotKinds ?? DEFAULT_ANNOT_KINDS,
        pages,
      })
      if (stripped.removed === 0) throw new PdfToolRefusal('no-annots')
      return [stripped.bytes]
    }
    case 'toText': {
      const doc = await engine.readText(first)
      if (!doc.pages.some((page) => page.text.trim() !== '')) throw new PdfToolRefusal('no-text')
      return [new TextEncoder().encode(pagesToText(doc.pages))]
    }
  }
}

/** Blank pages found in a PDF: 1-based candidates, a BGRA thumbnail for the first ones */
export interface FoundBlankPages {
  pageCount: number
  candidates: {
    page: number
    reason: 'empty' | 'nearly-white'
    thumb: { width: number; height: number; bgra: Uint8Array } | null
  }[]
}
