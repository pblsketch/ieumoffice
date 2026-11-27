/**
 * Document citations, bibliography block, pattern citation finder, six audit checks,
 * style switching, staleness integration, and HWP/HWPX roundtrip tests against the
 * real `@rhwp/core` engine.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import {
  MARK_PREFIXES,
  SUBMISSION_STRIP_PREFIXES,
  addRangeMark,
  findRangeMarks,
  listMarks,
} from '../studio-plugin/doc-marks.mjs'
import {
  normalizeBibEntry,
  renameBibEntryKey,
  type BibEntry,
} from '../studio-plugin/citation-styles.mjs'
import {
  BIB_SETTING_KEY,
  CIT_STYLE_SETTING_KEY,
  auditCitations,
  checkBibliographyStaleness,
  detectBibliographyManualEdits,
  detectUnmarkedBibliography,
  findPatternCitations,
  getDocumentCitationStyle,
  insertBibliographyBlock,
  insertCitation,
  listCitationMarks,
  refreshBibliographyBlock,
  rewriteCitationKeys,
  setDocumentCitationStyle,
  switchCitationStyle,
} from '../studio-plugin/citations.mjs'
import { findMatches, replaceFindMatches } from '../studio-plugin/find.mjs'
import { buildSubmissionCopy, defaultStalenessRegistry } from '../studio-plugin/staleness.mjs'

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

function makeSampleEntries(): BibEntry[] {
  return [
    normalizeBibEntry({
      key: '홍길동2020',
      type: 'article',
      authors: ['홍길동'],
      year: '2020',
      title: '인공지능 교육의 현황과 과제',
      containerTitle: '한국교육학연구',
      volume: '26',
      issue: '2',
      pages: '1-25',
      language: 'ko',
      verified: true,
    }),
    normalizeBibEntry({
      key: '김철수2019',
      type: 'book',
      authors: ['김철수', '이영희'],
      year: '2019',
      title: '데이터 과학 입문',
      publisher: '학술출판사',
      place: '서울',
      language: 'ko',
      verified: true,
    }),
    normalizeBibEntry({
      key: 'smith2021',
      type: 'article',
      authors: [
        { family: 'Smith', given: 'John' },
        { family: 'Doe', given: 'Jane' },
      ],
      year: '2021',
      title: 'Deep learning methods for document analysis',
      containerTitle: 'Journal of Computational Studies',
      volume: '14',
      issue: '3',
      pages: '101-120',
      language: 'en',
      verified: true,
    }),
    normalizeBibEntry({
      key: 'smith2021b',
      type: 'article',
      authors: [
        { family: 'Smith', given: 'John' },
        { family: 'Doe', given: 'Jane' },
      ],
      year: '2021',
      title: 'Structured layout evaluation in academic texts',
      containerTitle: 'Journal of Computational Studies',
      volume: '14',
      issue: '4',
      pages: '200-215',
      language: 'en',
      verified: true,
    }),
    normalizeBibEntry({
      key: 'unverified2024',
      type: 'article',
      authors: ['박미확인'],
      year: '2024',
      title: '미확인 초안 논문',
      containerTitle: '미확인학회지',
      language: 'ko',
      verified: false,
    }),
  ]
}

describe('document citation style & citation mark insertion', () => {
  it('defaults to apa and persists style in 설정:인용꼴', () => {
    const doc = makeDoc(['서론 문단입니다.'])
    try {
      expect(getDocumentCitationStyle(doc)).toBe('apa')
      const bad = setDocumentCitationStyle(doc, 'unknown' as never)
      expect(bad.ok).toBe(false)

      const ok = setDocumentCitationStyle(doc, 'ieee')
      expect(ok).toEqual({ ok: true, style: 'ieee' })
      expect(getDocumentCitationStyle(doc)).toBe('ieee')

      const settingMarks = listMarks(doc, [MARK_PREFIXES.setting])
      expect(settingMarks.some((m) => m.name.includes(CIT_STYLE_SETTING_KEY))).toBe(true)
    } finally {
      doc.free()
    }
  })

  it('inserts parenthetical, narrative, locator, and grouped multi-entry citations wrapped in 인용: start/end marks skipped by find.mjs replace', () => {
    const entries = makeSampleEntries()
    const doc = makeDoc([
      '선행 연구는 중요하다.',
      '는 핵심 결과를 제시하였다.',
      '복수 문헌을 함께 인용한다.',
    ])
    try {
      // 1. Parenthetical with locator
      const p1Len = doc.getParagraphLength(0, 0)
      const r1 = insertCitation(doc, {
        entries,
        items: [{ key: '홍길동2020', locator: '23' }],
        mode: 'parenthetical',
        place: { sec: 0, para: 0, offset: p1Len - 1 },
      })
      expect(r1.ok).toBe(true)
      if (!r1.ok || !r1.marked) return
      expect(r1.text).toBe('(홍길동, 2020, 23쪽)')
      expect(paraText(doc, 0, 0)).toBe('선행 연구는 중요하다(홍길동, 2020, 23쪽).')

      // 2. Narrative citation
      const r2 = insertCitation(doc, {
        entries,
        items: [{ key: '김철수2019' }],
        mode: 'narrative',
        place: { sec: 0, para: 1, offset: 0 },
      })
      expect(r2.ok).toBe(true)
      if (!r2.ok || !r2.marked) return
      expect(r2.text).toBe('김철수, 이영희(2019)')
      expect(paraText(doc, 0, 1)).toBe('김철수, 이영희(2019)는 핵심 결과를 제시하였다.')

      // 3. Multi-entry grouped citation
      const p3Len = doc.getParagraphLength(0, 2)
      const r3 = insertCitation(doc, {
        entries,
        items: [{ key: 'smith2021' }, { key: '홍길동2020' }],
        mode: 'parenthetical',
        place: { sec: 0, para: 2, offset: p3Len - 1 },
      })
      expect(r3.ok).toBe(true)
      if (!r3.ok || !r3.marked) return
      expect(r3.text).toBe('(홍길동, 2020; Smith & Doe, 2021)')

      // Verify paired 인용: range marks exist and listCitationMarks reads all 3 cleanly.
      const { ranges, broken } = findRangeMarks(doc, [MARK_PREFIXES.citation])
      expect(broken).toEqual([])
      expect(ranges).toHaveLength(3)

      const marks = listCitationMarks(doc, entries)
      expect(marks).toHaveLength(3)
      expect(marks[0]?.isManuallyEdited).toBe(false)
      expect(marks[2]?.keys).toEqual(['smith2021', '홍길동2020'])

      // Verify find.mjs recognizes our 인용: ranges and skips them on replaceFindMatches!
      const found = findMatches(doc, { query: '홍길동' })
      expect(found.ok).toBe(true)
      if (!found.ok) return
      expect(found.matches.length).toBeGreaterThanOrEqual(2)
      expect(found.matches.every((m) => m.inCitation === true)).toBe(true)

      const rep = replaceFindMatches(doc, { query: '홍길동' }, '다른이름', 'all')
      expect(rep.ok).toBe(true)
      if (!rep.ok) return
      expect(rep.replaced).toBe(0)
      expect(rep.skippedCitations).toBe(2)
      expect(paraText(doc, 0, 0)).toContain('(홍길동, 2020, 23쪽)')
    } finally {
      doc.free()
    }
  })

  it('inserts plain text ONLY (zero bookmarks) inside table cells and footnotes', () => {
    const entries = makeSampleEntries()
    const doc = makeDoc(['표 아래 본문', '각주 본문'])
    try {
      // Create a 1x2 table in paragraph 0.
      const createdTbl = JSON.parse(
        doc.createTableEx(
          JSON.stringify({
            sectionIdx: 0,
            paraIdx: 0,
            charOffset: 0,
            rowCount: 1,
            colCount: 2,
            treatAsChar: true,
          }),
        ),
      ) as { ok: boolean; controlIdx?: number }
      expect(createdTbl.ok).toBe(true)
      const tblCtrl = createdTbl.controlIdx ?? 0
      doc.insertTextInCell(0, 0, tblCtrl, 0, 0, 0, '셀 참고: ')

      // Create a footnote in paragraph 1.
      const fnRes = JSON.parse(doc.insertFootnote(0, 1, 2)) as {
        ok: boolean
        controlIdx?: number
      }
      expect(fnRes.ok).toBe(true)
      const fnControls = (
        JSON.parse(doc.getControls()) as Array<{
          list: number
          para: number
          ctrlId: string
          controlIndex: number
        }>
      ).filter((c) => c.list === 0 && c.para === 1 && c.ctrlId === 'fn')
      expect(fnControls.length).toBe(1)
      const fnCtrl = fnControls[0]!.controlIndex

      const marksBefore = listMarks(doc, [MARK_PREFIXES.citation])
      expect(marksBefore).toEqual([])

      // Insert into table cell.
      const cellRes = insertCitation(doc, {
        entries,
        items: [{ key: '홍길동2020' }],
        place: {
          kind: 'table',
          sec: 0,
          para: 0,
          path: [{ controlIndex: tblCtrl, cellIndex: 0, cellParaIndex: 0 }],
        },
      })
      expect(cellRes.ok).toBe(true)
      if (!cellRes.ok) return
      expect(cellRes.marked).toBe(false)
      expect(cellRes.placeKind).toBe('table')
      expect(cellRes.text).toBe('(홍길동, 2020)')

      const cellLen = doc.getCellParagraphLength(0, 0, tblCtrl, 0, 0)
      expect(doc.getTextInCell(0, 0, tblCtrl, 0, 0, 0, cellLen)).toBe('셀 참고: (홍길동, 2020)')

      // Insert into footnote.
      const noteRes = insertCitation(doc, {
        entries,
        items: [{ key: 'smith2021' }],
        place: {
          kind: 'footnote',
          sec: 0,
          para: 1,
          noteControl: fnCtrl,
          notePara: 0,
        },
      })
      expect(noteRes.ok).toBe(true)
      if (!noteRes.ok) return
      expect(noteRes.marked).toBe(false)
      expect(noteRes.placeKind).toBe('footnote')
      expect(noteRes.text).toBe('(Smith & Doe, 2021)')

      // Confirm ZERO citation bookmarks were added.
      expect(listMarks(doc, [MARK_PREFIXES.citation])).toEqual([])

      // Confirm findPatternCitations discovers BOTH the table cell and footnote citations!
      const patterns = findPatternCitations(doc, entries)
      expect(
        patterns.some((p) => p.kind === 'table' && p.parsedRefs[0]?.matchedKey === '홍길동2020'),
      ).toBe(true)
      expect(
        patterns.some((p) => p.kind === 'footnote' && p.parsedRefs[0]?.matchedKey === 'smith2021'),
      ).toBe(true)
    } finally {
      doc.free()
    }
  })

  it('strictly refuses unverified entries and missing entries without mutating the document', () => {
    const entries = makeSampleEntries()
    const doc = makeDoc(['원본 본문'])
    try {
      const unv = insertCitation(doc, {
        entries,
        items: [{ key: 'unverified2024' }],
        place: { sec: 0, para: 0, offset: 5 },
      })
      expect(unv.ok).toBe(false)
      if (!unv.ok) {
        expect(unv.reason).toBe('unverified_entry')
        expect(unv.unverifiedKeys).toEqual(['unverified2024'])
      }

      const miss = insertCitation(doc, {
        entries,
        items: [{ key: 'no_such_key' }],
        place: { sec: 0, para: 0, offset: 5 },
      })
      expect(miss.ok).toBe(false)
      if (!miss.ok) {
        expect(miss.reason).toBe('missing_entry')
        expect(miss.missingKeys).toEqual(['no_such_key'])
      }

      expect(paraText(doc, 0, 0)).toBe('원본 본문')
      expect(listMarks(doc, [MARK_PREFIXES.citation])).toEqual([])
    } finally {
      doc.free()
    }
  })

  it('rewrites old keys via rewriteCitationKeys when library keys are renamed', () => {
    const entries = makeSampleEntries()
    const doc = makeDoc(['첫 인용 문단.'])
    try {
      const ins = insertCitation(doc, {
        entries,
        items: [{ key: '홍길동2020' }],
        place: { sec: 0, para: 0, offset: 6 },
      })
      expect(ins.ok).toBe(true)

      const renamed = renameBibEntryKey(entries[0]!, 'hong_ai_2020')
      expect(renamed.ok).toBe(true)
      if (!renamed.ok) return
      const nextEntries = [renamed.entry, ...entries.slice(1)]

      const rw = rewriteCitationKeys(doc, { 홍길동2020: 'hong_ai_2020' }, nextEntries)
      expect(rw).toEqual({ ok: true, updated: 1 })

      const marks = listCitationMarks(doc, nextEntries)
      expect(marks).toHaveLength(1)
      expect(marks[0]?.items[0]?.key).toBe('hong_ai_2020')
      expect(marks[0]?.items[0]?.resolvedKey).toBe('hong_ai_2020')
    } finally {
      doc.free()
    }
  })
})

describe('style switching (APA -> IEEE -> Chicago -> MLA -> APA) and manual edit preservation', () => {
  it('rewrites marked citations across styles, skips manually edited marks, renumbers IEEE, and refreshes bibliography', () => {
    const entries = makeSampleEntries()
    const doc = makeDoc(['첫 문장이다.', '둘째 문장이다.', '셋째 문장이다.'])
    try {
      // Insert 3 citations in APA.
      expect(
        insertCitation(doc, {
          entries,
          items: [{ key: 'smith2021', locator: '10' }],
          place: { sec: 0, para: 0, offset: 5 },
        }).ok,
      ).toBe(true)
      expect(
        insertCitation(doc, {
          entries,
          items: [{ key: '홍길동2020' }],
          place: { sec: 0, para: 1, offset: 5 },
        }).ok,
      ).toBe(true)
      expect(
        insertCitation(doc, {
          entries,
          items: [{ key: '김철수2019' }],
          place: { sec: 0, para: 2, offset: 5 },
        }).ok,
      ).toBe(true)

      const bibRes = insertBibliographyBlock(doc, entries)
      expect(bibRes.ok).toBe(true)

      // Manually edit the third citation text inside its 인용: range!
      const marksBefore = listCitationMarks(doc, entries)
      const third = marksBefore[2]!
      doc.insertText(third.sec, third.para, third.startOffset + 1, '직접수정 ')

      // Switch APA -> IEEE
      const toIeee = switchCitationStyle(doc, 'ieee', entries)
      expect(toIeee.ok).toBe(true)
      if (!toIeee.ok) return
      expect(toIeee.style).toBe('ieee')
      expect(toIeee.updatedCitations).toBe(2)
      expect(toIeee.skippedManual).toHaveLength(1)
      expect(toIeee.skippedManual[0]?.id).toBe(third.id)
      expect(toIeee.bibliographyRefreshed).toBe(true)
      expect(getDocumentCitationStyle(doc)).toBe('ieee')

      expect(paraText(doc, 0, 0)).toContain('[1, p. 10]')
      expect(paraText(doc, 0, 1)).toContain('[2]')
      // Manual citation left untouched!
      expect(paraText(doc, 0, 2)).toContain('직접수정')

      // Insert a brand-new IEEE citation BEFORE para 0's citation -> shifts [1]->[2], [2]->[3]!
      const earlyIeee = insertCitation(doc, {
        entries,
        items: [{ key: 'smith2021b' }],
        place: { sec: 0, para: 0, offset: 0 },
      })
      expect(earlyIeee.ok).toBe(true)
      if (!earlyIeee.ok || !earlyIeee.marked) return
      expect(earlyIeee.text).toBe('[1]')
      expect(earlyIeee.renumbered).toBe(2)
      expect(paraText(doc, 0, 0)).toContain('[2, p. 10]')
      expect(paraText(doc, 0, 1)).toContain('[3]')

      // Switch IEEE -> Chicago
      const toChicago = switchCitationStyle(doc, 'chicago', entries)
      expect(toChicago.ok).toBe(true)
      if (!toChicago.ok) return
      expect(toChicago.skippedManual).toHaveLength(1)
      expect(paraText(doc, 0, 0)).toContain('(Smith and Doe 2021a, 10)')

      // Switch Chicago -> MLA
      const toMla = switchCitationStyle(doc, 'mla', entries)
      expect(toMla.ok).toBe(true)
      if (!toMla.ok) return
      expect(paraText(doc, 0, 0)).toContain('(Smith and Doe 10)')

      // Switch MLA -> APA
      const backApa = switchCitationStyle(doc, 'apa', entries)
      expect(backApa.ok).toBe(true)
      if (!backApa.ok) return
      expect(paraText(doc, 0, 0)).toContain('(Smith & Doe, 2021a, p. 10)')
      expect(paraText(doc, 0, 1)).toContain('(홍길동, 2020)')
      // Manual edit STILL preserved across all 4 switches!
      expect(paraText(doc, 0, 2)).toContain('직접수정')
    } finally {
      doc.free()
    }
  })
})

describe('bibliography block: insert, refresh, missing-key preservation, unmarked detection, manual edits, multi-section refusal', () => {
  it('inserts bibliography with hanging indent and preserves entries missing from library on refresh', () => {
    const entries = makeSampleEntries()
    const doc = makeDoc(['본문 인용이다.'])
    try {
      expect(
        insertCitation(doc, {
          entries,
          items: [{ key: '홍길동2020' }, { key: 'smith2021' }],
          place: { sec: 0, para: 0, offset: 7 },
        }).ok,
      ).toBe(true)

      const ins = insertBibliographyBlock(doc, entries)
      expect(ins.ok).toBe(true)
      if (!ins.ok) return
      expect(ins.count).toBe(2)
      expect(ins.title).toBe('참고문헌')
      expect(ins.range.startName).toBe('참고문헌:시작')
      expect(ins.range.endName).toBe('참고문헌:끝')

      // Korean entry comes before English entry in APA.
      expect(paraText(doc, 0, ins.startPara)).toBe('참고문헌')
      expect(paraText(doc, 0, ins.startPara + 1)).toContain('홍길동(2020)')
      expect(paraText(doc, 0, ins.startPara + 2)).toContain('Smith, J., & Doe, J. (2021)')

      // Simulate refreshing on another machine where `smith2021` is NOT in the local library.
      const partialLibrary = [entries[0]!]
      const refreshed = refreshBibliographyBlock(doc, partialLibrary)
      expect(refreshed.ok).toBe(true)
      if (!refreshed.ok) return
      expect(refreshed.preservedMissingKeys).toEqual(['smith2021'])
      expect(refreshed.count).toBe(2)
      // Preserved line for smith2021 is kept verbatim!
      expect(paraText(doc, 0, refreshed.startPara + 2)).toContain('Smith, J., & Doe, J. (2021)')
    } finally {
      doc.free()
    }
  })

  it('detects manual edits in bibliography and blocks refresh unless allowOverwriteManual is true', () => {
    const entries = makeSampleEntries()
    const doc = makeDoc(['본문 내용.'])
    try {
      expect(
        insertCitation(doc, {
          entries,
          items: [{ key: '홍길동2020' }],
          place: { sec: 0, para: 0, offset: 5 },
        }).ok,
      ).toBe(true)
      const ins = insertBibliographyBlock(doc, entries)
      expect(ins.ok).toBe(true)
      if (!ins.ok) return

      // Edit an entry line manually.
      const entryPara = ins.startPara + 1
      doc.insertText(0, entryPara, 0, '[수동편집] ')

      const manual = detectBibliographyManualEdits(doc)
      expect(manual.hasManualEdits).toBe(true)
      expect(manual.modifiedLines).toHaveLength(1)
      expect(manual.modifiedLines[0]?.para).toBe(entryPara)

      const blocked = refreshBibliographyBlock(doc, entries)
      expect(blocked.ok).toBe(false)
      if (!blocked.ok) {
        expect(blocked.reason).toBe('manual_edits')
      }

      const forced = refreshBibliographyBlock(doc, entries, { allowOverwriteManual: true })
      expect(forced.ok).toBe(true)
      expect(detectBibliographyManualEdits(doc).hasManualEdits).toBe(false)
    } finally {
      doc.free()
    }
  })

  it('detects unmarked bibliography below explicit heading while ignoring user tables', () => {
    const entries = makeSampleEntries()
    // Case 1: User table under a "참고문헌" heading must NEVER be mistaken for bibliography lines.
    const docWithTable = makeDoc(['본문', '참고문헌', ''])
    try {
      docWithTable.createTableEx(
        JSON.stringify({
          sectionIdx: 0,
          paraIdx: 2,
          charOffset: 0,
          rowCount: 2,
          colCount: 2,
          treatAsChar: true,
        }),
      )
      docWithTable.insertTextInCell(0, 2, 0, 0, 0, 0, '홍길동(2020). 표 안의 텍스트')
      expect(detectUnmarkedBibliography(docWithTable)).toEqual({ found: false })
    } finally {
      docWithTable.free()
    }

    // Case 2: Genuine unmarked bibliography lines below "참고문헌" heading.
    const docLegacy = makeDoc([
      '본문 인용이다.',
      '참고문헌',
      '홍길동(2020). 인공지능 교육의 현황과 과제. 한국교육학연구, 26(2), 1-25.',
      '김철수, 이영희(2019). 데이터 과학 입문. 서울: 학술출판사.',
      '부록',
      '부록 본문은 포함되면 안 된다.',
    ])
    try {
      expect(
        insertCitation(docLegacy, {
          entries,
          items: [{ key: '홍길동2020' }],
          place: { sec: 0, para: 0, offset: 7 },
        }).ok,
      ).toBe(true)

      const detected = detectUnmarkedBibliography(docLegacy)
      expect(detected.found).toBe(true)
      if (!detected.found) return
      expect(detected.headingPara).toEqual({ sec: 0, para: 1, text: '참고문헌' })
      expect(detected.range).toEqual({ sec: 0, startPara: 1, endPara: 3 })
      expect(detected.lines).toHaveLength(2)

      // insertBibliographyBlock refuses with legacy_bibliography_found until replaceLegacy: true!
      const blocked = insertBibliographyBlock(docLegacy, entries)
      expect(blocked.ok).toBe(false)
      if (!blocked.ok) {
        expect(blocked.reason).toBe('legacy_bibliography_found')
      }

      const replaced = insertBibliographyBlock(docLegacy, entries, { replaceLegacy: true })
      expect(replaced.ok).toBe(true)
      // Appendix paragraph after the legacy bibliography must stay intact!
      const allParas: string[] = []
      for (let p = 0; p < docLegacy.getParagraphCount(0); p++) {
        allParas.push(paraText(docLegacy, 0, p))
      }
      expect(allParas).toContain('부록')
      expect(allParas).toContain('부록 본문은 포함되면 안 된다.')
    } finally {
      docLegacy.free()
    }
  })

  it('refuses multi-section 참고문헌: range with multi_section_range', () => {
    const entries = makeSampleEntries()
    const doc = makeDoc(['첫 구역 본문', '둘째 구역 본문'])
    try {
      expect(
        insertCitation(doc, {
          entries,
          items: [{ key: '홍길동2020' }],
          place: { sec: 0, para: 0, offset: 6 },
        }).ok,
      ).toBe(true)
      doc.splitSection(0, 1, 0)
      expect(doc.getSectionCount()).toBe(2)

      expect(
        addRangeMark(
          doc,
          MARK_PREFIXES.bibliography,
          '',
          { sec: 0, para: 0, offset: 0 },
          { sec: 1, para: 0, offset: 5 },
        ).ok,
      ).toBe(true)

      const ref = refreshBibliographyBlock(doc, entries)
      expect(ref.ok).toBe(false)
      if (!ref.ok) {
        expect(ref.reason).toBe('multi_section_range')
      }
      const ins = insertBibliographyBlock(doc, entries)
      expect(ins.ok).toBe(false)
      if (!ins.ok) {
        expect(ins.reason).toBe('multi_section_range')
      }
    } finally {
      doc.free()
    }
  })
})

describe('six read-only citation audit checks (auditCitations)', () => {
  it('detects all 6 issue kinds with clickable locations without mutating the document', () => {
    const entries = makeSampleEntries()
    const doc = makeDoc([
      '본문 첫 인용: ',
      '본문 둘째 인용: ',
      '패턴 인용 (박미확인, 2024)과 (알수없음, 2022)이 있다.',
      '참고문헌',
      'Smith, J., & Doe, J. (2021). Deep learning methods for document analysis. Journal of Computational Studies, 14(3), 101-120.',
      '홍길동(2020). 인공지능 교육의 현황과 과제. 한국교육학연구, 26(2), 1-25.',
      '김철수, 이영희(2019). 데이터 과학 입문. 서울: 학술출판사.',
    ])
    try {
      // Mark smith2021 & smith2021b (triggers missing_disambiguation on smith2021 in bib + citation!)
      // and manually edit the first mark (triggers manual_citation_edit!).
      const r1 = insertCitation(doc, {
        entries,
        items: [{ key: 'smith2021' }],
        place: { sec: 0, para: 0, offset: doc.getParagraphLength(0, 0) },
      })
      expect(r1.ok).toBe(true)
      const r2 = insertCitation(doc, {
        entries,
        items: [{ key: 'smith2021b' }],
        place: { sec: 0, para: 1, offset: doc.getParagraphLength(0, 1) },
      })
      expect(r2.ok).toBe(true)
      if (!r1.ok || !r1.marked) return

      // Manually tweak mark #1 text (removes any suffix & triggers manual_citation_edit).
      doc.insertText(0, 0, r1.startOffset + 1, '편집 ')

      const bytesBefore = doc.exportHwpx()
      const report = auditCitations(doc, entries)
      const bytesAfter = doc.exportHwpx()
      expect(bytesAfter).toEqual(bytesBefore)

      expect(report.ok).toBe(true)
      // 1. missing_from_bibliography: smith2021b (not in bib), 박미확인(2024), 알수없음(2022)
      expect(report.counts.missing_from_bibliography).toBeGreaterThanOrEqual(2)
      expect(
        report.issues.some(
          (i) => i.type === 'missing_from_bibliography' && i.key === 'smith2021b' && i.para === 1,
        ),
      ).toBe(true)

      // 2. uncited_in_bibliography: 홍길동2020 and 김철수2019 are in bibliography but never cited
      expect(report.counts.uncited_in_bibliography).toBeGreaterThanOrEqual(2)
      expect(
        report.issues.some((i) => i.type === 'uncited_in_bibliography' && i.key === '김철수2019'),
      ).toBe(true)

      // 3. wrong_sort_order: English Smith placed BEFORE Korean 홍길동 and 김철수!
      expect(report.counts.wrong_sort_order).toBeGreaterThanOrEqual(2)

      // 4. missing_disambiguation: smith2021 & smith2021b share authors+2021, bib line lacks 2021a!
      expect(report.counts.missing_disambiguation).toBeGreaterThanOrEqual(1)
      expect(
        report.issues.some((i) => i.type === 'missing_disambiguation' && i.key === 'smith2021'),
      ).toBe(true)

      // 5. manual_citation_edit: mark #1 was edited
      expect(report.counts.manual_citation_edit).toBe(1)
      expect(
        report.issues.some((i) => i.type === 'manual_citation_edit' && i.sec === 0 && i.para === 0),
      ).toBe(true)

      // 6. unverified_citation: pattern (박미확인, 2024) matches unverified2024
      expect(report.counts.unverified_citation).toBe(1)
      expect(
        report.issues.some(
          (i) =>
            i.type === 'unverified_citation' &&
            i.key === 'unverified2024' &&
            i.sec === 0 &&
            i.para === 2,
        ),
      ).toBe(true)
    } finally {
      doc.free()
    }
  })
})

describe('staleness registry integration & HWP/HWPX roundtrip + submission copy stripping', () => {
  it('detects stale bibliography & IEEE numbering via defaultStalenessRegistry and refreshes cleanly', () => {
    const entries = makeSampleEntries()
    const doc = makeDoc(['첫 문단.', '둘째 문단.'])
    try {
      expect(setDocumentCitationStyle(doc, 'ieee').ok).toBe(true)
      expect(
        insertCitation(doc, {
          entries,
          items: [{ key: '홍길동2020' }],
          place: { sec: 0, para: 0, offset: 4 },
        }).ok,
      ).toBe(true)
      expect(insertBibliographyBlock(doc, entries).ok).toBe(true)

      expect(defaultStalenessRegistry.check(doc, { bibEntries: entries }).stale).toBe(false)

      // Insert a new citation in para 1 -> bibliography becomes stale!
      expect(
        insertCitation(doc, {
          entries,
          items: [{ key: 'smith2021' }],
          place: { sec: 0, para: 1, offset: 4 },
        }).ok,
      ).toBe(true)

      const staleCheck = defaultStalenessRegistry.check(doc, { bibEntries: entries })
      expect(staleCheck.stale).toBe(true)
      expect(staleCheck.items.some((i) => i.id === 'bibliography')).toBe(true)

      // Also verify checkBibliographyStaleness detects staleness even without bibEntries!
      expect(checkBibliographyStaleness(doc).stale).toBe(true)

      const refreshed = defaultStalenessRegistry.refreshAll(doc, { bibEntries: entries })
      expect(refreshed.ok).toBe(true)
      expect(refreshed.refreshed).toBeGreaterThanOrEqual(1)
      expect(defaultStalenessRegistry.check(doc, { bibEntries: entries }).stale).toBe(false)
    } finally {
      doc.free()
    }
  })

  it('survives HWP and HWPX save/reopen roundtrips and strips all citation/bibliography/setting marks in buildSubmissionCopy', () => {
    const entries = makeSampleEntries()
    const doc = makeDoc(['서론에서 선행 연구를 검토한다.'])
    try {
      expect(setDocumentCitationStyle(doc, 'chicago').ok).toBe(true)
      expect(
        insertCitation(doc, {
          entries,
          items: [{ key: '홍길동2020', locator: '15' }],
          place: { sec: 0, para: 0, offset: 15 },
        }).ok,
      ).toBe(true)
      expect(insertBibliographyBlock(doc, entries).ok).toBe(true)

      // Roundtrip both HWP and HWPX.
      for (const format of ['hwpx', 'hwp'] as const) {
        const bytes = format === 'hwp' ? doc.exportHwp() : doc.exportHwpx()
        const reopened = new HwpDocument(bytes)
        try {
          expect(getDocumentCitationStyle(reopened)).toBe('chicago')
          const marks = listCitationMarks(reopened, entries)
          expect(marks).toHaveLength(1)
          expect(marks[0]?.keys).toEqual(['홍길동2020'])
          expect(marks[0]?.items[0]?.locator).toBe('15')
          expect(marks[0]?.isManuallyEdited).toBe(false)

          const bibRanges = findRangeMarks(reopened, [MARK_PREFIXES.bibliography]).ranges
          expect(bibRanges).toHaveLength(1)
          expect(detectBibliographyManualEdits(reopened).hasManualEdits).toBe(false)
          expect(checkBibliographyStaleness(reopened, { bibEntries: entries }).stale).toBe(false)

          // Verify 설정:참고문헌 setting survived roundtrip.
          const settingMarks = listMarks(reopened, [MARK_PREFIXES.setting])
          expect(settingMarks.length).toBeGreaterThan(0)
          expect(
            settingMarks.some((m) => m.name.includes(BIB_SETTING_KEY) || m.name.includes('%c:')),
          ).toBe(true)
        } finally {
          reopened.free()
        }
      }

      // Verify buildSubmissionCopy strips 인용:, 참고문헌:, 설정: cleanly while keeping body text!
      for (const format of ['hwpx', 'hwp'] as const) {
        const sub = buildSubmissionCopy(doc, format, HwpDocument)
        expect(sub.ok).toBe(true)
        if (!sub.ok) continue
        const clean = new HwpDocument(sub.bytes)
        try {
          expect(listMarks(clean, SUBMISSION_STRIP_PREFIXES)).toEqual([])
          expect(paraText(clean, 0, 0)).toContain('(홍길동, 2020, 15쪽)')
        } finally {
          clean.free()
        }
      }
    } finally {
      doc.free()
    }
  })
})
