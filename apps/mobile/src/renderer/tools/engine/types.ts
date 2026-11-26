/**
 * The phone's PDF tools engine: what the tools screens hand it and what they
 * get back (spec 6). The work runs in one module worker (worker.ts) that
 * hosts the pure core (core.ts); client.ts is the screen-side handle.
 */
import type { InspectResult, PdfToolId, PdfToolOptions } from '@genoffice/pdf-ops'

export type { PdfToolId, PdfToolOptions }
export type { InspectResult }

/**
 * A file picked for a tool. Structurally the same as the home screen's
 * PdfToolInput (name, mime, sizeBytes?, readBytes): every call reads the file
 * again, so the engine reads one input at a time and drops it when done. The
 * bytes are handed to the worker without a copy (their buffer is detached),
 * so `readBytes` must return a fresh array on every call.
 */
export interface ToolFile {
  readonly name: string
  readonly mime: string
  readBytes(): Promise<Uint8Array>
}

export type ToolResultMime = 'application/pdf' | 'text/plain' | 'application/zip'

/** A file a tool made, kept in memory until the user opens, shares or saves it */
export interface ToolResultFile {
  readonly name: string
  readonly mime: ToolResultMime
  readonly bytes: Uint8Array
}

export type ToolRunFailure =
  | 'no-text'
  | 'no-annots'
  | 'not-smaller'
  | 'no-bookmarks'
  | 'wrong-password'
  | 'failed'
  | 'repair-failed'
  | 'too-large'
  | 'stopped'

export type ToolRunOutcome =
  | {
      ok: true
      files: ToolResultFile[]
      /** compress: the original file's size in bytes */
      sizeBefore?: number
      /** split by size: 1-based pages that alone are larger than the size asked for */
      oversizedPages?: number[]
    }
  | { ok: false; reason: ToolRunFailure }

/** A blank-page candidate to show: 1-based page, why, an RGBA thumbnail (null past the first ones) */
export interface BlankCandidateView {
  page: number
  reason: 'empty' | 'nearly-white'
  thumb: ImageData | null
}

export type BlankPagesOutcome =
  | { ok: true; pageCount: number; candidates: BlankCandidateView[] }
  | { ok: false; reason: 'stopped' | 'failed' | 'too-large' }

export interface PdfToolsEngine {
  /** What a picked file is for `tool` (page count or problem), and its size */
  inspect(file: ToolFile, tool: PdfToolId): Promise<InspectResult & { sizeBytes: number }>
  /** Run `tool` on `files` with options from its sheet (checked again here) */
  run(
    tool: PdfToolId,
    files: readonly ToolFile[],
    options: PdfToolOptions,
    onProgress?: (done: number, total: number) => void,
  ): Promise<ToolRunOutcome>
  /** The blank-page candidates of a PDF; nothing is removed */
  findBlankPages(
    file: ToolFile,
    onProgress?: (done: number, total: number) => void,
  ): Promise<BlankPagesOutcome>
  /** One ZIP holding `files` (split parts), named `zipName` */
  zip(files: readonly ToolResultFile[], zipName: string): Promise<ToolResultFile>
  /** End the worker now: the pending and queued calls settle as stopped; the next call starts a fresh worker */
  stop(): void
  /** Stop and let the engine go; later calls settle as stopped */
  dispose(): void
}
