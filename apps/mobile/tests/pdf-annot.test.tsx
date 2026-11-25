// Mobile PDF annotations (track T2, PDF-T5): text markup and sticky notes go into the
// pending edits in the PC shape (markups, note drawings, noteEdits, annotDeletes) by
// the PC rules (same-color pen removes, another color recolors, saved markups are
// replaced), touch selection over the page text, remembered colors, the author name,
// and nothing changes outside edit mode.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import type { MobileClient, MobileDocSession } from '@genoffice/mobile-bridge/transport'
import { loadSavedAnnots } from '../../pdf/src/renderer/annotation-catalog'
import { MARKUP_COLORS } from '../../pdf/src/renderer/annotations'
import { buildNoteThreads } from '../../pdf/src/renderer/note-threads'
import {
  DEFAULT_HIGHLIGHT_PENS,
  HIGHLIGHT_PENS_KEY,
  LINE_MARKUP_COLORS_KEY,
} from '../../pdf/src/renderer/selection-colors'
import type { SavePdfRequest } from '../../pdf/src/shared/ipc'
import type { EditorHost } from '../src/renderer/editors/editorKind'
import { startPdfEditDocument, type PdfEditDocument } from '../src/renderer/editors/pdf/edit'
import { setEngineAssetLoader } from '../src/renderer/editors/pdf/engine/assets'
import { setSharedPdfEngine, type PdfEngine } from '../src/renderer/editors/pdf/engine'
import { createInThreadPdfEngine } from '../src/renderer/editors/pdf/engine/inThread'
import {
  ANNOT_LONG_PRESS_MS,
  annotFeature,
  caretAt,
  highlightPenAction,
  MEMO_AUTHOR_KEY,
  markupAt,
  newNoteOp,
  noteDeleteOps,
  noteEditOps,
  pageThreads,
  paintOps,
  replyOp,
  selectionQuads,
  selectionText,
  textRunsOf,
  toggleMarkupOps,
  type MarkupWorld,
} from '../src/renderer/editors/pdf/features/annot'
import type { PdfOpenedDocument } from '../src/renderer/editors/pdf/view/model'
import { openPdfModel } from '../src/renderer/editors/pdf/view/openPdf'
import { pcUnlockProbe } from '../src/renderer/editors/pdf/view/pcEngineHooks'
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

const QUADS = [[40, 414, 120, 414, 40, 398, 120, 398]]
const YELLOW = [...DEFAULT_HIGHLIGHT_PENS[0]!] as [number, number, number]
const GREEN = [...DEFAULT_HIGHLIGHT_PENS[1]!] as [number, number, number]

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

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const fromBase64 = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'))

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

const opened: PdfOpenedDocument[] = []
const docs: PdfEditDocument[] = []

async function startDoc(bytes: Uint8Array) {
  const fake = fakeClient(bytes)
  const { host, toasts } = fakeHost(fake.client)
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
  const doc = startPdfEditDocument(host, model, { session: s, unlockProbe: pcUnlockProbe })
  docs.push(doc)
  return { doc, edit: doc.editSession, fake, toasts }
}

/** A document whose page 0 already carries `ops` saved in the file. */
async function startSavedDoc(
  ops: Parameters<PdfEditDocument['editSession']['services']['dispatch']>[0],
) {
  const started = await startDoc(await textPdf(['Hello world']))
  expect(started.edit.services.dispatch(ops).failures).toEqual([])
  expect(await started.edit.services.saveNow()).toBe(true)
  requests.length = 0
  return started
}

async function worldOf(edit: PdfEditDocument['editSession']): Promise<MarkupWorld> {
  const saved = await loadSavedAnnots(edit.getModel().proxy, 0)
  return { edits: edit.services.getEdits(), saved: (i) => (i === 0 ? saved.markups : []) }
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
        />
      </MobileLocaleProvider>,
    )
  })
  return host
}

async function settle(until: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries && !until(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
  }
  expect(until()).toBe(true)
}

/** The declarations of the first rule in `file` whose selector list holds `selector`. */
function cssRule(file: string, selector: string): Record<string, string> {
  const css = readFileSync(resolve(__dirname, '../src/renderer/editors/pdf', file), 'utf8')
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!m[1]!.split(',').some((s) => s.trim() === selector)) continue
    const decls = m[2]!.split(';').flatMap((d) => {
      const i = d.indexOf(':')
      return i < 0
        ? []
        : [
            [
              d.slice(0, i).trim(),
              d
                .slice(i + 1)
                .trim()
                .replace(/\s+/g, ' '),
            ],
          ]
    })
    return Object.fromEntries(decls)
  }
  throw new Error(`no rule for ${selector} in ${file}`)
}

const q = <T extends Element = HTMLElement>(root: ParentNode, testId: string) =>
  root.querySelector<T & HTMLElement>(`[data-testid="${testId}"]`)

function touch(target: Element, type: string, x: number, y: number) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  Object.defineProperty(e, 'pointerType', { value: 'touch' })
  Object.defineProperty(e, 'pointerId', { value: 7 })
  act(() => {
    target.dispatchEvent(e)
  })
}

function pointer(target: Element, type: string, x: number, y: number) {
  act(() => {
    target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }),
    )
  })
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

// ── text selection geometry ─────────────────────────────────────────────────

describe('text runs', () => {
  const items = [
    {
      str: 'Hello world',
      transform: [10, 0, 0, 10, 100, 700],
      width: 55,
      height: 10,
      fontName: 'f',
    },
    { str: '', transform: [10, 0, 0, 10, 155, 700], width: 0, height: 10, fontName: 'f' },
    { str: 'Second', transform: [10, 0, 0, 10, 100, 680], width: 30, height: 10, fontName: 'f' },
  ]
  const runs = textRunsOf(items, { f: { ascent: 0.8 } })

  it('drops empty items and splits characters evenly over the advance width', () => {
    expect(runs.map((r) => r.str)).toEqual(['Hello world', 'Second'])
    expect(caretAt(runs, 100, 703)).toEqual({ run: 0, offset: 0 })
    expect(caretAt(runs, 125, 703)).toEqual({ run: 0, offset: 5 })
    expect(caretAt(runs, 300, 300, 10)).toBeNull()
  })

  it('turns the characters between two carets into PC-shaped quads per line', () => {
    const quads = selectionQuads(runs, { run: 0, offset: 6 }, { run: 1, offset: 3 })
    expect(quads).toEqual([
      [130, 708, 155, 708, 130, 698, 155, 698],
      [100, 688, 115, 688, 100, 678, 115, 678],
    ])
    // either order, same characters
    expect(selectionText(runs, { run: 1, offset: 3 }, { run: 0, offset: 6 })).toBe('worldSec')
    // spaces alone mark nothing
    expect(selectionQuads(runs, { run: 0, offset: 5 }, { run: 0, offset: 6 })).toEqual([])
  })
})

// ── markup rules ────────────────────────────────────────────────────────────

describe('markups through the PC rules', () => {
  it('adds a line markup in the PC shape and removes it when toggled again', async () => {
    const { edit } = await startDoc(await textPdf(['Hello world']))
    const sel = new Map([[0, QUADS]])
    const first = toggleMarkupOps(await worldOf(edit), sel, 'underline', [0.17, 0.4, 1])
    expect(first.result).toBe('added')
    expect(edit.services.dispatch(first.ops).failures).toEqual([])
    expect(edit.services.getEdits().markups).toEqual([
      {
        id: expect.any(String),
        pageIndex: 0,
        type: 'underline',
        color: [0.17, 0.4, 1],
        quads: QUADS,
      },
    ])
    const second = toggleMarkupOps(await worldOf(edit), sel, 'underline', [0.17, 0.4, 1])
    expect(second.result).toBe('removed')
    expect(second.ops).toEqual([
      { op: 'removeMarkup', id: edit.services.getEdits().markups[0]!.id },
    ])
    edit.services.dispatch(second.ops)
    expect(edit.services.getEdits().markups).toEqual([])
  })

  it('pen: same color removes, another color recolors a pending highlight', async () => {
    const { edit } = await startDoc(await textPdf(['Hello world']))
    const sel = new Map([[0, QUADS]])
    const add = highlightPenAction(await worldOf(edit), sel, YELLOW)
    expect(add.kind).toBe('paint')
    if (add.kind !== 'paint') return
    edit.services.dispatch(paintOps(YELLOW, add.recolor, add.add))
    const id = edit.services.getEdits().markups[0]!.id
    expect(edit.services.getEdits().markups[0]).toMatchObject({ type: 'highlight', color: YELLOW })

    const other = highlightPenAction(await worldOf(edit), sel, GREEN)
    if (other.kind !== 'paint') throw new Error('expected paint')
    const ops = paintOps(GREEN, other.recolor, other.add)
    expect(ops).toEqual([{ op: 'recolorMarkup', id, color: GREEN }])
    edit.services.dispatch(ops)
    expect(edit.services.getEdits().markups).toEqual([
      expect.objectContaining({ id, color: GREEN }),
    ])

    const same = highlightPenAction(await worldOf(edit), sel, GREEN)
    expect(same).toEqual({ kind: 'remove', ops: [{ op: 'removeMarkup', id }] })
  })

  it('pen on a saved highlight: same color deletes it, another color replaces it (new + delete old)', async () => {
    const { edit } = await startSavedDoc([
      { op: 'addMarkup', markup: { pageIndex: 0, type: 'highlight', color: YELLOW, quads: QUADS } },
    ])
    const world = await worldOf(edit)
    const saved = world.saved(0)
    expect(saved).toHaveLength(1)
    const sel = new Map([[0, saved[0]!.quads]])

    const same = highlightPenAction(world, sel, YELLOW)
    expect(same).toEqual({ kind: 'remove', ops: [{ op: 'deleteSavedAnnot', annot: saved[0] }] })

    const other = highlightPenAction(world, sel, GREEN)
    if (other.kind !== 'paint') throw new Error('expected paint')
    const ops = paintOps(GREEN, other.recolor, other.add)
    expect(ops).toEqual([
      { op: 'deleteSavedAnnot', annot: saved[0] },
      {
        op: 'addMarkup',
        markup: { pageIndex: 0, type: 'highlight', color: GREEN, quads: saved[0]!.quads },
      },
    ])
    expect(edit.services.dispatch(ops).failures).toEqual([])
    const edits = edit.services.getEdits()
    expect(edits.annotDeletes).toEqual([{ id: expect.any(String), annot: saved[0] }])
    expect(edits.markups).toEqual([expect.objectContaining({ type: 'highlight', color: GREEN })])
    // the replaced markup is found again by its new color; the old one is gone
    expect(markupAt(await worldOf(edit), 0, 60, 405)).toMatchObject({
      pending: { color: GREEN },
    })
  })

  it('keeps an accepted AI highlight category (/Subj) when a saved markup is recolored', async () => {
    const { edit } = await startSavedDoc([
      {
        op: 'addMarkup',
        markup: { pageIndex: 0, type: 'highlight', color: YELLOW, quads: QUADS, subject: 'Key' },
      },
    ])
    const { readSubjects } = await import('../src/renderer/editors/pdf/features/annot/catalog')
    const saved = (await worldOf(edit)).saved(0)
    const subjects = await readSubjects(edit.getModel().originalBytes, saved)
    expect([...subjects.values()]).toEqual(['Key'])
    const ops = paintOps(GREEN, [{ saved: saved[0]! }], [], subjects)
    expect(ops[1]).toMatchObject({ op: 'addMarkup', markup: { subject: 'Key' } })
  })
})

// ── notes ───────────────────────────────────────────────────────────────────

describe('notes through the PC rules', () => {
  it('adds a note and a reply as PC note drawings, edits and deletes them', async () => {
    const { edit } = await startDoc(await textPdf(['Hello world']))
    const id = edit.services.newId()
    edit.services.dispatch([
      newNoteOp({ id, pageIndex: 0, at: [100, 300], contents: 'Check', author: 'Kim', now: 5 }),
    ])
    expect(edit.services.getEdits().drawings).toEqual([
      {
        id,
        input: {
          kind: 'note',
          pageIndex: 0,
          color: [0.86, 0.22, 0.18],
          at: [100, 300],
          contents: 'Check',
          author: 'Kim',
          createdMs: 5,
          localId: id,
        },
      },
    ])
    const [root] = pageThreads(edit.services.getEdits(), 0, [])
    edit.services.dispatch([
      replyOp({ pageIndex: 0, root: root!, contents: 'Done', author: '', now: 6 }),
    ])
    const reply = edit.services.getEdits().drawings[1]!
    expect(reply.input).toMatchObject({ kind: 'note', replyToLocalId: id, at: [100, 300] })
    expect(reply.input).not.toHaveProperty('author')

    const [thread] = pageThreads(edit.services.getEdits(), 0, [])
    expect(thread!.replies.map((r) => r.contents)).toEqual(['Done'])
    edit.services.dispatch(noteEditOps(thread!, ' Checked ')!)
    expect(edit.services.getEdits().drawings[0]!.input).toMatchObject({ contents: 'Checked' })
    expect(noteEditOps(thread!, 'Check')).toBeNull() // unchanged text: nothing to do

    edit.services.dispatch(noteDeleteOps(pageThreads(edit.services.getEdits(), 0, [])[0]!))
    expect(edit.services.getEdits().drawings).toEqual([])
  })

  it('edits, answers and deletes saved notes with noteEdits, replyToSaved and annotDeletes', async () => {
    const { edit } = await startSavedDoc([
      newNoteOp({
        id: 'n1',
        pageIndex: 0,
        at: [100, 300],
        contents: 'Saved',
        author: 'Lee',
        now: 5,
      }),
    ])
    const { notes } = await loadSavedAnnots(edit.getModel().proxy, 0)
    expect(notes).toHaveLength(1)
    const [root] = pageThreads(edit.services.getEdits(), 0, notes)
    expect(root!.saved?.contents).toBe('Saved')

    edit.services.dispatch(noteEditOps(root!, 'Changed')!)
    expect(edit.services.getEdits().noteEdits).toEqual([
      { id: expect.any(String), annot: notes[0], contents: 'Changed' },
    ])
    expect(pageThreads(edit.services.getEdits(), 0, notes)[0]!.contents).toBe('Changed')

    edit.services.dispatch([
      replyOp({ pageIndex: 0, root: root!, contents: 'Ok', author: 'Park', now: 7 }),
    ])
    expect(edit.services.getEdits().drawings[0]!.input).toMatchObject({
      kind: 'note',
      author: 'Park',
      replyToSaved: { objNum: notes[0]!.objNum, rect: notes[0]!.rect, contents: 'Saved' },
    })

    // deleting the saved root takes its pending reply and its content edit with it
    edit.services.dispatch(noteDeleteOps(pageThreads(edit.services.getEdits(), 0, notes)[0]!))
    const edits = edit.services.getEdits()
    expect(edits.annotDeletes).toEqual([{ id: expect.any(String), annot: notes[0] }])
    expect(edits.drawings).toEqual([])
    expect(edits.noteEdits).toEqual([])
    expect(buildNoteThreads([], [])).toEqual([])
  })
})

// ── the feature in the edit frame ───────────────────────────────────────────

describe('annot feature in the frame', () => {
  it('is the Highlighter slot', () => {
    expect(annotFeature.id).toBe('annot')
    expect(annotFeature.useFeature).toBeTypeOf('function')
  })

  async function openTool(host: HTMLElement) {
    act(() => q(host, 'pdf-tool-highlighter')!.click())
    await settle(() => q(host, 'pdf-annot-surface-0') !== null)
    const page = host.querySelector<HTMLElement>('.m-pdf-page')!
    const scale = parseFloat(page.style.width) / 400
    return { surface: q(host, 'pdf-annot-surface-0')!, scale }
  }

  /** Drag over the page text from PDF x1 to x2 on the text line (y 404). */
  async function dragSelect(host: HTMLElement, x1: number, x2: number) {
    const { surface, scale } = await openTool(host)
    const y = (500 - 404) * scale
    // the text runs load in the background once the tool is on
    await settle(() => {
      pointer(surface, 'pointerdown', x1 * scale, y)
      pointer(surface, 'pointermove', x2 * scale, y)
      pointer(surface, 'pointerup', x2 * scale, y)
      return q(host, 'pdf-annot-pen-0') !== null
    })
    return { surface, scale }
  }

  it('selects text by dragging over it and applies the pens by the PC rules', async () => {
    const { doc, edit } = await startDoc(await textPdf(['Hello world']))
    const host = mountWorkspace(doc)
    await dragSelect(host, 40, 200)
    expect(host.querySelectorAll('[data-testid="pdf-annot-selection"]').length).toBe(1)

    act(() => q(host, 'pdf-annot-pen-0')!.click())
    await settle(() => edit.services.getEdits().markups.length === 1)
    const [markup] = edit.services.getEdits().markups
    expect(markup).toMatchObject({ pageIndex: 0, type: 'highlight', color: YELLOW })
    expect(markup!.quads).toHaveLength(1)
    const [x1, yMax, x2, , , yMin] = markup!.quads[0]!
    expect(x1).toBeCloseTo(40, 0)
    expect(x2).toBeGreaterThan(100)
    expect(yMax).toBeGreaterThan(404)
    expect(yMin).toBeLessThan(400)
    await settle(() => q(host, 'pdf-annot-pending-markup') !== null)
    expect(q(host, 'pdf-annot-pen-0')!.getAttribute('aria-pressed')).toBe('true')

    // another pen recolors, the same pen again removes
    act(() => q(host, 'pdf-annot-pen-1')!.click())
    await settle(() => edit.services.getEdits().markups[0]?.color[0] === GREEN[0])
    expect(edit.services.getEdits().markups).toHaveLength(1)
    act(() => q(host, 'pdf-annot-pen-1')!.click())
    await settle(() => edit.services.getEdits().markups.length === 0)
  })

  it('adds a line markup, remembers the color picked in its color row, and toggles it off', async () => {
    const { doc, edit } = await startDoc(await textPdf(['Hello world']))
    const host = mountWorkspace(doc)
    await dragSelect(host, 40, 200)
    act(() => q(host, 'pdf-annot-strikeout')!.click())
    await settle(() => edit.services.getEdits().markups.length === 1)
    expect(edit.services.getEdits().markups[0]).toMatchObject({
      type: 'strikeout',
      color: MARKUP_COLORS.strikeout,
    })
    await settle(() => q(host, 'pdf-annot-color-row') !== null)
    act(() => q(host, 'pdf-annot-row-color-3')!.click())
    await settle(() => edit.services.getEdits().markups[0]?.color[2] === 1)
    expect(JSON.parse(window.localStorage.getItem(LINE_MARKUP_COLORS_KEY)!).strikeout).toEqual([
      0.169, 0.4, 1,
    ])
    act(() => q(host, 'pdf-annot-strikeout')!.click())
    await settle(() => edit.services.getEdits().markups.length === 0)
  })

  it('uses the pens remembered on the device', async () => {
    window.localStorage.setItem(
      HIGHLIGHT_PENS_KEY,
      JSON.stringify([[0, 0.675, 0.757], GREEN, YELLOW]),
    )
    const { doc, edit } = await startDoc(await textPdf(['Hello world']))
    const host = mountWorkspace(doc)
    await dragSelect(host, 40, 200)
    act(() => q(host, 'pdf-annot-pen-0')!.click())
    await settle(() => edit.services.getEdits().markups.length === 1)
    expect(edit.services.getEdits().markups[0]!.color).toEqual([0, 0.675, 0.757])
  })

  it('lets a finger scroll vertically and select by a sideways drag or a long press', async () => {
    const { doc } = await startDoc(await textPdf(['Hello world']))
    const host = mountWorkspace(doc)
    const { surface, scale } = await openTool(host)
    const y = (500 - 404) * scale
    const touchMoveCancelled = () => {
      const e = new Event('touchmove', { bubbles: true, cancelable: true })
      surface.dispatchEvent(e)
      return e.defaultPrevented
    }
    const selected = () => host.querySelectorAll('[data-testid="pdf-annot-selection"]').length

    // a sideways drag from text selects, and its touch moves no longer scroll
    await settle(() => {
      touch(surface, 'pointerdown', 45 * scale, y)
      touch(surface, 'pointermove', 120 * scale, y)
      const held = touchMoveCancelled()
      touch(surface, 'pointerup', 120 * scale, y)
      return held && q(host, 'pdf-annot-pen-0') !== null
    })
    act(() => q(host, 'pdf-annot-clear')!.click())
    expect(selected()).toBe(0)

    // a vertical swipe from text is the scroller's: nothing selected, the move is not held
    touch(surface, 'pointerdown', 45 * scale, y)
    touch(surface, 'pointermove', 46 * scale, y + 60)
    expect(touchMoveCancelled()).toBe(false)
    touch(surface, 'pointercancel', 46 * scale, y + 60)
    expect(selected()).toBe(0)
    expect(q(host, 'pdf-annot-pen-0')).toBeNull()

    // a long press selects the word under the finger
    touch(surface, 'pointerdown', 90 * scale, y)
    await act(async () => {
      await new Promise((r) => setTimeout(r, ANNOT_LONG_PRESS_MS + 100))
    })
    expect(selected()).toBe(1)
    touch(surface, 'pointerup', 90 * scale, y)
    await settle(() => q(host, 'pdf-annot-pen-0') !== null)
    const box = host.querySelector<HTMLElement>('[data-testid="pdf-annot-selection"]')!
    // "world" only: it starts after "Hello " and ends at the end of the line
    expect(parseFloat(box.style.left) / scale).toBeGreaterThan(70)
  })

  it('taps a saved highlight to recolor it (new + delete old) or delete it', async () => {
    const { doc, edit } = await startSavedDoc([
      { op: 'addMarkup', markup: { pageIndex: 0, type: 'highlight', color: YELLOW, quads: QUADS } },
    ])
    const host = mountWorkspace(doc)
    const { surface, scale } = await openTool(host)
    const tap = () => {
      pointer(surface, 'pointerdown', 60 * scale, (500 - 405) * scale)
      pointer(surface, 'pointerup', 60 * scale, (500 - 405) * scale)
    }
    await settle(() => {
      tap()
      return q(document, 'pdf-annot-sheet-delete') !== null
    })
    act(() => q(document, 'pdf-annot-sheet-color-1')!.click())
    await settle(() => edit.services.getEdits().markups.length === 1)
    const edits = edit.services.getEdits()
    expect(edits.annotDeletes).toHaveLength(1)
    expect(edits.markups[0]).toMatchObject({ type: 'highlight', color: GREEN })
    expect(edits.markups[0]!.quads).toEqual(
      (edits.annotDeletes[0]!.annot as { quads: number[][] }).quads,
    )
    await settle(() => q(host, 'pdf-annot-removed') !== null)

    act(() => void edit.store.undo())
    await settle(() => {
      tap()
      return q(document, 'pdf-annot-sheet-delete') !== null
    })
    act(() => q(document, 'pdf-annot-sheet-delete')!.click())
    await settle(() => edit.services.getEdits().annotDeletes.length === 1)
    expect(edit.services.getEdits().markups).toEqual([])
  })

  it('places a note in note mode with the remembered author, which also goes to the request', async () => {
    window.localStorage.setItem(MEMO_AUTHOR_KEY, 'Kim Minji')
    const { doc, edit } = await startDoc(await textPdf(['Hello world']))
    const host = mountWorkspace(doc)
    const { surface, scale } = await openTool(host)
    act(() => q(host, 'pdf-annot-mode-note')!.click())
    pointer(surface, 'pointerdown', 100 * scale, 200 * scale)
    pointer(surface, 'pointerup', 100 * scale, 200 * scale)
    await settle(() => q(document, 'pdf-annot-note-text') !== null)
    expect(q<HTMLInputElement>(document, 'pdf-annot-author')!.value).toBe('Kim Minji')
    const text = q<HTMLTextAreaElement>(document, 'pdf-annot-note-text')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        text,
        'Look',
      )
      text.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => q(document, 'pdf-annot-note-add')!.click())
    const drawings = edit.services.getEdits().drawings
    expect(drawings).toHaveLength(1)
    expect(drawings[0]!.input).toMatchObject({
      kind: 'note',
      pageIndex: 0,
      contents: 'Look',
      author: 'Kim Minji',
    })
    const at = (drawings[0]!.input as { at: [number, number] }).at
    expect(at[0]).toBeCloseTo(100, 3)
    expect(at[1]).toBeCloseTo(300, 3)
    await settle(() => q(host, `pdf-annot-pin-P${drawings[0]!.id}`) !== null)

    expect(await edit.services.saveNow()).toBe(true)
    expect(requests.at(-1)!.annotationAuthor).toBe('Kim Minji')
  })

  it('omits the author when none is stored (the PC default applies)', async () => {
    const { edit } = await startDoc(await textPdf(['Hello world']))
    edit.services.dispatch([
      { op: 'addMarkup', markup: { pageIndex: 0, type: 'highlight', color: YELLOW, quads: QUADS } },
    ])
    expect(await edit.services.saveNow()).toBe(true)
    expect(requests.at(-1)!.annotationAuthor).toBeUndefined()
  })

  it('opens a saved note thread to reply, edit and delete', async () => {
    const { doc, edit } = await startSavedDoc([
      newNoteOp({
        id: 'n1',
        pageIndex: 0,
        at: [100, 300],
        contents: 'Saved',
        author: 'Lee',
        now: 5,
      }),
    ])
    const host = mountWorkspace(doc)
    const { notes } = await loadSavedAnnots(edit.getModel().proxy, 0)
    const key = `S${notes[0]!.objNum}`
    await settle(() => q(host, `pdf-annot-pin-${key}`) !== null)
    act(() => q(host, `pdf-annot-pin-${key}`)!.click())
    await settle(() => q(document, `pdf-annot-comment-${key}`) !== null)
    expect(q(document, `pdf-annot-comment-${key}`)!.textContent).toContain('Saved')

    const text = q<HTMLTextAreaElement>(document, 'pdf-annot-thread-text')!
    const type = (value: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
          text,
          value,
        )
        text.dispatchEvent(new Event('input', { bubbles: true }))
      })
    type('Reply')
    act(() => q(document, 'pdf-annot-thread-submit')!.click())
    expect(edit.services.getEdits().drawings[0]!.input).toMatchObject({
      replyToSaved: { objNum: notes[0]!.objNum },
      contents: 'Reply',
    })

    act(() => q(document, `pdf-annot-edit-${key}`)!.click())
    type('Edited')
    act(() => q(document, 'pdf-annot-thread-submit')!.click())
    expect(edit.services.getEdits().noteEdits).toEqual([
      { id: expect.any(String), annot: notes[0], contents: 'Edited' },
    ])

    act(() => q(document, `pdf-annot-delete-${key}`)!.click())
    const edits = edit.services.getEdits()
    expect(edits.annotDeletes).toEqual([{ id: expect.any(String), annot: notes[0] }])
    expect(edits.drawings).toEqual([])
    expect(edits.noteEdits).toEqual([])
  })

  it('takes presses on glyphs in highlighter mode and shows its bar above the pages', async () => {
    const { doc } = await startDoc(await textPdf(['Hello world']))
    const host = mountWorkspace(doc)
    const { surface } = await openTool(host)

    // the surface is stacked over the PDF.js text layer spans and under the links
    const textSpan = cssRule('view/pdfView.css', '.m-pdf-page .textLayer > :not(.markedContent)')
    const links = cssRule('view/pdfView.css', '.m-pdf-link-layer')
    const surfaceRule = cssRule('features/annot/annot.css', '.m-pdf-annot-surface')
    expect(Number(surfaceRule['z-index'])).toBeGreaterThan(Number(textSpan['z-index']))
    expect(Number(surfaceRule['z-index'])).toBeLessThan(Number(links['z-index']))
    expect(surfaceRule['pointer-events']).toBe('auto')
    // the layer holding it adds no stacking context of its own (no z-index), so the
    // surface competes with the spans in the page column
    expect(cssRule('features/annot/annot.css', '.m-pdf-annot-layer')['z-index']).toBeUndefined()
    // note pins, drawn after the surface, stay above it
    const pin = cssRule('features/annot/annot.css', '.m-pdf-annot-pin')
    expect(Number(pin['z-index'])).toBeGreaterThanOrEqual(Number(surfaceRule['z-index']))
    expect(surface.closest('.m-pdf-page')).not.toBeNull()

    // the bar sits in the stage column before the document area, not over the pages
    const bar = q(host, 'pdf-annot-bar')!
    expect(bar.parentElement).toBe(q(host, 'pdf-stage'))
    expect(bar.closest('[data-testid="pdf-scroll"]')).toBeNull()
    const barRule = cssRule('features/annot/annot.css', '.m-pdf-annot-bar')
    expect(barRule.position).toBe('relative')
    expect(barRule.order).toBe('-1')
    expect(barRule['flex-shrink']).toBe('0')
    expect(barRule.top).toBeUndefined()

    // other modes: no surface, so links and text keep their presses
    act(() => q(host, 'pdf-tool-highlighter')!.click())
    expect(q(host, 'pdf-annot-surface-0')).toBeNull()
    expect(q(host, 'pdf-annot-bar')).toBeNull()
  })

  it('changes nothing while viewing: no tool surface, read-only threads', async () => {
    const { doc, edit } = await startSavedDoc([
      newNoteOp({
        id: 'n1',
        pageIndex: 0,
        at: [100, 300],
        contents: 'Saved',
        author: 'Lee',
        now: 5,
      }),
    ])
    const host = mountWorkspace(doc, 'view')
    expect(q(host, 'pdf-tool-highlighter')).toBeNull()
    expect(q(host, 'pdf-annot-surface-0')).toBeNull()
    expect(q(host, 'pdf-annot-bar')).toBeNull()
    const { notes } = await loadSavedAnnots(edit.getModel().proxy, 0)
    const key = `S${notes[0]!.objNum}`
    await settle(() => q(host, `pdf-annot-pin-${key}`) !== null)
    act(() => q(host, `pdf-annot-pin-${key}`)!.click())
    await settle(() => q(document, `pdf-annot-comment-${key}`) !== null)
    expect(q(document, `pdf-annot-delete-${key}`)).toBeNull()
    expect(q(document, 'pdf-annot-thread-text')).toBeNull()
    expect(edit.store.hasEdits()).toBe(false)
  })
})
