/**
 * Interactive whiteboard canvas editor inspired by Miro, Allo, and Claude Artifacts:
 * - Refined workspace chrome (clean header, left miniature page rail, floating vertical
 *   icon tool rail, bottom-left undo/zoom capsules, dark floating contextual format bar)
 * - Modern tactile canvas objects:
 *   - Warm ivory paper (#FFFDF8) with crisp subtle 24px dot matrix on freeform pages
 *   - Miro/Allo tactile sticky notes (curved paper-lift shadow, top sheen, hairline rim,
 *     luminous pastel palette, centered medium typography, instant typing on placement)
 *   - Clean editorial typography text objects with CJK/Latin auto-sizing, seamless transparent
 *     inline editing, size stepper, and optional pill/card background fills
 *   - Harmonized diagram shapes (clean white/tinted cards, soft elevation, rounded corners)
 *   - Straight, smooth curved (cubic Bezier), and rounded-elbow connectors with sleek open
 *     chevron, stealth dart, and ringed-dot arrowheads, snap ports, quick-connect dots,
 *     and midpoint pill label editing
 *   - Clipped rounded tables, clean link cards, die-cut stickers, and multiply highlighters
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import {
  computeStrokeOutline,
  type BoardObject,
  type ConnectorEnd,
  type ConnectorHead,
  type ConnectorProps,
  type ConnectorRouting,
  type ImageProps,
  type LineStyle,
  type LinkProps,
  type Page,
  type PageFormat,
  type Point,
  type RichText,
  type ShapeKind,
  type ShapeProps,
  type StickerProps,
  type StickyProps,
  type StrokeProps,
  type TableProps,
  type TextAlign,
  type TextProps,
} from '@genoffice/whiteboard-engine'
import { openableLink } from '../../shared/links'
import type { ExportFormat } from '../../shared/ipc'
import {
  BOARD_FONT_STACK,
  computeConnectorGeometry,
  CONNECTOR_WIDTH_PRESETS,
  estimateTextBoxSize,
  findAttachTarget,
  FONT_SIZE_PRESETS,
  HIGHLIGHTER_SWATCHES,
  HIGHLIGHTER_WIDTH_PRESETS,
  LINE_WIDTH_PRESETS,
  livePaperColor,
  PAPER_COLORS,
  PAPER_FILL_SWATCHES,
  PAPER_INK_SWATCHES,
  plainRichText,
  resolveConnectorEnd,
  resolveConnectorEndpoint,
  richTextFormatState,
  setRichTextColor,
  SHAPE_DEFAULT_FONT_SIZE,
  SHAPE_STYLE_PRESETS,
  SIDE_ANCHORS,
  STICKY_DEFAULT_FONT_SIZE,
  STICKY_DEFAULT_SIZE,
  stickyLiftShadowPath,
  strokeLineAttrs,
  TEXT_BG_PRESETS,
  TEXT_DEFAULT_FONT_SIZE,
  toggleRichTextMark,
  typographyMetrics,
  updateRichTextPreservingStyle,
  type ConnectorHeadShape,
  type RichMark,
  type SnapAttachTarget,
} from '../canvas/paper-style'
import {
  computeAlignUpdates,
  computeDistributeUpdates,
  computeGroupResize,
  computeRotationDegrees,
  computeSingleResize,
  computeSnapGuides,
  expandGroupSelection,
  isObjectLocked,
  normalizeRect,
  objectBounds,
  objectHitsPoint,
  objectIntersectsRect,
  searchBoardObjects,
  selectionBounds,
  type AlignDirection,
  type DistributeAxis,
  type Rect,
  type ResizeHandle,
  type SnapGuide,
} from '../canvas/geometry'
import {
  QuickPrintButton,
  shortcutLetterOf,
  type PrintPrinterInfo,
  type QuickPrintPrefStore,
} from '@genoffice/ui'
import { buildBuiltinTemplate, type BuiltinTemplateId } from '../canvas/templates'
import { SHAPE_KINDS, shapePath, shapeTextBox } from '../canvas/shape-paths'
import {
  isSpacePanKey,
  whiteboardHistoryShortcut,
  whiteboardToolShortcut,
} from '../canvas/shortcuts'
import { STICKER_IDS, StickerIcon } from '../canvas/stickers'
import type { WhiteboardSession } from '../document/session'
import {
  inspectPdfBytes,
  MAX_PDF_IMPORT_PAGES,
  parsePdfPageRange,
  renderPdfPagesToPng,
} from '../export/pdf-import'
import { renderPageToSvg, richTextPlain } from '../export/render-svg'
import { t as tGlobal, useI18n } from '../i18n/locale'
import { ContextMenu } from './ContextMenu'
import { Minimap } from './Minimap'
import { SearchBar } from './SearchBar'
import { TemplateModal } from './TemplateModal'
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignObjBottomIcon,
  AlignObjCenterHIcon,
  AlignObjLeftIcon,
  AlignObjMiddleVIcon,
  AlignObjRightIcon,
  AlignObjTopIcon,
  AlignRightIcon,
  ArrowEndIcon,
  ArrowStartIcon,
  BackIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleEndIcon,
  CircleStartIcon,
  ConnectorIcon,
  CopyIcon,
  CurvedRouteIcon,
  DashedLineIcon,
  DistributeHIcon,
  DistributeVIcon,
  DottedLineIcon,
  DuplicateIcon,
  ElbowRouteIcon,
  EraserIcon,
  ExportIcon,
  FitIcon,
  FrontIcon,
  GridBlankIcon,
  GridDotIcon,
  GridLineIcon,
  GroupIcon,
  HandIcon,
  HighlighterIcon,
  ImageIcon,
  LineEndIcon,
  LinkIcon,
  LockIcon,
  MinimapIcon,
  MinusIcon,
  PdfIcon,
  PenIcon,
  PlusIcon,
  PresentIcon,
  RedoIcon,
  SearchIcon,
  SelectIcon,
  ShapeIcon,
  ShapeKindGlyph,
  SolidLineIcon,
  StealthEndIcon,
  StealthStartIcon,
  StickerToolIcon,
  StickyIcon,
  StraightRouteIcon,
  TableIcon,
  TemplateIcon,
  TextBgIcon,
  TextIcon,
  TrashIcon,
  UndoIcon,
  UngroupIcon,
  UnlockIcon,
} from './icons'

type ToolKind =
  'select' | 'hand' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'highlighter' | 'eraser'

type GridMode = 'dot' | 'line' | 'blank'

const LINK_PREVIEW_PREF = 'whiteboardapp.linkPreview'
const IMAGE_DROP_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])
const TOOLBAR_LEFT_CLEARANCE = 92
const THUMB_W = 136
const THUMB_H = 78

function fileExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function pageGridMode(page: Page | undefined): GridMode {
  if (!page) return 'dot'
  if (page.background.kind === 'grid') {
    return page.background.pattern === 'line' ? 'line' : 'dot'
  }
  if (page.background.kind === 'solid') {
    return page.gridHidden === true ? 'blank' : page.format === 'freeform' ? 'dot' : 'blank'
  }
  return 'blank'
}

function nextGridMode(current: GridMode): GridMode {
  if (current === 'dot') return 'line'
  if (current === 'line') return 'blank'
  return 'dot'
}

const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
}

function boxResizeHandles(
  b: Rect,
): Array<{ handle: ResizeHandle; x: number; y: number; corner: boolean }> {
  return [
    { handle: 'nw', x: b.x, y: b.y, corner: true },
    { handle: 'n', x: b.x + b.width / 2, y: b.y, corner: false },
    { handle: 'ne', x: b.x + b.width, y: b.y, corner: true },
    { handle: 'e', x: b.x + b.width, y: b.y + b.height / 2, corner: false },
    { handle: 'se', x: b.x + b.width, y: b.y + b.height, corner: true },
    { handle: 's', x: b.x + b.width / 2, y: b.y + b.height, corner: false },
    { handle: 'sw', x: b.x, y: b.y + b.height, corner: true },
    { handle: 'w', x: b.x, y: b.y + b.height / 2, corner: false },
  ]
}

function thumbnailSwatch(obj: BoardObject): string {
  if (obj.kind === 'sticky') {
    const c = (obj.props as unknown as StickyProps).color
    return c || PAPER_FILL_SWATCHES[0]
  }
  if (obj.kind === 'shape') {
    const f = (obj.props as unknown as ShapeProps).fill
    return f && f !== 'transparent' ? f : PAPER_COLORS.zoneFill
  }
  if (obj.kind === 'stroke') {
    return (obj.props as unknown as StrokeProps).color || PAPER_COLORS.ink
  }
  if (obj.kind === 'connector') {
    return (obj.props as unknown as ConnectorProps).color || PAPER_COLORS.inkMuted
  }
  if (obj.kind === 'link') return '#F1E3D6'
  if (obj.kind === 'table') return '#EAE2D4'
  if (obj.kind === 'sticker') return '#F5C542'
  return PAPER_COLORS.lineStrong
}

const CONNECTOR_HEAD_CYCLE: readonly ConnectorHead[] = ['none', 'arrow', 'triangle', 'circle']
const LINE_STYLE_CYCLE: readonly LineStyle[] = ['solid', 'dashed', 'dotted']

function nextCycleValue<T>(list: readonly T[], current: T): T {
  const idx = list.indexOf(current)
  return list[(idx + 1) % list.length]!
}

function estimateLabelPillWidth(label: string): number {
  let units = 0
  for (const ch of label) {
    const code = ch.codePointAt(0) ?? 0
    const isWide =
      (code >= 0x1100 && code <= 0x11ff) ||
      (code >= 0x3000 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xff00 && code <= 0xffef)
    units += isWide ? 12.5 : 7.5
  }
  return Math.max(44, Math.ceil(units + 20))
}

function renderConnectorHead(
  head: ConnectorHeadShape | null,
  ink: string,
  strokeWidth: number,
  key: string,
): ReactElement | null {
  if (!head) return null
  if (head.kind === 'chevron' && head.path) {
    return (
      <path
        key={key}
        d={head.path}
        fill="none"
        stroke={ink}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    )
  }
  if (head.kind === 'stealth' && head.path) {
    return <path key={key} d={head.path} fill={ink} />
  }
  if (head.kind === 'circle' && head.point) {
    return (
      <circle
        key={key}
        cx={head.point.x}
        cy={head.point.y}
        r={head.radius ?? Math.max(3.6, strokeWidth * 1.65)}
        fill={PAPER_COLORS.paper}
        stroke={ink}
        strokeWidth={Math.max(1.75, strokeWidth)}
      />
    )
  }
  return null
}

function anchorNormalFromTarget(target: SnapAttachTarget | null | undefined): Point | null {
  if (!target) return null
  if (target.anchorY <= 0.05) return { x: 0, y: -1 }
  if (target.anchorY >= 0.95) return { x: 0, y: 1 }
  if (target.anchorX <= 0.05) return { x: -1, y: 0 }
  if (target.anchorX >= 0.95) return { x: 1, y: 0 }
  return null
}

export type WhiteboardEditorMenuAction = 'import-pdf' | 'zoom-in' | 'zoom-out' | 'zoom-fit'

export interface WhiteboardEditorProps {
  session: WhiteboardSession
  saveStatus: 'idle' | 'saving' | 'saved' | 'failed'
  autoSave: boolean
  onToggleAutoSave(): void
  onExport(format: ExportFormat, scope: 'all' | 'current'): void
  onPrint(initialDestination?: string): void
  onQuickPrint(printerLabel: string): void | Promise<void>
  listPrinters?: () => Promise<readonly PrintPrinterInfo[]>
  quickPrintPrefStore?: QuickPrintPrefStore
  exportModalFormat: ExportFormat | null
  onCloseExportModal(): void
  onOpenExportModal(format: ExportFormat): void
  presenting: boolean
  onSetPresenting(v: boolean): void
  onToast(message: string): void
  menuCommand?: { seq: number; cmd: WhiteboardEditorMenuAction } | null
}

export function WhiteboardEditor({
  session,
  saveStatus,
  autoSave,
  onToggleAutoSave,
  onExport,
  onPrint,
  onQuickPrint,
  listPrinters,
  quickPrintPrefStore,
  exportModalFormat,
  onCloseExportModal,
  onOpenExportModal,
  presenting,
  onSetPresenting,
  onToast,
  menuCommand,
}: WhiteboardEditorProps): ReactElement {
  const { t, lang } = useI18n()
  const [, setTick] = useState(0)
  const [tool, setTool] = useState<ToolKind>('select')
  const [spacePanning, setSpacePanning] = useState(false)
  const spacePanningRef = useRef(false)
  const [isPanning, setIsPanning] = useState(false)
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rounded_rectangle')
  const [shapePopoverOpen, setShapePopoverOpen] = useState(false)
  const [activeColor, setActiveColor] = useState<string>(PAPER_FILL_SWATCHES[0])
  const [penColor, setPenColor] = useState<string>(PAPER_COLORS.ink)
  const [highlighterColor, setHighlighterColor] = useState<string>(PAPER_COLORS.highlighterYellow)
  const [highlighterWidth, setHighlighterWidth] = useState<number>(22)
  const [connectorColor, setConnectorColor] = useState<string>(PAPER_COLORS.connectorDefault)
  const [connectorRouting, setConnectorRouting] = useState<ConnectorRouting>('curved')
  const [penWidth, setPenWidth] = useState<number>(4)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 96, y: 48 })
  const [stageSize, setStageSize] = useState({ width: 960, height: 640 })
  const [stickerOpen, setStickerOpen] = useState(false)
  const [alignMenuOpen, setAlignMenuOpen] = useState(false)
  const [templateModalOpen, setTemplateModalOpen] = useState(false)
  const [minimapOpen, setMinimapOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [editingTableCell, setEditingTableCell] = useState<{
    id: string
    row: number
    col: number
    text: string
  } | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [editingTitleText, setEditingTitleText] = useState('')
  const [renamingPageId, setRenamingPageId] = useState<string | null>(null)
  const [renamingPageText, setRenamingPageText] = useState('')
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [connectorHoverObjId, setConnectorHoverObjId] = useState<string | null>(null)
  const [exportScope, setExportScope] = useState<'all' | 'current'>('all')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  // Search state (Ctrl+F).
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchIndex, setSearchIndex] = useState(0)

  // Link card modal state (opt-in preview off by default, remembered per preference).
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkTitle, setLinkTitle] = useState('')
  const [linkFetchPreview, setLinkFetchPreview] = useState(
    () => localStorage.getItem(LINK_PREVIEW_PREF) === '1',
  )
  const [linkBusy, setLinkBusy] = useState(false)

  // PDF import modal state.
  const [pdfPending, setPdfPending] = useState<{
    name: string
    bytes: Uint8Array
    pageCount: number
  } | null>(null)
  const [pdfRange, setPdfRange] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)

  // Internal object clipboard (for Ctrl+C/X/V).
  const clipboardRef = useRef<{ objects: BoardObject[]; pasteCount: number } | null>(null)
  const pendingFitRef = useRef(false)
  const formatBarRef = useRef<HTMLDivElement | null>(null)

  // Active pointer interaction refs.
  const stageRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{
    kind:
      | 'multi-move'
      | 'pan'
      | 'right-pan'
      | 'marquee'
      | 'erase-sweep'
      | 'draw'
      | 'resize'
      | 'group-resize'
      | 'rotate'
      | 'connector-draw'
      | 'endpoint-drag'
    startClientX: number
    startClientY: number
    startPanX: number
    startPanY: number
    didMove?: boolean
    objectId?: string
    origRect?: Rect
    origMap?: Map<string, Rect>
    origBounds?: Rect
    otherRects?: Rect[]
    cloneSourceIds?: string[]
    isClone?: boolean
    handle?: ResizeHandle
    center?: Point
    points?: Array<[number, number, number]>
    startPoint?: Point
    additive?: boolean
    baseSelection?: string[]
    eraseSet?: Set<string>
    startAttach?: SnapAttachTarget | null
    whichEnd?: 'start' | 'end'
  } | null>(null)

  const [liveStroke, setLiveStroke] = useState<Array<[number, number, number]> | null>(null)
  const [liveConnector, setLiveConnector] = useState<{
    start: Point
    end: Point
    startTargetId: string | null
    endTargetId: string | null
    startNormal: Point | null
    endNormal: Point | null
    routing: ConnectorRouting
  } | null>(null)
  const [endpointPreview, setEndpointPreview] = useState<{
    id: string
    which: 'start' | 'end'
    end: ConnectorEnd
    targetId: string | null
  } | null>(null)
  const [marqueeRect, setMarqueeRect] = useState<Rect | null>(null)
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([])
  const [multiMoveDelta, setMultiMoveDelta] = useState<{
    ids: ReadonlySet<string>
    dx: number
    dy: number
    isClone: boolean
  } | null>(null)
  const [resizePreview, setResizePreview] = useState<ReadonlyMap<string, Rect> | null>(null)
  const [rotatePreview, setRotatePreview] = useState<{
    id: string
    angle: number
    clientX: number
    clientY: number
  } | null>(null)
  const [erasingIds, setErasingIds] = useState<ReadonlySet<string> | null>(null)

  useEffect(() => session.subscribe(() => setTick((n) => n + 1)), [session])

  // Track stage container size for minimap, format bar clamping, and viewport-centered inserts.
  useEffect(() => {
    const el = stageRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => {
      setStageSize({ width: el.clientWidth || 960, height: el.clientHeight || 640 })
    }
    update()
    const obs = new ResizeObserver(update)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const doc = session.getDocument()
  const activePage = session.getActivePage()
  const activePageId = activePage?.id ?? ''
  const selectedIds = session.getSelection()
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const highlights = session.getHighlights()
  const highlightSet = useMemo(() => new Set(highlights), [highlights])
  const importSummary = session.getImportSummary()

  const pageObjects = useMemo(
    () =>
      doc.objects
        .filter((o) => o.pageId === activePageId)
        .sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0)),
    [doc, activePageId],
  )

  // Apply in-flight move/resize/rotate deltas so attached connectors follow objects live during drag.
  const displayedObjects = useMemo(() => {
    if (!multiMoveDelta && !resizePreview && !rotatePreview && !endpointPreview) return pageObjects
    return pageObjects.map((o) => {
      if (multiMoveDelta && !multiMoveDelta.isClone && multiMoveDelta.ids.has(o.id)) {
        if (o.kind === 'connector') {
          const cp = o.props as unknown as ConnectorProps
          const shiftEnd = (end: ConnectorEnd): ConnectorEnd =>
            'objectId' in end ? end : { x: end.x + multiMoveDelta.dx, y: end.y + multiMoveDelta.dy }
          return {
            ...o,
            props: {
              ...o.props,
              start: shiftEnd(cp.start),
              end: shiftEnd(cp.end),
              ...(cp.waypoints
                ? {
                    waypoints: cp.waypoints.map((pt) => ({
                      x: pt.x + multiMoveDelta.dx,
                      y: pt.y + multiMoveDelta.dy,
                    })),
                  }
                : {}),
            },
          }
        }
        return {
          ...o,
          x: o.x + multiMoveDelta.dx,
          y: o.y + multiMoveDelta.dy,
        }
      }
      if (resizePreview) {
        const nextRect = resizePreview.get(o.id)
        if (nextRect) {
          return {
            ...o,
            x: nextRect.x,
            y: nextRect.y,
            width: Math.max(24, nextRect.width),
            height: Math.max(20, nextRect.height),
          }
        }
      }
      if (rotatePreview && rotatePreview.id === o.id) {
        return { ...o, rotation: rotatePreview.angle }
      }
      if (endpointPreview && endpointPreview.id === o.id && o.kind === 'connector') {
        return {
          ...o,
          props: {
            ...o.props,
            [endpointPreview.which]: endpointPreview.end,
          },
        }
      }
      return o
    })
  }, [endpointPreview, multiMoveDelta, pageObjects, resizePreview, rotatePreview])

  const objectsById = useMemo(
    () => new Map(displayedObjects.map((o) => [o.id, o])),
    [displayedObjects],
  )

  const selectedObjs = useMemo(
    () => displayedObjects.filter((o) => selectedIdSet.has(o.id)),
    [displayedObjects, selectedIdSet],
  )
  const selectedObj = selectedObjs.length === 1 ? selectedObjs[0]! : null
  const multiSelected = selectedObjs.length >= 2
  const allSelectedLocked = selectedObjs.length > 0 && selectedObjs.every(isObjectLocked)
  const hasUnlockedSelection = selectedObjs.some((o) => !isObjectLocked(o))
  const canGroupSelection = selectedObjs.length >= 2
  const canUngroupSelection = selectedObjs.some((o) => Boolean(o.groupId))

  const multiSelectionBox = useMemo(() => {
    if (!multiSelected) return null
    return selectionBounds(selectedObjs, objectsById)
  }, [multiSelected, objectsById, selectedObjs])

  // Search hits across the document.
  const searchHits = useMemo(
    () => (searchOpen ? searchBoardObjects(doc, searchQuery, activePageId) : []),
    [activePageId, doc, searchOpen, searchQuery],
  )
  const clampedSearchIndex =
    searchHits.length > 0
      ? ((searchIndex % searchHits.length) + searchHits.length) % searchHits.length
      : 0
  const searchHitIdSet = useMemo(() => new Set(searchHits.map((h) => h.objectId)), [searchHits])

  const clientToBoard = useCallback(
    (clientX: number, clientY: number) => {
      const rect = stageRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return {
        x: (clientX - rect.left - pan.x) / zoom,
        y: (clientY - rect.top - pan.y) / zoom,
      }
    },
    [pan.x, pan.y, zoom],
  )

  const viewportBoardCenter = useCallback((): Point => {
    return {
      x: Math.round((stageSize.width / 2 - pan.x) / zoom),
      y: Math.round((stageSize.height / 2 - pan.y) / zoom),
    }
  }, [pan.x, pan.y, stageSize.height, stageSize.width, zoom])

  const zoomAroundScreenPoint = useCallback(
    (nextZoomRaw: number, screenX: number, screenY: number) => {
      const nextZ = Math.max(0.2, Math.min(4, Number(nextZoomRaw.toFixed(3))))
      setZoom((prevZ) => {
        const ratio = nextZ / prevZ
        setPan((prevP) => ({
          x: Math.round(screenX - (screenX - prevP.x) * ratio),
          y: Math.round(screenY - (screenY - prevP.y) * ratio),
        }))
        return nextZ
      })
    },
    [],
  )

  const zoomAroundCenter = useCallback(
    (nextZoomRaw: number) => {
      zoomAroundScreenPoint(nextZoomRaw, stageSize.width / 2, stageSize.height / 2)
    },
    [stageSize.height, stageSize.width, zoomAroundScreenPoint],
  )

  const panToObject = useCallback(
    (objId: string, pageId?: string) => {
      if (pageId && pageId !== session.getActivePageId()) {
        session.setActivePageId(pageId)
      }
      const targetDoc = session.getDocument()
      const targetPageId = pageId ?? session.getActivePageId()
      const objs = targetDoc.objects.filter((o) => o.pageId === targetPageId)
      const byId = new Map(objs.map((o) => [o.id, o]))
      const obj = byId.get(objId)
      if (!obj) return
      const b = objectBounds(obj, byId)
      setPan({
        x: Math.round(stageSize.width / 2 - (b.x + b.width / 2) * zoom),
        y: Math.round(stageSize.height / 2 - (b.y + b.height / 2) * zoom),
      })
      session.setSelection([obj.id])
    },
    [session, stageSize.height, stageSize.width, zoom],
  )

  const handleFitZoom = useCallback(() => {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect || !activePage) {
      setZoom(1)
      setPan({ x: TOOLBAR_LEFT_CLEARANCE, y: 48 })
      return
    }
    const leftPad = TOOLBAR_LEFT_CLEARANCE
    const rightPad = 40
    const topPad = 48
    const bottomPad = 76
    const availW = Math.max(240, rect.width - leftPad - rightPad)
    const availH = Math.max(180, rect.height - topPad - bottomPad)

    let minX = 0
    let minY = 0
    let maxX = activePage.width || 1280
    let maxY = activePage.height || 720
    if (activePage.format === 'freeform') {
      if (displayedObjects.length > 0) {
        const boxes = displayedObjects.map((o) => objectBounds(o, objectsById))
        minX = Math.min(...boxes.map((b) => b.x)) - 28
        minY = Math.min(...boxes.map((b) => b.y)) - 28
        maxX = Math.max(...boxes.map((b) => b.x + b.width)) + 28
        maxY = Math.max(...boxes.map((b) => b.y + b.height)) + 28
      } else {
        minX = 0
        minY = 0
        maxX = 1280
        maxY = 760
      }
    }
    const contentW = Math.max(200, maxX - minX)
    const contentH = Math.max(140, maxY - minY)
    const maxZ = activePage.format === 'freeform' ? 1 : 2
    const nextZoom = Math.max(0.2, Math.min(maxZ, Math.min(availW / contentW, availH / contentH)))
    const z = Number(nextZoom.toFixed(2))
    setZoom(z)
    setPan({
      x: Math.round(leftPad + (availW - contentW * z) / 2 - minX * z),
      y: Math.round(topPad + (availH - contentH * z) / 2 - minY * z),
    })
  }, [activePage, displayedObjects, objectsById])

  const selectTool = useCallback(
    (next: ToolKind) => {
      setTool(next)
      setStickerOpen(false)
      setContextMenu(null)
      if (next !== 'shape') setShapePopoverOpen(false)
      if (next !== 'select') session.setSelection([])
    },
    [session],
  )

  // Clipboard & selection action helpers.
  const handleCopySelected = useCallback(() => {
    const sel = session.getSelection()
    if (sel.length === 0) return
    const set = new Set(sel)
    const objs = pageObjects.filter((o) => set.has(o.id)).map((o) => structuredClone(o))
    if (objs.length === 0) return
    clipboardRef.current = { objects: objs, pasteCount: 0 }
  }, [pageObjects, session])

  const handleCutSelected = useCallback(() => {
    const sel = session.getSelection()
    if (sel.length === 0) return
    const set = new Set(sel)
    const unlocked = pageObjects.filter((o) => set.has(o.id) && !isObjectLocked(o))
    if (unlocked.length === 0) return
    clipboardRef.current = { objects: unlocked.map((o) => structuredClone(o)), pasteCount: 0 }
    session.deleteObjects(unlocked.map((o) => o.id))
  }, [pageObjects, session])

  const handlePasteInternal = useCallback((): boolean => {
    const clip = clipboardRef.current
    if (!clip || clip.objects.length === 0) return false
    clip.pasteCount += 1
    const shift = clip.pasteCount * 28
    const created = session.pasteObjects(clip.objects, { x: shift, y: shift })
    return created.length > 0
  }, [session])

  const handleDuplicateSelected = useCallback(() => {
    const sel = session.getSelection()
    if (sel.length === 0) return
    session.duplicateObjects(sel, { x: 28, y: 28 })
  }, [session])

  const handleDeleteSelected = useCallback(() => {
    const sel = session.getSelection()
    if (sel.length === 0) return
    const set = new Set(sel)
    const unlockedIds = pageObjects
      .filter((o) => set.has(o.id) && !isObjectLocked(o))
      .map((o) => o.id)
    if (unlockedIds.length > 0) {
      session.deleteObjects(unlockedIds)
    }
  }, [pageObjects, session])

  const handleSelectAll = useCallback(() => {
    const allUnlocked = pageObjects.filter((o) => !isObjectLocked(o)).map((o) => o.id)
    setTool('select')
    session.setSelection(allUnlocked)
  }, [pageObjects, session])

  const handleGroupSelected = useCallback(() => {
    session.groupObjects(session.getSelection())
  }, [session])

  const handleUngroupSelected = useCallback(() => {
    session.ungroupObjects(session.getSelection())
  }, [session])

  const handleToggleLockSelected = useCallback(() => {
    session.toggleLock(session.getSelection())
  }, [session])

  const handleLayerOrder = useCallback(
    (direction: 'front' | 'forward' | 'backward' | 'back') => {
      const sel = session.getSelection()
      if (sel.length === 0) return
      session.stepLayerOrder(sel, direction)
    },
    [session],
  )

  const handleAlignSelected = useCallback(
    (dir: AlignDirection) => {
      const updates = computeAlignUpdates(selectedObjs, dir)
      if (updates.length === 0) return
      session.updateObjectsBatch(updates.map((u) => ({ id: u.id, patch: { x: u.x, y: u.y } })))
    },
    [selectedObjs, session],
  )

  const handleDistributeSelected = useCallback(
    (axis: DistributeAxis) => {
      const updates = computeDistributeUpdates(selectedObjs, axis)
      if (updates.length === 0) return
      session.updateObjectsBatch(updates.map((u) => ({ id: u.id, patch: { x: u.x, y: u.y } })))
    },
    [selectedObjs, session],
  )

  const modalOpen =
    linkModalOpen || pdfPending !== null || exportModalFormat !== null || templateModalOpen

  useEffect(() => {
    if (presenting || modalOpen || editingId !== null || editingTableCell !== null) {
      spacePanningRef.current = false
      setSpacePanning(false)
    }
  }, [editingId, editingTableCell, modalOpen, presenting])

  // Space-to-pan temporary mode + comprehensive keyboard shortcuts.
  useEffect(() => {
    const isTypingTarget = (el: HTMLElement | null): boolean =>
      Boolean(
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable),
      )

    const releaseSpacePan = () => {
      if (spacePanningRef.current) {
        spacePanningRef.current = false
        setSpacePanning(false)
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null
      const typing = isTypingTarget(activeEl)

      if (presenting) {
        if (e.key === 'Escape' || e.key === 'F5') {
          e.preventDefault()
          onSetPresenting(false)
        } else if (
          e.key === 'ArrowRight' ||
          e.key === 'PageDown' ||
          e.code === 'Space' ||
          e.key === ' '
        ) {
          e.preventDefault()
          const idx = doc.pages.findIndex((p) => p.id === activePageId)
          if (idx >= 0 && idx + 1 < doc.pages.length) {
            session.setActivePageId(doc.pages[idx + 1]!.id)
          }
        } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
          e.preventDefault()
          const idx = doc.pages.findIndex((p) => p.id === activePageId)
          if (idx > 0) {
            session.setActivePageId(doc.pages[idx - 1]!.id)
          }
        }
        return
      }

      if (modalOpen) return

      const mod = e.ctrlKey || e.metaKey
      const key = shortcutLetterOf(e) ?? e.key.toLowerCase()

      if (mod && !e.altKey && key === 'f') {
        e.preventDefault()
        setSearchOpen(true)
        return
      }

      if (typing || editingId !== null || editingTableCell !== null) return

      if (isSpacePanKey(e)) {
        if (!activeEl?.closest?.('[role="dialog"], [aria-modal="true"]')) {
          e.preventDefault()
          if (!spacePanningRef.current) {
            spacePanningRef.current = true
            setSpacePanning(true)
          }
        }
        return
      }
      if (e.key === 'F5') {
        e.preventDefault()
        onSetPresenting(true)
        return
      }
      const historyCmd = whiteboardHistoryShortcut(e)
      if (historyCmd) {
        e.preventDefault()
        if (historyCmd === 'undo') session.undo()
        else session.redo()
        return
      }
      if (mod && !e.altKey && key === 'a') {
        e.preventDefault()
        handleSelectAll()
        return
      }
      if (mod && !e.altKey && key === 'c') {
        e.preventDefault()
        handleCopySelected()
        return
      }
      if (mod && !e.altKey && key === 'x') {
        e.preventDefault()
        handleCutSelected()
        return
      }
      if (mod && !e.altKey && key === 'd') {
        e.preventDefault()
        handleDuplicateSelected()
        return
      }
      if (mod && !e.altKey && key === 'g') {
        e.preventDefault()
        if (e.shiftKey) handleUngroupSelected()
        else handleGroupSelected()
        return
      }
      if (mod && !e.altKey && e.shiftKey && key === 'l') {
        e.preventDefault()
        handleToggleLockSelected()
        return
      }
      if (mod && key === '0') {
        e.preventDefault()
        zoomAroundCenter(1)
        return
      }
      if (mod && key === '1') {
        e.preventDefault()
        handleFitZoom()
        return
      }
      if (mod && (key === '=' || key === '+')) {
        e.preventDefault()
        zoomAroundCenter(zoom + 0.15)
        return
      }
      if (mod && key === '-') {
        e.preventDefault()
        zoomAroundCenter(zoom - 0.15)
        return
      }
      if (e.key === 'Escape') {
        setStickerOpen(false)
        setShapePopoverOpen(false)
        setContextMenu(null)
        setTemplateModalOpen(false)
        setSearchOpen(false)
        setTool('select')
        session.setSelection([])
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (session.getSelection().length > 0) {
          e.preventDefault()
          handleDeleteSelected()
        }
        return
      }
      if (
        (e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight') &&
        session.getSelection().length > 0
      ) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        const selSet = new Set(session.getSelection())
        const ops: Array<Record<string, unknown>> = []
        for (const obj of pageObjects) {
          if (!selSet.has(obj.id) || isObjectLocked(obj)) continue
          if (obj.kind === 'connector') {
            const cp = obj.props as unknown as ConnectorProps
            const sFree = !('objectId' in cp.start)
            const eFree = !('objectId' in cp.end)
            if (sFree || eFree) {
              ops.push({
                op: 'update',
                id: obj.id,
                props: {
                  ...('x' in cp.start ? { start: { x: cp.start.x + dx, y: cp.start.y + dy } } : {}),
                  ...('x' in cp.end ? { end: { x: cp.end.x + dx, y: cp.end.y + dy } } : {}),
                },
              })
            }
          } else {
            ops.push({ op: 'update', id: obj.id, x: obj.x + dx, y: obj.y + dy })
          }
        }
        if (ops.length > 0) session.applyUserOps(ops)
        return
      }
      const nextTool = whiteboardToolShortcut(e)
      if (nextTool) {
        e.preventDefault()
        selectTool(nextTool)
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ') releaseSpacePan()
    }

    const onBlur = () => {
      releaseSpacePan()
      if (dragRef.current?.kind === 'pan') {
        dragRef.current = null
        setIsPanning(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [
    activePageId,
    doc.pages,
    editingId,
    editingTableCell,
    handleCopySelected,
    handleCutSelected,
    handleDeleteSelected,
    handleDuplicateSelected,
    handleFitZoom,
    handleGroupSelected,
    handleSelectAll,
    handleToggleLockSelected,
    handleUngroupSelected,
    modalOpen,
    onSetPresenting,
    pageObjects,
    presenting,
    selectTool,
    session,
    zoom,
    zoomAroundCenter,
  ])

  // Global paste listener: supports OS clipboard images, internal objects, URLs, and plain text.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (presenting) return
      const activeEl = document.activeElement as HTMLElement | null
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.isContentEditable)
      ) {
        return
      }

      const items = Array.from(e.clipboardData?.items ?? [])
      const imgItem = items.find((it) => it.type.startsWith('image/'))
      if (imgItem) {
        const file = imgItem.getAsFile()
        if (file) {
          e.preventDefault()
          void file.arrayBuffer().then(async (ab) => {
            const center = viewportBoardCenter()
            const res = await session.insertUserImage({
              bytes: new Uint8Array(ab),
              alt: file.name || 'Pasted image',
              x: Math.round(center.x - 180),
              y: Math.round(center.y - 120),
            })
            if (!res.ok) onToast(res.error)
          })
          return
        }
      }

      if (handlePasteInternal()) {
        e.preventDefault()
        return
      }

      const plain = e.clipboardData?.getData('text/plain')?.trim() ?? ''
      if (!plain) return
      e.preventDefault()
      const center = viewportBoardCenter()
      const safeUrl = openableLink(plain)
      if (safeUrl && /^https?:\/\//i.test(safeUrl) && !plain.includes('\n')) {
        session.addObject({
          kind: 'link',
          url: safeUrl,
          title: safeUrl,
          x: Math.round(center.x - 150),
          y: Math.round(center.y - 46),
          width: 300,
          height: 92,
        })
      } else {
        const sized = estimateTextBoxSize(plain, TEXT_DEFAULT_FONT_SIZE, 6, 4)
        session.addObject({
          kind: 'text',
          x: Math.round(center.x - sized.width / 2),
          y: Math.round(center.y - sized.height / 2),
          width: sized.width,
          height: sized.height,
          fontSize: TEXT_DEFAULT_FONT_SIZE,
          color: PAPER_COLORS.ink,
          text: plainRichText(plain, { color: PAPER_COLORS.ink }),
        })
      }
    }

    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [handlePasteInternal, onToast, presenting, session, viewportBoardCenter])

  // Inline text commit (preserves existing marks and skips no-op commits to keep undo clean).
  const commitInlineEdit = useCallback(() => {
    if (!editingId) return
    const obj = objectsById.get(editingId)
    const text = editingText
    setEditingId(null)
    if (!obj) return
    if (obj.kind === 'connector') {
      const existing = (obj.props as unknown as ConnectorProps).label
      const trimmed = text.trim()
      if (trimmed === richTextPlain(existing).trim()) return
      session.updateObject(obj.id, {
        props: {
          label: trimmed ? plainRichText(trimmed, { color: PAPER_COLORS.ink }) : null,
        },
      })
      return
    }
    if (obj.kind === 'sticky' || obj.kind === 'text' || obj.kind === 'shape') {
      const existing = (obj.props as unknown as StickyProps | TextProps | ShapeProps).text
      if (text === richTextPlain(existing)) return
      const defaultAlign =
        (obj.props as unknown as StickyProps | TextProps | ShapeProps).align ??
        (obj.kind === 'text' ? 'left' : 'center')
      const patch: Record<string, unknown> = {
        text: updateRichTextPreservingStyle(existing, text, defaultAlign),
      }
      if (obj.kind === 'text') {
        const tp = obj.props as unknown as TextProps
        const fs = tp.fontSize ?? TEXT_DEFAULT_FONT_SIZE
        const hasBox = Boolean((tp.background && tp.background !== 'transparent') || tp.borderColor)
        const sized = estimateTextBoxSize(text, fs, hasBox ? 14 : 6, hasBox ? 10 : 4)
        if (sized.width > obj.width) patch.width = sized.width
        if (sized.height > obj.height) patch.height = sized.height
      }
      session.updateObject(obj.id, patch)
    }
  }, [editingId, editingText, objectsById, session])

  // Table cell inline edit commit.
  const commitTableCellEdit = useCallback(
    (nextCell?: { row: number; col: number } | null) => {
      if (!editingTableCell) return
      const { id, row, col, text } = editingTableCell
      const obj = objectsById.get(id)
      if (obj && obj.kind === 'table') {
        const tp = obj.props as unknown as TableProps
        const rid = tp.rowIds[row]
        const cid = tp.colIds[col]
        const prevText = rid && cid ? richTextPlain(tp.cells?.[`${rid}:${cid}`]) : ''
        if (text !== prevText) {
          session.updateTable(id, { cells: [{ row, col, text }] })
        }
        if (
          nextCell &&
          nextCell.row >= 0 &&
          nextCell.row < tp.rowIds.length &&
          nextCell.col >= 0 &&
          nextCell.col < tp.colIds.length
        ) {
          const nRid = tp.rowIds[nextCell.row]!
          const nCid = tp.colIds[nextCell.col]!
          const freshObj = session.getDocument().objects.find((o) => o.id === id)
          const freshTp = (freshObj?.props ?? tp) as unknown as TableProps
          setEditingTableCell({
            id,
            row: nextCell.row,
            col: nextCell.col,
            text: richTextPlain(freshTp.cells?.[`${nRid}:${nCid}`]),
          })
          return
        }
      }
      setEditingTableCell(null)
    },
    [editingTableCell, objectsById, session],
  )

  const startInlineEdit = useCallback(
    (obj: BoardObject, clickClient?: Point) => {
      if (isObjectLocked(obj)) return
      if (obj.kind === 'table') {
        const tp = obj.props as unknown as TableProps
        const rows = tp.rowIds?.length || 1
        const cols = tp.colIds?.length || 1
        let row = 0
        let col = 0
        if (clickClient) {
          const pt = clientToBoard(clickClient.x, clickClient.y)
          col = Math.max(0, Math.min(cols - 1, Math.floor(((pt.x - obj.x) / obj.width) * cols)))
          row = Math.max(0, Math.min(rows - 1, Math.floor(((pt.y - obj.y) / obj.height) * rows)))
        }
        const rid = tp.rowIds[row]
        const cid = tp.colIds[col]
        setEditingTableCell({
          id: obj.id,
          row,
          col,
          text: rid && cid ? richTextPlain(tp.cells?.[`${rid}:${cid}`]) : '',
        })
        return
      }
      if (obj.kind === 'connector') {
        const cp = obj.props as unknown as ConnectorProps
        setEditingId(obj.id)
        setEditingText(richTextPlain(cp.label))
        return
      }
      if (obj.kind !== 'sticky' && obj.kind !== 'text' && obj.kind !== 'shape') return
      const p = obj.props as unknown as StickyProps | TextProps | ShapeProps
      setEditingId(obj.id)
      setEditingText(richTextPlain(p.text))
    },
    [clientToBoard],
  )

  // Quick-flow: Tab while editing a sticky commits it and creates a sibling sticky to its right.
  const handleStickyTabNext = useCallback(
    (current: BoardObject) => {
      if (current.kind !== 'sticky') return
      const sp = current.props as unknown as StickyProps
      commitInlineEdit()
      const created = session.addObject({
        kind: 'sticky',
        x: Math.round(current.x + current.width + 24),
        y: Math.round(current.y),
        width: current.width,
        height: current.height,
        color: sp.color || activeColor,
        fontSize: sp.fontSize ?? STICKY_DEFAULT_FONT_SIZE,
        align: sp.align ?? 'center',
        text: plainRichText('', { color: PAPER_COLORS.ink, align: sp.align ?? 'center' }),
      })
      if (created) {
        setEditingId(created.id)
        setEditingText('')
      }
    },
    [activeColor, commitInlineEdit, session],
  )

  // Add helpers.
  const handleAddSticker = useCallback(
    (stickerId: string) => {
      session.addObject({
        kind: 'sticker',
        stickerId,
        width: 96,
        height: 96,
      })
      setStickerOpen(false)
      setTool('select')
    },
    [session],
  )

  const handleAddTable = useCallback(() => {
    session.addObject({
      kind: 'table',
      width: 390,
      height: 174,
      rows: 3,
      cols: 3,
      headerRow: true,
      fontSize: 15,
      data: [
        ['Column 1', 'Column 2', 'Column 3'],
        ['', '', ''],
        ['', '', ''],
      ],
    })
    setStickerOpen(false)
    setShapePopoverOpen(false)
    setTool('select')
  }, [session])

  const handleApplyTemplate = useCallback(
    (templateId: BuiltinTemplateId, target: 'current_page' | 'new_pages') => {
      const titleKeyMap: Record<BuiltinTemplateId, Parameters<typeof tGlobal>[0]> = {
        kanban: 'tplKanbanTitle',
        swot: 'tplSwotTitle',
        kpt: 'tplKptTitle',
        flowchart: 'tplFlowchartTitle',
        matrix_2x2: 'tplMatrixTitle',
        timeline: 'tplTimelineTitle',
        mindmap: 'tplMindmapTitle',
        user_journey: 'tplJourneyTitle',
        meeting_notes: 'tplMeetingTitle',
        bmc: 'tplBmcTitle',
        fishbone: 'tplFishboneTitle',
        okr: 'tplOkrTitle',
      }
      const template = buildBuiltinTemplate(templateId, target, {
        title: tGlobal(titleKeyMap[templateId]),
        kanbanTodo: tGlobal('tplKanbanTodo'),
        kanbanDoing: tGlobal('tplKanbanDoing'),
        kanbanDone: tGlobal('tplKanbanDone'),
        swotS: tGlobal('tplSwotS'),
        swotW: tGlobal('tplSwotW'),
        swotO: tGlobal('tplSwotO'),
        swotT: tGlobal('tplSwotT'),
        kptKeep: tGlobal('tplKptKeep'),
        kptProblem: tGlobal('tplKptProblem'),
        kptTry: tGlobal('tplKptTry'),
        flowStart: tGlobal('tplFlowStart'),
        flowReview: tGlobal('tplFlowReview'),
        flowDecision: tGlobal('tplFlowDecision'),
        flowApprove: tGlobal('tplFlowApprove'),
        flowRevise: tGlobal('tplFlowRevise'),
        matrixQ1: tGlobal('tplMatrixQ1'),
        matrixQ2: tGlobal('tplMatrixQ2'),
        matrixQ3: tGlobal('tplMatrixQ3'),
        matrixQ4: tGlobal('tplMatrixQ4'),
        matrixHighImpact: tGlobal('tplMatrixHighImpact'),
        matrixLowEffort: tGlobal('tplMatrixLowEffort'),
        timelinePhase: tGlobal('tplTimelinePhase'),
        sampleItem: tGlobal('tplSampleItem'),
        mindmapTopic: tGlobal('tplMindmapTopic'),
        mindmapBranch: tGlobal('tplMindmapBranch'),
        mindmapIdea: tGlobal('tplMindmapIdea'),
        journeyAwareness: tGlobal('tplJourneyAwareness'),
        journeyConsider: tGlobal('tplJourneyConsider'),
        journeyDecision: tGlobal('tplJourneyDecision'),
        journeyUse: tGlobal('tplJourneyUse'),
        journeyAdvocate: tGlobal('tplJourneyAdvocate'),
        journeyActions: tGlobal('tplJourneyActions'),
        journeyTouchpoint: tGlobal('tplJourneyTouchpoint'),
        journeyOpportunity: tGlobal('tplJourneyOpportunity'),
        meetingMeta: tGlobal('tplMeetingMeta'),
        meetingAgenda: tGlobal('tplMeetingAgenda'),
        meetingDecisions: tGlobal('tplMeetingDecisions'),
        meetingActions: tGlobal('tplMeetingActions'),
        meetingColTask: tGlobal('tplMeetingColTask'),
        meetingColOwner: tGlobal('tplMeetingColOwner'),
        meetingColDue: tGlobal('tplMeetingColDue'),
        meetingColStatus: tGlobal('tplMeetingColStatus'),
        bmcPartners: tGlobal('tplBmcPartners'),
        bmcActivities: tGlobal('tplBmcActivities'),
        bmcResources: tGlobal('tplBmcResources'),
        bmcValue: tGlobal('tplBmcValue'),
        bmcRelations: tGlobal('tplBmcRelations'),
        bmcChannels: tGlobal('tplBmcChannels'),
        bmcSegments: tGlobal('tplBmcSegments'),
        bmcCost: tGlobal('tplBmcCost'),
        bmcRevenue: tGlobal('tplBmcRevenue'),
        fishboneProblem: tGlobal('tplFishboneProblem'),
        fishbonePeople: tGlobal('tplFishbonePeople'),
        fishboneProcess: tGlobal('tplFishboneProcess'),
        fishboneTools: tGlobal('tplFishboneTools'),
        fishboneEnv: tGlobal('tplFishboneEnv'),
        fishboneCause: tGlobal('tplFishboneCause'),
        okrObjective: tGlobal('tplOkrObjective'),
        okrKr: tGlobal('tplOkrKr'),
        okrInitiative: tGlobal('tplOkrInitiative'),
        okrColMetric: tGlobal('tplOkrColMetric'),
        okrColTarget: tGlobal('tplOkrColTarget'),
        okrColCurrent: tGlobal('tplOkrColCurrent'),
      })
      const res = session.applyUserTemplate(template)
      setTemplateModalOpen(false)
      if (!res.ok) {
        onToast(res.error.message)
      } else {
        setTool('select')
        pendingFitRef.current = true
      }
    },
    [onToast, session],
  )

  const handlePickImage = useCallback(async () => {
    setStickerOpen(false)
    setShapePopoverOpen(false)
    const picked = await window.whiteboardApi.core.pickImageFile()
    if (!picked.ok || !picked.bytes) return
    const res = await session.insertUserImage({ bytes: picked.bytes, alt: picked.name })
    if (!res.ok) onToast(res.error)
  }, [onToast, session])

  const openPdfBytesForImport = useCallback(
    async (bytes: Uint8Array, name: string) => {
      try {
        const info = await inspectPdfBytes(bytes)
        if (info.pageCount <= 0) {
          onToast(tGlobal('pdfImportFailed', { error: 'empty PDF' }))
          return
        }
        if (info.pageCount === 1) {
          const rendered = await renderPdfPagesToPng(bytes, [1])
          session.importPdfPages(rendered, name.replace(/\.pdf$/i, ''))
          return
        }
        setPdfPending({ name, bytes, pageCount: info.pageCount })
        setPdfRange(`1-${Math.min(info.pageCount, MAX_PDF_IMPORT_PAGES)}`)
      } catch (err) {
        onToast(
          tGlobal('pdfImportFailed', {
            error: err instanceof Error ? err.message : String(err),
          }),
        )
      }
    },
    [onToast, session],
  )

  const handlePickPdf = useCallback(async () => {
    const picked = await window.whiteboardApi.core.pickPdfFile()
    if (!picked.ok || !picked.bytes) return
    await openPdfBytesForImport(picked.bytes, picked.name ?? 'PDF')
  }, [openPdfBytesForImport])

  const lastMenuSeqRef = useRef(0)
  useEffect(() => {
    if (!menuCommand || menuCommand.seq === lastMenuSeqRef.current) return
    lastMenuSeqRef.current = menuCommand.seq
    if (menuCommand.cmd === 'import-pdf') {
      void handlePickPdf()
    } else if (menuCommand.cmd === 'zoom-in') {
      zoomAroundCenter(zoom + 0.15)
    } else if (menuCommand.cmd === 'zoom-out') {
      zoomAroundCenter(zoom - 0.15)
    } else if (menuCommand.cmd === 'zoom-fit') {
      handleFitZoom()
    }
  }, [handleFitZoom, handlePickPdf, menuCommand, zoom, zoomAroundCenter])

  const handleConfirmPdfImport = useCallback(async () => {
    if (!pdfPending || pdfBusy) return
    setPdfBusy(true)
    try {
      const nums = parsePdfPageRange(pdfRange, pdfPending.pageCount, MAX_PDF_IMPORT_PAGES)
      if (nums.length === 0) {
        onToast(tGlobal('pdfImportFailed', { error: 'no pages selected' }))
        return
      }
      const rendered = await renderPdfPagesToPng(pdfPending.bytes, nums)
      session.importPdfPages(rendered, pdfPending.name.replace(/\.pdf$/i, ''))
      setPdfPending(null)
    } catch (err) {
      onToast(
        tGlobal('pdfImportFailed', {
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    } finally {
      setPdfBusy(false)
    }
  }, [onToast, pdfBusy, pdfPending, pdfRange, session])

  const handleConfirmLinkCard = useCallback(async () => {
    const safe = openableLink(linkUrl)
    if (!safe) {
      onToast(tGlobal('linkInvalidUrl'))
      return
    }
    localStorage.setItem(LINK_PREVIEW_PREF, linkFetchPreview ? '1' : '0')
    let title = linkTitle.trim()
    let description: string | undefined
    let previewResourceId: string | undefined

    if (linkFetchPreview && /^https?:\/\//i.test(safe)) {
      setLinkBusy(true)
      try {
        const preview = await window.whiteboardApi.core.readLinkPreview(safe)
        if (preview.ok) {
          if (!title && preview.title) title = preview.title
          if (preview.description) description = preview.description
          if (preview.imageBytes && preview.imageBytes.length > 0) {
            const added = session.addImageResource(preview.imageBytes)
            previewResourceId = added.resourceId
          }
        } else {
          onToast(tGlobal('linkPreviewFailed'))
        }
      } catch {
        onToast(tGlobal('linkPreviewFailed'))
      } finally {
        setLinkBusy(false)
      }
    }

    session.addObject({
      kind: 'link',
      url: safe,
      title: title || safe,
      ...(description ? { description } : {}),
      ...(previewResourceId ? { previewResourceId } : {}),
      width: 300,
      height: previewResourceId ? 176 : 92,
    })
    setLinkModalOpen(false)
    setLinkUrl('')
    setLinkTitle('')
  }, [linkFetchPreview, linkTitle, linkUrl, onToast, session])

  // Drag & drop routing:
  // - `.pdf` dropped onto whiteboard -> PDF page background import
  // - raster image dropped onto whiteboard -> embed image on canvas
  // - other document types -> do NOT call preventDefault() so shell drop-open opens them in a new tab!
  const isBoardDroppable = useCallback((dt: DataTransfer | null): boolean => {
    if (!dt) return false
    const files = Array.from(dt.files ?? [])
    if (files.length === 0) return false
    return files.every((f) => {
      const ext = fileExt(f.name)
      return ext === 'pdf' || IMAGE_DROP_EXTS.has(ext)
    })
  }, [])

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (isBoardDroppable(e.dataTransfer)) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    },
    [isBoardDroppable],
  )

  const handleDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      if (!isBoardDroppable(e.dataTransfer)) return
      e.preventDefault()
      e.stopPropagation()
      const files = Array.from(e.dataTransfer.files)
      const pt = clientToBoard(e.clientX, e.clientY)
      for (const file of files) {
        const ext = fileExt(file.name)
        const buf = new Uint8Array(await file.arrayBuffer())
        if (ext === 'pdf') {
          await openPdfBytesForImport(buf, file.name)
        } else if (IMAGE_DROP_EXTS.has(ext)) {
          const res = await session.insertUserImage({
            bytes: buf,
            alt: file.name,
            x: pt.x,
            y: pt.y,
          })
          if (!res.ok) onToast(res.error)
        }
      }
    },
    [clientToBoard, isBoardDroppable, onToast, openPdfBytesForImport, session],
  )

  // Stage pointer handlers.
  const handleStagePointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      setStickerOpen(false)
      setShapePopoverOpen(false)
      setContextMenu(null)
      if (editingId) commitInlineEdit()
      if (editingTableCell) commitTableCellEdit()
      const pt = clientToBoard(e.clientX, e.clientY)

      // Right-click: pan if dragged, otherwise open context menu on pointer up.
      if (e.button === 2) {
        dragRef.current = {
          kind: 'right-pan',
          startClientX: e.clientX,
          startClientY: e.clientY,
          startPanX: pan.x,
          startPanY: pan.y,
          didMove: false,
        }
        return
      }

      if (
        e.button === 1 ||
        (e.button === 0 &&
          (spacePanningRef.current || tool === 'hand' || (tool === 'select' && e.altKey)))
      ) {
        e.preventDefault()
        dragRef.current = {
          kind: 'pan',
          startClientX: e.clientX,
          startClientY: e.clientY,
          startPanX: pan.x,
          startPanY: pan.y,
        }
        setIsPanning(true)
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId)
        } catch {
          // Synthetic events without an active pointer ID cannot be captured.
        }
        return
      }

      if (tool === 'eraser') {
        const hits = new Set<string>()
        for (const obj of pageObjects) {
          if (!isObjectLocked(obj) && objectHitsPoint(obj, pt, objectsById, 8 / zoom)) {
            hits.add(obj.id)
          }
        }
        dragRef.current = {
          kind: 'erase-sweep',
          startClientX: e.clientX,
          startClientY: e.clientY,
          startPanX: pan.x,
          startPanY: pan.y,
          eraseSet: hits,
        }
        if (hits.size > 0) setErasingIds(new Set(hits))
        return
      }

      if (tool === 'sticky') {
        e.preventDefault()
        const created = session.addObject({
          kind: 'sticky',
          x: Math.round(pt.x - STICKY_DEFAULT_SIZE / 2),
          y: Math.round(pt.y - STICKY_DEFAULT_SIZE / 2),
          width: STICKY_DEFAULT_SIZE,
          height: STICKY_DEFAULT_SIZE,
          color: activeColor,
          fontSize: STICKY_DEFAULT_FONT_SIZE,
          align: 'center',
          text: plainRichText('', { color: PAPER_COLORS.ink, align: 'center' }),
        })
        setTool('select')
        if (created) {
          setEditingId(created.id)
          setEditingText('')
        }
        return
      }
      if (tool === 'text') {
        e.preventDefault()
        const created = session.addObject({
          kind: 'text',
          x: Math.round(pt.x - 110),
          y: Math.round(pt.y - 20),
          width: 220,
          height: 44,
          fontSize: TEXT_DEFAULT_FONT_SIZE,
          color: PAPER_COLORS.ink,
          text: plainRichText('', { color: PAPER_COLORS.ink }),
        })
        setTool('select')
        if (created) {
          setEditingId(created.id)
          setEditingText('')
        }
        return
      }
      if (tool === 'shape') {
        session.addObject({
          kind: 'shape',
          shape: shapeKind,
          x: Math.round(pt.x - 98),
          y: Math.round(pt.y - 58),
          width: 196,
          height: 116,
          fill: PAPER_COLORS.shapeDefaultFill,
          stroke: PAPER_COLORS.shapeDefaultStroke,
          strokeWidth: 1.75,
          fontSize: SHAPE_DEFAULT_FONT_SIZE,
          align: 'center',
          text: plainRichText('', { color: PAPER_COLORS.ink, align: 'center' }),
        })
        setTool('select')
        return
      }
      if (tool === 'connector') {
        const hit = findAttachTarget(pageObjects, pt, 14 / zoom)
        const startPt = hit ? { x: hit.x, y: hit.y } : pt
        dragRef.current = {
          kind: 'connector-draw',
          startClientX: e.clientX,
          startClientY: e.clientY,
          startPanX: pan.x,
          startPanY: pan.y,
          startPoint: startPt,
          startAttach: hit,
        }
        setLiveConnector({
          start: startPt,
          end: startPt,
          startTargetId: hit?.objectId ?? null,
          endTargetId: null,
          startNormal: anchorNormalFromTarget(hit),
          endNormal: null,
          routing: hit ? connectorRouting : connectorRouting === 'elbow' ? 'elbow' : 'straight',
        })
        return
      }
      if (tool === 'pen' || tool === 'highlighter') {
        const pressure = e.pressure > 0 ? e.pressure : 0.5
        const pts: Array<[number, number, number]> = [[pt.x, pt.y, pressure]]
        dragRef.current = {
          kind: 'draw',
          startClientX: e.clientX,
          startClientY: e.clientY,
          startPanX: pan.x,
          startPanY: pan.y,
          points: pts,
        }
        setLiveStroke(pts)
        return
      }

      // Select tool on empty stage: begin marquee drag-selection (click clears selection on up).
      dragRef.current = {
        kind: 'marquee',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
        startPoint: pt,
        additive: e.shiftKey,
        baseSelection: [...selectedIds],
        didMove: false,
      }
    },
    [
      activeColor,
      clientToBoard,
      commitInlineEdit,
      commitTableCellEdit,
      connectorRouting,
      editingId,
      editingTableCell,
      objectsById,
      pageObjects,
      pan.x,
      pan.y,
      selectedIds,
      session,
      shapeKind,
      tool,
      zoom,
    ],
  )

  const handleObjectPointerDown = useCallback(
    (e: ReactPointerEvent, obj: BoardObject) => {
      if (
        spacePanningRef.current ||
        e.button === 1 ||
        tool === 'hand' ||
        tool === 'connector' ||
        tool === 'pen' ||
        tool === 'highlighter'
      ) {
        return
      }

      // Right-click on object: ensure it is selected, then let stage open context menu / pan.
      if (e.button === 2) {
        if (!selectedIds.includes(obj.id)) {
          session.setSelection(expandGroupSelection([obj.id], pageObjects))
        }
        return
      }

      e.stopPropagation()
      setStickerOpen(false)
      setShapePopoverOpen(false)
      setContextMenu(null)
      if (editingId && editingId !== obj.id) commitInlineEdit()
      if (editingTableCell && editingTableCell.id !== obj.id) commitTableCellEdit()

      if (tool === 'eraser') {
        const hits = new Set<string>()
        if (!isObjectLocked(obj)) hits.add(obj.id)
        dragRef.current = {
          kind: 'erase-sweep',
          startClientX: e.clientX,
          startClientY: e.clientY,
          startPanX: pan.x,
          startPanY: pan.y,
          eraseSet: hits,
        }
        if (hits.size > 0) setErasingIds(new Set(hits))
        return
      }
      if (tool !== 'select') return

      const groupMembers = expandGroupSelection([obj.id], pageObjects)
      if (e.shiftKey) {
        const next = new Set(selectedIds)
        const allIn = groupMembers.every((id) => next.has(id))
        for (const id of groupMembers) {
          if (allIn) next.delete(id)
          else next.add(id)
        }
        session.setSelection([...next])
        return
      }

      const nextSel = selectedIds.includes(obj.id) ? selectedIds : groupMembers
      if (nextSel !== selectedIds) {
        session.setSelection(nextSel)
      }

      const selSet = new Set(nextSel)
      const movable = pageObjects.filter((o) => selSet.has(o.id) && !isObjectLocked(o))
      if (movable.length === 0) return

      const origMap = new Map<string, Rect>()
      for (const m of movable) {
        if (m.kind !== 'connector') {
          origMap.set(m.id, { x: m.x, y: m.y, width: m.width, height: m.height })
        }
      }
      // Also allow dragging a single selected free-point connector or multi-selection with connectors.
      if (origMap.size === 0) return

      const origBounds = selectionBounds(
        movable.filter((m) => m.kind !== 'connector'),
        objectsById,
      )
      const otherRects = pageObjects
        .filter((o) => !selSet.has(o.id) && o.kind !== 'connector')
        .map((o) => ({ x: o.x, y: o.y, width: o.width, height: o.height }))

      dragRef.current = {
        kind: 'multi-move',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
        origMap,
        origBounds: origBounds ?? undefined,
        otherRects,
        cloneSourceIds: [...selSet],
        isClone: e.altKey,
        didMove: false,
      }
    },
    [
      commitInlineEdit,
      commitTableCellEdit,
      editingId,
      editingTableCell,
      objectsById,
      pageObjects,
      pan.x,
      pan.y,
      selectedIds,
      session,
      tool,
    ],
  )

  const handleResizePointerDown = useCallback(
    (e: ReactPointerEvent, obj: BoardObject, handle: ResizeHandle) => {
      if (spacePanningRef.current || e.button === 1) return
      e.stopPropagation()
      if (isObjectLocked(obj)) return
      dragRef.current = {
        kind: 'resize',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
        objectId: obj.id,
        origRect: { x: obj.x, y: obj.y, width: obj.width, height: obj.height },
        handle,
      }
    },
    [pan.x, pan.y],
  )

  const handleGroupResizePointerDown = useCallback(
    (e: ReactPointerEvent, bounds: Rect, handle: ResizeHandle) => {
      if (spacePanningRef.current || e.button === 1) return
      e.stopPropagation()
      const origMap = new Map<string, Rect>()
      for (const o of selectedObjs) {
        if (o.kind !== 'connector' && !isObjectLocked(o)) {
          origMap.set(o.id, { x: o.x, y: o.y, width: o.width, height: o.height })
        }
      }
      if (origMap.size === 0) return
      dragRef.current = {
        kind: 'group-resize',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
        origBounds: bounds,
        origMap,
        handle,
      }
    },
    [pan.x, pan.y, selectedObjs],
  )

  const handleRotatePointerDown = useCallback(
    (e: ReactPointerEvent, obj: BoardObject) => {
      e.stopPropagation()
      if (isObjectLocked(obj)) return
      dragRef.current = {
        kind: 'rotate',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
        objectId: obj.id,
        center: { x: obj.x + obj.width / 2, y: obj.y + obj.height / 2 },
      }
    },
    [pan.x, pan.y],
  )

  const handleEndpointPointerDown = useCallback(
    (e: ReactPointerEvent, obj: BoardObject, which: 'start' | 'end') => {
      e.stopPropagation()
      if (isObjectLocked(obj)) return
      dragRef.current = {
        kind: 'endpoint-drag',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
        objectId: obj.id,
        whichEnd: which,
      }
    },
    [pan.x, pan.y],
  )

  const handleQuickPortPointerDown = useCallback(
    (e: ReactPointerEvent, obj: BoardObject, anchorX: number, anchorY: number) => {
      e.stopPropagation()
      const startPt = {
        x: Math.round((obj.x + obj.width * anchorX) * 100) / 100,
        y: Math.round((obj.y + obj.height * anchorY) * 100) / 100,
      }
      const startAttach: SnapAttachTarget = {
        objectId: obj.id,
        anchorX,
        anchorY,
        x: startPt.x,
        y: startPt.y,
      }
      dragRef.current = {
        kind: 'connector-draw',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
        startPoint: startPt,
        startAttach,
      }
      setLiveConnector({
        start: startPt,
        end: startPt,
        startTargetId: obj.id,
        endTargetId: null,
        startNormal: anchorNormalFromTarget(startAttach),
        endNormal: null,
        routing: connectorRouting,
      })
    },
    [connectorRouting, pan.x, pan.y],
  )

  const handleStagePointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current
      if (!drag) {
        if (tool === 'connector') {
          const pt = clientToBoard(e.clientX, e.clientY)
          const hit = findAttachTarget(pageObjects, pt, 14 / zoom)
          setConnectorHoverObjId(hit?.objectId ?? null)
        } else if (connectorHoverObjId !== null) {
          setConnectorHoverObjId(null)
        }
        return
      }
      if (drag.kind === 'right-pan') {
        const dist = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY)
        if (dist >= 4) drag.didMove = true
        if (drag.didMove) {
          setPan({
            x: drag.startPanX + (e.clientX - drag.startClientX),
            y: drag.startPanY + (e.clientY - drag.startClientY),
          })
        }
        return
      }
      if (drag.kind === 'pan') {
        setPan({
          x: drag.startPanX + (e.clientX - drag.startClientX),
          y: drag.startPanY + (e.clientY - drag.startClientY),
        })
        return
      }
      if (drag.kind === 'marquee' && drag.startPoint) {
        const dist = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY)
        if (!drag.didMove && dist < 4) return
        drag.didMove = true
        const pt = clientToBoard(e.clientX, e.clientY)
        const rect = normalizeRect(drag.startPoint, pt)
        setMarqueeRect(rect)
        const hitIds = pageObjects
          .filter((o) => !isObjectLocked(o) && objectIntersectsRect(o, rect, objectsById))
          .map((o) => o.id)
        const expanded = expandGroupSelection(hitIds, pageObjects)
        if (drag.additive && drag.baseSelection) {
          session.setSelection([...new Set([...drag.baseSelection, ...expanded])])
        } else {
          session.setSelection(expanded)
        }
        return
      }
      if (drag.kind === 'erase-sweep' && drag.eraseSet) {
        const pt = clientToBoard(e.clientX, e.clientY)
        let added = false
        for (const obj of pageObjects) {
          if (
            !isObjectLocked(obj) &&
            !drag.eraseSet.has(obj.id) &&
            objectHitsPoint(obj, pt, objectsById, 8 / zoom)
          ) {
            drag.eraseSet.add(obj.id)
            added = true
          }
        }
        if (added) setErasingIds(new Set(drag.eraseSet))
        return
      }
      if (drag.kind === 'draw' && drag.points) {
        const pt = clientToBoard(e.clientX, e.clientY)
        const pressure = e.pressure > 0 ? e.pressure : 0.5
        drag.points.push([pt.x, pt.y, pressure])
        setLiveStroke([...drag.points])
        return
      }
      if (drag.kind === 'connector-draw' && drag.startPoint) {
        const pt = clientToBoard(e.clientX, e.clientY)
        const exclude = new Set(drag.startAttach ? [drag.startAttach.objectId] : [])
        const endHit = findAttachTarget(pageObjects, pt, 14 / zoom, exclude, drag.startPoint)
        const endPt = endHit ? { x: endHit.x, y: endHit.y } : pt
        let startPt = drag.startPoint
        let startAttach = drag.startAttach ?? null
        if (drag.startAttach) {
          const startObj = pageObjects.find((o) => o.id === drag.startAttach!.objectId)
          if (startObj) {
            const refaced = findAttachTarget([startObj], startPt, 9999, new Set(), endPt)
            if (refaced) {
              startPt = { x: refaced.x, y: refaced.y }
              startAttach = refaced
            }
          }
        }
        const attached = Boolean(startAttach || endHit)
        setLiveConnector({
          start: startPt,
          end: endPt,
          startTargetId: startAttach?.objectId ?? null,
          endTargetId: endHit?.objectId ?? null,
          startNormal: anchorNormalFromTarget(startAttach),
          endNormal: anchorNormalFromTarget(endHit),
          routing: attached
            ? connectorRouting
            : connectorRouting === 'elbow'
              ? 'elbow'
              : 'straight',
        })
        return
      }
      if (drag.kind === 'endpoint-drag' && drag.objectId && drag.whichEnd) {
        const pt = clientToBoard(e.clientX, e.clientY)
        const target = findAttachTarget(pageObjects, pt, 14 / zoom, new Set([drag.objectId]))
        const nextEnd: ConnectorEnd = target
          ? { objectId: target.objectId, anchorX: target.anchorX, anchorY: target.anchorY }
          : { x: Math.round(pt.x), y: Math.round(pt.y) }
        setEndpointPreview({
          id: drag.objectId,
          which: drag.whichEnd,
          end: nextEnd,
          targetId: target?.objectId ?? null,
        })
        return
      }
      if (drag.kind === 'multi-move' && drag.origMap && drag.origBounds) {
        const rawDx = (e.clientX - drag.startClientX) / zoom
        const rawDy = (e.clientY - drag.startClientY) / zoom
        if (
          !drag.didMove &&
          Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY) < 2
        ) {
          return
        }
        drag.didMove = true
        let dx = rawDx
        let dy = rawDy
        if (!(e.ctrlKey || e.metaKey) && drag.otherRects && drag.otherRects.length > 0) {
          const movingRect: Rect = {
            x: drag.origBounds.x + rawDx,
            y: drag.origBounds.y + rawDy,
            width: drag.origBounds.width,
            height: drag.origBounds.height,
          }
          const snap = computeSnapGuides(movingRect, drag.otherRects, 6 / zoom)
          dx += snap.snapDx
          dy += snap.snapDy
          setSnapGuides(snap.guides)
        } else {
          setSnapGuides([])
        }
        const ids = new Set(drag.cloneSourceIds ?? [...drag.origMap.keys()])
        setMultiMoveDelta({ ids, dx, dy, isClone: Boolean(drag.isClone) })
        return
      }
      if (drag.kind === 'resize' && drag.objectId && drag.origRect && drag.handle) {
        const rawDx = (e.clientX - drag.startClientX) / zoom
        const rawDy = (e.clientY - drag.startClientY) / zoom
        const next = computeSingleResize(drag.origRect, drag.handle, rawDx, rawDy, e.shiftKey)
        setResizePreview(new Map([[drag.objectId, next]]))
        return
      }
      if (drag.kind === 'group-resize' && drag.origBounds && drag.origMap && drag.handle) {
        const rawDx = (e.clientX - drag.startClientX) / zoom
        const rawDy = (e.clientY - drag.startClientY) / zoom
        const items = [...drag.origMap.entries()].map(([id, rect]) => ({ id, rect }))
        const nextMap = computeGroupResize(
          drag.origBounds,
          drag.handle,
          rawDx,
          rawDy,
          items,
          e.shiftKey,
        )
        setResizePreview(nextMap)
        return
      }
      if (drag.kind === 'rotate' && drag.objectId && drag.center) {
        const pt = clientToBoard(e.clientX, e.clientY)
        const angle = computeRotationDegrees(drag.center, pt, e.shiftKey)
        setRotatePreview({ id: drag.objectId, angle, clientX: e.clientX, clientY: e.clientY })
      }
    },
    [
      clientToBoard,
      connectorHoverObjId,
      connectorRouting,
      objectsById,
      pageObjects,
      session,
      tool,
      zoom,
    ],
  )

  const handleStagePointerUp = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current
      dragRef.current = null
      if (!drag) return

      if (drag.kind === 'pan') {
        setIsPanning(false)
        try {
          if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId)
          }
        } catch {
          // Ignore release failures on synthetic events.
        }
        return
      }

      if (drag.kind === 'right-pan') {
        if (!drag.didMove) {
          const menuW = 224
          const menuH = 380
          const x = Math.min(e.clientX, window.innerWidth - menuW - 8)
          const y = Math.min(e.clientY, window.innerHeight - menuH - 8)
          setContextMenu({ x: Math.max(8, x), y: Math.max(8, y) })
        }
        return
      }

      if (drag.kind === 'marquee') {
        setMarqueeRect(null)
        if (!drag.didMove && !drag.additive) {
          session.setSelection([])
        }
        return
      }

      if (drag.kind === 'erase-sweep') {
        const ids = drag.eraseSet ? [...drag.eraseSet] : []
        setErasingIds(null)
        if (ids.length > 0) {
          session.deleteObjects(ids)
        }
        return
      }

      if (drag.kind === 'connector-draw' && drag.startPoint) {
        const pt = clientToBoard(e.clientX, e.clientY)
        const distScreen = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY)
        let startEnd: ConnectorEnd = drag.startAttach
          ? {
              objectId: drag.startAttach.objectId,
              anchorX: drag.startAttach.anchorX,
              anchorY: drag.startAttach.anchorY,
            }
          : { x: Math.round(drag.startPoint.x), y: Math.round(drag.startPoint.y) }
        let endEnd: ConnectorEnd
        let hasEndAttach = false

        if (distScreen < 10) {
          const n = anchorNormalFromTarget(drag.startAttach)
          const dx = n ? n.x * 180 : 180
          const dy = n ? n.y * 180 : 0
          endEnd = {
            x: Math.round(drag.startPoint.x + dx),
            y: Math.round(drag.startPoint.y + dy),
          }
        } else {
          const exclude = new Set(drag.startAttach ? [drag.startAttach.objectId] : [])
          const endHit = findAttachTarget(pageObjects, pt, 14 / zoom, exclude, drag.startPoint)
          hasEndAttach = Boolean(endHit)
          endEnd = endHit
            ? { objectId: endHit.objectId, anchorX: endHit.anchorX, anchorY: endHit.anchorY }
            : { x: Math.round(pt.x), y: Math.round(pt.y) }
          if (drag.startAttach) {
            const startObj = pageObjects.find((o) => o.id === drag.startAttach!.objectId)
            const refPt = endHit ? { x: endHit.x, y: endHit.y } : pt
            if (startObj) {
              const refaced = findAttachTarget([startObj], drag.startPoint, 9999, new Set(), refPt)
              if (refaced) {
                startEnd = {
                  objectId: refaced.objectId,
                  anchorX: refaced.anchorX,
                  anchorY: refaced.anchorY,
                }
              }
            }
          }
        }

        const isAttached = Boolean(drag.startAttach || hasEndAttach)
        const resolvedRouting: ConnectorRouting = isAttached
          ? connectorRouting
          : connectorRouting === 'elbow'
            ? 'elbow'
            : 'straight'

        setLiveConnector(null)
        setConnectorHoverObjId(null)
        session.addObject({
          kind: 'connector',
          start: startEnd,
          end: endEnd,
          routing: resolvedRouting,
          color: connectorColor,
          strokeWidth: 2,
          startHead: 'none',
          endHead: 'arrow',
          lineStyle: 'solid',
        })
        setTool('select')
        return
      }

      if (drag.kind === 'endpoint-drag' && drag.objectId && drag.whichEnd) {
        const preview = endpointPreview
        setEndpointPreview(null)
        if (preview && preview.id === drag.objectId) {
          session.updateObject(drag.objectId, {
            props: { [preview.which]: preview.end },
          })
        }
        return
      }

      if (drag.kind === 'draw' && drag.points && drag.points.length > 0) {
        const pts = drag.points
        const xs = pts.map((p) => p[0])
        const ys = pts.map((p) => p[1])
        const minX = Math.min(...xs)
        const minY = Math.min(...ys)
        const maxX = Math.max(...xs)
        const maxY = Math.max(...ys)
        const relPoints: Array<[number, number, number]> = pts.map(([px, py, pr]) => [
          px - minX,
          py - minY,
          pr,
        ])
        const isHi = tool === 'highlighter'
        session.addObject({
          kind: 'stroke',
          x: minX,
          y: minY,
          width: Math.max(8, maxX - minX),
          height: Math.max(8, maxY - minY),
          tool: isHi ? 'highlighter' : 'pen',
          color: isHi ? highlighterColor : penColor,
          strokeWidth: isHi ? highlighterWidth : penWidth,
          opacity: isHi ? 0.35 : 1,
          points: relPoints,
        })
        setLiveStroke(null)
        return
      }

      if (drag.kind === 'multi-move' && multiMoveDelta) {
        const { dx, dy, isClone, ids } = multiMoveDelta
        setMultiMoveDelta(null)
        setSnapGuides([])
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          const rDx = Math.round(dx)
          const rDy = Math.round(dy)
          if (isClone && drag.cloneSourceIds) {
            session.duplicateObjects(drag.cloneSourceIds, { x: rDx, y: rDy })
          } else if (drag.origMap) {
            const ops: Array<Record<string, unknown>> = []
            for (const [id, orig] of drag.origMap.entries()) {
              ops.push({
                op: 'update',
                id,
                x: Math.round(orig.x + rDx),
                y: Math.round(orig.y + rDy),
              })
            }
            for (const obj of pageObjects) {
              if (obj.kind !== 'connector' || !ids.has(obj.id) || isObjectLocked(obj)) continue
              const cp = obj.props as unknown as ConnectorProps
              const sFree = !('objectId' in cp.start)
              const eFree = !('objectId' in cp.end)
              if (sFree || eFree || cp.waypoints?.length) {
                ops.push({
                  op: 'update',
                  id: obj.id,
                  props: {
                    ...('x' in cp.start
                      ? { start: { x: cp.start.x + rDx, y: cp.start.y + rDy } }
                      : {}),
                    ...('x' in cp.end ? { end: { x: cp.end.x + rDx, y: cp.end.y + rDy } } : {}),
                    ...(cp.waypoints
                      ? {
                          waypoints: cp.waypoints.map((pt) => ({
                            x: pt.x + rDx,
                            y: pt.y + rDy,
                          })),
                        }
                      : {}),
                  },
                })
              }
            }
            if (ops.length > 0) session.applyUserOps(ops)
          }
        }
        return
      }

      if ((drag.kind === 'resize' || drag.kind === 'group-resize') && resizePreview) {
        const preview = resizePreview
        setResizePreview(null)
        const updates: Array<{ id: string; patch: Record<string, unknown> }> = []
        for (const [id, rect] of preview.entries()) {
          updates.push({
            id,
            patch: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.max(24, Math.round(rect.width)),
              height: Math.max(20, Math.round(rect.height)),
            },
          })
        }
        if (updates.length > 0) session.updateObjectsBatch(updates)
        return
      }

      if (drag.kind === 'rotate' && rotatePreview) {
        const { id, angle } = rotatePreview
        setRotatePreview(null)
        session.updateObject(id, { rotation: angle })
      }
    },
    [
      clientToBoard,
      connectorColor,
      connectorRouting,
      endpointPreview,
      highlighterColor,
      highlighterWidth,
      multiMoveDelta,
      pageObjects,
      penColor,
      penWidth,
      resizePreview,
      rotatePreview,
      session,
      tool,
      zoom,
    ],
  )

  const handleOpenLinkCard = useCallback(
    (url: string) => {
      void window.whiteboardApi.core.openLink(url).then((opened) => {
        if (!opened) onToast(tGlobal('linkNotOpened'))
      })
    },
    [onToast],
  )

  // Multi-object & single-object rich text helpers.
  const textEditableSelectedObjs = useMemo(
    () =>
      selectedObjs.filter(
        (o) =>
          !isObjectLocked(o) && (o.kind === 'sticky' || o.kind === 'text' || o.kind === 'shape'),
      ),
    [selectedObjs],
  )

  const handleToggleMark = useCallback(
    (mark: RichMark) => {
      if (textEditableSelectedObjs.length === 0) return
      const updates = textEditableSelectedObjs.map((obj) => {
        const p = obj.props as unknown as StickyProps | TextProps | ShapeProps
        return { id: obj.id, patch: { text: toggleRichTextMark(p.text, mark) } }
      })
      session.updateObjectsBatch(updates)
    },
    [session, textEditableSelectedObjs],
  )

  const applyFontSize = useCallback(
    (nextSize: number) => {
      if (textEditableSelectedObjs.length === 0) return
      const clamped = Math.max(12, Math.min(72, Math.round(nextSize)))
      const updates = textEditableSelectedObjs.map((obj) => {
        const p = obj.props as unknown as StickyProps | TextProps | ShapeProps
        const patch: Record<string, unknown> = { fontSize: clamped }
        if (obj.kind === 'text') {
          const tp = obj.props as unknown as TextProps
          const hasBox = Boolean(
            (tp.background && tp.background !== 'transparent') || tp.borderColor,
          )
          const sized = estimateTextBoxSize(
            richTextPlain(p.text),
            clamped,
            hasBox ? 14 : 6,
            hasBox ? 10 : 4,
          )
          if (sized.width > obj.width) patch.width = sized.width
          if (sized.height > obj.height) patch.height = sized.height
        }
        return { id: obj.id, patch }
      })
      session.updateObjectsBatch(updates)
    },
    [session, textEditableSelectedObjs],
  )

  const handleStepFontSize = useCallback(
    (delta: -1 | 1) => {
      const lead = textEditableSelectedObjs[0]
      if (!lead) return
      const p = lead.props as unknown as StickyProps | TextProps | ShapeProps
      const fallback =
        lead.kind === 'text'
          ? TEXT_DEFAULT_FONT_SIZE
          : lead.kind === 'shape'
            ? SHAPE_DEFAULT_FONT_SIZE
            : STICKY_DEFAULT_FONT_SIZE
      const current = p.fontSize ?? fallback
      if (delta > 0) {
        const next = FONT_SIZE_PRESETS.find((s) => s > current) ?? Math.min(72, current + 4)
        applyFontSize(next)
      } else {
        const prev =
          [...FONT_SIZE_PRESETS].reverse().find((s) => s < current) ?? Math.max(12, current - 4)
        applyFontSize(prev)
      }
    },
    [applyFontSize, textEditableSelectedObjs],
  )

  const handleCycleFontSize = useCallback(() => {
    const lead = textEditableSelectedObjs[0]
    if (!lead) return
    const p = lead.props as unknown as StickyProps | TextProps | ShapeProps
    const fallback =
      lead.kind === 'text'
        ? TEXT_DEFAULT_FONT_SIZE
        : lead.kind === 'shape'
          ? SHAPE_DEFAULT_FONT_SIZE
          : STICKY_DEFAULT_FONT_SIZE
    const current = p.fontSize ?? fallback
    const nearest =
      FONT_SIZE_PRESETS.find((s) => s >= current) ??
      FONT_SIZE_PRESETS[FONT_SIZE_PRESETS.length - 1]!
    applyFontSize(nextCycleValue(FONT_SIZE_PRESETS, nearest))
  }, [applyFontSize, textEditableSelectedObjs])

  const handleCycleTextBackground = useCallback(() => {
    if (!selectedObj || selectedObj.kind !== 'text' || isObjectLocked(selectedObj)) return
    const tp = selectedObj.props as unknown as TextProps
    const curBg = (tp.background || 'transparent').toUpperCase()
    const idx = TEXT_BG_PRESETS.findIndex((p) => p.bg.toUpperCase() === curBg)
    const next = TEXT_BG_PRESETS[(idx + 1) % TEXT_BG_PRESETS.length]!
    const hasBox = next.bg !== 'transparent'
    const fs = tp.fontSize ?? TEXT_DEFAULT_FONT_SIZE
    const sized = estimateTextBoxSize(richTextPlain(tp.text), fs, hasBox ? 14 : 6, hasBox ? 10 : 4)
    session.updateObject(selectedObj.id, {
      props: {
        background: hasBox ? next.bg : null,
        borderColor: next.border ?? null,
      },
      ...(sized.width > selectedObj.width ? { width: sized.width } : {}),
      ...(sized.height > selectedObj.height ? { height: sized.height } : {}),
    })
  }, [selectedObj, session])

  const handleCycleAlign = useCallback(() => {
    const lead = textEditableSelectedObjs[0]
    if (!lead) return
    const p = lead.props as unknown as StickyProps | TextProps | ShapeProps
    const current: TextAlign = p.align ?? (lead.kind === 'text' ? 'left' : 'center')
    const nextAlign = nextCycleValue(['left', 'center', 'right'] as const, current)
    session.updateObjectsBatch(
      textEditableSelectedObjs.map((o) => ({ id: o.id, patch: { align: nextAlign } })),
    )
  }, [session, textEditableSelectedObjs])

  const presentSvg = useMemo(() => {
    if (!presenting || !activePage) return null
    return renderPageToSvg(doc, activePage.id, session.getAllResourceDataUrls())
  }, [presenting, activePage, doc, session])

  const statusText =
    saveStatus === 'saving'
      ? t('statusSaving')
      : saveStatus === 'failed'
        ? t('statusSaveFailed')
        : session.isDirty()
          ? t('statusUnsaved')
          : t('statusSaved')

  const editingObj = editingId ? (objectsById.get(editingId) ?? null) : null
  const editingTableObj = editingTableCell ? (objectsById.get(editingTableCell.id) ?? null) : null

  const allSelectedAreStickies =
    selectedObjs.length > 0 && selectedObjs.every((o) => o.kind === 'sticky' && !isObjectLocked(o))
  const allSelectedAreShapes =
    selectedObjs.length > 0 && selectedObjs.every((o) => o.kind === 'shape' && !isObjectLocked(o))
  const allSelectedAreInk =
    selectedObjs.length > 0 &&
    selectedObjs.every(
      (o) =>
        !isObjectLocked(o) && (o.kind === 'connector' || o.kind === 'stroke' || o.kind === 'text'),
    )
  const allSelectedAreTextEditable =
    selectedObjs.length > 0 && textEditableSelectedObjs.length === selectedObjs.length

  const leadTextObj = textEditableSelectedObjs[0] ?? null
  const selectedTextFormat = leadTextObj
    ? richTextFormatState(
        (leadTextObj.props as unknown as StickyProps | TextProps | ShapeProps).text,
      )
    : null
  const selectedTextAlign: TextAlign = leadTextObj
    ? ((leadTextObj.props as unknown as StickyProps | TextProps | ShapeProps).align ??
      (leadTextObj.kind === 'text' ? 'left' : 'center'))
    : 'left'
  const selectedFontSize: number = leadTextObj
    ? ((leadTextObj.props as unknown as StickyProps | TextProps | ShapeProps).fontSize ??
      (leadTextObj.kind === 'text'
        ? TEXT_DEFAULT_FONT_SIZE
        : leadTextObj.kind === 'shape'
          ? SHAPE_DEFAULT_FONT_SIZE
          : STICKY_DEFAULT_FONT_SIZE))
    : STICKY_DEFAULT_FONT_SIZE

  // Compute floating dark format bar anchor above single or multi selection (never shifts layout).
  const showFormatBar = Boolean(
    (tool === 'select' && selectedObjs.length > 0) ||
    tool === 'sticky' ||
    tool === 'pen' ||
    tool === 'highlighter' ||
    tool === 'connector',
  )
  const formatBarPos = useMemo(() => {
    if (!showFormatBar) return null
    const stageW = stageSize.width
    const barW = Math.min(
      stageW - TOOLBAR_LEFT_CLEARANCE - 16,
      formatBarRef.current?.offsetWidth || (multiSelected ? 660 : 520),
    )
    if (tool === 'select' && selectedObjs.length > 0) {
      const box = selectionBounds(selectedObjs, objectsById)
      if (box) {
        const cx = pan.x + (box.x + box.width / 2) * zoom
        const topOffset = !multiSelected && selectedObj?.kind !== 'connector' ? 82 : 62
        const topY = pan.y + box.y * zoom - topOffset
        const fallbackY = pan.y + (box.y + box.height) * zoom + 22
        const clampedLeft = Math.max(
          TOOLBAR_LEFT_CLEARANCE,
          Math.min(cx - barW / 2, stageW - barW - 16),
        )
        return { left: Math.round(clampedLeft), top: Math.round(topY < 10 ? fallbackY : topY) }
      }
    }
    return {
      left: Math.max(TOOLBAR_LEFT_CLEARANCE, Math.round(stageW / 2 - barW / 2)),
      top: 14,
    }
  }, [
    multiSelected,
    objectsById,
    pan.x,
    pan.y,
    selectedObj?.kind,
    selectedObjs,
    showFormatBar,
    stageSize.width,
    tool,
    zoom,
  ])

  useEffect(() => {
    if (!pendingFitRef.current) return
    pendingFitRef.current = false
    handleFitZoom()
  }, [activePageId, displayedObjects, handleFitZoom])

  useEffect(() => {
    if (!multiSelected) setAlignMenuOpen(false)
  }, [multiSelected])

  const snapHighlightIds = useMemo(() => {
    const ids = new Set<string>()
    if (liveConnector?.startTargetId) ids.add(liveConnector.startTargetId)
    if (liveConnector?.endTargetId) ids.add(liveConnector.endTargetId)
    if (endpointPreview?.targetId) ids.add(endpointPreview.targetId)
    if (tool === 'connector' && connectorHoverObjId) ids.add(connectorHoverObjId)
    return ids
  }, [connectorHoverObjId, endpointPreview, liveConnector, tool])

  const paperFill = livePaperColor(
    activePage?.background?.kind === 'solid' || activePage?.background?.kind === 'grid'
      ? activePage.background.color
      : undefined,
  )
  const currentGridMode = pageGridMode(activePage)

  return (
    <div className="wb-main" onDragOver={handleDragOver} onDrop={(e) => void handleDrop(e)}>
      {/* Clean Warm-Paper Header */}
      <header className="wb-header">
        <div className="wb-header-start">
          {editingTitle ? (
            <input
              type="text"
              className="wb-title-input"
              value={editingTitleText}
              autoFocus
              onChange={(e) => setEditingTitleText(e.target.value)}
              onBlur={() => {
                session.setTitle(editingTitleText)
                setEditingTitle(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  session.setTitle(editingTitleText)
                  setEditingTitle(false)
                } else if (e.key === 'Escape') {
                  setEditingTitle(false)
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="wb-title-btn"
              title={t('pageRename')}
              onClick={() => {
                setEditingTitleText(doc.title || '')
                setEditingTitle(true)
              }}
            >
              {doc.title || t('untitled')}
            </button>
          )}
          <div className="wb-status-group">
            <span className="wb-status-chip">{statusText}</span>
            <label className="wb-checkbox">
              <input type="checkbox" checked={autoSave} onChange={onToggleAutoSave} />
              <span>{t('autoSave')}</span>
            </label>
          </div>
        </div>
        <div className="wb-header-end">
          <button
            type="button"
            className="wb-header-btn"
            aria-label={t('toolSearch')}
            data-tip={`${t('toolSearch')} (Ctrl+F)`}
            onClick={() => setSearchOpen((v) => !v)}
          >
            <SearchIcon size={16} />
          </button>
          <button
            type="button"
            className="wb-header-btn"
            aria-label={t('toolExport')}
            data-tip={t('toolExport')}
            onClick={() => onOpenExportModal('png')}
          >
            <ExportIcon size={16} />
            <span>{t('toolExport')}</span>
          </button>
          <QuickPrintButton
            lang={lang}
            variant="labeled"
            align="right"
            listPrinters={listPrinters}
            prefStore={quickPrintPrefStore}
            getPageCount={() => doc.pages.length}
            onOpenDialog={onPrint}
            onQuickPrint={onQuickPrint}
            onNoPrinter={onToast}
          />
          <button
            type="button"
            className="wb-header-btn wb-present-btn"
            aria-label={t('toolPresent')}
            data-tip={`${t('toolPresent')} (F5)`}
            onClick={() => onSetPresenting(true)}
          >
            <PresentIcon size={16} />
            <span>{t('toolPresent')}</span>
          </button>
        </div>
      </header>

      {/* Left Thumbnail Page Rail */}
      <nav className="wb-rail wb-pages" aria-label={t('appName')}>
        <div className="wb-rail-head">
          <span>{t('appName')}</span>
          <span className="wb-rail-count">{doc.pages.length}</span>
        </div>

        <ol className="wb-rail-list">
          {doc.pages.map((p, idx) => {
            const isCurrent = p.id === activePageId
            const pObjects = doc.objects.filter((o) => o.pageId === p.id)
            const isRenaming = renamingPageId === p.id
            return (
              <li key={p.id} className="wb-rail-item">
                <button
                  type="button"
                  className={`wb-page-tab${isCurrent ? ' active' : ''}`}
                  aria-current={isCurrent ? 'page' : undefined}
                  onClick={() => session.setActivePageId(p.id)}
                >
                  <PageThumbnail page={p} objects={pObjects} />
                </button>
                <div className="wb-rail-label">
                  {isRenaming ? (
                    <input
                      type="text"
                      className="wb-rail-rename-input"
                      value={renamingPageText}
                      autoFocus
                      onChange={(e) => setRenamingPageText(e.target.value)}
                      onBlur={() => {
                        session.renamePage(p.id, renamingPageText.trim())
                        setRenamingPageId(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          session.renamePage(p.id, renamingPageText.trim())
                          setRenamingPageId(null)
                        } else if (e.key === 'Escape') {
                          setRenamingPageId(null)
                        }
                      }}
                    />
                  ) : (
                    <span
                      className="wb-rail-label-text"
                      title={t('pageRename')}
                      onDoubleClick={() => {
                        setRenamingPageId(p.id)
                        setRenamingPageText(p.title || t('pageDefaultName', { n: idx + 1 }))
                      }}
                    >
                      <span className={`wb-rail-num${isCurrent ? ' active' : ''}`}>{idx + 1}</span>
                      {p.title || t('pageDefaultName', { n: idx + 1 })}
                    </span>
                  )}
                  {!isRenaming && (
                    <div className="wb-rail-actions">
                      {doc.pages.length > 1 && (
                        <>
                          <button
                            type="button"
                            className="wb-rail-act"
                            aria-label={t('pageMoveUp')}
                            title={t('pageMoveUp')}
                            disabled={idx === 0}
                            onClick={() => session.reorderPage(p.id, idx - 1)}
                          >
                            <ChevronUpIcon size={12} />
                          </button>
                          <button
                            type="button"
                            className="wb-rail-act"
                            aria-label={t('pageMoveDown')}
                            title={t('pageMoveDown')}
                            disabled={idx === doc.pages.length - 1}
                            onClick={() => session.reorderPage(p.id, idx + 1)}
                          >
                            <ChevronDownIcon size={12} />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="wb-rail-act"
                        aria-label={t('pageDuplicate')}
                        title={t('pageDuplicate')}
                        onClick={() => session.duplicatePage(p.id)}
                      >
                        <CopyIcon size={12} />
                      </button>
                      {doc.pages.length > 1 && (
                        <button
                          type="button"
                          className="wb-rail-act danger"
                          aria-label={t('pageDelete')}
                          title={t('pageDelete')}
                          onClick={() => session.deletePage(p.id)}
                        >
                          <TrashIcon size={12} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ol>

        <div className="wb-rail-controls">
          <button
            type="button"
            className="wb-add-page-btn"
            onClick={() =>
              session.addPage('freeform', t('pageDefaultName', { n: doc.pages.length + 1 }))
            }
          >
            + {t('pageAdd')}
          </button>
          {activePage && (
            <select
              className="wb-select"
              value={activePage.format}
              onChange={(e) => session.setPageFormat(activePage.id, e.target.value as PageFormat)}
            >
              <option value="freeform">{t('pageFormatFreeform')}</option>
              <option value="wide_16_9">{t('pageFormatWide')}</option>
              <option value="a4_portrait">{t('pageFormatA4P')}</option>
              <option value="a4_landscape">{t('pageFormatA4L')}</option>
            </select>
          )}
          <button
            type="button"
            className="wb-rail-pdf-btn"
            aria-label={t('toolImportPdf')}
            data-tip={t('toolImportPdf')}
            onClick={() => void handlePickPdf()}
          >
            <PdfIcon size={15} />
            <span>{t('toolImportPdf')}</span>
          </button>
        </div>
      </nav>

      {/* Main Canvas Stage Column */}
      <div className="wb-stage-column">
        {/* Excalidraw skipped elements banner */}
        {importSummary && importSummary.skippedCount > 0 && (
          <div className="wb-banner" role="status">
            <span>{t('excalidrawBanner', { count: importSummary.skippedCount })}</span>
            <button type="button" className="wb-btn" onClick={() => session.dismissImportBanner()}>
              {t('excalidrawBannerDismiss')}
            </button>
          </div>
        )}

        {/* Interactive SVG Canvas Stage + Floating Workspace Controls */}
        <div className="wb-stage-wrap" ref={stageRef}>
          {/* Floating Search Bar (Ctrl+F) */}
          {searchOpen && (
            <SearchBar
              query={searchQuery}
              matchCount={searchHits.length}
              activeIndex={clampedSearchIndex}
              onQueryChange={(q) => {
                setSearchQuery(q)
                setSearchIndex(0)
                const hits = searchBoardObjects(doc, q, activePageId)
                if (hits[0]) panToObject(hits[0].objectId, hits[0].pageId)
              }}
              onPrev={() => {
                if (searchHits.length === 0) return
                const next = (clampedSearchIndex - 1 + searchHits.length) % searchHits.length
                setSearchIndex(next)
                const hit = searchHits[next]!
                panToObject(hit.objectId, hit.pageId)
              }}
              onNext={() => {
                if (searchHits.length === 0) return
                const next = (clampedSearchIndex + 1) % searchHits.length
                setSearchIndex(next)
                const hit = searchHits[next]!
                panToObject(hit.objectId, hit.pageId)
              }}
              onClose={() => {
                setSearchOpen(false)
                setSearchQuery('')
              }}
            />
          )}

          {/* Left-Floating Vertical Icon Tool Rail */}
          <div className="wb-toolbar" role="toolbar" aria-orientation="vertical">
            <button
              type="button"
              className={`wb-tool-btn${tool === 'select' && !spacePanning ? ' active' : ''}`}
              aria-label={t('toolSelect')}
              data-tip={`${t('toolSelect')} (V)`}
              aria-pressed={tool === 'select' && !spacePanning}
              onClick={() => selectTool('select')}
            >
              <SelectIcon size={20} />
              <span className="wb-tool-key" aria-hidden="true">
                V
              </span>
            </button>
            <button
              type="button"
              className={`wb-tool-btn${tool === 'hand' || spacePanning ? ' active' : ''}`}
              aria-label={t('toolHand')}
              data-tip={`${t('toolHand')} (Space)`}
              aria-pressed={tool === 'hand' || spacePanning}
              onClick={() => selectTool('hand')}
            >
              <HandIcon size={20} />
            </button>
            <button
              type="button"
              className={`wb-tool-btn${tool === 'sticky' ? ' active' : ''}`}
              aria-label={t('toolSticky')}
              data-tip={`${t('toolSticky')} (N)`}
              aria-pressed={tool === 'sticky'}
              onClick={() => selectTool('sticky')}
            >
              <StickyIcon size={20} />
              <span className="wb-tool-key" aria-hidden="true">
                N
              </span>
            </button>
            <button
              type="button"
              className={`wb-tool-btn${tool === 'text' ? ' active' : ''}`}
              aria-label={t('toolText')}
              data-tip={`${t('toolText')} (T)`}
              aria-pressed={tool === 'text'}
              onClick={() => selectTool('text')}
            >
              <TextIcon size={20} />
              <span className="wb-tool-key" aria-hidden="true">
                T
              </span>
            </button>
            <button
              type="button"
              className={`wb-tool-btn${tool === 'shape' ? ' active' : ''}`}
              aria-label={t('toolShape')}
              data-tip={`${t('toolShape')} (R)`}
              aria-pressed={tool === 'shape'}
              onClick={() => {
                if (tool === 'shape') {
                  setShapePopoverOpen((v) => !v)
                } else {
                  selectTool('shape')
                  setShapePopoverOpen(true)
                }
              }}
            >
              <ShapeIcon size={20} />
              <span className="wb-tool-key" aria-hidden="true">
                R
              </span>
            </button>
            <button
              type="button"
              className={`wb-tool-btn${tool === 'connector' ? ' active' : ''}`}
              aria-label={t('toolConnector')}
              data-tip={`${t('toolConnector')} (L)`}
              aria-pressed={tool === 'connector'}
              onClick={() => selectTool('connector')}
            >
              <ConnectorIcon size={20} />
              <span className="wb-tool-key" aria-hidden="true">
                L
              </span>
            </button>
            <button
              type="button"
              className={`wb-tool-btn${tool === 'pen' ? ' active' : ''}`}
              aria-label={t('toolPen')}
              data-tip={`${t('toolPen')} (P)`}
              aria-pressed={tool === 'pen'}
              onClick={() => selectTool('pen')}
            >
              <PenIcon size={20} />
              <span className="wb-tool-key" aria-hidden="true">
                P
              </span>
            </button>
            <button
              type="button"
              className={`wb-tool-btn${tool === 'highlighter' ? ' active' : ''}`}
              aria-label={t('toolHighlighter')}
              data-tip={`${t('toolHighlighter')} (H)`}
              aria-pressed={tool === 'highlighter'}
              onClick={() => selectTool('highlighter')}
            >
              <HighlighterIcon size={20} />
              <span className="wb-tool-key" aria-hidden="true">
                H
              </span>
            </button>
            <button
              type="button"
              className={`wb-tool-btn${tool === 'eraser' ? ' active' : ''}`}
              aria-label={t('toolEraser')}
              data-tip={`${t('toolEraser')} (E)`}
              aria-pressed={tool === 'eraser'}
              onClick={() => selectTool('eraser')}
            >
              <EraserIcon size={20} />
              <span className="wb-tool-key" aria-hidden="true">
                E
              </span>
            </button>

            <div className="wb-tool-sep" role="separator" />

            <button
              type="button"
              className="wb-tool-btn"
              aria-label={t('toolImage')}
              data-tip={t('toolImage')}
              onClick={() => void handlePickImage()}
            >
              <ImageIcon size={20} />
            </button>
            <button
              type="button"
              className="wb-tool-btn"
              aria-label={t('toolTable')}
              data-tip={t('toolTable')}
              onClick={handleAddTable}
            >
              <TableIcon size={20} />
            </button>
            <button
              type="button"
              className={`wb-tool-btn${stickerOpen ? ' active' : ''}`}
              aria-label={t('toolSticker')}
              data-tip={t('toolSticker')}
              aria-pressed={stickerOpen}
              onClick={() => {
                setShapePopoverOpen(false)
                setStickerOpen((v) => !v)
              }}
            >
              <StickerToolIcon size={20} />
            </button>
            <button
              type="button"
              className="wb-tool-btn"
              aria-label={t('toolLink')}
              data-tip={t('toolLink')}
              onClick={() => {
                setStickerOpen(false)
                setShapePopoverOpen(false)
                setLinkModalOpen(true)
              }}
            >
              <LinkIcon size={20} />
            </button>
            <button
              type="button"
              className={`wb-tool-btn${templateModalOpen ? ' active' : ''}`}
              aria-label={t('toolTemplates')}
              data-tip={t('toolTemplates')}
              onClick={() => {
                setStickerOpen(false)
                setShapePopoverOpen(false)
                setTemplateModalOpen(true)
              }}
            >
              <TemplateIcon size={20} />
            </button>
          </div>

          {/* Shape Options Popover beside Vertical Tool Rail */}
          {shapePopoverOpen && (
            <div className="wb-tool-popover wb-shape-grid" role="menu">
              {SHAPE_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`wb-tool-btn${shapeKind === k ? ' active' : ''}`}
                  aria-label={k}
                  data-tip={k}
                  onClick={() => {
                    setShapeKind(k)
                    setShapePopoverOpen(false)
                  }}
                >
                  <ShapeKindGlyph kind={k} size={20} />
                </button>
              ))}
            </div>
          )}

          {/* Sticker Grid Popover beside Vertical Tool Rail */}
          {stickerOpen && (
            <div className="wb-tool-popover wb-sticker-popover" role="menu">
              {STICKER_IDS.map((sid) => (
                <button
                  key={sid}
                  type="button"
                  className="wb-sticker-btn"
                  aria-label={sid}
                  onClick={() => handleAddSticker(sid)}
                >
                  <StickerIcon stickerId={sid} size={26} />
                </button>
              ))}
            </div>
          )}

          {/* Floating Dark Contextual Format Bar (zero layout shift) */}
          {showFormatBar && formatBarPos && (
            <div
              ref={formatBarRef}
              className="wb-format-bar"
              style={{ left: formatBarPos.left, top: formatBarPos.top }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {/* Multi-selection badge */}
              {tool === 'select' && multiSelected && (
                <>
                  <span className="wb-sel-count-chip">
                    {t('selectedCount', { count: selectedObjs.length })}
                  </span>
                  <span className="wb-format-sep" />
                </>
              )}

              {/* Curated Miro/Allo pastel fills for sticky notes (single or multi) */}
              {(tool === 'sticky' || (tool === 'select' && allSelectedAreStickies)) &&
                PAPER_FILL_SWATCHES.map((c) => {
                  const currentFill =
                    tool === 'select' && selectedObjs[0]?.kind === 'sticky'
                      ? (selectedObjs[0].props as unknown as StickyProps).color
                      : activeColor
                  return (
                    <button
                      key={c}
                      type="button"
                      className={`wb-swatch${currentFill?.toUpperCase() === c ? ' active' : ''}`}
                      style={{ backgroundColor: c }}
                      onClick={() => {
                        setActiveColor(c)
                        if (tool === 'select' && allSelectedAreStickies) {
                          session.updateObjectsBatch(
                            selectedObjs.map((o) => ({ id: o.id, patch: { color: c } })),
                          )
                        }
                      }}
                    />
                  )
                })}

              {/* Harmonized fill + border presets for shapes (single or multi) */}
              {tool === 'select' &&
                allSelectedAreShapes &&
                SHAPE_STYLE_PRESETS.map((preset) => {
                  const curFill = (selectedObjs[0]!.props as unknown as ShapeProps).fill
                  const isNone = preset.fill === 'transparent'
                  const isActive =
                    curFill?.toLowerCase() === preset.fill.toLowerCase() ||
                    (isNone && curFill === 'none')
                  return (
                    <button
                      key={preset.fill}
                      type="button"
                      className={`wb-swatch${isNone ? ' wb-swatch-none' : ''}${isActive ? ' active' : ''}`}
                      style={isNone ? undefined : { backgroundColor: preset.fill }}
                      onClick={() => {
                        session.updateObjectsBatch(
                          selectedObjs.map((o) => ({
                            id: o.id,
                            patch: { fill: preset.fill, stroke: preset.stroke },
                          })),
                        )
                      }}
                    />
                  )
                })}

              {/* Highlighter color swatches & width presets */}
              {tool === 'highlighter' && (
                <>
                  {HIGHLIGHTER_SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`wb-swatch${highlighterColor.toUpperCase() === c ? ' active' : ''}`}
                      style={{ backgroundColor: c }}
                      onClick={() => setHighlighterColor(c)}
                    />
                  ))}
                  <span className="wb-format-sep" />
                  {HIGHLIGHTER_WIDTH_PRESETS.map((w) => {
                    const dotPx = w === 16 ? 7 : w === 22 ? 10 : 14
                    return (
                      <button
                        key={w}
                        type="button"
                        className={`wb-format-btn${highlighterWidth === w ? ' active' : ''}`}
                        onClick={() => setHighlighterWidth(w)}
                      >
                        <span className="wb-width-dot" style={{ width: dotPx, height: dotPx }} />
                      </button>
                    )
                  })}
                </>
              )}

              {/* Crisp ink colors for pen, connector, stroke, and text (single or multi) */}
              {(tool === 'pen' ||
                tool === 'connector' ||
                (tool === 'select' && allSelectedAreInk)) &&
                PAPER_INK_SWATCHES.map((c) => {
                  const lead = selectedObjs[0]
                  const currentInk =
                    tool === 'select' && lead?.kind === 'connector'
                      ? (lead.props as unknown as ConnectorProps).color
                      : tool === 'select' && lead?.kind === 'stroke'
                        ? (lead.props as unknown as StrokeProps).color
                        : tool === 'select' && lead?.kind === 'text'
                          ? (selectedTextFormat?.color ??
                            (lead.props as unknown as TextProps).color ??
                            PAPER_COLORS.ink)
                          : tool === 'connector'
                            ? connectorColor
                            : penColor
                  return (
                    <button
                      key={c}
                      type="button"
                      className={`wb-swatch${currentInk?.toUpperCase() === c ? ' active' : ''}`}
                      style={{ backgroundColor: c }}
                      onClick={() => {
                        if (tool === 'connector' || lead?.kind === 'connector') {
                          setConnectorColor(c)
                        } else {
                          setPenColor(c)
                        }
                        if (tool === 'select' && allSelectedAreInk) {
                          session.updateObjectsBatch(
                            selectedObjs.map((o) => {
                              if (o.kind === 'text') {
                                const tp = o.props as unknown as TextProps
                                return {
                                  id: o.id,
                                  patch: { color: c, text: setRichTextColor(tp.text, c) },
                                }
                              }
                              return { id: o.id, patch: { color: c } }
                            }),
                          )
                        }
                      }}
                    />
                  )
                })}

              {/* Optional text box background pill/card toggle */}
              {tool === 'select' &&
                selectedObj?.kind === 'text' &&
                !isObjectLocked(selectedObj) && (
                  <>
                    <span className="wb-format-sep" />
                    <button
                      type="button"
                      className={`wb-format-btn${
                        (selectedObj.props as unknown as TextProps).background &&
                        (selectedObj.props as unknown as TextProps).background !== 'transparent'
                          ? ' active'
                          : ''
                      }`}
                      onClick={handleCycleTextBackground}
                    >
                      <TextBgIcon size={16} />
                    </button>
                  </>
                )}

              {/* Rich text controls (size stepper, B/I/U/S, align) for single or multi text-editable */}
              {tool === 'select' && allSelectedAreTextEditable && selectedTextFormat && (
                <>
                  <span className="wb-format-sep" />
                  <div className="wb-size-stepper">
                    <button
                      type="button"
                      className="wb-format-btn"
                      onClick={() => handleStepFontSize(-1)}
                    >
                      <MinusIcon size={13} />
                    </button>
                    <button type="button" className="wb-size-val" onClick={handleCycleFontSize}>
                      {selectedFontSize}
                    </button>
                    <button
                      type="button"
                      className="wb-format-btn"
                      onClick={() => handleStepFontSize(1)}
                    >
                      <PlusIcon size={13} />
                    </button>
                  </div>
                  <button
                    type="button"
                    className={`wb-format-btn${selectedTextFormat.bold ? ' active' : ''}`}
                    aria-pressed={selectedTextFormat.bold}
                    onClick={() => handleToggleMark('bold')}
                  >
                    <strong>B</strong>
                  </button>
                  <button
                    type="button"
                    className={`wb-format-btn${selectedTextFormat.italic ? ' active' : ''}`}
                    aria-pressed={selectedTextFormat.italic}
                    onClick={() => handleToggleMark('italic')}
                  >
                    <em style={{ fontFamily: 'Georgia, serif' }}>I</em>
                  </button>
                  <button
                    type="button"
                    className={`wb-format-btn${selectedTextFormat.underline ? ' active' : ''}`}
                    aria-pressed={selectedTextFormat.underline}
                    onClick={() => handleToggleMark('underline')}
                  >
                    <span style={{ textDecoration: 'underline' }}>U</span>
                  </button>
                  <button
                    type="button"
                    className={`wb-format-btn${selectedTextFormat.strike ? ' active' : ''}`}
                    aria-pressed={selectedTextFormat.strike}
                    onClick={() => handleToggleMark('strike')}
                  >
                    <span style={{ textDecoration: 'line-through' }}>S</span>
                  </button>
                  <button type="button" className="wb-format-btn" onClick={handleCycleAlign}>
                    {selectedTextAlign === 'center' ? (
                      <AlignCenterIcon size={16} />
                    ) : selectedTextAlign === 'right' ? (
                      <AlignRightIcon size={16} />
                    ) : (
                      <AlignLeftIcon size={16} />
                    )}
                  </button>
                </>
              )}

              {/* Shape kind cycle & border style for single unlocked shape */}
              {tool === 'select' &&
                selectedObj?.kind === 'shape' &&
                !isObjectLocked(selectedObj) && (
                  <>
                    <span className="wb-format-sep" />
                    <button
                      type="button"
                      className="wb-format-btn"
                      title={t('toolShape')}
                      onClick={() => {
                        const cur = (selectedObj.props as unknown as ShapeProps).shape
                        session.updateObject(selectedObj.id, {
                          shape: nextCycleValue(SHAPE_KINDS, cur),
                        })
                      }}
                    >
                      <ShapeKindGlyph
                        kind={(selectedObj.props as unknown as ShapeProps).shape}
                        size={16}
                      />
                    </button>
                    <button
                      type="button"
                      className={`wb-format-btn${
                        ((selectedObj.props as unknown as ShapeProps).lineStyle ?? 'solid') !==
                        'solid'
                          ? ' active'
                          : ''
                      }`}
                      onClick={() => {
                        const cur =
                          (selectedObj.props as unknown as ShapeProps).lineStyle ?? 'solid'
                        session.updateObject(selectedObj.id, {
                          lineStyle: nextCycleValue(LINE_STYLE_CYCLE, cur),
                        })
                      }}
                    >
                      {(selectedObj.props as unknown as ShapeProps).lineStyle === 'dashed' ? (
                        <DashedLineIcon size={17} />
                      ) : (selectedObj.props as unknown as ShapeProps).lineStyle === 'dotted' ? (
                        <DottedLineIcon size={17} />
                      ) : (
                        <SolidLineIcon size={17} />
                      )}
                    </button>
                  </>
                )}

              {/* Table row/col/header/font controls */}
              {tool === 'select' &&
                selectedObj?.kind === 'table' &&
                !isObjectLocked(selectedObj) &&
                (() => {
                  const tp = selectedObj.props as unknown as TableProps
                  const rows = tp.rowIds?.length || 1
                  const cols = tp.colIds?.length || 1
                  return (
                    <>
                      <button
                        type="button"
                        className="wb-format-text-btn"
                        onClick={() => session.updateTable(selectedObj.id, { rows: rows + 1 })}
                      >
                        {t('tableAddRow')}
                      </button>
                      <button
                        type="button"
                        className="wb-format-text-btn"
                        disabled={rows <= 1}
                        onClick={() => session.updateTable(selectedObj.id, { rows: rows - 1 })}
                      >
                        {t('tableDelRow')}
                      </button>
                      <span className="wb-format-sep" />
                      <button
                        type="button"
                        className="wb-format-text-btn"
                        onClick={() => session.updateTable(selectedObj.id, { cols: cols + 1 })}
                      >
                        {t('tableAddCol')}
                      </button>
                      <button
                        type="button"
                        className="wb-format-text-btn"
                        disabled={cols <= 1}
                        onClick={() => session.updateTable(selectedObj.id, { cols: cols - 1 })}
                      >
                        {t('tableDelCol')}
                      </button>
                      <span className="wb-format-sep" />
                      <button
                        type="button"
                        className={`wb-format-text-btn${tp.headerRow ? ' active' : ''}`}
                        onClick={() =>
                          session.updateTable(selectedObj.id, { headerRow: !tp.headerRow })
                        }
                      >
                        {t('tableHeaderRow')}
                      </button>
                    </>
                  )
                })()}

              {/* Connector routing (Straight / Curved / Elbow) when tool active or connector selected */}
              {(tool === 'connector' ||
                (tool === 'select' &&
                  selectedObj?.kind === 'connector' &&
                  !isObjectLocked(selectedObj))) && (
                <>
                  <span className="wb-format-sep" />
                  <div className="wb-format-seg" role="group">
                    {(
                      [
                        ['straight', StraightRouteIcon],
                        ['curved', CurvedRouteIcon],
                        ['elbow', ElbowRouteIcon],
                      ] as const
                    ).map(([route, Icon]) => {
                      const curRoute: ConnectorRouting =
                        tool === 'select' && selectedObj?.kind === 'connector'
                          ? ((selectedObj.props as unknown as ConnectorProps).routing ?? 'straight')
                          : connectorRouting
                      return (
                        <button
                          key={route}
                          type="button"
                          className={`wb-format-btn${curRoute === route ? ' active' : ''}`}
                          onClick={() => {
                            setConnectorRouting(route)
                            if (tool === 'select' && selectedObj?.kind === 'connector') {
                              session.updateObject(selectedObj.id, { props: { routing: route } })
                            }
                          }}
                        >
                          <Icon size={16} />
                        </button>
                      )
                    })}
                  </div>
                </>
              )}

              {/* Connector width, 4-way arrowhead caps, and solid/dashed/dotted toggle */}
              {tool === 'select' &&
                selectedObj?.kind === 'connector' &&
                !isObjectLocked(selectedObj) && (
                  <>
                    <span className="wb-format-sep" />
                    {CONNECTOR_WIDTH_PRESETS.map((w) => {
                      const curW = (selectedObj.props as unknown as ConnectorProps).strokeWidth ?? 2
                      const nearestW = CONNECTOR_WIDTH_PRESETS.reduce((best, cand) =>
                        Math.abs(cand - curW) < Math.abs(best - curW) ? cand : best,
                      )
                      const dotPx = w === 1.5 ? 4 : w === 2.5 ? 7 : 10
                      return (
                        <button
                          key={w}
                          type="button"
                          className={`wb-format-btn${nearestW === w ? ' active' : ''}`}
                          onClick={() => session.updateObject(selectedObj.id, { strokeWidth: w })}
                        >
                          <span className="wb-width-dot" style={{ width: dotPx, height: dotPx }} />
                        </button>
                      )
                    })}
                    <button
                      type="button"
                      className={`wb-format-btn${
                        ((selectedObj.props as unknown as ConnectorProps).startHead ?? 'none') !==
                        'none'
                          ? ' active'
                          : ''
                      }`}
                      onClick={() => {
                        const cur =
                          (selectedObj.props as unknown as ConnectorProps).startHead ?? 'none'
                        session.updateObject(selectedObj.id, {
                          props: { startHead: nextCycleValue(CONNECTOR_HEAD_CYCLE, cur) },
                        })
                      }}
                    >
                      {(() => {
                        const h =
                          (selectedObj.props as unknown as ConnectorProps).startHead ?? 'none'
                        if (h === 'arrow') return <ArrowStartIcon size={17} />
                        if (h === 'triangle') return <StealthStartIcon size={17} />
                        if (h === 'circle') return <CircleStartIcon size={17} />
                        return <LineEndIcon size={17} />
                      })()}
                    </button>
                    <button
                      type="button"
                      className={`wb-format-btn${
                        ((selectedObj.props as unknown as ConnectorProps).endHead ?? 'arrow') !==
                        'none'
                          ? ' active'
                          : ''
                      }`}
                      onClick={() => {
                        const cur =
                          (selectedObj.props as unknown as ConnectorProps).endHead ?? 'arrow'
                        session.updateObject(selectedObj.id, {
                          props: { endHead: nextCycleValue(CONNECTOR_HEAD_CYCLE, cur) },
                        })
                      }}
                    >
                      {(() => {
                        const h =
                          (selectedObj.props as unknown as ConnectorProps).endHead ?? 'arrow'
                        if (h === 'arrow') return <ArrowEndIcon size={17} />
                        if (h === 'triangle') return <StealthEndIcon size={17} />
                        if (h === 'circle') return <CircleEndIcon size={17} />
                        return <LineEndIcon size={17} />
                      })()}
                    </button>
                    <button
                      type="button"
                      className={`wb-format-btn${
                        ((selectedObj.props as unknown as ConnectorProps).lineStyle ?? 'solid') !==
                        'solid'
                          ? ' active'
                          : ''
                      }`}
                      onClick={() => {
                        const cur =
                          (selectedObj.props as unknown as ConnectorProps).lineStyle ?? 'solid'
                        session.updateObject(selectedObj.id, {
                          lineStyle: nextCycleValue(LINE_STYLE_CYCLE, cur),
                        })
                      }}
                    >
                      {(selectedObj.props as unknown as ConnectorProps).lineStyle === 'dashed' ? (
                        <DashedLineIcon size={17} />
                      ) : (selectedObj.props as unknown as ConnectorProps).lineStyle ===
                        'dotted' ? (
                        <DottedLineIcon size={17} />
                      ) : (
                        <SolidLineIcon size={17} />
                      )}
                    </button>
                  </>
                )}

              {/* Pen stroke width picker */}
              {tool === 'pen' && (
                <>
                  <span className="wb-format-sep" />
                  {LINE_WIDTH_PRESETS.map((w) => {
                    const dotPx = w === 2 ? 5 : w === 4 ? 8 : 12
                    return (
                      <button
                        key={w}
                        type="button"
                        className={`wb-format-btn${penWidth === w ? ' active' : ''}`}
                        onClick={() => setPenWidth(w)}
                      >
                        <span className="wb-width-dot" style={{ width: dotPx, height: dotPx }} />
                      </button>
                    )
                  })}
                </>
              )}

              {/* Multi-selection Align & Distribute compact popover trigger */}
              {tool === 'select' && multiSelected && hasUnlockedSelection && (
                <>
                  <span className="wb-format-sep" />
                  <div className="wb-format-anchor">
                    <button
                      type="button"
                      className={`wb-format-btn${alignMenuOpen ? ' active' : ''}`}
                      aria-label={t('ctxAlign')}
                      title={t('ctxAlign')}
                      aria-expanded={alignMenuOpen}
                      onClick={() => setAlignMenuOpen((v) => !v)}
                    >
                      <AlignObjLeftIcon size={16} />
                    </button>
                    {alignMenuOpen && (
                      <div className="wb-align-popover" role="menu">
                        <button
                          type="button"
                          className="wb-format-btn"
                          aria-label={t('alignLeft')}
                          title={t('alignLeft')}
                          onClick={() => {
                            handleAlignSelected('left')
                            setAlignMenuOpen(false)
                          }}
                        >
                          <AlignObjLeftIcon size={16} />
                        </button>
                        <button
                          type="button"
                          className="wb-format-btn"
                          aria-label={t('alignCenterH')}
                          title={t('alignCenterH')}
                          onClick={() => {
                            handleAlignSelected('center')
                            setAlignMenuOpen(false)
                          }}
                        >
                          <AlignObjCenterHIcon size={16} />
                        </button>
                        <button
                          type="button"
                          className="wb-format-btn"
                          aria-label={t('alignRight')}
                          title={t('alignRight')}
                          onClick={() => {
                            handleAlignSelected('right')
                            setAlignMenuOpen(false)
                          }}
                        >
                          <AlignObjRightIcon size={16} />
                        </button>
                        <button
                          type="button"
                          className="wb-format-btn"
                          aria-label={t('alignTop')}
                          title={t('alignTop')}
                          onClick={() => {
                            handleAlignSelected('top')
                            setAlignMenuOpen(false)
                          }}
                        >
                          <AlignObjTopIcon size={16} />
                        </button>
                        <button
                          type="button"
                          className="wb-format-btn"
                          aria-label={t('alignMiddleV')}
                          title={t('alignMiddleV')}
                          onClick={() => {
                            handleAlignSelected('middle')
                            setAlignMenuOpen(false)
                          }}
                        >
                          <AlignObjMiddleVIcon size={16} />
                        </button>
                        <button
                          type="button"
                          className="wb-format-btn"
                          aria-label={t('alignBottom')}
                          title={t('alignBottom')}
                          onClick={() => {
                            handleAlignSelected('bottom')
                            setAlignMenuOpen(false)
                          }}
                        >
                          <AlignObjBottomIcon size={16} />
                        </button>
                        {selectedObjs.length >= 3 && (
                          <>
                            <button
                              type="button"
                              className="wb-format-btn"
                              aria-label={t('distributeH')}
                              title={t('distributeH')}
                              onClick={() => {
                                handleDistributeSelected('horizontal')
                                setAlignMenuOpen(false)
                              }}
                            >
                              <DistributeHIcon size={16} />
                            </button>
                            <button
                              type="button"
                              className="wb-format-btn"
                              aria-label={t('distributeV')}
                              title={t('distributeV')}
                              onClick={() => {
                                handleDistributeSelected('vertical')
                                setAlignMenuOpen(false)
                              }}
                            >
                              <DistributeVIcon size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Object actions: group/ungroup, lock/unlock, layer order, duplicate, delete */}
              {tool === 'select' && selectedObjs.length > 0 && (
                <>
                  <span className="wb-format-sep" />
                  {canGroupSelection && !canUngroupSelection && (
                    <button
                      type="button"
                      className="wb-format-btn"
                      aria-label={t('ctxGroup')}
                      title={`${t('ctxGroup')} (Ctrl+G)`}
                      onClick={handleGroupSelected}
                    >
                      <GroupIcon size={15} />
                    </button>
                  )}
                  {canUngroupSelection && (
                    <button
                      type="button"
                      className="wb-format-btn active"
                      aria-label={t('ctxUngroup')}
                      title={`${t('ctxUngroup')} (Ctrl+Shift+G)`}
                      onClick={handleUngroupSelected}
                    >
                      <UngroupIcon size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    className={`wb-format-btn${allSelectedLocked ? ' active' : ''}`}
                    aria-label={allSelectedLocked ? t('ctxUnlock') : t('ctxLock')}
                    title={`${allSelectedLocked ? t('ctxUnlock') : t('ctxLock')} (Ctrl+Shift+L)`}
                    onClick={handleToggleLockSelected}
                  >
                    {allSelectedLocked ? <LockIcon size={15} /> : <UnlockIcon size={15} />}
                  </button>
                  <button
                    type="button"
                    className="wb-format-btn"
                    aria-label={t('toolBringFront')}
                    title={t('toolBringFront')}
                    onClick={() => handleLayerOrder('front')}
                  >
                    <FrontIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className="wb-format-btn"
                    aria-label={t('toolSendBack')}
                    title={t('toolSendBack')}
                    onClick={() => handleLayerOrder('back')}
                  >
                    <BackIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className="wb-format-btn"
                    aria-label={t('toolDuplicate')}
                    title={`${t('toolDuplicate')} (Ctrl+D)`}
                    onClick={handleDuplicateSelected}
                  >
                    <DuplicateIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className="wb-format-btn danger"
                    aria-label={t('toolDelete')}
                    title={t('toolDelete')}
                    disabled={!hasUnlockedSelection}
                    onClick={handleDeleteSelected}
                  >
                    <TrashIcon size={16} />
                  </button>
                </>
              )}
            </div>
          )}

          {/* Bottom-Left Floating Undo/Redo + Zoom/Fit + Grid Pill Groups */}
          <div className="wb-bottom-left">
            <div className="wb-control-group" role="group">
              <button
                type="button"
                className="wb-ctrl-btn"
                aria-label={t('toolUndo')}
                data-tip={`${t('toolUndo')} (Ctrl+Z)`}
                disabled={!session.canUndo()}
                onClick={() => session.undo()}
              >
                <UndoIcon size={18} />
              </button>
              <button
                type="button"
                className="wb-ctrl-btn"
                aria-label={t('toolRedo')}
                data-tip={`${t('toolRedo')} (Ctrl+Y)`}
                disabled={!session.canRedo()}
                onClick={() => session.redo()}
              >
                <RedoIcon size={18} />
              </button>
            </div>

            <div className="wb-control-group" role="group">
              <button
                type="button"
                className="wb-ctrl-btn"
                aria-label="-"
                onClick={() => zoomAroundCenter(zoom - 0.15)}
              >
                <MinusIcon size={16} />
              </button>
              <button
                type="button"
                className="wb-zoom-level"
                data-tip={t('zoomFit')}
                onClick={handleFitZoom}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                className="wb-ctrl-btn"
                aria-label="+"
                onClick={() => zoomAroundCenter(zoom + 0.15)}
              >
                <PlusIcon size={16} />
              </button>
              <button
                type="button"
                className="wb-ctrl-btn"
                aria-label={t('zoomFit')}
                data-tip={t('zoomFit')}
                onClick={handleFitZoom}
              >
                <FitIcon size={16} />
              </button>
            </div>

            {activePage && activePage.background.kind !== 'image' && (
              <div className="wb-control-group" role="group">
                <button
                  type="button"
                  className="wb-ctrl-btn"
                  aria-label={
                    currentGridMode === 'dot'
                      ? t('gridDot')
                      : currentGridMode === 'line'
                        ? t('gridLine')
                        : t('gridBlank')
                  }
                  title={
                    currentGridMode === 'dot'
                      ? t('gridDot')
                      : currentGridMode === 'line'
                        ? t('gridLine')
                        : t('gridBlank')
                  }
                  onClick={() =>
                    session.setPageGridMode(activePage.id, nextGridMode(currentGridMode))
                  }
                >
                  {currentGridMode === 'dot' ? (
                    <GridDotIcon size={16} />
                  ) : currentGridMode === 'line' ? (
                    <GridLineIcon size={16} />
                  ) : (
                    <GridBlankIcon size={16} />
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Bottom-Right Interactive Minimap & Toggle */}
          {activePage && (
            <div className="wb-bottom-right">
              {minimapOpen && (
                <Minimap
                  page={activePage}
                  objects={displayedObjects}
                  pan={pan}
                  zoom={zoom}
                  stageWidth={stageSize.width}
                  stageHeight={stageSize.height}
                  onPanTo={setPan}
                />
              )}
              <div className="wb-control-group" role="group">
                <button
                  type="button"
                  className={`wb-ctrl-btn${minimapOpen ? ' active' : ''}`}
                  aria-label={t('minimapToggle')}
                  title={t('minimapToggle')}
                  aria-pressed={minimapOpen}
                  onClick={() => setMinimapOpen((v) => !v)}
                >
                  <MinimapIcon size={16} />
                </button>
              </div>
            </div>
          )}

          <svg
            className={`wb-stage-svg${isPanning ? ' wb-panning' : spacePanning || tool === 'hand' ? ' wb-space-pan' : ''}`}
            style={{
              cursor: isPanning
                ? 'grabbing'
                : spacePanning || tool === 'hand'
                  ? 'grab'
                  : tool === 'connector' ||
                      tool === 'shape' ||
                      tool === 'sticky' ||
                      tool === 'pen' ||
                      tool === 'highlighter'
                    ? 'crosshair'
                    : tool === 'text'
                      ? 'text'
                      : tool === 'eraser'
                        ? 'cell'
                        : 'default',
            }}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={handleStagePointerDown}
            onPointerMove={handleStagePointerMove}
            onPointerUp={handleStagePointerUp}
            onPointerCancel={handleStagePointerUp}
            onLostPointerCapture={() => {
              if (dragRef.current?.kind === 'pan') {
                dragRef.current = null
                setIsPanning(false)
              }
            }}
            onWheel={(e) => {
              if (e.ctrlKey || e.metaKey) {
                e.preventDefault()
                const rect = stageRef.current?.getBoundingClientRect()
                if (!rect) return
                const factor = e.deltaY < 0 ? 1.1 : 0.9
                zoomAroundScreenPoint(zoom * factor, e.clientX - rect.left, e.clientY - rect.top)
              } else {
                setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }))
              }
            }}
          >
            <defs>
              <pattern id="wb-dot-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="12" cy="12" r="1.05" fill="#1F1D1A" fillOpacity="0.14" />
              </pattern>
              <pattern id="wb-line-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#E4DFD5" strokeWidth="1" />
              </pattern>
              <filter id="wb-sticky-shadow" x="-16%" y="-14%" width="132%" height="138%">
                <feDropShadow
                  dx="0"
                  dy="1"
                  stdDeviation="1.2"
                  floodColor="#1F1D1A"
                  floodOpacity="0.07"
                />
                <feDropShadow
                  dx="0"
                  dy="5"
                  stdDeviation="6"
                  floodColor="#1F1D1A"
                  floodOpacity="0.09"
                />
              </filter>
              <filter id="wb-sticky-lift" x="-18%" y="-40%" width="136%" height="220%">
                <feGaussianBlur stdDeviation="3.4" />
              </filter>
              <linearGradient id="wb-sticky-sheen" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.24" />
                <stop offset="22%" stopColor="#FFFFFF" stopOpacity="0" />
              </linearGradient>
              <filter id="wb-paper-card-shadow" x="-12%" y="-10%" width="124%" height="130%">
                <feDropShadow
                  dx="0"
                  dy="1"
                  stdDeviation="1.4"
                  floodColor="#1F1D1A"
                  floodOpacity="0.06"
                />
                <feDropShadow
                  dx="0"
                  dy="3"
                  stdDeviation="5"
                  floodColor="#1F1D1A"
                  floodOpacity="0.06"
                />
              </filter>
            </defs>

            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {/* Fixed or freeform page paper (theme-invariant warm ivory paper #FFFDF8) */}
              {activePage && activePage.format !== 'freeform' ? (
                <g className="wb-paper-shadow">
                  <rect
                    x={0}
                    y={0}
                    width={activePage.width}
                    height={activePage.height}
                    fill={paperFill}
                    rx={6}
                  />
                  {activePage.background?.kind !== 'image' && currentGridMode !== 'blank' && (
                    <rect
                      x={0}
                      y={0}
                      width={activePage.width}
                      height={activePage.height}
                      fill={currentGridMode === 'line' ? 'url(#wb-line-grid)' : 'url(#wb-dot-grid)'}
                      rx={6}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                  {activePage.background?.kind === 'image' &&
                    (() => {
                      const href = session.getResourceDataUrl(activePage.background.resourceId)
                      return href ? (
                        <image
                          href={href}
                          x={0}
                          y={0}
                          width={activePage.width}
                          height={activePage.height}
                          preserveAspectRatio="xMidYMid meet"
                          style={{ pointerEvents: 'none' }}
                        />
                      ) : null
                    })()}
                </g>
              ) : (
                <>
                  <rect x={-4000} y={-4000} width={8000} height={8000} fill={paperFill} />
                  {currentGridMode !== 'blank' && (
                    <rect
                      x={-4000}
                      y={-4000}
                      width={8000}
                      height={8000}
                      fill={currentGridMode === 'line' ? 'url(#wb-line-grid)' : 'url(#wb-dot-grid)'}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                </>
              )}

              {/* Board objects */}
              {displayedObjects.map((obj) => {
                const isSelected = selectedIdSet.has(obj.id)
                const isLocked = isObjectLocked(obj)
                const isHovered =
                  tool === 'select' && !spacePanning && hoveredId === obj.id && !isSelected
                const isHighlighted = highlightSet.has(obj.id)
                const isSearchMatch = searchHitIdSet.has(obj.id)
                const isErasing = Boolean(erasingIds?.has(obj.id))
                const isSnapTarget = snapHighlightIds.has(obj.id)
                const invZ = 1 / zoom
                const handleR = 4.6 * invZ

                return (
                  <g
                    key={obj.id}
                    data-object-id={obj.id}
                    data-object-kind={obj.kind}
                    transform={
                      obj.rotation
                        ? `rotate(${obj.rotation} ${obj.x + obj.width / 2} ${obj.y + obj.height / 2})`
                        : undefined
                    }
                    onPointerEnter={() => setHoveredId(obj.id)}
                    onPointerLeave={() => setHoveredId((prev) => (prev === obj.id ? null : prev))}
                    onPointerDown={(e) => handleObjectPointerDown(e, obj)}
                    onDoubleClick={(e) => startInlineEdit(obj, { x: e.clientX, y: e.clientY })}
                    style={{
                      opacity: isErasing ? 0.35 : 1,
                      cursor: isPanning
                        ? 'grabbing'
                        : spacePanning || tool === 'hand'
                          ? 'grab'
                          : tool === 'eraser'
                            ? 'crosshair'
                            : tool === 'select'
                              ? isLocked
                                ? 'not-allowed'
                                : obj.kind === 'connector'
                                  ? 'pointer'
                                  : 'move'
                              : 'inherit',
                      ...(spacePanning || isPanning ? { pointerEvents: 'none' } : {}),
                    }}
                  >
                    {renderObjectElement(
                      obj,
                      objectsById,
                      session,
                      handleOpenLinkCard,
                      isSelected,
                      editingId === obj.id,
                      t('defaultStickyText'),
                      t('defaultText'),
                    )}

                    {/* Subtle Miro/Allo hover outline on unselected boxes */}
                    {isHovered && obj.kind !== 'connector' && obj.kind !== 'stroke' && (
                      <rect
                        className="wb-hover-rect"
                        x={obj.x - 1 * invZ}
                        y={obj.y - 1 * invZ}
                        width={obj.width + 2 * invZ}
                        height={obj.height + 2 * invZ}
                        rx={4 * invZ}
                        strokeWidth={1.5 * invZ}
                      />
                    )}

                    {/* Search match ring */}
                    {isSearchMatch &&
                      (() => {
                        const sb = objectBounds(obj, objectsById)
                        return (
                          <rect
                            className="wb-search-highlight"
                            x={sb.x - 4 * invZ}
                            y={sb.y - 4 * invZ}
                            width={sb.width + 8 * invZ}
                            height={sb.height + 8 * invZ}
                            rx={6 * invZ}
                            strokeWidth={2.4 * invZ}
                          />
                        )
                      })()}

                    {/* Drag-eraser preview overlay */}
                    {isErasing &&
                      (() => {
                        const eb = objectBounds(obj, objectsById)
                        return (
                          <rect
                            className="wb-erase-preview"
                            x={eb.x - 2 * invZ}
                            y={eb.y - 2 * invZ}
                            width={eb.width + 4 * invZ}
                            height={eb.height + 4 * invZ}
                            rx={5 * invZ}
                            strokeWidth={1.8 * invZ}
                            strokeDasharray={`${4 * invZ} ${3 * invZ}`}
                          />
                        )
                      })()}

                    {/* Teal snap outline + 4 edge anchor dots when hovering/snapping a connector */}
                    {isSnapTarget && obj.kind !== 'connector' && obj.kind !== 'stroke' && (
                      <>
                        <rect
                          className="wb-attach-rect"
                          x={obj.x - 3 * invZ}
                          y={obj.y - 3 * invZ}
                          width={obj.width + 6 * invZ}
                          height={obj.height + 6 * invZ}
                          rx={6 * invZ}
                          strokeWidth={1.6 * invZ}
                          strokeDasharray={`${4 * invZ} ${3 * invZ}`}
                        />
                        {SIDE_ANCHORS.map((side, si) => (
                          <circle
                            key={si}
                            cx={obj.x + obj.width * side.anchorX}
                            cy={obj.y + obj.height * side.anchorY}
                            r={4.2 * invZ}
                            fill={PAPER_COLORS.paper}
                            stroke={PAPER_COLORS.live}
                            strokeWidth={1.8 * invZ}
                            style={{ pointerEvents: 'none' }}
                          />
                        ))}
                      </>
                    )}

                    {/* Amber AI change highlight */}
                    {isHighlighted &&
                      (() => {
                        const hb = objectBounds(obj, objectsById)
                        return (
                          <rect
                            className="wb-ai-highlight-rect"
                            x={hb.x - 5}
                            y={hb.y - 5}
                            width={hb.width + 10}
                            height={hb.height + 10}
                            rx={8}
                          />
                        )
                      })()}

                    {/* Selection frame: crisp outline + 8 resize handles + rotation handle + quick-connect dots */}
                    {isSelected && obj.kind !== 'connector' && (
                      <>
                        <rect
                          className={`wb-selection-rect${multiSelected ? ' wb-selection-member' : ''}`}
                          x={obj.x}
                          y={obj.y}
                          width={obj.width}
                          height={obj.height}
                          rx={2 * invZ}
                          strokeWidth={(multiSelected ? 1.2 : 1.6) * invZ}
                          strokeDasharray={isLocked ? `${4 * invZ} ${3 * invZ}` : undefined}
                        />
                        {isLocked && (
                          <g
                            transform={`translate(${obj.x + obj.width - 14 * invZ}, ${obj.y - 10 * invZ})`}
                            style={{ pointerEvents: 'none' }}
                          >
                            <circle r={9 * invZ} fill={PAPER_COLORS.ink} />
                            <rect
                              x={-4 * invZ}
                              y={-1 * invZ}
                              width={8 * invZ}
                              height={6 * invZ}
                              rx={1.5 * invZ}
                              fill={PAPER_COLORS.paper}
                            />
                            <path
                              d={`M ${-2.4 * invZ} ${-1 * invZ} V ${-3.2 * invZ} a ${2.4 * invZ} ${2.4 * invZ} 0 0 1 ${4.8 * invZ} 0 V ${-1 * invZ}`}
                              fill="none"
                              stroke={PAPER_COLORS.paper}
                              strokeWidth={1.4 * invZ}
                            />
                          </g>
                        )}
                        {!multiSelected && !isLocked && (
                          <>
                            {boxResizeHandles({
                              x: obj.x,
                              y: obj.y,
                              width: obj.width,
                              height: obj.height,
                            }).map((h) =>
                              h.corner ? (
                                <circle
                                  key={h.handle}
                                  className="wb-resize-handle"
                                  cx={h.x}
                                  cy={h.y}
                                  r={handleR}
                                  fill={PAPER_COLORS.cardBg}
                                  stroke={PAPER_COLORS.accent}
                                  strokeWidth={1.6 * invZ}
                                  style={{ cursor: HANDLE_CURSORS[h.handle] }}
                                  onPointerDown={(e) => handleResizePointerDown(e, obj, h.handle)}
                                />
                              ) : (
                                <rect
                                  key={h.handle}
                                  className="wb-resize-handle"
                                  x={h.x - (h.handle === 'n' || h.handle === 's' ? 7 : 3.2) * invZ}
                                  y={h.y - (h.handle === 'n' || h.handle === 's' ? 3.2 : 7) * invZ}
                                  width={(h.handle === 'n' || h.handle === 's' ? 14 : 6.4) * invZ}
                                  height={(h.handle === 'n' || h.handle === 's' ? 6.4 : 14) * invZ}
                                  rx={3 * invZ}
                                  fill={PAPER_COLORS.cardBg}
                                  stroke={PAPER_COLORS.accent}
                                  strokeWidth={1.4 * invZ}
                                  style={{ cursor: HANDLE_CURSORS[h.handle] }}
                                  onPointerDown={(e) => handleResizePointerDown(e, obj, h.handle)}
                                />
                              ),
                            )}
                            {/* Rotation lollipop handle above top center */}
                            {editingId !== obj.id && (
                              <>
                                <line
                                  className="wb-rotate-stem"
                                  x1={obj.x + obj.width / 2}
                                  y1={obj.y}
                                  x2={obj.x + obj.width / 2}
                                  y2={obj.y - 24 * invZ}
                                  strokeWidth={1.4 * invZ}
                                />
                                <circle
                                  className="wb-rotate-handle"
                                  cx={obj.x + obj.width / 2}
                                  cy={obj.y - 24 * invZ}
                                  r={5.2 * invZ}
                                  fill={PAPER_COLORS.cardBg}
                                  stroke={PAPER_COLORS.accent}
                                  strokeWidth={1.6 * invZ}
                                  onPointerDown={(e) => handleRotatePointerDown(e, obj)}
                                />
                              </>
                            )}
                          </>
                        )}
                        {obj.kind !== 'stroke' &&
                          !multiSelected &&
                          editingId !== obj.id &&
                          SIDE_ANCHORS.map((side, si) => {
                            const portOffset = 18 * invZ
                            return (
                              <circle
                                key={`qp-${si}`}
                                className="wb-quick-port"
                                cx={obj.x + obj.width * side.anchorX + side.nx * portOffset}
                                cy={obj.y + obj.height * side.anchorY + side.ny * portOffset}
                                r={4.2 * invZ}
                                strokeWidth={1.4 * invZ}
                                onPointerDown={(e) =>
                                  handleQuickPortPointerDown(e, obj, side.anchorX, side.anchorY)
                                }
                              />
                            )
                          })}
                      </>
                    )}

                    {isSelected &&
                      !multiSelected &&
                      !isLocked &&
                      obj.kind === 'connector' &&
                      (() => {
                        const cp = obj.props as unknown as ConnectorProps
                        const sp = resolveConnectorEnd(cp.start, objectsById)
                        const ep = resolveConnectorEnd(cp.end, objectsById)
                        const r = 5 * invZ
                        return (
                          <>
                            <circle
                              className="wb-resize-handle"
                              cx={sp.x}
                              cy={sp.y}
                              r={r}
                              fill={PAPER_COLORS.cardBg}
                              stroke={PAPER_COLORS.accent}
                              strokeWidth={1.8 * invZ}
                              style={{ cursor: 'move' }}
                              onPointerDown={(e) => handleEndpointPointerDown(e, obj, 'start')}
                            />
                            <circle
                              className="wb-resize-handle"
                              cx={ep.x}
                              cy={ep.y}
                              r={r}
                              fill={PAPER_COLORS.cardBg}
                              stroke={PAPER_COLORS.accent}
                              strokeWidth={1.8 * invZ}
                              style={{ cursor: 'move' }}
                              onPointerDown={(e) => handleEndpointPointerDown(e, obj, 'end')}
                            />
                          </>
                        )
                      })()}
                  </g>
                )
              })}

              {/* Alt+Drag clone ghost preview */}
              {multiMoveDelta?.isClone && (
                <g
                  transform={`translate(${multiMoveDelta.dx}, ${multiMoveDelta.dy})`}
                  opacity={0.55}
                  style={{ pointerEvents: 'none' }}
                >
                  {displayedObjects
                    .filter((o) => multiMoveDelta.ids.has(o.id) && o.kind !== 'connector')
                    .map((o) => (
                      <rect
                        key={`ghost-${o.id}`}
                        x={o.x}
                        y={o.y}
                        width={o.width}
                        height={o.height}
                        rx={4}
                        fill="none"
                        stroke={PAPER_COLORS.accent}
                        strokeWidth={1.8 / zoom}
                        strokeDasharray={`${5 / zoom} ${4 / zoom}`}
                      />
                    ))}
                </g>
              )}

              {/* Unified multi-selection bounding box with 8 proportional resize handles */}
              {multiSelectionBox && (
                <g>
                  <rect
                    className="wb-group-selection-rect"
                    x={multiSelectionBox.x}
                    y={multiSelectionBox.y}
                    width={multiSelectionBox.width}
                    height={multiSelectionBox.height}
                    rx={3 / zoom}
                    strokeWidth={1.6 / zoom}
                  />
                  {hasUnlockedSelection &&
                    boxResizeHandles(multiSelectionBox).map((h) =>
                      h.corner ? (
                        <circle
                          key={`grp-${h.handle}`}
                          className="wb-resize-handle"
                          cx={h.x}
                          cy={h.y}
                          r={4.8 / zoom}
                          fill={PAPER_COLORS.cardBg}
                          stroke={PAPER_COLORS.accent}
                          strokeWidth={1.6 / zoom}
                          style={{ cursor: HANDLE_CURSORS[h.handle] }}
                          onPointerDown={(e) =>
                            handleGroupResizePointerDown(e, multiSelectionBox, h.handle)
                          }
                        />
                      ) : (
                        <rect
                          key={`grp-${h.handle}`}
                          className="wb-resize-handle"
                          x={h.x - (h.handle === 'n' || h.handle === 's' ? 7 : 3.2) / zoom}
                          y={h.y - (h.handle === 'n' || h.handle === 's' ? 3.2 : 7) / zoom}
                          width={(h.handle === 'n' || h.handle === 's' ? 14 : 6.4) / zoom}
                          height={(h.handle === 'n' || h.handle === 's' ? 6.4 : 14) / zoom}
                          rx={3 / zoom}
                          fill={PAPER_COLORS.cardBg}
                          stroke={PAPER_COLORS.accent}
                          strokeWidth={1.4 / zoom}
                          style={{ cursor: HANDLE_CURSORS[h.handle] }}
                          onPointerDown={(e) =>
                            handleGroupResizePointerDown(e, multiSelectionBox, h.handle)
                          }
                        />
                      ),
                    )}
                </g>
              )}

              {/* Smart magnetic alignment guides */}
              {snapGuides.map((g, gi) =>
                g.axis === 'x' ? (
                  <line
                    key={`sg-${gi}`}
                    className="wb-smart-guide"
                    x1={g.value}
                    y1={g.from}
                    x2={g.value}
                    y2={g.to}
                    strokeWidth={1.25 / zoom}
                    strokeDasharray={`${4 / zoom} ${3 / zoom}`}
                  />
                ) : (
                  <line
                    key={`sg-${gi}`}
                    className="wb-smart-guide"
                    x1={g.from}
                    y1={g.value}
                    x2={g.to}
                    y2={g.value}
                    strokeWidth={1.25 / zoom}
                    strokeDasharray={`${4 / zoom} ${3 / zoom}`}
                  />
                ),
              )}

              {/* Drag rubber-band marquee selection rectangle */}
              {marqueeRect && (
                <rect
                  className="wb-marquee-rect"
                  x={marqueeRect.x}
                  y={marqueeRect.y}
                  width={marqueeRect.width}
                  height={marqueeRect.height}
                  rx={2 / zoom}
                  strokeWidth={1.4 / zoom}
                />
              )}

              {/* Live in-progress connector drag preview */}
              {liveConnector &&
                (() => {
                  const geom = computeConnectorGeometry(
                    liveConnector.start,
                    liveConnector.end,
                    undefined,
                    2,
                    'none',
                    'arrow',
                    liveConnector.routing,
                    liveConnector.startNormal,
                    liveConnector.endNormal,
                  )
                  return (
                    <g style={{ pointerEvents: 'none' }}>
                      <path
                        d={geom.shaftPath}
                        fill="none"
                        stroke={connectorColor}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {renderConnectorHead(geom.endHead, connectorColor, 2, 'live-end')}
                    </g>
                  )
                })()}

              {/* Live in-progress pressure stroke */}
              {liveStroke && liveStroke.length > 0 && (
                <path
                  d={computeStrokeOutline(
                    liveStroke,
                    tool === 'highlighter' ? highlighterWidth : penWidth,
                    tool === 'highlighter' ? 'highlighter' : 'pen',
                  )}
                  fill={tool === 'highlighter' ? highlighterColor : penColor}
                  fillOpacity={tool === 'highlighter' ? 0.35 : 1}
                  style={tool === 'highlighter' ? { mixBlendMode: 'multiply' } : undefined}
                />
              )}
            </g>
          </svg>

          {/* Live rotation degree badge */}
          {rotatePreview && (
            <div
              className="wb-rotate-badge"
              style={{
                left: rotatePreview.clientX - (stageRef.current?.getBoundingClientRect().left ?? 0),
                top: rotatePreview.clientY - (stageRef.current?.getBoundingClientRect().top ?? 0),
              }}
            >
              {rotatePreview.angle}°
            </div>
          )}

          {/* Inline table cell editor overlay */}
          {editingTableCell &&
            editingTableObj &&
            editingTableObj.kind === 'table' &&
            (() => {
              const tp = editingTableObj.props as unknown as TableProps
              const rows = tp.rowIds?.length || 1
              const cols = tp.colIds?.length || 1
              const cw = editingTableObj.width / cols
              const ch = editingTableObj.height / rows
              const cellX = editingTableObj.x + editingTableCell.col * cw
              const cellY = editingTableObj.y + editingTableCell.row * ch
              return (
                <input
                  type="text"
                  className="wb-table-cell-editor"
                  autoFocus
                  value={editingTableCell.text}
                  onChange={(e) =>
                    setEditingTableCell((prev) => (prev ? { ...prev, text: e.target.value } : null))
                  }
                  onBlur={() => commitTableCellEdit()}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      e.stopPropagation()
                      commitTableCellEdit()
                    } else if (e.key === 'Tab') {
                      e.preventDefault()
                      e.stopPropagation()
                      const delta = e.shiftKey ? -1 : 1
                      const linear = editingTableCell.row * cols + editingTableCell.col + delta
                      if (linear >= 0 && linear < rows * cols) {
                        commitTableCellEdit({
                          row: Math.floor(linear / cols),
                          col: linear % cols,
                        })
                      } else {
                        commitTableCellEdit()
                      }
                    } else if (e.key === 'Enter') {
                      e.preventDefault()
                      e.stopPropagation()
                      if (editingTableCell.row + 1 < rows) {
                        commitTableCellEdit({
                          row: editingTableCell.row + 1,
                          col: editingTableCell.col,
                        })
                      } else {
                        commitTableCellEdit()
                      }
                    }
                  }}
                  style={{
                    left: pan.x + cellX * zoom,
                    top: pan.y + cellY * zoom,
                    width: Math.max(64, cw * zoom),
                    height: Math.max(28, ch * zoom),
                    fontSize: (tp.fontSize ?? 14) * zoom,
                  }}
                />
              )
            })()}

          {/* Inline plain-text editor overlay styled seamlessly to match the board object */}
          {editingObj &&
            editingObj.kind !== 'connector' &&
            (() => {
              const p = editingObj.props as unknown as StickyProps | TextProps | ShapeProps
              const fmt = richTextFormatState(p.text)
              const rawFontSize =
                p.fontSize ??
                (editingObj.kind === 'text'
                  ? TEXT_DEFAULT_FONT_SIZE
                  : editingObj.kind === 'shape'
                    ? SHAPE_DEFAULT_FONT_SIZE
                    : STICKY_DEFAULT_FONT_SIZE)
              const fontSize = rawFontSize * zoom
              const metrics = typographyMetrics(rawFontSize)
              const align = p.align ?? (editingObj.kind === 'text' ? 'left' : 'center')
              const textBg = editingObj.kind === 'text' ? (p as TextProps).background : undefined
              const hasTextBox =
                editingObj.kind === 'text' &&
                Boolean((textBg && textBg !== 'transparent') || (p as TextProps).borderColor)
              const bg =
                editingObj.kind === 'sticky'
                  ? (p as StickyProps).color || PAPER_FILL_SWATCHES[0]
                  : editingObj.kind === 'shape'
                    ? (p as ShapeProps).fill && (p as ShapeProps).fill !== 'transparent'
                      ? (p as ShapeProps).fill
                      : PAPER_COLORS.paper
                    : hasTextBox
                      ? textBg || PAPER_COLORS.cardBg
                      : 'transparent'
              const padY =
                editingObj.kind === 'sticky'
                  ? 18 * zoom
                  : editingObj.kind === 'text'
                    ? (hasTextBox ? 10 : 4) * zoom
                    : 12 * zoom
              const padX =
                editingObj.kind === 'sticky'
                  ? 20 * zoom
                  : editingObj.kind === 'text'
                    ? (hasTextBox ? 14 : 6) * zoom
                    : 14 * zoom
              const isTransparentText = editingObj.kind === 'text' && !hasTextBox
              const defaultWeight = editingObj.kind === 'text' ? 400 : 500
              return (
                <textarea
                  className={`wb-inline-editor${isTransparentText ? ' wb-inline-text-transparent' : ' wb-inline-card'}`}
                  autoFocus
                  value={editingText}
                  placeholder={
                    editingObj.kind === 'sticky'
                      ? t('defaultStickyText')
                      : editingObj.kind === 'text'
                        ? t('defaultText')
                        : ''
                  }
                  onChange={(e) => setEditingText(e.target.value)}
                  onBlur={commitInlineEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      e.stopPropagation()
                      e.nativeEvent.stopImmediatePropagation()
                      commitInlineEdit()
                    } else if (e.key === 'Tab' && !e.shiftKey && editingObj.kind === 'sticky') {
                      e.preventDefault()
                      e.stopPropagation()
                      handleStickyTabNext(editingObj)
                    }
                  }}
                  style={{
                    left: pan.x + editingObj.x * zoom,
                    top: pan.y + editingObj.y * zoom,
                    width: Math.max(120, editingObj.width * zoom),
                    height: Math.max(40, editingObj.height * zoom),
                    padding: `${padY}px ${padX}px`,
                    background: bg,
                    color:
                      fmt.color ||
                      (editingObj.kind === 'text' ? (p as TextProps).color : undefined) ||
                      PAPER_COLORS.ink,
                    fontSize,
                    lineHeight: metrics.lineHeight,
                    letterSpacing: metrics.letterSpacing,
                    fontWeight: fmt.bold ? 700 : defaultWeight,
                    fontStyle: fmt.italic ? 'italic' : 'normal',
                    textAlign: align,
                  }}
                />
              )
            })()}

          {/* Midpoint floating pill editor for connector labels */}
          {editingObj &&
            editingObj.kind === 'connector' &&
            (() => {
              const cp = editingObj.props as unknown as ConnectorProps
              const a = resolveConnectorEndpoint(cp.start, objectsById)
              const b = resolveConnectorEndpoint(cp.end, objectsById)
              const geom = computeConnectorGeometry(
                a.point,
                b.point,
                cp.waypoints,
                cp.strokeWidth ?? 2,
                cp.startHead,
                cp.endHead,
                cp.routing ?? 'straight',
                a.normal,
                b.normal,
              )
              return (
                <input
                  type="text"
                  className="wb-label-editor"
                  autoFocus
                  value={editingText}
                  onChange={(e) => setEditingText(e.target.value)}
                  onBlur={commitInlineEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Escape') {
                      e.preventDefault()
                      e.stopPropagation()
                      e.nativeEvent.stopImmediatePropagation()
                      commitInlineEdit()
                    }
                  }}
                  style={{
                    left: pan.x + geom.midpoint.x * zoom,
                    top: pan.y + geom.midpoint.y * zoom,
                    width: Math.max(96, estimateLabelPillWidth(editingText) + 18),
                  }}
                />
              )
            })()}
        </div>
      </div>

      {/* Right-click Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          selectedCount={selectedObjs.length}
          hasClipboard={Boolean(clipboardRef.current?.objects.length)}
          canGroup={canGroupSelection}
          canUngroup={canUngroupSelection}
          allLocked={allSelectedLocked}
          hasUnlocked={hasUnlockedSelection}
          onCopy={handleCopySelected}
          onCut={handleCutSelected}
          onPaste={() => void handlePasteInternal()}
          onDuplicate={handleDuplicateSelected}
          onGroup={handleGroupSelected}
          onUngroup={handleUngroupSelected}
          onToggleLock={handleToggleLockSelected}
          onLayer={handleLayerOrder}
          onAlign={handleAlignSelected}
          onDistribute={handleDistributeSelected}
          onSelectAll={handleSelectAll}
          onDelete={handleDeleteSelected}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Template Gallery Modal */}
      {templateModalOpen && (
        <TemplateModal onSelect={handleApplyTemplate} onClose={() => setTemplateModalOpen(false)} />
      )}

      {/* Link Card Modal */}
      {linkModalOpen && (
        <div className="wb-modal-scrim">
          <div className="wb-modal" role="dialog" aria-modal="true">
            <h3>{t('linkDialogTitle')}</h3>
            <label className="wb-field">
              <span>{t('linkUrlLabel')}</span>
              <input
                className="wb-input"
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://example.com"
                autoFocus
              />
            </label>
            <label className="wb-field">
              <span>{t('linkTitleLabel')}</span>
              <input
                className="wb-input"
                type="text"
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
              />
            </label>
            <label className="wb-checkbox">
              <input
                type="checkbox"
                checked={linkFetchPreview}
                onChange={(e) => setLinkFetchPreview(e.target.checked)}
              />
              <span>{t('linkFetchPreview')}</span>
            </label>
            <div className="wb-modal-actions">
              <button
                type="button"
                className="wb-btn wb-btn-secondary"
                disabled={linkBusy}
                onClick={() => setLinkModalOpen(false)}
              >
                {t('btnCancel')}
              </button>
              <button
                type="button"
                className="wb-btn wb-btn-primary"
                disabled={linkBusy}
                onClick={() => void handleConfirmLinkCard()}
              >
                {t('btnAdd')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Multi-page PDF Range Modal */}
      {pdfPending && (
        <div className="wb-modal-scrim">
          <div className="wb-modal" role="dialog" aria-modal="true">
            <h3>{t('pdfDialogTitle')}</h3>
            <div>{t('pdfPageCount', { count: pdfPending.pageCount })}</div>
            <label className="wb-field">
              <span>{t('pdfRangeLabel')}</span>
              <input
                className="wb-input"
                type="text"
                value={pdfRange}
                onChange={(e) => setPdfRange(e.target.value)}
                autoFocus
              />
            </label>
            <div className="wb-modal-actions">
              <button
                type="button"
                className="wb-btn wb-btn-secondary"
                disabled={pdfBusy}
                onClick={() => setPdfPending(null)}
              >
                {t('btnCancel')}
              </button>
              <button
                type="button"
                className="wb-btn wb-btn-primary"
                disabled={pdfBusy}
                onClick={() => void handleConfirmPdfImport()}
              >
                {t('btnImport')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Scope Modal */}
      {exportModalFormat && (
        <div className="wb-modal-scrim">
          <div className="wb-modal" role="dialog" aria-modal="true">
            <h3>
              {exportModalFormat === 'png'
                ? t('exportTitlePng')
                : exportModalFormat === 'svg'
                  ? t('exportTitleSvg')
                  : t('exportTitlePdf')}
            </h3>
            <label className="wb-checkbox">
              <input
                type="radio"
                name="wb-export-scope"
                checked={exportScope === 'all'}
                onChange={() => setExportScope('all')}
              />
              <span>{t('exportAllPages')}</span>
            </label>
            <label className="wb-checkbox">
              <input
                type="radio"
                name="wb-export-scope"
                checked={exportScope === 'current'}
                onChange={() => setExportScope('current')}
              />
              <span>{t('exportCurrentPage')}</span>
            </label>
            <div className="wb-modal-actions">
              <button
                type="button"
                className="wb-btn wb-btn-secondary"
                onClick={onCloseExportModal}
              >
                {t('btnCancel')}
              </button>
              <button
                type="button"
                className="wb-btn wb-btn-primary"
                onClick={() => {
                  const fmt = exportModalFormat
                  onCloseExportModal()
                  onExport(fmt, exportScope)
                }}
              >
                {t('btnExport')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Presentation Mode Overlay (F5) */}
      {presenting && activePage && (
        <div className="wb-present-overlay" role="dialog" aria-modal="true">
          <div className="wb-present-stage">
            {presentSvg && (
              <img
                alt={activePage.title || 'Whiteboard page'}
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(presentSvg.svg)}`}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                  background: PAPER_COLORS.paper,
                }}
              />
            )}
          </div>
          <div className="wb-present-bar">
            <button
              type="button"
              onClick={() => {
                const idx = doc.pages.findIndex((p) => p.id === activePageId)
                if (idx > 0) session.setActivePageId(doc.pages[idx - 1]!.id)
              }}
            >
              {t('presentPrev')}
            </button>
            <span>
              {doc.pages.findIndex((p) => p.id === activePageId) + 1} / {doc.pages.length}
            </span>
            <button
              type="button"
              onClick={() => {
                const idx = doc.pages.findIndex((p) => p.id === activePageId)
                if (idx >= 0 && idx + 1 < doc.pages.length)
                  session.setActivePageId(doc.pages[idx + 1]!.id)
              }}
            >
              {t('presentNext')}
            </button>
            <button type="button" onClick={() => onSetPresenting(false)}>
              {t('presentExit')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Miniature thumbnail preview of a page's objects for the left page rail. */
function PageThumbnail({
  page,
  objects,
}: {
  page: Page
  objects: readonly BoardObject[]
}): ReactElement {
  const isFreeform = page.format === 'freeform'
  const byId = new Map(objects.map((o) => [o.id, o]))
  const boxes = objects.map((o) => ({ obj: o, box: objectBounds(o, byId) }))

  let minX = 0
  let minY = 0
  let maxX = page.width || 1280
  let maxY = page.height || 720
  if (isFreeform && boxes.length > 0) {
    minX = Math.min(...boxes.map((b) => b.box.x)) - 40
    minY = Math.min(...boxes.map((b) => b.box.y)) - 40
    maxX = Math.max(...boxes.map((b) => b.box.x + b.box.width)) + 40
    maxY = Math.max(...boxes.map((b) => b.box.y + b.box.height)) + 40
  }
  const areaW = Math.max(240, maxX - minX)
  const areaH = Math.max(160, maxY - minY)
  const scale = Math.min(THUMB_W / areaW, THUMB_H / areaH)
  const offsetX = (THUMB_W - areaW * scale) / 2 - minX * scale
  const offsetY = (THUMB_H - areaH * scale) / 2 - minY * scale

  return (
    <div className={`wb-thumb${isFreeform ? ' wb-thumb-freeform' : ''}`}>
      {boxes
        .filter(({ obj }) => obj.kind !== 'connector' && obj.kind !== 'stroke')
        .map(({ obj, box }) => (
          <span
            key={obj.id}
            className="wb-thumb-obj"
            style={{
              left: Math.round(offsetX + box.x * scale),
              top: Math.round(offsetY + box.y * scale),
              width: Math.max(3, Math.round(box.width * scale)),
              height: Math.max(3, Math.round(box.height * scale)),
              backgroundColor: thumbnailSwatch(obj),
            }}
          />
        ))}
      <svg
        width={THUMB_W}
        height={THUMB_H}
        viewBox={`0 0 ${THUMB_W} ${THUMB_H}`}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        aria-hidden="true"
      >
        {objects
          .filter((o) => o.kind === 'connector')
          .map((o) => {
            const p = o.props as unknown as ConnectorProps
            const s = resolveConnectorEnd(p.start, byId)
            const e = resolveConnectorEnd(p.end, byId)
            return (
              <line
                key={o.id}
                x1={offsetX + s.x * scale}
                y1={offsetY + s.y * scale}
                x2={offsetX + e.x * scale}
                y2={offsetY + e.y * scale}
                stroke={p.color || PAPER_COLORS.ink}
                strokeWidth={1.5}
                strokeLinecap="round"
              />
            )
          })}
      </svg>
    </div>
  )
}

/** Renders a RichText block cleanly with editorial typography, per-run marks, and alignment. */
function RichTextBlock({
  richText,
  fontSize,
  defaultColor = PAPER_COLORS.ink,
  defaultAlign = 'left',
  defaultWeight = 400,
}: {
  readonly richText: RichText | undefined
  readonly fontSize: number
  readonly defaultColor?: string
  readonly defaultAlign?: TextAlign
  readonly defaultWeight?: 400 | 500 | 600
}): ReactElement {
  const paragraphs = richText?.paragraphs ?? []
  const metrics = typographyMetrics(fontSize)
  return (
    <div
      style={{
        fontFamily: BOARD_FONT_STACK,
        fontSize,
        lineHeight: metrics.lineHeight,
        letterSpacing: metrics.letterSpacing,
        color: defaultColor,
        wordBreak: 'keep-all',
        overflowWrap: 'anywhere',
        whiteSpace: 'pre-wrap',
      }}
    >
      {paragraphs.map((p, pi) => {
        const align = p.align ?? defaultAlign
        const runs = p.runs ?? []
        return (
          <div key={pi} style={{ textAlign: align, minHeight: '1em' }}>
            {runs.length === 0 ? (
              <br />
            ) : (
              runs.map((r, ri) => {
                const decos = [r.underline ? 'underline' : '', r.strike ? 'line-through' : '']
                  .filter(Boolean)
                  .join(' ')
                return (
                  <span
                    key={ri}
                    style={{
                      fontWeight: r.bold ? 700 : defaultWeight,
                      fontStyle: r.italic ? 'italic' : 'normal',
                      textDecorationLine: decos || 'none',
                      color: r.color || defaultColor,
                    }}
                  >
                    {r.text}
                  </span>
                )
              })
            )}
          </div>
        )
      })}
    </div>
  )
}

function renderObjectElement(
  obj: BoardObject,
  byId: ReadonlyMap<string, BoardObject>,
  session: WhiteboardSession,
  onOpenLink: (url: string) => void,
  isSelected: boolean,
  isEditing: boolean,
  stickyPlaceholder: string,
  textPlaceholder: string,
): ReactElement | null {
  const { x, y, width, height } = obj
  switch (obj.kind) {
    case 'sticky': {
      const p = obj.props as unknown as StickyProps
      const isEmpty = !richTextPlain(p.text).trim()
      const fontSize = p.fontSize ?? STICKY_DEFAULT_FONT_SIZE
      const align = p.align ?? 'center'
      const liftPath = stickyLiftShadowPath(x, y, width, height)
      return (
        <g>
          {/* Miro-inspired curved bottom-edge paper-lift shadow */}
          <path
            d={liftPath}
            fill={PAPER_COLORS.ink}
            fillOpacity={0.11}
            filter="url(#wb-sticky-lift)"
          />
          <g filter="url(#wb-sticky-shadow)">
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              rx={4}
              fill={p.color || PAPER_FILL_SWATCHES[0]}
              stroke={PAPER_COLORS.stickyBorder}
              strokeWidth={1}
            />
            {/* Subtle top adhesive strip light sheen */}
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              rx={4}
              fill="url(#wb-sticky-sheen)"
              style={{ pointerEvents: 'none' }}
            />
            {!isEditing && (
              <foreignObject
                x={x + 20}
                y={y + 18}
                width={Math.max(10, width - 40)}
                height={Math.max(10, height - 36)}
              >
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ margin: 'auto 0', width: '100%' }}>
                    {isEmpty ? (
                      <div
                        style={{
                          fontFamily: BOARD_FONT_STACK,
                          fontSize,
                          lineHeight: typographyMetrics(fontSize).lineHeight,
                          letterSpacing: typographyMetrics(fontSize).letterSpacing,
                          fontWeight: 500,
                          textAlign: align,
                          color: PAPER_COLORS.inkPlaceholder,
                        }}
                      >
                        {stickyPlaceholder}
                      </div>
                    ) : (
                      <RichTextBlock
                        richText={p.text}
                        fontSize={fontSize}
                        defaultColor={PAPER_COLORS.ink}
                        defaultAlign={align}
                        defaultWeight={500}
                      />
                    )}
                  </div>
                </div>
              </foreignObject>
            )}
          </g>
        </g>
      )
    }
    case 'text': {
      const p = obj.props as unknown as TextProps
      const isEmpty = !richTextPlain(p.text).trim()
      const hasBox = Boolean((p.background && p.background !== 'transparent') || p.borderColor)
      const padX = hasBox ? 14 : 6
      const padY = hasBox ? 10 : 4
      const fontSize = p.fontSize ?? TEXT_DEFAULT_FONT_SIZE
      const align = p.align ?? 'left'
      return (
        <g>
          {hasBox && (
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              rx={8}
              fill={p.background && p.background !== 'transparent' ? p.background : 'none'}
              stroke={p.borderColor || 'none'}
              strokeWidth={1}
            />
          )}
          {!hasBox && (
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              rx={4}
              fill="transparent"
              stroke={isEmpty && !isEditing ? PAPER_COLORS.lineDashed : 'none'}
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          )}
          {!isEditing && (
            <foreignObject
              x={x + padX}
              y={y + padY}
              width={Math.max(10, width - padX * 2)}
              height={Math.max(10, height - padY * 2)}
            >
              {isEmpty ? (
                <div
                  style={{
                    fontFamily: BOARD_FONT_STACK,
                    fontSize,
                    lineHeight: typographyMetrics(fontSize).lineHeight,
                    letterSpacing: typographyMetrics(fontSize).letterSpacing,
                    textAlign: align,
                    color: PAPER_COLORS.inkPlaceholder,
                  }}
                >
                  {textPlaceholder}
                </div>
              ) : (
                <RichTextBlock
                  richText={p.text}
                  fontSize={fontSize}
                  defaultColor={p.color || PAPER_COLORS.ink}
                  defaultAlign={align}
                  defaultWeight={400}
                />
              )}
            </foreignObject>
          )}
        </g>
      )
    }
    case 'shape': {
      const p = obj.props as unknown as ShapeProps
      const sw = p.strokeWidth ?? 1.75
      const kind = p.shape || 'rounded_rectangle'
      const d = shapePath(kind, width, height, sw / 2)
      const box = shapeTextBox(kind, width, height)
      const hasText = richTextPlain(p.text).length > 0
      const fill = p.fill || PAPER_COLORS.shapeDefaultFill
      const isTransparent = fill === 'transparent' || fill === 'none'
      const lineAttrs = strokeLineAttrs(p.lineStyle, sw)
      return (
        <g
          transform={`translate(${x}, ${y})`}
          filter={isTransparent ? undefined : 'url(#wb-paper-card-shadow)'}
        >
          <path
            d={d}
            fill={fill}
            stroke={p.stroke || PAPER_COLORS.shapeDefaultStroke}
            strokeWidth={sw}
            strokeLinecap={lineAttrs.linecap}
            strokeLinejoin="round"
            strokeDasharray={lineAttrs.dasharray}
          />
          {hasText && !isEditing && (
            <foreignObject
              x={box.left}
              y={box.top}
              width={Math.max(10, box.width)}
              height={Math.max(10, box.height)}
            >
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <div style={{ margin: 'auto 0', width: '100%' }}>
                  <RichTextBlock
                    richText={p.text}
                    fontSize={p.fontSize ?? SHAPE_DEFAULT_FONT_SIZE}
                    defaultColor={PAPER_COLORS.ink}
                    defaultAlign={p.align ?? 'center'}
                    defaultWeight={500}
                  />
                </div>
              </div>
            </foreignObject>
          )}
        </g>
      )
    }
    case 'connector': {
      const p = obj.props as unknown as ConnectorProps
      const s = resolveConnectorEndpoint(p.start, byId)
      const e = resolveConnectorEndpoint(p.end, byId)
      const sw = p.strokeWidth ?? 2
      const ink = p.color || PAPER_COLORS.connectorDefault
      const geom = computeConnectorGeometry(
        s.point,
        e.point,
        p.waypoints,
        sw,
        p.startHead,
        p.endHead,
        p.routing ?? 'straight',
        s.normal,
        e.normal,
      )
      const lineAttrs = strokeLineAttrs(p.lineStyle, sw)
      const labelText = richTextPlain(p.label).trim()
      const pillW = labelText ? estimateLabelPillWidth(labelText) : 0
      return (
        <g>
          {/* Soft accent selection halo along the routed path */}
          {isSelected && (
            <path
              d={geom.fullPath}
              fill="none"
              stroke={PAPER_COLORS.accent}
              strokeOpacity={0.24}
              strokeWidth={sw + 9}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {/* Generous invisible hit-target so clicking thin connectors is effortless */}
          <path
            d={geom.fullPath}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(18, sw + 14)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Routed shaft (straight, smooth cubic Bezier, or rounded-corner elbow) */}
          <path
            d={geom.shaftPath}
            fill="none"
            stroke={ink}
            strokeWidth={sw}
            strokeLinecap={lineAttrs.linecap}
            strokeLinejoin="round"
            strokeDasharray={lineAttrs.dasharray}
          />
          {/* Refined open chevron, stealth filled dart, or ringed dot endpoints */}
          {renderConnectorHead(geom.startHead, ink, sw, 'start')}
          {renderConnectorHead(geom.endHead, ink, sw, 'end')}
          {/* Crisp midpoint-centered pill label */}
          {labelText && !isEditing && (
            <g filter="url(#wb-paper-card-shadow)">
              <rect
                x={geom.midpoint.x - pillW / 2}
                y={geom.midpoint.y - 12}
                width={pillW}
                height={24}
                rx={12}
                fill={PAPER_COLORS.cardBg}
                stroke={PAPER_COLORS.line}
                strokeWidth={1}
              />
              <text
                x={geom.midpoint.x}
                y={geom.midpoint.y + 4.5}
                textAnchor="middle"
                fontFamily={BOARD_FONT_STACK}
                fontSize={12.5}
                fontWeight={500}
                fill={PAPER_COLORS.ink}
              >
                {labelText}
              </text>
            </g>
          )}
        </g>
      )
    }
    case 'stroke': {
      const p = obj.props as unknown as StrokeProps
      const d = computeStrokeOutline(p.points ?? [], p.width ?? 4, p.tool ?? 'pen')
      const isHi = p.tool === 'highlighter'
      return (
        <path
          transform={`translate(${x}, ${y})`}
          d={d}
          fill={p.color || PAPER_COLORS.ink}
          fillOpacity={p.opacity ?? (isHi ? 0.35 : 1)}
          style={isHi ? { mixBlendMode: 'multiply' } : undefined}
        />
      )
    }
    case 'image': {
      const p = obj.props as unknown as ImageProps
      const href = session.getResourceDataUrl(p.resourceId)
      return href ? (
        <image
          href={href}
          x={x}
          y={y}
          width={width}
          height={height}
          preserveAspectRatio="xMidYMid meet"
        />
      ) : (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx={8}
          fill={PAPER_COLORS.zoneFill}
          stroke={PAPER_COLORS.lineDashed}
          strokeDasharray="4 4"
        />
      )
    }
    case 'table': {
      const p = obj.props as unknown as TableProps
      const rowIds = p.rowIds?.length ? p.rowIds : ['r1']
      const colIds = p.colIds?.length ? p.colIds : ['c1']
      const cw = width / colIds.length
      const ch = height / rowIds.length
      const clipId = `wb-live-tbl-${obj.id}`
      return (
        <g filter="url(#wb-paper-card-shadow)">
          <defs>
            <clipPath id={clipId}>
              <rect x={x} y={y} width={width} height={height} rx={10} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`}>
            <rect x={x} y={y} width={width} height={height} fill={PAPER_COLORS.cardBg} />
            {rowIds.map((rid, r) =>
              colIds.map((cid, c) => {
                const cell = p.cells?.[`${rid}:${cid}`]
                const cx0 = x + c * cw
                const cy0 = y + r * ch
                return (
                  <g key={`${rid}-${cid}`}>
                    {r === 0 && p.headerRow && (
                      <rect x={cx0} y={cy0} width={cw} height={ch} fill={PAPER_COLORS.zoneFill} />
                    )}
                    {c > 0 && (
                      <line
                        x1={cx0}
                        y1={cy0}
                        x2={cx0}
                        y2={cy0 + ch}
                        stroke={PAPER_COLORS.line}
                        strokeWidth={1}
                      />
                    )}
                    {r > 0 && (
                      <line
                        x1={cx0}
                        y1={cy0}
                        x2={cx0 + cw}
                        y2={cy0}
                        stroke={PAPER_COLORS.line}
                        strokeWidth={1}
                      />
                    )}
                    <text
                      x={cx0 + 12}
                      y={cy0 + ch / 2 + 5}
                      fontFamily={BOARD_FONT_STACK}
                      fontSize={p.fontSize ?? 14}
                      fontWeight={r === 0 && p.headerRow ? 600 : 400}
                      fill={PAPER_COLORS.ink}
                    >
                      {richTextPlain(cell)}
                    </text>
                  </g>
                )
              }),
            )}
          </g>
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            rx={10}
            fill="none"
            stroke={PAPER_COLORS.lineStrong}
            strokeWidth={1.2}
          />
        </g>
      )
    }
    case 'sticker': {
      const p = obj.props as unknown as StickerProps
      return (
        <g transform={`translate(${x}, ${y})`}>
          <svg width={width} height={height} viewBox="0 0 100 100" overflow="visible">
            <StickerIcon stickerId={p.stickerId || 'star'} tint={p.tint} />
          </svg>
        </g>
      )
    }
    case 'link': {
      const p = obj.props as unknown as LinkProps
      const previewHref = p.previewResourceId
        ? session.getResourceDataUrl(p.previewResourceId)
        : null
      return (
        <g filter="url(#wb-paper-card-shadow)">
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            rx={12}
            fill={PAPER_COLORS.cardBg}
            stroke={PAPER_COLORS.line}
            strokeWidth={1.2}
          />
          {previewHref && (
            <image
              href={previewHref}
              x={x + 8}
              y={y + 8}
              width={width - 16}
              height={Math.min(84, height * 0.5)}
              preserveAspectRatio="xMidYMid slice"
            />
          )}
          <foreignObject
            x={x + 18}
            y={previewHref ? y + Math.min(84, height * 0.5) + 12 : y + 16}
            width={Math.max(20, width - 36)}
            height={Math.max(24, height - (previewHref ? Math.min(84, height * 0.5) + 20 : 28))}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                fontFamily: BOARD_FONT_STACK,
              }}
            >
              <a
                href={p.url}
                onClick={(ev) => {
                  ev.preventDefault()
                  ev.stopPropagation()
                  onOpenLink(p.url)
                }}
                style={{
                  color: PAPER_COLORS.ink,
                  fontSize: 14.5,
                  fontWeight: 600,
                  letterSpacing: '-0.015em',
                  textDecoration: 'none',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {p.title || p.url} ↗
              </a>
              <span
                style={{
                  color: PAPER_COLORS.accent,
                  fontSize: 11.5,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {p.url}
              </span>
            </div>
          </foreignObject>
        </g>
      )
    }
  }
}
