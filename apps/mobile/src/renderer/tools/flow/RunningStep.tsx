/**
 * The running step (spec 5.3, running): a bar that counts when the tool reports
 * its progress and moves on its own otherwise, and [Stop]. Back while this
 * is up asks first; the flow owns that layer.
 */
import { useMobileLocale } from '../../i18n'

export interface RunningStepProps {
  /** what is being done: a tool run or the blank-page search */
  readonly finding: boolean
  readonly progress: { readonly done: number; readonly total: number } | null
  onStop(): void
}

export function RunningStep({ finding, progress, onStop }: RunningStepProps) {
  const { t } = useMobileLocale()
  const counted = progress !== null && progress.total > 0
  const label = counted
    ? t(finding ? 'pdfToolsFindingBlank' : 'pdfToolsWorkingProgress', {
        done: progress.done,
        total: progress.total,
      })
    : t('pdfToolsRunning')
  const percent = counted ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0

  return (
    <div className="pdf-tools-running" data-testid="pdf-tools-running">
      <p className="pdf-tools-running-label" aria-live="polite">
        {label}
      </p>
      <div
        className="pdf-tools-progress"
        role="progressbar"
        aria-label={label}
        aria-valuemin={counted ? 0 : undefined}
        aria-valuemax={counted ? progress.total : undefined}
        aria-valuenow={counted ? progress.done : undefined}
        data-indeterminate={counted ? undefined : 'true'}
      >
        <div
          className="pdf-tools-progress-fill"
          style={counted ? { width: `${percent}%` } : undefined}
        />
      </div>
      <div className="pdf-tools-step-actions">
        <button type="button" className="mobile-touch-btn mobile-btn-secondary" onClick={onStop}>
          {t('pdfToolsStop')}
        </button>
      </div>
    </div>
  )
}
