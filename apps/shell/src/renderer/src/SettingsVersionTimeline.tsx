import { useCallback, useEffect, useState } from 'react'
import type { VersionTimelineBridge } from '@genoffice/electron-utils/version-timeline-channels'
import { versionTimelineText } from '@genoffice/ui'
import { formatStoreSize } from './SettingsResultStore'
import { useI18n } from './locale'

declare global {
  interface Window {
    aiOfficeVersionTimeline?: VersionTimelineBridge
  }
}

/**
 * Settings -> General: persistent Version Timeline storage row alongside
 * the PDF AI Result Store (`SettingsResultStore`). Displays total disk usage
 * and deletes all saved snapshots only after explicit confirmation.
 */
export function VersionTimelineStoreField() {
  const { lang, dateLocale } = useI18n()
  const [bytes, setBytes] = useState<number | null>(null)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const api = window.aiOfficeVersionTimeline
    if (!api) return
    try {
      const stats = await api.getStats()
      setBytes(stats.totalBytes)
    } catch {
      setBytes(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const clearAll = async () => {
    const api = window.aiOfficeVersionTimeline
    if (!api) return
    setAsking(false)
    setBusy(true)
    try {
      await api.clearAll()
    } finally {
      await refresh()
      setBusy(false)
    }
  }

  const sizeText = bytes === null ? '—' : formatStoreSize(bytes, dateLocale)

  return (
    <>
      <div className="set-field" data-testid="version-timeline-store">
        <div className="set-field-text">
          <div className="set-field-stack">
            <div className="set-field-label">{versionTimelineText(lang, 'settingsLabel')}</div>
            <div className="set-field-desc">{versionTimelineText(lang, 'settingsDesc')}</div>
          </div>
        </div>
        <div className="set-field-control">
          <span className="set-field-value">{sizeText}</span>
          <button
            type="button"
            className="set-btn"
            disabled={busy || bytes === 0}
            onClick={() => setAsking(true)}
          >
            {versionTimelineText(lang, 'clearAll')}
          </button>
        </div>
      </div>
      {asking && (
        <div className="set-intg-confirm" role="group">
          <div className="set-field-desc">{versionTimelineText(lang, 'confirmClear')}</div>
          <div className="set-field-control">
            <button type="button" className="set-btn" onClick={() => setAsking(false)}>
              {versionTimelineText(lang, 'cancelBtn')}
            </button>
            <button
              type="button"
              className="set-btn set-btn-danger"
              onClick={() => void clearAll()}
            >
              {versionTimelineText(lang, 'confirmBtn')}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
