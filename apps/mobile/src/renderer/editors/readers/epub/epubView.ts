/**
 * The pure rules of the EPUB reading screen: reader settings (snapped to the
 * PC steps), the reading background, the CSS of the chapter frame for each
 * reading mode, which way a page turns for a tap or a swipe, and what a
 * gesture was. Nothing here touches the DOM, so the turning direction (also
 * for right-to-left and vertical books) is pinned by tests even where layout
 * cannot be measured.
 */
import type { ReaderSettings, ReaderTheme } from '@genoffice/mobile-bridge/readers'
import type { MobileTheme } from '@genoffice/mobile-bridge/transport'
import {
  previewCss,
  type PageFlow,
  type PageGeometry,
} from '../../../../../../epub/src/renderer/reader/preview-pages'
import {
  FIND_HIGHLIGHT,
  FONT_SCALES,
  LINE_HEIGHTS,
  themeCss,
  viewPrefsCss,
  type FrameColors,
  type ReadingTheme,
} from '../../../../../../epub/src/renderer/reader/view-prefs'

export { FONT_SCALES, LINE_HEIGHTS }
export type { ReadingTheme }

export const READER_THEMES: readonly ReaderTheme[] = ['app', 'light', 'sepia', 'dark']
export const READER_LAYOUTS: readonly ReaderSettings['layout'][] = ['paged', 'scroll']

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontScale: 1,
  lineHeight: null,
  theme: 'app',
  layout: 'paged',
  notesOpen: false,
}

function nearest(steps: readonly number[], value: number): number {
  let best = steps[0]!
  for (const step of steps) if (Math.abs(step - value) < Math.abs(best - value)) best = step
  return best
}

/** Snaps any continuous pinch scale to the nearest supported EPUB font scale step. */
export function nearestFontScale(value: number): number {
  return nearest(FONT_SCALES, value)
}

const finite = (value: unknown): value is number => typeof value === 'number' && isFinite(value)

/**
 * Stored settings as the screen uses them: text size and line height snapped
 * to the nearest PC step, unknown themes and modes back to the defaults. The
 * PPTX reader's `notesOpen` is kept as stored (the settings are shared).
 */
export function snapReaderSettings(
  stored: Partial<ReaderSettings> | null | undefined,
): ReaderSettings {
  const raw = stored ?? {}
  const lineSteps = LINE_HEIGHTS.filter((v): v is Exclude<typeof v, null> => v !== null)
  return {
    fontScale: finite(raw.fontScale) && raw.fontScale > 0 ? nearest(FONT_SCALES, raw.fontScale) : 1,
    lineHeight: finite(raw.lineHeight) ? nearest(lineSteps, raw.lineHeight) : null,
    theme: READER_THEMES.find((theme) => theme === raw.theme) ?? DEFAULT_READER_SETTINGS.theme,
    layout:
      READER_LAYOUTS.find((layout) => layout === raw.layout) ?? DEFAULT_READER_SETTINGS.layout,
    notesOpen: raw.notesOpen === true,
  }
}

/**
 * The paper the book is drawn on. 'app' follows the app theme: dark when the
 * app is dark, or when it follows the system and the system is dark.
 */
export function resolveReadingTheme(
  theme: ReaderTheme,
  appTheme: MobileTheme,
  systemDark: boolean,
): ReadingTheme {
  if (theme !== 'app') return theme
  return appTheme === 'dark' || (appTheme === 'system' && systemDark) ? 'dark' : 'light'
}

function lineHeightRule(lineHeight: number | null): string[] {
  return lineHeight === null ? [] : [`body, body * { line-height: ${lineHeight} !important; }`]
}

function findRule(colors: FrameColors): string {
  return `::highlight(${FIND_HIGHLIGHT}) { background-color: ${colors.hitBg}; color: ${colors.hitInk}; }`
}

/** The frame CSS of the paged mode: the PC preview's pages, the reader's line height, the search mark. */
export function pagedCss(
  geom: PageGeometry,
  settings: ReaderSettings,
  theme: ReadingTheme,
  colors: FrameColors,
): string {
  return [
    previewCss(
      geom,
      { device: 'fit', landscape: false, theme, fontScale: settings.fontScale },
      colors,
    ),
    ...lineHeightRule(settings.lineHeight),
    findRule(colors),
    'html { touch-action: pan-x pan-y; }',
  ].join('\n')
}

/**
 * The frame CSS of the scroll mode: the PC chapter view's settings
 * (`viewPrefsCss`) with the chosen paper. `viewPrefsCss` knows only light and
 * dark and writes its theme rules first, so those lines are swapped for the
 * chosen theme's.
 */
export function scrollCss(
  settings: ReaderSettings,
  theme: ReadingTheme,
  colors: FrameColors,
): string {
  const prefs = { fontScale: settings.fontScale, lineHeight: settings.lineHeight, dark: false }
  const rest = viewPrefsCss(prefs, colors).split('\n').slice(themeCss('light', colors).length)
  return [...themeCss(theme, colors), ...rest, 'html { touch-action: pan-x pan-y; }'].join('\n')
}

/** The pages advance this way: vertical writing runs downwards, rtl and vertical-rl turn leftwards. */
export function readingFlow(
  facts: { rtl: boolean; verticalWriting: boolean },
  style?: { writingMode: string; direction: string } | null,
): PageFlow {
  if (!style)
    return {
      axis: facts.verticalWriting ? 'vertical' : 'horizontal',
      rtl: facts.rtl || facts.verticalWriting,
    }
  return {
    axis: style.writingMode.startsWith('vertical') ? 'vertical' : 'horizontal',
    // vertical-rl books turn their pages leftwards too, as readers do (as the PC preview)
    rtl: facts.rtl || style.direction === 'rtl' || style.writingMode === 'vertical-rl',
  }
}

export type ScreenSide = 'left' | 'right'
export type TapZone = ScreenSide | 'middle'

/** A tap on this share of the width at either edge turns the page; the rest is the middle. */
export const EDGE_SHARE = 0.3

export function tapZone(x: number, width: number): TapZone {
  if (width <= 0) return 'middle'
  if (x < width * EDGE_SHARE) return 'left'
  if (x > width * (1 - EDGE_SHARE)) return 'right'
  return 'middle'
}

/** The page step of the right or left side: right is forward, reversed for rtl and vertical books. */
export function sideStep(side: ScreenSide, reversed: boolean): 1 | -1 {
  const forward = side === 'right'
  return forward !== reversed ? 1 : -1
}

/** A swipe moves the page with the finger: a swipe to the left shows the right side's page. */
export function swipeStep(dx: number, reversed: boolean): 1 | -1 {
  return sideStep(dx < 0 ? 'right' : 'left', reversed)
}

/** Movement (CSS px) below which a touch is a tap, and above which a mostly sideways one is a swipe. */
export const TAP_SLOP = 12
export const SWIPE_MIN = 40
/** A touch held longer than this is a long press (selection), not a tap. */
export const TAP_MAX_MS = 500
/** Vertical drag (CSS px) past a chapter edge that moves to the next or previous chapter in scroll mode. */
export const OVERSCROLL_DRAG = 80

export interface GestureSample {
  dx: number
  dy: number
  ms: number
  /** text was selected when the touch began */
  selectedBefore: boolean
  /** text is selected now */
  selectedAfter: boolean
  /** the touch began on a link (the link handles it) */
  onLink: boolean
}

export type Gesture = 'tap' | 'swipe' | 'none'

/**
 * What a finished touch was. A touch that started or changed a selection,
 * that began while text was selected (it clears it), or that began on a link
 * is not a page turn.
 */
export function classifyGesture(sample: GestureSample): Gesture {
  if (sample.onLink || sample.selectedBefore || sample.selectedAfter) return 'none'
  const ax = Math.abs(sample.dx)
  const ay = Math.abs(sample.dy)
  if (ax < TAP_SLOP && ay < TAP_SLOP) return sample.ms <= TAP_MAX_MS ? 'tap' : 'none'
  if (ax >= SWIPE_MIN && ax > ay * 1.5) return 'swipe'
  return 'none'
}

export type TurnResult = { kind: 'view'; view: number } | { kind: 'chapter'; dir: 1 | -1 }

/** One page on inside the chapter, or on to the next (previous) chapter at its end (start). */
export function turnWithin(view: number, views: number, step: 1 | -1): TurnResult {
  const next = view + step
  if (next >= 0 && next < views) return { kind: 'view', view: next }
  return { kind: 'chapter', dir: step }
}
