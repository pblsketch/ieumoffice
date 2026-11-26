import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import {
  clearMobileAiResults,
  getMobileAiResultsSize,
  type MobileAiCommandClient,
  type MobileAiResultsSize,
} from '@genoffice/mobile-bridge/ai-bridge'
import { useMobileLocale } from '../i18n'
import { AiConfirmSheet } from './AiConfirmSheet'
import { isMobileAiRunning, mobileAiRunState, subscribeMobileAiRunState } from './runState'
import { formatAiBytes } from './settingsText'

/**
 * The AI result store (`ai-results/`: pictures the AI made or fetched, copies
 * of attached photos): its size and a [clear] behind a confirm sheet. Hidden
 * when AI is off and the store is empty (design system: no AI UI when AI is off);
 * still shown when AI was turned off after creating files so the user can clear
 * them. Clearing waits while an AI run is going, since that run may be writing
 * or reading a picture there.
 */
export function AiResultsRows({
  client,
  aiEnabled = true,
}: {
  readonly client: MobileAiCommandClient
  readonly aiEnabled?: boolean
}) {
  const { t, lang } = useMobileLocale()
  const run = useSyncExternalStore(subscribeMobileAiRunState, mobileAiRunState, mobileAiRunState)
  const [size, setSize] = useState<MobileAiResultsSize | null>(null)
  const [unreadable, setUnreadable] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const reload = useCallback(async () => {
    try {
      setSize(await getMobileAiResultsSize(client))
      setUnreadable(false)
    } catch {
      setUnreadable(true)
    }
  }, [client])

  useEffect(() => {
    void reload()
  }, [reload])

  const cancel = useCallback(() => setConfirming(false), [])

  const confirmClear = async () => {
    if (busy) return
    if (isMobileAiRunning()) {
      setConfirming(false)
      return
    }
    setBusy(true)
    setFailed(false)
    try {
      setSize(await clearMobileAiResults(client))
    } catch {
      setFailed(true)
    } finally {
      setConfirming(false)
      setBusy(false)
    }
    await reload()
  }

  const empty = size !== null && size.bytes === 0 && size.files === 0
  const hasStoredFiles = size !== null && (size.bytes > 0 || size.files > 0)
  if (!aiEnabled && !hasStoredFiles) return null
  const sizeText = size
    ? t('aiResultsSize', { size: formatAiBytes(size.bytes, lang), count: size.files })
    : unreadable
      ? t('aiResultsUnknown')
      : ''

  return (
    <div className="mobile-card" data-testid="ai-results-card">
      <h3 className="mobile-card-subtitle">{t('aiResultsTitle')}</h3>
      <div className="mobile-list-row ai-set-results-row" data-testid="ai-results-row">
        <span className="mobile-set-label" data-testid="ai-results-size">
          {sizeText}
        </span>
        <button
          type="button"
          className="mobile-touch-btn mobile-btn-secondary mobile-btn-danger-text"
          disabled={run.running || busy || empty}
          onClick={() => setConfirming(true)}
          data-testid="ai-results-clear"
        >
          {t('aiClear')}
        </button>
      </div>
      {run.running && (
        <p className="ai-set-hint" data-testid="ai-results-busy">
          {t('aiResultsClearBusy')}
        </p>
      )}
      {failed && (
        <p className="ai-set-reason" role="alert">
          {t('aiResultsClearFailed')}
        </p>
      )}
      <AiConfirmSheet
        open={confirming}
        title={t('aiResultsClearTitle')}
        body={t('aiResultsClearBody')}
        confirmLabel={t('aiClear')}
        cancelLabel={t('cancel')}
        onConfirm={() => void confirmClear()}
        onCancel={cancel}
        confirmDisabled={busy || run.running}
        danger
        testId="ai-results-clear-sheet"
      />
    </div>
  )
}
