/**
 * Multi-scope find and replace engine tests against the real @rhwp/core WASM engine,
 * plus studio cursor navigation tests for revealFindMatch.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import {
  findMatches,
  replaceFindMatches,
  revealFindMatch,
  type FindMatch,
} from '../studio-plugin/find.mjs'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

/** Create a blank document populated with body paragraphs. */
function makeDoc(paragraphs: string[] = ['']): HwpDocument {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  paragraphs.forEach((text, index) => {
    if (index > 0) {
      doc.splitParagraph(0, index - 1, doc.getParagraphLength(0, index - 1))
    }
    if (text) doc.insertText(0, index, 0, text)
  })
  return doc
}

/** Read all body paragraphs of section 0. */
function bodyTexts(doc: HwpDocument, sec = 0): string[] {
  return Array.from({ length: doc.getParagraphCount(sec) }, (_, para) => {
    const len = doc.getParagraphLength(sec, para)
    return len > 0 ? doc.getTextRange(sec, para, 0, len) : ''
  })
}

/** Snapshot-based transaction helper matching the editor's single-step undo model. */
function withHistory(initial: HwpDocument) {
  let doc = initial
  const history: Uint8Array[] = []
  return {
    doc: () => doc,
    steps: () => history.length,
    transaction<T>(fn: (d: HwpDocument) => T): T {
      const before = doc.exportHwp()
      const result = fn(doc)
      history.push(before)
      return result
    },
    undo(): boolean {
      const before = history.pop()
      if (!before) return false
      doc = new HwpDocument(before)
      return true
    },
  }
}

describe('findMatches — scopes and reading order', () => {
  it('finds matches across body, table, nested table, textbox, footnote, and endnote while excluding headers and footers', () => {
    const doc = makeDoc(['도입 연구 문단', '', '결론 연구 문단'])

    // Header and footer containing the query — must be excluded
    doc.createHeaderFooter(0, true, 0)
    doc.insertTextInHeaderFooter(0, true, 0, 0, 0, '머리말 연구 제외')
    doc.createHeaderFooter(0, false, 0)
    doc.insertTextInHeaderFooter(0, false, 0, 0, 0, '꼬리말 연구 제외')

    // Text box in paragraph 0
    const shape = JSON.parse(
      doc.createShapeControl(
        JSON.stringify({
          sectionIdx: 0,
          paraIdx: 0,
          charOffset: 0,
          width: 12000,
          height: 5000,
          horzOffset: 0,
          vertOffset: 0,
          treatAsChar: false,
          textWrap: 'Square',
          shapeType: 'textbox',
        }),
      ),
    )
    expect(shape.ok).toBe(true)
    const tbPath = JSON.stringify([
      { controlIndex: shape.controlIdx, cellIndex: 0, cellParaIndex: 0 },
    ])
    doc.insertTextInCellByPath(0, shape.paraIdx, tbPath, 0, '글상자 연구 텍스트')

    // Footnote in paragraph 0
    const fn = JSON.parse(doc.insertFootnote(0, 0, 5))
    expect(fn.ok).toBe(true)
    doc.insertTextInFootnote(0, 0, fn.controlIdx, 0, 2, '각주 연구 설명')

    // Table with a nested table in paragraph 1
    doc.pasteHtml(0, 1, 0, '<table><tr><td>외부표 연구 칸</td><td>다른 칸</td></tr></table>')
    const outerCellPath = JSON.stringify([{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }])
    const nested = JSON.parse(
      doc.createTableInCellByPath(
        0,
        1,
        outerCellPath,
        doc.getCellParagraphLengthByPath(0, 1, outerCellPath),
        JSON.stringify({ rowCount: 1, colCount: 1 }),
      ),
    )
    expect(nested.ok).toBe(true)
    doc.insertTextInCellByPath(0, 1, JSON.stringify(nested.cellPath), 0, '안쪽표 연구 값')

    // Endnote in paragraph 2
    const en = JSON.parse(doc.insertEndnote(0, 2, 5))
    expect(en.ok).toBe(true)
    doc.insertTextInFootnote(0, 2, en.controlIdx, 0, 2, '미주 연구 참고')

    const result = findMatches(doc, { query: '연구' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.total).toBe(7)
    expect(result.matches.map((m) => m.kind)).toEqual([
      'body',
      'textbox',
      'footnote',
      'table',
      'table',
      'body',
      'endnote',
    ])

    // Indices are strictly 0..6 and pages are 1-based
    expect(result.matches.map((m) => m.index)).toEqual([0, 1, 2, 3, 4, 5, 6])
    for (const m of result.matches) {
      expect(m.matchText).toBe('연구')
      expect(m.length).toBe(2)
      expect(m.page).toBeGreaterThanOrEqual(1)
    }

    // Verify nested table path depth is 2
    expect(result.matches[3]!.path).toHaveLength(1)
    expect(result.matches[4]!.path).toHaveLength(2)

    // Verify footnote/endnote metadata and offset includes auto-number prefix while context strips it
    const fnMatch = result.matches[2]!
    expect(fnMatch.noteControl).toBe(fn.controlIdx)
    expect(fnMatch.notePara).toBe(0)
    expect(fnMatch.noteNumber).toBe(1)
    expect(fnMatch.offset).toBe(2 + 3) // 2 prefix + '각주 ' (3)
    expect(fnMatch.beforeText).toBe('각주 ')
    expect(fnMatch.afterText).toBe(' 설명')

    const enMatch = result.matches[6]!
    expect(enMatch.noteControl).toBe(en.controlIdx)
    expect(enMatch.notePara).toBe(0)
    expect(enMatch.noteNumber).toBe(1)
    expect(enMatch.beforeText).toBe('미주 ')
  })

  it('returns empty matches when query, style, and charFormat are all empty', () => {
    const doc = makeDoc(['아무 내용이나'])
    expect(findMatches(doc, {})).toEqual({ ok: true, total: 0, matches: [] })
    expect(findMatches(doc, { query: '', style: null, charFormat: {} })).toEqual({
      ok: true,
      total: 0,
      matches: [],
    })
  })

  it('finds and replaces a nested table appearing after more than 1,000 outer cell paragraphs', () => {
    const doc = makeDoc(['', ''])
    // 400 rows x 3 cols = 1,200 outer cell paragraphs before the nested table
    const bigRows = Array.from(
      { length: 400 },
      (_, i) => `<tr><td>행${i}</td><td>항목</td><td>값</td></tr>`,
    )
    expect(JSON.parse(doc.pasteHtml(0, 0, 0, `<table>${bigRows.join('')}</table>`)).ok).toBe(true)

    // Second table with a nested table inside cell 0
    expect(JSON.parse(doc.pasteHtml(0, 1, 0, '<table><tr><td>외부셀</td></tr></table>')).ok).toBe(
      true,
    )
    const outerCellPath = JSON.stringify([{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }])
    const nested = JSON.parse(
      doc.createTableInCellByPath(
        0,
        1,
        outerCellPath,
        doc.getCellParagraphLengthByPath(0, 1, outerCellPath),
        JSON.stringify({ rowCount: 1, colCount: 1 }),
      ),
    )
    expect(nested.ok).toBe(true)
    const nestedPathJson = JSON.stringify(nested.cellPath)
    doc.insertTextInCellByPath(0, 1, nestedPathJson, 0, '후반부 중첩표 표적')

    const found = findMatches(doc, { query: '표적' })
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.total).toBe(1)
    expect(found.matches[0]!.kind).toBe('table')
    expect(found.matches[0]!.path).toHaveLength(2)
    expect(found.matches[0]!.matchText).toBe('표적')

    const replaced = replaceFindMatches(doc, { query: '표적' }, '교체됨', 'all')
    expect(replaced).toMatchObject({
      ok: true,
      replaced: 1,
      skippedObjects: 0,
      skippedCitations: 0,
    })
    const updatedLen = doc.getCellParagraphLengthByPath(0, 1, nestedPathJson)
    expect(doc.getTextInCellByPath(0, 1, nestedPathJson, 0, updatedLen)).toBe(
      '후반부 중첩표 교체됨',
    )
  }, 30000)
})

describe('findMatches — case sensitivity, wholeWord, code points, and regex', () => {
  it('supports caseSensitive toggle and wholeWord for Korean, Latin, and digits', () => {
    const doc = makeDoc([
      '연구 논문과 연구. 하지만 연구자 및 선행연구 그리고 2025연구는 제외.',
      'Alpha alpha ALPHA test test123 test-case pre_test',
    ])

    // Korean wholeWord
    const koWhole = findMatches(doc, { query: '연구', wholeWord: true })
    expect(koWhole.ok).toBe(true)
    if (!koWhole.ok) return
    expect(koWhole.total).toBe(2)
    expect(koWhole.matches.map((m) => m.offset)).toEqual([0, 7])

    // Without wholeWord all 5 occurrences match
    const koAll = findMatches(doc, { query: '연구', wholeWord: false })
    expect(koAll.ok).toBe(true)
    if (!koAll.ok) return
    expect(koAll.total).toBe(5)

    // Case sensitivity
    const ci = findMatches(doc, { query: 'alpha', caseSensitive: false })
    expect(ci.ok && ci.total).toBe(3)
    const cs = findMatches(doc, { query: 'Alpha', caseSensitive: true })
    expect(cs.ok && cs.total).toBe(1)

    // Latin/digit wholeWord: matches "test", "test-case", and "pre_test" ('_' is not \p{L}|\p{N}), not "test123"
    const enWhole = findMatches(doc, { query: 'test', wholeWord: true })
    expect(enWhole.ok).toBe(true)
    if (!enWhole.ok) return
    expect(enWhole.total).toBe(3)
    expect(enWhole.matches.map((m) => m.afterText.slice(0, 1))).toEqual([' ', '-', ''])
  })

  it('counts code-point offsets accurately when emoji surrogate pairs precede a match', () => {
    const doc = makeDoc(['가😀나 연구 끝'])
    const found = findMatches(doc, { query: '연구' })
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.total).toBe(1)
    // '가'(0) '😀'(1) '나'(2) ' '(3) '연'(4)
    expect(found.matches[0]!.offset).toBe(4)
    expect(found.matches[0]!.length).toBe(2)
  })

  it('handles regex matching, invalid regex errors, zero-length regex safety, and $1 backreference replacement', () => {
    const doc = makeDoc(['2024-05-01 보고서와 2025-11-30 논문'])

    // Invalid regex returns structured error without throwing
    const bad = findMatches(doc, { query: '[unclosed', regex: true })
    expect(bad).toMatchObject({ ok: false, reason: 'invalid_regex' })
    if (!bad.ok) expect(bad.error.length).toBeGreaterThan(0)

    // Zero-length regex terminates safely without hanging
    const zeroLen = findMatches(doc, { query: 'z*', regex: true })
    expect(zeroLen.ok).toBe(true)
    if (zeroLen.ok) expect(zeroLen.total).toBe(0)

    // Regex backreference replacement: YYYY-MM-DD -> YYYY.MM.DD (keeping $$ literal $)
    const replaced = replaceFindMatches(
      doc,
      { query: '(\\d{4})-(\\d{2})-(\\d{2})', regex: true },
      '$1.$2.$3',
      'all',
    )
    expect(replaced).toMatchObject({
      ok: true,
      replaced: 2,
      skippedObjects: 0,
      skippedCitations: 0,
    })
    expect(bodyTexts(doc)[0]).toBe('2024.05.01 보고서와 2025.11.30 논문')
  })
})

describe('findMatches — style and charFormat filters', () => {
  it('supports style-only search, charFormat-only search, and combined query + style + charFormat', () => {
    const doc = makeDoc(['제1장 서론', '일반 본문 연구 내용입니다.', '제2장 본론 연구'])

    // Apply Outline 1 (개요 1, id=2) to paragraphs 0 and 2
    const styles = JSON.parse(doc.getStyleList()) as Array<{
      id: number
      name: string
      englishName: string
    }>
    const outline1 = styles.find((s) => s.name === '개요 1')!
    expect(outline1).toBeDefined()
    doc.applyStyle(0, 0, outline1.id)
    doc.applyStyle(0, 2, outline1.id)

    // Also add a table with a nested table to ensure style matching works on depth-1 cell
    // and gracefully skips nested tables
    doc.splitParagraph(0, 2, doc.getParagraphLength(0, 2))
    doc.pasteHtml(0, 3, 0, '<table><tr><td>표 제목</td></tr></table>')
    doc.applyCellStyle(0, 3, 0, 0, 0, outline1.id)
    const outerCell = JSON.stringify([{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }])
    const nested = JSON.parse(
      doc.createTableInCellByPath(
        0,
        3,
        outerCell,
        doc.getCellParagraphLengthByPath(0, 3, outerCell),
        JSON.stringify({ rowCount: 1, colCount: 1 }),
      ),
    )
    doc.insertTextInCellByPath(0, 3, JSON.stringify(nested.cellPath), 0, '안쪽표 텍스트')

    // Style-only by Korean name
    const byKoStyle = findMatches(doc, { style: '개요 1' })
    expect(byKoStyle.ok).toBe(true)
    if (!byKoStyle.ok) return
    expect(byKoStyle.matches.map((m) => m.matchText)).toEqual([
      '제1장 서론',
      '제2장 본론 연구',
      '표 제목',
    ])

    // Style-only by English name
    const byEnStyle = findMatches(doc, { style: outline1.englishName })
    expect(byEnStyle.ok && byEnStyle.total).toBe(3)

    // Apply char formats on paragraph 1:
    // "일반 "(0..3) bold+italic, "본문 "(3..6) bold+underline+14pt+#CC0000+맑은 고딕, "연구 "(6..9) bold+14pt+#cc0000+맑은 고딕
    doc.applyCharFormat(0, 1, 0, 3, JSON.stringify({ bold: true, italic: true }))
    doc.applyCharFormat(
      0,
      1,
      3,
      6,
      JSON.stringify({
        bold: true,
        underline: true,
        fontSize: 1400,
        textColor: '#cc0000',
        fontName: '맑은 고딕',
      }),
    )
    doc.applyCharFormat(
      0,
      1,
      6,
      9,
      JSON.stringify({
        bold: true,
        fontSize: 1400,
        textColor: '#cc0000',
        fontName: '맑은 고딕',
      }),
    )

    // charFormat-only: bold merges contiguous runs 0..3 + 3..6 + 6..9 into one span "일반 본문 연구 "
    const boldOnly = findMatches(doc, { charFormat: { bold: true } })
    expect(boldOnly.ok).toBe(true)
    if (!boldOnly.ok) return
    expect(boldOnly.total).toBe(1)
    expect(boldOnly.matches[0]!.matchText).toBe('일반 본문 연구 ')
    expect(boldOnly.matches[0]!.offset).toBe(0)
    expect(boldOnly.matches[0]!.length).toBe(9)

    // charFormat-only with font + size (within 0.2pt) + color (case-insensitive) + underline
    const richFilter = findMatches(doc, {
      charFormat: {
        font: '맑은 고딕',
        size: 14.1,
        color: '#CC0000',
        underline: true,
      },
    })
    expect(richFilter.ok).toBe(true)
    if (!richFilter.ok) return
    expect(richFilter.total).toBe(1)
    expect(richFilter.matches[0]!.matchText).toBe('본문 ')

    // charFormat-only: italic
    const italicOnly = findMatches(doc, { charFormat: { italic: true } })
    expect(italicOnly.ok).toBe(true)
    if (!italicOnly.ok) return
    expect(italicOnly.total).toBe(1)
    expect(italicOnly.matches[0]!.matchText).toBe('일반 ')

    // Combined query + style: "연구" only in 개요 1 (paragraph 2, not paragraph 1)
    const queryAndStyle = findMatches(doc, { query: '연구', style: '개요 1' })
    expect(queryAndStyle.ok).toBe(true)
    if (!queryAndStyle.ok) return
    expect(queryAndStyle.total).toBe(1)
    expect(queryAndStyle.matches[0]!.para).toBe(2)

    // Combined query + charFormat: "연구" only where bold & 14pt (paragraph 1, not paragraph 2)
    const queryAndFormat = findMatches(doc, {
      query: '연구',
      charFormat: { bold: true, size: 14 },
    })
    expect(queryAndFormat.ok).toBe(true)
    if (!queryAndFormat.ok) return
    expect(queryAndFormat.total).toBe(1)
    expect(queryAndFormat.matches[0]!.para).toBe(1)
  })
})

describe('replaceFindMatches — selection modes, single undo, and safety skips', () => {
  it('replaces one, a selected subset, and all in a single undoable transaction, rejecting control chars', () => {
    const session = withHistory(makeDoc(['사과와 사과 그리고 사과', '또 다른 사과']))

    // Reject newline in replacement
    const bad = replaceFindMatches(session.doc(), { query: '사과' }, '배\n감', 'all')
    expect(bad).toMatchObject({ ok: false, reason: 'bad_replacement' })

    // Replace only match index 1 (second occurrence in para 0)
    const one = session.transaction((d) =>
      replaceFindMatches(d, { query: '사과' }, '복숭아', { indices: [1] }),
    )
    expect(one).toMatchObject({ ok: true, replaced: 1 })
    expect(bodyTexts(session.doc())).toEqual(['사과와 복숭아 그리고 사과', '또 다른 사과'])

    // Undo restores original
    expect(session.undo()).toBe(true)
    expect(bodyTexts(session.doc())).toEqual(['사과와 사과 그리고 사과', '또 다른 사과'])

    // Replace selected subset { indices: [0, 2, 3] } in ONE transaction (reverse order in para 0)
    const subset = session.transaction((d) =>
      replaceFindMatches(d, { query: '사과' }, '오렌지', { indices: [0, 2, 3] }),
    )
    expect(subset).toMatchObject({
      ok: true,
      replaced: 3,
      skippedObjects: 0,
      skippedCitations: 0,
    })
    expect(bodyTexts(session.doc())).toEqual(['오렌지와 사과 그리고 오렌지', '또 다른 오렌지'])

    // Single undo restores ALL 3 replaced occurrences at once
    expect(session.steps()).toBe(1)
    expect(session.undo()).toBe(true)
    expect(bodyTexts(session.doc())).toEqual(['사과와 사과 그리고 사과', '또 다른 사과'])

    // Replace all in one transaction
    const all = session.transaction((d) => replaceFindMatches(d, { query: '사과' }, '배', 'all'))
    expect(all).toMatchObject({ ok: true, replaced: 4 })
    expect(bodyTexts(session.doc())).toEqual(['배와 배 그리고 배', '또 다른 배'])
    expect(session.undo()).toBe(true)
    expect(bodyTexts(session.doc())).toEqual(['사과와 사과 그리고 사과', '또 다른 사과'])
  })

  it('skips matches spanning an inline equation or footnote mark and preserves objects on adjacent replace', () => {
    const doc = makeDoc(['앞단어뒤단어와 뒤단어', '가나다라'])

    // Insert an inline equation between '앞단어' (0..3) and '뒤단어' (3..6)
    const eq = JSON.parse(doc.insertEquation(0, 0, 3, 'a^2 + b^2 = c^2'))
    expect(eq.ok).toBe(true)

    // Insert a footnote mark between '가나' (0..2) and '다라' (2..4)
    const fn = JSON.parse(doc.insertFootnote(0, 1, 2))
    expect(fn.ok).toBe(true)

    // Match spanning equation: '단어뒤'
    const eqFound = findMatches(doc, { query: '단어뒤' })
    expect(eqFound.ok).toBe(true)
    if (!eqFound.ok) return
    expect(eqFound.total).toBe(1)
    expect(eqFound.matches[0]!.spansObject).toBe(true)

    const eqRep = replaceFindMatches(doc, { query: '단어뒤' }, '바뀜', 'all')
    expect(eqRep).toMatchObject({ ok: true, replaced: 0, skippedObjects: 1, skippedCitations: 0 })
    expect(bodyTexts(doc)[0]).toBe('앞단어뒤단어와 뒤단어')
    // Equation is still intact
    expect(JSON.parse(doc.getEquationProperties(0, 0, eq.controlIdx, -1, -1)).script).toBe(
      'a^2 + b^2 = c^2',
    )

    // Match spanning footnote mark: '나다'
    const fnFound = findMatches(doc, { query: '나다' })
    expect(fnFound.ok && fnFound.matches[0]!.spansObject).toBe(true)
    const fnRep = replaceFindMatches(doc, { query: '나다' }, '바뀜', 'all')
    expect(fnRep).toMatchObject({ ok: true, replaced: 0, skippedObjects: 1 })
    expect(bodyTexts(doc)[1]).toBe('가나다라')

    // Match immediately following the equation ('뒤단어' at offset 3) IS replaced and stays AFTER the equation
    const afterEqRep = replaceFindMatches(doc, { query: '뒤단어' }, '새말', 'all')
    expect(afterEqRep).toMatchObject({ ok: true, replaced: 2, skippedObjects: 0 })
    expect(bodyTexts(doc)[0]).toBe('앞단어새말와 새말')
    // Equation remains between '앞단어' (len 3) and '새말' (offset 3 -> logical 3, offset 4 -> logical 5)
    expect(doc.textToLogicalOffset(0, 0, 3)).toBe(3)
    expect(doc.textToLogicalOffset(0, 0, 4)).toBe(5)
  })

  it('skips matches overlapping an app citation (인용:) bookmark range while replacing outside text', () => {
    const doc = makeDoc(['김철수 (김철수, 2024) 연구와 김철수 (박영희, 2025) 참고'])

    // Citation 1: start/end suffixed pair covering '(김철수, 2024)' at [4, 15)
    doc.addBookmark(0, 0, 4, '인용:c1:start')
    doc.addBookmark(0, 0, 15, '인용:c1:end')

    // Citation 2: underscore-suffixed pair covering '(박영희, 2025)' at [24, 35)
    doc.addBookmark(0, 0, 24, '인용:c2_start')
    doc.addBookmark(0, 0, 35, '인용:c2_end')

    const found = findMatches(doc, { query: '김철수' })
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.total).toBe(3)
    expect(found.matches.map((m) => Boolean(m.inCitation))).toEqual([false, true, false])

    const rep = replaceFindMatches(doc, { query: '김철수' }, '이영수', 'all')
    expect(rep).toMatchObject({ ok: true, replaced: 2, skippedObjects: 0, skippedCitations: 1 })
    // The citation '(김철수, 2024)' is untouched; both occurrences outside it are replaced
    expect(bodyTexts(doc)[0]).toBe('이영수 (김철수, 2024) 연구와 이영수 (박영희, 2025) 참고')

    // Second citation pair also protects its text
    const rep2 = replaceFindMatches(doc, { query: '박영희' }, '최민수', 'all')
    expect(rep2).toMatchObject({ ok: true, replaced: 0, skippedCitations: 1 })
    expect(bodyTexts(doc)[0]).toContain('(박영희, 2025)')
  })

  it('replaces text inside footnotes and endnotes while preserving automatic number prefixes', () => {
    const doc = makeDoc(['본문 문장입니다.'])
    const fn = JSON.parse(doc.insertFootnote(0, 0, 4))
    expect(fn.ok).toBe(true)
    doc.insertTextInFootnote(0, 0, fn.controlIdx, 0, 2, '초판 자료와 초판 해설')
    // Split right before '와' (index 5 in '초판 자료와 초판 해설') -> para 0: '초판 자료', para 1: '와 초판 해설'
    doc.splitParagraphInFootnote(0, 0, fn.controlIdx, 0, 2 + 5)

    // Searching spaces must NOT match inside the [0, prefix) auto-number region of para 0
    const spaceSearch = findMatches(doc, { query: '  ' })
    expect(spaceSearch.ok).toBe(true)
    if (spaceSearch.ok) expect(spaceSearch.total).toBe(0)

    const rep = replaceFindMatches(doc, { query: '초판' }, '개정판', 'all')
    expect(rep).toMatchObject({ ok: true, replaced: 2, skippedObjects: 0, skippedCitations: 0 })

    const info = JSON.parse(doc.getFootnoteInfo(0, 0, fn.controlIdx))
    expect(info.numberSlot).not.toBe(-1)
    expect(info.texts[0].slice(2)).toBe('개정판 자료')
    expect(info.texts[1]).toBe('와 개정판 해설')
  })

  it('replaces across body, table, nested table, textbox, footnote, and endnote in a single transaction', () => {
    const doc = makeDoc(['본문 초안', ''])
    const shape = JSON.parse(
      doc.createShapeControl(
        JSON.stringify({
          sectionIdx: 0,
          paraIdx: 0,
          charOffset: 0,
          width: 12000,
          height: 5000,
          horzOffset: 0,
          vertOffset: 0,
          treatAsChar: false,
          textWrap: 'Square',
          shapeType: 'textbox',
        }),
      ),
    )
    const tbPath = JSON.stringify([
      { controlIndex: shape.controlIdx, cellIndex: 0, cellParaIndex: 0 },
    ])
    doc.insertTextInCellByPath(0, shape.paraIdx, tbPath, 0, '상자 초안')

    const fn = JSON.parse(doc.insertFootnote(0, 0, 5))
    doc.insertTextInFootnote(0, 0, fn.controlIdx, 0, 2, '각주 초안')

    doc.pasteHtml(0, 1, 0, '<table><tr><td>외부 초안</td></tr></table>')
    const outerPath = JSON.stringify([{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }])
    const nested = JSON.parse(
      doc.createTableInCellByPath(
        0,
        1,
        outerPath,
        doc.getCellParagraphLengthByPath(0, 1, outerPath),
        JSON.stringify({ rowCount: 1, colCount: 1 }),
      ),
    )
    const nestedPath = JSON.stringify(nested.cellPath)
    doc.insertTextInCellByPath(0, 1, nestedPath, 0, '내부 초안')

    const en = JSON.parse(doc.insertEndnote(0, 0, 5))
    doc.insertTextInFootnote(0, 0, en.controlIdx, 0, 2, '미주 초안')

    const session = withHistory(doc)
    const rep = session.transaction((d) =>
      replaceFindMatches(d, { query: '초안' }, '최종본', 'all'),
    )
    expect(rep).toMatchObject({ ok: true, replaced: 6, skippedObjects: 0, skippedCitations: 0 })

    const after = findMatches(session.doc(), { query: '최종본' })
    expect(after.ok && after.total).toBe(6)
    const leftover = findMatches(session.doc(), { query: '초안' })
    expect(leftover.ok && leftover.total).toBe(0)

    // Single undo restores all 6 occurrences across all 4 scopes
    expect(session.undo()).toBe(true)
    const restored = findMatches(session.doc(), { query: '초안' })
    expect(restored.ok && restored.total).toBe(6)
  })
})

describe('revealFindMatch — studio cursor navigation', () => {
  function makeServices(
    opts: {
      withEnterFootnote?: boolean
      alreadyInNote?: { sec: number; para: number; ctrl: number }
    } = {},
  ) {
    const calls: Array<{ fn: string; args: unknown[] }> = []
    let inFn = Boolean(opts.alreadyInNote)
    const cursor: Record<string, unknown> = {
      fnSectionIdx: opts.alreadyInNote?.sec ?? 0,
      fnParaIdx: opts.alreadyInNote?.para ?? 0,
      fnControlIdx: opts.alreadyInNote?.ctrl ?? 0,
      isInFootnote: () => inFn,
      exitFootnote: vi.fn(() => {
        inFn = false
        calls.push({ fn: 'exitFootnote', args: [] })
      }),
      clearSelection: vi.fn(() => calls.push({ fn: 'clearSelection', args: [] })),
      moveTo: vi.fn((pos: unknown) => calls.push({ fn: 'moveTo', args: [pos] })),
      setAnchor: vi.fn(() => calls.push({ fn: 'setAnchor', args: [] })),
      setFnCursorPosition: vi.fn((p: number, o: number) =>
        calls.push({ fn: 'setFnCursorPosition', args: [p, o] }),
      ),
      setFnAnchor: vi.fn(() => calls.push({ fn: 'setFnAnchor', args: [] })),
    }
    if (opts.withEnterFootnote) {
      cursor.enterFootnote = vi.fn((...args: unknown[]) => {
        inFn = true
        calls.push({ fn: 'enterFootnote', args })
      })
    }
    const input = {
      cursor,
      updateCaret: vi.fn(() => calls.push({ fn: 'updateCaret', args: [] })),
      wasm: {
        getNoteEditInfo: vi.fn(() => ({
          ok: true,
          kind: 'footnote',
          pageNum: 1,
          footnoteIndex: 2,
          fnParaIndex: 0,
          charOffset: 2,
        })),
      },
    }
    const services = {
      getInputHandler: () => input,
      wasm: input.wasm,
    }
    return { services, calls, cursor, input }
  }

  it('moves and selects in body, table cell, nested table cell, and textbox', () => {
    const bodyMatch: FindMatch = {
      index: 0,
      kind: 'body',
      sec: 0,
      para: 2,
      offset: 4,
      length: 3,
      matchText: '연구자',
      beforeText: '',
      afterText: '',
      page: 1,
    }
    const s1 = makeServices()
    expect(revealFindMatch(s1.services, bodyMatch)).toEqual({ ok: true })
    expect(s1.calls).toEqual([
      { fn: 'clearSelection', args: [] },
      { fn: 'moveTo', args: [{ sectionIndex: 0, paragraphIndex: 2, charOffset: 4 }] },
      { fn: 'setAnchor', args: [] },
      { fn: 'moveTo', args: [{ sectionIndex: 0, paragraphIndex: 2, charOffset: 7 }] },
      { fn: 'updateCaret', args: [] },
    ])

    const nestedMatch: FindMatch = {
      index: 1,
      kind: 'table',
      sec: 0,
      para: 1,
      path: [
        { controlIndex: 0, cellIndex: 2, cellParaIndex: 1 },
        { controlIndex: 0, cellIndex: 0, cellParaIndex: 0 },
      ],
      offset: 1,
      length: 2,
      matchText: '연구',
      beforeText: '',
      afterText: '',
      page: 1,
    }
    const s2 = makeServices()
    expect(revealFindMatch(s2.services, nestedMatch)).toEqual({ ok: true })
    expect(s2.calls[1]).toEqual({
      fn: 'moveTo',
      args: [
        {
          sectionIndex: 0,
          paragraphIndex: 1,
          charOffset: 1,
          parentParaIndex: 1,
          controlIndex: 0,
          cellIndex: 2,
          cellParaIndex: 1,
          cellPath: nestedMatch.path,
        },
      ],
    })

    const tbMatch: FindMatch = {
      index: 2,
      kind: 'textbox',
      sec: 0,
      para: 0,
      path: [{ controlIndex: 2, cellIndex: 0, cellParaIndex: 0 }],
      offset: 3,
      length: 2,
      matchText: '상자',
      beforeText: '',
      afterText: '',
      page: 1,
    }
    const s3 = makeServices()
    expect(revealFindMatch(s3.services, tbMatch)).toEqual({ ok: true })
    expect(s3.calls[1]).toEqual({
      fn: 'moveTo',
      args: [
        {
          sectionIndex: 0,
          paragraphIndex: 0,
          charOffset: 3,
          parentParaIndex: 0,
          controlIndex: 2,
          cellIndex: 0,
          cellParaIndex: 0,
          isTextBox: true,
        },
      ],
    })
  })

  it('enters footnote mode when enterFootnote exists, and falls back to body anchor otherwise', () => {
    const fnMatch: FindMatch = {
      index: 0,
      kind: 'footnote',
      sec: 0,
      para: 3,
      noteControl: 1,
      notePara: 0,
      noteNumber: 1,
      anchorOffset: 6,
      offset: 5,
      length: 2,
      matchText: '연구',
      beforeText: '각주 ',
      afterText: '',
      page: 2,
    }

    const withEnter = makeServices({ withEnterFootnote: true })
    expect(revealFindMatch(withEnter.services, fnMatch)).toEqual({ ok: true, enteredNote: true })
    expect(withEnter.calls.map((c) => c.fn)).toEqual([
      'enterFootnote',
      'clearSelection',
      'setFnCursorPosition',
      'setFnAnchor',
      'setFnCursorPosition',
      'updateCaret',
    ])
    expect(withEnter.calls[2]!.args).toEqual([0, 5])
    expect(withEnter.calls[4]!.args).toEqual([0, 7])

    const fallback = makeServices({ withEnterFootnote: false })
    expect(revealFindMatch(fallback.services, fnMatch)).toEqual({ ok: true, enteredNote: false })
    expect(fallback.calls).toEqual([
      { fn: 'clearSelection', args: [] },
      { fn: 'moveTo', args: [{ sectionIndex: 0, paragraphIndex: 3, charOffset: 6 }] },
      { fn: 'updateCaret', args: [] },
    ])

    const alreadyIn = makeServices({
      withEnterFootnote: false,
      alreadyInNote: { sec: 0, para: 3, ctrl: 1 },
    })
    expect(revealFindMatch(alreadyIn.services, fnMatch)).toEqual({ ok: true, enteredNote: true })
    expect(alreadyIn.calls.map((c) => c.fn)).toEqual([
      'clearSelection',
      'setFnCursorPosition',
      'setFnAnchor',
      'setFnCursorPosition',
      'updateCaret',
    ])
  })
})

describe('findMatches & replaceFindMatches — target verification, non-body object skipping, and scope notices', () => {
  it('matches replacement targets by location and text instead of raw index, skipping stale targets', () => {
    const doc = makeDoc(['가나다 연구 가나다', '둘째 연구 문장'])
    const found = findMatches(doc, { query: '연구' })
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.matches).toHaveLength(2)

    // Edit paragraph 0 before replacing, invalidating target 0 while target 1 remains valid.
    doc.replaceText(0, 0, 4, 2, '바뀜')

    const res = replaceFindMatches(doc, { query: '연구' }, '수정', {
      targets: [found.matches[0], found.matches[1]],
    })
    expect(res).toMatchObject({
      ok: true,
      replaced: 1,
      skippedObjects: 0,
      skippedCitations: 0,
      skippedStale: 1,
    })
    expect(bodyTexts(doc)).toEqual(['가나다 바뀜 가나다', '둘째 수정 문장'])
  })

  it('skips matches spanning inline char-overlap objects inside table cells', () => {
    const doc = makeDoc(['머리', ''])
    doc.pasteHtml(0, 1, 0, '<table><tr><td>가나다라마</td><td>가나다라마</td></tr></table>')
    const cell0 = JSON.stringify([{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }])
    const cell1 = JSON.stringify([{ controlIndex: 0, cellIndex: 1, cellParaIndex: 0 }])
    // Insert a real inline char-overlap control inside cell 0 between '나'(1) and '다'(2)
    doc.insertCharOverlapByPath(
      0,
      1,
      cell0,
      2,
      JSON.stringify({ text: '1', shape: 1, innerSize: 0, overlap: true }),
    )

    const found = findMatches(doc, { query: '나다라' })
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.matches).toHaveLength(2)
    expect(found.matches[0].kind).toBe('table')
    expect(found.matches[0].spansObject).toBe(true)
    expect(found.matches[1].kind).toBe('table')
    expect(found.matches[1].spansObject).toBeUndefined()

    const rep = replaceFindMatches(doc, { query: '나다라' }, '변경', 'all')
    expect(rep).toMatchObject({ ok: true, replaced: 1, skippedObjects: 1, skippedCitations: 0 })
    // Cell 0 (spanning overlap) stays untouched; cell 1 is replaced
    expect(
      doc.getTextInCellByPath(0, 1, cell0, 0, doc.getCellParagraphLengthByPath(0, 1, cell0)),
    ).toBe('가나다라마')
    expect(
      doc.getTextInCellByPath(0, 1, cell1, 0, doc.getCellParagraphLengthByPath(0, 1, cell1)),
    ).toBe('가변경마')
  })

  it('filters text boxes by paragraph style and reports unsupported scopes for nested tables and notes', () => {
    const doc = makeDoc(['본문 연구', ''])
    const styles = JSON.parse(doc.getStyleList()) as Array<{ id: number; name: string }>
    const g1 = styles.find((s) => s.name === '개요 1')!.id
    doc.applyStyle(0, 0, g1)

    // Text box styled with 개요 1
    const shape = JSON.parse(
      doc.createShapeControl(
        JSON.stringify({
          sectionIdx: 0,
          paraIdx: 0,
          charOffset: 0,
          width: 12000,
          height: 5000,
          horzOffset: 0,
          vertOffset: 0,
          treatAsChar: false,
          textWrap: 'Square',
          shapeType: 'textbox',
        }),
      ),
    ) as { ok: boolean; paraIdx: number; controlIdx: number }
    expect(shape.ok).toBe(true)
    const tbPath = JSON.stringify([
      { controlIndex: shape.controlIdx, cellIndex: 0, cellParaIndex: 0 },
    ])
    doc.insertTextInCellByPath(0, shape.paraIdx, tbPath, 0, '글상자 연구')
    doc.applyCellStyle(0, shape.paraIdx, shape.controlIdx, 0, 0, g1)

    // Nested table + footnote
    doc.pasteHtml(0, 1, 0, '<table><tr><td>외부</td></tr></table>')
    const outerCell = JSON.stringify([{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }])
    const nested = JSON.parse(
      doc.createTableInCellByPath(
        0,
        1,
        outerCell,
        doc.getCellParagraphLengthByPath(0, 1, outerCell),
        JSON.stringify({ rowCount: 1, colCount: 1 }),
      ),
    ) as { ok: boolean; cellPath: unknown[] }
    expect(nested.ok).toBe(true)
    doc.insertTextInCellByPath(0, 1, JSON.stringify(nested.cellPath), 0, '중첩 연구')

    const fn = JSON.parse(doc.insertFootnote(0, 0, 2)) as { ok: boolean; controlIdx: number }
    expect(fn.ok).toBe(true)
    doc.insertTextInFootnote(0, 0, fn.controlIdx, 0, 2, '각주 연구')

    const res = findMatches(doc, { query: '연구', style: '개요 1' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.matches.map((m) => [m.kind, m.matchText])).toEqual([
      ['body', '연구'],
      ['textbox', '연구'],
    ])
    expect(res.unsupportedScopes).toEqual(['nested_table', 'footnote'])
  })
})
