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

      // Switch Chicago -> MLA (both smith2021 and smith2021b are cited -> MLA short titles apply)
      const toMla = switchCitationStyle(doc, 'mla', entries)
      expect(toMla.ok).toBe(true)
      if (!toMla.ok) return
      expect(paraText(doc, 0, 0)).toContain('(Smith and Doe, "Deep learning methods" 10)')
      expect(paraText(doc, 0, 0)).toContain('(Smith and Doe, "Structured layout evaluation")')

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

describe('PR review regressions: unified IEEE order, disambiguation sync, preserved missing lines, failure propagation, untitled audit, and range guards', () => {
  it('Item #2 Repro 1: manual pattern citation before marked citation stays unified in IEEE body & bibliography and is flagged by auditCitations', () => {
    const entries = makeSampleEntries()
    const doc = makeDoc(['선행 연구 (김철수, 2019)를 먼저 언급한다.', '후속 연구를 인용한다.'])
    try {
      const ins = insertCitation(doc, {
        entries,
        items: [{ key: '홍길동2020' }],
        place: { sec: 0, para: 1, offset: doc.getParagraphLength(0, 1) - 1 },
      })
      expect(ins.ok).toBe(true)
      expect(insertBibliographyBlock(doc, entries).ok).toBe(true)

      const switched = switchCitationStyle(doc, 'ieee', entries)
      expect(switched.ok).toBe(true)
      if (!switched.ok) return
      expect(switched.bibliographyRefreshed).toBe(true)

      // Unified order: 김철수2019 is [1], 홍길동2020 is [2] in BOTH body and bibliography.
      expect(paraText(doc, 0, 1)).toContain('[2]')
      expect(paraText(doc, 0, 1)).not.toContain('[1]')

      const bibRes = switched.bibliographyResult
      expect(bibRes?.ok).toBe(true)
      if (!bibRes || !bibRes.ok) return
      expect(bibRes.keys).toEqual(['김철수2019', '홍길동2020'])
      expect(paraText(doc, 0, bibRes.startPara + 1)).toMatch(/^\[1\]\s*김철수/)
      expect(paraText(doc, 0, bibRes.startPara + 2)).toMatch(/^\[2\]\s*홍길동/)

      // auditCitations flags the un-updated manual pattern citation (김철수, 2019) with clickable location.
      const report = auditCitations(doc, entries)
      const manualStyleIssue = report.issues.find(
        (i) =>
          i.type === 'manual_citation_edit' &&
          i.reason === 'unmarked_style_mismatch' &&
          i.sec === 0 &&
          i.para === 0,
      )
      expect(manualStyleIssue).toBeDefined()
      expect(manualStyleIssue?.key).toBe('김철수2019')
      expect(manualStyleIssue?.expectedText).toBe('[1]')
      expect(manualStyleIssue?.text).toBe('(김철수, 2019)')
    } finally {
      doc.free()
    }
  })

  it('Item #2 Repro 2: IEEE numbering syncs bidirectionally across body marks, table cells, and footnotes', () => {
    const entries = makeSampleEntries()
    // Direction A: marked body citation in para 2 ([1]), then insert earlier citation in table cell in para 0.
    const docA = makeDoc(['표 문단', '중간 문단', '마지막 본문이다.'])
    try {
      expect(setDocumentCitationStyle(docA, 'ieee').ok).toBe(true)
      const createdTbl = JSON.parse(
        docA.createTableEx(
          JSON.stringify({
            sectionIdx: 0,
            paraIdx: 0,
            charOffset: 0,
            rowCount: 1,
            colCount: 1,
            treatAsChar: true,
          }),
        ),
      ) as { ok: boolean; controlIdx?: number }
      expect(createdTbl.ok).toBe(true)
      const tblCtrl = createdTbl.controlIdx ?? 0
      docA.insertTextInCell(0, 0, tblCtrl, 0, 0, 0, '셀 인용: ')

      const bodyIns = insertCitation(docA, {
        entries,
        items: [{ key: '홍길동2020' }],
        place: { sec: 0, para: 2, offset: docA.getParagraphLength(0, 2) - 1 },
      })
      expect(bodyIns.ok).toBe(true)
      expect(paraText(docA, 0, 2)).toContain('[1]')

      const cellIns = insertCitation(docA, {
        entries,
        items: [{ key: '김철수2019' }],
        place: {
          kind: 'table',
          sec: 0,
          para: 0,
          path: [{ controlIndex: tblCtrl, cellIndex: 0, cellParaIndex: 0 }],
        },
      })
      expect(cellIns.ok).toBe(true)
      if (!cellIns.ok) return
      expect(cellIns.marked).toBe(false)
      expect(cellIns.text).toBe('[1]')
      expect(cellIns.renumbered).toBe(1)

      // Body citation in para 2 renumbered to [2], cell holds [1].
      const cellLen = docA.getCellParagraphLength(0, 0, tblCtrl, 0, 0)
      expect(docA.getTextInCell(0, 0, tblCtrl, 0, 0, 0, cellLen)).toBe('셀 인용: [1]')
      expect(paraText(docA, 0, 2)).toContain('[2]')

      const bibA = insertBibliographyBlock(docA, entries)
      expect(bibA.ok).toBe(true)
      if (!bibA.ok) return
      expect(bibA.keys).toEqual(['김철수2019', '홍길동2020'])
      expect(paraText(docA, 0, bibA.startPara + 1)).toMatch(/^\[1\]\s*김철수/)
      expect(paraText(docA, 0, bibA.startPara + 2)).toMatch(/^\[2\]\s*홍길동/)
      expect(checkBibliographyStaleness(docA, { bibEntries: entries }).stale).toBe(false)
    } finally {
      docA.free()
    }

    // Direction B (reverse): insert citation in footnote in para 1 ([1]), then insert earlier body citation in para 0 -> footnote shifts [1] -> [2]!
    const docB = makeDoc(['앞선 본문이다.', '각주 포함 문단'])
    try {
      expect(setDocumentCitationStyle(docB, 'ieee').ok).toBe(true)
      const fnRes = JSON.parse(docB.insertFootnote(0, 1, 2)) as { ok: boolean }
      expect(fnRes.ok).toBe(true)
      const fnCtrls = (
        JSON.parse(docB.getControls()) as Array<{
          list: number
          para: number
          ctrlId: string
          controlIndex: number
        }>
      ).filter((c) => c.list === 0 && c.para === 1 && c.ctrlId === 'fn')
      expect(fnCtrls).toHaveLength(1)
      const fnCtrl = fnCtrls[0]!.controlIndex

      const fnCite = insertCitation(docB, {
        entries,
        items: [{ key: '김철수2019' }],
        place: { kind: 'footnote', sec: 0, para: 1, noteControl: fnCtrl, notePara: 0 },
      })
      expect(fnCite.ok).toBe(true)
      if (!fnCite.ok) return
      expect(fnCite.text).toBe('[1]')

      const earlierBody = insertCitation(docB, {
        entries,
        items: [{ key: '홍길동2020' }],
        place: { sec: 0, para: 0, offset: docB.getParagraphLength(0, 0) - 1 },
      })
      expect(earlierBody.ok).toBe(true)
      if (!earlierBody.ok) return
      expect(earlierBody.text).toBe('[1]')
      expect(earlierBody.renumbered).toBe(1)

      const fnInfo = JSON.parse(docB.getFootnoteInfo(0, 1, fnCtrl)) as { texts: string[] }
      expect(fnInfo.texts[0]).toContain('[2]')
      expect(fnInfo.texts[0]).not.toContain('[1]')

      // Verify checkBibliographyStaleness detects IEEE mismatch when a cell/body number disagrees with unified order!
      const bibB = insertBibliographyBlock(docB, entries)
      expect(bibB.ok).toBe(true)
      expect(checkBibliographyStaleness(docB, { bibEntries: entries }).stale).toBe(false)

      // Manually insert a mismatched earlier pattern citation (smith2021) in para 0 before [1]
      // -> unified order shifts 홍길동2020 to [2], so body [1] disagrees with unified order!
      docB.insertText(0, 0, 0, '(Smith, 2021) ')
      const stale = checkBibliographyStaleness(docB, { bibEntries: entries })
      expect(stale.stale).toBe(true)
      expect(stale.ieeeOutOfOrder).toBe(true)
      expect(stale.reason).toBe('ieee_order_changed')
    } finally {
      docB.free()
    }
  })

  it('Item #7: reflects a/b disambiguation and MLA short-title changes in existing marks on insertCitation and refreshBibliographyBlock, skipping manual edits', () => {
    const hongA = normalizeBibEntry({
      key: 'hong2020a',
      type: 'article',
      authors: ['홍길동'],
      year: '2020',
      title: '가나다 인공지능 교육 연구',
      containerTitle: '한국교육학연구',
      language: 'ko',
      verified: true,
    })
    const hongB = normalizeBibEntry({
      key: 'hong2020b',
      type: 'article',
      authors: ['홍길동'],
      year: '2020',
      title: '다라마 인공지능 평가 연구',
      containerTitle: '한국교육학연구',
      language: 'ko',
      verified: true,
    })
    const pairEntries = [hongA, hongB]

    // 1. Auto-update first citation to 2020a when second 2020 work is inserted.
    const doc = makeDoc(['첫 문장이다.', '둘째 문장이다.'])
    try {
      const first = insertCitation(doc, {
        entries: pairEntries,
        items: [{ key: 'hong2020a' }],
        place: { sec: 0, para: 0, offset: 5 },
      })
      expect(first.ok).toBe(true)
      expect(paraText(doc, 0, 0)).toContain('(홍길동, 2020)')

      const second = insertCitation(doc, {
        entries: pairEntries,
        items: [{ key: 'hong2020b' }],
        place: { sec: 0, para: 1, offset: 5 },
      })
      expect(second.ok).toBe(true)
      if (!second.ok) return
      expect(second.text).toBe('(홍길동, 2020b)')
      expect(second.renumbered).toBe(1)
      expect(paraText(doc, 0, 0)).toContain('(홍길동, 2020a)')
      expect(paraText(doc, 0, 1)).toContain('(홍길동, 2020b)')
    } finally {
      doc.free()
    }

    // 2. Skip manually edited first citation and report in skippedManual.
    const docManual = makeDoc(['첫 문장이다.', '둘째 문장이다.'])
    try {
      const first = insertCitation(docManual, {
        entries: pairEntries,
        items: [{ key: 'hong2020a' }],
        place: { sec: 0, para: 0, offset: 5 },
      })
      expect(first.ok).toBe(true)
      if (!first.ok || !first.marked) return
      docManual.insertText(0, 0, first.startOffset + 1, '직접수정 ')

      const second = insertCitation(docManual, {
        entries: pairEntries,
        items: [{ key: 'hong2020b' }],
        place: { sec: 0, para: 1, offset: 5 },
      })
      expect(second.ok).toBe(true)
      if (!second.ok) return
      expect(second.skippedManual).toHaveLength(1)
      expect(second.skippedManual?.[0]?.id).toBe(first.id)
      expect(paraText(docManual, 0, 0)).toContain('직접수정')
      expect(paraText(docManual, 0, 1)).toContain('(홍길동, 2020b)')
    } finally {
      docManual.free()
    }

    // 3. Disambiguation sync during refreshBibliographyBlock (e.g. second entry added via manual pattern or library edit).
    const docRefresh = makeDoc(['첫 문장이다.', '둘째 문장은 (홍길동, 2020)을 언급한다.'])
    try {
      const onlyA = [hongA]
      expect(
        insertCitation(docRefresh, {
          entries: onlyA,
          items: [{ key: 'hong2020a' }],
          place: { sec: 0, para: 0, offset: 5 },
        }).ok,
      ).toBe(true)
      expect(insertBibliographyBlock(docRefresh, onlyA).ok).toBe(true)
      expect(paraText(docRefresh, 0, 0)).toContain('(홍길동, 2020)')

      // Now second work is included in library + bibliography (includeAllLibrary or cited) -> refresh syncs mark #1 to 2020a!
      const docWithTwoMarks = makeDoc(['첫 문장이다.', '둘째 문장이다.'])
      try {
        // Insert hong2020a with only hongA in library, insert bib, then insert hong2020b with only hongB (simulating another machine), then refresh with full library!
        expect(
          insertCitation(docWithTwoMarks, {
            entries: [hongA],
            items: [{ key: 'hong2020a' }],
            place: { sec: 0, para: 0, offset: 5 },
          }).ok,
        ).toBe(true)
        expect(insertBibliographyBlock(docWithTwoMarks, [hongA]).ok).toBe(true)
        expect(
          insertCitation(docWithTwoMarks, {
            entries: [hongB],
            items: [{ key: 'hong2020b' }],
            place: { sec: 0, para: 1, offset: 5 },
          }).ok,
        ).toBe(true)
        // Before refresh, both marks still lack a/b because each was inserted with a 1-entry library.
        expect(paraText(docWithTwoMarks, 0, 0)).toContain('(홍길동, 2020)')
        expect(paraText(docWithTwoMarks, 0, 1)).toContain('(홍길동, 2020)')

        const ref = refreshBibliographyBlock(docWithTwoMarks, pairEntries)
        expect(ref.ok).toBe(true)
        if (!ref.ok) return
        expect(ref.updatedCitations).toBe(2)
        expect(paraText(docWithTwoMarks, 0, 0)).toContain('(홍길동, 2020a)')
        expect(paraText(docWithTwoMarks, 0, 1)).toContain('(홍길동, 2020b)')
      } finally {
        docWithTwoMarks.free()
      }
    } finally {
      docRefresh.free()
    }

    // 4. MLA short-title sync when a second English work by the same author is inserted.
    const sampleEntries = makeSampleEntries()
    const docMla = makeDoc(['First sentence.', 'Second sentence.'])
    try {
      expect(setDocumentCitationStyle(docMla, 'mla').ok).toBe(true)
      expect(
        insertCitation(docMla, {
          entries: sampleEntries,
          items: [{ key: 'smith2021' }],
          place: { sec: 0, para: 0, offset: 14 },
        }).ok,
      ).toBe(true)
      expect(paraText(docMla, 0, 0)).toContain('(Smith and Doe)')

      const mla2 = insertCitation(docMla, {
        entries: sampleEntries,
        items: [{ key: 'smith2021b' }],
        place: { sec: 0, para: 1, offset: 15 },
      })
      expect(mla2.ok).toBe(true)
      if (!mla2.ok) return
      expect(mla2.renumbered).toBe(1)
      expect(paraText(docMla, 0, 0)).toContain('(Smith and Doe, "Deep learning methods")')
      expect(paraText(docMla, 0, 1)).toContain('(Smith and Doe, "Structured layout evaluation")')
    } finally {
      docMla.free()
    }
  })

  it('Item #8: preserves missing-from-library bibliography lines with LIVE document text in proper APA collation and IEEE number position', () => {
    const ganada = normalizeBibEntry({
      key: 'ganada2020',
      type: 'book',
      authors: ['가나다'],
      year: '2020',
      title: '누락될 한국어 문헌',
      publisher: '출판사',
      language: 'ko',
      verified: true,
    })
    const hong = makeSampleEntries()[0]!
    const smith = makeSampleEntries()[2]!

    // 1. APA: missing-key Korean entry edited live stays BEFORE 홍길동 with live edited text!
    const docApa = makeDoc(['인용 본문이다.'])
    try {
      expect(
        insertCitation(docApa, {
          entries: [ganada, hong, smith],
          items: [{ key: 'ganada2020' }, { key: '홍길동2020' }, { key: 'smith2021' }],
          place: { sec: 0, para: 0, offset: 7 },
        }).ok,
      ).toBe(true)
      const ins = insertBibliographyBlock(docApa, [ganada, hong, smith])
      expect(ins.ok).toBe(true)
      if (!ins.ok) return

      // Live-edit the 가나다 bibliography line in doc.
      const ganadaPara = ins.startPara + 1
      expect(paraText(docApa, 0, ganadaPara)).toContain('가나다(2020)')
      docApa.insertText(0, ganadaPara, docApa.getParagraphLength(0, ganadaPara), ' [현장수정]')

      // Refresh with partial library lacking ganada2020!
      const ref = refreshBibliographyBlock(docApa, [hong, smith], { allowOverwriteManual: true })
      expect(ref.ok).toBe(true)
      if (!ref.ok) return
      expect(ref.preservedMissingKeys).toEqual(['ganada2020'])
      expect(ref.keys).toEqual(['ganada2020', '홍길동2020', 'smith2021'])
      // Preserved live edited text stays FIRST (before 홍길동), NOT appended at the end!
      expect(paraText(docApa, 0, ref.startPara + 1)).toContain('가나다(2020)')
      expect(paraText(docApa, 0, ref.startPara + 1)).toContain('[현장수정]')
      expect(paraText(docApa, 0, ref.startPara + 2)).toContain('홍길동(2020)')
      expect(paraText(docApa, 0, ref.startPara + 3)).toContain('Smith, J.')
    } finally {
      docApa.free()
    }

    // 2. IEEE: missing-key [1] entry stays at position 1 BEFORE [2]!
    const docIeee = makeDoc(['첫 인용.', '둘째 인용.'])
    try {
      expect(setDocumentCitationStyle(docIeee, 'ieee').ok).toBe(true)
      expect(
        insertCitation(docIeee, {
          entries: [ganada, hong],
          items: [{ key: 'ganada2020' }],
          place: { sec: 0, para: 0, offset: 4 },
        }).ok,
      ).toBe(true)
      expect(
        insertCitation(docIeee, {
          entries: [ganada, hong],
          items: [{ key: '홍길동2020' }],
          place: { sec: 0, para: 1, offset: 5 },
        }).ok,
      ).toBe(true)
      const ins = insertBibliographyBlock(docIeee, [ganada, hong])
      expect(ins.ok).toBe(true)
      if (!ins.ok) return

      // Live-edit [1] line and refresh with partial library containing only hong!
      const firstBibPara = ins.startPara + 1
      docIeee.insertText(0, firstBibPara, docIeee.getParagraphLength(0, firstBibPara), ' [보존]')

      const ref = refreshBibliographyBlock(docIeee, [hong], { allowOverwriteManual: true })
      expect(ref.ok).toBe(true)
      if (!ref.ok) return
      expect(ref.preservedMissingKeys).toEqual(['ganada2020'])
      expect(ref.keys).toEqual(['ganada2020', '홍길동2020'])
      expect(paraText(docIeee, 0, ref.startPara + 1)).toMatch(/^\[1\]\s*가나다.*\[보존\]$/)
      expect(paraText(docIeee, 0, ref.startPara + 2)).toMatch(/^\[2\]\s*홍길동/)
    } finally {
      docIeee.free()
    }
  })

  it('Item #9: propagates writeDocSetting and mark-delete failures instead of discarding them', () => {
    const entries = makeSampleEntries()
    const doc = makeDoc(['첫 문장이다.', '둘째 문장이다.'])
    try {
      expect(
        insertCitation(doc, {
          entries,
          items: [{ key: '홍길동2020' }],
          place: { sec: 0, para: 0, offset: 5 },
        }).ok,
      ).toBe(true)
      expect(insertBibliographyBlock(doc, entries).ok).toBe(true)

      // Fault-inject addBookmark failure for setting bookmarks -> setDocumentCitationStyle & refreshBibliographyBlock fail cleanly.
      const failWriteProxy = Object.create(doc) as HwpDocument
      failWriteProxy.addBookmark = (sec: number, para: number, offset: number, name: string) => {
        if (name.startsWith(MARK_PREFIXES.setting)) {
          return JSON.stringify({ ok: false, error: 'simulated setting write failure' })
        }
        return doc.addBookmark(sec, para, offset, name)
      }

      const styleFail = setDocumentCitationStyle(failWriteProxy, 'ieee')
      expect(styleFail.ok).toBe(false)

      const rwFail = rewriteCitationKeys(failWriteProxy, { 홍길동2020: 'hong_renamed' }, entries)
      expect(rwFail.ok).toBe(false)
    } finally {
      doc.free()
    }

    // Use a fresh document for mark-delete fault injection (no wrapping transaction above).
    const docDel = makeDoc(['첫 문장이다.', '둘째 문장이다.'])
    try {
      expect(
        insertCitation(docDel, {
          entries,
          items: [{ key: '홍길동2020' }],
          place: { sec: 0, para: 0, offset: 5 },
        }).ok,
      ).toBe(true)
      expect(insertBibliographyBlock(docDel, entries).ok).toBe(true)

      // Fault-inject deleteBookmark & deleteControlAt failure -> switchCitationStyle & refreshBibliographyBlock return mark_delete_failed!
      const failDeleteProxy = Object.create(docDel) as HwpDocument
      failDeleteProxy.deleteBookmark = () =>
        JSON.stringify({ ok: false, error: 'simulated deleteBookmark failure' })
      ;(failDeleteProxy as unknown as Record<string, unknown>).deleteControlAt = () =>
        JSON.stringify({ ok: false, error: 'simulated deleteControlAt failure' })

      const switchFail = switchCitationStyle(failDeleteProxy, 'ieee', entries)
      expect(switchFail.ok).toBe(false)
      if (!switchFail.ok) {
        expect(switchFail.reason).toBe('mark_delete_failed')
        expect(Array.isArray(switchFail.failed) && switchFail.failed.length > 0).toBe(true)
      }

      const refreshFail = refreshBibliographyBlock(failDeleteProxy, entries, {
        allowOverwriteManual: true,
      })
      expect(refreshFail.ok).toBe(false)
      if (!refreshFail.ok) {
        expect(refreshFail.reason).toBe('mark_delete_failed')
        expect(Array.isArray(refreshFail.failed) && refreshFail.failed.length > 0).toBe(true)
      }
    } finally {
      docDel.free()
    }
  })

  it('Item #14: flags untitled entries in auditCitations (with clickable location when cited)', () => {
    const untitledCited = normalizeBibEntry({
      key: 'untitled_cited',
      type: 'article',
      authors: ['무제저자'],
      year: '2023',
      title: '',
      language: 'ko',
      verified: true,
    })
    const untitledUncited = normalizeBibEntry({
      key: 'untitled_uncited',
      type: 'book',
      authors: ['빈제목'],
      year: '2022',
      title: '   ',
      language: 'ko',
      verified: false,
    })
    const allEntries = [...makeSampleEntries(), untitledCited, untitledUncited]
    const doc = makeDoc(['제목 없는 문헌을 인용한다.'])
    try {
      expect(
        insertCitation(doc, {
          entries: allEntries,
          items: [{ key: 'untitled_cited' }],
          place: { sec: 0, para: 0, offset: 14 },
        }).ok,
      ).toBe(true)

      const report = auditCitations(doc, allEntries)
      const citedIssue = report.issues.find(
        (i) => i.reason === 'missing_title' && i.key === 'untitled_cited',
      )
      expect(citedIssue).toBeDefined()
      expect(citedIssue?.missingTitle).toBe(true)
      expect(citedIssue?.sec).toBe(0)
      expect(citedIssue?.para).toBe(0)
      expect(citedIssue?.length).toBeGreaterThan(0)

      const uncitedIssue = report.issues.find(
        (i) => i.reason === 'missing_title' && i.key === 'untitled_uncited',
      )
      expect(uncitedIssue).toBeDefined()
      expect(uncitedIssue?.missingTitle).toBe(true)
    } finally {
      doc.free()
    }
  })

  it('Item #20: blocks inserting a citation inside existing 인용: or 참고문헌: ranges with zero edits', () => {
    const entries = makeSampleEntries()
    const doc = makeDoc(['선행 연구를 인용한다.'])
    try {
      const first = insertCitation(doc, {
        entries,
        items: [{ key: '홍길동2020' }],
        place: { sec: 0, para: 0, offset: 11 },
      })
      expect(first.ok).toBe(true)
      if (!first.ok || !first.marked) return

      const bib = insertBibliographyBlock(doc, entries)
      expect(bib.ok).toBe(true)
      if (!bib.ok) return

      const bytesBefore = doc.exportHwpx()

      // Interior of existing 인용: range -> inside_citation
      const insideMid = insertCitation(doc, {
        entries,
        items: [{ key: '김철수2019' }],
        place: { sec: 0, para: 0, offset: first.startOffset + 3 },
      })
      expect(insideMid).toEqual({ ok: false, reason: 'inside_citation' })

      // Boundary of existing 인용: range -> inside_citation
      const insideBoundary = insertCitation(doc, {
        entries,
        items: [{ key: '김철수2019' }],
        place: { sec: 0, para: 0, offset: first.endOffset },
      })
      expect(insideBoundary).toEqual({ ok: false, reason: 'inside_citation' })

      // Inside existing 참고문헌: range -> inside_bibliography
      const insideBib = insertCitation(doc, {
        entries,
        items: [{ key: '김철수2019' }],
        place: { sec: 0, para: bib.startPara + 1, offset: 2 },
      })
      expect(insideBib).toEqual({ ok: false, reason: 'inside_bibliography' })

      expect(doc.exportHwpx()).toEqual(bytesBefore)
    } finally {
      doc.free()
    }
  })
})
