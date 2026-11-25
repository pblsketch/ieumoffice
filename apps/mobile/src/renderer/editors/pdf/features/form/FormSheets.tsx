// The sheets of the form feature (design system 5.5): a text field is typed in a sheet
// with the keyboard up (the field itself is often smaller than a finger and below the
// webview's no-zoom font size), a choice field is picked from a list, and the floating
// bars of mark placement and of a selected mark.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Params } from '@genoffice/i18n'
import {
  formatDate,
  isDateOnlyFormat,
  isValidDateInput,
  normalizeDateInput,
} from '../../../../../../../pdf/src/renderer/date-format'
import type { FormValueInput } from '../../../../../../../pdf/src/shared/ipc'
import { Sheet } from '../../../../components/Sheet'
import type { MobileStringKey } from '../../../../i18n/strings'
import { choiceRows, type FormMarkKind, type FormWidget } from './formModel'

type Translate = (key: MobileStringKey, params?: Params) => string

/**
 * Typing into a text field (PC FormLayer input / textarea / DateInput rules): every
 * change is one `setFormValue`; a date field takes complete dates in its format as
 * typed and, when the sheet closes, rewrites other recognisable layouts into the
 * format or reverts with the expected format shown.
 */
export function FormTextSheet({
  widget,
  value,
  t,
  onEdit,
  onInvalidDate,
  onClose,
}: {
  readonly widget: FormWidget | null
  readonly value: string
  readonly t: Translate
  readonly onEdit: (value: FormValueInput) => void
  readonly onInvalidDate: (format: string) => void
  readonly onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const id = widget?.id ?? null
  useEffect(() => setDraft(null), [id])
  // in the tap's own task, so the on-screen keyboard comes up
  useLayoutEffect(() => {
    if (id !== null) inputRef.current?.focus()
  }, [id])

  if (!widget) return null
  const format = widget.dateFormat
  const commit = (next: string) => {
    if (next !== value) onEdit({ name: widget.fieldName, kind: 'text', value: next })
  }
  const close = () => {
    if (format && draft !== null) {
      const normalized = normalizeDateInput(draft, format)
      if (normalized === null) onInvalidDate(format)
      else commit(normalized)
    }
    setDraft(null)
    onClose()
  }
  const shown = draft ?? value
  const fieldProps = {
    ref: inputRef,
    className: 'mobile-input m-pdf-form-text-input',
    value: shown,
    maxLength: widget.maxLen ?? undefined,
    placeholder: format ?? undefined,
    'aria-label': widget.fieldName,
    'aria-required': widget.required || undefined,
    'data-testid': 'pdf-form-text-input',
    onChange: (e: { target: { value: string } }) => {
      const next = e.target.value
      if (!format) {
        commit(next)
        return
      }
      setDraft(next)
      if (next.trim() && isValidDateInput(next, format)) commit(next.trim())
    },
  }

  return (
    <Sheet
      open
      modal={false}
      title={widget.fieldName}
      closeLabel={t('pdfFormDone')}
      onClose={close}
      testId="pdf-form-text-sheet"
    >
      <div className="m-pdf-form">
        {widget.multiLine ? (
          <textarea {...fieldProps} rows={4} />
        ) : (
          <input
            {...fieldProps}
            type={widget.password ? 'password' : 'text'}
            enterKeyHint="done"
            onKeyDown={(e) => {
              if (e.key === 'Enter') close()
            }}
          />
        )}
        {format && isDateOnlyFormat(format) && (
          <label className="m-pdf-field">
            {t('pdfFormDatePick')}
            <input
              type="date"
              className="mobile-input"
              data-testid="pdf-form-date-picker"
              onChange={(e) => {
                const [y, m, d] = e.target.value.split('-').map(Number)
                if (!y || !m || !d) return
                setDraft(null)
                commit(formatDate({ year: y, month: m, day: d }, format))
              }}
            />
          </label>
        )}
        <div className="mobile-row-actions">
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-primary"
            onClick={close}
            data-testid="pdf-form-text-done"
          >
            {t('pdfFormDone')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

/** Picking a choice field's option (PC FormLayer Dropdown rules). */
export function FormChoiceSheet({
  widget,
  value,
  t,
  onPick,
  onClose,
}: {
  readonly widget: FormWidget | null
  readonly value: string
  readonly t: Translate
  readonly onPick: (value: string) => void
  readonly onClose: () => void
}) {
  if (!widget) return null
  return (
    <Sheet
      open
      title={widget.fieldName}
      closeLabel={t('cancel')}
      onClose={onClose}
      testId="pdf-form-choice-sheet"
    >
      <div className="m-pdf-form-choices" role="radiogroup" aria-label={widget.fieldName}>
        {choiceRows(widget, value).map((row) => (
          <button
            key={`${row.disabled ? 'raw' : 'opt'}:${row.value}`}
            type="button"
            role="radio"
            aria-checked={!row.disabled && row.value === value}
            disabled={row.disabled}
            className="mobile-choice-btn m-pdf-form-option"
            data-testid={`pdf-form-choice-${row.value}`}
            onClick={() => onPick(row.value)}
          >
            {row.label}
          </button>
        ))}
      </div>
    </Sheet>
  )
}

/** While a mark waits for its tap: what to do, and a way out. */
export function FormPlaceBar({
  kind,
  t,
  onCancel,
}: {
  readonly kind: FormMarkKind
  readonly t: Translate
  readonly onCancel: () => void
}) {
  return (
    <div className="m-pdf-form-bar" role="status" data-testid="pdf-form-place-bar">
      <span className="m-pdf-form-bar-text">
        {t(kind === 'check' ? 'pdfFormPlaceCheck' : 'pdfFormPlaceCross')}
      </span>
      <button
        type="button"
        className="mobile-touch-btn"
        onClick={onCancel}
        data-testid="pdf-form-place-cancel"
      >
        {t('cancel')}
      </button>
    </div>
  )
}

/** A selected mark: delete it, or leave it where it is. */
export function FormMarkBar({
  t,
  onDelete,
  onDone,
}: {
  readonly t: Translate
  readonly onDelete: () => void
  readonly onDone: () => void
}) {
  return (
    <div className="m-pdf-form-bar" role="toolbar" data-testid="pdf-form-mark-bar">
      <button
        type="button"
        className="mobile-touch-btn"
        onClick={onDelete}
        data-testid="pdf-form-mark-delete"
      >
        {t('pdfFormDeleteMark')}
      </button>
      <button
        type="button"
        className="mobile-touch-btn mobile-btn-primary"
        onClick={onDone}
        data-testid="pdf-form-mark-done"
      >
        {t('pdfFormDone')}
      </button>
    </div>
  )
}
