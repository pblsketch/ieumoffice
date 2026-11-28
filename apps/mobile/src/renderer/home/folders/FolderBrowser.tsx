import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  listFolder,
  openFolderEntry,
  type FolderEntry,
  type LinkedFolder,
} from '@genoffice/mobile-bridge/home'
import type { ToastRequest } from '../../components/Toast'
import { IconBack, IconChevronRight, IconFolderOpen } from '../../components/MobileIcons'
import { useMobileLocale } from '../../i18n'
import { useBackLayer } from '../../shell/backStack'
import {
  folderFileItem,
  HomeFileRow,
  HomeSelectionBar,
  HomeSelectionHeader,
  isPictureItem,
  useHomeFileActions,
  useHomeSelection,
  type HomeActionsHost,
  type HomeFileItem,
} from '../actions'
import type { HomeHost } from '../homeHost'
import { setActiveFolderPath } from '../homeRuntime'
import { sortFolderEntries, useHomeListPrefs } from '../frame/frameModel'
import { HomeListToolbar } from '../frame/HomeListToolbar'
import { usePdfToolsLink, type PdfToolStart } from '../pdfToolsLink'
import {
  drawable,
  folderErrorKey,
  hostClient,
  isFolderEntry,
  isFolderLostError,
  splitEntries,
} from './folderModel'
import './folders.css'

export interface FolderBrowserProps {
  readonly host: HomeHost
  readonly folder: LinkedFolder
  /** Sub-folder names below the linked folder (empty for its top). */
  readonly path: readonly string[]
  readonly onEnter: (name: string) => void
  /** One level up; from the folder's top this leaves the folder. */
  readonly onUp: () => void
  /** The folder's permission is gone: mark it and go back to the folder list. */
  readonly onLost: () => void
}

/** One Back layer: while it is drawn, Back runs `onBack`. One is drawn per folder depth. */
function DepthBackLayer({ onBack }: { readonly onBack: () => void }) {
  useBackLayer(true, onBack)
  return null
}

/**
 * Inside a linked folder (spec 3.5): path, [‹], sub-folders, then files and pictures. A document
 * opens through the app's open path; a picture starts selection. The bar and menus are the shared
 * HOME-T7 parts for the folder list.
 */
export function FolderBrowser({ host, folder, path, onEnter, onUp, onLost }: FolderBrowserProps) {
  const { t } = useMobileLocale()
  const client = hostClient(host)
  const link = usePdfToolsLink()
  const [entries, setEntries] = useState<readonly FolderEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [reloadSeq, setReloadSeq] = useState(0)
  const [toolStart, setToolStart] = useState<PdfToolStart | null>(null)
  const opening = useRef(false)

  const toast = useCallback(
    (request: ToastRequest) => {
      if (typeof host.showToast === 'function') host.showToast(request)
    },
    [host],
  )

  const live = useRef({ onLost, toast, t })
  live.current = { onLost, toast, t }

  const pathKey = path.join('/')
  useEffect(() => {
    if (!client) return
    let alive = true
    setLoaded(false)
    listFolder(client, folder.id, path).then(
      (answer) => {
        if (!alive) return
        setEntries(drawable(answer, isFolderEntry))
        setLoaded(true)
      },
      (err: unknown) => {
        if (!alive) return
        setEntries([])
        setLoaded(true)
        if (isFolderLostError(err)) {
          live.current.onLost()
          return
        }
        const key = folderErrorKey(err)
        if (key) live.current.toast({ message: live.current.t(key), tone: 'error' })
      },
    )
    return () => {
      alive = false
    }
    // `path` is read through `pathKey` so a new array with the same names does not list again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, folder.id, pathKey, reloadSeq])

  const listPrefs = useHomeListPrefs()
  const { dirs, files } = useMemo(() => {
    const split = splitEntries(entries)
    return {
      dirs: sortFolderEntries(split.dirs, listPrefs.sortField, listPrefs.sortDir),
      files: sortFolderEntries(split.files, listPrefs.sortField, listPrefs.sortDir),
    }
  }, [entries, listPrefs.sortField, listPrefs.sortDir])
  const items = useMemo(
    () => files.map((entry) => folderFileItem(folder.id, entry)),
    [files, folder.id],
  )
  const selection = useHomeSelection(items)

  // Leaving a level drops the picks made there.
  const { clear } = selection
  useEffect(() => {
    clear()
  }, [clear, folder.id, pathKey])

  const actionsHost = useMemo<HomeActionsHost | null>(
    () =>
      client
        ? {
            client,
            showToast: (input) => {
              if (typeof host.showToast === 'function') host.showToast(input)
            },
          }
        : null,
    [client, host],
  )

  const actions = useHomeFileActions({
    listKind: 'folder',
    host: actionsHost,
    onChanged: () => {
      setReloadSeq((seq) => seq + 1)
      if (typeof host.refreshHome === 'function') void host.refreshHome()
    },
    onOpenPdfTool: setToolStart,
    onStartSelect: (item) => selection.start(item.key),
    onSelectionDone: selection.clear,
  })

  const openDocument = async (item: HomeFileItem) => {
    const ref = item.fileRef
    if (!client || ref.kind !== 'folder' || opening.current) return
    opening.current = true
    try {
      const session = await openFolderEntry(client, ref.folderId, ref.entryId)
      if (typeof host.openSession === 'function') await host.openSession(session)
    } catch (err) {
      if (isFolderLostError(err)) {
        live.current.onLost()
        return
      }
      const key = folderErrorKey(err)
      if (key) toast({ message: t(key), tone: 'error' })
    } finally {
      opening.current = false
    }
  }

  const onOpen = (item: HomeFileItem) => {
    if (isPictureItem(item)) selection.start(item.key)
    else void openDocument(item)
  }

  const closeTool = () => {
    setToolStart(null)
    setReloadSeq((seq) => seq + 1)
  }

  const pathText = [folder.name, ...path].join(' › ')
  const empty = loaded && dirs.length === 0 && files.length === 0

  useEffect(() => {
    setActiveFolderPath(pathText)
    return () => setActiveFolderPath(null)
  }, [pathText])

  return (
    <section className="home-folders-browse" data-testid="home-folders-browse">
      {Array.from({ length: path.length + 1 }, (_, depth) => (
        <DepthBackLayer key={depth} onBack={onUp} />
      ))}
      {selection.selecting ? (
        <HomeSelectionHeader count={selection.selectedItems.length} onClose={selection.clear} />
      ) : (
        <div className="home-folders-pathbar">
          <button
            type="button"
            className="mobile-icon-btn"
            data-testid="home-folders-back"
            aria-label={t('homeFolderBack')}
            title={t('homeFolderBack')}
            onClick={onUp}
          >
            <IconBack size={20} />
          </button>
          <span
            className="home-folders-path"
            data-testid="home-folders-path"
            role="heading"
            aria-level={2}
            aria-label={`${t('homeFolderPath')}: ${pathText}`}
          >
            {pathText}
          </span>
        </div>
      )}

      {!empty && !selection.selecting && (dirs.length > 0 || files.length > 0) && (
        <HomeListToolbar />
      )}

      {empty ? (
        <div className="mobile-empty-state" data-testid="home-folders-inside-empty">
          <span className="mobile-empty-icon" aria-hidden="true">
            <IconFolderOpen size={26} />
          </span>
          <p className="mobile-muted">{t('homeFolderInsideEmpty')}</p>
        </div>
      ) : (
        <ul
          className="mobile-doc-list home-folders-entries"
          data-view={listPrefs.viewMode}
          aria-label={pathText}
        >
          {dirs.map((entry) => (
            <li key={`dir:${entry.id}`} className="mobile-doc-list-item">
              <button
                type="button"
                className="mobile-doc-row-btn"
                data-testid={`home-folders-entry-${entry.id}`}
                disabled={selection.selecting}
                onClick={() => onEnter(entry.name)}
              >
                <span className="home-act-row-glyph" aria-hidden="true">
                  <IconFolderOpen size={20} />
                </span>
                <span className="mobile-doc-row-main">
                  <span className="mobile-doc-row-info">
                    <span className="mobile-list-name">{entry.name}</span>
                    <span className="mobile-doc-row-meta">{t('homeFolderSubfolder')}</span>
                  </span>
                  <IconChevronRight size={17} className="mobile-chevron" />
                </span>
              </button>
            </li>
          ))}
          {items.map((item) => (
            <HomeFileRow
              key={item.key}
              item={item}
              client={client}
              selecting={selection.selecting}
              selected={selection.isSelected(item.key)}
              onOpen={() => onOpen(item)}
              onToggleSelect={() => selection.toggle(item.key)}
              onStartSelect={() => selection.start(item.key)}
              onOpenMenu={() => actions.openRowMenu(item)}
            />
          ))}
        </ul>
      )}

      {selection.selecting && (
        <div className="home-folders-bar">
          <HomeSelectionBar
            listKind="folder"
            items={selection.selectedItems}
            onAction={(action) => actions.runBulk(action, selection.selectedItems)}
          />
        </div>
      )}
      {actions.element}

      {toolStart && link && (
        <div className="home-folders-tool-layer" data-testid="home-folders-tool-layer">
          <link.Flow host={host} start={toolStart} onClose={closeTool} />
        </div>
      )}
    </section>
  )
}
