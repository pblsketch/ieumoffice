import { useEffect, useState } from 'react'
import { PROGRESS_DELAY_MS } from './sizes'

/** True once `delayMs` has passed while `active` stays true; false again when it ends. */
export function useDelayedVisible(active: boolean, delayMs: number = PROGRESS_DELAY_MS): boolean {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!active) {
      setVisible(false)
      return
    }
    const timer = setTimeout(() => setVisible(true), delayMs)
    return () => clearTimeout(timer)
  }, [active, delayMs])
  return active && visible
}

export interface SpinnerProps {
  /** Spoken name of what is loading. */
  readonly label: string
  /** Show without the 300 ms delay (inside a button that is already busy). */
  readonly immediate?: boolean
  readonly size?: 's' | 'm'
}

/** Turning circle, shown only when the wait lasts longer than 300 ms. */
export function Spinner({ label, immediate = false, size = 'm' }: SpinnerProps) {
  const delayed = useDelayedVisible(!immediate)
  if (!immediate && !delayed) return null
  return (
    <span
      className={`mobile-spinner ds-spinner ds-spinner-${size}`}
      role="progressbar"
      aria-busy="true"
      aria-label={label}
      data-testid="ds-spinner"
    />
  )
}

export interface LinearProgressProps {
  /** Spoken name of the work. */
  readonly label: string
  /** 0 to 1; leave out when the amount is unknown (flowing bar). */
  readonly value?: number
}

/** Progress bar for work inside a sheet or a step screen (pair it with a Stop button). */
export function LinearProgress({ label, value }: LinearProgressProps) {
  const known = typeof value === 'number' && Number.isFinite(value)
  const ratio = known ? Math.min(1, Math.max(0, value as number)) : 0
  return (
    <div
      className={known ? 'ds-progress' : 'ds-progress ds-progress-flowing'}
      role="progressbar"
      aria-label={label}
      aria-valuemin={known ? 0 : undefined}
      aria-valuemax={known ? 100 : undefined}
      aria-valuenow={known ? Math.round(ratio * 100) : undefined}
      data-testid="ds-progress"
    >
      <span className="ds-progress-fill" style={known ? { width: `${ratio * 100}%` } : undefined} />
    </div>
  )
}

export interface DocSkeletonProps {
  /** Spoken and shown progress text ("Opening…"), given by the caller's strings. */
  readonly label: string
  /** Keep showing while the document opens. */
  readonly active: boolean
}

/** Page-shaped placeholder where the document will be, after 300 ms of opening. */
export function DocSkeleton({ label, active }: DocSkeletonProps) {
  const visible = useDelayedVisible(active)
  if (!visible) return null
  return (
    <div className="ds-doc-skeleton" role="status" aria-busy="true" data-testid="ds-doc-skeleton">
      <div className="ds-doc-skeleton-page" aria-hidden="true">
        <span className="ds-doc-skeleton-line ds-doc-skeleton-title" />
        <span className="ds-doc-skeleton-line" />
        <span className="ds-doc-skeleton-line" />
        <span className="ds-doc-skeleton-line ds-doc-skeleton-short" />
      </div>
      <p className="mobile-muted">{label}</p>
    </div>
  )
}
