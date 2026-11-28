import type { Lang, Params } from '@genoffice/i18n'
import type { PdfBatchItemOutcome, PdfToolError } from '../../../shared/pdf-tools-api'
import { formatBytes } from '../generate/format'
import type { PdfToolsStringKey } from '../i18n/strings-pdf-tools'

interface BatchSummaryProps {
  lang: Lang
  t: (key: PdfToolsStringKey, params?: Params) => string
  items: PdfBatchItemOutcome[]
  errorText: Record<PdfToolError, PdfToolsStringKey>
  firstOutputId?: string
  onReveal(id: string): void
}

export function BatchSummary({
  lang,
  t,
  items,
  errorText,
  firstOutputId,
  onReveal,
}: BatchSummaryProps) {
  const okCount = items.filter((i) => i.status === 'ok').length
  const partialCount = items.filter((i) => i.status === 'target-not-met').length
  const failedCount = items.filter((i) => i.status === 'skipped' || i.status === 'failed').length

  const statusLabel = (status: PdfBatchItemOutcome['status']): string => {
    if (status === 'ok') return t('batchStatusOk')
    if (status === 'target-not-met') return t('batchStatusPartial')
    if (status === 'skipped') return t('batchStatusSkipped')
    return t('batchStatusFailed')
  }

  const reasonText = (item: PdfBatchItemOutcome): string | null => {
    if (item.reason === 'unlocked-missing') return t('batchReasonUnlockedMissing')
    if (item.reason) return t(errorText[item.reason])
    if (item.status === 'target-not-met' && item.achievedBytes !== undefined) {
      return formatBytes(item.achievedBytes, lang)
    }
    return null
  }

  return (
    <div className="pt-batch-summary" role="status">
      <div className="pt-batch-head">
        <strong>
          {t('batchSummary', { ok: okCount, partial: partialCount, failed: failedCount })}
        </strong>
        {firstOutputId && (
          <button type="button" className="pt-btn" onClick={() => onReveal(firstOutputId)}>
            {t('reveal')}
          </button>
        )}
      </div>
      <ul className="pt-batch-list">
        {items.map((item) => {
          const detail = reasonText(item)
          return (
            <li key={item.inputId} className={`pt-batch-row is-${item.status}`}>
              <span className="pt-batch-badge">{statusLabel(item.status)}</span>
              <span className="pt-batch-name" title={item.name}>
                {item.name}
              </span>
              {detail && <span className="pt-batch-reason">{detail}</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
