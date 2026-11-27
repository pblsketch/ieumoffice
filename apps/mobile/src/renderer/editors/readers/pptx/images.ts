/**
 * Images of one rendered slide: collecting their URLs from the render tree, and loading
 * them into the `Map<url, HTMLImageElement>` the PC `SlideThumb` draws from.
 *
 * The collection covers the places the PC slides app collects (apps/slides/src/renderer/App.tsx,
 * the image-loading effect): picture nodes, image fills of shapes and the slide background,
 * picture bullets, table cell fills, chart backgrounds and bar fills, group children. It also
 * takes the image fills the PC leaves out (a picture's backdrop fill, a shape's fill overlay,
 * a table's background, a chart's plot area), which the drawing code can paint as well.
 *
 * The loader is small and our own: the PC one rasterizes metafiles through the Word engine,
 * which the mobile bundle does not carry. EMF/WMF URLs are skipped and stay missing images.
 */
import type { RenderFill, RenderNode, RenderSlide, RenderTextLayout } from '@genoffice/pptx-render'
import { isMetafileUrl } from './media'

/** Every image URL in a rendered slide, each once, in the order found */
export function slideImageUrls(slide: RenderSlide): string[] {
  const urls = new Set<string>()
  const addFill = (fill: RenderFill | undefined): void => {
    if (fill?.kind === 'image' && fill.dataUrl) urls.add(fill.dataUrl)
  }
  const addBullets = (text: RenderTextLayout | undefined): void => {
    for (const line of text?.lines ?? [])
      for (const run of line.runs) if (run.image) urls.add(run.image)
  }
  const walk = (nodes: readonly RenderNode[]): void => {
    for (const node of nodes) {
      switch (node.type) {
        case 'picture':
          if (node.dataUrl) urls.add(node.dataUrl)
          addFill(node.fill)
          break
        case 'shape':
        case 'text':
          addFill(node.fill)
          addFill(node.fillOverlay)
          addBullets(node.text)
          break
        case 'group':
          walk(node.children)
          break
        case 'table':
          addFill(node.bgFill)
          for (const cell of node.cells) {
            addFill(cell.fill)
            addBullets(cell.text)
          }
          break
        case 'chart':
          addFill(node.bgFill)
          addFill(node.plotRect?.fill)
          for (const bar of node.bars) addFill(bar.fill)
          break
        case 'placeholder-chip':
          break
      }
    }
  }
  addFill(slide.background)
  walk(slide.nodes)
  return [...urls]
}

export interface ImageLoad {
  /** Stops loading: no further calls to `onLoaded`, pending images are let go */
  cancel(): void
}

/**
 * Loads the URLs as images. `onLoaded` gets a new map (all images decoded so far) each time
 * one more finishes, so the caller can draw before every image is in. `onDone`, when given,
 * runs once every non-metafile image has either loaded or failed (or immediately if none).
 * Images that fail and EMF/WMF URLs are left out of the map.
 */
export function loadSlideImages(
  urls: readonly string[],
  onLoaded: (images: Map<string, HTMLImageElement>) => void,
  onDone?: (images: Map<string, HTMLImageElement>) => void,
): ImageLoad {
  const loaded = new Map<string, HTMLImageElement>()
  const pending = new Set<HTMLImageElement>()
  let cancelled = false
  let doneCalled = false

  const maybeFinish = (): void => {
    if (cancelled || doneCalled || pending.size > 0) return
    doneCalled = true
    onDone?.(new Map(loaded))
  }

  const settle = (img: HTMLImageElement): void => {
    img.onload = null
    img.onerror = null
    pending.delete(img)
  }

  for (const url of new Set(urls)) {
    if (isMetafileUrl(url)) continue
    const img = document.createElement('img')
    img.decoding = 'async'
    img.onload = () => {
      settle(img)
      if (cancelled) return
      loaded.set(url, img)
      onLoaded(new Map(loaded))
      maybeFinish()
    }
    img.onerror = () => {
      settle(img)
      maybeFinish()
    }
    pending.add(img)
    img.src = url
  }

  if (pending.size === 0) {
    queueMicrotask(maybeFinish)
  }

  return {
    cancel() {
      if (cancelled) return
      cancelled = true
      for (const img of [...pending]) {
        settle(img)
        img.removeAttribute('src')
      }
    },
  }
}
