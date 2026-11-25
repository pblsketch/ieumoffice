// Back history of sheets opened from the [⋯] More sheet (track T2, PDF-FIX-B). The
// shell's back stack steps history back asynchronously when the More sheet closes but
// pushes the next sheet's entry at once; the PDF editor therefore opens what a More row
// asks for only after that back step (view/moreSheetBack.ts). Without that, jsdom drops
// the pending back step (a browser may land it on the new entry instead), so each round
// leaves one entry too many and later Backs close the wrong layer.
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import type { ActiveDocState } from '@genoffice/mobile-bridge/session-state'
import type { MobileClient, MobileDocSession } from '@genoffice/mobile-bridge/transport'
import type { EditorHost } from '../src/renderer/editors/editorKind'
import { startPdfEditDocument, type PdfEditDocument } from '../src/renderer/editors/pdf/edit'
import { setSharedPdfEngine } from '../src/renderer/editors/pdf/engine'
import { createInThreadPdfEngine } from '../src/renderer/editors/pdf/engine/inThread'
import type { PdfOpenedDocument } from '../src/renderer/editors/pdf/view/model'
import {
  afterMoreSheetBack,
  MORE_SHEET_BACK_TIMEOUT_MS,
  noteMoreSheetBack,
} from '../src/renderer/editors/pdf/view/moreSheetBack'
import { openPdfModel } from '../src/renderer/editors/pdf/view/openPdf'
import { pcUnlockProbe } from '../src/renderer/editors/pdf/view/pcEngineHooks'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { translateMobile } from '../src/renderer/i18n/strings'
import { BackStackProvider } from '../src/renderer/shell/backStack'

const t = (key: Parameters<typeof translateMobile>[1]) => translateMobile('ko', key)

async function textPdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const text of pages) {
    doc.addPage([400, 500]).drawText(text, { x: 40, y: 400, size: 14, font })
  }
  return doc.save({ useObjectStreams: false })
}

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

function fakeHost(): EditorHost {
  const client = {
    getAppPrefs: async () => ({ lang: 'ko', theme: 'system', aiEnabled: false }),
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

async function startDoc(): Promise<PdfEditDocument> {
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
  return startPdfEditDocument(fakeHost(), model, { session, unlockProbe: pcUnlockProbe })
}

function frameProps(doc: PdfEditDocument, mode: 'view' | 'edit') {
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
    // App: Save As runs the document's save with forceSaveAs in the row's own tap
    onSaveAs: () => void doc.save!(docState, true),
    onShare: () => {},
    onOpenBackups: () => {},
    aiPanelContent: null,
  }
}

function mount(doc: PdfEditDocument) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push({ root, host })
  const Workspace = doc.Workspace
  const render = (mode: 'view' | 'edit') => {
    const node: ReactNode = (
      <BackStackProvider>
        <MobileLocaleProvider lang="ko">
          <Workspace frame={frameProps(doc, mode)} mode={mode} canEdit lang="ko" theme="light" />
        </MobileLocaleProvider>
      </BackStackProvider>
    )
    act(() => root.render(node))
  }
  render('edit')
  return { root, render }
}

const q = (testId: string) => document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)

function click(el: Element | null) {
  expect(el).not.toBeNull()
  act(() => void (el as HTMLElement).click())
}

/** Lets jsdom run its queued history traversals (popstate) and React finish. */
async function settle() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
  }
}

const layerOf = (state: unknown): unknown =>
  (state as { ieumBackLayer?: unknown } | null)?.ieumBackLayer

function moreRow(label: string): HTMLElement {
  const sheet = q('editor-more-sheet')!
  const row = [...sheet.querySelectorAll<HTMLElement>('button')].find(
    (b) => b.textContent === label,
  )
  expect(row, label).toBeDefined()
  return row!
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

describe('sheets opened from the More sheet', () => {
  it('keep the back stack and the history in step, and Back never leaves past the start', async () => {
    const startState: unknown = window.history.state
    const doc = await startDoc()
    const { root, render } = mount(doc)
    await settle()
    // the editor screen and edit mode each hold one entry
    const base: unknown = window.history.state
    expect(layerOf(base)).toBeDefined()

    const rounds: { row: () => HTMLElement; shown: string; close: () => void }[] = [
      {
        row: () => q('editor-more-pdfGoToPage')!,
        shown: 'pdf-goto-sheet',
        close: () =>
          act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))),
      },
      {
        row: () => q('editor-more-pdfOutline')!,
        shown: 'pdf-outline-sheet',
        close: () =>
          act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))),
      },
      {
        row: () => q('editor-more-pdfEdit-pages')!,
        shown: 'pdf-pages-sheet',
        close: () =>
          act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))),
      },
      {
        // placing a link holds its own entry too
        row: () => q('editor-more-pdfEdit-link')!,
        shown: 'pdf-link-placing',
        close: () => click(q('pdf-link-placing-cancel')),
      },
      {
        row: () => moreRow(t('saveAs')),
        shown: 'pdf-save-as-sheet',
        close: () =>
          act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))),
      },
    ]

    for (const round of rounds) {
      click(q('editor-more-btn'))
      expect(q('editor-more-sheet')).not.toBeNull()
      const moreState: unknown = window.history.state
      expect(layerOf(moreState)).not.toBe(layerOf(base))

      click(round.row())
      await settle()
      expect(q('editor-more-sheet')).toBeNull()
      expect(q(round.shown), round.shown).not.toBeNull()
      // the sheet's entry replaced the More sheet's, on top of the edit-mode entry
      expect(layerOf(window.history.state)).not.toBe(layerOf(moreState))

      round.close()
      await settle()
      expect(q(round.shown), round.shown).toBeNull()
      // back on the edit-mode entry: nothing left over from the More sheet
      expect(window.history.state).toEqual(base)
    }

    // leaving edit mode, then the editor, drops their entries and lands where the app
    // started (one at a time: jsdom folds two back steps queued in one task into one)
    render('view')
    await settle()
    act(() => root.unmount())
    roots.splice(0)
    await settle()
    expect(window.history.state).toEqual(startState)
  }, 60_000)
})

describe('afterMoreSheetBack', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  function showMoreSheet(armed: boolean) {
    const sheet = document.createElement('div')
    sheet.setAttribute('data-testid', 'editor-more-sheet')
    document.body.appendChild(sheet)
    window.history.replaceState(armed ? { ieumBackLayer: 99 } : null, '')
  }

  it('opens at once when no More sheet is closing or no back stack holds an entry', () => {
    const open = vi.fn()
    window.history.replaceState({ ieumBackLayer: 1 }, '')
    afterMoreSheetBack(open)
    expect(open).toHaveBeenCalledTimes(1)

    showMoreSheet(false)
    afterMoreSheetBack(open)
    expect(open).toHaveBeenCalledTimes(2)
    expect(noteMoreSheetBack()).toBeNull()
  })

  it('waits for the back step (popstate), shared by every open in the same tap', async () => {
    showMoreSheet(true)
    const first = vi.fn()
    const second = vi.fn()
    afterMoreSheetBack(first)
    document.body.innerHTML = ''
    // the sheet is gone by now; the noted wait still holds
    afterMoreSheetBack(second)
    await Promise.resolve()
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    window.dispatchEvent(new PopStateEvent('popstate'))
    await Promise.resolve()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    // settled: the next open is immediate
    const third = vi.fn()
    afterMoreSheetBack(third)
    expect(third).toHaveBeenCalledTimes(1)
  })

  it('opens anyway when the back step never arrives', async () => {
    vi.useFakeTimers()
    showMoreSheet(true)
    const open = vi.fn()
    afterMoreSheetBack(open)
    await vi.advanceTimersByTimeAsync(MORE_SHEET_BACK_TIMEOUT_MS - 1)
    expect(open).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(open).toHaveBeenCalledTimes(1)
  })
})
