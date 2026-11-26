/**
 * A confirm dialog for a step that cannot be undone (design system 5.8):
 * named buttons, [cancel] on the left and the action on the right on both
 * platforms (7), Back answers "cancel". Focus moves to the safe button and
 * returns to the opener when the dialog closes.
 */
import { useEffect, useRef } from 'react'
import { useBackLayer } from '../../shell/backStack'

export interface ConfirmDialogProps {
  readonly message: string
  readonly cancelLabel: string
  readonly actionLabel: string
  readonly danger?: boolean
  onCancel(): void
  onAction(): void
  readonly testId?: string
}

export function ConfirmDialog({
  message,
  cancelLabel,
  actionLabel,
  danger,
  onCancel,
  onAction,
  testId,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  useBackLayer(true, onCancel)

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()
    return () => {
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  return (
    <div className="mobile-modal-backdrop" data-testid={testId}>
      <section
        className="mobile-modal-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={message}
      >
        <p className="pdf-tools-confirm-text">{message}</p>
        <div className="pdf-tools-confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="mobile-touch-btn mobile-btn-secondary"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`mobile-touch-btn ${danger ? 'mobile-btn-secondary mobile-btn-danger-text' : 'mobile-btn-primary'}`}
            onClick={onAction}
          >
            {actionLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
