/**
 * Offscreen PowerPoint slide-to-PDF exporter (lazy-loaded on print / PDF share).
 *
 * Renders one slide at a time onto an offscreen container using the PC `SlideThumb` (Konva)
 * component with `Konva.pixelRatio = 1` (preventing 3x DPR memory spikes on mobile), waits
 * for actual Konva canvas frames, encodes to JPEG, and immediately zeroes canvases and
 * releases the slide's media URLs.
 */
import Konva from 'konva'
import { createRoot } from 'react-dom/client'
import { SlideThumb } from '../../../../../../slides/src/renderer/SlideThumb'
import {
  assembleImagesToPdf,
  markdownToPrintHtml,
  renderHtmlToPdfBytes,
  type RasterPdfPageInput,
} from '../../shared/pdfExport'
import type { PptxController, PptxSlideEntry } from './pptxDocument'

/** 1280px matches PC FIT_WIDTH (~150-200dpi across A4 landscape) while keeping memory modest. */
const EXPORT_SLIDE_WIDTH_PX = 1280
const EXPORT_SLIDE_WIDTH_PT = 792

function nextAnimationFrame(): Promise<void> {
  if (typeof requestAnimationFrame === 'function') {
    return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
  return new Promise<void>((resolve) => setTimeout(resolve, 16))
}

async function waitForPaintedCanvases(host: HTMLElement): Promise<HTMLCanvasElement[]> {
  // Poll across animation frames up to ~500ms so slow mobile devices finish Konva's first paint.
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await nextAnimationFrame()
    const canvases = Array.from(host.querySelectorAll('canvas')).filter(
      (c) => c.width > 0 && c.height > 0,
    )
    if (canvases.length > 0) {
      // Allow one extra frame for Konva's batched layer draw to complete.
      await nextAnimationFrame()
      return canvases
    }
  }
  return []
}

function hasCanvas2dSupport(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const probe = document.createElement('canvas')
    const ctx = probe.getContext('2d')
    probe.width = 0
    probe.height = 0
    return Boolean(ctx)
  } catch {
    return false
  }
}

async function captureSlideEntryJpeg(
  entry: PptxSlideEntry,
  aspect: number,
  quality: number,
): Promise<RasterPdfPageInput | null> {
  if (typeof document === 'undefined' || !document.body || !entry.slide) return null
  const heightPx = Math.max(1, Math.round(EXPORT_SLIDE_WIDTH_PX * aspect))
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = `position:fixed;left:-30000px;top:0;width:${EXPORT_SLIDE_WIDTH_PX}px;height:${heightPx}px;pointer-events:none;overflow:hidden;`
  document.body.appendChild(host)
  const root = createRoot(host)
  const prevPixelRatio = Konva.pixelRatio

  try {
    // Force 1x DPR for offscreen export so high-DPI phones do not allocate 3x (~33 MB/layer) buffers.
    Konva.pixelRatio = 1
    root.render(
      <SlideThumb slide={entry.slide} images={entry.images} width={EXPORT_SLIDE_WIDTH_PX} />,
    )
    const canvases = await waitForPaintedCanvases(host)
    if (canvases.length === 0) return null

    const out = document.createElement('canvas')
    out.width = EXPORT_SLIDE_WIDTH_PX
    out.height = heightPx
    try {
      const ctx = out.getContext('2d')
      if (!ctx) return null
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, out.width, out.height)
      for (const layer of canvases) {
        ctx.drawImage(layer, 0, 0, out.width, out.height)
      }
      const blob = await new Promise<Blob | null>((resolve) =>
        out.toBlob(resolve, 'image/jpeg', quality),
      )
      if (!blob) return null
      const bytes = new Uint8Array(await blob.arrayBuffer())
      return {
        bytes,
        mime: 'image/jpeg',
        widthPt: EXPORT_SLIDE_WIDTH_PT,
        heightPt: Math.max(72, Math.round(EXPORT_SLIDE_WIDTH_PT * aspect)),
      }
    } finally {
      out.width = 0
      out.height = 0
      for (const layer of canvases) {
        layer.width = 0
        layer.height = 0
      }
    }
  } finally {
    Konva.pixelRatio = prevPixelRatio
    root.unmount()
    host.remove()
  }
}

/** Exports all slides of `controller` as a multi-page PDF. */
export async function exportPptxToPdf(
  controller: PptxController,
  fileName: string,
): Promise<Uint8Array> {
  const status = await controller.waitReady()
  if (status !== 'ready') throw new Error('PPTX deck is not ready')
  const count = controller.slideCount()
  if (count === 0) throw new Error('PPTX deck has no slides')
  const aspect = controller.aspect()
  const quality = count > 40 ? 0.75 : count > 20 ? 0.82 : 0.88

  if (hasCanvas2dSupport()) {
    const pages: RasterPdfPageInput[] = []
    let failedCount = 0
    for (let i = 0; i < count; i += 1) {
      const captured = await controller.withExportSlide(i, EXPORT_SLIDE_WIDTH_PX, (entry) =>
        captureSlideEntryJpeg(entry, aspect, quality),
      )
      if (captured) pages.push(captured)
      else failedCount += 1
    }
    if (pages.length === 0 || failedCount > 0) {
      throw new Error(`Failed to render ${failedCount} of ${count} PowerPoint slides to PDF`)
    }
    return assembleImagesToPdf(pages)
  }

  // Headless/jsdom environment without HTML5 Canvas support: render slide text outline.
  const sections: string[] = []
  for (let i = 0; i < count; i += 1) {
    const text = controller.slideText(i).trim()
    sections.push(`# Slide ${i + 1}\n\n${text || '(Empty slide)'}`)
  }
  const html = markdownToPrintHtml(sections.join('\n\n---\n\n'), fileName)
  const fallback = await renderHtmlToPdfBytes(html, { title: fileName })
  return fallback.bytes
}
