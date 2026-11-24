/// Channel names and answer shapes of the advanced print layout, shared by the
/// editors' main processes (`print-arranged.ts`) and their preloads
/// (`print-layout-bridge.ts`). No runtime imports: preloads load this.
import type {
  ImageExportOptions,
  LabelSpec,
  PageSize,
  PrintLayoutErrorCode,
  PrintLayoutOptions,
} from '@genoffice/print-layout/plan'

/** App-wide channels: the typed-in label grid, quick-print toggle, and installed printer list, one for every editor. */
export const PRINT_LAYOUT_SHARED_CHANNELS = {
  labelSpecGet: 'print-layout:label-spec-get',
  labelSpecSet: 'print-layout:label-spec-set',
  listPrinters: 'print-layout:printers',
  quickPrintPrefGet: 'print-layout:quick-print-pref-get',
  quickPrintPrefSet: 'print-layout:quick-print-pref-set',
  quickPrintPrefChanged: 'print-layout:quick-print-pref-changed',
} as const

/** One installed OS printer returned by `print-layout:printers`. */
export interface PrintLayoutPrinterInfo {
  name: string
  displayName: string
  isDefault?: boolean | undefined
}

export interface PrintLayoutEditorChannels {
  preview: string
  previewFaces: string
  closePreview: string
  print: string
  save: string
  saveImages: string
  cancel: string
  /** main → the requesting window only: `PrintLayoutProgress` */
  progress: string
}

const PREFIX = /^[a-z][a-z0-9-]*$/

/** One editor's channels, named after its prefix (`docs`, `pdf`, `sheets` ...). */
export function printLayoutChannels(prefix: string): PrintLayoutEditorChannels {
  if (!PREFIX.test(prefix)) throw new Error(`invalid print layout channel prefix: ${prefix}`)
  return {
    preview: `${prefix}:print-layout-preview`,
    previewFaces: `${prefix}:print-layout-preview-faces`,
    closePreview: `${prefix}:print-layout-close-preview`,
    print: `${prefix}:print-layout-print`,
    save: `${prefix}:print-layout-save`,
    saveImages: `${prefix}:print-layout-save-images`,
    cancel: `${prefix}:print-layout-cancel`,
    progress: `${prefix}:print-layout-progress`,
  }
}

/** Faces rendered so far out of all faces of the running job. */
export interface PrintLayoutProgress {
  done: number
  total: number
}

/** Placement of one overlay PNG stamp on a face (top-left coordinates in points). */
export interface PrintLayoutOverlayPlacement {
  stampIndex: number
  x?: number | undefined
  y?: number | undefined
  width?: number | undefined
  height?: number | undefined
  opacity?: number | undefined
}

/** Deduplicated PNG stamps and per-face placements sent over IPC. */
export interface PrintLayoutOverlayData {
  stamps: Uint8Array[]
  perFace: PrintLayoutOverlayPlacement[][]
}

/**
 * What a screen sends. `options` is checked again in the main process;
 * `editor` is the editor's own request (range, selection ...) handed to its
 * `buildJobPdf` as it is.
 */
export interface PrintLayoutRequestBase<E = unknown> {
  options: PrintLayoutOptions | Record<string, unknown>
  editor?: E
  /** pre-rendered transparent PNG overlays (watermark, header/footer) */
  overlays?: PrintLayoutOverlayData | undefined
}

export interface PrintLayoutPreviewRequest<E = unknown> extends PrintLayoutRequestBase<E> {
  /** long side of each preview image in pixels; default 800 */
  longSidePx?: number | undefined
  /** optional 0-based face indices to render (defaults to all faces) */
  faceIndices?: number[] | undefined
}

export interface PrintLayoutPreviewFacesRequest<E = unknown> extends PrintLayoutRequestBase<E> {
  /** cache key identifying the editor input (document revision + range/settings) */
  editorKey?: string | undefined
  /** cache key identifying layout options + overlays */
  optionsKey?: string | undefined
  /** 0-based face indices to render on demand */
  faceIndices: number[]
  /** long side of each preview image in pixels; default 800 */
  longSidePx?: number | undefined
}

export interface PrintLayoutPrintRequest<E = unknown> extends PrintLayoutRequestBase<E> {
  /**
   * The in-app printer choice in the shape `print-job.ts` reads
   * (`PrintJobOptions`); absent or `deviceName: null` opens the system dialog.
   */
  job?: unknown
}

export type PrintLayoutSaveRequest<E = unknown> = PrintLayoutRequestBase<E>

export interface PrintLayoutSaveImagesRequest<E = unknown> extends PrintLayoutRequestBase<E> {
  image: ImageExportOptions
}

/**
 * A job that did not finish. `aborted`: the screen canceled it. `code`: the
 * layout options cannot be printed for this job (the screen shows its own
 * text for the code); `error` is an English detail.
 */
export type PrintLayoutFailure =
  { ok: false; aborted: true } | { ok: false; error: string; code?: PrintLayoutErrorCode }

export interface PrintLayoutPreviewFace {
  /** 0-based face index when rendered on demand */
  index?: number | undefined
  /** small PNG of the face, not turned */
  png: Uint8Array
  /** the face in points */
  widthPt: number
  heightPt: number
}

export type PrintLayoutPreviewResult =
  | {
      ok: true
      faces: PrintLayoutPreviewFace[]
      totalFaces?: number | undefined
      faceSizes?: PageSize[] | undefined
    }
  | PrintLayoutFailure

export type PrintLayoutPreviewFacesResult =
  | {
      ok: true
      totalFaces: number
      faceSizes: PageSize[]
      faces: Array<PrintLayoutPreviewFace & { index: number }>
    }
  | PrintLayoutFailure

/** `canceled`: the user closed the system print dialog, which is not a failure. */
export type PrintLayoutPrintResult = { ok: true; canceled?: true } | PrintLayoutFailure

/** `canceled`: the user closed the save dialog. */
export type PrintLayoutSaveResult =
  { ok: true; path: string } | { ok: true; canceled: true } | PrintLayoutFailure

/** `canceled`: the user closed the save dialog. */
export type PrintLayoutSaveImagesResult =
  { ok: true; paths: string[] } | { ok: true; canceled: true } | PrintLayoutFailure

export type LabelSpecSetResult =
  { ok: true; spec: LabelSpec } | { ok: false; error: string; code?: PrintLayoutErrorCode }
