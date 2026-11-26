import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  MobileAiSettingsSnapshot,
  MobileAppPrefs,
  MobileAppPrefsPatch,
  MobileChatGptStatus,
  MobileClient,
} from '@genoffice/mobile-bridge/transport'
import type { EditorKind } from '../src/renderer/editors/editorKind'
import type { HomeHost } from '../src/renderer/home/homeHost'
import {
  resetHomeRuntimeForTest,
  setActiveDocKey,
  setHomeRuntime,
} from '../src/renderer/home/homeRuntime'
import {
  getHomePrefs,
  resetHomePrefsForTest,
  updateHomePrefs,
} from '../src/renderer/home/prefsStore'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { homeStrings } from '../src/renderer/i18n/home'
import { SettingsScreen, type SettingsScreenProps } from '../src/renderer/settings/SettingsScreen'
import {
  homeCardItemsOf,
  moveCardItem,
  setCardHidden,
  visibleCardOrder,
} from '../src/renderer/settings/sections/homeSettingsModel'

// Pin the editor registry to the base kinds (HWP, Markdown) like tests/open-gate.test.tsx, so kinds
// other tracks register do not change the card rows and the "all editors off" rule tested here.
vi.mock('../src/renderer/editors/registry', async () => {
  const { hwpEditorKind } = await import('../src/renderer/editors/hwpKind')
  const { markdownEditorKind } = await import('../src/renderer/editors/markdownKind')
  const kinds = [hwpEditorKind, markdownEditorKind]
  return {
    EDITOR_KINDS: kinds,
    findEditorKind: (format: string) =>
      kinds.find((kind) => (kind.formats as readonly string[]).includes(format)) ?? null,
    openableExtensions: () => kinds.flatMap((kind) => kind.openExtensions),
  }
})

const ko = homeStrings.ko

const prefs: MobileAppPrefs = {
  lang: 'ko',
  theme: 'system',
  hwpDefaultFormat: 'hwpx',
  aiEnabled: false,
}

const aiSettings: MobileAiSettingsSnapshot = {
  selectedProvider: 'openrouter',
  modelByProvider: {},
  configuredProviders: {},
  chatgptVisible: false,
  subscriptionNoticeVersion: 0,
}

const chatgptStatus: MobileChatGptStatus = { state: 'signed-out' } as MobileChatGptStatus

function props(overrides: Partial<SettingsScreenProps> = {}): SettingsScreenProps {
  return {
    prefs,
    aiSettings,
    chatgptStatus,
    backups: [],
    onBack: () => {},
    onUpdatePrefs: () => {},
    onSelectProvider: () => {},
    onValidateAndSaveKey: async () => {},
    onRemoveKey: async () => {},
    onChatgptSignIn: async () => {},
    onChatgptSignOut: async () => {},
    onRestoreBackup: async () => {},
    onDeleteBackup: async () => {},
    ...overrides,
  }
}

type Answer = (args: Record<string, unknown> | undefined) => unknown

interface FakeHost {
  readonly host: HomeHost
  readonly invoke: ReturnType<typeof vi.fn>
  readonly setAppPrefs: ReturnType<typeof vi.fn>
  readonly refreshHome: ReturnType<typeof vi.fn>
  readonly showToast: ReturnType<typeof vi.fn>
  calls(command: string): Array<Record<string, unknown> | undefined>
}

/** A runtime host whose backend answers the home commands from `answers` ({ok:true} otherwise). */
function fakeHost(answers: Record<string, Answer> = {}): FakeHost {
  let stored: Record<string, unknown> = { ...prefs }
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    const answer = answers[command]
    return answer ? answer(args) : { ok: true }
  })
  const setAppPrefs = vi.fn(async (patch: MobileAppPrefsPatch) => {
    stored = { ...stored, ...patch }
    return { ...stored }
  })
  const getAppPrefs = vi.fn(async () => ({ ...stored }))
  const client = { transport: { invoke }, getAppPrefs, setAppPrefs } as unknown as MobileClient
  const refreshHome = vi.fn(async () => {})
  const showToast = vi.fn()
  const host: HomeHost = {
    client,
    openSession: async () => {},
    createNew: async () => {},
    showToast,
    refreshHome,
    openSettings: () => {},
  }
  return {
    host,
    invoke,
    setAppPrefs,
    refreshHome,
    showToast,
    calls: (command) =>
      invoke.mock.calls
        .filter((call) => call[0] === command)
        .map((call) => call[1] as Record<string, unknown> | undefined),
  }
}

const mounted: Array<{ root: Root; container: HTMLElement }> = []

function render(overrides: Partial<SettingsScreenProps> = {}): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  act(() => {
    root.render(
      <MobileLocaleProvider lang="ko">
        <SettingsScreen {...props(overrides)} />
      </MobileLocaleProvider>,
    )
  })
  return container
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
  })
}

function click(el: Element | null | undefined): void {
  if (!el) throw new Error('element not found')
  act(() => {
    ;(el as HTMLElement).click()
  })
}

function byTestId<T extends Element = HTMLElement>(root: ParentNode, id: string): T | null {
  return root.querySelector<T>(`[data-testid="${id}"]`)
}

function buttonByName(root: ParentNode, name: string): HTMLButtonElement | null {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
  return (
    buttons.find((b) => b.getAttribute('aria-label') === name || b.textContent?.trim() === name) ??
    null
  )
}

function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key]))
}

beforeEach(() => {
  resetHomePrefsForTest()
  resetHomeRuntimeForTest()
})

afterEach(() => {
  while (mounted.length > 0) {
    const entry = mounted.pop()
    if (!entry) break
    act(() => entry.root.unmount())
    entry.container.remove()
  }
  resetHomeRuntimeForTest()
  resetHomePrefsForTest()
})

describe('settings: editors', () => {
  it('saves editorsOff at once when an editor switch moves', async () => {
    const fake = fakeHost()
    setHomeRuntime(fake.host)
    const el = render()
    await flush()

    const hwp = byTestId<HTMLInputElement>(el, 'home-set-editor-hwp')
    expect(hwp?.checked).toBe(true)
    click(hwp)
    await flush()

    expect(fake.setAppPrefs).toHaveBeenLastCalledWith({ editorsOff: ['hwp'] })
    expect(getHomePrefs().editorsOff).toEqual(['hwp'])
    expect(byTestId<HTMLInputElement>(el, 'home-set-editor-hwp')?.checked).toBe(false)

    click(byTestId(el, 'home-set-editor-pdfTools'))
    await flush()
    expect(fake.setAppPrefs).toHaveBeenLastCalledWith({ editorsOff: ['hwp', 'pdfTools'] })
  })

  it('shows every editor on when all editor kinds are off, and the next switch starts from there', async () => {
    await updateHomePrefs({ editorsOff: ['hwp', 'markdown', 'pdfTools'] })
    const el = render()
    await flush()

    expect(byTestId<HTMLInputElement>(el, 'home-set-editor-hwp')?.checked).toBe(true)
    expect(byTestId<HTMLInputElement>(el, 'home-set-editor-markdown')?.checked).toBe(true)
    // the PDF tools are not an editor kind, so they keep their own value
    expect(byTestId<HTMLInputElement>(el, 'home-set-editor-pdfTools')?.checked).toBe(false)

    click(byTestId(el, 'home-set-editor-markdown'))
    await flush()
    expect(getHomePrefs().editorsOff).toEqual(['pdfTools', 'markdown'])
    expect(byTestId<HTMLInputElement>(el, 'home-set-editor-hwp')?.checked).toBe(true)
    expect(byTestId<HTMLInputElement>(el, 'home-set-editor-markdown')?.checked).toBe(false)
  })
})

describe('settings: new documents on the home screen', () => {
  it('moves and hides cards and writes the order and the hidden list', async () => {
    const fake = fakeHost()
    setHomeRuntime(fake.host)
    const el = render()
    await flush()

    const rows = () =>
      Array.from(el.querySelectorAll('[data-testid^="home-set-card-row-"]')).map((row) =>
        row.getAttribute('data-testid'),
      )
    expect(rows()).toEqual(['home-set-card-row-hwp', 'home-set-card-row-md'])

    const hwpName = ko.homeSetEditorHwp
    const up = buttonByName(el, fill(ko.homeSetCardUp, { name: hwpName }))
    expect(up?.disabled).toBe(true)

    click(buttonByName(el, fill(ko.homeSetCardDown, { name: hwpName })))
    await flush()
    expect(fake.setAppPrefs).toHaveBeenLastCalledWith({ homeKindsOrder: ['md', 'hwp'] })
    expect(rows()).toEqual(['home-set-card-row-md', 'home-set-card-row-hwp'])

    const show = byTestId<HTMLInputElement>(el, 'home-set-card-show-md')
    expect(show?.checked).toBe(true)
    click(show)
    await flush()
    expect(fake.setAppPrefs).toHaveBeenLastCalledWith({ homeKindsHidden: ['md'] })
    expect(byTestId<HTMLInputElement>(el, 'home-set-card-show-md')?.checked).toBe(false)
  })

  it("keeps a turned-off editor's card values and leaves its card out of the list", async () => {
    await updateHomePrefs({
      editorsOff: ['markdown'],
      homeKindsOrder: ['md', 'hwp'],
      homeKindsHidden: ['md'],
    })
    const el = render()
    await flush()

    expect(byTestId(el, 'home-set-card-row-md')).toBeNull()
    click(byTestId(el, 'home-set-card-show-hwp'))
    await flush()
    expect(getHomePrefs().homeKindsHidden).toEqual(['md', 'hwp'])
    expect(getHomePrefs().homeKindsOrder).toEqual(['md', 'hwp'])
  })

  it('swaps only shown cards and leaves the places of turned-off kinds alone', () => {
    const kinds = [
      { id: 'hwp', createFormats: ['hwp', 'hwpx'] },
      { id: 'sheets', createFormats: ['xlsx', 'csv'] },
      { id: 'markdown', createFormats: ['md'] },
      { id: 'pdf' },
    ] as unknown as EditorKind[]
    const items = homeCardItemsOf(kinds)
    expect(items.map((item) => item.id)).toEqual(['hwp', 'xlsx', 'csv', 'md'])

    const all = items.map((item) => item.id)
    const shown = ['hwp', 'md']
    expect(visibleCardOrder(all, ['future', 'md'], shown)).toEqual(['md', 'hwp'])
    // 'xlsx' and 'csv' belong to a turned-off kind; 'future' is an id this build does not know
    expect(moveCardItem(all, ['future', 'csv'], shown, 'md', -1)).toEqual([
      'future',
      'csv',
      'md',
      'xlsx',
      'hwp',
    ])
    expect(moveCardItem(all, [], shown, 'hwp', -1)).toBeNull()
    expect(setCardHidden(['csv'], 'md', true)).toEqual(['csv', 'md'])
    expect(setCardHidden(['csv', 'md'], 'md', false)).toEqual(['csv'])
  })
})

describe('settings: keep the screen on', () => {
  it('is on by default and saves the switch', async () => {
    const el = render()
    await flush()
    const toggle = byTestId<HTMLInputElement>(el, 'home-set-keep-screen-on')
    expect(toggle?.checked).toBe(true)
    expect(el.textContent).toContain(ko.homeSetKeepScreenOnDesc)
    click(toggle)
    await flush()
    expect(getHomePrefs().keepScreenOnWhileReading).toBe(false)
    expect(byTestId<HTMLInputElement>(el, 'home-set-keep-screen-on')?.checked).toBe(false)
  })
})

describe('settings: storage', () => {
  it('asks once, then clears the recovery copies but keeps the open document', async () => {
    const fake = fakeHost({
      mobile_home_storage_usage: () => ({
        recoveryBytes: 4096,
        tempBytes: 2048,
        backupBytes: 0,
      }),
      mobile_home_clear_storage: () => ({ freedBytes: 4096 }),
    })
    setHomeRuntime(fake.host)
    // the app layer reports the open document
    setActiveDocKey('doc-open')
    const el = render()
    await flush()

    expect(byTestId(el, 'home-set-storage')).not.toBeNull()
    click(buttonByName(el, ko.homeSetStorageClearRecovery))
    expect(fake.calls('mobile_home_clear_storage')).toEqual([])
    const dialog = byTestId(el, 'home-set-confirm')
    expect(dialog?.textContent).toContain(ko.homeSetStorageClearRecoveryBody)

    click(buttonByName(dialog as HTMLElement, ko.homeSetStorageClearAction))
    await flush()
    expect(fake.calls('mobile_home_clear_storage')).toEqual([
      { kind: 'recovery', keepDocKey: 'doc-open' },
    ])
    expect(fake.refreshHome).toHaveBeenCalled()
    expect(byTestId(el, 'home-set-confirm')).toBeNull()
  })

  it('clears temp files after one confirm and does nothing on cancel', async () => {
    const fake = fakeHost({
      mobile_home_storage_usage: () => ({ recoveryBytes: 0, tempBytes: 10, backupBytes: 0 }),
      mobile_home_clear_storage: () => ({ freedBytes: 10 }),
    })
    setHomeRuntime(fake.host)
    const el = render()
    await flush()

    click(buttonByName(el, ko.homeSetStorageClearTemp))
    click(buttonByName(byTestId(el, 'home-set-confirm') as HTMLElement, '취소'))
    await flush()
    expect(fake.calls('mobile_home_clear_storage')).toEqual([])

    click(buttonByName(el, ko.homeSetStorageClearTemp))
    click(
      buttonByName(byTestId(el, 'home-set-confirm') as HTMLElement, ko.homeSetStorageClearAction),
    )
    await flush()
    expect(fake.calls('mobile_home_clear_storage')).toEqual([{ kind: 'temp' }])
  })
})

describe('settings: document folders', () => {
  it('shows the row count before unlinking a folder', async () => {
    let folders = [
      { id: 'f1', name: 'Work', status: 'ok', addedAt: 1 },
      { id: 'f2', name: 'Old', status: 'lost', addedAt: 2 },
    ]
    const fake = fakeHost({
      mobile_home_list_folders: () => folders,
      mobile_home_count_folder_entries: () => ({ count: 3 }),
      mobile_home_unlink_folder: (args) => {
        folders = folders.filter((folder) => folder.id !== args?.id)
        return { removedEntries: 3 }
      },
    })
    setHomeRuntime(fake.host)
    const el = render()
    await flush()

    const section = byTestId(el, 'home-set-folders') as HTMLElement
    expect(section.textContent).toContain('Work')
    expect(section.textContent).toContain(ko.homeSetFolderLost)

    click(buttonByName(section, fill(ko.homeSetFolderRemoveNamed, { name: 'Work' })))
    await flush()
    expect(fake.calls('mobile_home_count_folder_entries')).toEqual([{ id: 'f1' }])
    const dialog = byTestId(el, 'home-set-confirm') as HTMLElement
    expect(dialog.textContent).toContain(fill(ko.homeSetFolderRemoveBody, { count: 3 }))
    expect(fake.calls('mobile_home_unlink_folder')).toEqual([])

    click(buttonByName(dialog, ko.homeSetFolderRemove))
    await flush()
    expect(fake.calls('mobile_home_unlink_folder')).toEqual([{ id: 'f1' }])
    expect(section.textContent).not.toContain('Work')
    expect(fake.refreshHome).toHaveBeenCalled()
  })
})

describe('settings: layout', () => {
  it('keeps the AI switch as the last row of the first card, with a runtime too', async () => {
    const fake = fakeHost({
      mobile_home_app_info: () => ({ version: '1.4.2', platform: 'android', osVersion: '16' }),
    })
    setHomeRuntime(fake.host)
    const el = render()
    await flush()

    const card = el.querySelector('.mobile-set-card')
    const rows = card?.querySelectorAll(':scope > .mobile-set-row')
    const last = rows?.[rows.length - 1]
    expect(last?.querySelector('[data-testid="settings-ai-enabled-toggle"]')).not.toBeNull()
    expect(card?.contains(byTestId(el, 'home-set-editor-hwp'))).toBe(true)
    expect(card?.contains(byTestId(el, 'home-set-keep-screen-on'))).toBe(true)
    expect(el.querySelector('.mobile-about-ver')?.textContent).toBe('v1.4.2')
  })

  it('hides the rows that need a client when there is no runtime', async () => {
    const el = render()
    await flush()
    expect(byTestId(el, 'home-set-folders')).toBeNull()
    expect(byTestId(el, 'home-set-storage')).toBeNull()
    expect(byTestId(el, 'home-set-editor-hwp')).not.toBeNull()
    expect(el.querySelector('.mobile-about-ver')?.textContent).toBe('v0.1.0')
  })
})
