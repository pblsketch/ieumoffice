/**
 * Document Outline tab for the HWP left workpane.
 *
 * Displays merged native Hangul outline headings and style-mapped headings in a
 * collapsible tree with printed page numbers, level filtering, active caret
 * tracking, adaptive idle-debounced refresh on edits, promote/demote actions,
 * drag-and-drop section reordering, and a document/app-wide style-mapping drawer.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { DragEvent, FormEvent, KeyboardEvent, MouseEvent, ReactElement } from 'react'
import type { Params } from '@genoffice/i18n'
import {
  DEFAULT_OUTLINE_STYLE_MAP,
  findActiveOutlineIndex,
  type OutlineCaret,
  type OutlineItem,
  type OutlineStyleMap,
} from '../../../studio-plugin/outline.mjs'
import type { AgentBridge } from '../ai/agent-bridge'
import { useOutlineI18n, type OutlineStringKey } from '../i18n/outline'
import {
  ALL_OUTLINE_LEVELS,
  computeFilterLevels,
  computeVisibleOutlineRows,
  formatPrintedPage,
  outlineItemKey,
  parseOutlineItemKey,
  sortOutlineStyleEntries,
  type VisibleOutlineRow,
} from './outline-tree'
import './outline-tab.css'

/** Base pause after the last edit before re-reading the outline (matches char-count.mjs). */
export const OUTLINE_REFRESH_PAUSE_MS = 700
/** Adaptive multiplier applied to the last outline read duration to protect typing on long docs. */
export const OUTLINE_PAUSE_PER_READ = 4
/** Maximum wait for an idle slot before running a scheduled outline refresh anyway. */
export const OUTLINE_IDLE_DEADLINE_MS = 2000
/** Lightweight caret polling interval while the Outline tab is visible. */
export const OUTLINE_CARET_POLL_MS = 800

const INDENT_STEP_PX = 14
const BASE_PADDING_LEFT_PX = 8

export interface ChangeOutlineLevelParams {
  sec: number
  para: number
  delta: 1 | -1
  singleOnly?: boolean
  appStyleMap?: OutlineStyleMap | null
}

export type ChangeOutlineLevelResult =
  | {
      ok: true
      changed: Array<{
        sec: number
        para: number
        fromLevel: number
        toLevel: number
        styleName: string
      }>
      place: { sec: number; para: number; offset: number; length: number }
    }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'unsupported_place'
        | 'level_out_of_range'
        | 'no_mapped_style'
        | 'missing_style_in_doc'
      title?: string
      sec?: number
      para?: number
      fromLevel?: number
      targetLevel?: number
      styleName?: string
    }

export interface MoveOutlineSectionParams {
  source: { sec: number; para: number }
  target: { sec: number; para: number }
  position: 'before' | 'after'
  appStyleMap?: OutlineStyleMap | null
}

export type MoveOutlineSectionResult =
  | {
      ok: true
      movedParagraphs: number
      newStart: { sec: number; para: number }
      place: { sec: number; para: number; offset: number; length: number }
    }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'unsupported_place'
        | 'cross_section'
        | 'first_para_layout'
        | 'target_inside_source'
        | 'no_change'
        | 'objects_changed'
        | 'bookmarks_lost'
        | 'engine_error'
      error?: string
    }

export type OutlineTabBridge = Pick<
  AgentBridge,
  'readOutline' | 'setDocOutlineMap' | 'caretPosition' | 'reveal' | 'listStyles'
> & {
  changeOutlineLevel?(
    params: ChangeOutlineLevelParams,
  ): Promise<ChangeOutlineLevelResult | { ok: false; reason: string }>
  moveOutlineSection?(
    params: MoveOutlineSectionParams,
  ): Promise<MoveOutlineSectionResult | { ok: false; reason: string; error?: string }>
}

export interface OutlineSettingsApi {
  getOutlineStyleMap?(): Promise<OutlineStyleMap>
  setOutlineStyleMap?(map: OutlineStyleMap | null): Promise<OutlineStyleMap>
  onOutlineStyleMapChanged?(handler: (map: OutlineStyleMap) => void): () => void
}

export interface OutlineTabProps {
  bridge: OutlineTabBridge
  /** Defaults to window.hwpApi when omitted. */
  settingsApi?: OutlineSettingsApi
  /** Increments whenever the document changes externally (App.tsx docTick). */
  changeTick?: number
  /** Whether the Outline tab panel is currently visible on screen. */
  visible?: boolean
  /** Optional tuning overrides for tests (default matches char-count.mjs: 700ms pause, 4x cost multiplier, 2000ms idle deadline). */
  refreshPauseMs?: number
  caretPollMs?: number
}

type MappingScope = 'doc' | 'app'

interface NoticeState {
  kind: 'error' | 'info'
  key: OutlineStringKey
  params?: Params
  reason?: string
}

interface ContextMenuState {
  item: OutlineItem
  hasChildren: boolean
  isCollapsed: boolean
  x: number
  y: number
}

interface DropIndicatorState {
  key: string
  position: 'before' | 'after'
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function mapLevelRefusalToNotice(
  result: Extract<ChangeOutlineLevelResult, { ok: false }> | { ok: false; reason: string },
  fallbackTargetLevel: number,
): NoticeState {
  switch (result.reason) {
    case 'not_found':
      return { kind: 'error', key: 'outlineLevelNotFound', reason: result.reason }
    case 'unsupported_place':
      return { kind: 'error', key: 'outlineLevelUnsupported', reason: result.reason }
    case 'level_out_of_range':
      return { kind: 'error', key: 'outlineLevelOutOfRange', reason: result.reason }
    case 'no_mapped_style':
      return {
        kind: 'error',
        key: 'outlineLevelNoMappedStyle',
        params: {
          level:
            'targetLevel' in result && result.targetLevel !== undefined
              ? result.targetLevel
              : fallbackTargetLevel,
        },
        reason: result.reason,
      }
    case 'missing_style_in_doc':
      return {
        kind: 'error',
        key: 'outlineLevelMissingStyle',
        params: { style: 'styleName' in result ? (result.styleName ?? '') : '' },
        reason: result.reason,
      }
    default:
      return { kind: 'error', key: 'outlineLevelUnsupported', reason: result.reason }
  }
}

function mapMoveRefusalToNotice(
  result:
    | Extract<MoveOutlineSectionResult, { ok: false }>
    | { ok: false; reason: string; error?: string },
): NoticeState {
  switch (result.reason) {
    case 'not_found':
      return { kind: 'error', key: 'outlineMoveNotFound', reason: result.reason }
    case 'unsupported_place':
      return { kind: 'error', key: 'outlineMoveUnsupported', reason: result.reason }
    case 'cross_section':
      return { kind: 'error', key: 'outlineMoveCrossSection', reason: result.reason }
    case 'first_para_layout':
      return { kind: 'error', key: 'outlineMoveFirstParaLayout', reason: result.reason }
    case 'target_inside_source':
      return { kind: 'error', key: 'outlineMoveTargetInsideSource', reason: result.reason }
    case 'no_change':
      return { kind: 'error', key: 'outlineMoveNoChange', reason: result.reason }
    case 'objects_changed':
      return { kind: 'error', key: 'outlineMoveObjectsChanged', reason: result.reason }
    case 'bookmarks_lost':
      return { kind: 'error', key: 'outlineMoveBookmarksLost', reason: result.reason }
    case 'engine_error':
      return {
        kind: 'error',
        key: 'outlineMoveEngineError',
        params: { error: 'error' in result ? (result.error ?? '') : '' },
        reason: result.reason,
      }
    default:
      return { kind: 'error', key: 'outlineMoveUnsupported', reason: result.reason }
  }
}

export function OutlineTab({
  bridge,
  settingsApi,
  changeTick = 0,
  visible = true,
  refreshPauseMs = OUTLINE_REFRESH_PAUSE_MS,
  caretPollMs = OUTLINE_CARET_POLL_MS,
}: OutlineTabProps): ReactElement {
  const { t } = useOutlineI18n()
  const styleDatalistId = useId()

  const resolvedSettingsApi: OutlineSettingsApi | undefined =
    settingsApi ?? (typeof window !== 'undefined' ? window.hwpApi : undefined)

  const [items, setItems] = useState<OutlineItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [caret, setCaret] = useState<OutlineCaret | null>(null)
  const [maxLevel, setMaxLevel] = useState<number | null>(null)
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() => new Set())

  const [appStyleMap, setAppStyleMap] = useState<OutlineStyleMap | null>(null)
  const [effectiveStyleMap, setEffectiveStyleMap] = useState<OutlineStyleMap>(() => ({
    ...DEFAULT_OUTLINE_STYLE_MAP,
  }))
  const [hasDocStyleMap, setHasDocStyleMap] = useState(false)
  const [docStyleMap, setDocStyleMap] = useState<OutlineStyleMap | null>(null)

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mappingScope, setMappingScope] = useState<MappingScope>('doc')
  const [docStyles, setDocStyles] = useState<string[]>([])
  const [newStyleName, setNewStyleName] = useState('')
  const [newStyleLevel, setNewStyleLevel] = useState(1)

  const [mutating, setMutating] = useState(false)
  const [notice, setNotice] = useState<NoticeState | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const [dropIndicator, setDropIndicator] = useState<DropIndicatorState | null>(null)

  const mountedRef = useRef(true)
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  const appStyleMapRef = useRef<OutlineStyleMap | null>(null)
  const hasLoadedRef = useRef(false)
  const dirtyWhileHiddenRef = useRef(false)
  const lastChangeTickRef = useRef(changeTick)
  const lastReadCostMsRef = useRef(0)
  const readSeqRef = useRef(0)

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshIdleRef = useRef<number | null>(null)

  const dragSourceRef = useRef<{ sec: number; para: number } | null>(null)
  const dropIndicatorRef = useRef<DropIndicatorState | null>(null)

  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const lastScrolledKeyRef = useRef<string | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)

  const cancelScheduledRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
    if (refreshIdleRef.current !== null) {
      if (typeof globalThis.cancelIdleCallback === 'function') {
        globalThis.cancelIdleCallback(refreshIdleRef.current)
      }
      refreshIdleRef.current = null
    }
  }, [])

  const syncCaret = useCallback(async () => {
    try {
      const next = await bridge.caretPosition()
      if (!mountedRef.current) return
      setCaret((prev) => {
        if (prev === null && next === null) return prev
        if (prev && next && prev.sec === next.sec && prev.para === next.para) return prev
        return next
      })
    } catch {
      // Caret lookup can fail transiently while the editor swaps documents.
    }
  }, [bridge])

  const runReadOutline = useCallback(
    async (overrideAppMap?: OutlineStyleMap | null) => {
      cancelScheduledRefresh()
      const seq = ++readSeqRef.current
      const started = nowMs()
      const mapToUse = overrideAppMap !== undefined ? overrideAppMap : appStyleMapRef.current
      try {
        const result = await bridge.readOutline({ appStyleMap: mapToUse })
        lastReadCostMsRef.current = Math.max(0, nowMs() - started)
        if (!mountedRef.current || seq !== readSeqRef.current) return
        setItems(Array.isArray(result?.items) ? result.items : [])
        setEffectiveStyleMap(result?.effectiveStyleMap ?? {})
        setHasDocStyleMap(result?.hasDocStyleMap === true)
        setDocStyleMap(result?.docStyleMap ?? null)
        setLoaded(true)
        hasLoadedRef.current = true
        dirtyWhileHiddenRef.current = false
        void syncCaret()
      } catch (err) {
        lastReadCostMsRef.current = Math.max(0, nowMs() - started)
        if (!mountedRef.current || seq !== readSeqRef.current) return
        setLoaded(true)
        setNotice({
          kind: 'error',
          key: 'outlineReadFailed',
          params: { error: err instanceof Error ? err.message : String(err) },
        })
      }
    },
    [bridge, cancelScheduledRefresh, syncCaret],
  )

  const scheduleDebouncedRefresh = useCallback(() => {
    cancelScheduledRefresh()
    const delay = Math.max(refreshPauseMs, lastReadCostMsRef.current * OUTLINE_PAUSE_PER_READ)
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null
      if (!mountedRef.current) return
      if (!visibleRef.current) {
        dirtyWhileHiddenRef.current = true
        return
      }
      if (typeof globalThis.requestIdleCallback === 'function') {
        refreshIdleRef.current = globalThis.requestIdleCallback(
          () => {
            refreshIdleRef.current = null
            if (!mountedRef.current || !visibleRef.current) {
              dirtyWhileHiddenRef.current = true
              return
            }
            void runReadOutline()
          },
          { timeout: OUTLINE_IDLE_DEADLINE_MS },
        )
      } else {
        void runReadOutline()
      }
    }, delay)
  }, [cancelScheduledRefresh, refreshPauseMs, runReadOutline])

  const refreshDocStyles = useCallback(async () => {
    try {
      const result = await bridge.listStyles()
      if (!mountedRef.current) return
      if (result && Array.isArray(result.paragraph)) {
        setDocStyles(result.paragraph)
      }
    } catch {
      // Editor may not be ready yet; retry on next drawer open.
    }
  }, [bridge])

  // Track unmount and cancel pending timers/idle callbacks.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cancelScheduledRefresh()
    }
  }, [cancelScheduledRefresh])

  // Load app-wide outline style map once and subscribe to cross-tab updates.
  useEffect(() => {
    let active = true
    const init = async (): Promise<void> => {
      let initialAppMap: OutlineStyleMap | null = null
      if (typeof resolvedSettingsApi?.getOutlineStyleMap === 'function') {
        try {
          initialAppMap = await resolvedSettingsApi.getOutlineStyleMap()
        } catch {
          initialAppMap = null
        }
      }
      if (!active || !mountedRef.current) return
      appStyleMapRef.current = initialAppMap
      setAppStyleMap(initialAppMap)
      if (visibleRef.current) {
        await runReadOutline(initialAppMap)
      } else {
        dirtyWhileHiddenRef.current = true
      }
    }
    void init()

    const unsubscribe = resolvedSettingsApi?.onOutlineStyleMapChanged?.((nextMap) => {
      if (!active || !mountedRef.current) return
      appStyleMapRef.current = nextMap
      setAppStyleMap(nextMap)
      if (visibleRef.current) {
        void runReadOutline(nextMap)
      } else {
        dirtyWhileHiddenRef.current = true
      }
    })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [resolvedSettingsApi, runReadOutline])

  // Debounced adaptive idle refresh whenever the document changes externally.
  useEffect(() => {
    if (changeTick === lastChangeTickRef.current) return
    lastChangeTickRef.current = changeTick
    if (!visibleRef.current) {
      cancelScheduledRefresh()
      dirtyWhileHiddenRef.current = true
      return
    }
    scheduleDebouncedRefresh()
  }, [changeTick, cancelScheduledRefresh, scheduleDebouncedRefresh])

  // Flush deferred refresh when the tab becomes visible again.
  useEffect(() => {
    if (!visible) {
      cancelScheduledRefresh()
      return
    }
    if (dirtyWhileHiddenRef.current) {
      dirtyWhileHiddenRef.current = false
      void runReadOutline()
    }
  }, [visible, cancelScheduledRefresh, runReadOutline])

  // Lightweight caret poll only while the Outline tab is visible.
  useEffect(() => {
    if (!visible || caretPollMs <= 0) return
    const intervalId = setInterval(() => {
      void syncCaret()
    }, caretPollMs)
    return () => clearInterval(intervalId)
  }, [visible, caretPollMs, syncCaret])

  // Load paragraph styles when the settings drawer opens (or document updates while open).
  useEffect(() => {
    if (!visible || !settingsOpen) return
    void refreshDocStyles()
  }, [visible, settingsOpen, changeTick, refreshDocStyles])

  // Close context menu on outside click or Escape key.
  useEffect(() => {
    if (!contextMenu) return
    const handlePointerDown = (e: globalThis.MouseEvent): void => {
      if (contextMenuRef.current?.contains(e.target as Node)) return
      setContextMenu(null)
    }
    const handleKeyDown = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu])

  const filterLevels = useMemo(() => computeFilterLevels(items), [items])

  const visibleRows = useMemo(
    () => computeVisibleOutlineRows(items, maxLevel, collapsedKeys),
    [items, maxLevel, collapsedKeys],
  )

  const activeIndex = useMemo(() => findActiveOutlineIndex(items, caret), [items, caret])
  const activeItem = activeIndex >= 0 ? items[activeIndex] : null
  const activeKey = activeItem ? outlineItemKey(activeItem) : null

  // Keep the active heading visible in the outline scroll area when the caret moves.
  useEffect(() => {
    if (!visible || !activeKey || activeKey === lastScrolledKeyRef.current) return
    lastScrolledKeyRef.current = activeKey
    const el = rowRefs.current.get(activeKey)
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [visible, activeKey, visibleRows])

  const toggleCollapse = useCallback((key: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const handleSelectRow = useCallback(
    (item: OutlineItem) => {
      setContextMenu(null)
      setCaret({ sec: item.sec, para: item.para })
      void Promise.resolve(
        bridge.reveal({ sec: item.sec, para: item.para, offset: 0, length: 0 }),
      ).catch(() => undefined)
    },
    [bridge],
  )

  const handleRowKeyDown = (e: KeyboardEvent<HTMLDivElement>, row: VisibleOutlineRow): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleSelectRow(row.item)
      return
    }
    if (e.key === 'ArrowLeft' && row.hasChildren && !row.isCollapsed) {
      e.preventDefault()
      toggleCollapse(row.key)
      return
    }
    if (e.key === 'ArrowRight' && row.hasChildren && row.isCollapsed) {
      e.preventDefault()
      toggleCollapse(row.key)
    }
  }

  const handleChangeLevel = useCallback(
    async (item: OutlineItem | null, delta: 1 | -1, singleOnly: boolean) => {
      if (!item || mutating) return
      setContextMenu(null)
      if (typeof bridge.changeOutlineLevel !== 'function') {
        setNotice({ kind: 'error', key: 'outlineOpUnavailable', reason: 'unavailable' })
        return
      }
      setMutating(true)
      setNotice(null)
      try {
        const result = await bridge.changeOutlineLevel({
          sec: item.sec,
          para: item.para,
          delta,
          singleOnly,
          appStyleMap: appStyleMapRef.current,
        })
        if (!mountedRef.current) return
        if (!result.ok) {
          const fallbackLevel = Math.min(10, Math.max(1, item.level + delta))
          setNotice(mapLevelRefusalToNotice(result, fallbackLevel))
          return
        }
        await runReadOutline()
      } catch (err) {
        if (!mountedRef.current) return
        setNotice({
          kind: 'error',
          key: 'outlineLevelFailed',
          params: { error: err instanceof Error ? err.message : String(err) },
        })
      } finally {
        if (mountedRef.current) setMutating(false)
      }
    },
    [bridge, mutating, runReadOutline],
  )

  const handleRowContextMenu = (e: MouseEvent<HTMLDivElement>, row: VisibleOutlineRow): void => {
    e.preventDefault()
    setContextMenu({
      item: row.item,
      hasChildren: row.hasChildren,
      isCollapsed: row.isCollapsed,
      x: e.clientX,
      y: e.clientY,
    })
  }

  const computeDropPosition = (
    e: DragEvent<HTMLDivElement>,
    targetKey: string,
  ): 'before' | 'after' => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (e.clientY > 0 && rect.height > 0) {
      return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    }
    if (dropIndicatorRef.current?.key === targetKey) {
      return dropIndicatorRef.current.position
    }
    if (rect.height > 0) {
      return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    }
    return 'after'
  }

  const handleDragStart = (e: DragEvent<HTMLDivElement>, row: VisibleOutlineRow): void => {
    setContextMenu(null)
    const source = { sec: row.item.sec, para: row.item.para }
    dragSourceRef.current = source
    setDraggingKey(row.key)
    try {
      e.dataTransfer?.setData('text/plain', row.key)
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
    } catch {
      // Synthetic drag events in tests may omit or lock dataTransfer.
    }
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>, row: VisibleOutlineRow): void => {
    e.preventDefault()
    const source = dragSourceRef.current
    if (source && source.sec === row.item.sec && source.para === row.item.para) {
      if (dropIndicatorRef.current !== null) {
        dropIndicatorRef.current = null
        setDropIndicator(null)
      }
      return
    }
    try {
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    } catch {
      // Ignore read-only dataTransfer in synthetic events.
    }
    const position = computeDropPosition(e, row.key)
    const next: DropIndicatorState = { key: row.key, position }
    if (
      dropIndicatorRef.current?.key !== next.key ||
      dropIndicatorRef.current?.position !== next.position
    ) {
      dropIndicatorRef.current = next
      setDropIndicator(next)
    }
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>, row: VisibleOutlineRow): void => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    if (dropIndicatorRef.current?.key === row.key) {
      dropIndicatorRef.current = null
      setDropIndicator(null)
    }
  }

  const handleDragEnd = (): void => {
    dragSourceRef.current = null
    dropIndicatorRef.current = null
    setDraggingKey(null)
    setDropIndicator(null)
  }

  const handleDrop = async (
    e: DragEvent<HTMLDivElement>,
    row: VisibleOutlineRow,
  ): Promise<void> => {
    e.preventDefault()
    let source = dragSourceRef.current
    if (!source) {
      try {
        const raw = e.dataTransfer?.getData('text/plain')
        if (raw) source = parseOutlineItemKey(raw)
      } catch {
        source = null
      }
    }
    const position = computeDropPosition(e, row.key)
    dragSourceRef.current = null
    dropIndicatorRef.current = null
    setDraggingKey(null)
    setDropIndicator(null)

    if (!source || (source.sec === row.item.sec && source.para === row.item.para)) return
    if (mutating) return
    if (typeof bridge.moveOutlineSection !== 'function') {
      setNotice({ kind: 'error', key: 'outlineOpUnavailable', reason: 'unavailable' })
      return
    }

    setMutating(true)
    setNotice(null)
    try {
      const result = await bridge.moveOutlineSection({
        source,
        target: { sec: row.item.sec, para: row.item.para },
        position,
        appStyleMap: appStyleMapRef.current,
      })
      if (!mountedRef.current) return
      if (!result.ok) {
        setNotice(mapMoveRefusalToNotice(result))
        return
      }
      await runReadOutline()
    } catch (err) {
      if (!mountedRef.current) return
      setNotice({
        kind: 'error',
        key: 'outlineMoveEngineError',
        params: { error: err instanceof Error ? err.message : String(err) },
      })
    } finally {
      if (mountedRef.current) setMutating(false)
    }
  }

  const displayedStyleMap: OutlineStyleMap = useMemo(() => {
    if (mappingScope === 'doc') {
      return docStyleMap ?? effectiveStyleMap
    }
    return appStyleMap ?? { ...DEFAULT_OUTLINE_STYLE_MAP }
  }, [mappingScope, docStyleMap, effectiveStyleMap, appStyleMap])

  const sortedMappings = useMemo(
    () => sortOutlineStyleEntries(displayedStyleMap),
    [displayedStyleMap],
  )

  const saveStyleMap = useCallback(
    async (nextMap: OutlineStyleMap) => {
      if (mutating) return
      setMutating(true)
      setNotice(null)
      try {
        if (mappingScope === 'doc') {
          const res = await bridge.setDocOutlineMap(nextMap)
          if (!mountedRef.current) return
          if (!res.ok) {
            setNotice({
              kind: 'error',
              key: 'outlineSettingsSaveFailed',
              params: { error: 'reason' in res ? String(res.reason) : '' },
            })
            return
          }
          setNotice({ kind: 'info', key: 'outlineSettingsSavedDoc' })
          await runReadOutline()
        } else {
          if (typeof resolvedSettingsApi?.setOutlineStyleMap !== 'function') {
            setNotice({ kind: 'error', key: 'outlineOpUnavailable', reason: 'unavailable' })
            return
          }
          const saved = await resolvedSettingsApi.setOutlineStyleMap(nextMap)
          if (!mountedRef.current) return
          appStyleMapRef.current = saved
          setAppStyleMap(saved)
          setNotice({ kind: 'info', key: 'outlineSettingsSavedApp' })
          await runReadOutline(saved)
        }
      } catch (err) {
        if (!mountedRef.current) return
        setNotice({
          kind: 'error',
          key: 'outlineSettingsSaveFailed',
          params: { error: err instanceof Error ? err.message : String(err) },
        })
      } finally {
        if (mountedRef.current) setMutating(false)
      }
    },
    [bridge, mappingScope, mutating, resolvedSettingsApi, runReadOutline],
  )

  const handleUpdateMappingLevel = (styleName: string, level: number): void => {
    const nextMap: OutlineStyleMap = { ...displayedStyleMap, [styleName]: level }
    void saveStyleMap(nextMap)
  }

  const handleRemoveMapping = (styleName: string): void => {
    const nextMap: OutlineStyleMap = { ...displayedStyleMap }
    delete nextMap[styleName]
    void saveStyleMap(nextMap)
  }

  const handleAddMapping = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    const trimmed = newStyleName.trim()
    if (!trimmed) return
    const nextMap: OutlineStyleMap = { ...displayedStyleMap, [trimmed]: newStyleLevel }
    setNewStyleName('')
    void saveStyleMap(nextMap)
  }

  const handleClearDocOverride = async (): Promise<void> => {
    if (mutating) return
    setMutating(true)
    setNotice(null)
    try {
      const res = await bridge.setDocOutlineMap(null)
      if (!mountedRef.current) return
      if (!res.ok) {
        setNotice({
          kind: 'error',
          key: 'outlineSettingsSaveFailed',
          params: { error: 'reason' in res ? String(res.reason) : '' },
        })
        return
      }
      setNotice({ kind: 'info', key: 'outlineSettingsClearedDoc' })
      await runReadOutline()
    } catch (err) {
      if (!mountedRef.current) return
      setNotice({
        kind: 'error',
        key: 'outlineSettingsSaveFailed',
        params: { error: err instanceof Error ? err.message : String(err) },
      })
    } finally {
      if (mountedRef.current) setMutating(false)
    }
  }

  const handleResetAppDefaults = async (): Promise<void> => {
    if (mutating) return
    if (typeof resolvedSettingsApi?.setOutlineStyleMap !== 'function') {
      setNotice({ kind: 'error', key: 'outlineOpUnavailable', reason: 'unavailable' })
      return
    }
    setMutating(true)
    setNotice(null)
    try {
      const saved = await resolvedSettingsApi.setOutlineStyleMap(null)
      if (!mountedRef.current) return
      appStyleMapRef.current = saved
      setAppStyleMap(saved)
      setNotice({ kind: 'info', key: 'outlineSettingsResetApp' })
      await runReadOutline(saved)
    } catch (err) {
      if (!mountedRef.current) return
      setNotice({
        kind: 'error',
        key: 'outlineSettingsSaveFailed',
        params: { error: err instanceof Error ? err.message : String(err) },
      })
    } finally {
      if (mountedRef.current) setMutating(false)
    }
  }

  return (
    <div className="outline-tab" data-outline-tab="true">
      <div className="outline-header">
        <div className="outline-toolbar-row">
          <div
            className="outline-level-filters"
            role="group"
            aria-label={t('outlineLevelFilterLabel')}
          >
            {filterLevels.map((level) => {
              const isActive = maxLevel === level
              return (
                <button
                  key={level}
                  type="button"
                  className={`outline-filter-btn${isActive ? ' active' : ''}`}
                  aria-pressed={isActive}
                  aria-label={t('outlineLevelItem', { level })}
                  title={t('outlineLevelItem', { level })}
                  data-outline-level-filter={String(level)}
                  onClick={() => setMaxLevel(level)}
                >
                  {level}
                </button>
              )
            })}
            <button
              type="button"
              className={`outline-filter-btn${maxLevel === null ? ' active' : ''}`}
              aria-pressed={maxLevel === null}
              data-outline-level-filter="all"
              onClick={() => setMaxLevel(null)}
            >
              {t('outlineLevelAll')}
            </button>
          </div>
        </div>

        <div className="outline-actions-row">
          <button
            type="button"
            className="outline-tool-btn"
            disabled={!activeItem || mutating}
            title={t('outlinePromoteTooltip')}
            aria-label={t('outlinePromote')}
            data-outline-action="promote"
            onClick={(e) => void handleChangeLevel(activeItem, -1, e.shiftKey)}
          >
            ← {t('outlinePromote')}
          </button>
          <button
            type="button"
            className="outline-tool-btn"
            disabled={!activeItem || mutating}
            title={t('outlineDemoteTooltip')}
            aria-label={t('outlineDemote')}
            data-outline-action="demote"
            onClick={(e) => void handleChangeLevel(activeItem, 1, e.shiftKey)}
          >
            → {t('outlineDemote')}
          </button>
          <button
            type="button"
            className={`outline-tool-btn outline-settings-toggle${settingsOpen ? ' active' : ''}`}
            aria-expanded={settingsOpen}
            data-outline-action="toggle-settings"
            onClick={() => setSettingsOpen((prev) => !prev)}
          >
            {t('outlineSettingsToggle')}
          </button>
        </div>
      </div>

      {notice !== null && (
        <div
          className={`outline-notice ${notice.kind === 'error' ? 'is-error' : 'is-info'}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
          data-outline-notice={notice.kind}
          data-outline-notice-reason={notice.reason ?? ''}
        >
          <span className="outline-notice-text">{t(notice.key, notice.params)}</span>
          <button
            type="button"
            className="outline-notice-close"
            aria-label={t('outlineDismissNotice')}
            title={t('outlineDismissNotice')}
            data-outline-action="dismiss-notice"
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </div>
      )}

      {settingsOpen && (
        <div className="outline-settings-drawer" data-outline-settings="open">
          <div className="outline-settings-head">
            <h3 className="outline-settings-title">{t('outlineSettingsTitle')}</h3>
            <button
              type="button"
              className="outline-settings-close"
              aria-label={t('outlineSettingsClose')}
              title={t('outlineSettingsClose')}
              data-outline-action="close-settings"
              onClick={() => setSettingsOpen(false)}
            >
              ×
            </button>
          </div>

          <div className="outline-scope-tabs" role="group" aria-label={t('outlineScopeLabel')}>
            <button
              type="button"
              className={`outline-scope-btn${mappingScope === 'doc' ? ' active' : ''}`}
              aria-pressed={mappingScope === 'doc'}
              data-outline-scope="doc"
              onClick={() => setMappingScope('doc')}
            >
              {t('outlineScopeDoc')}
            </button>
            <button
              type="button"
              className={`outline-scope-btn${mappingScope === 'app' ? ' active' : ''}`}
              aria-pressed={mappingScope === 'app'}
              data-outline-scope="app"
              onClick={() => setMappingScope('app')}
            >
              {t('outlineScopeApp')}
            </button>
          </div>

          <p className="outline-scope-status" data-outline-doc-override={String(hasDocStyleMap)}>
            {hasDocStyleMap ? t('outlineScopeDocActive') : t('outlineScopeAppActive')}
          </p>

          <div className="outline-mapping-list" data-outline-mapping-list="true">
            {sortedMappings.length === 0 ? (
              <p className="outline-mapping-empty">{t('outlineMappingEmpty')}</p>
            ) : (
              sortedMappings.map(([styleName, level]) => (
                <div
                  key={styleName}
                  className="outline-mapping-row"
                  data-outline-mapping-style={styleName}
                >
                  <span className="outline-mapping-style" title={styleName}>
                    {styleName}
                  </span>
                  <select
                    className="outline-select"
                    value={level}
                    disabled={mutating}
                    aria-label={`${styleName} ${t('outlineLevelSelectLabel')}`}
                    data-outline-map-level={styleName}
                    onChange={(e) => handleUpdateMappingLevel(styleName, Number(e.target.value))}
                  >
                    {ALL_OUTLINE_LEVELS.map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {t('outlineLevelOption', { level: lvl })}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="outline-mapping-remove"
                    disabled={mutating}
                    aria-label={t('outlineMappingRemove', { style: styleName })}
                    title={t('outlineMappingRemove', { style: styleName })}
                    data-outline-remove-style={styleName}
                    onClick={() => handleRemoveMapping(styleName)}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>

          <form className="outline-add-form" onSubmit={handleAddMapping}>
            <input
              type="text"
              className="outline-style-input"
              list={styleDatalistId}
              value={newStyleName}
              placeholder={t('outlineStyleInputPlaceholder')}
              aria-label={t('outlineStyleSelectLabel')}
              data-outline-add-style="input"
              onChange={(e) => setNewStyleName(e.target.value)}
            />
            <datalist id={styleDatalistId} data-outline-style-options="true">
              {docStyles.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <select
              className="outline-select"
              value={newStyleLevel}
              aria-label={t('outlineLevelSelectLabel')}
              data-outline-add-level="select"
              onChange={(e) => setNewStyleLevel(Number(e.target.value))}
            >
              {ALL_OUTLINE_LEVELS.map((lvl) => (
                <option key={lvl} value={lvl}>
                  {t('outlineLevelOption', { level: lvl })}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="outline-add-btn"
              disabled={newStyleName.trim().length === 0 || mutating}
              data-outline-action="add-mapping"
            >
              {t('outlineMappingAdd')}
            </button>
          </form>

          <div className="outline-settings-footer">
            {mappingScope === 'doc' && hasDocStyleMap && (
              <button
                type="button"
                className="outline-link-btn"
                disabled={mutating}
                data-outline-action="clear-doc-map"
                onClick={() => void handleClearDocOverride()}
              >
                {t('outlineClearDocOverride')}
              </button>
            )}
            {mappingScope === 'app' && (
              <button
                type="button"
                className="outline-link-btn"
                disabled={mutating}
                data-outline-action="reset-app-map"
                onClick={() => void handleResetAppDefaults()}
              >
                {t('outlineResetAppDefaults')}
              </button>
            )}
          </div>
        </div>
      )}

      <div
        className="outline-tree"
        role="tree"
        aria-label={t('outlineTreeLabel')}
        data-outline-tree="true"
        onScroll={() => {
          if (contextMenu) setContextMenu(null)
        }}
      >
        {!loaded ? (
          <p className="outline-empty-state" data-outline-state="loading">
            {t('outlineLoading')}
          </p>
        ) : items.length === 0 ? (
          <p className="outline-empty-state" data-outline-state="empty">
            {t('outlineEmpty')}
          </p>
        ) : visibleRows.length === 0 ? (
          <p className="outline-empty-state" data-outline-state="filtered-empty">
            {t('outlineFilteredEmpty')}
          </p>
        ) : (
          visibleRows.map((row) => {
            const isActive = row.key === activeKey
            const isDragging = row.key === draggingKey
            const dropPos = dropIndicator?.key === row.key ? dropIndicator.position : null
            const pageText = formatPrintedPage(row.item)
            const displayTitle = row.item.title || t('outlineUntitled')
            const paddingLeft = BASE_PADDING_LEFT_PX + row.depth * INDENT_STEP_PX

            return (
              <div
                key={row.key}
                ref={(node) => {
                  if (node) rowRefs.current.set(row.key, node)
                  else rowRefs.current.delete(row.key)
                }}
                role="treeitem"
                tabIndex={0}
                aria-level={row.item.level}
                aria-expanded={row.hasChildren ? !row.isCollapsed : undefined}
                aria-current={isActive ? 'location' : undefined}
                draggable={!mutating}
                className={`outline-row level-${row.item.level}${isActive ? ' active' : ''}${isDragging ? ' dragging' : ''}${dropPos === 'before' ? ' drop-before' : ''}${dropPos === 'after' ? ' drop-after' : ''}`}
                style={{ paddingLeft: `${paddingLeft}px` }}
                data-outline-row={row.key}
                data-outline-level={row.item.level}
                data-drop-position={dropPos ?? undefined}
                onClick={() => handleSelectRow(row.item)}
                onKeyDown={(e) => handleRowKeyDown(e, row)}
                onContextMenu={(e) => handleRowContextMenu(e, row)}
                onDragStart={(e) => handleDragStart(e, row)}
                onDragOver={(e) => handleDragOver(e, row)}
                onDragLeave={(e) => handleDragLeave(e, row)}
                onDragEnd={handleDragEnd}
                onDrop={(e) => void handleDrop(e, row)}
              >
                {row.hasChildren ? (
                  <button
                    type="button"
                    className="outline-chevron-btn"
                    aria-label={row.isCollapsed ? t('outlineExpand') : t('outlineCollapse')}
                    title={row.isCollapsed ? t('outlineExpand') : t('outlineCollapse')}
                    data-outline-toggle={row.key}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleCollapse(row.key)
                    }}
                  >
                    {row.isCollapsed ? '▸' : '▾'}
                  </button>
                ) : (
                  <span className="outline-chevron-spacer" aria-hidden="true" />
                )}

                <span className="outline-row-content">
                  {row.item.number && (
                    <span className="outline-row-number" data-outline-number={row.key}>
                      {row.item.number}
                    </span>
                  )}
                  <span className="outline-row-title" title={displayTitle}>
                    {displayTitle}
                  </span>
                </span>

                <span
                  className="outline-row-page"
                  aria-label={t('outlinePageAria', { page: pageText })}
                  data-outline-page={row.key}
                >
                  {pageText}
                </span>
              </div>
            )
          })
        )}
      </div>

      {contextMenu !== null && (
        <div
          ref={contextMenuRef}
          className="outline-context-menu"
          role="menu"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          data-outline-context-menu="true"
        >
          <button
            type="button"
            role="menuitem"
            className="outline-context-item"
            disabled={mutating}
            data-outline-menu="promote"
            onClick={() => void handleChangeLevel(contextMenu.item, -1, false)}
          >
            {t('outlineMenuPromote')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="outline-context-item"
            disabled={mutating}
            data-outline-menu="demote"
            onClick={() => void handleChangeLevel(contextMenu.item, 1, false)}
          >
            {t('outlineMenuDemote')}
          </button>
          <div className="outline-context-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="outline-context-item"
            disabled={mutating}
            data-outline-menu="promote-single"
            onClick={() => void handleChangeLevel(contextMenu.item, -1, true)}
          >
            {t('outlineMenuPromoteSingle')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="outline-context-item"
            disabled={mutating}
            data-outline-menu="demote-single"
            onClick={() => void handleChangeLevel(contextMenu.item, 1, true)}
          >
            {t('outlineMenuDemoteSingle')}
          </button>
          {contextMenu.hasChildren && (
            <>
              <div className="outline-context-sep" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="outline-context-item"
                data-outline-menu="toggle-collapse"
                onClick={() => {
                  toggleCollapse(outlineItemKey(contextMenu.item))
                  setContextMenu(null)
                }}
              >
                {contextMenu.isCollapsed ? t('outlineMenuExpand') : t('outlineMenuCollapse')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
