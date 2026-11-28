/**
 * The PDF tools window's work, without Electron: read what a picked PDF is,
 * check a tool's options against it, and run the tool. Every tool goes
 * through the PDF editor's own functions (apps/pdf/src/main: save-pdf.ts for
 * pages, images-to-pdf.ts, read-text.ts), so a file made here matches the same
 * command in the editor. No AI, no network, and the source bytes are only read.
 */
import { PDFDocument } from 'pdf-lib'
import { headlessModuleFor } from '@genoffice/electron-utils'
import {
  applySaveRequest,
  extractPagesBytes,
  mergePagesBytes,
  mergePdfBytes,
  setPageSizeBytes,
  splitPagesBytes,
} from '../../../../pdf/src/main/save-pdf'
import { executeSplitPlan, readPdfBookmarks } from '../../../../pdf/src/main/split-pdf'
import {
  MAX_SPLIT_MAX_BYTES,
  MIN_SPLIT_MAX_BYTES,
  formatSplitRangeList,
  parseSplitRangeList,
  sanitizeSplitName,
  type SplitBookmarkEntry,
  type SplitOutputOptions,
  type SplitPlanRequest,
} from '../../../../pdf/src/shared/split-plan'
import {
  imagesToPdfBytes,
  isSupportedWebImageBytes,
  readImageInfo,
} from '../../../../pdf/src/main/images-to-pdf'
import { duplexMergeBytes } from '../../../../pdf/src/main/print-prep'
import { overlayPdfBytes } from '../../../../pdf/src/main/overlay'
import { stripAnnotsBytes } from '../../../../pdf/src/main/annot-strip'
import {
  COMPRESS_LEVELS,
  COMPRESS_MODES,
  compressPdfBytes,
  compressPdfV2Bytes,
  type CompressMode,
  type ImageRecoder,
} from '../../../../pdf/src/main/compress'
import { interleavePdfBytes } from '../../../../pdf/src/main/interleave'
import { mergePdfV2Bytes } from '../../../../pdf/src/main/merge-v2'
import { organizePdfBytes, type OrganizePageSpec } from '../../../../pdf/src/main/organize-pages'
import { readPdfText, type PdfPageText } from '../../../../pdf/src/main/read-text'
import { parsePageRange } from '../../../../pdf/src/renderer/convert/page-range'
import type { StructureJob } from '../pdf-structure/protocol'
import {
  PDF_TOOL_ANNOT_KINDS,
  PDF_TOOL_IDS,
  PDF_TOOL_MARGINS,
  PDF_TOOL_PAPERS,
  PDF_TOOL_SHEET_PAGES,
  type PdfConvertFormat,
  type PdfImageOptimize,
  type PdfImageOrientation,
  type PdfInputProblem,
  type PdfPickedFileKind,
  type PdfToolAccept,
  type PdfToolAnnotKind,
  type PdfToolId,
  type PdfToolInputKind,
  type PdfToolMargin,
  type PdfToolOptions,
  type PdfToolPaper,
} from '../../shared/pdf-tools-api'

/** Bytes one run may read in total, the editor's merge cap */
export const MAX_TOOL_INPUT_BYTES = 1024 * 1024 * 1024

/** The editor's "page size" list (apps/pdf/src/renderer/view-config.ts PAPER_SIZES) */
const PAPER_POINTS: Record<PdfToolPaper, { w: number; h: number }> = {
  A3: { w: 842, h: 1191 },
  A4: { w: 595, h: 842 },
  A5: { w: 420, h: 595 },
  Letter: { w: 612, h: 792 },
  Legal: { w: 612, h: 1008 },
}

export function isPdfToolId(value: unknown): value is PdfToolId {
  return typeof value === 'string' && (PDF_TOOL_IDS as readonly string[]).includes(value)
}

/** Points of space around a picture for each margin choice (imagesToPdf) */
const MARGIN_POINTS: Record<PdfToolMargin, number> = { none: 0, small: 18, large: 36 }

/** Batch-capable tools (spec 3.1): single-file tools that can also process a folder of files; `split` is excluded */
const BATCH_TOOL_SET: ReadonlySet<PdfToolId> = new Set<PdfToolId>([
  'reverse',
  'rotate',
  'nup',
  'pageSize',
  'splitPages',
  'overlay',
  'stripAnnots',
  'ocr',
  'docsToPdf',
  'pdfToImages',
  'convertFromPdf',
  'toText',
  'compress',
  'encrypt',
  'decrypt',
  'repair',
])

/** Tools eligible as a tool-chaining target (spec 3.1): `split`, `imagesToPdf`, `docsToPdf`, `decrypt` are excluded */
const CHAIN_TARGET_SET: ReadonlySet<PdfToolId> = new Set<PdfToolId>([
  'organize',
  'merge',
  'interleave',
  'extract',
  'reverse',
  'rotate',
  'blankPages',
  'duplex',
  'nup',
  'pageSize',
  'splitPages',
  'overlay',
  'stripAnnots',
  'ocr',
  'pdfToImages',
  'convertFromPdf',
  'toText',
  'compress',
  'encrypt',
  'repair',
])

export function isBatchTool(tool: PdfToolId): boolean {
  return BATCH_TOOL_SET.has(tool)
}

export function isChainTarget(tool: PdfToolId): boolean {
  return CHAIN_TARGET_SET.has(tool)
}

/** Whether a tool input requirement accepts an actual picked file kind (spec 3.2) */
export function acceptsFileKind(toolKind: PdfToolInputKind, fileKind: PdfPickedFileKind): boolean {
  return toolKind === 'mixed' ? true : toolKind === fileKind
}

/** Multi-input tools plus batch-capable tools accept picking several files (`split` stays false) */
export function toolTakesMany(tool: PdfToolId): boolean {
  return (
    tool === 'merge' ||
    tool === 'imagesToPdf' ||
    tool === 'duplex' ||
    tool === 'docsToPdf' ||
    isBatchTool(tool)
  )
}

/** The fewest files a tool runs on: merge needs two */
export function toolMinInputs(tool: PdfToolId): number {
  return tool === 'merge' ? 2 : 1
}

/** Which PDFs a tool takes */
export function toolAccepts(tool: PdfToolId): PdfToolAccept {
  return tool === 'decrypt' ? 'encrypted' : tool === 'repair' ? 'damaged' : 'pdf'
}

export type JobPdfToolId =
  'encrypt' | 'decrypt' | 'repair' | 'ocr' | 'pdfToImages' | 'convertFromPdf'

/** Tools that run in the PDF job process rather than in-process pdf-lib */
export function toolRunsAsJob(tool: PdfToolId): tool is JobPdfToolId {
  return (
    tool === 'encrypt' ||
    tool === 'decrypt' ||
    tool === 'repair' ||
    tool === 'ocr' ||
    tool === 'pdfToImages' ||
    tool === 'convertFromPdf'
  )
}

/** the longest password AES-256 PDF encryption keeps (127 bytes of UTF-8) */
export const MAX_PASSWORD_BYTES = 127

/** Input kind accepted by each tool (spec 3.1) */
export function toolInputKind(tool: PdfToolId): PdfToolInputKind {
  if (tool === 'imagesToPdf') return 'image'
  if (tool === 'docsToPdf') return 'document'
  if (tool === 'merge') return 'mixed'
  return 'pdf'
}

/** The kind of file a tool writes */
export function toolOutputExtension(
  tool: PdfToolId,
  options?: PdfToolOptions,
): 'pdf' | 'txt' | 'zip' | PdfConvertFormat {
  if (tool === 'toText') return 'txt'
  if (tool === 'convertFromPdf') return options?.targetFormat ?? 'docx'
  if (tool === 'pdfToImages') return options?.imageOutMode === 'zip' ? 'zip' : 'pdf'
  return 'pdf'
}

/**
 * A tool ran but has nothing to write: a PDF without any text layer (toText),
 * none of the chosen kinds of annotation (stripAnnots), not smaller (compress),
 * no pages recognized by OCR, or no embedded images.
 */
export class PdfToolRefusal extends Error {
  constructor(
    readonly reason:
      | 'no-text'
      | 'no-annots'
      | 'not-smaller'
      | 'no-ocr-changes'
      | 'no-embedded-images'
      | 'no-bookmarks',
  ) {
    super(reason)
  }
}

/** Read document bookmarks (/Outlines) from PDF bytes */
export async function readBookmarksBytes(bytes: Uint8Array): Promise<SplitBookmarkEntry[]> {
  return readPdfBookmarks(bytes)
}

export type InspectResult = { ok: true; pages: number } | { ok: false; problem: PdfInputProblem }

/**
 * A picked picture counts as one page: JPEG/PNG via `readImageInfo`, or
 * WebP/BMP/GIF via magic bytes (optionally verified by Chromium `extraCheck`).
 */
export function inspectImage(
  bytes: Uint8Array,
  extraCheck?: (bytes: Uint8Array) => boolean,
): InspectResult {
  if (readImageInfo(bytes)) return { ok: true, pages: 1 }
  if (isSupportedWebImageBytes(bytes) && (!extraCheck || extraCheck(bytes))) {
    return { ok: true, pages: 1 }
  }
  return { ok: false, problem: 'not-image' }
}

/** A picked non-PDF document supported by headless PDF export (rejects `.odp` etc.) */
export function inspectDocument(filePath: string, sizeBytes: number): InspectResult {
  if (sizeBytes > MAX_TOOL_INPUT_BYTES) return { ok: false, problem: 'too-large' }
  return headlessModuleFor(filePath)
    ? { ok: true, pages: 0 }
    : { ok: false, problem: 'unsupported-document' }
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

export type CheckedOptions =
  | { ok: true; options: PdfToolOptions }
  | {
      ok: false
      error:
        | 'range'
        | 'no-kinds'
        | 'none-chosen'
        | 'all-pages'
        | 'password-empty'
        | 'password-same'
        | 'password-long'
        | 'invalid-target-size'
        | 'invalid-size'
    }

const CONVERT_FORMATS: readonly PdfConvertFormat[] = ['docx', 'xlsx', 'pptx', 'hwpx', 'md', 'epub']
const IMAGE_ORIENTATIONS: readonly PdfImageOrientation[] = ['auto', 'portrait', 'landscape']
const IMAGE_OPTIMIZES: readonly PdfImageOptimize[] = ['original', 'balanced', 'compact']
const IMAGE_DPIS = [150, 200, 300] as const
const IMAGE_QUALITIES = ['high', 'medium', 'small'] as const

/** Annotation kinds stripAnnots removes when the window sends none (links stay) */
export const DEFAULT_ANNOT_KINDS: PdfToolAnnotKind[] = PDF_TOOL_ANNOT_KINDS.filter(
  (kind) => kind !== 'links',
)

const intIn = (value: unknown, lo: number, hi: number): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= lo && value <= hi
    ? value
    : undefined

/**
 * Only the options `tool` reads, each checked against the first input's
 * `pageCount`; anything missing or out of range takes the dialog's default,
 * except a page range, which must name pages that exist.
 */
export function checkOptions(
  tool: PdfToolId,
  raw: unknown,
  pageCount: number,
  backgroundPages = 1,
): CheckedOptions {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  switch (tool) {
    case 'split': {
      if (o.splitMode === undefined) {
        return { ok: true, options: { chunkSize: intIn(o.chunkSize, 1, pageCount) ?? 1 } }
      }
      const mode =
        o.splitMode === 'ranges' ||
        o.splitMode === 'fixed' ||
        o.splitMode === 'bookmarks' ||
        o.splitMode === 'maxSize'
          ? o.splitMode
          : 'fixed'
      const splitPattern =
        o.splitPattern === 'range' || o.splitPattern === 'bookmark' ? o.splitPattern : 'numbered'
      const splitPrefix = typeof o.splitPrefix === 'string' ? o.splitPrefix.trim() : ''
      const splitCreateSubfolder = o.splitCreateSubfolder === true
      const base: PdfToolOptions = {
        splitMode: mode,
        splitPattern,
        splitCreateSubfolder,
        ...(splitPrefix ? { splitPrefix } : {}),
      }
      if (mode === 'ranges') {
        const parsed = parseSplitRangeList(
          typeof o.splitRanges === 'string' ? o.splitRanges : '',
          pageCount,
        )
        if (!parsed.ok) return { ok: false, error: 'range' }
        return {
          ok: true,
          options: {
            ...base,
            splitRanges: formatSplitRangeList(parsed.ranges),
            splitMergeRanges: o.splitMergeRanges === true,
          },
        }
      }
      if (mode === 'fixed') {
        const splitFixedKind = o.splitFixedKind === 'fileCount' ? 'fileCount' : 'pagesPerFile'
        const rawVal = o.splitFixedValue ?? o.chunkSize
        return {
          ok: true,
          options: {
            ...base,
            splitFixedKind,
            splitFixedValue: intIn(rawVal, 1, pageCount) ?? 1,
          },
        }
      }
      if (mode === 'bookmarks') {
        return {
          ok: true,
          options: {
            ...base,
            splitBookmarkLevel: o.splitBookmarkLevel === 2 ? 2 : 1,
            splitIncludeLeading: o.splitIncludeLeading !== false,
          },
        }
      }
      const maxBytes =
        typeof o.splitMaxBytes === 'number' && Number.isFinite(o.splitMaxBytes)
          ? Math.round(o.splitMaxBytes)
          : 0
      if (maxBytes < MIN_SPLIT_MAX_BYTES || maxBytes > MAX_SPLIT_MAX_BYTES) {
        return { ok: false, error: 'invalid-size' }
      }
      return {
        ok: true,
        options: {
          ...base,
          splitMaxBytes: maxBytes,
        },
      }
    }
    case 'extract': {
      const range = parsePageRange(typeof o.pages === 'string' ? o.pages : '', pageCount)
      return range.ok
        ? { ok: true, options: { pages: range.pages.join(',') } }
        : { ok: false, error: 'range' }
    }
    case 'nup':
      return {
        ok: true,
        options: {
          perSheet: intIn(o.perSheet, 2, 16) ?? 2,
          direction: o.direction === 'vertical' ? 'vertical' : 'horizontal',
          separator: o.separator === true,
        },
      }
    case 'rotate':
      return {
        ok: true,
        options: { rotation: o.rotation === 180 || o.rotation === 270 ? o.rotation : 90 },
      }
    case 'pageSize':
      return {
        ok: true,
        options: {
          paper: (PDF_TOOL_PAPERS as readonly unknown[]).includes(o.paper)
            ? (o.paper as PdfToolPaper)
            : 'A4',
        },
      }
    case 'splitPages':
      return { ok: true, options: { perPage: o.perPage === 4 || o.perPage === 9 ? o.perPage : 2 } }
    case 'encrypt': {
      // passwords are taken as typed: no trimming
      const password = typeof o.password === 'string' ? o.password : ''
      const restrict = o.restrict === true
      const permission = typeof o.permissionPassword === 'string' ? o.permissionPassword : ''
      if (!password || (restrict && !permission)) return { ok: false, error: 'password-empty' }
      const tooLong = (text: string) => new TextEncoder().encode(text).length > MAX_PASSWORD_BYTES
      if (tooLong(password) || tooLong(permission)) return { ok: false, error: 'password-long' }
      if (restrict && permission === password) return { ok: false, error: 'password-same' }
      return {
        ok: true,
        options: restrict ? { password, restrict, permissionPassword: permission } : { password },
      }
    }
    case 'decrypt': {
      const password = typeof o.password === 'string' ? o.password : ''
      if (!password) return { ok: false, error: 'password-empty' }
      return { ok: true, options: { password } }
    }
    case 'compress': {
      const legacyLevel = (COMPRESS_LEVELS as readonly unknown[]).includes(o.compressLevel)
        ? (o.compressLevel as 'light' | 'medium' | 'strong')
        : 'medium'
      const hasV2 =
        o.compressMode !== undefined ||
        o.targetSizeMb !== undefined ||
        o.grayscaleImages !== undefined ||
        o.linearize !== undefined ||
        o.stripMetadata !== undefined
      if (!hasV2) {
        return { ok: true, options: { compressLevel: legacyLevel } }
      }
      const mode: CompressMode = (COMPRESS_MODES as readonly unknown[]).includes(o.compressMode)
        ? (o.compressMode as CompressMode)
        : legacyLevel
      let targetSizeMb: number | undefined
      if (mode === 'target') {
        const rawMb = typeof o.targetSizeMb === 'number' ? o.targetSizeMb : Number(o.targetSizeMb)
        if (!Number.isFinite(rawMb) || rawMb <= 0 || rawMb > 10_000) {
          return { ok: false, error: 'invalid-target-size' }
        }
        targetSizeMb = rawMb
      }
      const out: PdfToolOptions = {
        compressLevel: mode === 'light' || mode === 'strong' ? mode : 'medium',
        compressMode: mode,
        ...(targetSizeMb !== undefined ? { targetSizeMb } : {}),
        grayscaleImages: mode === 'lossless' ? false : o.grayscaleImages === true,
        linearize: o.linearize === true,
        stripMetadata: o.stripMetadata === true,
      }
      return { ok: true, options: out }
    }
    case 'blankPages': {
      const raw = typeof o.removePages === 'string' ? o.removePages : ''
      const pages = [...new Set(raw.split(',').map((p) => Number(p.trim())))]
        .filter((p) => Number.isInteger(p) && p >= 1 && p <= pageCount)
        .sort((a, b) => a - b)
      if (pages.length === 0) return { ok: false, error: 'none-chosen' }
      if (pages.length >= pageCount) return { ok: false, error: 'all-pages' }
      return { ok: true, options: { removePages: pages.join(',') } }
    }
    case 'stripAnnots': {
      const text = typeof o.applyPages === 'string' ? o.applyPages.trim() : ''
      const range = text ? parsePageRange(text, pageCount) : null
      if (range && !range.ok) return { ok: false, error: 'range' }
      const kinds = Array.isArray(o.annotKinds)
        ? PDF_TOOL_ANNOT_KINDS.filter((kind) => (o.annotKinds as unknown[]).includes(kind))
        : DEFAULT_ANNOT_KINDS
      if (kinds.length === 0) return { ok: false, error: 'no-kinds' }
      return {
        ok: true,
        options: { annotKinds: kinds, applyPages: range?.ok ? range.pages.join(',') : '' },
      }
    }
    case 'overlay': {
      const text = typeof o.applyPages === 'string' ? o.applyPages.trim() : ''
      const range = text ? parsePageRange(text, pageCount) : null
      if (range && !range.ok) return { ok: false, error: 'range' }
      return {
        ok: true,
        options: {
          layer: o.layer === 'front' ? 'front' : 'behind',
          backgroundPage: intIn(o.backgroundPage, 1, backgroundPages) ?? 1,
          applyPages: range?.ok ? range.pages.join(',') : '',
        },
      }
    }
    case 'duplex':
      return {
        ok: true,
        options: {
          sheetPages: (PDF_TOOL_SHEET_PAGES as readonly unknown[]).includes(o.sheetPages)
            ? (o.sheetPages as number)
            : 1,
        },
      }
    case 'imagesToPdf': {
      const base: PdfToolOptions = {
        imagePaper:
          o.imagePaper === 'image' || (PDF_TOOL_PAPERS as readonly unknown[]).includes(o.imagePaper)
            ? (o.imagePaper as PdfToolPaper | 'image')
            : 'A4',
        margin: (PDF_TOOL_MARGINS as readonly unknown[]).includes(o.margin)
          ? (o.margin as PdfToolMargin)
          : 'small',
      }
      if (o.imageOrientation !== undefined) {
        base.imageOrientation = (IMAGE_ORIENTATIONS as readonly unknown[]).includes(
          o.imageOrientation,
        )
          ? (o.imageOrientation as PdfImageOrientation)
          : 'auto'
      }
      if (o.imageOptimize !== undefined) {
        base.imageOptimize = (IMAGE_OPTIMIZES as readonly unknown[]).includes(o.imageOptimize)
          ? (o.imageOptimize as PdfImageOptimize)
          : 'original'
      }
      if (
        o.itemRotations &&
        typeof o.itemRotations === 'object' &&
        !Array.isArray(o.itemRotations)
      ) {
        const clean: Record<string, 0 | 90 | 180 | 270> = {}
        for (const [k, v] of Object.entries(o.itemRotations as Record<string, unknown>)) {
          if (v === 0 || v === 90 || v === 180 || v === 270) clean[k] = v
        }
        base.itemRotations = clean
      }
      return { ok: true, options: base }
    }
    case 'merge': {
      const out: PdfToolOptions = {}
      if (o.addBookmarks !== undefined) out.addBookmarks = o.addBookmarks !== false
      if (o.unifyPaper !== undefined) {
        out.unifyPaper =
          o.unifyPaper === 'keep' || (PDF_TOOL_PAPERS as readonly unknown[]).includes(o.unifyPaper)
            ? (o.unifyPaper as 'keep' | PdfToolPaper)
            : 'keep'
      }
      if (o.mergeRanges && typeof o.mergeRanges === 'object' && !Array.isArray(o.mergeRanges)) {
        const clean: Record<string, string> = {}
        for (const [k, v] of Object.entries(o.mergeRanges as Record<string, unknown>)) {
          if (typeof v === 'string' && v.trim()) clean[k] = v.trim()
        }
        out.mergeRanges = clean
      }
      return { ok: true, options: out }
    }
    case 'interleave':
      return { ok: true, options: { reverseEven: o.reverseEven !== false } }
    case 'ocr': {
      const text = typeof o.applyPages === 'string' ? o.applyPages.trim() : ''
      const range = text ? parsePageRange(text, pageCount) : null
      if (range && !range.ok) return { ok: false, error: 'range' }
      return {
        ok: true,
        options: {
          applyPages: range?.ok ? range.pages.join(',') : '',
          reocrExisting: o.reocrExisting === true,
        },
      }
    }
    case 'pdfToImages': {
      const text = typeof o.applyPages === 'string' ? o.applyPages.trim() : ''
      const range = text ? parsePageRange(text, pageCount) : null
      if (range && !range.ok) return { ok: false, error: 'range' }
      return {
        ok: true,
        options: {
          pdfToImagesMode: o.pdfToImagesMode === 'embedded' ? 'embedded' : 'pages',
          imageFormat: o.imageFormat === 'png' ? 'png' : 'jpg',
          imageDpi: (IMAGE_DPIS as readonly unknown[]).includes(o.imageDpi)
            ? (o.imageDpi as 150 | 200 | 300)
            : 200,
          imageQuality: (IMAGE_QUALITIES as readonly unknown[]).includes(o.imageQuality)
            ? (o.imageQuality as 'high' | 'medium' | 'small')
            : 'medium',
          imageOutMode: o.imageOutMode === 'folder' ? 'folder' : 'zip',
          applyPages: range?.ok ? range.pages.join(',') : '',
        },
      }
    }
    case 'convertFromPdf': {
      const text = typeof o.applyPages === 'string' ? o.applyPages.trim() : ''
      const range = text ? parsePageRange(text, pageCount) : null
      if (range && !range.ok) return { ok: false, error: 'range' }
      const targetFormat: PdfConvertFormat = (CONVERT_FORMATS as readonly unknown[]).includes(
        o.targetFormat,
      )
        ? (o.targetFormat as PdfConvertFormat)
        : 'docx'
      return {
        ok: true,
        options: {
          targetFormat,
          applyPages: range?.ok ? range.pages.join(',') : '',
          ...(typeof o.epubTitle === 'string'
            ? { epubTitle: o.epubTitle.trim().slice(0, 200) }
            : {}),
          ...(typeof o.epubAuthor === 'string'
            ? { epubAuthor: o.epubAuthor.trim().slice(0, 200) }
            : {}),
          epubCover: o.epubCover !== false,
          epubPageBreaks: o.epubPageBreaks === true,
        },
      }
    }
    case 'docsToPdf':
      return {
        ok: true,
        options: {
          docsOutputMode: o.docsOutputMode === 'merge' ? 'merge' : 'each',
          addBookmarks: o.addBookmarks !== false,
        },
      }
    case 'organize':
      return { ok: true, options: {} }
    default:
      return { ok: true, options: {} }
  }
}

/** What a long or multi-source tool needs from the window */
export interface RunDeps {
  recode?: ImageRecoder
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
  /** merge v2: display filenames aligned with `inputs` */
  sourceNames?: string[]
  /** merge v2 / imagesToPdf: inputIds aligned with `inputs` */
  inputIds?: string[]
  /** organize: map of sourceId -> PDF bytes and the ordered page plan */
  sourceMap?: ReadonlyMap<string, Uint8Array>
  organizePlan?: readonly OrganizePageSpec[]
}

/** Build a SplitPlanRequest from checked PdfToolOptions */
export function splitPlanFromOptions(options: PdfToolOptions, pageCount: number): SplitPlanRequest {
  if (!options.splitMode) {
    return { mode: 'fixed', kind: 'pagesPerFile', value: options.chunkSize ?? 1 }
  }
  switch (options.splitMode) {
    case 'ranges': {
      const parsed = parseSplitRangeList(options.splitRanges ?? '', pageCount)
      return {
        mode: 'ranges',
        ranges: parsed.ok ? parsed.ranges : [],
        mergeRanges: options.splitMergeRanges === true,
      }
    }
    case 'fixed':
      return {
        mode: 'fixed',
        kind: options.splitFixedKind === 'fileCount' ? 'fileCount' : 'pagesPerFile',
        value: options.splitFixedValue ?? options.chunkSize ?? 1,
      }
    case 'bookmarks':
      return {
        mode: 'bookmarks',
        level: options.splitBookmarkLevel === 2 ? 2 : 1,
        includeLeadingPages: options.splitIncludeLeading !== false,
      }
    case 'maxSize':
      return { mode: 'maxSize', maxBytes: options.splitMaxBytes ?? 0 }
  }
}

/** Run the split tool and return output bytes paired with computed filenames and warnings */
export async function runSplitPdfTool(
  first: Uint8Array,
  sourceName: string,
  options: PdfToolOptions,
  deps: RunDeps = {},
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

/** Run `tool` on `inputs` (already checked); one file, or one per part for split */
export async function runPdfTool(
  tool: PdfToolId,
  inputs: Uint8Array[],
  options: PdfToolOptions,
  deps: RunDeps = {},
): Promise<Uint8Array[]> {
  if (tool === 'organize') {
    if (!deps.sourceMap || !deps.organizePlan || deps.organizePlan.length === 0) {
      throw new Error('empty-organize')
    }
    return [await organizePdfBytes(deps.sourceMap, deps.organizePlan)]
  }
  const [first, ...rest] = inputs
  if (!first) throw new Error('no input')
  switch (tool) {
    case 'merge': {
      const wantsV2 =
        options.addBookmarks !== undefined ||
        (options.unifyPaper !== undefined && options.unifyPaper !== 'keep') ||
        (options.mergeRanges !== undefined && Object.keys(options.mergeRanges).length > 0)
      if (!wantsV2) {
        return [(await mergePdfBytes(first, rest)).merged]
      }
      const mergeInputs = await Promise.all(
        inputs.map(async (bytes, idx) => {
          const id = deps.inputIds?.[idx]
          const rangeText = id ? options.mergeRanges?.[id]?.trim() : ''
          let pages: number[] | undefined
          if (rangeText) {
            const count = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount()
            const parsed = parsePageRange(rangeText, count)
            if (!parsed.ok) throw new Error('range')
            pages = parsed.pages.map((p) => p - 1)
          }
          return {
            bytes,
            name: deps.sourceNames?.[idx] ?? `document-${idx + 1}.pdf`,
            ...(pages ? { pages } : {}),
          }
        }),
      )
      const paper =
        options.unifyPaper && options.unifyPaper !== 'keep'
          ? PAPER_POINTS[options.unifyPaper]
          : null
      const merged = await mergePdfV2Bytes(mergeInputs, {
        addBookmarks: options.addBookmarks !== false,
        unifyPaper: paper,
      })
      return [merged.bytes]
    }
    case 'interleave': {
      const even = inputs[1]
      if (!even) throw new Error('need even')
      return [
        (await interleavePdfBytes(first, even, { reverseEven: options.reverseEven !== false }))
          .bytes,
      ]
    }
    case 'split':
      return (await runSplitPdfTool(first, 'document.pdf', options, deps)).parts
    case 'extract': {
      const pages = (options.pages ?? '').split(',').map((p) => Number(p) - 1)
      return [await extractPagesBytes(first, pages)]
    }
    case 'reverse': {
      const count = (await PDFDocument.load(first, { updateMetadata: false })).getPageCount()
      return [
        await extractPagesBytes(
          first,
          Array.from({ length: count }, (_, i) => count - 1 - i),
        ),
      ]
    }
    case 'nup':
      return [
        await mergePagesBytes(first, {
          perSheet: options.perSheet ?? 2,
          direction: options.direction ?? 'horizontal',
          separator: options.separator ?? false,
        }),
      ]
    case 'rotate': {
      const count = (await PDFDocument.load(first, { updateMetadata: false })).getPageCount()
      const delta = options.rotation ?? 90
      const applied = await applySaveRequest(first, {
        path: '',
        markups: [],
        drawings: [],
        formValues: [],
        stamps: [],
        rotations: Array.from({ length: count }, (_, pageIndex) => ({ pageIndex, delta })),
      })
      return [applied.bytes]
    }
    case 'pageSize': {
      const paper = PAPER_POINTS[options.paper ?? 'A4']
      return [await setPageSizeBytes(first, paper.w, paper.h)]
    }
    case 'splitPages':
      return [await splitPagesBytes(first, options.perPage ?? 2)]
    case 'imagesToPdf': {
      const paper = options.imagePaper ?? 'A4'
      const rotations =
        options.itemRotations && deps.inputIds
          ? deps.inputIds.map((id) => options.itemRotations?.[id] ?? 0)
          : undefined
      return [
        await imagesToPdfBytes(inputs, {
          paper: paper === 'image' ? null : PAPER_POINTS[paper],
          marginPt: MARGIN_POINTS[options.margin ?? 'small'],
          ...(options.imageOrientation ? { orientation: options.imageOrientation } : {}),
          ...(rotations ? { rotations } : {}),
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
        await overlayPdfBytes(first!, background, {
          behind: options.layer !== 'front',
          backgroundPage: (options.backgroundPage ?? 1) - 1,
          pages,
        }),
      ]
    }
    case 'encrypt':
    case 'decrypt':
    case 'repair':
    case 'ocr':
    case 'pdfToImages':
    case 'convertFromPdf':
    case 'docsToPdf':
      // the window runs these in the PDF job process or headless runner
      throw new Error(`${tool} runs as a job`)
    case 'compress': {
      const mode: CompressMode = options.compressMode ?? options.compressLevel ?? 'medium'
      if (mode !== 'lossless' && !deps.recode) throw new Error('no picture code')
      const useV2 =
        options.compressMode !== undefined ||
        options.grayscaleImages === true ||
        options.stripMetadata === true ||
        options.targetSizeMb !== undefined
      if (!useV2) {
        const made = await compressPdfBytes(
          first!,
          options.compressLevel ?? 'medium',
          deps.recode!,
          {
            ...(deps.onProgress ? { onProgress: deps.onProgress } : {}),
            ...(deps.signal ? { signal: deps.signal } : {}),
          },
        )
        // a file that did not get smaller is not worth a copy
        if (made.bytes.length >= first!.length) throw new PdfToolRefusal('not-smaller')
        return [made.bytes]
      }
      const made = await compressPdfV2Bytes(
        first!,
        {
          mode,
          ...(options.targetSizeMb !== undefined
            ? { targetBytes: Math.round(options.targetSizeMb * 1024 * 1024) }
            : {}),
          grayscaleImages: options.grayscaleImages === true,
          stripMetadata: options.stripMetadata === true,
        },
        deps.recode ?? (async () => null),
        {
          ...(deps.onProgress ? { onProgress: deps.onProgress } : {}),
          ...(deps.signal ? { signal: deps.signal } : {}),
        },
      )
      if (made.bytes.length >= first!.length) throw new PdfToolRefusal('not-smaller')
      return [made.bytes]
    }
    case 'blankPages': {
      // the editor's own page removal on save, which keeps bookmarks and forms
      const deletedPages = (options.removePages ?? '').split(',').map((p) => Number(p) - 1)
      const applied = await applySaveRequest(first!, {
        path: '',
        markups: [],
        drawings: [],
        formValues: [],
        stamps: [],
        deletedPages,
      })
      return [applied.bytes]
    }
    case 'stripAnnots': {
      const pages = options.applyPages
        ? options.applyPages.split(',').map((p) => Number(p) - 1)
        : null
      const stripped = await stripAnnotsBytes(first!, {
        kinds: options.annotKinds ?? DEFAULT_ANNOT_KINDS,
        pages,
      })
      if (stripped.removed === 0) throw new PdfToolRefusal('no-annots')
      return [stripped.bytes]
    }
    case 'toText': {
      const doc = await readPdfText(first!)
      if (!doc.pages.some((page) => page.text.trim() !== '')) throw new PdfToolRefusal('no-text')
      return [new TextEncoder().encode(pagesToText(doc.pages))]
    }
  }
}

/** The pages' text in order, a blank line between pages; a page without text adds nothing */
export function pagesToText(pages: Pick<PdfPageText, 'text'>[]): string {
  const texts = pages.map((page) => page.text.trimEnd()).filter((text) => text.trim() !== '')
  return `${texts.join('\n\n')}\n`
}

/** File names the save dialog suggests, from the first input's name */
export function outputNames(
  tool: PdfToolId,
  sourceName: string,
  count: number,
  options: PdfToolOptions,
): string[] {
  if (tool === 'imagesToPdf') {
    const imgBase = sourceName.replace(/\.(jpe?g|png|webp|bmp|gif)$/i, '') || 'document'
    return [`${imgBase}.pdf`]
  }
  if (tool === 'docsToPdf') {
    const docBase = sourceName.replace(/\.(drawio\.(svg|png)|[a-z0-9]{1,10})$/i, '') || 'document'
    return options.docsOutputMode === 'merge' ? [`${docBase}-merged.pdf`] : [`${docBase}.pdf`]
  }
  if (tool === 'merge') {
    const mixBase = sourceName.replace(/\.(drawio\.(svg|png)|[a-z0-9]{1,10})$/i, '') || 'document'
    return [`${mixBase}-merged.pdf`]
  }
  const base = sourceName.replace(/\.(pdf|jpe?g|png)$/i, '') || 'document'
  if (tool === 'split') {
    const stem = options.splitPrefix ? sanitizeSplitName(options.splitPrefix, base, 60) : base
    const padWidth = count >= 10 ? String(count).length : 1
    return Array.from(
      { length: count },
      (_, i) => `${stem}-${String(i + 1).padStart(padWidth, '0')}.pdf`,
    )
  }
  if (tool === 'pdfToImages') {
    return options.imageOutMode === 'folder' ? [base] : [`${base}-images.zip`]
  }
  if (tool === 'convertFromPdf') {
    const ext = options.targetFormat ?? 'docx'
    return [`${base}.${ext}`]
  }
  if (tool === 'toText') return [`${base}.txt`]
  const suffix: Record<
    Exclude<
      PdfToolId,
      'split' | 'imagesToPdf' | 'docsToPdf' | 'pdfToImages' | 'convertFromPdf' | 'toText'
    >,
    string
  > = {
    organize: 'organized',
    merge: 'merged',
    interleave: 'interleaved',
    duplex: 'duplex',
    overlay: 'background',
    stripAnnots: 'clean',
    blankPages: 'no-blank',
    ocr: 'ocr',
    compress: 'smaller',
    encrypt: 'locked',
    decrypt: 'unlocked',
    repair: 'repaired',
    extract: 'pages',
    reverse: 'reversed',
    nup: `${options.perSheet ?? 2}up`,
    rotate: 'rotated',
    pageSize: options.paper ?? 'A4',
    splitPages: 'split',
  }
  return [`${base}-${suffix[tool]}.pdf`]
}

export interface FoundBlankPages {
  pageCount: number
  candidates: {
    page: number
    reason: 'empty' | 'nearly-white'
    thumb: { width: number; height: number; bgra: Uint8Array } | null
  }[]
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
  tool: 'encrypt' | 'decrypt' | 'repair' | 'ocr',
  path: string,
  options: PdfToolOptions,
  password?: string,
): StructureJob {
  const pages =
    tool === 'ocr' && options.applyPages
      ? options.applyPages
          .split(',')
          .map((p) => Number(p))
          .filter((p) => Number.isInteger(p) && p >= 1)
      : undefined
  const source = {
    pdfPath: path,
    ...(password !== undefined ? { password } : {}),
    ...(pages && pages.length > 0 ? { pages } : {}),
  }
  if (tool === 'repair') return { op: 'repair', source }
  if (tool === 'decrypt') return { op: 'decrypt', source, password: options.password ?? '' }
  if (tool === 'ocr') {
    return { op: 'ocrPdf', source, reocrExisting: options.reocrExisting === true }
  }
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
