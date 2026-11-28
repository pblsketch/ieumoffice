/**
 * Table, figure, and equation table-of-contents (TOC) collection, classification,
 * multi-TOC coexistence, layout, hyperlink roundtrip, staleness, and fallback tests
 * against the real `@rhwp/core` engine.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import {
  MARK_PREFIXES,
  addRangeMark,
  isAppTocHyperlinkField,
  listMarks,
} from '../studio-plugin/doc-marks.mjs'
import {
  DEFAULT_TOC_TITLES,
  TOC_KINDS,
  checkTocStaleness,
  classifyCaptionParagraph,
  collectCaptionTocEntries,
  findTocRange,
  insertTocBlock,
  listTocRanges,
  readTocMeta,
  refreshTocBlock,
} from '../studio-plugin/toc.mjs'
import { tablesOf } from '../studio-plugin/agent-plugin.mjs'

const require = createRequire(import.meta.url)

const TABLE_CAPTION_CELL_SENTINEL = 65534
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8b8AAAAASUVORK5CYII=',
  'base64',
)

interface StyleEntry {
  id: number
  name: string
  englishName?: string
}

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

function openFixture(name: string): HwpDocument {
  return new HwpDocument(new Uint8Array(readFileSync(join(__dirname, 'fixtures', name))))
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

function appendPara(doc: HwpDocument, sec: number, text = ''): number {
  const para = doc.getParagraphCount(sec)
  doc.insertParagraph(sec, para)
  const bodyStyle = styleIdByName(doc, '바탕글')
  doc.applyStyle(sec, para, bodyStyle)
  if (text) doc.insertText(sec, para, 0, text)
  return para
}

function paraText(doc: HwpDocument, sec: number, para: number): string {
  const len = doc.getParagraphLength(sec, para)
  return len > 0 ? doc.getTextRange(sec, para, 0, len) : ''
}

function styleIdByName(doc: HwpDocument, name: string): number {
  const styles = JSON.parse(doc.getStyleList()) as StyleEntry[]
  const found = styles.find((s) => s.name === name || s.englishName === name)
  if (!found) throw new Error(`Style not found: ${name}`)
  return found.id
}

function ensureStyle(doc: HwpDocument, name: string, englishName = name): number {
  const styles = JSON.parse(doc.getStyleList()) as StyleEntry[]
  const existing = styles.find((s) => s.name === name || s.englishName === englishName)
  if (existing) return existing.id
  return doc.createStyle(
    JSON.stringify({
      name,
      englishName,
      type: 0,
      nextStyleId: 0,
    }),
  )
}

function hideObjectCaptions(doc: HwpDocument): HwpDocument {
  return new Proxy(doc, {
    get(target, prop) {
      if (prop === 'listObjectCaptions') return undefined
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

function createMixedAcademicDoc(): {
  doc: HwpDocument
  tableObjPara: number
  picObjPara: number
  shapeObjPara: number
  bodyTablePara: number
  bodyFigPara1: number
  bodyFigPara2: number
  bodyEqPara1: number
  bodyEqPara2: number
} {
  const doc = makeDoc(['서론', '본문 시작입니다.'])
  doc.applyStyle(0, 0, styleIdByName(doc, '개요 1'))

  // Real object caption 1: table with attached caption.
  const tableObjPara = appendPara(doc, 0, '표 개체 문단')
  const tbl = JSON.parse(doc.createTable(0, tableObjPara, 0, 2, 2)) as {
    paraIdx: number
    controlIdx: number
  }
  doc.setTableProperties(
    0,
    tbl.paraIdx,
    tbl.controlIdx,
    JSON.stringify({ hasCaption: true, captionDirection: 2 }),
  )
  doc.insertTextInCell(
    0,
    tbl.paraIdx,
    tbl.controlIdx,
    TABLE_CAPTION_CELL_SENTINEL,
    0,
    3,
    ' 실험 환경 요약',
  )

  // Body caption paragraph: table prefix with angle brackets.
  const bodyTablePara = appendPara(doc, 0, '<표 2> 성능 비교 결과')

  // Section 2 heading.
  const h2 = appendPara(doc, 0, '시스템 구조')
  doc.applyStyle(0, h2, styleIdByName(doc, '개요 1'))

  // Real object caption 2: picture with attached caption.
  const picObjPara = appendPara(doc, 0, '그림 개체 문단')
  const pic = JSON.parse(
    doc.insertPicture(0, picObjPara, 0, '[]', PNG_1X1, 4000, 4000, 100, 100, 'png', 'arch'),
  ) as { paraIdx: number; controlIdx: number }
  doc.setPictureProperties(
    0,
    pic.paraIdx,
    pic.controlIdx,
    JSON.stringify({ hasCaption: true, captionDirection: 'Bottom' }),
  )

  // Body caption paragraphs: figure prefixes including brackets and Roman numerals.
  const bodyFigPara1 = appendPara(doc, 0, '[그림 2] 전체 아키텍처')
  const bodyFigPara2 = appendPara(doc, 0, '〈그림 II-1〉 모듈 간 데이터 흐름')

  // Real object caption 3: shape with attached caption (classifies as figure by default).
  const shapeObjPara = appendPara(doc, 0, '도형 개체 문단')
  const shape = JSON.parse(
    doc.createShapeControl(
      JSON.stringify({
        sectionIdx: 0,
        paraIdx: shapeObjPara,
        charOffset: 0,
        width: 4000,
        height: 2000,
        horzOffset: 0,
        vertOffset: 0,
        treatAsChar: true,
        textWrap: 'Square',
      }),
    ),
  ) as { paraIdx: number; controlIdx: number }
  doc.attachCaptionAt(shape.paraIdx, shape.controlIdx)

  // Equations with prefix-matched body caption paragraphs.
  const eqHost1 = appendPara(doc, 0, '')
  doc.insertEquation(0, eqHost1, 0, 'E = m c^2', 1100, 0)
  const bodyEqPara1 = appendPara(doc, 0, '[수식 1] 질량-에너지 등가식')

  const eqHost2 = appendPara(doc, 0, '')
  doc.insertEquation(0, eqHost2, 0, 'a^2 + b^2 = c^2', 1100, 0)
  const bodyEqPara2 = appendPara(doc, 0, 'Equation 2 Pythagorean theorem')

  // Conclusion heading + English table caption.
  const h3 = appendPara(doc, 0, '결론')
  doc.applyStyle(0, h3, styleIdByName(doc, '개요 1'))
  appendPara(doc, 0, 'Table 3 Final ablation metrics')

  return {
    doc,
    tableObjPara: tbl.paraIdx,
    picObjPara: pic.paraIdx,
    shapeObjPara: shape.paraIdx,
    bodyTablePara,
    bodyFigPara1,
    bodyFigPara2,
    bodyEqPara1,
    bodyEqPara2,
  }
}

describe('DEFAULT_TOC_TITLES and classifyCaptionParagraph', () => {
  it('exports kind-specific default titles and classifies caption prefixes accurately', () => {
    expect(DEFAULT_TOC_TITLES).toEqual({
      body: '차례',
      table: '표 차례',
      figure: '그림 차례',
      equation: '수식 차례',
    })

    // Table prefixes.
    expect(classifyCaptionParagraph('<표 1> 요약')).toBe('table')
    expect(classifyCaptionParagraph('표 2-1. 항목별 분포')).toBe('table')
    expect(classifyCaptionParagraph('도표 3 비교')).toBe('table')
    expect(classifyCaptionParagraph('Table 2 Benchmark results')).toBe('table')
    expect(classifyCaptionParagraph('Table II-1: Summary')).toBe('table')

    // Figure prefixes.
    expect(classifyCaptionParagraph('[그림 1] 아키텍처')).toBe('figure')
    expect(classifyCaptionParagraph('〈그림 II-1〉 흐름도')).toBe('figure')
    expect(classifyCaptionParagraph('《그림 III》 개요')).toBe('figure')
    expect(classifyCaptionParagraph('Figure 3. Loss curve')).toBe('figure')
    expect(classifyCaptionParagraph('Fig. 4a Attention map')).toBe('figure')

    // Equation prefixes.
    expect(classifyCaptionParagraph('[수식 1] 목적 함수')).toBe('equation')
    expect(classifyCaptionParagraph('(수식 2) 정규화 항')).toBe('equation')
    expect(classifyCaptionParagraph('식 (3) 오차율')).toBe('equation')
    expect(classifyCaptionParagraph('Equation 1 Gradient step')).toBe('equation')
    expect(classifyCaptionParagraph('Eq. (2) Softmax')).toBe('equation')

    // Ordinary prose must not false-match.
    expect(classifyCaptionParagraph('표현 방법의 비교')).toBeNull()
    expect(classifyCaptionParagraph('그림을 참고하여 작성한다.')).toBeNull()
    expect(classifyCaptionParagraph('식물학 연구 동향')).toBeNull()
    expect(classifyCaptionParagraph('Table of contents')).toBeNull()
    expect(classifyCaptionParagraph('Table in the next section shows details.')).toBeNull()
    expect(classifyCaptionParagraph('Figure out the next step')).toBeNull()
  })

  it('infers kind from adjacent controls for caption-styled paragraphs without an explicit prefix', () => {
    const doc = makeDoc([''])
    const captionStyle = ensureStyle(doc, '캡션', 'Caption')

    // Table with caption-styled paragraph above (para + 1 has table).
    const tableCapPara = 0
    doc.insertText(0, tableCapPara, 0, '분기별 매출 현황')
    doc.applyStyle(0, tableCapPara, captionStyle)
    const tableHostPara = appendPara(doc, 0, '')
    doc.createTable(0, tableHostPara, 0, 2, 2)

    // Picture with caption-styled paragraph below (para - 1 has picture).
    const picHostPara = appendPara(doc, 0, '')
    doc.insertPicture(0, picHostPara, 0, '[]', PNG_1X1, 4000, 4000, 100, 100, 'png', 'fig')
    const picCapPara = appendPara(doc, 0, '모듈 연결 개요')
    doc.applyStyle(0, picCapPara, captionStyle)

    // Equation with caption-styled paragraph below (para - 1 has equation).
    const eqHostPara = appendPara(doc, 0, '')
    doc.insertEquation(0, eqHostPara, 0, 'x + y = z', 1100, 0)
    const eqCapPara = appendPara(doc, 0, '선형 관계식')
    doc.applyStyle(0, eqCapPara, captionStyle)

    // Standalone caption-styled paragraph with no adjacent object returns null.
    appendPara(doc, 0, '일반 문단')
    const orphanCapPara = appendPara(doc, 0, '근처 개체가 없는 캡션')
    doc.applyStyle(0, orphanCapPara, captionStyle)
    appendPara(doc, 0, '또 다른 일반 문단')

    // Caption-styled paragraph WITH explicit prefix uses prefix regardless of neighbor.
    const explicitCapPara = appendPara(doc, 0, '<표 9> 명시적 접두어')
    doc.applyStyle(0, explicitCapPara, captionStyle)

    expect(
      classifyCaptionParagraph(paraText(doc, 0, tableCapPara), '캡션', doc, 0, tableCapPara),
    ).toBe('table')
    expect(
      classifyCaptionParagraph(paraText(doc, 0, picCapPara), 'Caption', doc, 0, picCapPara),
    ).toBe('figure')
    expect(classifyCaptionParagraph(paraText(doc, 0, eqCapPara), '캡션', doc, 0, eqCapPara)).toBe(
      'equation',
    )
    expect(
      classifyCaptionParagraph(paraText(doc, 0, orphanCapPara), '캡션', doc, 0, orphanCapPara),
    ).toBeNull()
    expect(
      classifyCaptionParagraph(paraText(doc, 0, explicitCapPara), '캡션', doc, 0, explicitCapPara),
    ).toBe('table')

    // End-to-end collection matches each caption-styled paragraph into the right TOC kind.
    expect(collectCaptionTocEntries(doc, 'table').entries.map((e) => e.title)).toEqual([
      '분기별 매출 현황',
      '<표 9> 명시적 접두어',
    ])
    expect(collectCaptionTocEntries(doc, 'figure').entries.map((e) => e.title)).toEqual([
      '모듈 연결 개요',
    ])
    expect(collectCaptionTocEntries(doc, 'equation').entries.map((e) => e.title)).toEqual([
      '선형 관계식',
    ])
    doc.free()
  })
})

describe('collectCaptionTocEntries on fixtures, mixed sources, nested objects, and exclusions', () => {
  it('reads real object captions from caption-footnote-flow.hwpx with strict kind separation and multi-paragraph joining', () => {
    const doc = openFixture('caption-footnote-flow.hwpx')

    const tables = collectCaptionTocEntries(doc, 'table')
    expect(tables.objectCaptionsUnavailable).toBeUndefined()
    expect(tables.entries).toHaveLength(2)
    expect(tables.entries.every((e) => e.level === 1 && e.source === 'object-caption')).toBe(true)
    expect(tables.entries.every((e) => e.objectKind === 'table')).toBe(true)
    expect(tables.entries[0].title.startsWith('[표 1]')).toBe(true)
    expect(tables.entries[1].title.startsWith('[표 2]')).toBe(true)

    const figures = collectCaptionTocEntries(doc, 'figure')
    expect(figures.entries).toHaveLength(2)
    expect(figures.entries.every((e) => e.level === 1 && e.source === 'object-caption')).toBe(true)
    expect(figures.entries.every((e) => e.objectKind === 'picture')).toBe(true)
    expect(figures.entries[0].title.startsWith('[그림 1]')).toBe(true)
    // Second picture caption has two paragraphs joined cleanly with a single space.
    expect(figures.entries[1].title.startsWith('[그림 2]')).toBe(true)
    expect(figures.entries[1].title).toContain('주:')
    expect(figures.entries[1].title).not.toContain('\n')

    const equations = collectCaptionTocEntries(doc, 'equation')
    expect(equations.entries).toHaveLength(0)

    doc.free()
  })

  it('combines real object captions and body caption paragraphs in strict reading order and separates kinds', () => {
    const { doc } = createMixedAcademicDoc()

    const tables = collectCaptionTocEntries(doc, 'table')
    expect(tables.entries.map((e) => ({ title: e.title, source: e.source }))).toEqual([
      { title: '표 1 실험 환경 요약', source: 'object-caption' },
      { title: '<표 2> 성능 비교 결과', source: 'caption-paragraph' },
      { title: 'Table 3 Final ablation metrics', source: 'caption-paragraph' },
    ])

    const figures = collectCaptionTocEntries(doc, 'figure')
    expect(figures.entries.map((e) => ({ title: e.title, source: e.source }))).toEqual([
      { title: '그림 1', source: 'object-caption' },
      { title: '[그림 2] 전체 아키텍처', source: 'caption-paragraph' },
      { title: '〈그림 II-1〉 모듈 간 데이터 흐름', source: 'caption-paragraph' },
      { title: '그림 1', source: 'object-caption' },
    ])
    expect(figures.entries[0].objectKind).toBe('picture')
    expect(figures.entries[3].objectKind).toBe('shape')

    const equations = collectCaptionTocEntries(doc, 'equation')
    expect(equations.entries.map((e) => ({ title: e.title, source: e.source }))).toEqual([
      { title: '[수식 1] 질량-에너지 등가식', source: 'caption-paragraph' },
      { title: 'Equation 2 Pythagorean theorem', source: 'caption-paragraph' },
    ])

    // Verify monotonic document reading order across all collected entries.
    for (const group of [tables.entries, figures.entries, equations.entries]) {
      for (let i = 1; i < group.length; i++) {
        expect(group[i].sec).toBeGreaterThanOrEqual(group[i - 1].sec)
        if (group[i].sec === group[i - 1].sec) {
          expect(group[i].para).toBeGreaterThanOrEqual(group[i - 1].para)
        }
      }
    }

    doc.free()
  })

  it('links nested cell object captions to their host body paragraph and preserves cellPath', async () => {
    const doc = makeDoc(['바깥 표 문단'])
    const outer = JSON.parse(doc.createTable(0, 0, 0, 1, 2)) as {
      paraIdx: number
      controlIdx: number
    }
    const cell0Path = JSON.stringify([
      { controlIndex: outer.controlIdx, cellIndex: 0, cellParaIndex: 0 },
    ])
    const cell1Path = JSON.stringify([
      { controlIndex: outer.controlIdx, cellIndex: 1, cellParaIndex: 0 },
    ])
    doc.createTableInCellByPath(
      0,
      outer.paraIdx,
      cell0Path,
      0,
      JSON.stringify({ rowCount: 1, colCount: 1 }),
    )
    doc.insertPictureInCell(
      0,
      outer.paraIdx,
      0,
      cell1Path,
      PNG_1X1,
      3000,
      3000,
      100,
      100,
      'png',
      'nested-fig',
    )

    const baseHwpx = doc.exportHwpx()
    doc.free()

    const zip = await JSZip.loadAsync(baseHwpx)
    const sectionEntry = zip.file('Contents/section0.xml')
    expect(sectionEntry).not.toBeNull()
    let xml = await sectionEntry!.async('string')

    const makeCaptionXml = (text: string, side: 'TOP' | 'BOTTOM') =>
      `<hp:caption side="${side}" fullSz="0" width="8504" gap="850" lastWidth="12000">` +
      `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP" ` +
      `linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" ` +
      `hasTextRef="0" hasNumRef="0"><hp:p id="0" paraPrIDRef="0" styleIDRef="0" ` +
      `pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">` +
      `<hp:t>${text}</hp:t></hp:run></hp:p></hp:subList></hp:caption>`

    let tblEndCount = 0
    xml = xml.replace(/<\/hp:tbl>/g, (match) => {
      tblEndCount += 1
      return tblEndCount === 1 ? `${makeCaptionXml('[표 1] 중첩 표 캡션', 'TOP')}${match}` : match
    })
    xml = xml.replace(
      '</hp:pic>',
      `${makeCaptionXml('[그림 1] 중첩 그림 캡션', 'BOTTOM')}</hp:pic>`,
    )

    zip.file('Contents/section0.xml', xml)
    const nestedBytes = await zip.generateAsync({ type: 'uint8array' })

    const reloaded = new HwpDocument(nestedBytes)
    const tblEntries = collectCaptionTocEntries(reloaded, 'table').entries
    const figEntries = collectCaptionTocEntries(reloaded, 'figure').entries

    expect(tblEntries).toHaveLength(1)
    expect(tblEntries[0].para).toBe(outer.paraIdx)
    expect(tblEntries[0].cellPath).toEqual([
      { controlIndex: outer.controlIdx, cellIndex: 0, cellParaIndex: 0 },
    ])

    expect(figEntries).toHaveLength(1)
    expect(figEntries[0].para).toBe(outer.paraIdx)
    expect(figEntries[0].cellPath).toEqual([
      { controlIndex: outer.controlIdx, cellIndex: 1, cellParaIndex: 0 },
    ])

    // Inserting a table TOC links to the host body paragraph (shifted after TOC insertion).
    const res = insertTocBlock(reloaded, { sec: 0, para: 0 }, { kind: 'table' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.linksApplied).toBe(true)
    expect(paraText(reloaded, 0, 0)).toBe('표 차례')
    expect(paraText(reloaded, 0, 1)).toMatch(/^\[표 1\] 중첩 표 캡션\t1$/)
    const bm = listMarks(reloaded, [MARK_PREFIXES.heading]).find(
      (m) => m.name === res.entries[0].bookmark,
    )
    expect(bm?.para).toBe(outer.paraIdx + 2)

    reloaded.free()
  })

  it('classifies shape object captions by explicit prefix (table/equation) and defaults to figure', () => {
    const doc = makeDoc(['도형 캡션 분류 테스트'])
    const fakeCaptions = [
      {
        kind: 'shape',
        text: '표 1 도형으로 만든 표',
        paragraphs: ['표 1 도형으로 만든 표'],
        sec: 0,
        para: 0,
        controlIndex: 0,
        cellPath: [],
        direction: 'Top',
        hasCaption: true,
      },
      {
        kind: 'shape',
        text: '수식 1 도형 수식 박스',
        paragraphs: ['수식 1 도형 수식 박스'],
        sec: 0,
        para: 0,
        controlIndex: 1,
        cellPath: [],
        direction: 'Bottom',
        hasCaption: true,
      },
      {
        kind: 'shape',
        text: '아키텍처 다이어그램',
        paragraphs: ['아키텍처 다이어그램'],
        sec: 0,
        para: 0,
        controlIndex: 2,
        cellPath: [],
        direction: 'Bottom',
        hasCaption: true,
      },
    ]
    const wrapped = new Proxy(doc, {
      get(target, prop) {
        if (prop === 'listObjectCaptions') return () => JSON.stringify(fakeCaptions)
        const value = Reflect.get(target, prop, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })

    expect(collectCaptionTocEntries(wrapped, 'table').entries.map((e) => e.title)).toEqual([
      '표 1 도형으로 만든 표',
    ])
    expect(collectCaptionTocEntries(wrapped, 'equation').entries.map((e) => e.title)).toEqual([
      '수식 1 도형 수식 박스',
    ])
    expect(collectCaptionTocEntries(wrapped, 'figure').entries.map((e) => e.title)).toEqual([
      '아키텍처 다이어그램',
    ])
    doc.free()
  })

  it('skips captions inside marked index blocks and deduplicates identical same-para captions', () => {
    const doc = makeDoc(['본문 시작', '<표 1> 실제 표', '<표 2> 색인 블록 안의 항목'])
    addRangeMark(
      doc,
      MARK_PREFIXES.indexBlock,
      '기본',
      { sec: 0, para: 2, offset: 0 },
      { sec: 0, para: 2, offset: doc.getParagraphLength(0, 2) },
    )

    const collected = collectCaptionTocEntries(doc, 'table')
    expect(collected.entries.map((e) => e.title)).toEqual(['<표 1> 실제 표'])

    // Attach an object caption and put identical body text on the exact same host paragraph.
    const dupDoc = makeDoc([''])
    const tbl = JSON.parse(dupDoc.createTable(0, 0, 0, 1, 1)) as {
      paraIdx: number
      controlIdx: number
    }
    dupDoc.setTableProperties(
      0,
      tbl.paraIdx,
      tbl.controlIdx,
      JSON.stringify({ hasCaption: true, captionDirection: 2 }),
    )
    dupDoc.insertTextInCell(
      0,
      tbl.paraIdx,
      tbl.controlIdx,
      TABLE_CAPTION_CELL_SENTINEL,
      0,
      3,
      ' 동일 캡션',
    )
    dupDoc.insertText(0, tbl.paraIdx, 0, '표 1 동일 캡션')

    const deduped = collectCaptionTocEntries(dupDoc, 'table')
    expect(deduped.entries).toHaveLength(1)
    expect(deduped.entries[0].source).toBe('object-caption')

    doc.free()
    dupDoc.free()
  })
})

describe('coexistence of all 4 TOCs, independent refresh, layouts, roundtrip, and staleness', () => {
  it('supports body, table, figure, and equation TOCs coexisting with independent ranges, settings, refresh, and staleness', () => {
    const { doc } = createMixedAcademicDoc()
    // Insert a dedicated front-matter paragraph before chapter 1 and start chapter 1 on page 2,
    // so adding a line to one front-matter TOC never shifts body page breaks.
    doc.splitParagraph(0, 0, 0)
    doc.applyStyle(0, 0, styleIdByName(doc, '바탕글'))
    doc.applyParaFormat(0, 1, JSON.stringify({ pageBreakBefore: true }))

    // Insert all 4 TOCs sequentially at the front of the document.
    const bodyRes = insertTocBlock(doc, { sec: 0, para: 0 }, { kind: 'body' })
    expect(bodyRes.ok).toBe(true)
    if (!bodyRes.ok) return
    expect(paraText(doc, 0, bodyRes.range.startPara)).toBe('차례')
    expect(bodyRes.count).toBe(3)

    const tableRes = insertTocBlock(
      doc,
      { sec: 0, para: bodyRes.range.endPara + 1 },
      { kind: 'table' },
    )
    expect(tableRes.ok).toBe(true)
    if (!tableRes.ok) return
    expect(tableRes.kind).toBe('table')
    expect(tableRes.kindId).toBe(TOC_KINDS.table)
    expect(paraText(doc, 0, tableRes.range.startPara)).toBe('표 차례')
    expect(tableRes.count).toBe(3)

    const figureRes = insertTocBlock(
      doc,
      { sec: 0, para: tableRes.range.endPara + 1 },
      { kind: 'figure' },
    )
    expect(figureRes.ok).toBe(true)
    if (!figureRes.ok) return
    expect(figureRes.kind).toBe('figure')
    expect(figureRes.kindId).toBe(TOC_KINDS.figure)
    expect(paraText(doc, 0, figureRes.range.startPara)).toBe('그림 차례')
    expect(figureRes.count).toBe(4)

    const eqRes = insertTocBlock(
      doc,
      { sec: 0, para: figureRes.range.endPara + 1 },
      { kind: 'equation' },
    )
    expect(eqRes.ok).toBe(true)
    if (!eqRes.ok) return
    expect(eqRes.kind).toBe('equation')
    expect(eqRes.kindId).toBe(TOC_KINDS.equation)
    expect(paraText(doc, 0, eqRes.range.startPara)).toBe('수식 차례')
    expect(eqRes.count).toBe(2)

    // All 4 ranges and settings coexist cleanly.
    const ranges = listTocRanges(doc)
    expect(ranges.map((r) => r.kind).sort()).toEqual(['body', 'equation', 'figure', 'table'])
    for (const kind of ['body', 'table', 'figure', 'equation'] as const) {
      expect(findTocRange(doc, kind)).not.toBeNull()
      expect(readTocMeta(doc, kind)?.kind).toBe(kind)
    }

    // Re-inserting an existing caption TOC refuses with `toc_exists` only for that kind.
    const dupTable = insertTocBlock(doc, { sec: 0, para: 0 }, { kind: 'table' })
    expect(dupTable.ok).toBe(false)
    if (!dupTable.ok) expect(dupTable.reason).toBe('toc_exists')

    // All 4 TOCs are fresh right after insertion.
    expect(checkTocStaleness(doc)).toEqual({ stale: false, items: [] })

    // Append a new table caption and rename an equation caption; verify staleness detects BOTH kinds.
    appendPara(doc, 0, '<표 4> 추가된 표 캡션')
    const eqEntriesBefore = collectCaptionTocEntries(doc, 'equation').entries
    const firstEqPara = eqEntriesBefore[0].para
    doc.insertText(0, firstEqPara, doc.getParagraphLength(0, firstEqPara), ' (수정)')

    const stale = checkTocStaleness(doc)
    expect(stale.stale).toBe(true)
    expect(stale.items.map((item) => item.kind).sort()).toEqual(['equation', 'table'])
    expect(stale.items.every((item) => item.reason === 'entries_changed')).toBe(true)

    // Refresh ONLY the table TOC — equation TOC stays stale, body & figure remain intact.
    const refreshedTable = refreshTocBlock(doc, { kind: 'table' })
    expect(refreshedTable.ok).toBe(true)
    if (!refreshedTable.ok) return
    expect(refreshedTable.count).toBe(4)
    expect(refreshedTable.entries.map((e) => e.title)).toContain('<표 4> 추가된 표 캡션')

    const staleAfterTable = checkTocStaleness(doc)
    expect(staleAfterTable.stale).toBe(true)
    expect(staleAfterTable.items.map((item) => item.kind)).toEqual(['equation'])

    // Refresh the equation TOC — all 4 TOCs are now completely fresh.
    const refreshedEq = refreshTocBlock(doc, { kind: 'equation' })
    expect(refreshedEq.ok).toBe(true)
    if (!refreshedEq.ok) return
    expect(refreshedEq.entries[0].title).toContain('(수정)')
    expect(checkTocStaleness(doc)).toEqual({ stale: false, items: [] })

    // Verify all 4 TOCs still hold valid hyperlinks and range marks.
    const fields = JSON.parse(doc.getFieldList()) as Array<{
      fieldType?: string
      command?: string
    }>
    expect(fields.filter(isAppTocHyperlinkField)).toHaveLength(3 + 4 + 4 + 2)
    doc.free()
  })

  it('does not falsely refuse caption TOC insertion when an unmarked legacy body TOC exists', () => {
    const doc = makeDoc(['차례', '1. 서론\t1', '서론', '<표 1> 요약 표'])
    doc.applyStyle(0, 2, styleIdByName(doc, '개요 1'))

    const res = insertTocBlock(doc, { sec: 0, para: 3 }, { kind: 'table', title: '커스텀 표 목록' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(paraText(doc, 0, res.range.startPara)).toBe('커스텀 표 목록')
    expect(res.count).toBe(1)
    doc.free()
  })

  it('supports table layout and title: null for caption TOCs and survives HWP & HWPX roundtrips with links intact', () => {
    // Use fixture with static object captions + appended body caption paragraphs so both
    // dotted-tab and 2-column table layouts coexist cleanly across HWP and HWPX roundtrips.
    const doc = openFixture('caption-footnote-flow.hwpx')
    appendPara(doc, 0, '<표 3> 추가 비교 표')
    appendPara(doc, 0, '[그림 3] 추가 시스템 흐름도')

    // Dotted-tab table TOC (default title) + table-layout figure TOC (no title).
    const tableToc = insertTocBlock(
      doc,
      { sec: 0, para: 0 },
      { kind: 'table', layout: 'dotted-tab', links: true },
    )
    expect(tableToc.ok).toBe(true)
    if (!tableToc.ok) return
    expect(tableToc.linksApplied).toBe(true)
    expect(tableToc.count).toBe(3)

    const figToc = insertTocBlock(
      doc,
      { sec: 0, para: tableToc.range.endPara + 1 },
      { kind: 'figure', layout: 'table', title: null, links: true },
    )
    expect(figToc.ok).toBe(true)
    if (!figToc.ok) return
    expect(figToc.layout).toBe('table')
    expect(figToc.linksApplied).toBe(true)
    expect(figToc.count).toBe(3)
    expect(figToc.range.startPara).toBe(figToc.range.endPara)

    // Verify links on dotted-tab table TOC point to host body paragraph (object captions)
    // and to the caption paragraph itself (body caption paragraph).
    const tableEntries = collectCaptionTocEntries(doc, 'table').entries
    const headingMarks = listMarks(doc, [MARK_PREFIXES.heading])
    for (let i = 0; i < tableToc.entries.length; i++) {
      const linkCtx = JSON.parse(
        doc.getHyperlinkContext(
          JSON.stringify({ section: 0, para: tableToc.range.startPara + 1 + i, cellPath: [] }),
        ),
      ) as { links: Array<{ uri: string }> }
      expect(linkCtx.links).toHaveLength(1)
      expect(linkCtx.links[0].uri).toMatch(/^#제목:/)
      const bmName = linkCtx.links[0].uri.slice(1)
      const targetMark = headingMarks.find((m) => m.name === bmName)
      expect(targetMark).toBeDefined()
      expect(targetMark?.para).toBe(tableEntries[i].para)
    }

    // Verify HWP & HWPX roundtrip preserves both caption TOCs, links, page shifts, and refresh.
    for (const [label, bytes] of [
      ['hwp', doc.exportHwp()],
      ['hwpx', doc.exportHwpx()],
    ] as const) {
      const reopened = new HwpDocument(bytes)
      expect(findTocRange(reopened, 'table'), label).not.toBeNull()
      expect(findTocRange(reopened, 'figure'), label).not.toBeNull()
      expect(readTocMeta(reopened, 'table')?.layout, label).toBe('dotted-tab')
      expect(readTocMeta(reopened, 'figure')?.layout, label).toBe('table')
      expect(readTocMeta(reopened, 'figure')?.title, label).toBeNull()
      expect(checkTocStaleness(reopened), label).toEqual({ stale: false, items: [] })

      // Verify figure TOC table exists with 3 rows x 2 columns and cell hyperlinks survived.
      const figRange = findTocRange(reopened, 'figure')!
      const figTable = tablesOf(reopened).tables.find(
        (t) => t.sec === 0 && t.para === figRange.start.para && t.path.length === 1,
      )
      expect(figTable, label).toBeDefined()
      expect(figTable?.rows, label).toBe(3)
      expect(figTable?.cols, label).toBe(2)

      // Push the last table caption onto a new page -> staleness reports pages_changed -> refresh updates it.
      const reopenedTables = collectCaptionTocEntries(reopened, 'table').entries
      const lastTableCaption = reopenedTables[reopenedTables.length - 1]
      const prevPage = lastTableCaption.page
      reopened.applyParaFormat(
        lastTableCaption.sec,
        lastTableCaption.para,
        JSON.stringify({ pageBreakBefore: true }),
      )

      const stale = checkTocStaleness(reopened)
      expect(stale.stale, label).toBe(true)
      expect(
        stale.items.some((item) => item.kind === 'table' && item.reason === 'pages_changed'),
        label,
      ).toBe(true)

      const refreshed = refreshTocBlock(reopened, { kind: 'table' })
      expect(refreshed.ok, label).toBe(true)
      if (refreshed.ok) {
        expect(refreshed.pages[refreshed.pages.length - 1], label).toBeGreaterThan(prevPage)
      }
      expect(checkTocStaleness(reopened, { kind: 'table' }).stale, label).toBe(false)
      reopened.free()
    }

    doc.free()
  })
})

describe('graceful fallback when listObjectCaptions is unavailable', () => {
  it('skips object captions without throwing, builds and refreshes TOC from body caption paragraphs, and reports objectCaptionsUnavailable', () => {
    const { doc } = createMixedAcademicDoc()
    const legacyEngineDoc = hideObjectCaptions(doc)

    // Direct collection falls back cleanly to body caption paragraphs.
    const collected = collectCaptionTocEntries(legacyEngineDoc, 'table')
    expect(collected.objectCaptionsUnavailable).toBe(true)
    expect(typeof collected.warning).toBe('string')
    expect(collected.entries.map((e) => e.title)).toEqual([
      '<표 2> 성능 비교 결과',
      'Table 3 Final ablation metrics',
    ])
    expect(collected.entries.every((e) => e.source === 'caption-paragraph')).toBe(true)

    // insertTocBlock succeeds on body caption paragraphs and propagates objectCaptionsUnavailable.
    const inserted = insertTocBlock(legacyEngineDoc, { sec: 0, para: 0 }, { kind: 'table' })
    expect(inserted.ok).toBe(true)
    if (!inserted.ok) return
    expect(inserted.objectCaptionsUnavailable).toBe(true)
    expect(typeof inserted.warning).toBe('string')
    expect(inserted.count).toBe(2)
    expect(paraText(doc, 0, 0)).toBe('표 차례')

    // checkTocStaleness works without throwing and reports objectCaptionsUnavailable.
    const staleCheck = checkTocStaleness(legacyEngineDoc, { kind: 'table' })
    expect(staleCheck.stale).toBe(false)
    expect(staleCheck.objectCaptionsUnavailable).toBe(true)

    // refreshTocBlock succeeds after adding another body table caption and propagates the flag.
    appendPara(doc, 0, '<표 4> 폴백 갱신 확인')
    const refreshed = refreshTocBlock(legacyEngineDoc, { kind: 'table' })
    expect(refreshed.ok).toBe(true)
    if (!refreshed.ok) return
    expect(refreshed.objectCaptionsUnavailable).toBe(true)
    expect(typeof refreshed.warning).toBe('string')
    expect(refreshed.count).toBe(3)

    // Document containing ONLY real object captions returns no_entries + objectCaptionsUnavailable.
    const objOnlyDoc = openFixture('caption-footnote-flow.hwpx')
    const hiddenObjOnly = hideObjectCaptions(objOnlyDoc)
    const noEntries = insertTocBlock(hiddenObjOnly, { sec: 0, para: 0 }, { kind: 'table' })
    expect(noEntries.ok).toBe(false)
    if (!noEntries.ok) {
      expect(noEntries.reason).toBe('no_entries')
      expect(noEntries.objectCaptionsUnavailable).toBe(true)
      expect(typeof noEntries.warning).toBe('string')
    }

    objOnlyDoc.free()
    doc.free()
  })
})
