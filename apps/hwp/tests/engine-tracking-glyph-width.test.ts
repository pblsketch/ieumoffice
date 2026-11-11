// @vitest-environment jsdom
/** Tracking moves origins; it must not become a second horizontal glyph scale. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import init, { HwpDocument } from '@rhwp/core'
import { beforeAll, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const text = '2024년 65,063,026,600'
const tableRefs = new WeakMap<HwpDocument, { paraIdx: number; controlIdx: number }>()

beforeAll(async () => {
  await init({
    module_or_path: readFileSync(join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')),
  })
})

function specimen(cell: boolean, spacings: number[], ratio: number) {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  doc.setHangul2024Compat(false)
  const fontIds = Array.from({ length: 7 }, (_, lang) =>
    doc.findOrCreateFontIdForLang(lang, '맑은 고딕'),
  )
  const props = JSON.stringify({ fontSize: 900, fontIds, spacings, ratios: Array(7).fill(ratio) })
  if (cell) {
    const made = JSON.parse(doc.createTable(0, 0, 0, 1, 1))
    expect(made.ok).toBe(true)
    tableRefs.set(doc, made)
    doc.insertTextInCell(0, made.paraIdx, made.controlIdx, 0, 0, 0, text)
    doc.applyCharFormatInCell(0, made.paraIdx, made.controlIdx, 0, 0, 0, text.length, props)
  } else {
    doc.insertText(0, 0, 0, text)
    doc.applyCharFormat(0, 0, 0, text.length, props)
  }
  return doc
}

function asciiGlyphs(doc: HwpDocument) {
  expect(doc.pageCount()).toBe(1)
  const svg = new DOMParser().parseFromString(
    doc.renderPageSvgWithProfile(0, 'print'),
    'image/svg+xml',
  )
  return [...svg.querySelectorAll('text')]
    .filter((node) => /^[0-9,]$/.test(node.textContent ?? ''))
    .map((node) => ({
      text: node.textContent,
      x: Number(node.getAttribute('x')),
      y: Number(node.getAttribute('y')),
      size: Number(node.getAttribute('font-size')),
      width: node.hasAttribute('textLength') ? Number(node.getAttribute('textLength')) : null,
    }))
}

function reopen(doc: HwpDocument, format: 'hwp' | 'hwpx') {
  const next = new HwpDocument(format === 'hwp' ? doc.exportHwp() : doc.exportHwpx())
  next.setHangul2024Compat(false)
  const ref = tableRefs.get(doc)
  if (ref) tableRefs.set(next, ref)
  return next
}

function firstDigitStep(doc: HwpDocument) {
  const ref = tableRefs.get(doc)
  const cursor = (offset: number) =>
    JSON.parse(
      ref
        ? doc.getCursorRectInCell(0, ref.paraIdx, ref.controlIdx, 0, 0, offset)
        : doc.getCursorRect(0, 0, offset),
    )
  return cursor(1).x - cursor(0).x
}

describe('source tracking and intrinsic glyph widths', () => {
  for (const cell of [false, true]) {
    for (const format of ['hwp', 'hwpx'] as const) {
      it.each([
        [-31, 100],
        [-24, 70],
        [-5, 100],
        [20, 100],
        [20, 125],
      ])(
        `preserves glyph widths in ${cell ? 'table' : 'body'} ${format}, spacing %i / ratio %i`,
        (spacing, ratio) => {
          const plain = specimen(cell, Array(7).fill(0), ratio)
          const tracked = specimen(cell, Array(7).fill(spacing), ratio)
          const zero = reopen(plain, format)
          const actual = reopen(tracked, format)
          try {
            const beforeHwp = actual.exportHwp()
            const beforeHwpx = actual.exportHwpx()
            const expected = asciiGlyphs(zero)
            const glyphs = asciiGlyphs(actual)
            expect(glyphs.map((glyph) => glyph.text).join('')).toBe('202465,063,026,600')
            expect(glyphs.map((glyph) => glyph.text)).toEqual(expected.map((glyph) => glyph.text))
            for (let i = 0; i < expected.length; i++) {
              if (expected[i]!.width === null) expect(glyphs[i]!.width).toBeNull()
              else {
                expect(expected[i]!.width).toBeGreaterThan(0)
                expect(glyphs[i]!.width).toBeCloseTo(expected[i]!.width!, 3)
              }
              expect(glyphs[i]!.size).toBe(expected[i]!.size)
              expect(glyphs[i]!.y).toBe(expected[i]!.y)
            }
            const step = firstDigitStep(actual)
            const zeroStep = firstDigitStep(zero)
            if (spacing < 0) expect(step).toBeLessThan(zeroStep)
            else expect(step).toBeGreaterThan(zeroStep)
            // Paint must leave both source formats untouched.
            expect(actual.exportHwp()).toEqual(beforeHwp)
            expect(actual.exportHwpx()).toEqual(beforeHwpx)
          } finally {
            actual.free()
            zero.free()
            tracked.free()
            plain.free()
          }
        },
      )

      it(`uses the Latin spacing slot in mixed-script ${cell ? 'table' : 'body'} ${format}`, () => {
        const hangul = specimen(cell, [-24, 0, 0, 0, 0, 0, 0], 100)
        const latin = specimen(cell, [0, -24, 0, 0, 0, 0, 0], 100)
        const first = reopen(hangul, format)
        const second = reopen(latin, format)
        try {
          const a = asciiGlyphs(first)
          const b = asciiGlyphs(second)
          expect(b.map((glyph) => glyph.width)).toEqual(a.map((glyph) => glyph.width))
          expect(firstDigitStep(second)).toBeLessThan(firstDigitStep(first))
        } finally {
          second.free()
          first.free()
          latin.free()
          hangul.free()
        }
      })
    }
  }
})
