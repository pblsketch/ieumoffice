import { createPortal } from 'react-dom'
import { Sheet } from '../components/Sheet'

export interface AiConfirmSheetProps {
  readonly open: boolean
  readonly title: string
  readonly body: string
  readonly confirmLabel: string
  readonly cancelLabel: string
  readonly onConfirm: () => void
  /** Also the close button, Back and Escape (the sheet's back layer). */
  readonly onCancel: () => void
  readonly confirmDisabled?: boolean
  /** The action removes something: drawn in the danger colour. */
  readonly danger?: boolean
  readonly testId: string
}

/**
 * A yes/no question of the settings' AI rows as a bottom sheet: [cancel] then
 * the action, right-aligned (design system 7: the same order on both
 * platforms reads naturally). Portaled to the page so it sits above the
 * settings cards.
 */
export function AiConfirmSheet({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  confirmDisabled = false,
  danger = false,
  testId,
}: AiConfirmSheetProps) {
  const sheet = (
    <Sheet open={open} title={title} closeLabel={cancelLabel} onClose={onCancel} testId={testId}>
      <div className="ai-set-confirm">
        <p className="ai-set-confirm-body">{body}</p>
        <div className="ai-set-confirm-actions">
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-secondary"
            onClick={onCancel}
            data-testid={`${testId.replace(/-sheet$/, '')}-cancel`}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={
              danger
                ? 'mobile-touch-btn mobile-btn-secondary mobile-btn-danger-text'
                : 'mobile-touch-btn mobile-btn-primary'
            }
            onClick={onConfirm}
            disabled={confirmDisabled}
            data-testid={`${testId.replace(/-sheet$/, '')}-confirm`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Sheet>
  )
  return typeof document === 'undefined' ? sheet : createPortal(sheet, document.body)
}
