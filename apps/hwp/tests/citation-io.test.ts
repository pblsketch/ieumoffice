/**
 * Unit tests for bibliography import/export (BibTeX, RIS, CSL JSON),
 * untrusted input guards, document reference list rule parsing,
 * and duplicate detection.
 */
import { describe, expect, it } from 'vitest'
import {
  BIBLIOGRAPHY_FORMATS,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ENTRIES,
  detectBibliographyFormat,
  exportBibTeX,
  exportBibliography,
  exportCslJson,
  exportRis,
  findDuplicateEntries,
  hasFormulaPrefix,
  isDuplicateEntry,
  normalizeDoi,
  normalizeTitleForMatch,
  parseBibTeX,
  parseBibliographyFile,
  parseCslJson,
  parseDocumentReferenceLines,
  parseRis,
  planImportPreview,
  sanitizeImportedField,
} from '../studio-plugin/citation-io.mjs'
import { normalizeBibEntry, type BibEntry } from '../studio-plugin/citation-styles.mjs'

function makeEntry(overrides: Record<string, unknown>): BibEntry {
  return normalizeBibEntry(overrides)
}

function encodeUtf8WithBom(text: string): Uint8Array {
  const body = new TextEncoder().encode(text)
  const out = new Uint8Array(body.length + 3)
  out[0] = 0xef
  out[1] = 0xbb
  out[2] = 0xbf
  out.set(body, 3)
  return out
}

describe('untrusted input guards and sanitization', () => {
  it('exports the default import limits and supported format list', () => {
    expect(MAX_IMPORT_BYTES).toBe(2 * 1024 * 1024)
    expect(MAX_IMPORT_ENTRIES).toBe(5000)
    expect(BIBLIOGRAPHY_FORMATS).toEqual(['bibtex', 'ris', 'csl-json'])
  })

  it('rejects oversized string and Uint8Array inputs across all parsers', () => {
    const bigBib = `@article{k1, title = {${'A'.repeat(200)}}}`
    const resBib = parseBibTeX(bigBib, { maxBytes: 64 })
    expect(resBib.ok).toBe(false)
    if (!resBib.ok) {
      expect(resBib.reason).toBe('too_large')
      expect(resBib.maxBytes).toBe(64)
      expect(resBib.actualBytes).toBeGreaterThan(64)
    }

    const bigBytes = new Uint8Array(128).fill(0x41)
    const resRis = parseRis(bigBytes, { maxBytes: 64 })
    expect(resRis.ok).toBe(false)
    if (!resRis.ok) expect(resRis.reason).toBe('too_large')

    const resCsl = parseCslJson(bigBytes, { maxBytes: 64 })
    expect(resCsl.ok).toBe(false)
    if (!resCsl.ok) expect(resCsl.reason).toBe('too_large')

    const resAuto = parseBibliographyFile(bigBytes, { maxBytes: 64 })
    expect(resAuto.ok).toBe(false)
    if (!resAuto.ok) expect(resAuto.reason).toBe('too_large')

    const resDoc = parseDocumentReferenceLines(['홍길동(2020). 제목. 출판사.'], { maxBytes: 10 })
    expect(resDoc.ok).toBe(false)
    if (!resDoc.ok) expect(resDoc.reason).toBe('too_large')
  })

  it('rejects empty and whitespace-only inputs across all parsers', () => {
    for (const input of ['', '   \n\t  ', encodeUtf8WithBom('   ')]) {
      const bib = parseBibTeX(input)
      expect(bib.ok).toBe(false)
      if (!bib.ok) expect(bib.reason).toBe('empty')

      const ris = parseRis(input)
      expect(ris.ok).toBe(false)
      if (!ris.ok) expect(ris.reason).toBe('empty')

      const csl = parseCslJson(input)
      expect(csl.ok).toBe(false)
      if (!csl.ok) expect(csl.reason).toBe('empty')

      const doc = parseDocumentReferenceLines(input)
      expect(doc.ok).toBe(false)
      if (!doc.ok) expect(doc.reason).toBe('empty')
    }
  })

  it('strips NUL/control bytes while preserving formula-prefixed values as inert strings', () => {
    expect(sanitizeImportedField('\uFEFF=SUM(A1:A10)\u0000\u0007')).toBe('=SUM(A1:A10)')
    expect(sanitizeImportedField("+cmd|' /C calc'!A0")).toBe("+cmd|' /C calc'!A0")
    expect(sanitizeImportedField('-1+1')).toBe('-1+1')
    expect(sanitizeImportedField('@eval(1)')).toBe('@eval(1)')

    expect(hasFormulaPrefix('=SUM(A1)')).toBe(true)
    expect(hasFormulaPrefix('  +cmd')).toBe(true)
    expect(hasFormulaPrefix('-1+1')).toBe(true)
    expect(hasFormulaPrefix('@eval')).toBe(true)
    expect(hasFormulaPrefix('Normal Title')).toBe(false)
    expect(hasFormulaPrefix('')).toBe(false)

    const bibWithFormulas = `
@article{formula2024,
  author = {{@eval(org)}},
  title = {=SUM(A1:A5)\u0000},
  journal = {+cmd_journal},
  year = {2024},
  note = {-1+1}
}`
    const parsed = parseBibTeX(bibWithFormulas)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      const entry = parsed.entries[0]
      expect(entry.title).toBe('=SUM(A1:A5)')
      expect(entry.containerTitle).toBe('+cmd_journal')
      expect(entry.memo).toBe('-1+1')
      expect(entry.authors[0]).toEqual({ literal: '@eval(org)', isOrganization: true })
      expect(hasFormulaPrefix(entry.title)).toBe(true)
      expect(hasFormulaPrefix(entry.containerTitle)).toBe(true)
      expect(hasFormulaPrefix(entry.memo)).toBe(true)
    }
  })

  it('enforces maxEntries limit with a warning instead of unbounded allocation', () => {
    const many = Array.from(
      { length: 5 },
      (_, idx) => `@article{k${idx}, author = {Smith, J.}, title = {Study ${idx}}, year = {2020}}`,
    ).join('\n')
    const res = parseBibTeX(many, { maxEntries: 3 })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.entries).toHaveLength(3)
      expect(res.warnings.length).toBeGreaterThan(0)
    }
  })
})

describe('BibTeX import and export', () => {
  it('parses standard BibTeX with nested braces, macros, concatenation, diacritics, and UTF-8 Korean', () => {
    const sample = encodeUtf8WithBom(`
@comment{Ignore @article{fake2020, title = {Ignored}}}
@preamble{"\\newcommand{\\noopsort}[1]{}"}
@string{jedu = "Journal of {STEM} Education"}

@article{smith2020,
  author = {Smith, John A. and M\\"uller, Ren\\'e and {World Health Organization}},
  editor = {Lee, Min-Su},
  title = {Effects of {AI} \\& 50\\% Feedback -- A Study},
  journal = jedu # " Quarterly",
  year = 2020,
  volume = {12},
  number = {3},
  pages = {45--67},
  doi = {10.1234/jedu.2020.001},
  url = {https://example.org/study?a=1&b=2},
  urldate = {2024-03-10},
  language = {english},
  keywords = {education, assessment; methodology},
  note = {Core reference}
}

@phdthesis{hong2021,
  author = {홍길동},
  title = {실천교육학의 이해},
  school = {한국대학교},
  year = {2021},
  address = {서울},
  keywords = {교육학, 방법론}
}
`)
    const res = parseBibTeX(sample)
    expect(res.ok).toBe(true)
    if (!res.ok) return

    expect(res.entries).toHaveLength(2)

    const en = res.entries[0]
    expect(en.key).toBe('smith2020')
    expect(en.type).toBe('article')
    expect(en.verified).toBe(true)
    expect(en.source).toBe('import')
    expect(en.authors).toEqual([
      { family: 'Smith', given: 'John A.' },
      { family: 'M\u00FCller', given: 'Ren\u00E9' },
      { literal: 'World Health Organization', isOrganization: true },
    ])
    expect(en.editors).toEqual([{ family: 'Lee', given: 'Min-Su' }])
    expect(en.title).toBe('Effects of AI & 50% Feedback - A Study')
    expect(en.containerTitle).toBe('Journal of STEM Education Quarterly')
    expect(en.year).toBe('2020')
    expect(en.volume).toBe('12')
    expect(en.issue).toBe('3')
    expect(en.pages).toBe('45-67')
    expect(en.doi).toBe('10.1234/jedu.2020.001')
    expect(en.url).toBe('https://example.org/study?a=1&b=2')
    expect(en.accessed).toBe('2024-03-10')
    expect(en.language).toBe('en')
    expect(en.tags).toEqual(['education, assessment', 'methodology'])
    expect(en.memo).toBe('Core reference')

    const ko = res.entries[1]
    expect(ko.key).toBe('hong2021')
    expect(ko.type).toBe('thesis')
    expect(ko.authors).toEqual([{ literal: '홍길동' }])
    expect(ko.title).toBe('실천교육학의 이해')
    expect(ko.institution).toBe('한국대학교')
    expect(ko.degree).toBe('박사학위논문')
    expect(ko.place).toBe('서울')
    expect(ko.language).toBe('ko')
    expect(ko.tags).toEqual(['교육학', '방법론'])
  })

  it('rejects malformed BibTeX with unclosed braces or no entries', () => {
    const unclosed = parseBibTeX('@article{k1, title = {Unclosed title')
    expect(unclosed.ok).toBe(false)
    if (!unclosed.ok) expect(unclosed.reason).toBe('invalid_format')

    const prose = parseBibTeX('This is plain text without any BibTeX records.')
    expect(prose.ok).toBe(false)
    if (!prose.ok) expect(prose.reason).toBe('invalid_format')
  })

  it('roundtrips BibTeX entries cleanly across multiple entry types', () => {
    const original: BibEntry[] = [
      makeEntry({
        key: 'kim2022',
        type: 'article',
        authors: ['김철수', { literal: '한국교육개발원', isOrganization: true }],
        year: '2022',
        title: '디지털 전환 & 100% 평가 {모형}',
        containerTitle: '한국교육학연구',
        volume: '15',
        issue: '2',
        pages: '10-32',
        doi: '10.9999/ke.2022.15.2.10',
        language: 'ko',
        tags: ['디지털', '평가'],
        memo: '핵심 논문',
      }),
      makeEntry({
        key: 'doe2019',
        type: 'conference',
        authors: [{ family: 'Doe', given: 'Jane' }],
        year: '2019',
        title: 'Scalable Indexing for Large Corpora',
        containerTitle: 'Proceedings of the Annual Computing Symposium',
        pages: '112-120',
        place: 'Boston',
        publisher: 'Computing Press',
        language: 'en',
        tags: ['indexing'],
      }),
    ]

    const exported = exportBibTeX(original)
    const reparsed = parseBibTeX(exported)
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return

    expect(reparsed.entries).toHaveLength(2)
    expect(reparsed.entries[0]).toMatchObject({
      key: 'kim2022',
      type: 'article',
      authors: [{ literal: '김철수' }, { literal: '한국교육개발원', isOrganization: true }],
      year: '2022',
      title: '디지털 전환 & 100% 평가 {모형}',
      containerTitle: '한국교육학연구',
      volume: '15',
      issue: '2',
      pages: '10-32',
      doi: '10.9999/ke.2022.15.2.10',
      language: 'ko',
      tags: ['디지털', '평가'],
      memo: '핵심 논문',
    })
    expect(reparsed.entries[1]).toMatchObject({
      key: 'doe2019',
      type: 'conference',
      authors: [{ family: 'Doe', given: 'Jane' }],
      year: '2019',
      title: 'Scalable Indexing for Large Corpora',
      containerTitle: 'Proceedings of the Annual Computing Symposium',
      pages: '112-120',
      place: 'Boston',
      publisher: 'Computing Press',
      language: 'en',
      tags: ['indexing'],
    })
  })
})

describe('RIS import and export', () => {
  it('parses standard RIS and single-space Korean library catalog RIS with continuations', () => {
    const risText = encodeUtf8WithBom(`
TY  - JOUR
ID  - park2023
AU  - 박영희
AU  - 이민호
TI  - 한국어 텍스트 마이닝의
최신 동향 연구
JF  - 언어정보학회지
PY  - 2023/06/15
VL  - 28
IS  - 1
SP  - 15
EP  - 42
DO  - 10.5555/lang.2023.28.1.15
LA  - kor
KW  - 텍스트마이닝
KW  - 자연어처리
N1  - 국내 학술지
ER  - 

TY - THES
AU - 김수진
TI - 대학생의 비판적 읽기 전략 분석
PB - 서울대학교
M3 - 석사학위논문
Y1 - 2020///
CY - 서울
ER -
`)
    const res = parseRis(risText)
    expect(res.ok).toBe(true)
    if (!res.ok) return

    expect(res.entries).toHaveLength(2)
    expect(res.entries[0]).toMatchObject({
      key: 'park2023',
      type: 'article',
      authors: [{ literal: '박영희' }, { literal: '이민호' }],
      title: '한국어 텍스트 마이닝의 최신 동향 연구',
      containerTitle: '언어정보학회지',
      year: '2023',
      volume: '28',
      issue: '1',
      pages: '15-42',
      doi: '10.5555/lang.2023.28.1.15',
      language: 'ko',
      tags: ['텍스트마이닝', '자연어처리'],
      memo: '국내 학술지',
      verified: true,
      source: 'import',
    })
    expect(res.entries[1]).toMatchObject({
      type: 'thesis',
      authors: [{ literal: '김수진' }],
      title: '대학생의 비판적 읽기 전략 분석',
      institution: '서울대학교',
      degree: '석사학위논문',
      year: '2020',
      place: '서울',
      language: 'ko',
    })
  })

  it('rejects non-RIS input as invalid_format', () => {
    const res = parseRis('<html><body>Not a RIS file</body></html>')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('invalid_format')
  })

  it('roundtrips RIS export and parse with CRLF and LF options', () => {
    const entries = [
      makeEntry({
        key: 'chen2021',
        type: 'book',
        authors: [{ family: 'Chen', given: 'Wei' }],
        editors: [{ family: 'Brown', given: 'Alice' }],
        year: '2021',
        title: 'Quantitative Research Methods',
        edition: '2nd ed.',
        publisher: 'University Press',
        place: 'London',
        url: 'https://example.org/book',
        accessed: '2024-02-01',
        language: 'en',
        tags: ['methods', 'statistics'],
        memo: 'Textbook',
      }),
    ]

    const exportedCrlf = exportRis(entries, { lineEnding: '\r\n' })
    expect(exportedCrlf).toContain('\r\n')
    expect(exportedCrlf).toContain('TY  - BOOK')
    expect(exportedCrlf).toContain('ER  - ')

    const reparsed = parseRis(exportedCrlf)
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return

    expect(reparsed.entries[0]).toMatchObject({
      key: 'chen2021',
      type: 'book',
      authors: [{ family: 'Chen', given: 'Wei' }],
      editors: [{ family: 'Brown', given: 'Alice' }],
      year: '2021',
      title: 'Quantitative Research Methods',
      edition: '2nd ed.',
      publisher: 'University Press',
      place: 'London',
      url: 'https://example.org/book',
      accessed: '2024-02-01',
      language: 'en',
      tags: ['methods', 'statistics'],
      memo: 'Textbook',
    })
  })
})

describe('CSL JSON import and export', () => {
  it('parses top-level array and wrapped items/references objects', () => {
    const wrapped = JSON.stringify({
      items: [
        {
          id: 'lee2022',
          type: 'article-journal',
          title: 'Adaptive Learning Systems',
          author: [{ family: 'Lee', given: 'Hana' }, { literal: 'National Research Institute' }],
          issued: { 'date-parts': [[2022, 11, 5]] },
          'container-title': 'Educational Technology Review',
          volume: '34',
          issue: '4',
          page: '201-218',
          DOI: '10.1000/etr.2022.34.4',
          URL: 'https://example.org/etr/2022',
          accessed: { 'date-parts': [[2024, 5, 3]] },
          language: 'en-US',
          keyword: 'adaptive, learning',
          note: 'Reviewed',
        },
      ],
    })

    const res = parseCslJson(wrapped)
    expect(res.ok).toBe(true)
    if (!res.ok) return

    expect(res.entries).toHaveLength(1)
    expect(res.entries[0]).toMatchObject({
      key: 'lee2022',
      type: 'article',
      title: 'Adaptive Learning Systems',
      authors: [
        { family: 'Lee', given: 'Hana' },
        { literal: 'National Research Institute', isOrganization: true },
      ],
      year: '2022',
      containerTitle: 'Educational Technology Review',
      volume: '34',
      issue: '4',
      pages: '201-218',
      doi: '10.1000/etr.2022.34.4',
      url: 'https://example.org/etr/2022',
      accessed: '2024-05-03',
      language: 'en',
      tags: ['adaptive', 'learning'],
      memo: 'Reviewed',
      verified: true,
      source: 'import',
    })
  })

  it('rejects invalid JSON and non-bibliography JSON payloads', () => {
    const badJson = parseCslJson('{not valid json')
    expect(badJson.ok).toBe(false)
    if (!badJson.ok) expect(badJson.reason).toBe('invalid_format')

    const badShape = parseCslJson('{"hello": "world"}')
    expect(badShape.ok).toBe(false)
    if (!badShape.ok) expect(badShape.reason).toBe('invalid_format')

    const emptyItems = parseCslJson('[1, 2, 3]')
    expect(emptyItems.ok).toBe(false)
    if (!emptyItems.ok) expect(emptyItems.reason).toBe('invalid_format')
  })

  it('roundtrips CSL JSON export and parse with full field fidelity', () => {
    const entries = [
      makeEntry({
        key: 'choi2024',
        type: 'thesis',
        authors: ['최지훈'],
        year: '2024',
        title: '공공데이터 활용 정책 분석',
        degree: '박사학위논문',
        institution: '고려대학교',
        place: '서울',
        language: 'ko',
        tags: ['공공데이터', '정책'],
        memo: '학위논문 참고',
      }),
      makeEntry({
        key: 'web2023',
        type: 'webpage',
        authors: [{ literal: 'World Health Organization', isOrganization: true }],
        year: '2023',
        title: 'Global Health Statistics',
        containerTitle: 'Annual Portal',
        url: 'https://example.org/health',
        accessed: '2024-01-15',
        language: 'en',
        tags: ['health'],
      }),
    ]

    const json = exportCslJson(entries)
    const reparsed = parseCslJson(json)
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return

    expect(reparsed.entries[0]).toMatchObject({
      key: 'choi2024',
      type: 'thesis',
      authors: [{ literal: '최지훈' }],
      year: '2024',
      title: '공공데이터 활용 정책 분석',
      degree: '박사학위논문',
      institution: '고려대학교',
      place: '서울',
      language: 'ko',
      tags: ['공공데이터', '정책'],
      memo: '학위논문 참고',
    })
    expect(reparsed.entries[1]).toMatchObject({
      key: 'web2023',
      type: 'webpage',
      authors: [{ literal: 'World Health Organization', isOrganization: true }],
      year: '2023',
      title: 'Global Health Statistics',
      containerTitle: 'Annual Portal',
      url: 'https://example.org/health',
      accessed: '2024-01-15',
      language: 'en',
      tags: ['health'],
    })
  })
})

describe('auto-detection and format dispatch', () => {
  it('detects format from filename extension and content sniffing', () => {
    expect(detectBibliographyFormat('anything', 'refs.bib')).toBe('bibtex')
    expect(detectBibliographyFormat('anything', 'catalog.ris')).toBe('ris')
    expect(detectBibliographyFormat('anything', 'library.json')).toBe('csl-json')

    expect(detectBibliographyFormat('@article{a, title={T}}')).toBe('bibtex')
    expect(detectBibliographyFormat('TY  - JOUR\nTI  - T\nER  - ')).toBe('ris')
    expect(detectBibliographyFormat('[{"id":"a","title":"T"}]')).toBe('csl-json')
    expect(detectBibliographyFormat('plain text without markers')).toBeNull()
  })

  it('dispatches parseBibliographyFile and supports tag-filtered exportBibliography', () => {
    const entries = [
      makeEntry({
        key: 'a2020',
        type: 'book',
        authors: ['홍길동'],
        year: '2020',
        title: '책 A',
        tags: ['ch1'],
      }),
      makeEntry({
        key: 'b2021',
        type: 'book',
        authors: ['김철수'],
        year: '2021',
        title: '책 B',
        tags: ['ch2'],
      }),
    ]

    const bib = exportBibliography(entries, 'bibtex', { tag: 'ch1' })
    const parsedBib = parseBibliographyFile(bib)
    expect(parsedBib.ok).toBe(true)
    expect(parsedBib.format).toBe('bibtex')
    if (parsedBib.ok) {
      expect(parsedBib.entries).toHaveLength(1)
      expect(parsedBib.entries[0].key).toBe('a2020')
    }

    const ris = exportBibliography(entries, 'ris', { tag: 'ch2' })
    const parsedRis = parseBibliographyFile(ris)
    expect(parsedRis.ok).toBe(true)
    expect(parsedRis.format).toBe('ris')
    if (parsedRis.ok) {
      expect(parsedRis.entries).toHaveLength(1)
      expect(parsedRis.entries[0].key).toBe('b2021')
    }

    const csl = exportBibliography(entries, 'csl-json')
    const parsedCsl = parseBibliographyFile(csl)
    expect(parsedCsl.ok).toBe(true)
    expect(parsedCsl.format).toBe('csl-json')
    if (parsedCsl.ok) {
      expect(parsedCsl.entries).toHaveLength(2)
    }

    const unknown = parseBibliographyFile('just some prose')
    expect(unknown.ok).toBe(false)
    expect(unknown.format).toBeNull()

    expect(() => exportBibliography(entries, 'unknown' as never)).toThrow(RangeError)
  })
})

describe('extended format variants and edge cases', () => {
  it('handles BibTeX parenthesized entries, all entry types, and bare numeric values', () => {
    const bib = `
@book(book2020,
  author = "Kim, Young-Ho",
  title = "Foundations of Logic",
  publisher = "Seoul Academic",
  edition = "3rd",
  year = 2020
)
@incollection{chap2021,
  author = {Park, Min},
  editor = {Choi, Jin},
  title = {Chapter One},
  booktitle = {Collected Essays},
  pages = {10--25},
  year = 2021
}
@mastersthesis{mthesis2022,
  author = {Doe, Alex},
  title = {Empirical Study},
  school = {State University},
  year = 2022
}
@techreport{rep2023,
  author = {{Policy Research Institute}},
  title = {Annual Statistical Summary},
  institution = {Policy Research Institute},
  year = 2023
}
@online{web2024,
  author = {Lee, J.},
  title = {Open Reference Specification},
  url = {https://example.org/spec},
  urldate = {2024-06-01},
  year = 2024
}
@misc{misc2024,
  author = {Han, S.},
  title = {Dataset Archive},
  year = 2024
}
`
    const res = parseBibTeX(bib)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.entries.map((e) => e.type)).toEqual([
      'book',
      'chapter',
      'thesis',
      'report',
      'webpage',
      'other',
    ])
    expect(res.entries[0].edition).toBe('3rd')
    expect(res.entries[1].containerTitle).toBe('Collected Essays')
    expect(res.entries[2].degree).toBe("Master's thesis")
    expect(res.entries[3].institution).toBe('Policy Research Institute')
    expect(res.entries[4].accessed).toBe('2024-06-01')
  })

  it('handles RIS missing closing ER tag with a warning and combined SP page range', () => {
    const ris = `TY  - CONF
AU  - Smith, J.
TI  - Streaming Algorithms
T2  - Symposium on Algorithms
PY  - 2022
SP  - 100-112
PB  - Science Press`
    const res = parseRis(ris)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.entries).toHaveLength(1)
    expect(res.entries[0]).toMatchObject({
      type: 'conference',
      containerTitle: 'Symposium on Algorithms',
      pages: '100-112',
    })
    expect(res.warnings.length).toBeGreaterThan(0)
  })

  it('handles CSL JSON references container and non-dropping name particles', () => {
    const json = JSON.stringify({
      references: [
        {
          id: 'beethoven1824',
          type: 'book',
          title: 'Symphony Notes',
          author: [{ given: 'Ludwig', 'non-dropping-particle': 'van', family: 'Beethoven' }],
          issued: { raw: '1824' },
          publisher: 'Vienna Press',
        },
      ],
    })
    const res = parseCslJson(json)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.entries[0].authors).toEqual([{ family: 'van Beethoven', given: 'Ludwig' }])
    expect(res.entries[0].year).toBe('1824')
  })

  it('handles reversed Korean thesis order, Place: Publisher, editors, MLA book, and Uint8Array document lines', () => {
    const docText = encodeUtf8WithBom(
      [
        '김민수(2022). 인공지능과 교육 평가. 한국대학교 박사학위논문.',
        '박철수(편)(2021). 현대 사회학 개론. 서울: 문학출판사.',
        'Green, Alice. Principles of Design. North Press, 2019.',
      ].join('\n'),
    )
    const res = parseDocumentReferenceLines(docText)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.parsed).toHaveLength(3)
    expect(res.unparsed).toHaveLength(0)
    expect(res.parsed[0].entry).toMatchObject({
      type: 'thesis',
      degree: '박사학위논문',
      institution: '한국대학교',
    })
    expect(res.parsed[1].entry).toMatchObject({
      type: 'book',
      editors: [{ literal: '박철수' }],
      place: '서울',
      publisher: '문학출판사',
    })
    expect(res.parsed[2].entry).toMatchObject({
      type: 'book',
      authors: [{ family: 'Green', given: 'Alice' }],
      title: 'Principles of Design',
      publisher: 'North Press',
      year: '2019',
    })
  })
})

describe('document reference list rule parser', () => {
  it('parses Korean academic, APA, Chicago, IEEE, and MLA lines and isolates unparsed lines', () => {
    const lines = [
      '1. 홍길동(2020). 실천교육학의 이해. 학지사.',
      '2. 홍길동, 김철수(2021). 협력 학습의 효과 분석. 한국교육학연구, 12(3), 45-67.',
      '(3) 이영희(2019). 디지털 글쓰기 지도 방안. 박사학위논문, 한국대학교.',
      '[4] Smith, J. A., & Doe, B. (2020). Cognitive load in reading. Journal of Applied Psychology, 12(3), 45-67. https://doi.org/10.1234/jap.2020.001',
      'Smith, J. A. (2018). Foundations of research design. Academic Press.',
      '[5] J. A. Smith and B. Doe, "Signal processing methods," IEEE Trans. Signal Process., vol. 68, no. 4, pp. 1020-1035, 2020.',
      'Miller, Sarah. 2021. "Urban Planning Trends." Journal of Urban Studies 15 (2): 100-120.',
      'Brown, Thomas. "Modern Literary Forms." Literary Review, vol. 8, no. 2, 2021, pp. 30-48.',
      '이 줄은 형식이 맞지 않아 미파싱으로 남아야 합니다',
      'incomplete fragment',
    ]

    const res = parseDocumentReferenceLines(lines)
    expect(res.ok).toBe(true)
    if (!res.ok) return

    expect(res.parsed).toHaveLength(8)
    expect(res.unparsed).toHaveLength(2)
    expect(res.unparsed.map((u) => u.lineIndex)).toEqual([8, 9])

    expect(res.parsed[0].entry).toMatchObject({
      type: 'book',
      authors: [{ literal: '홍길동' }],
      year: '2020',
      title: '실천교육학의 이해',
      publisher: '학지사',
      language: 'ko',
      source: 'document',
      verified: true,
    })

    expect(res.parsed[1].entry).toMatchObject({
      type: 'article',
      authors: [{ literal: '홍길동' }, { literal: '김철수' }],
      year: '2021',
      title: '협력 학습의 효과 분석',
      containerTitle: '한국교육학연구',
      volume: '12',
      issue: '3',
      pages: '45-67',
    })

    expect(res.parsed[2].entry).toMatchObject({
      type: 'thesis',
      authors: [{ literal: '이영희' }],
      year: '2019',
      title: '디지털 글쓰기 지도 방안',
      degree: '박사학위논문',
      institution: '한국대학교',
    })

    expect(res.parsed[3].entry).toMatchObject({
      type: 'article',
      authors: [
        { family: 'Smith', given: 'J. A.' },
        { family: 'Doe', given: 'B.' },
      ],
      year: '2020',
      title: 'Cognitive load in reading',
      containerTitle: 'Journal of Applied Psychology',
      volume: '12',
      issue: '3',
      pages: '45-67',
      doi: '10.1234/jap.2020.001',
    })

    expect(res.parsed[4].entry).toMatchObject({
      type: 'book',
      authors: [{ family: 'Smith', given: 'J. A.' }],
      year: '2018',
      title: 'Foundations of research design',
      publisher: 'Academic Press',
    })

    expect(res.parsed[5].entry).toMatchObject({
      type: 'article',
      authors: [
        { family: 'Smith', given: 'J. A.' },
        { family: 'Doe', given: 'B.' },
      ],
      title: 'Signal processing methods',
      containerTitle: 'IEEE Trans. Signal Process.',
      volume: '68',
      issue: '4',
      pages: '1020-1035',
      year: '2020',
    })

    expect(res.parsed[6].entry).toMatchObject({
      type: 'article',
      authors: [{ family: 'Miller', given: 'Sarah' }],
      year: '2021',
      title: 'Urban Planning Trends',
      containerTitle: 'Journal of Urban Studies',
      volume: '15',
      issue: '2',
      pages: '100-120',
    })

    expect(res.parsed[7].entry).toMatchObject({
      type: 'article',
      authors: [{ family: 'Brown', given: 'Thomas' }],
      year: '2021',
      title: 'Modern Literary Forms',
      containerTitle: 'Literary Review',
      volume: '8',
      issue: '2',
      pages: '30-48',
    })
  })
})

describe('duplicate detection and import preview planning', () => {
  it('normalizes DOIs and titles consistently', () => {
    expect(normalizeDoi('https://doi.org/10.1234/ABC.2020')).toBe('10.1234/abc.2020')
    expect(normalizeDoi('http://dx.doi.org/10.1234/ABC.2020.')).toBe('10.1234/abc.2020')
    expect(normalizeDoi('DOI: 10.1234/ABC.2020')).toBe('10.1234/abc.2020')
    expect(normalizeDoi('')).toBe('')

    expect(normalizeTitleForMatch('  실천교육학의 이해: 이론과 실제!  ')).toBe(
      '실천교육학의 이해 이론과 실제',
    )
    expect(normalizeTitleForMatch('Cognitive Load — A Meta-Analysis (2nd Ed.)')).toBe(
      'cognitive load a meta analysis 2nd ed',
    )
  })

  it('detects duplicates by DOI and by title+year with configurable toggles', () => {
    const existing = makeEntry({
      key: 'smith2020',
      authors: [{ family: 'Smith', given: 'John' }],
      year: '2020',
      title: 'Cognitive Load: A Review',
      doi: 'https://doi.org/10.1234/CL.2020',
    })

    const sameDoiDiffTitle = makeEntry({
      key: 'other2020',
      year: '2020',
      title: 'Different Subtitle',
      doi: 'doi:10.1234/cl.2020',
    })
    expect(isDuplicateEntry(sameDoiDiffTitle, existing)).toEqual({
      isDuplicate: true,
      matchReason: 'doi',
    })
    expect(isDuplicateEntry(sameDoiDiffTitle, existing, { matchByDoi: false })).toEqual({
      isDuplicate: false,
      matchReason: null,
    })

    const sameTitleYear = makeEntry({
      key: 'smith2020_alt',
      year: '2020',
      title: 'cognitive load a review!',
    })
    expect(isDuplicateEntry(sameTitleYear, existing)).toEqual({
      isDuplicate: true,
      matchReason: 'title_year',
    })
    expect(isDuplicateEntry(sameTitleYear, existing, { matchByTitleYear: false })).toEqual({
      isDuplicate: false,
      matchReason: null,
    })

    const diffYear = makeEntry({
      key: 'smith2021',
      year: '2021',
      title: 'Cognitive Load: A Review',
    })
    expect(isDuplicateEntry(diffYear, existing)).toEqual({
      isDuplicate: false,
      matchReason: null,
    })
  })

  it('plans import preview with non-colliding keys and intra-batch deduplication', () => {
    const existing = [
      makeEntry({
        id: 'bib_smith2020',
        key: 'smith2020',
        authors: [{ family: 'Smith', given: 'John' }],
        year: '2020',
        title: 'Existing Study',
        doi: '10.1000/existing',
      }),
    ]

    const candidates = [
      // Duplicate of existing by DOI
      makeEntry({
        key: 'dup_doi',
        year: '2020',
        title: 'Existing Study (Preprint)',
        doi: 'https://doi.org/10.1000/EXISTING',
      }),
      // Unique entry that shares the same key as existing -> must get a non-colliding key
      makeEntry({
        key: 'smith2020',
        authors: [{ family: 'Smith', given: 'John' }],
        year: '2020',
        title: 'Second Unique Study',
      }),
      // Duplicate of the second candidate within the same batch by title+year
      makeEntry({
        key: 'smith2020_copy',
        authors: [{ family: 'Smith', given: 'John' }],
        year: '2020',
        title: 'Second Unique Study.',
      }),
      // Distinct Korean entry
      makeEntry({
        key: '홍길동2022',
        authors: ['홍길동'],
        year: '2022',
        title: '새로운 연구',
      }),
    ]

    const plan = planImportPreview(candidates, existing)
    expect(plan.totalCandidates).toBe(4)
    expect(plan.toAdd).toHaveLength(2)
    expect(plan.toAdd[0].key).toBe('smith2020a')
    expect(plan.toAdd[0].id).not.toBe('bib_smith2020')
    expect(plan.toAdd[1].key).toBe('홍길동2022')

    expect(plan.duplicates).toHaveLength(2)
    expect(plan.duplicates[0]).toMatchObject({
      candidateIndex: 0,
      existingKey: 'smith2020',
      existingId: 'bib_smith2020',
      matchReason: 'doi',
      source: 'existing',
    })
    expect(plan.duplicates[1]).toMatchObject({
      candidateIndex: 2,
      existingKey: 'smith2020a',
      matchReason: 'title_year',
      source: 'batch',
    })

    const dupList = findDuplicateEntries(candidates, existing)
    expect(dupList).toHaveLength(2)
  })
})
