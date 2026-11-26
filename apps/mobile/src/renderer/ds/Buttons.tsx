import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Spinner } from './Progress'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'mobile-btn-primary',
  secondary: 'mobile-btn-secondary',
  ghost: 'mobile-btn-ghost',
  danger: 'mobile-btn-secondary mobile-btn-danger-text',
}

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  readonly variant?: ButtonVariant
  /** Leading icon (an <Icon size="m">). */
  readonly icon?: ReactNode
  /** Waiting: keeps its width, shows a turning circle in place of the label. */
  readonly busy?: boolean
  /** Spoken name while busy (the caller's "Working…" string); the label is used when left out. */
  readonly busyLabel?: string
  /** Fill the row (for StickyActions and sheet action rows). */
  readonly wide?: boolean
  readonly children: ReactNode
}

/** Text button with the four variants of the design system (5.7). */
export function Button({
  variant = 'secondary',
  icon,
  busy = false,
  busyLabel,
  wide = false,
  disabled,
  className,
  children,
  type = 'button',
  onClick,
  ...rest
}: ButtonProps) {
  const classes = ['mobile-touch-btn', VARIANT_CLASS[variant], 'ds-btn']
  if (wide) classes.push('ds-btn-wide')
  if (busy) classes.push('ds-btn-busy')
  if (className) classes.push(className)
  // A busy button keeps keyboard focus (aria-disabled, not disabled) but ignores presses.
  return (
    <button
      type={type}
      className={classes.join(' ')}
      disabled={disabled}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      onClick={busy ? undefined : onClick}
      {...rest}
    >
      {icon && <span className="ds-btn-icon">{icon}</span>}
      <span className="ds-btn-label">{children}</span>
      {busy && (
        <span className="ds-btn-spinner">
          <Spinner
            label={busyLabel ?? (typeof children === 'string' ? children : '')}
            immediate
            size="s"
          />
        </span>
      )}
    </button>
  )
}

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children'
> {
  /** Spoken name; required because the button shows no text. */
  readonly label: string
  readonly icon: ReactNode
  /** Toggle button: true or false sets aria-pressed; leave out for a plain action. */
  readonly pressed?: boolean
  /** Round floating look (FloatingTools). */
  readonly round?: boolean
}

/** Icon-only button: 48 press area, name required (5.7). */
export function IconButton({
  label,
  icon,
  pressed,
  round = false,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const classes = ['mobile-icon-btn', 'ds-icon-btn']
  if (round) classes.push('ds-icon-btn-round')
  if (className) classes.push(className)
  return (
    <button
      type={type}
      className={classes.join(' ')}
      aria-label={label}
      title={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      {...rest}
    >
      {icon}
    </button>
  )
}

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  readonly selected: boolean
  readonly icon?: ReactNode
  readonly children: ReactNode
}

/** Filter chip: 32 visible, 48 press area (the home filter chip look). */
export function Chip({ selected, icon, className, children, type = 'button', ...rest }: ChipProps) {
  return (
    <button
      type={type}
      className={className ? `home-frame-chip ds-chip ${className}` : 'home-frame-chip ds-chip'}
      aria-pressed={selected}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}
