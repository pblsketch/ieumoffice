import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  MobileAppPrefs,
  MobileAppPrefsPatch,
  MobileClient,
} from '@genoffice/mobile-bridge/transport'
import type { EditorKind } from '../src/renderer/editors/editorKind'
import { EDITOR_KINDS } from '../src/renderer/editors/registry'
import { confirmEditorOn, setEditorOffHandler } from '../src/renderer/home/editorGate'
import type { HomeHost } from '../src/renderer/home/homeHost'
import {
  getHomeRuntime,
  markSessionOrigin,
  resetHomeRuntimeForTest,
  sessionOrigin,
  setHomeRuntime,
  useHomeRuntime,
} from '../src/renderer/home/homeRuntime'
import { resetKeepScreenOnForTest, useKeepScreenOn } from '../src/renderer/home/keepScreenOn'
import {
  ensureLoaded,
  getHomePrefs,
  HOME_TIP_IDS,
  homePrefsLoaded,
  isEditorOn,
  normalizeHomePrefs,
  PDF_TOOLS_ID,
  resetHomePrefsForTest,
  setEditorOn,
  updateHomePrefs,
  useHomePrefs,
} from '../src/renderer/home/prefsStore'
import { DEFAULT_PREFS } from '../src/renderer/settings/defaultPrefs'

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

const KIND_IDS = EDITOR_KINDS.map((kind) => kind.id)
const KEEP_ON = 'mobile_home_keep_screen_on'

interface FakeClient {
  readonly client: MobileClient
  readonly invoke: ReturnType<typeof vi.fn>
  readonly setAppPrefs: ReturnType<typeof vi.fn>
  readonly getAppPrefs: ReturnType<typeof vi.fn>
}

/** A client whose backend keeps the prefs in memory, like the Rust store does. */
function fakeClient(stored: Record<string, unknown> = {}): FakeClient {
  let current: Record<string, unknown> = { ...stored }
  const invoke = vi.fn(async () => ({ ok: true }))
  const getAppPrefs = vi.fn(async () => ({ ...current }))
  const setAppPrefs = vi.fn(async (patch: MobileAppPrefsPatch) => {
    current = { ...current, ...patch }
    return { ...current }
  })
  const client = { transport: { invoke }, getAppPrefs, setAppPrefs } as unknown as MobileClient
  return { client, invoke, getAppPrefs, setAppPrefs }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function kind(id: string): EditorKind {
  return { id } as unknown as EditorKind
}

const roots: Array<{ root: Root; container: HTMLElement }> = []

function mount(node: ReactNode): { rerender(next: ReactNode): void; unmount(): void } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const entry = { root, container }
  roots.push(entry)
  act(() => root.render(node))
  return {
    rerender: (next) => act(() => root.render(next)),
    unmount: () => {
      act(() => root.unmount())
      container.remove()
      roots.splice(roots.indexOf(entry), 1)
    },
  }
}

let visibility: DocumentVisibilityState = 'visible'

function setVisibility(next: DocumentVisibilityState): void {
  visibility = next
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  })
})

afterEach(() => {
  while (roots.length > 0) {
    const entry = roots.pop()
    if (!entry) break
    act(() => entry.root.unmount())
    entry.container.remove()
  }
  setEditorOffHandler(null)
  resetKeepScreenOnForTest()
  resetHomePrefsForTest()
  resetHomeRuntimeForTest()
})

describe('first values of the app settings', () => {
  it('makes new HWP documents .hwpx and fills the home fields for a fresh install', () => {
    expect(DEFAULT_PREFS).toMatchObject({
      hwpDefaultFormat: 'hwpx',
      aiEnabled: false,
      editorsOff: [],
      homeKindsHidden: [],
      homeKindsOrder: [],
      keepScreenOnWhileReading: true,
      firstRunDone: false,
      tipsSeen: [],
      lastSeenVersion: '',
    })
  })
})

describe('normalizing the stored settings', () => {
  it('reads missing home fields as already done, all on, and nothing to show', () => {
    const old: MobileAppPrefs = {
      lang: 'en',
      theme: 'dark',
      hwpDefaultFormat: 'hwp',
      aiEnabled: true,
    }
    const prefs = normalizeHomePrefs(old)
    expect(prefs).toEqual({
      lang: 'en',
      theme: 'dark',
      hwpDefaultFormat: 'hwp',
      aiEnabled: true,
      editorsOff: [],
      homeKindsHidden: [],
      homeKindsOrder: [],
      keepScreenOnWhileReading: true,
      firstRunDone: true,
      tipsSeen: [...HOME_TIP_IDS],
      lastSeenVersion: null,
    })
    expect(HOME_TIP_IDS).toEqual(['editButton', 'flowView', 'firstEdit', 'firstKeyboard'])
  })

  it('keeps the values that are there', () => {
    const prefs = normalizeHomePrefs({
      ...DEFAULT_PREFS,
      editorsOff: ['markdown', 7, PDF_TOOLS_ID],
      homeKindsHidden: ['md'],
      homeKindsOrder: ['md', 'hwp'],
      keepScreenOnWhileReading: false,
      firstRunDone: false,
      tipsSeen: ['editButton'],
      lastSeenVersion: '',
    })
    expect(prefs.editorsOff).toEqual(['markdown', PDF_TOOLS_ID])
    expect(prefs.homeKindsHidden).toEqual(['md'])
    expect(prefs.homeKindsOrder).toEqual(['md', 'hwp'])
    expect(prefs.keepScreenOnWhileReading).toBe(false)
    expect(prefs.firstRunDone).toBe(false)
    expect(prefs.tipsSeen).toEqual(['editButton'])
    // an empty value means a fresh install, not a missing field
    expect(prefs.lastSeenVersion).toBe('')
  })

  it('falls back to the first values for a reply that is not settings (fake bridge)', () => {
    const prefs = normalizeHomePrefs({ ok: true })
    expect(prefs.lang).toBe(DEFAULT_PREFS.lang)
    expect(prefs.theme).toBe(DEFAULT_PREFS.theme)
    expect(prefs.hwpDefaultFormat).toBe('hwpx')
    expect(prefs.aiEnabled).toBe(false)
    expect(prefs.firstRunDone).toBe(true)
    expect(normalizeHomePrefs(undefined)).toEqual(normalizeHomePrefs({}))
  })

  it('uses the missing values before anything is loaded', () => {
    expect(homePrefsLoaded()).toBe(false)
    expect(getHomePrefs()).toEqual(normalizeHomePrefs(undefined))
  })
})

describe('editor on and off', () => {
  it('turns off only the listed editors', async () => {
    const [first] = KIND_IDS
    await updateHomePrefs({ editorsOff: [first] })
    expect(isEditorOn(first)).toBe(false)
    for (const id of KIND_IDS.slice(1)) expect(isEditorOn(id)).toBe(true)
    expect(isEditorOn(PDF_TOOLS_ID)).toBe(true)
    expect(isEditorOn('someFutureKind')).toBe(true)
  })

  it('reads every editor off as every editor on, but keeps PDF tools off', async () => {
    await updateHomePrefs({ editorsOff: [...KIND_IDS, PDF_TOOLS_ID] })
    for (const id of KIND_IDS) expect(isEditorOn(id)).toBe(true)
    expect(isEditorOn(PDF_TOOLS_ID)).toBe(false)
  })

  it('turns one editor back on without touching the others', async () => {
    await updateHomePrefs({ editorsOff: ['markdown', PDF_TOOLS_ID] })
    await setEditorOn('markdown', true)
    expect(getHomePrefs().editorsOff).toEqual([PDF_TOOLS_ID])
    await setEditorOn('markdown', false)
    expect(getHomePrefs().editorsOff).toEqual([PDF_TOOLS_ID, 'markdown'])
  })
})

describe('loading and saving', () => {
  it('loads once and keeps the result', async () => {
    const fake = fakeClient({ ...DEFAULT_PREFS, editorsOff: ['markdown'], firstRunDone: false })
    await Promise.all([ensureLoaded(fake.client), ensureLoaded(fake.client)])
    await ensureLoaded(fake.client)
    expect(fake.getAppPrefs).toHaveBeenCalledTimes(1)
    expect(homePrefsLoaded()).toBe(true)
    expect(getHomePrefs().editorsOff).toEqual(['markdown'])
    expect(getHomePrefs().firstRunDone).toBe(false)
  })

  it('without a client keeps the defaults and resolves at once', async () => {
    await ensureLoaded()
    expect(homePrefsLoaded()).toBe(false)
    expect(getHomePrefs()).toEqual(normalizeHomePrefs(undefined))
  })

  it('keeps the defaults when the read fails and tries again later', async () => {
    const fake = fakeClient({ ...DEFAULT_PREFS, editorsOff: ['markdown'] })
    fake.getAppPrefs.mockRejectedValueOnce(new Error('no backend'))
    await ensureLoaded(fake.client)
    expect(homePrefsLoaded()).toBe(false)
    expect(isEditorOn('markdown')).toBe(true)
    await ensureLoaded(fake.client)
    expect(homePrefsLoaded()).toBe(true)
    expect(isEditorOn('markdown')).toBe(false)
  })

  it('saves through the client and stores what the backend returns', async () => {
    const fake = fakeClient({ ...DEFAULT_PREFS })
    await ensureLoaded(fake.client)
    const prefs = await updateHomePrefs({ tipsSeen: ['editButton'], firstRunDone: true })
    expect(fake.setAppPrefs).toHaveBeenCalledWith({ tipsSeen: ['editButton'], firstRunDone: true })
    expect(prefs.tipsSeen).toEqual(['editButton'])
    expect(getHomePrefs()).toBe(prefs)
  })

  it('keeps the saved values when the backend reply is not settings', async () => {
    const setAppPrefs = vi.fn(async () => ({ ok: true }))
    const client = { setAppPrefs } as unknown as MobileClient
    await updateHomePrefs({ homeKindsOrder: ['md', 'hwp'] }, client)
    expect(getHomePrefs().homeKindsOrder).toEqual(['md', 'hwp'])
  })

  it('uses the runtime host client when no client is passed', async () => {
    const fake = fakeClient({ ...DEFAULT_PREFS })
    setHomeRuntime({ client: fake.client } as unknown as HomeHost)
    await updateHomePrefs({ keepScreenOnWhileReading: false })
    expect(fake.setAppPrefs).toHaveBeenCalledTimes(1)
    expect(getHomePrefs().keepScreenOnWhileReading).toBe(false)
  })

  it('leaves the values as they were when saving fails', async () => {
    const setAppPrefs = vi.fn(async () => {
      throw new Error('disk full')
    })
    const client = { setAppPrefs } as unknown as MobileClient
    await expect(updateHomePrefs({ editorsOff: ['markdown'] }, client)).rejects.toThrow()
    expect(getHomePrefs().editorsOff).toEqual([])
  })

  it('re-renders the hook when the values change', async () => {
    const seen: string[][] = []
    function Probe(): null {
      const { prefs, isEditorOn: on } = useHomePrefs()
      seen.push([...prefs.editorsOff])
      expect(typeof on('markdown')).toBe('boolean')
      return null
    }
    mount(createElement(Probe))
    await act(async () => {
      await updateHomePrefs({ editorsOff: ['markdown'] })
    })
    expect(seen.at(0)).toEqual([])
    expect(seen.at(-1)).toEqual(['markdown'])
  })
})

describe('asking before opening a file of a turned-off editor', () => {
  it('opens at once when the editor is on', async () => {
    const ask = vi.fn(async () => false)
    setEditorOffHandler(ask)
    await expect(confirmEditorOn(kind('markdown'))).resolves.toBe(true)
    expect(ask).not.toHaveBeenCalled()
  })

  it('asks the registered handler when the editor is off', async () => {
    await updateHomePrefs({ editorsOff: ['markdown'] })
    const ask = vi.fn(async () => false)
    setEditorOffHandler(ask)
    await expect(confirmEditorOn(kind('markdown'))).resolves.toBe(false)
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ id: 'markdown' }))
    ask.mockResolvedValueOnce(true)
    await expect(confirmEditorOn(kind('markdown'))).resolves.toBe(true)
  })

  it('opens when no handler is registered', async () => {
    await updateHomePrefs({ editorsOff: ['markdown'] })
    await expect(confirmEditorOn(kind('markdown'))).resolves.toBe(true)
  })

  it('does not open when the handler fails', async () => {
    await updateHomePrefs({ editorsOff: ['markdown'] })
    setEditorOffHandler(async () => {
      throw new Error('layer gone')
    })
    await expect(confirmEditorOn(kind('markdown'))).resolves.toBe(false)
  })

  it('drops a handler when its unregister is called', async () => {
    await updateHomePrefs({ editorsOff: ['markdown'] })
    const ask = vi.fn(async () => false)
    const unregister = setEditorOffHandler(ask)
    unregister()
    await expect(confirmEditorOn(kind('markdown'))).resolves.toBe(true)
    expect(ask).not.toHaveBeenCalled()
  })

  it('waits for the first read of the settings before deciding', async () => {
    const reply = deferred<Record<string, unknown>>()
    const getAppPrefs = vi.fn(() => reply.promise)
    const client = { getAppPrefs } as unknown as MobileClient
    const ask = vi.fn(async () => false)
    setEditorOffHandler(ask)
    let settled = false
    const decision = confirmEditorOn(kind('markdown'), client).then((value) => {
      settled = true
      return value
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)
    reply.resolve({ ...DEFAULT_PREFS, editorsOff: ['markdown'] })
    await expect(decision).resolves.toBe(false)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('a call without a client waits for a read already under way', async () => {
    const reply = deferred<Record<string, unknown>>()
    const client = { getAppPrefs: vi.fn(() => reply.promise) } as unknown as MobileClient
    const loading = ensureLoaded(client)
    const ask = vi.fn(async () => false)
    setEditorOffHandler(ask)
    const decision = confirmEditorOn(kind('markdown'))
    reply.resolve({ ...DEFAULT_PREFS, editorsOff: ['markdown'] })
    await loading
    await expect(decision).resolves.toBe(false)
  })

  it('treats a failed read as all editors on', async () => {
    const client = {
      getAppPrefs: vi.fn(async () => {
        throw new Error('no backend')
      }),
    } as unknown as MobileClient
    const ask = vi.fn(async () => false)
    setEditorOffHandler(ask)
    await expect(confirmEditorOn(kind('markdown'), client)).resolves.toBe(true)
    expect(ask).not.toHaveBeenCalled()
  })
})

describe('keeping the screen on while reading', () => {
  function Reader(props: { client: MobileClient; active: boolean }): null {
    useKeepScreenOn(props.client, props.active)
    return null
  }

  function keepCalls(fake: FakeClient): boolean[] {
    return fake.invoke.mock.calls
      .filter(([command]) => command === KEEP_ON)
      .map(([, args]) => (args as { on: boolean }).on)
  }

  it('turns on for the first reader and off after the last one leaves', async () => {
    const fake = fakeClient({ ...DEFAULT_PREFS })
    const a = mount(createElement(Reader, { client: fake.client, active: true }))
    const b = mount(createElement(Reader, { client: fake.client, active: true }))
    await flush()
    expect(keepCalls(fake)).toEqual([true])
    a.unmount()
    await flush()
    expect(keepCalls(fake)).toEqual([true])
    b.unmount()
    await flush()
    expect(keepCalls(fake)).toEqual([true, false])
  })

  it('follows the active flag', async () => {
    const fake = fakeClient({ ...DEFAULT_PREFS })
    const reader = mount(createElement(Reader, { client: fake.client, active: false }))
    await flush()
    expect(keepCalls(fake)).toEqual([])
    reader.rerender(createElement(Reader, { client: fake.client, active: true }))
    await flush()
    reader.rerender(createElement(Reader, { client: fake.client, active: false }))
    await flush()
    expect(keepCalls(fake)).toEqual([true, false])
  })

  it('does nothing while the setting is off, and lets go when it is turned off', async () => {
    const fake = fakeClient({ ...DEFAULT_PREFS, keepScreenOnWhileReading: false })
    await ensureLoaded(fake.client)
    mount(createElement(Reader, { client: fake.client, active: true }))
    await flush()
    expect(keepCalls(fake)).toEqual([])
    await act(async () => {
      await updateHomePrefs({ keepScreenOnWhileReading: true })
    })
    expect(keepCalls(fake)).toEqual([true])
    await act(async () => {
      await updateHomePrefs({ keepScreenOnWhileReading: false })
    })
    expect(keepCalls(fake)).toEqual([true, false])
  })

  it('lets go while the app is in the background and takes hold again when it comes back', async () => {
    const fake = fakeClient({ ...DEFAULT_PREFS })
    mount(createElement(Reader, { client: fake.client, active: true }))
    await flush()
    setVisibility('hidden')
    await flush()
    expect(keepCalls(fake)).toEqual([true, false])
    setVisibility('visible')
    await flush()
    expect(keepCalls(fake)).toEqual([true, false, true])
  })

  it('swallows a backend refusal', async () => {
    const fake = fakeClient({ ...DEFAULT_PREFS })
    fake.invoke.mockRejectedValue(new Error('not on this platform'))
    expect(() => mount(createElement(Reader, { client: fake.client, active: true }))).not.toThrow()
    await flush()
    expect(keepCalls(fake)).toEqual([true])
  })
})

describe('the PDF tools link', () => {
  it('reads null until T3 provides the link, then re-renders with it', async () => {
    vi.resetModules()
    const mod = await import('../src/renderer/home/pdfToolsLink')
    const seen: Array<unknown> = []
    function Probe(): null {
      seen.push(mod.usePdfToolsLink())
      return null
    }
    mount(createElement(Probe))
    expect(seen.at(-1)).toBeNull()
    const link = { Flow: () => null }
    act(() => mod.providePdfToolsLink(link))
    expect(seen.at(-1)).toBe(link)
  })
})

describe('the home runtime', () => {
  it('holds the host the app layer puts in', () => {
    const seen: Array<HomeHost | null> = []
    function Probe(): null {
      seen.push(useHomeRuntime())
      return null
    }
    mount(createElement(Probe))
    expect(seen.at(-1)).toBeNull()
    expect(getHomeRuntime()).toBeNull()
    const host = { client: fakeClient().client } as unknown as HomeHost
    act(() => setHomeRuntime(host))
    expect(seen.at(-1)).toBe(host)
    expect(getHomeRuntime()).toBe(host)
    act(() => setHomeRuntime(null))
    expect(seen.at(-1)).toBeNull()
  })

  it('remembers where each session came from', () => {
    expect(sessionOrigin('s1')).toBeNull()
    markSessionOrigin('s1', 'sample')
    markSessionOrigin('s2', 'received')
    expect(sessionOrigin('s1')).toBe('sample')
    expect(sessionOrigin('s2')).toBe('received')
    expect(sessionOrigin('s3')).toBeNull()
  })
})
