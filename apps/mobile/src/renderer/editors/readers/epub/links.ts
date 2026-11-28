/**
 * Where a link tapped in a chapter goes, with the PC's `routeLink` (apps/epub
 * reader `links.ts`). The phone has no `epub-asset:` addresses, so the
 * chapter gets a synthetic base under `BOOK_LINK_ORIGIN`: a target that
 * resolves inside it is a place in the book, anything else is outside. Of the
 * outside ones only absolute `http:`, `https:` and `mailto:` addresses are
 * offered for opening; every other address goes nowhere.
 *
 * Pass the `href` as written (`getAttribute`), not the element's resolved
 * `href` property: the drawn copy has no `<base>`.
 */
import { routeLink } from '../../../../../../epub/src/renderer/reader/links'
import { isOpenableExternalUrl } from '../shared/externalUrl'
import type { ReaderBook } from './book'

/** The synthetic origin chapters are placed under for routing; never fetched. */
export const BOOK_LINK_ORIGIN = 'https://book.invalid/'

export type BookLinkRoute =
  | { kind: 'chapter'; spineIndex: number; fragment: string | null }
  /** another entry of the book (a picture, a page outside the spine): nothing happens */
  | { kind: 'entry' }
  /** an outside address that may be offered for opening */
  | { kind: 'outside'; url: string }
  | { kind: 'none' }

const bookUrl = (path: string): string =>
  BOOK_LINK_ORIGIN +
  path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

/** Routes the `href` of a link in the spine item `fromSpineIndex`. */
export function routeBookLink(
  book: ReaderBook,
  fromSpineIndex: number,
  href: string | null,
): BookLinkRoute {
  const items = book.epub.spine.items
  const from = Number.isSafeInteger(fromSpineIndex) ? items[fromSpineIndex] : undefined
  if (!from) return { kind: 'none' }
  const route = routeLink(
    href,
    bookUrl(from.path),
    BOOK_LINK_ORIGIN,
    items.map((item) => item.path),
  )
  if (route.kind !== 'outside') return route
  const url = route.url.trim()
  return isOpenableExternalUrl(url) ? { kind: 'outside', url } : { kind: 'none' }
}
