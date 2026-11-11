import { Fragment, useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { geomDispSize, pdfRectToCss } from './annotations'
import type { LocalMarkup, PageGeom } from './annotations'
import { DrawLayer } from './DrawLayer'
import type { LocalDrawing } from './DrawLayer'
import { ImageEditLayer } from './ImageEditLayer'
import type { LocalImageEdit } from './ImageEditLayer'
import { MarkupOverlay } from './PdfPage'
import {
  textEditPreviewContent,
  textEditPreviewParts,
  textEraseKey,
  textInsertPreviewStyle,
} from './text-edit-preview'
import type { LocalTextEdit, LocalTextInsert } from './text-edit-preview'
import { STROKE_WIDTH } from './view-config'
import type { StampInput } from '../shared/ipc'
import { releaseCanvasPixels, retainPageResources } from './page-resources'
import { renderViewBitmap } from './view-bitmap'

interface RenderTaskHandle {
  promise: Promise<unknown>
  cancel: () => void
}

interface RenderedThumb {
  doc: PDFDocumentProxy
  pageNo: number
  rotationDelta: number
  rasterW: number
}

/** Thumbnail: rendered once per (doc, page, rotation, raster width) while visible.
 *  Offscreen thumbnails release their canvas allocation and raster again when
 *  shown. rasterW only changes when a sidebar drag ends, so a resize re-rasters
 *  each visible thumb once; while dragging the canvas just CSS-stretches. */
export function PdfThumb({
  doc,
  pageNo,
  rotationDelta,
  visible,
  rasterW,
}: {
  doc: PDFDocumentProxy
  pageNo: number
  rotationDelta: number
  visible: boolean
  rasterW: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderedRef = useRef<RenderedThumb | null>(null)
  const renderSettledRef = useRef<Promise<void>>(Promise.resolve())
  const renderGeneration = useRef({ version: 0 }).current
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const version = ++renderGeneration.version
    if (!visible) {
      renderedRef.current = null
      // Cancellation is asynchronous. Keep the backing store until PDF.js
      // releases it, and do not clear a render started by a rapid revisit.
      void renderSettledRef.current.finally(() => {
        if (renderGeneration.version === version) releaseCanvasPixels(canvas)
      })
      return
    }
    const rendered = renderedRef.current
    if (
      rendered?.doc === doc &&
      rendered.pageNo === pageNo &&
      rendered.rotationDelta === rotationDelta &&
      rendered.rasterW === rasterW
    ) {
      return
    }
    renderedRef.current = null
    let disposed = false
    let renderTask: RenderTaskHandle | null = null
    const resources = retainPageResources(doc, pageNo)
    const previousRenderSettled = renderSettledRef.current
    const renderSettled = (async () => {
      // pdf.js owns the canvas until RenderTask.promise settles, including after
      // cancel(). Never hand the same canvas to the replacement task sooner.
      await previousRenderSettled
      if (disposed) return
      try {
        const page = await resources.page
        if (disposed) return
        const rotation = (page.rotate + rotationDelta) % 360
        const scale = rasterW / page.getViewport({ scale: 1, rotation }).width
        const viewport = page.getViewport({ scale, rotation })
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        renderTask = renderViewBitmap(
          doc,
          page,
          pageNo,
          {
            canvas,
            viewport,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          },
          rotationDelta,
          true,
        )
        await renderTask.promise
        if (!disposed) renderedRef.current = { doc, pageNo, rotationDelta, rasterW }
      } catch {
        if (!disposed) renderedRef.current = null
      } finally {
        renderTask = null
      }
    })().finally(() => resources.release())
    renderSettledRef.current = renderSettled
    return () => {
      disposed = true
      renderTask?.cancel()
    }
  }, [doc, pageNo, rotationDelta, visible, rasterW, renderGeneration])

  // Capture the node: React may clear canvasRef before passive unmount cleanup runs.
  useEffect(() => {
    const canvas = canvasRef.current
    return () => {
      const version = ++renderGeneration.version
      void renderSettledRef.current.finally(() => {
        // The generation check also covers StrictMode's effect remount.
        if (canvas && renderGeneration.version === version) releaseCanvasPixels(canvas)
      })
    }
  }, [renderGeneration])

  return <canvas ref={canvasRef} style={{ width: '100%' }} />
}

export interface ThumbMenu {
  x: number
  y: number
  /** null = opened on the pane gap rather than a page; insert-only menu */
  origIdx: number | null
  /** gap menus: page the insert goes after (null = before the first page) */
  afterOrigIdx?: number | null
}

/** Read-only mirror of the pending-edit overlays, scaled into a page thumbnail so the
 *  sidebar tracks unsaved edits like the canvas does. Children render at scale 1 (display
 *  coords) and the container scales down; CSS kills all inner pointer events so thumbnail
 *  click/drag/context-menu behavior is untouched. */
export function ThumbPendingOverlay({
  geom,
  k,
  markups,
  drawings,
  textEdits,
  erasedText,
  textInserts,
  imageEdits,
  stamps,
}: {
  geom: PageGeom
  k: number
  markups: LocalMarkup[]
  drawings: LocalDrawing[]
  textEdits: LocalTextEdit[]
  /** textEraseKey of runs the page's live render already erased */
  erasedText?: Set<string>
  textInserts: LocalTextInsert[]
  imageEdits: LocalImageEdit[]
  stamps: StampInput[]
}): ReactElement {
  const disp = geomDispSize(geom)
  const noop = () => {}
  return (
    <div
      className="pdf-thumb-overlay"
      style={{ width: disp.width, height: disp.height, transform: `scale(${k})` }}
    >
      {imageEdits.length > 0 && (
        <ImageEditLayer
          geom={geom}
          scale={1}
          edits={imageEdits}
          existing={[]}
          selectedId={null}
          selectedKey={null}
          editHint=""
          onSelectEdit={noop}
          onSelectExisting={noop}
        />
      )}
      {stamps.map((s, si) => (
        <img
          key={si}
          className="pdf-stamp-preview"
          src={`data:image/png;base64,${s.image}`}
          alt=""
          style={{ ...pdfRectToCss(geom, s.rect, 1), opacity: s.opacity ?? 1 }}
        />
      ))}
      <MarkupOverlay markups={markups} geom={geom} scale={1} selectedId={null} />
      {drawings.length > 0 && (
        <DrawLayer
          geom={geom}
          scale={1}
          pageWidth={disp.width}
          pageHeight={disp.height}
          drawings={drawings}
          savedNotes={[]}
          activeNoteKey={null}
          noteOpenTitle=""
          tool={null}
          color={[0, 0, 0]}
          strokeWidth={STROKE_WIDTH}
          selectedId={null}
          selectTitle=""
          onCommit={noop}
          onNoteAt={noop}
          onNoteOpen={noop}
          onSelect={noop}
        />
      )}
      {textInserts.map((insert) => (
        <div
          key={insert.id}
          className="pdf-textinsert-preview"
          style={textInsertPreviewStyle(insert, geom, 1)}
        >
          {insert.input.text}
        </div>
      ))}
      {textEdits.map((te) => {
        const { style, coverStyle } = textEditPreviewParts(
          te,
          geom,
          1,
          !!erasedText?.has(textEraseKey(te.input)),
        )
        return (
          <Fragment key={te.id}>
            {coverStyle && <div className="pdf-textedit-cover" style={coverStyle} />}
            <div className="pdf-textedit-preview" style={style}>
              {textEditPreviewContent(te, 1)}
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}
