import { useEffect, useRef, useState } from 'react'
import { Sheet } from '../../../components/Sheet'
import type { PptxController } from './pptxDocument'
import { PPTX_SEARCH_LIMIT, searchDeck, type PptxSearchResult } from './pptxSearch'
import type { PptxTranslate } from './pptxTypes'

/** Pause after typing before the deck is searched. */
const SEARCH_WAIT_MS = 200

/**
 * Finds words in the slides and their notes. A new input stops the search before it; an
 * empty input does nothing. A result tap goes to its slide (nothing is highlighted there).
 */
export function PptxSearchSheet({
  open,
  controller,
  t,
  onClose,
  onPick,
}: {
  readonly open: boolean
  readonly controller: PptxController
  readonly t: PptxTranslate
  readonly onClose: () => void
  readonly onPick: (index: number) => void
}) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [result, setResult] = useState<PptxSearchResult | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    if (!query.trim()) {
      setSearching(false)
      setResult(null)
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(() => {
      void searchDeck(
        {
          slideCount: controller.slideCount(),
          slideText: (i) => controller.slideText(i),
          slideNotes: (i) => controller.slideNotes(i),
        },
        query,
        () => cancelled,
      ).then((found) => {
        if (cancelled || !found) return
        setResult(found)
        setSearching(false)
      })
    }, SEARCH_WAIT_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [controller, open, query])

  const hits = result?.hits ?? []
  return (
    <Sheet
      open={open}
      title={t('readersSearch')}
      closeLabel={t('readersClose')}
      onClose={onClose}
      initialDetent="large"
      testId="pptx-search-sheet"
    >
      <div className="mobile-pptx-search">
        <input
          ref={inputRef}
          type="search"
          className="mobile-pptx-search-input"
          value={query}
          placeholder={t('readersSearchPlaceholder')}
          aria-label={t('readersSearch')}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="pptx-search-input"
        />
        <p className="mobile-pptx-search-status" role="status" aria-live="polite">
          {searching
            ? t('readersSearching')
            : result
              ? hits.length === 0
                ? t('readersSearchNone')
                : result.limited
                  ? `${t('readersSearchCount', { count: hits.length })} · ${t('readersSearchLimited', { limit: PPTX_SEARCH_LIMIT })}`
                  : t('readersSearchCount', { count: hits.length })
              : ''}
        </p>
        {!searching && hits.length > 0 && (
          <ul className="mobile-pptx-search-results">
            {hits.map((hit, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="mobile-pptx-search-hit"
                  onClick={() => onPick(hit.slideIndex)}
                  data-testid="pptx-search-hit"
                >
                  <span className="mobile-pptx-search-slide">
                    {t('readersPptxSlideLabel', { n: hit.slideIndex + 1 })}
                    {hit.inNotes && ` · ${t('readersPptxNotes')}`}
                  </span>
                  <span className="mobile-pptx-search-snippet">
                    {hit.before}
                    <mark>{hit.match}</mark>
                    {hit.after}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  )
}
