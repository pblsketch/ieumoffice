/**
 * The small controls of the options sheet forms: a text field (also for
 * numbers and passwords), a radio group, a switch row and a checkbox row.
 * Every control has a visible label and a hit area of at least `--m-hit`; an
 * option error is drawn under the field it belongs to and tied to it with
 * aria-describedby (the sheet announces it once, so this copy does not).
 */
import { useId, type ReactNode } from 'react'
import { useMobileLocale } from '../../i18n'
import { optionsErrorKey } from '../flow/format'
import { ProblemNote } from '../flow/ProblemNote'
import type { ToolOptionsError } from './index'

/** The ids a field's hint and error take, joined for aria-describedby */
function describedBy(
  base: string,
  hint: boolean,
  error: ToolOptionsError | null,
): string | undefined {
  const ids = [hint ? `${base}-hint` : null, error ? `${base}-error` : null].filter(Boolean)
  return ids.length > 0 ? ids.join(' ') : undefined
}

function FieldError({
  id,
  error,
}: {
  readonly id: string
  readonly error: ToolOptionsError | null
}) {
  const { t } = useMobileLocale()
  if (!error) return null
  return (
    <ProblemNote id={id} className="pdf-tools-field-error" testId="pdf-tools-field-error">
      {t(optionsErrorKey(error))}
    </ProblemNote>
  )
}

export interface TextFieldProps {
  readonly label: string
  readonly value: string
  onChange(value: string): void
  onBlur?(): void
  /** shown under the field (page count, notes) */
  readonly hint?: ReactNode
  readonly placeholder?: string
  /** the error that belongs to this field, or null */
  readonly error?: ToolOptionsError | null
  /** a password: hidden, never filled in or corrected by the keyboard */
  readonly secret?: boolean
  readonly inputMode?: 'text' | 'numeric' | 'decimal'
}

export function TextField({
  label,
  value,
  onChange,
  onBlur,
  hint,
  placeholder,
  error = null,
  secret = false,
  inputMode = 'text',
}: TextFieldProps) {
  const id = useId()
  return (
    <div className="pdf-tools-field">
      <label htmlFor={id} className="pdf-tools-field-label">
        {label}
      </label>
      <input
        id={id}
        className="mobile-input pdf-tools-input"
        type={secret ? 'password' : 'text'}
        inputMode={secret ? undefined : inputMode}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint !== undefined, error)}
        onChange={(e) => onChange(e.currentTarget.value)}
        onBlur={onBlur}
      />
      {hint !== undefined && (
        <p id={`${id}-hint`} className="pdf-tools-field-hint">
          {hint}
        </p>
      )}
      <FieldError id={`${id}-error`} error={error} />
    </div>
  )
}

export interface Choice<T> {
  readonly value: T
  readonly label: string
}

export interface ChoiceGroupProps<T> {
  /** the visible group name; without one, `name` names the group for screen readers */
  readonly legend?: string
  readonly name?: string
  readonly choices: readonly Choice<T>[]
  readonly value: T
  onPick(value: T): void
  /** two choices a row for short labels */
  readonly columns?: 1 | 2
}

/** One choice of several: native radios, so arrow keys move between them */
export function ChoiceGroup<T extends string | number>({
  legend,
  name,
  choices,
  value,
  onPick,
  columns = 1,
}: ChoiceGroupProps<T>) {
  const group = useId()
  return (
    <fieldset
      className="pdf-tools-choices"
      data-columns={columns}
      aria-label={legend ? undefined : name}
    >
      {legend && <legend className="pdf-tools-field-label">{legend}</legend>}
      <div className="pdf-tools-choice-list">
        {choices.map((choice) => (
          <label key={String(choice.value)} className="pdf-tools-choice">
            <input
              type="radio"
              name={group}
              checked={choice.value === value}
              onChange={() => onPick(choice.value)}
            />
            <span className="pdf-tools-choice-text">{choice.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export interface CheckGroupProps<T> {
  readonly legend: string
  readonly choices: readonly Choice<T>[]
  readonly chosen: readonly T[]
  onToggle(value: T, on: boolean): void
  readonly error?: ToolOptionsError | null
}

/** Any number of choices: checkboxes under one visible name */
export function CheckGroup<T extends string>({
  legend,
  choices,
  chosen,
  onToggle,
  error = null,
}: CheckGroupProps<T>) {
  const id = useId()
  return (
    <fieldset
      className="pdf-tools-choices"
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(id, false, error)}
    >
      <legend className="pdf-tools-field-label">{legend}</legend>
      <div className="pdf-tools-choice-list">
        {choices.map((choice) => (
          <label key={choice.value} className="pdf-tools-choice">
            <input
              type="checkbox"
              checked={chosen.includes(choice.value)}
              onChange={(e) => onToggle(choice.value, e.currentTarget.checked)}
            />
            <span className="pdf-tools-choice-text">{choice.label}</span>
          </label>
        ))}
      </div>
      <FieldError id={`${id}-error`} error={error} />
    </fieldset>
  )
}

export interface ToggleRowProps {
  readonly label: string
  readonly checked: boolean
  onChange(checked: boolean): void
}

/** An on/off option: the label on the left, a switch on the right, the whole row taps */
export function ToggleRow({ label, checked, onChange }: ToggleRowProps) {
  return (
    <label className="pdf-tools-toggle">
      <span className="pdf-tools-toggle-text">{label}</span>
      <input
        type="checkbox"
        role="switch"
        className="mobile-switch"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
    </label>
  )
}

/** A note under a group of options */
export function Note({ children }: { readonly children: ReactNode }) {
  return <p className="pdf-tools-field-hint">{children}</p>
}
