/** @vitest-environment jsdom */
// Left workpane shell (WorkpaneSide.tsx, workpane-state.ts, workpane-menu.mjs,
// hancom-keys Ctrl+F binding, App integration, and 22-language workpane i18n shard).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { defaultAiSettings } from '@genoffice/ai-provider'
import { LANGS } from '@genoffice/i18n'
import type { AppChoiceSource, AppChoiceState } from '@genoffice/ui'
import {
  ADDED_SHORTCUTS,
  CHORDS,
  LABELS,
  REMOVED_SHORTCUTS,
  adaptToHancom,
  hancomCommands,
  withHancomLabel,
} from '../studio-plugin/hancom-keys.mjs'
import {
  WORKPANE_COMMAND_EVENT,
  WORKPANE_MENU_ITEMS,
  installWorkpaneMenu,
} from '../studio-plugin/workpane-menu.mjs'
import { workpaneStrings } from '../src/renderer/i18n/workpane'
import {
  DEFAULT_WORKPANE_TAB,
  DEFAULT_WORKPANE_TABS,
  MIN_DOC_WIDTH,
  WORKPANE_OPEN_KEY,
  WORKPANE_RAIL_WIDTH,
  WORKPANE_TAB_KEY,
  WORKPANE_WIDTH_DEFAULT,
  WORKPANE_WIDTH_KEY,
  WORKPANE_WIDTH_MAX,
  WORKPANE_WIDTH_MIN,
  WorkpaneSide,
  WorkpaneToggle,
  clampWorkpaneWidth,
  isWorkpaneFindShortcut,
  loadWorkpaneOpen,
  loadWorkpaneTab,
  loadWorkpaneWidth,
  parseWorkpaneCommand,
  resolveWorkpaneMode,
  saveWorkpaneOpen,
  saveWorkpaneTab,
  saveWorkpaneWidth,
  type WorkpaneSlotContext,
  type WorkpaneTabDef,
} from '../src/renderer/workpane'
import type { HwpApi } from '../src/shared/ipc'

let mockEditorFrame: HTMLIFrameElement | null = null

vi.mock('@rhwp/editor', () => ({
  createEditor: async (host: HTMLElement) => {
    const frame = document.createElement('iframe')
    host.appendChild(frame)
    mockEditorFrame = frame
    return {
      element: frame,
      loadFile: async () => undefined,
      commands: { context: async () => ({ isDirty: false, passwordProtected: false }) },
      plugins: {
        load: async () => undefined,
        invoke: async () => ({ ok: true, memos: [], tabs: [], count: 0, segments: [], fonts: [] }),
      },
      chrome: { get: async () => ({}), set: async () => undefined },
      exportHwp: async () => new Uint8Array(),
      exportHwpx: async () => new Uint8Array(),
      notifySaved: () => undefined,
      destroy: () => undefined,
    }
  },
}))

import App from '../src/renderer/App'
import { LocaleProvider } from '../src/renderer/i18n/locale'

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  }
}

describe('workpane state, tab registry, persistence, and auto-collapse', () => {
  it('registers Outline and Find tabs by default', () => {
    expect(DEFAULT_WORKPANE_TABS.map((tab) => tab.id)).toEqual(['outline', 'find'])
    expect(DEFAULT_WORKPANE_TAB).toBe('outline')
  })

  it('persists open state, active tab, and clamped width independently', () => {
    const storage = memoryStorage()
    expect(loadWorkpaneOpen(storage)).toBe(false)
    saveWorkpaneOpen(true, storage)
    expect(storage.data.get(WORKPANE_OPEN_KEY)).toBe('1')
    expect(loadWorkpaneOpen(storage)).toBe(true)
    saveWorkpaneOpen(false, storage)
    expect(loadWorkpaneOpen(storage)).toBe(false)

    expect(loadWorkpaneTab(undefined, storage)).toBe('outline')
    saveWorkpaneTab('find', storage)
    expect(storage.data.get(WORKPANE_TAB_KEY)).toBe('find')
    expect(loadWorkpaneTab(undefined, storage)).toBe('find')
    // supports future registered tabs such as bibliography
    saveWorkpaneTab('bibliography', storage)
    expect(loadWorkpaneTab(['outline', 'find'], storage)).toBe('outline')
    expect(loadWorkpaneTab(['outline', 'find', 'bibliography'], storage)).toBe('bibliography')

    expect(loadWorkpaneWidth(storage)).toBe(WORKPANE_WIDTH_DEFAULT)
    expect(loadWorkpaneWidth(memoryStorage({ [WORKPANE_WIDTH_KEY]: 'not-a-number' }))).toBe(
      WORKPANE_WIDTH_DEFAULT,
    )
    saveWorkpaneWidth(100, storage)
    expect(storage.data.get(WORKPANE_WIDTH_KEY)).toBe(String(WORKPANE_WIDTH_MIN))
    saveWorkpaneWidth(999, storage)
    expect(storage.data.get(WORKPANE_WIDTH_KEY)).toBe(String(WORKPANE_WIDTH_MAX))
    saveWorkpaneWidth(340, storage)
    expect(loadWorkpaneWidth(storage)).toBe(340)
  })

  it('clamps widths and auto-collapses to rail when document width would drop below MIN_DOC_WIDTH', () => {
    expect(clampWorkpaneWidth(120)).toBe(WORKPANE_WIDTH_MIN)
    expect(clampWorkpaneWidth(800)).toBe(WORKPANE_WIDTH_MAX)
    expect(clampWorkpaneWidth(400, 320)).toBe(320)

    // Wide container: stays expanded at desired width
    expect(resolveWorkpaneMode(1200, 280, 0, MIN_DOC_WIDTH)).toEqual({
      mode: 'expanded',
      width: 280,
      docWidth: 920,
    })

    // Moderately tight container: shrinks expanded width while keeping docWidth >= MIN_DOC_WIDTH
    expect(resolveWorkpaneMode(900, 380, 300, MIN_DOC_WIDTH)).toEqual({
      mode: 'expanded',
      width: 240,
      docWidth: 360,
    })

    // Exact boundary: 220 + 360 = 580 still fits expanded at WORKPANE_WIDTH_MIN
    expect(resolveWorkpaneMode(580, 280, 0, MIN_DOC_WIDTH)).toEqual({
      mode: 'expanded',
      width: WORKPANE_WIDTH_MIN,
      docWidth: MIN_DOC_WIDTH,
    })

    // Below threshold (available for workpane < 220): auto-collapses into icon rail
    expect(resolveWorkpaneMode(579, 280, 0, MIN_DOC_WIDTH)).toEqual({
      mode: 'rail',
      width: WORKPANE_RAIL_WIDTH,
      docWidth: 579 - WORKPANE_RAIL_WIDTH,
    })

    // With sibling sidebars (e.g. AI dock 360px) leaving < 220px for workpane
    expect(resolveWorkpaneMode(900, 280, 360, MIN_DOC_WIDTH)).toEqual({
      mode: 'rail',
      width: WORKPANE_RAIL_WIDTH,
      docWidth: 900 - 360 - WORKPANE_RAIL_WIDTH,
    })

    // Unmeasured container (0px in jsdom) stays expanded at clamped desired width
    expect(resolveWorkpaneMode(0, 310, 0, MIN_DOC_WIDTH)).toEqual({
      mode: 'expanded',
      width: 310,
      docWidth: MIN_DOC_WIDTH,
    })
  })

  it('parses workpane command payloads and matches Ctrl+F / Cmd+F', () => {
    expect(parseWorkpaneCommand({ action: 'open', tab: 'find', focus: true })).toEqual({
      action: 'open',
      tab: 'find',
      focus: true,
    })
    expect(parseWorkpaneCommand({ action: 'open', tab: 'unknown' })).toEqual({ action: 'open' })
    expect(parseWorkpaneCommand({ action: 'bogus' })).toBeNull()
    expect(parseWorkpaneCommand(null)).toBeNull()

    expect(
      isWorkpaneFindShortcut({
        key: 'f',
        code: 'KeyF',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        repeat: false,
      }),
    ).toBe(true)
    expect(
      isWorkpaneFindShortcut({
        key: 'Process',
        code: 'KeyF',
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        shiftKey: false,
        repeat: false,
      }),
    ).toBe(true)
    expect(
      isWorkpaneFindShortcut({
        key: 'f',
        code: 'KeyF',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: true,
        repeat: false,
      }),
    ).toBe(false)
    expect(
      isWorkpaneFindShortcut({
        key: 'h',
        code: 'KeyH',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        repeat: false,
      }),
    ).toBe(false)
  })
})

describe('workpane-menu.mjs View menu registration', () => {
  it('registers Outline and Find commands in the View menu and dispatches WORKPANE_COMMAND_EVENT', () => {
    const commands = new Map<
      string,
      { id: string; label: string; shortcutLabel?: string; execute: () => void }
    >()
    const menuItems: Array<{ menuId: string; commandId: string; position?: string }> = []
    const host = {
      automation: {
        registerCommand: (def: {
          id: string
          label: string
          shortcutLabel?: string
          execute: () => void
        }) => {
          commands.set(def.id, def)
        },
        addMenuItem: (item: { menuId: string; commandId: string; position?: string }) => {
          menuItems.push(item)
        },
      },
    }

    const result = installWorkpaneMenu(host, {
      outline: '작업창 › 개요',
      find: '작업창 › 찾기',
    })
    expect(result).toEqual({ ok: true })
    expect(menuItems).toEqual(
      WORKPANE_MENU_ITEMS.map((item) => ({
        menuId: 'view',
        commandId: item.id,
        position: 'bottom',
      })),
    )
    expect(commands.get('ext:ieum-workpane-outline')?.label).toBe('작업창 › 개요')
    expect(commands.get('ext:ieum-workpane-find')?.label).toBe('작업창 › 찾기')
    expect(commands.get('ext:ieum-workpane-find')?.shortcutLabel).toBe('Ctrl+F')

    const received: unknown[] = []
    const listener = (e: Event) => received.push((e as CustomEvent).detail)
    globalThis.addEventListener(WORKPANE_COMMAND_EVENT, listener)
    try {
      commands.get('ext:ieum-workpane-outline')!.execute()
      commands.get('ext:ieum-workpane-find')!.execute()
    } finally {
      globalThis.removeEventListener(WORKPANE_COMMAND_EVENT, listener)
    }
    expect(received).toEqual([
      { action: 'open', tab: 'outline', focus: true },
      { action: 'open', tab: 'find', focus: true },
    ])
  })

  it('rejects empty labels and returns ok: false when automation hooks are unavailable', () => {
    expect(() => installWorkpaneMenu({}, { outline: '', find: 'Find' })).toThrow(/labels\.outline/)
    expect(installWorkpaneMenu({}, { outline: 'Outline', find: 'Find' })).toEqual({ ok: false })
    expect(
      installWorkpaneMenu(
        {
          automation: {
            registerCommand: () => {
              throw new Error('already registered')
            },
            addMenuItem: () => {
              throw new Error('no view menu')
            },
          },
        },
        { outline: 'Outline', find: 'Find' },
      ),
    ).toEqual({ ok: false })
  })
})

describe('hancom-keys.mjs Ctrl+F workpane binding', () => {
  it('binds Ctrl+F to ieum:workpane-find while keeping Ctrl+Q,F for edit:find and Ctrl+H for edit:find-replace', () => {
    expect(REMOVED_SHORTCUTS).toContainEqual([{ key: 'f', ctrl: true }, 'edit:find'])
    expect(ADDED_SHORTCUTS).toContainEqual([
      { key: 'f', code: 'KeyF', ctrl: true },
      'ieum:workpane-find',
    ])
    expect(ADDED_SHORTCUTS).toContainEqual([
      { key: 'h', code: 'KeyH', ctrl: true },
      'edit:find-replace',
    ])
    expect(CHORDS.q.f).toBe('edit:find')
    expect(CHORDS.q.a).toBe('edit:find-replace')
    expect(LABELS['edit:find']).toBe('Ctrl+Q,F')
    expect(withHancomLabel({ id: 'edit:find', shortcutLabel: 'Ctrl+F' }).shortcutLabel).toBe(
      'Ctrl+Q,F',
    )

    const adapted = adaptToHancom([
      [{ key: 'f', ctrl: true }, 'edit:find'],
      [{ key: 'z', ctrl: true }, 'edit:undo'],
    ])
    expect(adapted.some(([def, id]) => def.key === 'f' && id === 'edit:find')).toBe(false)
    expect(adapted[0]).toEqual([{ key: 'f', code: 'KeyF', ctrl: true }, 'ieum:workpane-find'])
  })

  it('registers ieum:workpane-find and dispatches WORKPANE_COMMAND_EVENT on execute', () => {
    const cmd = hancomCommands('ko').find((c) => c.id === 'ieum:workpane-find')
    expect(cmd).toBeDefined()
    expect(cmd?.shortcutLabel).toBe('Ctrl+F')
    expect(cmd?.canExecute?.({ hasDocument: true })).toBe(true)
    expect(cmd?.canExecute?.({ hasDocument: false })).toBe(false)

    const received: unknown[] = []
    const listener = (e: Event) => received.push((e as CustomEvent).detail)
    globalThis.addEventListener(WORKPANE_COMMAND_EVENT, listener)
    try {
      cmd!.execute({})
    } finally {
      globalThis.removeEventListener(WORKPANE_COMMAND_EVENT, listener)
    }
    expect(received).toEqual([{ action: 'open', tab: 'find', focus: true }])
  })
})

describe('workpane i18n shard (22 languages)', () => {
  it('covers every UI language in LANGS with identical keys and non-empty translations', () => {
    expect(Object.keys(workpaneStrings).sort()).toEqual([...LANGS].sort())
    const keys = Object.keys(workpaneStrings.zh).sort()
    for (const lang of LANGS) {
      const dict = workpaneStrings[lang]
      expect(Object.keys(dict).sort(), lang).toEqual(keys)
      for (const key of keys) {
        expect(dict[key as keyof typeof dict].trim().length, `${lang}.${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('translates rather than copies English outside English', () => {
    for (const lang of LANGS) {
      if (lang === 'en') continue
      expect(workpaneStrings[lang].workpaneTitle, lang).not.toBe(workpaneStrings.en.workpaneTitle)
      expect(workpaneStrings[lang].workpaneClose, lang).not.toBe(workpaneStrings.en.workpaneClose)
      expect(workpaneStrings[lang].workpaneTabOutline, lang).not.toBe(
        workpaneStrings.en.workpaneTabOutline,
      )
      expect(workpaneStrings[lang].workpaneTabFind, lang).not.toBe(
        workpaneStrings.en.workpaneTabFind,
      )
      expect(workpaneStrings[lang].workpaneOutlineEmpty, lang).not.toBe(
        workpaneStrings.en.workpaneOutlineEmpty,
      )
    }
  })
})

describe('WorkpaneSide and WorkpaneToggle components', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.appendChild(container)
    localStorage.clear()
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

  it('renders top-bar toggle in Korean and English and reports press state', async () => {
    const onToggle = vi.fn()
    root = createRoot(container)
    await act(async () => {
      root!.render(
        createElement(LocaleProvider, {
          initial: 'ko',
          children: createElement(WorkpaneToggle, { open: true, onToggle }),
        }),
      )
    })
    const btn = container.querySelector<HTMLButtonElement>('.workpane-toggle')!
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    expect(btn.textContent).toBe('작업창')
    await act(async () => btn.click())
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('stays mounted while closed, switches tabs, supports extensible tabs, and closes cleanly', async () => {
    const onSelectTab = vi.fn()
    const onClose = vi.fn()
    const customTabs: readonly WorkpaneTabDef[] = [
      ...DEFAULT_WORKPANE_TABS,
      { id: 'bibliography', label: 'Bibliography' },
    ]
    const seenContexts: WorkpaneSlotContext[] = []
    root = createRoot(container)

    await act(async () => {
      root!.render(
        createElement(LocaleProvider, {
          initial: 'en',
          children: createElement(WorkpaneSide, {
            open: false,
            activeTab: 'outline',
            onSelectTab,
            onClose,
            tabs: customTabs,
            containerWidth: 1200,
            otherSideWidths: 0,
          }),
        }),
      )
    })
    expect(container.querySelector('.workpane-side')?.classList.contains('collapsed')).toBe(true)
    expect(container.querySelector('.workpane-side-resizer')).toBeNull()

    await act(async () => {
      root!.render(
        createElement(LocaleProvider, {
          initial: 'en',
          children: createElement(WorkpaneSide, {
            open: true,
            activeTab: 'find',
            focusFindTick: 2,
            onSelectTab,
            onClose,
            tabs: customTabs,
            containerWidth: 1200,
            otherSideWidths: 0,
            renderTab: (tab, ctx) => {
              seenContexts.push(ctx)
              return createElement('div', { 'data-slot': tab }, `slot:${tab}:${ctx.focusFindTick}`)
            },
          }),
        }),
      )
    })
    const side = container.querySelector<HTMLElement>('.workpane-side')!
    expect(side.classList.contains('collapsed')).toBe(false)
    expect(side.dataset.mode).toBe('expanded')
    expect(side.style.width).toBe(`${WORKPANE_WIDTH_DEFAULT}px`)
    expect(side.querySelector('.workpane-side-resizer')).not.toBeNull()
    expect(side.querySelectorAll('[role="tab"]')).toHaveLength(3)
    expect(side.querySelector('[data-workpane-tab="find"]')?.getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(side.querySelector('[data-slot="find"]')?.textContent).toBe('slot:find:2')
    expect(seenContexts[0]?.visible).toBe(true)

    await act(async () => {
      side.querySelector<HTMLButtonElement>('[data-workpane-tab="bibliography"]')?.click()
    })
    expect(onSelectTab).toHaveBeenCalledWith('bibliography')

    await act(async () => {
      side.querySelector<HTMLButtonElement>('.workpane-close-btn')?.click()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('auto-collapses to an icon rail when narrow and toggles flyout on icon click', async () => {
    const onSelectTab = vi.fn()
    const onClose = vi.fn()
    root = createRoot(container)

    const renderWith = async (props: {
      activeTab: string
      containerWidth: number
      focusFindTick?: number
    }) => {
      await act(async () => {
        root!.render(
          createElement(LocaleProvider, {
            initial: 'ko',
            children: createElement(WorkpaneSide, {
              open: true,
              activeTab: props.activeTab,
              onSelectTab,
              onClose,
              containerWidth: props.containerWidth,
              otherSideWidths: 0,
              focusFindTick: props.focusFindTick ?? 0,
            }),
          }),
        )
      })
    }

    await renderWith({ activeTab: 'outline', containerWidth: 500 })
    const side = container.querySelector<HTMLElement>('.workpane-side')!
    expect(side.classList.contains('rail')).toBe(true)
    expect(side.style.width).toBe(`${WORKPANE_RAIL_WIDTH}px`)
    expect(side.querySelector('.workpane-rail')).not.toBeNull()
    expect(side.querySelector('.workpane-side-resizer')).toBeNull()
    expect(side.querySelector<HTMLElement>('.workpane-panel')?.hidden).toBe(true)

    // Clicking Find icon in rail selects it and opens the flyout
    await act(async () => {
      side.querySelector<HTMLButtonElement>('[data-workpane-rail-tab="find"]')?.click()
    })
    expect(onSelectTab).toHaveBeenCalledWith('find')
    await renderWith({ activeTab: 'find', containerWidth: 500 })
    expect(side.classList.contains('flyout-open')).toBe(true)
    expect(side.querySelector<HTMLElement>('.workpane-panel')?.hidden).toBe(false)

    // Clicking active icon again closes the flyout
    await act(async () => {
      side.querySelector<HTMLButtonElement>('[data-workpane-rail-tab="find"]')?.click()
    })
    expect(side.classList.contains('flyout-open')).toBe(false)
    expect(side.querySelector<HTMLElement>('.workpane-panel')?.hidden).toBe(true)

    // Widening back above threshold exits rail mode
    await renderWith({ activeTab: 'find', containerWidth: 1100 })
    expect(side.classList.contains('rail')).toBe(false)
    expect(side.style.width).toBe(`${WORKPANE_WIDTH_DEFAULT}px`)
  })

  it('resizes via pointer drag on the right edge and saves width to localStorage', async () => {
    Object.assign(HTMLElement.prototype, { setPointerCapture: () => {} })
    root = createRoot(container)
    await act(async () => {
      root!.render(
        createElement(LocaleProvider, {
          initial: 'en',
          children: createElement(WorkpaneSide, {
            open: true,
            activeTab: 'outline',
            onSelectTab: () => {},
            onClose: () => {},
            containerWidth: 1400,
            otherSideWidths: 0,
          }),
        }),
      )
    })
    const resizer = container.querySelector<HTMLElement>('.workpane-side-resizer')!
    await act(async () => {
      resizer.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 280 }))
    })
    await act(async () => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 350 }))
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: 350 }))
    })
    expect(container.querySelector<HTMLElement>('.workpane-side')?.style.width).toBe(
      `${WORKPANE_WIDTH_DEFAULT + 70}px`,
    )
    expect(localStorage.getItem(WORKPANE_WIDTH_KEY)).toBe(String(WORKPANE_WIDTH_DEFAULT + 70))
  })
})

describe('App workpane integration (AI-off, Ctrl+F, editor frame events, presentation CSS)', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  function fakeApi(): HwpApi {
    const given: Record<string, unknown> = {
      consumePending: async () => 'C:/docs/a.hwp',
      untitledCopy: async () => null,
      readFile: async () => new Uint8Array([1, 2, 3]),
      trackingDropped: async () => false,
      getTheme: async () => 'system',
      getLanguage: async () => 'ko',
      getAutoSaveDefault: async () => ({ on: false, updatedAt: 0 }),
      getMemoModalOpen: async () => false,
      getAuthorName: async () => ({ value: '', fallback: '' }),
      getAiSettings: async () => ({ ...defaultAiSettings(), subscriptionNoticeSeen: true }),
      getAiPanelPrefs: async () => ({}),
      setAiPanelPrefs: async () => ({}),
    }
    return new Proxy(given, {
      get(target, name) {
        if (typeof name !== 'string' || name === 'then') return undefined
        if (name in target) return target[name]
        if (/^on[A-Z]/.test(name)) return () => () => undefined
        return async () => undefined
      },
    }) as unknown as HwpApi
  }

  function aiOffChoice(): AppChoiceSource {
    const state: AppChoiceState = { off: [], aiFeatures: false, locked: false }
    return {
      get: async () => state,
      onChange: () => () => undefined,
    }
  }

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    Element.prototype.scrollTo = () => undefined
    localStorage.clear()
    mockEditorFrame = null
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root) act(() => root!.unmount())
    root = null
    container.remove()
    delete (window as { hwpApi?: unknown }).hwpApi
    vi.unstubAllGlobals()
  })

  async function settle(turns = 16): Promise<void> {
    for (let turn = 0; turn < turns; turn++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
  }

  it('works with AI off, toggles via top-bar button, and opens Find tab on Ctrl+F and editor events', async () => {
    Object.assign(window, { hwpApi: fakeApi() })
    vi.stubGlobal('aiOfficeEditorChoice', aiOffChoice())
    root = createRoot(container)
    await act(async () => {
      root!.render(createElement(LocaleProvider, { initial: 'ko', children: createElement(App) }))
    })
    await settle()

    expect(container.querySelector('.hwp-app')?.getAttribute('data-phase')).toBe('ready')
    expect(container.querySelector('.ai-dock')).toBeNull()

    const side = container.querySelector<HTMLElement>('.workpane-side')!
    const toggle = container.querySelector<HTMLButtonElement>('.workpane-toggle')!
    expect(side.classList.contains('collapsed')).toBe(true)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')

    // Top-bar toggle opens the workpane
    await act(async () => toggle.click())
    expect(side.classList.contains('collapsed')).toBe(false)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem(WORKPANE_OPEN_KEY)).toBe('1')

    // Close button collapses it
    await act(async () => {
      side.querySelector<HTMLButtonElement>('.workpane-close-btn')?.click()
    })
    expect(side.classList.contains('collapsed')).toBe(true)

    // Ctrl+F on host window opens the workpane directly to the Find tab
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, cancelable: true }),
      )
    })
    expect(side.classList.contains('collapsed')).toBe(false)
    expect(side.dataset.tab).toBe('find')
    expect(localStorage.getItem(WORKPANE_TAB_KEY)).toBe('find')

    // Editor-frame WORKPANE_COMMAND_EVENT switches to Outline tab
    await act(async () => {
      mockEditorFrame?.contentWindow?.dispatchEvent(
        new CustomEvent(WORKPANE_COMMAND_EVENT, {
          detail: { action: 'open', tab: 'outline', focus: true },
        }),
      )
    })
    expect(side.dataset.tab).toBe('outline')
  })

  it('hides the workpane in presentation mode CSS', () => {
    const css = readFileSync(resolve(__dirname, '../src/renderer/styles.css'), 'utf8')
    expect(css).toContain('.hwp-app.hwp-presenting .workpane-side')
  })
})
