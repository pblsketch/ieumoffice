import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PdfViewApi, PdfViewSource } from '../shared/view-source'
import { createViewActivity } from '@genoffice/electron-utils/view-activity'
import type { ViewVisibilityBridge } from '@genoffice/electron-utils/view-visibility'
import { pageRasterCache } from './page-raster-cache'

interface Renderer {
  source: PdfViewSource
  api: PdfViewApi
  password?: string
  disabled: boolean
}
const renderers = new WeakMap<PDFDocumentProxy, Renderer>()
const activity = new WeakMap<PDFDocumentProxy, ReturnType<typeof createViewActivity>>()

export function bindFileViewRenderer(
  doc: PDFDocumentProxy,
  source: PdfViewSource,
  api: PdfViewApi,
  password?: string,
): void {
  if (typeof document !== 'undefined') {
    activity.get(doc)?.dispose()
    activity.set(
      doc,
      createViewActivity(
        document,
        (window as Window & { aiOfficeViewVisibility?: ViewVisibilityBridge })
          .aiOfficeViewVisibility,
      ),
    )
  }
  if (!source.hasXfa && source.length <= 0xffffffff)
    renderers.set(doc, { source, api, password, disabled: false })
}
export function fileViewRenderer(doc: PDFDocumentProxy): Renderer | undefined {
  const renderer = renderers.get(doc)
  return renderer?.disabled ? undefined : renderer
}
export function disableFileViewRenderer(doc: PDFDocumentProxy): void {
  const renderer = renderers.get(doc)
  if (renderer) renderer.disabled = true
}
export function forgetFileViewRenderer(doc: PDFDocumentProxy): void {
  pageRasterCache.close(doc)
  activity.get(doc)?.dispose()
  activity.delete(doc)
  renderers.delete(doc)
}

export function watchViewActivity(doc: PDFDocumentProxy, listener: (visible: boolean) => void) {
  const state = activity.get(doc)
  listener(state?.isVisible() ?? true)
  return state?.subscribe(() => listener(state.isVisible())) ?? (() => {})
}

/** Optional automatic preparation sleeps; direct user operations keep their own policy. */
export function waitForViewActivity(doc: PDFDocumentProxy, signal?: AbortSignal): Promise<boolean> {
  return activity.get(doc)?.wait(signal) ?? Promise.resolve(!signal?.aborted)
}
