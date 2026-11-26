/**
 * An open EPUB book on the phone: opening through the engine's read side,
 * the facts the reading screen needs, reading order and the table of
 * contents, and closing (every `blob:` URL still alive is revoked).
 */
import { openEpub, type EpubBook, type EpubRefusalReason } from '@genoffice/epub-engine/core'
import {
  currentTocEntry,
  firstReadingIndex,
  nextReadingIndex,
} from '../../../../../../epub/src/renderer/reader/navigation'
import { revokeRecord, type UrlRecord } from './resources'

/** What the reading screen shows about the whole book. */
export interface BookFacts {
  title: string
  creators: string[]
  languages: string[]
  /** spine items, the chapters that can be drawn */
  chapterCount: number
  /** the whole book is pre-paginated */
  fixedLayout: boolean
  /** vertical writing per `primary-writing-mode` or the book's CSS */
  verticalWriting: boolean
  /** pages turn right to left (`page-progression-direction="rtl"`) */
  rtl: boolean
}

/** An opened book: the engine's book plus the URLs its chapter views hold. */
export class ReaderBook {
  readonly facts: BookFacts
  private readonly live = new Set<UrlRecord>()
  private closed = false
  /** @internal reading texts for search, by spine index */
  readonly searchTexts = new Map<number, string>()

  constructor(readonly epub: EpubBook) {
    this.facts = {
      title: epub.metadata.title,
      creators: [...epub.metadata.creators],
      languages: [...epub.metadata.languages],
      chapterCount: epub.spine.items.length,
      fixedLayout: epub.fixedLayout,
      verticalWriting: epub.verticalWriting,
      rtl: epub.spine.pageProgressionDirection === 'rtl',
    }
  }

  get disposed(): boolean {
    return this.closed
  }

  /** @internal A fresh URL record for one chapter view; already released once the book is closed. */
  track(): UrlRecord {
    const record: UrlRecord = { urls: [], released: this.closed }
    if (!this.closed) this.live.add(record)
    return record
  }

  /** @internal Revokes one chapter view's URLs. Calling it again does nothing. */
  release(record: UrlRecord): void {
    this.live.delete(record)
    if (!record.released) revokeRecord(record)
  }

  /** Revokes every URL still alive and refuses new chapter views. Safe to call twice. */
  dispose(): void {
    this.closed = true
    for (const record of this.live) revokeRecord(record)
    this.live.clear()
    this.searchTexts.clear()
  }
}

export type OpenBookResult =
  { ok: true; book: ReaderBook } | { ok: false; reason: EpubRefusalReason }

/**
 * Opens book bytes. The book reads from these bytes as they are
 * (`takeOwnership`): the caller must not change them afterwards. A refusal
 * reason is returned unchanged for the screen to word.
 */
export async function openBook(bytes: Uint8Array): Promise<OpenBookResult> {
  const result = await openEpub(bytes, { takeOwnership: true })
  if (!result.ok) return { ok: false, reason: result.reason }
  return { ok: true, book: new ReaderBook(result.book) }
}

/** The chapter a book opens at when nothing was remembered: the first linear item. */
export function firstChapter(book: ReaderBook): number {
  return firstReadingIndex(book.epub.spine.items)
}

/** The next (1) or previous (-1) chapter in the reading flow, skipping `linear="no"`; null at either end. */
export function nextChapter(book: ReaderBook, from: number, dir: 1 | -1): number | null {
  return nextReadingIndex(book.epub.spine.items, from, dir)
}

/** The index in `tocEntries` of the entry for the chapter being read; -1 when none comes before. */
export function currentTocIndex(book: ReaderBook, spineIndex: number): number {
  return currentTocEntry(book.epub.toc.entries, spineIndex)
}

/** A table-of-contents line. `spineIndex` null: the target is outside the spine (shown dimmed). */
export interface ReaderTocEntry {
  title: string
  /** nesting depth, 1 for the top level */
  depth: number
  spineIndex: number | null
  fragment: string | null
}

export function tocEntries(book: ReaderBook): ReaderTocEntry[] {
  return book.epub.toc.entries.map((entry) => ({
    title: entry.title,
    depth: entry.depth,
    spineIndex: entry.spineIndex,
    fragment: entry.spineIndex === null ? null : entry.fragment,
  }))
}
