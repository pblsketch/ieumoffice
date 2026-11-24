/// The advanced print layout calls an editor's preload exposes. The caller
/// passes its own `ipcRenderer`, so this module imports nothing from Electron
/// or the package root and loads in sandboxed preloads. Answers cross
/// contextBridge as plain data; a main process that does not answer reads as
/// a failure, never a thrown error.
import type { LabelSpec } from '@genoffice/print-layout/plan'
import {
  PRINT_LAYOUT_SHARED_CHANNELS,
  printLayoutChannels,
  type LabelSpecSetResult,
  type PrintLayoutFailure,
  type PrintLayoutPreviewFacesRequest,
  type PrintLayoutPreviewFacesResult,
  type PrintLayoutPreviewRequest,
  type PrintLayoutPreviewResult,
  type PrintLayoutPrinterInfo,
  type PrintLayoutPrintRequest,
  type PrintLayoutPrintResult,
  type PrintLayoutProgress,
  type PrintLayoutSaveImagesRequest,
  type PrintLayoutSaveImagesResult,
  type PrintLayoutSaveRequest,
  type PrintLayoutSaveResult,
} from './print-layout-channels'

/** The part of Electron's `ipcRenderer` the bridge uses. */
export interface PrintLayoutIpcRenderer {
  invoke(channel: string, ...args: any[]): Promise<any>
  on(channel: string, listener: (event: any, ...args: any[]) => void): unknown
  removeListener(channel: string, listener: (...args: any[]) => void): unknown
}

export interface PrintLayoutBridge<E = unknown> {
  /** builds the arranged result and returns each face as a small PNG */
  preview(request: PrintLayoutPreviewRequest<E>): Promise<PrintLayoutPreviewResult>
  /** on-demand cached preview rendering only requested 0-based face indices */
  previewFaces?(request: PrintLayoutPreviewFacesRequest<E>): Promise<PrintLayoutPreviewFacesResult>
  /** releases any cached job/arranged PDF held for this window's live preview */
  closePreview?(): Promise<void>
  /** prints the arranged result (system dialog, or the in-app printer in `job`) */
  print(request: PrintLayoutPrintRequest<E>): Promise<PrintLayoutPrintResult>
  /** asks where to save, then writes the arranged PDF */
  savePdf(request: PrintLayoutSaveRequest<E>): Promise<PrintLayoutSaveResult>
  /** asks where to save, then writes the arranged faces as PNG/JPG files or ZIP */
  saveImages?(request: PrintLayoutSaveImagesRequest<E>): Promise<PrintLayoutSaveImagesResult>
  /** stops this window's running job; nothing is sent to a printer */
  cancel(): Promise<void>
  /** faces done of the running job; returns the unsubscribe */
  onProgress(listener: (progress: PrintLayoutProgress) => void): () => void
  /** the label grid the user typed in last; null when none */
  getLabelSpec(): Promise<LabelSpec | null>
  setLabelSpec(spec: LabelSpec): Promise<LabelSpecSetResult>
  /** installed OS printers for the in-app print dialog; absent in older mocks */
  listPrinters?(): Promise<PrintLayoutPrinterInfo[]>
  /** app-wide quick-print click preference: true when clicking the print icon prints immediately */
  getQuickPrintPref?(): Promise<boolean>
  setQuickPrintPref?(enabled: boolean): Promise<boolean>
  onQuickPrintPrefChanged?(listener: (enabled: boolean) => void): () => void
}

function noAnswer(err: unknown): PrintLayoutFailure {
  return {
    ok: false,
    error: err instanceof Error ? err.message : 'the print layout service did not answer',
  }
}

function isProgress(v: unknown): v is PrintLayoutProgress {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  return (
    typeof p.done === 'number' &&
    typeof p.total === 'number' &&
    Number.isFinite(p.done) &&
    Number.isFinite(p.total)
  )
}

export function createPrintLayoutBridge<E = unknown>(
  ipcRenderer: PrintLayoutIpcRenderer,
  prefix: string,
): PrintLayoutBridge<E> {
  const c = printLayoutChannels(prefix)
  return {
    preview: (request) => ipcRenderer.invoke(c.preview, request).catch(noAnswer),
    previewFaces: (request) => ipcRenderer.invoke(c.previewFaces, request).catch(noAnswer),
    closePreview: async () => {
      await ipcRenderer.invoke(c.closePreview).catch(() => undefined)
    },
    print: (request) => ipcRenderer.invoke(c.print, request).catch(noAnswer),
    savePdf: (request) => ipcRenderer.invoke(c.save, request).catch(noAnswer),
    saveImages: (request) => ipcRenderer.invoke(c.saveImages, request).catch(noAnswer),
    cancel: async () => {
      await ipcRenderer.invoke(c.cancel).catch(() => undefined)
    },
    onProgress(listener) {
      const handler = (_event: unknown, progress: unknown) => {
        if (isProgress(progress)) listener({ done: progress.done, total: progress.total })
      }
      ipcRenderer.on(c.progress, handler)
      return () => {
        ipcRenderer.removeListener(c.progress, handler)
      }
    },
    getLabelSpec: () =>
      ipcRenderer
        .invoke(PRINT_LAYOUT_SHARED_CHANNELS.labelSpecGet)
        .then((spec: unknown) => (spec && typeof spec === 'object' ? (spec as LabelSpec) : null))
        .catch(() => null),
    setLabelSpec: (spec) =>
      ipcRenderer.invoke(PRINT_LAYOUT_SHARED_CHANNELS.labelSpecSet, spec).catch(noAnswer),
    listPrinters: () =>
      ipcRenderer
        .invoke(PRINT_LAYOUT_SHARED_CHANNELS.listPrinters)
        .then((list: unknown) => (Array.isArray(list) ? (list as PrintLayoutPrinterInfo[]) : []))
        .catch(() => []),
    getQuickPrintPref: () =>
      ipcRenderer
        .invoke(PRINT_LAYOUT_SHARED_CHANNELS.quickPrintPrefGet)
        .then((v: unknown) => v === true)
        .catch(() => false),
    setQuickPrintPref: (enabled: boolean) =>
      ipcRenderer
        .invoke(PRINT_LAYOUT_SHARED_CHANNELS.quickPrintPrefSet, enabled === true)
        .then((v: unknown) => v === true)
        .catch(() => enabled === true),
    onQuickPrintPrefChanged(listener) {
      const handler = (_event: unknown, value: unknown) => {
        listener(value === true)
      }
      ipcRenderer.on(PRINT_LAYOUT_SHARED_CHANNELS.quickPrintPrefChanged, handler)
      return () => {
        ipcRenderer.removeListener(PRINT_LAYOUT_SHARED_CHANNELS.quickPrintPrefChanged, handler)
      }
    },
  }
}
