/**
 * Finding words in a deck: each slide's text (boxes, table cells, groups) and its notes.
 * Runs in steps so a newer query can stop an older one, and so a long deck does not hold
 * the screen. Results lead to the slide; nothing is highlighted inside the slide.
 */

/** Most hits listed, as in the EPUB reader. */
export const PPTX_SEARCH_LIMIT = 500

/** Characters kept before and after a hit in its snippet. */
const SNIPPET_BEFORE = 30
const SNIPPET_AFTER = 50
/** Slides searched between two pauses. */
const SLIDES_PER_STEP = 25

export interface PptxSearchSource {
  readonly slideCount: number
  slideText(index: number): string
  slideNotes(index: number): string
}

export interface PptxSearchHit {
  readonly slideIndex: number
  readonly inNotes: boolean
  readonly before: string
  readonly match: string
  readonly after: string
}

export interface PptxSearchResult {
  readonly hits: readonly PptxSearchHit[]
  /** More hits exist than PPTX_SEARCH_LIMIT */
  readonly limited: boolean
}

const flat = (text: string): string => text.replace(/\s+/g, ' ')

/** Every hit of `needle` (already lower-cased) in `text`, appended to `out` up to the limit. */
function collect(
  text: string,
  needle: string,
  slideIndex: number,
  inNotes: boolean,
  out: PptxSearchHit[],
  limit: number,
): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  // Lower-casing can change the length of a few letters; then snippets come from the lower form
  const source = lower.length === text.length ? text : lower
  let from = 0
  for (;;) {
    const at = lower.indexOf(needle, from)
    if (at < 0) return false
    if (out.length >= limit) return true
    const end = at + needle.length
    const start = Math.max(0, at - SNIPPET_BEFORE)
    const stop = Math.min(source.length, end + SNIPPET_AFTER)
    out.push({
      slideIndex,
      inNotes,
      before: (start > 0 ? '…' : '') + flat(source.slice(start, at)).trimStart(),
      match: flat(source.slice(at, end)),
      after: flat(source.slice(end, stop)).trimEnd() + (stop < source.length ? '…' : ''),
    })
    from = end
  }
}

const pause = (): Promise<void> => new Promise((done) => setTimeout(done, 0))

/**
 * Searches the deck. Resolves null when `isCancelled` turned true on the way. An empty or
 * blank query finds nothing and does not search.
 */
export async function searchDeck(
  source: PptxSearchSource,
  query: string,
  isCancelled: () => boolean,
  limit = PPTX_SEARCH_LIMIT,
): Promise<PptxSearchResult | null> {
  const needle = query.trim().toLowerCase()
  if (!needle) return { hits: [], limited: false }
  const hits: PptxSearchHit[] = []
  for (let index = 0; index < source.slideCount; index += 1) {
    if (index > 0 && index % SLIDES_PER_STEP === 0) {
      await pause()
      if (isCancelled()) return null
    }
    if (collect(source.slideText(index), needle, index, false, hits, limit)) {
      return { hits, limited: true }
    }
    if (collect(source.slideNotes(index), needle, index, true, hits, limit)) {
      return { hits, limited: true }
    }
  }
  return isCancelled() ? null : { hits, limited: false }
}
