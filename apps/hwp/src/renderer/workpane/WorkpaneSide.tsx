/**
 * Left workpane shell beside the Hangul editor document area, plus its top-bar toggle.
 *
 * Hosts extensible tabs ([Outline | Find] now, with a tab-registry design so later
 * bundles can register additional tabs such as Bibliography). Stays mounted while closed
 * so tab internal state survives toggling, resizes via pointer capture so the editor
 * iframe cannot swallow drags, and auto-collapses into a narrow vertical icon rail
 * whenever remaining document width would drop below MIN_DOC_WIDTH.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react'
import { IconClose } from '@genoffice/ui/icons'
import { useWorkpaneI18n, type WorkpaneTFunc } from '../i18n/workpane'
import {
  DEFAULT_WORKPANE_TABS,
  MIN_DOC_WIDTH,
  WORKPANE_WIDTH_MIN,
  clampWorkpaneWidth,
  loadWorkpaneWidth,
  resolveWorkpaneMode,
  saveWorkpaneWidth,
  type WorkpaneDisplayMode,
  type WorkpaneTabDef,
  type WorkpaneTabId,
} from './workpane-state'

export interface WorkpaneSlotContext {
  activeTab: WorkpaneTabId
  /** Increments each time Ctrl+F or View > Workpane > Find asks to focus the Find input. */
  focusFindTick: number
  /** Whether the tab content area is currently visible on screen. */
  visible: boolean
  /** Current layout mode of the workpane shell ('expanded' | 'rail'). */
  mode: WorkpaneDisplayMode
  /** Request closing the workpane (or flyout in rail mode). */
  close(): void
}

export interface WorkpaneSideProps {
  open: boolean
  activeTab: WorkpaneTabId
  onSelectTab(tab: WorkpaneTabId): void
  onClose(): void
  /** Increments when the Find input should be focused (e.g. Ctrl+F). */
  focusFindTick?: number
  /** Extensible tab registry; defaults to [outline, find]. */
  tabs?: readonly WorkpaneTabDef[]
  /**
   * Custom slot renderer for a tab's content. Return `undefined` to fall back to `slots`
   * or the built-in placeholder.
   */
  renderTab?: (tab: WorkpaneTabId, context: WorkpaneSlotContext) => ReactNode
  /** Optional static slot map keyed by tab id. */
  slots?: Partial<Record<WorkpaneTabId, ReactNode>>
  /** Optional hint string that triggers an immediate layout re-measure when sibling panes toggle. */
  layoutHint?: string
  /** Optional container width override (px); defaults to measuring the parent `.app-main` row. */
  containerWidth?: number
  /** Optional sibling sidebar width override (px); defaults to measuring sibling columns. */
  otherSideWidths?: number
  /** Minimum document width before auto-collapsing to icon rail (default MIN_DOC_WIDTH = 360). */
  minDocWidth?: number
}

function tabLabelOf(tab: WorkpaneTabDef, t: WorkpaneTFunc): string {
  if (tab.label) return tab.label
  if (tab.labelKey) return t(tab.labelKey)
  return tab.id
}

function WorkpaneTabIcon({ id }: { id: WorkpaneTabId }): ReactElement {
  if (id === 'find') {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5L13.75 13.75" />
      </svg>
    )
  }
  if (id === 'outline') {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 4h10M5.5 8h7.5M5.5 12h6" />
        <circle cx="3" cy="8" r="0.8" fill="currentColor" stroke="none" />
        <circle cx="3" cy="12" r="0.8" fill="currentColor" stroke="none" />
      </svg>
    )
  }
  // Generic panel-tab fallback icon for future registered tabs (e.g. bibliography)
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d="M5.5 6h5M5.5 9.5h3.5" />
    </svg>
  )
}

/** Measure the `.app-main` container and any sibling columns beside the document stage. */
function measureParentSpace(sideEl: HTMLElement | null): {
  containerWidth: number
  otherSideWidths: number
} {
  const parent = sideEl?.parentElement
  if (!parent) return { containerWidth: 0, otherSideWidths: 0 }
  const containerWidth = parent.getBoundingClientRect().width
  let otherSideWidths = 0
  for (const child of Array.from(parent.children)) {
    if (child === sideEl || child.classList.contains('hwp-stage')) continue
    otherSideWidths += child.getBoundingClientRect().width
  }
  return { containerWidth, otherSideWidths }
}

/** Top-bar button that opens and closes the left workpane. */
export function WorkpaneToggle({
  open,
  onToggle,
}: {
  open: boolean
  onToggle(): void
}): ReactElement {
  const { t } = useWorkpaneI18n()
  return (
    <button
      type="button"
      className={`workpane-toggle${open ? ' on' : ''}`}
      aria-pressed={open}
      onClick={onToggle}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
        <path d="M6.25 2.5v11" />
      </svg>
      <span>{t('workpaneOpen')}</span>
    </button>
  )
}

/** Resizable left workpane column with tab bar, slot rendering, and narrow-window icon rail. */
export function WorkpaneSide({
  open,
  activeTab,
  onSelectTab,
  onClose,
  focusFindTick = 0,
  tabs = DEFAULT_WORKPANE_TABS,
  renderTab,
  slots,
  layoutHint,
  containerWidth: containerWidthProp,
  otherSideWidths: otherSideWidthsProp,
  minDocWidth = MIN_DOC_WIDTH,
}: WorkpaneSideProps): ReactElement {
  const { t } = useWorkpaneI18n()
  const sideRef = useRef<HTMLDivElement>(null)
  const [preferredWidth, setPreferredWidth] = useState(() => loadWorkpaneWidth())
  const preferredRef = useRef(preferredWidth)
  preferredRef.current = preferredWidth
  const [resizing, setResizing] = useState(false)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const [measured, setMeasured] = useState({ containerWidth: 0, otherSideWidths: 0 })
  /** In narrow rail mode, clicking a tab icon opens a flyout without shrinking the document stage. */
  const [flyoutOpen, setFlyoutOpen] = useState(false)
  const prevFocusFindTickRef = useRef(focusFindTick)

  const refreshMeasure = useCallback(() => {
    if (containerWidthProp !== undefined && otherSideWidthsProp !== undefined) return
    const next = measureParentSpace(sideRef.current)
    setMeasured((prev) =>
      prev.containerWidth === next.containerWidth && prev.otherSideWidths === next.otherSideWidths
        ? prev
        : next,
    )
  }, [containerWidthProp, otherSideWidthsProp])

  useEffect(() => {
    refreshMeasure()
    const parent = sideRef.current?.parentElement
    let observer: ResizeObserver | null = null
    if (parent && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => refreshMeasure())
      observer.observe(parent)
      for (const child of Array.from(parent.children)) {
        if (child !== sideRef.current && !child.classList.contains('hwp-stage')) {
          observer.observe(child)
        }
      }
    }
    window.addEventListener('resize', refreshMeasure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', refreshMeasure)
    }
  }, [refreshMeasure, open, layoutHint])

  useEffect(() => () => resizeCleanupRef.current?.(), [])

  const effectiveContainerWidth = containerWidthProp ?? measured.containerWidth
  const effectiveOtherSideWidths = otherSideWidthsProp ?? measured.otherSideWidths
  const layout = useMemo(
    () =>
      resolveWorkpaneMode(
        effectiveContainerWidth,
        preferredWidth,
        effectiveOtherSideWidths,
        minDocWidth,
      ),
    [effectiveContainerWidth, preferredWidth, effectiveOtherSideWidths, minDocWidth],
  )
  const isRail = open && layout.mode === 'rail'

  // Clear the rail flyout when the workpane closes or widens back to expanded mode.
  useEffect(() => {
    if (!isRail && flyoutOpen) setFlyoutOpen(false)
  }, [isRail, flyoutOpen])

  // Ctrl+F / View > Workpane > Find in rail mode opens the flyout so the find input is reachable.
  useEffect(() => {
    if (focusFindTick !== prevFocusFindTickRef.current) {
      prevFocusFindTickRef.current = focusFindTick
      if (isRail && activeTab === 'find') {
        setFlyoutOpen(true)
      }
    }
  }, [focusFindTick, isRail, activeTab])

  const handleClose = useCallback(() => {
    if (isRail && flyoutOpen) {
      setFlyoutOpen(false)
    } else {
      onClose()
    }
  }, [isRail, flyoutOpen, onClose])

  const handleRailTabClick = (tabId: WorkpaneTabId): void => {
    if (flyoutOpen && activeTab === tabId) {
      setFlyoutOpen(false)
      return
    }
    onSelectTab(tabId)
    setFlyoutOpen(true)
  }

  /** Drag the right edge toward the document; pointer capture keeps the editor iframe from stealing moves. */
  const startResize = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const resizer = e.currentTarget
    const startX = e.clientX
    const startW = layout.width
    const maxAllowed =
      effectiveContainerWidth > 0
        ? Math.max(
            WORKPANE_WIDTH_MIN,
            effectiveContainerWidth - effectiveOtherSideWidths - minDocWidth,
          )
        : undefined
    setResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: PointerEvent): void => {
      const nextWidth = clampWorkpaneWidth(startW + ev.clientX - startX, maxAllowed)
      preferredRef.current = nextWidth
      setPreferredWidth(nextWidth)
    }
    let done = false
    const cleanup = (): void => {
      if (done) return
      done = true
      resizeCleanupRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
      resizer.removeEventListener('lostpointercapture', cleanup)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setResizing(false)
      saveWorkpaneWidth(preferredRef.current)
    }
    resizeCleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
    resizer.addEventListener('lostpointercapture', cleanup)
    resizer.setPointerCapture?.(e.pointerId)
  }

  const panelVisible = open && (!isRail || flyoutOpen)
  const slotContext = useMemo<WorkpaneSlotContext>(
    () => ({
      activeTab,
      focusFindTick,
      visible: panelVisible,
      mode: layout.mode,
      close: handleClose,
    }),
    [activeTab, focusFindTick, panelVisible, layout.mode, handleClose],
  )

  const renderSlot = (tabId: WorkpaneTabId): ReactNode => {
    if (renderTab) {
      const rendered = renderTab(tabId, slotContext)
      if (rendered !== undefined) return rendered
    }
    if (slots && tabId in slots && slots[tabId] !== undefined) {
      return slots[tabId]
    }
    const emptyKey =
      tabId === 'outline'
        ? 'workpaneOutlineEmpty'
        : tabId === 'find'
          ? 'workpaneFindEmpty'
          : 'workpaneOutlineEmpty'
    return <p className="workpane-placeholder">{t(emptyKey)}</p>
  }

  return (
    <div
      ref={sideRef}
      className={
        `workpane-side` +
        `${open ? '' : ' collapsed'}` +
        `${isRail ? ' rail' : ''}` +
        `${isRail && flyoutOpen ? ' flyout-open' : ''}` +
        `${resizing ? ' workpane-side-resizing' : ''}`
      }
      data-mode={open ? layout.mode : 'closed'}
      data-tab={activeTab}
      style={{ width: open ? layout.width : preferredWidth }}
    >
      {isRail && (
        <div
          className="workpane-rail"
          role="toolbar"
          aria-label={t('workpaneTitle')}
          title={t('workpaneRailHint')}
        >
          {tabs.map((tab) => {
            const label = tabLabelOf(tab, t)
            const active = activeTab === tab.id && flyoutOpen
            return (
              <button
                key={tab.id}
                type="button"
                className={`workpane-rail-btn${active ? ' active' : ''}`}
                aria-label={label}
                aria-pressed={active}
                title={label}
                data-workpane-rail-tab={tab.id}
                onClick={() => handleRailTabClick(tab.id)}
              >
                <WorkpaneTabIcon id={tab.id} />
              </button>
            )
          })}
          <button
            type="button"
            className="workpane-rail-btn workpane-rail-close"
            aria-label={t('workpaneClose')}
            title={t('workpaneClose')}
            onClick={() => {
              setFlyoutOpen(false)
              onClose()
            }}
          >
            <IconClose size={14} />
          </button>
        </div>
      )}
      <div
        className={`workpane-panel${isRail ? ' workpane-panel-flyout' : ''}`}
        style={isRail ? { width: preferredWidth } : undefined}
        aria-hidden={!panelVisible}
        hidden={isRail && !flyoutOpen}
      >
        <div className="workpane-head">
          <span className="workpane-title">{t('workpaneTitle')}</span>
          <button
            type="button"
            className="workpane-close-btn"
            aria-label={t('workpaneClose')}
            title={t('workpaneClose')}
            onClick={handleClose}
          >
            <IconClose size={14} />
          </button>
        </div>
        <div className="workpane-tabs" role="tablist" aria-label={t('workpaneTitle')}>
          {tabs.map((tab) => {
            const label = tabLabelOf(tab, t)
            const selected = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                className={`workpane-tab${selected ? ' active' : ''}`}
                aria-selected={selected}
                data-workpane-tab={tab.id}
                onClick={() => onSelectTab(tab.id)}
              >
                <WorkpaneTabIcon id={tab.id} />
                <span>{label}</span>
              </button>
            )
          })}
        </div>
        <div className="workpane-body">
          {tabs.map((tab) => {
            const selected = activeTab === tab.id
            return (
              <div
                key={tab.id}
                role="tabpanel"
                className="workpane-tabpanel"
                data-workpane-panel={tab.id}
                hidden={!selected}
              >
                {renderSlot(tab.id)}
              </div>
            )
          })}
        </div>
      </div>
      {open && !isRail && (
        <div
          className="workpane-side-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('workpaneResize')}
          onPointerDown={startResize}
        />
      )}
    </div>
  )
}
