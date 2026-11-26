/** @vitest-environment jsdom */
// FindTab UI, virtualization, filters, replace actions, stale banner, and 22-language i18n shard.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LANGS } from '@genoffice/i18n'
import type {
  FindMatch,
  FindOptions,
  FindReplaceResult,
  FindReplaceSelection,
  FindResult,
  RevealFindResult,
} from '../studio-plugin/find.mjs'
import { findStrings } from '../src/renderer/i18n/find'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import {
  FIND_ROW_HEIGHT,
  FindTab,
  type FindTabBridge,
  type FindTabProps,
} from '../src/renderer/workpane/FindTab'
import type { HwpApi } from '../src/shared/ipc'

function makeMatch(index: number, overrides: Partial<FindMatch> = {}): FindMatch {
  return {
    index,
    kind: 'body',
    sec: 0,
    para: index,
    offset: 4,
    length: 5,
    matchText: 'Alpha',
    beforeText: `row ${index} `,
    afterText: ' trailing',
    page: Math.floor(index / 10) + 1,
    ...overrides,
  }
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  proto?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')
  proto?.set?.call(select, value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

function createFakeBridge(overrides: Partial<FindTabBridge> = {}): {
  bridge: FindTabBridge
  findMatches: ReturnType<typeof vi.fn<(options?: FindOptions) => Promise<FindResult>>>
  replaceFindMatches: ReturnType<
    typeof vi.fn<
      (
        options: FindOptions,
        replacement: string,
        selection?: FindReplaceSelection,
      ) => Promise<FindReplaceResult>
    >
  >
  revealFindMatch: ReturnType<typeof vi.fn<(match: FindMatch) => Promise<RevealFindResult>>>
  listStyles: ReturnType<typeof vi.fn<() => Promise<{ paragraph: string[]; character: string[] }>>>
} {
  const findMatches = vi.fn<(options?: FindOptions) => Promise<FindResult>>(async () => ({
    ok: true,
    total: 0,
    matches: [],
  }))
  const replaceFindMatches = vi.fn<
    (
      options: FindOptions,
      replacement: string,
      selection?: FindReplaceSelection,
    ) => Promise<FindReplaceResult>
  >(async () => ({
    ok: true,
    replaced: 0,
    skippedObjects: 0,
    skippedCitations: 0,
  }))
  const revealFindMatch = vi.fn<(match: FindMatch) => Promise<RevealFindResult>>(async () => ({
    ok: true,
  }))
  const listStyles = vi.fn<() => Promise<{ paragraph: string[]; character: string[] }>>(
    async () => ({
      paragraph: ['바탕글', '개요 1', '인용문'],
      character: [],
    }),
  )

  const bridge: FindTabBridge = {
    findMatches: overrides.findMatches ?? findMatches,
    replaceFindMatches: overrides.replaceFindMatches ?? replaceFindMatches,
    revealFindMatch: overrides.revealFindMatch ?? revealFindMatch,
    listStyles: overrides.listStyles ?? listStyles,
  }
  return { bridge, findMatches, replaceFindMatches, revealFindMatch, listStyles }
}

describe('find i18n shard (22 languages)', () => {
  it('covers every UI language in LANGS with identical keys and preserved placeholders', () => {
    expect(Object.keys(findStrings).sort()).toEqual([...LANGS].sort())
    const keys = Object.keys(findStrings.zh).sort()
    const placeholders = (text: string): string[] =>
      Array.from(text.matchAll(/\{[a-zA-Z0-9_]+\}/g))
        .map((m) => m[0])
        .sort()

    for (const lang of LANGS) {
      const dict = findStrings[lang]
      expect(Object.keys(dict).sort(), lang).toEqual(keys)
      for (const key of keys) {
        const value = dict[key as keyof typeof dict]
        expect(value.trim().length, `${lang}.${key}`).toBeGreaterThan(0)
        expect(placeholders(value), `${lang}.${key} placeholders`).toEqual(
          placeholders(findStrings.en[key as keyof typeof dict]),
        )
      }
    }
  })

  it('does not leave untranslated English strings in Korean or other non-English locales', () => {
    const keys = Object.keys(findStrings.en) as Array<keyof typeof findStrings.en>
    for (const key of keys) {
      expect(findStrings.ko[key], `ko.${key}`).not.toBe(findStrings.en[key])
    }
    for (const lang of LANGS) {
      if (lang === 'en') continue
      expect(findStrings[lang].findSearchButton, lang).not.toBe(findStrings.en.findSearchButton)
      expect(findStrings[lang].findReplaceAll, lang).not.toBe(findStrings.en.findReplaceAll)
      expect(findStrings[lang].findStaleNotice, lang).not.toBe(findStrings.en.findStaleNotice)
      expect(findStrings[lang].findNoMatches, lang).not.toBe(findStrings.en.findNoMatches)
      expect(findStrings[lang].findOptRegex, lang).not.toBe(findStrings.en.findOptRegex)
    }
  })
})

describe('FindTab component', () => {
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

  async function renderFindTab(props: FindTabProps, lang: 'ko' | 'en' = 'ko'): Promise<void> {
    if (!root) root = createRoot(container)
    await act(async () => {
      root!.render(
        createElement(LocaleProvider, {
          initial: lang,
          children: createElement(FindTab, props),
        }),
      )
    })
  }

  it('focuses and selects the search input when focusTick increments while visible', async () => {
    const { bridge } = createFakeBridge()
    await renderFindTab({ bridge, visible: true, focusTick: 0 })

    const input = container.querySelector<HTMLInputElement>('[data-find-input="query"]')!
    expect(document.activeElement).not.toBe(input)

    const selectSpy = vi.spyOn(input, 'select')
    await renderFindTab({ bridge, visible: true, focusTick: 1 })
    expect(document.activeElement).toBe(input)
    expect(selectSpy).toHaveBeenCalledTimes(1)

    // When hidden during increment, defers focus until becoming visible.
    input.blur()
    await renderFindTab({ bridge, visible: false, focusTick: 2 })
    expect(document.activeElement).not.toBe(input)

    await renderFindTab({ bridge, visible: true, focusTick: 2 })
    expect(document.activeElement).toBe(input)
  })

  it('runs search with query and options, rendering count, mark, page, scope, and badges', async () => {
    const matches: FindMatch[] = [
      makeMatch(0, {
        kind: 'body',
        matchText: 'Alpha',
        beforeText: 'Start ',
        afterText: ' end',
        page: 1,
      }),
      makeMatch(1, {
        kind: 'table',
        matchText: 'Alpha',
        beforeText: 'Cell ',
        afterText: ' value',
        page: 2,
        spansObject: true,
      }),
      makeMatch(2, {
        kind: 'footnote',
        matchText: 'Alpha',
        beforeText: 'Note ',
        afterText: ' text',
        page: 3,
        inCitation: true,
      }),
    ]
    const { bridge, findMatches } = createFakeBridge()
    findMatches.mockResolvedValueOnce({ ok: true, total: 3, matches })

    await renderFindTab({ bridge, visible: true })

    const input = container.querySelector<HTMLInputElement>('[data-find-input="query"]')!
    await act(async () => {
      setInputValue(input, 'Alpha')
      container.querySelector<HTMLButtonElement>('[data-find-option="caseSensitive"]')!.click()
      container.querySelector<HTMLButtonElement>('[data-find-option="wholeWord"]')!.click()
      container.querySelector<HTMLButtonElement>('[data-find-option="regex"]')!.click()
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-find-action="search"]')!.click()
    })

    expect(findMatches).toHaveBeenCalledWith({
      query: 'Alpha',
      caseSensitive: true,
      wholeWord: true,
      regex: true,
    })

    expect(container.querySelector('[data-find-total="3"]')?.textContent).toBe('3개 찾음')
    const rows = container.querySelectorAll('[data-find-row]')
    expect(rows).toHaveLength(3)
    expect(rows[0].querySelector('mark.find-match-mark')?.textContent).toBe('Alpha')
    expect(rows[0].querySelector('.find-meta-page')?.textContent).toBe('1쪽')
    expect(rows[0].querySelector('[data-find-scope="body"]')?.textContent).toBe('본문')
    expect(rows[1].querySelector('[data-find-scope="table"]')?.textContent).toBe('표')
    expect(rows[1].querySelector('[data-find-badge="object"]')?.textContent).toBe('개체 걸침')
    expect(rows[2].querySelector('[data-find-scope="footnote"]')?.textContent).toBe('각주')
    expect(rows[2].querySelector('[data-find-badge="citation"]')?.textContent).toBe('인용')
  })

  it('shows inline regex error directly under the search input on invalid_regex', async () => {
    const { bridge, findMatches } = createFakeBridge()
    findMatches.mockResolvedValueOnce({
      ok: false,
      reason: 'invalid_regex',
      error: 'Unterminated group',
    })

    await renderFindTab({ bridge, visible: true })

    const input = container.querySelector<HTMLInputElement>('[data-find-input="query"]')!
    await act(async () => {
      setInputValue(input, '(unclosed')
      container.querySelector<HTMLButtonElement>('[data-find-option="regex"]')!.click()
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-find-action="search"]')!.click()
    })

    const alert = container.querySelector('[data-find-error="regex"]')
    expect(alert).not.toBeNull()
    expect(alert?.getAttribute('role')).toBe('alert')
    expect(alert?.textContent).toContain('Unterminated group')
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })

  it('supports style-only and charFormat-only searches without a text query', async () => {
    const { bridge, findMatches, listStyles } = createFakeBridge()
    findMatches.mockResolvedValue({
      ok: true,
      total: 1,
      matches: [makeMatch(0, { matchText: 'Styled heading' })],
    })

    await renderFindTab({ bridge, visible: true })
    expect(listStyles).toHaveBeenCalled()

    // Open filters drawer.
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-find-action="toggle-filters"]')!.click()
    })

    const styleSelect = container.querySelector<HTMLSelectElement>('[data-find-filter="style"]')!
    const optionValues = Array.from(styleSelect.options).map((o) => o.value)
    expect(optionValues).toEqual(['', '바탕글', '개요 1', '인용문'])

    // Style-only search (empty text query).
    await act(async () => {
      setSelectValue(styleSelect, '개요 1')
    })
    const searchBtn = container.querySelector<HTMLButtonElement>('[data-find-action="search"]')!
    expect(searchBtn.disabled).toBe(false)

    await act(async () => {
      searchBtn.click()
    })
    expect(findMatches).toHaveBeenLastCalledWith({ style: '개요 1' })

    // Clear filters, then run charFormat-only search (bold=true, italic=false, font, size, color).
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-find-action="clear-filters"]')!.click()
    })
    expect(searchBtn.disabled).toBe(true)

    await act(async () => {
      // Bold: any -> on (true)
      container.querySelector<HTMLButtonElement>('[data-find-filter="bold"]')!.click()
      // Italic: any -> on -> off (false)
      const italicBtn = container.querySelector<HTMLButtonElement>('[data-find-filter="italic"]')!
      italicBtn.click()
      italicBtn.click()
      setInputValue(container.querySelector<HTMLInputElement>('[data-find-filter="font"]')!, '바탕')
      setInputValue(container.querySelector<HTMLInputElement>('[data-find-filter="size"]')!, '11')
      setInputValue(
        container.querySelector<HTMLInputElement>('[data-find-filter="color"]')!,
        '#cc0000',
      )
    })

    expect(container.querySelector('[data-find-filter-count]')?.textContent).toBe('5')
    await act(async () => {
      searchBtn.click()
    })
    expect(findMatches).toHaveBeenLastCalledWith({
      charFormat: {
        bold: true,
        italic: false,
        font: '바탕',
        size: 11,
        color: '#cc0000',
      },
    })
  })

  it('virtualizes 2,000 matches into a small visible DOM slice and updates on scroll', async () => {
    const many = Array.from({ length: 2000 }, (_, i) => makeMatch(i, { matchText: `Hit${i}` }))
    const { bridge, findMatches } = createFakeBridge()
    findMatches.mockResolvedValueOnce({ ok: true, total: 2000, matches: many })

    await renderFindTab({ bridge, visible: true })

    await act(async () => {
      setInputValue(container.querySelector<HTMLInputElement>('[data-find-input="query"]')!, 'Hit')
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-find-action="search"]')!.click()
    })

    expect(container.querySelector('[data-find-total="2000"]')?.textContent).toBe('2000개 찾음')
    const initialRows = container.querySelectorAll('[data-find-row]')
    expect(initialRows.length).toBeGreaterThan(0)
    expect(initialRows.length).toBeLessThan(40)
    expect(initialRows[0].getAttribute('data-find-row')).toBe('0')

    // Scroll down to around match 500.
    const viewport = container.querySelector<HTMLDivElement>('[data-find-results="true"]')!
    await act(async () => {
      viewport.scrollTop = 500 * FIND_ROW_HEIGHT
      viewport.dispatchEvent(new Event('scroll'))
    })

    const scrolledRows = Array.from(container.querySelectorAll('[data-find-row]')).map((el) =>
      Number(el.getAttribute('data-find-row')),
    )
    expect(scrolledRows.length).toBeLessThan(40)
    expect(scrolledRows).toContain(500)
    expect(scrolledRows).not.toContain(0)
  })

  it('reveals match on row click without toggling checkbox, and checkbox click does not reveal', async () => {
    const matches = [makeMatch(0), makeMatch(1)]
    const { bridge, findMatches, revealFindMatch } = createFakeBridge()
    findMatches.mockResolvedValueOnce({ ok: true, total: 2, matches })

    await renderFindTab({ bridge, visible: true })
    await act(async () => {
      setInputValue(
        container.querySelector<HTMLInputElement>('[data-find-input="query"]')!,
        'Alpha',
      )
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-find-action="search"]')!.click()
    })

    const row1 = container.querySelector<HTMLDivElement>('[data-find-row="1"]')!
    const check1 = container.querySelector<HTMLInputElement>('[data-find-row-check="1"]')!

    // Click row 1 -> reveals match 1, checkbox remains unchecked.
    await act(async () => {
      row1.click()
    })
    expect(revealFindMatch).toHaveBeenCalledTimes(1)
    expect(revealFindMatch).toHaveBeenCalledWith(matches[1])
    expect(check1.checked).toBe(false)

    // Toggle checkbox on row 1 -> checks it, does NOT call revealFindMatch again.
    await act(async () => {
      check1.click()
    })
    expect(check1.checked).toBe(true)
    expect(revealFindMatch).toHaveBeenCalledTimes(1)
  })

  it('runs replace-this, replace-selected, and replace-all, reports skipped counts, and re-searches', async () => {
    const initial = [makeMatch(0), makeMatch(1), makeMatch(2)]
    const { bridge, findMatches, replaceFindMatches } = createFakeBridge()
    findMatches
      .mockResolvedValueOnce({ ok: true, total: 3, matches: initial })
      .mockResolvedValueOnce({ ok: true, total: 2, matches: [makeMatch(0), makeMatch(1)] })
      .mockResolvedValueOnce({ ok: true, total: 1, matches: [makeMatch(0)] })
      .mockResolvedValueOnce({ ok: true, total: 0, matches: [] })

    replaceFindMatches
      .mockResolvedValueOnce({
        ok: true,
        replaced: 1,
        skippedObjects: 0,
        skippedCitations: 0,
      })
      .mockResolvedValueOnce({
        ok: true,
        replaced: 1,
        skippedObjects: 1,
        skippedCitations: 0,
      })
      .mockResolvedValueOnce({
        ok: true,
        replaced: 1,
        skippedObjects: 2,
        skippedCitations: 3,
      })

    await renderFindTab({ bridge, visible: true })
    await act(async () => {
      setInputValue(
        container.querySelector<HTMLInputElement>('[data-find-input="query"]')!,
        'Alpha',
      )
      setInputValue(
        container.querySelector<HTMLInputElement>('[data-find-input="replace"]')!,
        'Beta',
      )
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-find-action="search"]')!.click()
    })
    expect(findMatches).toHaveBeenCalledTimes(1)

    // 1) Replace this (default active match is index 0).
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-find-action="replace-this"]')!.click()
    })
    expect(replaceFindMatches).toHaveBeenNthCalledWith(1, { query: 'Alpha' }, 'Beta', {
      indices: [0],
    })
    expect(findMatches).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-find-notice="replace"]')?.textContent).toContain(
      '1개 바꿨습니다.',
    )

    // 2) Replace selected (check row 1).
    await act(async () => {
      container.querySelector<HTMLInputElement>('[data-find-row-check="1"]')!.click()
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-find-action="replace-selected"]')!.click()
    })
    expect(replaceFindMatches).toHaveBeenNthCalledWith(2, { query: 'Alpha' }, 'Beta', {
      indices: [1],
    })
    expect(findMatches).toHaveBeenCalledTimes(3)
    expect(container.querySelector('[data-find-skipped="objects"]')?.textContent).toContain('1개')

    // 3) Replace all (reports both skippedObjects and skippedCitations).
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-find-action="replace-all"]')!.click()
    })
    expect(replaceFindMatches).toHaveBeenNthCalledWith(3, { query: 'Alpha' }, 'Beta', 'all')
    expect(findMatches).toHaveBeenCalledTimes(4)
    expect(container.querySelector('[data-find-skipped="objects"]')?.textContent).toContain('2개')
    expect(container.querySelector('[data-find-skipped="citations"]')?.textContent).toContain('3개')
    expect(container.querySelector('[data-find-stale="true"]')).toBeNull()
  })

  it('shows stale banner on external changeTick without auto-searching, and refreshes on click', async () => {
    const { bridge, findMatches } = createFakeBridge()
    findMatches
      .mockResolvedValueOnce({ ok: true, total: 1, matches: [makeMatch(0)] })
      .mockResolvedValueOnce({ ok: true, total: 2, matches: [makeMatch(0), makeMatch(1)] })

    await renderFindTab({ bridge, visible: true, changeTick: 0 })

    // Document changes before any search should NOT show the stale banner.
    await renderFindTab({ bridge, visible: true, changeTick: 1 })
    expect(container.querySelector('[data-find-stale="true"]')).toBeNull()
    expect(findMatches).toHaveBeenCalledTimes(0)

    // Run a search.
    await act(async () => {
      setInputValue(
        container.querySelector<HTMLInputElement>('[data-find-input="query"]')!,
        'Alpha',
      )
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-find-action="search"]')!.click()
    })
    expect(findMatches).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-find-stale="true"]')).toBeNull()

    // External document edit bumps changeTick -> shows banner, does NOT auto-call findMatches.
    await renderFindTab({ bridge, visible: true, changeTick: 2 })
    const banner = container.querySelector('[data-find-stale="true"]')
    expect(banner).not.toBeNull()
    expect(banner?.textContent).toContain('문서가 바뀌었습니다, 다시 찾기')
    expect(findMatches).toHaveBeenCalledTimes(1)

    // Clicking the banner action re-runs findMatches and hides the banner.
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-find-action="stale-refresh"]')!.click()
    })
    expect(findMatches).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-find-stale="true"]')).toBeNull()
    expect(container.querySelector('[data-find-total="2"]')?.textContent).toBe('2개 찾음')
  })

  it('does not show stale banner when changeTick bumps during its own replace', async () => {
    let currentTick = 1
    const { bridge, findMatches, replaceFindMatches } = createFakeBridge()
    findMatches
      .mockResolvedValueOnce({ ok: true, total: 1, matches: [makeMatch(0)] })
      .mockResolvedValueOnce({ ok: true, total: 0, matches: [] })
    replaceFindMatches.mockImplementationOnce(async () => {
      currentTick += 1
      await renderFindTab({ bridge, visible: true, changeTick: currentTick })
      return { ok: true, replaced: 1, skippedObjects: 0, skippedCitations: 0 }
    })

    await renderFindTab({ bridge, visible: true, changeTick: currentTick })
    await act(async () => {
      setInputValue(
        container.querySelector<HTMLInputElement>('[data-find-input="query"]')!,
        'Alpha',
      )
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-find-action="search"]')!.click()
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-find-action="replace-all"]')!.click()
    })

    expect(container.querySelector('[data-find-stale="true"]')).toBeNull()
  })
})
