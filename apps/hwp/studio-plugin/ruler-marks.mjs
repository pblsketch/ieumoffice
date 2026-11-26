/**
 * The paragraph marks of the Hangul tab's horizontal ruler, as Hancom Hangul has them, and
 * the name each one shows when the mouse rests on it (decision 0169).
 *
 * rhwp's ruler had one paragraph mark, ▽ for the first line, which it could only move right
 * of the left margin; its two △ were the page margins. A hanging paragraph (내어쓰기, the
 * second line starting under the words after a mark: 1., 가., □) could be neither seen nor
 * set there. Hangul has four marks for the paragraph the caret is in:
 *
 *   ▽ at the top          첫 줄 시작 위치    where the first line starts
 *   △ at the bottom       나머지 줄 시작 위치 where the lines after it start
 *   □ under that △        문단 왼쪽 여백      moves both, the paragraph as a whole
 *   △ at the right        문단 오른쪽 여백    where the lines end
 *
 * The page margins stay draggable at the edges of the white band, with no mark of their own.
 *
 * In the document a paragraph has a left margin and an indent: a positive indent starts the
 * first line further in, a negative one the lines after it (renderer/layout/paragraph_layout.rs).
 * The marks work in the two starts instead and turn them back into margin and indent when a
 * drag is dropped, so either start can pass the other, as in Hangul.
 *
 * Units: screen x is ruler canvas px; paragraph values are px at zoom 1 (96 dpi), as the
 * studio reports them; the commit is in the paragraph's stored unit (twice HWPUNIT).
 * Nothing here touches the DOM except createRulerTip and drawParaMarks.
 */

/** Module specifier the studio-ruler-para-marks patch imports; build-studio.mjs aliases it. */
export const RULER_MARKS_MODULE = '@ieum/ruler-marks'

/** The paragraph marks, in the order they are drawn. */
export const PARA_MARKS = ['paraFirst', 'paraRest', 'paraLeft', 'paraRight']

/** The page margin edges of the ruler, named as the studio names them. */
export const PAGE_MARGIN_MARKS = ['pageMarginLeft', 'pageMarginRight']

/** Whether `kind` is one of the four paragraph marks. */
export function isParaMark(kind) {
  return PARA_MARKS.includes(kind)
}

const LABELS = {
  paraFirst: { ko: '첫 줄 시작 위치', en: 'First line start' },
  paraRest: { ko: '나머지 줄 시작 위치', en: 'Other lines start' },
  paraLeft: { ko: '문단 왼쪽 여백', en: 'Paragraph left margin' },
  paraRight: { ko: '문단 오른쪽 여백', en: 'Paragraph right margin' },
  pageMarginLeft: { ko: '용지 왼쪽 여백', en: 'Page left margin' },
  pageMarginRight: { ko: '용지 오른쪽 여백', en: 'Page right margin' },
}

/** The name a ruler mark shows on hover, in the studio's locale (Korean or English). */
export function rulerMarkLabel(kind, locale) {
  const label = LABELS[kind]
  if (!label) return ''
  return locale === 'ko' ? label.ko : label.en
}

/** Size of a triangle mark and height of the □ under the lower one (CSS px). */
export const MARK_SIZE = 6
const SQUARE_HEIGHT = 4
/** How far from a paragraph mark, and from a page margin edge, a pointer still takes it. */
const PARA_HIT_X = 5
const PAGE_HIT_X = 4

/**
 * px (zoom 1, 96 dpi) to the paragraph's stored unit (200 to a point), on a tenth of a point
 * as the paragraph dialog shows it. The value must be even: the lowest bit of the stored value
 * marks its unit, and an odd one counts characters of the base style (rhwp #7816, as Hancom
 * Hangul reads it), so a dropped mark would land about five times as far in.
 */
const toParaUnits = (px) => 20 * Math.round((px * 150) / 20)

/**
 * Where the lines of a paragraph start and where they end, in px at zoom 1 from the edges of
 * the area it stands in (the text column, a column of several, or a table cell):
 * `{ first, rest, right }`.
 */
export function paraState({ marginLeftPx = 0, indentPx = 0, marginRightPx = 0 }) {
  return {
    first: marginLeftPx + Math.max(indentPx, 0),
    rest: marginLeftPx + Math.max(-indentPx, 0),
    right: marginRightPx,
  }
}

/** The screen x of each paragraph mark for `state` in `area` (`{ refLeft, refRight, zoom }`). */
export function paraMarkXs(state, area) {
  const rest = area.refLeft + state.rest * area.zoom
  return {
    paraFirst: area.refLeft + state.first * area.zoom,
    paraRest: rest,
    paraLeft: rest,
    paraRight: area.refRight - state.right * area.zoom,
  }
}

/**
 * Where a paragraph mark `kind` may be dragged, in screen px: inside the area, and short of the
 * line end (or of the later line start, for the right mark) by `minGap`. The □ moves both
 * starts, so its range follows from the pointer's start `area.startX`.
 */
export function paraMarkRange(kind, values, area, minGap) {
  const state = paraState(values)
  const { refLeft, refRight, zoom } = area
  const lineEnd = refRight - state.right * zoom
  const furthest = Math.max(state.first, state.rest)
  if (kind === 'paraRight') {
    return { min: refLeft + furthest * zoom + minGap, max: refRight }
  }
  if (kind === 'paraLeft') {
    const start = area.startX ?? 0
    return {
      min: start - Math.min(state.first, state.rest) * zoom,
      max: start + (lineEnd - minGap - (refLeft + furthest * zoom)),
    }
  }
  return { min: refLeft, max: lineEnd - minGap }
}

/**
 * The paragraph's starts and end with mark `kind` dragged to screen x (`area.startX`: where the
 * drag began, for the □). Nothing goes left of the area or right of its edge.
 */
export function dragParaMark(kind, x, values, area) {
  const state = paraState(values)
  const at = (x - area.refLeft) / area.zoom
  switch (kind) {
    case 'paraFirst':
      return { ...state, first: Math.max(0, at) }
    case 'paraRest':
      return { ...state, rest: Math.max(0, at) }
    case 'paraLeft': {
      const shift = Math.max(
        (x - (area.startX ?? x)) / area.zoom,
        -Math.min(state.first, state.rest),
      )
      return { ...state, first: state.first + shift, rest: state.rest + shift }
    }
    case 'paraRight':
      return { ...state, right: Math.max(0, (area.refRight - x) / area.zoom) }
    default:
      return state
  }
}

/**
 * The paragraph properties a dropped mark writes, in the stored unit. The left margin is the
 * nearer of the two starts and the indent the first line's distance from the other start:
 * positive when the first line starts further in, negative (내어쓰기) when the others do.
 */
export function paraMarkProps(kind, state) {
  if (kind === 'paraRight') return { marginRight: toParaUnits(state.right) }
  return {
    marginLeft: toParaUnits(Math.min(state.first, state.rest)),
    indent: toParaUnits(state.first - state.rest),
  }
}

/**
 * The paragraph marks a pointer at height `y` of a ruler `height` high can take: ▽ at the
 * top, the lower △ above the □ at the bottom, the right △ over both. The band between them
 * is left to the page margin edges, which a paragraph mark at the same place would hide.
 */
function marksAtHeight(y, height) {
  if (y <= MARK_SIZE) return ['paraFirst']
  if (y >= height - SQUARE_HEIGHT - 0.5) return ['paraLeft', 'paraRight']
  if (y >= height - SQUARE_HEIGHT - MARK_SIZE) return ['paraRest', 'paraRight']
  return []
}

/**
 * The ruler mark under the pointer at (x, y), from `pins` (`{ kind, x }`), or null: the nearest
 * paragraph mark of that height, else the nearest page margin edge at any height.
 */
export function hitRulerMark(pins, x, y, height) {
  const nearest = (candidates, reach) => {
    let best = null
    for (const pin of candidates) {
      const distance = Math.abs(pin.x - x)
      if (distance > reach) continue
      if (!best || distance < Math.abs(best.x - x)) best = pin
    }
    return best
  }
  const kinds = marksAtHeight(y, height)
  return (
    nearest(
      pins.filter((pin) => kinds.includes(pin.kind)),
      PARA_HIT_X,
    ) ??
    nearest(
      pins.filter((pin) => PAGE_MARGIN_MARKS.includes(pin.kind)),
      PAGE_HIT_X,
    )
  )
}

/** Draw the paragraph marks at `xs` (paraMarkXs) on a ruler `height` high, in the fill set. */
export function drawParaMarks(ctx, xs, height) {
  const half = MARK_SIZE / 2
  const triangle = (points) => {
    ctx.beginPath()
    ctx.moveTo(points[0], points[1])
    ctx.lineTo(points[2], points[3])
    ctx.lineTo(points[4], points[5])
    ctx.closePath()
    ctx.fill()
  }
  const restBase = height - SQUARE_HEIGHT
  triangle([xs.paraFirst - half, 0, xs.paraFirst + half, 0, xs.paraFirst, MARK_SIZE])
  triangle([
    xs.paraRest - half,
    restBase,
    xs.paraRest + half,
    restBase,
    xs.paraRest,
    restBase - MARK_SIZE,
  ])
  ctx.fillRect(xs.paraLeft - half, restBase + 0.5, MARK_SIZE, SQUARE_HEIGHT - 0.5)
  triangle([
    xs.paraRight - half,
    height,
    xs.paraRight + half,
    height,
    xs.paraRight,
    height - MARK_SIZE,
  ])
}

/** How long the pointer rests on a mark before its name shows, as a tooltip does. */
const TIP_DELAY_MS = 300

/**
 * The name box under the ruler. `show(text, x, top)` puts it at screen x below `top` after a
 * short rest (at once when one is showing already), `hide()` takes it away, `dispose()`
 * removes it. Its colours are the studio's own pale note colours, so a theme repaints it.
 */
export function createRulerTip(doc = globalThis.document) {
  let box = null
  let timer = null
  let shown = false
  const place = (text, x, top) => {
    if (!box) {
      box = doc.createElement('div')
      box.className = 'ieum-ruler-tip'
      box.setAttribute('role', 'tooltip')
      box.style.cssText = [
        'position:fixed',
        'z-index:10000',
        'pointer-events:none',
        'white-space:nowrap',
        'padding:2px 6px',
        'font-size:12px',
        'line-height:16px',
        'border-radius:2px',
        'background:var(--ui-warning-bg)',
        'color:var(--ui-text)',
        'border:1px solid var(--ui-border-strong)',
      ].join(';')
      doc.body.append(box)
    }
    box.textContent = text
    box.style.display = 'block'
    box.style.top = `${Math.round(top + 3)}px`
    const width = box.offsetWidth
    const room = doc.documentElement?.clientWidth ?? 0
    const left = room > 0 ? Math.min(Math.max(0, x - 6), room - width - 2) : x - 6
    box.style.left = `${Math.round(Math.max(0, left))}px`
    shown = true
  }
  const clear = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  return {
    show(text, x, top) {
      clear()
      if (shown) {
        place(text, x, top)
        return
      }
      timer = setTimeout(() => {
        timer = null
        place(text, x, top)
      }, TIP_DELAY_MS)
    },
    hide() {
      clear()
      shown = false
      if (box) box.style.display = 'none'
    },
    dispose() {
      clear()
      shown = false
      box?.remove()
      box = null
    },
  }
}
