import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  PdfBlankPagesResult,
  PdfBookmarksResult,
  PdfMixStatusEvent,
  PdfPickResult,
  PdfProgressEvent,
  PdfRenderThumbsResult,
  PdfSpaceAudit,
  PdfToolError,
  PdfToolId,
  PdfToolRunRequest,
  PdfToolRunResult,
  PdfToolsInit,
  PdfToolsStart,
  PdfToolsTheme,
  PdfToolsWindowApi,
} from '../shared/pdf-tools-api'
import { PDF_TOOLS_CHANNELS } from '../shared/pdf-tools-api'

function themeOf(value: unknown): PdfToolsTheme {
  return value === 'light' || value === 'dark' ? value : 'system'
}

// The PDF tools window's narrow API: pick inputs through main's dialog or
// preload-resolved OS drop File objects, run a tool, open or reveal what it
// wrote, and listen for progress, mix-status, and theme broadcasts.
// Local file paths never cross back into the page; it only sees opaque ids and names.
const api: PdfToolsWindowApi = {
  async getInit() {
    const init = (await ipcRenderer.invoke(PDF_TOOLS_CHANNELS.getInit)) as PdfToolsInit | null
    return { lang: init?.lang ?? 'en', theme: themeOf(init?.theme) }
  },
  onThemeChanged(handler) {
    const listener = (_event: IpcRendererEvent, theme: unknown) => handler(themeOf(theme))
    ipcRenderer.on('app:theme-changed', listener)
    return () => ipcRenderer.removeListener('app:theme-changed', listener)
  },
  async pickInputs(multi: boolean, kind = 'pdf', accept = 'pdf') {
    const result = (await ipcRenderer.invoke(
      PDF_TOOLS_CHANNELS.pickInputs,
      multi,
      kind,
      accept,
    )) as PdfPickResult | undefined
    return result ?? { inputs: [], rejected: [] }
  },
  async dropInputs(files: File[], kind = 'pdf', accept = 'pdf') {
    const paths: string[] = []
    if (Array.isArray(files)) {
      for (const file of files) {
        try {
          const resolved = webUtils.getPathForFile(file)
          if (typeof resolved === 'string' && resolved.length > 0) paths.push(resolved)
        } catch {
          // ignore non-file entries
        }
      }
    }
    if (paths.length === 0) return { inputs: [], rejected: [] }
    const result = (await ipcRenderer.invoke(
      PDF_TOOLS_CHANNELS.dropInputs,
      paths,
      kind,
      accept,
    )) as PdfPickResult | undefined
    return result ?? { inputs: [], rejected: [] }
  },
  async releaseInputs(ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0) return
    await ipcRenderer.invoke(PDF_TOOLS_CHANNELS.releaseInputs, ids)
  },
  async unlockInput(inputId: string, password: string) {
    const result = (await ipcRenderer.invoke(PDF_TOOLS_CHANNELS.unlockInput, inputId, password)) as
      | { ok: true; pages: number }
      | { ok: false; error: 'wrong-password' | 'missing' | 'failed' }
      | undefined
    return result ?? { ok: false, error: 'failed' }
  },
  async promoteResult(outputId: string, nextTool: PdfToolId) {
    const result = (await ipcRenderer.invoke(
      PDF_TOOLS_CHANNELS.promoteResult,
      outputId,
      nextTool,
    )) as { ok: true; start: PdfToolsStart } | { ok: false; error: PdfToolError } | undefined
    return result ?? { ok: false, error: 'failed' }
  },
  async promoteInput(inputId: string, nextTool: PdfToolId) {
    const result = (await ipcRenderer.invoke(
      PDF_TOOLS_CHANNELS.promoteInput,
      inputId,
      nextTool,
    )) as { ok: true; start: PdfToolsStart } | { ok: false; error: PdfToolError } | undefined
    return result ?? { ok: false, error: 'failed' }
  },
  async auditSpace(inputId: string) {
    const result = (await ipcRenderer.invoke(PDF_TOOLS_CHANNELS.auditSpace, inputId)) as
      { ok: true; audit: PdfSpaceAudit } | { ok: false; error: PdfToolError } | undefined
    return result ?? { ok: false, error: 'failed' }
  },
  async ocrAvailable() {
    const result = (await ipcRenderer.invoke(PDF_TOOLS_CHANNELS.ocrAvailable)) as
      { available: boolean; platform: string } | undefined
    return result ?? { available: false, platform: 'unknown' }
  },
  async renderThumbs(inputId: string, startPage: number, endPage: number) {
    const result = (await ipcRenderer.invoke(
      PDF_TOOLS_CHANNELS.renderThumbs,
      inputId,
      startPage,
      endPage,
    )) as PdfRenderThumbsResult | undefined
    return result ?? { ok: false, error: 'failed' }
  },
  async cancelThumbs() {
    await ipcRenderer.invoke(PDF_TOOLS_CHANNELS.cancelThumbs)
  },
  onMixStatus(handler) {
    const listener = (_event: IpcRendererEvent, value: unknown) => {
      if (
        value &&
        typeof value === 'object' &&
        typeof (value as PdfMixStatusEvent).inputId === 'string'
      ) {
        handler(value as PdfMixStatusEvent)
      }
    }
    ipcRenderer.on(PDF_TOOLS_CHANNELS.mixStatus, listener)
    return () => ipcRenderer.removeListener(PDF_TOOLS_CHANNELS.mixStatus, listener)
  },
  async confirmSavePartial(pendingId: string, save: boolean) {
    const result = (await ipcRenderer.invoke(
      PDF_TOOLS_CHANNELS.confirmSavePartial,
      pendingId,
      save,
    )) as PdfToolRunResult | undefined
    return result ?? { ok: false, error: 'failed' }
  },
  async run(request: PdfToolRunRequest) {
    const result = (await ipcRenderer.invoke(PDF_TOOLS_CHANNELS.run, request)) as
      PdfToolRunResult | undefined
    return result ?? { ok: false, error: 'failed' }
  },
  async openResult(id: string) {
    await ipcRenderer.invoke(PDF_TOOLS_CHANNELS.openResult, id)
  },
  async revealResult(id: string) {
    await ipcRenderer.invoke(PDF_TOOLS_CHANNELS.revealResult, id)
  },
  async openInEditor() {
    await ipcRenderer.invoke(PDF_TOOLS_CHANNELS.openInEditor)
  },
  async openInEditorWithInput(inputId: string) {
    await ipcRenderer.invoke(PDF_TOOLS_CHANNELS.openInEditorWithInput, inputId)
  },
  async openSplitInEditor(inputId: string) {
    await ipcRenderer.invoke(PDF_TOOLS_CHANNELS.openSplitInEditor, inputId)
  },
  async readBookmarks(inputId: string) {
    const result = (await ipcRenderer.invoke(PDF_TOOLS_CHANNELS.readBookmarks, inputId)) as
      PdfBookmarksResult | undefined
    return result ?? { ok: false, error: 'failed' }
  },
  async findBlankPages(inputId: string) {
    const result = (await ipcRenderer.invoke(PDF_TOOLS_CHANNELS.findBlankPages, inputId)) as
      PdfBlankPagesResult | undefined
    return result ?? { ok: false, error: 'failed' }
  },
  async cancelRun() {
    await ipcRenderer.invoke(PDF_TOOLS_CHANNELS.cancelRun)
  },
  async cancelFind() {
    await ipcRenderer.invoke(PDF_TOOLS_CHANNELS.cancelFind)
  },
  onProgress(handler) {
    const listener = (_event: IpcRendererEvent, value: unknown) => {
      const v = (value ?? {}) as PdfProgressEvent
      if (typeof v.done === 'number' && typeof v.total === 'number') {
        handler(v.done, v.total, v)
      }
    }
    ipcRenderer.on(PDF_TOOLS_CHANNELS.progress, listener)
    return () => ipcRenderer.removeListener(PDF_TOOLS_CHANNELS.progress, listener)
  },
  async takeStart() {
    const start = (await ipcRenderer.invoke(PDF_TOOLS_CHANNELS.takeStart)) as PdfToolsStart | null
    return start ?? null
  },
  onStartReady(handler) {
    const listener = () => handler()
    ipcRenderer.on(PDF_TOOLS_CHANNELS.startReady, listener)
    return () => ipcRenderer.removeListener(PDF_TOOLS_CHANNELS.startReady, listener)
  },
  async close() {
    await ipcRenderer.invoke(PDF_TOOLS_CHANNELS.close)
  },
}

contextBridge.exposeInMainWorld('aiOfficePdfTools', api)
