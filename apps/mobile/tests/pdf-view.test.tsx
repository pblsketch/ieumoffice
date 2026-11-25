// Mobile PDF viewer (track T2, PDF-T3): registration, the open rules shared with the
// PC editor (password, permissions, damaged files), search, outline, links, and the
// render window that releases far-away page bitmaps.
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { MobileClient, MobileDocSession } from '@genoffice/mobile-bridge/transport'
import { encryptDocument } from '../../pdf/src/main/pdf-crypt'
import { pdfDocTypeIcons } from '../src/renderer/components/icons/pdf'
import { findEditorKind, openableExtensions } from '../src/renderer/editors/registry'
import type { EditorHost } from '../src/renderer/editors/editorKind'
import { pdfEditorKinds } from '../src/renderer/editors/pdf'
import { createPdfEditorKind, pdfEditorKind } from '../src/renderer/editors/pdf/kind'
import {
  PdfOpenCancelledError,
  type PdfPasswordPrompt,
} from '../src/renderer/editors/pdf/openTypes'
import {
  computePageLayout,
  fitWidthScale,
  renderWindow,
  visiblePageRange,
} from '../src/renderer/editors/pdf/view/layout'
import type { PdfOpenedDocument } from '../src/renderer/editors/pdf/view/model'
import { openPdfModel } from '../src/renderer/editors/pdf/view/openPdf'
import {
  flattenOutline,
  loadPdfOutline,
  resolveDestPageIndex,
} from '../src/renderer/editors/pdf/view/outline'
import { parseGoToPage } from '../src/renderer/editors/pdf/view/PdfGoToPageSheet'
import { pageLinksOf } from '../src/renderer/editors/pdf/view/PdfLinkLayer'
import { createSheetPasswordPrompt } from '../src/renderer/editors/pdf/view/PdfPasswordSheet'
import { hitsByPage, searchPdf } from '../src/renderer/editors/pdf/view/PdfSearchBar'
import {
  INITIAL_PDF_VIEW_STATE,
  PdfViewer,
  type PdfViewerHandle,
} from '../src/renderer/editors/pdf/view/PdfViewer'
import { pdfReadOnlyReason } from '../src/renderer/editors/pdf/view/readOnly'
import { pcUnlockProbe } from '../src/renderer/editors/pdf/view/pcEngineHooks'
import { MobileLocaleProvider } from '../src/renderer/i18n'

// ── fixtures ────────────────────────────────────────────────────────────────

async function textPdf(pages: string[]): Promise<PDFDocument> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const text of pages) {
    doc.addPage([400, 500]).drawText(text, { x: 40, y: 400, size: 14, font })
  }
  return doc
}

async function encryptedPdf(modifying: boolean): Promise<Uint8Array> {
  const doc = await textPdf(['Secret page'])
  encryptDocument(doc, {
    userPassword: 'user1',
    ownerPassword: 'owner1',
    permissions: { printing: true, modifying, annotating: modifying, copying: true },
  })
  return doc.save({ useObjectStreams: false })
}

/** Six pages saved with plain object headers; one page object zeroed like a damaged block. */
async function damagedPdf(): Promise<Uint8Array> {
  const doc = await textPdf(['Page 1', 'Page 2', 'Page 3', 'Page 4', 'Page 5', 'Page 6'])
  const lost = doc.getPages()[2]!.ref.objectNumber
  const bytes = await doc.save({ useObjectStreams: false })
  const text = Buffer.from(bytes).toString('latin1')
  const start = text.search(new RegExp(`(^|[\\r\\n])${lost} 0 obj`))
  const end = text.indexOf('endobj', start) + 'endobj'.length
  const out = bytes.slice()
  out.fill(0, start + 1, end)
  return out
}

/** Three pages; outline: Chapter A (→1) › Section A.1 (→2), Chapter B (→3). */
async function outlinedPdf(): Promise<Uint8Array> {
  const doc = await textPdf(['One', 'Two', 'Three'])
  const ctx = doc.context
  const dest = (i: number) => ctx.obj([doc.getPage(i).ref, PDFName.of('XYZ'), null, null, null])
  const outlines = ctx.nextRef()
  const a = ctx.nextRef()
  const a1 = ctx.nextRef()
  const b = ctx.nextRef()
  ctx.assign(
    a,
    ctx.obj({
      Title: PDFString.of('Chapter A'),
      Parent: outlines,
      Next: b,
      First: a1,
      Last: a1,
      Count: 1,
      Dest: dest(0),
    }),
  )
  ctx.assign(a1, ctx.obj({ Title: PDFString.of('Section A.1'), Parent: a, Dest: dest(1) }))
  ctx.assign(
    b,
    ctx.obj({ Title: PDFString.of('Chapter B'), Parent: outlines, Prev: a, Dest: dest(2) }),
  )
  ctx.assign(outlines, ctx.obj({ Type: 'Outlines', First: a, Last: b, Count: 3 }))
  doc.catalog.set(PDFName.of('Outlines'), outlines)
  return doc.save({ useObjectStreams: false })
}

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')

function session(over: Partial<MobileDocSession> = {}): MobileDocSession {
  return {
    sessionId: 's1',
    docKey: 'k1',
    name: 'sample.pdf',
    ext: 'pdf',
    format: 'pdf',
    writable: true,
    ephemeral: false,
    ...over,
  }
}

function fakeClient(bytes: Uint8Array | null): MobileClient & { shared: unknown[] } {
  const shared: unknown[] = []
  return {
    shared,
    getAppPrefs: async () => ({
      lang: 'ko',
      theme: 'system',
      hwpDefaultFormat: 'hwp',
      aiEnabled: false,
    }),
    readFileBytes: async () => ({ bytesBase64: bytes ? toBase64(bytes) : '' }),
    shareFile: async (params: unknown) => {
      shared.push(params)
      return { ok: true }
    },
  } as unknown as MobileClient & { shared: unknown[] }
}

/** Answers the password prompts in order and records what was asked. */
function scriptedPrompt(answers: (string | null)[]) {
  const asked: { fileName: string; wrong: boolean }[] = []
  const prompt: PdfPasswordPrompt = async (request) => {
    asked.push({ ...request })
    return answers.shift() ?? null
  }
  return { asked, askPassword: () => prompt }
}

const opened: PdfOpenedDocument[] = []
async function openModel(
  bytes: Uint8Array,
  over: Partial<Parameters<typeof openPdfModel>[0]> = {},
): Promise<PdfOpenedDocument> {
  const model = await openPdfModel({
    bytes,
    fileName: 'sample.pdf',
    writable: true,
    isUntitled: false,
    fromRecovery: false,
    askPassword: async () => null,
    unlockProbe: pcUnlockProbe,
    ...over,
  })
  opened.push(model)
  return model
}

const roots: { root: Root; host: HTMLElement }[] = []
function mount(node: React.ReactNode): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push({ root, host })
  act(() => {
    root.render(<MobileLocaleProvider lang="ko">{node}</MobileLocaleProvider>)
  })
  return host
}

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  for (const { root, host } of roots.splice(0)) {
    act(() => root.unmount())
    host.remove()
  }
  for (const model of opened.splice(0)) await model.destroy().catch(() => {})
  vi.restoreAllMocks()
})

// ── registration ────────────────────────────────────────────────────────────

describe('PDF kind registration', () => {
  it('registers one PDF kind that the open gate and the picker offer', () => {
    expect(pdfEditorKinds).toEqual([pdfEditorKind])
    expect(findEditorKind('pdf')).toBe(pdfEditorKind)
    expect(openableExtensions()).toContain('pdf')
    expect(pdfEditorKind.id).toBe('pdf')
    expect(pdfEditorKind.formats).toEqual(['pdf'])
    expect(pdfEditorKind.openExtensions).toEqual(['pdf'])
    expect(pdfEditorKind.createFormats).toEqual(['pdf'])
    expect(pdfEditorKind.editable).toBe(true)
    expect(pdfEditorKind.hasAi).toBe(true)
    expect(pdfEditorKind.recoveryFormat('pdf')).toBe('pdf')
    expect(pdfEditorKind.labelKey).toBe('pdfViewEditorName')
  })

  it('has a file-type picture', () => {
    expect(typeof pdfDocTypeIcons.pdf).toBe('string')
    // the bundler inlines the small desktop picture as a data URL (or links the .svg)
    expect(pdfDocTypeIcons.pdf).toMatch(/^data:image\/svg\+xml|file-pdf\.svg/)
  })
})

// ── open rules ──────────────────────────────────────────────────────────────

describe('opening an encrypted PDF', () => {
  it('asks again after a wrong password and does not open when cancelled', async () => {
    const bytes = await encryptedPdf(false)
    const { asked, askPassword } = scriptedPrompt(['bad', null])
    const kind = createPdfEditorKind({ askPassword })
    const attempt = kind.open({ session: session(), client: fakeClient(bytes), isUntitled: false })
    await expect(attempt).rejects.toBeInstanceOf(PdfOpenCancelledError)
    await attempt.catch((err: PdfOpenCancelledError) => {
      expect(err.code).toBe('USER_CANCELLED')
      // the app shows an open error's message as a banner; a cancel shows none
      expect(err.message).toBe('')
    })
    expect(asked).toEqual([
      { fileName: 'sample.pdf', wrong: false },
      { fileName: 'sample.pdf', wrong: true },
    ])
    // two key derivations and a decrypt on a slow disk under a full run can exceed 5 s
  }, 60_000)

  it('opens view-only with the user password when /P forbids modifying', async () => {
    const bytes = await encryptedPdf(false)
    const { askPassword } = scriptedPrompt(['user1'])
    const model = await openModel(bytes, { askPassword: askPassword() })
    expect(model.encrypted).toBe(true)
    expect(model.sessionUnlocked).toBe(true)
    expect(model.lock).toEqual({ unlockedAsOwner: false, modifying: false })
    expect(model.readOnlyReason).toBe('encrypted')
    // kept in memory for the save path, never written anywhere here
    expect(model.password).toBe('user1')
    expect(model.originalBytes).toBe(bytes)
  })

  it('opens editable with the owner password, or a user password /P lets modify', async () => {
    const owner = await openModel(await encryptedPdf(false), {
      askPassword: scriptedPrompt(['owner1']).askPassword(),
    })
    expect(owner.lock).toEqual({ unlockedAsOwner: true, modifying: false })
    expect(owner.readOnlyReason).toBeNull()

    const user = await openModel(await encryptedPdf(true), {
      askPassword: scriptedPrompt(['user1']).askPassword(),
    })
    expect(user.lock).toEqual({ unlockedAsOwner: false, modifying: true })
    expect(user.readOnlyReason).toBeNull()
  })

  it('stays view-only when the app handler cannot confirm the password', async () => {
    const model = await openModel(await encryptedPdf(true), {
      askPassword: scriptedPrompt(['user1']).askPassword(),
      unlockProbe: async () => ({ ok: false, reason: 'unavailable' }),
    })
    expect(model.sessionUnlocked).toBe(false)
    expect(model.readOnlyReason).toBe('encrypted')
  })

  it('tells App the protected document is not editable', async () => {
    const kind = createPdfEditorKind({ askPassword: scriptedPrompt(['user1']).askPassword })
    const result = await kind.open({
      session: session(),
      client: fakeClient(await encryptedPdf(false)),
      isUntitled: false,
    })
    expect(result.encrypted).toBe(true)
  })
})

describe('read-only judgment (PC rule)', () => {
  const base = {
    damaged: false,
    encrypted: false,
    sessionUnlocked: false,
    lock: null,
    writable: true,
    isUntitled: false,
  }
  it('follows damage, the lock, and writability', () => {
    expect(pdfReadOnlyReason(base)).toBeNull()
    expect(pdfReadOnlyReason({ ...base, damaged: true, encrypted: true })).toBe('damaged')
    expect(pdfReadOnlyReason({ ...base, encrypted: true })).toBe('encrypted')
    expect(
      pdfReadOnlyReason({
        ...base,
        encrypted: true,
        sessionUnlocked: true,
        lock: { unlockedAsOwner: false, modifying: false },
      }),
    ).toBe('encrypted')
    expect(
      pdfReadOnlyReason({
        ...base,
        encrypted: true,
        sessionUnlocked: true,
        lock: { unlockedAsOwner: true, modifying: false },
      }),
    ).toBeNull()
    expect(pdfReadOnlyReason({ ...base, writable: false })).toBe('notWritable')
    expect(pdfReadOnlyReason({ ...base, writable: false, isUntitled: true })).toBeNull()
  })
})

describe('opening a damaged PDF', () => {
  it('shows lost pages blank from patched bytes and opens view-only', async () => {
    const bytes = await damagedPdf()
    const model = await openModel(bytes)
    expect(model.damaged).toBe(true)
    expect(model.readOnlyReason).toBe('damaged')
    expect(model.pages).toHaveLength(6)
    expect(model.failedPages.size).toBe(0)
    // the patch lives in memory: the document keeps the bytes as read
    expect(model.originalBytes).toBe(bytes)
    const page6 = await model.proxy.getPage(6)
    const text = await page6.getTextContent()
    expect(text.items.map((it) => ('str' in it ? it.str : '')).join('')).toBe('Page 6')
  })

  it('rejects bytes that are not a PDF with a readable message', async () => {
    const kind = createPdfEditorKind()
    await expect(
      kind.open({
        session: session(),
        client: fakeClient(new TextEncoder().encode('not a pdf at all')),
        isUntitled: false,
      }),
    ).rejects.toThrow('이 PDF를 열 수 없습니다')
  })
})

describe('new and recovered PDFs', () => {
  it('starts an untitled PDF from the PC blank page, editable in memory', async () => {
    const kind = createPdfEditorKind()
    const result = await kind.open({
      session: session({ writable: false }),
      client: fakeClient(null),
      isUntitled: true,
    })
    expect(result.encrypted).toBe(false)
    expect(result.noticeKey).toBeNull()
  })

  it('shares the file itself, or the bytes of a document with no file yet', async () => {
    const bytes = (await (await textPdf(['x'])).save()) as Uint8Array
    const client = fakeClient(bytes)
    const host = { client } as unknown as EditorHost
    const kind = createPdfEditorKind()
    const fromFile = await kind.open({ session: session(), client, isUntitled: false })
    await fromFile.start(host).share({ session: session() } as never)
    const recovered = await kind.open({
      session: session({ sessionId: 's2' }),
      client,
      isUntitled: true,
      recoveryBytesBase64: toBase64(bytes),
    })
    await recovered.start(host).share({ session: session({ sessionId: 's2' }) } as never)
    expect(client.shared).toEqual([
      { sessionId: 's1', suggestedName: 'sample.pdf', mode: 'original' },
      {
        sessionId: 's2',
        suggestedName: 'sample.pdf',
        mode: 'edited',
        bytesBase64: toBase64(bytes),
      },
    ])
  })
})

// ── search, outline, links ──────────────────────────────────────────────────

describe('search (PC search.ts rules)', () => {
  it('finds every hit across pages, case-folded, and marks the active one', async () => {
    const doc = await textPdf(['Hello Apple', 'apple pie and APPLE'])
    const model = await openModel(await doc.save())
    const matches = await searchPdf(model, 'aPPle')
    expect(matches.map((m) => m.pageIndex)).toEqual([0, 1, 1])
    expect(await searchPdf(model, 'banana')).toEqual([])
    const hits = hitsByPage(matches, 1)
    expect(hits.get(0)!.rects).toHaveLength(1)
    expect(hits.get(0)!.activeRects).toHaveLength(0)
    expect(hits.get(1)!.activeRects).toHaveLength(1)
    expect(hits.get(1)!.rects).toHaveLength(1)
  })
})

describe('outline', () => {
  it('lists the bookmark tree with depths and jumps to its pages', async () => {
    const model = await openModel(await outlinedPdf())
    const rows = await loadPdfOutline(model.proxy)
    expect(rows.map((r) => [r.title, r.depth])).toEqual([
      ['Chapter A', 0],
      ['Section A.1', 1],
      ['Chapter B', 0],
    ])
    const pages = await Promise.all(rows.map((r) => resolveDestPageIndex(model.proxy, r.dest)))
    expect(pages).toEqual([0, 1, 2])
  })

  it('follows only http, https and mailto addresses', () => {
    const rows = flattenOutline([
      { title: 'web', url: 'https://example.com/a' },
      { title: 'mail', url: 'mailto:a@example.com' },
      { title: 'script', url: 'javascript:alert(1)' },
      { title: 'file', url: 'file:///etc/passwd', items: [{ title: 'child' }] },
    ])
    expect(rows.map((r) => [r.title, r.url, r.depth])).toEqual([
      ['web', 'https://example.com/a', 0],
      ['mail', 'mailto:a@example.com', 0],
      ['script', null, 0],
      ['file', null, 0],
      ['child', null, 1],
    ])
  })

  it('keeps page links to safe addresses and document destinations', () => {
    const links = pageLinksOf([
      { subtype: 'Link', rect: [0, 0, 10, 10], url: 'https://example.com' },
      { subtype: 'Link', rect: [0, 0, 10, 10], url: 'javascript:alert(1)' },
      { subtype: 'Link', rect: [0, 0, 10, 10], dest: 'chapter2' },
      { subtype: 'Text', rect: [0, 0, 10, 10], url: 'https://example.com' },
    ])
    expect(links).toEqual([
      { rect: [0, 0, 10, 10], url: 'https://example.com', dest: null },
      { rect: [0, 0, 10, 10], url: null, dest: 'chapter2' },
    ])
  })

  it('accepts page numbers within the document only', () => {
    expect(parseGoToPage('3', 5)).toBe(2)
    expect(parseGoToPage(' 5 ', 5)).toBe(4)
    expect(parseGoToPage('0', 5)).toBeNull()
    expect(parseGoToPage('6', 5)).toBeNull()
    expect(parseGoToPage('2a', 5)).toBeNull()
  })
})

// ── password sheet ──────────────────────────────────────────────────────────

describe('password sheet', () => {
  it('answers with the typed password, says when the last one was wrong, and cancels', async () => {
    const prompt = createSheetPasswordPrompt('ko')
    let answer!: Promise<string | null>
    act(() => {
      answer = prompt({ fileName: 'a.pdf', wrong: true })
    })
    expect(document.querySelector('[data-testid="pdf-password-wrong"]')?.textContent).toBe(
      '암호가 올바르지 않습니다',
    )
    const input = document.querySelector<HTMLInputElement>('[data-testid="pdf-password-input"]')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'pw')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="pdf-password-submit"]')!.click()
    })
    expect(await answer).toBe('pw')

    act(() => {
      answer = prompt({ fileName: 'a.pdf', wrong: false })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(document.querySelectorAll('[data-testid="pdf-password-sheet"]')).toHaveLength(1)
    expect(document.querySelector('[data-testid="pdf-password-wrong"]')).toBeNull()
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="pdf-password-cancel"]')!.click()
    })
    expect(await answer).toBeNull()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(document.querySelector('[data-testid="pdf-password-sheet"]')).toBeNull()
  })
})

// ── render window ───────────────────────────────────────────────────────────

describe('render window', () => {
  it('keeps the visible pages and one neighbour each side, with no page-count cap', () => {
    const sizes = Array.from({ length: 1000 }, () => ({ width: 600, height: 800 }))
    const scale = fitWidthScale(sizes, 400)
    const layout = computePageLayout(sizes, scale, 400)
    expect(layout.tops).toHaveLength(1000)
    const top = layout.tops[500]!
    const range = visiblePageRange(layout, top, 800)!
    expect(range.first).toBe(500)
    expect(renderWindow(range, 1000)).toEqual({ first: 499, last: range.last + 1 })
    expect(renderWindow(visiblePageRange(layout, layout.contentHeight - 10, 800), 1000)!.last).toBe(
      999,
    )
  })

  it('releases the bitmaps of pages that scrolled far away', async () => {
    const pageCount = 30
    const rendered: number[] = []
    const fakePage = (n: number) => ({
      rotate: 0,
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
      render: () => {
        rendered.push(n)
        return { promise: Promise.resolve(), cancel: () => {} }
      },
      streamTextContent: () => new ReadableStream({ start: (c) => c.close() }),
      getAnnotations: async () => [],
    })
    const proxy = { getPage: async (n: number) => fakePage(n) } as unknown as PDFDocumentProxy
    const geometry = {
      width: 600,
      height: 800,
      rotate: 0,
      origin: [0, 0] as [number, number],
      userUnit: 1,
    }
    const model = {
      proxy,
      pages: Array.from({ length: pageCount }, () => geometry),
      failedPages: new Set<number>(),
    } as unknown as PdfOpenedDocument

    // the scroll box of the viewer: 400 × 800 CSS px
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('m-pdf-scroll') ? 400 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('m-pdf-scroll') ? 800 : 0
    })

    // jsdom does not scroll: keep the scroll position the viewer sets
    const scrollTops = new WeakMap<Element, number>()
    vi.spyOn(Element.prototype, 'scrollTop', 'get').mockImplementation(function (this: Element) {
      return scrollTops.get(this) ?? 0
    })
    vi.spyOn(Element.prototype, 'scrollTop', 'set').mockImplementation(function (
      this: Element,
      value: number,
    ) {
      scrollTops.set(this, value)
    })

    const viewer = createRef<PdfViewerHandle>()
    const host = mount(
      <PdfViewer
        ref={viewer}
        model={model}
        initialView={INITIAL_PDF_VIEW_STATE}
        onViewChange={() => {}}
        onGoToDest={() => {}}
        labels={{ page: (n) => `p${n}`, brokenPage: 'broken', internalLink: 'link' }}
      />,
    )
    const settle = () =>
      act(async () => {
        for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
      })
    const drawn = () =>
      [...host.querySelectorAll('.m-pdf-page')]
        .filter((page) => page.querySelector('canvas'))
        .map((page) => Number((page as HTMLElement).dataset.page))
    await settle()

    // fit width: 384 px wide pages, 512 px tall — pages 0 and 1 show, page 2 is the neighbour
    expect(viewer.current!.getScale()).toBeCloseTo(0.64)
    expect(viewer.current!.getRenderWindow()).toEqual({ first: 0, last: 2 })
    expect(drawn()).toEqual([0, 1, 2])

    act(() => viewer.current!.scrollToPage(20))
    await settle()
    // pages 20 and 21 show; 19 and 22 are the neighbours
    expect(viewer.current!.getRenderWindow()).toEqual({ first: 19, last: 22 })
    // the far pages gave their canvases back; only the new window holds bitmaps
    expect(drawn()).toEqual([19, 20, 21, 22])
    expect(rendered).toEqual(expect.arrayContaining([1, 2, 3, 20, 21, 22, 23]))
    expect(rendered).not.toContain(10)
  })
})

// ── workspace ───────────────────────────────────────────────────────────────

function frameProps(canEdit: boolean) {
  return {
    docTitle: 'sample.pdf',
    docFormat: 'pdf' as const,
    saveState: 'saved' as const,
    mode: 'view' as const,
    canEdit,
    aiEnabled: false,
    noticeBanner: null,
    onBack: () => {},
    onEnterEdit: () => {},
    onDone: () => {},
    onExitEdit: () => {},
    onSave: () => {},
    onSaveAs: () => {},
    onShare: () => {},
    onOpenBackups: () => {},
    aiPanelContent: null,
  }
}

async function mountWorkspace(bytes: Uint8Array): Promise<HTMLElement> {
  // jsdom has no 2D canvas: PDF.js fails to paint, which the page treats like a blank page
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  const client = fakeClient(bytes)
  const result = await pdfEditorKind.open({ session: session(), client, isUntitled: false })
  const doc = result.start({ client } as unknown as EditorHost)
  const Workspace = doc.Workspace
  return mount(
    <Workspace
      frame={frameProps(!result.encrypted)}
      mode="view"
      canEdit={!result.encrypted}
      lang="ko"
      theme="dark"
    />,
  )
}

describe('view-mode workspace', () => {
  it('shows the read-only reason where editing would start, and no edit button', async () => {
    const host = await mountWorkspace(await damagedPdf())
    expect(host.querySelector('[data-testid="pdf-readonly-reason"]')?.textContent).toContain(
      '손상된 파일',
    )
    expect(host.querySelector('[data-testid="editor-mode-toggle"]')).toBeNull()
    expect(host.querySelector('[data-testid="pdf-page-chip"]')?.textContent).toBe('1 / 6')
  })

  it('offers the edit button for an ordinary PDF and finds text from the More sheet', async () => {
    const doc = await textPdf(['Hello Apple', 'apple pie'])
    const host = await mountWorkspace(await doc.save())
    expect(host.querySelector('[data-testid="pdf-readonly-reason"]')).toBeNull()
    expect(host.querySelector('[data-testid="editor-mode-toggle"]')).not.toBeNull()

    act(() => host.querySelector<HTMLButtonElement>('[data-testid="editor-more-btn"]')!.click())
    act(() =>
      document.querySelector<HTMLButtonElement>('[data-testid="editor-more-pdfSearch"]')!.click(),
    )
    const input = host.querySelector<HTMLInputElement>('[data-testid="pdf-search-input"]')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'APPLE')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600))
    })
    expect(host.querySelector('[data-testid="pdf-search-count"]')?.textContent).toBe('1 / 2')
    // the first hit (page 1) is on screen and painted as the active hit
    expect(host.querySelectorAll('[data-testid="pdf-search-hit-active"]')).toHaveLength(1)
  })
})
