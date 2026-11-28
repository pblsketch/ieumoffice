import type { UnsavedSwitchChoice } from '@genoffice/mobile-bridge/session-state'
import { useMobileLocale } from '../i18n'

export interface UnsavedModalProps {
  readonly open: boolean
  readonly docTitle: string
  readonly onChoice: (choice: UnsavedSwitchChoice) => void
}

export function UnsavedModal({ open, docTitle, onChoice }: UnsavedModalProps) {
  const { t } = useMobileLocale()
  if (!open) return null

  return (
    <div className="mobile-modal-backdrop" data-testid="unsaved-switch-modal">
      <section
        className="mobile-modal-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={t('unsavedTitle')}
      >
        <h2 className="mobile-section-title">{t('unsavedTitle')}</h2>
        <p className="mobile-muted">
          {docTitle} — {t('unsavedPrompt')}
        </p>
        <div className="mobile-row-actions">
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-primary"
            onClick={() => onChoice('save')}
          >
            {t('unsavedSave')}
          </button>
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-secondary"
            onClick={() => onChoice('discard')}
          >
            {t('unsavedDiscard')}
          </button>
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-ghost"
            onClick={() => onChoice('cancel')}
          >
            {t('cancel')}
          </button>
        </div>
      </section>
    </div>
  )
}
