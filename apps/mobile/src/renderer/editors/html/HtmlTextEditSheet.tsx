import { useEffect, useRef, useState } from 'react'
import { Sheet } from '../../components/Sheet'
import { useMobileLocale } from '../../i18n'
import type { HtmlTextEditPlan } from './htmlElementEdit'
import './htmlTextEditSheet.css'

export interface HtmlTextEditSheetProps {
  /** What the selected element offers; null: the sheet is closed. */
  readonly plan: HtmlTextEditPlan | null
  /** Apply: one value per field, in the plan's order. */
  readonly onApply: (values: readonly string[]) => void
  /** Cancel, Back or the close button: nothing changes. */
  readonly onCancel: () => void
  /** The element has no text to edit here: switch to the source view. */
  readonly onEditInSource: () => void
}

/**
 * "Edit text" for the selected HTML element (spec 5.4): one field for an element with text
 * only, one per direct text run for mixed content, and the way to the source when there is no
 * text to edit.
 */
export function HtmlTextEditSheet({
  plan,
  onApply,
  onCancel,
  onEditInSource,
}: HtmlTextEditSheetProps) {
  const { t } = useMobileLocale()
  return (
    <Sheet
      open={plan !== null}
      title={t('webHtmlEditText')}
      closeLabel={t('webHtmlEditTextCancel')}
      onClose={onCancel}
      testId="web-html-text-sheet"
    >
      {plan && (
        <TextEditForm
          key={`${plan.kind}:${plan.sid}`}
          plan={plan}
          onApply={onApply}
          onCancel={onCancel}
          onEditInSource={onEditInSource}
        />
      )}
    </Sheet>
  )
}

function initialValues(plan: HtmlTextEditPlan): string[] {
  if (plan.kind === 'text') return [plan.value]
  if (plan.kind === 'nodes') return plan.parts.map((part) => part.value)
  return []
}

function TextEditForm({
  plan,
  onApply,
  onCancel,
  onEditInSource,
}: Omit<HtmlTextEditSheetProps, 'plan'> & { readonly plan: HtmlTextEditPlan }) {
  const { t } = useMobileLocale()
  const [values, setValues] = useState<string[]>(() => initialValues(plan))
  const firstRef = useRef<HTMLTextAreaElement | null>(null)

  // The sheet takes the focus when it opens; the first field gets it right after.
  useEffect(() => {
    const id = requestAnimationFrame(() => firstRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])

  if (plan.kind === 'source') {
    return (
      <div className="web-html-text-sheet">
        <p className="web-html-text-hint" data-testid="web-html-text-source-hint">
          {t('webHtmlEditInSource')}
        </p>
        <div className="web-html-text-actions">
          <button
            type="button"
            className="mobile-pill-btn mobile-btn-primary"
            data-testid="web-html-text-to-source"
            onClick={onEditInSource}
          >
            {t('webHtmlGoToSource')}
          </button>
        </div>
      </div>
    )
  }

  const labels =
    plan.kind === 'text'
      ? [t('webHtmlEditTextField')]
      : plan.parts.map((_, i) => t('webHtmlEditTextPart', { n: i + 1 }))

  return (
    <div className="web-html-text-sheet">
      {plan.kind === 'nodes' && (
        <p className="web-html-text-hint">{t('webHtmlEditTextMixedHint')}</p>
      )}
      {labels.map((label, i) => (
        <label className="web-html-text-field" key={i}>
          <span className="web-html-text-field-label">{label}</span>
          <textarea
            ref={i === 0 ? firstRef : undefined}
            className="mobile-input web-html-text-input"
            data-testid={`web-html-text-field-${i}`}
            value={values[i] ?? ''}
            rows={3}
            onChange={(e) => {
              const next = e.target.value
              setValues((prev) => prev.map((value, j) => (j === i ? next : value)))
            }}
          />
        </label>
      ))}
      <div className="web-html-text-actions">
        <button
          type="button"
          className="mobile-pill-btn mobile-btn-ghost"
          data-testid="web-html-text-cancel"
          onClick={onCancel}
        >
          {t('webHtmlEditTextCancel')}
        </button>
        <button
          type="button"
          className="mobile-pill-btn mobile-btn-primary"
          data-testid="web-html-text-apply"
          onClick={() => onApply(values)}
        >
          {t('webHtmlEditTextApply')}
        </button>
      </div>
    </div>
  )
}
