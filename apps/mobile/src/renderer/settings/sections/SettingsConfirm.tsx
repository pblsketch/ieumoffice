// Owner: track T6. Confirm dialog of the settings sections (design system 5.8, 7, 8).
import { useEffect, useId, useRef } from 'react'
import type { AppPlatform } from '@genoffice/mobile-bridge/home'
import { useMobileLocale } from '../../i18n'
import { useBackLayer } from '../../shell/backStack'
import './homeSettings.css'

export interface SettingsConfirmProps {
  readonly open: boolean
  readonly title: string
  readonly body: string
  /** Names the action ("Clear", "Remove"), never yes/no. */
  readonly actionLabel: string
  readonly busy?: boolean
  /** iOS stretches the two buttons; Android right-aligns them. Both put the action last. */
  readonly platform?: AppPlatform
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

export function SettingsConfirm({
  open,
  title,
  body,
  actionLabel,
  busy = false,
  platform,
  onConfirm,
  onCancel,
}: SettingsConfirmProps) {
  const { t } = useMobileLocale()
  const titleId = useId()
  const bodyId = useId()
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  useBackLayer(open, onCancel)

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (opener?.isConnected) opener.focus()
    }
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="mobile-modal-backdrop" data-testid="home-set-confirm">
      <section
        className="mobile-modal-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
        <h2 id={titleId} className="mobile-section-title">
          {title}
        </h2>
        <p id={bodyId} className="mobile-muted">
          {body}
        </p>
        <div className={`home-set-confirm-actions${platform === 'ios' ? ' is-ios' : ''}`}>
          <button
            ref={cancelRef}
            type="button"
            className="mobile-touch-btn mobile-btn-ghost"
            onClick={onCancel}
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-secondary mobile-btn-danger-text"
            onClick={onConfirm}
            disabled={busy}
          >
            {actionLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
