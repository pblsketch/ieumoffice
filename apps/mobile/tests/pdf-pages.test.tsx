// Mobile PDF page operations (track T2, PDF-T10, spec 3.9): the organizer sheet writes
// PC page ops (rotatePages, deletePage, setPageOrder, insertBlankPage) as pending
// edits, keeps the last page, marks pending deletions on the viewer pages, and takes
// pages from another PDF only after a confirmation that saves the edits first.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import type { MobileClient, MobileDocSession } from '@genoffice/mobile-bridge/transport'
import { encryptDocument } from '../../pdf/src/main/pdf-crypt'
import type { EditorHost } from '../src/renderer/editors/editorKind'
import {
  emptyEditSnapshot,
  PDF_FEATURES,
  startPdfEditDocument,
  type PdfEditDocument,
  type PdfFeatureChrome,
  type PdfFeatureSet,
} from '../src/renderer/editors/pdf/edit'
import { createPdfEditStore } from '../src/renderer/editors/pdf/edit/editStore'
import { setEngineAssetLoader } from '../src/renderer/editors/pdf/engine/assets'
import { setSharedPdfEngine } from '../src/renderer/editors/pdf/engine'
import { createInThreadPdfEngine } from '../src/renderer/editors/pdf/engine/inThread'
import { pagesFeature } from '../src/renderer/editors/pdf/features/pages'
import {
  blankPageOp,
  checkPickedPdf,
  deleteOps,
  importAfterIndex,
  importBlockReason,
  moveOps,
  pageOrderOp,
  reorderVisible,
  rotateOps,
  runPdfImport,
} from '../src/renderer/editors/pdf/features/pages/pageOps'
import { pdfPageGeom, type PdfOpenedDocument } from '../src/renderer/editors/pdf/view/model'
import { openPdfModel } from '../src/renderer/editors/pdf/view/openPdf'
import { pcUnlockProbe } from '../src/renderer/editors/pdf/view/pcEngineHooks'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { translateMobile, type MobileStringKey } from '../src/renderer/i18n/strings'

const mobileRequire = createRequire(join(resolve(__dirname, '..'), 'package.json'))
const tk = (key: MobileStringKey, params?: Record<string, string | number>) =>
  translateMobile('ko', key, params)

// ── fixtures ────────────────────────────────────────────────────────────────

async function textPdf(pages: string[], size: [number, number] = [400, 500]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const text of pages) doc.addPage(size).drawText(text, { x: 40, y: 100, size: 14, font })
  return doc.save({ useObjectStreams: false })
}

async function encryptedPdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await textPdf(pages))
  encryptDocument(doc, {
    userPassword: 'user1',
    ownerPassword: 'owner1',
    permissions: { printing: true, modifying: true, annotating: true, copying: true },
  })
  return doc.save({ useObjectStreams: false })
}

async function pageInfo(bytes: Uint8Array): Promise<{ count: number; rotations: number[] }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  return { count: doc.getPageCount(), rotations: doc.getPages().map((p) => p.getRotation().angle) }
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

function fakeClient(fileBytes: Uint8Array) {
  const saved: { sessionId: string; bytes: Uint8Array }[] = []
  const savedAs: Uint8Array[] = []
  const client = {
    readFileBytes: async () => ({ bytesBase64: toBase64(fileBytes) }),
    saveFileBytes: async (sessionId: string, bytesBase64: string) => {
      saved.push({ sessionId, bytes: fromBase64(bytesBase64) })
      return {}
    },
    saveAsFileBytes: async (params: { bytesBase64: string }) => {
      savedAs.push(fromBase64(params.bytesBase64))
      return session({ sessionId: 's2', docKey: 'k2' })
    },
    recoveryWrite: async () => ({ ok: true }),
    recoveryDiscard: async () => ({ ok: true }),
    shareFile: async () => ({ ok: true }),
  } as unknown as MobileClient
  return { client, saved, savedAs }
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

async function startDoc(
  bytes: Uint8Array,
  options: {
    sessionOver?: Partial<MobileDocSession>
    modelOver?: Partial<Parameters<typeof openPdfModel>[0]>
    features?: PdfFeatureSet
    /** Lend the frame service the import writes with (see pageOps `PdfFileWriteService`). */
    writer?: boolean
  } = {},
) {
  const fake = fakeClient(bytes)
  const { host, toasts } = fakeHost(fake.client)
  const s = session(options.sessionOver)
  const model = await openPdfModel({
    bytes,
    fileName: 'sample.pdf',
    writable: s.writable,
    isUntitled: false,
    fromRecovery: false,
    askPassword: async () => null,
    unlockProbe: pcUnlockProbe,
    ...options.modelOver,
  })
  opened.push(model)
  const doc = startPdfEditDocument(host, model, {
    session: s,
    unlockProbe: pcUnlockProbe,
    features: options.features,
  })
  docs.push(doc)
  const edit = doc.editSession
  const writes: Uint8Array[] = []
  if (options.writer !== false) {
    // stands in for the frame addition `services.writeFileBytes` (client.saveFileBytes)
    Object.assign(edit.services, {
      async writeFileBytes(next: Uint8Array) {
        writes.push(next)
        await fake.client.saveFileBytes(edit.getSession().sessionId, toBase64(next))
        return true
      },
    })
  }
  return { doc, edit, fake, toasts, writes, model }
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

const q = (testId: string) => document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
const click = (testId: string) => act(() => q(testId)!.click())

function openOrganizer() {
  click('editor-more-btn')
  click('editor-more-pdfEdit-pages')
}

/** Lets pending promises (picker, pdf-lib, engine, save) settle inside act. */
async function settle(until: () => boolean, rounds = 200) {
  for (let i = 0; i < rounds && !until(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
  }
  expect(until()).toBe(true)
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

// ── op shapes ───────────────────────────────────────────────────────────────

describe('page op shapes', () => {
  const store = (pages: number) =>
    createPdfEditStore({
      context: (s) => ({
        readOnly: false,
        pageCount: pages + s.blankPages.length,
        deleted: s.deleted,
        claimedImages: new Set(),
        fieldNames: new Set(),
        radioGroups: new Set(),
      }),
    })

  it('rotates the picked pages a quarter turn clockwise (PC rotatePages)', () => {
    expect(rotateOps([0, 2])).toEqual([{ op: 'rotatePages', pages: [0, 2], dir: 90 }])
    expect(rotateOps([])).toEqual([])
    const s = store(3)
    s.dispatch(rotateOps([0, 2]))
    s.dispatch(rotateOps([2]))
    expect([...s.getSnapshot().rotations]).toEqual([
      [0, 90],
      [2, 180],
    ])
  })

  it('deletes the picked pages in one batch and never the last one', () => {
    expect(deleteOps([0, 1, 2], [2, 0])).toEqual([
      { op: 'deletePage', pageIndex: 2 },
      { op: 'deletePage', pageIndex: 0 },
    ])
    expect(deleteOps([0, 1, 2], [0, 1, 2])).toBeNull()
    expect(deleteOps([1], [1])).toBeNull()
    const s = store(3)
    s.dispatch(deleteOps([0, 1, 2], [0, 2])!)
    expect([...s.getSnapshot().deleted].sort()).toEqual([0, 2])
    expect(s.canUndo()).toBe(true)
  })

  it('reorders by gap and lists deleted pages at the tail (PC setPageOrder)', () => {
    expect(reorderVisible([0, 1, 2, 3], new Set([1]), 3)).toEqual([0, 2, 1, 3])
    expect(reorderVisible([0, 1, 2, 3], new Set([1]), 0)).toEqual([1, 0, 2, 3])
    expect(reorderVisible([0, 1, 2, 3], new Set([1, 2]), 4)).toEqual([0, 3, 1, 2])
    expect(moveOps([0, 1, 2], new Set([1]), 1, 3)).toBeNull()
    // page 1 is deleted: it trails the visible order
    expect(pageOrderOp([2, 0, 3], 4)).toEqual({ op: 'setPageOrder', order: [2, 0, 3, 1] })
    const s = store(4)
    s.dispatch(deleteOps([0, 1, 2, 3], [1])!)
    s.dispatch(moveOps([0, 2, 3], new Set([0]), 3, 4)!)
    expect(s.getSnapshot().order).toEqual([2, 3, 0, 1])
  })

  it('adds a blank page before or after a page, sized like it with its pending rotation', async () => {
    const model = await openPdfModel({
      bytes: await textPdf(['A', 'B'], [300, 600]),
      fileName: 'a.pdf',
      writable: true,
      isUntitled: false,
      fromRecovery: false,
      askPassword: async () => null,
      unlockProbe: pcUnlockProbe,
    })
    opened.push(model)
    const edits = { ...emptyEditSnapshot(), rotations: new Map([[1, 90]]) }
    const geom = (i: number) => pdfPageGeom(model, i, edits.rotations.get(i) ?? 0)
    expect(blankPageOp(edits, 2, geom, 1, 'after')).toEqual({
      op: { op: 'insertBlankPage', after: 1, pageIndex: 2, width: 600, height: 300 },
      pageIndex: 2,
    })
    expect(blankPageOp(edits, 2, geom, 0, 'before').op).toEqual({
      op: 'insertBlankPage',
      after: null,
      pageIndex: 2,
      width: 300,
      height: 600,
    })
    expect(blankPageOp(edits, 2, geom, 1, 'before').op).toMatchObject({ after: 0 })
  })
})

// ── the organizer sheet ─────────────────────────────────────────────────────

describe('organizer sheet', () => {
  const tiles = () =>
    [...document.querySelectorAll('[data-testid^="pdf-pages-tile-"]')].map((el) =>
      Number(el.getAttribute('data-testid')!.slice('pdf-pages-tile-'.length)),
    )

  it('opens from [⋯] Organize pages and rotates, deletes, moves and adds blank pages as pending edits', async () => {
    const { doc, edit, toasts } = await startDoc(await textPdf(['A', 'B', 'C']))
    const host = mountWorkspace(doc)
    openOrganizer()
    expect(q('pdf-pages-sheet')).not.toBeNull()
    expect(tiles()).toEqual([0, 1, 2])

    click('pdf-pages-pick-0')
    click('pdf-pages-pick-2')
    expect(q('pdf-pages-count')?.textContent).toBe(tk('pdfPagesSelected', { n: 2 }))
    click('pdf-pages-rotate')
    expect([...edit.store.getSnapshot().rotations]).toEqual([
      [0, 90],
      [2, 90],
    ])

    // move page 2 earlier, in front of page 1
    click('pdf-pages-pick-0')
    click('pdf-pages-earlier')
    expect(edit.store.getSnapshot().order).toEqual([0, 2, 1])
    expect(tiles()).toEqual([0, 2, 1])
    // the viewer still draws file order: the moved pages say where they go
    expect(host.querySelector('[data-testid="pdf-pages-moved-2"]')?.textContent).toBe(
      tk('pdfPagesMovedLabel', { n: 2 }),
    )

    click('pdf-pages-blank-after')
    const snap = edit.store.getSnapshot()
    expect(snap.blankPages.map((b) => b.input)).toEqual([{ pageIndex: 3, width: 500, height: 400 }])
    expect(snap.order).toEqual([0, 2, 3, 1])
    expect(tiles()).toEqual([0, 2, 3, 1])

    click('pdf-pages-delete')
    expect([...edit.store.getSnapshot().deleted]).toEqual([3])
    click('pdf-pages-pick-1')
    click('pdf-pages-delete')
    expect([...edit.store.getSnapshot().deleted]).toEqual([3, 1])
    expect(tiles()).toEqual([0, 2])
    // pending deletion is marked on the viewer page, with how to bring it back
    const cover = host.querySelector('[data-testid="pdf-pages-deleted-1"]')
    expect(cover?.textContent).toContain(tk('pdfPagesDeletedLabel'))
    expect(cover?.textContent).toContain(tk('pdfPagesDeletedHint'))

    // the last pages cannot all go
    click('pdf-pages-select-all')
    click('pdf-pages-delete')
    expect(toasts.at(-1)).toBe(tk('pdfPagesKeepOne'))
    expect([...edit.store.getSnapshot().deleted]).toEqual([3, 1])

    act(() => void edit.store.undo())
    expect(host.querySelector('[data-testid="pdf-pages-deleted-1"]')).toBeNull()
  })

  it('saves the organized pages through the PC save code', async () => {
    const { doc, edit, fake } = await startDoc(await textPdf(['A', 'B', 'C']))
    mountWorkspace(doc)
    openOrganizer()
    click('pdf-pages-pick-1')
    click('pdf-pages-rotate')
    click('pdf-pages-blank-before')
    click('pdf-pages-select-all') // clears the pick (the new blank page)
    click('pdf-pages-pick-0')
    click('pdf-pages-delete')
    expect(await edit.services.saveNow()).toBe(true)
    // pages: blank (before B), B rotated, C
    expect(await pageInfo(fake.saved[0]!.bytes)).toEqual({ count: 3, rotations: [0, 90, 0] })
  }, 60_000)

  it('changes nothing and opens nothing when not editing', async () => {
    let chrome: PdfFeatureChrome = {}
    const features: PdfFeatureSet = {
      ...PDF_FEATURES,
      pages: {
        id: 'pages',
        useFeature(ctx) {
          chrome = pagesFeature.useFeature!(ctx)
          return chrome
        },
      },
    }
    const { doc, edit } = await startDoc(await textPdf(['A', 'B']), { features })
    const pick = vi.spyOn(edit.services, 'pickPdfFile')
    mountWorkspace(doc, 'view')
    act(() => chrome.onMorePress?.())
    expect(q('pdf-pages-sheet')).toBeNull()
    expect(q('pdf-pages-import-sheet')).toBeNull()
    expect(edit.store.hasEdits()).toBe(false)
    expect(pick).not.toHaveBeenCalled()
  })
})

// ── pages from another PDF ──────────────────────────────────────────────────

describe('taking pages from another PDF', () => {
  async function pickInto(edit: PdfEditDocument['editSession'], other: Uint8Array | null) {
    const pick = vi.fn(async () => other)
    edit.services.pickPdfFile = pick
    return pick
  }

  it('is offered only once the frame lends a file writer', async () => {
    const { doc } = await startDoc(await textPdf(['A']), { writer: false })
    mountWorkspace(doc)
    openOrganizer()
    expect(q('pdf-pages-import')).toBeNull()
    expect(q('pdf-pages-rotate')).not.toBeNull()
  })

  it('changes nothing when the picker or the confirmation is cancelled', async () => {
    const { doc, edit, fake, writes } = await startDoc(await textPdf(['A', 'B']))
    mountWorkspace(doc)
    edit.services.dispatch(rotateOps([0]))
    const save = vi.spyOn(edit.services, 'saveNow')

    await pickInto(edit, null)
    openOrganizer()
    click('pdf-pages-import')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(q('pdf-pages-import-sheet')).toBeNull()

    await pickInto(edit, await textPdf(['X']))
    openOrganizer()
    click('pdf-pages-import')
    await settle(() => q('pdf-pages-import-sheet') !== null)
    expect(q('pdf-pages-import-notice')?.textContent).toBe(tk('pdfPagesImportConfirmHint'))
    click('pdf-pages-import-cancel')
    expect(q('pdf-pages-import-sheet')).toBeNull()

    expect(save).not.toHaveBeenCalled()
    expect(writes).toHaveLength(0)
    expect(fake.saved).toHaveLength(0)
    expect([...edit.store.getSnapshot().rotations]).toEqual([[0, 90]])
  })

  it('saves the edits first, writes the merged file, then reloads it', async () => {
    const { doc, edit, fake, toasts, writes } = await startDoc(await textPdf(['A', 'B', 'C']))
    mountWorkspace(doc)
    edit.services.dispatch(rotateOps([0]))
    edit.services.dispatch(moveOps([0, 1, 2], new Set([2]), 0, 3)!)
    const order: string[] = []
    const save = edit.services.saveNow
    edit.services.saveNow = async () => {
      order.push('save')
      return save()
    }
    const write = (
      edit.services as unknown as { writeFileBytes: (b: Uint8Array) => Promise<boolean> }
    ).writeFileBytes
    Object.assign(edit.services, {
      writeFileBytes: async (bytes: Uint8Array) => {
        order.push('write')
        return write(bytes)
      },
    })
    await pickInto(edit, await textPdf(['X', 'Y'], [200, 200]))

    openOrganizer()
    click('pdf-pages-pick-0') // visible position 2 (C, A, B)
    click('pdf-pages-import')
    await settle(() => q('pdf-pages-import-sheet') !== null)
    expect(q('pdf-pages-import-after')?.getAttribute('aria-checked')).toBe('true')
    click('pdf-pages-import-confirm')
    await settle(() => toasts.includes(tk('pdfPagesImportDone', { n: 2 })))

    expect(order).toEqual(['save', 'write'])
    expect(fake.saved).toHaveLength(2)
    // first the pending edits (C first, A turned), then the pages after A
    expect(await pageInfo(fake.saved[0]!.bytes)).toEqual({ count: 3, rotations: [0, 90, 0] })
    expect(latin1(fake.saved[1]!.bytes)).toBe(latin1(writes[0]!))
    const merged = await PDFDocument.load(fake.saved[1]!.bytes)
    expect(merged.getPages().map((p) => Math.round(p.getWidth()))).toEqual([
      400, 400, 200, 200, 400,
    ])
    expect(edit.getModel().pages).toHaveLength(5)
    expect(latin1(edit.getModel().originalBytes)).toBe(latin1(writes[0]!))
    expect(edit.store.hasEdits()).toBe(false)
  }, 60_000)

  it('stops when saving the edits fails', async () => {
    const { edit, writes } = await startDoc(await textPdf(['A']))
    edit.services.dispatch(rotateOps([0]))
    edit.services.saveNow = async () => false
    const result = await runPdfImport({
      services: edit.services,
      write: async () => true,
      other: await textPdf(['X']),
      place: { kind: 'end' },
    })
    expect(result.outcome).toBe('saveFailed')
    expect(writes).toHaveLength(0)
  })

  it('is blocked for an encrypted document', async () => {
    const { doc, edit, toasts } = await startDoc(await encryptedPdf(['Secret']), {
      modelOver: { askPassword: async ({ wrong }) => (wrong ? null : 'user1') },
    })
    expect(edit.getModel().readOnlyReason).toBeNull()
    expect(edit.getModel().encrypted).toBe(true)
    const pick = await pickInto(edit, await textPdf(['X']))
    mountWorkspace(doc)
    openOrganizer()
    click('pdf-pages-import')
    await settle(() => toasts.length > 0)
    expect(toasts.at(-1)).toBe(tk('pdfPagesImportEncrypted'))
    expect(pick).not.toHaveBeenCalled()
  }, 60_000)

  it('is blocked for a new document that was never saved', async () => {
    const { doc, edit, toasts } = await startDoc(await textPdf(['A']), {
      modelOver: { isUntitled: true },
    })
    const pick = await pickInto(edit, await textPdf(['X']))
    mountWorkspace(doc)
    openOrganizer()
    click('pdf-pages-import')
    await settle(() => toasts.length > 0)
    expect(toasts.at(-1)).toBe(tk('pdfPagesImportUntitled'))
    expect(pick).not.toHaveBeenCalled()
  })

  it('is blocked for a damaged or read-only document', async () => {
    const base = { damaged: false, encrypted: false, readOnlyReason: null, isUntitled: false }
    const file = { writable: true, ephemeral: false }
    expect(importBlockReason(base, file)).toBeNull()
    expect(importBlockReason({ ...base, damaged: true, readOnlyReason: 'damaged' }, file)).toBe(
      'pdfPagesImportDamaged',
    )
    expect(importBlockReason({ ...base, readOnlyReason: 'notWritable' }, file)).toBe(
      'pdfPagesImportReadOnly',
    )
    expect(importBlockReason(base, { writable: false, ephemeral: false })).toBe(
      'pdfPagesImportReadOnly',
    )
    expect(importBlockReason(base, { writable: true, ephemeral: true })).toBe(
      'pdfPagesImportUntitled',
    )

    // a read-only file: nothing is saved or written even when asked directly
    const { edit, writes } = await startDoc(await textPdf(['A']), {
      sessionOver: { writable: false },
    })
    expect(edit.getModel().readOnlyReason).toBe('notWritable')
    const save = vi.spyOn(edit.services, 'saveNow')
    const result = await runPdfImport({
      services: edit.services,
      write: async () => true,
      other: await textPdf(['X']),
      place: { kind: 'front' },
    })
    expect(result.outcome).toBe('blocked')
    expect(save).not.toHaveBeenCalled()
    expect(writes).toHaveLength(0)
  })

  it('is blocked when the picked PDF is locked with a password', async () => {
    const locked = await encryptedPdf(['Locked'])
    expect(await checkPickedPdf(locked)).toEqual({ ok: false, reason: 'encrypted' })
    expect(await checkPickedPdf(new Uint8Array([1, 2, 3]))).toEqual({
      ok: false,
      reason: 'unreadable',
    })
    expect(await checkPickedPdf(await textPdf(['X', 'Y']))).toEqual({ ok: true, pageCount: 2 })

    const { doc, edit, fake, toasts } = await startDoc(await textPdf(['A']))
    const save = vi.spyOn(edit.services, 'saveNow')
    await pickInto(edit, locked)
    mountWorkspace(doc)
    openOrganizer()
    click('pdf-pages-import')
    await settle(() => toasts.length > 0)
    expect(toasts.at(-1)).toBe(tk('pdfPagesImportPickEncrypted'))
    expect(q('pdf-pages-import-sheet')).toBeNull()
    expect(save).not.toHaveBeenCalled()
    expect(fake.saved).toHaveLength(0)
  }, 60_000)

  it('maps the place to the PC afterPageIndex in the saved (visible) order', () => {
    expect(importAfterIndex([2, 0, 1], { kind: 'front' })).toBe(-1)
    expect(importAfterIndex([2, 0, 1], { kind: 'end' })).toBe(2)
    expect(importAfterIndex([2, 0, 1], { kind: 'after', page: 0 })).toBe(1)
  })
})

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1')
