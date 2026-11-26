import type { ReactNode } from 'react'

export interface ScreenHeaderProps {
  readonly title: ReactNode
  /** One line under the title. */
  readonly description?: ReactNode
  /** Buttons at the right end. */
  readonly actions?: ReactNode
  readonly testId?: string
}

/** Head of a home tab screen (recent, folders, tools, settings): rule 4.4. */
export function ScreenHeader({ title, description, actions, testId }: ScreenHeaderProps) {
  return (
    <header className="ds-screen-header" data-testid={testId}>
      <div className="ds-screen-header-text">
        <h1 className="ds-screen-title">{title}</h1>
        {description && <p className="mobile-muted">{description}</p>}
      </div>
      {actions && <div className="ds-screen-actions">{actions}</div>}
    </header>
  )
}

export interface EmptyStateProps {
  /** An <Icon size="xl"> or picture; drawn on a round backing. */
  readonly icon: ReactNode
  readonly title: ReactNode
  readonly body?: ReactNode
  /** The one main button. */
  readonly action?: ReactNode
  /** At most one secondary button. */
  readonly secondaryAction?: ReactNode
  /** Inside a sheet: no dashed frame. */
  readonly plain?: boolean
  readonly testId?: string
}

/** The one empty-state shape (rule 4.6). */
export function EmptyState({
  icon,
  title,
  body,
  action,
  secondaryAction,
  plain = false,
  testId,
}: EmptyStateProps) {
  return (
    <div
      className={plain ? 'mobile-empty-state ds-empty-plain' : 'mobile-empty-state'}
      data-testid={testId}
    >
      <span className="mobile-empty-icon" aria-hidden="true">
        {icon}
      </span>
      <h2 className="ds-empty-title">{title}</h2>
      {body && <p className="mobile-muted">{body}</p>}
      {(action || secondaryAction) && (
        <div className="ds-empty-actions">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  )
}

/** Main buttons fixed at the bottom of a step screen, above the keyboard and safe area (rule 4.7). */
export function StickyActions({
  children,
  testId,
}: {
  readonly children: ReactNode
  readonly testId?: string
}) {
  return (
    <div className="ds-sticky-actions" data-testid={testId}>
      {children}
    </div>
  )
}

export interface InlineNoticeProps {
  /** Why (for example "Read only"). */
  readonly message: ReactNode
  /** The way out (for example a "Edit a copy" button). */
  readonly action?: ReactNode
  readonly tone?: 'info' | 'warning'
  readonly testId?: string
}

/** Notice over the document: reason plus the button that resolves it (5.12). */
export function InlineNotice({ message, action, tone = 'info', testId }: InlineNoticeProps) {
  return (
    <div className={`ds-inline-notice ds-inline-notice-${tone}`} role="status" data-testid={testId}>
      <span className="ds-inline-notice-text">{message}</span>
      {action}
    </div>
  )
}

export interface FloatingToolsProps {
  /** Spoken name of the group ("View tools"). */
  readonly label: string
  /** Round IconButtons. */
  readonly children: ReactNode
  /** Faded while the document scrolls (tunable). */
  readonly dimmed?: boolean
  readonly testId?: string
}

/** Floating round buttons at the bottom right of a document in view mode (Q2, owner 11-26). */
export function FloatingTools({ label, children, dimmed = false, testId }: FloatingToolsProps) {
  return (
    <div
      className={dimmed ? 'ds-floating-tools ds-floating-dimmed' : 'ds-floating-tools'}
      role="toolbar"
      aria-label={label}
      data-testid={testId}
    >
      {children}
    </div>
  )
}

export interface PageIndicatorProps {
  /** Shown text, for example "3 / 12" or a chapter name with the page. */
  readonly text: ReactNode
  /** Spoken text, for example "Page 3 of 12". */
  readonly label: string
  /** Previous / next buttons for formats that page (EPUB, slides). */
  readonly previous?: ReactNode
  readonly next?: ReactNode
  readonly testId?: string
}

/** Page pill at the bottom left, on the same line as FloatingTools. */
export function PageIndicator({ text, label, previous, next, testId }: PageIndicatorProps) {
  return (
    <div className="ds-page-indicator" data-testid={testId}>
      {previous}
      <span className="ds-page-indicator-text" aria-hidden="true">
        {text}
      </span>
      <span className="mobile-sr-only">{label}</span>
      {next}
    </div>
  )
}
