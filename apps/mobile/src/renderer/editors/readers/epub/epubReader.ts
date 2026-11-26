/**
 * One open EPUB document on the phone, without its screen: the book (opened
 * by the engine after the document switch), the chapter view on screen and
 * its `blob:` URLs, where the reader is (saved in batches), the device-wide
 * reader settings and the last search. It lives as long as the document, so
 * the Workspace can unmount (the settings screen) and mount again at the same
 * place.
 */
import type { EpubRefusalReason } from '@genoffice/epub-engine/core'
import {
  getReaderState,
  setReaderPosition,
  setReaderSettings,
  type ReaderSettings,
} from '@genoffice/mobile-bridge/readers'
import type { MobileClient, MobileDocSession } from '@genoffice/mobile-bridge/transport'
import {
  FIXED_FALLBACK,
  fixedViewport,
  type Size,
} from '../../../../../../epub/src/renderer/reader/preview-pages'
import type { EditorHost } from '../../editorKind'
import {
  currentTocIndex,
  firstChapter,
  openBook,
  tocEntries,
  type ReaderBook,
  type ReaderTocEntry,
} from './book'
import { buildChapterView, type ChapterView } from './chapterView'
import { normalizeQuery, searchBook, type BookSearchResult } from './search'
import { DEFAULT_READER_SETTINGS, snapReaderSettings } from './epubView'

/** Tunable timing: how long position writes are gathered before one is sent (ms). */
export const EPUB_READER_TUNING = { positionWriteMs: 1000 }

/** Where the reader is: a spine item and the first block on screen. */
export interface EpubPlace {
  spineIndex: number
  blockId: string | null
}

export interface EpubSearchState {
  query: string
  running: boolean
  result: BookSearchResult | null
}

export interface EpubReaderState {
  status: 'opening' | 'ready' | 'refused' | 'closed'
  reason: EpubRefusalReason | null
  settings: ReaderSettings
  search: EpubSearchState
}

/** A drawn chapter and, for a pre-paginated one, the size of its page. */
export interface LoadedChapter {
  view: ChapterView
  fixed: Size | null
}

export interface EpubReaderDeps {
  client: MobileClient
  session: Pick<MobileDocSession, 'docKey' | 'name'>
  /** the book bytes; the book takes them over */
  bytes: Uint8Array
  host: Pick<EditorHost, 'showToast' | 'translate'>
}

const NO_SEARCH: EpubSearchState = { query: '', running: false, result: null }

export class EpubReader {
  readonly client: MobileClient
  readonly host: EpubReaderDeps['host']
  private readonly docKey: string
  private state: EpubReaderState = {
    status: 'opening',
    reason: null,
    settings: DEFAULT_READER_SETTINGS,
    search: NO_SEARCH,
  }
  private readonly listeners = new Set<() => void>()
  private bookValue: ReaderBook | null = null
  private toc: ReaderTocEntry[] = []
  private current: LoadedChapter | null = null
  private placeValue: EpubPlace = { spineIndex: 0, blockId: null }
  private written: EpubPlace | null = null
  private writeTimer: ReturnType<typeof setTimeout> | null = null
  private searchToken = 0
  /** set once the refusal was shown, so a remounted screen does not show it again */
  refusalShown = false
  readonly ready: Promise<void>

  constructor(deps: EpubReaderDeps) {
    this.client = deps.client
    this.host = deps.host
    this.docKey = deps.session.docKey
    this.ready = this.open(deps.bytes)
  }

  private async open(bytes: Uint8Array): Promise<void> {
    const saved = getReaderState(this.client, this.docKey).catch(() => null)
    let opened: Awaited<ReturnType<typeof openBook>>
    try {
      opened = await openBook(bytes)
    } catch {
      opened = { ok: false, reason: 'damaged' }
    }
    const stored = await saved
    if (this.state.status === 'closed') {
      if (opened.ok) opened.book.dispose()
      return
    }
    if (!opened.ok) {
      this.set({ status: 'refused', reason: opened.reason })
      return
    }
    const book = opened.book
    this.bookValue = book
    this.toc = tocEntries(book)
    this.placeValue = restorePlace(book, stored?.position ?? null)
    this.written = this.placeValue
    this.set({ status: 'ready', settings: snapReaderSettings(stored?.settings ?? null) })
  }

  getState = (): EpubReaderState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private set(patch: Partial<EpubReaderState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  get book(): ReaderBook | null {
    return this.bookValue
  }

  get place(): EpubPlace {
    return this.placeValue
  }

  /** The chapter on screen (kept while the Workspace is unmounted). */
  get shown(): LoadedChapter | null {
    return this.current
  }

  get tocEntries(): readonly ReaderTocEntry[] {
    return this.toc
  }

  currentTocIndex(spineIndex: number): number {
    return this.bookValue ? currentTocIndex(this.bookValue, spineIndex) : -1
  }

  /** The chapter's name: its table-of-contents title, else "Chapter n". */
  chapterName(spineIndex: number): string {
    const at = this.currentTocIndex(spineIndex)
    const title = at >= 0 ? this.toc[at]?.title.trim() : ''
    return title || this.host.translate('readersEpubChapterFallback', { n: spineIndex + 1 })
  }

  /**
   * Draws a chapter; `viewCss` gets the page size of a pre-paginated chapter
   * (null otherwise). Null when the book is closed; throws when the chapter
   * cannot be drawn.
   */
  async loadChapter(
    spineIndex: number,
    viewCss: (fixed: Size | null) => string,
  ): Promise<LoadedChapter | null> {
    const book = this.bookValue
    if (!book || book.disposed) return null
    const item = book.epub.spine.items[spineIndex]
    if (!item) throw new Error('No such chapter.')
    let fixed: Size | null = null
    if (item.fixedLayout) {
      const source = await book.epub.readText(item.path)
      fixed = fixedViewport(source?.text ?? '') ?? FIXED_FALLBACK
    }
    const view = await buildChapterView(book, spineIndex, viewCss(fixed))
    if (!view) {
      if (book.disposed) return null
      throw new Error('The chapter could not be drawn.')
    }
    return { view, fixed }
  }

  /** The chapter now on screen; the one shown before releases its URLs. */
  showChapter(chapter: LoadedChapter): void {
    if (this.current && this.current.view !== chapter.view) this.current.view.release()
    this.current = chapter
  }

  /** Where the reader is now; written to the bridge after a short pause. */
  record(place: EpubPlace): void {
    this.placeValue = place
    if (!this.bookValue || this.state.status !== 'ready') return
    if (this.written && samePlace(this.written, place)) {
      this.cancelWrite()
      return
    }
    if (this.writeTimer !== null) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      this.flushPosition()
    }, EPUB_READER_TUNING.positionWriteMs)
  }

  private cancelWrite(): void {
    if (this.writeTimer !== null) clearTimeout(this.writeTimer)
    this.writeTimer = null
  }

  /** Writes the place now when it changed since the last write. */
  flushPosition(): void {
    this.cancelWrite()
    const book = this.bookValue
    const place = this.placeValue
    if (!book || (this.written && samePlace(this.written, place))) return
    const item = book.epub.spine.items[place.spineIndex]
    if (!item) return
    this.written = place
    void setReaderPosition(this.client, this.docKey, {
      kind: 'epub',
      spineIndex: place.spineIndex,
      href: item.path,
      blockId: place.blockId,
    }).catch(() => {})
  }

  /** Changes the device-wide reader settings and saves them. */
  updateSettings(patch: Partial<ReaderSettings>): void {
    const settings = snapReaderSettings({ ...this.state.settings, ...patch })
    this.set({ settings })
    void setReaderSettings(this.client, settings).catch(() => {})
  }

  /** Searches the book; a newer search (or an empty one) cancels the one running. */
  search(query: string): void {
    const token = ++this.searchToken
    const book = this.bookValue
    if (!book || normalizeQuery(query) === '') {
      this.set({ search: { query, running: false, result: null } })
      return
    }
    this.set({ search: { query, running: true, result: null } })
    void searchBook(book, { query, isCancelled: () => token !== this.searchToken })
      .then((result) => {
        if (token !== this.searchToken || result.cancelled) return
        this.set({ search: { query, running: false, result } })
      })
      .catch(() => {
        if (token === this.searchToken)
          this.set({ search: { query, running: false, result: null } })
      })
  }

  /** Closes the book: the last place is written, every URL revoked. */
  dispose(): void {
    if (this.state.status === 'closed') return
    this.flushPosition()
    this.searchToken++
    this.current?.view.release()
    this.current = null
    this.bookValue?.dispose()
    this.bookValue = null
    this.set({ status: 'closed', search: NO_SEARCH })
    this.listeners.clear()
  }
}

const samePlace = (a: EpubPlace, b: EpubPlace): boolean =>
  a.spineIndex === b.spineIndex && a.blockId === b.blockId

/**
 * The place a book opens at: the saved chapter (by index when the path still
 * matches, else by path) and block, else the first reading item.
 */
function restorePlace(
  book: ReaderBook,
  saved: Awaited<ReturnType<typeof getReaderState>>['position'],
): EpubPlace {
  const items = book.epub.spine.items
  if (saved && saved.kind === 'epub') {
    const index =
      Number.isSafeInteger(saved.spineIndex) && items[saved.spineIndex]?.path === saved.href
        ? saved.spineIndex
        : items.findIndex((item) => item.path === saved.href)
    if (index >= 0) return { spineIndex: index, blockId: saved.blockId ?? null }
  }
  return { spineIndex: firstChapter(book), blockId: null }
}

export function createEpubReader(deps: EpubReaderDeps): EpubReader {
  return new EpubReader(deps)
}
