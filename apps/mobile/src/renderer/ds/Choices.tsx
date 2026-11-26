import { useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface ChoiceOption<T extends string> {
  readonly value: T
  readonly label: ReactNode
  /** Spoken name when the label is not plain text (an icon, a line sample). */
  readonly ariaLabel?: string
  readonly icon?: ReactNode
  readonly disabled?: boolean
}

export interface ChoiceGroupProps<T extends string> {
  /** Spoken name of the group. */
  readonly label: string
  readonly options: ReadonlyArray<ChoiceOption<T>>
  readonly value: T | null
  readonly onChange: (value: T) => void
  /** Tiles in a grid (default) or one row of segments. */
  readonly layout?: 'grid' | 'row'
  readonly testId?: string
}

/**
 * One choice out of several (line spacing, pen shape, page number place). The chosen tile
 * gets the ring of rule 4.1; arrow keys move the choice like a radio group.
 */
export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  layout = 'grid',
  testId,
}: ChoiceGroupProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0)
  const current = options.findIndex((o) => o.value === value)
  const focusIndex = current >= 0 && !options[current].disabled ? current : (enabled[0] ?? -1)

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    // right and left swap in right-to-left languages (ar, he)
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight'
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft'
    const step =
      event.key === forward || event.key === 'ArrowDown'
        ? 1
        : event.key === backward || event.key === 'ArrowUp'
          ? -1
          : 0
    if (step === 0 || enabled.length === 0) return
    event.preventDefault()
    const at = enabled.indexOf(index)
    const next = enabled[(at + step + enabled.length) % enabled.length]
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div
      className={`ds-choice-group ds-choice-group-${layout}`}
      role="radiogroup"
      aria-label={label}
      data-testid={testId}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(el) => {
            refs.current[index] = el
          }}
          type="button"
          role="radio"
          className="mobile-choice-btn ds-choice"
          aria-checked={option.value === value}
          aria-label={option.ariaLabel}
          disabled={option.disabled}
          tabIndex={index === focusIndex ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  )
}

export interface SwatchProps {
  /** Color name to speak ("Red"). */
  readonly label: string
  /** The document color itself (pen, highlighter, signature). It is document data, not a theme color. */
  readonly color: string
  readonly selected: boolean
  readonly onSelect: () => void
}

/**
 * Color sample: always has a thin outline so a black sample stays visible on a dark
 * sheet; the chosen one gets an outer ring (rule 4.1).
 */
export function Swatch({ label, color, selected, onSelect }: SwatchProps) {
  return (
    <button
      type="button"
      className="ds-swatch"
      aria-label={label}
      title={label}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="ds-swatch-face" style={{ background: color }} aria-hidden="true" />
    </button>
  )
}
