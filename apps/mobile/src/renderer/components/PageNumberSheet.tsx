import { useEffect, useState } from 'react'
import {
  DEFAULT_PAGE_NUMBER,
  PAGE_NUMBER_PLACES,
  PAGE_NUMBER_SHAPES,
  type PageNumberPlace,
  type PageNumberSetting,
  type PageNumberShape,
} from '../editors/pageNumbers'
import { useMobileLocale, type MobileStringKey } from '../i18n'
import { Sheet } from './Sheet'

const PLACE_LABELS: Record<PageNumberPlace, MobileStringKey> = {
  none: 'pageNumberNone',
  bottomCenter: 'pageNumberBottomCenter',
  bottomRight: 'pageNumberBottomRight',
  topCenter: 'pageNumberTopCenter',
  topRight: 'pageNumberTopRight',
}

/** Shapes are shown by example; the examples read the same in every language. */
const SHAPE_EXAMPLES: Record<PageNumberShape, string> = {
  digit: '1, 2, 3',
  upperRoman: 'I, II, III',
  lowerRoman: 'i, ii, iii',
  hangulSyllable: '가, 나, 다',
}

export interface PageNumberSheetProps {
  readonly open: boolean
  readonly onClose: () => void
  /** The document's setting; null when it uses one the phone does not offer. */
  readonly current: PageNumberSetting | null
  readonly onApply: (setting: PageNumberSetting) => void
}

/** Page numbers for the whole document: place, shape and dashes (design system sheet). */
export function PageNumberSheet({ open, onClose, current, onApply }: PageNumberSheetProps) {
  const { t } = useMobileLocale()
  const [setting, setSetting] = useState<PageNumberSetting>(current ?? DEFAULT_PAGE_NUMBER)

  useEffect(() => {
    if (open) setSetting(current ?? DEFAULT_PAGE_NUMBER)
  }, [open, current])

  const numbered = setting.place !== 'none'

  return (
    <Sheet
      open={open}
      title={t('pageNumber')}
      closeLabel={t('cancel')}
      onClose={onClose}
      testId="hwp-page-number-sheet"
    >
      <div className="mobile-choice-sheet">
        <h3 className="mobile-format-group-title">{t('pageNumberPlace')}</h3>
        <div className="mobile-choice-grid" role="radiogroup" aria-label={t('pageNumberPlace')}>
          {(Object.keys(PAGE_NUMBER_PLACES) as PageNumberPlace[]).map((place) => (
            <button
              key={place}
              type="button"
              role="radio"
              aria-checked={setting.place === place}
              className="mobile-choice-btn"
              onClick={() => setSetting((s) => ({ ...s, place }))}
            >
              {t(PLACE_LABELS[place])}
            </button>
          ))}
        </div>
        {numbered && (
          <>
            <h3 className="mobile-format-group-title">{t('pageNumberShape')}</h3>
            <div className="mobile-choice-grid" role="radiogroup" aria-label={t('pageNumberShape')}>
              {(Object.keys(PAGE_NUMBER_SHAPES) as PageNumberShape[]).map((shape) => (
                <button
                  key={shape}
                  type="button"
                  role="radio"
                  aria-checked={setting.shape === shape}
                  className="mobile-choice-btn"
                  onClick={() => setSetting((s) => ({ ...s, shape }))}
                >
                  {SHAPE_EXAMPLES[shape]}
                </button>
              ))}
            </div>
            <label className="mobile-set-row">
              <span className="mobile-set-label">{t('pageNumberDash')}</span>
              <input
                type="checkbox"
                className="mobile-switch"
                checked={setting.dash}
                onChange={(event) => setSetting((s) => ({ ...s, dash: event.target.checked }))}
              />
            </label>
          </>
        )}
        <div className="mobile-memo-actions">
          <button
            type="button"
            className="mobile-pill-btn mobile-btn-primary"
            data-testid="hwp-page-number-apply"
            onClick={() => onApply(setting)}
          >
            {t('pageNumberApply')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
