import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FavoriteEntry, FavoriteGroup } from '@genoffice/mobile-bridge/home'
import type {
  MobileAppPrefs,
  MobileClient,
  MobileDocFormat,
  MobileDocSession,
  RecentDocEntry,
} from '@genoffice/mobile-bridge/transport'
import { HomeScreen, type HomeScreenProps } from '../src/renderer/components/HomeScreen'
import { EDITOR_KINDS } from '../src/renderer/editors/registry'
import {
  homeCardList,
  homeChips,
  resetHomeFrameForTest,
} from '../src/renderer/home/frame/frameModel'
import type { HomeHost } from '../src/renderer/home/homeHost'
import { resetHomeRuntimeForTest, sessionOrigin } from '../src/renderer/home/homeRuntime'
import { HOME_TABS, HOME_TABS_ENABLED, visibleHomeTabs } from '../src/renderer/home/homeTabs'
import {
  providePdfToolsLink,
  type PdfToolFlowProps,
  type PdfToolsLink,
} from '../src/renderer/home/pdfToolsLink'
import { resetHomePrefsForTest } from '../src/renderer/home/prefsStore'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { BackStackProvider } from '../src/renderer/shell/backStack'

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

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Handler = (args: Record<string, unknown> | undefined) => unknown

interface Fake {
  readonly host: HomeHost
  readonly invoke: ReturnType<typeof vi.fn>
  readonly openSession: ReturnType<typeof vi.fn>
  readonly openSettings: ReturnType<typeof vi.fn>
  calls(command: string): (Record<string, unknown> | undefined)[]
}

/** A backend that answers the commands it knows and `{ ok: true }` to the rest, like the preview. */
function fakeHost(
  handlers: Record<string, Handler> = {},
  prefs: Partial<MobileAppPrefs> = {},
): Fake {
  let stored: MobileAppPrefs = {
    lang: 'ko',
    theme: 'system',
    hwpDefaultFormat: 'hwpx',
    aiEnabled: false,
    ...prefs,
  }
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    const handler = handlers[command]
    return handler ? handler(args) : { ok: true }
  })
  const client = {
    transport: { invoke, listen: vi.fn() },
    getAppPrefs: vi.fn(async () => stored),
    setAppPrefs: vi.fn(async (patch: Partial<MobileAppPrefs>) => {
      stored = { ...stored, ...patch }
      return stored
    }),
    removeRecentDoc: vi.fn(async () => ({ ok: true })),
  } as unknown as MobileClient
  const openSession = vi.fn(async () => {})
  const openSettings = vi.fn()
  const host = {
    client,
    openSession,
    createNew: vi.fn(async () => {}),
    showToast: vi.fn(),
    refreshHome: vi.fn(async () => {}),
    openSettings,
  } as unknown as HomeHost
  return {
    host,
    invoke,
    openSession,
    openSettings,
    calls: (command) =>
      invoke.mock.calls
        .filter((call) => call[0] === command)
        .map((call) => call[1] as Record<string, unknown> | undefined),
  }
}

const roots: Root[] = []
const containers: HTMLElement[] = []

function render(node: ReactNode): Root {
  const container = document.createElement('div')
  document.body.appendChild(container)
  containers.push(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(
      <MobileLocaleProvider lang="ko">
        <BackStackProvider>{node}</BackStackProvider>
      </MobileLocaleProvider>,
    )
  })
  return root
}

function unmountAll(): void {
  act(() => {
    while (roots.length > 0) roots.pop()?.unmount()
  })
  while (containers.length > 0) containers.pop()?.remove()
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
  })
}

function byTestId(id: string): HTMLElement | null {
  return document.body.querySelector(`[data-testid="${id}"]`)
}

function testIds(prefix: string): string[] {
  return [...document.body.querySelectorAll(`[data-testid^="${prefix}"]`)].map(
    (el) => el.getAttribute('data-testid') ?? '',
  )
}

function click(el: Element | null): void {
  if (!el) throw new Error('element missing')
  act(() => {
    ;(el as HTMLElement).click()
  })
}

function setWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
  window.dispatchEvent(new Event('resize'))
}

function doc(id: string, name: string, format: MobileDocFormat): RecentDocEntry {
  return { id, docKey: `doc-${id}`, name, format, openedAt: 1700000000000 }
}

function homeProps(overrides: Partial<HomeScreenProps> = {}): HomeScreenProps {
  return {
    recentDocs: [],
    recoveryEntries: [],
    permissionDeniedRecentId: null,
    defaultHwpFormat: 'hwpx',
    onCreateNew: vi.fn(),
    onOpenFile: vi.fn(),
    onOpenRecent: vi.fn(),
    onRemoveRecent: vi.fn(),
    onRestoreRecovery: vi.fn(),
    onDiscardRecovery: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  }
}

async function renderHome(overrides: Partial<HomeScreenProps> = {}): Promise<HomeScreenProps> {
  const props = homeProps(overrides)
  render(<HomeScreen {...props} />)
  await flush()
  return props
}

const noLink = null as unknown as PdfToolsLink

function FakeFlow({ start, onClose }: PdfToolFlowProps) {
  return (
    <div
      data-testid="fake-flow"
      data-kind={start.kind}
      data-count={start.kind === 'menu' ? 0 : start.inputs.length}
    >
      <button type="button" data-testid="fake-flow-close" onClick={onClose}>
        x
      </button>
    </div>
  )
}

const someLink: PdfToolsLink = { Flow: FakeFlow }

beforeEach(() => {
  // A browser answers history.back() with a popstate; jsdom does it later, so answer at once here.
  vi.spyOn(window.history, 'back').mockImplementation(() => {
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  resetHomePrefsForTest()
  resetHomeRuntimeForTest()
  resetHomeFrameForTest()
  providePdfToolsLink(noLink)
  setWidth(390)
})

afterEach(() => {
  unmountAll()
  vi.restoreAllMocks()
})

describe('home tabs', () => {
  it('turns the four tabs on and hides [Tools] while the PDF tools are off', async () => {
    expect(HOME_TABS_ENABLED).toBe(true)
    expect(HOME_TABS.map((tab) => tab.id)).toEqual(['recent', 'folders', 'tools', 'settings'])
    expect(visibleHomeTabs(() => true).map((tab) => tab.id)).toEqual([
      'recent',
      'folders',
      'tools',
      'settings',
    ])
    expect(visibleHomeTabs((id) => id !== 'pdfTools').map((tab) => tab.id)).toEqual([
      'recent',
      'folders',
      'settings',
    ])

    const on = fakeHost()
    await renderHome({ host: on.host })
    expect(byTestId('home-tab-bar')).not.toBeNull()
    expect(byTestId('home-tab-rail')).toBeNull()
    expect(testIds('home-tab-')).toEqual([
      'home-tab-bar',
      'home-tab-recent',
      'home-tab-folders',
      'home-tab-tools',
      'home-tab-settings',
    ])
    expect(byTestId('home-tab-recent')?.getAttribute('aria-current')).toBe('page')
    expect(byTestId('home-tab-bar')?.tagName).toBe('NAV')
    unmountAll()

    resetHomePrefsForTest()
    const off = fakeHost({}, { editorsOff: ['pdfTools'] })
    await renderHome({ host: off.host })
    expect(byTestId('home-tab-tools')).toBeNull()
    expect(byTestId('home-tab-folders')).not.toBeNull()
  })

  it('shows the same tabs as a rail from the medium window class up', async () => {
    setWidth(700)
    const fake = fakeHost()
    await renderHome({ host: fake.host })
    expect(byTestId('home-tab-rail')).not.toBeNull()
    expect(byTestId('home-tab-bar')).toBeNull()
    expect(byTestId('mobile-home-screen')?.getAttribute('data-layout')).toBe('rail')
    expect(testIds('home-tab-').filter((id) => id !== 'home-tab-rail')).toHaveLength(4)
  })

  it('sends [Settings] to the settings screen and comes back to the last tab', async () => {
    const fake = fakeHost()
    const props = await renderHome({ host: fake.host })
    click(byTestId('home-tab-folders'))
    expect(byTestId('home-tab-folders')?.getAttribute('aria-current')).toBe('page')
    expect(byTestId('home-panel-folders')).not.toBeNull()
    expect(byTestId('home-fab')).not.toBeNull()

    click(byTestId('home-tab-tools'))
    expect(byTestId('home-panel-tools')).not.toBeNull()
    expect(byTestId('home-fab')).toBeNull()
    click(byTestId('home-tab-folders'))

    click(byTestId('home-tab-settings'))
    expect(fake.openSettings).toHaveBeenCalledTimes(1)
    expect(props.onOpenSettings).not.toHaveBeenCalled()

    // App unmounts the home for the settings screen and draws it again on the way back.
    unmountAll()
    await renderHome({ host: fake.host })
    expect(byTestId('home-tab-folders')?.getAttribute('aria-current')).toBe('page')

    // A new app run starts at [Recent].
    unmountAll()
    resetHomeFrameForTest()
    await renderHome({ host: fake.host })
    expect(byTestId('home-tab-recent')?.getAttribute('aria-current')).toBe('page')
  })
})

describe('new-document cards', () => {
  it('shows the HWP, Markdown and open-file cards on the first render without opening anything', async () => {
    const fake = fakeHost()
    const props = await renderHome({ host: fake.host })
    expect(byTestId('home-new-hwp-btn')).not.toBeNull()
    expect(byTestId('home-new-md-btn')).not.toBeNull()
    expect(byTestId('home-open-file-btn')).not.toBeNull()
    expect(byTestId('home-create-sheet')).toBeNull()
    expect(byTestId('home-tool-flow')).toBeNull()
    expect(fake.openSession).not.toHaveBeenCalled()
    // the open card lists what the registry opens instead of a fixed list
    expect(byTestId('home-open-file-btn')?.textContent).toContain('.markdown')

    click(byTestId('home-new-hwp-btn'))
    expect(props.onCreateNew).toHaveBeenCalledWith('hwpx')
  })

  it('draws without a host, and with answers that are not lists', async () => {
    const bare = await renderHome({
      recentDocs: [doc('rec-1', 'moved.hwp', 'hwp')],
      permissionDeniedRecentId: 'rec-1',
    })
    expect(byTestId('home-new-hwp-btn')).not.toBeNull()
    expect(byTestId('home-new-md-btn')).not.toBeNull()
    expect(byTestId('home-tab-bar')).toBeNull()
    expect(byTestId('recent-expired-rec-1')).not.toBeNull()
    click(byTestId('home-settings-btn'))
    expect(bare.onOpenSettings).toHaveBeenCalled()
    unmountAll()

    // every bridge answer is { ok: true }
    const odd = fakeHost()
    await renderHome({ host: odd.host, recentDocs: [doc('a', 'a.md', 'md')] })
    expect(byTestId('home-recent-list')).not.toBeNull()
    expect(byTestId('home-file-row-recent:a')).not.toBeNull()
  })

  it('follows the stored order, leaves out hidden cards and cards of editors that are off', () => {
    const on = (_id: string) => true
    const ids = (prefs: { homeKindsOrder: string[]; homeKindsHidden: string[] }, isOn = on) =>
      homeCardList(EDITOR_KINDS, prefs, isOn).map((item) => item.id)
    expect(ids({ homeKindsOrder: [], homeKindsHidden: [] }).slice(0, 2)).toEqual(['hwp', 'md'])
    expect(ids({ homeKindsOrder: ['md', 'hwp'], homeKindsHidden: [] }).slice(0, 2)).toEqual([
      'md',
      'hwp',
    ])
    expect(ids({ homeKindsOrder: [], homeKindsHidden: ['md'] })).not.toContain('md')
    expect(
      ids({ homeKindsOrder: [], homeKindsHidden: [] }, (id) => id !== 'markdown'),
    ).not.toContain('md')
  })

  it('applies hidden cards and the order on the home and in the create sheet', async () => {
    const fake = fakeHost({}, { homeKindsHidden: ['md'] })
    await renderHome({ host: fake.host })
    expect(byTestId('home-new-md-btn')).toBeNull()
    expect(byTestId('home-new-hwp-btn')).not.toBeNull()
    click(byTestId('home-fab'))
    expect(byTestId('home-create-sheet')).not.toBeNull()
    expect(byTestId('home-create-hwp')).not.toBeNull()
    expect(byTestId('home-create-md')).toBeNull()
    expect(byTestId('home-create-open-file')).not.toBeNull()
    unmountAll()

    resetHomePrefsForTest()
    const ordered = fakeHost({}, { homeKindsOrder: ['md', 'hwp'] })
    await renderHome({ host: ordered.host })
    const cards = testIds('home-new-')
    expect(cards.indexOf('home-new-md-btn')).toBeLessThan(cards.indexOf('home-new-hwp-btn'))
    unmountAll()

    resetHomePrefsForTest()
    const off = fakeHost({}, { editorsOff: ['markdown'] })
    await renderHome({ host: off.host })
    expect(byTestId('home-new-md-btn')).toBeNull()
  })
})

describe('filter chips and lists', () => {
  const favorites: FavoriteEntry[] = [
    { docKey: 'doc-a', name: 'a.md', format: 'md', groupId: 'g1', addedAt: 1 },
    { docKey: 'far', name: 'far.md', format: 'md', groupId: null, addedAt: 2 },
  ]
  const groups: FavoriteGroup[] = [{ id: 'g1', name: '수업' }]

  it('adds format chips only when the recent list has two families or more', () => {
    const one = homeChips(
      [doc('a', 'a.md', 'md'), doc('b', 'b.txt', 'txt')],
      [],
      EDITOR_KINDS,
      true,
    )
    expect(one.map((chip) => chip.id)).toEqual(['all', 'favorites'])
    const two = homeChips(
      [doc('a', 'a.md', 'md'), doc('b', 'b.hwpx', 'hwpx'), doc('c', 'c.hwp', 'hwp')],
      groups,
      EDITOR_KINDS,
      true,
    )
    expect(two.map((chip) => chip.id)).toEqual([
      'all',
      'favorites',
      'group:g1',
      'family:hwp',
      'family:md',
    ])
    expect(homeChips([], groups, EDITOR_KINDS, false).map((chip) => chip.id)).toEqual(['all'])
  })

  it('filters by format, lists favorites per group, and marks starred recent rows', async () => {
    const fake = fakeHost({
      mobile_home_list_favorites: () => favorites,
      mobile_home_list_groups: () => groups,
      mobile_home_recent_meta: () => [{ id: 'a', folderId: 'f1', folderName: '학교 폴더' }],
    })
    const props = await renderHome({
      host: fake.host,
      recentDocs: [doc('a', 'a.md', 'md'), doc('b', 'b.hwpx', 'hwpx')],
    })
    expect(testIds('home-chip-')).toEqual([
      'home-chip-all',
      'home-chip-favorites',
      'home-chip-group-g1',
      'home-chip-family-hwp',
      'home-chip-family-md',
    ])
    expect(byTestId('home-chip-all')?.getAttribute('aria-pressed')).toBe('true')
    const rowA = byTestId('home-file-row-recent:a')
    expect(rowA?.querySelector('.home-act-star')).not.toBeNull()
    expect(rowA?.textContent).toContain('학교 폴더')
    expect(byTestId('home-file-row-recent:b')?.querySelector('.home-act-star')).toBeNull()

    click(byTestId('home-chip-family-hwp'))
    expect(byTestId('home-chip-family-hwp')?.getAttribute('aria-pressed')).toBe('true')
    expect(byTestId('home-file-row-recent:a')).toBeNull()
    expect(byTestId('home-file-row-recent:b')).not.toBeNull()

    click(byTestId('home-chip-favorites'))
    expect(byTestId('home-favorites-list')).not.toBeNull()
    expect(byTestId('home-file-row-favorite:doc-a')).not.toBeNull()
    expect(byTestId('home-file-row-favorite:far')).not.toBeNull()

    click(byTestId('home-chip-group-g1'))
    expect(byTestId('home-file-row-favorite:doc-a')).not.toBeNull()
    expect(byTestId('home-file-row-favorite:far')).toBeNull()

    // a favorite that is also in the recent list opens the way recent rows do
    click(byTestId('home-file-row-open-favorite:doc-a'))
    expect(props.onOpenRecent).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
  })

  it('opens a favorite outside the recent list through the bridge', async () => {
    const session = { sessionId: 'fav-1', format: 'md' } as unknown as MobileDocSession
    const fake = fakeHost({
      mobile_home_list_favorites: () => favorites,
      mobile_home_open_favorite: () => session,
    })
    await renderHome({ host: fake.host, recentDocs: [doc('a', 'a.md', 'md')] })
    click(byTestId('home-chip-favorites'))
    click(byTestId('home-file-row-open-favorite:far'))
    await flush()
    expect(fake.calls('mobile_home_open_favorite')).toEqual([{ docKey: 'far' }])
    expect(fake.openSession).toHaveBeenCalledWith(session)
  })
})

describe('empty state', () => {
  it('offers the sample document, open file and create new', async () => {
    const session = { sessionId: 'sample-1', format: 'hwpx' } as unknown as MobileDocSession
    const fake = fakeHost({ mobile_home_open_sample: () => session })
    const props = await renderHome({ host: fake.host })
    expect(byTestId('home-empty')).not.toBeNull()

    click(byTestId('home-empty-open'))
    expect(props.onOpenFile).toHaveBeenCalledTimes(1)

    click(byTestId('home-empty-create'))
    expect(byTestId('home-create-sheet')).not.toBeNull()
    click(byTestId('home-create-md'))
    expect(props.onCreateNew).toHaveBeenCalledWith('md')
    expect(byTestId('home-create-sheet')).toBeNull()

    click(byTestId('home-empty-sample'))
    await flush()
    expect(fake.calls('mobile_home_open_sample')).toEqual([{ lang: 'ko' }])
    expect(fake.openSession).toHaveBeenCalledWith(session)
    expect(sessionOrigin('sample-1')).toBe('sample')
  })

  it('has no sample button without a host', async () => {
    await renderHome()
    expect(byTestId('home-empty')).not.toBeNull()
    expect(byTestId('home-empty-sample')).toBeNull()
  })
})

describe('PDF tools link', () => {
  const pdfs = [doc('p1', 'one.pdf', 'pdf'), doc('p2', 'two.pdf', 'pdf')]

  async function selectBoth(): Promise<void> {
    click(byTestId('home-file-row-more-recent:p1'))
    click(byTestId('home-act-menu-select'))
    click(byTestId('home-file-row-open-recent:p2'))
    await flush()
  }

  it('hides the "PDF tools" row and [merge] while T3 has not linked its screen', async () => {
    const fake = fakeHost()
    await renderHome({ host: fake.host, recentDocs: pdfs })
    click(byTestId('home-fab'))
    expect(byTestId('home-create-sheet')).not.toBeNull()
    expect(byTestId('home-create-pdf-tools')).toBeNull()
    click(byTestId('home-create-open-file'))

    await selectBoth()
    expect(byTestId('home-act-bar')).not.toBeNull()
    expect(byTestId('home-act-bar-merge')).toBeNull()
  })

  it('shows them with a link, opens the tools screen and closes it', async () => {
    providePdfToolsLink(someLink)
    const fake = fakeHost()
    await renderHome({ host: fake.host, recentDocs: pdfs })
    click(byTestId('home-fab'))
    click(byTestId('home-create-pdf-tools'))
    expect(byTestId('home-create-sheet')).toBeNull()
    expect(byTestId('fake-flow')?.getAttribute('data-kind')).toBe('menu')
    click(byTestId('fake-flow-close'))
    expect(byTestId('home-tool-flow')).toBeNull()

    await selectBoth()
    expect(byTestId('home-act-selection-header')).not.toBeNull()
    expect(byTestId('home-tab-bar')).toBeNull()
    click(byTestId('home-act-bar-merge'))
    expect(byTestId('fake-flow')?.getAttribute('data-kind')).toBe('merge')
    expect(byTestId('fake-flow')?.getAttribute('data-count')).toBe('2')
    // the bar action ended selection
    expect(byTestId('home-act-bar')).toBeNull()
  })

  it('keeps them hidden while the PDF tools are turned off', async () => {
    providePdfToolsLink(someLink)
    const fake = fakeHost({}, { editorsOff: ['pdfTools'] })
    await renderHome({ host: fake.host, recentDocs: pdfs })
    click(byTestId('home-fab'))
    expect(byTestId('home-create-pdf-tools')).toBeNull()
  })
})

describe('home header layout and scroll collapse', () => {
  it('renders a unified home header that compacts on body scroll and resets on tab switch', async () => {
    const fake = fakeHost()
    await renderHome({ host: fake.host })
    const header = byTestId('home-header')
    expect(header).not.toBeNull()
    expect(header?.classList.contains('home-frame-header')).toBe(true)
    expect(header?.getAttribute('data-scrolled')).toBeNull()

    const body = document.body.querySelector<HTMLElement>('.home-frame-body')
    expect(body).not.toBeNull()
    Object.defineProperty(body!, 'scrollTop', { value: 48, configurable: true })
    act(() => {
      body!.dispatchEvent(new Event('scroll'))
    })
    expect(header?.getAttribute('data-scrolled')).toBe('true')

    click(byTestId('home-tab-folders'))
    await flush()
    expect(header?.getAttribute('data-scrolled')).toBeNull()
  })
})
