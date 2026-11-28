import { useCallback } from 'react'
import type { Lang } from '@genoffice/i18n'
import type { DriveEntry, DriveListingRequest } from '../../shared/drive-api'
import { DRIVE_ERROR_KEYS, DriveBrowser, type DrivePickOutcome } from './DriveBrowser'
import { FAILURE_KEYS as PICK_FAILURE_KEYS } from './drive-failures'
import { DriveNavIcon, useDriveState } from './drive-state'
import { driveUiText, type DriveStringKey } from './i18n/strings-drive'
import './drive.css'

export { DriveNavIcon, useDriveState }

export function DrivePanel({
  lang,
  dateLocale,
  onOpenSettings,
}: {
  lang: Lang
  dateLocale: string
  /** Settings → Integrations, where Drive is connected */
  onOpenSettings: () => void
}) {
  const t = (key: DriveStringKey) => driveUiText(lang, key)
  const state = useDriveState()

  const list = useCallback(
    (listing: DriveListingRequest, pageToken?: string) =>
      window.aiOfficeDrive!.list(listing, pageToken),
    [],
  )

  const open = async (entry: DriveEntry): Promise<DriveStringKey | null> => {
    const result = await window.aiOfficeDrive!.open(entry.id).catch(() => null)
    return result?.ok ? null : DRIVE_ERROR_KEYS[result?.kind ?? 'network']
  }

  const pick = async (): Promise<DrivePickOutcome> => {
    const result = await window.aiOfficeDrive!.pickOpen().catch(() => null)
    if (!result) return { error: 'driveErrNetwork' }
    if (result.ok) {
      if (result.problem) return { error: DRIVE_ERROR_KEYS[result.problem] }
      return result.opened === 0 && result.picked > 1 ? { added: result.picked } : {}
    }
    if (result.reason === 'cancelled' || result.reason === 'busy') return {}
    if (result.reason === 'not-connected') return { error: 'driveErrNotConnected' }
    return { error: PICK_FAILURE_KEYS[result.reason] }
  }

  if (!state || state.state === 'unavailable') return <main className="content drive-panel" />

  if (state.state !== 'connected') {
    return (
      <main className="content drive-panel">
        <div className="drive-head">
          <h2 className="drive-title">{t('driveNav')}</h2>
        </div>
        <div className="drive-empty-card">
          <div className="drive-empty-title">{t('driveNotConnectedTitle')}</div>
          <p className="drive-empty-body">{t('driveNotConnectedBody')}</p>
          {state.state === 'disconnected' && state.expired && (
            <p className="drive-warn">{t('driveExpired')}</p>
          )}
          <button className="drive-primary" onClick={onOpenSettings}>
            {t('driveOpenSettings')}
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="content drive-panel">
      <div className="drive-head">
        <h2 className="drive-title">{t('driveNav')}</h2>
        <span className="drive-account">{state.email || state.name}</span>
      </div>
      {state.trainingAck ? (
        <DriveBrowser
          lang={lang}
          dateLocale={dateLocale}
          list={list}
          onOpen={open}
          onPick={pick}
          picking={state.picking}
        />
      ) : (
        <div className="drive-empty-card">
          <div className="drive-empty-title">{t('driveTrainingTitle')}</div>
          <p className="drive-empty-body">{t('driveTrainingBody')}</p>
          <button className="drive-primary" onClick={onOpenSettings}>
            {t('driveOpenSettings')}
          </button>
        </div>
      )}
    </main>
  )
}
