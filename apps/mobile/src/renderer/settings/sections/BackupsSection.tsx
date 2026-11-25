// Owner: track T6 (HWP original backups and their total size).
import type { HwpBackupEntry, MobileRestoreTarget } from '@genoffice/mobile-bridge/transport'
import { useMobileLocale } from '../../i18n'
import { DocTypeIcon } from '../../components/MobileIcons'
import { formatBytes } from './homeSettingsModel'

export interface BackupsSectionProps {
  readonly backups: readonly HwpBackupEntry[]
  readonly onRestoreBackup: (backupId: string, target: MobileRestoreTarget) => Promise<void>
  readonly onDeleteBackup: (backupId: string) => Promise<void>
}

export function BackupsSection({ backups, onRestoreBackup, onDeleteBackup }: BackupsSectionProps) {
  const { t, lang } = useMobileLocale()
  const totalBytes = backups.reduce(
    (sum, item) => sum + (Number.isFinite(item.sizeBytes) ? item.sizeBytes : 0),
    0,
  )
  return (
    <section className="mobile-section" aria-label={t('settingsBackupsSection')}>
      <div className="mobile-section-bar">
        <h2 className="mobile-section-heading">{t('settingsBackupsSection')}</h2>
        {backups.length > 0 && (
          <span className="mobile-section-count" data-testid="home-set-backups-total">
            {t('homeSetBackupsTotal', { size: formatBytes(totalBytes, lang) })}
          </span>
        )}
      </div>
      <div className="mobile-card">
        {backups.length === 0 ? (
          <p className="mobile-muted">{t('settingsBackupsEmpty')}</p>
        ) : (
          <ul className="mobile-list" data-testid="settings-backup-list">
            {backups.map((item) => (
              <li key={item.backupId} className="mobile-list-item-col mobile-backup-item">
                <div className="mobile-list-row">
                  <div className="mobile-list-meta">
                    <DocTypeIcon format={item.format} size={26} />
                    <span className="mobile-list-name">{item.originalName}</span>
                  </div>
                  <span className="mobile-badge">{item.format.toUpperCase()}</span>
                </div>
                <div className="mobile-row-actions">
                  <button
                    type="button"
                    className="mobile-touch-btn mobile-btn-secondary"
                    onClick={() => void onRestoreBackup(item.backupId, 'in-place')}
                  >
                    {t('backupRestoreInPlace')}
                  </button>
                  <button
                    type="button"
                    className="mobile-touch-btn mobile-btn-secondary"
                    onClick={() => void onRestoreBackup(item.backupId, 'save-as')}
                  >
                    {t('backupRestoreSaveAs')}
                  </button>
                  <button
                    type="button"
                    className="mobile-touch-btn mobile-btn-ghost mobile-btn-danger-text"
                    onClick={() => void onDeleteBackup(item.backupId)}
                  >
                    {t('backupDelete')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
