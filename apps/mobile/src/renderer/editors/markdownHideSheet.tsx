import { useEffect } from 'react'
import { useRedactLabelField } from '@genoffice/ui'
import { Sheet } from '../components/Sheet'
import { useMobileLocale } from '../i18n'
import './markdownHideSheet.css'

export interface MarkdownHideSheetProps {
  readonly open: boolean
  /** The name offered first (prefix plus the next number not yet used in the document). */
  readonly defaultLabel: string
  /** Hide: the label, already sanitized (never empty). */
  readonly onConfirm: (label: string) => void
  /** Cancel, Back or the close button: nothing changes. */
  readonly onCancel: () => void
}

/**
 * Asks for the name of a span hidden from the AI (spec 4.4). The name is the only
 * part the model sees, so the `{{name}}` it will read is shown as it is typed, as
 * in the PC Markdown editor's dialog.
 */
export function MarkdownHideSheet({
  open,
  defaultLabel,
  onConfirm,
  onCancel,
}: MarkdownHideSheetProps) {
  const { t } = useMobileLocale()
  return (
    <Sheet
      open={open}
      title={t('webHideFromAi')}
      closeLabel={t('webHideCancel')}
      onClose={onCancel}
      testId="web-hide-sheet"
    >
      {open && (
        <HideLabelForm defaultLabel={defaultLabel} onConfirm={onConfirm} onCancel={onCancel} />
      )}
    </Sheet>
  )
}

function HideLabelForm({
  defaultLabel,
  onConfirm,
  onCancel,
}: Omit<MarkdownHideSheetProps, 'open'>) {
  const { t } = useMobileLocale()
  const field = useRedactLabelField(defaultLabel, onConfirm, onCancel)
  const { inputRef } = field

  // The sheet takes the focus when it opens; the name field gets it right after.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(id)
  }, [inputRef])

  return (
    <div className="web-hide-sheet">
      <p className="web-hide-hint">{t('webHideHint')}</p>
      <label className="web-hide-field">
        <span className="web-hide-field-label">{t('webHideLabel')}</span>
        <input
          ref={inputRef}
          className="mobile-input"
          data-testid="web-hide-label"
          value={field.value}
          maxLength={field.maxLength}
          onChange={(e) => field.setValue(e.target.value)}
          onKeyDown={field.onKeyDown}
          enterKeyHint="done"
        />
      </label>
      <div className="web-hide-marker" data-testid="web-hide-marker" aria-live="polite">
        {field.marker}
      </div>
      <div className="web-hide-actions">
        <button
          type="button"
          className="mobile-pill-btn mobile-btn-ghost"
          data-testid="web-hide-cancel"
          onClick={onCancel}
        >
          {t('webHideCancel')}
        </button>
        <button
          type="button"
          className="mobile-pill-btn mobile-btn-primary"
          data-testid="web-hide-confirm"
          disabled={field.empty}
          onClick={() => onConfirm(field.label)}
        >
          {t('webHideConfirm')}
        </button>
      </div>
    </div>
  )
}
