// Mobile PDF forms (track T2, PDF-T8, spec 3.8): AcroForm fields filled in edit mode
// through the PC `setFormValue` op (text in a sheet with the keyboard, check boxes,
// radio groups, choices in a sheet), check/cross marks on documents without fields
// (PC static form fills), the file's own static fills kept on save, signature fields
// handed to the sign feature, and nothing changing outside edit mode.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument, PDFHexString, PDFName, PDFString, rgb } from 'pdf-lib'
import type { ActiveDocState } from '@genoffice/mobile-bridge/session-state'
import type { MobileClient, MobileDocSession } from '@genoffice/mobile-bridge/transport'
import { pdfToView } from '../../pdf/src/renderer/annotations'
import type { SavePdfRequest, StaticFormFillRecord } from '../../pdf/src/shared/ipc'
import type { EditorHost } from '../src/renderer/editors/editorKind'
import {
  PDF_FEATURES,
  startPdfEditDocument,
  type PdfEditDocument,
  type PdfFeatureChrome,
  type PdfFeatureSet,
} from '../src/renderer/editors/pdf/edit'
import { setEngineAssetLoader } from '../src/renderer/editors/pdf/engine/assets'
import { setSharedPdfEngine, type PdfEngine } from '../src/renderer/editors/pdf/engine'
import { createInThreadPdfEngine } from '../src/renderer/editors/pdf/engine/inThread'
import {
  createFormFeature,
  readSavedStaticFormFills,
} from '../src/renderer/editors/pdf/features/form'
import type { PdfOpenedDocument } from '../src/renderer/editors/pdf/view/model'
import { openPdfModel } from '../src/renderer/editors/pdf/view/openPdf'
import { pcUnlockProbe } from '../src/renderer/editors/pdf/view/pcEngineHooks'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { translateMobile } from '../src/renderer/i18n/strings'

const mobileRequire = createRequire(join(resolve(__dirname, '..'), 'package.json'))

// 1×1 transparent PNG: the stand-in for the PC canvas-painted mark (jsdom has no 2D canvas)
const MARK_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

// ── fixtures ────────────────────────────────────────────────────────────────

/** One page with a text field, a check box, a radio group, a drop-down and a signature field. */
async function formPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 500])
  const form = doc.getForm()
  form.createTextField('name').addToPage(page, { x: 40, y: 420, width: 200, height: 24 })
  form.createCheckBox('agree').addToPage(page, { x: 40, y: 380, width: 16, height: 16 })
  const color = form.createRadioGroup('color')
  color.addOptionToPage('red', page, { x: 40, y: 340, width: 16, height: 16 })
  color.addOptionToPage('blue', page, { x: 80, y: 340, width: 16, height: 16 })
  const size = form.createDropdown('size')
  size.addOptions(['S', 'M', 'L'])
  size.addToPage(page, { x: 40, y: 300, width: 120, height: 24 })
  // pdf-lib makes no signature fields; a bare /Sig widget is what PDF.js reports as one
  const sig = doc.context.register(
    doc.context.obj({
      FT: 'Sig',
      T: PDFString.of('Sig1'),
      Type: 'Annot',
      Subtype: 'Widget',
      Rect: [40, 200, 240, 250],
      F: 4,
      P: page.ref,
    }),
  )
  page.node.addAnnot(sig)
  form.acroForm.addField(sig)
  return doc.save({ useObjectStreams: false })
}

/** A printed form without fields: one drawn box at (100,300)–(114,314), optionally with saved fills. */
async function printedPdf(saved?: unknown): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 500])
  page.drawRectangle({
    x: 100,
    y: 300,
    width: 14,
    height: 14,
    borderWidth: 1,
    borderColor: rgb(0, 0, 0),
  })
  if (saved !== undefined) {
    doc.catalog.set(
      PDFName.of('GenOfficeStaticFormFills'),
      PDFHexString.fromText(JSON.stringify(saved)),
    )
  }
  return doc.save({ useObjectStreams: false })
}

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const fromBase64 = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'))

function session(over: Partial<MobileDocSession> = {}): MobileDocSession {
  return {
    sessionId: 's1',
    docKey: 'k1',
    name: 'form.pdf',
    ext: 'pdf',
    format: 'pdf',
    writable: true,
    ephemeral: false,
    ...over,
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
  const saved: { sessionId: string; bytes: Uint8Array }[] = []
  const client = {
    getAppPrefs: async () => ({
      lang: 'ko',
      theme: 'system',
      hwpDefaultFormat: 'hwp',
      aiEnabled: false,
    }),
    readFileBytes: async () => ({ bytesBase64: toBase64(fileBytes) }),
    saveFileBytes: async (sessionId: string, bytesBase64: string) => {
      saved.push({ sessionId, bytes: fromBase64(bytesBase64) })
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

const requests: SavePdfRequest[] = []
function recordingEngine(): PdfEngine {
  const inner = createInThreadPdfEngine()
  return {
    ...inner,
    saveBytes: async (source, request) => {
      requests.push(request)
      return inner.saveBytes(source, request)
    },
  }
}

/** The form feature with the test mark painter, and a spy on what it hands the frame. */
function spiedFeatures() {
  const chromes: PdfFeatureChrome[] = []
  const form = createFormFeature({
    renderMark: (_kind, size = 12) => ({
      kind: 'image',
      image: MARK_PNG,
      width: size,
      height: size,
    }),
  })
  const features: PdfFeatureSet = {
    ...PDF_FEATURES,
    form: {
      id: 'form',
      useFeature(ctx) {
        const chrome = form.useFeature!(ctx)
        chromes.push(chrome)
        return chrome
      },
    },
  }
  return { features, chromes }
}

const opened: PdfOpenedDocument[] = []
const docs: PdfEditDocument[] = []

async function startDoc(bytes: Uint8Array) {
  const fake = fakeClient(bytes)
  const { host, toasts } = fakeHost(fake.client)
  const s = session()
  const model = await openPdfModel({
    bytes,
    fileName: 'form.pdf',
    writable: true,
    isUntitled: false,
    fromRecovery: false,
    askPassword: async () => null,
    unlockProbe: pcUnlockProbe,
  })
  opened.push(model)
  const { features, chromes } = spiedFeatures()
  const doc = startPdfEditDocument(host, model, {
    session: s,
    unlockProbe: pcUnlockProbe,
    features,
  })
  docs.push(doc)
  return { doc, fake, s, toasts, chromes, edit: doc.editSession }
}

const roots: { root: Root; host: HTMLElement }[] = []

function mountWorkspace(doc: PdfEditDocument, mode: 'view' | 'edit' = 'edit', canEdit = true) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push({ root, host })
  const Workspace = doc.Workspace
  act(() => {
    root.render(
      <MobileLocaleProvider lang="ko">
        <Workspace
          frame={{
            docTitle: 'form.pdf',
            docFormat: 'pdf' as const,
            saveState: 'saved' as const,
            mode,
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
          }}
          mode={mode}
          canEdit={canEdit}
          lang="ko"
          theme="dark"
        />
      </MobileLocaleProvider>,
    )
  })
  return host
}

/** Waits until the async catalog read (PDF.js annotations) has drawn the page's fields. */
async function fieldsReady(host: HTMLElement) {
  await vi.waitFor(() => {
    expect(host.querySelector('[data-field="name"]')).not.toBeNull()
  })
}

const q = <T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T => {
  const el = root.querySelector<T>(selector)
  if (!el) throw new Error(`not found: ${selector}`)
  return el
}

const click = (el: HTMLElement) => act(() => el.click())

function pageScale(host: HTMLElement): number {
  return parseFloat(q(host, '.m-pdf-page').style.width) / 400
}

/** Taps the placement layer of page 0 at a PDF point (jsdom boxes sit at 0,0). */
function tapPdfPoint(host: HTMLElement, x: number, y: number) {
  const scale = pageScale(host)
  const [vx, vy] = pdfToView({ pw: 400, ph: 500, rot: 0 }, x, y)
  const layer = q(host, '[data-testid="pdf-form-place-0"]')
  act(() => {
    layer.dispatchEvent(
      new MouseEvent('click', { bubbles: true, clientX: vx * scale, clientY: vy * scale }),
    )
  })
}

function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(input) as object
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function openMore(host: HTMLElement) {
  click(q(host, '[data-testid="editor-more-btn"]'))
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
  requests.length = 0
  setSharedPdfEngine(recordingEngine())
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

// ── AcroForm fields ─────────────────────────────────────────────────────────

describe('AcroForm fields', () => {
  it('fills text, check box, radio and choice fields as PC formValues and saves them into the fields', async () => {
    const { doc, edit, fake, s } = await startDoc(await formPdf())
    const host = mountWorkspace(doc)
    await fieldsReady(host)

    // text: a sheet with the keyboard, every change one PC setFormValue
    click(q(host, '[data-field="name"]'))
    const input = q<HTMLInputElement>(document, '[data-testid="pdf-form-text-input"]')
    expect(document.activeElement).toBe(input)
    typeInto(input, 'Kim')
    expect(q(host, '[data-field="name"]').textContent).toBe('Kim')
    click(q(document, '[data-testid="pdf-form-text-done"]'))
    expect(document.querySelector('[data-testid="pdf-form-text-input"]')).toBeNull()

    click(q(host, '[data-field="agree"]'))
    expect(q(host, '[data-field="agree"]').getAttribute('aria-checked')).toBe('true')

    click(q(host, '[data-field="color"][data-button-value="blue"]'))

    click(q(host, '[data-field="size"]'))
    click(q(document, '[data-testid="pdf-form-choice-M"]'))
    expect(document.querySelector('[data-testid="pdf-form-choice-sheet"]')).toBeNull()
    expect(q(host, '[data-field="size"]').textContent).toBe('M')

    expect([...edit.store.getSnapshot().formEdits.values()]).toEqual([
      { name: 'name', kind: 'text', value: 'Kim' },
      { name: 'agree', kind: 'checkbox', checked: true },
      { name: 'color', kind: 'radio', value: 'blue' },
      { name: 'size', kind: 'choice', value: 'M' },
    ])

    expect(await doc.save!(docState(s), false)).toBe(true)
    expect(requests[0]!.formValues).toEqual([
      { name: 'name', kind: 'text', value: 'Kim' },
      { name: 'agree', kind: 'checkbox', checked: true },
      { name: 'color', kind: 'radio', value: 'blue' },
      { name: 'size', kind: 'choice', value: 'M' },
    ])
    const form = (await PDFDocument.load(fake.saved[0]!.bytes)).getForm()
    expect(form.getTextField('name').getText()).toBe('Kim')
    expect(form.getCheckBox('agree').isChecked()).toBe(true)
    expect(form.getRadioGroup('color').getSelected()).toBe('blue')
    expect(form.getDropdown('size').getSelected()).toEqual(['M'])
  })

  it('keeps one choice per radio group and does nothing when the chosen button is tapped again', async () => {
    const { doc, edit } = await startDoc(await formPdf())
    const host = mountWorkspace(doc)
    await fieldsReady(host)
    const red = () => q(host, '[data-field="color"][data-button-value="red"]')
    const blue = () => q(host, '[data-field="color"][data-button-value="blue"]')
    expect(red().getAttribute('aria-checked')).toBe('false')
    expect(blue().getAttribute('aria-checked')).toBe('false')

    click(red())
    expect(red().getAttribute('aria-checked')).toBe('true')
    click(blue())
    expect(red().getAttribute('aria-checked')).toBe('false')
    expect(blue().getAttribute('aria-checked')).toBe('true')
    expect(edit.store.getSnapshot().formEdits.get('color')).toEqual({
      name: 'color',
      kind: 'radio',
      value: 'blue',
    })

    const before = edit.store.getSnapshot()
    click(blue())
    expect(edit.store.getSnapshot()).toBe(before)

    // the check box toggles back off
    click(q(host, '[data-field="agree"]'))
    click(q(host, '[data-field="agree"]'))
    expect(edit.store.getSnapshot().formEdits.get('agree')).toEqual({
      name: 'agree',
      kind: 'checkbox',
      checked: false,
    })
  })

  it('lists the choice options by their display values in a sheet', async () => {
    const { doc } = await startDoc(await formPdf())
    const host = mountWorkspace(doc)
    await fieldsReady(host)
    click(q(host, '[data-field="size"]'))
    const sheet = q(document, '[data-testid="pdf-form-choice-sheet"]')
    const rows = [...sheet.querySelectorAll<HTMLElement>('[data-testid^="pdf-form-choice-"]')]
    expect(rows.map((row) => row.textContent)).toEqual(['S', 'M', 'L'])
    expect(rows.every((row) => row.getAttribute('aria-checked') === 'false')).toBe(true)
  })

  it('switches PDF.js to the form mode, feeds field names to op planning, and refuses a field that collides', async () => {
    const { doc, edit, chromes } = await startDoc(await formPdf())
    const host = mountWorkspace(doc)
    await fieldsReady(host)
    // AnnotationMode.ENABLE_FORMS: PDF.js leaves the widgets to the form layer (PC PdfPage)
    expect(chromes.at(-1)!.annotationMode).toBe(2)
    const plan = edit.services.dispatch([
      {
        op: 'addFormField',
        field: { name: 'name', kind: 'text', pageIndex: 0, rect: [10, 10, 60, 30] },
      },
    ])
    expect(plan.failures).toHaveLength(1)
    const radio = edit.services.dispatch([
      {
        op: 'addFormField',
        field: {
          name: 'color',
          kind: 'radio',
          pageIndex: 0,
          rect: [10, 10, 30, 30],
          exportValue: 'green',
        },
      },
    ])
    expect(radio.failures).toEqual([])
  })

  it('hands an unsigned signature field to the sign feature', async () => {
    const { doc, edit } = await startDoc(await formPdf())
    const handler = vi.fn()
    const host = mountWorkspace(doc)
    await fieldsReady(host)
    // registered after the sign feature mounted its own handler, so this one answers
    edit.services.registerSignatureHandler(handler)
    const button = q(host, '[data-field="Sig1"]')
    expect(button.textContent).toBe(translateMobile('ko', 'pdfFormSignField'))
    click(button)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0]![0]).toMatchObject({
      pageIndex: 0,
      rect: [40, 200, 240, 250],
      fieldName: 'Sig1',
      kind: 'signature',
      signed: false,
    })

    // once a drawing is placed for that field, it reads as signed and is not offered again
    edit.services.dispatch([
      {
        op: 'addDrawing',
        drawing: {
          kind: 'image',
          pageIndex: 0,
          image: MARK_PNG,
          rect: [50, 205, 230, 245],
          formFieldName: 'Sig1',
        },
      },
    ])
    await act(async () => {})
    click(q(host, '[data-field="Sig1"]'))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('changes nothing outside edit mode and offers no mark rows', async () => {
    const { doc, edit, chromes } = await startDoc(await formPdf())
    const handler = vi.fn()
    edit.services.registerSignatureHandler(handler)
    const host = mountWorkspace(doc, 'view')
    await fieldsReady(host)
    expect(chromes.at(-1)!.moreItems ?? []).toEqual([])
    for (const field of host.querySelectorAll<HTMLElement>('[data-field]')) click(field)
    expect(document.querySelector('[data-testid="pdf-form-text-sheet"]')).toBeNull()
    expect(document.querySelector('[data-testid="pdf-form-choice-sheet"]')).toBeNull()
    expect(handler).not.toHaveBeenCalled()
    expect(edit.store.hasEdits()).toBe(false)
  })

  it('changes nothing on a document that cannot be edited', async () => {
    const { doc, edit } = await startDoc(await formPdf())
    const host = mountWorkspace(doc, 'edit', false)
    await fieldsReady(host)
    click(q(host, '[data-field="agree"]'))
    click(q(host, '[data-field="name"]'))
    expect(document.querySelector('[data-testid="pdf-form-text-sheet"]')).toBeNull()
    expect(edit.store.hasEdits()).toBe(false)
  })
})

// ── check and cross marks ───────────────────────────────────────────────────

describe('static marks', () => {
  it('reads the saved static fills the way PC readStaticFormFills does', async () => {
    const good: StaticFormFillRecord = {
      id: 'a',
      kind: 'text',
      pageIndex: 0,
      rect: [10, 10, 80, 30],
      text: 'Hong',
      fontSize: 14,
      color: '#111111',
      align: 'left',
    }
    const bytes = await printedPdf([good, { id: 'b', kind: 'circle', pageIndex: 0 }, 7])
    expect(await readSavedStaticFormFills(bytes)).toEqual([good])
    expect(await readSavedStaticFormFills(await printedPdf())).toEqual([])
    expect(await readSavedStaticFormFills(new Uint8Array([1, 2, 3]))).toEqual([])
  })

  it('fills a printed box with a check, drops a cross at the tap elsewhere, and keeps the saved fills on save', async () => {
    const saved: StaticFormFillRecord = {
      id: 'saved-1',
      kind: 'text',
      pageIndex: 0,
      rect: [200, 400, 300, 420],
      text: 'Hong',
      fontSize: 14,
      color: '#111111',
      align: 'left',
    }
    const { doc, edit, s, fake } = await startDoc(await printedPdf([saved]))
    const host = mountWorkspace(doc)

    openMore(host)
    click(q(document, '[data-testid="editor-more-pdfFormCheck"]'))
    expect(q(document, '[data-testid="pdf-form-place-bar"]').textContent).toContain(
      translateMobile('ko', 'pdfFormPlaceCheck'),
    )
    tapPdfPoint(host, 107, 307)
    await vi.waitFor(() => expect(edit.store.getSnapshot().imageEdits).toHaveLength(1))
    expect(document.querySelector('[data-testid="pdf-form-place-bar"]')).toBeNull()
    const check = edit.store.getSnapshot().imageEdits[0]!
    expect(check.input).toMatchObject({
      kind: 'insertImage',
      pageIndex: 0,
      image: MARK_PNG,
      layer: 'aboveText',
      rotate: 0,
    })
    // the mark is a square centred on the printed box
    const r = (check.input as { rect: number[] }).rect
    expect(r[2]! - r[0]!).toBeCloseTo(r[3]! - r[1]!, 5)
    expect((r[0]! + r[2]!) / 2).toBeCloseTo(107, 0)
    expect((r[1]! + r[3]!) / 2).toBeCloseTo(307, 0)
    expect(r[2]! - r[0]!).toBeGreaterThan(12)
    expect(check.staticFill).toEqual({ id: check.id, kind: 'check', pageIndex: 0, rect: r })

    openMore(host)
    click(q(document, '[data-testid="editor-more-pdfFormCross"]'))
    tapPdfPoint(host, 250, 100)
    await vi.waitFor(() => expect(edit.store.getSnapshot().imageEdits).toHaveLength(2))
    const cross = edit.store.getSnapshot().imageEdits[1]!
    const cr = (cross.input as { rect: number[] }).rect
    expect(cr[0]).toBeCloseTo(244, 5)
    expect(cr[1]).toBeCloseTo(94, 5)
    expect(cr[2]).toBeCloseTo(256, 5)
    expect(cr[3]).toBeCloseTo(106, 5)
    expect(cross.staticFill?.kind).toBe('cross')
    expect(host.querySelectorAll('[data-testid="pdf-form-mark"]')).toHaveLength(2)

    expect(await doc.save!(docState(s), false)).toBe(true)
    const request = requests[0]!
    expect(request.staticFormFills).toEqual([
      saved,
      { id: check.id, kind: 'check', pageIndex: 0, rect: r },
      { id: cross.id, kind: 'cross', pageIndex: 0, rect: cr },
    ])
    expect(request.imageEdits).toHaveLength(2)
    expect((await readSavedStaticFormFills(fake.saved[0]!.bytes)).map((x) => x.id)).toEqual([
      'saved-1',
      check.id,
      cross.id,
    ])
  })

  it('ticks a check box field instead of adding a picture when the mark lands on one', async () => {
    const { doc, edit } = await startDoc(await formPdf())
    const host = mountWorkspace(doc)
    await fieldsReady(host)
    openMore(host)
    click(q(document, '[data-testid="editor-more-pdfFormCheck"]'))
    tapPdfPoint(host, 48, 388)
    await vi.waitFor(() =>
      expect(edit.store.getSnapshot().formEdits.get('agree')).toEqual({
        name: 'agree',
        kind: 'checkbox',
        checked: true,
      }),
    )
    expect(edit.store.getSnapshot().imageEdits).toEqual([])
  })

  it('moves and deletes a placed mark, and cancelling placement adds nothing', async () => {
    const { doc, edit } = await startDoc(await printedPdf())
    const host = mountWorkspace(doc)

    openMore(host)
    click(q(document, '[data-testid="editor-more-pdfFormCross"]'))
    click(q(document, '[data-testid="pdf-form-place-cancel"]'))
    expect(document.querySelector('[data-testid="pdf-form-place-0"]')).toBeNull()
    expect(edit.store.hasEdits()).toBe(false)

    openMore(host)
    click(q(document, '[data-testid="editor-more-pdfFormCross"]'))
    tapPdfPoint(host, 250, 100)
    await vi.waitFor(() => expect(edit.store.getSnapshot().imageEdits).toHaveLength(1))
    const id = edit.store.getSnapshot().imageEdits[0]!.id
    // a new mark comes selected, with its delete bar
    expect(q(document, '[data-testid="pdf-form-mark-bar"]')).not.toBeNull()

    const scale = pageScale(host)
    const mark = q(host, '[data-testid="pdf-form-mark"]')
    act(() => {
      mark.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }))
      mark.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, clientX: 10 + 20 * scale, clientY: 10 }),
      )
      mark.dispatchEvent(
        new MouseEvent('pointerup', { bubbles: true, clientX: 10 + 20 * scale, clientY: 10 }),
      )
    })
    const moved = edit.store.getSnapshot().imageEdits[0]!
    expect(moved.id).toBe(id)
    const mr = (moved.input as { rect: number[] }).rect
    expect(mr[0]).toBeCloseTo(264, 5)
    expect(mr[2]).toBeCloseTo(276, 5)
    expect(mr[1]).toBeCloseTo(94, 5)
    expect(resultingRect(edit.store.getSnapshot().imageEdits[0]!)).toEqual(mr)

    click(q(document, '[data-testid="pdf-form-mark-delete"]'))
    expect(edit.store.getSnapshot().imageEdits).toEqual([])
    expect(document.querySelector('[data-testid="pdf-form-mark-bar"]')).toBeNull()
    expect(host.querySelector('[data-testid="pdf-form-mark"]')).toBeNull()
  })
})

function resultingRect(edit: { input: unknown }): number[] {
  return (edit.input as { rect: number[] }).rect
}
