// Find bar over the document: PC search.ts rules (case and width folded), the
// hits painted on their pages, previous/next jumping to each hit.
import { useEffect, useRef, useState } from 'react'
import { searchInIndex, type SearchMatch } from '../../../../../../pdf/src/renderer/search'
import { IconClose } from '../../../components/MobileIcons'
import type { MobileStringKey } from '../../../i18n/strings'
import { IconPdfChevronDown, IconPdfChevronUp, IconPdfSearch } from './icons'
import type { PdfOpenedDocument } from './model'
import type { PdfPageHits } from './PdfViewer'

const SEARCH_DELAY_MS = 250

/** Hits grouped by page for the viewer; the active match's rects are marked. */
export function hitsByPage(
  matches: readonly SearchMatch[],
  activeIndex: number,
): Map<number, PdfPageHits> {
  const out = new Map<number, { rects: SearchMatch['rects']; activeRects: SearchMatch['rects'] }>()
  matches.forEach((match, i) => {
    const entry = out.get(match.pageIndex) ?? { rects: [], activeRects: [] }
    if (i === activeIndex) entry.activeRects.push(...match.rects)
    else entry.rects.push(...match.rects)
    out.set(match.pageIndex, entry)
  })
  return out
}

/** Every hit of `query` in the document (the index is built once per document). */
export async function searchPdf(
  model: Pick<PdfOpenedDocument, 'proxy' | 'searchIndex'>,
  query: string,
): Promise<SearchMatch[]> {
  if (!query.trim()) return []
  const index = await model.searchIndex.get(model.proxy)
  return searchInIndex(index, query)
}

export function PdfSearchBar({
  model,
  t,
  onHitsChange,
  onGoToMatch,
  onClose,
}: {
  readonly model: PdfOpenedDocument
  readonly t: (key: MobileStringKey) => string
  readonly onHitsChange: (hits: Map<number, PdfPageHits> | null) => void
  readonly onGoToMatch: (match: SearchMatch) => void
  readonly onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<SearchMatch[] | null>(null)
  const [active, setActive] = useState(0)
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const onGoRef = useRef(onGoToMatch)
  onGoRef.current = onGoToMatch

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!query.trim()) {
      setMatches(null)
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(() => {
      void searchPdf(model, query)
        .catch(() => [])
        .then((found) => {
          if (cancelled) return
          setSearching(false)
          setMatches(found)
          setActive(0)
          const first = found[0]
          if (first) onGoRef.current(first)
        })
    }, SEARCH_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [model, query])

  useEffect(() => {
    onHitsChange(matches && matches.length > 0 ? hitsByPage(matches, active) : null)
  }, [matches, active, onHitsChange])

  // the hits go when the bar closes
  useEffect(() => () => onHitsChange(null), [onHitsChange])

  const step = (delta: number) => {
    if (!matches || matches.length === 0) return
    const next = (active + delta + matches.length) % matches.length
    setActive(next)
    onGoToMatch(matches[next]!)
  }

  const count = matches?.length ?? 0
  return (
    <div className="m-pdf-findbar" role="search" data-testid="pdf-search-bar">
      <IconPdfSearch size={18} />
      <input
        ref={inputRef}
        className="m-pdf-find-input"
        type="search"
        enterKeyHint="search"
        value={query}
        placeholder={t('pdfViewSearchPlaceholder')}
        aria-label={t('pdfViewSearch')}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            step(e.shiftKey ? -1 : 1)
          }
        }}
        data-testid="pdf-search-input"
      />
      <span className="m-pdf-find-count" aria-live="polite" data-testid="pdf-search-count">
        {searching
          ? t('pdfViewSearching')
          : matches === null
            ? ''
            : count === 0
              ? t('pdfViewSearchNone')
              : `${active + 1} / ${count}`}
      </span>
      <button
        type="button"
        className="mobile-icon-btn"
        onClick={() => step(-1)}
        disabled={count === 0}
        aria-label={t('pdfViewSearchPrev')}
        title={t('pdfViewSearchPrev')}
      >
        <IconPdfChevronUp size={20} />
      </button>
      <button
        type="button"
        className="mobile-icon-btn"
        onClick={() => step(1)}
        disabled={count === 0}
        aria-label={t('pdfViewSearchNext')}
        title={t('pdfViewSearchNext')}
        data-testid="pdf-search-next"
      >
        <IconPdfChevronDown size={20} />
      </button>
      <button
        type="button"
        className="mobile-icon-btn"
        onClick={onClose}
        aria-label={t('pdfViewSearchClose')}
        title={t('pdfViewSearchClose')}
      >
        <IconClose size={20} />
      </button>
    </div>
  )
}
