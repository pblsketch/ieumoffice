/**
 * Floating canvas text search bar (Ctrl+F) with cross-page match stepping.
 */
import type { ReactElement } from 'react'
import { useI18n } from '../i18n/locale'
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, SearchIcon } from './icons'

export interface SearchBarProps {
  readonly query: string
  readonly matchCount: number
  readonly activeIndex: number
  readonly onQueryChange: (q: string) => void
  readonly onPrev: () => void
  readonly onNext: () => void
  readonly onClose: () => void
}

export function SearchBar({
  query,
  matchCount,
  activeIndex,
  onQueryChange,
  onPrev,
  onNext,
  onClose,
}: SearchBarProps): ReactElement {
  const { t } = useI18n()

  return (
    <div className="wb-search-bar" role="search" onPointerDown={(e) => e.stopPropagation()}>
      <SearchIcon size={15} />
      <input
        type="text"
        className="wb-search-input"
        value={query}
        placeholder={t('searchPlaceholder')}
        autoFocus
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          } else if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) onPrev()
            else onNext()
          }
        }}
      />
      <span className="wb-search-count">
        {query.trim()
          ? matchCount > 0
            ? `${activeIndex + 1} / ${matchCount}`
            : t('searchNoMatches')
          : ''}
      </span>
      <button
        type="button"
        className="wb-search-btn"
        aria-label={t('presentPrev')}
        disabled={matchCount === 0}
        onClick={onPrev}
      >
        <ChevronUpIcon size={14} />
      </button>
      <button
        type="button"
        className="wb-search-btn"
        aria-label={t('presentNext')}
        disabled={matchCount === 0}
        onClick={onNext}
      >
        <ChevronDownIcon size={14} />
      </button>
      <button type="button" className="wb-search-btn" aria-label={t('btnClose')} onClick={onClose}>
        <CloseIcon size={14} />
      </button>
    </div>
  )
}
