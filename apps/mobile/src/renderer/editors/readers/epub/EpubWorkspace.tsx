/**
 * The EPUB reading screen: the shell with the chapter frame, the position
 * line and the contents / search / settings sheets.
 *
 * A chapter is drawn in a sandboxed frame (`allow-same-origin`, never
 * `allow-scripts`) from the adapter's drawing copy; every handler is attached
 * from this page. In the paged mode the chapter is cut into pages with the PC
 * preview's CSS columns and a page turns by shifting the body with
 * `transform` (the frame never scrolls, as in the PC preview); the scroll mode
 * scrolls the chapter and moves on past its ends (PC `navigation.ts`). A
 * pre-paginated chapter is one page fitted into the screen.
 *
 * Everything the document keeps (the book, the chapter on screen, the place,
 * the settings, the last search) lives in the `EpubReader`; this screen only
 * holds what it lays out.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Params } from '@genoffice/i18n'
import type { EpubRefusalReason } from '@genoffice/epub-engine/core'
import { IconChevronRight } from '../../../components/MobileIcons'
import {
  IconReaderSearch,
  IconReaderSettings,
  IconReaderToc,
} from '../../../components/icons/readers'
import { translateMobile } from '../../../i18n'
import type { MobileStringKey } from '../../../i18n/strings'
import { EditorShell, type EditorQuickActionItem } from '../../../shell/EditorShell'
import type { EditorWorkspaceProps } from '../../editorKind'
import { attachPinchZoom } from '../../pinchZoom'
import { useReaderKeepScreenOn } from '../shared/keepScreenOn'
import {
  applyViewCss,
  blockElement,
  clearHit,
  frameEdges,
  fragmentElement,
  topBlockId,
} from '../../../../../../epub/src/renderer/reader/frame-dom'
import {
  OVERSCROLL_IDLE,
  overscroll,
  type OverscrollState,
} from '../../../../../../epub/src/renderer/reader/navigation'
import {
  fixedPageCss,
  pageCount,
  pageGeometry,
  pageOfBox,
  viewCount,
  viewOfPage,
  viewOffset,
  type PageFlow,
  type PageGeometry,
  type Size,
} from '../../../../../../epub/src/renderer/reader/preview-pages'
import { FIND_HIGHLIGHT, frameColors } from '../../../../../../epub/src/renderer/reader/view-prefs'
import { nextChapter } from './book'
import { BLOCK_ATTR, VIEW_STYLE_ID } from './chapterView'
import { EpubOpening } from './EpubOpening'
import { createEpubReader, type EpubReader, type LoadedChapter } from './epubReader'
import { EpubLinkSheet, EpubSearchSheet, EpubSettingsSheet, EpubTocSheet } from './EpubSheets'
import {
  FONT_SCALES,
  OVERSCROLL_DRAG,
  classifyGesture,
  nearestFontScale,
  pagedCss,
  readingFlow,
  resolveReadingTheme,
  scrollCss,
  sideStep,
  swipeStep,
  tapZone,
  turnWithin,
  type GestureSample,
  type ReadingTheme,
} from './epubView'
import { routeBookLink } from './links'
import { buildTextIndex, rangeOf, type BookSearchHit } from './search'

export { createEpubReader }

export const EPUB_REFUSAL_TEXT: Record<EpubRefusalReason, MobileStringKey> = {
  damaged: 'readersErrEpubDamaged',
  'too-large': 'readersErrEpubTooLarge',
  'not-epub': 'readersErrEpubNotEpub',
  drm: 'readersErrEpubDrm',
}

export interface EpubWorkspaceProps extends EditorWorkspaceProps {
  readonly reader: EpubReader
  /** when the document started opening (Date.now()) */
  readonly since: number
}

const noop = () => {}

/** The stage size where nothing is laid out (tests): a phone screen. */
const FALLBACK_STAGE: Size = { width: 390, height: 640 }

/** Wheel travel that turns one page in the paged mode, and the pause before the next turn. */
const WHEEL_TURN = 60
const WHEEL_REST_MS = 280
/** Mouse events this soon after a touch are the touch's compatibility events. */
const TOUCH_MOUSE_MS = 800

const XLINK_NS = 'http://www.w3.org/1999/xlink'

/** The `href` as written (no `<base>` in the copy: never the resolved property). */
function linkHref(anchor: Element): string | null {
  return anchor.getAttribute('href') ?? anchor.getAttributeNS(XLINK_NS, 'href')
}

type Target =
  | { kind: 'start' }
  | { kind: 'end' }
  | { kind: 'block'; id: string }
  | { kind: 'fragment'; id: string }
  | { kind: 'hit'; start: number; length: number }
  | { kind: 'view'; view: number }

type LaidMode = 'paged' | 'scroll' | 'fixed'

interface Shown {
  chapter: LoadedChapter
  /** remounts the frame for every chapter drawn */
  key: number
}

interface Layout {
  pages: number
  views: number
  view: number
}

interface HighlightWindow {
  Highlight?: new (...ranges: Range[]) => unknown
  CSS?: { highlights?: Map<string, unknown> }
}

function measure(el: HTMLElement | null): Size {
  const width = el?.clientWidth ?? 0
  const height = el?.clientHeight ?? 0
  return width > 0 && height > 0 ? { width, height } : FALLBACK_STAGE
}

/** The screen pages are laid out on: even widths, so two pages side by side are whole pixels. */
function screenOf(stage: Size): Size {
  return { width: Math.max(2, Math.floor(stage.width / 2) * 2), height: Math.floor(stage.height) }
}

function scroller(doc: Document): Element {
  return doc.scrollingElement ?? doc.documentElement
}

function hasSelection(doc: Document): boolean {
  const selection = doc.getSelection()
  return !!selection && !selection.isCollapsed && selection.toString() !== ''
}

/** Marks a search hit without touching the chapter's DOM: a custom highlight, else the selection. */
function markHit(doc: Document, start: number, length: number): Range | null {
  if (!doc.body) return null
  const range = rangeOf(doc, buildTextIndex(doc.body), start, length)
  if (!range) return null
  const win = doc.defaultView as (Window & HighlightWindow) | null
  const highlights = win?.CSS?.highlights
  if (win?.Highlight && highlights) {
    highlights.set(FIND_HIGHLIGHT, new win.Highlight(range))
  } else {
    const selection = doc.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }
  return range
}

/** The first box of an element or range; a range without boxes of its own (some engines) is measured by its element. */
function boxOf(item: Element | Range): { left: number; right: number; top: number } {
  const measured =
    typeof item.getClientRects === 'function'
      ? item
      : ((item as Range).startContainer?.parentElement ?? null)
  if (!measured) return { left: 0, right: 0, top: 0 }
  return measured.getClientRects()[0] ?? measured.getBoundingClientRect()
}

const darkQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null

function subscribeSystemDark(listener: () => void): () => void {
  const query = darkQuery()
  query?.addEventListener?.('change', listener)
  return () => query?.removeEventListener?.('change', listener)
}

function useSystemDark(): boolean {
  return useSyncExternalStore(
    subscribeSystemDark,
    () => darkQuery()?.matches ?? false,
    () => false,
  )
}

export function EpubWorkspace(props: EpubWorkspaceProps) {
  const { frame, lang, reader, since } = props
  const state = useSyncExternalStore(reader.subscribe, reader.getState)
  const reading = state.status === 'ready' && reader.book !== null
  useReaderKeepScreenOn(reader.client, reading)

  useEffect(() => {
    if (state.status !== 'refused' || reader.refusalShown) return
    reader.refusalShown = true
    reader.host.showToast(reader.host.translate(EPUB_REFUSAL_TEXT[state.reason ?? 'damaged']))
    frame.onBack()
  }, [state.status, state.reason, reader, frame])

  if (reading) return <ReadingScreen {...props} />
  return (
    <EditorShell {...frame} quickActions={[]} viewTools={[]} onFitToWidth={noop}>
      {state.status === 'opening' && (
        <EpubOpening since={since} label={translateMobile(lang, 'readersOpening')} />
      )}
    </EditorShell>
  )
}

type SheetName = 'toc' | 'search' | 'settings'

function ReadingScreen({ frame, lang, theme, reader }: EpubWorkspaceProps) {
  const book = reader.book!
  const facts = book.facts
  const state = useSyncExternalStore(reader.subscribe, reader.getState)
  const settings = state.settings
  const t = (key: MobileStringKey, params?: Params) => translateMobile(lang, key, params)
  const systemDark = useSystemDark()
  const readingTheme: ReadingTheme = resolveReadingTheme(settings.theme, theme, systemDark)

  const [sheet, setSheet] = useState<SheetName | null>(null)
  const [linkUrl, setLinkUrl] = useState<string | null>(null)
  const [lineHidden, setLineHidden] = useState(false)
  const [stage, setStage] = useState<Size>(FALLBACK_STAGE)
  const [flow, setFlow] = useState<PageFlow>(() => readingFlow(facts))
  const [shown, setShown] = useState<Shown | null>(null)
  const [failed, setFailed] = useState<number | null>(null)
  const [layout, setLayout] = useState<Layout>({ pages: 1, views: 1, view: 0 })
  const [progress, setProgress] = useState(0)
  const [fixedPinchZoom, setFixedPinchZoom] = useState(1)

  const stageRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const docRef = useRef<Document | null>(null)
  const pinchDisposeRef = useRef<(() => void) | null>(null)
  const fixedPinchZoomRef = useRef(fixedPinchZoom)
  fixedPinchZoomRef.current = fixedPinchZoom
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const themeRef = useRef(readingTheme)
  themeRef.current = readingTheme
  const stageSizeRef = useRef(stage)
  stageSizeRef.current = stage
  const flowRef = useRef(flow)
  const shownRef = useRef<Shown | null>(null)
  const failedRef = useRef<number | null>(null)
  const layoutRef = useRef(layout)
  const laidModeRef = useRef<LaidMode>('paged')
  const targetRef = useRef<Target>({ kind: 'start' })
  /** how far the body is shifted to show the current view */
  const offsetRef = useRef({ left: 0, top: 0 })
  const tokenRef = useRef(0)
  const loadingRef = useRef(false)
  const overscrollRef = useRef<OverscrollState>(OVERSCROLL_IDLE)
  const wheelRef = useRef({ sum: 0, at: 0, turned: 0 })
  const timersRef = useRef<{ relayout: number | null; scroll: number | null }>({
    relayout: null,
    scroll: null,
  })
  const blockingRef = useRef(false)
  blockingRef.current = sheet !== null || linkUrl !== null

  const screen = screenOf(stage)
  const geom = pageGeometry(screen, flow.axis)

  // ---- geometry and CSS (handlers run between renders: everything from refs) ----

  const currentGeometry = (): PageGeometry =>
    pageGeometry(screenOf(stageSizeRef.current), flowRef.current.axis)

  const modeFor = (fixed: Size | null): LaidMode =>
    fixed ? 'fixed' : settingsRef.current.layout === 'scroll' ? 'scroll' : 'paged'

  const cssFor = (fixed: Size | null, g: PageGeometry): string => {
    const mode = modeFor(fixed)
    if (fixed) return fixedPageCss(fixed)
    if (mode === 'scroll') return scrollCss(settingsRef.current, themeRef.current, frameColors())
    return pagedCss(g, settingsRef.current, themeRef.current, frameColors())
  }

  const spineNow = (): number =>
    shownRef.current?.chapter.view.spineIndex ?? failedRef.current ?? reader.place.spineIndex

  const setLayoutNow = (next: Layout) => {
    layoutRef.current = next
    setLayout(next)
  }

  /** Shifts the body so view `view` shows (the frame itself never scrolls in this mode). */
  const showView = (view: number) => {
    const doc = docRef.current
    if (!doc) return
    const at = viewOffset(currentGeometry(), flowRef.current, view)
    offsetRef.current = at
    const shift = at.left === 0 && at.top === 0 ? 'none' : `translate(${-at.left}px, ${-at.top}px)`
    doc.body?.style.setProperty('transform', shift, 'important')
  }

  const pageOf = (item: Element | Range): number =>
    pageOfBox(currentGeometry(), flowRef.current, boxOf(item), offsetRef.current)

  /** The first block on screen (or running into it from the page before). */
  const blockInView = (): string | null => {
    const doc = docRef.current
    if (!doc) return null
    if (laidModeRef.current !== 'paged') return topBlockId(doc)
    const g = currentGeometry()
    const first = layoutRef.current.view * g.columns
    let last: string | null = null
    for (const el of Array.from(doc.querySelectorAll(`[${BLOCK_ATTR}]`))) {
      const page = pageOf(el)
      if (page > first + g.columns - 1) break
      last = el.getAttribute(BLOCK_ATTR)
      if (page >= first) return last
    }
    return last
  }

  const recordNow = () => {
    if (!shownRef.current) return
    reader.record({ spineIndex: spineNow(), blockId: blockInView() })
  }

  const updateProgress = () => {
    const doc = docRef.current
    if (!doc) return
    const el = scroller(doc)
    const max = el.scrollHeight - el.clientHeight
    setProgress(max <= 0 ? 100 : Math.min(100, Math.max(0, Math.round((el.scrollTop / max) * 100))))
  }

  /** Counts the pages (or scrolls) and puts the reader at `target`. */
  const lay = (target: Target) => {
    const doc = docRef.current
    const current = shownRef.current
    if (!doc || !current) return
    clearHit(doc)
    const hit = target.kind === 'hit' ? markHit(doc, target.start, target.length) : null
    const mode = modeFor(current.chapter.fixed)
    laidModeRef.current = mode
    if (mode === 'fixed') {
      setLayoutNow({ pages: 1, views: 1, view: 0 })
      recordNow()
      return
    }
    const el = scroller(doc)
    if (mode === 'scroll') {
      doc.body?.style.removeProperty('transform')
      offsetRef.current = { left: 0, top: 0 }
      if (target.kind === 'start') el.scrollTop = 0
      else if (target.kind === 'end') el.scrollTop = el.scrollHeight
      else if (target.kind === 'block' || target.kind === 'fragment') {
        const found =
          target.kind === 'block' ? blockElement(doc, target.id) : fragmentElement(doc, target.id)
        if (found) el.scrollTop += found.getBoundingClientRect().top
        else el.scrollTop = 0
      } else if (hit) {
        el.scrollTop += boxOf(hit).top - el.clientHeight / 3
      }
      setLayoutNow({ pages: 1, views: 1, view: 0 })
      updateProgress()
      recordNow()
      return
    }
    const g = currentGeometry()
    // counted unshifted (a shift changes the scroll range), so places are measured the same way
    showView(0)
    el.scrollLeft = 0
    el.scrollTop = 0
    const pages = pageCount(g, { scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight })
    const views = viewCount(g, pages)
    let view = 0
    if (target.kind === 'end') view = views - 1
    else if (target.kind === 'view') view = target.view
    else if (target.kind === 'block' || target.kind === 'fragment') {
      const found =
        target.kind === 'block' ? blockElement(doc, target.id) : fragmentElement(doc, target.id)
      if (found) view = viewOfPage(g, pageOf(found))
    } else if (hit) view = viewOfPage(g, pageOf(hit))
    view = Math.min(Math.max(0, view), views - 1)
    setLayoutNow({ pages, views, view })
    showView(view)
    recordNow()
  }

  /** Lays the chapter out again where the reader is (settings, screen size, pictures arrived). */
  const relayout = () => {
    const doc = docRef.current
    const current = shownRef.current
    if (!doc || !current) return
    const anchor = blockInView()
    applyViewCss(doc, cssFor(current.chapter.fixed, currentGeometry()))
    lay(anchor ? { kind: 'block', id: anchor } : { kind: 'view', view: layoutRef.current.view })
  }

  // ---- chapters ----

  const load = async (spineIndex: number, target: Target) => {
    const token = ++tokenRef.current
    loadingRef.current = true
    let chapter: LoadedChapter | null = null
    let error = false
    try {
      chapter = await reader.loadChapter(spineIndex, (fixed) => cssFor(fixed, currentGeometry()))
    } catch {
      error = true
    }
    if (token !== tokenRef.current) {
      chapter?.view.release()
      return
    }
    loadingRef.current = false
    if (!chapter) {
      if (!error) return
      docRef.current = null
      shownRef.current = null
      setShown(null)
      reader.clearShown()
      failedRef.current = spineIndex
      setFailed(spineIndex)
      reader.record({ spineIndex, blockId: null })
      return
    }
    targetRef.current = target
    docRef.current = null
    failedRef.current = null
    setFailed(null)
    const next = { chapter, key: token }
    shownRef.current = next
    reader.showChapter(chapter)
    setShown(next)
    reader.record({ spineIndex, blockId: target.kind === 'block' ? target.id : null })
  }

  const chapterTurn = (from: number, dir: 1 | -1) => {
    const next = nextChapter(book, from, dir)
    if (next !== null) void load(next, { kind: dir > 0 ? 'start' : 'end' })
  }

  const turn = (step: 1 | -1) => {
    if (loadingRef.current) return
    const current = shownRef.current
    if (!current) {
      if (failedRef.current !== null) chapterTurn(failedRef.current, step)
      return
    }
    if (laidModeRef.current === 'scroll') {
      chapterTurn(current.chapter.view.spineIndex, step)
      return
    }
    const result = turnWithin(layoutRef.current.view, layoutRef.current.views, step)
    if (result.kind === 'chapter') {
      chapterTurn(current.chapter.view.spineIndex, result.dir)
      return
    }
    setLayoutNow({ ...layoutRef.current, view: result.view })
    showView(result.view)
    recordNow()
  }

  const goTo = (spineIndex: number, target: Target) => {
    if (shownRef.current?.chapter.view.spineIndex === spineIndex && docRef.current) lay(target)
    else void load(spineIndex, target)
  }

  const onLink = (href: string | null) => {
    const route = routeBookLink(book, spineNow(), href)
    if (route.kind === 'chapter') {
      goTo(
        route.spineIndex,
        route.fragment ? { kind: 'fragment', id: route.fragment } : { kind: 'start' },
      )
    } else if (route.kind === 'outside') {
      setLinkUrl(route.url)
    }
  }

  const frameWidth = (): number =>
    shownRef.current?.chapter.fixed?.width ?? screenOf(stageSizeRef.current).width

  const onGesture = (
    sample: GestureSample,
    x: number,
    edges: { atStart: boolean; atEnd: boolean },
  ) => {
    const doc = docRef.current
    const scrollMode = laidModeRef.current === 'scroll'
    if (
      scrollMode &&
      doc &&
      !sample.onLink &&
      !sample.selectedAfter &&
      Math.abs(sample.dy) > OVERSCROLL_DRAG &&
      Math.abs(sample.dy) > Math.abs(sample.dx)
    ) {
      // pushed on past an edge the chapter had already reached
      const now = frameEdges(doc)
      if (sample.dy < 0 && edges.atEnd && now.atEnd) turn(1)
      else if (sample.dy > 0 && edges.atStart && now.atStart) turn(-1)
      return
    }
    const gesture = classifyGesture(sample)
    if (gesture === 'tap') {
      const zone = tapZone(x, frameWidth())
      if (zone === 'middle') setLineHidden((hidden) => !hidden)
      else if (!scrollMode) turn(sideStep(zone, flowRef.current.rtl))
    } else if (gesture === 'swipe' && !scrollMode) {
      turn(swipeStep(sample.dx, flowRef.current.rtl))
    }
  }

  const onKey = (e: KeyboardEvent) => {
    if (blockingRef.current || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
    const field = (e.target as Element | null)?.closest?.('input, textarea, select, button')
    if (field || laidModeRef.current === 'scroll') return
    const rtl = flowRef.current.rtl
    let step: 1 | -1
    switch (e.key) {
      case 'ArrowRight':
        step = rtl ? -1 : 1
        break
      case 'ArrowLeft':
        step = rtl ? 1 : -1
        break
      case 'PageDown':
      case ' ':
        step = 1
        break
      case 'PageUp':
        step = -1
        break
      default:
        return
    }
    e.preventDefault()
    turn(step)
  }

  const onWheel = (e: WheelEvent) => {
    const doc = docRef.current
    if (!doc) return
    const now = performance.now()
    if (laidModeRef.current === 'scroll') {
      const edges = frameEdges(doc)
      const step = overscroll(overscrollRef.current, {
        deltaY: e.deltaY,
        atStart: edges.atStart,
        atEnd: edges.atEnd,
        time: now,
      })
      overscrollRef.current = step.state
      if (step.turn !== null) turn(step.turn)
      return
    }
    e.preventDefault()
    const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
    const w = wheelRef.current
    if (now - w.at > WHEEL_REST_MS) w.sum = 0
    w.at = now
    if (now - w.turned < WHEEL_REST_MS) return
    w.sum += delta
    if (Math.abs(w.sum) < WHEEL_TURN) return
    const dir = w.sum > 0 ? 1 : -1
    w.sum = 0
    w.turned = now
    turn(dir)
  }

  const onFrameScroll = () => {
    const doc = docRef.current
    if (!doc) return
    if (laidModeRef.current !== 'scroll') {
      // a selection dragged past the page edge must not carry the page away
      const el = scroller(doc)
      if (el.scrollLeft !== 0) el.scrollLeft = 0
      if (el.scrollTop !== 0) el.scrollTop = 0
      return
    }
    const timers = timersRef.current
    if (timers.scroll !== null) return
    timers.scroll = window.setTimeout(() => {
      timers.scroll = null
      updateProgress()
      recordNow()
    }, 150)
  }

  const relayoutSoon = () => {
    const timers = timersRef.current
    if (timers.relayout !== null) window.clearTimeout(timers.relayout)
    timers.relayout = window.setTimeout(() => {
      timers.relayout = null
      apiRef.current.relayout()
    }, 60)
  }

  /** Wires a chapter document: links, touches, keys, wheel, scroll, late resources. */
  const wire = (doc: Document) => {
    const api = () => apiRef.current
    const targetElement = (target: EventTarget | null): Element | null => {
      if (!target) return null
      const node = target as Node
      return node.nodeType === 1 ? (target as Element) : (node.parentElement ?? null)
    }
    const onClick = (e: MouseEvent) => {
      const anchor = targetElement(e.target)?.closest?.('a, area, [href]')
      if (!anchor) return
      e.preventDefault()
      if (e.type === 'click') api().onLink(linkHref(anchor))
    }
    doc.addEventListener('click', onClick, true)
    doc.addEventListener('auxclick', onClick, true)
    doc.addEventListener('submit', (e) => e.preventDefault(), true)
    doc.addEventListener('keydown', (e) => api().onKey(e))
    doc.addEventListener('wheel', (e) => api().onWheel(e), { passive: false })
    doc.addEventListener('scroll', () => api().onFrameScroll(), { passive: true })
    doc.addEventListener('load', () => api().relayoutSoon(), true)
    void doc.fonts?.ready.then(() => api().relayoutSoon())

    let start: {
      x: number
      y: number
      at: number
      selected: boolean
      onLink: boolean
      edges: { atStart: boolean; atEnd: boolean }
    } | null = null
    let lastTouch = 0
    const begin = (x: number, y: number, target: EventTarget | null) => {
      start = {
        x,
        y,
        at: Date.now(),
        selected: hasSelection(doc),
        onLink: !!targetElement(target)?.closest?.('a, area'),
        edges: frameEdges(doc),
      }
    }
    const finish = (x: number, y: number) => {
      const began = start
      start = null
      if (!began) return
      api().onGesture(
        {
          dx: x - began.x,
          dy: y - began.y,
          ms: Date.now() - began.at,
          selectedBefore: began.selected,
          selectedAfter: hasSelection(doc),
          onLink: began.onLink,
        },
        x,
        began.edges,
      )
    }
    doc.addEventListener(
      'touchstart',
      (e) => {
        lastTouch = Date.now()
        const touch = e.touches[0]
        if (e.touches.length !== 1 || !touch) start = null
        else begin(touch.clientX, touch.clientY, e.target)
      },
      { passive: true },
    )
    doc.addEventListener(
      'touchmove',
      (e) => {
        // two fingers: zooming, not a turn
        if (e.touches.length > 1) start = null
      },
      { passive: true },
    )
    doc.addEventListener('touchend', (e) => {
      lastTouch = Date.now()
      const touch = e.changedTouches[0]
      if (touch) finish(touch.clientX, touch.clientY)
    })
    doc.addEventListener('touchcancel', () => {
      start = null
    })
    doc.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || Date.now() - lastTouch < TOUCH_MOUSE_MS) return
      begin(e.clientX, e.clientY, e.target)
    })
    doc.addEventListener('mouseup', (e) => {
      if (e.button !== 0 || Date.now() - lastTouch < TOUCH_MOUSE_MS) return
      finish(e.clientX, e.clientY)
    })

    // Two-finger pinch adjusts font size on reflowable chapters, or zooms fixed-layout pages.
    pinchDisposeRef.current?.()
    const isFixed = shownRef.current?.chapter.fixed !== null
    const minFont = FONT_SCALES[0]!
    const maxFont = FONT_SCALES[FONT_SCALES.length - 1]!
    const applyReflowScale = (scale: number) => {
      const snapped = nearestFontScale(scale)
      if (snapped !== settingsRef.current.fontScale) {
        reader.updateSettings({ fontScale: snapped })
      }
    }
    pinchDisposeRef.current = attachPinchZoom(doc, {
      getScale: () => (isFixed ? fixedPinchZoomRef.current : settingsRef.current.fontScale),
      min: isFixed ? 1 : minFont,
      max: isFixed ? 4 : maxFont,
      onPreview: (scale) => {
        if (isFixed) {
          setFixedPinchZoom(scale)
        } else {
          applyReflowScale(scale)
        }
      },
      onCommit: (scale) => {
        if (isFixed) {
          setFixedPinchZoom(scale)
        } else {
          applyReflowScale(scale)
        }
      },
    })
  }

  const onFrameLoad = () => {
    const frameEl = frameRef.current
    const current = shownRef.current
    const doc = frameEl?.contentDocument
    // the first, empty document of a new frame carries no view style
    if (!doc || !current || !doc.getElementById(VIEW_STYLE_ID) || docRef.current === doc) return
    docRef.current = doc
    wire(doc)
    const style = doc.body ? doc.defaultView?.getComputedStyle(doc.body) : null
    const found = readingFlow(
      facts,
      style && style.writingMode
        ? { writingMode: style.writingMode, direction: style.direction ?? '' }
        : null,
    )
    const before = flowRef.current
    flowRef.current = found
    if (found.axis !== before.axis || found.rtl !== before.rtl) setFlow(found)
    // a chapter kept from before (the screen was away) may carry older settings
    applyViewCss(doc, cssFor(current.chapter.fixed, currentGeometry()))
    lay(targetRef.current)
  }

  const apiRef = useRef({
    relayout,
    relayoutSoon,
    onLink,
    onKey,
    onWheel,
    onFrameScroll,
    onGesture,
    onFrameLoad,
  })
  apiRef.current = {
    relayout,
    relayoutSoon,
    onLink,
    onKey,
    onWheel,
    onFrameScroll,
    onGesture,
    onFrameLoad,
  }

  const apiLoad = useRef(load)
  apiLoad.current = load

  // the place the document is at: the chapter kept on screen, else drawn now
  useEffect(() => {
    const place = reader.place
    const target: Target = place.blockId ? { kind: 'block', id: place.blockId } : { kind: 'start' }
    const kept = reader.shown
    if (kept && kept.view.spineIndex === place.spineIndex) {
      const next = { chapter: kept, key: ++tokenRef.current }
      targetRef.current = target
      shownRef.current = next
      reader.showChapter(kept)
      setShown(next)
    } else {
      void apiLoad.current(place.spineIndex, target)
    }
    const timers = timersRef.current
    const tokens = tokenRef
    return () => {
      // a chapter still being drawn for this screen is dropped
      tokens.current++
      if (timers.relayout !== null) window.clearTimeout(timers.relayout)
      if (timers.scroll !== null) window.clearTimeout(timers.scroll)
      timers.relayout = null
      timers.scroll = null
    }
  }, [reader])

  // a new chapter frame: wire it once its document is there
  useEffect(() => {
    setFixedPinchZoom(1)
    const frameEl = frameRef.current
    if (!frameEl || !shown) return
    const handler = () => apiRef.current.onFrameLoad()
    frameEl.addEventListener('load', handler)
    handler()
    return () => {
      frameEl.removeEventListener('load', handler)
      pinchDisposeRef.current?.()
      pinchDisposeRef.current = null
    }
  }, [shown])

  // the stage's size
  useEffect(() => {
    const el = stageRef.current
    const update = () => setStage(measure(el))
    update()
    window.addEventListener('resize', update)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (el) observer?.observe(el)
    return () => {
      window.removeEventListener('resize', update)
      observer?.disconnect()
    }
  }, [])

  // keys from the page (a keyboard on a tablet or DeX)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => apiRef.current.onKey(e)
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // settings and the screen size lay the chapter out again, keeping the block on screen
  useEffect(() => {
    if (docRef.current) apiRef.current.relayout()
  }, [
    settings.fontScale,
    settings.lineHeight,
    settings.layout,
    readingTheme,
    screen.width,
    screen.height,
    flow.axis,
  ])

  // ---- what is drawn ----

  const spine = shown?.chapter.view.spineIndex ?? failed ?? reader.place.spineIndex
  const fixed = shown?.chapter.fixed ?? null
  const scrollMode = !fixed && settings.layout === 'scroll'
  const where = fixed
    ? t('readersPosition', { current: spine + 1, total: facts.chapterCount })
    : scrollMode
      ? t('readersEpubChapterProgress', { percent: progress })
      : t('readersPosition', {
          current: Math.min(layout.view * geom.columns + 1, layout.pages),
          total: layout.pages,
        })
  const chapterName = reader.chapterName(spine)
  const leftStep = sideStep('left', flow.rtl)
  const rightStep = sideStep('right', flow.rtl)
  const stepLabel = (step: 1 | -1) => t(step > 0 ? 'readersA11yNextPage' : 'readersA11yPrevPage')
  const fixedScale = fixed
    ? Math.min(screen.width / fixed.width, screen.height / fixed.height) * fixedPinchZoom
    : 1
  const failedNext = failed !== null ? nextChapter(book, failed, 1) : null

  const viewTools: EditorQuickActionItem[] = [
    {
      id: 'epubToc',
      label: t('readersA11yToc'),
      icon: <IconReaderToc size={19} />,
      onPress: () => setSheet('toc'),
    },
    {
      id: 'epubSearch',
      label: t('readersA11ySearch'),
      icon: <IconReaderSearch size={19} />,
      onPress: () => setSheet('search'),
    },
    {
      id: 'epubSettings',
      label: t('readersA11ySettings'),
      icon: <IconReaderSettings size={19} />,
      onPress: () => setSheet('settings'),
    },
  ]

  const closeSheet = () => setSheet(null)

  return (
    <EditorShell
      {...frame}
      docTitle={facts.title.trim() || frame.docTitle}
      quickActions={[]}
      viewTools={viewTools}
      moreItems={[]}
      onFitToWidth={noop}
    >
      <div
        className="epub-reader"
        data-theme={readingTheme}
        data-mode={fixed ? 'fixed' : settings.layout}
        data-testid="epub-reader"
      >
        <div ref={stageRef} className="epub-reader-stage" data-theme={readingTheme}>
          {shown ? (
            <iframe
              key={shown.key}
              ref={frameRef}
              className="epub-reader-frame"
              title={chapterName}
              sandbox="allow-same-origin"
              srcDoc={shown.chapter.view.html}
              data-fixed={fixed ? 'true' : undefined}
              style={
                fixed
                  ? {
                      width: fixed.width,
                      height: fixed.height,
                      transform: `translate(-50%, -50%) scale(${fixedScale})`,
                    }
                  : { width: screen.width, height: screen.height }
              }
              data-testid="epub-chapter-frame"
            />
          ) : failed !== null ? (
            <div className="epub-reader-failed" role="alert" data-testid="epub-chapter-failed">
              <p>{t('readersEpubChapterFailed')}</p>
              {failedNext !== null && (
                <button
                  type="button"
                  className="mobile-touch-btn mobile-btn-secondary"
                  onClick={() => void load(failedNext, { kind: 'start' })}
                  data-testid="epub-next-chapter"
                >
                  {t('readersEpubNextChapter')}
                </button>
              )}
            </div>
          ) : null}
        </div>
        <div
          className="epub-reader-line"
          data-hidden={lineHidden ? 'true' : undefined}
          data-testid="epub-position-line"
        >
          <button
            type="button"
            className="mobile-icon-btn epub-reader-turn"
            data-side="left"
            aria-label={stepLabel(leftStep)}
            title={stepLabel(leftStep)}
            onClick={() => turn(leftStep)}
            data-testid="epub-turn-left"
          >
            <IconChevronRight size={20} />
          </button>
          <span className="epub-reader-chapter" data-testid="epub-chapter-name">
            {chapterName}
          </span>
          <span className="epub-reader-where" aria-live="polite" data-testid="epub-where">
            {where}
          </span>
          <button
            type="button"
            className="mobile-icon-btn epub-reader-turn"
            data-side="right"
            aria-label={stepLabel(rightStep)}
            title={stepLabel(rightStep)}
            onClick={() => turn(rightStep)}
            data-testid="epub-turn-right"
          >
            <IconChevronRight size={20} />
          </button>
        </div>
      </div>

      <EpubTocSheet
        open={sheet === 'toc'}
        entries={reader.tocEntries}
        currentIndex={reader.currentTocIndex(spine)}
        onPick={(entry) => {
          if (entry.spineIndex === null) return
          closeSheet()
          goTo(
            entry.spineIndex,
            entry.fragment ? { kind: 'fragment', id: entry.fragment } : { kind: 'start' },
          )
        }}
        onClose={closeSheet}
        t={t}
      />
      <EpubSearchSheet
        open={sheet === 'search'}
        search={state.search}
        onQuery={(query) => reader.search(query)}
        onPick={(hit: BookSearchHit) => {
          closeSheet()
          goTo(hit.spineIndex, { kind: 'hit', start: hit.start, length: hit.length })
        }}
        chapterName={(index) => reader.chapterName(index)}
        onClose={closeSheet}
        t={t}
      />
      <EpubSettingsSheet
        open={sheet === 'settings'}
        settings={settings}
        fixedLayout={facts.fixedLayout || fixed !== null}
        onChange={(patch) => reader.updateSettings(patch)}
        onClose={closeSheet}
        t={t}
      />
      <EpubLinkSheet
        url={linkUrl}
        client={reader.client}
        showToast={reader.host.showToast}
        onClose={() => setLinkUrl(null)}
        t={t}
      />
    </EditorShell>
  )
}
