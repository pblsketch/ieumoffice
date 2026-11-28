import { useCallback, useEffect, useRef, useState } from 'react'
import {
  countFolderEntries,
  linkFolder,
  listFolders,
  unlinkFolder,
  type AppPlatform,
  type LinkedFolder,
} from '@genoffice/mobile-bridge/home'
import { Sheet } from '../../components/Sheet'
import type { ToastRequest } from '../../components/Toast'
import { HomeActRemoveIcon } from '../../components/icons/home'
import { IconChevronRight, IconFolderOpen, IconMore } from '../../components/MobileIcons'
import { useMobileLocale } from '../../i18n'
import { HomeConfirmDialog } from '../actions'
import type { HomeHost } from '../homeHost'
import { useFoldersRevision } from '../homeRuntime'
import { FolderBrowser } from './FolderBrowser'
import {
  countOf,
  drawable,
  folderErrorKey,
  hostClient,
  isLinkedFolder,
  isLost,
  isUserCancel,
  lostReasonKey,
  platformOf,
} from './folderModel'
import './folders.css'

interface PendingRemoval {
  readonly folder: LinkedFolder
  readonly count: number
  readonly platform: AppPlatform
}

interface Place {
  readonly folderId: string
  readonly path: readonly string[]
}

/**
 * The [Folders] tab (spec 3.5): the linked folders with their state, [Link folder], a lost
 * folder's reason and [Link again], [⋯] → Remove with the entry count; inside a folder, the
 * browser. Without a client (the slot test draws it with `{}`) it shows the empty state only.
 */
export function FoldersView({ host }: { readonly host: HomeHost }) {
  const { t } = useMobileLocale()
  const client = hostClient(host)
  const [folders, setFolders] = useState<readonly LinkedFolder[]>([])
  const [loaded, setLoaded] = useState(false)
  const [place, setPlace] = useState<Place | null>(null)
  const [menuFolder, setMenuFolder] = useState<LinkedFolder | null>(null)
  const [pending, setPending] = useState<PendingRemoval | null>(null)
  const foldersRevision = useFoldersRevision()
  const busy = useRef(false)

  const toast = useCallback(
    (request: ToastRequest) => {
      if (typeof host.showToast === 'function') host.showToast(request)
    },
    [host],
  )

  const refreshHome = useCallback(() => {
    if (typeof host.refreshHome === 'function') void host.refreshHome()
  }, [host])

  const reload = useCallback(async () => {
    if (!client) return
    try {
      setFolders(drawable(await listFolders(client), isLinkedFolder))
    } catch {
      setFolders([])
    } finally {
      setLoaded(true)
    }
  }, [client])

  useEffect(() => {
    void reload()
  }, [reload, foldersRevision])

  /** Runs one bridge step at a time; a second tap while one runs is ignored. */
  const guarded = async (step: () => Promise<void>) => {
    if (busy.current) return
    busy.current = true
    try {
      await step()
    } finally {
      busy.current = false
    }
  }

  const link = (replaceId?: string) => {
    if (!client) return
    void guarded(async () => {
      try {
        await linkFolder(client, replaceId)
      } catch (err) {
        // A cancelled picker is left as it is; nothing asks again (spec 3.5).
        if (isUserCancel(err)) return
        toast({ message: t(folderErrorKey(err) ?? 'homeActFailed'), tone: 'error' })
        return
      }
      await reload()
      refreshHome()
    })
  }

  const askRemove = (folder: LinkedFolder) => {
    if (!client) return
    void guarded(async () => {
      try {
        const [answer, platform] = await Promise.all([
          countFolderEntries(client, folder.id),
          platformOf(client),
        ])
        setPending({ folder, count: countOf(answer), platform })
      } catch (err) {
        const key = folderErrorKey(err)
        if (key) toast({ message: t(key), tone: 'error' })
      }
    })
  }

  const confirmRemove = () => {
    const removal = pending
    if (!client || !removal) return
    void guarded(async () => {
      setPending(null)
      try {
        await unlinkFolder(client, removal.folder.id)
        toast({ message: t('homeFolderRemoved') })
      } catch (err) {
        const key = folderErrorKey(err)
        if (key) toast({ message: t(key), tone: 'error' })
      }
      await reload()
      refreshHome()
    })
  }

  const markLost = useCallback(
    (folderId: string) => {
      setFolders((prev) =>
        prev.map((folder) =>
          folder.id === folderId && !isLost(folder)
            ? { ...folder, status: 'lost', lostReason: folder.lostReason ?? 'revoked' }
            : folder,
        ),
      )
      setPlace(null)
      toast({ message: t('homeFolderLost'), tone: 'error' })
    },
    [t, toast],
  )

  const current = place ? folders.find((folder) => folder.id === place.folderId) : undefined

  if (place && current && client) {
    return (
      <FolderBrowser
        host={host}
        folder={current}
        path={place.path}
        onEnter={(name) => setPlace({ folderId: current.id, path: [...place.path, name] })}
        onUp={() =>
          setPlace((prev) =>
            prev && prev.path.length > 0 ? { ...prev, path: prev.path.slice(0, -1) } : null,
          )
        }
        onLost={() => markLost(current.id)}
      />
    )
  }

  const linkButton = (
    <button
      type="button"
      className="mobile-touch-btn mobile-btn-secondary"
      data-testid="home-folders-link"
      onClick={() => link()}
    >
      {t('homeFolderLink')}
    </button>
  )

  return (
    <section
      className="home-folders"
      aria-label={t('homeFolderListLabel')}
      data-testid="home-folders"
    >
      {folders.length === 0 ? (
        (loaded || !client) && (
          <div className="mobile-empty-state" data-testid="home-folders-empty">
            <span className="mobile-empty-icon" aria-hidden="true">
              <IconFolderOpen size={26} />
            </span>
            <p className="home-folders-empty-title">{t('homeFolderEmptyTitle')}</p>
            <p className="mobile-muted">{t('homeFolderEmptyBody')}</p>
            {linkButton}
          </div>
        )
      ) : (
        <>
          <ul className="mobile-doc-list" data-testid="home-folders-list">
            {folders.map((folder) => (
              <FolderRow
                key={folder.id}
                folder={folder}
                onEnter={() => setPlace({ folderId: folder.id, path: [] })}
                onRelink={() => link(folder.id)}
                onMenu={() => setMenuFolder(folder)}
              />
            ))}
          </ul>
          <div className="home-folders-actions">{linkButton}</div>
        </>
      )}

      <Sheet
        open={menuFolder !== null}
        title={menuFolder?.name ?? ''}
        closeLabel={t('homeActCancel')}
        onClose={() => setMenuFolder(null)}
        testId="home-folders-menu"
      >
        <div className="mobile-menu-stack">
          <button
            type="button"
            className="mobile-menu-row-btn mobile-btn-danger-text"
            data-testid="home-folders-menu-remove"
            onClick={() => {
              const folder = menuFolder
              setMenuFolder(null)
              if (folder) askRemove(folder)
            }}
          >
            <HomeActRemoveIcon size={19} />
            <span>{t('homeFolderRemove')}</span>
          </button>
        </div>
      </Sheet>

      <HomeConfirmDialog
        open={pending !== null}
        title={pending ? t('homeFolderRemoveTitle', { name: pending.folder.name }) : ''}
        message={pending ? t('homeFolderRemoveBody', { count: pending.count }) : ''}
        confirmLabel={t('homeFolderRemove')}
        danger
        platform={pending?.platform ?? 'other'}
        onConfirm={confirmRemove}
        onCancel={() => setPending(null)}
        testId="home-folders-remove-confirm"
      />
    </section>
  )
}

interface FolderRowProps {
  readonly folder: LinkedFolder
  readonly onEnter: () => void
  readonly onRelink: () => void
  readonly onMenu: () => void
}

/** One linked folder: name and state; a lost one says why and offers [Link again] instead. */
function FolderRow({ folder, onEnter, onRelink, onMenu }: FolderRowProps) {
  const { t } = useMobileLocale()
  const lost = isLost(folder)
  const main = (
    <>
      <span className="home-act-row-glyph" aria-hidden="true">
        <IconFolderOpen size={20} />
      </span>
      <span className="mobile-doc-row-main">
        <span className="mobile-doc-row-info">
          <span className="mobile-list-name">{folder.name}</span>
          {!lost && <span className="mobile-doc-row-meta">{t('homeFolderOk')}</span>}
        </span>
        {!lost && <IconChevronRight size={17} className="mobile-chevron" />}
      </span>
    </>
  )
  return (
    <li
      className="mobile-doc-list-item home-folders-row"
      data-testid={`home-folders-folder-${folder.id}`}
    >
      <div className="home-folders-row-line">
        {lost ? (
          <div className="mobile-doc-row-btn home-folders-row-static">{main}</div>
        ) : (
          <button
            type="button"
            className="mobile-doc-row-btn home-folders-row-open"
            data-testid={`home-folders-open-${folder.id}`}
            onClick={onEnter}
          >
            {main}
          </button>
        )}
        <button
          type="button"
          className="mobile-icon-btn"
          data-testid={`home-folders-more-${folder.id}`}
          aria-haspopup="dialog"
          aria-label={t('homeFolderMenu', { name: folder.name })}
          title={t('homeFolderMenu', { name: folder.name })}
          onClick={onMenu}
        >
          <IconMore size={20} />
        </button>
      </div>
      {lost && (
        <div className="mobile-inline-alert mobile-doc-inline-alert">
          <p className="mobile-alert-text">{t(lostReasonKey(folder))}</p>
          <div className="mobile-row-actions">
            <button
              type="button"
              className="mobile-touch-btn mobile-btn-secondary"
              data-testid={`home-folders-relink-${folder.id}`}
              aria-label={t('homeFolderRelinkNamed', { name: folder.name })}
              onClick={onRelink}
            >
              {t('homeFolderRelink')}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
