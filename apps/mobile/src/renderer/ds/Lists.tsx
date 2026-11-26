import type { ChangeEvent, ReactNode } from 'react'

export interface SwitchProps {
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  readonly disabled?: boolean
  /** Spoken name when the switch is not inside a SwitchRow (whose text names it). */
  readonly label?: string
  readonly testId?: string
}

/** On/off switch: a checkbox with the switch role, drawn by the shared `mobile-switch` look. */
export function Switch({ checked, onChange, disabled, label, testId }: SwitchProps) {
  return (
    <input
      type="checkbox"
      role="switch"
      className="mobile-switch"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      aria-checked={checked}
      onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.checked)}
      data-testid={testId}
    />
  )
}

export interface SwitchRowProps extends Omit<SwitchProps, 'label'> {
  readonly title: ReactNode
  readonly hint?: ReactNode
}

/** Settings row whose whole width presses the switch (rule 4.3). */
export function SwitchRow({ title, hint, ...switchProps }: SwitchRowProps) {
  return (
    <label className="mobile-set-row ds-switch-row">
      <span className="ds-row-text">
        <span className="mobile-set-label">{title}</span>
        {hint && <span className="ds-row-hint">{hint}</span>}
      </span>
      <Switch {...switchProps} />
    </label>
  )
}

export interface SettingsGroupProps {
  /** Group heading above the card; every group has one (rule 4.5). */
  readonly title: ReactNode
  /** Short explanation under the card. */
  readonly note?: ReactNode
  readonly children: ReactNode
  readonly testId?: string
}

/**
 * Settings group: heading outside the card, rows as direct children of the card, note
 * under it. Keeps the `mobile-set-card` / `h2.mobile-section-heading` markup the settings
 * tests rely on.
 */
export function SettingsGroup({ title, note, children, testId }: SettingsGroupProps) {
  return (
    <section className="ds-settings-group" data-testid={testId}>
      <h2 className="mobile-section-heading">{title}</h2>
      <div className="mobile-set-card">{children}</div>
      {note && <p className="mobile-muted ds-settings-note">{note}</p>}
    </section>
  )
}

export interface ListRowProps {
  readonly title: ReactNode
  /** Second line: type, time, place. Makes the row the two-line height. */
  readonly subtitle?: ReactNode
  readonly leading?: ReactNode
  /** Value text, a chevron, a switch or a menu button at the end. */
  readonly trailing?: ReactNode
  readonly onPress?: () => void
  readonly selected?: boolean
  /** Marks the row as the open item (current chapter, current slide). */
  readonly current?: boolean
  readonly danger?: boolean
  readonly disabled?: boolean
  readonly testId?: string
}

/** One- or two-line list row (rule 4.5 heights). Pressable when `onPress` is given. */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  onPress,
  selected,
  current,
  danger,
  disabled,
  testId,
}: ListRowProps) {
  const classes = ['ds-list-row', subtitle ? 'ds-list-row-two' : 'ds-list-row-one']
  if (danger) classes.push('ds-list-row-danger')
  if (current) classes.push('ds-list-row-current')
  const body = (
    <>
      {leading && <span className="ds-list-row-leading">{leading}</span>}
      <span className="ds-row-text">
        <span className="ds-list-row-title">{title}</span>
        {subtitle && <span className="ds-row-hint">{subtitle}</span>}
      </span>
      {trailing && <span className="ds-list-row-trailing">{trailing}</span>}
    </>
  )
  if (!onPress) {
    return (
      <div className={classes.join(' ')} aria-current={current || undefined} data-testid={testId}>
        {body}
      </div>
    )
  }
  return (
    <button
      type="button"
      className={classes.join(' ')}
      onClick={onPress}
      disabled={disabled}
      aria-pressed={selected === undefined ? undefined : selected}
      aria-current={current || undefined}
      data-testid={testId}
    >
      {body}
    </button>
  )
}

export interface ActionItem {
  readonly id: string
  readonly label: string
  /** Required: every row of a menu has an icon (rule 4.9). */
  readonly icon: ReactNode
  readonly onSelect: () => void
  readonly danger?: boolean
  readonly disabled?: boolean
}

export interface ActionListProps {
  readonly items: ReadonlyArray<ActionItem>
  readonly testId?: string
}

/**
 * Rows of the "more" and document menus. A row without an icon is not drawn (the rule
 * is that every row has one), so a missing icon shows up in review instead of shipping.
 */
export function ActionList({ items, testId }: ActionListProps) {
  return (
    <div className="mobile-menu-stack ds-action-list" role="menu" data-testid={testId}>
      {items
        .filter((item) => item.icon !== null && item.icon !== undefined && item.icon !== false)
        .map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={item.danger ? 'mobile-menu-row-btn ds-action-danger' : 'mobile-menu-row-btn'}
            disabled={item.disabled}
            onClick={item.onSelect}
            data-testid={`ds-action-${item.id}`}
          >
            <span className="ds-action-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span>{item.label}</span>
          </button>
        ))}
    </div>
  )
}
