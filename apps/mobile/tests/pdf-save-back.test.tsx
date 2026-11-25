// Back history across a save of the PDF editor (track T2, PDF-FIX-D). A save reloads
// the document from the written bytes; the editor screen must stay mounted through it.
// When the Workspace was remounted for the new document, the shell's editor and
// edit-mode layers were removed (two asynchronous back steps) and armed again (two
// immediate pushes) in the same moment: the history drifted from the back stack, and in
// a browser [Done] could step back past the app's first entry (about:blank).
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import type { ActiveDocState } from '@genoffice/mobile-bridge/session-state'
import type { MobileClient, MobileDocSession } from '@genoffice/mobile-bridge/transport'
import type { Op } from '../../pdf/src/renderer/edit-ops'
import type { EditorHost } from '../src/renderer/editors/editorKind'
import { startPdfEditDocument, type PdfEditDocument } from '../src/renderer/editors/pdf/edit'
import { setSharedPdfEngine } from '../src/renderer/editors/pdf/engine'
import { createInThreadPdfEngine } from '../src/renderer/editors/pdf/engine/inThread'
import type { PdfOpenedDocument } from '../src/renderer/editors/pdf/view/model'
import { openPdfModel } from '../src/renderer/editors/pdf/view/openPdf'
import { pcUnlockProbe } from '../src/renderer/editors/pdf/view/pcEngineHooks'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { translateMobile } from '../src/renderer/i18n/strings'
import { BackStackProvider } from '../src/renderer/shell/backStack'

async function textPdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const text of pages) {
    doc.addPage([400, 500]).drawText(text, { x: 40, y: 400, size: 14, font })
  }
  return doc.save({ useObjectStreams: false })
}

const rectOp = (pageIndex = 0): Op => ({
  op: 'addDrawing',
  drawing: { kind: 'rect', pageIndex, color: [1, 0, 0], width: 2, rect: [50, 50, 150, 120] },
})

const session: MobileDocSession = {
  sessionId: 's1',
  docKey: 'k1',
  name: 'sample.pdf',
  ext: 'pdf',
  format: 'pdf',
  writable: true,
  ephemeral: false,
}

const docState: ActiveDocState = {
  session,
  dirty: true,
  encrypted: false,
  distribution: false,
  trackingDropped: false,
  isUntitled: false,
}

function fakeHost(saved: string[]): EditorHost {
  const client = {
    getAppPrefs: async () => ({ lang: 'ko', theme: 'system', aiEnabled: false }),
    saveFileBytes: async (_sessionId: string, bytesBase64: string) => {
      saved.push(bytesBase64)
    },
    recoveryWrite: async () => ({ ok: true }),
    recoveryDiscard: async () => ({ ok: true }),
  } as unknown as MobileClient
  return {
    client,
    markDirty: () => {},
    updateSession: () => {},
    setNotice: () => {},
    showToast: () => {},
    contentChanged: () => {},
    refreshHome: async () => {},
    openSession: async () => {},
    translate: (key, params) => translateMobile('ko', key, params),
    windowClass: () => 'compact',
  }
}

const opened: PdfOpenedDocument[] = []
const roots: { root: Root; host: HTMLElement }[] = []

async function startDoc(saved: string[]): Promise<PdfEditDocument> {
  const bytes = await textPdf(['One', 'Two'])
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
  return startPdfEditDocument(fakeHost(saved), model, {
    session,
    unlockProbe: pcUnlockProbe,
    onModelReplaced: (next) => void opened.push(next),
  })
}

function mount(doc: PdfEditDocument) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push({ root, host })
  const Workspace = doc.Workspace
  const render = (mode: 'view' | 'edit') => {
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
    const node: ReactNode = (
      <BackStackProvider>
        <MobileLocaleProvider lang="ko">
          <Workspace frame={frame} mode={mode} canEdit lang="ko" theme="light" />
        </MobileLocaleProvider>
      </BackStackProvider>
    )
    act(() => root.render(node))
  }
  return { root, render }
}

const q = (testId: string) => document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)

/** Lets jsdom run its queued history traversals (popstate) and React finish. */
async function settle() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
  }
}

/** Counts the history calls the back stack makes (calling through). */
function watchHistory() {
  const back = vi.spyOn(window.history, 'back')
  const push = vi.spyOn(window.history, 'pushState')
  return {
    counts: () => ({ back: back.mock.calls.length, push: push.mock.calls.length }),
    reset: () => {
      back.mockClear()
      push.mockClear()
    },
  }
}

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  setSharedPdfEngine(createInThreadPdfEngine())
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(async () => {
  for (const { root, host } of roots.splice(0)) {
    act(() => root.unmount())
    host.remove()
  }
  await settle()
  for (const model of opened.splice(0)) await model.destroy().catch(() => {})
  setSharedPdfEngine(null)
  vi.restoreAllMocks()
})

describe('saving the PDF editor keeps the back history', () => {
  it('[완료] with a pending edit drops only the edit-mode entry and Back never leaves past the start', async () => {
    const startState: unknown = window.history.state
    const startLength = window.history.length
    const saved: string[] = []
    const doc = await startDoc(saved)
    const { root, render } = mount(doc)
    // App opens a document in view mode (the editor screen's entry), then edit mode
    render('view')
    await settle()
    const editorState: unknown = window.history.state
    render('edit')
    await settle()
    const editState: unknown = window.history.state
    expect(editState).not.toEqual(editorState)
    const header = q('editor-header')
    expect(header).not.toBeNull()

    act(() => void doc.editSession.services.dispatch([rectOp()]))
    const before = doc.editSession.getModel()
    const lengthBefore = window.history.length
    const history = watchHistory()

    // App's [Done] (handleDone): save the pending edits, then back to view mode
    let ok = false
    await act(async () => {
      ok = await doc.save!(docState, false)
    })
    expect(ok).toBe(true)
    expect(saved).toHaveLength(1)
    expect(doc.editSession.getModel()).not.toBe(before)
    await settle()
    // the reload swapped the document in place: no back layer was removed or added
    expect(history.counts()).toEqual({ back: 0, push: 0 })
    expect(window.history.state).toEqual(editState)
    expect(window.history.length).toBe(lengthBefore)
    expect(q('editor-header')).toBe(header)
    expect(q('pdf-stage')).not.toBeNull()

    render('view')
    await settle()
    // leaving edit mode drops its one entry
    expect(history.counts()).toEqual({ back: 1, push: 0 })
    expect(window.history.state).toEqual(editorState)

    // leaving the editor lands where the app started
    act(() => root.unmount())
    roots.splice(0)
    await settle()
    expect(window.history.state).toEqual(startState)
    expect(window.history.length).toBeGreaterThanOrEqual(startLength)
  }, 60_000)

  it('[저장] in edit mode stays in edit mode with the same entries and the tools off', async () => {
    const saved: string[] = []
    const doc = await startDoc(saved)
    const { render } = mount(doc)
    render('view')
    await settle()
    render('edit')
    await settle()
    const editState: unknown = window.history.state
    const header = q('editor-header')
    // a bar tool on (the highlighter holds no history entry of its own)
    act(() => void q('pdf-tool-highlighter')!.click())
    expect(q('pdf-tool-highlighter')!.getAttribute('data-active')).toBe('true')
    await settle()
    expect(window.history.state).toEqual(editState)

    act(() => void doc.editSession.services.dispatch([rectOp()]))
    const history = watchHistory()
    await act(async () => {
      await doc.save!(docState, false)
    })
    await settle()
    expect(saved).toHaveLength(1)
    expect(history.counts()).toEqual({ back: 0, push: 0 })
    expect(window.history.state).toEqual(editState)
    expect(q('editor-header')).toBe(header)
    // the edit bar is still there for the reloaded document, no tool left on
    for (const tool of ['pen', 'highlighter', 'textbox', 'sign']) {
      const icon = q(`pdf-tool-${tool}`)
      expect(icon, tool).not.toBeNull()
      expect(icon!.getAttribute('data-active'), tool).toBe('false')
    }
    // the reloaded document is the one on screen: a second edit saves from it
    act(() => void doc.editSession.services.dispatch([rectOp(1)]))
    await act(async () => {
      await doc.save!(docState, false)
    })
    await settle()
    expect(saved).toHaveLength(2)
    expect(history.counts()).toEqual({ back: 0, push: 0 })
    expect(window.history.state).toEqual(editState)
  }, 60_000)
})
