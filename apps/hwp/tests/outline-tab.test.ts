/** @vitest-environment jsdom */
// OutlineTab UI, tree filtering/collapse, caret tracking, adaptive idle refresh,
// settings drawer, promote/demote, drag-and-drop reorder, and 22-language i18n shard.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LANGS } from '@genoffice/i18n'
import {
  DEFAULT_OUTLINE_STYLE_MAP,
  type OutlineCaret,
  type OutlineItem,
  type OutlineStyleMap,
  type ReadOutlineOptions,
  type ReadOutlineResult,
  type WriteDocOutlineMapResult,
} from '../studio-plugin/outline.mjs'
import { outlineStrings } from '../src/renderer/i18n/outline'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import {
  OUTLINE_PAUSE_PER_READ,
  OutlineTab,
  type ChangeOutlineLevelParams,
  type ChangeOutlineLevelResult,
  type MoveOutlineSectionParams,
  type MoveOutlineSectionResult,
  type OutlineSettingsApi,
  type OutlineTabBridge,
  type OutlineTabProps,
} from '../src/renderer/workpane/OutlineTab'
import type { HwpApi } from '../src/shared/ipc'

function makeItem(overrides: Partial<OutlineItem> & { sec: number; para: number }): OutlineItem {
  return {
    level: 1,
    number: '',
    title: 'Heading',
    page: 1,
    physicalPage: 1,
    source: 'style',
    styleName: '제목 1',
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

function createFakeBridge(overrides: Partial<OutlineTabBridge> = {}): {
  bridge: OutlineTabBridge
  readOutline: ReturnType<
    typeof vi.fn<(options?: ReadOutlineOptions) => Promise<ReadOutlineResult>>
  >
  setDocOutlineMap: ReturnType<
    typeof vi.fn<(map: OutlineStyleMap | null) => Promise<WriteDocOutlineMapResult>>
  >
  caretPosition: ReturnType<typeof vi.fn<() => Promise<OutlineCaret | null>>>
  reveal: ReturnType<
    typeof vi.fn<
      (place: { sec: number; para: number; offset: number; length: number }) => Promise<{
        ok: boolean
      }>
    >
  >
  listStyles: ReturnType<typeof vi.fn<() => Promise<{ paragraph: string[]; character: string[] }>>>
  changeOutlineLevel: ReturnType<
    typeof vi.fn<(params: ChangeOutlineLevelParams) => Promise<ChangeOutlineLevelResult>>
  >
  moveOutlineSection: ReturnType<
    typeof vi.fn<(params: MoveOutlineSectionParams) => Promise<MoveOutlineSectionResult>>
  >
} {
  const readOutline = vi.fn<(options?: ReadOutlineOptions) => Promise<ReadOutlineResult>>(
    async (options) => ({
      items: [],
      effectiveStyleMap: options?.appStyleMap ?? { ...DEFAULT_OUTLINE_STYLE_MAP },
      hasDocStyleMap: false,
      docStyleMap: null,
    }),
  )
  const setDocOutlineMap = vi.fn<
    (map: OutlineStyleMap | null) => Promise<WriteDocOutlineMapResult>
  >(async (map) => (map === null ? { ok: true, existed: true, map: null } : { ok: true, map }))
  const caretPosition = vi.fn<() => Promise<OutlineCaret | null>>(async () => null)
  const reveal = vi.fn<
    (place: { sec: number; para: number; offset: number; length: number }) => Promise<{
      ok: boolean
    }>
  >(async () => ({ ok: true }))
  const listStyles = vi.fn<() => Promise<{ paragraph: string[]; character: string[] }>>(
    async () => ({
      paragraph: ['바탕글', '제목 1', '제목 2', '논문장제목', '절제목'],
      character: [],
    }),
  )
  const changeOutlineLevel = vi.fn<
    (params: ChangeOutlineLevelParams) => Promise<ChangeOutlineLevelResult>
  >(async (params) => ({
    ok: true,
    changed: [
      {
        sec: params.sec,
        para: params.para,
        fromLevel: 2,
        toLevel: 2 + params.delta,
        styleName: `제목 ${2 + params.delta}`,
      },
    ],
    place: { sec: params.sec, para: params.para, offset: 0, length: 0 },
  }))
  const moveOutlineSection = vi.fn<
    (params: MoveOutlineSectionParams) => Promise<MoveOutlineSectionResult>
  >(async (params) => ({
    ok: true,
    movedParagraphs: 3,
    newStart: { sec: params.target.sec, para: params.target.para },
    place: { sec: params.target.sec, para: params.target.para, offset: 0, length: 0 },
  }))

  const bridge: OutlineTabBridge = {
    readOutline: overrides.readOutline ?? readOutline,
    setDocOutlineMap: overrides.setDocOutlineMap ?? setDocOutlineMap,
    caretPosition: overrides.caretPosition ?? caretPosition,
    reveal: overrides.reveal ?? reveal,
    listStyles: overrides.listStyles ?? listStyles,
    changeOutlineLevel: overrides.changeOutlineLevel ?? changeOutlineLevel,
    moveOutlineSection: overrides.moveOutlineSection ?? moveOutlineSection,
  }

  return {
    bridge,
    readOutline,
    setDocOutlineMap,
    caretPosition,
    reveal,
    listStyles,
    changeOutlineLevel,
    moveOutlineSection,
  }
}

function createFakeSettingsApi(initialMap: OutlineStyleMap = { ...DEFAULT_OUTLINE_STYLE_MAP }): {
  settingsApi: OutlineSettingsApi
  getOutlineStyleMap: ReturnType<typeof vi.fn<() => Promise<OutlineStyleMap>>>
  setOutlineStyleMap: ReturnType<
    typeof vi.fn<(map: OutlineStyleMap | null) => Promise<OutlineStyleMap>>
  >
  emitChanged: (nextMap: OutlineStyleMap) => void
} {
  let currentMap: OutlineStyleMap = { ...initialMap }
  const listeners = new Set<(map: OutlineStyleMap) => void>()

  const getOutlineStyleMap = vi.fn<() => Promise<OutlineStyleMap>>(async () => ({ ...currentMap }))
  const setOutlineStyleMap = vi.fn<(map: OutlineStyleMap | null) => Promise<OutlineStyleMap>>(
    async (map) => {
      currentMap = map === null ? { ...DEFAULT_OUTLINE_STYLE_MAP } : { ...map }
      return { ...currentMap }
    },
  )

  const settingsApi: OutlineSettingsApi = {
    getOutlineStyleMap,
    setOutlineStyleMap,
    onOutlineStyleMapChanged: (handler) => {
      listeners.add(handler)
      return () => {
        listeners.delete(handler)
      }
    },
  }

  return {
    settingsApi,
    getOutlineStyleMap,
    setOutlineStyleMap,
    emitChanged: (nextMap) => {
      currentMap = { ...nextMap }
      for (const listener of listeners) listener({ ...currentMap })
    },
  }
}

function mockRowRect(el: HTMLElement, top: number, height: number): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top,
    bottom: top + height,
    left: 0,
    right: 260,
    width: 260,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect)
}

function makeDragEvent(
  type: string,
  init: { clientY?: number; data?: Record<string, string> } = {},
): Event {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientY: init.clientY ?? 0,
  })
  const store: Record<string, string> = { ...(init.data ?? {}) }
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: (format: string, val: string) => {
        store[format] = val
      },
      getData: (format: string) => store[format] ?? '',
    },
  })
  return event
}

describe('outline i18n shard (22 languages)', () => {
  it('covers every UI language in LANGS with identical keys and preserved placeholders', () => {
    expect(Object.keys(outlineStrings).sort()).toEqual([...LANGS].sort())
    const keys = Object.keys(outlineStrings.zh).sort()
    const placeholders = (text: string): string[] =>
      Array.from(text.matchAll(/\{[a-zA-Z0-9_]+\}/g))
        .map((m) => m[0])
        .sort()

    for (const lang of LANGS) {
      const dict = outlineStrings[lang]
      expect(Object.keys(dict).sort(), lang).toEqual(keys)
      for (const key of keys) {
        const value = dict[key as keyof typeof dict]
        expect(value.trim().length, `${lang}.${key}`).toBeGreaterThan(0)
        expect(placeholders(value), `${lang}.${key} placeholders`).toEqual(
          placeholders(outlineStrings.en[key as keyof typeof dict]),
        )
      }
    }
  })

  it('does not leave untranslated English strings in Korean or other non-English locales', () => {
    const keys = Object.keys(outlineStrings.en) as Array<keyof typeof outlineStrings.en>
    for (const key of keys) {
      expect(outlineStrings.ko[key], `ko.${key}`).not.toBe(outlineStrings.en[key])
    }
    for (const lang of LANGS) {
      if (lang === 'en') continue
      expect(outlineStrings[lang].outlinePromote, lang).not.toBe(outlineStrings.en.outlinePromote)
      expect(outlineStrings[lang].outlineDemote, lang).not.toBe(outlineStrings.en.outlineDemote)
      expect(outlineStrings[lang].outlineEmpty, lang).not.toBe(outlineStrings.en.outlineEmpty)
      expect(outlineStrings[lang].outlineSettingsTitle, lang).not.toBe(
        outlineStrings.en.outlineSettingsTitle,
      )
      expect(outlineStrings[lang].outlineMoveCrossSection, lang).not.toBe(
        outlineStrings.en.outlineMoveCrossSection,
      )
    }
  })
})

describe('OutlineTab component', () => {
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
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function renderOutlineTab(props: OutlineTabProps, lang: 'ko' | 'en' = 'ko'): Promise<void> {
    if (!root) root = createRoot(container)
    await act(async () => {
      root!.render(
        createElement(LocaleProvider, {
          initial: lang,
          children: createElement(OutlineTab, props),
        }),
      )
    })
  }

  it('renders outline tree with numbers, titles, printed page labels, and level indentation', async () => {
    const items: OutlineItem[] = [
      makeItem({
        sec: 0,
        para: 0,
        level: 1,
        number: '제1장',
        title: '서론',
        page: 1,
        pageLabel: 'i',
        physicalPage: 1,
      }),
      makeItem({
        sec: 0,
        para: 4,
        level: 2,
        number: '1.1',
        title: '연구 배경',
        page: 1,
        physicalPage: 3,
        styleName: '제목 2',
      }),
      makeItem({
        sec: 0,
        para: 9,
        level: 3,
        number: '1.1.1',
        title: '세부 내용',
        page: 2,
        physicalPage: 4,
        styleName: '제목 3',
      }),
    ]
    const { bridge, readOutline } = createFakeBridge()
    readOutline.mockResolvedValue({
      items,
      effectiveStyleMap: { ...DEFAULT_OUTLINE_STYLE_MAP },
      hasDocStyleMap: false,
      docStyleMap: null,
    })
    const { settingsApi } = createFakeSettingsApi()

    await renderOutlineTab({ bridge, settingsApi, caretPollMs: 0 })

    const rows = Array.from(container.querySelectorAll<HTMLDivElement>('[data-outline-row]'))
    expect(rows).toHaveLength(3)
    expect(rows[0].querySelector('[data-outline-number="0:0"]')?.textContent).toBe('제1장')
    expect(rows[0].querySelector('.outline-row-title')?.textContent).toBe('서론')
    expect(rows[0].querySelector('[data-outline-page="0:0"]')?.textContent).toBe('i')

    expect(rows[1].querySelector('[data-outline-number="0:4"]')?.textContent).toBe('1.1')
    expect(rows[1].querySelector('.outline-row-title')?.textContent).toBe('연구 배경')
    expect(rows[1].querySelector('[data-outline-page="0:4"]')?.textContent).toBe('1')

    expect(rows[2].querySelector('[data-outline-page="0:9"]')?.textContent).toBe('2')

    const indent0 = parseInt(rows[0].style.paddingLeft, 10)
    const indent1 = parseInt(rows[1].style.paddingLeft, 10)
    const indent2 = parseInt(rows[2].style.paddingLeft, 10)
    expect(indent1).toBeGreaterThan(indent0)
    expect(indent2).toBeGreaterThan(indent1)
  })

  it('filters visible headings accurately with level filter buttons (1, 2, 3, ..., All)', async () => {
    const items: OutlineItem[] = [
      makeItem({ sec: 0, para: 0, level: 1, title: 'Chapter 1', page: 1 }),
      makeItem({ sec: 0, para: 2, level: 2, title: 'Section 1.1', page: 2 }),
      makeItem({ sec: 0, para: 5, level: 3, title: 'Sub 1.1.1', page: 3 }),
      makeItem({ sec: 0, para: 8, level: 4, title: 'Detail 1.1.1.1', page: 4 }),
    ]
    const { bridge, readOutline } = createFakeBridge()
    readOutline.mockResolvedValue({
      items,
      effectiveStyleMap: { ...DEFAULT_OUTLINE_STYLE_MAP },
      hasDocStyleMap: false,
      docStyleMap: null,
    })
    const { settingsApi } = createFakeSettingsApi()

    await renderOutlineTab({ bridge, settingsApi, caretPollMs: 0 })

    // Buttons 1..4 plus All should exist since max heading level is 4.
    expect(container.querySelector('[data-outline-level-filter="1"]')).not.toBeNull()
    expect(container.querySelector('[data-outline-level-filter="4"]')).not.toBeNull()
    expect(container.querySelector('[data-outline-level-filter="5"]')).toBeNull()
    expect(container.querySelectorAll('[data-outline-row]')).toHaveLength(4)

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-outline-level-filter="2"]')!.click()
    })
    const level2Rows = Array.from(container.querySelectorAll('[data-outline-row]'))
    expect(level2Rows.map((el) => el.getAttribute('data-outline-row'))).toEqual(['0:0', '0:2'])

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-outline-level-filter="1"]')!.click()
    })
    const level1Rows = Array.from(container.querySelectorAll('[data-outline-row]'))
    expect(level1Rows.map((el) => el.getAttribute('data-outline-row'))).toEqual(['0:0'])

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-outline-level-filter="all"]')!.click()
    })
    expect(container.querySelectorAll('[data-outline-row]')).toHaveLength(4)
  })

  it('collapses and expands only descendant headings per branch', async () => {
    const items: OutlineItem[] = [
      makeItem({ sec: 0, para: 0, level: 1, title: 'Ch 1', page: 1 }),
      makeItem({ sec: 0, para: 2, level: 2, title: 'Sec 1.1', page: 1 }),
      makeItem({ sec: 0, para: 4, level: 3, title: 'Sub 1.1.1', page: 2 }),
      makeItem({ sec: 0, para: 6, level: 2, title: 'Sec 1.2', page: 2 }),
      makeItem({ sec: 0, para: 10, level: 1, title: 'Ch 2', page: 3 }),
      makeItem({ sec: 0, para: 12, level: 2, title: 'Sec 2.1', page: 4 }),
    ]
    const { bridge, readOutline } = createFakeBridge()
    readOutline.mockResolvedValue({
      items,
      effectiveStyleMap: { ...DEFAULT_OUTLINE_STYLE_MAP },
      hasDocStyleMap: false,
      docStyleMap: null,
    })
    const { settingsApi } = createFakeSettingsApi()

    await renderOutlineTab({ bridge, settingsApi, caretPollMs: 0 })

    // Leaf rows should not render a collapse toggle.
    expect(container.querySelector('[data-outline-toggle="0:4"]')).toBeNull()
    expect(container.querySelector('[data-outline-toggle="0:6"]')).toBeNull()
    expect(container.querySelector('[data-outline-toggle="0:0"]')).not.toBeNull()
    expect(container.querySelector('[data-outline-toggle="0:2"]')).not.toBeNull()

    // Collapse Sec 1.1 -> hides only Sub 1.1.1.
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-outline-toggle="0:2"]')!.click()
    })
    expect(
      Array.from(container.querySelectorAll('[data-outline-row]')).map((el) =>
        el.getAttribute('data-outline-row'),
      ),
    ).toEqual(['0:0', '0:2', '0:6', '0:10', '0:12'])

    // Collapse Ch 1 -> hides all descendants of Ch 1 while keeping Ch 2 & Sec 2.1 visible.
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-outline-toggle="0:0"]')!.click()
    })
    expect(
      Array.from(container.querySelectorAll('[data-outline-row]')).map((el) =>
        el.getAttribute('data-outline-row'),
      ),
    ).toEqual(['0:0', '0:10', '0:12'])

    // Expand Ch 1 -> Sec 1.1 stays collapsed until expanded itself.
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-outline-toggle="0:0"]')!.click()
    })
    expect(
      Array.from(container.querySelectorAll('[data-outline-row]')).map((el) =>
        el.getAttribute('data-outline-row'),
      ),
    ).toEqual(['0:0', '0:2', '0:6', '0:10', '0:12'])

    // Expand Sec 1.1 -> restores Sub 1.1.1.
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-outline-toggle="0:2"]')!.click()
    })
    expect(container.querySelectorAll('[data-outline-row]')).toHaveLength(6)
  })

  it('navigates to heading on click via bridge.reveal({ sec, para, offset: 0, length: 0 })', async () => {
    const items: OutlineItem[] = [
      makeItem({ sec: 0, para: 0, level: 1, title: 'Intro', page: 1 }),
      makeItem({ sec: 1, para: 15, level: 2, title: 'Methods', page: 5 }),
    ]
    const { bridge, readOutline, reveal } = createFakeBridge()
    readOutline.mockResolvedValue({
      items,
      effectiveStyleMap: { ...DEFAULT_OUTLINE_STYLE_MAP },
      hasDocStyleMap: false,
      docStyleMap: null,
    })
    const { settingsApi } = createFakeSettingsApi()

    await renderOutlineTab({ bridge, settingsApi, caretPollMs: 0 })

    await act(async () => {
      container.querySelector<HTMLDivElement>('[data-outline-row="1:15"]')!.click()
    })

    expect(reveal).toHaveBeenCalledWith({ sec: 1, para: 15, offset: 0, length: 0 })
    expect(container.querySelector('[data-outline-row="1:15"]')?.getAttribute('aria-current')).toBe(
      'location',
    )
  })

  it('tracks active heading from bridge.caretPosition() via findActiveOutlineIndex and scrolls it into view', async () => {
    const items: OutlineItem[] = [
      makeItem({ sec: 0, para: 0, level: 1, title: 'Intro', page: 1 }),
      makeItem({ sec: 0, para: 10, level: 2, title: 'Body', page: 2 }),
      makeItem({ sec: 0, para: 25, level: 2, title: 'Conclusion', page: 4 }),
    ]
    const scrollIntoViewMock = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock,
    })

    let currentCaret: OutlineCaret = { sec: 0, para: 14 }
    const { bridge, readOutline, caretPosition } = createFakeBridge()
    readOutline.mockResolvedValue({
      items,
      effectiveStyleMap: { ...DEFAULT_OUTLINE_STYLE_MAP },
      hasDocStyleMap: false,
      docStyleMap: null,
    })
    caretPosition.mockImplementation(async () => currentCaret)
    const { settingsApi } = createFakeSettingsApi()

    vi.useFakeTimers()
    await renderOutlineTab({ bridge, settingsApi, caretPollMs: 500 })

    // Caret at para 14 maps to heading at para 10.
    expect(container.querySelector('[data-outline-row="0:10"]')?.classList.contains('active')).toBe(
      true,
    )
    expect(container.querySelector('[data-outline-row="0:10"]')?.getAttribute('aria-current')).toBe(
      'location',
    )
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'nearest' })

    // Move caret past para 25 and advance poll interval.
    scrollIntoViewMock.mockClear()
    currentCaret = { sec: 0, para: 30 }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(container.querySelector('[data-outline-row="0:25"]')?.classList.contains('active')).toBe(
      true,
    )
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('coalesces rapid changeTick bumps via adaptive debounce + requestIdleCallback and defers while hidden', async () => {
    vi.useFakeTimers()
    const idleCallbacks = new Map<number, IdleRequestCallback>()
    let nextIdleId = 1
    const reqIdle = vi.fn((cb: IdleRequestCallback) => {
      const id = nextIdleId++
      idleCallbacks.set(id, cb)
      return id
    })
    const cancelIdle = vi.fn((id: number) => {
      idleCallbacks.delete(id)
    })
    vi.stubGlobal('requestIdleCallback', reqIdle)
    vi.stubGlobal('cancelIdleCallback', cancelIdle)

    // Simulate a read costing 300ms so adaptive delay becomes 300 * 4 = 1200ms (> 700ms).
    let fakeNow = 0
    vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)

    const { bridge, readOutline } = createFakeBridge()
    readOutline.mockImplementation(async () => {
      fakeNow += 300
      return {
        items: [makeItem({ sec: 0, para: 0, level: 1, title: 'Doc', page: 1 })],
        effectiveStyleMap: { ...DEFAULT_OUTLINE_STYLE_MAP },
        hasDocStyleMap: false,
        docStyleMap: null,
      }
    })
    const { settingsApi } = createFakeSettingsApi()

    await renderOutlineTab({
      bridge,
      settingsApi,
      changeTick: 0,
      visible: true,
      refreshPauseMs: 700,
      caretPollMs: 0,
    })
    expect(readOutline).toHaveBeenCalledTimes(1)

    // Rapid changeTick bumps should coalesce into a single scheduled refresh.
    await renderOutlineTab({
      bridge,
      settingsApi,
      changeTick: 1,
      visible: true,
      refreshPauseMs: 700,
      caretPollMs: 0,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    await renderOutlineTab({
      bridge,
      settingsApi,
      changeTick: 2,
      visible: true,
      refreshPauseMs: 700,
      caretPollMs: 0,
    })
    await renderOutlineTab({
      bridge,
      settingsApi,
      changeTick: 3,
      visible: true,
      refreshPauseMs: 700,
      caretPollMs: 0,
    })

    // Still before adaptive delay (300ms * OUTLINE_PAUSE_PER_READ = 1200ms).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })
    expect(reqIdle).not.toHaveBeenCalled()
    expect(readOutline).toHaveBeenCalledTimes(1)

    // After full adaptive pause, requestIdleCallback is queued (not run until idle).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300 * OUTLINE_PAUSE_PER_READ - 700)
    })
    expect(reqIdle).toHaveBeenCalledTimes(1)
    expect(readOutline).toHaveBeenCalledTimes(1)

    // Fire the queued idle callback -> exactly one coalesced readOutline call runs.
    await act(async () => {
      for (const cb of Array.from(idleCallbacks.values())) {
        cb({ didTimeout: false, timeRemaining: () => 50 })
      }
      idleCallbacks.clear()
    })
    expect(readOutline).toHaveBeenCalledTimes(2)

    // While hidden, changeTick bumps defer until visible becomes true again.
    await renderOutlineTab({
      bridge,
      settingsApi,
      changeTick: 4,
      visible: false,
      refreshPauseMs: 700,
      caretPollMs: 0,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(readOutline).toHaveBeenCalledTimes(2)

    await renderOutlineTab({
      bridge,
      settingsApi,
      changeTick: 4,
      visible: true,
      refreshPauseMs: 700,
      caretPollMs: 0,
    })
    expect(readOutline).toHaveBeenCalledTimes(3)
  })

  it('edits document-only vs app-wide mappings, allows removing default 제목 1, and reacts to external updates', async () => {
    let docMap: OutlineStyleMap | null = null
    const { bridge, readOutline, setDocOutlineMap, listStyles } = createFakeBridge()
    readOutline.mockImplementation(async (options) => {
      const effective = docMap ?? options?.appStyleMap ?? { ...DEFAULT_OUTLINE_STYLE_MAP }
      return {
        items: [makeItem({ sec: 0, para: 0, level: 1, title: 'Chapter', page: 1 })],
        effectiveStyleMap: effective,
        hasDocStyleMap: docMap !== null,
        docStyleMap: docMap,
      }
    })
    setDocOutlineMap.mockImplementation(async (nextMap) => {
      docMap = nextMap
      return nextMap === null ? { ok: true, existed: true, map: null } : { ok: true, map: nextMap }
    })

    const { settingsApi, setOutlineStyleMap, emitChanged } = createFakeSettingsApi({
      '제목 1': 1,
      '제목 2': 2,
    })

    await renderOutlineTab({ bridge, settingsApi, caretPollMs: 0 })

    // Open settings drawer.
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-outline-action="toggle-settings"]')!.click()
    })
    expect(container.querySelector('[data-outline-settings="open"]')).not.toBeNull()
    expect(listStyles).toHaveBeenCalled()

    // Style datalist should be populated from bridge.listStyles().paragraph.
    const datalistValues = Array.from(
      container.querySelectorAll<HTMLOptionElement>('[data-outline-style-options] option'),
    ).map((o) => o.value)
    expect(datalistValues).toContain('논문장제목')

    // In doc scope (default), remove default '제목 1' -> calls setDocOutlineMap without '제목 1'.
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-outline-remove-style="제목 1"]')!.click()
    })
    expect(setDocOutlineMap).toHaveBeenCalledWith({ '제목 2': 2 })
    expect(container.querySelector('[data-outline-mapping-style="제목 1"]')).toBeNull()

    // Add a custom style '논문장제목' at level 1 in doc scope.
    await act(async () => {
      setInputValue(
        container.querySelector<HTMLInputElement>('[data-outline-add-style="input"]')!,
        '논문장제목',
      )
      setSelectValue(
        container.querySelector<HTMLSelectElement>('[data-outline-add-level="select"]')!,
        '1',
      )
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-outline-action="add-mapping"]')!.click()
    })
    expect(setDocOutlineMap).toHaveBeenLastCalledWith({ '제목 2': 2, 논문장제목: 1 })

    // Clear doc override -> calls setDocOutlineMap(null).
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-outline-action="clear-doc-map"]')!.click()
    })
    expect(setDocOutlineMap).toHaveBeenLastCalledWith(null)

    // Switch to app-wide scope and add '절제목' at level 2.
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-outline-scope="app"]')!.click()
    })
    await act(async () => {
      setInputValue(
        container.querySelector<HTMLInputElement>('[data-outline-add-style="input"]')!,
        '절제목',
      )
      setSelectValue(
        container.querySelector<HTMLSelectElement>('[data-outline-add-level="select"]')!,
        '2',
      )
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-outline-action="add-mapping"]')!.click()
    })
    expect(setOutlineStyleMap).toHaveBeenCalledWith({
      '제목 1': 1,
      '제목 2': 2,
      절제목: 2,
    })

    // External onOutlineStyleMapChanged event from another tab refreshes outline immediately.
    const callsBeforeExternal = readOutline.mock.calls.length
    await act(async () => {
      emitChanged({ '제목 1': 1, 장제목: 1 })
    })
    expect(readOutline.mock.calls.length).toBeGreaterThan(callsBeforeExternal)
    expect(readOutline).toHaveBeenLastCalledWith({
      appStyleMap: { '제목 1': 1, 장제목: 1 },
    })
  })

  it('supports promote/demote toolbar buttons (Shift for singleOnly), context menu, and refusal notices', async () => {
    const items: OutlineItem[] = [
      makeItem({ sec: 0, para: 0, level: 1, title: 'Chapter 1', page: 1 }),
      makeItem({ sec: 0, para: 5, level: 2, title: 'Section 1.1', page: 2, styleName: '제목 2' }),
    ]
    const { bridge, readOutline, caretPosition, changeOutlineLevel } = createFakeBridge()
    readOutline.mockResolvedValue({
      items,
      effectiveStyleMap: { '제목 1': 1, '제목 2': 2 },
      hasDocStyleMap: false,
      docStyleMap: null,
    })
    caretPosition.mockResolvedValue({ sec: 0, para: 5 })
    const { settingsApi } = createFakeSettingsApi({ '제목 1': 1, '제목 2': 2 })

    await renderOutlineTab({ bridge, settingsApi, caretPollMs: 0 })

    // Normal toolbar click -> singleOnly: false.
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-outline-action="promote"]')!.click()
    })
    expect(changeOutlineLevel).toHaveBeenLastCalledWith({
      sec: 0,
      para: 5,
      delta: -1,
      singleOnly: false,
      appStyleMap: { '제목 1': 1, '제목 2': 2 },
    })

    // Shift+click on Demote -> singleOnly: true.
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-outline-action="demote"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    })
    expect(changeOutlineLevel).toHaveBeenLastCalledWith({
      sec: 0,
      para: 5,
      delta: 1,
      singleOnly: true,
      appStyleMap: { '제목 1': 1, '제목 2': 2 },
    })

    // Context menu on row 0:0 -> Promote this heading only -> refusal notice on ok: false.
    changeOutlineLevel.mockResolvedValueOnce({
      ok: false,
      reason: 'level_out_of_range',
      sec: 0,
      para: 0,
      fromLevel: 1,
      targetLevel: 0,
    })
    await act(async () => {
      container
        .querySelector<HTMLDivElement>('[data-outline-row="0:0"]')!
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
    expect(container.querySelector('[data-outline-context-menu="true"]')).not.toBeNull()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-outline-menu="promote-single"]')!.click()
    })
    expect(changeOutlineLevel).toHaveBeenLastCalledWith({
      sec: 0,
      para: 0,
      delta: -1,
      singleOnly: true,
      appStyleMap: { '제목 1': 1, '제목 2': 2 },
    })
    const alert = container.querySelector('[data-outline-notice="error"]')
    expect(alert).not.toBeNull()
    expect(alert?.getAttribute('role')).toBe('alert')
    expect(alert?.getAttribute('data-outline-notice-reason')).toBe('level_out_of_range')
    expect(alert?.textContent).toContain('1')

    // Missing style refusal displays the missing style name.
    changeOutlineLevel.mockResolvedValueOnce({
      ok: false,
      reason: 'missing_style_in_doc',
      styleName: '제목 3',
      targetLevel: 3,
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-outline-action="demote"]')!.click()
    })
    const missingStyleAlert = container.querySelector('[data-outline-notice="error"]')
    expect(missingStyleAlert?.getAttribute('data-outline-notice-reason')).toBe(
      'missing_style_in_doc',
    )
    expect(missingStyleAlert?.textContent).toContain('제목 3')
  })

  it('reorders sections via drag-and-drop (before/after) and shows refusal notice on ok: false', async () => {
    const items: OutlineItem[] = [
      makeItem({ sec: 0, para: 0, level: 1, title: 'Part A', page: 1 }),
      makeItem({ sec: 0, para: 6, level: 1, title: 'Part B', page: 2 }),
      makeItem({ sec: 1, para: 0, level: 1, title: 'Part C', page: 4 }),
    ]
    const { bridge, readOutline, moveOutlineSection } = createFakeBridge()
    readOutline.mockResolvedValue({
      items,
      effectiveStyleMap: { '제목 1': 1 },
      hasDocStyleMap: false,
      docStyleMap: null,
    })
    const { settingsApi } = createFakeSettingsApi({ '제목 1': 1 })

    await renderOutlineTab({ bridge, settingsApi, caretPollMs: 0 })

    const rowA = container.querySelector<HTMLDivElement>('[data-outline-row="0:0"]')!
    const rowB = container.querySelector<HTMLDivElement>('[data-outline-row="0:6"]')!
    const rowC = container.querySelector<HTMLDivElement>('[data-outline-row="1:0"]')!
    mockRowRect(rowA, 0, 30)
    mockRowRect(rowB, 30, 30)
    mockRowRect(rowC, 60, 30)

    // Drag Part A onto bottom half of Part B -> position: 'after'.
    await act(async () => {
      rowA.dispatchEvent(makeDragEvent('dragstart'))
      rowB.dispatchEvent(makeDragEvent('dragover', { clientY: 54 }))
    })
    expect(rowB.classList.contains('drop-after')).toBe(true)

    await act(async () => {
      rowB.dispatchEvent(makeDragEvent('drop', { clientY: 54 }))
    })
    expect(moveOutlineSection).toHaveBeenLastCalledWith({
      source: { sec: 0, para: 0 },
      target: { sec: 0, para: 6 },
      position: 'after',
      appStyleMap: { '제목 1': 1 },
    })

    // Drag Part B onto top half of Part C -> position: 'before', and engine refuses cross_section.
    moveOutlineSection.mockResolvedValueOnce({
      ok: false,
      reason: 'cross_section',
    })
    await act(async () => {
      rowB.dispatchEvent(makeDragEvent('dragstart'))
      rowC.dispatchEvent(makeDragEvent('dragover', { clientY: 64 }))
    })
    expect(rowC.classList.contains('drop-before')).toBe(true)

    await act(async () => {
      rowC.dispatchEvent(makeDragEvent('drop', { clientY: 64 }))
    })
    expect(moveOutlineSection).toHaveBeenLastCalledWith({
      source: { sec: 0, para: 6 },
      target: { sec: 1, para: 0 },
      position: 'before',
      appStyleMap: { '제목 1': 1 },
    })

    const alert = container.querySelector('[data-outline-notice="error"]')
    expect(alert).not.toBeNull()
    expect(alert?.getAttribute('role')).toBe('alert')
    expect(alert?.getAttribute('data-outline-notice-reason')).toBe('cross_section')
  })
})
