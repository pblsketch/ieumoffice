// Owner: track T6. "Document folders": linked folders, [Link folder], [Remove] with a count (spec 3.5, 3.11).
import { useCallback, useEffect, useState } from 'react'
import {
  countFolderEntries,
  linkFolder,
  listFolders,
  unlinkFolder,
  type AppPlatform,
  type LinkedFolder,
} from '@genoffice/mobile-bridge/home'
import { isMobileCommandError } from '@genoffice/mobile-bridge/transport'
import type { HomeHost } from '../../home/homeHost'
import { useMobileLocale } from '../../i18n'
import { SettingsConfirm } from './SettingsConfirm'
import './homeSettings.css'

export interface FoldersSectionProps {
  readonly host: HomeHost
  readonly platform?: AppPlatform
}

interface PendingRemoval {
  readonly folder: LinkedFolder
  readonly count: number
}

function isFolder(value: unknown): value is LinkedFolder {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && typeof record.name === 'string'
}

function isCancel(err: unknown): boolean {
  return isMobileCommandError(err) && err.code === 'USER_CANCELLED'
}

export function FoldersSection({ host, platform }: FoldersSectionProps) {
  const { t } = useMobileLocale()
  const client = host.client
  const [folders, setFolders] = useState<readonly LinkedFolder[]>([])
  const [pending, setPending] = useState<PendingRemoval | null>(null)
  const [busy, setBusy] = useState(false)

  const fail = useCallback(
    () => host.showToast({ message: t('homeSetFailed'), tone: 'error' }),
    [host, t],
  )

  const reload = useCallback(async () => {
    try {
      const list = await listFolders(client)
      setFolders(list.filter(isFolder))
    } catch {
      setFolders([])
    }
  }, [client])

  useEffect(() => {
    void reload()
  }, [reload])

  const link = async (replaceId?: string) => {
    if (busy) return
    setBusy(true)
    try {
      await linkFolder(client, replaceId)
      await reload()
      void host.refreshHome()
    } catch (err) {
      if (!isCancel(err)) fail()
    } finally {
      setBusy(false)
    }
  }

  const askRemove = async (folder: LinkedFolder) => {
    if (busy) return
    setBusy(true)
    try {
      const res: unknown = await countFolderEntries(client, folder.id)
      const count =
        res && typeof res === 'object' && typeof (res as { count?: unknown }).count === 'number'
          ? (res as { count: number }).count
          : 0
      setPending({ folder, count })
    } catch {
      fail()
    } finally {
      setBusy(false)
    }
  }

  const cancelRemove = useCallback(() => setPending(null), [])

  const confirmRemove = async () => {
    if (!pending || busy) return
    setBusy(true)
    try {
      await unlinkFolder(client, pending.folder.id)
      setPending(null)
      await reload()
      void host.refreshHome()
    } catch {
      setPending(null)
      fail()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="mobile-section"
      aria-label={t('homeSetFoldersTitle')}
      data-testid="home-set-folders"
    >
      <h2 className="mobile-section-heading">{t('homeSetFoldersTitle')}</h2>
      <div className="mobile-card">
        {folders.length === 0 ? (
          <p className="mobile-muted">{t('homeSetFoldersEmpty')}</p>
        ) : (
          <ul className="mobile-list home-set-folder-list">
            {folders.map((folder) => {
              const lost = folder.status === 'lost'
              return (
                <li key={folder.id} className="mobile-list-item-col home-set-folder">
                  <div className="mobile-list-row">
                    <span className="home-set-text">
                      <span className="mobile-list-name">{folder.name}</span>
                      <span className="home-set-desc">
                        {lost ? t('homeSetFolderLost') : t('homeSetFolderOk')}
                      </span>
                    </span>
                  </div>
                  <div className="mobile-row-actions">
                    {lost && (
                      <button
                        type="button"
                        className="mobile-touch-btn mobile-btn-secondary"
                        onClick={() => void link(folder.id)}
                        disabled={busy}
                      >
                        {t('homeSetFolderRelink')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="mobile-touch-btn mobile-btn-ghost mobile-btn-danger-text"
                      aria-label={t('homeSetFolderRemoveNamed', { name: folder.name })}
                      onClick={() => void askRemove(folder)}
                      disabled={busy}
                    >
                      {t('homeSetFolderRemove')}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <div className="mobile-row-actions">
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-secondary"
            onClick={() => void link()}
            disabled={busy}
          >
            {t('homeSetFolderLink')}
          </button>
        </div>
      </div>
      <SettingsConfirm
        open={pending !== null}
        title={pending ? t('homeSetFolderRemoveTitle', { name: pending.folder.name }) : ''}
        body={pending ? t('homeSetFolderRemoveBody', { count: pending.count }) : ''}
        actionLabel={t('homeSetFolderRemove')}
        busy={busy}
        platform={platform}
        onConfirm={() => void confirmRemove()}
        onCancel={cancelRemove}
      />
    </section>
  )
}
