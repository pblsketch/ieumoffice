/**
 * How the tools screens show something that went wrong: a run that ended
 * without a result, a refusal, an option or a file the tool cannot use. The
 * error colour and an alert mark, so the message is not told by colour alone.
 * Pure notes (the blank-page note, the stopped toast) do not use this.
 */
import type { ReactNode } from 'react'
import { SvgIcon } from '../../components/icons/svgIcon'

function IconAlert({ size = 18 }: { readonly size?: number }) {
  return (
    <SvgIcon size={size} className="pdf-tools-problem-icon">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.5h.01" />
    </SvgIcon>
  )
}

export interface ProblemNoteProps {
  /** 'p' for a block message, 'span' inside a row or a label */
  readonly as?: 'p' | 'span'
  readonly id?: string
  readonly role?: 'alert' | 'status'
  readonly className?: string
  readonly testId?: string
  readonly children: ReactNode
}

export function ProblemNote({
  as: Tag = 'p',
  id,
  role,
  className,
  testId,
  children,
}: ProblemNoteProps) {
  return (
    <Tag
      id={id}
      role={role}
      className={className ? `pdf-tools-problem ${className}` : 'pdf-tools-problem'}
      data-testid={testId}
    >
      <IconAlert />
      <span className="pdf-tools-problem-text">{children}</span>
    </Tag>
  )
}
