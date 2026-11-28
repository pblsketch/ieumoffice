// PPTX reading screen of track T5: the kind's opening order, the slide view (turning, the
// slides kept built, zoom), the slide list, search, the show, notes, the remembered slide,
// keep-screen-on, share and dispose. Konva does not paint in jsdom, so the PC painter is a
// stand-in that shows what it was given; the decks open in the real engine.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import JSZip from 'jszip'
import PptxGenJS from 'pptxgenjs'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMobileClient,
  type MobileClient,
  type MobileDocSession,
  type MobileTransport,
} from '@genoffice/mobile-bridge/transport'
import type { ReaderPosition, ReaderSettings } from '@genoffice/mobile-bridge/readers'
import type {
  EditorDocument,
  EditorFrameProps,
  EditorHost,
} from '../src/renderer/editors/editorKind'
import { createPptxEditorKind } from '../src/renderer/editors/readers/pptx/pptxKind'
import { searchDeck } from '../src/renderer/editors/readers/pptx/pptxSearch'
import { MobileLocaleProvider, translateMobile } from '../src/renderer/i18n'
import { BackStackProvider } from '../src/renderer/shell/backStack'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SLOW = 60_000

// ── stand-ins ───────────────────────────────────────────────────────

const spy = vi.hoisted(() => ({
  opened: 0,
  rendered: [] as number[],
  released: [] as number[],
  disposed: 0,
  keepScreenOn: [] as boolean[],
  imageLoads: 0,
}))

vi.mock('../../slides/src/renderer/SlideThumb', () => ({
  SlideThumb: (props: {
    slide: { widthPx: number; partPath?: string }
    images: Map<string, HTMLImageElement>
    width: number
  }) => (
    <div
      data-testid="slide-thumb"
      data-width={props.width}
      data-images={props.images.size}
      data-part={props.slide.partPath ?? ''}
    />
  ),
}))

vi.mock('../src/renderer/editors/readers/shared/keepScreenOn', () => ({
  useReaderKeepScreenOn: (_client: unknown, active: boolean) => {
    spy.keepScreenOn.push(active)
  },
}))

vi.mock('../src/renderer/editors/readers/pptx/deck', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/renderer/editors/readers/pptx/deck')>()
  return {
    ...actual,
    async openDeck(bytes: Uint8Array) {
      spy.opened += 1
      const deck = await actual.openDeck(bytes)
      return {
        ...deck,
        slideCount: deck.slideCount,
        size: deck.size,
        renderSlide(index: number, width: number) {
          spy.rendered.push(index)
          return deck.renderSlide(index, width)
        },
        releaseSlide(index: number) {
          spy.released.push(index)
          deck.releaseSlide(index)
        },
        dispose() {
          spy.disposed += 1
          deck.dispose()
        },
      }
    },
  }
})

vi.mock('../src/renderer/editors/readers/pptx/images', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/renderer/editors/readers/pptx/images')>()
  return {
    ...actual,
    // jsdom decodes no images: hand back one stand-in per URL right away
    loadSlideImages(urls: readonly string[], onLoaded: (m: Map<string, HTMLImageElement>) => void) {
      spy.imageLoads += 1
      let cancelled = false
      queueMicrotask(() => {
        if (!cancelled) onLoaded(new Map(urls.map((u) => [u, document.createElement('img')])))
      })
      return {
        cancel() {
          cancelled = true
        },
      }
    },
  }
})

// ── decks built here ────────────────────────────────────────────────

const PNG_DATA =
  'image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

interface SlideSpec {
  readonly text: string
  readonly notes?: string
  readonly hidden?: boolean
  readonly picture?: boolean
}

async function buildDeck(specs: readonly SlideSpec[]): Promise<Uint8Array> {
  const p = new PptxGenJS()
  for (const spec of specs) {
    const s = p.addSlide()
    s.addText(spec.text, { x: 1, y: 1, w: 6, h: 1 })
    if (spec.notes) s.addNotes(spec.notes)
    if (spec.hidden) s.hidden = true
    if (spec.picture) s.addImage({ data: PNG_DATA, x: 1, y: 2.5, w: 1, h: 1 })
  }
  return (await p.write({ outputType: 'uint8array' })) as Uint8Array
}

/** A deck whose presentation lists no slides */
async function buildEmptyDeck(): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await buildDeck([{ text: 'Only' }]))
  const path = 'ppt/presentation.xml'
  const xml = await zip.file(path)!.async('string')
  zip.file(path, xml.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, '<p:sldIdLst/>'))
  return zip.generateAsync({ type: 'uint8array' })
}

const SIX: readonly SlideSpec[] = [
  { text: 'Alpha opening', picture: true },
  { text: 'Bravo hidden', hidden: true },
  { text: 'Charlie middle' },
  { text: 'Delta words', notes: 'Speaker bravo note' },
  { text: 'Echo near end' },
  { text: 'Foxtrot last' },
]

let sixDeck: Promise<Uint8Array> | null = null
const sixBytes = () => (sixDeck ??= buildDeck(SIX))

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

// ── fake bridge ─────────────────────────────────────────────────────

interface Bridge {
  readonly client: MobileClient
  readonly calls: { command: string; args?: Record<string, unknown> }[]
  state: { position: ReaderPosition | null; settings: ReaderSettings | null }
}

function makeBridge(bytesBase64: string): Bridge {
  const bridge: Bridge = {
    client: null as unknown as MobileClient,
    calls: [],
    state: { position: null, settings: null },
  }
  const transport: MobileTransport = {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      bridge.calls.push({ command, args })
      switch (command) {
        case 'mobile_read_file_bytes':
          return { bytesBase64 } as T
        case 'mobile_readers_get_state':
          return { ...bridge.state } as T
        case 'mobile_readers_set_position':
          bridge.state.position = args!.position as ReaderPosition
          return { ok: true } as T
        case 'mobile_readers_set_settings':
          bridge.state.settings = args!.settings as ReaderSettings
          return { ok: true } as T
        default:
          return { ok: true } as T
      }
    },
    async listen() {
      return () => {}
    },
  }
  ;(bridge as { client: MobileClient }).client = createMobileClient(transport)
  return bridge
}

const callsOf = (bridge: Bridge, command: string) =>
  bridge.calls.filter((call) => call.command === command)

const SESSION: MobileDocSession = {
  sessionId: 's-1',
  docKey: 'doc-key-1',
  name: 'Deck.pptx',
  ext: 'pptx',
  format: 'pptx',
  writable: true,
  ephemeral: false,
}

// ── rendering ───────────────────────────────────────────────────────

const t = (key: Parameters<typeof translateMobile>[1], params?: Record<string, string | number>) =>
  translateMobile('en', key, params)

interface Mounted {
  readonly doc: EditorDocument
  readonly host: EditorHost & { showToast: ReturnType<typeof vi.fn> }
  readonly frame: EditorFrameProps & { onBack: ReturnType<typeof vi.fn> }
  readonly container: HTMLElement
  mount(): void
  unmount(): void
}

const mounted: { root: Root; container: HTMLElement }[] = []

function makeHost(client: MobileClient) {
  return {
    client,
    markDirty: vi.fn(),
    updateSession: vi.fn(),
    setNotice: vi.fn(),
    showToast: vi.fn(),
    contentChanged: vi.fn(),
    refreshHome: vi.fn(async () => {}),
    openSession: vi.fn(async () => {}),
    translate: (
      key: Parameters<typeof translateMobile>[1],
      params?: Record<string, string | number>,
    ) => translateMobile('en', key, params),
    windowClass: () => 'compact' as const,
  }
}

function makeFrame() {
  return {
    docTitle: SESSION.name,
    docFormat: SESSION.format,
    saveState: 'saved' as const,
    mode: 'view' as const,
    canEdit: false,
    aiEnabled: false,
    noticeBanner: null,
    aiPanelContent: null,
    onBack: vi.fn(),
    onEnterEdit: vi.fn(),
    onDone: vi.fn(),
    onExitEdit: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onShare: vi.fn(),
    onOpenBackups: vi.fn(),
  }
}

async function tick(ms = 10): Promise<void> {
  await act(async () => {
    await new Promise((done) => setTimeout(done, ms))
  })
}

async function waitFor(check: () => boolean, timeoutMs = 20_000): Promise<void> {
  const until = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out waiting')
    await tick()
  }
}

async function openReader(
  bridge: Bridge,
  options: { positionDelayMs?: number } = {},
): Promise<Mounted> {
  const kind = createPptxEditorKind({ positionDelayMs: options.positionDelayMs ?? 20 })
  const opened = await kind.open({ session: SESSION, client: bridge.client, isUntitled: false })
  const host = makeHost(bridge.client)
  const doc = opened.start(host)
  const frame = makeFrame()
  const container = document.createElement('div')
  document.body.appendChild(container)
  let root: Root | null = null
  const result: Mounted = {
    doc,
    host,
    frame,
    container,
    mount() {
      root = createRoot(container)
      mounted.push({ root, container })
      const Workspace = doc.Workspace
      act(() =>
        root!.render(
          <MobileLocaleProvider lang="en">
            <BackStackProvider>
              <Workspace frame={frame} mode="view" canEdit={false} lang="en" theme="light" />
            </BackStackProvider>
          </MobileLocaleProvider>,
        ),
      )
    },
    unmount() {
      act(() => root?.unmount())
      root = null
    },
  }
  result.mount()
  return result
}

const q = (sel: string): HTMLElement | null => document.querySelector(sel)
const testId = (id: string): HTMLElement | null => q(`[data-testid="${id}"]`)
const positionText = () => testId('pptx-position')?.textContent ?? null
const ready = () => positionText() !== null || testId('pptx-no-slides') !== null

async function click(el: Element | null): Promise<void> {
  if (!el) throw new Error('nothing to click')
  await act(async () => {
    ;(el as HTMLElement).click()
  })
}

function pointer(el: Element, type: string, x: number, y = 100, id = 1): void {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: id }))
}

async function swipe(el: Element, fromX: number, toX: number): Promise<void> {
  await act(async () => {
    pointer(el, 'pointerdown', fromX)
    pointer(el, 'pointermove', (fromX + toX) / 2)
    pointer(el, 'pointermove', toX)
    pointer(el, 'pointerup', toX)
  })
}

async function tap(el: Element, x: number): Promise<void> {
  await act(async () => {
    pointer(el, 'pointerdown', x)
    pointer(el, 'pointerup', x)
  })
}

async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

// ── setup ───────────────────────────────────────────────────────────

const originalRect = HTMLElement.prototype.getBoundingClientRect
let urlSeq = 0

beforeEach(() => {
  Object.assign(spy, {
    opened: 0,
    rendered: [],
    released: [],
    disposed: 0,
    keepScreenOn: [],
    imageLoads: 0,
  })
  URL.createObjectURL = () => `blob:test/${++urlSeq}`
  URL.revokeObjectURL = () => {}
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
  // every box measures 400 × 300 (jsdom lays nothing out)
  HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 400,
      height: 300,
      right: 400,
      bottom: 300,
      toJSON: () => ({}),
    } as DOMRect
  }
})

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
  document.body.innerHTML = ''
  HTMLElement.prototype.getBoundingClientRect = originalRect
  Reflect.deleteProperty(globalThis, 'IntersectionObserver')
})

// ── tests ───────────────────────────────────────────────────────────

describe('pptx kind', () => {
  it('is a read-only kind without AI or creation', () => {
    const kind = createPptxEditorKind()
    expect(kind).toMatchObject({
      id: 'pptx',
      formats: ['pptx'],
      openExtensions: ['pptx'],
      editable: false,
      hasAi: false,
      labelKey: 'readersPptxKindLabel',
    })
    expect(kind.createFormats).toBeUndefined()
    expect(kind.recoveryFormat('pptx')).toBe('pptx')
  })

  it('keeps the engine, Konva, the PC painter and the Workspace out of the kind file', () => {
    const source = readFileSync(
      resolve(__dirname, '../src/renderer/editors/readers/pptx/pptxKind.tsx'),
      'utf8',
    )
    // value imports only: `import type` lines are erased from the bundle
    const staticImports = [...source.matchAll(/^import\s+(?!type\s)[^']*?from\s+'([^']+)'/gm)].map(
      (m) => m[1],
    )
    expect(staticImports.length).toBeGreaterThan(0)
    const heavy =
      /pptx-engine|pptx-render|konva|slides\/src|\.\/deck|\.\/images|\.\/media|PptxWorkspace|pptxDocument/
    for (const path of staticImports) expect(path).not.toMatch(heavy)
    expect(source).toContain("import('./pptxDocument')")
    expect(source).toContain("import('./PptxWorkspace')")
  })

  it('draws with the PC font fallback without the PC font manager', async () => {
    // SlideThumb's painter (konva-adapter) publishes its own family fallback on import
    const adapter = await import('../../slides/src/renderer/konva-adapter')
    expect(window.__genofficeDisplayFontFamily).toBe(adapter.displayFontFamily)
    expect(adapter.displayFontFamily('맑은 고딕')).toContain('맑은 고딕')
  })

  it('reads only the bytes in open(); the engine runs after start', async () => {
    const bridge = makeBridge(toBase64(await sixBytes()))
    const kind = createPptxEditorKind()
    const opened = await kind.open({ session: SESSION, client: bridge.client, isUntitled: false })
    expect(callsOf(bridge, 'mobile_read_file_bytes')).toEqual([
      { command: 'mobile_read_file_bytes', args: { sessionId: 's-1' } },
    ])
    expect(opened.noticeKey).toBeNull()
    expect(opened.encrypted).toBeUndefined()
    await tick(50)
    expect(spy.opened).toBe(0)

    // a cancelled switch frees what open() prepared and never opens the engine
    opened.discard?.()
    await tick(50)
    expect(spy.opened).toBe(0)
  })

  it(
    'opens the deck inside the document after start and draws the first slide',
    async () => {
      const bridge = makeBridge(toBase64(await sixBytes()))
      const view = await openReader(bridge)
      expect(view.doc.editable).toBe(false)
      expect(view.doc.aiAvailable).toBe(false)
      expect(view.doc.save).toBeUndefined()
      expect(view.doc.writeRecovery).toBeUndefined()
      expect(view.doc.createAiRun).toBeUndefined()
      await waitFor(ready)
      expect(spy.opened).toBe(1)
      expect(positionText()).toBe('1 / 6')
      const picture = q('.mobile-pptx-slide-picture')!
      expect(picture.getAttribute('role')).toBe('img')
      expect(picture.getAttribute('aria-label')).toBe(
        t('readersPptxSlideA11y', { current: 1, total: 6 }),
      )
      expect(q('.mobile-pptx-slide .mobile-sr-only')!.textContent).toContain('Alpha opening')
      // images arrive after the first drawing and the slide is drawn again with them
      await waitFor(() => testId('slide-thumb')?.getAttribute('data-images') === '1')
      expect(testId('slide-thumb')!.getAttribute('data-width')).toBe('400')
    },
    SLOW,
  )

  it('shows the refusal and goes back when the engine does not take the file', async () => {
    const bridge = makeBridge(toBase64(new TextEncoder().encode('not a deck')))
    const view = await openReader(bridge)
    await waitFor(() => view.frame.onBack.mock.calls.length > 0)
    expect(view.host.showToast).toHaveBeenCalledWith(t('readersErrPptxOpen'))
    // no slide was ever on screen
    expect(spy.keepScreenOn.every((active) => !active)).toBe(true)
    expect(view.frame.onBack).toHaveBeenCalledTimes(1)
  })

  it('shares the original file', async () => {
    const bridge = makeBridge(toBase64(await sixBytes()))
    const view = await openReader(bridge)
    await view.doc.share({
      session: SESSION,
      dirty: false,
      isUntitled: false,
      encrypted: false,
      distribution: false,
      trackingDropped: false,
    } as Parameters<EditorDocument['share']>[0])
    expect(callsOf(bridge, 'mobile_share_file')[0]!.args).toMatchObject({
      sessionId: 's-1',
      suggestedName: 'Deck.pptx',
      mode: 'original',
    })
  })
})

describe('slide view', () => {
  it(
    'turns with the buttons, swipes and edge taps, and shows the position',
    async () => {
      const bridge = makeBridge(toBase64(await sixBytes()))
      await openReader(bridge)
      await waitFor(ready)
      expect((testId('pptx-prev') as HTMLButtonElement).disabled).toBe(true)
      await click(testId('pptx-next'))
      expect(positionText()).toBe('2 / 6')
      await click(testId('pptx-prev'))
      expect(positionText()).toBe('1 / 6')

      const stage = testId('pptx-stage')!
      await swipe(stage, 300, 100)
      expect(positionText()).toBe('2 / 6')
      await swipe(stage, 100, 300)
      expect(positionText()).toBe('1 / 6')
      await tap(stage, 380) // right edge
      expect(positionText()).toBe('2 / 6')
      await tap(stage, 200) // middle: nothing
      expect(positionText()).toBe('2 / 6')
      await tap(stage, 10) // left edge
      expect(positionText()).toBe('1 / 6')
    },
    SLOW,
  )

  it(
    'pans instead of turning while zoomed, and turns again at 1×',
    async () => {
      const bridge = makeBridge(toBase64(await sixBytes()))
      await openReader(bridge)
      await waitFor(ready)
      const stage = testId('pptx-stage')!
      await act(async () => {
        pointer(stage, 'pointerdown', 180, 100, 1)
        pointer(stage, 'pointerdown', 220, 100, 2)
        pointer(stage, 'pointermove', 100, 100, 1)
        pointer(stage, 'pointermove', 300, 100, 2)
        pointer(stage, 'pointerup', 100, 100, 1)
        pointer(stage, 'pointerup', 300, 100, 2)
      })
      expect(stage.getAttribute('data-zoomed')).toBe('true')
      await swipe(stage, 300, 100)
      expect(positionText()).toBe('1 / 6')
      expect(q('.mobile-pptx-zoom')!.getAttribute('style')).toContain('scale(4)')

      // pinch back to 1×
      await act(async () => {
        pointer(stage, 'pointerdown', 100, 100, 3)
        pointer(stage, 'pointerdown', 300, 100, 4)
        pointer(stage, 'pointermove', 190, 100, 3)
        pointer(stage, 'pointermove', 210, 100, 4)
        pointer(stage, 'pointerup', 190, 100, 3)
        pointer(stage, 'pointerup', 210, 100, 4)
      })
      expect(stage.getAttribute('data-zoomed')).toBeNull()
      await swipe(stage, 300, 100)
      expect(positionText()).toBe('2 / 6')
    },
    SLOW,
  )

  it(
    'builds only the current slide and its neighbours and releases far ones',
    async () => {
      const bridge = makeBridge(toBase64(await sixBytes()))
      await openReader(bridge)
      await waitFor(ready)
      expect([...new Set(spy.rendered)].sort()).toEqual([0, 1])
      for (let i = 0; i < 3; i += 1) await click(testId('pptx-next'))
      expect(positionText()).toBe('4 / 6')
      expect([...new Set(spy.rendered)].sort()).toEqual([0, 1, 2, 3, 4])
      expect(spy.rendered).not.toContain(5)
      expect([...new Set(spy.released)].sort()).toEqual([0, 1])
    },
    SLOW,
  )

  it(
    'keeps the screen on while the slide view is up',
    async () => {
      const bridge = makeBridge(toBase64(await sixBytes()))
      await openReader(bridge)
      await waitFor(ready)
      expect(spy.keepScreenOn.at(-1)).toBe(true)
      await click(testId('view-tool-pptxSearch'))
      // a sheet over the slide keeps it on
      expect(spy.keepScreenOn.at(-1)).toBe(true)
    },
    SLOW,
  )

  it(
    'keeps the slide when the Workspace mounts again',
    async () => {
      const bridge = makeBridge(toBase64(await sixBytes()))
      const view = await openReader(bridge)
      await waitFor(ready)
      await click(testId('pptx-next'))
      await click(testId('pptx-next'))
      view.unmount()
      expect(testId('pptx-position')).toBeNull()
      view.mount()
      await waitFor(ready)
      expect(positionText()).toBe('3 / 6')
      expect(spy.opened).toBe(1)
    },
    SLOW,
  )

  it('shows the empty state for a deck without slides, with no list or show', async () => {
    const bridge = makeBridge(toBase64(await buildEmptyDeck()))
    await openReader(bridge)
    await waitFor(ready)
    expect(testId('pptx-no-slides')!.textContent).toContain(t('readersPptxNoSlides'))
    expect(testId('view-tool-pptxSlideList')).toBeNull()
    expect(testId('view-tool-pptxPresent')).toBeNull()
    expect(testId('view-tool-pptxSearch')).not.toBeNull()
    expect(spy.keepScreenOn.at(-1)).toBe(false)
  })
})

describe('slide list and search', () => {
  it(
    'lists the slides, marks the current one, dims hidden ones and goes to a tapped slide',
    async () => {
      // cells report visible through the observer; only those draw a thumbnail
      const observed: Element[] = []
      let notify: ((records: { target: Element; isIntersecting: boolean }[]) => void) | null = null
      class FakeObserver {
        constructor(cb: (records: { target: Element; isIntersecting: boolean }[]) => void) {
          notify = cb
        }
        observe(el: Element) {
          observed.push(el)
        }
        unobserve() {}
        disconnect() {}
      }
      ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeObserver

      const bridge = makeBridge(toBase64(await sixBytes()))
      await openReader(bridge)
      await waitFor(ready)
      await click(testId('view-tool-pptxSlideList'))
      const sheet = testId('pptx-slide-list-sheet')!
      expect(sheet.querySelectorAll('.mobile-pptx-grid-cell')).toHaveLength(6)
      expect(observed).toHaveLength(6)
      expect(sheet.querySelectorAll('[data-testid="slide-thumb"]')).toHaveLength(0)
      await act(async () => {
        notify!(observed.slice(3, 5).map((target) => ({ target, isIntersecting: true })))
      })
      expect(sheet.querySelectorAll('[data-testid="slide-thumb"]')).toHaveLength(2)

      expect(testId('pptx-grid-cell-0')!.getAttribute('aria-current')).toBe('true')
      const hiddenCell = testId('pptx-grid-cell-1')!
      expect(hiddenCell.getAttribute('data-hidden')).toBe('true')
      expect(hiddenCell.textContent).toContain(t('readersPptxHidden'))
      expect(testId('pptx-grid-cell-2')!.getAttribute('data-hidden')).toBeNull()

      await click(testId('pptx-grid-cell-4'))
      expect(testId('pptx-slide-list-sheet')).toBeNull()
      expect(positionText()).toBe('5 / 6')
    },
    SLOW,
  )

  it(
    'finds words in slides and notes, and a result goes to its slide',
    async () => {
      const bridge = makeBridge(toBase64(await sixBytes()))
      await openReader(bridge)
      await waitFor(ready)
      await click(testId('view-tool-pptxSearch'))
      const input = testId('pptx-search-input') as HTMLInputElement
      await typeInto(input, '   ')
      await tick(300)
      expect(q('.mobile-pptx-search-status')!.textContent).toBe('')

      await typeInto(input, 'BRAVO')
      await waitFor(() => document.querySelectorAll('[data-testid="pptx-search-hit"]').length > 0)
      const hits = [...document.querySelectorAll('[data-testid="pptx-search-hit"]')]
      expect(hits.map((h) => h.querySelector('.mobile-pptx-search-slide')!.textContent)).toEqual([
        t('readersPptxSlideLabel', { n: 2 }),
        `${t('readersPptxSlideLabel', { n: 4 })} · ${t('readersPptxNotes')}`,
      ])
      expect(hits[1]!.querySelector('mark')!.textContent).toBe('bravo')
      await click(hits[1]!)
      expect(testId('pptx-search-sheet')).toBeNull()
      expect(positionText()).toBe('4 / 6')
    },
    SLOW,
  )

  it('stops an older search when a newer query starts', async () => {
    const source = {
      slideCount: 100,
      slideText: (i: number) => `slide ${i} needle`,
      slideNotes: () => '',
    }
    let cancelled = false
    const older = searchDeck(source, 'needle', () => cancelled)
    cancelled = true
    expect(await older).toBeNull()
    expect(await searchDeck(source, '', () => false)).toEqual({ hits: [], limited: false })
    const limited = await searchDeck(source, 'needle', () => false, 10)
    expect(limited).toMatchObject({ limited: true })
    expect(limited!.hits).toHaveLength(10)
  })
})

describe('show', () => {
  it(
    'skips hidden slides, ends with the end screen and closes on one more step',
    async () => {
      const bridge = makeBridge(toBase64(await sixBytes()))
      await openReader(bridge)
      await waitFor(ready)
      await click(testId('view-tool-pptxPresent'))
      const label = () =>
        testId('pptx-show')?.querySelector('.mobile-pptx-slide-picture')?.getAttribute('aria-label')
      expect(label()).toBe(t('readersPptxSlideA11y', { current: 1, total: 6 }))
      expect(spy.keepScreenOn.at(-1)).toBe(true)
      const stage = testId('pptx-show-stage')!
      await tap(stage, 300)
      // slide 2 is hidden
      expect(label()).toBe(t('readersPptxSlideA11y', { current: 3, total: 6 }))
      await swipe(stage, 300, 100)
      expect(label()).toBe(t('readersPptxSlideA11y', { current: 4, total: 6 }))
      await swipe(stage, 100, 300)
      expect(label()).toBe(t('readersPptxSlideA11y', { current: 3, total: 6 }))
      for (let i = 0; i < 4; i += 1) await tap(stage, 300)
      const end = testId('pptx-show-end')!
      expect(end.textContent).toContain(t('readersPptxShowEnd'))
      expect(end.textContent).toContain(t('readersPptxShowEndHint'))
      await tap(stage, 300)
      expect(testId('pptx-show')).toBeNull()
    },
    SLOW,
  )

  it(
    'closes with the close button and lands on the slide shown last',
    async () => {
      const bridge = makeBridge(toBase64(await sixBytes()))
      await openReader(bridge)
      await waitFor(ready)
      await click(testId('view-tool-pptxPresent'))
      await tap(testId('pptx-show-stage')!, 300)
      await tap(testId('pptx-show-stage')!, 300)
      await click(testId('pptx-show-close'))
      expect(testId('pptx-show')).toBeNull()
      expect(positionText()).toBe('4 / 6')
    },
    SLOW,
  )

  it(
    'does not open when every slide is hidden',
    async () => {
      const bytes = await buildDeck([
        { text: 'One', hidden: true },
        { text: 'Two', hidden: true },
      ])
      const bridge = makeBridge(toBase64(bytes))
      const view = await openReader(bridge)
      await waitFor(ready)
      await click(testId('view-tool-pptxPresent'))
      expect(testId('pptx-show')).toBeNull()
      expect(view.host.showToast).toHaveBeenCalledWith(t('readersPptxNoVisibleSlides'))
    },
    SLOW,
  )
})

describe('notes and the remembered place', () => {
  it(
    'shows the notes of the current slide and remembers the panel, keeping other settings',
    async () => {
      const bridge = makeBridge(toBase64(await sixBytes()))
      bridge.state.settings = {
        fontScale: 1.5,
        lineHeight: 1.8,
        theme: 'dark',
        layout: 'scroll',
        notesOpen: false,
      }
      await openReader(bridge)
      await waitFor(ready)
      expect(testId('pptx-notes-body')).toBeNull()
      await click(testId('pptx-notes-toggle'))
      expect(testId('pptx-notes-toggle')!.getAttribute('aria-expanded')).toBe('true')
      expect(testId('pptx-notes-body')!.textContent).toBe(t('readersPptxNotesEmpty'))
      for (let i = 0; i < 3; i += 1) await click(testId('pptx-next'))
      expect(testId('pptx-notes-body')!.textContent).toBe('Speaker bravo note')
      await waitFor(() => callsOf(bridge, 'mobile_readers_set_settings').length > 0)
      expect(bridge.state.settings).toEqual({
        fontScale: 1.5,
        lineHeight: 1.8,
        theme: 'dark',
        layout: 'scroll',
        notesOpen: true,
      })

      // the next deck opens with the panel open
      const again = makeBridge(toBase64(await sixBytes()))
      again.state.settings = bridge.state.settings
      await openReader(again)
      await waitFor(() => document.querySelectorAll('[data-testid="pptx-notes-body"]').length > 0)
    },
    SLOW,
  )

  it(
    'writes defaults with the panel state when no settings are stored',
    async () => {
      const bridge = makeBridge(toBase64(await sixBytes()))
      await openReader(bridge)
      await waitFor(ready)
      await click(testId('pptx-notes-toggle'))
      await waitFor(() => callsOf(bridge, 'mobile_readers_set_settings').length > 0)
      expect(bridge.state.settings).toEqual({
        fontScale: 1,
        lineHeight: null,
        theme: 'app',
        layout: 'paged',
        notesOpen: true,
      })
    },
    SLOW,
  )

  it(
    'saves the last slide after a pause and opens there next time',
    async () => {
      const bridge = makeBridge(toBase64(await sixBytes()))
      await openReader(bridge, { positionDelayMs: 400 })
      await waitFor(ready)
      await click(testId('pptx-next'))
      await click(testId('pptx-next'))
      // two quick turns are written once
      expect(callsOf(bridge, 'mobile_readers_set_position')).toHaveLength(0)
      await waitFor(() => callsOf(bridge, 'mobile_readers_set_position').length > 0)
      expect(callsOf(bridge, 'mobile_readers_set_position')).toHaveLength(1)
      expect(callsOf(bridge, 'mobile_readers_set_position')[0]!.args).toEqual({
        docKey: 'doc-key-1',
        position: { kind: 'pptx', slideIndex: 2, partPath: 'ppt/slides/slide3.xml' },
      })

      const again = makeBridge(toBase64(await sixBytes()))
      again.state.position = bridge.state.position
      await openReader(again)
      await waitFor(() => document.querySelectorAll('[data-testid="pptx-position"]').length > 1)
      const positions = [...document.querySelectorAll('[data-testid="pptx-position"]')]
      expect(positions.at(-1)!.textContent).toBe('3 / 6')
    },
    SLOW,
  )

  it(
    'opens at the first slide when the remembered one is not in the deck',
    async () => {
      const bridge = makeBridge(toBase64(await sixBytes()))
      bridge.state.position = { kind: 'pptx', slideIndex: 40, partPath: 'ppt/slides/slide41.xml' }
      await openReader(bridge)
      await waitFor(ready)
      expect(positionText()).toBe('1 / 6')
    },
    SLOW,
  )

  it(
    'writes a pending position and frees the deck on dispose',
    async () => {
      const bridge = makeBridge(toBase64(await sixBytes()))
      const view = await openReader(bridge, { positionDelayMs: 60_000 })
      await waitFor(ready)
      await click(testId('pptx-next'))
      expect(callsOf(bridge, 'mobile_readers_set_position')).toHaveLength(0)
      view.unmount()
      view.doc.dispose?.()
      await tick(20)
      expect(callsOf(bridge, 'mobile_readers_set_position')[0]!.args).toMatchObject({
        position: { kind: 'pptx', slideIndex: 1, partPath: 'ppt/slides/slide2.xml' },
      })
      expect(spy.disposed).toBe(1)
      // released when the view went, and nothing is built again
      expect([...new Set(spy.released)].sort()).toEqual([0, 1, 2])
    },
    SLOW,
  )
})
