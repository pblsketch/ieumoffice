/**
 * The open PowerPoint deck of one reader document: opening, the current slide, the render
 * data and images of the slides some view holds, the remembered position and the notes
 * panel setting. Lives in the EditorDocument closure, so a Workspace that mounts again
 * (after the settings screen) finds the same deck and the same slide.
 *
 * Loaded with a dynamic import from pptxKind.tsx: it pulls in the engine.
 */
import type { RenderSlide } from '@genoffice/pptx-render'
import {
  getReaderState,
  setReaderPosition,
  setReaderSettings,
  type ReaderPosition,
  type ReaderSettings,
} from '@genoffice/mobile-bridge/readers'
import type { MobileClient } from '@genoffice/mobile-bridge/transport'
import { openDeck, type PptxDeck } from './deck'
import { loadSlideImages, slideImageUrls, type ImageLoad } from './images'

/**
 * Width the render data is built at, the PC slides app's FIT_WIDTH: one width for every
 * screen keeps the adapter's cache warm and the text layout the same as on the PC.
 * SlideThumb scales the drawing to the width on screen.
 */
export const PPTX_RENDER_WIDTH_PX = 1280

/** Reader settings when none are stored yet (the EPUB reader shares this record). */
export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontScale: 1,
  lineHeight: null,
  theme: 'app',
  layout: 'paged',
  notesOpen: false,
}

/** Default wait before a changed slide is written as the reading position. */
export const PPTX_POSITION_DELAY_MS = 1000

export type PptxStatus = 'opening' | 'ready' | 'failed'

/** What a view draws for one slide. */
export interface PptxSlideEntry {
  /** null when the slide could not be built */
  readonly slide: RenderSlide | null
  readonly failed: boolean
  /** Decoded images so far; a new map each time one more arrives */
  readonly images: Map<string, HTMLImageElement>
}

export interface PptxController {
  /** performance.now() when opening began (the opening placeholder waits from here) */
  readonly startedAt: number
  status(): PptxStatus
  /** Changes on every state change (for useSyncExternalStore) */
  version(): number
  subscribe(listener: () => void): () => void
  slideCount(): number
  /** Slide height / width */
  aspect(): number
  current(): number
  goTo(index: number): void
  /** The entry of a slide some view holds, or undefined */
  entry(index: number): PptxSlideEntry | undefined
  /**
   * The slides one view (owner) shows now. Slides no view holds any more are released:
   * their render data and image URLs go.
   */
  hold(owner: string, indices: readonly number[]): void
  isHidden(index: number): boolean
  slideText(index: number): string
  slideNotes(index: number): string
  notesOpen(): boolean
  setNotesOpen(open: boolean): void
  /** True once after opening failed: the view that sees it shows the toast and goes back */
  takeFailure(): boolean
  /** Writes a pending position now */
  flushPosition(): Promise<void>
  /** Resolves once the deck has finished opening (ready or failed). */
  waitReady(): Promise<PptxStatus>
  /**
   * Builds render data and decoded images for one slide at `widthPx`, passes it to `visitor`,
   * and immediately releases the slide when not held by another view (keeps peak memory bounded).
   */
  withExportSlide<T>(
    index: number,
    widthPx: number,
    visitor: (entry: PptxSlideEntry) => Promise<T>,
  ): Promise<T>
  dispose(): void
}

export interface PptxControllerOptions {
  readonly client: MobileClient
  readonly docKey: string
  readonly base64: string | null
  readonly positionDelayMs?: number
}

interface LiveEntry {
  slide: RenderSlide | null
  failed: boolean
  images: Map<string, HTMLImageElement>
  load: ImageLoad | null
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** The slide to show for a remembered position: by part path, else by index, else the first. */
export function restoredSlideIndex(
  position: ReaderPosition | null | undefined,
  deck: Pick<PptxDeck, 'slideCount' | 'indexOfPath'>,
): number {
  if (!position || position.kind !== 'pptx' || deck.slideCount === 0) return 0
  const byPath = deck.indexOfPath(position.partPath)
  if (byPath >= 0) return byPath
  const index = position.slideIndex
  return Number.isInteger(index) && index >= 0 && index < deck.slideCount ? index : 0
}

export function createPptxController(options: PptxControllerOptions): PptxController {
  const { client, docKey } = options
  const positionDelayMs = options.positionDelayMs ?? PPTX_POSITION_DELAY_MS
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const listeners = new Set<() => void>()
  const entries = new Map<number, LiveEntry>()
  const holders = new Map<string, readonly number[]>()

  let base64: string | null = options.base64
  let deck: PptxDeck | null = null
  let status: PptxStatus = 'opening'
  let failurePending = false
  let disposed = false
  let version = 0
  let current = 0
  let notesOpen = DEFAULT_READER_SETTINGS.notesOpen
  let positionTimer: ReturnType<typeof setTimeout> | null = null
  let positionDirty = false
  let writes: Promise<void> = Promise.resolve()

  const notify = () => {
    version += 1
    for (const listener of [...listeners]) listener()
  }

  /** Serializes bridge writes so a later value never lands before an earlier one. */
  const queueWrite = (write: () => Promise<void>): Promise<void> => {
    writes = writes.then(write).catch(() => {
      // A position or setting that did not save is not worth an error on screen.
    })
    return writes
  }

  const writePosition = (): Promise<void> => {
    if (positionTimer) clearTimeout(positionTimer)
    positionTimer = null
    if (!positionDirty || !deck || deck.slideCount === 0) return writes
    positionDirty = false
    const position: ReaderPosition = {
      kind: 'pptx',
      slideIndex: current,
      partPath: deck.slidePath(current),
    }
    return queueWrite(() => setReaderPosition(client, docKey, position))
  }

  const releaseEntry = (index: number) => {
    const entry = entries.get(index)
    if (!entry) return
    entries.delete(index)
    entry.load?.cancel()
    deck?.releaseSlide(index)
  }

  const buildEntry = (index: number) => {
    if (!deck || entries.has(index)) return
    const entry: LiveEntry = { slide: null, failed: false, images: new Map(), load: null }
    entries.set(index, entry)
    try {
      entry.slide = deck.renderSlide(index, PPTX_RENDER_WIDTH_PX)
    } catch {
      entry.failed = true
      return
    }
    const urls = slideImageUrls(entry.slide)
    if (urls.length === 0) return
    entry.load = loadSlideImages(urls, (images) => {
      if (entries.get(index) !== entry) return
      entry.images = images
      notify()
    })
  }

  /** Builds what the holders need and releases the rest. */
  const syncHeld = () => {
    if (!deck) return
    const wanted = new Set<number>()
    for (const indices of holders.values()) {
      for (const index of indices) {
        if (Number.isInteger(index) && index >= 0 && index < deck.slideCount) wanted.add(index)
      }
    }
    let changed = false
    for (const index of [...entries.keys()]) {
      if (!wanted.has(index)) {
        releaseEntry(index)
        changed = true
      }
    }
    for (const index of wanted) {
      if (!entries.has(index)) {
        buildEntry(index)
        changed = true
      }
    }
    if (changed) notify()
  }

  const open = async () => {
    const encoded = base64
    base64 = null
    const statePromise = getReaderState(client, docKey).catch(() => null)
    let opened: PptxDeck
    try {
      if (encoded === null) throw new Error('pptx bytes are gone')
      let bytes: Uint8Array | null = decodeBase64(encoded)
      const pending = openDeck(bytes)
      // The engine keeps what it needs; this module holds no reference to the input.
      bytes = null
      opened = await pending
    } catch {
      if (disposed) return
      status = 'failed'
      failurePending = true
      notify()
      return
    }
    const state = await statePromise
    if (disposed) {
      opened.dispose()
      return
    }
    deck = opened
    notesOpen = state?.settings?.notesOpen ?? DEFAULT_READER_SETTINGS.notesOpen
    current = restoredSlideIndex(state?.position, opened)
    status = 'ready'
    syncHeld()
    notify()
  }

  const openPromise = open()

  return {
    startedAt,
    status: () => status,
    version: () => version,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    slideCount: () => deck?.slideCount ?? 0,
    aspect: () => (deck && deck.size.cx > 0 ? deck.size.cy / deck.size.cx : 9 / 16),
    current: () => current,
    goTo(index) {
      if (!deck || deck.slideCount === 0) return
      const next = Math.min(Math.max(0, Math.trunc(index)), deck.slideCount - 1)
      if (next === current) return
      current = next
      positionDirty = true
      if (positionTimer) clearTimeout(positionTimer)
      positionTimer = setTimeout(() => void writePosition(), positionDelayMs)
      notify()
    },
    entry(index) {
      const entry = entries.get(index)
      return entry ? { slide: entry.slide, failed: entry.failed, images: entry.images } : undefined
    },
    hold(owner, indices) {
      if (indices.length === 0) holders.delete(owner)
      else holders.set(owner, [...indices])
      syncHeld()
    },
    isHidden: (index) => (deck ? deck.isHidden(index) : false),
    slideText: (index) => (deck ? deck.slideText(index) : ''),
    slideNotes: (index) => (deck ? deck.slideNotes(index) : ''),
    notesOpen: () => notesOpen,
    setNotesOpen(open) {
      if (open === notesOpen) return
      notesOpen = open
      notify()
      // Keep the other reader settings as stored (the EPUB reader shares the record).
      void queueWrite(async () => {
        const state = await getReaderState(client, docKey).catch(() => null)
        const base = state?.settings ?? DEFAULT_READER_SETTINGS
        await setReaderSettings(client, { ...base, notesOpen: open })
      })
    },
    takeFailure() {
      if (!failurePending) return false
      failurePending = false
      return true
    },
    flushPosition: writePosition,
    async waitReady() {
      await openPromise
      return status
    },
    async withExportSlide(index, widthPx, visitor) {
      await openPromise
      if (!deck || disposed) {
        return visitor({ slide: null, failed: true, images: new Map() })
      }
      const alreadyHeld = [...holders.values()].some((list) => list.includes(index))
      let slide: RenderSlide | null = null
      let failed = false
      let images = new Map<string, HTMLImageElement>()
      let load: ImageLoad | null = null
      try {
        slide = deck.renderSlide(index, widthPx)
        const urls = slideImageUrls(slide)
        if (urls.length > 0) {
          images = await new Promise<Map<string, HTMLImageElement>>((resolve) => {
            let latest = new Map<string, HTMLImageElement>()
            let settled = false
            const finish = (finalMap?: Map<string, HTMLImageElement>) => {
              if (settled) return
              settled = true
              clearTimeout(timer)
              resolve(finalMap ?? latest)
            }
            const timer = setTimeout(() => finish(), 3000)
            load = loadSlideImages(
              urls,
              (map) => {
                latest = map
              },
              (finalMap) => finish(finalMap),
            )
          })
        }
      } catch {
        failed = true
      }
      try {
        return await visitor({ slide, failed, images })
      } finally {
        ;(load as ImageLoad | null)?.cancel()
        if (!alreadyHeld && !disposed) {
          deck?.releaseSlide(index)
        }
      }
    },
    dispose() {
      if (disposed) return
      void writePosition()
      disposed = true
      base64 = null
      for (const index of [...entries.keys()]) releaseEntry(index)
      holders.clear()
      deck?.dispose()
      deck = null
      listeners.clear()
    },
  }
}
