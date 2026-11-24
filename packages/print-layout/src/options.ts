import { issue, type PrintLayoutIssue } from './errors'
import {
  DEFAULT_LABEL_PRESET_ID,
  labelCellCount,
  resolveLabelSpec,
  validateLabelSpec,
  type LabelSpecChoice,
} from './labels'
import { isPaperName, type PaperName } from './paper'

export const LAYOUT_MODES = ['single', 'nup', 'booklet', 'poster', 'labels'] as const
export type LayoutMode = (typeof LAYOUT_MODES)[number]

export const NUP_COUNTS = [2, 4, 6, 9, 16] as const
export type NupCount = (typeof NUP_COUNTS)[number]

/** `row`: left to right, then top to bottom. `column`: top to bottom, then left to right. */
export const NUP_ORDERS = ['row', 'column'] as const
export type NupOrder = (typeof NUP_ORDERS)[number]

export const BOOKLET_BINDINGS = ['left', 'right'] as const
export type BookletBinding = (typeof BOOKLET_BINDINGS)[number]

export const LABEL_FILLS = ['repeat', 'sequence'] as const
export type LabelFill = (typeof LABEL_FILLS)[number]

/** Face filter; faces count from 1 in the arranged output, not by document page. */
export const SIDES_FILTERS = ['all', 'odd', 'even'] as const
export type SidesFilter = (typeof SIDES_FILTERS)[number]

/** `source` keeps the job's own page size. */
export type PaperChoice = 'source' | PaperName

export const DPI_CHOICES = ['auto', 150, 300, 600] as const
export type DpiChoice = (typeof DPI_CHOICES)[number]

export const SCALING_MODES = ['actual', 'fit', 'shrink', 'custom'] as const
export type ScalingMode = (typeof SCALING_MODES)[number]

export const SCALE_PERCENT_MIN = 10
export const SCALE_PERCENT_MAX = 400

export const ORIENTATION_CHOICES = ['auto', 'portrait', 'landscape'] as const
export type OrientationChoice = (typeof ORIENTATION_CHOICES)[number]

export const WATERMARK_KINDS = ['none', 'text', 'image'] as const
export type WatermarkKind = (typeof WATERMARK_KINDS)[number]

export const WATERMARK_OPACITY_MIN = 0.05
export const WATERMARK_OPACITY_MAX = 0.8
export const WATERMARK_ANGLE_MIN = -90
export const WATERMARK_ANGLE_MAX = 90
export const WATERMARK_FONT_SIZE_MIN = 12
export const WATERMARK_FONT_SIZE_MAX = 144
export const WATERMARK_IMAGE_SCALE_MIN = 10
export const WATERMARK_IMAGE_SCALE_MAX = 200

export const HEADER_FOOTER_SLOT_KINDS = ['none', 'title', 'date', 'pageNumber', 'custom'] as const
export type HeaderFooterSlotKind = (typeof HEADER_FOOTER_SLOT_KINDS)[number]

export const IMAGE_EXPORT_FORMATS = ['png', 'jpg'] as const
export type ImageExportFormat = (typeof IMAGE_EXPORT_FORMATS)[number]

export const JPG_QUALITIES = [90, 80, 65] as const
export type JpgQuality = (typeof JPG_QUALITIES)[number]

export const IMAGE_BUNDLE_MODES = ['files', 'zip'] as const
export type ImageBundleMode = (typeof IMAGE_BUNDLE_MODES)[number]

export const POSTER_TILES_MIN = 1
export const POSTER_TILES_MAX = 8
export const POSTER_OVERLAP_MM_MIN = 0
export const POSTER_OVERLAP_MM_MAX = 30

export interface NupOptions {
  count: NupCount
  order: NupOrder
  border?: boolean | undefined
}

export interface BookletOptions {
  binding: BookletBinding
}

export interface PosterOptions {
  /** sheets across, 1-8 */
  cols: number
  /** sheets down, 1-8; cols x rows must be more than one sheet */
  rows: number
  /** 0-30 mm */
  overlapMm: number
  cutMarks: boolean
  tileLabels?: boolean | undefined
}

export interface LabelOptions {
  fill: LabelFill
  /** 1-based job page used by `repeat`; at most the job page count */
  repeatPage: number
  /** 1-based first cell on the first sheet; cells count row-first */
  startCell: number
  spec: LabelSpecChoice
}

export interface WatermarkOptions {
  kind: WatermarkKind
  text: string
  /** `#rrggbb` hex color for text watermark */
  color: string
  /** 0.05-0.8 */
  opacity: number
  /** -90 to 90 degrees */
  angle: number
  /** 12-144 pt */
  fontSize: number
  /** repeat watermark in a grid across the face */
  tile: boolean
  /** data URL (`data:image/png;base64,...` or `data:image/jpeg;base64,...`) for image watermark */
  imageDataUrl?: string | undefined
  /** 10-200 percent of the face short edge */
  imageScale: number
}

export interface HeaderFooterSlot {
  kind: HeaderFooterSlotKind
  text: string
}

export interface HeaderFooterOptions {
  enabled: boolean
  topLeft: HeaderFooterSlot
  topCenter: HeaderFooterSlot
  topRight: HeaderFooterSlot
  bottomLeft: HeaderFooterSlot
  bottomCenter: HeaderFooterSlot
  bottomRight: HeaderFooterSlot
  /** document title supplied by the editor for `title` slots */
  documentTitle?: string | undefined
  /** formatted date supplied by the editor/UI for `date` slots */
  dateText?: string | undefined
}

export interface ImageExportOptions {
  format: ImageExportFormat
  quality: JpgQuality
  bundle: ImageBundleMode
}

/**
 * Every option of the shared page layout panel. All sub-option groups are always
 * present; only the group of the chosen `mode` takes effect.
 */
export interface PrintLayoutOptions {
  mode: LayoutMode
  nup: NupOptions
  booklet: BookletOptions
  poster: PosterOptions
  labels: LabelOptions
  sides: SidesFilter
  reverse: boolean
  paper: PaperChoice
  /** shrink pages larger than `paper`; kept in sync with `scaling === 'shrink'` */
  fitToPaper: boolean
  /** single-page scaling mode: actual (100%), fit (up/down), shrink (down only), custom (%) */
  scaling: ScalingMode
  /** 10-400%, used when `mode === 'single'` and `scaling === 'custom'` */
  scalePercent: number
  /** sheet orientation override for single, nup, and poster modes */
  orientation: OrientationChoice
  grayscale: boolean
  dpi: DpiChoice
  watermark: WatermarkOptions
  headerFooter: HeaderFooterOptions
}

export function createDefaultWatermarkOptions(): WatermarkOptions {
  return {
    kind: 'none',
    text: '',
    color: '#888888',
    opacity: 0.2,
    angle: -45,
    fontSize: 48,
    tile: false,
    imageScale: 50,
  }
}

export function createDefaultHeaderFooterOptions(): HeaderFooterOptions {
  return {
    enabled: false,
    topLeft: { kind: 'none', text: '' },
    topCenter: { kind: 'none', text: '' },
    topRight: { kind: 'none', text: '' },
    bottomLeft: { kind: 'none', text: '' },
    bottomCenter: { kind: 'pageNumber', text: '' },
    bottomRight: { kind: 'none', text: '' },
  }
}

export function createDefaultImageExportOptions(): ImageExportOptions {
  return {
    format: 'png',
    quality: 90,
    bundle: 'files',
  }
}

/** A fresh default set; the panel starts from this every time it opens. */
export function createDefaultOptions(): PrintLayoutOptions {
  return {
    mode: 'single',
    nup: { count: 2, order: 'row', border: false },
    booklet: { binding: 'left' },
    poster: { cols: 2, rows: 2, overlapMm: 10, cutMarks: true, tileLabels: false },
    labels: {
      fill: 'sequence',
      repeatPage: 1,
      startCell: 1,
      spec: { kind: 'preset', id: DEFAULT_LABEL_PRESET_ID },
    },
    sides: 'all',
    reverse: false,
    paper: 'source',
    fitToPaper: false,
    scaling: 'actual',
    scalePercent: 100,
    orientation: 'auto',
    grayscale: false,
    dpi: 'auto',
    watermark: createDefaultWatermarkOptions(),
    headerFooter: createDefaultHeaderFooterOptions(),
  }
}

/** True when watermark configuration will visibly draw something on faces. */
export function hasActiveWatermark(w: WatermarkOptions | undefined): boolean {
  if (!w || w.kind === 'none') return false
  if (w.kind === 'text') return w.text.trim().length > 0
  return typeof w.imageDataUrl === 'string' && w.imageDataUrl.trim().length > 0
}

/** True when header/footer is enabled and at least one slot produces content. */
export function hasActiveHeaderFooter(hf: HeaderFooterOptions | undefined): boolean {
  if (!hf || !hf.enabled) return false
  const slots = [
    hf.topLeft,
    hf.topCenter,
    hf.topRight,
    hf.bottomLeft,
    hf.bottomCenter,
    hf.bottomRight,
  ]
  return slots.some((s) => s.kind !== 'none' && (s.kind !== 'custom' || s.text.trim().length > 0))
}

/** True when any face-level overlay (watermark or header/footer) is active. */
export function hasFaceOverlays(o: PrintLayoutOptions): boolean {
  return hasActiveWatermark(o.watermark) || hasActiveHeaderFooter(o.headerFooter)
}

/**
 * True when nothing sends the job down the new print route: mode, sides,
 * reverse, paper, fit/scaling, orientation, grayscale, dpi, watermark and
 * header/footer are all at their defaults. Sub-options of a mode that is not
 * chosen do not count.
 */
export function isDefaultOptions(o: PrintLayoutOptions): boolean {
  const customNon100 = o.scaling === 'custom' && o.scalePercent !== 100
  const scalingChanged = o.scaling === 'custom' ? customNon100 : o.scaling !== 'actual'
  return (
    o.mode === 'single' &&
    o.sides === 'all' &&
    !o.reverse &&
    o.paper === 'source' &&
    !o.fitToPaper &&
    !scalingChanged &&
    o.orientation === 'auto' &&
    !o.grayscale &&
    o.dpi === 'auto' &&
    !hasFaceOverlays(o)
  )
}

/**
 * True when the faces differ geometrically from the job's pages (mode, sides,
 * reverse, paper, fit/scaling, orientation). Grayscale, dpi, and face overlays
 * keep the underlying face geometry intact.
 */
export function changesSheetArrangement(o: PrintLayoutOptions): boolean {
  const customNon100 = o.scaling === 'custom' && o.scalePercent !== 100
  const scalingChanged = o.scaling === 'custom' ? customNon100 : o.scaling !== 'actual'
  return (
    o.mode !== 'single' ||
    o.sides !== 'all' ||
    o.reverse ||
    o.paper !== 'source' ||
    o.fitToPaper ||
    scalingChanged ||
    o.orientation !== 'auto'
  )
}

/**
 * True when an editor with its own native preview should switch to the live
 * rendered PDF preview (arrangement changed, grayscale, or face overlays).
 */
export function needsLivePreview(o: PrintLayoutOptions): boolean {
  return changesSheetArrangement(o) || o.grayscale || hasFaceOverlays(o)
}

export type OptionsResult =
  { ok: true; options: PrintLayoutOptions } | { ok: false; error: PrintLayoutIssue }

export type ImageOptionsResult =
  { ok: true; options: ImageExportOptions } | { ok: false; error: PrintLayoutIssue }

class Invalid {
  constructor(readonly issue: PrintLayoutIssue) {}
}

function fail(code: PrintLayoutIssue['code'], message: string): never {
  throw new Invalid(issue(code, message))
}

function record(v: unknown, name: string): Record<string, unknown> {
  if (v === undefined) return {}
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    fail('invalid-options', `${name} must be an object`)
  }
  return v as Record<string, unknown>
}

function pick<T>(
  v: unknown,
  fallback: T,
  allowed: readonly T[],
  code: PrintLayoutIssue['code'],
  name: string,
): T {
  if (v === undefined) return fallback
  if (!(allowed as readonly unknown[]).includes(v)) fail(code, `${name} cannot be ${String(v)}`)
  return v as T
}

function flag(v: unknown, fallback: boolean, name: string): boolean {
  if (v === undefined) return fallback
  if (typeof v !== 'boolean') fail('invalid-flag', `${name} must be true or false`)
  return v
}

/** Strict read for the chosen mode: missing takes the default, anything else is kept for the range check. */
function strictNum(v: unknown, fallback: number): number {
  if (v === undefined) return fallback
  return typeof v === 'number' ? v : NaN
}

/** Lenient read for modes that are not chosen: unusable values fall back to the default. */
function looseNum(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function isSpecChoiceShape(v: unknown): v is LabelSpecChoice {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return (
    (c.kind === 'preset' && typeof c.id === 'string') ||
    (c.kind === 'custom' && typeof c.spec === 'object' && c.spec !== null)
  )
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/
const IMAGE_DATA_URL_RE = /^data:image\/(?:png|jpeg|jpg);base64,[A-Za-z0-9+/=]+$/

function normalizeWatermark(raw: unknown): WatermarkOptions {
  const d = createDefaultWatermarkOptions()
  if (raw === undefined) return d
  const w = record(raw, 'watermark')
  const kind = pick(w.kind, d.kind, WATERMARK_KINDS, 'invalid-watermark', 'watermark.kind')
  const text = typeof w.text === 'string' ? w.text.slice(0, 200) : d.text
  const color = typeof w.color === 'string' && HEX_COLOR_RE.test(w.color) ? w.color : d.color
  const opacity = looseNum(w.opacity, d.opacity)
  const angle = looseNum(w.angle, d.angle)
  const fontSize = looseNum(w.fontSize, d.fontSize)
  const tile = typeof w.tile === 'boolean' ? w.tile : d.tile
  const imageScale = looseNum(w.imageScale, d.imageScale)
  const imageDataUrl =
    typeof w.imageDataUrl === 'string' && IMAGE_DATA_URL_RE.test(w.imageDataUrl)
      ? w.imageDataUrl
      : undefined

  if (kind !== 'none') {
    if (
      typeof w.opacity === 'number' &&
      (!Number.isFinite(w.opacity) ||
        w.opacity < WATERMARK_OPACITY_MIN ||
        w.opacity > WATERMARK_OPACITY_MAX)
    ) {
      fail('invalid-watermark', 'watermark.opacity must be from 0.05 to 0.8')
    }
    if (
      kind === 'text' &&
      typeof w.angle === 'number' &&
      (!Number.isFinite(w.angle) || w.angle < WATERMARK_ANGLE_MIN || w.angle > WATERMARK_ANGLE_MAX)
    ) {
      fail('invalid-watermark', 'watermark.angle must be from -90 to 90')
    }
    if (
      kind === 'text' &&
      typeof w.fontSize === 'number' &&
      (!Number.isFinite(w.fontSize) ||
        w.fontSize < WATERMARK_FONT_SIZE_MIN ||
        w.fontSize > WATERMARK_FONT_SIZE_MAX)
    ) {
      fail('invalid-watermark', 'watermark.fontSize must be from 12 to 144')
    }
    if (
      kind === 'image' &&
      typeof w.imageScale === 'number' &&
      (!Number.isFinite(w.imageScale) ||
        w.imageScale < WATERMARK_IMAGE_SCALE_MIN ||
        w.imageScale > WATERMARK_IMAGE_SCALE_MAX)
    ) {
      fail('invalid-watermark', 'watermark.imageScale must be from 10 to 200')
    }
  }

  return {
    kind,
    text,
    color,
    opacity: Math.min(WATERMARK_OPACITY_MAX, Math.max(WATERMARK_OPACITY_MIN, opacity)),
    angle: Math.min(WATERMARK_ANGLE_MAX, Math.max(WATERMARK_ANGLE_MIN, angle)),
    fontSize: Math.min(WATERMARK_FONT_SIZE_MAX, Math.max(WATERMARK_FONT_SIZE_MIN, fontSize)),
    tile,
    ...(imageDataUrl !== undefined ? { imageDataUrl } : {}),
    imageScale: Math.min(
      WATERMARK_IMAGE_SCALE_MAX,
      Math.max(WATERMARK_IMAGE_SCALE_MIN, imageScale),
    ),
  }
}

function normalizeSlot(raw: unknown, fallback: HeaderFooterSlot, name: string): HeaderFooterSlot {
  if (raw === undefined) return { ...fallback }
  const r = record(raw, name)
  const kind = pick(
    r.kind,
    fallback.kind,
    HEADER_FOOTER_SLOT_KINDS,
    'invalid-header-footer',
    `${name}.kind`,
  )
  const text = typeof r.text === 'string' ? r.text.slice(0, 200) : fallback.text
  return { kind, text }
}

function normalizeHeaderFooter(raw: unknown): HeaderFooterOptions {
  const d = createDefaultHeaderFooterOptions()
  if (raw === undefined) return d
  const hf = record(raw, 'headerFooter')
  const enabled = flag(hf.enabled, d.enabled, 'headerFooter.enabled')
  const documentTitle =
    typeof hf.documentTitle === 'string' ? hf.documentTitle.slice(0, 200) : undefined
  const dateText = typeof hf.dateText === 'string' ? hf.dateText.slice(0, 80) : undefined
  return {
    enabled,
    topLeft: normalizeSlot(hf.topLeft, d.topLeft, 'headerFooter.topLeft'),
    topCenter: normalizeSlot(hf.topCenter, d.topCenter, 'headerFooter.topCenter'),
    topRight: normalizeSlot(hf.topRight, d.topRight, 'headerFooter.topRight'),
    bottomLeft: normalizeSlot(hf.bottomLeft, d.bottomLeft, 'headerFooter.bottomLeft'),
    bottomCenter: normalizeSlot(hf.bottomCenter, d.bottomCenter, 'headerFooter.bottomCenter'),
    bottomRight: normalizeSlot(hf.bottomRight, d.bottomRight, 'headerFooter.bottomRight'),
    ...(documentTitle !== undefined ? { documentTitle } : {}),
    ...(dateText !== undefined ? { dateText } : {}),
  }
}

function normalize(input: unknown, jobPageCount: number): PrintLayoutOptions {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail('invalid-options', 'options must be an object')
  }
  if (!Number.isInteger(jobPageCount) || jobPageCount < 1) {
    fail('no-pages', 'the print job has no pages')
  }
  const d = createDefaultOptions()
  const i = input as Record<string, unknown>
  const nupIn = record(i.nup, 'nup')
  const bookletIn = record(i.booklet, 'booklet')
  const posterIn = record(i.poster, 'poster')
  const labelsIn = record(i.labels, 'labels')

  const mode = pick(i.mode, d.mode, LAYOUT_MODES, 'invalid-mode', 'mode')
  const sides = pick(i.sides, d.sides, SIDES_FILTERS, 'invalid-sides', 'sides')
  const reverse = flag(i.reverse, d.reverse, 'reverse')
  let paper: PaperChoice = d.paper
  if (i.paper !== undefined) {
    if (i.paper !== 'source' && !isPaperName(i.paper)) {
      fail('invalid-paper', `paper cannot be ${String(i.paper)}`)
    }
    paper = i.paper as PaperChoice
  }
  const hasExplicitScaling = i.scaling !== undefined
  const rawFitToPaper = flag(i.fitToPaper, d.fitToPaper, 'fitToPaper')
  let scaling = pick(i.scaling, d.scaling, SCALING_MODES, 'invalid-scaling', 'scaling')
  const scalePercent =
    mode === 'single' && scaling === 'custom'
      ? strictNum(i.scalePercent, d.scalePercent)
      : looseNum(i.scalePercent, d.scalePercent)
  const orientation = pick(
    i.orientation,
    d.orientation,
    ORIENTATION_CHOICES,
    'invalid-orientation',
    'orientation',
  )
  const grayscale = flag(i.grayscale, d.grayscale, 'grayscale')
  const dpi = pick(i.dpi, d.dpi, DPI_CHOICES, 'invalid-dpi', 'dpi')
  const watermark = normalizeWatermark(i.watermark)
  const headerFooter = normalizeHeaderFooter(i.headerFooter)

  const nup: NupOptions = { ...d.nup }
  const booklet: BookletOptions = { ...d.booklet }
  const posterNum = mode === 'poster' ? strictNum : looseNum
  const poster: PosterOptions = {
    cols: posterNum(posterIn.cols, d.poster.cols),
    rows: posterNum(posterIn.rows, d.poster.rows),
    overlapMm: posterNum(posterIn.overlapMm, d.poster.overlapMm),
    cutMarks: typeof posterIn.cutMarks === 'boolean' ? posterIn.cutMarks : d.poster.cutMarks,
    tileLabels:
      typeof posterIn.tileLabels === 'boolean'
        ? posterIn.tileLabels
        : (d.poster.tileLabels ?? false),
  }
  const labelNum = mode === 'labels' ? strictNum : looseNum
  const labels: LabelOptions = {
    fill: d.labels.fill,
    repeatPage: labelNum(labelsIn.repeatPage, d.labels.repeatPage),
    startCell: labelNum(labelsIn.startCell, d.labels.startCell),
    spec: d.labels.spec,
  }
  if (labelsIn.spec !== undefined && mode === 'labels')
    labels.spec = labelsIn.spec as LabelSpecChoice
  else if (isSpecChoiceShape(labelsIn.spec)) labels.spec = labelsIn.spec

  // Only the chosen mode's group is checked strictly; the others are carried
  // through as given so the panel keeps them when the user switches back.
  if (mode === 'nup') {
    nup.count = pick(nupIn.count, d.nup.count, NUP_COUNTS, 'invalid-nup-count', 'nup.count')
    nup.order = pick(nupIn.order, d.nup.order, NUP_ORDERS, 'invalid-nup-order', 'nup.order')
    nup.border = flag(nupIn.border, d.nup.border ?? false, 'nup.border')
  } else {
    if ((NUP_COUNTS as readonly unknown[]).includes(nupIn.count))
      nup.count = nupIn.count as NupCount
    if ((NUP_ORDERS as readonly unknown[]).includes(nupIn.order))
      nup.order = nupIn.order as NupOrder
    if (typeof nupIn.border === 'boolean') nup.border = nupIn.border
  }

  if (mode === 'booklet') {
    booklet.binding = pick(
      bookletIn.binding,
      d.booklet.binding,
      BOOKLET_BINDINGS,
      'invalid-booklet-binding',
      'booklet.binding',
    )
  } else if ((BOOKLET_BINDINGS as readonly unknown[]).includes(bookletIn.binding)) {
    booklet.binding = bookletIn.binding as BookletBinding
  }

  if (mode === 'poster') {
    for (const [name, v] of [
      ['poster.cols', poster.cols],
      ['poster.rows', poster.rows],
    ] as const) {
      if (!Number.isInteger(v) || v < POSTER_TILES_MIN || v > POSTER_TILES_MAX) {
        fail('poster-tiles-out-of-range', `${name} must be a whole number from 1 to 8`)
      }
    }
    if (poster.cols * poster.rows === 1)
      fail('poster-single-tile', 'a poster needs more than one sheet')
    if (
      !Number.isFinite(poster.overlapMm) ||
      poster.overlapMm < POSTER_OVERLAP_MM_MIN ||
      poster.overlapMm > POSTER_OVERLAP_MM_MAX
    ) {
      fail('poster-overlap-out-of-range', 'poster.overlapMm must be from 0 to 30')
    }
    poster.cutMarks = flag(posterIn.cutMarks, d.poster.cutMarks, 'poster.cutMarks')
    poster.tileLabels = flag(posterIn.tileLabels, d.poster.tileLabels ?? false, 'poster.tileLabels')
  }

  if (mode === 'labels') {
    labels.fill = pick(
      labelsIn.fill,
      d.labels.fill,
      LABEL_FILLS,
      'invalid-label-fill',
      'labels.fill',
    )
    const choice = record(labels.spec, 'labels.spec')
    let cells: number
    if (choice.kind === 'preset') {
      const spec =
        typeof choice.id === 'string'
          ? resolveLabelSpec({ kind: 'preset', id: choice.id })
          : undefined
      if (!spec) fail('label-unknown-preset', `no label preset ${String(choice.id)}`)
      labels.spec = { kind: 'preset', id: choice.id as string }
      cells = labelCellCount(spec)
    } else if (choice.kind === 'custom') {
      const r = validateLabelSpec(choice.spec)
      if (!r.ok) throw new Invalid(r.error)
      labels.spec = { kind: 'custom', spec: r.spec }
      cells = labelCellCount(r.spec)
    } else {
      fail('label-spec-invalid', 'labels.spec.kind must be preset or custom')
    }
    if (!Number.isInteger(labels.startCell) || labels.startCell < 1 || labels.startCell > cells) {
      fail('label-start-cell-out-of-range', `labels.startCell must be from 1 to ${cells}`)
    }
    if (
      labels.fill === 'repeat' &&
      (!Number.isInteger(labels.repeatPage) ||
        labels.repeatPage < 1 ||
        labels.repeatPage > jobPageCount)
    ) {
      fail('label-repeat-page-out-of-range', `labels.repeatPage must be from 1 to ${jobPageCount}`)
    }
  } else if ((LABEL_FILLS as readonly unknown[]).includes(labelsIn.fill)) {
    labels.fill = labelsIn.fill as LabelFill
  }

  // Backward compatibility: legacy callers mutate fitToPaper while leaving scaling at default.
  if (rawFitToPaper && (!hasExplicitScaling || scaling === 'actual')) {
    if (paper === 'source') fail('fit-needs-paper', 'fitToPaper needs a chosen paper')
    if (mode !== 'single') fail('fit-needs-single', 'fitToPaper only applies to one page per sheet')
    scaling = 'shrink'
  }
  if (mode === 'single' && scaling === 'custom') {
    if (
      !Number.isFinite(scalePercent) ||
      scalePercent < SCALE_PERCENT_MIN ||
      scalePercent > SCALE_PERCENT_MAX
    ) {
      fail(
        'scale-percent-out-of-range',
        `scalePercent must be from ${SCALE_PERCENT_MIN} to ${SCALE_PERCENT_MAX}`,
      )
    }
  }
  const fitToPaper = mode === 'single' && paper !== 'source' && scaling === 'shrink'

  return {
    mode,
    nup,
    booklet,
    poster,
    labels,
    sides,
    reverse,
    paper,
    fitToPaper,
    scaling,
    scalePercent: Math.min(SCALE_PERCENT_MAX, Math.max(SCALE_PERCENT_MIN, scalePercent)),
    orientation,
    grayscale,
    dpi,
    watermark,
    headerFooter,
  }
}

/**
 * Checks options (for example from the screen over IPC) against a job of
 * `jobPageCount` pages. Missing fields take their defaults. Never throws.
 */
export function validateOptions(input: unknown, jobPageCount: number): OptionsResult {
  try {
    return { ok: true, options: normalize(input, jobPageCount) }
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.issue }
    throw e
  }
}

/** Checks image export options sent from the screen over IPC. Never throws. */
export function validateImageExportOptions(input: unknown): ImageOptionsResult {
  try {
    const d = createDefaultImageExportOptions()
    if (input === undefined) return { ok: true, options: d }
    const r = record(input, 'image')
    const format = pick(
      r.format,
      d.format,
      IMAGE_EXPORT_FORMATS,
      'invalid-image-options',
      'image.format',
    )
    const quality = pick(
      r.quality,
      d.quality,
      JPG_QUALITIES,
      'invalid-image-options',
      'image.quality',
    )
    const bundle = pick(
      r.bundle,
      d.bundle,
      IMAGE_BUNDLE_MODES,
      'invalid-image-options',
      'image.bundle',
    )
    return { ok: true, options: { format, quality, bundle } }
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.issue }
    throw e
  }
}
