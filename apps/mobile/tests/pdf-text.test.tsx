// Mobile PDF Text box tool (track T2, PDF-T9; spec 2.3, 3.7): new text (PC textInserts)
// and document text edits (PC textEdits) through the edit frame, the app-font coverage
// gates, the scanned-page notice, and a save through the engine read back with PDF.js.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { ActiveDocState } from '@genoffice/mobile-bridge/session-state'
import type { MobileClient, MobileDocSession } from '@genoffice/mobile-bridge/transport'
import { viewToPdf } from '../../pdf/src/renderer/annotations'
import type { TextBlock } from '../../pdf/src/renderer/text-block'
import type { SavePdfRequest } from '../../pdf/src/shared/ipc'
import type { EditorHost } from '../src/renderer/editors/editorKind'
import { startPdfEditDocument, type PdfEditDocument } from '../src/renderer/editors/pdf/edit'
import { setSharedPdfEngine, type PdfEngine } from '../src/renderer/editors/pdf/engine'
import { setEngineAssetLoader, type EngineAsset } from '../src/renderer/editors/pdf/engine/assets'
import { BUNDLED_FONTS } from '../src/renderer/editors/pdf/engine/fontTable'
import { createInThreadPdfEngine } from '../src/renderer/editors/pdf/engine/inThread'
import { keepsStandardFace } from '../src/renderer/editors/pdf/features/text/pageFonts'
import {
  editInputOf,
  insertDraftAt,
  insertInputOf,
  predictEditFont,
  textEditListOps,
  uncoverableChars,
  type EditDraft,
} from '../src/renderer/editors/pdf/features/text/textModel'
import type { PdfOpenedDocument } from '../src/renderer/editors/pdf/view/model'
import { openPdfModel } from '../src/renderer/editors/pdf/view/openPdf'
import { pcUnlockProbe } from '../src/renderer/editors/pdf/view/pcEngineHooks'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { translateMobile } from '../src/renderer/i18n/strings'

const MOBILE_ROOT = resolve(__dirname, '..')
const FONT_DIR = resolve(MOBILE_ROOT, 'src/renderer/assets/fonts')
const mobileRequire = createRequire(join(MOBILE_ROOT, 'package.json'))

function assetBytes(asset: EngineAsset): Uint8Array {
  if (asset === 'pdfium.wasm')
    return new Uint8Array(readFileSync(mobileRequire.resolve('@embedpdf/pdfium/pdfium.wasm')))
  if (asset === 'hb-subset.wasm')
    return new Uint8Array(readFileSync(mobileRequire.resolve('harfbuzzjs/hb-subset.wasm')))
  const font = BUNDLED_FONTS.find((f) => f.asset === asset)!
  return new Uint8Array(readFileSync(join(FONT_DIR, font.woff2)))
}

const ko = (key: Parameters<typeof translateMobile>[1], params?: Record<string, string>) =>
  translateMobile('ko', key, params)

// ── fixtures ────────────────────────────────────────────────────────────────

/** 400×500 pages; 'Hello World' in unembedded Helvetica at (40, 400), 14 pt. */
async function textPdf(lines: string[] = ['Hello World']): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([400, 500])
  lines.forEach((text, i) => page.drawText(text, { x: 40, y: 400 - i * 40, size: 14, font }))
  return doc.save({ useObjectStreams: false })
}

/** A page with a picture-like box and no text layer (a scan, to the tool). */
async function scannedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc
    .addPage([400, 500])
    .drawRectangle({ x: 20, y: 20, width: 360, height: 460, color: rgb(0.9, 0.9, 0.85) })
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

function recordingEngine() {
  const inner = createInThreadPdfEngine()
  const requests: SavePdfRequest[] = []
  const engine: PdfEngine = {
    ...inner,
    saveBytes: async (source, request) => {
      requests.push(request)
      return inner.saveBytes(source, request)
    },
  }
  return { engine, inner, requests }
}

const opened: PdfOpenedDocument[] = []
const docs: PdfEditDocument[] = []

async function openModel(bytes: Uint8Array): Promise<PdfOpenedDocument> {
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
  return model
}

async function startDoc(bytes: Uint8Array) {
  const fake = fakeClient(bytes)
  const { host, toasts } = fakeHost(fake.client)
  const s = session()
  const model = await openModel(bytes)
  const doc = startPdfEditDocument(host, model, { session: s, unlockProbe: pcUnlockProbe })
  docs.push(doc)
  return { doc, fake, toasts, s, edit: doc.editSession }
}

const roots: { root: Root; host: HTMLElement }[] = []

function mountWorkspace(doc: PdfEditDocument, mode: 'view' | 'edit' = 'edit'): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push({ root, host })
  const Workspace = doc.Workspace
  const frame = {
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
  act(() => {
    root.render(
      <MobileLocaleProvider lang="ko">
        <Workspace frame={frame} mode={mode} canEdit lang="ko" theme="light" />
      </MobileLocaleProvider>,
    )
  })
  return host
}

async function waitFor<T>(
  probe: () => T | null | undefined | false,
  what: string,
  ms = 30_000,
): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const value = probe()
    if (value) return value
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
  }
}

const q = <T extends Element = HTMLElement>(host: ParentNode, testId: string) =>
  host.querySelector<T>(`[data-testid="${testId}"]`)

function pressTextTool(host: HTMLElement) {
  const icon = q(host, 'pdf-tool-textbox')!
  act(() => icon.closest('button')!.click())
}

function pageScale(host: HTMLElement, pageIndex = 0): number {
  const page = host.querySelector<HTMLElement>(`.m-pdf-page[data-page="${pageIndex}"]`)!
  return Number(page.style.getPropertyValue('--scale-factor'))
}

function pointer(el: Element, type: string, clientX: number, clientY: number) {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY }))
}

/** A finger tap at page view coordinates (PDF pt, y down). */
function tap(host: HTMLElement, vx: number, vy: number, pageIndex = 0) {
  const scale = pageScale(host, pageIndex)
  const catcher = q(host, `pdf-text-catcher-${pageIndex}`)!
  act(() => {
    pointer(catcher, 'pointerdown', vx * scale, vy * scale)
    pointer(catcher, 'pointerup', vx * scale, vy * scale)
  })
}

function typeInto(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function click(host: ParentNode, testId: string) {
  act(() => q(host, testId)!.click())
}

const draftBox = (host: HTMLElement) => q<HTMLTextAreaElement>(host, 'pdf-text-draft')

async function pageText(bytes: Uint8Array): Promise<string> {
  const model = await openModel(bytes)
  const page = await model.proxy.getPage(1)
  const content = await page.getTextContent()
  return content.items.map((it) => ('str' in it ? it.str : '')).join(' ')
}

let recorder: ReturnType<typeof recordingEngine>

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  setEngineAssetLoader(async (asset) => assetBytes(asset))
})

afterAll(() => {
  setEngineAssetLoader(null)
  setSharedPdfEngine(null)
})

beforeEach(() => {
  recorder = recordingEngine()
  setSharedPdfEngine(recorder.engine)
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

// ── font coverage (spec 2.3) ────────────────────────────────────────────────

describe('font coverage', () => {
  it('names exactly the characters no app font draws', async () => {
    const canDraw = recorder.inner.canDrawText
    expect(await uncoverableChars(canDraw, '안녕 Hello 123', 'arial')).toEqual([])
    expect(await uncoverableChars(canDraw, '안녕 뷁 漢字 ①', 'arial')).toEqual([
      '뷁',
      '漢',
      '字',
      '①',
    ])
    expect(await uncoverableChars(canDraw, '한글 뷁')).toEqual(['뷁'])
  }, 60_000)

  it('predicts the app-font substitution of a document text edit', async () => {
    const canDraw = recorder.inner.canDrawText
    // embedded subset: only the characters the page already draws in that face
    expect(await predictEditFont(canDraw, '안녕 Hello', '안녕 Helo', undefined, false)).toEqual({
      kind: 'ok',
    })
    expect(await predictEditFont(canDraw, '안녕 세상', '안녕 Helo', undefined, false)).toEqual({
      kind: 'substitute',
      chars: ['세', '상'],
    })
    expect(await predictEditFont(canDraw, '안녕 뷁', '안녕', undefined, false)).toEqual({
      kind: 'blocked',
      chars: ['뷁'],
    })
    // an unembedded base-14 face keeps WinAnsi text (PC keptStandardFont)
    expect(
      await predictEditFont(canDraw, 'Brand new', 'Hello', undefined, false, ['Helvetica']),
    ).toEqual({
      kind: 'ok',
    })
    expect(keepsStandardFace('ABCDEF+Helvetica', 'x')).toBe(false)
    expect(keepsStandardFace('Helvetica', '한글')).toBe(false)
    // an explicit app font must draw everything itself
    expect(await predictEditFont(canDraw, '가나 漢', '', 'times', true)).toEqual({
      kind: 'blocked',
      chars: ['漢'],
    })
  }, 60_000)
})

// ── PC shapes ───────────────────────────────────────────────────────────────

describe('inputs in the PC shape', () => {
  it('builds a text insert like the PC insert dialog plus the font choice', () => {
    const geom = { pw: 400, ph: 500, rot: 90 }
    const d = {
      ...insertDraftAt(0, geom, 30, 40, {
        fontSize: 12,
        color: '#e53935',
        font: 'times',
        bold: true,
      }),
      value: '첫째\n둘째',
    }
    const input = insertInputOf(d, geom)
    expect(input).toEqual({
      pageIndex: 0,
      origin: viewToPdf(geom, 30, 52),
      text: '첫째\n둘째',
      fontSize: 12,
      color: [229, 57, 53],
      font: 'times',
      bold: true,
      lineLeading: 12 * 1.2,
      lineXOffsets: [0, 0],
      align: 'left',
      rotate: 90,
    })
  })

  it('reflows a paragraph edit into the block like PC mergeTextDraft', () => {
    const block: TextBlock = {
      rect: [40, 340, 300, 414],
      fontSize: 14,
      lineHeight: 20,
      align: 'center',
      lines: [
        { rect: [40, 397, 300, 414], text: 'first line', y: 400, fontSize: 14 },
        { rect: [60, 377, 280, 394], text: 'second line', y: 380, fontSize: 14 },
      ],
    }
    const draft: EditDraft = {
      kind: 'edit',
      pageIndex: 0,
      rect: [...block.rect],
      oldText: 'first line second line',
      fontSize: 14,
      value: 'one\ntwo',
      size: 21,
      color: '#2b66ff',
      block: {
        leftPt: 40,
        firstBaseline: 400,
        widthPt: 260,
        lineHeight: 20,
        align: 'center',
        bottomPt: 340,
      },
      knownChars: '',
    }
    const input = editInputOf(draft, [block])
    expect(input).toMatchObject({
      pageIndex: 0,
      rect: [40, 340, 300, 414],
      oldText: 'first line second line',
      newText: 'one\ntwo',
      fontSize: 14,
      newFontSize: 21,
      newColor: [43, 102, 255],
      origin: [40, 400],
      lineLeading: 30,
      align: 'center',
      blockSource: 'one\ntwo',
    })
    expect((input as { lineXOffsets: number[] }).lineXOffsets).toHaveLength(2)
    // a line edit replaces the run in place: no origin, no leading
    const line = editInputOf(
      { ...draft, block: undefined, size: undefined, color: undefined, value: 'x' },
      [block],
    )
    expect(line).toEqual({
      pageIndex: 0,
      rect: [40, 340, 300, 414],
      oldText: 'first line second line',
      newText: 'x',
      fontSize: 14,
    })
    // a reflow growing onto the block below is refused (PC reflowOverflows)
    const below: TextBlock = { ...block, rect: [40, 200, 300, 330] }
    expect(editInputOf({ ...draft, value: 'a\nb\nc\nd\ne\nf' }, [block, below])).toBe('overflow')
  })

  it('writes text edit lists with the PC op names', () => {
    const a = {
      id: 'a',
      input: { pageIndex: 0, rect: [0, 0, 1, 1], oldText: 'x', newText: 'y', fontSize: 9 },
    }
    const b = { ...a, id: 'b', cover: [0, 0, 2, 2] as [number, number, number, number] }
    expect(textEditListOps([a as never], [b as never])).toEqual([
      { op: 'removeTextEdit', id: 'a' },
      { op: 'putTextEdit', id: 'b', input: a.input, cover: [0, 0, 2, 2] },
    ])
  })
})

// ── the tool in the edit frame ──────────────────────────────────────────────

describe('Text box tool', () => {
  it('changes nothing when not editing or when the tool is off', async () => {
    const view = await startDoc(await textPdf())
    const viewHost = mountWorkspace(view.doc, 'view')
    expect(q(viewHost, 'pdf-text-catcher-0')).toBeNull()
    expect(q(viewHost, 'pdf-tool-textbox')).toBeNull()

    const edit = await startDoc(await textPdf())
    const host = mountWorkspace(edit.doc, 'edit')
    // tool off: no tap catcher, the page scrolls and selects as in viewing
    expect(q(host, 'pdf-text-catcher-0')).toBeNull()
    expect(edit.edit.store.hasEdits()).toBe(false)
    pressTextTool(host)
    expect(q(host, 'pdf-text-catcher-0')).not.toBeNull()
    expect(edit.toasts.at(-1)).toBe(ko('pdfTextHint'))
    pressTextTool(host)
    expect(q(host, 'pdf-text-catcher-0')).toBeNull()
    expect(edit.edit.store.hasEdits()).toBe(false)
  })

  it('blocks an insert with characters no app font draws and names them', async () => {
    const { doc, edit, toasts } = await startDoc(await textPdf())
    const host = mountWorkspace(doc)
    pressTextTool(host)
    tap(host, 200, 300)
    const box = await waitFor(() => draftBox(host), 'the insert box')
    expect(box.dataset.kind).toBe('insert')
    typeInto(box, 'Hi 뷁 漢')
    click(host, 'pdf-text-confirm')
    await waitFor(() => toasts.includes(ko('pdfTextCannotDraw', { chars: '뷁 漢' })), 'the refusal')
    expect(edit.store.getSnapshot().textInserts).toHaveLength(0)
    // the box stays open with the text so it can be fixed
    expect(draftBox(host)?.value).toBe('Hi 뷁 漢')
  }, 60_000)

  it('counts an open box as unsaved and commits it before a save', async () => {
    const { doc, edit, fake, s } = await startDoc(await textPdf())
    const host = mountWorkspace(doc)
    pressTextTool(host)
    tap(host, 40, 200)
    typeInto(await waitFor(() => draftBox(host), 'the insert box'), '열린 상자')
    // nothing confirmed yet, but [완료] / save must not lose what is being typed
    expect(edit.store.getSnapshot().textInserts).toHaveLength(0)
    expect(await doc.save!(docState(s), false)).toBe(true)
    expect(recorder.requests.at(-1)?.textInserts).toHaveLength(1)
    expect(fake.saved).toHaveLength(1)
    expect((await pageText(fake.saved[0]!)).replace(/\s+/g, '')).toContain('열린상자')
  }, 60_000)

  it('adds new text with the PC insert shape, then reopens, moves and deletes it', async () => {
    const { doc, edit } = await startDoc(await textPdf())
    const host = mountWorkspace(doc)
    pressTextTool(host)
    tap(host, 200, 300)
    const box = await waitFor(() => draftBox(host), 'the insert box')
    typeInto(box, '안녕 Hello\n둘째 줄')
    click(host, 'pdf-text-bold')
    click(host, 'pdf-text-size-up')
    click(host, 'pdf-text-font')
    click(host, 'pdf-text-font-times')
    click(host, 'pdf-text-color')
    click(host, 'pdf-text-color-2b66ff')
    click(host, 'pdf-text-confirm')
    const inserts = await waitFor(
      () =>
        edit.store.getSnapshot().textInserts.length === 1 && edit.store.getSnapshot().textInserts,
      'the insert',
    )
    const input = inserts[0]!.input
    expect(input).toEqual({
      pageIndex: 0,
      origin: [200, 500 - (300 + 14)],
      text: '안녕 Hello\n둘째 줄',
      fontSize: 16,
      color: [43, 102, 255],
      font: 'times',
      bold: true,
      lineLeading: 16 * 1.2,
      lineXOffsets: [0, 0],
      align: 'left',
      rotate: 0,
    })
    expect(draftBox(host)).toBeNull()
    const preview = await waitFor(() => q(host, 'pdf-text-insert-preview'), 'the preview')
    expect(preview.textContent).toBe('안녕 Hello\n둘째 줄')

    // drag moves it (PC patchTextInsert origin)
    const scale = pageScale(host)
    act(() => {
      pointer(preview, 'pointerdown', 0, 0)
      pointer(preview, 'pointermove', 20 * scale, 10 * scale)
      pointer(preview, 'pointerup', 20 * scale, 10 * scale)
    })
    expect(edit.store.getSnapshot().textInserts[0]!.input.origin).toEqual([220, 176])

    // a tap reopens it; changing the text patches the same insert
    act(() => {
      pointer(q(host, 'pdf-text-insert-preview')!, 'pointerdown', 0, 0)
      pointer(q(host, 'pdf-text-insert-preview')!, 'pointerup', 0, 0)
    })
    const again = await waitFor(() => draftBox(host), 'the reopened box')
    expect(again.value).toBe('안녕 Hello\n둘째 줄')
    typeInto(again, '바뀐 글')
    click(host, 'pdf-text-confirm')
    await waitFor(
      () => edit.store.getSnapshot().textInserts[0]?.input.text === '바뀐 글',
      'the patch',
    )
    expect(edit.store.getSnapshot().textInserts).toHaveLength(1)

    act(() => {
      pointer(q(host, 'pdf-text-insert-preview')!, 'pointerdown', 0, 0)
      pointer(q(host, 'pdf-text-insert-preview')!, 'pointerup', 0, 0)
    })
    await waitFor(() => draftBox(host), 'the reopened box')
    click(host, 'pdf-text-delete')
    expect(edit.store.getSnapshot().textInserts).toHaveLength(0)
    expect(edit.store.undo()).toBe(true)
    expect(edit.store.getSnapshot().textInserts).toHaveLength(1)
  }, 60_000)

  it('edits document text in place with a PC text edit and previews it', async () => {
    const { doc, edit, toasts } = await startDoc(await textPdf())
    const host = mountWorkspace(doc)
    pressTextTool(host)
    tap(host, 60, 95)
    const box = await waitFor(() => draftBox(host), 'the edit box')
    expect(box.dataset.kind).toBe('edit')
    expect(box.value).toBe('Hello World')
    typeInto(box, 'Hello Mobile')
    click(host, 'pdf-text-confirm')
    const edits = await waitFor(
      () => edit.store.getSnapshot().textEdits.length === 1 && edit.store.getSnapshot().textEdits,
      'the edit',
    )
    const te = edits[0]!
    expect(te.input).toMatchObject({
      pageIndex: 0,
      oldText: 'Hello World',
      newText: 'Hello Mobile',
    })
    expect(te.input.fontSize).toBeCloseTo(14, 0)
    expect(te.input.origin).toBeUndefined()
    expect(te.input.rect[0]).toBeCloseTo(40, 0)
    // the save will match it: the dry run found the run's ink
    expect(te.cover).toBeDefined()
    // Helvetica without a font program keeps drawing Latin text: no substitution notice
    const substituted = ko('pdfTextFontSubstituted', { chars: '@' }).split('@')[0]!
    expect(toasts.filter((m) => m.startsWith(substituted))).toEqual([])
    const preview = await waitFor(
      () => q<HTMLElement>(host, 'pdf-text-edit-preview'),
      'the edit preview',
    )
    expect(preview.textContent).toBe('Hello Mobile')
    expect(host.querySelector('.m-pdf-text-cover')).not.toBeNull()

    // tapping the preview reopens the same edit; putting the text back drops it
    act(() => preview.click())
    const again = await waitFor(() => draftBox(host), 'the reopened edit')
    expect(again.value).toBe('Hello Mobile')
    typeInto(again, 'Hello World')
    click(host, 'pdf-text-confirm')
    await waitFor(() => edit.store.getSnapshot().textEdits.length === 0, 'the revert')
  }, 60_000)

  it('tells the person a scanned page has no text and only inserts there', async () => {
    const { doc, edit, toasts } = await startDoc(await scannedPdf())
    const host = mountWorkspace(doc)
    pressTextTool(host)
    tap(host, 100, 100)
    await waitFor(() => toasts.includes(ko('pdfTextScannedPage')), 'the scanned-page notice')
    const box = await waitFor(() => draftBox(host), 'the insert box')
    expect(box.dataset.kind).toBe('insert')
    typeInto(box, '메모')
    click(host, 'pdf-text-confirm')
    await waitFor(() => edit.store.getSnapshot().textInserts.length === 1, 'the insert')
    expect(edit.store.getSnapshot().textEdits).toHaveLength(0)
  }, 60_000)

  it('saves an insert and an edit through the engine as real PDF text, then edits the inserted text like document text', async () => {
    const { doc, edit, fake, s, toasts } = await startDoc(await textPdf())
    const host = mountWorkspace(doc)
    pressTextTool(host)

    tap(host, 60, 95)
    typeInto(await waitFor(() => draftBox(host), 'the edit box'), 'Hello Mobile')
    click(host, 'pdf-text-confirm')
    await waitFor(() => edit.store.getSnapshot().textEdits.length === 1, 'the edit')

    tap(host, 40, 200)
    typeInto(await waitFor(() => draftBox(host), 'the insert box'), '안녕 Hello')
    click(host, 'pdf-text-confirm')
    await waitFor(() => edit.store.getSnapshot().textInserts.length === 1, 'the insert')

    const before = edit.getModel()
    expect(await doc.save!(docState(s), false)).toBe(true)
    const request = recorder.requests.at(-1)!
    expect(request.textEdits).toHaveLength(1)
    expect(request.textInserts).toHaveLength(1)
    expect(fake.saved).toHaveLength(1)
    const text = await pageText(fake.saved[0]!)
    expect(text).toContain('Hello Mobile')
    expect(text).not.toContain('Hello World')
    expect(text.replace(/\s+/g, '')).toContain('안녕Hello')

    // after the save the inserted text is document text: tap it and edit it the same way
    await waitFor(() => edit.getModel() !== before && !edit.store.hasEdits(), 'the reload')
    // the reloaded document starts with no tool on
    await waitFor(() => q(host, 'pdf-tool-textbox'), 'the edit bar')
    if (!q(host, 'pdf-text-catcher-0')) pressTextTool(host)
    tap(host, 50, 209)
    const box = await waitFor(
      () => draftBox(host)?.dataset.kind === 'edit' && draftBox(host),
      'the edit box',
    )
    expect(box.value.replace(/\s+/g, '')).toBe('안녕Hello')
    // 세상 is not in the embedded subset: the save draws it in an app font, said up front
    typeInto(box, '안녕 세상')
    click(host, 'pdf-text-confirm')
    await waitFor(
      () => toasts.includes(ko('pdfTextFontSubstituted', { chars: '세 상' })),
      'the substitution notice',
    )
    expect(edit.store.getSnapshot().textEdits).toHaveLength(1)

    // even the app fonts lack 뷁: the edit is refused at confirm, not at save
    act(() => q(host, 'pdf-text-edit-preview')!.click())
    const again = await waitFor(() => draftBox(host), 'the reopened edit')
    typeInto(again, '안녕 뷁')
    click(host, 'pdf-text-confirm')
    await waitFor(() => toasts.includes(ko('pdfTextCannotDraw', { chars: '뷁' })), 'the refusal')
    expect(edit.store.getSnapshot().textEdits[0]!.input.newText).toBe('안녕 세상')
  }, 120_000)
})
