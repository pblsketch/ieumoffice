/**
 * Choosing the blank pages to remove (spec 5.3, find and remove blank pages).
 *
 * Slot for PTL-T9: replace this simple list with the thumbnail grid. Keep the
 * exported names and props. The flow keeps `chosen`, accepts only pages among
 * the candidates and disables [Remove] when nothing or every page is chosen.
 */
import { useMobileLocale } from '../../i18n'
import type { BlankCandidateView } from '../engine/types'

export interface BlankReviewProps {
  /** 1-based candidates in page order, with a thumbnail for the first ones */
  readonly candidates: readonly BlankCandidateView[]
  readonly pageCount: number
  readonly chosen: ReadonlySet<number>
  onChange(chosen: ReadonlySet<number>): void
}

/** What starts chosen: the pages with nothing on them, not the nearly white ones */
export function initialBlankChoice(candidates: readonly BlankCandidateView[]): Set<number> {
  return new Set(candidates.filter((c) => c.reason === 'empty').map((c) => c.page))
}

export function BlankReview({ candidates, chosen, onChange }: BlankReviewProps) {
  const { t } = useMobileLocale()
  const toggle = (page: number, on: boolean) => {
    const next = new Set(chosen)
    if (on) next.add(page)
    else next.delete(page)
    onChange(next)
  }
  return (
    <ul className="pdf-tools-blank-list" data-testid="pdf-tools-blank-review">
      {candidates.map((c) => (
        <li key={c.page}>
          <label className="pdf-tools-blank-row">
            <input
              type="checkbox"
              checked={chosen.has(c.page)}
              onChange={(e) => toggle(c.page, e.currentTarget.checked)}
            />
            <span className="pdf-tools-blank-page">
              {t('pdfToolsBlankPageLabel', { n: c.page })}
            </span>
            <span className="mobile-muted">
              {t(c.reason === 'empty' ? 'pdfToolsBlankEmpty' : 'pdfToolsBlankNearlyWhite')}
            </span>
          </label>
        </li>
      ))}
    </ul>
  )
}
