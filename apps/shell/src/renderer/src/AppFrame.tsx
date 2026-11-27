import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { SplitViewState } from '../../shared/split-view-api'
import { filePanelInset, type FilePanelState } from '../../shared/file-panel-api'
import { tabStripHeight } from '../../shared/tab-drag-geometry'
import type { TabSummary } from '../../shared/tabs-api'
import { FilePanel } from './file-panel/FilePanel'
import { useFirstConnectionNotice } from './FirstConnectionNotice'
import { Home } from './Home'
import { subscribeProjectScreen, type ProjectScreenRequest } from './project-screen-events'
import {
  SPLIT_EVEN_RATIO,
  dividerRect,
  ratioForDragOffset,
  type ViewportSize,
} from './split-view-geometry'
import { TabBar } from './TabBar'
import { useSubscriptionConnection } from './subscription-client'

const Onboarding = lazy(() => import('./Onboarding').then((m) => ({ default: m.Onboarding })))

interface AppFrameProps {
  /** resolved before first paint (main.tsx) so home never flashes under the overlay */
  initialOnboardingSeen: boolean
}

/** The shell renderer's viewport: the same CSS px space the pane bounds use. */
function useViewportSize(): ViewportSize {
  const [size, setSize] = useState<ViewportSize>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))
  useEffect(() => {
    const onResize = (): void => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

/** Read the split once, then follow the main process' change notices. */
function useSplitView(): SplitViewState | null {
  const [split, setSplit] = useState<SplitViewState | null>(null)
  useEffect(() => {
    let alive = true
    // until the split wiring is registered a bare read rejects: "not split"
    void window.aiOfficeTabs.getSplit().then(
      (state) => {
        if (alive) setSplit(state)
      },
      () => undefined,
    )
    const off = window.aiOfficeTabs.onSplitChanged(setSplit)
    return () => {
      alive = false
      off()
    }
  }, [])
  return split
}

/** Read the files panel state once, then follow the main process' change notices. */
function useFilePanelState(): FilePanelState | null {
  const [state, setState] = useState<FilePanelState | null>(null)
  useEffect(() => {
    let alive = true
    void window.aiOfficeFilePanel?.get().then(
      (next) => {
        if (alive) setState(next)
      },
      () => undefined,
    )
    const off = window.aiOfficeFilePanel?.onChanged(setState)
    return () => {
      alive = false
      off?.()
    }
  }, [])
  return state
}

interface DividerDrag {
  pointerId: number
  /** pointer position minus the divider's leading edge at pointer-down */
  grabOffset: number
  frame: number | null
  pending: number | null
}

/**
 * The two panes are WebContentsViews that paint above shell DOM, so the only
 * chrome the divider can live in is the gap the main process leaves between
 * them. Its rectangle is recomputed from the viewport and the split ratio.
 */
function SplitDivider({
  split,
  viewport: windowViewport,
  originX,
}: {
  split: SplitViewState
  viewport: ViewportSize
  /** where the pane space begins: right of the open files panel */
  originX: number
}) {
  const dragRef = useRef<DividerDrag | null>(null)
  // during a drag the divider follows the pointer here so it never lags the
  // main process re-laying the views out; the answered state takes over after
  const [dragRatio, setDragRatio] = useState<number | null>(null)
  const ratio = dragRatio ?? split.ratio
  // the geometry works in pane space; the files panel shifts it right
  const viewport = {
    width: Math.max(0, windowViewport.width - originX),
    height: windowViewport.height,
  }
  const paneRect = dividerRect(viewport, split.orientation, ratio)
  const rect = { ...paneRect, left: paneRect.left + originX }

  // a queued frame must never fire into an unmounted divider (e.g. the split
  // closed mid-drag)
  useEffect(() => {
    return () => {
      const drag = dragRef.current
      if (drag?.frame != null) cancelAnimationFrame(drag.frame)
      dragRef.current = null
    }
  }, [])

  const pointerAlongAxis = (event: ReactPointerEvent<HTMLDivElement>): number =>
    split.orientation === 'side' ? event.clientX - originX : event.clientY

  const send = (value: number): void => window.aiOfficeTabs.setSplitRatio(value)

  const endDrag = (): void => {
    const drag = dragRef.current
    if (drag?.frame != null) cancelAnimationFrame(drag.frame)
    dragRef.current = null
    setDragRatio(null)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const current = dividerRect(viewport, split.orientation, split.ratio)
    const leading = split.orientation === 'side' ? current.left + originX : current.top
    dragRef.current = {
      pointerId: event.pointerId,
      grabOffset: pointerAlongAxis(event) - leading,
      frame: null,
      pending: null,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragRatio(split.ratio)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const target = pointerAlongAxis(event) - drag.grabOffset
    const next = ratioForDragOffset(target, viewport, split.orientation)
    // past a pane's minimum the drag means "close that side": say so once and
    // let the split notice remove the divider
    if (next === 0 || next === 1) {
      endDrag()
      send(next)
      return
    }
    setDragRatio(next)
    drag.pending = next
    // every accepted ratio re-lays both views in the main process, so the
    // pointer stream is sampled to one send per animation frame
    if (drag.frame == null) {
      drag.frame = requestAnimationFrame(() => {
        const current = dragRef.current
        if (!current) return
        current.frame = null
        const pending = current.pending
        current.pending = null
        if (pending != null) send(pending)
      })
    }
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const target = pointerAlongAxis(event) - drag.grabOffset
    // the release position supersedes the last throttled sample
    const final = ratioForDragOffset(target, viewport, split.orientation)
    endDrag()
    send(final)
  }

  return (
    <div
      className={`split-divider ${split.orientation === 'side' ? 'side' : 'stack'}`}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      role="separator"
      aria-orientation={split.orientation === 'side' ? 'vertical' : 'horizontal'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={() => send(SPLIT_EVEN_RATIO)}
    />
  )
}

export function AppFrame({ initialOnboardingSeen }: AppFrameProps) {
  // null until the initial tabs:list response arrives (~0.1 ms), so a direct
  // file-launch does not mount Home and fire its IPCs behind the editor view.
  const [homeActive, setHomeActive] = useState<boolean | null>(initialOnboardingSeen ? null : true)
  const [homeMounted, setHomeMounted] = useState(!initialOnboardingSeen)
  const [showOnboarding, setShowOnboarding] = useState(!initialOnboardingSeen)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pendingProjectRequest, setPendingProjectRequest] = useState<ProjectScreenRequest | null>(
    null,
  )
  const split = useSplitView()
  const viewport = useViewportSize()
  const filePanel = useFilePanelState()
  const [tabs, setTabs] = useState<TabSummary[]>([])
  // the panel mounts the first time it opens and then keeps its tree while closed
  const [filePanelMounted, setFilePanelMounted] = useState(false)
  useEffect(() => {
    if (filePanel?.open) setFilePanelMounted(true)
  }, [filePanel?.open])
  // one live view of the subscription connection for the home screen, the
  // onboarding and the first-connection notice; defer the initial CLI probes
  // slightly on returning launches so Home finishes painting first
  const connection = useSubscriptionConnection({ initialDelayMs: showOnboarding ? 0 : 600 })
  const notice = useFirstConnectionNotice(connection.statuses)

  useEffect(() => {
    const applyTabs = (tabs: Awaited<ReturnType<typeof window.aiOfficeTabs.list>>) => {
      setTabs(tabs)
      const active = tabs.find((tab) => tab.active)
      const isHome = !active || active.kind === 'home'
      setHomeActive(isHome)
      if (isHome) setHomeMounted(true)
    }
    void window.aiOfficeTabs.list().then(applyTabs)
    return window.aiOfficeTabs.onChanged(applyTabs)
  }, [])

  // Buffer "open project screen" from an editor AI panel's "[view]" even before
  // Home has mounted on a direct file launch so the request is never lost.
  useEffect(
    () =>
      subscribeProjectScreen(window.projectFolderApi, (request) => {
        setPendingProjectRequest(request)
        setHomeMounted(true)
      }),
    [],
  )

  const finishOnboarding = async (): Promise<boolean> => {
    try {
      const persisted = await window.aiOffice.setOnboardingSeen()
      if (!persisted) return false
      setShowOnboarding(false)
      return true
    } catch {
      return false
    }
  }

  const isHomeVisible = homeActive === true
  const activeTab = tabs.find((tab) => tab.active)
  // Home has its own sidebar, so the panel only stands beside editor tabs
  const filePanelShown = !!filePanel?.open && homeActive === false
  const panelInset = filePanel && filePanelShown ? filePanelInset(filePanel, viewport.width) : 0
  const openPaths = tabs.flatMap((tab) => (tab.filePath ? [tab.filePath] : []))

  return (
    <div className="app-frame">
      <TabBar
        split={split}
        filePanel={
          homeActive === false && filePanel
            ? {
                open: filePanel.open,
                toggle: () => window.aiOfficeFilePanel.setOpen(!filePanel.open),
              }
            : null
        }
      />
      {/* divider sits in the gap between the two pane views — the one slice of
       * the content area they do not cover. Home paints this document instead
       * (the panes are only hidden there, not closed), so no seam over it. */}
      {split && !isHomeVisible && (
        <SplitDivider split={split} viewport={viewport} originX={panelInset} />
      )}
      {filePanel && filePanelMounted && (
        <FilePanel
          state={filePanel}
          inset={panelInset}
          top={tabStripHeight(filePanel.scale)}
          viewportHeight={viewport.height}
          activeFilePath={activeTab?.filePath}
          openPaths={openPaths}
          hidden={!filePanelShown}
        />
      )}
      {/* docs/sheets tabs render as WebContentsView children of this window, positioned
       * by the main process to cover this area — only Home paints its own content here. */}
      <div
        className="app-frame-content"
        style={{ visibility: isHomeVisible ? 'visible' : 'hidden' }}
      >
        {(homeMounted || showOnboarding) && (
          <Home
            connection={connection}
            aiSettings={notice.settings}
            // during the onboarding its connect step shows the notice instead
            noticeDue={notice.due && !showOnboarding}
            onNoticeAcknowledge={notice.acknowledge}
            welcomeOpen={showOnboarding}
            onSettingsOpenChange={setSettingsOpen}
            initialProjectRequest={pendingProjectRequest}
            active={isHomeVisible}
          />
        )}
      </div>
      {/* editor WebContentsViews paint above ALL shell DOM, so the overlay only
       * renders while the home tab is active — it comes back when home does */}
      {showOnboarding && isHomeVisible && (
        <Suspense fallback={null}>
          <Onboarding
            onDone={finishOnboarding}
            connection={connection}
            noticeDue={notice.due}
            onNoticeAcknowledge={notice.acknowledge}
            covered={settingsOpen}
          />
        </Suspense>
      )}
    </div>
  )
}
