/**
 * Unit tests for the pure citation data model, key helpers, sorting,
 * disambiguation, and bibliography / in-text formatting module.
 */
import { describe, expect, it } from 'vitest'
import {
  BIBLIOGRAPHY_HANGING_INDENT_PT,
  CITATION_STYLES,
  DEFAULT_BIBLIOGRAPHY_TITLE_EN,
  DEFAULT_BIBLIOGRAPHY_TITLE_KO,
  DEFAULT_CITATION_STYLE,
  ENTRY_TYPES,
  IEEE_HANGING_INDENT_PT,
  assignDisambiguationSuffixes,
  assignIeeeNumbers,
  assignMlaShortTitles,
  compareSortOrder,
  detectEntryLanguage,
  findMissingDisambiguation,
  formatAuthorDisplay,
  formatBibliographyEntry,
  formatBibliographyList,
  formatBibliographyText,
  formatEdition,
  formatInTextCitation,
  formatLocator,
  generateCitationKey,
  getBibliographyHangingIndentPt,
  isCitationStyle,
  isEntryType,
  normalizeAuthor,
  normalizeBibEntry,
  renameBibEntryKey,
  resolveEntryByKey,
  sanitizeCitationKey,
  sortBibliographyEntries,
  type BibEntry,
  type BibEntryType,
  type CitationStyle,
} from '../studio-plugin/citation-styles.mjs'

function makeEntry(overrides: Record<string, unknown>): BibEntry {
  return normalizeBibEntry(overrides)
}

describe('constants and type guards', () => {
  it('exposes the expected entry types, citation styles, and indent constants', () => {
    expect(ENTRY_TYPES).toEqual([
      'article',
      'book',
      'chapter',
      'thesis',
      'report',
      'conference',
      'webpage',
      'other',
    ])
    expect(CITATION_STYLES).toEqual(['apa', 'chicago', 'mla', 'ieee'])
    expect(DEFAULT_CITATION_STYLE).toBe('apa')
    expect(BIBLIOGRAPHY_HANGING_INDENT_PT).toBe(24)
    expect(IEEE_HANGING_INDENT_PT).toBe(20)
    expect(DEFAULT_BIBLIOGRAPHY_TITLE_KO).toBe('참고문헌')
    expect(DEFAULT_BIBLIOGRAPHY_TITLE_EN).toBe('References')

    expect(getBibliographyHangingIndentPt('apa')).toBe(24)
    expect(getBibliographyHangingIndentPt('chicago')).toBe(24)
    expect(getBibliographyHangingIndentPt('mla')).toBe(24)
    expect(getBibliographyHangingIndentPt('ieee')).toBe(20)

    expect(isCitationStyle('apa')).toBe(true)
    expect(isCitationStyle('ieee')).toBe(true)
    expect(isCitationStyle('vancouver')).toBe(false)
    expect(isEntryType('article')).toBe(true)
    expect(isEntryType('patent')).toBe(false)
  })
})

describe('author normalization and display', () => {
  it('normalizes Korean, Western, particle, and organizational authors cleanly', () => {
    expect(normalizeAuthor('홍길동')).toEqual({ literal: '홍길동' })
    expect(normalizeAuthor('Smith, John A.')).toEqual({ family: 'Smith', given: 'John A.' })
    expect(normalizeAuthor('John A. Smith')).toEqual({ family: 'Smith', given: 'John A.' })
    expect(normalizeAuthor('Ludwig van Beethoven')).toEqual({
      family: 'van Beethoven',
      given: 'Ludwig',
    })
    expect(normalizeAuthor('UNESCO')).toEqual({ literal: 'UNESCO' })
    expect(normalizeAuthor({ literal: 'World Health Organization', isOrganization: true })).toEqual(
      {
        literal: 'World Health Organization',
        isOrganization: true,
      },
    )
    expect(normalizeAuthor({ family: '홍', given: '길동' })).toEqual({
      family: '홍',
      given: '길동',
    })
    expect(normalizeAuthor('   ')).toBeNull()
    expect(normalizeAuthor(null)).toBeNull()
  })

  it('formats author display without inverting Korean names', () => {
    expect(formatAuthorDisplay('홍길동', 'ko')).toBe('홍길동')
    expect(formatAuthorDisplay({ family: '홍', given: '길동' }, 'ko')).toBe('홍길동')
    expect(formatAuthorDisplay({ family: 'Smith', given: 'John A.' }, 'en')).toBe('John A. Smith')
    expect(formatAuthorDisplay({ literal: '교육부', isOrganization: true }, 'ko')).toBe('교육부')
    expect(
      formatAuthorDisplay({ literal: 'World Health Organization', isOrganization: true }, 'en'),
    ).toBe('World Health Organization')
  })
})

describe('language detection, key generation, normalization, and oldKeys resolution', () => {
  it('auto-detects Korean vs English and honors explicit user override', () => {
    expect(detectEntryLanguage({ title: '실천교육학의 이해' })).toBe('ko')
    expect(detectEntryLanguage({ authors: ['홍길동'], title: 'Practice Theory' })).toBe('ko')
    expect(
      detectEntryLanguage({ title: 'Applied Research Methods', authors: ['John Smith'] }),
    ).toBe('en')
    expect(detectEntryLanguage({ title: '실천교육학의 이해', language: 'en' })).toBe('en')
    expect(detectEntryLanguage({ title: 'Applied Research Methods', language: 'ko' })).toBe('ko')
  })

  it('generates bookmark-safe citation keys with collision suffixes', () => {
    expect(sanitizeCitationKey('홍길동: 2020/a%b')).toBe('홍길동2020ab')
    expect(generateCitationKey({ authors: ['홍길동'], year: '2020' })).toBe('홍길동2020')
    expect(generateCitationKey({ authors: ['John Smith'], year: '2020' })).toBe('smith2020')
    expect(
      generateCitationKey({
        authors: [{ literal: '교육부', isOrganization: true }],
        year: '2023',
      }),
    ).toBe('교육부2023')
    expect(generateCitationKey({ title: '무저자 문서', year: '2021' })).toBe('무명2021')
    expect(generateCitationKey({ title: 'Untitled Note', year: '2021' })).toBe('anon2021')

    const existing = new Set(['홍길동2020', '홍길동2020a'])
    expect(generateCitationKey({ authors: ['홍길동'], year: '2020' }, existing)).toBe('홍길동2020b')
  })

  it('normalizes entries, renames keys preserving oldKeys, and resolves both current and old keys', () => {
    const entry = normalizeBibEntry({
      type: 'article',
      authors: ['  홍길동  '],
      year: 2020,
      title: '  교육 혁신  ',
      volume: 12,
      issue: 3,
      tags: ['교육', ' 교육 ', '정책'],
      oldKeys: ['old:key', 'oldkey'],
      verified: false,
      source: 'ai',
      memo: 'https://example.org/source',
    })

    expect(entry.key).toBe('홍길동2020')
    expect(entry.year).toBe('2020')
    expect(entry.volume).toBe('12')
    expect(entry.issue).toBe('3')
    expect(entry.language).toBe('ko')
    expect(entry.tags).toEqual(['교육', '정책'])
    expect(entry.oldKeys).toEqual(['oldkey'])
    expect(entry.verified).toBe(false)
    expect(entry.source).toBe('ai')

    const renamed = renameBibEntryKey(entry, 'hong2020_new', new Set(['other2020']))
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    expect(renamed.entry.key).toBe('hong2020_new')
    expect(renamed.entry.oldKeys).toContain('홍길동2020')
    expect(renamed.entry.oldKeys).toContain('oldkey')

    const dup = renameBibEntryKey(renamed.entry, 'other2020', new Set(['other2020']))
    expect(dup).toEqual({ ok: false, reason: 'duplicate_key' })

    const invalid = renameBibEntryKey(renamed.entry, ':::')
    expect(invalid).toEqual({ ok: false, reason: 'invalid_key' })

    const list = [renamed.entry]
    expect(resolveEntryByKey(list, 'hong2020_new')?.id).toBe(entry.id)
    expect(resolveEntryByKey(list, '홍길동2020')?.id).toBe(entry.id)
    expect(resolveEntryByKey(list, 'oldkey')?.id).toBe(entry.id)
    expect(resolveEntryByKey(list, 'missing')).toBeNull()
  })
})

describe('Korean academic formatting across all four citation styles', () => {
  const koBook = makeEntry({
    type: 'book',
    authors: ['홍길동'],
    year: '2020',
    title: '실천교육학의 이해',
    publisher: '학지사',
  })

  const koArticle = makeEntry({
    type: 'article',
    authors: ['홍길동'],
    year: '2020',
    title: '제목',
    containerTitle: '학술지명',
    volume: '12',
    issue: '3',
    pages: '45-67',
  })

  it('matches the fixed Korean book and journal examples with no corner brackets or italic/bold runs', () => {
    for (const style of ['apa', 'chicago', 'mla'] as const) {
      const bookFmt = formatBibliographyEntry(koBook, style)
      expect(bookFmt.text).toBe('홍길동(2020). 실천교육학의 이해. 학지사.')
      expect(bookFmt.segments).toEqual([{ text: '홍길동(2020). 실천교육학의 이해. 학지사.' }])
      expect(bookFmt.text).not.toContain('『')
      expect(bookFmt.text).not.toContain('』')

      const artFmt = formatBibliographyEntry(koArticle, style)
      expect(artFmt.text).toBe('홍길동(2020). 제목. 학술지명, 12(3), 45-67.')
      expect(artFmt.segments).toEqual([{ text: '홍길동(2020). 제목. 학술지명, 12(3), 45-67.' }])
      expect(artFmt.text).not.toContain('『')
      expect(artFmt.text).not.toContain('』')
    }

    const ieeeBook = formatBibliographyEntry(koBook, 'ieee', { ieeeNumber: 1 })
    expect(ieeeBook.text).toBe('[1] 홍길동(2020). 실천교육학의 이해. 학지사.')
    expect(ieeeBook.segments.every((s) => !s.italic)).toBe(true)

    const ieeeArt = formatBibliographyEntry(koArticle, 'ieee', { ieeeNumber: 2 })
    expect(ieeeArt.text).toBe('[2] 홍길동(2020). 제목. 학술지명, 12(3), 45-67.')
    expect(ieeeArt.text).not.toContain('『')
  })

  it('formats Korean structured family/given names without commas or inversion', () => {
    const structuredKo = makeEntry({
      type: 'book',
      authors: [
        { family: '홍', given: '길동' },
        { family: '김', given: '철수' },
      ],
      year: '2021',
      title: '연구방법론',
      publisher: '교육과학사',
    })
    expect(formatBibliographyText(structuredKo, 'apa')).toBe(
      '홍길동, 김철수(2021). 연구방법론. 교육과학사.',
    )
    expect(formatInTextCitation(structuredKo, 'apa')).toBe('(홍길동, 김철수, 2021)')
  })

  it('formats all eight Korean entry types cleanly', () => {
    const koEntries: Record<BibEntryType, BibEntry> = {
      article: koArticle,
      book: koBook,
      chapter: makeEntry({
        type: 'chapter',
        authors: ['홍길동'],
        editors: ['김철수'],
        year: '2020',
        title: '교육과정의 변화',
        containerTitle: '현대교육학 개론',
        pages: '10-30',
        publisher: '학지사',
      }),
      thesis: makeEntry({
        type: 'thesis',
        authors: ['홍길동'],
        year: '2020',
        title: '학습동기 모형 연구',
        degree: '박사학위논문',
        institution: '한국대학교',
      }),
      report: makeEntry({
        type: 'report',
        authors: [{ literal: '교육부', isOrganization: true }],
        year: '2023',
        title: '교육정책 연차보고서',
        institution: '교육부',
      }),
      conference: makeEntry({
        type: 'conference',
        authors: ['홍길동'],
        year: '2022',
        title: '디지털 전환과 수업 설계',
        containerTitle: '한국교육학회 학술대회',
        place: '서울',
        pages: '15-24',
      }),
      webpage: makeEntry({
        type: 'webpage',
        authors: [{ literal: '교육부', isOrganization: true }],
        year: '2025',
        title: '고교학점제 안내',
        containerTitle: '교육부 누리집',
        accessed: '2026-11-20',
        url: 'https://example.org/guide',
      }),
      other: makeEntry({
        type: 'other',
        authors: ['홍길동'],
        year: '2024',
        title: '연구 자료집',
        institution: '한국교육연구소',
      }),
    }

    expect(formatBibliographyText(koEntries.chapter, 'apa')).toBe(
      '홍길동(2020). 교육과정의 변화. 김철수(편), 현대교육학 개론 (10-30쪽). 학지사.',
    )
    expect(formatBibliographyText(koEntries.thesis, 'apa')).toBe(
      '홍길동(2020). 학습동기 모형 연구. 한국대학교 박사학위논문.',
    )
    expect(formatBibliographyText(koEntries.report, 'apa')).toBe(
      '교육부(2023). 교육정책 연차보고서.',
    )
    expect(formatBibliographyText(koEntries.conference, 'apa')).toBe(
      '홍길동(2022). 디지털 전환과 수업 설계. 한국교육학회 학술대회, 서울, 15-24.',
    )
    expect(formatBibliographyText(koEntries.webpage, 'apa')).toBe(
      '교육부(2025). 고교학점제 안내. 교육부 누리집. 2026-11-20 검색, https://example.org/guide',
    )
    expect(formatBibliographyText(koEntries.other, 'apa')).toBe(
      '홍길동(2024). 연구 자료집. 한국교육연구소.',
    )
  })
})

describe('English bibliography formatting across all four styles and eight types', () => {
  const enArticle = makeEntry({
    type: 'article',
    authors: ['Smith, John A.', 'Doe, Barbara'],
    year: '2020',
    title: 'Article title',
    containerTitle: 'Journal Name',
    volume: '12',
    issue: '3',
    pages: '45-67',
    doi: '10.1234/example.2020',
  })

  const enBook = makeEntry({
    type: 'book',
    authors: ['Smith, John A.'],
    year: '2020',
    title: 'Book Title',
    edition: '2nd ed.',
    place: 'New York',
    publisher: 'Academic Press',
  })

  const enChapter = makeEntry({
    type: 'chapter',
    authors: ['Smith, John A.'],
    editors: ['Editor, E.'],
    year: '2020',
    title: 'Chapter title',
    containerTitle: 'Edited Book Title',
    pages: '10-30',
    place: 'Boston',
    publisher: 'Academic Press',
  })

  const enThesis = makeEntry({
    type: 'thesis',
    authors: ['Smith, John A.'],
    year: '2020',
    title: 'Thesis title',
    degree: 'Doctoral dissertation',
    institution: 'Example University',
  })

  const enReport = makeEntry({
    type: 'report',
    authors: [{ literal: 'World Health Organization', isOrganization: true }],
    year: '2021',
    title: 'Annual Health Report',
    institution: 'World Health Organization',
  })

  const enConference = makeEntry({
    type: 'conference',
    authors: ['Smith, John A.'],
    year: '2022',
    title: 'Paper title',
    containerTitle: 'Proceedings of the Annual Symposium',
    pages: '10-20',
    publisher: 'Symposium Press',
  })

  const enWebpage = makeEntry({
    type: 'webpage',
    authors: ['Smith, John A.'],
    year: '2024',
    title: 'Page title',
    containerTitle: 'Example Portal',
    accessed: '2026-11-20',
    url: 'https://example.org/page',
  })

  const enOther = makeEntry({
    type: 'other',
    authors: ['Smith, John A.'],
    year: '2023',
    title: 'Dataset description',
    containerTitle: 'Open Archive',
    institution: 'Research Lab',
  })

  it('formats APA 7th English entries with italic container segments', () => {
    const art = formatBibliographyEntry(enArticle, 'apa')
    expect(art.text).toBe(
      'Smith, J. A., & Doe, B. (2020). Article title. Journal Name, 12(3), 45-67. https://doi.org/10.1234/example.2020',
    )
    expect(art.segments.some((s) => s.italic && s.text === 'Journal Name')).toBe(true)
    expect(art.segments.some((s) => s.italic && s.text === '12')).toBe(true)
    expect(art.segments.map((s) => s.text).join('')).toBe(art.text)

    expect(formatBibliographyText(enBook, 'apa')).toBe(
      'Smith, J. A. (2020). Book Title (2nd ed.). Academic Press.',
    )
    expect(formatBibliographyText(enChapter, 'apa')).toBe(
      'Smith, J. A. (2020). Chapter title. In E. Editor (Ed.), Edited Book Title (pp. 10-30). Academic Press.',
    )
    expect(formatBibliographyText(enThesis, 'apa')).toBe(
      'Smith, J. A. (2020). Thesis title [Doctoral dissertation, Example University].',
    )
    expect(formatBibliographyText(enReport, 'apa')).toBe(
      'World Health Organization. (2021). Annual Health Report.',
    )
    expect(formatBibliographyText(enConference, 'apa')).toBe(
      'Smith, J. A. (2022). Paper title. In Proceedings of the Annual Symposium (pp. 10-20). Symposium Press.',
    )
    expect(formatBibliographyText(enWebpage, 'apa')).toBe(
      'Smith, J. A. (2024). Page title. Example Portal. Retrieved November 20, 2026, from https://example.org/page',
    )
    expect(formatBibliographyText(enOther, 'apa')).toBe(
      'Smith, J. A. (2023). Dataset description. Open Archive. Research Lab.',
    )
  })

  it('formats Chicago Author-Date English entries', () => {
    expect(formatBibliographyText(enArticle, 'chicago')).toBe(
      'Smith, John A., and Barbara Doe. 2020. "Article title." Journal Name 12 (3): 45-67. https://doi.org/10.1234/example.2020',
    )
    expect(formatBibliographyText(enBook, 'chicago')).toBe(
      'Smith, John A. 2020. Book Title. 2nd ed. New York: Academic Press.',
    )
    expect(formatBibliographyText(enChapter, 'chicago')).toBe(
      'Smith, John A. 2020. "Chapter title." In Edited Book Title, edited by E. Editor, 10-30. Boston: Academic Press.',
    )
    expect(formatBibliographyText(enThesis, 'chicago')).toBe(
      'Smith, John A. 2020. "Thesis title." Doctoral dissertation, Example University.',
    )
    expect(formatBibliographyText(enReport, 'chicago')).toBe(
      'World Health Organization. 2021. Annual Health Report. World Health Organization.',
    )
    expect(formatBibliographyText(enConference, 'chicago')).toBe(
      'Smith, John A. 2022. "Paper title." In Proceedings of the Annual Symposium, 10-20. Symposium Press.',
    )
    expect(formatBibliographyText(enWebpage, 'chicago')).toBe(
      'Smith, John A. 2024. "Page title." Example Portal. Accessed 2026-11-20. https://example.org/page',
    )
    expect(formatBibliographyText(enOther, 'chicago')).toBe(
      'Smith, John A. 2023. Dataset description. Open Archive. Research Lab.',
    )
  })

  it('formats MLA 9th English entries', () => {
    const noDoiArticle = makeEntry({ ...enArticle, doi: undefined })
    expect(formatBibliographyText(noDoiArticle, 'mla')).toBe(
      'Smith, John A., and Barbara Doe. "Article title." Journal Name, vol. 12, no. 3, 2020, pp. 45-67.',
    )
    expect(formatBibliographyText(enBook, 'mla')).toBe(
      'Smith, John A. Book Title. 2nd ed., Academic Press, 2020.',
    )
    expect(formatBibliographyText(enChapter, 'mla')).toBe(
      'Smith, John A. "Chapter title." Edited Book Title, edited by E. Editor, Academic Press, 2020, pp. 10-30.',
    )
    expect(formatBibliographyText(enThesis, 'mla')).toBe(
      'Smith, John A. Thesis title. 2020, Example University, Doctoral dissertation.',
    )
    expect(formatBibliographyText(enReport, 'mla')).toBe(
      'World Health Organization. Annual Health Report. World Health Organization, 2021.',
    )
    expect(formatBibliographyText(enConference, 'mla')).toBe(
      'Smith, John A. "Paper title." Proceedings of the Annual Symposium, Symposium Press, 2022, pp. 10-20.',
    )
    expect(formatBibliographyText(enWebpage, 'mla')).toBe(
      'Smith, John A. "Page title." Example Portal, 2024, https://example.org/page. Accessed 2026-11-20.',
    )
    expect(formatBibliographyText(enOther, 'mla')).toBe(
      'Smith, John A. Dataset description. Open Archive, Research Lab, 2023.',
    )
  })

  it('formats IEEE English entries with [n] prefixes', () => {
    const noDoiArticle = makeEntry({ ...enArticle, doi: undefined })
    expect(formatBibliographyText(noDoiArticle, 'ieee', { ieeeNumber: 1 })).toBe(
      '[1] J. A. Smith and B. Doe, "Article title," Journal Name, vol. 12, no. 3, pp. 45-67, 2020.',
    )
    expect(formatBibliographyText(enArticle, 'ieee', { ieeeNumber: 1 })).toBe(
      '[1] J. A. Smith and B. Doe, "Article title," Journal Name, vol. 12, no. 3, pp. 45-67, 2020. doi: 10.1234/example.2020.',
    )
    expect(formatBibliographyText(enBook, 'ieee', { ieeeNumber: 2 })).toBe(
      '[2] J. A. Smith, Book Title, 2nd ed. New York: Academic Press, 2020.',
    )
    expect(formatBibliographyText(enChapter, 'ieee', { ieeeNumber: 3 })).toBe(
      '[3] J. A. Smith, "Chapter title," in Edited Book Title, E. Editor, Ed. Boston: Academic Press, 2020, pp. 10-30.',
    )
    expect(formatBibliographyText(enThesis, 'ieee', { ieeeNumber: 4 })).toBe(
      '[4] J. A. Smith, "Thesis title," Doctoral dissertation, Example University, 2020.',
    )
    expect(formatBibliographyText(enReport, 'ieee', { ieeeNumber: 5 })).toBe(
      '[5] World Health Organization, "Annual Health Report," World Health Organization, 2021.',
    )
    expect(formatBibliographyText(enConference, 'ieee', { ieeeNumber: 6 })).toBe(
      '[6] J. A. Smith, "Paper title," in Proceedings of the Annual Symposium, 2022, pp. 10-20.',
    )
    expect(formatBibliographyText(enWebpage, 'ieee', { ieeeNumber: 7 })).toBe(
      '[7] J. A. Smith, "Page title," Example Portal, 2024. [Online]. Available: https://example.org/page (accessed 2026-11-20).',
    )
    expect(formatBibliographyText(enOther, 'ieee', { ieeeNumber: 8 })).toBe(
      '[8] J. A. Smith, "Dataset description," Open Archive, Research Lab, 2023.',
    )
  })

  it('handles multi-author truncation rules, question titles, and missing authors without double periods', () => {
    const manyAuthors = Array.from({ length: 22 }, (_, i) => `Author${i + 1}, Given`)
    const megaPaper = makeEntry({
      type: 'article',
      authors: manyAuthors,
      year: '2024',
      title: 'Does scale matter?',
      containerTitle: 'Big Journal',
    })

    const apa = formatBibliographyText(megaPaper, 'apa')
    expect(apa).toContain('Author19, G., ... Author22, G. (2024). Does scale matter? Big Journal.')
    expect(apa).not.toContain('?.')
    expect(apa).not.toMatch(/(?<!\.)\.\.(?!\.)/)

    const chicago = formatBibliographyText(megaPaper, 'chicago')
    expect(chicago).toContain('et al. 2024. "Does scale matter?"')
    expect(chicago).not.toContain('?.')

    const mla = formatBibliographyText(megaPaper, 'mla')
    expect(mla).toContain('Author1, Given, et al. "Does scale matter?"')

    const ieee = formatBibliographyText(megaPaper, 'ieee', { ieeeNumber: 1 })
    expect(ieee).toContain('[1] G. Author1 et al., "Does scale matter?" Big Journal, 2024.')

    const anonEntry = makeEntry({
      type: 'book',
      year: '2019',
      title: 'Anonymous Almanac',
      publisher: 'Civic Press',
    })
    expect(formatBibliographyText(anonEntry, 'apa')).toBe('Anonymous Almanac. (2019). Civic Press.')
  })
})

describe('in-text citations, locators, and multi-entry grouping', () => {
  const ko1 = makeEntry({ key: '홍길동2020', authors: ['홍길동'], year: '2020', title: '논문' })
  const ko2 = makeEntry({
    key: '홍김2021',
    authors: ['홍길동', '김철수'],
    year: '2021',
    title: '공동연구',
  })
  const ko3 = makeEntry({
    key: '홍외2022',
    authors: ['홍길동', '김철수', '이영희'],
    year: '2022',
    title: '다인연구',
  })
  const en1 = makeEntry({ key: 'smith2020', authors: ['Smith, John'], year: '2020', title: 'One' })
  const en2 = makeEntry({
    key: 'smithdoe2021',
    authors: ['Smith, John', 'Doe, Jane'],
    year: '2021',
    title: 'Two',
  })
  const en3 = makeEntry({
    key: 'smithetal2022',
    authors: ['Smith, John', 'Doe, Jane', 'Lee, Min'],
    year: '2022',
    title: 'Three',
  })

  it('formats locators cleanly without doubling existing prefixes', () => {
    expect(formatLocator('23', 'apa', 'ko')).toBe('23쪽')
    expect(formatLocator('23-25', 'apa', 'ko')).toBe('23-25쪽')
    expect(formatLocator('23쪽', 'apa', 'ko')).toBe('23쪽')
    expect(formatLocator('제2장', 'apa', 'ko')).toBe('제2장')

    expect(formatLocator('23', 'apa', 'en')).toBe('p. 23')
    expect(formatLocator('23-25', 'apa', 'en')).toBe('pp. 23-25')
    expect(formatLocator('p. 23', 'apa', 'en')).toBe('p. 23')
    expect(formatLocator('ch. 2', 'apa', 'en')).toBe('ch. 2')

    expect(formatLocator('23', 'chicago', 'en')).toBe('23')
    expect(formatLocator('23-25', 'mla', 'en')).toBe('23-25')
    expect(formatLocator('23', 'ieee', 'en')).toBe('p. 23')
  })

  it('formats single parenthetical and narrative citations across all four styles', () => {
    // APA
    expect(formatInTextCitation(ko1, 'apa')).toBe('(홍길동, 2020)')
    expect(formatInTextCitation(ko1, 'apa', { mode: 'narrative' })).toBe('홍길동(2020)')
    expect(formatInTextCitation({ entry: ko1, locator: '23' }, 'apa')).toBe('(홍길동, 2020, 23쪽)')
    expect(formatInTextCitation(ko2, 'apa')).toBe('(홍길동, 김철수, 2021)')
    expect(formatInTextCitation(ko3, 'apa')).toBe('(홍길동 외, 2022)')

    expect(formatInTextCitation(en1, 'apa')).toBe('(Smith, 2020)')
    expect(formatInTextCitation(en1, 'apa', { mode: 'narrative' })).toBe('Smith (2020)')
    expect(formatInTextCitation({ entry: en1, locator: '23-25' }, 'apa')).toBe(
      '(Smith, 2020, pp. 23-25)',
    )
    expect(formatInTextCitation(en2, 'apa')).toBe('(Smith & Doe, 2021)')
    expect(formatInTextCitation(en2, 'apa', { mode: 'narrative' })).toBe('Smith and Doe (2021)')
    expect(formatInTextCitation(en3, 'apa')).toBe('(Smith et al., 2022)')

    // Chicago
    expect(formatInTextCitation(ko1, 'chicago')).toBe('(홍길동, 2020)')
    expect(formatInTextCitation({ entry: ko1, locator: '23' }, 'chicago')).toBe(
      '(홍길동, 2020, 23쪽)',
    )
    expect(formatInTextCitation(en1, 'chicago')).toBe('(Smith 2020)')
    expect(formatInTextCitation({ entry: en1, locator: '23' }, 'chicago')).toBe('(Smith 2020, 23)')
    expect(formatInTextCitation(en2, 'chicago')).toBe('(Smith and Doe 2021)')
    expect(formatInTextCitation(en3, 'chicago')).toBe('(Smith et al. 2022)')
    expect(formatInTextCitation(en1, 'chicago', { mode: 'narrative' })).toBe('Smith (2020)')

    // MLA (Korean entries always follow Korean author-year format across all styles)
    expect(formatInTextCitation(ko1, 'mla')).toBe('(홍길동, 2020)')
    expect(formatInTextCitation({ entry: ko1, locator: '23' }, 'mla')).toBe('(홍길동, 2020, 23쪽)')
    expect(formatInTextCitation(ko1, 'mla', { mode: 'narrative' })).toBe('홍길동(2020)')
    expect(formatInTextCitation(ko2, 'mla')).toBe('(홍길동, 김철수, 2021)')
    expect(formatInTextCitation(ko3, 'mla')).toBe('(홍길동 외, 2022)')
    expect(formatInTextCitation(en1, 'mla')).toBe('(Smith)')
    expect(formatInTextCitation({ entry: en1, locator: '23' }, 'mla')).toBe('(Smith 23)')
    expect(formatInTextCitation(en2, 'mla')).toBe('(Smith and Doe)')
    expect(formatInTextCitation(en3, 'mla')).toBe('(Smith et al.)')
    expect(formatInTextCitation({ entry: en1, locator: '23' }, 'mla', { mode: 'narrative' })).toBe(
      'Smith (23)',
    )

    // IEEE
    const ieeeNums = new Map([
      ['홍길동2020', 1],
      ['smith2020', 2],
    ])
    expect(formatInTextCitation(ko1, 'ieee', { ieeeNumbers: ieeeNums })).toBe('[1]')
    expect(
      formatInTextCitation({ entry: ko1, locator: '23' }, 'ieee', { ieeeNumbers: ieeeNums }),
    ).toBe('[1, 23쪽]')
    expect(formatInTextCitation(ko1, 'ieee', { mode: 'narrative', ieeeNumbers: ieeeNums })).toBe(
      '홍길동[1]',
    )
    expect(
      formatInTextCitation({ entry: en1, locator: '23' }, 'ieee', { ieeeNumbers: ieeeNums }),
    ).toBe('[2, p. 23]')
    expect(formatInTextCitation(en1, 'ieee', { mode: 'narrative', ieeeNumbers: ieeeNums })).toBe(
      'Smith [2]',
    )
  })

  it('orders grouped citations, merges same-author years in APA, and compresses IEEE ranges', () => {
    const hong2019 = makeEntry({
      key: '홍길동2019',
      authors: ['홍길동'],
      year: '2019',
      title: '가',
    })
    const kim2018 = makeEntry({ key: '김철수2018', authors: ['김철수'], year: '2018', title: '나' })

    // APA: Korean sorted first in Hangul order, same-author years merged, English after Korean
    expect(formatInTextCitation([en1, ko1, hong2019, kim2018], 'apa')).toBe(
      '(김철수, 2018; 홍길동, 2019, 2020; Smith, 2020)',
    )

    // Prefix and suffix preserved
    expect(
      formatInTextCitation(
        [
          { entry: ko1, prefix: '참조:', locator: '12', suffix: '강조 추가' },
          { entry: en1, prefix: 'see' },
        ],
        'apa',
      ),
    ).toBe('(참조: 홍길동, 2020, 12쪽, 강조 추가; see Smith, 2020)')

    // Chicago & MLA grouping
    expect(formatInTextCitation([en1, ko1], 'chicago')).toBe('(홍길동, 2020; Smith 2020)')
    expect(formatInTextCitation([en1, ko1], 'mla')).toBe('(홍길동, 2020; Smith)')

    // IEEE ascending sort + 3+ consecutive range compression
    const ieeeNums = new Map([
      ['홍길동2019', 3],
      ['홍길동2020', 1],
      ['김철수2018', 2],
      ['smith2020', 5],
    ])
    expect(
      formatInTextCitation([en1, hong2019, ko1, kim2018], 'ieee', { ieeeNumbers: ieeeNums }),
    ).toBe('[1]-[3], [5]')
    expect(formatInTextCitation([kim2018, ko1], 'ieee', { ieeeNumbers: ieeeNums })).toBe('[1], [2]')
  })
})

describe('sorting, disambiguation, IEEE numbering, and audit helpers', () => {
  const koKim = makeEntry({ key: '김철수2021', authors: ['김철수'], year: '2021', title: '다' })
  const koHongB = makeEntry({
    key: '홍길동2020_2',
    authors: ['홍길동'],
    year: '2020',
    title: '하늘의 교육',
  })
  const koHongA = makeEntry({
    key: '홍길동2020_1',
    authors: ['홍길동'],
    year: '2020',
    title: '가나다 교육',
  })
  const koHongNd = makeEntry({
    key: '홍길동nd',
    authors: ['홍길동'],
    year: '연도미상',
    title: '미상 자료',
  })
  const enBrown = makeEntry({
    key: 'brown2019',
    authors: ['Brown, Alice'],
    year: '2019',
    title: 'The Zebra Model',
  })
  const enAdams2 = makeEntry({
    key: 'adams2020_2',
    authors: ['Adams, Bob'],
    year: '2020',
    title: 'The Beta Paper',
  })
  const enAdams1 = makeEntry({
    key: 'adams2020_1',
    authors: ['Adams, Bob'],
    year: '2020',
    title: 'An Alpha Study',
  })
  const enAdamsPress = makeEntry({
    key: 'adams_press',
    authors: ['Adams, Bob'],
    year: 'in press',
    title: 'Future Work',
  })

  const unsorted = [enBrown, koHongB, enAdams2, koKim, enAdamsPress, koHongA, koHongNd, enAdams1]

  it('sorts Korean entries first (Hangul order), then English A-Z with year & title ordering', () => {
    const sorted = sortBibliographyEntries(unsorted, 'apa')
    expect(sorted.map((e) => e.key)).toEqual([
      '김철수2021',
      '홍길동nd',
      '홍길동2020_1',
      '홍길동2020_2',
      'adams2020_1',
      'adams2020_2',
      'adams_press',
      'brown2019',
    ])
  })

  it('assigns a/b disambiguation suffixes in sorted title order for author-date styles and none for IEEE', () => {
    const disambig = assignDisambiguationSuffixes(unsorted, 'apa')
    expect(disambig.get('홍길동2020_1')).toBe('a')
    expect(disambig.get('홍길동2020_2')).toBe('b')
    expect(disambig.get('adams2020_1')).toBe('a')
    expect(disambig.get('adams2020_2')).toBe('b')
    expect(disambig.has('김철수2021')).toBe(false)
    expect(disambig.has('brown2019')).toBe(false)

    expect(assignDisambiguationSuffixes(unsorted, 'ieee').size).toBe(0)

    expect(formatInTextCitation([koHongB, koHongA], 'apa', { disambiguation: disambig })).toBe(
      '(홍길동, 2020a, 2020b)',
    )
    expect(formatBibliographyText(koHongA, 'apa', { disambiguation: disambig })).toBe(
      '홍길동(2020a). 가나다 교육.',
    )
  })

  it('sorts and numbers IEEE bibliographies strictly by first appearance and resolves oldKeys', () => {
    const renamed = renameBibEntryKey(enBrown, 'brown2019_v2')
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return

    const pool = [koKim, renamed.entry, koHongA]
    const citedOrder = ['brown2019', '홍길동2020_1', 'brown2019_v2', '김철수2021']

    const numbers = assignIeeeNumbers(citedOrder, pool)
    expect(numbers.get('brown2019_v2')).toBe(1)
    expect(numbers.get('홍길동2020_1')).toBe(2)
    expect(numbers.get('김철수2021')).toBe(3)

    const list = formatBibliographyList(pool, 'ieee', { citedKeysInOrder: citedOrder })
    expect(list.entries.map((e) => e.key)).toEqual(['brown2019_v2', '홍길동2020_1', '김철수2021'])
    expect(list.entries.map((e) => e.number)).toEqual([1, 2, 3])
    expect(list.entries[0].text.startsWith('[1] A. Brown,')).toBe(true)
    expect(list.entries[1].text.startsWith('[2] 홍길동(2020).')).toBe(true)
  })

  it('formats a full sorted bibliography list for every style', () => {
    for (const style of CITATION_STYLES as readonly CitationStyle[]) {
      const result = formatBibliographyList([enBrown, koHongA, koHongB], style, {
        citedKeysInOrder: ['brown2019', '홍길동2020_2', '홍길동2020_1'],
      })
      expect(result.style).toBe(style)
      expect(result.entries).toHaveLength(3)
      for (const item of result.entries) {
        expect(item.text.length).toBeGreaterThan(0)
        expect(item.segments.map((s) => s.text).join('')).toBe(item.text)
      }
    }
  })

  it('detects sort-order mismatches and missing disambiguation suffixes for audit checks', () => {
    const expectedOrder = ['김철수2021', '홍길동2020_1', '홍길동2020_2']
    expect(compareSortOrder(expectedOrder, expectedOrder).inOrder).toBe(true)

    const swapped = compareSortOrder(['홍길동2020_1', '김철수2021', '홍길동2020_2'], expectedOrder)
    expect(swapped.inOrder).toBe(false)
    expect(swapped.mismatches.map((m) => m.key)).toEqual(['홍길동2020_1', '김철수2021'])

    const missing = findMissingDisambiguation(
      [koHongA, koHongB],
      {
        홍길동2020_1: '홍길동(2020a). 가나다 교육.',
        홍길동2020_2: '홍길동(2020). 하늘의 교육.',
      },
      'apa',
    )
    expect(missing).toEqual([
      {
        key: '홍길동2020_2',
        expectedSuffix: 'b',
        expectedToken: '2020b',
        year: '2020',
      },
    ])

    // MLA and IEEE never report missing a/b year suffixes.
    expect(
      findMissingDisambiguation([koHongA, koHongB], { 홍길동2020_1: '홍길동(2020).' }, 'mla'),
    ).toEqual([])
    expect(
      findMissingDisambiguation([koHongA, koHongB], { 홍길동2020_1: '[1] 홍길동(2020).' }, 'ieee'),
    ).toEqual([])
  })
})

describe('MLA short-title disambiguation, edition formatting, and Chicago/APA refinements', () => {
  it('disambiguates English MLA same-author works with short titles and never adds a/b suffixes', () => {
    const smithArticle = makeEntry({
      key: 'smith2020a_src',
      type: 'article',
      authors: ['Smith, John'],
      year: '2020',
      title: 'Climate Policy: A Global Review',
      containerTitle: 'Policy Studies',
      volume: '10',
      pages: '12-30',
    })
    const smithBook = makeEntry({
      key: 'smith2020b_src',
      type: 'book',
      authors: ['Smith, John'],
      year: '2020',
      title: 'World History',
      publisher: 'Academic Press',
    })
    const doeBook = makeEntry({
      key: 'doe2020',
      type: 'book',
      authors: ['Doe, Jane'],
      year: '2020',
      title: 'Unique Study',
      publisher: 'North Press',
    })
    const pool = [smithArticle, smithBook, doeBook]

    // MLA never assigns a/b suffixes to years in bibliography or in-text.
    expect(assignDisambiguationSuffixes(pool, 'mla').size).toBe(0)
    const mlaList = formatBibliographyList(pool, 'mla')
    expect(mlaList.disambiguation.size).toBe(0)
    for (const row of mlaList.entries) {
      expect(row.text).not.toMatch(/2020[ab]/)
    }

    const shortTitles = assignMlaShortTitles(pool)
    expect(shortTitles.get('smith2020a_src')).toBe('"Climate Policy"')
    expect(shortTitles.get('smith2020b_src')).toBe('World History')
    expect(shortTitles.has('doe2020')).toBe(false)

    expect(
      formatInTextCitation({ entry: smithArticle, locator: '23' }, 'mla', { allEntries: pool }),
    ).toBe('(Smith, "Climate Policy" 23)')
    expect(formatInTextCitation(smithArticle, 'mla', { allEntries: pool })).toBe(
      '(Smith, "Climate Policy")',
    )
    expect(formatInTextCitation(smithBook, 'mla', { allEntries: pool })).toBe(
      '(Smith, World History)',
    )
    expect(formatInTextCitation(doeBook, 'mla', { allEntries: pool })).toBe('(Doe)')

    // Auto-computes short titles when citing colliding works together without allEntries.
    expect(formatInTextCitation([smithArticle, smithBook], 'mla')).toBe(
      '(Smith, "Climate Policy"; Smith, World History)',
    )
    expect(
      formatInTextCitation({ entry: smithArticle, locator: '23' }, 'mla', {
        mode: 'narrative',
        allEntries: pool,
      }),
    ).toBe('Smith ("Climate Policy" 23)')
    expect(
      formatInTextCitation(smithBook, 'mla', {
        mode: 'narrative',
        allEntries: pool,
      }),
    ).toBe('Smith (World History)')

    // Expands colliding short prefixes until distinct.
    const smithEurope = makeEntry({
      key: 'smith_eu',
      type: 'article',
      authors: ['Smith, John'],
      year: '2021',
      title: 'Climate Policy in Europe',
    })
    const smithAsia = makeEntry({
      key: 'smith_as',
      type: 'article',
      authors: ['Smith, John'],
      year: '2022',
      title: 'Climate Policy in Asia',
    })
    const expanded = assignMlaShortTitles([smithEurope, smithAsia])
    expect(expanded.get('smith_eu')).toBe('"Climate Policy in Europe"')
    expect(expanded.get('smith_as')).toBe('"Climate Policy in Asia"')
  })

  it('formats numeric and textual editions cleanly in Korean and English across all four styles', () => {
    expect(formatEdition('1', 'apa', 'en')).toBe('(1st ed.)')
    expect(formatEdition('2', 'apa', 'en')).toBe('(2nd ed.)')
    expect(formatEdition('3', 'apa', 'en')).toBe('(3rd ed.)')
    expect(formatEdition('4', 'apa', 'en')).toBe('(4th ed.)')
    expect(formatEdition('11', 'apa', 'en')).toBe('(11th ed.)')
    expect(formatEdition('12', 'apa', 'en')).toBe('(12th ed.)')
    expect(formatEdition('13', 'apa', 'en')).toBe('(13th ed.)')
    expect(formatEdition('21', 'apa', 'en')).toBe('(21st ed.)')
    expect(formatEdition('22', 'apa', 'en')).toBe('(22nd ed.)')
    expect(formatEdition('23', 'apa', 'en')).toBe('(23rd ed.)')

    expect(formatEdition('2', 'chicago', 'en')).toBe('2nd ed.')
    expect(formatEdition('2', 'mla', 'en')).toBe('2nd ed.')
    expect(formatEdition('2', 'ieee', 'en')).toBe('2nd ed.')

    expect(formatEdition('1', 'apa', 'ko')).toBe('제1판')
    expect(formatEdition('2', 'chicago', 'ko')).toBe('제2판')
    expect(formatEdition('11', 'mla', 'ko')).toBe('제11판')
    expect(formatEdition('22', 'ieee', 'ko')).toBe('제22판')

    // Non-numeric text preserved without doubling "ed." or parentheses.
    expect(formatEdition('Rev. ed.', 'apa', 'en')).toBe('(Rev. ed.)')
    expect(formatEdition('(2nd ed.)', 'apa', 'en')).toBe('(2nd ed.)')
    expect(formatEdition('Rev. ed.', 'chicago', 'en')).toBe('Rev. ed.')
    expect(formatEdition('Rev. ed.', 'mla', 'en')).toBe('Rev. ed.')
    expect(formatEdition('Rev. ed.', 'ieee', 'en')).toBe('Rev. ed.')
    expect(formatEdition('개정판', 'apa', 'ko')).toBe('개정판')
    expect(formatEdition('제3판', 'apa', 'ko')).toBe('제3판')

    const numEnBook = makeEntry({
      type: 'book',
      authors: ['Smith, John A.'],
      year: '2020',
      title: 'Book Title',
      edition: '2',
      place: 'New York',
      publisher: 'Academic Press',
    })
    expect(formatBibliographyText(numEnBook, 'apa')).toBe(
      'Smith, J. A. (2020). Book Title (2nd ed.). Academic Press.',
    )
    expect(formatBibliographyText(numEnBook, 'chicago')).toBe(
      'Smith, John A. 2020. Book Title. 2nd ed. New York: Academic Press.',
    )
    expect(formatBibliographyText(numEnBook, 'mla')).toBe(
      'Smith, John A. Book Title. 2nd ed., Academic Press, 2020.',
    )
    expect(formatBibliographyText(numEnBook, 'ieee', { ieeeNumber: 1 })).toBe(
      '[1] J. A. Smith, Book Title, 2nd ed. New York: Academic Press, 2020.',
    )

    const revEnBook = makeEntry({ ...numEnBook, edition: 'Rev. ed.' })
    expect(formatBibliographyText(revEnBook, 'apa')).toBe(
      'Smith, J. A. (2020). Book Title (Rev. ed.). Academic Press.',
    )
    expect(formatBibliographyText(revEnBook, 'chicago')).toBe(
      'Smith, John A. 2020. Book Title. Rev. ed. New York: Academic Press.',
    )

    const numEnChapter = makeEntry({
      type: 'chapter',
      authors: ['Smith, John A.'],
      editors: ['Editor, E.'],
      year: '2020',
      title: 'Chapter title',
      containerTitle: 'Edited Book',
      edition: '3',
      pages: '10-20',
      publisher: 'Academic Press',
    })
    expect(formatBibliographyText(numEnChapter, 'apa')).toBe(
      'Smith, J. A. (2020). Chapter title. In E. Editor (Ed.), Edited Book (3rd ed., pp. 10-20). Academic Press.',
    )

    const numKoBook = makeEntry({
      type: 'book',
      authors: ['홍길동'],
      year: '2020',
      title: '교육학 개론',
      edition: '2',
      publisher: '학지사',
    })
    const revKoBook = makeEntry({ ...numKoBook, edition: '개정판' })
    for (const style of ['apa', 'chicago', 'mla'] as const) {
      expect(formatBibliographyText(numKoBook, style)).toBe(
        '홍길동(2020). 교육학 개론 (제2판). 학지사.',
      )
      expect(formatBibliographyText(revKoBook, style)).toBe(
        '홍길동(2020). 교육학 개론 (개정판). 학지사.',
      )
    }
    expect(formatBibliographyText(numKoBook, 'ieee', { ieeeNumber: 1 })).toBe(
      '[1] 홍길동(2020). 교육학 개론 (제2판). 학지사.',
    )
  })

  it('refines Chicago undated/grouped citations and APA conference, accessed date, and org-publisher omission', () => {
    // 1. Chicago undated: no double period after n.d.
    const chicagoUndated = makeEntry({
      type: 'book',
      authors: ['Smith, John'],
      title: 'Undated Monograph',
      publisher: 'Academic Press',
    })
    const chicagoUndatedText = formatBibliographyText(chicagoUndated, 'chicago')
    expect(chicagoUndatedText).toBe('Smith, John. n.d. Undated Monograph. Academic Press.')
    expect(chicagoUndatedText).not.toContain('n.d..')

    // 2. Chicago same-author grouped in-text citations merge years cleanly.
    const smithA = makeEntry({
      key: 'smith2020a',
      authors: ['Smith, John'],
      year: '2020',
      title: 'Alpha Paper',
    })
    const smithB = makeEntry({
      key: 'smith2020b',
      authors: ['Smith, John'],
      year: '2020',
      title: 'Beta Paper',
    })
    const chicagoDisambig = assignDisambiguationSuffixes([smithA, smithB], 'chicago')
    expect(
      formatInTextCitation([smithB, smithA], 'chicago', { disambiguation: chicagoDisambig }),
    ).toBe('(Smith 2020a, 2020b)')

    const hongA = makeEntry({ key: 'hong2020a', authors: ['홍길동'], year: '2020', title: '가' })
    const hongB = makeEntry({ key: 'hong2020b', authors: ['홍길동'], year: '2020', title: '나' })
    const koChicagoDisambig = assignDisambiguationSuffixes([hongA, hongB], 'chicago')
    expect(
      formatInTextCitation([hongB, hongA], 'chicago', { disambiguation: koChicagoDisambig }),
    ).toBe('(홍길동, 2020a, 2020b)')

    // 3. APA 7th conference paper with and without pages.
    const confWithPages = makeEntry({
      type: 'conference',
      authors: ['Smith, John A.'],
      year: '2022',
      title: 'Paper title',
      containerTitle: 'Proceedings of the Annual Symposium',
      pages: '10-20',
      publisher: 'Symposium Press',
    })
    expect(formatBibliographyText(confWithPages, 'apa')).toBe(
      'Smith, J. A. (2022). Paper title. In Proceedings of the Annual Symposium (pp. 10-20). Symposium Press.',
    )
    const confNoPages = makeEntry({ ...confWithPages, pages: undefined })
    expect(formatBibliographyText(confNoPages, 'apa')).toBe(
      'Smith, J. A. (2022). Paper title. In Proceedings of the Annual Symposium. Symposium Press.',
    )

    // 4. APA 7th accessed date: ISO YYYY-MM-DD formatted to Month D, YYYY; non-ISO preserved.
    const webIso = makeEntry({
      type: 'webpage',
      authors: ['Smith, John A.'],
      year: '2023',
      title: 'Policy Brief',
      containerTitle: 'Example Portal',
      accessed: '2023-05-01',
      url: 'https://example.org/brief',
    })
    expect(formatBibliographyText(webIso, 'apa')).toBe(
      'Smith, J. A. (2023). Policy Brief. Example Portal. Retrieved May 1, 2023, from https://example.org/brief',
    )
    const webNonIso = makeEntry({ ...webIso, accessed: 'Spring 2023' })
    expect(formatBibliographyText(webNonIso, 'apa')).toBe(
      'Smith, J. A. (2023). Policy Brief. Example Portal. Retrieved Spring 2023, from https://example.org/brief',
    )

    // 5. APA 7th & Korean: omit redundant publisher/institution when identical to org author.
    const orgBookEn = makeEntry({
      type: 'book',
      authors: [{ literal: 'World Health Organization', isOrganization: true }],
      year: '2023',
      title: 'Global Standards',
      publisher: '  world health organization  ',
    })
    expect(formatBibliographyText(orgBookEn, 'apa')).toBe(
      'World Health Organization. (2023). Global Standards.',
    )

    const orgBookKo = makeEntry({
      type: 'book',
      authors: [{ literal: '교육부', isOrganization: true }],
      year: '2023',
      title: '교육과정 총론',
      publisher: '교육부',
    })
    expect(formatBibliographyText(orgBookKo, 'apa')).toBe('교육부(2023). 교육과정 총론.')
  })
})
