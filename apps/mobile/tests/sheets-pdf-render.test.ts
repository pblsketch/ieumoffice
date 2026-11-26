// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import {
  faceRuns,
  parseCssColor,
  parseInsetShadows,
  shadowBands,
} from '../src/renderer/editors/sheets/pdf/domToPdf'
import {
  bundledFaceSpecs,
  FaceResolver,
  fontFaceCss,
  loadFace,
  parseFontFamilyList,
  pdfLibFontkit,
} from '../src/renderer/editors/sheets/pdf/fonts'

const repo = resolve(__dirname, '../../..')
const specs = bundledFaceSpecs({
  calibri: 'calibri.ttf',
  calibriBold: 'calibri-bold.ttf',
  arial: 'arial.ttf',
  arialBold: 'arial-bold.ttf',
  korean: 'korean.woff2',
})
const files: Record<string, string> = {
  calibri: 'packages/ui/src/fonts/Carlito-Regular.ttf',
  'calibri-bold': 'packages/ui/src/fonts/Carlito-Bold.ttf',
  arial: 'apps/docs/src/renderer/fonts/LiberationSans-Regular.ttf',
  'arial-bold': 'apps/docs/src/renderer/fonts/LiberationSans-Bold.ttf',
  korean: 'apps/mobile/src/renderer/assets/fonts/GenOfficeSansKR-Regular-subset.woff2',
}
const faces = specs.map((spec) =>
  loadFace(spec, new Uint8Array(readFileSync(resolve(repo, files[spec.id] as string)))),
)
const face = (id: string) => faces.find((candidate) => candidate.spec.id === id)

/** The desktop's print stack for a cell in Malgun-less Korean UI (print-html.ts). */
const STACK = parseFontFamilyList(
  "Calibri, 'Helvetica Neue', Arial, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
)

describe('sheet PDF drawing helpers', () => {
  it('reads computed colors', () => {
    expect(parseCssColor('rgb(255, 0, 51)')).toEqual({ r: 1, g: 0, b: 0.2, a: 1 })
    expect(parseCssColor('rgba(0, 0, 0, 0)')).toBeNull()
    expect(parseCssColor('rgb(0 128 255 / 50%)')?.a).toBe(0.5)
    expect(parseCssColor('#c0c0c0')).toEqual({
      r: 192 / 255,
      g: 192 / 255,
      b: 192 / 255,
      a: 1,
    })
    expect(parseCssColor('transparent')).toBeNull()
  })

  it('reads the inset borders the desktop markup paints, in either engine order', () => {
    // Blink lists the color first, WebKit may put `inset` first.
    const blink = parseInsetShadows(
      'rgb(0, 0, 0) 0px 2px 0px 0px inset, rgb(192, 192, 192) -1px 0px 0px 0px inset',
    )
    const webkit = parseInsetShadows(
      'inset 0px 2px 0px 0px rgb(0, 0, 0), inset -1px 0px rgb(192, 192, 192)',
    )
    for (const shadows of [blink, webkit]) {
      expect(shadows).toHaveLength(2)
      expect(shadows[0]).toMatchObject({ x: 0, y: 2, color: { r: 0, g: 0, b: 0 } })
      expect(shadows[1]).toMatchObject({ x: -1, y: 0 })
    }
    expect(parseInsetShadows('none')).toEqual([])
    // Outer and blurred shadows are not border marks.
    expect(parseInsetShadows('rgb(0, 0, 0) 0px 2px 4px 0px')).toEqual([])
  })

  it('turns an inset shadow into the band it paints', () => {
    const box = { left: 10, top: 20, width: 100, height: 30 }
    const color = { r: 0, g: 0, b: 0, a: 1 }
    expect(shadowBands(box, { color, x: 0, y: 2 })).toEqual([
      { left: 10, top: 20, width: 100, height: 2 },
    ])
    expect(shadowBands(box, { color, x: 0, y: -1 })).toEqual([
      { left: 10, top: 49, width: 100, height: 1 },
    ])
    expect(shadowBands(box, { color, x: 3, y: 0 })).toEqual([
      { left: 10, top: 20, width: 3, height: 30 },
    ])
    expect(shadowBands(box, { color, x: -1, y: 0 })).toEqual([
      { left: 109, top: 20, width: 1, height: 30 },
    ])
  })
})

describe('sheet PDF fonts', () => {
  const resolver = new FaceResolver(faces)

  it('falls back through the desktop font stack like the browser', () => {
    const pick = (families: readonly string[], bold: boolean, char: string) => {
      const choice = resolver.choose(families, bold, char.codePointAt(0) as number)
      return choice ? [choice.face.spec.id, choice.syntheticBold] : null
    }
    expect(pick(STACK, false, 'A')).toEqual(['calibri', false])
    expect(pick(STACK, true, 'A')).toEqual(['calibri-bold', false])
    // Hangul is not in Carlito: the Korean face takes it, thickened for bold.
    expect(pick(STACK, true, '가')).toEqual(['korean', true])
    // A cell font of Arial uses its metric twin.
    expect(pick(['Arial', ...STACK], false, 'A')).toEqual(['arial', false])
    // Hanja are outside the bundled subset.
    expect(pick(STACK, false, '漢')).toBeNull()
    expect(resolver.primary(STACK, false).spec.id).toBe('calibri')
    expect(resolver.primary(['맑은 고딕', ...STACK], true).spec.id).toBe('korean')
  })

  it('splits mixed text into runs of one face, spaces staying with their run', () => {
    const text = 'A4 복사용지 (500매)'
    const runs = faceRuns(text, 0, text.length, resolver, STACK, false)
    expect(runs.map((run) => [text.slice(run.start, run.end), run.face?.spec.id])).toEqual([
      ['A4 ', 'calibri'],
      ['복사용지 ', 'korean'],
      ['(500', 'calibri'],
      ['매', 'korean'],
      [')', 'calibri'],
    ])
  })

  it('declares every desktop family over its bundled face for the print page', () => {
    const css = fontFaceCss(faces, (loaded) => `blob:${loaded.spec.id}`)
    expect(css).toContain('font-family:"calibri";src:url("blob:calibri");font-weight:400')
    expect(css).toContain('font-family:"malgun gothic";src:url("blob:korean");font-weight:400')
    expect(css).toContain('font-family:"calibri";src:url("blob:calibri-bold");font-weight:700')
    expect(css).toContain('font-family:"ieum-pdf-korean"')
  })

  it('embeds a subset of the WOFF2 Korean face through pdf-lib', async () => {
    const pdf = await PDFDocument.create()
    pdf.registerFontkit(pdfLibFontkit as unknown as Parameters<PDFDocument['registerFontkit']>[0])
    const korean = await pdf.embedFont((face('korean') as { bytes: Uint8Array }).bytes, {
      subset: true,
    })
    const latin = await pdf.embedFont((face('calibri') as { bytes: Uint8Array }).bytes, {
      subset: true,
    })
    const page = pdf.addPage([200, 100])
    page.drawText('견적서 합계', { font: korean, size: 12, x: 10, y: 60 })
    page.drawText('Total 1,234', { font: latin, size: 12, x: 10, y: 30 })
    const bytes = await pdf.save({ useObjectStreams: false })
    // The subsets are a few kilobytes, not the 300 KB and 630 KB faces.
    expect(bytes.length).toBeLessThan(60_000)
    const reopened = await PDFDocument.load(bytes)
    expect(reopened.getPageCount()).toBe(1)
    const raw = new TextDecoder('latin1').decode(bytes)
    expect(raw).toContain('/FontFile2')
    expect(raw).toContain('/ToUnicode')
  })
})
