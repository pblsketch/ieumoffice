// Mobile PDF edit frame (track T2, PDF-T4): pending edits through the PC op registry,
// undo/redo, save / Save As (annotation handling and the PC guards) through the engine,
// recovery copies on the PC scheduler rules, the edit bar and the feature slots.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib'
import type { ActiveDocState } from '@genoffice/mobile-bridge/session-state'
import type { MobileClient, MobileDocSession } from '@genoffice/mobile-bridge/transport'
import { MobileCommandError } from '@genoffice/mobile-bridge/transport'
import { encryptDocument } from '../../pdf/src/main/pdf-crypt'
import type { SavePdfRequest } from '../../pdf/src/shared/ipc'
import type { EditorHost } from '../src/renderer/editors/editorKind'
import {
  assertAnnotationChoice,
  buildSavePdfRequest,
  createRecoveryGate,
  emptyEditSnapshot,
  PDF_FEATURE_ORDER,
  PDF_FEATURES,
  startPdfEditDocument,
  type Op,
  type PdfEditDocument,
  type PdfFeature,
  type PdfFeatureContext,
  type PdfFeatureSet,
} from '../src/renderer/editors/pdf/edit'
import { setEngineAssetLoader } from '../src/renderer/editors/pdf/engine/assets'
import { setSharedPdfEngine, type PdfEngine } from '../src/renderer/editors/pdf/engine'
import { createInThreadPdfEngine } from '../src/renderer/editors/pdf/engine/inThread'
import { createPdfEditorKind } from '../src/renderer/editors/pdf/kind'
import type { PdfOpenedDocument } from '../src/renderer/editors/pdf/view/model'
import { openPdfModel } from '../src/renderer/editors/pdf/view/openPdf'
import { pcBlankPdfBytes, pcUnlockProbe } from '../src/renderer/editors/pdf/view/pcEngineHooks'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { translateMobile } from '../src/renderer/i18n/strings'

const mobileRequire = createRequire(join(resolve(__dirname, '..'), 'package.json'))

// ── fixtures ────────────────────────────────────────────────────────────────

async function textPdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const text of pages) {
    doc.addPage([400, 500]).drawText(text, { x: 40, y: 400, size: 14, font })
  }
  return doc.save({ useObjectStreams: false })
}

const highlightOp = (pageIndex = 0): Op => ({
  op: 'addMarkup',
  markup: {
    pageIndex,
    type: 'highlight',
    color: [1, 0.87, 0.35],
    quads: [[40, 420, 200, 420, 40, 398, 200, 398]],
  },
})

const rectOp = (pageIndex = 0): Op => ({
  op: 'addDrawing',
  drawing: { kind: 'rect', pageIndex, color: [1, 0, 0], width: 2, rect: [50, 50, 150, 120] },
})

async function annotSubtypes(bytes: Uint8Array, password?: string): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: password !== undefined,
    updateMetadata: false,
  })
  const out: string[] = []
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) continue
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookup(i, PDFDict)
      out.push(String(annot.get(PDFName.of('Subtype'))))
    }
  }
  return out
}

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1')
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

function docState(s: MobileDocSession, over: Partial<ActiveDocState> = {}): ActiveDocState {
  return {
    session: s,
    dirty: true,
    encrypted: false,
    distribution: false,
    trackingDropped: false,
    isUntitled: false,
    ...over,
  }
}

interface FakeClient {
  readonly client: MobileClient
  readonly saved: { sessionId: string; bytes: Uint8Array }[]
  readonly savedAs: { suggestedName: string; format: string; bytes: Uint8Array }[]
  readonly shared: { mode: string; bytes: Uint8Array | null }[]
  readonly recovery: { docKey: string; format: string; bytes: Uint8Array }[]
  failSave: unknown
  failRecovery: boolean
}

function fakeClient(fileBytes: Uint8Array | null = null): FakeClient {
  const state: FakeClient = {
    client: null as unknown as MobileClient,
    saved: [],
    savedAs: [],
    shared: [],
    recovery: [],
    failSave: null,
    failRecovery: false,
  }
  let nextSession = 2
  ;(state as { client: MobileClient }).client = {
    getAppPrefs: async () => ({
      lang: 'ko',
      theme: 'system',
      hwpDefaultFormat: 'hwp',
      aiEnabled: false,
    }),
    readFileBytes: async () => ({ bytesBase64: fileBytes ? toBase64(fileBytes) : '' }),
    saveFileBytes: async (sessionId: string, bytesBase64: string) => {
      if (state.failSave) throw state.failSave
      state.saved.push({ sessionId, bytes: fromBase64(bytesBase64) })
      return {}
    },
    saveAsFileBytes: async (params: {
      suggestedName: string
      format: string
      bytesBase64: string
    }) => {
      state.savedAs.push({
        suggestedName: params.suggestedName,
        format: params.format,
        bytes: fromBase64(params.bytesBase64),
      })
      const n = nextSession++
      return session({ sessionId: `s${n}`, docKey: `k${n}`, name: params.suggestedName })
    },
    shareFile: async (params: { mode: string; bytesBase64?: string }) => {
      state.shared.push({
        mode: params.mode,
        bytes: params.bytesBase64 ? fromBase64(params.bytesBase64) : null,
      })
      return { ok: true }
    },
    recoveryWrite: async (params: { docKey: string; format: string; bytesBase64: string }) => {
      if (state.failRecovery) throw new Error('disk full')
      state.recovery.push({
        docKey: params.docKey,
        format: params.format,
        bytes: fromBase64(params.bytesBase64),
      })
      return { ok: true }
    },
    recoveryDiscard: async () => ({ ok: true }),
  } as unknown as MobileClient
  return state
}

function fakeHost(client: MobileClient) {
  const log = {
    dirty: [] as boolean[],
    toasts: [] as string[],
    notices: [] as (string | null)[],
    sessions: [] as { session: MobileDocSession; dirty: boolean; isUntitled: boolean }[],
    changed: 0,
  }
  const host: EditorHost = {
    client,
    markDirty: (dirty) => log.dirty.push(dirty),
    updateSession: (meta) => log.sessions.push(meta),
    setNotice: (text) => log.notices.push(text),
    showToast: (input) => log.toasts.push(typeof input === 'string' ? input : input.message),
    contentChanged: () => {
      log.changed += 1
    },
    refreshHome: async () => {},
    openSession: async () => {},
    translate: (key, params) => translateMobile('ko', key, params),
    windowClass: () => 'compact',
  }
  return { host, log }
}

/** An engine that records every save request and can be told to fail. */
function recordingEngine() {
  const inner = createInThreadPdfEngine()
  const requests: SavePdfRequest[] = []
  const applied: SavePdfRequest[] = []
  const control = { failSave: null as Error | null }
  const engine: PdfEngine = {
    ...inner,
    saveBytes: async (source, request) => {
      requests.push(request)
      if (control.failSave) throw control.failSave
      return inner.saveBytes(source, request)
    },
    applyEdits: async (source, request) => {
      applied.push(request)
      return inner.applyEdits(source, request)
    },
  }
  return { engine, requests, applied, control }
}

const opened: PdfOpenedDocument[] = []
const docs: PdfEditDocument[] = []

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

async function startDoc(
  bytes: Uint8Array,
  options: {
    sessionOver?: Partial<MobileDocSession>
    modelOver?: Partial<Parameters<typeof openPdfModel>[0]>
    now?: () => number
    features?: PdfFeatureSet
  } = {},
) {
  const fake = fakeClient(bytes)
  const { host, log } = fakeHost(fake.client)
  const s = session(options.sessionOver)
  const model = await openModel(bytes, { writable: s.writable, ...options.modelOver })
  const doc = startPdfEditDocument(host, model, {
    session: s,
    unlockProbe: pcUnlockProbe,
    now: options.now,
    features: options.features,
  })
  docs.push(doc)
  return { doc, fake, log, s, model, edit: doc.editSession }
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

function frameProps(over: { canEdit: boolean; aiEnabled: boolean; mode: 'view' | 'edit' }) {
  return {
    docTitle: 'sample.pdf',
    docFormat: 'pdf' as const,
    saveState: 'saved' as const,
    mode: over.mode,
    canEdit: over.canEdit,
    aiEnabled: over.aiEnabled,
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

function mountWorkspace(
  doc: PdfEditDocument,
  over: { canEdit?: boolean; aiEnabled?: boolean; mode?: 'view' | 'edit' } = {},
): HTMLElement {
  const props = { canEdit: true, aiEnabled: false, mode: 'edit' as const, ...over }
  const Workspace = doc.Workspace
  return mount(
    <Workspace
      frame={frameProps(props)}
      mode={props.mode}
      canEdit={props.canEdit}
      lang="ko"
      theme="dark"
    />,
  )
}

let recorder: ReturnType<typeof recordingEngine>

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
  vi.unstubAllGlobals()
})

// ── pending edits and undo ──────────────────────────────────────────────────

describe('pending edits', () => {
  it('runs ops through the PC registry, one undo step per batch, and marks the document unsaved', async () => {
    const { edit, log } = await startDoc(await textPdf(['Hello']))
    const plan = edit.services.dispatch([highlightOp(), rectOp()])
    expect(plan.failures).toEqual([])
    expect(edit.store.getSnapshot().markups).toHaveLength(1)
    expect(edit.store.getSnapshot().drawings).toHaveLength(1)
    expect(log.dirty.at(-1)).toBe(true)
    expect(log.changed).toBeGreaterThan(0)

    edit.services.dispatch([rectOp()])
    expect(edit.store.getSnapshot().drawings).toHaveLength(2)
    expect(edit.store.undo()).toBe(true)
    expect(edit.store.getSnapshot().drawings).toHaveLength(1)
    expect(edit.store.undo()).toBe(true)
    expect(edit.store.hasEdits()).toBe(false)
    // undoing everything leaves nothing to save
    expect(log.dirty.at(-1)).toBe(false)
    expect(edit.store.redo()).toBe(true)
    expect(edit.store.redo()).toBe(true)
    expect(edit.store.getSnapshot().drawings).toHaveLength(2)
    expect(edit.store.canRedo()).toBe(false)
  })

  it('refuses an invalid batch as a whole and folds repeats with the same coalesce key', async () => {
    const { edit } = await startDoc(await textPdf(['Hello']))
    const bad = edit.services.dispatch([rectOp(), rectOp(7)])
    expect(bad.failures).toHaveLength(1)
    expect(edit.store.hasEdits()).toBe(false)

    edit.services.dispatch([rectOp()], { coalesceKey: 'drag' })
    edit.services.dispatch([rectOp()], { coalesceKey: 'drag' })
    expect(edit.store.getSnapshot().drawings).toHaveLength(2)
    edit.store.undo()
    expect(edit.store.hasEdits()).toBe(false)
  })
})

// ── save ────────────────────────────────────────────────────────────────────

describe('save', () => {
  it('writes nothing when nothing changed', async () => {
    const { doc, fake, s } = await startDoc(await textPdf(['Hello']))
    expect(await doc.save!(docState(s, { dirty: false }), false)).toBe(true)
    expect(fake.saved).toHaveLength(0)
    expect(fake.savedAs).toHaveLength(0)
    expect(recorder.requests).toHaveLength(0)
  })

  it('saves pending edits through the engine and saveFileBytes, then reloads and starts a new history', async () => {
    const { doc, edit, fake, log, s, model } = await startDoc(await textPdf(['Hello']))
    edit.services.dispatch([highlightOp(), rectOp()])
    expect(await doc.save!(docState(s), false)).toBe(true)

    expect(recorder.requests).toHaveLength(1)
    const request = recorder.requests[0]!
    expect(request.markups).toHaveLength(1)
    expect(request.drawings).toEqual([expect.objectContaining({ kind: 'rect' })])
    expect(request.protectionDirty).toBe(false)
    // an in-place save never carries annotation handling (PC guard)
    expect(request.annotations).toBeUndefined()
    expect(request.decryption).toBeUndefined()

    expect(fake.saved).toHaveLength(1)
    expect(fake.saved[0]!.sessionId).toBe('s1')
    expect(await annotSubtypes(fake.saved[0]!.bytes)).toEqual(['/Highlight', '/Square'])

    // the view now shows the file: a new model from the written bytes, nothing pending
    const reloaded = edit.getModel()
    expect(reloaded).not.toBe(model)
    expect(latin1(reloaded.originalBytes)).toBe(latin1(fake.saved[0]!.bytes))
    expect(edit.store.hasEdits()).toBe(false)
    expect(edit.store.canUndo()).toBe(false)
    expect(log.dirty.at(-1)).toBe(false)
    expect(log.toasts).toContain(translateMobile('ko', 'savedNotice'))
  })

  it('keeps the edits and writes nothing when the save verification fails', async () => {
    const { doc, edit, fake, log, s, model } = await startDoc(await textPdf(['Hello']))
    edit.services.dispatch([rectOp()])
    recorder.control.failSave = new Error(
      'save-verify-failed pages=1: text edit did not land; the file was not written',
    )
    expect(await doc.save!(docState(s), false)).toBe(false)
    expect(fake.saved).toHaveLength(0)
    expect(edit.store.hasEdits()).toBe(true)
    expect(edit.store.canUndo()).toBe(true)
    expect(edit.getModel()).toBe(model)
    expect(log.toasts.at(-1)).toBe(translateMobile('ko', 'pdfEditSaveVerifyFailed', { pages: '1' }))
  })

  it('keeps the edits when the file write is refused', async () => {
    const { doc, edit, fake, log, s, model } = await startDoc(await textPdf(['Hello']))
    edit.services.dispatch([rectOp()])
    fake.failSave = new MobileCommandError({ code: 'IO_ERROR', messageKey: 'io' } as never)
    expect(await doc.save!(docState(s), false)).toBe(false)
    expect(edit.store.hasEdits()).toBe(true)
    expect(edit.getModel()).toBe(model)
    expect(log.toasts.at(-1)).toBe(translateMobile('ko', 'pdfEditSaveFailed'))
  })

  it('blocks edits while a save is writing', async () => {
    const { doc, edit, s } = await startDoc(await textPdf(['Hello']))
    edit.services.dispatch([rectOp()])
    const saving = doc.save!(docState(s), false)
    expect(edit.isSaving()).toBe(true)
    // the store is locked from the start of the write until the reload
    const refused = edit.services.dispatch([rectOp()])
    expect(refused.failures).toHaveLength(1)
    expect(await saving).toBe(true)
    expect(edit.store.hasEdits()).toBe(false)
  })
})

// ── Save As ─────────────────────────────────────────────────────────────────

/** A one-page PDF that already holds a saved highlight (written by the engine itself). */
async function pdfWithHighlight(): Promise<Uint8Array> {
  const source = await textPdf(['Hello'])
  const model = await openModel(source)
  const markup = highlightOp().markup as SavePdfRequest['markups'][number]
  const request = buildSavePdfRequest(
    { ...emptyEditSnapshot(), markups: [{ id: 'm1', ...markup }] },
    model,
  )
  return (await createInThreadPdfEngine().saveBytes(source, request)).bytes
}

describe('Save As', () => {
  it('asks how the copy handles annotations: keep, flatten, strip', async () => {
    const source = await pdfWithHighlight()
    expect(await annotSubtypes(source)).toEqual(['/Highlight'])
    const outcomes: Record<string, string[]> = {}
    for (const choice of ['keep', 'flatten', 'strip'] as const) {
      const { doc, edit, fake, s } = await startDoc(source)
      edit.services.dispatch([rectOp()])
      const prompt = vi.fn(async () => choice)
      edit.setAnnotationPrompt(prompt)
      expect(await doc.save!(docState(s), true)).toBe(true)
      expect(prompt).toHaveBeenCalledTimes(1)
      const request = recorder.requests.at(-1)!
      expect(request.annotations).toBe(choice === 'keep' ? undefined : choice)
      expect(fake.saved).toHaveLength(0)
      expect(fake.savedAs).toHaveLength(1)
      expect(fake.savedAs[0]!.format).toBe('pdf')
      expect(fake.savedAs[0]!.suggestedName).toBe('sample.pdf')
      outcomes[choice] = await annotSubtypes(fake.savedAs[0]!.bytes)
      // the document now lives in the new file
      expect(edit.getSession().sessionId).not.toBe('s1')
    }
    expect(outcomes.keep).toEqual(['/Highlight', '/Square'])
    // baked into the page content: no annotation objects left
    expect(outcomes.flatten).toEqual([])
    // comment annotations left out
    expect(outcomes.strip).toEqual([])
  }, 60_000)

  it('copies the original bytes unchanged when there is nothing pending', async () => {
    const source = await textPdf(['Hello'])
    const { doc, edit, fake, s } = await startDoc(source)
    edit.setAnnotationPrompt(async () => 'keep')
    expect(await doc.save!(docState(s, { dirty: false }), true)).toBe(true)
    expect(recorder.requests).toHaveLength(0)
    expect(latin1(fake.savedAs[0]!.bytes)).toBe(latin1(source))
  })

  it('returns without writing when the sheet is cancelled', async () => {
    const { doc, edit, fake, s } = await startDoc(await textPdf(['Hello']))
    edit.services.dispatch([rectOp()])
    edit.setAnnotationPrompt(async () => null)
    expect(await doc.save!(docState(s), true)).toBe(false)
    expect(fake.savedAs).toHaveLength(0)
    expect(edit.store.hasEdits()).toBe(true)
  })

  it('enforces the PC guards: annotation handling only on Save As, never on a protected document', async () => {
    expect(() =>
      assertAnnotationChoice({ inPlace: true, encrypted: false, annotations: 'flatten' }),
    ).toThrow(/requires Save As/)
    expect(() =>
      assertAnnotationChoice({ inPlace: false, encrypted: true, annotations: 'strip' }),
    ).toThrow(/without a password/)
    expect(() =>
      assertAnnotationChoice({ inPlace: true, encrypted: true, annotations: 'keep' }),
    ).not.toThrow()

    // an in-place save does not ask, even with a prompt in place
    const plain = await startDoc(await textPdf(['Hello']))
    const prompt = vi.fn(async () => 'flatten' as const)
    plain.edit.setAnnotationPrompt(prompt)
    plain.edit.services.dispatch([rectOp()])
    expect(await plain.doc.save!(docState(plain.s), false)).toBe(true)
    expect(prompt).not.toHaveBeenCalled()
    expect(recorder.requests.at(-1)!.annotations).toBeUndefined()
  })

  it("keeps an encrypted document's protection and never asks about annotations", async () => {
    const plainDoc = await PDFDocument.load(await textPdf(['Secret page']))
    encryptDocument(plainDoc, {
      userPassword: 'user1',
      ownerPassword: 'owner1',
      permissions: { printing: true, modifying: true, annotating: true, copying: true },
    })
    const source = await plainDoc.save({ useObjectStreams: false })
    const { doc, edit, fake, s, model } = await startDoc(source, {
      modelOver: { askPassword: async ({ wrong }) => (wrong ? null : 'user1') },
    })
    expect(model.encrypted).toBe(true)
    expect(model.readOnlyReason).toBeNull()

    edit.services.dispatch([rectOp()])
    const prompt = vi.fn(async () => 'flatten' as const)
    edit.setAnnotationPrompt(prompt)
    expect(await doc.save!(docState(s), true)).toBe(true)
    expect(prompt).not.toHaveBeenCalled()
    const request = recorder.requests.at(-1)!
    expect(request.annotations).toBeUndefined()
    expect(request.decryption).toEqual({ userPassword: 'user1' })
    expect(request.protectionDirty).toBe(false)
    expect(latin1(fake.savedAs[0]!.bytes)).toContain('/Encrypt')
    // reopened with the same password, still editable
    expect(edit.getModel().encrypted).toBe(true)
    expect(edit.getModel().readOnlyReason).toBeNull()
  })
})

// ── untitled ────────────────────────────────────────────────────────────────

describe('untitled PDF', () => {
  it('makes the blank PDF without a global Buffer (the web view, through the stand-ins)', async () => {
    vi.stubGlobal('Buffer', undefined)
    const bytes = await pcBlankPdfBytes()
    vi.unstubAllGlobals()
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    expect(doc.getPage(0).getSize().width).toBeCloseTo(595.28)
  })

  it('opens a new blank PDF and its first save is Save As', async () => {
    const fake = fakeClient(null)
    const { host, log } = fakeHost(fake.client)
    const kind = createPdfEditorKind({ askPassword: () => async () => null })
    const s = session({ sessionId: 'u1', docKey: 'ku', name: '새 문서', writable: false })
    const opened = await kind.open({ session: s, client: fake.client, isUntitled: true })
    const doc = opened.start(host) as PdfEditDocument
    docs.push(doc)
    const model = doc.editSession.getModel()
    expect(model.isUntitled).toBe(true)
    expect(model.readOnlyReason).toBeNull()

    expect(await doc.save!(docState(s, { isUntitled: true }), false)).toBe(true)
    expect(fake.saved).toHaveLength(0)
    expect(fake.savedAs).toHaveLength(1)
    expect(fake.savedAs[0]!.suggestedName).toBe('새 문서.pdf')
    expect(latin1(fake.savedAs[0]!.bytes)).toBe(latin1(model.originalBytes))
    expect(log.sessions.at(-1)).toMatchObject({ isUntitled: false, dirty: false })
    expect(doc.editSession.getModel().isUntitled).toBe(false)
  })
})

// ── share ───────────────────────────────────────────────────────────────────

describe('share', () => {
  it('shares the edited bytes before a save, and the file itself when nothing is pending', async () => {
    const { doc, edit, fake, s } = await startDoc(await textPdf(['Hello']))
    await doc.share(docState(s, { dirty: false }))
    expect(fake.shared.at(-1)).toEqual({ mode: 'original', bytes: null })

    edit.services.dispatch([rectOp()])
    await doc.share(docState(s))
    const shared = fake.shared.at(-1)!
    expect(shared.mode).toBe('edited')
    expect(await annotSubtypes(shared.bytes!)).toEqual(['/Square'])
    expect(fake.saved).toHaveLength(0)
  })
})

// ── recovery copies ─────────────────────────────────────────────────────────

describe('recovery copies', () => {
  it('follow the PC scheduler rules inside the app calls', async () => {
    let now = 100_000
    const { doc, edit, fake, s } = await startDoc(await textPdf(['Hello']), { now: () => now })
    const write = () => doc.writeRecovery!(docState(s))

    await write()
    expect(fake.recovery).toHaveLength(0) // nothing pending

    edit.services.dispatch([rectOp()])
    now += 1_000
    await write()
    expect(fake.recovery).toHaveLength(0) // input has not paused 2 s yet
    now += 1_500
    await write()
    expect(fake.recovery).toHaveLength(1)
    expect(fake.recovery[0]!.format).toBe('pdf')
    expect(fake.recovery[0]!.docKey).toBe('k1')
    expect(await annotSubtypes(fake.recovery[0]!.bytes)).toEqual(['/Square'])

    now += 5_000
    await write()
    expect(fake.recovery).toHaveLength(1) // nothing changed since the copy

    edit.services.dispatch([highlightOp()])
    now += 3_000
    await write()
    expect(fake.recovery).toHaveLength(1) // about every 30 s at most
    now += 30_000
    await write()
    expect(fake.recovery).toHaveLength(2)

    // a failed write backs off for ten rounds, then tries again
    edit.services.dispatch([rectOp()])
    fake.failRecovery = true
    now += 31_000
    await write()
    fake.failRecovery = false
    now += 60_000
    await write()
    expect(fake.recovery).toHaveLength(2)
    now += 300_000
    await write()
    expect(fake.recovery).toHaveLength(3)

    // the app going to the background writes a due copy without waiting
    edit.services.dispatch([rectOp()])
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await write()
    expect(fake.recovery).toHaveLength(4)
  })

  it('waits while a save is writing', async () => {
    let now = 0
    const { doc, edit, fake, s } = await startDoc(await textPdf(['Hello']), { now: () => now })
    edit.services.dispatch([rectOp()])
    now += 3_000
    const saving = doc.save!(docState(s), false)
    await doc.writeRecovery!(docState(s))
    expect(fake.recovery).toHaveLength(0)
    await saving
  })

  it('are never written for an encrypted document, even an editable one', async () => {
    const plainDoc = await PDFDocument.load(await textPdf(['Secret page']))
    encryptDocument(plainDoc, {
      userPassword: 'user1',
      ownerPassword: 'owner1',
      permissions: { printing: true, modifying: true, annotating: true, copying: true },
    })
    let now = 0
    const { doc, edit, fake, s, model } = await startDoc(
      await plainDoc.save({ useObjectStreams: false }),
      { now: () => now, modelOver: { askPassword: async () => 'user1' } },
    )
    expect(model.readOnlyReason).toBeNull()
    edit.services.dispatch([rectOp()])
    now += 60_000
    await doc.writeRecovery!(docState(s))
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await doc.writeRecovery!(docState(s))
    expect(fake.recovery).toHaveLength(0)
    expect(recorder.applied).toHaveLength(0)
  })

  it('gate: spacing, pause and back-off', async () => {
    let now = 0
    const gate = createRecoveryGate({ now: () => now })
    expect(gate.due({ busy: false })).toBe(true) // revision 0 never copied: harmless, callers check edits
    gate.bump()
    expect(gate.due({ busy: false })).toBe(false)
    now = 2_000
    expect(gate.due({ busy: true })).toBe(false)
    expect(gate.due({ busy: false })).toBe(true)
    expect(await gate.run(async () => 'written')).toBe('written')
    expect(gate.due({ busy: false, flush: true })).toBe(false)
  })
})

// ── the edit bar and the feature slots ──────────────────────────────────────

const barButtons = (host: HTMLElement) =>
  [...host.querySelectorAll('[data-testid="phone-quick-toolbar"] button')].map(
    (button) => button.getAttribute('aria-label') ?? '',
  )

describe('edit bar', () => {
  const t = (key: Parameters<typeof translateMobile>[1]) => translateMobile('ko', key)

  it('shows exactly Pen, Highlighter, Text box, Sign and no AI slot while AI is off', async () => {
    const { doc } = await startDoc(await textPdf(['Hello']))
    const host = mountWorkspace(doc, { aiEnabled: false })
    expect(barButtons(host)).toEqual([
      t('pdfEditPen'),
      t('pdfEditHighlighter'),
      t('pdfEditTextBox'),
      t('pdfEditSign'),
    ])
    expect(host.querySelector('[data-testid="phone-ai-open-btn"]')).toBeNull()
  })

  it('puts the round AI button at the right end when AI is on', async () => {
    const { doc } = await startDoc(await textPdf(['Hello']))
    const host = mountWorkspace(doc, { aiEnabled: true })
    const buttons = [...host.querySelectorAll('[data-testid="phone-quick-toolbar"] button')]
    expect(buttons).toHaveLength(5)
    expect(buttons.at(-1)!.getAttribute('data-testid')).toBe('phone-ai-open-btn')
  })

  it('shows no bar for a read-only document', async () => {
    const { doc } = await startDoc(await textPdf(['Hello']), { sessionOver: { writable: false } })
    expect(doc.editSession.getModel().readOnlyReason).toBe('notWritable')
    const view = mountWorkspace(doc, { mode: 'view', canEdit: true })
    expect(view.querySelector('[data-testid="pdf-tool-pen"]')).toBeNull()
    expect(view.querySelector('[data-testid="editor-mode-toggle"]')).toBeNull()
    const edit = mountWorkspace(doc, { mode: 'edit', canEdit: true })
    expect(edit.querySelector('[data-testid="pdf-tool-pen"]')).toBeNull()
  })

  it('offers undo and redo in the app bar and the frame entries in the More sheet', async () => {
    const { doc, edit } = await startDoc(await textPdf(['Hello']))
    const host = mountWorkspace(doc)
    act(() => void edit.services.dispatch([rectOp()]))
    const undo = host.querySelector<HTMLButtonElement>(
      `.mobile-header-actions button[aria-label="${t('undo')}"]`,
    )!
    act(() => undo.click())
    expect(edit.store.hasEdits()).toBe(false)
    act(() =>
      host
        .querySelector<HTMLButtonElement>(
          `.mobile-header-actions button[aria-label="${t('redo')}"]`,
        )!
        .click(),
    )
    expect(edit.store.hasEdits()).toBe(true)

    act(() => host.querySelector<HTMLButtonElement>('[data-testid="editor-more-btn"]')!.click())
    expect(document.querySelector('[data-testid="editor-more-pdfEdit-pages"]')?.textContent).toBe(
      t('pdfEditPages'),
    )
    expect(document.querySelector('[data-testid="editor-more-pdfEdit-link"]')?.textContent).toBe(
      t('pdfEditLink'),
    )
  })

  it('asks Save As annotation handling in a sheet', async () => {
    const { doc, edit, fake, s } = await startDoc(await pdfWithHighlight())
    const host = mountWorkspace(doc)
    edit.services.dispatch([rectOp()])
    let saving!: Promise<boolean>
    act(() => {
      saving = doc.save!(docState(s), true)
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    const sheet = document.querySelector('[data-testid="pdf-save-as-sheet"]')
    expect(sheet).not.toBeNull()
    expect(
      document.querySelector('[data-testid="pdf-save-as-keep"]')?.getAttribute('aria-checked'),
    ).toBe('true')
    act(() =>
      document.querySelector<HTMLButtonElement>('[data-testid="pdf-save-as-strip"]')!.click(),
    )
    act(() =>
      document.querySelector<HTMLButtonElement>('[data-testid="pdf-save-as-confirm"]')!.click(),
    )
    await act(async () => {
      expect(await saving).toBe(true)
    })
    expect(recorder.requests.at(-1)!.annotations).toBe('strip')
    expect(await annotSubtypes(fake.savedAs[0]!.bytes)).toEqual([])
    expect(host).toBeTruthy()
  }, 60_000)
})

describe('feature slots', () => {
  it('registers seven empty features that render without error', async () => {
    expect(Object.keys(PDF_FEATURES).sort()).toEqual(
      ['annot', 'draw', 'form', 'link', 'pages', 'sign', 'text'].sort(),
    )
    expect([...PDF_FEATURE_ORDER].sort()).toEqual(Object.keys(PDF_FEATURES).sort())
    for (const [id, feature] of Object.entries(PDF_FEATURES)) expect(feature.id).toBe(id)
    const { doc } = await startDoc(await textPdf(['Hello', 'World']))
    const host = mountWorkspace(doc)
    expect(host.querySelectorAll('.m-pdf-page')).toHaveLength(2)
  })

  it('lets a feature read the document, dispatch ops with undo, draw overlays and stage extras, add rows and answer its bar button', async () => {
    const seen: PdfFeatureContext[] = []
    const probe: PdfFeature = {
      id: 'draw',
      useFeature(ctx) {
        seen.push(ctx)
        return {
          onToolPress: (active) => {
            if (active) ctx.services.dispatch([rectOp()])
          },
          renderPageOverlay: (page) => (
            <div data-testid={`probe-overlay-${page.pageIndex}`} data-width={page.width} />
          ),
          stageExtras: <div data-testid="probe-stage">{ctx.edits.drawings.length}</div>,
          moreItems: [{ id: 'probeRow', label: 'Probe', onPress: () => {} }],
        }
      },
    }
    const signHandler = vi.fn()
    const signer: PdfFeature = {
      id: 'sign',
      useFeature(ctx) {
        // a feature registers services from an effect-like spot; here once per render is fine
        if (seen.length === 1) ctx.services.registerSignatureHandler(signHandler)
        return {}
      },
    }
    const features: PdfFeatureSet = { ...PDF_FEATURES, draw: probe, sign: signer }
    const { doc, edit } = await startDoc(await textPdf(['Hello']), { features })
    const host = mountWorkspace(doc)

    const ctx = seen.at(-1)!
    expect(ctx.feature).toBe('draw')
    expect(ctx.editing).toBe(true)
    expect(ctx.model.pages).toHaveLength(1)
    expect(ctx.pageGeom(0)).toMatchObject({ pw: 400, ph: 500, rot: 0 })
    expect(host.querySelector('[data-testid="probe-overlay-0"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="probe-stage"]')?.textContent).toBe('0')

    act(() => host.querySelector<HTMLElement>('[data-testid="pdf-tool-pen"]')!.click())
    expect(seen.at(-1)!.toolActive).toBe(true)
    expect(seen.at(-1)!.activeTool).toBe('pen')
    expect(host.querySelector('[data-testid="pdf-tool-pen"]')?.getAttribute('data-active')).toBe(
      'true',
    )
    expect(host.querySelector('[data-testid="probe-stage"]')?.textContent).toBe('1')
    act(() => void edit.store.undo())
    expect(host.querySelector('[data-testid="probe-stage"]')?.textContent).toBe('0')

    act(() => host.querySelector<HTMLButtonElement>('[data-testid="editor-more-btn"]')!.click())
    expect(document.querySelector('[data-testid="editor-more-probeRow"]')).not.toBeNull()

    const target = {
      pageIndex: 0,
      rect: [10, 10, 100, 40] as [number, number, number, number],
      fieldName: 'Sig1',
    }
    await edit.services.requestSignature(target)
    expect(signHandler).toHaveBeenCalledWith(target)
  })

  it('tells the person when nothing can sign yet', async () => {
    const { edit, log } = await startDoc(await textPdf(['Hello']))
    await edit.services.requestSignature({ pageIndex: 0, rect: [0, 0, 1, 1], fieldName: 'S' })
    expect(log.toasts.at(-1)).toBe(translateMobile('ko', 'pdfEditSignatureUnavailable'))
  })

  it('reloads the same session from bytes a feature already wrote', async () => {
    const { edit, log, model } = await startDoc(await textPdf(['Hello']))
    edit.services.dispatch([rectOp()])
    await edit.services.reopenFromBytes(await textPdf(['One', 'Two']))
    expect(edit.getModel()).not.toBe(model)
    expect(edit.getModel().pages).toHaveLength(2)
    expect(edit.store.hasEdits()).toBe(false)
    expect(log.dirty.at(-1)).toBe(false)
  })

  it('writes bytes over the open file in place and reports a refused write', async () => {
    const { edit, fake, log, s } = await startDoc(await textPdf(['Hello']))
    const bytes = await textPdf(['One', 'Two'])
    await expect(edit.services.writeFileBytes(bytes)).resolves.toBe(true)
    expect(fake.saved.at(-1)?.sessionId).toBe(s.sessionId)
    expect(fake.saved.at(-1)?.bytes).toEqual(bytes)
    expect(fake.savedAs).toHaveLength(0)

    fake.failSave = new Error('write refused')
    await expect(edit.services.writeFileBytes(bytes)).resolves.toBe(false)
    expect(log.toasts.at(-1)).toBe(translateMobile('ko', 'pdfEditSaveFailed'))
  })

  it('picks a PDF through the web view file input, never the app document picker', async () => {
    const { pickPdfFile } = await import('../src/renderer/editors/pdf/edit')
    const created: HTMLInputElement[] = []
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = realCreate(tag)
      if (tag === 'input') {
        created.push(el as HTMLInputElement)
        vi.spyOn(el as HTMLInputElement, 'click').mockImplementation(() => {})
      }
      return el
    }) as typeof document.createElement)
    const picking = pickPdfFile()
    const input = created[0]!
    expect(input.type).toBe('file')
    expect(input.accept).toBe('application/pdf')
    const file = new File([new Uint8Array([37, 80, 68, 70])], 'other.pdf', {
      type: 'application/pdf',
    })
    Object.defineProperty(input, 'files', { value: [file] })
    input.onchange?.(new Event('change'))
    expect([...((await picking) ?? [])]).toEqual([37, 80, 68, 70])
  })
})
