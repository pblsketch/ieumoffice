import type { Lang } from '@genoffice/i18n'
import type {
  PdfInputProblem,
  PdfToolAccept,
  PdfToolId,
  PdfToolInputKind,
  PdfToolOptions,
} from '@genoffice/pdf-ops/tool-ids'

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
  run: 'pdf-tools:run',
  openResult: 'pdf-tools:open-result',
  revealResult: 'pdf-tools:reveal-result',
  openInEditor: 'pdf-tools:open-in-editor',
  openSplitInEditor: 'pdf-tools:open-split-in-editor',
  readBookmarks: 'pdf-tools:read-bookmarks',
  findBlankPages: 'pdf-tools:find-blank-pages',
  cancelFind: 'pdf-tools:cancel-find',
  /** stop a tool that reports progress (compress) */
  cancelRun: 'pdf-tools:cancel-run',
  /** the task the PDF editor's ribbon asked for, taken once */
  takeStart: 'pdf-tools:take-start',
  /** main → window: a task from the ribbon is waiting */
  startReady: 'pdf-tools:start-ready',
  /** main → window: { done, total } while blank pages are being looked for */
  progress: 'pdf-tools:progress',
  close: 'pdf-tools:close',
} as const

// The tools' own ids, choices and options are shared with the phone in
// @genoffice/pdf-ops; this file keeps every name it exported for its
// importers. The constants come from a side-effect-free package, so a bundle
// that does not use them leaves them out.
export {
  PDF_TOOL_ANNOT_KINDS,
  PDF_TOOL_IDS,
  PDF_TOOL_MARGINS,
  PDF_TOOL_PAPERS,
  PDF_TOOL_SHEET_PAGES,
} from '@genoffice/pdf-ops/tool-ids'
export type {
  PdfInputProblem,
  PdfToolAccept,
  PdfToolAnnotKind,
  PdfToolId,
  PdfToolInputKind,
  PdfToolMargin,
  PdfToolOptions,
  PdfToolPaper,
} from '@genoffice/pdf-ops/tool-ids'

/** Tools that need the PDF editor's view; their cards open the file in a PDF tab */
export const PDF_EDITOR_TOOL_IDS = ['stamps', 'crop', 'exportImages', 'convert', 'edit'] as const
export type PdfEditorToolId = (typeof PDF_EDITOR_TOOL_IDS)[number]

/** One picked file, as the window may see it: an opaque id, never the path */
export interface PdfToolInput {
  id: string
  kind: PdfToolInputKind
  name: string
  /** 1 for a picture */
  pages: number
  size: number
}

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
  | 'no-bookmarks'
  | 'invalid-size'
  | 'failed'

export interface PdfToolRunRequest {
  tool: PdfToolId
  /** ids from pickInputs, in the order the user arranged them */
  inputIds: string[]
  options: PdfToolOptions
  /** overlay: the id of the PDF picked as the background */
  backgroundId?: string
}

export type PdfToolRunResult =
  | {
      ok: true
      outputs: { id: string; name: string; size: number }[]
      /** 1-based pages that exceeded maxSize on their own */
      oversizedPages?: number[]
    }
  | { ok: false; canceled: true }
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

/** A task opened from the PDF editor's ribbon, its file already picked */
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

export interface PdfToolsWindowApi {
  getInit(): Promise<PdfToolsInit>
  onThemeChanged(handler: (theme: PdfToolsTheme) => void): () => void
  /** a main-process open dialog; the window gets ids, never paths */
  pickInputs(
    multi: boolean,
    kind?: PdfToolInputKind,
    accept?: PdfToolAccept,
  ): Promise<PdfPickResult>
  run(request: PdfToolRunRequest): Promise<PdfToolRunResult>
  openResult(id: string): Promise<void>
  revealResult(id: string): Promise<void>
  /** pick a PDF and open it in a PDF editor tab */
  openInEditor(): Promise<void>
  /** open a picked PDF in the editor and immediately launch the visual Split dialog */
  openSplitInEditor(inputId: string): Promise<void>
  /** read document bookmarks for a picked PDF */
  readBookmarks(inputId: string): Promise<PdfBookmarksResult>
  /** look for blank pages in a picked PDF, in a process of its own */
  findBlankPages(inputId: string): Promise<PdfBlankPagesResult>
  cancelFind(): Promise<void>
  cancelRun(): Promise<void>
  onProgress(handler: (done: number, total: number) => void): () => void
  /** the task the editor's ribbon opened this window on, once; null when none waits */
  takeStart(): Promise<PdfToolsStart | null>
  onStartReady(handler: () => void): () => void
  close(): Promise<void>
}

export interface PdfToolsHomeApi {
  open(): Promise<void>
}
