/**
 * Outline reading, style-to-level mapping, document setting persistence,
 * table exclusion, printed page numbers, and active heading tracking tests
 * against the real `@rhwp/core` engine.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import {
  DEFAULT_OUTLINE_STYLE_MAP,
  DOC_OUTLINE_MAP_KEY,
  findActiveOutlineIndex,
  normalizeOutlineStyleMap,
  readDocOutlineMap,
  readOutline,
  resolveOutlineStyleMap,
  splitStyleHeadingText,
  writeDocOutlineMap,
} from '../studio-plugin/outline.mjs'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

interface StyleEntry {
  id: number
  name: string
  englishName?: string
}

function makeDoc(lines: string[]): HwpDocument {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  lines.forEach((line, index) => {
    if (index > 0) doc.splitParagraph(0, index - 1, doc.getParagraphLength(0, index - 1))
    if (line) doc.insertText(0, index, 0, line)
  })
  return doc
}

function styleIdByName(doc: HwpDocument, name: string): number {
  const styles = JSON.parse(doc.getStyleList()) as StyleEntry[]
  const found = styles.find((s) => s.name === name)
  if (!found) throw new Error(`Style not found: ${name}`)
  return found.id
}

function ensureStyle(doc: HwpDocument, name: string, englishName = ''): number {
  const styles = JSON.parse(doc.getStyleList()) as StyleEntry[]
  const existing = styles.find((s) => s.name === name)
  if (existing) return existing.id
  return doc.createStyle(
    JSON.stringify({
      name,
      englishName: englishName || name,
      type: 0,
      nextStyleId: 0,
    }),
  )
}

describe('outline style map defaults, normalization, and resolution', () => {
  it('defines 제목 1..10 and Heading 1..10 with 제목 N before Heading N per level', () => {
    const entries = Object.entries(DEFAULT_OUTLINE_STYLE_MAP)
    expect(entries).toHaveLength(20)
    for (let level = 1; level <= 10; level++) {
      expect(entries[(level - 1) * 2]).toEqual([`제목 ${level}`, level])
      expect(entries[(level - 1) * 2 + 1]).toEqual([`Heading ${level}`, level])
    }
  })

  it('normalizes style maps by trimming keys and keeping only integer levels 1..10', () => {
    const normalized = normalizeOutlineStyleMap({
      '  제목 1  ': 1,
      장제목: 2,
      '': 1,
      '   ': 2,
      tooLow: 0,
      negative: -1,
      tooHigh: 11,
      fractional: 2.5,
      nanVal: Number.NaN,
      stringVal: '3' as unknown as number,
      nullVal: null as unknown as number,
      maxValid: 10,
    })
    expect(normalized).toEqual({
      '제목 1': 1,
      장제목: 2,
      maxValid: 10,
    })
    expect(normalizeOutlineStyleMap(null)).toEqual({})
    expect(normalizeOutlineStyleMap(['제목 1'] as unknown as Record<string, number>)).toEqual({})
  })

  it('resolves effective map with docMap > appMap > defaults, honoring explicit empty maps', () => {
    expect(resolveOutlineStyleMap(undefined, undefined)).toEqual(DEFAULT_OUTLINE_STYLE_MAP)
    expect(resolveOutlineStyleMap(null, null)).toEqual(DEFAULT_OUTLINE_STYLE_MAP)
    // Explicit empty appMap means user removed all default mappings
    expect(resolveOutlineStyleMap({}, undefined)).toEqual({})
    expect(resolveOutlineStyleMap({ 장제목: 1 }, null)).toEqual({ 장제목: 1 })
    // Doc map takes full precedence over app map, including explicit empty {}
    expect(resolveOutlineStyleMap({ 장제목: 1 }, { 절제목: 2 })).toEqual({ 절제목: 2 })
    expect(resolveOutlineStyleMap({ 장제목: 1 }, {})).toEqual({})
  })

  it('splits common leading heading prefix tokens without losing text or mis-splitting plain titles', () => {
    expect(splitStyleHeadingText('제1장 서론')).toEqual({ number: '제1장', title: '서론' })
    expect(splitStyleHeadingText('제 2 절 연구 방법')).toEqual({
      number: '제 2 절',
      title: '연구 방법',
    })
    expect(splitStyleHeadingText('1. 서론')).toEqual({ number: '1.', title: '서론' })
    expect(splitStyleHeadingText('1.1 연구 배경')).toEqual({ number: '1.1', title: '연구 배경' })
    expect(splitStyleHeadingText('1.1.1 세부 목표')).toEqual({
      number: '1.1.1',
      title: '세부 목표',
    })
    expect(splitStyleHeadingText('Ⅰ. 이론적 배경')).toEqual({
      number: 'Ⅰ.',
      title: '이론적 배경',
    })
    expect(splitStyleHeadingText('가. 첫째 항목')).toEqual({ number: '가.', title: '첫째 항목' })
    expect(splitStyleHeadingText('(1) 분석 절차')).toEqual({ number: '(1)', title: '분석 절차' })
    expect(splitStyleHeadingText('A. Appendix Overview')).toEqual({
      number: 'A.',
      title: 'Appendix Overview',
    })
    // No leading marker or marker-only text stays in title
    expect(splitStyleHeadingText('서론')).toEqual({ number: '', title: '서론' })
    expect(splitStyleHeadingText('1.')).toEqual({ number: '', title: '1.' })
    expect(splitStyleHeadingText('2026 연구 계획')).toEqual({
      number: '',
      title: '2026 연구 계획',
    })
    expect(splitStyleHeadingText('A study on AI')).toEqual({
      number: '',
      title: 'A study on AI',
    })
  })
})

describe('readOutline against real @rhwp/core documents', () => {
  it('reads outline-only paragraphs with engine levels, numbers, titles, pages, and source=outline', () => {
    const doc = makeDoc(['서론', '연구 배경', '세부 질문', '일반 본문 문단입니다.'])
    doc.applyStyle(0, 0, styleIdByName(doc, '개요 1'))
    doc.applyStyle(0, 1, styleIdByName(doc, '개요 2'))
    doc.applyStyle(0, 2, styleIdByName(doc, '개요 3'))

    const result = readOutline(doc)
    expect(result.hasDocStyleMap).toBe(false)
    expect(result.docStyleMap).toBeNull()
    expect(result.effectiveStyleMap).toEqual(DEFAULT_OUTLINE_STYLE_MAP)
    expect(result.items).toHaveLength(3)

    expect(result.items[0]).toMatchObject({
      level: 1,
      title: '서론',
      page: 1,
      physicalPage: 1,
      sec: 0,
      para: 0,
      source: 'outline',
      styleName: '개요 1',
    })
    expect(result.items[0]!.number.length).toBeGreaterThan(0)

    expect(result.items[1]).toMatchObject({
      level: 2,
      title: '연구 배경',
      page: 1,
      physicalPage: 1,
      sec: 0,
      para: 1,
      source: 'outline',
      styleName: '개요 2',
    })
    expect(result.items[1]!.number.length).toBeGreaterThan(0)

    expect(result.items[2]).toMatchObject({
      level: 3,
      title: '세부 질문',
      page: 1,
      physicalPage: 1,
      sec: 0,
      para: 2,
      source: 'outline',
      styleName: '개요 3',
    })
    expect(result.items[2]!.number.length).toBeGreaterThan(0)
  })

  it('merges style-mapped headings and outline paragraphs in document order without duplicates', () => {
    const doc = makeDoc([
      '제1장 서론',
      '개요 기반 절',
      '   ',
      '1.1 선행 연구',
      '본문 설명',
      'A. 영문 부록',
    ])
    const title1Id = ensureStyle(doc, '제목 1', 'Heading 1')
    const heading2Id = ensureStyle(doc, 'Heading 2', 'Heading 2')
    const customId = ensureStyle(doc, '장제목', 'ChapterTitle')
    const outline2Id = styleIdByName(doc, '개요 2')

    doc.applyStyle(0, 0, title1Id)
    doc.applyStyle(0, 1, outline2Id)
    doc.applyStyle(0, 2, title1Id) // whitespace-only styled paragraph should be skipped
    doc.applyStyle(0, 3, customId)
    doc.applyStyle(0, 5, heading2Id)

    // Include outline style in style map too -> para 1 must NOT be duplicated and must stay source='outline'
    const result = readOutline(doc, {
      appStyleMap: {
        ...DEFAULT_OUTLINE_STYLE_MAP,
        장제목: 2,
        '개요 2': 4,
      },
    })

    expect(result.items).toHaveLength(4)
    expect(result.items.map((item) => item.para)).toEqual([0, 1, 3, 5])

    expect(result.items[0]).toMatchObject({
      level: 1,
      number: '제1장',
      title: '서론',
      sec: 0,
      para: 0,
      source: 'style',
      styleName: '제목 1',
    })
    expect(result.items[1]).toMatchObject({
      level: 2,
      title: '개요 기반 절',
      sec: 0,
      para: 1,
      source: 'outline',
      styleName: '개요 2',
    })
    expect(result.items[2]).toMatchObject({
      level: 2,
      number: '1.1',
      title: '선행 연구',
      sec: 0,
      para: 3,
      source: 'style',
      styleName: '장제목',
    })
    expect(result.items[3]).toMatchObject({
      level: 2,
      number: 'A.',
      title: '영문 부록',
      sec: 0,
      para: 5,
      source: 'style',
      styleName: 'Heading 2',
    })
  })

  it('persists document-level outline style map across HWP and HWPX export/reload and overrides app map', () => {
    expect(DOC_OUTLINE_MAP_KEY).toBe('개요수준')

    const doc = makeDoc(['커스텀 장 제목', '기본 제목 1', '본문'])
    const customId = ensureStyle(doc, '논문장제목')
    const title1Id = ensureStyle(doc, '제목 1', 'Heading 1')
    doc.applyStyle(0, 0, customId)
    doc.applyStyle(0, 1, title1Id)

    expect(readDocOutlineMap(doc)).toBeNull()

    const writeRes = writeDocOutlineMap(doc, { 논문장제목: 1 })
    expect(writeRes.ok).toBe(true)
    expect(readDocOutlineMap(doc)).toEqual({ 논문장제목: 1 })

    // Doc map overrides appStyleMap (default title style is excluded while custom style is included)
    const beforeSave = readOutline(doc, { appStyleMap: DEFAULT_OUTLINE_STYLE_MAP })
    expect(beforeSave.hasDocStyleMap).toBe(true)
    expect(beforeSave.docStyleMap).toEqual({ 논문장제목: 1 })
    expect(beforeSave.effectiveStyleMap).toEqual({ 논문장제목: 1 })
    expect(beforeSave.items.map((item) => item.title)).toEqual(['커스텀 장 제목'])

    // Round-trip through real HWP binary
    const reloadedHwp = new HwpDocument(doc.exportHwp())
    expect(readDocOutlineMap(reloadedHwp)).toEqual({ 논문장제목: 1 })
    const afterHwp = readOutline(reloadedHwp, { appStyleMap: DEFAULT_OUTLINE_STYLE_MAP })
    expect(afterHwp.hasDocStyleMap).toBe(true)
    expect(afterHwp.items.map((item) => item.title)).toEqual(['커스텀 장 제목'])

    // Round-trip through real HWPX archive
    const reloadedHwpx = new HwpDocument(doc.exportHwpx())
    expect(readDocOutlineMap(reloadedHwpx)).toEqual({ 논문장제목: 1 })
    const afterHwpx = readOutline(reloadedHwpx, { appStyleMap: DEFAULT_OUTLINE_STYLE_MAP })
    expect(afterHwpx.hasDocStyleMap).toBe(true)
    expect(afterHwpx.items.map((item) => item.title)).toEqual(['커스텀 장 제목'])

    // Clearing doc map falls back to appStyleMap
    const clearRes = writeDocOutlineMap(reloadedHwpx, null)
    expect(clearRes.ok).toBe(true)
    expect(readDocOutlineMap(reloadedHwpx)).toBeNull()
    const afterClear = readOutline(reloadedHwpx, { appStyleMap: DEFAULT_OUTLINE_STYLE_MAP })
    expect(afterClear.hasDocStyleMap).toBe(false)
    expect(afterClear.docStyleMap).toBeNull()
    expect(afterClear.items.map((item) => item.title)).toEqual(['기본 제목 1'])
  })

  it('persists an explicit empty document map {} across HWP and HWPX reload and overrides appStyleMap', () => {
    const doc = makeDoc(['기본 제목 1', '네이티브 개요'])
    const title1Id = ensureStyle(doc, '제목 1', 'Heading 1')
    const outline1Id = styleIdByName(doc, '개요 1')
    doc.applyStyle(0, 0, title1Id)
    doc.applyStyle(0, 1, outline1Id)

    expect(writeDocOutlineMap(doc, {}).ok).toBe(true)
    expect(readDocOutlineMap(doc)).toEqual({})

    for (const reloaded of [new HwpDocument(doc.exportHwp()), new HwpDocument(doc.exportHwpx())]) {
      expect(readDocOutlineMap(reloaded)).toEqual({})
      const res = readOutline(reloaded, { appStyleMap: DEFAULT_OUTLINE_STYLE_MAP })
      expect(res.hasDocStyleMap).toBe(true)
      expect(res.docStyleMap).toEqual({})
      expect(res.effectiveStyleMap).toEqual({})
      expect(res.items.map((item) => item.title)).toEqual(['네이티브 개요'])
    }
  })

  it('excludes default 제목 1 / Heading 1 headings when removed from appStyleMap', () => {
    const doc = makeDoc(['한국어 제목', 'English Heading', '개요 문단'])
    const title1Id = ensureStyle(doc, '제목 1', 'Heading 1')
    const heading1Id = ensureStyle(doc, 'Heading 1', 'Heading 1')
    const outline1Id = styleIdByName(doc, '개요 1')

    doc.applyStyle(0, 0, title1Id)
    doc.applyStyle(0, 1, heading1Id)
    doc.applyStyle(0, 2, outline1Id)

    // Removing all style mappings via explicit {} keeps only outline paragraphs
    const emptyMapResult = readOutline(doc, { appStyleMap: {} })
    expect(emptyMapResult.items.map((item) => item.title)).toEqual(['개요 문단'])

    // Removing the Korean title style while keeping Heading 1 excludes Korean title even if englishName is Heading 1
    const withoutKoreanTitle = readOutline(doc, { appStyleMap: { 'Heading 1': 1 } })
    expect(withoutKoreanTitle.items.map((item) => item.title)).toEqual([
      'English Heading',
      '개요 문단',
    ])
  })

  it('excludes outline-styled and style-mapped headings inside table cells', () => {
    const doc = makeDoc(['본문 개요', '', '본문 제목'])
    const outline1Id = styleIdByName(doc, '개요 1')
    const title1Id = ensureStyle(doc, '제목 1', 'Heading 1')

    doc.applyStyle(0, 0, outline1Id)
    doc.applyStyle(0, 2, title1Id)

    // Create a 1x2 table in para 1 and put both an outline style and a mapped heading style inside table cells
    doc.createTable(0, 1, 0, 1, 2)
    doc.insertTextInCell(0, 1, 0, 0, 0, 0, '표 안 개요 제목')
    doc.applyCellStyle(0, 1, 0, 0, 0, outline1Id)
    doc.insertTextInCell(0, 1, 0, 1, 0, 0, '표 안 스타일 제목')
    doc.applyCellStyle(0, 1, 0, 1, 0, title1Id)

    // Verify the raw engine actually emitted a cell entry in getOutlineNavigation
    const rawNav = JSON.parse(doc.getOutlineNavigation()) as { outline: unknown[] }
    expect(rawNav.outline.length).toBeGreaterThan(1)

    // readOutline must include ONLY body paragraphs (createTable inserts a trailing paragraph, shifting para 2 to 3)
    const result = readOutline(doc)
    expect(result.items.map((item) => item.title)).toEqual(['본문 개요', '본문 제목'])
    expect(result.items.map((item) => item.para)).toEqual([0, 3])
  })

  it('reflects insertNewNumber printed page numbers and non-decimal page labels', () => {
    const doc = makeDoc(['첫 쪽 개요'])
    const outline1Id = styleIdByName(doc, '개요 1')
    const title1Id = ensureStyle(doc, '제목 1', 'Heading 1')
    doc.applyStyle(0, 0, outline1Id)

    // Page 2: restart printed page numbering at 10
    doc.insertPageBreak(0, 0, doc.getParagraphLength(0, 0))
    doc.insertText(0, 1, 0, '1. 둘째 쪽 스타일 제목')
    doc.applyStyle(0, 1, title1Id)
    doc.insertNewNumber(0, 1, 0, 10)

    // Page 3: continues at 11
    doc.insertPageBreak(0, 1, doc.getParagraphLength(0, 1))
    doc.insertText(0, 2, 0, '셋째 쪽 개요')
    doc.applyStyle(0, 2, outline1Id)

    expect(doc.pageCount()).toBe(3)

    const result = readOutline(doc)
    expect(result.items).toHaveLength(3)
    expect(result.items[0]).toMatchObject({
      title: '첫 쪽 개요',
      page: 1,
      physicalPage: 1,
    })
    expect(result.items[1]).toMatchObject({
      number: '1.',
      title: '둘째 쪽 스타일 제목',
      page: 10,
      physicalPage: 2,
    })
    expect(result.items[2]).toMatchObject({
      title: '셋째 쪽 개요',
      page: 11,
      physicalPage: 3,
    })

    // Non-decimal format (3 = lowercase Roman numerals) populates pageLabel
    doc.setPageNumberPos(0, 3, 5, false)
    const romanResult = readOutline(doc)
    expect(romanResult.items[0]).toMatchObject({ page: 1, pageLabel: 'i', physicalPage: 1 })
    expect(romanResult.items[1]).toMatchObject({ page: 10, pageLabel: 'x', physicalPage: 2 })
    expect(romanResult.items[2]).toMatchObject({ page: 11, pageLabel: 'xi', physicalPage: 3 })
  })

  it('inherits page-number format across sections when a later section has no explicit pgnp', () => {
    const doc = makeDoc(['앞 구역 개요'])
    const outline1Id = styleIdByName(doc, '개요 1')
    doc.applyStyle(0, 0, outline1Id)
    doc.setPageNumberPos(0, 3, 5, false)

    // Split into section 1 without setting pageNumberPos on section 1
    doc.splitSection(0, 0, doc.getParagraphLength(0, 0))
    expect(doc.getSectionCount()).toBe(2)
    doc.insertText(1, 0, 0, '둘째 구역 개요')
    doc.applyStyle(1, 0, outline1Id)
    doc.insertNewNumber(1, 0, 0, 5)

    expect(JSON.parse(doc.getPageNumberPos(1)).pageNumber).toBeNull()

    const inherited = readOutline(doc)
    expect(inherited.items).toHaveLength(2)
    expect(inherited.items[0]).toMatchObject({
      sec: 0,
      para: 0,
      page: 1,
      pageLabel: 'i',
      physicalPage: 1,
    })
    expect(inherited.items[1]).toMatchObject({
      sec: 1,
      para: 0,
      page: 5,
      pageLabel: 'v',
      physicalPage: 2,
    })

    // Explicitly resetting section 1 to Arabic (format 0) stops inheritance for section 1
    doc.setPageNumberPos(1, 0, 5, false)
    const explicitArabic = readOutline(doc)
    expect(explicitArabic.items[0]).toMatchObject({ page: 1, pageLabel: 'i' })
    expect(explicitArabic.items[1]).toMatchObject({ page: 5, physicalPage: 2 })
    expect(explicitArabic.items[1]!.pageLabel).toBeUndefined()
  })

  it('tracks the active heading index for a given (sec, para) caret position', () => {
    const items = [
      {
        level: 1,
        number: '1.',
        title: 'One',
        page: 1,
        physicalPage: 1,
        sec: 0,
        para: 2,
        source: 'outline' as const,
        styleName: '개요 1',
      },
      {
        level: 2,
        number: '가.',
        title: 'One-A',
        page: 1,
        physicalPage: 1,
        sec: 0,
        para: 5,
        source: 'outline' as const,
        styleName: '개요 2',
      },
      {
        level: 1,
        number: '2.',
        title: 'Two',
        page: 2,
        physicalPage: 2,
        sec: 1,
        para: 1,
        source: 'style' as const,
        styleName: '제목 1',
      },
    ]

    expect(findActiveOutlineIndex([], { sec: 0, para: 0 })).toBe(-1)
    expect(findActiveOutlineIndex(items, null)).toBe(-1)
    expect(findActiveOutlineIndex(items, undefined)).toBe(-1)
    expect(findActiveOutlineIndex(items, { sec: 0, para: 0 })).toBe(-1)
    expect(findActiveOutlineIndex(items, { sec: 0, para: 1 })).toBe(-1)
    expect(findActiveOutlineIndex(items, { sec: 0, para: 2 })).toBe(0)
    expect(findActiveOutlineIndex(items, { sec: 0, para: 4 })).toBe(0)
    expect(findActiveOutlineIndex(items, { sec: 0, para: 5 })).toBe(1)
    expect(findActiveOutlineIndex(items, { sec: 0, para: 99 })).toBe(1)
    expect(findActiveOutlineIndex(items, { sec: 1, para: 0 })).toBe(1)
    expect(findActiveOutlineIndex(items, { sec: 1, para: 1 })).toBe(2)
    expect(findActiveOutlineIndex(items, { sec: 2, para: 0 })).toBe(2)
  })
})
