/**
 * Index marks (`색인:`) and index block builder (`색인블록:`) tests
 * against the real `@rhwp/core` engine.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import {
  MARK_PREFIXES,
  MAX_MARK_NAME_LEN,
  findRangeMarks,
  listMarks,
} from '../studio-plugin/doc-marks.mjs'
import {
  DEFAULT_INDEX_COLUMNS,
  DEFAULT_INDEX_LAYOUT,
  DEFAULT_INDEX_TITLE,
  INDEX_BLOCK_SETTING_KEY,
  KOREAN_PARTICLES,
  addIndexMark,
  addIndexMarksAll,
  buildIndexBlock,
  checkIndexStaleness,
  compareIndexTerms,
  groupIndexEntries,
  indexGroupHeadingOf,
  listIndexMarks,
  previewIndexMarksAll,
  refreshIndexBlock,
  removeIndexMark,
  removeIndexMarksByTerm,
  resolveIndexWordAt,
  willMultiColumnIndexSplitPages,
} from '../studio-plugin/index-marks.mjs'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

function makeDoc(lines: string[]): HwpDocument {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  lines.forEach((line, index) => {
    if (index > 0) doc.splitParagraph(0, index - 1, doc.getParagraphLength(0, index - 1))
    if (line) doc.insertText(0, index, 0, line)
  })
  return doc
}

function paraText(doc: HwpDocument, sec: number, para: number): string {
  const len = doc.getParagraphLength(sec, para)
  return len > 0 ? doc.getTextRange(sec, para, 0, len) : ''
}

function sectionColumnCounts(doc: HwpDocument): number[] {
  const out: number[] = []
  for (let s = 0; s < doc.getSectionCount(); s++) {
    out.push((JSON.parse(doc.getColumnDef(s)) as { columnCount: number }).columnCount)
  }
  return out
}

describe('index mark management (single, chunked, word resolution, refusal, removal)', () => {
  it('resolves word around caret and adds single, sub-entry, special-char, and chunked long marks', () => {
    const doc = makeDoc([
      '인공지능과 기계학습은 현대 연구의 핵심이다.',
      '긴 용어와 특수 기호를 테스트하는 문단이다.',
    ])

    const resolved = resolveIndexWordAt(doc, { sec: 0, para: 0, offset: 2 })
    expect(resolved).toEqual({
      word: '인공지능과',
      sec: 0,
      para: 0,
      start: 0,
      end: 5,
      offset: 0,
      length: 5,
    })

    // Default term resolved from caret when term is omitted
    const autoRes = addIndexMark(doc, { sec: 0, para: 0, offset: 7 })
    expect(autoRes.ok).toBe(true)
    if (!autoRes.ok) return
    expect(autoRes.term).toBe('기계학습은')
    expect(autoRes.subTerm).toBe('')

    // Sub-entry with colons and percent signs
    const specialRes = addIndexMark(
      doc,
      { sec: 0, para: 0, offset: 0 },
      {
        term: 'AI:모델%1',
        subTerm: '학습:단계%2',
      },
    )
    expect(specialRes.ok).toBe(true)
    if (!specialRes.ok) return
    expect(specialRes.names.every((n) => n.length <= MAX_MARK_NAME_LEN)).toBe(true)

    // Long term exceeding 64 UTF-16 code units -> chunked bookmarks
    const longTerm =
      '초거대언어모델기반자연어이해및생성시스템평가방법론과통계적유의성검증지표분석사례연구보고서제목'
    const longSub = '세부항목:다국어벤치마크비교분석및오류유형분류체계설계방안'
    const longRes = addIndexMark(
      doc,
      { sec: 0, para: 1, offset: 3 },
      {
        term: longTerm,
        subTerm: longSub,
      },
    )
    expect(longRes.ok).toBe(true)
    if (!longRes.ok) return
    expect(longRes.names.length).toBeGreaterThan(1)
    expect(longRes.names.every((n) => n.length <= MAX_MARK_NAME_LEN)).toBe(true)

    // List decodes all marks in document order
    const listed = listIndexMarks(doc)
    expect(listed).toHaveLength(3)
    expect(listed[0]).toMatchObject({
      term: 'AI:모델%1',
      subTerm: '학습:단계%2',
      sec: 0,
      para: 0,
      offset: 0,
      page: 1,
      pageLabel: '1',
      physicalPage: 1,
    })
    expect(listed[1]).toMatchObject({
      term: '기계학습은',
      subTerm: '',
      sec: 0,
      para: 0,
      offset: 7,
    })
    expect(listed[2]).toMatchObject({
      term: longTerm,
      subTerm: longSub,
      sec: 0,
      para: 1,
      offset: 3,
    })
  })

  it('refuses non-body places, out-of-range coordinates, and invalid terms', () => {
    const doc = makeDoc(['본문 첫 줄'])

    expect(addIndexMark(doc, { sec: 0, para: 0, offset: 0, inTable: true }, '용어')).toEqual({
      ok: false,
      reason: 'unsupported_place',
    })
    expect(addIndexMark(doc, { sec: 0, para: 0, offset: 0, inTextBox: true }, '용어')).toEqual({
      ok: false,
      reason: 'unsupported_place',
    })
    expect(addIndexMark(doc, { sec: 0, para: 0, offset: 0, inFootnote: true }, '용어')).toEqual({
      ok: false,
      reason: 'unsupported_place',
    })
    expect(addIndexMark(doc, { sec: 0, para: 0, offset: 0, inEndnote: true }, '용어')).toEqual({
      ok: false,
      reason: 'unsupported_place',
    })
    expect(addIndexMark(doc, { sec: 0, para: 0, offset: 0, inHeaderFooter: true }, '용어')).toEqual(
      {
        ok: false,
        reason: 'unsupported_place',
      },
    )
    expect(
      addIndexMark(
        doc,
        {
          sec: 0,
          para: 0,
          offset: 0,
          cellPath: [{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }],
        },
        '용어',
      ),
    ).toEqual({
      ok: false,
      reason: 'unsupported_place',
    })

    // Out-of-range coordinates
    expect(addIndexMark(doc, { sec: 5, para: 0, offset: 0 }, '용어')).toEqual({
      ok: false,
      reason: 'not_found',
    })
    expect(addIndexMark(doc, { sec: 0, para: 99, offset: 0 }, '용어')).toEqual({
      ok: false,
      reason: 'not_found',
    })
    expect(addIndexMark(doc, { sec: 0, para: 0, offset: 999 }, '용어')).toEqual({
      ok: false,
      reason: 'not_found',
    })

    // Empty or control-character term
    expect(addIndexMark(doc, { sec: 0, para: 0, offset: 2 }, { term: '   ' })).toEqual({
      ok: true,
      id: '1',
      term: '본문',
      subTerm: '',
      sec: 0,
      para: 0,
      offset: 2,
      names: ['색인:본문::1'],
    })
    expect(addIndexMark(doc, { sec: 0, para: 0, offset: 0 }, { term: '줄바꿈\n불가' })).toEqual({
      ok: false,
      reason: 'invalid_term',
    })
  })

  it('removes single, chunked, by-term, and post-hyperlink index marks safely', () => {
    const doc = makeDoc(['앞쪽 링크 뒤쪽 본문 텍스트'])

    // Insert a hyperlink before an index bookmark in the same paragraph
    doc.insertHyperlinkEx(
      JSON.stringify({
        target: { section: 0, para: 0, cellPath: [] },
        start: 0,
        end: 5,
        uri: 'https://example.com',
      }),
    )

    const longTerm =
      '매우긴색인항목이름으로청크분할삭제검증을위한충분히긴문자열데이터테스트샘플하나둘셋넷다섯여섯'
    const m1 = addIndexMark(doc, { sec: 0, para: 0, offset: 8 }, { term: '링크뒤용어' })
    const m2 = addIndexMark(doc, { sec: 0, para: 0, offset: 10 }, { term: longTerm })
    const m3 = addIndexMark(doc, { sec: 0, para: 0, offset: 12 }, { term: '공통어', subTerm: '갑' })
    const m4 = addIndexMark(doc, { sec: 0, para: 0, offset: 14 }, { term: '공통어', subTerm: '을' })
    expect(m1.ok && m2.ok && m3.ok && m4.ok).toBe(true)
    if (!m1.ok || !m2.ok || !m3.ok || !m4.ok) return

    // Remove mark sitting after a hyperlink without throwing
    const rm1 = removeIndexMark(doc, m1.id)
    expect(rm1.ok).toBe(true)

    // Remove chunked mark by its names array
    const rm2 = removeIndexMark(doc, m2.names)
    expect(rm2.ok).toBe(true)
    if (rm2.ok) expect(rm2.removed).toBe(m2.names.length)

    // Remove only one sub-entry by term + subTerm
    const rmSub = removeIndexMarksByTerm(doc, '공통어', '갑')
    expect(rmSub).toMatchObject({ ok: true, removedMarks: 1, removedBookmarks: 1 })
    expect(listIndexMarks(doc).map((m) => `${m.term}/${m.subTerm}`)).toEqual(['공통어/을'])

    // Remove all remaining marks for term
    const rmAll = removeIndexMarksByTerm(doc, '공통어')
    expect(rmAll).toMatchObject({ ok: true, removedMarks: 1, removedBookmarks: 1 })
    expect(listIndexMarks(doc)).toHaveLength(0)
    expect(removeIndexMark(doc, 'nonexistent')).toEqual({ ok: false, reason: 'not_found' })
  })
})

describe('addIndexMarksAll (whole-word matching & non-body skip counts)', () => {
  it('marks body whole-word occurrences, skips duplicates, and counts table, textbox, footnote, and endnote hits', () => {
    const doc = makeDoc([
      '연구 방법과 연구. 하지만 연구자 및 선행연구는 제외하고 (연구)만 표시한다.',
      '표 아래 본문과 글상자 및 각주 미주 자리.',
    ])

    // 1. Table cell with 2 matches of '연구'
    const tbl = JSON.parse(
      doc.createTableEx(
        JSON.stringify({
          sectionIdx: 0,
          paraIdx: 1,
          charOffset: 0,
          rowCount: 1,
          colCount: 2,
          treatAsChar: true,
        }),
      ),
    ) as { ok: boolean; controlIdx: number }
    expect(tbl.ok).toBe(true)
    doc.insertTextInCell(0, 1, tbl.controlIdx, 0, 0, 0, '연구 결과 표')
    doc.insertTextInCell(0, 1, tbl.controlIdx, 1, 0, 0, '연구, 연구자')

    // 2. Text box with 1 match of '연구'
    const tb = JSON.parse(
      doc.createShapeControl(
        JSON.stringify({
          sectionIdx: 0,
          paraIdx: 1,
          charOffset: 2,
          width: 12000,
          height: 4000,
          horzOffset: 0,
          vertOffset: 0,
          treatAsChar: false,
          textWrap: 'Square',
          shapeType: 'textbox',
        }),
      ),
    ) as { ok: boolean; controlIdx: number }
    expect(tb.ok).toBe(true)
    doc.insertTextInCellByPath(
      0,
      1,
      JSON.stringify([{ controlIndex: tb.controlIdx, cellIndex: 0, cellParaIndex: 0 }]),
      0,
      '글상자 안 연구 내용',
    )

    // 3. Footnote with 1 match of '연구'
    const fn = JSON.parse(doc.insertFootnote(0, 1, 4)) as { ok: boolean; controlIdx: number }
    expect(fn.ok).toBe(true)
    const fnInfo = JSON.parse(doc.getNoteEditInfo(0, 1, fn.controlIdx)) as { charOffset: number }
    doc.insertTextInFootnote(0, 1, fn.controlIdx, 0, fnInfo.charOffset, '각주 속 연구 참고')

    // 4. Endnote with 1 match of '연구'
    const en = JSON.parse(doc.insertEndnote(0, 1, 6)) as { ok: boolean; controlIdx: number }
    expect(en.ok).toBe(true)
    const enInfo = JSON.parse(doc.getNoteEditInfo(0, 1, en.controlIdx)) as { charOffset: number }
    doc.insertTextInFootnote(0, 1, en.controlIdx, 0, enInfo.charOffset, '미주 속 연구 노트')

    const res = addIndexMarksAll(doc, { term: '연구' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    // Body paragraph 0 has 3 whole-word matches: '연구 ', '연구.', '(연구)'
    expect(res.added).toBe(3)
    expect(res.marks.map((m) => m.offset)).toEqual([0, 7, 33])
    expect(res.skippedCounts).toEqual({
      tableCell: 2,
      textBox: 1,
      footnote: 1,
      endnote: 1,
    })
    expect(res.skippedNonBody).toBe(5)

    // Repeated run must not duplicate existing marks at the same offsets
    const second = addIndexMarksAll(doc, { term: '연구' })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.added).toBe(0)
    expect(listIndexMarks(doc)).toHaveLength(3)
  })

  it('matches Korean postpositions by default, excludes compound words, and provides a read-only preview', () => {
    expect(KOREAN_PARTICLES.length).toBeGreaterThan(20)
    for (let i = 1; i < KOREAN_PARTICLES.length; i++) {
      expect(KOREAN_PARTICLES[i - 1]!.length).toBeGreaterThanOrEqual(KOREAN_PARTICLES[i]!.length)
    }

    const doc = makeDoc([
      '연구는 중요하다. 연구를 통해 연구의 깊이를 더하는 연구 방법은 연구자가 정한다.',
      '표 자리',
    ])
    const tbl = JSON.parse(
      doc.createTableEx(
        JSON.stringify({
          sectionIdx: 0,
          paraIdx: 1,
          charOffset: 0,
          rowCount: 1,
          colCount: 1,
          treatAsChar: true,
        }),
      ),
    ) as { ok: boolean; controlIdx: number }
    expect(tbl.ok).toBe(true)
    doc.insertTextInCell(
      0,
      1,
      tbl.controlIdx,
      0,
      0,
      0,
      '연구에서는 결과를 기록하고 연구자는 제외한다.',
    )

    // Read-only preview matches addIndexMarksAll and never mutates doc.
    const preview = previewIndexMarksAll(doc, { term: '연구' })
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    expect(preview.includeParticles).toBe(true)
    expect(preview.matches).toHaveLength(4)
    expect(preview.matches.map((m) => m.matchedText)).toEqual([
      '연구는',
      '연구를',
      '연구의',
      '연구',
    ])
    expect(preview.matches.map((m) => m.particle)).toEqual(['는', '를', '의', null])
    expect(preview.matches.every((m) => m.alreadyMarked === false)).toBe(true)
    expect(preview.matches.every((m) => m.page === 1 && m.pageLabel === '1')).toBe(true)
    expect(preview.skippedCounts.tableCell).toBe(1)
    expect(preview.skippedNonBody).toBe(1)
    expect(listIndexMarks(doc)).toHaveLength(0)

    // Opting out of particle matching only matches exact boundary ('연구 방법').
    const strictPreview = previewIndexMarksAll(doc, { term: '연구', includeParticles: false })
    expect(strictPreview.ok).toBe(true)
    if (strictPreview.ok) {
      expect(strictPreview.includeParticles).toBe(false)
      expect(strictPreview.matches).toHaveLength(1)
      expect(strictPreview.matches[0]!.matchedText).toBe('연구')
      expect(strictPreview.skippedCounts.tableCell).toBe(0)
    }

    // Applying marks adds exactly 4 marks (3 particle matches + 1 exact) and skips '연구자가'.
    const added = addIndexMarksAll(doc, { term: '연구' })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(added.added).toBe(4)
    expect(added.includeParticles).toBe(true)
    expect(added.particleMatches).toBe(3)
    expect(added.skippedCounts.tableCell).toBe(1)
    expect(added.marks.map((m) => m.offset)).toEqual(preview.matches.map((m) => m.offset))
    const para0 = paraText(doc, 0, 0)
    const researcherOffset = para0.indexOf('연구자')
    expect(researcherOffset).toBeGreaterThan(0)
    expect(added.marks.some((m) => m.offset === researcherOffset)).toBe(false)

    // Subsequent preview marks all 4 occurrences as alreadyMarked.
    const afterPreview = previewIndexMarksAll(doc, { term: '연구' })
    expect(afterPreview.ok).toBe(true)
    if (afterPreview.ok) {
      expect(afterPreview.matches).toHaveLength(4)
      expect(afterPreview.matches.every((m) => m.alreadyMarked === true)).toBe(true)
    }
  })
})

describe('sorting, double-consonant folding, and page deduplication', () => {
  it('sorts Korean (Hangul) -> English (A-Z) -> Other and folds double consonants into base consonants', () => {
    expect(indexGroupHeadingOf('가을')).toBe('ㄱ')
    expect(indexGroupHeadingOf('까치')).toBe('ㄱ')
    expect(indexGroupHeadingOf('따뜻함')).toBe('ㄷ')
    expect(indexGroupHeadingOf('빨강')).toBe('ㅂ')
    expect(indexGroupHeadingOf('쌍둥이')).toBe('ㅅ')
    expect(indexGroupHeadingOf('짜장면')).toBe('ㅈ')
    expect(indexGroupHeadingOf('ㄲ')).toBe('ㄱ')
    expect(indexGroupHeadingOf('ㅆ')).toBe('ㅅ')
    expect(indexGroupHeadingOf('apple')).toBe('A')
    expect(indexGroupHeadingOf('Éclair')).toBe('E')
    expect(indexGroupHeadingOf('2026년')).toBe('기타')
    expect(indexGroupHeadingOf('@표시')).toBe('기타')

    const terms = [
      'zebra',
      '2026',
      '하늘',
      'Apple',
      '까치',
      '가을',
      '쌍둥이',
      '사랑',
      'banana',
      '#tag',
    ]
    const sorted = [...terms].sort(compareIndexTerms)
    expect(sorted).toEqual([
      '가을',
      '까치',
      '사랑',
      '쌍둥이',
      '하늘',
      'Apple',
      'banana',
      'zebra',
      '#tag',
      '2026',
    ])

    const grouped = groupIndexEntries([
      { term: '가을', subTerm: '', page: 5, pageLabel: '5', physicalPage: 5, numberingRun: 0 },
      { term: '가을', subTerm: '', page: 2, pageLabel: '2', physicalPage: 2, numberingRun: 0 },
      { term: '가을', subTerm: '', page: 5, pageLabel: '5', physicalPage: 5, numberingRun: 0 },
      { term: '까치', subTerm: '', page: 3, pageLabel: '3', physicalPage: 3, numberingRun: 0 },
      { term: '사랑', subTerm: '정의', page: 4, pageLabel: '4', physicalPage: 4, numberingRun: 0 },
      { term: '쌍둥이', subTerm: '', page: 1, pageLabel: '1', physicalPage: 1, numberingRun: 0 },
      { term: 'Alpha', subTerm: '', page: 2, pageLabel: '2', physicalPage: 2, numberingRun: 0 },
      { term: '100', subTerm: '', page: 1, pageLabel: '1', physicalPage: 1, numberingRun: 0 },
    ])

    expect(grouped.groups.map((g) => g.heading)).toEqual(['ㄱ', 'ㅅ', 'A', '기타'])
    expect(grouped.groups[0]!.entries.map((e) => e.term)).toEqual(['가을', '까치'])
    expect(grouped.groups[0]!.entries[0]!.pagesText).toBe('2, 5')
    expect(grouped.groups[1]!.entries.map((e) => e.term)).toEqual(['사랑', '쌍둥이'])
    // Main entry with only sub-entries has empty direct pagesText
    expect(grouped.groups[1]!.entries[0]!.pagesText).toBe('')
    expect(grouped.groups[1]!.entries[0]!.subEntries[0]!.pagesText).toBe('4')
  })
})

describe('index block builder (multi-column scoping, layouts, printed pages, refresh, staleness, roundtrip)', () => {
  it('builds a scoped 2-column dotted-tab index while trailing body preserves 1-column layout, with Roman & restarted pages', () => {
    const doc = makeDoc([
      '머리말 페이지',
      '서론 페이지에서 가을과 까치를 다룬다.',
      '본론 1장에서 가을과 Alpha를 다룬다.',
      '본론 2장에서 가을과 2026년을 다룬다.',
      '색인 뒤쪽 부록 본문은 1단을 유지해야 한다.',
    ])

    // Page breaks: p0=phys1 (i), p1=phys2 (ii), p2=phys3 (restart 1), p3=phys4 (2), p4=phys5
    doc.setPageNumberPos(0, 3, 5, false) // lowerRoman
    doc.applyParaFormat(0, 1, JSON.stringify({ pageBreakBefore: true }))
    doc.applyParaFormat(0, 2, JSON.stringify({ pageBreakBefore: true }))
    doc.applyParaFormat(0, 3, JSON.stringify({ pageBreakBefore: true }))
    doc.applyParaFormat(0, 4, JSON.stringify({ pageBreakBefore: true }))
    doc.insertNewNumber(0, 2, 0, 1)

    // Add index marks across front matter and restarted pages
    addIndexMark(doc, { sec: 0, para: 1, offset: 0 }, { term: '가을' })
    addIndexMark(doc, { sec: 0, para: 1, offset: 5 }, { term: '까치' })
    addIndexMark(doc, { sec: 0, para: 2, offset: 0 }, { term: '가을' })
    addIndexMark(doc, { sec: 0, para: 2, offset: 3 }, { term: '가을', subTerm: '단풍' })
    addIndexMark(doc, { sec: 0, para: 2, offset: 6 }, { term: 'Alpha' })
    addIndexMark(doc, { sec: 0, para: 3, offset: 0 }, { term: '가을' })
    addIndexMark(doc, { sec: 0, para: 3, offset: 4 }, { term: '2026년' })

    // Refuse building in a table cell
    expect(buildIndexBlock(doc, { sec: 0, para: 4, inTable: true })).toEqual({
      ok: false,
      reason: 'in_table',
    })

    // Build index before para 4 (middle of document, trailing para 4 must stay 1-column!)
    const built = buildIndexBlock(doc, { sec: 0, para: 4 }, { allowPageSplit: true })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.columns).toBe(DEFAULT_INDEX_COLUMNS)
    expect(built.layout).toBe(DEFAULT_INDEX_LAYOUT)
    expect(built.title).toBe(DEFAULT_INDEX_TITLE)

    // Verify 3 sections: [body before (1 col), index (2 cols), trailing body (1 col)]
    expect(doc.getSectionCount()).toBe(3)
    expect(sectionColumnCounts(doc)).toEqual([1, 2, 1])
    expect(paraText(doc, 2, 0)).toBe('색인 뒤쪽 부록 본문은 1단을 유지해야 한다.')

    // Verify sorted headings, folded double consonant (까치 under ㄱ), sub-entry, and printed pages
    expect(built.lines).toEqual([
      '찾아보기',
      'ㄱ',
      '가을\tii, i, ii',
      '단풍\ti',
      '까치\tii',
      'A',
      'Alpha\ti',
      '기타',
      '2026년\tii',
    ])

    // Verify dotted right tab stop and sub-entry indentation on rendered index paragraphs
    const entryProps = JSON.parse(doc.getParaPropertiesAt(built.sec, built.startPara + 2)) as {
      marginLeft: number
      tabStops: Array<{ position: number; type: number; fill: number }>
    }
    expect(entryProps.marginLeft).toBe(0)
    expect(entryProps.tabStops).toHaveLength(1)
    expect(entryProps.tabStops[0]!.type).toBe(1) // right
    expect(entryProps.tabStops[0]!.fill).toBe(3) // dots
    expect(entryProps.tabStops[0]!.position).toBeGreaterThan(20000)
    expect(entryProps.tabStops[0]!.position).toBeLessThan(50000) // column width, not full 1-col width

    const subProps = JSON.parse(doc.getParaPropertiesAt(built.sec, built.startPara + 3)) as {
      marginLeft: number
    }
    expect(subProps.marginLeft).toBeGreaterThan(0)

    // Range marks exist
    const { ranges } = findRangeMarks(doc, [MARK_PREFIXES.indexBlock])
    expect(ranges).toHaveLength(1)
    expect(ranges[0]!.start.name).toBe('색인블록:기본:시작')
    expect(ranges[0]!.end.name).toBe('색인블록:기본:끝')

    // Fresh immediately after build
    expect(checkIndexStaleness(doc)).toEqual({ stale: false })

    // Building a second index block is refused
    expect(buildIndexBlock(doc, { sec: 2, para: 0 })).toMatchObject({
      ok: false,
      reason: 'index_block_exists',
    })
  })

  it('stabilizes page numbers in 2 passes when index block is inserted before body content', () => {
    const doc = makeDoc(['첫 번째 본문 문단', '두 번째 본문 문단'])
    doc.applyParaFormat(0, 1, JSON.stringify({ pageBreakBefore: true }))
    addIndexMark(doc, { sec: 0, para: 0, offset: 0 }, { term: '첫용어' })
    addIndexMark(doc, { sec: 0, para: 1, offset: 0 }, { term: '둘용어' })

    // Insert 2-column index at (0, 0) BEFORE all body content
    const built = buildIndexBlock(doc, { sec: 0, para: 0 }, { columns: 2, allowPageSplit: true })
    expect(built.ok).toBe(true)
    if (!built.ok) return

    // Index occupies section 0 (page 1, 2 cols); body moved to section 1 (pages 2 and 3, 1 col)
    expect(sectionColumnCounts(doc)).toEqual([2, 1])
    expect(built.lines).toContain('둘용어\t3')
    expect(built.lines).toContain('첫용어\t2')
    expect(checkIndexStaleness(doc)).toEqual({ stale: false })
  })

  it('supports 1-column (no extra section) and 3-column scoped builds and borderless table layout', () => {
    // 1-column dotted-tab stays in a single section
    const doc1 = makeDoc(['본문 내용', '끝 문단'])
    addIndexMark(doc1, { sec: 0, para: 0, offset: 0 }, { term: '단일열' })
    const b1 = buildIndexBlock(doc1, { sec: 0, para: 1 }, { columns: 1, groupHeadings: false })
    expect(b1.ok).toBe(true)
    if (!b1.ok) return
    expect(doc1.getSectionCount()).toBe(1)
    expect(sectionColumnCounts(doc1)).toEqual([1])
    expect(b1.lines).toEqual(['찾아보기', '단일열\t1'])

    // 3-column borderless table layout
    const doc3 = makeDoc(['앞 본문', '뒤 본문'])
    addIndexMark(doc3, { sec: 0, para: 0, offset: 0 }, { term: '표항목' })
    addIndexMark(doc3, { sec: 0, para: 0, offset: 2 }, { term: '표항목', subTerm: '하위항목' })
    const b3 = buildIndexBlock(
      doc3,
      { sec: 0, para: 1 },
      { columns: 3, layout: 'table', allowPageSplit: true },
    )
    expect(b3.ok).toBe(true)
    if (!b3.ok) return
    expect(sectionColumnCounts(doc3)).toEqual([1, 3, 1])
    expect(b3.layout).toBe('table')
    expect(b3.lines).toEqual(['찾아보기', 'ㅍ', '표항목\t1', '하위항목\t1'])

    // Verify table cells have border type 0 (borderless)
    const tablePara = b3.endPara
    const cellProps = JSON.parse(doc3.getCellProperties(b3.sec, tablePara, 0, 0)) as {
      borderLeft: { type: number }
      borderRight: { type: number }
      borderTop: { type: number }
      borderBottom: { type: number }
    }
    expect(cellProps.borderLeft.type).toBe(0)
    expect(cellProps.borderRight.type).toBe(0)
    expect(cellProps.borderTop.type).toBe(0)
    expect(cellProps.borderBottom.type).toBe(0)
    expect(checkIndexStaleness(doc3)).toEqual({ stale: false })

    // Manual edit inside a table cell is detected by refreshIndexBlock
    doc3.insertTextInCell(b3.sec, tablePara, 0, 2, 0, 0, '수정-')
    const tableRefused = refreshIndexBlock(doc3)
    expect(tableRefused.ok).toBe(false)
    if (!tableRefused.ok) {
      expect(tableRefused.reason).toBe('manual_edits')
    }
    const tableOverwritten = refreshIndexBlock(doc3, { allowOverwriteManual: true })
    expect(tableOverwritten.ok).toBe(true)
    expect(checkIndexStaleness(doc3)).toEqual({ stale: false })
  })

  it('detects manual edits, refreshes cleanly (including column count transitions), and reports staleness accurately', () => {
    const doc = makeDoc(['본문 첫 문단', '본문 둘째 문단', '뒤쪽 꼬리 문단'])
    addIndexMark(doc, { sec: 0, para: 0, offset: 0 }, { term: '나비' })
    addIndexMark(doc, { sec: 0, para: 1, offset: 0 }, { term: '가을' })

    // No index block yet -> not stale
    expect(checkIndexStaleness(doc)).toEqual({ stale: false })

    const built = buildIndexBlock(doc, { sec: 0, para: 2 }, { columns: 2, allowPageSplit: true })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(sectionColumnCounts(doc)).toEqual([1, 2, 1])
    expect(checkIndexStaleness(doc)).toEqual({ stale: false })

    // Shift para 1 onto page 2 -> pages_changed staleness!
    doc.applyParaFormat(0, 1, JSON.stringify({ pageBreakBefore: true }))
    expect(checkIndexStaleness(doc)).toEqual({ stale: true, reason: 'pages_changed' })

    // Add a new mark -> entries_changed staleness!
    addIndexMark(doc, { sec: 0, para: 1, offset: 3 }, { term: '다람쥐' })
    expect(checkIndexStaleness(doc)).toEqual({ stale: true, reason: 'entries_changed' })

    // Manually edit one line inside the index block
    const entryPara = built.startPara + 2 // '가을\t1'
    doc.insertText(built.sec, entryPara, 0, '수동편집-')

    // Refresh without allowOverwriteManual must refuse with manual_edits
    const refused = refreshIndexBlock(doc)
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.reason).toBe('manual_edits')
      expect(refused.modifiedLines?.length).toBeGreaterThan(0)
    }

    // Refresh with allowOverwriteManual: true and switch to 1 column (merges scoped section back!)
    const refreshed1 = refreshIndexBlock(doc, { allowOverwriteManual: true, columns: 1 })
    expect(refreshed1.ok).toBe(true)
    if (!refreshed1.ok) return
    expect(refreshed1.refreshed).toBe(true)
    expect(doc.getSectionCount()).toBe(1)
    expect(sectionColumnCounts(doc)).toEqual([1])
    expect(refreshed1.lines).toEqual([
      '찾아보기',
      'ㄱ',
      '가을\t2',
      'ㄴ',
      '나비\t1',
      'ㄷ',
      '다람쥐\t2',
    ])
    expect(checkIndexStaleness(doc)).toEqual({ stale: false })

    // Refresh switching from 1 column back to 2 columns -> re-scopes dedicated section!
    const refreshed2 = refreshIndexBlock(doc, { columns: 2 })
    expect(refreshed2.ok).toBe(true)
    if (!refreshed2.ok) return
    expect(sectionColumnCounts(doc)).toEqual([1, 2, 1])
    expect(paraText(doc, 2, 0)).toBe('뒤쪽 꼬리 문단')
    expect(checkIndexStaleness(doc)).toEqual({ stale: false })
  })

  it('refuses build when no index marks exist', () => {
    const doc = makeDoc(['색인 표시가 없는 문서'])
    expect(buildIndexBlock(doc, { sec: 0, para: 0 })).toEqual({
      ok: false,
      reason: 'no_index_marks',
    })
  })

  it('round-trips index marks, chunked long marks, range marks, tabs, and scoped columns across HWP and HWPX', () => {
    const doc = makeDoc(['서론 문단', '본론 문단', '결론 꼬리 문단'])
    const longTerm =
      '라운드트립보존검증을위한육십사자초과장문색인항목문자열테스트데이터갑을병정무기경신임계자축인묘'
    addIndexMark(doc, { sec: 0, para: 0, offset: 0 }, { term: '서론용어' })
    addIndexMark(doc, { sec: 0, para: 1, offset: 0 }, { term: longTerm, subTerm: '세부:1' })

    const built = buildIndexBlock(
      doc,
      { sec: 0, para: 2 },
      { columns: 2, layout: 'dotted-tab', allowPageSplit: true },
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const hwpBytes = doc.exportHwp()
    const hwpxBytes = doc.exportHwpx()

    for (const reopened of [new HwpDocument(hwpBytes), new HwpDocument(hwpxBytes)]) {
      // Scoped 2-column section preserved with 1-column surrounding sections
      expect(sectionColumnCounts(reopened)).toEqual([1, 2, 1])

      // Index marks (including chunked long term) decoded accurately
      const marks = listIndexMarks(reopened)
      expect(marks.map((m) => m.term)).toEqual(['서론용어', longTerm])
      expect(marks[1]!.subTerm).toBe('세부:1')

      // Range marks and settings preserved
      const { ranges } = findRangeMarks(reopened, [MARK_PREFIXES.indexBlock])
      expect(ranges).toHaveLength(1)
      expect(listMarks(reopened, [MARK_PREFIXES.setting]).length).toBeGreaterThan(0)
      expect(INDEX_BLOCK_SETTING_KEY).toBe('색인블록')

      // Dotted tab stops preserved on both sub-entry (startPara+3) and main entry (startPara+5)
      for (const delta of [3, 5]) {
        const entryProps = JSON.parse(
          reopened.getParaPropertiesAt(ranges[0]!.start.sec, ranges[0]!.start.para + delta),
        ) as { tabStops: Array<{ position: number; type: number; fill: number }> }
        expect(entryProps.tabStops).toHaveLength(1)
        expect(entryProps.tabStops[0]!.type).toBe(1)
        expect(entryProps.tabStops[0]!.fill).toBe(3)
      }

      // Freshness & refresh work seamlessly after reopen
      expect(checkIndexStaleness(reopened)).toEqual({ stale: false })
      const refreshed = refreshIndexBlock(reopened)
      expect(refreshed.ok).toBe(true)
    }
  })

  it('resets inherited pageBreakBefore and 개요 1 outline style on all rendered index paragraphs without polluting outline navigation', () => {
    const doc = makeDoc(['제1장 서론', '본문 내용에서 핵심용어를 설명한다.', '꼬리 문단'])
    const styles = JSON.parse(doc.getStyleList()) as Array<{ id: number; name: string }>
    const outline1 = styles.find((s) => s.name === '개요 1')
    expect(outline1).toBeDefined()
    doc.applyStyle(0, 0, outline1!.id)
    doc.applyParaFormat(0, 0, JSON.stringify({ pageBreakBefore: true }))

    addIndexMark(doc, { sec: 0, para: 1, offset: 0 }, { term: '핵심용어' })
    addIndexMark(doc, { sec: 0, para: 1, offset: 4 }, { term: '핵심용어', subTerm: '정의' })

    // Insert single-column dotted-tab index immediately after the 개요 1 + pageBreakBefore paragraph
    const built = buildIndexBlock(doc, { sec: 0, para: 1 }, { columns: 1, layout: 'dotted-tab' })
    expect(built.ok).toBe(true)
    if (!built.ok) return

    for (let p = built.startPara; p <= built.endPara; p++) {
      const style = JSON.parse(doc.getStyleAt(built.sec, p)) as { id: number; name: string }
      const props = JSON.parse(doc.getParaPropertiesAt(built.sec, p)) as {
        pageBreakBefore: boolean
        headType: string
      }
      expect(style.id).toBe(0)
      expect(props.pageBreakBefore).toBe(false)
      expect(props.headType).toBe('None')
    }

    // Outline navigation must still report only the single real heading
    const nav = JSON.parse(doc.getOutlineNavigation()) as { outline: Array<{ title: string }> }
    expect(nav.outline).toHaveLength(1)
    expect(nav.outline[0]!.title).toBe('제1장 서론')

    // Refreshing into table layout also keeps body style and pageBreakBefore=false on title & table holder
    const refreshedTable = refreshIndexBlock(doc, { layout: 'table' })
    expect(refreshedTable.ok).toBe(true)
    if (!refreshedTable.ok) return
    for (let p = refreshedTable.startPara; p <= refreshedTable.endPara; p++) {
      const style = JSON.parse(doc.getStyleAt(refreshedTable.sec, p)) as { id: number }
      const props = JSON.parse(doc.getParaPropertiesAt(refreshedTable.sec, p)) as {
        pageBreakBefore: boolean
        headType: string
      }
      expect(style.id).toBe(0)
      expect(props.pageBreakBefore).toBe(false)
      expect(props.headType).toBe('None')
    }
    const navAfter = JSON.parse(doc.getOutlineNavigation()) as { outline: Array<{ title: string }> }
    expect(navAfter.outline).toHaveLength(1)
  })

  it('builds title-less table index blocks (title: "" and title: null) with valid paired range, refresh, non-body skip exclusion, and HWP/HWPX roundtrip', () => {
    for (const emptyTitle of ['', null] as const) {
      const doc = makeDoc(['본문에서 색인어 테스트를 진행한다.', '뒤쪽 문단'])
      addIndexMark(doc, { sec: 0, para: 0, offset: 5 }, { term: '색인어' })

      const built = buildIndexBlock(
        doc,
        { sec: 0, para: 1 },
        {
          title: emptyTitle,
          layout: 'table',
          columns: 2,
          allowPageSplit: true,
        },
      )
      expect(built.ok).toBe(true)
      if (!built.ok) return
      expect(built.startPara).toBe(built.endPara)
      expect(built.lines).toEqual(['ㅅ', '색인어\t1'])

      // Range mark must be validly paired (시작 before 끝) with zero broken marks
      const rangeCheck = findRangeMarks(doc, [MARK_PREFIXES.indexBlock])
      expect(rangeCheck.ranges).toHaveLength(1)
      expect(rangeCheck.broken).toHaveLength(0)
      expect(rangeCheck.ranges[0]!.start.name).toBe('색인블록:기본:시작')
      expect(rangeCheck.ranges[0]!.end.name).toBe('색인블록:기본:끝')

      expect(checkIndexStaleness(doc)).toEqual({ stale: false })

      // addIndexMarksAll must NOT count cells inside the table-layout index block as skippedCounts.tableCell
      const scanAll = addIndexMarksAll(doc, { term: '색인어' })
      expect(scanAll.ok).toBe(true)
      if (!scanAll.ok) return
      expect(scanAll.skippedCounts.tableCell).toBe(0)
      expect(scanAll.skippedNonBody).toBe(0)

      // HWP and HWPX roundtrip preserve paired range, staleness, and refreshability
      for (const reopened of [
        new HwpDocument(doc.exportHwp()),
        new HwpDocument(doc.exportHwpx()),
      ]) {
        const reopenedRanges = findRangeMarks(reopened, [MARK_PREFIXES.indexBlock])
        expect(reopenedRanges.ranges).toHaveLength(1)
        expect(reopenedRanges.broken).toHaveLength(0)
        expect(checkIndexStaleness(reopened)).toEqual({ stale: false })
        const refreshed = refreshIndexBlock(reopened)
        expect(refreshed.ok).toBe(true)
      }
    }
  })

  it('recovers from orphan index-block marks and cleans up duplicate/broken index marks on refresh', () => {
    // Case A: Orphan `색인블록:기본:시작` cleared on refresh, allowing immediate rebuild
    const docOrphan1 = makeDoc(['본문 첫 문단', '본문 둘째 문단'])
    addIndexMark(docOrphan1, { sec: 0, para: 0, offset: 0 }, { term: '복구어' })
    docOrphan1.addBookmark(0, 1, 0, '색인블록:기본:시작')

    const refreshOrphan = refreshIndexBlock(docOrphan1)
    expect(refreshOrphan.ok).toBe(false)
    if (!refreshOrphan.ok) {
      expect(refreshOrphan.reason).toBe('not_found')
      expect(refreshOrphan.cleanedMarks?.brokenRemoved).toBe(1)
    }
    const rebuiltAfterRefresh = buildIndexBlock(
      docOrphan1,
      { sec: 0, para: 1 },
      { allowPageSplit: true },
    )
    expect(rebuiltAfterRefresh.ok).toBe(true)

    // Case B: Orphan `색인블록:기본:끝` auto-cleaned directly by buildIndexBlock (no duplicate_name lockout)
    const docOrphan2 = makeDoc(['본문 첫 문단', '본문 둘째 문단'])
    addIndexMark(docOrphan2, { sec: 0, para: 0, offset: 0 }, { term: '복구어' })
    docOrphan2.addBookmark(0, 1, 0, '색인블록:기본:끝')

    const builtDirect = buildIndexBlock(docOrphan2, { sec: 0, para: 1 }, { allowPageSplit: true })
    expect(builtDirect.ok).toBe(true)
    if (builtDirect.ok) {
      expect(builtDirect.cleanedMarks?.brokenRemoved).toBe(1)
    }

    // Case C: Copy/paste duplicate `색인:` mark + incomplete chunked `색인:` mark cleaned on refreshIndexBlock
    const docDup = makeDoc(['첫째 문단', '둘째 문단', '색인 자리'])
    docDup.applyParaFormat(0, 1, JSON.stringify({ pageBreakBefore: true }))
    docDup.addBookmark(0, 0, 0, '색인:중복어::1')
    // Simulate real copy/paste of paragraph 0 into paragraph 1, duplicating the `색인:중복어::1` bookmark
    docDup.copySelection(0, 0, 0, 0, docDup.getParagraphLength(0, 0))
    docDup.pasteInternal(0, 1, 0)
    docDup.addBookmark(0, 0, 2, '색인:%c:dead01:1/2:끊긴청크') // incomplete 1/2 chunk

    const builtDup = buildIndexBlock(docDup, { sec: 0, para: 2 }, { columns: 1 })
    expect(builtDup.ok).toBe(true)

    const refreshedDup = refreshIndexBlock(docDup)
    expect(refreshedDup.ok).toBe(true)
    if (!refreshedDup.ok) return
    expect(refreshedDup.cleanedMarks?.deduplicated).toBeGreaterThanOrEqual(1)
    expect(refreshedDup.cleanedMarks?.brokenRemoved).toBeGreaterThanOrEqual(1)
    // Both occurrences of '중복어' survived deduplication across pages 1 and 2
    expect(refreshedDup.lines).toContain('중복어\t1, 2')
    expect(findRangeMarks(docDup, [MARK_PREFIXES.indexBlock]).broken).toHaveLength(0)
  })

  it('supports end-of-document insertion with 2 -> 3 -> 1 -> 2 column transitions', () => {
    const doc = makeDoc(['첫 문단', '마지막 본문 문단'])
    addIndexMark(doc, { sec: 0, para: 0, offset: 0 }, { term: '끝색인' })

    // Append at end of document using where: 'after' on the last paragraph (2 cols)
    const built = buildIndexBlock(doc, { sec: 0, para: 1 }, { where: 'after', columns: 2 })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(sectionColumnCounts(doc)).toEqual([1, 2])
    expect(paraText(doc, 0, 1)).toBe('마지막 본문 문단')

    // 2 -> 3 columns
    const r3 = refreshIndexBlock(doc, { columns: 3 })
    expect(r3.ok).toBe(true)
    expect(sectionColumnCounts(doc)).toEqual([1, 3])

    // 3 -> 1 column (merges dedicated end section back into section 0)
    const r1 = refreshIndexBlock(doc, { columns: 1 })
    expect(r1.ok).toBe(true)
    expect(sectionColumnCounts(doc)).toEqual([1])

    // 1 -> 2 columns (re-isolates end section cleanly)
    const r2 = refreshIndexBlock(doc, { columns: 2 })
    expect(r2.ok).toBe(true)
    expect(sectionColumnCounts(doc)).toEqual([1, 2])
    expect(paraText(doc, 0, 1)).toBe('마지막 본문 문단')
    expect(checkIndexStaleness(doc)).toEqual({ stale: false })
  })

  it('requires page_split_confirm for mid-document multi-column indexes, allows end-of-document directly, and inherits section attributes', () => {
    const doc = makeDoc(['앞 본문 문단', '중간 본문 문단', '뒤쪽 부록 문단'])
    addIndexMark(doc, { sec: 0, para: 0, offset: 0 }, { term: '머리말용어' })

    // Configure custom landscape pageDef, header, multi-line footer, and page number position.
    doc.setPageDef(
      0,
      JSON.stringify({
        width: 59528,
        height: 84186,
        marginLeft: 5000,
        marginRight: 5200,
        marginTop: 4000,
        marginBottom: 4200,
        landscape: true,
      }),
    )
    doc.createHeaderFooter(0, true, 0)
    doc.insertTextInHeaderFooter(0, true, 0, 0, 0, '학위논문 머리말')
    doc.applyCharFormatInHeaderFooter(
      0,
      true,
      0,
      0,
      0,
      0,
      '학위논문 머리말'.length,
      JSON.stringify({ bold: true, fontSize: 1100 }),
    )
    doc.createHeaderFooter(0, false, 0)
    doc.insertTextInHeaderFooter(0, false, 0, 0, 0, '꼬리말 첫 줄')
    doc.splitParagraphInHeaderFooter(0, false, 0, 0, '꼬리말 첫 줄'.length)
    doc.insertTextInHeaderFooter(0, false, 0, 1, 0, '꼬리말 둘째 줄')
    doc.setPageNumberPos(0, 0, 5, true)

    // Mid-document multi-column splits pages; end-of-document and 1-column do not.
    expect(willMultiColumnIndexSplitPages(doc, { sec: 0, para: 1 }, 2)).toBe(true)
    expect(willMultiColumnIndexSplitPages(doc, { sec: 0, para: 1 }, 1)).toBe(false)
    expect(willMultiColumnIndexSplitPages(doc, { sec: 0, para: 2 }, 2, { where: 'after' })).toBe(
      false,
    )

    // Mid-document multi-column refuses without allowPageSplit and does not mutate doc.
    const refused = buildIndexBlock(doc, { sec: 0, para: 1 }, { columns: 2 })
    expect(refused).toEqual({
      ok: false,
      reason: 'page_split_confirm',
      splitsPages: true,
    })
    expect(doc.getSectionCount()).toBe(1)
    expect(findRangeMarks(doc, [MARK_PREFIXES.indexBlock]).ranges).toHaveLength(0)

    // Confirming allowPageSplit: true succeeds and inherits section attributes on all split sections.
    const built = buildIndexBlock(doc, { sec: 0, para: 1 }, { columns: 2, allowPageSplit: true })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(doc.getSectionCount()).toBe(3)
    expect(sectionColumnCounts(doc)).toEqual([1, 2, 1])

    const verifyInheritance = (targetDoc: HwpDocument, label: string) => {
      expect(targetDoc.getSectionCount(), label).toBe(3)
      for (let s = 0; s < 3; s++) {
        const pd = JSON.parse(targetDoc.getPageDef(s)) as {
          landscape: boolean
          marginLeft: number
          marginRight: number
        }
        expect(pd.landscape, `${label}:sec${s}:landscape`).toBe(true)
        expect(pd.marginLeft, `${label}:sec${s}:marginLeft`).toBe(5000)
        expect(pd.marginRight, `${label}:sec${s}:marginRight`).toBe(5200)

        const header = JSON.parse(targetDoc.getHeaderFooter(s, true, 0)) as {
          exists: boolean
          text: string
        }
        expect(header.exists, `${label}:sec${s}:headerExists`).toBe(true)
        expect(header.text, `${label}:sec${s}:headerText`).toBe('학위논문 머리말')

        const footer = JSON.parse(targetDoc.getHeaderFooter(s, false, 0)) as {
          exists: boolean
          text: string
        }
        expect(footer.exists, `${label}:sec${s}:footerExists`).toBe(true)
        expect(footer.text, `${label}:sec${s}:footerText`).toBe('꼬리말 첫 줄\n꼬리말 둘째 줄')

        const pgnp = JSON.parse(targetDoc.getPageNumberPos(s)) as {
          pageNumber: { format: number; position: number; dash: boolean } | null
        }
        expect(pgnp.pageNumber, `${label}:sec${s}:pgnp`).toEqual({
          format: 0,
          position: 5,
          dash: true,
        })

        const sd = JSON.parse(targetDoc.getSectionDef(s)) as { pageNum: number }
        expect(sd.pageNum, `${label}:sec${s}:pageNum`).toBe(0)
      }

      // Continuous page numbers 1, 2, 3 across the 3 sections.
      expect(targetDoc.pageCount(), `${label}:pageCount`).toBe(3)
      const printedPages = [0, 1, 2].map(
        (p) => (JSON.parse(targetDoc.getPageInfo(p)) as { pageNumber: number }).pageNumber,
      )
      expect(printedPages, `${label}:printedPages`).toEqual([1, 2, 3])
    }

    verifyInheritance(doc, 'live')
    const reopenedHwp = new HwpDocument(doc.exportHwp())
    const reopenedHwpx = new HwpDocument(doc.exportHwpx())
    try {
      verifyInheritance(reopenedHwp, 'hwp')
      verifyInheritance(reopenedHwpx, 'hwpx')
    } finally {
      reopenedHwp.free()
      reopenedHwpx.free()
    }

    // End-of-document multi-column succeeds directly without allowPageSplit and inherits attributes.
    const endDoc = makeDoc(['첫 문단', '마지막 문단'])
    addIndexMark(endDoc, { sec: 0, para: 0, offset: 0 }, { term: '끝용어' })
    endDoc.createHeaderFooter(0, true, 0)
    endDoc.insertTextInHeaderFooter(0, true, 0, 0, 0, '문서 끝 머리말')
    endDoc.setPageNumberPos(0, 0, 5, false)

    const endBuilt = buildIndexBlock(endDoc, { sec: 0, para: 1 }, { where: 'after', columns: 2 })
    expect(endBuilt.ok).toBe(true)
    expect(sectionColumnCounts(endDoc)).toEqual([1, 2])
    const endHeader = JSON.parse(endDoc.getHeaderFooter(1, true, 0)) as {
      exists: boolean
      text: string
    }
    expect(endHeader.exists).toBe(true)
    expect(endHeader.text).toBe('문서 끝 머리말')
  })
})
