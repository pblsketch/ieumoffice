// The phone's html2docx browser driver (spec 5.7). The desktop renders the document in an isolated
// window with its scripts on and drives it over CDP. The phone has neither: the document goes into
// a hidden frame that cannot run scripts (the same sandbox as the preview), and the converter's
// in-page code runs in this window with the frame's globals in scope. The document's own scripts
// never run. There is no page capture, so pictures that the converter would capture are lost,
// except plain images, which are drawn from their own pixels when the browser allows it.
import type { BrowserDriver, ScreenshotOptions, Viewport } from '@genoffice/html2docx'
import { PREVIEW_SANDBOX } from './htmlPreview'

/** The only "address" this driver loads: the HTML it was given, as the frame's srcdoc. */
export const EXPORT_DOCUMENT_URL = 'about:srcdoc'

/** The frame's sandbox: exactly the preview's (spec 8-1, never one that lets scripts run). */
export const EXPORT_SANDBOX = PREVIEW_SANDBOX

type Timers = Record<string, unknown>

interface FrameScope {
  readonly frame: Window
  readonly timers: Timers
}

/**
 * Runs `source` (a statement list or an expression) with the frame's globals in scope: every
 * free name the converter's code uses (`window`, `document`, `getComputedStyle`, `Node`,
 * `globalThis`, …) resolves to the frame's, so the code sees the frame document as if it ran
 * there. Timers come from this window: a frame that may not run scripts never fires its own.
 * Only `this` is read inside, so no name in the document (an element id) can stand in for ours.
 */
function compileInFrame(body: string): (this: FrameScope) => unknown {
  return new Function(`with (this.frame) { with (this.timers) {\n${body}\n} }`) as (
    this: FrameScope,
  ) => unknown
}

/** Timer functions of this window, in a scope object without a prototype (no stray names). */
function parentTimers(): Timers {
  const timers: Timers = Object.create(null)
  timers.setTimeout = (handler: TimerHandler, ms?: number, ...args: unknown[]) =>
    window.setTimeout(handler, ms, ...args)
  timers.clearTimeout = (id?: number) => window.clearTimeout(id)
  timers.setInterval = (handler: TimerHandler, ms?: number, ...args: unknown[]) =>
    window.setInterval(handler, ms, ...args)
  timers.clearInterval = (id?: number) => window.clearInterval(id)
  timers.requestAnimationFrame = (callback: FrameRequestCallback) =>
    window.requestAnimationFrame(callback)
  timers.cancelAnimationFrame = (id: number) => window.cancelAnimationFrame(id)
  timers.queueMicrotask = (callback: VoidFunction) => window.queueMicrotask(callback)
  return timers
}

/** What `executeJavaScript` would hand back: a copy of the value, nothing that refers into the frame. */
function cloneResult<T>(value: unknown): T {
  if (value === undefined || value === null || typeof value !== 'object') return value as T
  try {
    return structuredClone(value) as T
  } catch {
    // a value that cannot be copied (a FontFaceSet): the converter ignores those results
    return undefined as T
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

/** The rectangle an image's pixels fill in its box, for `object-fit` contain and cover. */
function fittedRect(
  fit: string,
  boxWidth: number,
  boxHeight: number,
  naturalWidth: number,
  naturalHeight: number,
): { x: number; y: number; width: number; height: number } {
  if (fit !== 'contain' && fit !== 'cover' && fit !== 'scale-down') {
    return { x: 0, y: 0, width: boxWidth, height: boxHeight }
  }
  const scaleX = boxWidth / naturalWidth
  const scaleY = boxHeight / naturalHeight
  let scale = fit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY)
  if (fit === 'scale-down') scale = Math.min(scale, 1)
  const width = naturalWidth * scale
  const height = naturalHeight * scale
  return { x: (boxWidth - width) / 2, y: (boxHeight - height) / 2, width, height }
}

export interface FrameDriverOptions {
  /** The document to convert; never written anywhere. */
  readonly html: string
  /** Where the hidden frame goes (default: this document's body). */
  readonly host?: HTMLElement
}

/**
 * html2docx's `BrowserDriver` over a hidden `sandbox="allow-same-origin"` frame. One conversion
 * per driver; `lostCaptures` counts the pictures the converter asked for and did not get.
 */
export class SandboxFrameDriver implements BrowserDriver {
  private readonly html: string
  private readonly host: HTMLElement
  private viewport: Viewport = { width: 794, height: 1123, deviceScaleFactor: 2 }
  private holder: HTMLDivElement | null = null
  private frame: HTMLIFrameElement | null = null
  private readonly timers = parentTimers()
  private closed = false
  /** Captures the converter asked for that this driver could not make. */
  lostCaptures = 0

  constructor(options: FrameDriverOptions) {
    this.html = options.html
    this.host = options.host ?? document.body
  }

  /** The frame now in use (tests look at its sandbox). */
  get frameElement(): HTMLIFrameElement | null {
    return this.frame
  }

  private frameWindow(): Window {
    const win = this.frame?.contentWindow
    if (!win || !this.frame?.contentDocument) throw new Error('html export: no document loaded')
    return win
  }

  private frameDocument(): Document {
    const doc = this.frame?.contentDocument
    if (!doc) throw new Error('html export: no document loaded')
    return doc
  }

  private sizeFrame(): void {
    if (!this.frame) return
    this.frame.style.width = `${this.viewport.width}px`
    this.frame.style.height = `${this.viewport.height}px`
  }

  private removeFrame(): void {
    this.frame?.remove()
    this.frame = null
  }

  async setViewport(viewport: Viewport): Promise<void> {
    this.viewport = { ...viewport }
    this.sizeFrame()
  }

  async goto(url: string, { timeoutMs }: { timeoutMs: number }): Promise<void> {
    if (this.closed) throw new Error('html export: driver closed')
    if (url !== EXPORT_DOCUMENT_URL) throw new Error('html export: only the given document loads')
    this.removeFrame()
    if (!this.holder) {
      // In the viewport but invisible and untouchable: offscreen frames may skip loading images.
      const holder = document.createElement('div')
      holder.setAttribute('aria-hidden', 'true')
      holder.setAttribute('data-testid', 'web-html-export-frame-holder')
      holder.inert = true
      Object.assign(holder.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        right: '0',
        bottom: '0',
        overflow: 'hidden',
        opacity: '0',
        pointerEvents: 'none',
        zIndex: '-1',
      })
      this.host.appendChild(holder)
      this.holder = holder
    }
    const frame = document.createElement('iframe')
    // the sandbox goes on before the document does
    frame.setAttribute('sandbox', EXPORT_SANDBOX)
    frame.setAttribute('tabindex', '-1')
    frame.setAttribute('data-testid', 'web-html-export-frame')
    Object.assign(frame.style, { position: 'absolute', left: '0', top: '0', border: '0' })
    this.frame = frame
    this.sizeFrame()
    const loaded = new Promise<void>((resolve) => {
      frame.addEventListener('load', () => resolve(), { once: true })
    })
    frame.srcdoc = this.html
    this.holder.appendChild(frame)
    // a stalled resource ends the wait: the converter goes on with what has rendered
    await Promise.race([loaded, sleep(timeoutMs)])
  }

  private run(body: string): unknown {
    return compileInFrame(body).call({ frame: this.frameWindow(), timers: this.timers })
  }

  async evaluate<T>(fn: string | ((arg?: any) => T | Promise<T>), arg?: unknown): Promise<T> {
    // the same text the desktop driver hands to executeJavaScript, run against the frame
    const expression =
      typeof fn === 'string'
        ? fn
        : `(${fn.toString()}\n)(${arg === undefined ? '' : JSON.stringify(arg)})`
    const value = await this.run(`return (${expression}\n)`)
    return cloneResult<T>(value)
  }

  async addScript(source: string): Promise<void> {
    this.run(source)
  }

  async addInitScript(_source: string): Promise<void> {
    // debug tracing only; nothing runs in the frame before its document
  }

  async screenshot(_options: ScreenshotOptions): Promise<Uint8Array> {
    // no page capture in a web view; the converter skips the picture and goes on
    this.lostCaptures++
    throw new Error('html export: page capture is not available on the phone')
  }

  async screenshotElement(
    selector: string,
    _options: Pick<ScreenshotOptions, 'omitBackground'>,
  ): Promise<Uint8Array | null> {
    const element = this.frameDocument().querySelector(selector)
    if (!element) return null
    const rect = element.getBoundingClientRect()
    if (Math.round(rect.width) <= 0 || Math.round(rect.height) <= 0) return null
    const drawn = await this.drawImage(element, rect)
    if (!drawn) this.lostCaptures++
    return drawn
  }

  /**
   * A plain image drawn from its own pixels at the box's size (no CSS effects). null for anything
   * else, and for an image the browser will not let us read (another site's picture).
   */
  private async drawImage(element: Element, rect: DOMRect): Promise<Uint8Array | null> {
    if (element.tagName !== 'IMG') return null
    const image = element as HTMLImageElement
    if (!image.complete || image.naturalWidth === 0 || image.naturalHeight === 0) return null
    const scale = this.viewport.deviceScaleFactor > 0 ? this.viewport.deviceScaleFactor : 1
    const width = Math.round(rect.width)
    const height = Math.round(rect.height)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) return null
    try {
      const fit = this.frameWindow().getComputedStyle(image).objectFit
      const target = fittedRect(fit, width, height, image.naturalWidth, image.naturalHeight)
      context.scale(scale, scale)
      context.drawImage(image, target.x, target.y, target.width, target.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      return blob ? new Uint8Array(await blob.arrayBuffer()) : null
    } catch {
      // a picture from another site taints the canvas: it cannot be read back
      return null
    }
  }

  async elementExists(selector: string): Promise<boolean> {
    return this.frameDocument().querySelector(selector) !== null
  }

  async close(): Promise<void> {
    this.closed = true
    this.removeFrame()
    this.holder?.remove()
    this.holder = null
  }
}
