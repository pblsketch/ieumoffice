// Mobile PDF signatures (track T2, PDF-T7): the ten signatures remembered on the
// device with the PC signature-store rules, the signature sheet (pad and picture),
// placing a PC-shaped image stamp, moving / resizing / deleting it, signature fields
// fitted like the PC `signatureDrawingForField`, and nothing changing outside editing.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import type { MobileClient, MobileDocSession } from '@genoffice/mobile-bridge/transport'
import type { DrawingInput } from '../../pdf/src/shared/ipc'
import type { EditorHost } from '../src/renderer/editors/editorKind'
import { startPdfEditDocument, type PdfEditDocument } from '../src/renderer/editors/pdf/edit'
import { setSharedPdfEngine } from '../src/renderer/editors/pdf/engine'
import { createInThreadPdfEngine } from '../src/renderer/editors/pdf/engine/inThread'
import {
  addSignature,
  loadSavedSignatures,
  loadSignColor,
  MAX_SAVED_SIGNATURES,
  rememberSignature,
  sanitizeSignatures,
  SIGN_COLOR_KEY,
  SIGNATURES_KEY,
  writeSavedSignatures,
  type SignatureData,
  type SignatureStorage,
} from '../src/renderer/editors/pdf/features/sign/store'
import type { PdfOpenedDocument } from '../src/renderer/editors/pdf/view/model'
import { openPdfModel } from '../src/renderer/editors/pdf/view/openPdf'
import { pcUnlockProbe } from '../src/renderer/editors/pdf/view/pcEngineHooks'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { translateMobile } from '../src/renderer/i18n/strings'

// ── fixtures ────────────────────────────────────────────────────────────────

const PAGE_W = 400
const PAGE_H = 500
/** What the stubbed canvas encodes every PNG as. */
const PNG_B64 = 'U0lHTg=='

async function blankPdf(pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pages; i++) {
    doc.addPage([PAGE_W, PAGE_H]).drawText(`Page ${i + 1}`, { x: 40, y: 400, size: 14, font })
  }
  return doc.save({ useObjectStreams: false })
}

const strokes = (seed: number): SignatureData => ({
  kind: 'strokes',
  paths: [[10, 10, 20 + seed, 30]],
  width: 420,
  height: 150,
})

const imageSig = (image = 'QUJD', width = 200, height = 100): SignatureData => ({
  kind: 'image',
  image,
  width,
  height,
})

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

function fakeHost() {
  const toasts: string[] = []
  const client = {
    getAppPrefs: async () => ({
      lang: 'ko',
      theme: 'system',
      hwpDefaultFormat: 'hwp',
      aiEnabled: false,
    }),
    recoveryWrite: async () => ({ ok: true }),
    recoveryDiscard: async () => ({ ok: true }),
  } as unknown as MobileClient
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

async function startDoc(pages = 1) {
  const bytes = await blankPdf(pages)
  const { host, toasts } = fakeHost()
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
  const doc = startPdfEditDocument(host, model, { session: session(), unlockProbe: pcUnlockProbe })
  docs.push(doc)
  return { doc, edit: doc.editSession, toasts }
}

const roots: { root: Root; host: HTMLElement }[] = []

function mountWorkspace(doc: PdfEditDocument, mode: 'view' | 'edit' = 'edit'): HTMLElement {
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
            docTitle: 'sample.pdf',
            docFormat: 'pdf',
            saveState: 'saved',
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
          }}
          mode={mode}
          canEdit
          lang="ko"
          theme="dark"
        />
      </MobileLocaleProvider>,
    )
  })
  return host
}

const q = <T extends Element = HTMLElement>(testId: string): T | null =>
  document.querySelector<T>(`[data-testid="${testId}"]`)

function click(el: Element | null, init: MouseEventInit = {}) {
  expect(el).not.toBeNull()
  act(() => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }))
  })
}

function pointer(el: Element, type: string, x: number, y: number) {
  act(() => {
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        button: 0,
      }),
    )
  })
}

/** The page's CSS scale, read from the viewer's page box. */
function pageScale(host: HTMLElement, pageIndex = 0): number {
  const box = host.querySelector<HTMLElement>(`.m-pdf-page[data-page="${pageIndex}"]`)!
  return parseFloat(box.style.width) / PAGE_W
}

/** A stand-in 2D context for the canvases this feature draws on (jsdom has none). */
function fakeContext() {
  const strokeStyles: string[] = []
  const ctx = {
    strokes: strokeStyles,
    lineWidth: 0,
    lineCap: 'butt',
    lineJoin: 'miter',
    set strokeStyle(value: string) {
      strokeStyles.push(value)
    },
    get strokeStyle() {
      return strokeStyles.at(-1) ?? ''
    },
    scale: () => {},
    setTransform: () => {},
    clearRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    drawImage: () => {},
  }
  return ctx
}

let ctx: ReturnType<typeof fakeContext>

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  setSharedPdfEngine(null)
})

beforeEach(() => {
  setSharedPdfEngine(createInThreadPdfEngine())
  window.localStorage.clear()
  ctx = fakeContext()
  // PDF.js page canvases get none (a blank page); the pad and the stamp rasterizer get the stand-in
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return this.closest('.m-pdf-page') ? null : (ctx as unknown as CanvasRenderingContext2D)
  } as typeof HTMLCanvasElement.prototype.getContext)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    `data:image/png;base64,${PNG_B64}`,
  )
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
  window.localStorage.clear()
})

// ── remembered signatures ───────────────────────────────────────────────────

describe('remembered signatures (PC signature-store rules)', () => {
  it('keeps ten, newest first: the 11th saved signature evicts the oldest', () => {
    for (let i = 0; i < 11; i++) rememberSignature(strokes(i), window.localStorage, 1000 + i)
    const list = loadSavedSignatures(window.localStorage)
    expect(MAX_SAVED_SIGNATURES).toBe(10)
    expect(list).toHaveLength(10)
    expect(list[0]!.data).toEqual(strokes(10))
    expect(list[0]!.createdAt).toBe(1010)
    expect(list.at(-1)!.data).toEqual(strokes(1))
    expect(list.some((s) => JSON.stringify(s.data) === JSON.stringify(strokes(0)))).toBe(false)
    expect(new Set(list.map((s) => s.id)).size).toBe(10)
    // stored on the device under the mobile PDF prefix
    expect(SIGNATURES_KEY.startsWith('ieum-mobile-pdf-')).toBe(true)
    expect(SIGN_COLOR_KEY.startsWith('ieum-mobile-pdf-')).toBe(true)
    expect(JSON.parse(window.localStorage.getItem(SIGNATURES_KEY)!)).toHaveLength(10)

    // the same payload again moves to the front instead of duplicating
    rememberSignature(strokes(5), window.localStorage, 2000)
    const again = loadSavedSignatures(window.localStorage)
    expect(again).toHaveLength(10)
    expect(again[0]!.data).toEqual(strokes(5))
    expect(again.filter((s) => JSON.stringify(s.data) === JSON.stringify(strokes(5)))).toHaveLength(
      1,
    )
  })

  it('drops invalid stored data and survives broken storage', () => {
    const good = { id: 'a', createdAt: 5, data: imageSig() }
    const raw = [
      good,
      { id: 'a', createdAt: 6, data: imageSig('ZZZ') }, // duplicate id
      { id: '', createdAt: 1, data: imageSig() }, // empty id
      {
        id: 'b',
        createdAt: 1,
        data: { kind: 'strokes', paths: [[1, 2, 3]], width: 420, height: 150 },
      }, // odd path
      { id: 'c', createdAt: 1, data: { kind: 'strokes', paths: [], width: 420, height: 150 } }, // no path
      {
        id: 'd',
        createdAt: 1,
        data: { kind: 'strokes', paths: [[1, 2, 3, 4]], width: 0, height: 150 },
      }, // zero width
      { id: 'e', createdAt: 1, data: { kind: 'image', image: '', width: 1, height: 1 } }, // empty image
      { id: 'f', createdAt: 1, data: { kind: 'text', width: 1, height: 1 } }, // unknown kind
      { id: 'g', data: strokes(1) }, // missing createdAt → 0
      'nonsense',
      null,
    ]
    window.localStorage.setItem(SIGNATURES_KEY, JSON.stringify(raw))
    expect(loadSavedSignatures(window.localStorage)).toEqual([
      good,
      { id: 'g', createdAt: 0, data: strokes(1) },
    ])
    expect(sanitizeSignatures({ not: 'a list' })).toEqual([])
    window.localStorage.setItem(SIGNATURES_KEY, '{broken')
    expect(loadSavedSignatures(window.localStorage)).toEqual([])
    window.localStorage.setItem(SIGN_COLOR_KEY, '"red"')
    expect(loadSignColor(window.localStorage)).toEqual([0.1, 0.1, 0.12])
  })

  it('gives up the oldest first when the device storage is full, never the newest', () => {
    const stored = new Map<string, string>()
    const small: SignatureStorage = {
      getItem: (k) => stored.get(k) ?? null,
      removeItem: (k) => void stored.delete(k),
      setItem: (k, v) => {
        if (v.length > 600) throw new DOMException('full', 'QuotaExceededError')
        stored.set(k, v)
      },
    }
    let list = addSignature([], imageSig('A'.repeat(150)), 1)
    list = addSignature(list, imageSig('B'.repeat(150)), 2)
    list = addSignature(list, imageSig('C'.repeat(150)), 3)
    const kept = writeSavedSignatures(list, small)
    expect(kept.map((s) => (s.data.kind === 'image' ? s.data.image[0] : ''))).toEqual(['C', 'B'])
    expect(loadSavedSignatures(small)).toHaveLength(2)
  })
})

// ── placing ─────────────────────────────────────────────────────────────────

describe('placing a signature', () => {
  it('draws on the pad, remembers it and drops the PC-shaped image stamp where the page is tapped', async () => {
    const { doc, edit } = await startDoc()
    const host = mountWorkspace(doc)
    click(q('pdf-tool-sign'))
    expect(q('pdf-sign-sheet')).not.toBeNull()
    expect(q<HTMLButtonElement>('pdf-sign-confirm')!.disabled).toBe(true)

    click(q('pdf-sign-color-blue'))
    const pad = q('pdf-sign-pad')!
    pointer(pad, 'pointerdown', 20, 30)
    pointer(pad, 'pointermove', 120, 60)
    pointer(pad, 'pointermove', 220, 90)
    pointer(pad, 'pointerup', 220, 90)
    expect(q<HTMLButtonElement>('pdf-sign-confirm')!.disabled).toBe(false)
    click(q('pdf-sign-confirm'))

    // the sheet closed and the next tap on a page places it
    expect(q('pdf-sign-sheet')).toBeNull()
    expect(q('pdf-sign-place-hint')).not.toBeNull()
    expect(edit.store.getSnapshot().drawings).toHaveLength(0)
    const scale = pageScale(host)
    click(q('pdf-sign-catch-0'), { clientX: 150 * scale, clientY: 200 * scale })

    const drawings = edit.store.getSnapshot().drawings
    expect(drawings).toHaveLength(1)
    const input = drawings[0]!.input as Extract<DrawingInput, { kind: 'image' }>
    expect(Object.keys(input).sort()).toEqual(['image', 'kind', 'pageIndex', 'rect'])
    expect(input.kind).toBe('image')
    expect(input.pageIndex).toBe(0)
    expect(input.image).toBe(PNG_B64)
    // PC placeSignature: a third of the page width (capped at a sixth of its height),
    // centered on the tap, y flipped into PDF space; the pad is 420 × 150
    const w = PAGE_W / 3
    const h = (w * 150) / 420
    const left = 150 - w / 2
    const top = 200 - h / 2
    const expected = [left, PAGE_H - (top + h), left + w, PAGE_H - top]
    input.rect.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 6))
    // drawn in the chosen PC swatch (blue) at the pad stroke width
    expect(ctx.strokes.at(-1)).toBe('rgb(26, 61, 158)')

    // remembered as the PC strokes payload, color kept for next time
    const saved = loadSavedSignatures(window.localStorage)
    expect(saved).toHaveLength(1)
    expect(saved[0]!.data).toMatchObject({ kind: 'strokes', width: 420, height: 150 })
    expect((saved[0]!.data as { paths: number[][] }).paths).toEqual([[20, 30, 120, 60, 220, 90]])
    expect(loadSignColor(window.localStorage)).toEqual([0.1, 0.24, 0.62])

    // placing ends the tool and selects the new stamp
    expect(q('pdf-sign-place-hint')).toBeNull()
    expect(q('pdf-tool-sign')!.getAttribute('data-active')).toBe('false')
    expect(q('pdf-sign-remove')).not.toBeNull()

    // one undo step
    act(() => void edit.store.undo())
    expect(edit.store.getSnapshot().drawings).toHaveLength(0)
  })

  it('does not remember a signature when the switch is off, and picks a remembered one', async () => {
    rememberSignature(imageSig('UkVN', 300, 100), window.localStorage, 1)
    const { doc, edit } = await startDoc()
    mountWorkspace(doc)
    click(q('pdf-tool-sign'))
    expect(document.querySelectorAll('[data-testid="pdf-sign-saved-pick"]')).toHaveLength(1)
    click(q('pdf-sign-saved-pick'))
    click(q('pdf-sign-catch-0'), { clientX: 0, clientY: 0 })
    const input = edit.store.getSnapshot().drawings[0]!.input as Extract<
      DrawingInput,
      { kind: 'image' }
    >
    expect(input.image).toBe('UkVN')
    // kept on the page: the top-left corner is clamped to the page corner
    expect(input.rect[0]).toBeCloseTo(0, 6)
    expect(input.rect[3]).toBeCloseTo(PAGE_H, 6)
    expect(loadSavedSignatures(window.localStorage)).toHaveLength(1)

    click(q('pdf-tool-sign'))
    click(q('pdf-sign-remember'))
    const pad = q('pdf-sign-pad')!
    pointer(pad, 'pointerdown', 10, 10)
    pointer(pad, 'pointermove', 50, 50)
    pointer(pad, 'pointerup', 50, 50)
    click(q('pdf-sign-confirm'))
    expect(loadSavedSignatures(window.localStorage)).toHaveLength(1)

    // forgetting a remembered signature
    click(q('pdf-tool-sign'))
    click(q('pdf-tool-sign'))
    click(q('pdf-sign-saved-forget'))
    expect(loadSavedSignatures(window.localStorage)).toHaveLength(0)
  })

  it('moves, resizes (aspect kept) and deletes a pending stamp through the PC ops', async () => {
    const { doc, edit } = await startDoc()
    const host = mountWorkspace(doc)
    act(
      () =>
        void edit.services.dispatch([
          {
            op: 'addDrawing',
            drawing: { kind: 'image', pageIndex: 0, image: 'QUJD', rect: [100, 300, 200, 350] },
          },
        ]),
    )
    const scale = pageScale(host)
    const rectNow = () =>
      (edit.store.getSnapshot().drawings[0]!.input as Extract<DrawingInput, { kind: 'image' }>).rect

    click(q('pdf-sign-body'))
    expect(q('pdf-sign-remove')).not.toBeNull()

    const body = q('pdf-sign-body')!
    pointer(body, 'pointerdown', 10, 10)
    pointer(body, 'pointermove', 10 + 30 * scale, 10 + 20 * scale)
    pointer(body, 'pointerup', 10 + 30 * scale, 10 + 20 * scale)
    rectNow().forEach((v, i) => expect(v).toBeCloseTo([130, 280, 230, 330][i]!, 6))

    const handle = q('pdf-sign-resize')!
    pointer(handle, 'pointerdown', 0, 0)
    pointer(handle, 'pointermove', 100 * scale, 0)
    pointer(handle, 'pointerup', 100 * scale, 0)
    // twice as wide and twice as tall, the top-left corner fixed
    rectNow().forEach((v, i) => expect(v).toBeCloseTo([130, 230, 330, 330][i]!, 6))

    click(q('pdf-sign-remove'))
    expect(edit.store.getSnapshot().drawings).toHaveLength(0)
    act(() => void edit.store.undo())
    expect(edit.store.getSnapshot().drawings).toHaveLength(1)
  })
})

// ── signature fields ────────────────────────────────────────────────────────

describe('signature fields', () => {
  it('fits the signature into the field like the PC signatureDrawingForField', async () => {
    rememberSignature(imageSig('RklU', 200, 100), window.localStorage, 1)
    const { doc, edit } = await startDoc()
    mountWorkspace(doc)
    const target = {
      pageIndex: 0,
      rect: [100, 100, 300, 160] as [number, number, number, number],
      fieldName: 'Signature1',
      id: 'w1',
    }
    let request!: Promise<void>
    act(() => {
      request = edit.services.requestSignature(target)
    })
    expect(q('pdf-sign-sheet')).not.toBeNull()
    expect(q('pdf-sign-field-hint')!.textContent).toContain('Signature1')
    click(q('pdf-sign-saved-pick'))
    await act(async () => {
      await request
    })
    const drawing = edit.store.getSnapshot().drawings[0]!
    // field 200 × 60, inset 4.8 → 190.4 × 50.4; a 2:1 stamp fits the height: 100.8 × 50.4
    expect(drawing.input).toMatchObject({
      kind: 'image',
      pageIndex: 0,
      image: 'RklU',
      formFieldName: 'Signature1',
    })
    const rect = (drawing.input as Extract<DrawingInput, { kind: 'image' }>).rect
    rect.forEach((v, i) => expect(v).toBeCloseTo([149.6, 104.8, 250.4, 155.2][i]!, 6))
    expect(drawing.formWidgetId).toBe('w1')
    expect(q('pdf-sign-sheet')).toBeNull()
  })

  it('draws a new signature into a field as a fitted stamp, and settles when cancelled', async () => {
    const { doc, edit } = await startDoc()
    mountWorkspace(doc)
    const target = {
      pageIndex: 0,
      rect: [50, 50, 260, 125] as [number, number, number, number],
      fieldName: 'Sig',
    }
    let request!: Promise<void>
    act(() => {
      request = edit.services.requestSignature(target)
    })
    const pad = q('pdf-sign-pad')!
    pointer(pad, 'pointerdown', 10, 10)
    pointer(pad, 'pointermove', 300, 100)
    pointer(pad, 'pointerup', 300, 100)
    click(q('pdf-sign-confirm'))
    await act(async () => {
      await request
    })
    const input = edit.store.getSnapshot().drawings[0]!.input as Extract<
      DrawingInput,
      { kind: 'image' }
    >
    expect(input.kind).toBe('image')
    expect(input.formFieldName).toBe('Sig')
    // a 420 × 150 pad in a 210 × 75 field (inset 6): fitted to 176.4 × 63, centered
    const [x1, y1, x2, y2] = input.rect
    expect(x2 - x1).toBeCloseTo(176.4, 6)
    expect(y2 - y1).toBeCloseTo(63, 6)
    expect(x1).toBeCloseTo(50 + (210 - 176.4) / 2, 6)
    expect(y1).toBeCloseTo(50 + (75 - 63) / 2, 6)

    let cancelled!: Promise<void>
    act(() => {
      cancelled = edit.services.requestSignature(target)
    })
    click(document.querySelector('[data-testid="pdf-sign-sheet"] .mobile-sheet-header button'))
    await act(async () => {
      await cancelled
    })
    expect(q('pdf-sign-sheet')).toBeNull()
    expect(edit.store.getSnapshot().drawings).toHaveLength(1)
  })
})

// ── outside editing ─────────────────────────────────────────────────────────

describe('outside editing', () => {
  it('changes nothing: no sheet for a field, pending stamps shown but not selectable', async () => {
    rememberSignature(imageSig(), window.localStorage, 1)
    const { doc, edit } = await startDoc()
    act(
      () =>
        void edit.services.dispatch([
          {
            op: 'addDrawing',
            drawing: { kind: 'image', pageIndex: 0, image: 'QUJD', rect: [100, 300, 200, 350] },
          },
        ]),
    )
    const before = edit.store.getSnapshot()
    mountWorkspace(doc, 'view')
    expect(q('pdf-tool-sign')).toBeNull()

    await act(async () => {
      await edit.services.requestSignature({ pageIndex: 0, rect: [0, 0, 100, 40], fieldName: 'S' })
    })
    expect(q('pdf-sign-sheet')).toBeNull()

    const placed = q('pdf-sign-placed')!
    expect(placed.getAttribute('data-interactive')).toBe('false')
    click(q('pdf-sign-body'))
    expect(q('pdf-sign-remove')).toBeNull()
    const body = q('pdf-sign-body')!
    pointer(body, 'pointerdown', 0, 0)
    pointer(body, 'pointermove', 80, 80)
    pointer(body, 'pointerup', 80, 80)
    expect(q('pdf-sign-catch-0')).toBeNull()
    expect(edit.store.getSnapshot()).toBe(before)
  })
})
