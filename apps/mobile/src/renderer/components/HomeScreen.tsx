import { useMemo, useState } from 'react'
import { htmlLang } from '@genoffice/i18n'
import type { RecentDocEntry, RecoveryEntry } from '@genoffice/mobile-bridge/transport'
import { useMobileLocale } from '../i18n'
import {
  DocTypeIcon,
  IconChevronRight,
  IconFileText,
  IconFolderOpen,
  IconSettings,
  IeumAppIcon,
} from './MobileIcons'

type RecentFilter = 'all' | 'hwp' | 'md'

function formatOpenedTime(timestamp: number, locale: string): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
  try {
    const date = new Date(timestamp)
    const now = new Date()
    const sameDay =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    if (sameDay) {
      return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)
    }
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
    }).format(date)
  } catch {
    return ''
  }
}

export interface HomeScreenProps {
  readonly recentDocs: readonly RecentDocEntry[]
  readonly recoveryEntries: readonly RecoveryEntry[]
  readonly permissionDeniedRecentId: string | null
  readonly defaultHwpFormat: 'hwp' | 'hwpx'
  readonly onCreateNew: (format: 'hwp' | 'hwpx' | 'md') => void
  readonly onOpenFile: () => void
  readonly onOpenRecent: (entry: RecentDocEntry) => void
  readonly onRemoveRecent: (id: string) => void
  readonly onRestoreRecovery: (entry: RecoveryEntry) => void
  readonly onDiscardRecovery: (docKey: string) => void
  readonly onOpenSettings: () => void
}

export function HomeScreen({
  recentDocs,
  recoveryEntries,
  permissionDeniedRecentId,
  defaultHwpFormat,
  onCreateNew,
  onOpenFile,
  onOpenRecent,
  onRemoveRecent,
  onRestoreRecovery,
  onDiscardRecovery,
  onOpenSettings,
}: HomeScreenProps) {
  const { lang, t } = useMobileLocale()
  const [filter, setFilter] = useState<RecentFilter>('all')
  const locale = htmlLang(lang)

  const hasBothFamilies = useMemo(() => {
    let hwp = false
    let md = false
    for (const doc of recentDocs) {
      if (doc.format === 'hwp' || doc.format === 'hwpx') hwp = true
      else md = true
    }
    return hwp && md
  }, [recentDocs])

  const filteredRecent = useMemo(() => {
    if (!hasBothFamilies || filter === 'all') return recentDocs
    return recentDocs.filter((doc) =>
      filter === 'hwp'
        ? doc.format === 'hwp' || doc.format === 'hwpx'
        : doc.format === 'md' || doc.format === 'txt',
    )
  }, [filter, hasBothFamilies, recentDocs])

  return (
    <div className="mobile-page" data-testid="mobile-home-screen">
      <header className="mobile-appbar">
        <div className="mobile-brand-wrap">
          <IeumAppIcon size={28} />
          <h1 className="mobile-appbar-title">{t('appTitle')}</h1>
        </div>
        <button
          type="button"
          className="mobile-icon-btn"
          onClick={onOpenSettings}
          aria-label={t('settings')}
          title={t('settings')}
          data-testid="home-settings-btn"
        >
          <IconSettings size={21} />
        </button>
      </header>

      <main className="mobile-page-body">
        {recoveryEntries.length > 0 && (
          <section
            className="mobile-card mobile-recovery-banner"
            aria-label={t('recoveryBannerTitle')}
            data-testid="home-recovery-banner"
          >
            <h2 className="mobile-section-title">{t('recoveryBannerTitle')}</h2>
            <ul className="mobile-list">
              {recoveryEntries.map((entry) => (
                <li key={entry.docKey} className="mobile-list-item-col">
                  <div className="mobile-list-row">
                    <div className="mobile-list-meta">
                      <DocTypeIcon format={entry.format} size={26} />
                      <span className="mobile-list-name">{entry.title}</span>
                      <span className="mobile-badge">{entry.format.toUpperCase()}</span>
                    </div>
                  </div>
                  <div className="mobile-row-actions">
                    <button
                      type="button"
                      className="mobile-touch-btn mobile-btn-primary"
                      onClick={() => onRestoreRecovery(entry)}
                    >
                      {t('recoveryRestore')}
                    </button>
                    <button
                      type="button"
                      className="mobile-touch-btn mobile-btn-ghost"
                      onClick={() => onDiscardRecovery(entry.docKey)}
                    >
                      {t('recoveryDiscard')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mobile-home-cta-group" aria-label={t('newDoc')}>
          <div className="mobile-home-create-grid">
            <button
              type="button"
              className="mobile-quick-card"
              onClick={() => onCreateNew(defaultHwpFormat)}
              data-testid="home-new-hwp-btn"
            >
              <DocTypeIcon format={defaultHwpFormat} size={38} />
              <div className="mobile-quick-card-text">
                <span className="mobile-quick-card-title">
                  {defaultHwpFormat === 'hwpx' ? t('newHwpx') : t('newHwp')}
                </span>
                <span className="mobile-quick-card-sub">.{defaultHwpFormat}</span>
              </div>
            </button>

            <button
              type="button"
              className="mobile-quick-card"
              onClick={() => onCreateNew('md')}
              data-testid="home-new-md-btn"
            >
              <DocTypeIcon format="md" size={38} />
              <div className="mobile-quick-card-text">
                <span className="mobile-quick-card-title">{t('newMarkdown')}</span>
                <span className="mobile-quick-card-sub">.md</span>
              </div>
            </button>
          </div>

          <button
            type="button"
            className="mobile-open-card"
            onClick={onOpenFile}
            data-testid="home-open-file-btn"
          >
            <span className="mobile-quick-folder" aria-hidden="true">
              <IconFolderOpen size={19} />
            </span>
            <span className="mobile-open-card-text">
              <span className="mobile-quick-card-title">{t('openFile')}</span>
              <span className="mobile-quick-card-sub">.hwp · .hwpx · .md · .txt</span>
            </span>
            <IconChevronRight size={18} className="mobile-chevron" />
          </button>
        </section>

        <section className="mobile-section" aria-label={t('recentDocs')}>
          <div className="mobile-section-bar">
            <div className="mobile-section-heading-wrap">
              <h2 className="mobile-section-heading">{t('recentDocs')}</h2>
              {recentDocs.length > 0 && (
                <span className="mobile-section-count">{recentDocs.length}</span>
              )}
            </div>
            {hasBothFamilies && (
              <div className="mobile-filter-pills" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === 'all'}
                  className={filter === 'all' ? 'mobile-filter-pill active' : 'mobile-filter-pill'}
                  onClick={() => setFilter('all')}
                >
                  •
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === 'hwp'}
                  className={filter === 'hwp' ? 'mobile-filter-pill active' : 'mobile-filter-pill'}
                  onClick={() => setFilter('hwp')}
                >
                  HWP
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === 'md'}
                  className={filter === 'md' ? 'mobile-filter-pill active' : 'mobile-filter-pill'}
                  onClick={() => setFilter('md')}
                >
                  MD
                </button>
              </div>
            )}
          </div>

          {filteredRecent.length === 0 ? (
            <div className="mobile-empty-state">
              <span className="mobile-empty-icon" aria-hidden="true">
                <IconFileText size={26} />
              </span>
              <p className="mobile-muted">{t('recentEmpty')}</p>
            </div>
          ) : (
            <ul className="mobile-doc-list" data-testid="home-recent-list">
              {filteredRecent.map((entry) => {
                const expired = permissionDeniedRecentId === entry.id
                const openedLabel = formatOpenedTime(entry.openedAt, locale)
                return (
                  <li key={entry.id} className="mobile-doc-list-item">
                    <button
                      type="button"
                      className="mobile-doc-row-btn"
                      onClick={() => onOpenRecent(entry)}
                    >
                      <DocTypeIcon format={entry.format} size={34} />
                      <span className="mobile-doc-row-main">
                        <span className="mobile-doc-row-info">
                          <span className="mobile-list-name">{entry.name}</span>
                          <span className="mobile-doc-row-meta">
                            <span>{entry.format.toUpperCase()}</span>
                            {openedLabel && <span>· {openedLabel}</span>}
                          </span>
                        </span>
                        <IconChevronRight size={17} className="mobile-chevron" />
                      </span>
                    </button>
                    {expired && (
                      <div
                        className="mobile-inline-alert mobile-doc-inline-alert"
                        role="alert"
                        data-testid={`recent-expired-${entry.id}`}
                      >
                        <p className="mobile-alert-text">{t('recentPermissionExpired')}</p>
                        <div className="mobile-row-actions">
                          <button
                            type="button"
                            className="mobile-touch-btn mobile-btn-secondary"
                            onClick={onOpenFile}
                          >
                            {t('repickFile')}
                          </button>
                          <button
                            type="button"
                            className="mobile-touch-btn mobile-btn-ghost"
                            onClick={() => onRemoveRecent(entry.id)}
                          >
                            {t('removeFromRecent')}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}
