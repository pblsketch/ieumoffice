import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { PdfViewTile } from '../shared/view-source'
import { releaseCanvasPixels } from './page-resources'
import { renderViewBitmap, type ViewRenderTask } from './view-bitmap'

const TILE_SIZE = 512

/** Cover the viewport and one nearby tile without allocating a full zoomed page. */
export function visiblePageTiles(
  width: number,
  height: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): PdfViewTile[] {
  if (right <= 0 || bottom <= 0 || left >= width || top >= height) return []
  const x0 = Math.max(0, Math.floor(left / TILE_SIZE) - 1)
  const y0 = Math.max(0, Math.floor(top / TILE_SIZE) - 1)
  const x1 = Math.min(Math.ceil(width / TILE_SIZE), Math.ceil(right / TILE_SIZE) + 1)
  const y1 = Math.min(Math.ceil(height / TILE_SIZE), Math.ceil(bottom / TILE_SIZE) + 1)
  const tiles: PdfViewTile[] = []
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      tiles.push({
        x: x * TILE_SIZE,
        y: y * TILE_SIZE,
        width: Math.min(TILE_SIZE, width - x * TILE_SIZE),
        height: Math.min(TILE_SIZE, height - y * TILE_SIZE),
      })
    }
  const cx = (left + right) / 2,
    cy = (top + bottom) / 2
  return tiles.sort(
    (a, b) =>
      Math.hypot(a.x + a.width / 2 - cx, a.y + a.height / 2 - cy) -
      Math.hypot(b.x + b.width / 2 - cx, b.y + b.height / 2 - cy),
  )
}

/** Native and fallback renders share the full page transform and editable DOM layers. */
export function renderViewportTiles(
  doc: PDFDocumentProxy,
  page: PDFPageProxy,
  pageNo: number,
  viewport: ReturnType<PDFPageProxy['getViewport']>,
  dpr: number,
  rotation: number,
  holder: HTMLElement,
  surface: HTMLElement,
): ViewRenderTask {
  const root = holder.closest<HTMLElement>('.pdf-scroll')
  const width = Math.floor(viewport.width * dpr),
    height = Math.floor(viewport.height * dpr)
  const tiles = new Map<string, { canvas: HTMLCanvasElement; task: ViewRenderTask }>()
  let stopped = false
  let frame: number | undefined
  let initial = true
  let revision = 0
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  const update = () => {
    frame = undefined
    if (stopped) return
    const generation = ++revision
    const box = holder.getBoundingClientRect()
    const clip = root?.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
    }
    const wanted = visiblePageTiles(
      width,
      height,
      (clip.left - box.left) * dpr,
      (clip.top - box.top) * dpr,
      (clip.right - box.left) * dpr,
      (clip.bottom - box.top) * dpr,
    )
    const keys = new Set(wanted.map((tile) => `${tile.x}:${tile.y}`))
    for (const [key, tile] of tiles)
      if (!keys.has(key)) {
        tile.task.cancel()
        tile.canvas.remove()
        // An active fallback still owns its canvas until its promise settles.
        void tile.task.promise.finally(() => releaseCanvasPixels(tile.canvas)).catch(() => {})
        tiles.delete(key)
      }
    const pending: Promise<unknown>[] = []
    for (const tile of wanted) {
      const key = `${tile.x}:${tile.y}`
      let entry = tiles.get(key)
      if (!entry) {
        const canvas = document.createElement('canvas')
        canvas.width = tile.width
        canvas.height = tile.height
        canvas.style.left = `${tile.x / dpr}px`
        canvas.style.top = `${tile.y / dpr}px`
        canvas.style.width = `${tile.width / dpr}px`
        canvas.style.height = `${tile.height / dpr}px`
        const task = renderViewBitmap(
          doc,
          page,
          pageNo,
          {
            canvas,
            viewport,
            annotationMode: 2,
            transform: [dpr, 0, 0, dpr, -tile.x, -tile.y],
          },
          rotation,
          false,
          tile,
        )
        entry = { canvas, task }
        tiles.set(key, entry)
        void task.promise
          .then(() => {
            if (!stopped && tiles.get(key)?.canvas === canvas) surface.append(canvas)
          })
          .catch(() => {})
      }
      pending.push(entry.task.promise)
    }
    if (initial) {
      void Promise.all(pending).then(
        () => {
          if (stopped || generation !== revision) return
          initial = false
          resolve()
        },
        (error: unknown) => {
          if (!stopped && generation === revision) reject(error)
        },
      )
    }
  }
  const schedule = () => {
    if (!stopped && frame === undefined) frame = requestAnimationFrame(update)
  }
  root?.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
  update()
  return {
    promise,
    cancel() {
      stopped = true
      root?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame !== undefined) cancelAnimationFrame(frame)
      for (const entry of tiles.values()) {
        entry.task.cancel()
        void entry.task.promise
          .finally(() => {
            if (!holder.contains(entry.canvas)) releaseCanvasPixels(entry.canvas)
          })
          .catch(() => {})
      }
      tiles.clear()
    },
  }
}
