import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const { layers } = vi.hoisted(() => ({ layers: [] as { cancel: ReturnType<typeof vi.fn> }[] }))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  AnnotationMode: { ENABLE_FORMS: 2 },
  TextLayer: class {
    cancel = vi.fn()
    constructor() {
      layers.push(this)
    }
    render() {
      return Promise.resolve()
    }
  },
}))
import { PdfPage } from '../src/renderer/PdfPage'
import { bindFileViewRenderer, forgetFileViewRenderer } from '../src/renderer/view-renderer'
import type { PdfViewApi } from '../src/shared/view-source'

function makePdf() {
  const tasks: { promise: Promise<void>; resolve(): void; cancel: ReturnType<typeof vi.fn> }[] = []
  const page = {
    rotate: 0,
    cleanup: vi.fn(),
    getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale }),
    streamTextContent: vi.fn(),
    render: vi.fn(() => {
      let resolve!: () => void
      const promise = new Promise<void>((done) => {
        resolve = done
      })
      const task = { promise, resolve, cancel: vi.fn(() => resolve()) }
      tasks.push(task)
      return task
    }),
  }
  const doc = { getPage: vi.fn(async () => page) } as unknown as PDFDocumentProxy
  return { doc, page, tasks }
}

let root: Root | null = null
let container: HTMLDivElement | null = null
const onRenderState = vi.fn()

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 })
})
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  container?.remove()
  root = null
  container = null
  layers.length = 0
  onRenderState.mockClear()
})

async function show(doc: PDFDocumentProxy, visible: boolean, scale = 1) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }
  await act(async () => {
    root!.render(
      createElement(PdfPage, { doc, pageNo: 1, visible, scale, rotationDelta: 0, onRenderState }),
    )
  })
}

describe('PdfPage resource lifecycle', () => {
  it('reuses a completed immutable bitmap after leaving and returning without losing its pixels', async () => {
    const { doc } = makePdf()
    const paint = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    vi.stubGlobal('ImageData', class {})
    const render = vi.fn(async () => ({ width: 100, height: 200, rgba: new ArrayBuffer(80_000) }))
    bindFileViewRenderer(
      doc,
      { id: 'immutable', length: 100, hasXfa: false, initialData: new ArrayBuffer(0) },
      { renderViewPage: render, cancelViewRender: async () => {} } as unknown as PdfViewApi,
    )
    try {
      await show(doc, true)
      const original = container!.querySelector('canvas')!
      expect(original.width).toBe(100)
      await show(doc, false)
      expect(original.width).toBe(100)
      await show(doc, true)
      expect(container!.querySelector('canvas')).toBe(original)
      expect(original.width).toBe(100)
      expect(render).toHaveBeenCalledOnce()
    } finally {
      forgetFileViewRenderer(doc)
      paint.mockRestore()
      vi.unstubAllGlobals()
    }
  })
  it('releases the text layer, canvas pixels and decoded images when scrolled out', async () => {
    const { doc, page, tasks } = makePdf()
    await show(doc, true)
    await act(async () => tasks[0]!.resolve())
    const canvas = container!.querySelector('canvas')!
    expect(canvas.width).toBe(100)
    await show(doc, false)
    expect(layers[0]!.cancel).toHaveBeenCalledOnce()
    expect(canvas.width).toBe(0)
    expect(canvas.height).toBe(0)
    expect(container!.querySelector('canvas')).toBeNull()
    expect(page.cleanup).toHaveBeenCalledOnce()
  })

  it('keeps the previous bitmap through zoom until a completed replacement swaps in', async () => {
    const { doc, page, tasks } = makePdf()
    await show(doc, true)
    await act(async () => tasks[0]!.resolve())
    const previous = container!.querySelector('canvas')!
    expect(page.cleanup).toHaveBeenCalledOnce()
    await show(doc, true, 2)
    expect(container!.querySelector('canvas')).toBe(previous)
    expect(previous.width).toBe(100)
    expect(page.cleanup).toHaveBeenCalledOnce()
    await act(async () => tasks[1]!.resolve())
    expect(container!.querySelector('canvas')!.width).toBe(200)
    expect(previous.width).toBe(0)
    expect(page.cleanup).toHaveBeenCalledTimes(2)
  })

  it('cancels a pending render and never mounts a stale bitmap after leaving', async () => {
    const { doc, page, tasks } = makePdf()
    await show(doc, true)
    await show(doc, false)
    expect(tasks[0]!.cancel).toHaveBeenCalledOnce()
    expect(container!.querySelector('canvas')).toBeNull()
    expect(layers).toHaveLength(0)
    expect(page.cleanup).toHaveBeenCalledOnce()
  })
})
