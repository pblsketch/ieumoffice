/** @vitest-environment jsdom */
// Bibliography workpane tab (BibliographyTab.tsx), 22-language biblio i18n shard,
// library CRUD, verification gate, citation/bibliography operations, import preview,
// AI unparsed-line gating, and audit navigation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LANGS } from '@genoffice/i18n'
import type { BibEntry } from '../studio-plugin/citation-styles.mjs'
import type { AuditIssue } from '../studio-plugin/citations.mjs'
import { biblioStrings, bibliographyMenuLabelsFor } from '../src/renderer/i18n/biblio'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import {
  BibliographyTab,
  type BibliographyLibraryApi,
  type BibliographyTabBridge,
  type BibliographyTabProps,
} from '../src/renderer/workpane/BibliographyTab'
import type { HwpApi } from '../src/shared/ipc'

function makeEntry(overrides: Partial<BibEntry> = {}): BibEntry {
  return {
    id: overrides.id ?? 'id-1',
    key: overrides.key ?? 'kim2024',
    oldKeys: overrides.oldKeys ?? [],
    type: overrides.type ?? 'article',
    authors: overrides.authors ?? [{ family: '김철수' }],
    year: overrides.year ?? '2024',
    title: overrides.title ?? '한국어 학술 글쓰기 연구',
    containerTitle: overrides.containerTitle ?? '국어교육연구',
    language: overrides.language ?? 'ko',
    tags: overrides.tags ?? ['교육'],
    verified: overrides.verified ?? true,
    source: overrides.source ?? 'manual',
    ...overrides,
  }
}

function makeMockBridge(overrides: Partial<BibliographyTabBridge> = {}): BibliographyTabBridge {
  return {
    getCitationStyle: vi.fn(async () => ({ ok: true as const, style: 'apa' as const })),
    setCitationStyle: vi.fn(async (style) => ({ ok: true as const, style })),
    listCitationMarks: vi.fn(async () => ({ ok: true as const, marks: [] })),
    insertCitation: vi.fn(async () => ({
      ok: true as const,
      marked: true as const,
      placeKind: 'body' as const,
      text: '(김철수, 2024)',
      sec: 0,
      para: 0,
      startOffset: 0,
      endOffset: 11,
      offset: 0,
      length: 11,
      id: 'c1',
      keys: ['kim2024'],
    })),
    switchCitationStyle: vi.fn(async (newStyle) => ({
      ok: true as const,
      style: newStyle,
      updatedCitations: 2,
      skippedManual: [],
      missingKeys: [],
      unverifiedKeys: [],
      bibliographyRefreshed: true,
      bibliographyResult: null,
    })),
    insertBibliographyBlock: vi.fn(async (_entries, opts) => ({
      ok: true as const,
      count: 2,
      style: opts?.style ?? ('apa' as const),
      title: '참고문헌',
      sec: 0,
      startPara: 5,
      endPara: 7,
      keys: ['kim2024'],
      expectedLines: [],
      preservedMissingKeys: [],
      range: {
        startName: '참고문헌:시작',
        endName: '참고문헌:끝',
        start: { sec: 0, para: 5, offset: 0 },
        end: { sec: 0, para: 7, offset: 0 },
      },
      place: { sec: 0, para: 5, offset: 0, length: 4 },
    })),
    refreshBibliographyBlock: vi.fn(async (_entries, opts) => ({
      ok: true as const,
      count: 2,
      style: opts?.style ?? ('apa' as const),
      title: '참고문헌',
      sec: 0,
      startPara: 5,
      endPara: 7,
      keys: ['kim2024'],
      expectedLines: [],
      preservedMissingKeys: [],
      refreshed: true,
      range: {
        startName: '참고문헌:시작',
        endName: '참고문헌:끝',
        start: { sec: 0, para: 5, offset: 0 },
        end: { sec: 0, para: 7, offset: 0 },
      },
      place: { sec: 0, para: 5, offset: 0, length: 4 },
    })),
    detectUnmarkedBibliography: vi.fn(async () => ({ found: false as const })),
    detectBibliographyManualEdits: vi.fn(async () => ({
      hasManualEdits: false,
      modifiedLines: [],
      range: null,
    })),
    highlightBibliographyRange: vi.fn(async () => ({ ok: true })),
    rewriteCitationKeys: vi.fn(async () => ({ ok: true as const, updated: 2 })),
    auditCitations: vi.fn(async () => ({
      ok: true as const,
      style: 'apa' as const,
      issues: [],
      counts: {
        missing_from_bibliography: 0,
        uncited_in_bibliography: 0,
        wrong_sort_order: 0,
        missing_disambiguation: 0,
        manual_citation_edit: 0,
        unverified_citation: 0,
      },
    })),
    revealFindMatch: vi.fn(async () => ({ ok: true })),
    reveal: vi.fn(async () => ({ ok: true })),
    ...overrides,
  }
}

function makeMockApi(
  initialEntries: BibEntry[],
  overrides: Partial<BibliographyLibraryApi> = {},
): BibliographyLibraryApi {
  let store = [...initialEntries]
  return {
    bibList: vi.fn(async () => ({ ok: true as const, entries: [...store], tags: [] })),
    bibAdd: vi.fn(async (input) => {
      const added = makeEntry({
        id: `id-${store.length + 1}`,
        key: input.key ?? `entry${store.length + 1}`,
        title: input.title ?? 'Untitled',
        authors: (input.authors ?? []).map((a) => (typeof a === 'string' ? { literal: a } : a)),
        year: input.year != null ? String(input.year) : undefined,
        tags: input.tags ? [...input.tags] : [],
      })
      store = [...store, added]
      return { ok: true as const, entry: added, entries: [...store] }
    }),
    bibUpdate: vi.fn(async (id, patch) => {
      store = store.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              title: patch.title ?? entry.title,
              year: patch.year != null ? String(patch.year) : entry.year,
              key: patch.key ?? entry.key,
            }
          : entry,
      )
      const updated = store.find((entry) => entry.id === id)!
      return { ok: true as const, entry: updated, entries: [...store] }
    }),
    bibDelete: vi.fn(async (id) => {
      store = store.filter((entry) => entry.id !== id)
      return { ok: true as const, deletedId: id, entries: [...store] }
    }),
    bibVerify: vi.fn(async (id) => {
      store = store.map((entry) => (entry.id === id ? { ...entry, verified: true } : entry))
      const verified = store.find((entry) => entry.id === id)!
      return { ok: true as const, entry: verified, entries: [...store] }
    }),
    bibPickImportFile: vi.fn(async () => ({ ok: true as const, canceled: true as const })),
    bibPreviewImport: vi.fn(async (candidates) => ({
      ok: true as const,
      preview: {
        toAdd: candidates.map((cand, idx) =>
          makeEntry({
            id: `imp-${idx}`,
            key: cand.key ?? `imp${idx}`,
            title: cand.title ?? `Imported ${idx}`,
          }),
        ),
        duplicates: [],
        totalCandidates: candidates.length,
      },
    })),
    bibCommitImport: vi.fn(async (items) => {
      const added = items.map((item, idx) =>
        makeEntry({
          id: `committed-${idx}`,
          key: item.key ?? `committed${idx}`,
          title: item.title ?? `Committed ${idx}`,
        }),
      )
      store = [...store, ...added]
      return {
        ok: true as const,
        added,
        skippedDuplicates: [],
        entries: [...store],
      }
    }),
    bibExportFile: vi.fn(async (format) => ({
      ok: true as const,
      path: `/tmp/refs.${format}`,
      count: store.length,
      format,
    })),
    ...overrides,
  }
}

function setInputValue(input: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto =
    input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('biblio i18n shard', () => {
  it('covers all UI languages in LANGS with identical non-empty keys and real translations', () => {
    expect(Object.keys(biblioStrings).sort()).toEqual([...LANGS].sort())
    const keys = Object.keys(biblioStrings.zh).sort()
    for (const lang of LANGS) {
      const dict = biblioStrings[lang]
      expect(Object.keys(dict).sort(), lang).toEqual(keys)
      for (const key of keys) {
        expect(dict[key as keyof typeof dict].trim().length, `${lang}.${key}`).toBeGreaterThan(0)
      }
      const menuLabels = bibliographyMenuLabelsFor(lang)
      expect(menuLabels.insertCitation.length).toBeGreaterThan(0)
      expect(menuLabels.insertBibliography.length).toBeGreaterThan(0)
      expect(menuLabels.refreshBibliography.length).toBeGreaterThan(0)
      expect(menuLabels.openTab.length).toBeGreaterThan(0)
      if (lang !== 'en') {
        expect(dict.insertCitationBtn, lang).not.toBe(biblioStrings.en.insertCitationBtn)
        expect(dict.tabLibrary, lang).not.toBe(biblioStrings.en.tabLibrary)
        expect(dict.unverifiedBlockError, lang).not.toBe(biblioStrings.en.unverifiedBlockError)
        expect(dict.verifyBtn, lang).not.toBe(biblioStrings.en.verifyBtn)
        expect(dict.importAiPromptPrefix, lang).not.toBe(biblioStrings.en.importAiPromptPrefix)
        expect(dict.libraryErrorTitle, lang).not.toBe(biblioStrings.en.libraryErrorTitle)
        expect(dict.libraryNearLimitTitle, lang).not.toBe(biblioStrings.en.libraryNearLimitTitle)
        expect(dict.untitledEntry, lang).not.toBe(biblioStrings.en.untitledEntry)
      }
      // Every template placeholder present in English must also exist in every language.
      for (const key of keys) {
        const enVal = biblioStrings.en[key as keyof typeof dict]
        const placeholders = enVal.match(/\{[a-zA-Z0-9_]+\}/g) ?? []
        for (const token of placeholders) {
          expect(dict[key as keyof typeof dict], `${lang}.${key} missing ${token}`).toContain(token)
        }
      }
    }
  })

  it('uses explicit Mark as verified copy and untrusted-data AI prefill preamble across all 22 languages', () => {
    expect(biblioStrings.en.verifyBtn).toBe('Mark as verified')
    expect(biblioStrings.ko.verifyBtn).toBe('확인함으로 표시')
    expect(biblioStrings.zh.verifyBtn).toBe('标记为已确认')
    expect(biblioStrings.ja.verifyBtn).toBe('確認済みにする')

    expect(biblioStrings.en.importAiPromptPrefix.toLowerCase()).toContain('untrusted')
    expect(biblioStrings.en.importAiPromptPrefix.toLowerCase()).toContain('not instructions')
    expect(biblioStrings.ko.importAiPromptPrefix).toContain('지시가 아니라')
    expect(biblioStrings.ko.importAiPromptPrefix).toContain('따르지 말고')
    expect(biblioStrings.zh.importAiPromptPrefix).toContain('不可信')
    expect(biblioStrings.zh.importAiPromptPrefix).toContain('并非指令')

    for (const lang of LANGS) {
      const dict = biblioStrings[lang]
      expect(dict.verifyBtn.trim().length, `${lang}.verifyBtn`).toBeGreaterThan(2)
      expect(
        dict.importAiPromptPrefix.trim().length,
        `${lang}.importAiPromptPrefix`,
      ).toBeGreaterThan(40)
    }
  })
})

describe('BibliographyTab', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.appendChild(container)
    Object.assign(window, {
      hwpApi: {
        onLanguageChanged: () => () => undefined,
      } as unknown as HwpApi,
    })
  })

  afterEach(() => {
    if (root) act(() => root!.unmount())
    root = null
    container.remove()
    delete (window as { hwpApi?: unknown }).hwpApi
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function renderTab(props: BibliographyTabProps) {
    root = createRoot(container)
    await act(async () => {
      root!.render(
        createElement(LocaleProvider, {
          initial: 'ko',
          children: createElement(BibliographyTab, props),
        }),
      )
    })
  }

  it('renders entries, filters by search and tags, and supports add, edit, and delete with cited warning', async () => {
    const e1 = makeEntry({
      id: 'e1',
      key: 'kim2024',
      title: '인공지능 교육 연구',
      authors: [{ family: '김철수' }],
      year: '2024',
      tags: ['교육', '인공지능'],
    })
    const e2 = makeEntry({
      id: 'e2',
      key: 'smith2023',
      title: 'Academic Writing Methods',
      authors: [{ family: 'Smith', given: 'Jane' }],
      year: '2023',
      language: 'en',
      tags: ['방법론'],
    })
    const bridge = makeMockBridge({
      listCitationMarks: vi.fn(async () => ({
        ok: true as const,
        marks: [
          {
            id: 'm1',
            sec: 0,
            para: 1,
            startOffset: 0,
            endOffset: 10,
            offset: 0,
            length: 10,
            text: '(김철수, 2024)',
            writtenText: '(김철수, 2024)',
            mode: 'parenthetical' as const,
            items: [{ key: 'kim2024' }],
            keys: ['kim2024'],
            isManuallyEdited: false,
            start: { name: '인용:1:시작', sec: 0, para: 1, offset: 0 },
            end: { name: '인용:1:끝', sec: 0, para: 1, offset: 10 },
          },
        ],
      })),
    })
    const api = makeMockApi([e1, e2])

    await renderTab({ bridge, api, entries: [e1, e2] })

    expect(container.querySelectorAll('[data-testid="bib-entry-row"]')).toHaveLength(2)

    // Filter by search
    const searchInput = container.querySelector<HTMLInputElement>(
      '[data-testid="bib-search-input"]',
    )!
    await act(async () => setInputValue(searchInput, 'Academic'))
    expect(container.querySelectorAll('[data-testid="bib-entry-row"]')).toHaveLength(1)
    expect(container.textContent).toContain('Academic Writing Methods')
    await act(async () => setInputValue(searchInput, ''))

    // Filter by tag
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="bib-tag-교육"]')?.click()
    })
    expect(container.querySelectorAll('[data-testid="bib-entry-row"]')).toHaveLength(1)
    expect(container.textContent).toContain('인공지능 교육 연구')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="bib-tag-all"]')?.click()
    })

    // Add entry
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="bib-add-btn"]')?.click()
    })
    await act(async () => {
      setInputValue(container.querySelector('[data-testid="bib-title-input"]')!, '새로운 논문')
      setInputValue(container.querySelector('[data-testid="bib-author-input"]')!, '이영희')
      setInputValue(container.querySelector('[data-testid="bib-year-input"]')!, '2025')
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="bib-save-btn"]')?.click()
    })
    expect(api.bibAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '새로운 논문',
        authors: ['이영희'],
        year: '2025',
      }),
    )
    expect(container.querySelectorAll('[data-testid="bib-entry-row"]')).toHaveLength(3)

    // Edit first entry
    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>('[data-testid="bib-row-edit-btn"]')[0]?.click()
    })
    await act(async () => {
      setInputValue(
        container.querySelector('[data-testid="bib-title-input"]')!,
        '인공지능 교육 연구 개정판',
      )
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="bib-save-btn"]')?.click()
    })
    expect(api.bibUpdate).toHaveBeenCalledWith(
      'e1',
      expect.objectContaining({ title: '인공지능 교육 연구 개정판' }),
    )

    // Delete first entry -> warns because it is cited in the open document
    await act(async () => {
      container
        .querySelectorAll<HTMLButtonElement>('[data-testid="bib-row-delete-btn"]')[0]
        ?.click()
    })
    const confirmBox = container.querySelector('[data-testid="bib-delete-confirm"]')!
    expect(confirmBox).not.toBeNull()
    expect(confirmBox.textContent).toContain('1번 인용되고 있습니다')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="bib-delete-confirm-btn"]')?.click()
    })
    expect(api.bibDelete).toHaveBeenCalledWith('e1')
  })

  it('blocks citing an unverified entry until the user clicks Verified (bibVerify)', async () => {
    const unverified = makeEntry({
      id: 'u1',
      key: 'draft2025',
      title: '미확인 후보 논문',
      verified: false,
      source: 'ai',
    })
    const bridge = makeMockBridge()
    const api = makeMockApi([unverified])

    await renderTab({ bridge, api, entries: [unverified] })

    const rowCiteBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="bib-row-cite-btn"]',
    )!
    expect(rowCiteBtn.disabled).toBe(true)

    // Even selecting the checkbox and clicking top Insert Citation blocks with an alert
    await act(async () => {
      container.querySelector<HTMLInputElement>('.bib-entry-check')?.click()
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="bib-insert-citation-btn"]')?.click()
    })
    expect(bridge.insertCitation).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="bib-notice"]')?.textContent).toContain('확인함')

    // Clicking Verified calls bibVerify and unlocks citing
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="bib-verify-btn"]')?.click()
    })
    expect(api.bibVerify).toHaveBeenCalledWith('u1')
    expect(container.querySelector('[data-testid="bib-verify-btn"]')).toBeNull()
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="bib-row-cite-btn"]')?.disabled,
    ).toBe(false)

    // Now inserting citation succeeds
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="bib-row-cite-btn"]')?.click()
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="bib-composer-submit-btn"]')?.click()
    })
    expect(bridge.insertCitation).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'parenthetical',
        foreign: true,
        items: [{ key: 'draft2025' }],
      }),
    )
  })

  it('inserts narrative citations with locator, highlights unmarked bibliography before replace, and switches style with foreign:true', async () => {
    const e1 = makeEntry({ id: 'e1', key: 'kim2024', title: '첫 번째 연구' })
    const bridge = makeMockBridge({
      detectUnmarkedBibliography: vi.fn(async () => ({
        found: true as const,
        headingPara: { sec: 0, para: 10, text: '참고문헌' },
        range: { sec: 0, startPara: 10, endPara: 12 },
        lines: [
          { sec: 0, para: 11, text: '홍길동 (2022). 논문 제목. 학술지, 10(2), 1-15.' },
          { sec: 0, para: 12, text: 'Unstructured broken line' },
        ],
      })),
    })
    const api = makeMockApi([e1])

    await renderTab({ bridge, api, entries: [e1] })

    // Open citation composer via row Cite button, switch to narrative, add locator
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="bib-row-cite-btn"]')?.click()
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="bib-mode-narrative"]')?.click()
      setInputValue(container.querySelector('[data-testid="bib-locator-input-kim2024"]')!, 'p. 42')
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="bib-composer-submit-btn"]')?.click()
    })
    expect(bridge.insertCitation).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'narrative',
        style: 'apa',
        foreign: true,
        items: [{ key: 'kim2024', locator: 'p. 42' }],
      }),
    )

    // Insert bibliography detects unmarked bibliography, highlights it, and waits for confirmation
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="bib-insert-list-btn"]')?.click()
    })
    expect(bridge.highlightBibliographyRange).toHaveBeenCalledWith({
      sec: 0,
      startPara: 10,
      endPara: 12,
    })
    expect(bridge.insertBibliographyBlock).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="bib-legacy-confirm"]')).not.toBeNull()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="bib-legacy-replace-btn"]')?.click()
    })
    expect(bridge.insertBibliographyBlock).toHaveBeenCalledWith(
      [e1],
      expect.objectContaining({
        style: 'apa',
        replaceLegacy: true,
        foreign: true,
      }),
    )

    // Switch style calls switchCitationStyle once with foreign: true
    const styleSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="bib-style-select"]',
    )!
    await act(async () => setInputValue(styleSelect, 'ieee'))
    expect(bridge.switchCitationStyle).toHaveBeenCalledTimes(1)
    expect(bridge.switchCitationStyle).toHaveBeenCalledWith('ieee', [e1], { foreign: true })
  })

  it('renders audit issues and jumps to clicked issue location in the document', async () => {
    const issues: AuditIssue[] = [
      {
        type: 'missing_from_bibliography',
        kind: 'body',
        sec: 0,
        para: 3,
        offset: 5,
        length: 12,
        text: '(박지훈, 2021)',
        key: 'park2021',
      },
      {
        type: 'manual_citation_edit',
        kind: 'body',
        sec: 0,
        para: 6,
        offset: 2,
        length: 14,
        text: '(김철수, 2024 수정)',
        key: 'kim2024',
      },
    ]
    const bridge = makeMockBridge({
      auditCitations: vi.fn(async () => ({
        ok: true as const,
        style: 'apa' as const,
        issues,
        counts: {
          missing_from_bibliography: 1,
          uncited_in_bibliography: 0,
          wrong_sort_order: 0,
          missing_disambiguation: 0,
          manual_citation_edit: 1,
          unverified_citation: 0,
        },
      })),
    })
    const api = makeMockApi([])

    await renderTab({ bridge, api, entries: [] })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="bib-audit-tab"]')?.click()
    })
    const rows = container.querySelectorAll<HTMLButtonElement>('[data-testid="bib-audit-issue"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].dataset.issueType).toBe('missing_from_bibliography')
    expect(rows[1].dataset.issueType).toBe('manual_citation_edit')

    await act(async () => rows[0].click())
    expect(bridge.revealFindMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'body',
        sec: 0,
        para: 3,
        offset: 5,
        length: 12,
      }),
    )
  })

  it('shows import preview with toAdd/duplicates/unparsed lines and gates AI button on aiEnabled with only checked lines', async () => {
    const existing = makeEntry({ id: 'e1', key: 'kim2024', title: 'Existing Paper', year: '2024' })
    const legacy = {
      found: true as const,
      headingPara: { sec: 0, para: 20, text: '참고문헌' },
      range: { sec: 0, startPara: 20, endPara: 23 },
      lines: [
        {
          sec: 0,
          para: 21,
          text: 'Hong, G. (2022). Sample study title. Journal of Studies, 12(1), 10-20.',
        },
        { sec: 0, para: 22, text: 'Not parseable alpha' },
        { sec: 0, para: 23, text: 'Not parseable beta' },
      ],
    }
    const bridge = makeMockBridge({
      detectUnmarkedBibliography: vi.fn(async () => legacy),
    })
    const api = makeMockApi([existing], {
      bibPreviewImport: vi.fn(async () => ({
        ok: true as const,
        preview: {
          toAdd: [makeEntry({ id: 'new-1', key: 'hong2022', title: 'Sample study title' })],
          duplicates: [
            {
              candidate: makeEntry({ id: 'dup-1', key: 'kim2024b', title: 'Existing Paper' }),
              candidateIndex: 1,
              existingKey: 'kim2024',
              existingId: 'e1',
              matchReason: 'title_year' as const,
              source: 'existing' as const,
            },
          ],
          totalCandidates: 2,
        },
      })),
    })
    const onRequestAiParseLines = vi.fn()

    // 1. With aiEnabled=false: AI button must be hidden
    await renderTab({
      bridge,
      api,
      entries: [existing],
      aiEnabled: false,
      onRequestAiParseLines,
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="bib-import-btn"]')?.click()
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="bib-import-doc-btn"]')?.click()
    })

    expect(container.querySelector('[data-testid="bib-import-preview"]')).not.toBeNull()
    expect(container.textContent).toContain('Sample study title')
    expect(container.textContent).toContain('제목+연도 일치')
    expect(container.querySelector('[data-testid="bib-unparsed-section"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="bib-unparsed-ai-btn"]')).toBeNull()

    // 2. Re-render with aiEnabled=true: AI button appears and sends ONLY checked unparsed lines
    await act(async () => {
      root!.render(
        createElement(LocaleProvider, {
          initial: 'ko',
          children: createElement(BibliographyTab, {
            bridge,
            api,
            entries: [existing],
            aiEnabled: true,
            onRequestAiParseLines,
          }),
        }),
      )
    })

    const aiBtn = container.querySelector<HTMLButtonElement>('[data-testid="bib-unparsed-ai-btn"]')!
    expect(aiBtn).not.toBeNull()

    // Uncheck the second unparsed line, leaving only the first checked
    const unparsedChecks = container.querySelectorAll<HTMLInputElement>(
      '[data-testid="bib-unparsed-section"] input[type="checkbox"]',
    )
    expect(unparsedChecks.length).toBe(2)
    await act(async () => unparsedChecks[1].click())

    await act(async () => aiBtn.click())
    expect(onRequestAiParseLines).toHaveBeenCalledTimes(1)
    expect(onRequestAiParseLines).toHaveBeenCalledWith(['Not parseable alpha'])

    // Confirm import commits only toAdd
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="bib-import-confirm-btn"]')?.click()
    })
    expect(api.bibCommitImport).toHaveBeenCalledWith(
      [expect.objectContaining({ key: 'hong2022' })],
      { source: 'document', skipDuplicates: true },
    )
  })

  it('shows key-rename banner and rewrites citation keys in 1 undo step on confirmation', async () => {
    const entry = makeEntry({ id: 'e1', key: 'kim2024_new', oldKeys: ['kim2024'] })
    const bridge = makeMockBridge()
    const api = makeMockApi([entry])
    const onDismissKeyRename = vi.fn()

    await renderTab({
      bridge,
      api,
      entries: [entry],
      pendingKeyRename: {
        id: 'e1',
        oldKey: 'kim2024',
        newKey: 'kim2024_new',
        title: entry.title,
      },
      onDismissKeyRename,
    })

    expect(container.querySelector('[data-testid="bib-key-rename-banner"]')).not.toBeNull()
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="bib-key-rename-apply-btn"]')
        ?.click()
    })
    expect(bridge.rewriteCitationKeys).toHaveBeenCalledWith({ kim2024: 'kim2024_new' }, [entry], {
      foreign: true,
    })
    expect(onDismissKeyRename).toHaveBeenCalledTimes(1)
  })

  it('shows prominent error banner with backup path on library_corrupt / library_too_large, disables writes, hides empty-library state, and retries', async () => {
    const bridge = makeMockBridge()
    const api = makeMockApi([])
    const onReloadLibrary = vi.fn()
    const backupPath = 'C:/Users/tester/AppData/hwp-bibliography.json.corrupt-1730000000'

    await renderTab({
      bridge,
      api,
      entries: [],
      libraryError: {
        reason: 'library_corrupt',
        error: 'Unexpected token in JSON',
        corruptBackupPath: backupPath,
        maxBytes: 5 * 1024 * 1024,
      },
      onReloadLibrary,
    })

    const banner = container.querySelector('[data-testid="bib-library-error-banner"]')
    expect(banner).not.toBeNull()
    expect(banner?.getAttribute('data-error-reason')).toBe('library_corrupt')
    expect(container.querySelector('[data-testid="bib-library-backup-path"]')?.textContent).toBe(
      backupPath,
    )
    expect(container.querySelector('[data-testid="bib-empty-library"]')).toBeNull()
    expect(container.textContent).not.toContain(biblioStrings.ko.emptyLibrary)

    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="bib-add-btn"]')?.disabled,
    ).toBe(true)
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="bib-import-btn"]')?.disabled,
    ).toBe(true)
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="bib-export-btn"]')?.disabled,
    ).toBe(true)

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="bib-library-retry-btn"]')?.click()
    })
    expect(onReloadLibrary).toHaveBeenCalledTimes(1)

    // Re-render with library_too_large error and verify size details and disabled state
    await act(async () => {
      root!.render(
        createElement(LocaleProvider, {
          initial: 'ko',
          children: createElement(BibliographyTab, {
            bridge,
            api,
            entries: [],
            libraryError: {
              reason: 'library_too_large',
              error: 'Library exceeds size limit',
              sizeBytes: 6 * 1024 * 1024,
              maxBytes: 5 * 1024 * 1024,
            },
            onReloadLibrary,
          }),
        }),
      )
    })

    const largeBanner = container.querySelector('[data-testid="bib-library-error-banner"]')
    expect(largeBanner?.getAttribute('data-error-reason')).toBe('library_too_large')
    expect(
      container.querySelector('[data-testid="bib-library-error-size"]')?.textContent,
    ).toContain('6.0 MB')
    expect(container.querySelector('[data-testid="bib-library-backup-path"]')).toBeNull()
    expect(container.querySelector('[data-testid="bib-empty-library"]')).toBeNull()
  })

  it('shows non-blocking nearLimit warning banner and reports localized too_large write rejections without overwriting', async () => {
    const entry = makeEntry({ id: 'e1', key: 'kim2024', title: '정상 논문' })
    const bridge = makeMockBridge()
    const api = makeMockApi([entry], {
      bibAdd: vi.fn(async () => ({
        ok: false as const,
        reason: 'too_large' as const,
        error: 'Library file would exceed limit',
        actualBytes: 5_500_000,
        maxBytes: 5 * 1024 * 1024,
      })),
    })

    await renderTab({
      bridge,
      api,
      entries: [entry],
      nearLimit: {
        sizeBytes: Math.round(4.5 * 1024 * 1024),
        maxBytes: 5 * 1024 * 1024,
      },
    })

    const nearBanner = container.querySelector('[data-testid="bib-near-limit-banner"]')
    expect(nearBanner).not.toBeNull()
    expect(nearBanner?.textContent).toContain('4.5 MB')
    expect(nearBanner?.textContent).toContain('5.0 MB')

    // Writes remain enabled in near-limit warning state
    const addBtn = container.querySelector<HTMLButtonElement>('[data-testid="bib-add-btn"]')!
    expect(addBtn.disabled).toBe(false)

    // Attempting to add when backend rejects with reason: 'too_large' surfaces clear localized error
    await act(async () => addBtn.click())
    await act(async () => {
      setInputValue(container.querySelector('[data-testid="bib-title-input"]')!, '대용량 문헌')
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="bib-save-btn"]')?.click()
    })

    const notice = container.querySelector('[data-testid="bib-notice"]')
    expect(notice?.textContent).toContain('5.2 MB')
    expect(notice?.textContent).toContain('5.0 MB')
    expect(notice?.textContent).toContain('덮어쓰지 않았습니다')
  })

  it('activates libraryError banner when a write call returns library_corrupt', async () => {
    const unverified = makeEntry({ id: 'u1', key: 'ai2025', title: '후보 논문', verified: false })
    const bridge = makeMockBridge()
    const backupPath = 'C:/data/hwp-bibliography.json.corrupt-999'
    const api = makeMockApi([unverified], {
      bibVerify: vi.fn(async () => ({
        ok: false as const,
        reason: 'library_corrupt' as const,
        error: 'Corrupt JSON',
        corruptBackupPath: backupPath,
        maxBytes: 5 * 1024 * 1024,
      })),
    })

    await renderTab({ bridge, api, entries: [unverified] })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="bib-verify-btn"]')?.click()
    })

    expect(container.querySelector('[data-testid="bib-library-error-banner"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="bib-library-backup-path"]')?.textContent).toBe(
      backupPath,
    )
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="bib-add-btn"]')?.disabled,
    ).toBe(true)
  })

  it('renders an untitled stored entry (title: "") with a localized fallback label and keeps it editable', async () => {
    const untitled = makeEntry({
      id: 'nt-1',
      key: 'anon2024',
      title: '',
      authors: [{ family: '홍길동' }],
      year: '2024',
    })
    const bridge = makeMockBridge()
    const api = makeMockApi([untitled])

    await renderTab({ bridge, api, entries: [untitled] })

    const titleEl = container.querySelector('[data-testid="bib-entry-title"]')
    expect(titleEl?.textContent).toBe(biblioStrings.ko.untitledEntry)
    expect(titleEl?.classList.contains('is-untitled')).toBe(true)

    // Entry remains editable via the Edit button
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="bib-row-edit-btn"]')?.click()
    })
    const titleInput = container.querySelector<HTMLInputElement>('[data-testid="bib-title-input"]')!
    expect(titleInput).not.toBeNull()
    expect(titleInput.value).toBe('')
  })
})
