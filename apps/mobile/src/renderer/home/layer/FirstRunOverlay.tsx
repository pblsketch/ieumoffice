// The first-run guide (track T6): a single welcome screen over the home. No folder picker,
// no AI question, no account, no OS permission prompt. Folder linking lives in the [Folders] tab.
import { useEffect, useRef } from 'react'
import { useMobileLocale } from '../../i18n'
import { useBackLayer } from '../../shell/backStack'
import './layer.css'

export interface FirstRunOverlayProps {
  /** Finished or closed with Back: the guide does not show again. */
  readonly onFinish: () => void
}

export function FirstRunOverlay({ onFinish }: FirstRunOverlayProps) {
  const { t } = useMobileLocale()
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  // Back dismisses the welcome guide.
  useBackLayer(true, onFinish)

  // Focus moves to the heading so a screen reader starts there.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <div
      className="home-run-first"
      role="dialog"
      aria-modal="true"
      aria-label={t('homeRunGuideLabel')}
      data-testid="home-run-first"
      data-step="welcome"
    >
      <section className="home-run-first-card">
        <h2 ref={headingRef} tabIndex={-1} className="home-run-first-title">
          {t('homeRunWelcomeTitle')}
        </h2>
        <p className="home-run-first-body">{t('homeRunWelcomeBody')}</p>
        <div className="home-run-first-actions">
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-primary"
            data-testid="home-run-first-start"
            onClick={onFinish}
          >
            {t('homeRunStart')}
          </button>
        </div>
      </section>
    </div>
  )
}
