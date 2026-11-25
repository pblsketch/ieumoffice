// Mobile PDF drawing (track T2, PDF-T6, spec 3.5): the pen/finger rule and its memory,
// palm rejection, drawings equal to what the PC DrawLayer records for the same pointer
// path, the eraser, and nothing changing outside edit mode.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib'
import type { MobileClient, MobileDocSession } from '@genoffice/mobile-bridge/transport'
import type { PageGeom } from '../../pdf/src/renderer/annotations'
import { pdfToView } from '../../pdf/src/renderer/annotations'
import { DrawLayer, type DrawTool } from '../../pdf/src/renderer/DrawLayer'
import type { DrawingInput } from '../../pdf/src/shared/ipc'
import type { EditorHost } from '../src/renderer/editors/editorKind'
import {
  startPdfEditDocument,
  type Op,
  type PdfEditDocument,
} from '../src/renderer/editors/pdf/edit'
import { setEngineAssetLoader } from '../src/renderer/editors/pdf/engine/assets'
import { setSharedPdfEngine } from '../src/renderer/editors/pdf/engine'
import { createInThreadPdfEngine } from '../src/renderer/editors/pdf/engine/inThread'
import {
  createPenInputRouter,
  loadPenPrefs,
  PEN_PREFS_KEY,
  savePenPrefs,
  startStroke,
  type DrawShapeTool,
} from '../src/renderer/editors/pdf/features/draw'
import { DrawPageLayer } from '../src/renderer/editors/pdf/features/draw/DrawPageLayer'
import type { PdfOpenedDocument } from '../src/renderer/editors/pdf/view/model'
import { openPdfModel } from '../src/renderer/editors/pdf/view/openPdf'
import { pcUnlockProbe } from '../src/renderer/editors/pdf/view/pcEngineHooks'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { translateMobile } from '../src/renderer/i18n/strings'

const mobileRequire = createRequire(join(resolve(__dirname, '..'), 'package.json'))
const tr = (key: Parameters<typeof translateMobile>[1]) => translateMobile('ko', key)

// ── pointer helpers ─────────────────────────────────────────────────────────

type Kind = 'pen' | 'touch' | 'mouse'

function pointer(el: Element, type: string, id: number, kind: Kind, x: number, y: number) {
  let event!: PointerEvent
  act(() => {
    event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: id,
      pointerType: kind,
      clientX: x,
      clientY: y,
      button: 0,
    })
    el.dispatchEvent(event)
  })
  return event
}

/** down at the first point, move through the rest, up at the last. */
function stroke(el: Element, id: number, kind: Kind, points: [number, number][]) {
  pointer(el, 'pointerdown', id, kind, ...points[0]!)
  for (const p of points.slice(1)) pointer(el, 'pointermove', id, kind, ...p)
  pointer(el, 'pointerup', id, kind, ...points.at(-1)!)
}

// ── mounting ────────────────────────────────────────────────────────────────

const roots: { root: Root; host: HTMLElement }[] = []
function mount(node: ReactNode): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push({ root, host })
  act(() => {
    root.render(<MobileLocaleProvider lang="ko">{node}</MobileLocaleProvider>)
  })
  return host
}

async function textPdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const text of pages) {
    doc.addPage([400, 500]).drawText(text, { x: 40, y: 400, size: 14, font })
  }
  return doc.save({ useObjectStreams: false })
}

async function annotSubtypes(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const out: string[] = []
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) continue
    for (let i = 0; i < annots.size(); i++) {
      out.push(String(annots.lookup(i, PDFDict).get(PDFName.of('Subtype'))))
    }
  }
  return out
}

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const fromBase64 = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'))

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

function fakeHost(fileBytes: Uint8Array) {
  const saved: Uint8Array[] = []
  const toasts: string[] = []
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
  return { host, saved, toasts }
}

const opened: PdfOpenedDocument[] = []
const docs: PdfEditDocument[] = []

async function startDoc(pages = ['Hello']) {
  const bytes = await textPdf(pages)
  const fake = fakeHost(bytes)
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
  const doc = startPdfEditDocument(fake.host, model, {
    session: session(),
    unlockProbe: pcUnlockProbe,
  })
  docs.push(doc)
  return { doc, edit: doc.editSession, fake }
}

function mountWorkspace(doc: PdfEditDocument, mode: 'view' | 'edit' = 'edit'): HTMLElement {
  const Workspace = doc.Workspace
  return mount(
    <Workspace
      frame={{
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
      }}
      mode={mode}
      canEdit
      lang="ko"
      theme="dark"
    />,
  )
}

const layerOf = (host: HTMLElement, page = 0) =>
  host.querySelector<SVGSVGElement>(`[data-testid="pdf-draw-layer-${page}"]`)
/** CSS px per PDF unit of the 400×500 test page. */
const scaleOf = (layer: SVGSVGElement) => Number(layer.getAttribute('width')) / 400
const click = (selector: string) =>
  act(() => document.querySelector<HTMLElement>(selector)!.click())
const pressPen = (host: HTMLElement) =>
  act(() => host.querySelector<HTMLElement>('[data-testid="pdf-tool-pen"]')!.click())

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
  // jsdom has no pointer capture; the PC layer calls it unguarded
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {}
  }
})

afterAll(() => {
  setEngineAssetLoader(null)
  setSharedPdfEngine(null)
})

beforeEach(() => {
  setSharedPdfEngine(createInThreadPdfEngine())
  window.localStorage.clear()
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

// ── the pen/finger state machine ────────────────────────────────────────────

describe('pen and finger', () => {
  it('lets a finger draw until a pen is used, then the finger moves the view', () => {
    const changes: unknown[] = []
    const router = createPenInputRouter({ onChange: (p) => changes.push(p) })
    expect(router.down(1, 'touch')).toEqual({ route: 'draw', abortLive: false })
    router.up(1)
    expect(router.prefs().penSeen).toBe(false)

    expect(router.down(2, 'pen')).toEqual({ route: 'draw', abortLive: false })
    router.up(2)
    expect(router.prefs()).toEqual({ penSeen: true, fingerDraws: false })
    expect(changes).toEqual([{ penSeen: true, fingerDraws: false }])

    expect(router.down(3, 'touch').route).toBe('pass')
    router.up(3)
    // the pen still draws, and so does a mouse
    expect(router.down(4, 'pen').route).toBe('draw')
    router.up(4)
    expect(router.down(5, 'mouse').route).toBe('draw')
    router.up(5)
  })

  it('makes the finger draw again with the switch on, even after a pen', () => {
    const router = createPenInputRouter({ initial: { penSeen: true, fingerDraws: false } })
    expect(router.down(1, 'touch').route).toBe('pass')
    router.up(1)
    router.setFingerDraws(true)
    expect(router.down(2, 'touch').route).toBe('draw')
    router.up(2)
    router.setFingerDraws(false)
    expect(router.down(3, 'touch').route).toBe('pass')
  })

  it('ignores touches while a pen is down (palm), in either mode', () => {
    for (const fingerDraws of [false, true]) {
      const router = createPenInputRouter({ initial: { penSeen: true, fingerDraws } })
      expect(router.down(1, 'pen').route).toBe('draw')
      expect(router.penDown()).toBe(true)
      expect(router.down(2, 'touch')).toEqual({ route: 'block', abortLive: false })
      router.up(2)
      router.up(1)
      expect(router.penDown()).toBe(false)
      expect(router.down(3, 'touch').route).toBe(fingerDraws ? 'draw' : 'pass')
    }
  })

  it('drops a palm stroke when the pen comes down, and a finger stroke when a second finger joins', () => {
    const router = createPenInputRouter()
    expect(router.down(1, 'touch').route).toBe('draw')
    expect(router.down(2, 'pen')).toEqual({ route: 'draw', abortLive: true })
    router.up(1)
    router.up(2)

    const zoom = createPenInputRouter()
    expect(zoom.down(1, 'touch').route).toBe('draw')
    expect(zoom.down(2, 'touch')).toEqual({ route: 'pass', abortLive: true })
    expect(zoom.down(3, 'touch')).toEqual({ route: 'pass', abortLive: false })
  })

  it('remembers the state on the device and ignores anything unreadable', () => {
    expect(PEN_PREFS_KEY.startsWith('ieum-mobile-pdf-')).toBe(true)
    expect(loadPenPrefs(window.localStorage)).toEqual({ penSeen: false, fingerDraws: false })
    savePenPrefs({ penSeen: true, fingerDraws: true }, window.localStorage)
    expect(JSON.parse(window.localStorage.getItem(PEN_PREFS_KEY)!)).toEqual({
      penSeen: true,
      fingerDraws: true,
    })
    expect(loadPenPrefs(window.localStorage)).toEqual({ penSeen: true, fingerDraws: true })
    for (const junk of ['{', '42', 'null', '{"penSeen":"yes"}']) {
      window.localStorage.setItem(PEN_PREFS_KEY, junk)
      expect(loadPenPrefs(window.localStorage)).toEqual({ penSeen: false, fingerDraws: false })
    }
  })
})

// ── same drawings as the PC layer ───────────────────────────────────────────

describe('drawings match the PC DrawLayer', () => {
  const GEOMS: { geom: PageGeom; scale: number }[] = [
    { geom: { pw: 400, ph: 500, rot: 0 }, scale: 1.5 },
    { geom: { pw: 400, ph: 500, rot: 90, x0: 10, y0: 20 }, scale: 0.75 },
  ]
  const PATHS: Record<DrawShapeTool, [number, number][]> = {
    ink: [
      [10, 10],
      [20, 15],
      [30, 25],
      [45, 40],
    ],
    rect: [
      [100, 120],
      [60, 50],
      [20, 30],
    ],
    ellipse: [
      [20, 30],
      [140, 90],
    ],
    line: [
      [10, 10],
      [80, 90],
    ],
    arrow: [
      [80, 90],
      [10, 200],
    ],
  }
  const RED: [number, number, number] = [0.86, 0.22, 0.18]

  function pcRecord(tool: DrawTool, geom: PageGeom, scale: number, path: [number, number][]) {
    const commits: DrawingInput[] = []
    const host = mount(
      <DrawLayer
        geom={geom}
        scale={scale}
        pageWidth={400}
        pageHeight={500}
        drawings={[]}
        savedNotes={[]}
        activeNoteKey={null}
        tool={tool}
        color={RED}
        strokeWidth={2}
        selectedId={null}
        selectTitle=""
        noteOpenTitle=""
        onCommit={(input) => commits.push(input)}
        onNoteAt={() => {}}
        onNoteOpen={() => {}}
        onSelect={() => {}}
      />,
    )
    stroke(host.querySelector('svg.pdf-draw-layer')!, 1, 'mouse', path)
    return commits
  }

  function mobileRecord(
    tool: DrawShapeTool,
    geom: PageGeom,
    scale: number,
    path: [number, number][],
    kind: Kind = 'mouse',
  ) {
    const commits: { pageIndex: number; input: DrawingInput }[] = []
    const host = mount(
      <DrawPageLayer
        page={{
          pageIndex: 3,
          geom,
          scale,
          width: 400 * scale,
          height: 500 * scale,
          rendered: true,
        }}
        drawings={[]}
        active
        tool={tool}
        style={{ color: RED, width: 2 }}
        fingerDraws
        router={createPenInputRouter()}
        onCommit={(pageIndex, input) => commits.push({ pageIndex, input })}
        onErase={() => {}}
      />,
    )
    stroke(host.querySelector('[data-testid="pdf-draw-layer-3"]')!, 1, kind, path)
    return commits
  }

  for (const tool of Object.keys(PATHS) as DrawShapeTool[]) {
    it(`records the same ${tool} as the PC for the same pointer path`, () => {
      for (const { geom, scale } of GEOMS) {
        const pc = pcRecord(tool, geom, scale, PATHS[tool])
        expect(pc).toHaveLength(1)
        for (const kind of ['mouse', 'pen', 'touch'] as const) {
          const mobile = mobileRecord(tool, geom, scale, PATHS[tool], kind)
          expect(mobile).toEqual([{ pageIndex: 3, input: pc[0] }])
        }
      }
    })
  }

  it('drops a click-and-release exactly like the PC', () => {
    const { geom, scale } = GEOMS[0]!
    const taps: Record<DrawShapeTool, [number, number][]> = {
      ink: [
        [10, 10],
        [11, 11],
      ],
      rect: [
        [10, 10],
        [12, 12],
      ],
      ellipse: [[10, 10]],
      line: [
        [10, 10],
        [13, 12],
      ],
      arrow: [
        [10, 10],
        [10, 10],
      ],
    }
    for (const tool of Object.keys(taps) as DrawShapeTool[]) {
      expect(pcRecord(tool, geom, scale, taps[tool])).toEqual([])
      expect(mobileRecord(tool, geom, scale, taps[tool])).toEqual([])
    }
  })

  it('builds each kind with the PC DrawingInput fields', () => {
    const style = { color: RED, width: 4 }
    const ink = startStroke('ink', [1, 2], style)
    ink.move([3, 4])
    ink.move([5, 6])
    expect(ink.finish()).toEqual({
      kind: 'ink',
      pageIndex: 0,
      color: RED,
      width: 4,
      paths: [[1, 2, 3, 4, 5, 6]],
    })
    const rect = startStroke('rect', [50, 60], style)
    rect.move([10, 20])
    expect(rect.finish()).toEqual({
      kind: 'rect',
      pageIndex: 0,
      color: RED,
      width: 4,
      rect: [10, 20, 50, 60],
    })
    const arrow = startStroke('arrow', [0, 0], style)
    arrow.move([30, 40])
    expect(arrow.finish()).toMatchObject({ kind: 'arrow', from: [0, 0], to: [30, 40] })
  })
})

// ── in the editor ───────────────────────────────────────────────────────────

describe('drawing in the editor', () => {
  it('changes nothing outside edit mode, but still shows pending drawings', async () => {
    const { doc, edit } = await startDoc()
    edit.services.dispatch([
      {
        op: 'addDrawing',
        drawing: {
          kind: 'rect',
          pageIndex: 0,
          color: [1, 0, 0],
          width: 2,
          rect: [50, 50, 150, 120],
        },
      },
    ])
    const host = mountWorkspace(doc, 'view')
    expect(host.querySelector('[data-testid="pdf-tool-pen"]')).toBeNull()
    const layer = layerOf(host)!
    expect(layer.getAttribute('data-active')).toBe('false')
    expect(layer.querySelectorAll('rect')).toHaveLength(1)
    const before = edit.store.getSnapshot()
    stroke(layer, 1, 'touch', [
      [10, 10],
      [40, 40],
      [80, 90],
    ])
    stroke(layer, 2, 'pen', [
      [10, 10],
      [40, 40],
      [80, 90],
    ])
    expect(edit.store.getSnapshot()).toBe(before)
    expect(window.localStorage.getItem(PEN_PREFS_KEY)).toBeNull()
    expect(document.querySelector('[data-testid="pdf-draw-sheet"]')).toBeNull()
  })

  it('opens the [Pen] sheet with tools, colors, widths and the finger switch', async () => {
    const { doc } = await startDoc()
    const host = mountWorkspace(doc)
    // no layer until the tool is on (nothing pending)
    expect(layerOf(host)).toBeNull()
    pressPen(host)
    const sheet = document.querySelector('[data-testid="pdf-draw-sheet"]')!
    expect(sheet).not.toBeNull()
    expect(
      [...sheet.querySelectorAll('[data-testid^="pdf-draw-tool-"]')].map((b) => b.textContent),
    ).toEqual(
      (
        [
          'pdfDrawPen',
          'pdfDrawRect',
          'pdfDrawEllipse',
          'pdfDrawLine',
          'pdfDrawArrow',
          'pdfDrawEraser',
        ] as const
      ).map((key) => tr(key)),
    )
    expect(sheet.querySelectorAll('[data-testid^="pdf-draw-color-"]')).toHaveLength(5)
    expect(sheet.querySelectorAll('[data-testid^="pdf-draw-width-"]')).toHaveLength(4)
    expect(sheet.querySelector('[data-testid="pdf-draw-finger-switch"]')).not.toBeNull()
    expect(layerOf(host)!.getAttribute('data-active')).toBe('true')

    // closing the sheet keeps the tool on; the floating button reopens it
    click('[data-testid="pdf-draw-sheet"] .mobile-sheet-header button')
    expect(document.querySelector('[data-testid="pdf-draw-sheet"]')).toBeNull()
    expect(layerOf(host)!.getAttribute('data-active')).toBe('true')
    click('[data-testid="pdf-draw-settings"]')
    expect(document.querySelector('[data-testid="pdf-draw-sheet"]')).not.toBeNull()

    // turning the tool off hides the sheet, the button and the empty layer
    pressPen(host)
    expect(document.querySelector('[data-testid="pdf-draw-sheet"]')).toBeNull()
    expect(document.querySelector('[data-testid="pdf-draw-settings"]')).toBeNull()
    expect(layerOf(host)).toBeNull()
  })

  it('draws with a finger before any pen, then only the pen draws until the switch is on', async () => {
    const { doc, edit } = await startDoc()
    const host = mountWorkspace(doc)
    pressPen(host)
    const layer = layerOf(host)!
    const scale = scaleOf(layer)
    expect(layer.style.touchAction).toBe('none')

    stroke(layer, 1, 'touch', [
      [30, 30],
      [60, 45],
      [90, 75],
    ])
    expect(edit.store.getSnapshot().drawings).toHaveLength(1)
    expect(edit.store.getSnapshot().drawings[0]!.input).toEqual({
      kind: 'ink',
      pageIndex: 0,
      color: [0.86, 0.22, 0.18],
      width: 2,
      paths: [
        [30 / scale, 500 - 30 / scale, 60 / scale, 500 - 45 / scale, 90 / scale, 500 - 75 / scale],
      ],
    })
    expect(window.localStorage.getItem(PEN_PREFS_KEY)).toBeNull()

    stroke(layer, 2, 'pen', [
      [30, 130],
      [60, 145],
      [90, 175],
    ])
    expect(edit.store.getSnapshot().drawings).toHaveLength(2)
    expect(loadPenPrefs()).toEqual({ penSeen: true, fingerDraws: false })
    expect(layerOf(host)!.style.touchAction).toBe('pan-x pan-y')

    // the finger now moves the view: not captured, not prevented, nothing drawn
    const down = pointer(layer, 'pointerdown', 3, 'touch', 30, 230)
    expect(down.defaultPrevented).toBe(false)
    pointer(layer, 'pointermove', 3, 'touch', 60, 245)
    pointer(layer, 'pointermove', 3, 'touch', 90, 275)
    pointer(layer, 'pointerup', 3, 'touch', 90, 275)
    expect(edit.store.getSnapshot().drawings).toHaveLength(2)

    // the switch: the finger draws again, remembered on the device
    const toggle = document.querySelector<HTMLInputElement>(
      '[data-testid="pdf-draw-finger-switch"]',
    )!
    expect(toggle.checked).toBe(false)
    act(() => toggle.click())
    expect(loadPenPrefs()).toEqual({ penSeen: true, fingerDraws: true })
    expect(layerOf(host)!.style.touchAction).toBe('none')
    stroke(layer, 4, 'touch', [
      [30, 330],
      [60, 345],
      [90, 375],
    ])
    expect(edit.store.getSnapshot().drawings).toHaveLength(3)
  })

  it('starts from the remembered state in the next document', async () => {
    savePenPrefs({ penSeen: true, fingerDraws: false })
    const { doc, edit } = await startDoc()
    const host = mountWorkspace(doc)
    pressPen(host)
    const layer = layerOf(host)!
    expect(layer.style.touchAction).toBe('pan-x pan-y')
    stroke(layer, 1, 'touch', [
      [30, 30],
      [60, 45],
      [90, 75],
    ])
    expect(edit.store.getSnapshot().drawings).toHaveLength(0)
    expect(
      document.querySelector<HTMLInputElement>('[data-testid="pdf-draw-finger-switch"]')!.checked,
    ).toBe(false)
  })

  it('ignores the palm while the pen is down', async () => {
    savePenPrefs({ penSeen: true, fingerDraws: true })
    const { doc, edit } = await startDoc()
    const host = mountWorkspace(doc)
    pressPen(host)
    const layer = layerOf(host)!

    pointer(layer, 'pointerdown', 1, 'pen', 30, 30)
    // the palm's touches can neither draw nor scroll nor start a zoom
    const touch = new TouchEvent('touchstart', { bubbles: true, cancelable: true })
    act(() => void layer.dispatchEvent(touch))
    expect(touch.defaultPrevented).toBe(true)
    const palm = pointer(layer, 'pointerdown', 2, 'touch', 200, 200)
    expect(palm.defaultPrevented).toBe(true)
    pointer(layer, 'pointermove', 2, 'touch', 220, 230)
    pointer(layer, 'pointermove', 1, 'pen', 60, 50)
    pointer(layer, 'pointermove', 2, 'touch', 240, 260)
    pointer(layer, 'pointermove', 1, 'pen', 90, 80)
    pointer(layer, 'pointerup', 2, 'touch', 240, 260)
    pointer(layer, 'pointerup', 1, 'pen', 90, 80)

    const drawings = edit.store.getSnapshot().drawings
    expect(drawings).toHaveLength(1)
    const ink = drawings[0]!.input as Extract<DrawingInput, { kind: 'ink' }>
    expect(ink.paths[0]).toHaveLength(6)

    // with no pen down, touches are the finger's again
    const free = new TouchEvent('touchstart', { bubbles: true, cancelable: true })
    act(() => void layer.dispatchEvent(free))
    expect(free.defaultPrevented).toBe(false)
  })

  it('drops the palm stroke when the pen lands, and a stroke that turns into a two-finger zoom', async () => {
    const { doc, edit } = await startDoc()
    const host = mountWorkspace(doc)
    pressPen(host)
    const layer = layerOf(host)!

    pointer(layer, 'pointerdown', 1, 'touch', 200, 200)
    pointer(layer, 'pointermove', 1, 'touch', 220, 220)
    pointer(layer, 'pointermove', 1, 'touch', 240, 240)
    stroke(layer, 2, 'pen', [
      [30, 30],
      [60, 50],
      [90, 80],
    ])
    pointer(layer, 'pointermove', 1, 'touch', 260, 260)
    pointer(layer, 'pointerup', 1, 'touch', 260, 260)
    expect(edit.store.getSnapshot().drawings).toHaveLength(1)
    expect(edit.store.getSnapshot().drawings[0]!.input).toMatchObject({
      kind: 'ink',
      paths: [expect.any(Array)],
    })

    // with the switch on, a second finger turns the stroke into a zoom
    act(() =>
      document.querySelector<HTMLInputElement>('[data-testid="pdf-draw-finger-switch"]')!.click(),
    )
    pointer(layer, 'pointerdown', 3, 'touch', 100, 300)
    pointer(layer, 'pointermove', 3, 'touch', 120, 320)
    pointer(layer, 'pointermove', 3, 'touch', 140, 340)
    pointer(layer, 'pointerdown', 4, 'touch', 200, 300)
    pointer(layer, 'pointermove', 3, 'touch', 100, 380)
    pointer(layer, 'pointerup', 3, 'touch', 100, 380)
    pointer(layer, 'pointerup', 4, 'touch', 200, 300)
    expect(edit.store.getSnapshot().drawings).toHaveLength(1)
  })

  it('draws the chosen shape, color and width as a PC addDrawing', async () => {
    const { doc, edit } = await startDoc(['One', 'Two'])
    const host = mountWorkspace(doc)
    pressPen(host)
    click('[data-testid="pdf-draw-tool-arrow"]')
    click('[data-testid="pdf-draw-color-blue"]')
    click('[data-testid="pdf-draw-width-4"]')
    expect(
      document.querySelector('[data-testid="pdf-draw-color-blue"]')!.getAttribute('aria-checked'),
    ).toBe('true')
    const layer = layerOf(host, 1)!
    const scale = scaleOf(layer)
    stroke(layer, 1, 'pen', [
      [20, 20],
      [120, 220],
    ])
    expect(edit.store.getSnapshot().drawings.map((d) => d.input)).toEqual([
      {
        kind: 'arrow',
        pageIndex: 1,
        color: [0.17, 0.4, 1],
        width: 4,
        from: [20 / scale, 500 - 20 / scale],
        to: [120 / scale, 500 - 220 / scale],
        label: '',
      },
    ])
    // one stroke is one undo step
    act(() => void edit.store.undo())
    expect(edit.store.getSnapshot().drawings).toEqual([])
  })

  it('erases whole pending strokes and shapes under the eraser, one undo step per swipe', async () => {
    const { doc, edit } = await startDoc()
    const ops: Op[] = [
      {
        op: 'addDrawing',
        drawing: {
          kind: 'rect',
          pageIndex: 0,
          color: [1, 0, 0],
          width: 2,
          rect: [50, 300, 150, 400],
        },
      },
      {
        op: 'addDrawing',
        drawing: {
          kind: 'ink',
          pageIndex: 0,
          color: [0, 0, 1],
          width: 2,
          paths: [[200, 300, 250, 350, 300, 300]],
        },
      },
      {
        op: 'addDrawing',
        drawing: {
          kind: 'line',
          pageIndex: 0,
          color: [0, 0, 0],
          width: 2,
          from: [50, 50],
          to: [350, 50],
        },
      },
    ]
    edit.services.dispatch(ops)
    const ids = edit.store.getSnapshot().drawings.map((d) => d.id)
    const host = mountWorkspace(doc)
    pressPen(host)
    click('[data-testid="pdf-draw-tool-eraser"]')
    expect(document.querySelector('[data-testid="pdf-draw-eraser-hint"]')?.textContent).toBe(
      tr('pdfDrawEraserHint'),
    )
    const layer = layerOf(host)!
    expect(layer.querySelectorAll('[data-drawing-id]')).toHaveLength(3)
    const scale = scaleOf(layer)
    const geom: PageGeom = { pw: 400, ph: 500, rot: 0, x0: 0, y0: 0, userUnit: 1 }
    const at = (x: number, y: number): [number, number] => {
      const [vx, vy] = pdfToView(geom, x, y)
      return [vx * scale, vy * scale]
    }

    // empty paper: nothing
    stroke(layer, 1, 'touch', [at(100, 200), at(110, 210)])
    expect(edit.store.getSnapshot().drawings).toHaveLength(3)
    // inside the rectangle but away from its outline: nothing
    stroke(layer, 2, 'touch', [at(100, 350)])
    expect(edit.store.getSnapshot().drawings).toHaveLength(3)

    // one swipe across the rectangle's edge and the ink
    stroke(layer, 3, 'touch', [at(150, 350), at(200, 330), at(250, 350)])
    expect(edit.store.getSnapshot().drawings.map((d) => d.id)).toEqual([ids[2]])
    expect(edit.store.getSnapshot().annotDeletes).toEqual([])
    act(() => void edit.store.undo())
    expect(edit.store.getSnapshot().drawings.map((d) => d.id)).toEqual(ids)

    // a pen erases too
    stroke(layer, 4, 'pen', [at(200, 50)])
    expect(edit.store.getSnapshot().drawings.map((d) => d.id)).toEqual([ids[0], ids[1]])
  })

  it('saves a drawn stroke as the PC writes it', async () => {
    const { doc, edit, fake } = await startDoc()
    const host = mountWorkspace(doc)
    pressPen(host)
    stroke(layerOf(host)!, 1, 'touch', [
      [30, 30],
      [60, 45],
      [90, 75],
    ])
    click('[data-testid="pdf-draw-tool-ellipse"]')
    stroke(layerOf(host)!, 2, 'touch', [
      [100, 100],
      [200, 180],
    ])
    expect(edit.store.getSnapshot().drawings.map((d) => d.input.kind)).toEqual(['ink', 'ellipse'])
    await act(async () => {
      expect(await edit.services.saveNow()).toBe(true)
    })
    expect(await annotSubtypes(fake.saved.at(-1)!)).toEqual(['/Ink', '/Circle'])
  }, 60_000)

  it('tells the person when a drawing is refused', async () => {
    const { doc, edit, fake } = await startDoc()
    const host = mountWorkspace(doc)
    pressPen(host)
    edit.store.setLocked(true)
    stroke(layerOf(host)!, 1, 'touch', [
      [30, 30],
      [60, 45],
      [90, 75],
    ])
    edit.store.setLocked(false)
    expect(edit.store.getSnapshot().drawings).toEqual([])
    expect(fake.toasts.at(-1)).toBe(tr('pdfDrawRefused'))
  })
})
