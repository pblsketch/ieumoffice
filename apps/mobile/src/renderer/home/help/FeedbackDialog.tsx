// The "Send feedback" confirm dialog (track T6, spec 3.11): the PC wording, the details that get
// copied (version, OS, UI language), then [Open survey] copies them and opens the survey.
import { useEffect, useRef, useState } from 'react'
import { useMobileLocale } from '../../i18n'
import { useBackLayer } from '../../shell/backStack'
import { useHomeRuntime } from '../homeRuntime'
import { feedbackOsLabel, openFeedbackSurvey, useAppInfo } from './feedback'
import './help.css'

export interface FeedbackDialogProps {
  readonly open: boolean
  readonly onClose: () => void
}

export function FeedbackDialog({ open, onClose }: FeedbackDialogProps) {
  if (!open) return null
  // Mounted per opening, so every opening starts from the confirm step.
  return <FeedbackDialogBody onClose={onClose} />
}

type Phase = 'confirm' | 'busy' | 'copyFailed'

/** Shown for a value the backend did not give. */
const UNKNOWN = '-'

async function copyText(text: string): Promise<boolean> {
  try {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (!clipboard?.writeText) return false
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function FeedbackDialogBody({ onClose }: { readonly onClose: () => void }) {
  const { t, lang } = useMobileLocale()
  const runtime = useHomeRuntime()
  const client = runtime?.client ?? null
  const info = useAppInfo(client)
  const [phase, setPhase] = useState<Phase>('confirm')
  const dialogRef = useRef<HTMLElement | null>(null)
  const textRef = useRef<HTMLTextAreaElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useBackLayer(true, onClose)

  useEffect(() => {
    if (typeof document === 'undefined') return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  useEffect(() => {
    if (phase !== 'copyFailed') return
    textRef.current?.focus()
    textRef.current?.select()
  }, [phase])

  const os = info ? feedbackOsLabel(info) : ''
  const details = t('homeHelpFeedbackDetails', {
    version: info?.version ?? UNKNOWN,
    os: os === '' ? UNKNOWN : os,
    language: lang,
  })

  const onOpenSurvey = async () => {
    if (phase !== 'confirm') return
    setPhase('busy')
    const copied = await copyText(details)
    if (client) {
      try {
        await openFeedbackSurvey(client)
      } catch {
        runtime?.showToast({ message: t('homeHelpFeedbackOpenFailed'), tone: 'error' })
      }
    }
    if (copied) onCloseRef.current()
    else setPhase('copyFailed')
  }

  const title = t('homeHelpFeedbackTitle')
  return (
    <div className="mobile-modal-backdrop" data-testid="home-help-feedback-dialog">
      <section
        ref={dialogRef}
        className="mobile-modal-dialog home-help-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <h2 className="mobile-section-title">{title}</h2>
        {phase === 'copyFailed' ? (
          <>
            <p className="mobile-muted" role="alert">
              {t('homeHelpFeedbackCopyFailed')}
            </p>
            <textarea
              ref={textRef}
              className="home-help-details-text"
              readOnly
              value={details}
              aria-label={title}
              data-testid="home-help-feedback-text"
            />
          </>
        ) : (
          <>
            <p className="mobile-muted">{t('homeHelpFeedbackBody')}</p>
            <p className="home-help-details" data-testid="home-help-feedback-details">
              {details}
            </p>
          </>
        )}
        <div className="home-help-dialog-actions" data-platform={info?.platform ?? 'other'}>
          {phase === 'copyFailed' ? (
            <button
              type="button"
              className="mobile-touch-btn mobile-btn-secondary"
              onClick={onClose}
              data-testid="home-help-feedback-close"
            >
              {t('homeHelpClose')}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="mobile-touch-btn mobile-btn-secondary"
                onClick={onClose}
                data-testid="home-help-feedback-cancel"
              >
                {t('homeHelpFeedbackCancel')}
              </button>
              <button
                type="button"
                className="mobile-touch-btn mobile-btn-primary"
                onClick={() => void onOpenSurvey()}
                disabled={phase === 'busy'}
                data-testid="home-help-feedback-open"
              >
                {t('homeHelpFeedbackOpen')}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
