// Mobile PDF link feature (track T2, PDF-T11, spec 3.10): [⋯] Insert link → drag a
// box on a page → an http/https/mailto address or a page of this document → the PC
// `addDrawing` op with kind 'link'; pending links can be retargeted or deleted; nothing
// changes outside edit mode; leaving edit mode, a bar tool or Back ends placing.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib'
import type { ActiveDocState } from '@genoffice/mobile-bridge/session-state'
import type { MobileClient, MobileDocSession } from '@genoffice/mobile-bridge/transport'
import type { EditorHost } from '../src/renderer/editors/editorKind'
import {
  PDF_FEATURES,
  startPdfEditDocument,
  type PdfEditDocument,
  type PdfFeatureChrome,
  type PdfFeatureSet,
} from '../src/renderer/editors/pdf/edit'
import { setEngineAssetLoader } from '../src/renderer/editors/pdf/engine/assets'
import { setSharedPdfEngine } from '../src/renderer/editors/pdf/engine'
import { createInThreadPdfEngine } from '../src/renderer/editors/pdf/engine/inThread'
import {
  parseLinkPage,
  parseLinkUrl,
  resolveLinkTarget,
  visiblePageOrder,
} from '../src/renderer/editors/pdf/features/link'
import { useLinkFeature } from '../src/renderer/editors/pdf/features/link/useLinkFeature'
import { emptyEditSnapshot } from '../src/renderer/editors/pdf/edit'
import type { PdfOpenedDocument } from '../src/renderer/editors/pdf/view/model'
import { openPdfModel } from '../src/renderer/editors/pdf/view/openPdf'
import { pcUnlockProbe } from '../src/renderer/editors/pdf/view/pcEngineHooks'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { translateMobile } from '../src/renderer/i18n/strings'
import { BackStackProvider } from '../src/renderer/shell/backStack'

const mobileRequire = createRequire(join(resolve(__dirname, '..'), 'package.json'))
const t = (key: Parameters<typeof translateMobile>[1], params?: Record<string, string | number>) =>
  translateMobile('ko', key, params)

// ── fixtures ────────────────────────────────────────────────────────────────

const PAGE_W = 400
const PAGE_H = 500

async function textPdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const text of pages) {
    doc.addPage([PAGE_W, PAGE_H]).drawText(text, { x: 40, y: 400, size: 14, font })
  }
  return doc.save({ useObjectStreams: false })
}

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const fromBase64 = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'))

function session(): MobileDocSession {
  return {
    sessionId: 's1',
    docKey: 'k1',
    name: 'sample.pdf',
    ext: 'pdf',
    format: 'pdf',
    writable: true,
    ephemeral: false,
  }
}

function docState(s: MobileDocSession): ActiveDocState {
  return {
    session: s,
    dirty: true,
    encrypted: false,
    distribution: false,
    trackingDropped: false,
    isUntitled: false,
  }
}

function fakeClient(fileBytes: Uint8Array) {
  const saved: Uint8Array[] = []
  const client = {
    getAppPrefs: async () => ({
      lang: 'ko',
      theme: 'system',
      hwpDefaultFormat: 'hwp',
      aiEnabled: false,
    }),
    readFileBytes: async () => ({ bytesBase64: toBase64(fileBytes) }),
    saveFileBytes: async (_sessionId: string, bytesBase64: string) => {
      saved.push(fromBase64(bytesBase64))
      return {}
    },
    recoveryWrite: async () => ({ ok: true }),
    recoveryDiscard: async () => ({ ok: true }),
  } as unknown as MobileClient
  return { client, saved }
}

function fakeHost(client: MobileClient) {
  const toasts: string[] = []
  const host: EditorHost = {
    client,
    markDirty: () => {},
    updateSession: () => {},
    setNotice: () => {},
    showToast: (input) => toasts.push(typeof input === 'string' ? input : input.message),
    contentChanged: () => {},
    refreshHome: async () => {},
    openSession: async () => {},
    translate: (key, params) => translateMobile('ko', key, params),
    windowClass: () => 'compact',
  }
  return { host, toasts }
}

const opened: PdfOpenedDocument[] = []
const docs: PdfEditDocument[] = []

/** The link feature wrapped so a test can call its chrome directly (view mode checks). */
let lastChrome: PdfFeatureChrome | null = null
const probedFeatures: PdfFeatureSet = {
  ...PDF_FEATURES,
  link: {
    id: 'link',
    useFeature(ctx) {
      const chrome = useLinkFeature(ctx)
      lastChrome = chrome
      return chrome
    },
  },
}

async function startDoc(pages = ['One', 'Two', 'Three']) {
  const bytes = await textPdf(pages)
  const { client, saved } = fakeClient(bytes)
  const { host, toasts } = fakeHost(client)
  const s = session()
  const model = await openPdfModel({
    bytes,
    fileName: 'sample.pdf',
    writable: true,
    isUntitled: false,
    fromRecovery: false,
    askPassword: async () => null,
    unlockProbe: pcUnlockProbe,
  })
  opened.push(model)
  const doc = startPdfEditDocument(host, model, {
    session: s,
    unlockProbe: pcUnlockProbe,
    features: probedFeatures,
  })
  docs.push(doc)
  return { doc, edit: doc.editSession, saved, toasts, s }
}

const roots: { root: Root; host: HTMLElement }[] = []

function frameProps(mode: 'view' | 'edit') {
  return {
    docTitle: 'sample.pdf',
    docFormat: 'pdf' as const,
    saveState: 'saved' as const,
    mode,
    canEdit: true,
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

function mountWorkspace(doc: PdfEditDocument, mode: 'view' | 'edit' = 'edit') {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push({ root, host })
  const Workspace = doc.Workspace
  const render = (next: 'view' | 'edit') => {
    const node: ReactNode = (
      <BackStackProvider>
        <MobileLocaleProvider lang="ko">
          <Workspace frame={frameProps(next)} mode={next} canEdit lang="ko" theme="dark" />
        </MobileLocaleProvider>
      </BackStackProvider>
    )
    act(() => root.render(node))
  }
  render(mode)
  return { host, render }
}

const q = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T & HTMLElement>(selector)

function click(selector: string) {
  const el = q(selector)
  expect(el, selector).not.toBeNull()
  act(() => el!.click())
}

function openInsertLink() {
  click('[data-testid="editor-more-btn"]')
  click('[data-testid="editor-more-pdfEdit-link"]')
}

function pointer(type: string, target: Element, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  Object.defineProperty(event, 'pointerType', { value: 'touch' })
  act(() => void target.dispatchEvent(event))
}

/** A finger drag on page `pageIndex` from (x1,y1) to (x2,y2), page CSS px. */
function drag(pageIndex: number, from: [number, number], to: [number, number]) {
  const layer = q(`[data-testid="pdf-link-layer-${pageIndex}"]`)
  expect(layer).not.toBeNull()
  pointer('pointerdown', layer!, from[0], from[1])
  pointer('pointermove', layer!, (from[0] + to[0]) / 2, (from[1] + to[1]) / 2)
  expect(q('[data-testid="pdf-link-live"]')).not.toBeNull()
  pointer('pointermove', layer!, to[0], to[1])
  pointer('pointerup', layer!, to[0], to[1])
}

function typeInto(selector: string, value: string) {
  const input = q<HTMLInputElement>(selector) as HTMLInputElement
  expect(input, selector).not.toBeNull()
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** The page CSS scale the viewer laid page 0 out at. */
function pageScale(host: HTMLElement): number {
  const page = host.querySelector<HTMLElement>('.m-pdf-page[data-page="0"]')!
  return parseFloat(page.style.width) / PAGE_W
}

async function linkAnnots(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const pages = doc.getPages()
  const out: { page: number; uri: string | null; destPage: number | null }[] = []
  pages.forEach((page, index) => {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) return
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookup(i, PDFDict)
      if (String(annot.get(PDFName.of('Subtype'))) !== '/Link') continue
      const action = annot.lookupMaybe(PDFName.of('A'), PDFDict)
      const uri = action?.lookupMaybe(PDFName.of('URI'), PDFString)?.decodeText() ?? null
      const dest = annot.lookupMaybe(PDFName.of('Dest'), PDFArray)
      const destPage = dest ? pages.findIndex((p) => p.ref === dest.get(0)) + 1 : null
      out.push({ page: index, uri, destPage })
    }
  })
  return out
}

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  setEngineAssetLoader(async (asset) => {
    if (asset === 'pdfium.wasm') {
      return new Uint8Array(readFileSync(mobileRequire.resolve('@embedpdf/pdfium/pdfium.wasm')))
    }
    if (asset === 'hb-subset.wasm') {
      return new Uint8Array(readFileSync(mobileRequire.resolve('harfbuzzjs/hb-subset.wasm')))
    }
    throw new Error(`asset not used by these tests: ${asset}`)
  })
})

afterAll(() => {
  setEngineAssetLoader(null)
  setSharedPdfEngine(null)
})

beforeEach(() => {
  setSharedPdfEngine(createInThreadPdfEngine())
  lastChrome = null
  // jsdom has no 2D canvas: PDF.js fails to paint, which the page treats like a blank page
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
})

afterEach(async () => {
  for (const { root, host } of roots.splice(0)) {
    act(() => root.unmount())
    host.remove()
  }
  for (const doc of docs.splice(0)) opened.push(doc.editSession.getModel())
  for (const model of opened.splice(0)) await model.destroy().catch(() => {})
  vi.restoreAllMocks()
})

// ── target rules ────────────────────────────────────────────────────────────

describe('link targets', () => {
  it('accepts only http, https and mailto addresses ("www." becomes https)', () => {
    expect(parseLinkUrl(' https://example.com/a?b=1 ')).toBe('https://example.com/a?b=1')
    expect(parseLinkUrl('http://example.com')).toBe('http://example.com')
    expect(parseLinkUrl('mailto:someone@example.com')).toBe('mailto:someone@example.com')
    expect(parseLinkUrl('www.example.com')).toBe('https://www.example.com')
    for (const bad of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,hi',
      'ftp://example.com',
      'tel:123',
      'example.com',
      'https://',
      'mailto:',
      'https://exa mple.com',
      '',
    ]) {
      expect(parseLinkUrl(bad), bad).toBeNull()
    }
  })

  it('accepts only page numbers within 1..page count', () => {
    expect(parseLinkPage('1', 3)).toBe(1)
    expect(parseLinkPage(' 3 ', 3)).toBe(3)
    for (const bad of ['0', '4', '-1', '1.5', 'two', ''])
      expect(parseLinkPage(bad, 3), bad).toBeNull()
  })

  it('maps a visible page position to its original page like the PC (order, deletions, blank pages)', () => {
    const edits = { ...emptyEditSnapshot(), order: [2, 0, 1], deleted: new Set([0]) }
    const visible = visiblePageOrder(edits, 3)
    expect(visible).toEqual([2, 1])
    expect(resolveLinkTarget('', '1', visible)).toEqual({ ok: true, target: { destPage: 3 } })
    expect(resolveLinkTarget('', '2', visible)).toEqual({ ok: true, target: { destPage: 2 } })
    expect(resolveLinkTarget('', '3', visible)).toEqual({ ok: false, error: 'page' })
    expect(resolveLinkTarget('ftp://x', '', visible)).toEqual({ ok: false, error: 'url' })
    expect(resolveLinkTarget(' ', '', visible)).toEqual({ ok: false, error: 'empty' })
    expect(resolveLinkTarget('mailto:a@b.c', '', visible)).toEqual({
      ok: true,
      target: { url: 'mailto:a@b.c' },
    })
  })
})

// ── the feature in the edit frame ───────────────────────────────────────────

describe('insert link', () => {
  it('drags a box, refuses a disallowed address, then adds kind "link" with the url', async () => {
    const { doc, edit } = await startDoc()
    const { host } = mountWorkspace(doc)
    openInsertLink()
    expect(q('[data-testid="pdf-link-placing"]')?.textContent).toContain(t('pdfLinkPlaceHint'))

    // a tap is not a box: still placing, no sheet
    const layer = q('[data-testid="pdf-link-layer-0"]')!
    pointer('pointerdown', layer, 30, 30)
    pointer('pointerup', layer, 31, 31)
    expect(q('[data-testid="pdf-link-sheet"]')).toBeNull()
    expect(q('[data-testid="pdf-link-placing"]')).not.toBeNull()

    drag(0, [20, 20], [120, 80])
    expect(q('[data-testid="pdf-link-placing"]')).toBeNull()
    expect(q('[data-testid="pdf-link-sheet"]')).not.toBeNull()

    typeInto('[data-testid="pdf-link-url"]', 'javascript:alert(1)')
    click('[data-testid="pdf-link-apply"]')
    expect(q('[data-testid="pdf-link-error"]')?.textContent).toBe(t('pdfLinkUrlInvalid'))
    expect(edit.services.getEdits().drawings).toHaveLength(0)

    typeInto('[data-testid="pdf-link-url"]', 'https://example.com/docs')
    click('[data-testid="pdf-link-apply"]')
    expect(q('[data-testid="pdf-link-sheet"]')).toBeNull()

    const s = pageScale(host)
    const drawings = edit.services.getEdits().drawings
    expect(drawings).toHaveLength(1)
    expect(drawings[0]!.input).toEqual({
      kind: 'link',
      pageIndex: 0,
      rect: [20 / s, PAGE_H - 80 / s, 120 / s, PAGE_H - 20 / s].map((n) => expect.closeTo(n, 6)),
      url: 'https://example.com/docs',
    })
    expect(edit.store.canUndo()).toBe(true)
    expect(host.querySelectorAll('[data-testid="pdf-link-pending"]')).toHaveLength(1)
  })

  it('refuses a page outside the document and adds kind "link" with a 1-based destPage', async () => {
    const { doc, edit } = await startDoc()
    mountWorkspace(doc)
    // pending order: the third page shows first
    act(() => void edit.services.dispatch([{ op: 'setPageOrder', order: [2, 0, 1] }]))
    openInsertLink()
    drag(1, [10, 10], [90, 50])

    typeInto('[data-testid="pdf-link-page"]', '4')
    click('[data-testid="pdf-link-apply"]')
    expect(q('[data-testid="pdf-link-error"]')?.textContent).toBe(
      t('pdfLinkPageInvalid', { count: 3 }),
    )
    typeInto('[data-testid="pdf-link-page"]', '0')
    click('[data-testid="pdf-link-apply"]')
    expect(q('[data-testid="pdf-link-error"]')).not.toBeNull()
    expect(edit.services.getEdits().drawings).toHaveLength(0)

    // typing a page clears the address field (PC: exactly one target)
    typeInto('[data-testid="pdf-link-url"]', 'https://x.example')
    typeInto('[data-testid="pdf-link-page"]', '1')
    expect(q<HTMLInputElement>('[data-testid="pdf-link-url"]')!.value).toBe('')
    click('[data-testid="pdf-link-apply"]')

    const input = edit.services.getEdits().drawings[0]!.input
    expect(input).toMatchObject({ kind: 'link', pageIndex: 1, destPage: 3 })
    expect('url' in input).toBe(false)
  })

  it('edits a pending link target in one undo step and deletes it', async () => {
    const { doc, edit } = await startDoc()
    mountWorkspace(doc)
    openInsertLink()
    drag(0, [20, 20], [120, 80])
    typeInto('[data-testid="pdf-link-url"]', 'www.example.com')
    click('[data-testid="pdf-link-apply"]')
    const first = edit.services.getEdits().drawings[0]!
    expect(first.input).toMatchObject({ url: 'https://www.example.com' })

    click('[data-testid="pdf-link-pending"]')
    expect(q('[data-testid="pdf-link-sheet"] [role="dialog"]')?.getAttribute('aria-label')).toBe(
      t('pdfLinkEditTitle'),
    )
    expect(q<HTMLInputElement>('[data-testid="pdf-link-url"]')!.value).toBe(
      'https://www.example.com',
    )
    typeInto('[data-testid="pdf-link-page"]', '2')
    click('[data-testid="pdf-link-apply"]')
    const edited = edit.services.getEdits().drawings
    expect(edited).toHaveLength(1)
    expect(edited[0]!.id).toBe(first.id)
    expect(edited[0]!.input).toEqual({
      kind: 'link',
      pageIndex: 0,
      rect: (first.input as { rect: number[] }).rect,
      destPage: 2,
    })

    act(() => void edit.store.undo())
    expect(edit.services.getEdits().drawings[0]!.input).toMatchObject({
      url: 'https://www.example.com',
    })
    act(() => void edit.store.redo())

    click('[data-testid="pdf-link-pending"]')
    expect(q<HTMLInputElement>('[data-testid="pdf-link-page"]')!.value).toBe('2')
    click('[data-testid="pdf-link-delete"]')
    expect(edit.services.getEdits().drawings).toHaveLength(0)
    expect(q('[data-testid="pdf-link-sheet"]')).toBeNull()
    expect(q('[data-testid="pdf-link-pending"]')).toBeNull()
  })

  it('writes a Link annotation through the PC save (url and page target)', async () => {
    const { doc, edit, saved, s } = await startDoc()
    mountWorkspace(doc)
    openInsertLink()
    drag(0, [20, 20], [120, 80])
    typeInto('[data-testid="pdf-link-url"]', 'mailto:someone@example.com')
    click('[data-testid="pdf-link-apply"]')
    openInsertLink()
    drag(2, [20, 20], [120, 80])
    typeInto('[data-testid="pdf-link-page"]', '1')
    click('[data-testid="pdf-link-apply"]')
    expect(edit.services.getEdits().drawings).toHaveLength(2)

    await act(async () => {
      expect(await doc.save!(docState(s), false)).toBe(true)
    })
    expect(saved).toHaveLength(1)
    expect(await linkAnnots(saved[0]!)).toEqual([
      { page: 0, uri: 'mailto:someone@example.com', destPage: null },
      { page: 2, uri: null, destPage: 1 },
    ])
  }, 60_000)
})

describe('placing mode and view mode', () => {
  it('ends placing on Back, on a bar tool and on leaving edit mode', async () => {
    const { doc } = await startDoc()
    const { render } = mountWorkspace(doc)

    // Back: the entry pressed straight from the hook, so the More sheet's own history
    // step (jsdom never answers its history.back()) does not sit on the back stack
    act(() => lastChrome!.onMorePress!())
    expect(q('[data-testid="pdf-link-placing"]')).not.toBeNull()
    act(() => void window.dispatchEvent(new PopStateEvent('popstate')))
    expect(q('[data-testid="pdf-link-placing"]')).toBeNull()

    openInsertLink()
    click('[data-testid="pdf-tool-pen"]')
    expect(q('[data-testid="pdf-link-placing"]')).toBeNull()
    click('[data-testid="pdf-tool-pen"]')

    openInsertLink()
    click('[data-testid="pdf-link-placing-cancel"]')
    expect(q('[data-testid="pdf-link-placing"]')).toBeNull()

    openInsertLink()
    render('view')
    expect(q('[data-testid="pdf-link-placing"]')).toBeNull()
    expect(q('[data-testid="pdf-link-layer-0"]')).toBeNull()
    render('edit')
    expect(q('[data-testid="pdf-link-placing"]')).toBeNull()
  })

  it('changes nothing when not editing', async () => {
    const { doc, edit } = await startDoc()
    act(
      () =>
        void edit.services.dispatch([
          {
            op: 'addDrawing',
            drawing: {
              kind: 'link',
              pageIndex: 0,
              rect: [10, 10, 200, 60],
              url: 'https://a.example',
            },
          },
        ]),
    )
    const before = edit.services.getEdits()
    const { host } = mountWorkspace(doc, 'view')

    // no entry in view mode, and the hook refuses even if called
    click('[data-testid="editor-more-btn"]')
    expect(q('[data-testid="editor-more-pdfEdit-link"]')).toBeNull()
    act(() => lastChrome!.onMorePress!())
    expect(q('[data-testid="pdf-link-placing"]')).toBeNull()

    // the pending box is shown but does not answer a tap or a drag
    const box = host.querySelector<HTMLElement>('[data-testid="pdf-link-pending"]')!
    expect(box.getAttribute('data-interactive')).toBe('false')
    act(() => box.click())
    expect(q('[data-testid="pdf-link-sheet"]')).toBeNull()
    const layer = q('[data-testid="pdf-link-layer-0"]')!
    expect(layer.getAttribute('data-placing')).toBe('false')
    pointer('pointerdown', layer, 20, 20)
    pointer('pointerup', layer, 150, 150)
    expect(q('[data-testid="pdf-link-sheet"]')).toBeNull()

    expect(edit.services.getEdits()).toBe(before)
  })
})
