/**
 * Finding text in the whole book with the PC's search (apps/epub reader
 * `book-search.ts`, 500 hits at most). A chapter's reading text is the text
 * of its drawing copy: the same sanitized document `buildChapterView` draws,
 * written out as HTML and read back as the frame reads its `srcdoc`, so a
 * hit's offset maps to a DOM range in the frame with `buildTextIndex` and
 * `rangeOf` there. No resource is served for this.
 */
import {
  SEARCH_LIMIT,
  buildTextIndex,
  normalizeQuery,
  rangeOf,
  searchBook as searchChapters,
  type BookSearchHit,
  type BookSearchResult,
  type TextIndex,
} from '../../../../../../epub/src/renderer/reader/book-search'
import type { ReaderBook } from './book'
import { assembleChapter } from './chapterView'

export { SEARCH_LIMIT, buildTextIndex, normalizeQuery, rangeOf }
export type { BookSearchHit, BookSearchResult, TextIndex }

/** The reading text of a chapter; null when there is no such chapter or the book was closed. */
export async function chapterSearchText(
  book: ReaderBook,
  spineIndex: number,
): Promise<string | null> {
  if (book.disposed) return null
  const known = book.searchTexts.get(spineIndex)
  if (known !== undefined) return known
  const chapter = await assembleChapter(book, spineIndex)
  if (!chapter || book.disposed) return null
  const html = `<!DOCTYPE html>\n${chapter.doc.documentElement.outerHTML}`
  const text = buildTextIndex(new DOMParser().parseFromString(html, 'text/html').body).text
  book.searchTexts.set(spineIndex, text)
  return text
}

export interface ReaderSearchOptions {
  query: string
  /** most hits listed; the PC's 500 when left out */
  limit?: number
  /** characters of context on each side */
  context?: number
  isCancelled?(): boolean
  onProgress?(done: number, total: number): void
}

/** Searches every chapter in spine order, case-insensitively. */
export function searchBook(
  book: ReaderBook,
  options: ReaderSearchOptions,
): Promise<BookSearchResult> {
  return searchChapters({
    query: options.query,
    chapterCount: book.facts.chapterCount,
    limit: options.limit ?? SEARCH_LIMIT,
    context: options.context,
    isCancelled: () => book.disposed || (options.isCancelled?.() ?? false),
    onProgress: options.onProgress,
    chapterText: (i) => chapterSearchText(book, i).catch(() => null),
  })
}
