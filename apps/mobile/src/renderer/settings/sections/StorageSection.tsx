// Owner: track T6 (storage: sizes, clearing temp files and recovery copies). Draws the AI result
// store rows that T7 owns below its own card.
import { useCallback, useEffect, useState } from 'react'
import {
  clearStorage,
  storageUsage,
  type AppPlatform,
  type ClearStorageKind,
  type StorageUsage,
} from '@genoffice/mobile-bridge/home'
import type { MobileAiSettingsSlot } from '../../ai/settingsSlot'
import { useActiveDocKey, useHomeRuntime } from '../../home/homeRuntime'
import type { HomeHost } from '../../home/homeHost'
import { useMobileLocale } from '../../i18n'
import { AiStorageRows } from './AiSection'
import { formatBytes } from './homeSettingsModel'
import { SettingsConfirm } from './SettingsConfirm'
import './homeSettings.css'

export interface StorageSectionProps {
  readonly aiSlot?: MobileAiSettingsSlot
  /** Document key of the open document; its recovery copy is kept when clearing. */
  readonly activeDocKey?: string
  readonly platform?: AppPlatform
}

export function StorageSection({ aiSlot, activeDocKey, platform }: StorageSectionProps) {
  const runtime = useHomeRuntime()
  // without the prop, the document the app layer reports as open
  const openDocKey = useActiveDocKey()
  const keepDocKey = activeDocKey ?? openDocKey ?? undefined
  return (
    <>
      {runtime && <StorageCard host={runtime} activeDocKey={keepDocKey} platform={platform} />}
      <AiStorageRows slot={aiSlot} />
    </>
  )
}

function readUsage(raw: unknown): StorageUsage | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const num = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : null
  const recoveryBytes = num(record.recoveryBytes)
  const tempBytes = num(record.tempBytes)
  const backupBytes = num(record.backupBytes)
  if (recoveryBytes === null || tempBytes === null || backupBytes === null) return null
  return { recoveryBytes, tempBytes, backupBytes }
}

interface StorageCardProps {
  readonly host: HomeHost
  readonly activeDocKey?: string
  readonly platform?: AppPlatform
}

function StorageCard({ host, activeDocKey, platform }: StorageCardProps) {
  const { t, lang } = useMobileLocale()
  const client = host.client
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [pending, setPending] = useState<ClearStorageKind | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      setUsage(readUsage(await storageUsage(client)))
    } catch {
      setUsage(null)
    }
  }, [client])

  useEffect(() => {
    void reload()
  }, [reload])

  const confirmClear = async () => {
    if (!pending || busy) return
    const kind = pending
    setBusy(true)
    try {
      const res: unknown = await clearStorage(
        client,
        kind,
        kind === 'recovery' ? activeDocKey : undefined,
      )
      setPending(null)
      const freed =
        res && typeof res === 'object' ? (res as { freedBytes?: unknown }).freedBytes : undefined
      if (typeof freed === 'number') {
        host.showToast(t('homeSetStorageCleared', { size: formatBytes(freed, lang) }))
      }
      await reload()
      // the home's recovery notice lists the copies that were just cleared
      if (kind === 'recovery') void host.refreshHome()
    } catch {
      setPending(null)
      host.showToast({ message: t('homeSetFailed'), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const cancel = useCallback(() => setPending(null), [])

  const sizeRow = (label: string, bytes: number | undefined) => (
    <div className="mobile-list-row home-set-size-row">
      <span className="home-set-name">{label}</span>
      {bytes !== undefined && <span className="home-set-size">{formatBytes(bytes, lang)}</span>}
    </div>
  )

  return (
    <section
      className="mobile-section"
      aria-label={t('homeSetStorageTitle')}
      data-testid="home-set-storage"
    >
      <h2 className="mobile-section-heading">{t('homeSetStorageTitle')}</h2>
      <div className="mobile-card">
        {sizeRow(t('homeSetStorageRecovery'), usage?.recoveryBytes)}
        {sizeRow(t('homeSetStorageTemp'), usage?.tempBytes)}
        {sizeRow(t('homeSetStorageBackups'), usage?.backupBytes)}
        <div className="mobile-row-actions">
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-secondary"
            onClick={() => setPending('temp')}
            disabled={busy}
          >
            {t('homeSetStorageClearTemp')}
          </button>
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-secondary mobile-btn-danger-text"
            onClick={() => setPending('recovery')}
            disabled={busy}
          >
            {t('homeSetStorageClearRecovery')}
          </button>
        </div>
      </div>
      <SettingsConfirm
        open={pending !== null}
        title={
          pending === 'recovery'
            ? t('homeSetStorageClearRecoveryTitle')
            : t('homeSetStorageClearTempTitle')
        }
        body={
          pending === 'recovery'
            ? t('homeSetStorageClearRecoveryBody')
            : t('homeSetStorageClearTempBody')
        }
        actionLabel={t('homeSetStorageClearAction')}
        busy={busy}
        platform={platform}
        onConfirm={() => void confirmClear()}
        onCancel={cancel}
      />
    </section>
  )
}
