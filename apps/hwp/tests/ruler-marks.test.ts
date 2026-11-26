import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  RULER_MARKS_MODULE,
  STUDIO_PATCHES,
  applyPatch,
  patchTargets,
} from '../scripts/rhwp-patches.mjs'
import {
  createRulerTip,
  dragParaMark,
  hitRulerMark,
  isParaMark,
  paraMarkProps,
  paraMarkRange,
  paraMarkXs,
  paraState,
  rulerMarkLabel,
} from '../studio-plugin/ruler-marks.mjs'

const CORE_MANIFEST = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'vendor', 'rhwp-core', 'package.json'), 'utf8'),
)
const STUDIO_ROOT = join(
  __dirname,
  '..',
  'node_modules',
  '.cache',
  'rhwp-studio',
  CORE_MANIFEST.rhwp.tag,
  'rhwp-studio',
)

/** A paragraph area 400 px wide at x 100, at 100 percent. */
const AREA = { refLeft: 100, refRight: 500, zoom: 1 }
/** One point in page pixels (96 dpi). */
const PT = 96 / 72
/** One point in the paragraph's stored unit (twice HWPUNIT). */
const PT_UNITS = 200

describe('ruler paragraph marks', () => {
  it('names every mark as Hancom Hangul does, in Korean and in English', () => {
    expect(rulerMarkLabel('paraFirst', 'ko')).toBe('첫 줄 시작 위치')
    expect(rulerMarkLabel('paraRest', 'ko')).toBe('나머지 줄 시작 위치')
    expect(rulerMarkLabel('paraLeft', 'ko')).toBe('문단 왼쪽 여백')
    expect(rulerMarkLabel('paraRight', 'ko')).toBe('문단 오른쪽 여백')
    expect(rulerMarkLabel('pageMarginLeft', 'ko')).toBe('용지 왼쪽 여백')
    expect(rulerMarkLabel('pageMarginRight', 'ko')).toBe('용지 오른쪽 여백')
    expect(rulerMarkLabel('paraRest', 'en')).toBe('Other lines start')
    expect(rulerMarkLabel('unknown', 'ko')).toBe('')
  })

  it('puts the first-line and the other-lines marks where the lines start', () => {
    // indented: the first line further in
    expect(paraState({ marginLeftPx: 20, indentPx: 10, marginRightPx: 5 })).toEqual({
      first: 30,
      rest: 20,
      right: 5,
    })
    // hanging (내어쓰기): the lines after the first further in
    const hanging = paraState({ marginLeftPx: 20, indentPx: -15 })
    expect(hanging).toEqual({ first: 20, rest: 35, right: 0 })
    expect(paraMarkXs(hanging, { ...AREA, zoom: 2 })).toEqual({
      paraFirst: 140,
      paraRest: 170,
      paraLeft: 170,
      paraRight: 500,
    })
  })

  it('writes a hanging indent when the other-lines mark is dragged past the first line', () => {
    const values = { marginLeftPx: 0, indentPx: 0, marginRightPx: 0 }
    const state = dragParaMark('paraRest', 100 + 12 * PT, values, AREA)
    expect(state.first).toBe(0)
    expect(paraMarkProps('paraRest', state)).toEqual({ marginLeft: 0, indent: -12 * PT_UNITS })
  })

  it('turns a first line dragged left of the other lines into a hang', () => {
    // margin 20 pt, first line 10 pt further in; the first line goes to 5 pt
    const values = { marginLeftPx: 20 * PT, indentPx: 10 * PT, marginRightPx: 0 }
    const props = paraMarkProps('paraFirst', dragParaMark('paraFirst', 100 + 5 * PT, values, AREA))
    expect(props).toEqual({ marginLeft: 5 * PT_UNITS, indent: -15 * PT_UNITS })
  })

  it('moves both starts with the left margin mark and keeps the hang', () => {
    const values = { marginLeftPx: 10 * PT, indentPx: -20 * PT, marginRightPx: 0 }
    const startX = paraMarkXs(paraState(values), AREA).paraLeft
    const moved = dragParaMark('paraLeft', startX + 6 * PT, values, { ...AREA, startX })
    expect(paraMarkProps('paraLeft', moved)).toEqual({
      marginLeft: 16 * PT_UNITS,
      indent: -20 * PT_UNITS,
    })
    // and no further left than the edge of the area
    const back = dragParaMark('paraLeft', startX - 80 * PT, values, { ...AREA, startX })
    expect(paraMarkProps('paraLeft', back)).toEqual({ marginLeft: 0, indent: -20 * PT_UNITS })
  })

  it('writes even values on a tenth of a point, which the engine draws where they are', () => {
    // 12.34 pt and 7.77 pt: px * 150 would be odd units, which the engine draws five times as far in
    const state = { first: 12.34 * PT, rest: 19.77 * PT, right: 7.77 * PT }
    const left = paraMarkProps('paraRest', state)
    const right = paraMarkProps('paraRight', state)
    expect(left).toEqual({ marginLeft: 2460, indent: -1480 })
    expect(right).toEqual({ marginRight: 1560 })
    for (const value of [left.marginLeft, left.indent, right.marginRight])
      expect(Math.abs(value % 20)).toBe(0)
  })

  it('sets the right margin from the right mark', () => {
    const state = dragParaMark('paraRight', 500 - 9 * PT, paraState({}), AREA)
    expect(paraMarkProps('paraRight', state)).toEqual({ marginRight: 9 * PT_UNITS })
  })

  it('keeps each mark inside the area and short of the line end', () => {
    const values = { marginLeftPx: 10, indentPx: -30, marginRightPx: 20 }
    expect(paraMarkRange('paraFirst', values, AREA, 40)).toEqual({ min: 100, max: 440 })
    expect(paraMarkRange('paraRest', values, AREA, 40)).toEqual({ min: 100, max: 440 })
    // furthest start 40: the right mark stays 40 px past it
    expect(paraMarkRange('paraRight', values, AREA, 40)).toEqual({ min: 180, max: 500 })
    // the □ from where the drag began: 10 px left at most, and right until the furthest
    // start meets the line end less the gap
    expect(paraMarkRange('paraLeft', values, { ...AREA, startX: 140 }, 40)).toEqual({
      min: 130,
      max: 140 + (480 - 40 - 140),
    })
  })

  it('takes the mark of the height the pointer is at, and a page margin edge between them', () => {
    const pins = [
      { kind: 'pageMarginLeft', x: 100, y: 20 },
      { kind: 'pageMarginRight', x: 500, y: 20 },
      { kind: 'paraFirst', x: 100, y: 0 },
      { kind: 'paraRest', x: 100, y: 0 },
      { kind: 'paraLeft', x: 100, y: 0 },
      { kind: 'paraRight', x: 500, y: 0 },
    ]
    expect(hitRulerMark(pins, 101, 2, 20)?.kind).toBe('paraFirst')
    expect(hitRulerMark(pins, 99, 12, 20)?.kind).toBe('paraRest')
    expect(hitRulerMark(pins, 100, 18, 20)?.kind).toBe('paraLeft')
    expect(hitRulerMark(pins, 498, 12, 20)?.kind).toBe('paraRight')
    expect(hitRulerMark(pins, 100, 8, 20)?.kind).toBe('pageMarginLeft')
    expect(hitRulerMark(pins, 503, 8, 20)?.kind).toBe('pageMarginRight')
    expect(hitRulerMark(pins, 300, 12, 20)).toBeNull()
    expect(isParaMark('paraRest')).toBe(true)
    expect(isParaMark('pageMarginLeft')).toBe(false)
    expect(isParaMark(undefined)).toBe(false)
  })

  it('shows the name box after a short rest and hides it again', () => {
    vi.useFakeTimers()
    const appended: FakeBox[] = []
    const doc = {
      createElement: () => new FakeBox(),
      body: { append: (box: FakeBox) => appended.push(box) },
      documentElement: { clientWidth: 800 },
    }
    const tip = createRulerTip(doc as never)
    tip.show('첫 줄 시작 위치', 120, 40)
    expect(appended).toHaveLength(0)
    vi.advanceTimersByTime(300)
    expect(appended).toHaveLength(1)
    const box = appended[0]
    expect(box.textContent).toBe('첫 줄 시작 위치')
    expect(box.attributes.role).toBe('tooltip')
    expect(box.style.display).toBe('block')
    expect(box.style.top).toBe('43px')
    // a second mark while one shows: at once
    tip.show('나머지 줄 시작 위치', 160, 40)
    expect(box.textContent).toBe('나머지 줄 시작 위치')
    tip.hide()
    expect(box.style.display).toBe('none')
    tip.dispose()
    expect(box.removed).toBe(true)
    vi.useRealTimers()
  })
})

class FakeBox {
  className = ''
  textContent = ''
  offsetWidth = 90
  removed = false
  attributes: Record<string, string> = {}
  style: Record<string, string> = {}
  setAttribute(name: string, value: string) {
    this.attributes[name] = value
  }
  remove() {
    this.removed = true
  }
}

describe('studio-ruler-para-marks', () => {
  it('is in the studio build after the patches it follows', () => {
    expect(STUDIO_PATCHES).toContain('studio-ruler-para-kinds')
    expect(STUDIO_PATCHES).toContain('studio-ruler-para-marks')
    expect(patchTargets('studio-ruler-para-marks', '/x/rhwp-studio/src/view/ruler.ts')).toBe(true)
    expect(
      patchTargets('studio-ruler-para-kinds', '/x/rhwp-studio/src/view/ruler-pin-geometry.ts'),
    ).toBe(true)
  })

  it.skipIf(!existsSync(STUDIO_ROOT))('applies to the pinned rhwp-studio checkout', () => {
    const ruler = applyPatch(
      'studio-ruler-para-marks',
      readFileSync(join(STUDIO_ROOT, 'src/view/ruler.ts'), 'utf8'),
    )
    expect(ruler).toContain(`from '${RULER_MARKS_MODULE}'`)
    expect(ruler).toContain('drawParaMarks(ctx, marks, canvasH)')
    expect(ruler).not.toContain('this.drawTriangleUp(ctx, pageLeftPinX')
    const kinds = applyPatch(
      'studio-ruler-para-kinds',
      readFileSync(join(STUDIO_ROOT, 'src/view/ruler-pin-geometry.ts'), 'utf8'),
    )
    expect(kinds).toContain("'paraFirst' | 'paraRest' | 'paraLeft' | 'paraRight'")
  })
})
