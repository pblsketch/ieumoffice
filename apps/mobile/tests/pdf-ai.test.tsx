// Mobile PDF AI (track T2, PDF-T12, spec 3.12): the PC PDF skill over the mobile edit
// session, run only against a fake scripted transport (never a real provider or key).
// The offered tools are exactly the spec list, apply_ops takes only the listed ops, edit
// tools go through the view/edit gate, one run's edits are taken back as one, and a
// scripted run's highlight, note, form value, check mark and blank page land as pending
// edits. With AI off the PDF editor shows no AI entry.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi, type Mock } from 'vitest'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import {
  AgentLoop,
  type AgentSkill,
  type AgentStreamRequest,
  type AgentToolCall,
  type AgentTransport,
} from '@genoffice/agent-core'
import { createI18n } from '@genoffice/i18n'
import type { MobileClient, MobileDocSession } from '@genoffice/mobile-bridge/transport'
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import { strings as pcStrings } from '../../pdf/src/renderer/i18n/strings'
import type { EditorAiContext, EditorAiRun, EditorHost } from '../src/renderer/editors/editorKind'
import {
  buildSavePdfRequest,
  startPdfEditDocument,
  type PdfEditDocument,
} from '../src/renderer/editors/pdf/edit'
import type { PdfOpenedDocument } from '../src/renderer/editors/pdf/view/model'
import { openPdfModel } from '../src/renderer/editors/pdf/view/openPdf'
import { pcUnlockProbe } from '../src/renderer/editors/pdf/view/pcEngineHooks'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { translateMobile } from '../src/renderer/i18n/strings'

/** spec 3.12: the tools the phone offers */
const SPEC_TOOLS = [
  'read_pages',
  'search_text',
  'goto_page',
  'get_outline',
  'read_annotations',
  'markup_text',
  'add_note',
  'reply_note',
  'edit_note',
  'delete_markup',
  'delete_note',
  'list_form_fields',
  'add_form_mark',
  'insert_blank_page',
  'apply_ops',
]

const pcLabel = createI18n(pcStrings)

// 1×1 transparent PNG: the stand-in for the PC canvas-painted mark (jsdom has no 2D canvas)
const MARK_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

// ── fixtures ────────────────────────────────────────────────────────────────

/** Page 1: a heading, a text field and a printed box labelled "Agree"; page 2: plain text. */
async function samplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const first = doc.addPage([400, 500])
  first.drawText('Quarterly report summary', { x: 40, y: 450, size: 14, font })
  doc.getForm().createTextField('name').addToPage(first, { x: 40, y: 380, width: 200, height: 24 })
  first.drawRectangle({
    x: 100,
    y: 300,
    width: 14,
    height: 14,
    borderWidth: 1,
    borderColor: rgb(0, 0, 0),
  })
  first.drawText('Agree', { x: 120, y: 302, size: 12, font })
  doc.addPage([400, 500]).drawText('Second page notes', { x: 40, y: 450, size: 14, font })
  return doc.save({ useObjectStreams: false })
}

function session(over: Partial<MobileDocSession> = {}): MobileDocSession {
  return {
    sessionId: 's1',
    docKey: 'k1',
    name: 'report.pdf',
    ext: 'pdf',
    format: 'pdf',
    writable: true,
    ephemeral: false,
    ...over,
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

async function startDoc() {
  const { host, toasts } = fakeHost()
  const model = await openPdfModel({
    bytes: await samplePdf(),
    fileName: 'report.pdf',
    writable: true,
    isUntitled: false,
    fromRecovery: false,
    askPassword: async () => null,
    unlockProbe: pcUnlockProbe,
  })
  opened.push(model)
  const doc = startPdfEditDocument(host, model, {
    session: session(),
    unlockProbe: pcUnlockProbe,
    aiMarkPainter: (_kind, size = 12) => ({
      kind: 'image',
      image: MARK_PNG,
      width: size,
      height: size,
    }),
  })
  docs.push(doc)
  return { doc, store: doc.editSession.store, toasts }
}

interface FakeCtx {
  readonly ctx: EditorAiContext
  readonly switchToEdit: Mock<() => void>
  undo: { summary: string; undo: () => void } | null
  mode: DocumentMode
}

/** What App lends the run (useMobileAi), with the document's mode and capabilities. */
function fakeCtx(
  mode: DocumentMode = 'edit',
  caps = { writable: true, encrypted: false, distribution: false, isUntitled: false },
): FakeCtx {
  const state: FakeCtx = {
    mode,
    undo: null,
    switchToEdit: vi.fn(() => {
      state.mode = 'edit'
    }),
    ctx: {
      getMode: () => state.mode,
      getCapabilities: () => caps,
      switchToEdit: () => state.switchToEdit(),
      setUndo: (entry) => {
        state.undo = entry
      },
      getLang: () => 'ko',
    },
  }
  return state
}

let callSeq = 0
const call = (name: string, input: Record<string, unknown>): AgentToolCall => ({
  id: `c${++callSeq}`,
  name,
  input,
})

/** A model that answers from a script: each turn either calls tools or says its last words. */
function scriptedTransport(turns: AgentToolCall[][], finalText = 'Done.') {
  const requests: AgentStreamRequest[] = []
  let turn = 0
  const transport: AgentTransport = {
    stream(request, callbacks) {
      requests.push(request)
      const calls = turns[turn++]
      queueMicrotask(() => {
        if (calls) for (const c of calls) callbacks.onToolCall(c)
        else callbacks.onDelta(finalText)
        callbacks.onDone()
      })
      return { cancel: () => {} }
    },
  }
  return { transport, requests }
}

async function runScript(run: EditorAiRun, turns: AgentToolCall[][]) {
  const { transport, requests } = scriptedTransport(turns)
  const results: { name: string; isError: boolean; output: string }[] = []
  const skill: AgentSkill = {
    ...run.skill,
    get systemPrompt() {
      return run.skill.systemPrompt
    },
    get tools() {
      return run.skill.tools
    },
    async executeTool(c, signal) {
      const result = await run.skill.executeTool(c, signal)
      results.push({ name: c.name, isError: result.isError === true, output: result.output })
      return result
    },
  }
  await new Promise<void>((done, fail) => {
    const loop = new AgentLoop({
      transport,
      skill,
      events: { onDone: () => done(), onError: (e) => fail(new Error(e)) },
    })
    loop.run('Mark up the report and fill the form.')
  })
  run.finish?.()
  return { requests, results }
}

const exec = (run: EditorAiRun, name: string, input: Record<string, unknown>) =>
  run.skill.executeTool(call(name, input))

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

const roots: { root: Root; host: HTMLElement }[] = []

afterEach(async () => {
  for (const { root, host } of roots.splice(0)) {
    act(() => root.unmount())
    host.remove()
  }
  for (const doc of docs.splice(0)) opened.push(doc.editSession.getModel())
  for (const model of opened.splice(0)) await model.destroy().catch(() => {})
  vi.restoreAllMocks()
})

// ── the tools ────────────────────────────────────────────────────────────────

describe('offered tools', () => {
  it('are exactly the spec 3.12 list, each one the PC tool', async () => {
    const { doc } = await startDoc()
    const run = await doc.createAiRun!(fakeCtx().ctx)
    const names = run.skill.tools.map((t) => t.name)
    expect([...names].sort()).toEqual([...SPEC_TOOLS].sort())
    // the prompt names only what is offered and cites pages as text
    const prompt = run.skill.systemPrompt
    expect(prompt).not.toContain('pdfnav://')
    expect(prompt).not.toContain('insert_text')
    expect(prompt).not.toContain('web_search')
    expect(prompt).toContain('setFormValue')
    expect(prompt).toContain('add_form_mark')
    // the reply language follows the app (PC directive)
    expect(prompt).toContain('한국어로 답변하세요')
  })

  it('describe apply_ops with only the ops the phone takes', async () => {
    const { doc } = await startDoc()
    const run = await doc.createAiRun!(fakeCtx().ctx)
    const applyOps = run.skill.tools.find((t) => t.name === 'apply_ops')!
    expect(applyOps.description).toContain('- setFormValue ')
    expect(applyOps.description).toContain('- rotatePages ')
    expect(applyOps.description).not.toContain('addFormField')
    expect(applyOps.description).not.toContain('setMetadata')
    expect(applyOps.description).not.toContain('removeTextInsert')
  })

  it('refuses a tool that is not offered', async () => {
    const { doc } = await startDoc()
    const run = await doc.createAiRun!(fakeCtx().ctx)
    for (const name of ['insert_text', 'edit_text', 'web_search', 'insert_image', 'split_pdf']) {
      const result = await exec(run, name, {})
      expect(result.isError, name).toBe(true)
    }
  })

  it('labels each call in the app language from the PC strings', async () => {
    const { doc } = await startDoc()
    const run = await doc.createAiRun!(fakeCtx().ctx)
    const result = await exec(run, 'goto_page', { page: 2 })
    expect(result.isError).toBeFalsy()
    expect(result.summary).toBe(pcLabel('ko', 'aiToolGoto', { page: 2 }))
  })
})

describe('apply_ops on the phone', () => {
  it('refuses an op outside the list and applies nothing of the batch', async () => {
    const { doc, store } = await startDoc()
    const run = await doc.createAiRun!(fakeCtx().ctx)
    for (const ops of [
      [{ op: 'setMetadata', metadata: { title: 'New' } }],
      [
        {
          op: 'addFormField',
          field: { name: 'x', kind: 'text', page: 1, x: 1, y: 1, width: 9, height: 9 },
        },
      ],
      [{ op: 'removeTextInsert', id: 'T1' }],
      [
        { op: 'rotatePages', pages: [1], dir: 90 },
        { op: 'addDrawing', drawing: { kind: 'ink', pageIndex: 0, color: [0, 0, 0], paths: [] } },
      ],
    ]) {
      const result = await exec(run, 'apply_ops', { ops })
      expect(result.isError).toBe(true)
      expect(result.output).toContain('Nothing was applied')
      expect(result.output).toContain('the mobile app does not do')
    }
    expect(store.hasEdits()).toBe(false)
    expect(store.canUndo()).toBe(false)
  })

  it('applies the listed ops as one undo step', async () => {
    const { doc, store } = await startDoc()
    const run = await doc.createAiRun!(fakeCtx().ctx)
    const result = await exec(run, 'apply_ops', {
      ops: [
        { op: 'rotatePages', pages: [2], dir: 90 },
        { op: 'setFormValue', value: { name: 'name', value: 'Kim' } },
      ],
    })
    expect(result.isError).toBeFalsy()
    const edits = store.getSnapshot()
    expect(edits.rotations.get(1)).toBe(90)
    expect(edits.formEdits.get('name')).toEqual({ name: 'name', kind: 'text', value: 'Kim' })
    expect(store.undoSnapshots()).toHaveLength(1)
  })
})

describe('view/edit gate', () => {
  it('switches a viewed document to edit mode before an edit tool runs', async () => {
    const { doc, store } = await startDoc()
    const fake = fakeCtx('view')
    const run = await doc.createAiRun!(fake.ctx)
    // reading stays in view mode
    await exec(run, 'search_text', { query: 'Quarterly' })
    expect(fake.switchToEdit).not.toHaveBeenCalled()
    const result = await exec(run, 'insert_blank_page', { after_page: 1 })
    expect(result.isError).toBeFalsy()
    expect(fake.switchToEdit).toHaveBeenCalledTimes(1)
    expect(fake.mode).toBe('edit')
    expect(store.getSnapshot().blankPages).toHaveLength(1)
  })

  it('withholds and refuses edit tools on a document that may not be changed', async () => {
    const { doc, store } = await startDoc()
    const fake = fakeCtx('view', {
      writable: false,
      encrypted: false,
      distribution: false,
      isUntitled: false,
    })
    const run = await doc.createAiRun!(fake.ctx)
    const names = run.skill.tools.map((t) => t.name)
    expect(names).toContain('read_pages')
    expect(names).not.toContain('markup_text')
    expect(names).not.toContain('apply_ops')
    const result = await exec(run, 'markup_text', {
      page: 1,
      text: 'Quarterly',
      type: 'highlight',
    })
    expect(result.isError).toBe(true)
    expect(fake.switchToEdit).not.toHaveBeenCalled()
    expect(store.hasEdits()).toBe(false)
  })
})

// ── a scripted run ───────────────────────────────────────────────────────────

describe('a scripted run', () => {
  const script = (): AgentToolCall[][] => [
    [call('search_text', { query: 'Quarterly report' }), call('list_form_fields', {})],
    [
      call('markup_text', { page: 1, text: 'Quarterly report', type: 'highlight' }),
      call('add_note', { page: 1, text: 'Check the numbers', anchor_text: 'summary' }),
    ],
    [
      call('apply_ops', { ops: [{ op: 'setFormValue', value: { name: 'name', value: 'Kim' } }] }),
      call('add_form_mark', { page: 1, kind: 'check', anchor_text: 'Agree', placement: 'left' }),
      call('insert_blank_page', { after_page: 2 }),
    ],
  ]

  it('highlights, adds a note, fills a field, ticks a box and adds a blank page', async () => {
    const { doc, store } = await startDoc()
    const fake = fakeCtx('view')
    const run = await doc.createAiRun!(fake.ctx)
    const { requests, results } = await runScript(run, script())

    // every model turn was offered exactly the spec tools
    for (const request of requests) {
      expect(request.tools.map((t) => t.name).sort()).toEqual([...SPEC_TOOLS].sort())
    }
    expect(results.filter((r) => r.isError)).toEqual([])
    expect(fake.switchToEdit).toHaveBeenCalledTimes(1)

    const edits = store.getSnapshot()
    expect(edits.markups).toHaveLength(1)
    expect(edits.markups[0]).toMatchObject({ pageIndex: 0, type: 'highlight' })
    expect(edits.drawings).toHaveLength(1)
    expect(edits.drawings[0]!.input).toMatchObject({
      kind: 'note',
      pageIndex: 0,
      contents: 'Check the numbers',
      author: 'AI Assistant',
    })
    expect([...edits.formEdits.values()]).toEqual([{ name: 'name', kind: 'text', value: 'Kim' }])
    expect(edits.imageEdits).toHaveLength(1)
    expect(edits.imageEdits[0]!.input).toMatchObject({ kind: 'insertImage', pageIndex: 0 })
    expect(edits.imageEdits[0]!.staticFill).toMatchObject({ kind: 'check', pageIndex: 0 })
    expect(edits.blankPages).toHaveLength(1)
    expect(edits.blankPages[0]!.input).toMatchObject({ pageIndex: 2, width: 400, height: 500 })

    // the save request carries them the PC way
    const request = buildSavePdfRequest(edits, doc.editSession.getModel())
    expect(request.markups).toHaveLength(1)
    expect(request.drawings).toHaveLength(1)
    expect(request.formValues).toEqual([{ name: 'name', kind: 'text', value: 'Kim' }])
    expect(request.blankPages).toHaveLength(1)

    // one change card for the run
    expect(fake.undo?.summary).toBe(translateMobile('ko', 'aiChangedPlaces', { count: 5 }))
  })

  it('takes the whole run back at once, and Redo replays it', async () => {
    const { doc, store, toasts } = await startDoc()
    const fake = fakeCtx()
    const run = await doc.createAiRun!(fake.ctx)
    await runScript(run, script())
    expect(store.undoSnapshots()).toHaveLength(5)

    fake.undo!.undo()
    expect(fake.undo).toBeNull()
    expect(store.hasEdits()).toBe(false)
    expect(store.canUndo()).toBe(false)
    expect(toasts).toEqual([])
    // Redo replays the run batch by batch, the highlight first
    store.redo()
    expect(store.getSnapshot().markups).toHaveLength(1)
    expect(store.getSnapshot().drawings).toHaveLength(0)
    for (let i = 0; i < 4; i++) store.redo()
    expect(store.getSnapshot().blankPages).toHaveLength(1)
  })

  it('refuses to take the run back once the document changed after it', async () => {
    const { doc, store, toasts } = await startDoc()
    const fake = fakeCtx()
    const run = await doc.createAiRun!(fake.ctx)
    await runScript(run, script())
    // the person rotates a page afterwards
    doc.editSession.services.dispatch([{ op: 'rotatePages', pages: [0], dir: 90 }])

    fake.undo!.undo()
    expect(toasts).toEqual([translateMobile('ko', 'aiUndoRefused')])
    const edits = store.getSnapshot()
    expect(edits.markups).toHaveLength(1)
    expect(edits.rotations.get(0)).toBe(90)
  })

  it('leaves no change card when the run changed nothing', async () => {
    const { doc } = await startDoc()
    const fake = fakeCtx()
    const run = await doc.createAiRun!(fake.ctx)
    await runScript(run, [[call('read_pages', { start: 1 })]])
    expect(fake.undo).toBeNull()
  })
})

// ── AI off ───────────────────────────────────────────────────────────────────

function mount(doc: PdfEditDocument, aiEnabled: boolean, mode: DocumentMode) {
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
            docTitle: 'report.pdf',
            docFormat: 'pdf' as const,
            saveState: 'saved' as const,
            mode,
            canEdit: true,
            aiEnabled,
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

const AI_ENTRIES = [
  '[data-testid="phone-ai-open-btn"]',
  '[data-testid="phone-view-ai-btn"]',
  '[data-testid="tablet-ai-toggle"]',
  '[data-testid="editor-ai-sheet"]',
]

describe('AI off by default', () => {
  it('shows no AI entry in the PDF editor while AI is off', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const { doc } = await startDoc()
    for (const mode of ['view', 'edit'] as const) {
      const host = mount(doc, false, mode)
      for (const selector of AI_ENTRIES) expect(host.querySelector(selector), selector).toBeNull()
    }
    // the same frame with AI on does show it
    const on = mount(doc, true, 'view')
    expect(AI_ENTRIES.some((selector) => on.querySelector(selector) !== null)).toBe(true)
  })

  it('keeps the tools out of the first load: the run loads them on demand', () => {
    const root = resolve(__dirname, '../src/renderer/editors/pdf')
    const run = readFileSync(join(root, 'ai/createAiRun.ts'), 'utf8')
    expect(run).toContain("await import('./pdfAgent')")
    expect(run).not.toMatch(/^import[^\n]*from '\.\/(pdfAgent|deps|applyOps|relabel)'/m)
    expect(run).not.toMatch(/^import [^t][^\n]*pdf-skill/m)
    const start = readFileSync(join(root, 'edit/startPdfEditDocument.tsx'), 'utf8')
    expect(start).not.toMatch(/from '\.\.\/ai\/(pdfAgent|deps)'/)
  })
})
