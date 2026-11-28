import type { Lang } from '@genoffice/i18n'

/**
 * The PDF tools window: pick a task first, then the files it needs, then get
 * a new file. Every tool runs on the user's PC without AI and never writes
 * over its source. Plan: docs/plans/pdf-tools.md, decision 0030.
 *
 * Kept apart from pdf-tools-home-channels.ts: the shell preload and this
 * window's preload are separate bundle entries, and a module both import by
 * value would become a shared chunk a sandboxed preload cannot load.
 */
export const PDF_TOOLS_CHANNELS = {
  getInit: 'pdf-tools:get-init',
  pickInputs: 'pdf-tools:pick-inputs',
  dropInputs: 'pdf-tools:drop-inputs',
  releaseInputs: 'pdf-tools:release-inputs',
  unlockInput: 'pdf-tools:unlock-input',
  promoteResult: 'pdf-tools:promote-result',
  promoteInput: 'pdf-tools:promote-input',
  auditSpace: 'pdf-tools:audit-space',
  ocrAvailable: 'pdf-tools:ocr-available',
  renderThumbs: 'pdf-tools:render-thumbs',
  cancelThumbs: 'pdf-tools:cancel-thumbs',
  mixStatus: 'pdf-tools:mix-status',
  confirmSavePartial: 'pdf-tools:confirm-save-partial',
  openInEditorWithInput: 'pdf-tools:open-in-editor-with-input',
  run: 'pdf-tools:run',
  openResult: 'pdf-tools:open-result',
  revealResult: 'pdf-tools:reveal-result',
  openInEditor: 'pdf-tools:open-in-editor',
  openSplitInEditor: 'pdf-tools:open-split-in-editor',
  readBookmarks: 'pdf-tools:read-bookmarks',
  findBlankPages: 'pdf-tools:find-blank-pages',
  cancelFind: 'pdf-tools:cancel-find',
  /** stop a tool that reports progress (compress, batch, ocr, etc.) */
  cancelRun: 'pdf-tools:cancel-run',
  /** the task the PDF editor's ribbon asked for, taken once */
  takeStart: 'pdf-tools:take-start',
  /** main → window: a task from the ribbon is waiting */
  startReady: 'pdf-tools:start-ready',
  /** main → window: PdfProgressEvent while work runs */
  progress: 'pdf-tools:progress',
  close: 'pdf-tools:close',
} as const

/** Tools the window runs itself, each making a new file from the picked files */
export const PDF_TOOL_IDS = [
  'organize',
  'merge',
  'interleave',
  'split',
  'extract',
  'reverse',
  'nup',
  'rotate',
  'pageSize',
  'splitPages',
  'imagesToPdf',
  'docsToPdf',
  'pdfToImages',
  'convertFromPdf',
  'toText',
  'duplex',
  'overlay',
  'stripAnnots',
  'blankPages',
  'ocr',
  'compress',
  'encrypt',
  'decrypt',
  'repair',
] as const
export type PdfToolId = (typeof PDF_TOOL_IDS)[number]

/** Tools that need the PDF editor's view; their cards open the file in a PDF tab */
export const PDF_EDITOR_TOOL_IDS = ['stamps', 'crop', 'edit'] as const
export type PdfEditorToolId = (typeof PDF_EDITOR_TOOL_IDS)[number]

/** Paper sizes "page size" offers (points, portrait), the PDF editor's list */
export const PDF_TOOL_PAPERS = ['A3', 'A4', 'A5', 'Letter', 'Legal'] as const
export type PdfToolPaper = (typeof PDF_TOOL_PAPERS)[number]

/** Which PDFs a tool takes: readable ones, only password-protected ones (decrypt), or damaged ones too (repair) */
export type PdfToolAccept = 'pdf' | 'encrypted' | 'damaged'

/** Actual kind of one picked file */
export type PdfPickedFileKind = 'pdf' | 'image' | 'document'

/** What a tool accepts when picking or dropping files */
export type PdfToolInputKind = 'pdf' | 'image' | 'document' | 'mixed'

export type PdfCompressMode = 'lossless' | 'light' | 'medium' | 'strong' | 'target'
export type PdfImageOrientation = 'auto' | 'portrait' | 'landscape'
export type PdfImageOptimize = 'original' | 'balanced' | 'compact'
export type PdfConvertFormat = 'docx' | 'xlsx' | 'pptx' | 'hwpx' | 'md' | 'epub'

/** Pages a sheet will later hold N-up (duplex): 1 for no N-up */
export const PDF_TOOL_SHEET_PAGES = [1, 2, 4, 6, 8, 9, 16] as const

/** Kinds of annotation stripAnnots can remove (apps/pdf/src/main/annot-strip.ts) */
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

/** One page entry in the visual Organize Pages plan */
export interface PdfOrganizePageSpec {
  /** picked/inserted PDF input id, or 'blank' for an inserted blank page */
  sourceId: string | 'blank'
  /** 0-based page index in sourceId (ignored when sourceId === 'blank') */
  sourcePageIndex: number
  /** clockwise extra rotation added on top of the source page's /Rotate */
  extraRotation: 0 | 90 | 180 | 270
  /** page size in pt for 'blank' pages */
  widthPt?: number
  heightPt?: number
}

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
  /** overlay, stripAnnots, ocr, pdfToImages, convertFromPdf: "1-3,5" style pages, '' for every page */
  applyPages?: string
  /** stripAnnots: the kinds to remove */
  annotKinds?: PdfToolAnnotKind[]
  /** blankPages: "3,7" style 1-based pages to remove, all among the pages found */
  removePages?: string
  /** compress: kept for backward compatibility; when compressMode is absent, maps to compressMode */
  compressLevel?: 'light' | 'medium' | 'strong'
  /** encrypt: the password asked for on opening; decrypt: the one that opens it now */
  password?: string
  /** encrypt, in the window only (never sent): the password typed again */
  passwordConfirm?: string
  /** encrypt: refuse printing, copying and changes without `permissionPassword` */
  restrict?: boolean
  permissionPassword?: string

  // v2 additions
  compressMode?: PdfCompressMode
  targetSizeMb?: number
  grayscaleImages?: boolean
  linearize?: boolean
  stripMetadata?: boolean
  reocrExisting?: boolean
  reverseEven?: boolean
  itemRotations?: Record<string, 0 | 90 | 180 | 270>
  imageOrientation?: PdfImageOrientation
  imageOptimize?: PdfImageOptimize
  pdfToImagesMode?: 'pages' | 'embedded'
  imageFormat?: 'png' | 'jpg'
  imageDpi?: 150 | 200 | 300
  imageQuality?: 'high' | 'medium' | 'small'
  imageOutMode?: 'zip' | 'folder'
  targetFormat?: PdfConvertFormat
  epubTitle?: string
  epubAuthor?: string
  epubCover?: boolean
  epubPageBreaks?: boolean
  addBookmarks?: boolean
  unifyPaper?: 'keep' | PdfToolPaper
  /** merge: per-inputId 1-based page range string ("1-3,5"), empty = all pages */
  mergeRanges?: Record<string, string>
  docsOutputMode?: 'each' | 'merge'
}

/** One picked file, as the window may see it: an opaque id, never the path */
export interface PdfToolInput {
  id: string
  kind: PdfPickedFileKind
  name: string
  /** 1 for a picture; 0 while a document is pending conversion */
  pages: number
  size: number
  encrypted?: boolean
  unlocked?: boolean
  unsavedWarning?: boolean
  hasTextLayer?: boolean
  mixState?: 'pending' | 'converting' | 'ready' | 'error'
  mixError?: string
  thumb?: string | null
}

export type PdfInputProblem =
  'encrypted' | 'unreadable' | 'too-large' | 'not-image' | 'not-encrypted' | 'unsupported-document'

export interface PdfPickResult {
  inputs: PdfToolInput[]
  rejected: { name: string; problem: PdfInputProblem }[]
}

export type PdfToolError =
  | 'no-input'
  | 'need-two'
  | 'missing'
  | 'too-large'
  | 'range'
  | 'same-as-source'
  | 'unsaved-target'
  | 'busy'
  | 'no-text'
  | 'need-background'
  | 'need-even'
  | 'no-annots'
  | 'no-kinds'
  | 'all-pages'
  | 'not-found'
  | 'none-chosen'
  | 'not-smaller'
  | 'password-empty'
  | 'password-same'
  | 'password-long'
  | 'wrong-password'
  | 'no-ocr-engine'
  | 'no-ocr-changes'
  | 'no-embedded-images'
  | 'invalid-target-size'
  | 'mix-converting'
  | 'mix-failed'
  | 'empty-organize'
  | 'no-bookmarks'
  | 'invalid-size'
  | 'failed'

export interface PdfToolRunRequest {
  tool: PdfToolId
  /** ids from pickInputs/dropInputs, in the order the user arranged them */
  inputIds: string[]
  options: PdfToolOptions
  /** overlay: the id of the PDF picked as the background */
  backgroundId?: string
  /** interleave: even-pages PDF input id */
  evenId?: string
  /** organize: full or selected page descriptors to assemble */
  organizePlan?: PdfOrganizePageSpec[]
}

export interface PdfBatchItemOutcome {
  inputId: string
  name: string
  status: 'ok' | 'target-not-met' | 'skipped' | 'failed'
  outputs?: { id: string; name: string; size: number }[]
  reason?: PdfToolError | 'unlocked-missing'
  achievedBytes?: number
  targetBytes?: number
}

export interface PdfSpaceAudit {
  totalBytes: number
  imagesBytes: number
  fontsBytes: number
  contentBytes: number
  otherBytes: number
  duplicateImageCount: number
  duplicateImageSavableBytes: number
}

export interface PdfProgressEvent {
  done: number
  total: number
  fileDone?: number
  fileTotal?: number
  currentName?: string
}

export type PdfToolRunResult =
  | {
      ok: true
      outputs: { id: string; name: string; size: number }[]
      notice?: 'unlocked-unencrypted'
      ocrSummary?: { ocredPages: number; skippedPages: number }
      batch?: PdfBatchItemOutcome[]
      /** 1-based pages that exceeded maxSize on their own */
      oversizedPages?: number[]
    }
  | {
      ok: false
      targetMissed: true
      pendingId: string
      achievedBytes: number
      targetBytes: number
      originalBytes: number
    }
  | { ok: false; canceled: true; savedCount?: number }
  | { ok: false; error: PdfToolError }

export interface PdfBookmarkItem {
  title: string
  level: number
  /** 1-based page number */
  page: number
}

export type PdfBookmarksResult =
  | { ok: true; bookmarks: PdfBookmarkItem[] }
  | { ok: false; error: 'no-input' | 'missing' | 'failed' }

/** A page that may be blank, for the user to look at before anything is removed */
export interface PdfBlankCandidate {
  /** 1-based */
  page: number
  /** draws nothing at all, or white but for specks */
  reason: 'empty' | 'nearly-white'
  /** a PNG data URL of the page; null past the candidates that get one */
  thumb: string | null
}

export type PdfBlankPagesResult =
  | { ok: true; pageCount: number; candidates: PdfBlankCandidate[] }
  | { ok: false; canceled: true }
  | { ok: false; error: 'no-input' | 'missing' | 'busy' | 'failed' }

/** A task opened from the PDF editor's ribbon or promoted from another tool */
export interface PdfToolsStart {
  tool: PdfToolId
  inputs: PdfToolInput[]
  rejected: PdfPickResult['rejected']
}

export type PdfToolsTheme = 'light' | 'dark' | 'system'

export interface PdfToolsInit {
  lang: Lang
  theme: PdfToolsTheme
}

export interface PdfMixStatusEvent {
  inputId: string
  state: 'pending' | 'converting' | 'ready' | 'error'
  pages?: number
  thumb?: string | null
  error?: string
}

export interface PdfRenderThumbsResultOk {
  ok: true
  pageCount: number
  thumbs: { page: number; widthPt: number; heightPt: number; thumb: string }[]
}

export type PdfRenderThumbsResult =
  PdfRenderThumbsResultOk | { ok: false; canceled?: true; error?: PdfToolError }

export interface PdfToolsWindowApi {
  getInit(): Promise<PdfToolsInit>
  onThemeChanged(handler: (theme: PdfToolsTheme) => void): () => void
  /** a main-process open dialog; the window gets ids, never paths */
  pickInputs(
    multi: boolean,
    kind?: PdfToolInputKind,
    accept?: PdfToolAccept,
  ): Promise<PdfPickResult>
  /** drag-and-drop: preload resolves File -> path via webUtils.getPathForFile, main returns opaque ids */
  dropInputs(files: File[], kind?: PdfToolInputKind, accept?: PdfToolAccept): Promise<PdfPickResult>
  /** release removed or abandoned input ids so main clears cached passwords, bytes, and mix temp PDFs */
  releaseInputs(ids: string[]): Promise<void>
  unlockInput(
    inputId: string,
    password: string,
  ): Promise<
    { ok: true; pages: number } | { ok: false; error: 'wrong-password' | 'missing' | 'failed' }
  >
  promoteResult(
    outputId: string,
    nextTool: PdfToolId,
  ): Promise<{ ok: true; start: PdfToolsStart } | { ok: false; error: PdfToolError }>
  promoteInput(
    inputId: string,
    nextTool: PdfToolId,
  ): Promise<{ ok: true; start: PdfToolsStart } | { ok: false; error: PdfToolError }>
  auditSpace(
    inputId: string,
  ): Promise<{ ok: true; audit: PdfSpaceAudit } | { ok: false; error: PdfToolError }>
  ocrAvailable(): Promise<{ available: boolean; platform: string }>
  renderThumbs(inputId: string, startPage: number, endPage: number): Promise<PdfRenderThumbsResult>
  cancelThumbs(): Promise<void>
  onMixStatus(handler: (ev: PdfMixStatusEvent) => void): () => void
  confirmSavePartial(pendingId: string, save: boolean): Promise<PdfToolRunResult>
  run(request: PdfToolRunRequest): Promise<PdfToolRunResult>
  openResult(id: string): Promise<void>
  revealResult(id: string): Promise<void>
  /** pick a PDF and open it in a PDF editor tab */
  openInEditor(): Promise<void>
  /** open an already-picked PDF input in a PDF editor tab */
  openInEditorWithInput(inputId: string): Promise<void>
  /** open a picked PDF in the editor and immediately launch the visual Split dialog */
  openSplitInEditor(inputId: string): Promise<void>
  /** read document bookmarks for a picked PDF */
  readBookmarks(inputId: string): Promise<PdfBookmarksResult>
  /** look for blank pages in a picked PDF, in a process of its own */
  findBlankPages(inputId: string): Promise<PdfBlankPagesResult>
  cancelFind(): Promise<void>
  cancelRun(): Promise<void>
  onProgress(handler: (done: number, total: number, detail?: PdfProgressEvent) => void): () => void
  /** the task the editor's ribbon opened this window on, once; null when none waits */
  takeStart(): Promise<PdfToolsStart | null>
  onStartReady(handler: () => void): () => void
  close(): Promise<void>
}

export interface PdfToolsHomeApi {
  open(): Promise<void>
}
