/**
 * The PDF tools' domain: tool ids, choices and options. Pure values and types
 * with no pdf-lib, so screens and preload code can import them cheaply.
 */
/** Tools the window runs itself, each making a new file from the picked PDFs */
export const PDF_TOOL_IDS = [
  'merge',
  'split',
  'extract',
  'reverse',
  'nup',
  'rotate',
  'pageSize',
  'splitPages',
  'imagesToPdf',
  'toText',
  'duplex',
  'overlay',
  'stripAnnots',
  'blankPages',
  'compress',
  'encrypt',
  'decrypt',
  'repair',
] as const
export type PdfToolId = (typeof PDF_TOOL_IDS)[number]

/** Paper sizes "page size" offers (points, portrait), the PDF editor's list */
export const PDF_TOOL_PAPERS = ['A3', 'A4', 'A5', 'Letter', 'Legal'] as const
export type PdfToolPaper = (typeof PDF_TOOL_PAPERS)[number]

/** Which PDFs a tool takes: readable ones, only password-protected ones (decrypt), or damaged ones too (repair) */
export type PdfToolAccept = 'pdf' | 'encrypted' | 'damaged'

/** What a tool takes: PDFs, or JPEG and PNG pictures (imagesToPdf) */
export type PdfToolInputKind = 'pdf' | 'image'

/** Pages a sheet will later hold N-up (duplex): 1 for no N-up */
export const PDF_TOOL_SHEET_PAGES = [1, 2, 4, 6, 8, 9, 16] as const

/** Kinds of annotation stripAnnots can remove (annot-strip.ts) */
export const PDF_TOOL_ANNOT_KINDS = [
  'comments',
  'highlights',
  'drawings',
  'stamps',
  'links',
  'other',
] as const
export type PdfToolAnnotKind = (typeof PDF_TOOL_ANNOT_KINDS)[number]

/** Space around a picture on its page (imagesToPdf) */
export const PDF_TOOL_MARGINS = ['none', 'small', 'large'] as const
export type PdfToolMargin = (typeof PDF_TOOL_MARGINS)[number]

export interface PdfToolOptions {
  /** split: legacy pages per output file */
  chunkSize?: number
  /** split: mode selector ('ranges' | 'fixed' | 'bookmarks' | 'maxSize') */
  splitMode?: 'ranges' | 'fixed' | 'bookmarks' | 'maxSize'
  /** split (ranges): comma-separated ranges like "1-3, 4-8" */
  splitRanges?: string
  /** split (ranges): merge all listed ranges into a single PDF */
  splitMergeRanges?: boolean
  /** split (fixed): pages per file or equal file count */
  splitFixedKind?: 'pagesPerFile' | 'fileCount'
  /** split (fixed): value for pagesPerFile or fileCount */
  splitFixedValue?: number
  /** split (bookmarks): nesting depth (1 or 2) */
  splitBookmarkLevel?: 1 | 2
  /** split (bookmarks): include pages before the first bookmark */
  splitIncludeLeading?: boolean
  /** split (maxSize): maximum byte size per output file */
  splitMaxBytes?: number
  /** split: custom output filename prefix */
  splitPrefix?: string
  /** split: output filename naming pattern */
  splitPattern?: 'numbered' | 'range' | 'bookmark'
  /** split: group multiple output files inside a new subfolder */
  splitCreateSubfolder?: boolean
  /** extract: "1-3,5" style, 1-based */
  pages?: string
  /** nup: pages per sheet (2-16), fill order and hairlines between cells */
  perSheet?: number
  direction?: 'horizontal' | 'vertical'
  separator?: boolean
  /** rotate: clockwise degrees added to every page */
  rotation?: 90 | 180 | 270
  /** pageSize: target paper */
  paper?: PdfToolPaper
  /** splitPages: pieces each page is cut into */
  perPage?: 2 | 4 | 9
  /** imagesToPdf: a paper, or 'image' for pages the size of each picture */
  imagePaper?: PdfToolPaper | 'image'
  /** imagesToPdf: space kept around each picture on a paper page */
  margin?: PdfToolMargin
  /** duplex: pages each sheet side will hold when printed N-up afterwards */
  sheetPages?: number
  /** overlay: under the page's content or over it */
  layer?: 'behind' | 'front'
  /** overlay: 1-based page of the background PDF */
  backgroundPage?: number
  /** overlay, stripAnnots: "1-3,5" style pages to work on, '' for every page */
  applyPages?: string
  /** stripAnnots: the kinds to remove */
  annotKinds?: PdfToolAnnotKind[]
  /** blankPages: "3,7" style 1-based pages to remove, all among the pages found */
  removePages?: string
  /** compress: how hard to shrink the pictures */
  compressLevel?: 'light' | 'medium' | 'strong'
  /** encrypt: the password asked for on opening; decrypt: the one that opens it now */
  password?: string
  /** encrypt, in the window only (never sent): the password typed again */
  passwordConfirm?: string
  /** encrypt: refuse printing, copying and changes without `permissionPassword` */
  restrict?: boolean
  permissionPassword?: string
}

export type PdfInputProblem =
  'encrypted' | 'unreadable' | 'too-large' | 'not-image' | 'not-encrypted'

export const COMPRESS_LEVELS = ['light', 'medium', 'strong'] as const
export type CompressLevel = (typeof COMPRESS_LEVELS)[number]

/** Longest side in pixels and JPEG quality each level asks for */
export const LEVEL_TARGETS: Record<CompressLevel, { longSide: number; quality: number }> = {
  light: { longSide: 3000, quality: 85 },
  medium: { longSide: 2000, quality: 75 },
  strong: { longSide: 1400, quality: 60 },
}
