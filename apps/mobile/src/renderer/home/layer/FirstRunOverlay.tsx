// The first-run guide (track T6, spec 3.13): two steps over the home — welcome, then an optional
// document folder. No AI question, no account, no OS permission prompt (the folder comes from the
// system picker).
import { useEffect, useRef, useState } from 'react'
import { linkFolder } from '@genoffice/mobile-bridge/home'
import { isMobileCommandError, type MobileClient } from '@genoffice/mobile-bridge/transport'
import { useMobileLocale } from '../../i18n'
import { useBackLayer } from '../../shell/backStack'
import './layer.css'

type Step = 'welcome' | 'folder' | 'linked'

export interface FirstRunOverlayProps {
  readonly client: MobileClient
  /** Finished, skipped or closed with Back: the guide does not show again. */
  readonly onFinish: () => void
  readonly showToast: (input: { message: string; tone?: 'info' | 'error' }) => void
}

export function FirstRunOverlay({ client, onFinish, showToast }: FirstRunOverlayProps) {
  const { t } = useMobileLocale()
  const [step, setStep] = useState<Step>('welcome')
  const [picking, setPicking] = useState(false)
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  // Back leaves the guide as "later".
  useBackLayer(true, onFinish)

  // Focus moves to each step's heading so a screen reader starts there.
  useEffect(() => {
    headingRef.current?.focus()
  }, [step])

  const pickFolder = async () => {
    if (picking) return
    setPicking(true)
    try {
      await linkFolder(client)
      setStep('linked')
    } catch (err) {
      // cancelling the picker keeps this step and does not ask again
      if (!(isMobileCommandError(err) && err.code === 'USER_CANCELLED')) {
        showToast({ message: t('homeActFailed'), tone: 'error' })
      }
    } finally {
      setPicking(false)
    }
  }

  const stepNumber = step === 'welcome' ? 1 : 2
  return (
    <div
      className="home-run-first"
      role="dialog"
      aria-modal="true"
      aria-label={t('homeRunGuideLabel')}
      data-testid="home-run-first"
      data-step={step}
    >
      <section className="home-run-first-card">
        <p className="home-run-first-step">{t('homeRunStep', { current: stepNumber, total: 2 })}</p>
        {step === 'welcome' && (
          <>
            <h2 ref={headingRef} tabIndex={-1} className="home-run-first-title">
              {t('homeRunWelcomeTitle')}
            </h2>
            <p className="home-run-first-body">{t('homeRunWelcomeBody')}</p>
            <div className="home-run-first-actions">
              <button
                type="button"
                className="mobile-touch-btn mobile-btn-ghost"
                data-testid="home-run-first-skip"
                onClick={onFinish}
              >
                {t('homeRunSkip')}
              </button>
              <button
                type="button"
                className="mobile-touch-btn mobile-btn-primary"
                data-testid="home-run-first-next"
                onClick={() => setStep('folder')}
              >
                {t('homeRunNext')}
              </button>
            </div>
          </>
        )}
        {step === 'folder' && (
          <>
            <h2 ref={headingRef} tabIndex={-1} className="home-run-first-title">
              {t('homeRunFolderTitle')}
            </h2>
            <p className="home-run-first-body">{t('homeRunFolderBody')}</p>
            <div className="home-run-first-actions">
              <button
                type="button"
                className="mobile-touch-btn mobile-btn-ghost"
                data-testid="home-run-first-later"
                onClick={onFinish}
              >
                {t('homeRunLater')}
              </button>
              <button
                type="button"
                className="mobile-touch-btn mobile-btn-primary"
                data-testid="home-run-first-pick"
                disabled={picking}
                onClick={() => void pickFolder()}
              >
                {t('homeRunFolderPick')}
              </button>
            </div>
          </>
        )}
        {step === 'linked' && (
          <>
            <h2 ref={headingRef} tabIndex={-1} className="home-run-first-title">
              {t('homeRunFolderTitle')}
            </h2>
            <p className="home-run-first-body" role="status" data-testid="home-run-first-linked">
              {t('homeRunFolderLinked')}
            </p>
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
          </>
        )}
      </section>
    </div>
  )
}
