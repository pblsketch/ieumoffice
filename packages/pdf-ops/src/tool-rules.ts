/**
 * The PDF tools' rules with no pdf-lib: what each tool takes, which options it
 * reads (checkOptions), the split plan from those options, and the names of what
 * it writes. Screens import these without pulling the PDF engine in; tools.ts
 * runs the tools.
 */
import {
  PDF_TOOL_IDS,
  type PdfToolId,
  PDF_TOOL_PAPERS,
  type PdfToolPaper,
  type PdfToolAccept,
  type PdfToolInputKind,
  PDF_TOOL_SHEET_PAGES,
  PDF_TOOL_ANNOT_KINDS,
  type PdfToolAnnotKind,
  PDF_TOOL_MARGINS,
  type PdfToolMargin,
  type PdfToolOptions,
  type PdfInputProblem,
  COMPRESS_LEVELS,
} from './tool-ids'
import {
  type SplitPlanRequest,
  MIN_SPLIT_MAX_BYTES,
  MAX_SPLIT_MAX_BYTES,
  parseSplitRangeList,
  formatSplitRangeList,
  sanitizeSplitName,
} from './split-plan'
import { parsePageRange } from './page-range'
// ---------------------------------------------------------------------------
// Rules

/** The editor's "page size" list (apps/pdf/src/renderer/view-config.ts PAPER_SIZES) */
export const PAPER_POINTS: Readonly<Record<PdfToolPaper, { w: number; h: number }>> = Object.freeze(
  {
    A3: { w: 842, h: 1191 },
    A4: { w: 595, h: 842 },
    A5: { w: 420, h: 595 },
    Letter: { w: 612, h: 792 },
    Legal: { w: 612, h: 1008 },
  },
)

export function isPdfToolId(value: unknown): value is PdfToolId {
  return typeof value === 'string' && (PDF_TOOL_IDS as readonly string[]).includes(value)
}

/** Points of space around a picture for each margin choice (imagesToPdf) */
export const MARGIN_POINTS: Readonly<Record<PdfToolMargin, number>> = Object.freeze({
  none: 0,
  small: 18,
  large: 36,
})

/** Merge, imagesToPdf and duplex take several files; every other tool takes one */
export function toolTakesMany(tool: PdfToolId): boolean {
  return tool === 'merge' || tool === 'imagesToPdf' || tool === 'duplex'
}

/** The fewest files a tool runs on: merge needs two */
export function toolMinInputs(tool: PdfToolId): number {
  return tool === 'merge' ? 2 : 1
}

/** Which PDFs a tool takes */
export function toolAccepts(tool: PdfToolId): PdfToolAccept {
  return tool === 'decrypt' ? 'encrypted' : tool === 'repair' ? 'damaged' : 'pdf'
}

/** the longest password AES-256 PDF encryption keeps (127 bytes of UTF-8) */
export const MAX_PASSWORD_BYTES = 127

/** imagesToPdf takes pictures; every other tool takes PDFs */
export function toolInputKind(tool: PdfToolId): PdfToolInputKind {
  return tool === 'imagesToPdf' ? 'image' : 'pdf'
}

/** The kind of file a tool writes */
export function toolOutputExtension(tool: PdfToolId): 'pdf' | 'txt' {
  return tool === 'toText' ? 'txt' : 'pdf'
}

/**
 * A tool ran but has nothing to write: a PDF without any text layer (toText),
 * or none of the chosen kinds of annotation (stripAnnots)
 */
export class PdfToolRefusal extends Error {
  constructor(readonly reason: 'no-text' | 'no-annots' | 'not-smaller' | 'no-bookmarks') {
    super(reason)
  }
}

export type InspectResult = { ok: true; pages: number } | { ok: false; problem: PdfInputProblem }

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
        | 'invalid-size'
    }

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
    case 'compress':
      return {
        ok: true,
        options: {
          compressLevel: (COMPRESS_LEVELS as readonly unknown[]).includes(o.compressLevel)
            ? (o.compressLevel as 'light' | 'medium' | 'strong')
            : 'medium',
        },
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
    case 'imagesToPdf':
      return {
        ok: true,
        options: {
          imagePaper:
            o.imagePaper === 'image' ||
            (PDF_TOOL_PAPERS as readonly unknown[]).includes(o.imagePaper)
              ? (o.imagePaper as PdfToolPaper | 'image')
              : 'A4',
          margin: (PDF_TOOL_MARGINS as readonly unknown[]).includes(o.margin)
            ? (o.margin as PdfToolMargin)
            : 'small',
        },
      }
    default:
      return { ok: true, options: {} }
  }
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

/** The pages' text in order, a blank line between pages; a page without text adds nothing */
export function pagesToText(pages: { text: string }[]): string {
  const texts = pages.map((page) => page.text.trimEnd()).filter((text) => text.trim() !== '')
  return `${texts.join('\n\n')}\n`
}

/**
 * Endings taken off the first input's name: the PC's PDF, JPEG and PNG, and
 * the picture kinds a phone hands over (the PC never takes those, so its
 * names stay as they were)
 */
const SOURCE_ENDING = /\.(pdf|jpe?g|png|heic|heif|webp|gif|bmp|avif|tiff?)$/i

/** File names the save dialog suggests, from the first input's name */
export function outputNames(
  tool: PdfToolId,
  sourceName: string,
  count: number,
  options: PdfToolOptions,
): string[] {
  const base = sourceName.replace(SOURCE_ENDING, '') || 'document'
  if (tool === 'split') {
    const stem = options.splitPrefix ? sanitizeSplitName(options.splitPrefix, base, 60) : base
    const padWidth = count >= 10 ? String(count).length : 1
    return Array.from(
      { length: count },
      (_, i) => `${stem}-${String(i + 1).padStart(padWidth, '0')}.pdf`,
    )
  }
  if (tool === 'imagesToPdf') return [`${base}.pdf`]
  if (tool === 'toText') return [`${base}.txt`]
  const suffix: Record<Exclude<PdfToolId, 'split' | 'imagesToPdf' | 'toText'>, string> = {
    merge: 'merged',
    duplex: 'duplex',
    overlay: 'background',
    stripAnnots: 'clean',
    blankPages: 'no-blank',
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
