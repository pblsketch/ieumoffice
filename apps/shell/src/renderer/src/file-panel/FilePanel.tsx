import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
} from 'react'
import {
  filePanelShortcutLabel,
  type FilePanelApi,
  type FilePanelState,
} from '../../../shared/file-panel-api'
import type { FolderListing, FolderRoot, RecentEntry } from '../../../shared/home-api'
import { Chevron, FileBadge, FolderIcon } from '../Home'
import { filePanelText, type FilePanelStringKey } from '../i18n/strings-file-panel'
import { useI18n } from '../locale'
import {
  baseName,
  filePreviewNav,
  isAtOrUnder,
  mergeFileMatches,
  parentDir,
  rootFor,
  samePath,
  stepPreviewPath,
  treeOrder,
} from './file-panel-model'
import './file-panel.css'

declare global {
  interface Window {
    aiOfficeFilePanel: FilePanelApi
  }
}

const IS_MAC = navigator.platform.toLowerCase().includes('mac')

/** folders expanded in the panel; survives closing the panel and restarting */
const EXPANDED_KEY = 'filePanel.expanded'
/** sections the user folded away */
const FOLDED_KEY = 'filePanel.foldedSections'
/** how many recent documents the Recent section lists */
const RECENT_COUNT = 20
/** how many index hits a search asks for */
const SEARCH_COUNT = 40
const SEARCH_DEBOUNCE_MS = 150
/** row indent per tree level, in px */
const INDENT_PX = 14

type SectionId = 'current' | 'folders' | 'recent'

function readStringSet(key: string): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeStringSet(key: string, set: ReadonlySet<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...set]))
  } catch {
    // quota / private mode: the panel just forgets its layout
  }
}

interface FilePanelProps {
  state: FilePanelState
  /** painted width in window px (DIP); the views start right of it */
  inset: number
  /** the tab strip's painted height */
  top: number
  /** window content height */
  viewportHeight: number
  /** file behind the active tab; absent for an untitled document */
  activeFilePath: string | undefined
  /** every file open in a tab, for the "open" marks */
  openPaths: readonly string[]
  /** hidden while Home is on screen; the panel keeps its state meanwhile */
  hidden: boolean
}

export function FilePanel({
  state,
  inset,
  top,
  viewportHeight,
  activeFilePath,
  openPaths,
  hidden,
}: FilePanelProps) {
  const { lang } = useI18n()
  const tx = (key: FilePanelStringKey) => filePanelText(lang, key)
  const scale = state.scale > 0 ? state.scale : 1

  const [roots, setRoots] = useState<FolderRoot[]>([])
  const [listings, setListings] = useState<ReadonlyMap<string, FolderListing>>(new Map())
  const listingsRef = useRef(listings)
  listingsRef.current = listings
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => readStringSet(EXPANDED_KEY))
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => readStringSet(FOLDED_KEY))
  const [recents, setRecents] = useState<RecentEntry[]>([])
  const [query, setQuery] = useState('')
  /** index hits for the current query; null while the index is being asked */
  const [indexHits, setIndexHits] = useState<RecentEntry[] | null>([])
  const bodyRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const hoveredFilePathRef = useRef<string | null>(null)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const previewPathRef = useRef<string | null>(null)
  previewPathRef.current = previewPath
  const previewRowElRef = useRef<HTMLElement | null>(null)
  const lastPreviewPathRef = useRef<string | null>(null)

  // dir -> whether a reload was asked for while its request was in flight
  const inflight = useRef(new Map<string, boolean>())
  const load = useCallback((dir: string, force = false) => {
    if (!force && listingsRef.current.has(dir)) return
    if (inflight.current.has(dir)) {
      if (force) inflight.current.set(dir, true)
      return
    }
    inflight.current.set(dir, false)
    void window.aiOfficeFilePanel
      .listDocumentFolder(dir)
      .then((listing) => {
        setListings((prev) => new Map(prev).set(dir, treeOrder(listing)))
      })
      .catch(() => undefined)
      .finally(() => {
        const again = inflight.current.get(dir)
        inflight.current.delete(dir)
        if (again) load(dir, true)
      })
  }, [])

  const loadRoots = useCallback(() => {
    void window.aiOffice
      .folderRoots()
      .then(setRoots)
      .catch(() => undefined)
  }, [])

  const loadRecents = useCallback(() => {
    void window.aiOffice
      .recents({ limit: RECENT_COUNT })
      .then((page) => setRecents(page.entries.filter((entry) => !entry.missing)))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    loadRoots()
  }, [loadRoots])

  // recents move whenever a document opens, so they follow the open tabs
  const openKey = openPaths.join('\n')
  useEffect(() => {
    loadRecents()
  }, [loadRecents, openKey])

  const currentDir = activeFilePath ? parentDir(activeFilePath) : null
  useEffect(() => {
    if (currentDir) load(currentDir, true)
  }, [currentDir, load])

  useEffect(() => {
    for (const dir of expanded) load(dir)
  }, [expanded, load])

  useEffect(() => {
    for (const root of roots) if (root.readable) load(root.path)
  }, [roots, load])

  // a folder under a tree root changed on disk: refresh the copies shown here
  useEffect(
    () =>
      window.aiOffice.onFolderChanged((dirs) => {
        for (const dir of dirs) {
          for (const shown of listingsRef.current.keys()) {
            if (samePath(shown, dir)) load(shown, true)
          }
        }
      }),
    [load],
  )

  const refreshAll = () => {
    loadRoots()
    loadRecents()
    for (const dir of listingsRef.current.keys()) load(dir, true)
  }

  const toggleExpanded = (dir: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      writeStringSet(EXPANDED_KEY, next)
      return next
    })
  }

  const collapseAll = () => {
    const none = new Set<string>()
    writeStringSet(EXPANDED_KEY, none)
    setExpanded(none)
  }

  const toggleSection = (id: SectionId) => {
    setFolded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      writeStringSet(FOLDED_KEY, next)
      return next
    })
  }

  // ── search ──
  const needle = query.trim()
  useEffect(() => {
    if (!needle) {
      setIndexHits([])
      return
    }
    setIndexHits(null)
    let alive = true
    const timer = setTimeout(() => {
      void window.aiOffice
        .searchFiles({ q: needle, limit: SEARCH_COUNT })
        .then((page) => {
          if (alive) setIndexHits(page.hits)
        })
        .catch(() => {
          if (alive) setIndexHits([])
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [needle])

  const results = useMemo(() => {
    if (!needle) return []
    const local: RecentEntry[][] = []
    const current = currentDir ? listings.get(currentDir) : undefined
    if (current) local.push(current.files)
    for (const [dir, listing] of listings) {
      if (dir !== currentDir) local.push(listing.files)
    }
    local.push(recents)
    return mergeFileMatches(needle, local, indexHits ?? [])
  }, [needle, currentDir, listings, recents, indexHits])

  // ── quick look ──
  const getVisibleFileRows = useCallback(
    () => Array.from(bodyRef.current?.querySelectorAll<HTMLElement>('[data-fp-file-path]') ?? []),
    [],
  )

  const closePreview = useCallback(() => {
    if (!previewPathRef.current) return
    setPreviewPath(null)
    previewPathRef.current = null
    window.aiOfficeFilePanel.quickLookClose()
  }, [])

  const openPreview = useCallback(
    (path: string, direction: 'up' | 'down' | 'none' = 'none', rowEl?: HTMLElement | null) => {
      const rows = getVisibleFileRows()
      const paths = rows.map((el) => el.dataset.fpFilePath ?? '')
      let idx = rowEl && rows.includes(rowEl) ? rows.indexOf(rowEl) : -1
      let canPrev: boolean
      let canNext: boolean
      const total = paths.length
      if (idx !== -1) {
        canPrev = idx > 0
        canNext = idx < total - 1
      } else {
        const nav = filePreviewNav(paths, path)
        idx = nav.index
        canPrev = nav.canPrev
        canNext = nav.canNext
      }
      const targetRow = idx !== -1 ? rows[idx] : null
      if (targetRow) {
        previewRowElRef.current = targetRow
        targetRow.scrollIntoView({ block: 'nearest' })
        if (document.activeElement !== targetRow) {
          targetRow.focus({ preventScroll: true })
        }
      } else {
        previewRowElRef.current = null
      }
      lastPreviewPathRef.current = path
      setPreviewPath(path)
      previewPathRef.current = path
      void window.aiOfficeFilePanel
        .quickLookOpen(path, {
          canPrev,
          canNext,
          direction,
          ...(idx !== -1 ? { index: idx, total } : {}),
        })
        .then((ok) => {
          if (!ok && previewPathRef.current && samePath(previewPathRef.current, path)) {
            setPreviewPath(null)
            previewPathRef.current = null
          }
        })
        .catch(() => {
          if (previewPathRef.current && samePath(previewPathRef.current, path)) {
            setPreviewPath(null)
            previewPathRef.current = null
          }
        })
    },
    [getVisibleFileRows],
  )

  const togglePreview = useCallback(
    (path: string, rowEl?: HTMLElement | null) => {
      if (previewPathRef.current && samePath(previewPathRef.current, path)) {
        closePreview()
        return
      }
      openPreview(path, 'none', rowEl)
    },
    [closePreview, openPreview],
  )

  const stepPreview = useCallback(
    (delta: -1 | 1) => {
      const current = previewPathRef.current
      if (!current) return
      const rows = getVisibleFileRows()
      const paths = rows.map((el) => el.dataset.fpFilePath ?? '')
      const anchored = previewRowElRef.current
      const anchoredIdx =
        anchored && rows.includes(anchored) && samePath(anchored.dataset.fpFilePath ?? '', current)
          ? rows.indexOf(anchored)
          : -1
      if (anchoredIdx !== -1) {
        const nextIdx = anchoredIdx + delta
        const nextRow = rows[nextIdx]
        const nextPath = paths[nextIdx]
        if (!nextRow || !nextPath) return
        openPreview(nextPath, delta < 0 ? 'up' : 'down', nextRow)
        return
      }
      const next = stepPreviewPath(paths, current, delta)
      if (!next) return
      openPreview(next.path, next.direction, rows[next.index] ?? null)
    },
    [getVisibleFileRows, openPreview],
  )

  // Close Quick Look when the panel hides (e.g. switched to Home or closed)
  useEffect(() => {
    if (hidden && previewPathRef.current) {
      closePreview()
    }
  }, [hidden, closePreview])

  // Sync preview open/close state driven from main or the preview window itself
  useEffect(() => {
    const offChanged = window.aiOfficeFilePanel.onQuickLookChanged((next) => {
      const wasOpen = previewPathRef.current !== null
      const nextPath = next.open ? next.path : null
      setPreviewPath(nextPath)
      previewPathRef.current = nextPath
      if (nextPath) {
        lastPreviewPathRef.current = nextPath
      } else if (wasOpen && !hidden) {
        // Restore keyboard focus to the last previewed file row if the window returned focus to body
        const active = document.activeElement
        if (!active || active === document.body) {
          const anchor = previewRowElRef.current
          if (anchor && anchor.isConnected) {
            anchor.focus({ preventScroll: true })
          } else if (lastPreviewPathRef.current) {
            const match = getVisibleFileRows().find((el) =>
              samePath(el.dataset.fpFilePath ?? '', lastPreviewPathRef.current ?? ''),
            )
            match?.focus({ preventScroll: true })
          }
        }
      }
    })
    const offStep = window.aiOfficeFilePanel.onQuickLookStep((delta) => {
      stepPreview(delta)
    })
    return () => {
      offChanged()
      offStep()
    }
  }, [hidden, getVisibleFileRows, stepPreview])

  // ── row actions ──
  const isOpen = (path: string) => openPaths.some((open) => samePath(open, path))
  const isActive = (path: string) => !!activeFilePath && samePath(activeFilePath, path)

  const openFile = (path: string) => {
    if (previewPathRef.current) closePreview()
    void window.aiOffice.openPath(path)
  }

  const showMenu = (event: ReactMouseEvent, kind: 'file' | 'folder', path: string): void => {
    event.preventDefault()
    const rowEl = event.currentTarget as HTMLElement
    const canAddRoot = kind === 'folder' && rootFor(path, roots) === undefined
    void window.aiOfficeFilePanel
      .showItemMenu(kind, path, event.clientX, event.clientY, canAddRoot)
      .then((action) => {
        if (action === 'open') openFile(path)
        else if (action === 'quickLook') openPreview(path, 'none', rowEl)
        else if (action === 'copyPath') void navigator.clipboard?.writeText(path)
        else if (action === 'addRoot') {
          void window.aiOffice.dropFolderRoots([path]).then(loadRoots)
        }
      })
  }

  /** arrow keys walk the visible rows in screen order */
  const moveFocus = (from: HTMLElement, step: 1 | -1 | 'first' | 'last') => {
    const rows = Array.from(bodyRef.current?.querySelectorAll<HTMLElement>('[data-fp-row]') ?? [])
    if (rows.length === 0) return
    let index: number
    if (step === 'first') index = 0
    else if (step === 'last') index = rows.length - 1
    else index = Math.min(rows.length - 1, Math.max(0, rows.indexOf(from) + step))
    rows[index]?.focus()
  }

  const rowKeys = (
    event: ReactKeyboardEvent<HTMLElement>,
    activate: () => void,
    options?: {
      filePath?: string
      folder?: { path: string; open: boolean }
    },
  ) => {
    const target = event.currentTarget
    const folder = options?.folder
    const filePath = options?.filePath
    const noMods = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
    switch (event.key) {
      case ' ':
        if (!noMods || event.nativeEvent.isComposing) break
        if (filePath) {
          event.preventDefault()
          if (!event.repeat) togglePreview(filePath, target)
        } else if (previewPathRef.current) {
          event.preventDefault()
          if (!event.repeat) closePreview()
        }
        break
      case 'Escape':
        if (previewPathRef.current) {
          event.preventDefault()
          closePreview()
        }
        break
      case 'ArrowDown':
        event.preventDefault()
        if (previewPathRef.current) stepPreview(1)
        else moveFocus(target, 1)
        break
      case 'ArrowUp':
        event.preventDefault()
        if (previewPathRef.current) stepPreview(-1)
        else if (bodyRef.current?.querySelector('[data-fp-row]') === target)
          searchRef.current?.focus()
        else moveFocus(target, -1)
        break
      case 'Home':
        event.preventDefault()
        moveFocus(target, 'first')
        break
      case 'End':
        event.preventDefault()
        moveFocus(target, 'last')
        break
      case 'ArrowRight':
        if (folder && !folder.open) {
          event.preventDefault()
          toggleExpanded(folder.path)
        }
        break
      case 'ArrowLeft':
        if (folder?.open) {
          event.preventDefault()
          toggleExpanded(folder.path)
        }
        break
      case 'Enter':
        event.preventDefault()
        activate()
        break
    }
  }

  // Fallback for Space / Esc when focus is inside the panel (not an input/button/row)
  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    const target = event.target as HTMLElement | null
    const tag = target?.tagName
    if (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      tag === 'BUTTON' ||
      target?.isContentEditable
    ) {
      return
    }
    if (event.key === ' ') {
      if (previewPathRef.current) {
        event.preventDefault()
        if (!event.repeat) closePreview()
      } else if (hoveredFilePathRef.current) {
        event.preventDefault()
        if (!event.repeat) {
          const hovered = hoveredFilePathRef.current
          const match = getVisibleFileRows().find((el) =>
            samePath(el.dataset.fpFilePath ?? '', hovered),
          )
          openPreview(hovered, 'none', match ?? null)
        }
      }
    } else if (event.key === 'Escape' && previewPathRef.current) {
      event.preventDefault()
      closePreview()
    }
  }

  // ── rows ──
  function renderFile(entry: RecentEntry, depth: number, detail?: string): ReactElement {
    const active = isActive(entry.path)
    const open = isOpen(entry.path)
    const previewing = !!previewPath && samePath(previewPath, entry.path)
    return (
      <li key={entry.path} role="none">
        <div
          className={`fp-row fp-file${active ? ' active' : ''}${previewing ? ' previewing' : ''}`}
          role="treeitem"
          aria-current={active ? 'page' : undefined}
          aria-level={depth + 1}
          tabIndex={-1}
          data-fp-row=""
          data-fp-file-path={entry.path}
          title={entry.path}
          style={{ paddingInlineStart: 8 + depth * INDENT_PX }}
          onClick={() => openFile(entry.path)}
          onMouseEnter={() => {
            hoveredFilePathRef.current = entry.path
          }}
          onMouseLeave={() => {
            if (hoveredFilePathRef.current === entry.path) {
              hoveredFilePathRef.current = null
            }
          }}
          onKeyDown={(event) =>
            rowKeys(event, () => openFile(entry.path), { filePath: entry.path })
          }
          onContextMenu={(event) => showMenu(event, 'file', entry.path)}
        >
          <span className="fp-twisty" aria-hidden="true" />
          <span className="fp-icon" aria-hidden="true">
            <FileBadge ext={entry.ext} size={16} />
          </span>
          <span className="fp-name">{entry.name}</span>
          {detail && <span className="fp-detail">{detail}</span>}
          {open && !active && (
            <span className="fp-open-dot" role="img" aria-label={tx('openMark')} />
          )}
          <button
            type="button"
            className="fp-preview-btn"
            tabIndex={-1}
            title={`${tx('quickLook')} (Space)`}
            aria-label={tx('quickLook')}
            onClick={(event) => {
              event.stopPropagation()
              const rowEl = event.currentTarget.closest<HTMLElement>('[data-fp-file-path]')
              togglePreview(entry.path, rowEl)
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4S1.5 8 1.5 8Z"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="8" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.25" />
            </svg>
          </button>
        </div>
      </li>
    )
  }

  /** one folder's rows: sub-folders, then documents, or a one-line note */
  function renderEntries(dir: string, depth: number): ReactElement[] {
    const listing = listings.get(dir)
    const note = (text: string) => [
      <li
        key="note"
        className="fp-note"
        role="none"
        style={{ paddingInlineStart: 8 + depth * INDENT_PX + 22 }}
      >
        {text}
      </li>,
    ]
    if (!listing) return note('…')
    if (listing.missing) return note(tx('folderMissing'))
    if (listing.folders.length === 0 && listing.files.length === 0) return note(tx('emptyFolder'))
    return [
      ...listing.folders.map((folder) => renderFolder(folder.path, folder.name, depth)),
      ...listing.files.map((file) => renderFile(file, depth)),
    ]
  }

  function renderFolder(
    path: string,
    name: string,
    depth: number,
    root?: FolderRoot,
  ): ReactElement {
    const unavailable = root !== undefined && !root.readable
    // every readable folder can open: one without sub-folders may still hold documents
    const open = expanded.has(path) && !unavailable
    const holdsActive = !open && !!activeFilePath && isAtOrUnder(path, activeFilePath)
    return (
      <li key={path} role="none">
        <div
          className={`fp-row fp-folder${unavailable ? ' unavailable' : ''}${holdsActive ? ' holds-active' : ''}`}
          role="treeitem"
          aria-expanded={unavailable ? undefined : open}
          aria-level={depth + 1}
          tabIndex={-1}
          data-fp-row=""
          title={path}
          style={{ paddingInlineStart: 8 + depth * INDENT_PX }}
          onClick={() => {
            if (!unavailable) toggleExpanded(path)
          }}
          onKeyDown={(event) =>
            rowKeys(event, () => !unavailable && toggleExpanded(path), {
              folder: { path, open },
            })
          }
          onContextMenu={(event) => showMenu(event, 'folder', path)}
        >
          <span className="fp-twisty" aria-hidden="true">
            {!unavailable && <Chevron open={open} />}
          </span>
          <span className="fp-icon fp-folder-icon" aria-hidden="true">
            <FolderIcon open={open} />
          </span>
          <span className="fp-name">{name}</span>
        </div>
        {open && (
          <ul className="fp-group" role="group">
            {renderEntries(path, depth + 1)}
          </ul>
        )}
      </li>
    )
  }

  function renderSection(id: SectionId, title: string, body: ReactElement, extra?: string) {
    const isFolded = folded.has(id)
    return (
      <section className="fp-section" aria-label={title}>
        <button
          className="fp-section-head"
          aria-expanded={!isFolded}
          title={extra}
          onClick={() => toggleSection(id)}
        >
          <Chevron open={!isFolded} />
          <span className="fp-section-title">{title}</span>
          {extra && <span className="fp-section-extra">{baseName(extra)}</span>}
        </button>
        {!isFolded && body}
      </section>
    )
  }

  const currentBody = currentDir ? (
    <ul className="fp-tree" role="tree" aria-label={tx('sectionCurrent')}>
      {renderEntries(currentDir, 0)}
    </ul>
  ) : (
    <p className="fp-hint">{tx('untitledHint')}</p>
  )

  const foldersBody = (
    <ul className="fp-tree" role="tree" aria-label={tx('sectionFolders')}>
      {roots.map((root) => renderFolder(root.path, root.name, 0, root))}
    </ul>
  )

  const recentBody =
    recents.length === 0 ? (
      <p className="fp-hint">{tx('noRecent')}</p>
    ) : (
      <ul className="fp-tree" role="tree" aria-label={tx('sectionRecent')}>
        {recents.map((entry) => renderFile(entry, 0, baseName(parentDir(entry.path) ?? '')))}
      </ul>
    )

  const searchBody =
    results.length > 0 ? (
      <ul className="fp-tree" role="tree" aria-label={tx('searchPlaceholder')}>
        {results.map((entry) => renderFile(entry, 0, baseName(parentDir(entry.path) ?? '')))}
      </ul>
    ) : (
      <p className="fp-hint">{indexHits === null ? tx('searching') : tx('noResults')}</p>
    )

  // ── resize: the panel's right edge, the one strip of it the document never covers ──
  const dragRef = useRef<{ pointerId: number; frame: number | null; width: number } | null>(null)
  const widthAt = (clientX: number) => clientX / scale
  const onResizeDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, frame: null, width: widthAt(event.clientX) }
  }
  const onResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    drag.width = widthAt(event.clientX)
    // every width re-lays the document views out, so one send per frame
    if (drag.frame === null) {
      drag.frame = requestAnimationFrame(() => {
        const current = dragRef.current
        if (!current) return
        current.frame = null
        window.aiOfficeFilePanel.setWidth(current.width, false)
      })
    }
  }
  const endResize = (event: ReactPointerEvent<HTMLDivElement>, commit: boolean) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.frame !== null) cancelAnimationFrame(drag.frame)
    dragRef.current = null
    window.aiOfficeFilePanel.setWidth(commit ? widthAt(event.clientX) : drag.width, true)
  }

  return (
    <aside
      className="file-panel"
      aria-label={tx('panelTitle')}
      hidden={hidden}
      style={{ top, width: inset, height: Math.max(0, viewportHeight - top) }}
      onKeyDown={onPanelKeyDown}
    >
      <div
        className="file-panel-inner"
        style={{
          zoom: scale,
          width: inset / scale,
          height: Math.max(0, viewportHeight - top) / scale,
        }}
      >
        <header className="fp-head">
          <span className="fp-title">{tx('panelTitle')}</span>
          <div className="fp-actions">
            <button
              className="fp-action"
              title={tx('refresh')}
              aria-label={tx('refresh')}
              onClick={refreshAll}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M13.2 8a5.2 5.2 0 1 1-1.52-3.68M13.2 2.6v2.9h-2.9"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              className="fp-action"
              title={tx('collapseAll')}
              aria-label={tx('collapseAll')}
              onClick={collapseAll}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M4.5 6.5 8 3l3.5 3.5M4.5 13 8 9.5l3.5 3.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              className="fp-action"
              title={tx('addFolder')}
              aria-label={tx('addFolder')}
              onClick={() =>
                void window.aiOffice.addFolderRoot().then((added) => added && loadRoots())
              }
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.1c.44 0 .85.19 1.13.52L8.4 4.4H13A1.5 1.5 0 0 1 14.5 5.9v5.6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4zM8 6.6v4.2M5.9 8.7h4.2"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              className="fp-action"
              title={`${tx('hidePanel')} (${filePanelShortcutLabel(IS_MAC)})`}
              aria-label={tx('hidePanel')}
              onClick={() => window.aiOfficeFilePanel.setOpen(false)}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </header>
        <div className="fp-search">
          <input
            ref={searchRef}
            type="search"
            className="fp-search-input"
            placeholder={tx('searchPlaceholder')}
            aria-label={tx('searchPlaceholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                bodyRef.current?.querySelector<HTMLElement>('[data-fp-row]')?.focus()
              } else if (event.key === 'Escape' && query) {
                event.preventDefault()
                setQuery('')
              }
            }}
          />
        </div>
        <div className="fp-body" ref={bodyRef}>
          {needle ? (
            searchBody
          ) : (
            <>
              {renderSection('current', tx('sectionCurrent'), currentBody, currentDir ?? undefined)}
              {renderSection('folders', tx('sectionFolders'), foldersBody)}
              {renderSection('recent', tx('sectionRecent'), recentBody)}
            </>
          )}
        </div>
      </div>
      <div
        className="file-panel-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={tx('resizePanel')}
        title={tx('resizePanel')}
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={(event) => endResize(event, true)}
        onPointerCancel={(event) => endResize(event, false)}
        onLostPointerCapture={(event) => endResize(event, false)}
      />
    </aside>
  )
}
