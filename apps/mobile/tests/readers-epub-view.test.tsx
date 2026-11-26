// EPUB reading screen and editor kind (track T5, task RDR-T5): the opening order (open() only reads
// bytes, the engine opens the book after the switch, refusals toast and go back), turning pages and
// chapters (rtl reversed), contents, search, reading settings, the saved place (batched writes,
// restore), outside links (T6 opener present or not), keep-screen-on, share, dispose and fixed layout.
// Books are built in the test with jszip. jsdom draws no layout and does not load `srcdoc`, so each
// chapter frame gets the drawing copy written in and a fake column layout (three blocks a page at
// 100%, fewer at larger text) that answers `scrollWidth` and `getClientRects` like the PC preview.
import { describe, expect, it, beforeEach, afterEach, vi, type Mock } from 'vitest'

vi.hoisted(() => {
  const sample = new TextEncoder().encode('')
  globalThis.Uint8Array = sample.constructor as Uint8ArrayConstructor
  globalThis.ArrayBuffer = sample.buffer.constructor as ArrayBufferConstructor
})

const h = vi.hoisted(() => ({
  keep: [] as [unknown, boolean][],
  opener: null as null | ((client: unknown, url: string) => Promise<void>),
  failChapter: null as number | null,
}))

vi.mock('../src/renderer/editors/readers/shared/keepScreenOn', () => ({
  useReaderKeepScreenOn: (client: unknown, active: boolean) => {
    h.keep.push([client, active])
  },
}))

vi.mock('../src/renderer/editors/readers/shared/externalUrl', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/renderer/editors/readers/shared/externalUrl')>()
  return {
    ...actual,
    get readerExternalUrlOpener() {
      return h.opener
    },
  }
})

vi.mock('../src/renderer/editors/readers/epub/book', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/renderer/editors/readers/epub/book')>()
  return { ...actual, openBook: vi.fn(actual.openBook) }
})

vi.mock('../src/renderer/editors/readers/epub/chapterView', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/renderer/editors/readers/epub/chapterView')>()
  return {
    ...actual,
    buildChapterView: vi.fn(async (...args: Parameters<typeof actual.buildChapterView>) => {
      if (h.failChapter === args[1]) throw new Error('cannot draw')
      return actual.buildChapterView(...args)
    }),
  }
})

import JSZip from 'jszip'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReaderPosition, ReaderSettings } from '@genoffice/mobile-bridge/readers'
import type { ActiveDocState } from '@genoffice/mobile-bridge/session-state'
import {
  createMobileClient,
  type MobileClient,
  type MobileDocSession,
  type MobileTransport,
} from '@genoffice/mobile-bridge/transport'
import type {
  EditorDocument,
  EditorFrameProps,
  EditorHost,
} from '../src/renderer/editors/editorKind'
import { epubEditorKind } from '../src/renderer/editors/readers/epub/epubKind'
import { EPUB_READER_TUNING } from '../src/renderer/editors/readers/epub/epubReader'
import { openBook } from '../src/renderer/editors/readers/epub/book'
import {
  BLOCK_ATTR,
  VIEW_STYLE_ID,
  buildChapterView,
} from '../src/renderer/editors/readers/epub/chapterView'
import {
  classifyGesture,
  readingFlow,
  resolveReadingTheme,
  sideStep,
  snapReaderSettings,
  swipeStep,
  tapZone,
  turnWithin,
} from '../src/renderer/editors/readers/epub/epubView'
import { translateMobile } from '../src/renderer/i18n'
import type { MobileStringKey } from '../src/renderer/i18n/strings'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ---------------------------------------------------------------- books

const CONTAINER_XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n' +
  '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n' +
  '</container>\n'

const xhtml = (title: string, body: string): string =>
  '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n' +
  '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">\n' +
  `<head><title>${title}</title></head>\n<body>\n${body}\n</body>\n</html>\n`

const CHAPTER_ONE = xhtml(
  'One',
  [
    '<h1>Chapter One</h1>',
    '<p>Line one text. <a href="three.xhtml">to three</a> <a href="https://example.com/x">secure</a> ' +
      '<a href="http://example.com/y">plain</a> <a href="mailto:a@example.com">mail</a></p>',
    '<p>Line two text.<img src="../images/pic.png" alt="p"/></p>',
    '<p>Line three text.</p>',
    '<p>Line four text.</p>',
    '<p>Line five text.</p>',
    '<p>Line six text.</p>',
  ].join('\n'),
)
const CHAPTER_TWO = xhtml('Two', '<h1>Chapter Two</h1>\n<p>Not in the reading flow.</p>')
const CHAPTER_THREE = xhtml(
  'Three',
  '<h2>Chapter Three</h2>\n<p>Another paragraph with a paragraph word.</p>\n<p>More.</p>\n<p>End.</p>',
)
const NAV = xhtml(
  'Contents',
  '<nav epub:type="toc"><ol>' +
    '<li><a href="one.xhtml">Chapter One</a></li>' +
    '<li><a href="two.xhtml">Chapter Two</a></li>' +
    '<li><a href="notes.xhtml">Notes</a></li>' +
    '<li><a href="three.xhtml">Chapter Three</a></li>' +
    '</ol></nav>',
)

async function buildBook(options: { rtl?: boolean; fixedLayout?: boolean } = {}) {
  const opf =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" prefix="rendition: http://www.idpf.org/vocab/rendition/#">\n' +
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
    '<dc:identifier id="uid">urn:uuid:00000000-0000-0000-0000-000000000001</dc:identifier>\n' +
    '<dc:title>A Reader Book</dc:title>\n<dc:language>en</dc:language>\n' +
    '<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>\n' +
    (options.fixedLayout ? '<meta property="rendition:layout">pre-paginated</meta>\n' : '') +
    '</metadata>\n<manifest>\n' +
    '<item id="nav" href="text/nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n' +
    '<item id="one" href="text/one.xhtml" media-type="application/xhtml+xml"/>\n' +
    '<item id="two" href="text/two.xhtml" media-type="application/xhtml+xml"/>\n' +
    '<item id="three" href="text/three.xhtml" media-type="application/xhtml+xml"/>\n' +
    '<item id="notes" href="text/notes.xhtml" media-type="application/xhtml+xml"/>\n' +
    '<item id="pic" href="images/pic.png" media-type="image/png"/>\n' +
    '</manifest>\n' +
    `<spine${options.rtl ? ' page-progression-direction="rtl"' : ''}>\n` +
    '<itemref idref="one"/>\n<itemref idref="two" linear="no"/>\n<itemref idref="three"/>\n' +
    '</spine>\n</package>\n'
  const zip = new JSZip()
  const date = new Date('2026-01-01T00:00:00Z')
  zip.file('mimetype', 'application/epub+zip', { date, compression: 'STORE' })
  const files: Record<string, string | Uint8Array> = {
    'META-INF/container.xml': CONTAINER_XML,
    'OEBPS/content.opf': opf,
    'OEBPS/text/nav.xhtml': NAV,
    'OEBPS/text/one.xhtml': CHAPTER_ONE,
    'OEBPS/text/two.xhtml': CHAPTER_TWO,
    'OEBPS/text/three.xhtml': CHAPTER_THREE,
    'OEBPS/text/notes.xhtml': xhtml('Notes', '<p>Outside the spine.</p>'),
    'OEBPS/images/pic.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
  }
  for (const [name, data] of Object.entries(files)) zip.file(name, data, { date })
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

function toBase64(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text)
}

// ---------------------------------------------------------------- fake bridge and host

interface Store {
  positions: Map<string, ReaderPosition>
  settings: ReaderSettings | null
}

interface Env {
  client: MobileClient
  calls: { command: string; args: Record<string, unknown> | undefined }[]
  session: MobileDocSession
  host: EditorHost & { showToast: ReturnType<typeof vi.fn> }
}

function makeEnv(bytes: Uint8Array, store: Store, docKey = 'book-key'): Env {
  const calls: Env['calls'] = []
  const transport: MobileTransport = {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      calls.push({ command, args })
      switch (command) {
        case 'mobile_read_file_bytes':
          return { bytesBase64: toBase64(bytes) } as T
        case 'mobile_readers_get_state':
          return {
            position: store.positions.get(String(args?.docKey)) ?? null,
            settings: store.settings,
          } as T
        case 'mobile_readers_set_position':
          store.positions.set(String(args?.docKey), args?.position as ReaderPosition)
          return { ok: true } as T
        case 'mobile_readers_set_settings':
          store.settings = args?.settings as ReaderSettings
          return { ok: true } as T
        default:
          return { ok: true } as T
      }
    },
    async listen() {
      return () => {}
    },
  }
  const client = createMobileClient(transport)
  const session: MobileDocSession = {
    sessionId: 'session-1',
    docKey,
    name: 'book.epub',
    ext: 'epub',
    format: 'epub',
    writable: true,
    ephemeral: false,
  }
  const host = {
    client,
    markDirty: vi.fn(),
    updateSession: vi.fn(),
    setNotice: vi.fn(),
    showToast: vi.fn(),
    contentChanged: vi.fn(),
    refreshHome: vi.fn(async () => {}),
    openSession: vi.fn(async () => {}),
    translate: (key: MobileStringKey, params?: Record<string, string | number>) =>
      translateMobile('en', key, params),
    windowClass: () => 'compact' as const,
  }
  return { client, calls, session, host }
}

const en = (key: MobileStringKey, params?: Record<string, string | number>) =>
  translateMobile('en', key, params)

// ---------------------------------------------------------------- rendering

let roots: { root: Root; el: HTMLElement }[] = []
let blobs: string[]
let revoked: string[]
const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL
const originalWidth = window.innerWidth

beforeEach(() => {
  h.keep = []
  h.opener = null
  h.failChapter = null
  EPUB_READER_TUNING.positionWriteMs = 40
  blobs = []
  revoked = []
  let n = 0
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:test/${++n}`
    blobs.push(url)
    return url
  }) as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url)
  }) as typeof URL.revokeObjectURL
  // a phone: the view tools are the floating buttons
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
  vi.mocked(openBook).mockClear()
  vi.mocked(buildChapterView).mockClear()
})

afterEach(() => {
  for (const { root, el } of roots) {
    act(() => root.unmount())
    el.remove()
  }
  roots = []
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
  Reflect.deleteProperty(navigator, 'clipboard')
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor<T>(probe: () => T | null | undefined | false, ms = 4000): Promise<T> {
  const until = Date.now() + ms
  for (;;) {
    const value = probe()
    if (value) return value
    if (Date.now() > until) throw new Error('timed out waiting')
    await act(async () => {
      await sleep(10)
    })
  }
}

function makeFrame(env: Env): EditorFrameProps & { onBack: Mock<() => void> } {
  return {
    docTitle: env.session.name,
    docFormat: 'epub',
    saveState: 'saved',
    mode: 'view',
    canEdit: false,
    aiEnabled: false,
    aiPanelContent: null,
    onBack: vi.fn<() => void>(),
    onEnterEdit: vi.fn(),
    onDone: vi.fn(),
    onExitEdit: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onShare: vi.fn(),
    onOpenBackups: vi.fn(),
  }
}

function mount(doc: EditorDocument, frame: EditorFrameProps): { el: HTMLElement; root: Root } {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  const Workspace = doc.Workspace
  act(() =>
    root.render(<Workspace frame={frame} mode="view" canEdit={false} lang="en" theme="light" />),
  )
  const entry = { root, el }
  roots.push(entry)
  return entry
}

function unmount(entry: { el: HTMLElement; root: Root }): void {
  act(() => entry.root.unmount())
  entry.el.remove()
  roots = roots.filter((r) => r !== entry)
}

async function openDocument(env: Env) {
  const opened = await epubEditorKind.open({
    session: env.session,
    client: env.client,
    isUntitled: false,
  })
  const doc = opened.start(env.host)
  const frame = makeFrame(env)
  const view = mount(doc, frame)
  return { doc, frame, view }
}

/** Answers layout questions like the PC preview's columns: `perPage` blocks a page at 100%. */
function fakeLayout(doc: Document, rtl = false): void {
  const PAGE = 390
  const perPage = () => {
    const css = doc.getElementById(VIEW_STYLE_ID)?.textContent ?? ''
    const m = /font-size: (\d+)%/.exec(css)
    const scale = m ? Number(m[1]) / 100 : 1
    return Math.max(1, Math.floor(3 / scale + 1e-9))
  }
  const blocks = () => Array.from(doc.querySelectorAll(`[${BLOCK_ATTR}]`))
  const shift = () => {
    const m = /translate\((-?[\d.]+)px/.exec(doc.body.style.transform)
    return m ? Number(m[1]) : 0
  }
  Object.defineProperty(doc.documentElement, 'scrollWidth', {
    configurable: true,
    get: () => Math.ceil(blocks().length / perPage()) * PAGE,
  })
  for (const el of blocks()) {
    el.getClientRects = () => {
      const start = Math.floor(blocks().indexOf(el) / perPage()) * PAGE
      const right = rtl ? PAGE - start + shift() : start + shift() + 300
      const box = { left: right - 300, right, top: 10, bottom: 30, width: 300, height: 20 }
      return [box] as unknown as DOMRectList
    }
  }
}

const frameEl = (el: HTMLElement) =>
  el.querySelector<HTMLIFrameElement>('iframe[data-testid="epub-chapter-frame"]')

/** Writes the drawing copy into the (next) chapter frame and fires its load. */
async function loadFrame(
  el: HTMLElement,
  options: {
    previous?: HTMLIFrameElement | null
    rtl?: boolean
    before?: (doc: Document) => void
  } = {},
): Promise<Document> {
  const iframe = await waitFor(() => {
    const found = frameEl(el)
    return found && found !== options.previous ? found : null
  })
  const doc = iframe.contentDocument!
  if (!doc.getElementById(VIEW_STYLE_ID)) {
    const win = doc.defaultView as Window & typeof globalThis
    const parsed = new win.DOMParser().parseFromString(iframe.getAttribute('srcdoc')!, 'text/html')
    doc.replaceChild(doc.importNode(parsed.documentElement, true), doc.documentElement)
    fakeLayout(doc, options.rtl)
    options.before?.(doc)
  }
  await act(async () => {
    iframe.dispatchEvent(new Event('load'))
  })
  return doc
}

const where = (el: HTMLElement) => el.querySelector('[data-testid="epub-where"]')?.textContent
const chapterName = (el: HTMLElement) =>
  el.querySelector('[data-testid="epub-chapter-name"]')?.textContent

function press(doc: Document, type: 'mousedown' | 'mouseup', x: number) {
  const win = doc.defaultView as Window & typeof globalThis
  doc.body.dispatchEvent(
    new win.MouseEvent(type, { bubbles: true, clientX: x, clientY: 300, button: 0 }),
  )
}

function tap(doc: Document, x: number) {
  act(() => {
    press(doc, 'mousedown', x)
    press(doc, 'mouseup', x)
  })
}

function swipe(doc: Document, dx: number) {
  act(() => {
    press(doc, 'mousedown', 200)
    press(doc, 'mouseup', 200 + dx)
  })
}

function click(target: Element | null) {
  if (!target) throw new Error('nothing to click')
  act(() => {
    ;(target as HTMLElement).click()
  })
}

function clickLink(doc: Document, href: string) {
  const anchor = Array.from(doc.querySelectorAll('a')).find((a) => a.getAttribute('href') === href)
  if (!anchor) throw new Error(`no link ${href}`)
  const win = doc.defaultView as Window & typeof globalThis
  act(() => {
    anchor.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

const byTestId = (testId: string) => document.querySelector(`[data-testid="${testId}"]`)

const newStore = (): Store => ({ positions: new Map(), settings: null })

// ---------------------------------------------------------------- pure rules

describe('reading rules', () => {
  it('snaps stored settings to the PC steps and keeps notesOpen', () => {
    expect(
      snapReaderSettings({
        fontScale: 1.3,
        lineHeight: 1.7,
        theme: 'nope' as never,
        layout: 'scroll',
        notesOpen: true,
      }),
    ).toEqual({ fontScale: 1.25, lineHeight: 1.8, theme: 'app', layout: 'scroll', notesOpen: true })
    expect(snapReaderSettings(null)).toEqual({
      fontScale: 1,
      lineHeight: null,
      theme: 'app',
      layout: 'paged',
      notesOpen: false,
    })
    expect(snapReaderSettings({ fontScale: 9, lineHeight: 0.2 })).toMatchObject({
      fontScale: 3,
      lineHeight: 1.2,
    })
  })

  it('follows the app theme, and the system when the app does', () => {
    expect(resolveReadingTheme('app', 'dark', false)).toBe('dark')
    expect(resolveReadingTheme('app', 'light', true)).toBe('light')
    expect(resolveReadingTheme('app', 'system', true)).toBe('dark')
    expect(resolveReadingTheme('app', 'system', false)).toBe('light')
    expect(resolveReadingTheme('sepia', 'dark', true)).toBe('sepia')
  })

  it('turns forward on the right and with a swipe to the left, reversed for rtl and vertical books', () => {
    expect(sideStep('right', false)).toBe(1)
    expect(sideStep('left', false)).toBe(-1)
    expect(sideStep('right', true)).toBe(-1)
    expect(sideStep('left', true)).toBe(1)
    expect(swipeStep(-80, false)).toBe(1)
    expect(swipeStep(80, false)).toBe(-1)
    expect(swipeStep(-80, true)).toBe(-1)
    expect(swipeStep(80, true)).toBe(1)
    expect(readingFlow({ rtl: true, verticalWriting: false })).toEqual({
      axis: 'horizontal',
      rtl: true,
    })
    expect(readingFlow({ rtl: false, verticalWriting: true })).toEqual({
      axis: 'vertical',
      rtl: true,
    })
    expect(
      readingFlow(
        { rtl: false, verticalWriting: false },
        { writingMode: 'vertical-rl', direction: 'ltr' },
      ),
    ).toEqual({ axis: 'vertical', rtl: true })
  })

  it('tells taps, swipes and selections apart', () => {
    const base = {
      dx: 0,
      dy: 0,
      ms: 100,
      selectedBefore: false,
      selectedAfter: false,
      onLink: false,
    }
    expect(classifyGesture(base)).toBe('tap')
    expect(classifyGesture({ ...base, ms: 900 })).toBe('none')
    expect(classifyGesture({ ...base, dx: -90 })).toBe('swipe')
    expect(classifyGesture({ ...base, dx: -90, selectedAfter: true })).toBe('none')
    expect(classifyGesture({ ...base, selectedBefore: true })).toBe('none')
    expect(classifyGesture({ ...base, onLink: true })).toBe('none')
    expect(classifyGesture({ ...base, dx: 50, dy: 60 })).toBe('none')
    expect(tapZone(10, 390)).toBe('left')
    expect(tapZone(195, 390)).toBe('middle')
    expect(tapZone(380, 390)).toBe('right')
    expect(turnWithin(0, 3, 1)).toEqual({ kind: 'view', view: 1 })
    expect(turnWithin(2, 3, 1)).toEqual({ kind: 'chapter', dir: 1 })
    expect(turnWithin(0, 3, -1)).toEqual({ kind: 'chapter', dir: -1 })
  })
})

// ---------------------------------------------------------------- the kind

describe('the EPUB kind', () => {
  it('is a read-only kind without AI', () => {
    expect(epubEditorKind).toMatchObject({
      id: 'epub',
      formats: ['epub'],
      openExtensions: ['epub'],
      editable: false,
      hasAi: false,
      labelKey: 'readersEpubKindLabel',
    })
    expect(epubEditorKind.createFormats).toBeUndefined()
    expect(epubEditorKind.recoveryFormat('epub')).toBe('epub')
  })

  it('open() only reads the bytes; the engine opens the book after start', async () => {
    const env = makeEnv(await buildBook(), newStore())
    const opened = await epubEditorKind.open({
      session: env.session,
      client: env.client,
      isUntitled: false,
    })
    expect(env.calls.map((c) => c.command)).toEqual(['mobile_read_file_bytes'])
    expect(opened.noticeKey).toBeNull()
    expect(openBook).not.toHaveBeenCalled()
    opened.discard?.()

    const again = await epubEditorKind.open({
      session: env.session,
      client: env.client,
      isUntitled: false,
    })
    const doc = again.start(env.host)
    expect(doc.editable).toBe(false)
    expect(doc.aiAvailable).toBe(false)
    expect(doc.save).toBeUndefined()
    expect(doc.writeRecovery).toBeUndefined()
    expect(doc.createAiRun).toBeUndefined()
    const view = mount(doc, makeFrame(env))
    await loadFrame(view.el)
    expect(openBook).toHaveBeenCalledTimes(1)
    doc.dispose?.()
  })

  it.each([
    ['damaged', 'readersErrEpubDamaged'],
    ['too-large', 'readersErrEpubTooLarge'],
    ['not-epub', 'readersErrEpubNotEpub'],
    ['drm', 'readersErrEpubDrm'],
  ] as const)('a %s book toasts its reason and goes back home', async (reason, key) => {
    vi.mocked(openBook).mockResolvedValueOnce({ ok: false, reason })
    const env = makeEnv(await buildBook(), newStore())
    const { frame, doc } = await openDocument(env)
    await waitFor(() => frame.onBack.mock.calls.length > 0)
    expect(env.host.showToast).toHaveBeenCalledWith(en(key))
    expect(frame.onBack).toHaveBeenCalledTimes(1)
    doc.dispose?.()
  })

  it('shares the original file', async () => {
    const env = makeEnv(await buildBook(), newStore())
    const opened = await epubEditorKind.open({
      session: env.session,
      client: env.client,
      isUntitled: false,
    })
    const doc = opened.start(env.host)
    await doc.share({ session: env.session } as ActiveDocState)
    const share = env.calls.find((c) => c.command === 'mobile_share_file')
    expect(share?.args).toMatchObject({
      sessionId: 'session-1',
      suggestedName: 'book.epub',
      mode: 'original',
    })
    doc.dispose?.()
  })
})

// ---------------------------------------------------------------- reading

describe('reading a book', () => {
  it('opens at the first reading item and keeps the screen on while reading', async () => {
    const env = makeEnv(await buildBook(), newStore())
    const { view, doc } = await openDocument(env)
    await loadFrame(view.el)
    expect(chapterName(view.el)).toBe('Chapter One')
    expect(where(view.el)).toBe(en('readersPosition', { current: 1, total: 3 }))
    expect(view.el.querySelector('.mobile-header-title')?.textContent).toBe('A Reader Book')
    expect(h.keep.some(([c, active]) => c === env.client && active)).toBe(true)
    expect(h.keep[0]).toEqual([env.client, false])
    doc.dispose?.()
  })

  it('turns pages and chapters, skipping linear="no" items', async () => {
    const env = makeEnv(await buildBook(), newStore())
    const { view, doc } = await openDocument(env)
    let frameDoc = await loadFrame(view.el)
    swipe(frameDoc, -100)
    expect(where(view.el)).toBe(en('readersPosition', { current: 2, total: 3 }))
    click(byTestId('epub-turn-right'))
    expect(where(view.el)).toBe(en('readersPosition', { current: 3, total: 3 }))
    // tapping the middle hides only the position line
    tap(frameDoc, 195)
    expect(byTestId('epub-position-line')?.getAttribute('data-hidden')).toBe('true')
    tap(frameDoc, 195)
    expect(byTestId('epub-position-line')?.getAttribute('data-hidden')).toBeNull()

    let previous = frameEl(view.el)
    tap(frameDoc, 380)
    frameDoc = await loadFrame(view.el, { previous })
    expect(chapterName(view.el)).toBe('Chapter Three')
    expect(where(view.el)).toBe(en('readersPosition', { current: 1, total: 2 }))

    previous = frameEl(view.el)
    tap(frameDoc, 10)
    await loadFrame(view.el, { previous })
    expect(chapterName(view.el)).toBe('Chapter One')
    expect(where(view.el)).toBe(en('readersPosition', { current: 3, total: 3 }))
    // the chapter left behind released its URLs
    expect(revoked.length).toBeGreaterThan(0)
    doc.dispose?.()
  })

  it('turns the other way in a right-to-left book', async () => {
    const env = makeEnv(await buildBook({ rtl: true }), newStore())
    const { view, doc } = await openDocument(env)
    const frameDoc = await loadFrame(view.el, { rtl: true })
    expect(where(view.el)).toBe(en('readersPosition', { current: 1, total: 3 }))
    tap(frameDoc, 10)
    expect(where(view.el)).toBe(en('readersPosition', { current: 2, total: 3 }))
    swipe(frameDoc, 100)
    expect(where(view.el)).toBe(en('readersPosition', { current: 3, total: 3 }))
    tap(frameDoc, 380)
    expect(where(view.el)).toBe(en('readersPosition', { current: 2, total: 3 }))
    expect(byTestId('epub-turn-left')?.getAttribute('aria-label')).toBe(en('readersA11yNextPage'))
    doc.dispose?.()
  })

  it('goes to a contents entry; entries outside the spine are inert', async () => {
    const env = makeEnv(await buildBook(), newStore())
    const { view, doc } = await openDocument(env)
    await loadFrame(view.el)
    click(byTestId('view-tool-epubToc'))
    const entries = Array.from(document.querySelectorAll<HTMLButtonElement>('.epub-toc-entry'))
    expect(entries.map((e) => e.textContent)).toEqual([
      'Chapter One',
      'Chapter Two',
      'Notes',
      'Chapter Three',
    ])
    expect(entries[0]!.getAttribute('aria-current')).toBe('true')
    expect(entries[2]!.disabled).toBe(true)
    const previous = frameEl(view.el)
    click(entries[3]!)
    expect(byTestId('epub-toc-sheet')).toBeNull()
    await loadFrame(view.el, { previous })
    expect(chapterName(view.el)).toBe('Chapter Three')
    doc.dispose?.()
  })

  it('finds text in the book and marks the hit in its chapter', async () => {
    const env = makeEnv(await buildBook(), newStore())
    const { view, doc } = await openDocument(env)
    await loadFrame(view.el)
    click(byTestId('view-tool-epubSearch'))
    const input = byTestId('epub-search-input') as HTMLInputElement
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setValue.call(input, 'paragraph word')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const hit = await waitFor(() => byTestId('epub-search-hit'))
    expect(byTestId('epub-search-status')?.textContent).toBe(en('readersSearchCount', { count: 1 }))
    expect(hit.textContent).toContain('Chapter Three')
    const previous = frameEl(view.el)
    click(hit)
    let marked: Range | null = null
    await loadFrame(view.el, {
      previous,
      before: (frameDoc) => {
        const win = frameDoc.defaultView as unknown as Record<string, unknown>
        win.Highlight = class {
          constructor(range: Range) {
            marked = range
          }
        }
        win.CSS = { highlights: new Map() }
      },
    })
    expect(chapterName(view.el)).toBe('Chapter Three')
    expect(String(marked)).toBe('paragraph word')
    doc.dispose?.()
  })

  it('keeps the block on screen when the text size changes, and saves the settings', async () => {
    const store = newStore()
    const env = makeEnv(await buildBook(), store)
    const { view, doc } = await openDocument(env)
    const frameDoc = await loadFrame(view.el)
    tap(frameDoc, 380)
    tap(frameDoc, 380)
    expect(where(view.el)).toBe(en('readersPosition', { current: 3, total: 3 }))
    click(byTestId('view-tool-epubSettings'))
    click(byTestId('epub-font-larger'))
    // 110%: two blocks a page, the seventh block is on the fourth page
    expect(where(view.el)).toBe(en('readersPosition', { current: 4, total: 4 }))
    expect(byTestId('epub-font-value')?.textContent).toBe(
      en('readersEpubFontPercent', { percent: 110 }),
    )
    await waitFor(() => store.settings)
    expect(store.settings).toEqual({
      fontScale: 1.1,
      lineHeight: null,
      theme: 'app',
      layout: 'paged',
      notesOpen: false,
    })
    doc.dispose?.()
  })

  it('snaps stored settings and applies a background at once', async () => {
    const store = newStore()
    store.settings = {
      fontScale: 1.3,
      lineHeight: 1.7,
      theme: 'light',
      layout: 'paged',
      notesOpen: true,
    }
    const env = makeEnv(await buildBook(), store)
    const { view, doc } = await openDocument(env)
    await loadFrame(view.el)
    click(byTestId('view-tool-epubSettings'))
    expect(byTestId('epub-font-value')?.textContent).toBe(
      en('readersEpubFontPercent', { percent: 125 }),
    )
    const checked = (group: string) =>
      byTestId(group)?.querySelector('[aria-checked="true"]')?.textContent
    expect(checked('epub-line-height')).toBe('1.8')
    const sepia = Array.from(byTestId('epub-theme')!.querySelectorAll('button')).find(
      (b) => b.textContent === en('readersEpubThemeSepia'),
    )
    click(sepia!)
    expect(byTestId('epub-reader')?.getAttribute('data-theme')).toBe('sepia')
    await waitFor(() => store.settings?.theme === 'sepia')
    expect(store.settings).toEqual({
      fontScale: 1.25,
      lineHeight: 1.8,
      theme: 'sepia',
      layout: 'paged',
      notesOpen: true,
    })
    doc.dispose?.()
  })

  it('scrolls in the scroll mode and moves on when pushed past the chapter end', async () => {
    const env = makeEnv(await buildBook(), newStore())
    const { view, doc } = await openDocument(env)
    const frameDoc = await loadFrame(view.el)
    click(byTestId('view-tool-epubSettings'))
    const scrolled = Array.from(byTestId('epub-layout')!.querySelectorAll('button')).find(
      (b) => b.textContent === en('readersEpubFlowScrolled'),
    )
    click(scrolled!)
    click(document.querySelector('[data-testid="epub-settings-sheet"] .mobile-icon-btn'))
    expect(byTestId('epub-reader')?.getAttribute('data-mode')).toBe('scroll')
    // jsdom lays nothing out: the chapter is at its start and its end at once
    expect(where(view.el)).toBe(en('readersEpubChapterProgress', { percent: 100 }))
    expect(frameDoc.getElementById(VIEW_STYLE_ID)?.textContent).not.toContain('column-width')
    // a tap at the edge does not turn in this mode
    tap(frameDoc, 380)
    expect(chapterName(view.el)).toBe('Chapter One')
    const previous = frameEl(view.el)
    act(() => {
      const win = frameDoc.defaultView as Window & typeof globalThis
      frameDoc.body.dispatchEvent(
        new win.MouseEvent('mousedown', { bubbles: true, clientX: 200, clientY: 400, button: 0 }),
      )
      frameDoc.body.dispatchEvent(
        new win.MouseEvent('mouseup', { bubbles: true, clientX: 200, clientY: 250, button: 0 }),
      )
    })
    await loadFrame(view.el, { previous })
    expect(chapterName(view.el)).toBe('Chapter Three')
    doc.dispose?.()
  })

  it('writes the place in one batch and opens there again', async () => {
    const store = newStore()
    const env = makeEnv(await buildBook(), store)
    const first = await openDocument(env)
    const frameDoc = await loadFrame(first.view.el)
    tap(frameDoc, 380)
    tap(frameDoc, 380)
    await act(async () => {
      await sleep(120)
    })
    const writes = env.calls.filter((c) => c.command === 'mobile_readers_set_position')
    expect(writes).toHaveLength(1)
    const blockIds = Array.from(frameDoc.querySelectorAll(`[${BLOCK_ATTR}]`)).map((el) =>
      el.getAttribute(BLOCK_ATTR),
    )
    expect(writes[0]!.args).toEqual({
      docKey: 'book-key',
      position: { kind: 'epub', spineIndex: 0, href: 'OEBPS/text/one.xhtml', blockId: blockIds[6] },
    })
    first.doc.dispose?.()
    unmount(first.view)

    const env2 = makeEnv(await buildBook(), store)
    const second = await openDocument(env2)
    await loadFrame(second.view.el)
    expect(where(second.view.el)).toBe(en('readersPosition', { current: 3, total: 3 }))
    second.doc.dispose?.()
  })

  it('shows the same place after the screen unmounts and mounts again', async () => {
    const env = makeEnv(await buildBook(), newStore())
    const { view, doc, frame } = await openDocument(env)
    const frameDoc = await loadFrame(view.el)
    tap(frameDoc, 380)
    expect(where(view.el)).toBe(en('readersPosition', { current: 2, total: 3 }))
    const built = vi.mocked(buildChapterView).mock.calls.length
    unmount(view)
    const again = mount(doc, frame)
    await loadFrame(again.el)
    expect(where(again.el)).toBe(en('readersPosition', { current: 2, total: 3 }))
    // the chapter kept by the document is drawn again, not built again
    expect(vi.mocked(buildChapterView).mock.calls.length).toBe(built)
    doc.dispose?.()
  })

  it('revokes every URL on dispose', async () => {
    const env = makeEnv(await buildBook(), newStore())
    const { view, doc } = await openDocument(env)
    await loadFrame(view.el)
    expect(blobs.length).toBeGreaterThan(0)
    doc.dispose?.()
    expect(blobs.every((url) => revoked.includes(url))).toBe(true)
  })

  it('shows a chapter that cannot be drawn in place, with the next chapter', async () => {
    h.failChapter = 0
    const env = makeEnv(await buildBook(), newStore())
    const { view, doc } = await openDocument(env)
    await waitFor(() => byTestId('epub-chapter-failed'))
    expect(byTestId('epub-chapter-failed')?.textContent).toContain(en('readersEpubChapterFailed'))
    click(byTestId('epub-next-chapter'))
    await loadFrame(view.el)
    expect(chapterName(view.el)).toBe('Chapter Three')
    doc.dispose?.()
  })

  it('lets go of the chapter before when the next one cannot be drawn', async () => {
    const env = makeEnv(await buildBook(), newStore())
    const { view, doc } = await openDocument(env)
    const frameDoc = await loadFrame(view.el)
    const before = [...blobs]
    expect(before.length).toBeGreaterThan(0)
    h.failChapter = 2
    clickLink(frameDoc, 'three.xhtml')
    await waitFor(() => byTestId('epub-chapter-failed'))
    expect(before.every((url) => revoked.includes(url))).toBe(true)
    doc.dispose?.()
  })

  it('treats any element with an href as a link (MathML links never navigate the frame)', async () => {
    const env = makeEnv(await buildBook(), newStore())
    const { view, doc } = await openDocument(env)
    const frameDoc = await loadFrame(view.el)
    const math = frameDoc.createElementNS('http://www.w3.org/1998/Math/MathML', 'mi')
    math.setAttribute('href', 'https://remote.example/')
    frameDoc.body.append(math)
    const win = frameDoc.defaultView as Window & typeof globalThis
    const event = new win.MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => {
      math.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
    doc.dispose?.()
  })

  it('turns off text size, line height and mode for a fixed-layout book', async () => {
    const env = makeEnv(await buildBook({ fixedLayout: true }), newStore())
    const { view, doc } = await openDocument(env)
    await loadFrame(view.el)
    expect(frameEl(view.el)?.getAttribute('data-fixed')).toBe('true')
    click(byTestId('view-tool-epubSettings'))
    expect(byTestId('epub-fixed-note')?.textContent).toBe(en('readersEpubFixedLayoutNote'))
    expect((byTestId('epub-font-larger') as HTMLButtonElement).disabled).toBe(true)
    expect((byTestId('epub-font-smaller') as HTMLButtonElement).disabled).toBe(true)
    const disabled = (group: string) =>
      Array.from(byTestId(group)!.querySelectorAll('button')).every((b) => b.disabled)
    expect(disabled('epub-line-height')).toBe(true)
    expect(disabled('epub-layout')).toBe(true)
    expect(
      Array.from(byTestId('epub-theme')!.querySelectorAll('button')).some((b) => b.disabled),
    ).toBe(false)
    doc.dispose?.()
  })
})

// ---------------------------------------------------------------- links

describe('links in a chapter', () => {
  it('goes to a chapter of the book', async () => {
    const env = makeEnv(await buildBook(), newStore())
    const { view, doc } = await openDocument(env)
    const frameDoc = await loadFrame(view.el)
    const previous = frameEl(view.el)
    clickLink(frameDoc, 'three.xhtml')
    await loadFrame(view.el, { previous })
    expect(chapterName(view.el)).toBe('Chapter Three')
    doc.dispose?.()
  })

  it('offers only the copy while the system opener is missing', async () => {
    const env = makeEnv(await buildBook(), newStore())
    const { view, doc } = await openDocument(env)
    const frameDoc = await loadFrame(view.el)
    clickLink(frameDoc, 'https://example.com/x')
    expect(byTestId('epub-link-url')?.textContent).toBe('https://example.com/x')
    expect(byTestId('epub-link-copy')).not.toBeNull()
    expect(byTestId('epub-link-open')).toBeNull()

    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    click(byTestId('epub-link-copy'))
    await waitFor(() => env.host.showToast.mock.calls.length > 0)
    expect(writeText).toHaveBeenCalledWith('https://example.com/x')
    expect(env.host.showToast).toHaveBeenCalledWith(en('readersLinkCopied'))
    doc.dispose?.()
  })

  it('opens https addresses with the opener, never http or mailto', async () => {
    const opener = vi.fn(async () => {})
    h.opener = opener
    const env = makeEnv(await buildBook(), newStore())
    const { view, doc } = await openDocument(env)
    const frameDoc = await loadFrame(view.el)

    clickLink(frameDoc, 'http://example.com/y')
    expect(byTestId('epub-link-url')?.textContent).toBe('http://example.com/y')
    expect(byTestId('epub-link-open')).toBeNull()
    click(document.querySelector('[data-testid="epub-link-sheet"] .mobile-icon-btn'))
    expect(byTestId('epub-link-sheet')).toBeNull()

    clickLink(frameDoc, 'mailto:a@example.com')
    expect(byTestId('epub-link-open')).toBeNull()
    expect(byTestId('epub-link-copy')).not.toBeNull()
    click(document.querySelector('[data-testid="epub-link-sheet"] .mobile-icon-btn'))

    clickLink(frameDoc, 'https://example.com/x')
    click(byTestId('epub-link-open'))
    await waitFor(() => byTestId('epub-link-sheet') === null)
    expect(opener).toHaveBeenCalledWith(env.client, 'https://example.com/x')
    doc.dispose?.()
  })

  it('falls back to the copy when opening is refused', async () => {
    h.opener = vi.fn(async () => {
      throw new Error('refused')
    })
    const env = makeEnv(await buildBook(), newStore())
    const { view, doc } = await openDocument(env)
    const frameDoc = await loadFrame(view.el)
    clickLink(frameDoc, 'https://example.com/x')
    click(byTestId('epub-link-open'))
    await waitFor(() => byTestId('epub-link-open') === null)
    expect(byTestId('epub-link-copy')).not.toBeNull()
    expect(env.host.showToast).not.toHaveBeenCalledWith(en('readersLinkCopyFailed'))
    doc.dispose?.()
  })
})
