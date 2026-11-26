/**
 * The PDF tools screens (spec 5.1–5.4): the tools list, the full-screen flow
 * from each start, files, options, running and stopping, refusals, the
 * result sheet and the blank-page review, and the home [Tools] tab. The
 * engine and the native bridge are fakes; the real engine has its own tests
 * (pdf-tools-engine*.test.ts).
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parseMobileCommandError,
  type MobileClient,
  type MobileDocSession,
} from '@genoffice/mobile-bridge/transport'
import type { HomeHost } from '../src/renderer/home/homeHost'
import { ToolsTab } from '../src/renderer/home/ToolsTab'
import { translateMobile, type MobileStringKey } from '../src/renderer/i18n'
import { BackStackProvider } from '../src/renderer/shell/backStack'
import { MOBILE_PDF_TOOLS } from '../src/renderer/tools/catalog'
import type {
  BlankPagesOutcome,
  InspectResult,
  PdfToolsEngine,
  ToolFile,
  ToolResultFile,
  ToolRunOutcome,
} from '../src/renderer/tools/engine/types'
import { PdfToolsEnvProvider, type PdfToolsEnv } from '../src/renderer/tools/env'
import PdfToolsFlowScreen from '../src/renderer/tools/flow/Flow'
import { failureKey, formatBytes } from '../src/renderer/tools/flow/format'
import { pdfToolsLink, type PdfToolsFlowStart } from '../src/renderer/tools/link'
import { ToolsList } from '../src/renderer/tools/ToolsList'

// The editor registry fixed to the base kinds (HWP, Markdown), so a track that registers
// another editor (e.g. T2's PDF editor) does not change what these tests see. A test that
// wants a PDF editor adds one through `registry.withPdf`.
const registry = vi.hoisted(() => ({ withPdf: false }))
vi.mock('../src/renderer/editors/registry', async () => {
  const { hwpEditorKind } = await import('../src/renderer/editors/hwpKind')
  const { markdownEditorKind } = await import('../src/renderer/editors/markdownKind')
  const base = [hwpEditorKind, markdownEditorKind]
  const pdfKind = { ...markdownEditorKind, id: 'pdf', formats: ['pdf'], openExtensions: ['pdf'] }
  const kinds = () => (registry.withPdf ? [...base, pdfKind] : base)
  return {
    get EDITOR_KINDS() {
      return kinds()
    },
    findEditorKind: (format: string) =>
      kinds().find((kind) => (kind.formats as readonly string[]).includes(format)) ?? null,
    openableExtensions: () => kinds().flatMap((kind) => kind.openExtensions),
  }
})

// React's act() checks this flag
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const en = (key: MobileStringKey, params?: Record<string, string | number>) =>
  translateMobile('en', key, params)

// ---- fakes

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

interface RunCall {
  tool: string
  files: readonly ToolFile[]
  options: Record<string, unknown>
  onProgress?: (done: number, total: number) => void
  done: Deferred<ToolRunOutcome>
}

interface FindCall {
  file: ToolFile
  onProgress?: (done: number, total: number) => void
  done: Deferred<BlankPagesOutcome>
}

function makeEngine(answers: Record<string, InspectResult> = {}) {
  const runs: RunCall[] = []
  const finds: FindCall[] = []
  const inspected: string[] = []
  let manual: Deferred<void>[] | null = null
  const engine = {
    inspect: vi.fn(async (file: ToolFile) => {
      inspected.push(file.name)
      if (manual) {
        const gate = deferred<void>()
        manual.push(gate)
        await gate.promise
      }
      return { ...(answers[file.name] ?? { ok: true, pages: 4 }), sizeBytes: 2048 }
    }),
    run: vi.fn(
      (
        tool: string,
        files: readonly ToolFile[],
        options: Record<string, unknown>,
        onProgress?: (done: number, total: number) => void,
      ) => {
        const done = deferred<ToolRunOutcome>()
        runs.push({ tool, files, options, onProgress, done })
        return done.promise
      },
    ),
    findBlankPages: vi.fn((file: ToolFile, onProgress?: (done: number, total: number) => void) => {
      const done = deferred<BlankPagesOutcome>()
      finds.push({ file, onProgress, done })
      return done.promise
    }),
    zip: vi.fn(
      async (_files: readonly ToolResultFile[], zipName: string): Promise<ToolResultFile> => ({
        name: zipName,
        mime: 'application/zip',
        bytes: new Uint8Array([9, 9, 9]),
      }),
    ),
    stop: vi.fn(() => {
      for (const run of runs) run.done.resolve({ ok: false, reason: 'stopped' })
      for (const find of finds) find.done.resolve({ ok: false, reason: 'stopped' })
    }),
    dispose: vi.fn(),
  }
  return {
    engine: engine as unknown as PdfToolsEngine & typeof engine,
    runs,
    finds,
    inspected,
    /** inspections wait until `release()` lets the next one finish */
    holdInspections() {
      manual = []
      return {
        pending: () => manual!.length,
        release: () => manual!.shift()?.resolve(),
      }
    },
  }
}

const cancelled = { code: 'USER_CANCELLED', messageKey: 'mobile.userCancelled' }

function makeHost(opts: { withCopy?: boolean; invoke?: (cmd: string) => Promise<unknown> } = {}) {
  const invoke = vi.fn(
    opts.invoke ??
      (async (cmd: string) =>
        cmd === 'mobile_pdf_tools_save_copy' ? { name: 'x' } : { ok: true }),
  )
  const client = {
    transport: { invoke, listen: vi.fn() },
    pickOpenFile: vi.fn(),
  } as unknown as MobileClient & { pickOpenFile: ReturnType<typeof vi.fn> }
  const host = {
    client,
    openSession: vi.fn(async () => {}),
    createNew: vi.fn(async () => {}),
    showToast: vi.fn(),
    refreshHome: vi.fn(async () => {}),
    openSettings: vi.fn(),
    ...(opts.withCopy ? { openUntitledCopy: vi.fn(async () => {}) } : {}),
  }
  return { host: host as HomeHost & typeof host, invoke, client }
}

function input(name: string, mime = 'application/pdf', sizeBytes?: number) {
  return {
    name,
    mime,
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    readBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  }
}

const pdfResult = (name: string, size = 10): ToolResultFile => ({
  name,
  mime: 'application/pdf',
  bytes: new Uint8Array(size),
})

// ---- rendering

const roots: Root[] = []
const containers: HTMLElement[] = []

beforeEach(() => {
  // a browser answers history.back() with a popstate; here at once
  vi.spyOn(window.history, 'back').mockImplementation(() => {
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
})

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  while (containers.length > 0) containers.pop()?.remove()
  vi.restoreAllMocks()
})

async function flush(times = 4) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  }
}

async function render(node: ReactNode, env: PdfToolsEnv) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  containers.push(el)
  const root = createRoot(el)
  roots.push(root)
  await act(async () => {
    root.render(
      <BackStackProvider>
        <PdfToolsEnvProvider value={env}>{node}</PdfToolsEnvProvider>
      </BackStackProvider>,
    )
  })
  await flush()
  return el
}

interface FlowSetup {
  start: PdfToolsFlowStart
  engine?: ReturnType<typeof makeEngine>
  host?: ReturnType<typeof makeHost>
  editorOpens?: (ext: string) => boolean
}

async function renderFlow(setup: FlowSetup) {
  const engine = setup.engine ?? makeEngine()
  const host = setup.host ?? makeHost()
  const onClose = vi.fn()
  await render(<PdfToolsFlowScreen host={host.host} start={setup.start} onClose={onClose} />, {
    createEngine: () => engine.engine,
    editorOpens: setup.editorOpens ?? (() => false),
  })
  return { engine, host, onClose }
}

const body = () => document.body

function buttons(text: string): HTMLButtonElement[] {
  return [...body().querySelectorAll<HTMLButtonElement>('button')].filter(
    (b) => b.textContent?.trim() === text || b.getAttribute('aria-label') === text,
  )
}

function button(text: string): HTMLButtonElement {
  const found = buttons(text)
  if (found.length === 0) throw new Error(`no button "${text}"`)
  return found[0]!
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click()
  })
  await flush()
}

async function pickFiles(files: File[]) {
  const picker = body().querySelector<HTMLInputElement>('[data-testid="pdf-tools-file-input"]')!
  Object.defineProperty(picker, 'files', { value: files, configurable: true })
  await act(async () => {
    picker.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await flush()
}

async function systemBack() {
  await act(async () => {
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await flush()
}

const rows = () => [...body().querySelectorAll('[data-testid="pdf-tools-file-row"]')]
const rowNames = () => rows().map((r) => r.querySelector('.pdf-tools-file-name')?.textContent)
const title = () => body().querySelector('.pdf-tools-flow h1')?.textContent
const optionsSheet = () => body().querySelector('[data-testid="pdf-tools-options-sheet"]')
const resultSheet = () => body().querySelector('[data-testid="pdf-tools-result-sheet"]')
const appBarBack = () =>
  body().querySelector<HTMLButtonElement>('.pdf-tools-flow .mobile-appbar button')!

/** Files picked, [Next], then [Start] of the options sheet */
async function toRunning(start: PdfToolsFlowStart, setup: Omit<FlowSetup, 'start'> = {}) {
  const made = await renderFlow({ start, ...setup })
  // from the list: the reverse tool
  if (start.kind === 'menu')
    await click(body().querySelector<HTMLButtonElement>('[data-tool="reverse"]')!)
  if (rows().length === 0)
    await pickFiles([new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })])
  await click(button(en('pdfToolsNext')))
  await click(button(en('pdfToolsStart')))
  return made
}

// ---- tests

describe('tools list', () => {
  it('shows the intro, the four groups and every first-version tool, without the edit card when no PDF editor is registered', async () => {
    const { host } = makeHost()
    await render(<ToolsList host={host} onPickTool={() => {}} />, {})
    expect(body().textContent).toContain(en('pdfToolsIntro'))
    expect(body().textContent).toContain(en('pdfToolsDeviceNote'))
    const headings = [...body().querySelectorAll('h2')].map((h) => h.textContent)
    expect(headings).toEqual([
      en('pdfToolsGroupOrganize'),
      en('pdfToolsGroupConvert'),
      en('pdfToolsGroupSizeSecurity'),
      en('pdfToolsGroupClean'),
    ])
    const cards = [...body().querySelectorAll<HTMLElement>('.pdf-tools-card')]
    expect(cards.map((c) => c.dataset.tool)).toEqual([...MOBILE_PDF_TOOLS])
    expect(cards[0]!.textContent).toContain(en('pdfToolsToolMerge'))
    expect(cards[0]!.textContent).toContain(en('pdfToolsDescMerge'))
    expect(cards[0]!.querySelector('svg')).not.toBeNull()
    expect(body().querySelector('[data-tool="edit"]')).toBeNull()
  })

  it('shows the edit card once the registry has an editor that opens .pdf', async () => {
    registry.withPdf = true
    try {
      const { host } = makeHost()
      await render(<ToolsList host={host} onPickTool={() => {}} />, {})
      expect(body().textContent).toContain(en('pdfToolsGroupEditor'))
      expect(body().querySelector('[data-tool="edit"]')).not.toBeNull()
    } finally {
      registry.withPdf = false
    }
  })

  it('shows the edit card with a PDF editor and opens a picked PDF there', async () => {
    const { host } = makeHost()
    const session = { sessionId: 's1', format: 'pdf' } as unknown as MobileDocSession
    host.client.pickOpenFile.mockResolvedValueOnce(session)
    const onLeave = vi.fn()
    const onPickTool = vi.fn()
    await render(<ToolsList host={host} onPickTool={onPickTool} onLeave={onLeave} />, {
      editorOpens: (ext) => ext === 'pdf',
    })
    expect(body().textContent).toContain(en('pdfToolsGroupEditor'))
    await click(body().querySelector<HTMLButtonElement>('[data-tool="edit"]')!)
    expect(host.client.pickOpenFile).toHaveBeenCalledWith(['pdf'])
    expect(host.openSession).toHaveBeenCalledWith(session)
    expect(onLeave).toHaveBeenCalledTimes(1)

    // a closed picker is silent; another failure is told
    host.client.pickOpenFile.mockRejectedValueOnce(parseMobileCommandError(cancelled))
    await click(body().querySelector<HTMLButtonElement>('[data-tool="edit"]')!)
    expect(host.showToast).not.toHaveBeenCalled()
    host.client.pickOpenFile.mockRejectedValueOnce(new Error('boom'))
    await click(body().querySelector<HTMLButtonElement>('[data-tool="edit"]')!)
    expect(host.showToast).toHaveBeenCalledWith({ message: en('pdfToolsErrFailed'), tone: 'error' })

    await click(body().querySelector<HTMLButtonElement>('[data-tool="compress"]')!)
    expect(onPickTool).toHaveBeenCalledWith('compress')
  })
})

describe('flow starts', () => {
  it('menu: the list first, a tool, back to the list, back out', async () => {
    const { onClose } = await renderFlow({ start: { kind: 'menu' } })
    expect(title()).toBe(en('pdfToolsWindowTitle'))
    expect(body().querySelector('[data-testid="pdf-tools-list"]')).not.toBeNull()
    await click(body().querySelector<HTMLButtonElement>('[data-tool="reverse"]')!)
    expect(title()).toBe(en('pdfToolsToolReverse'))
    expect(body().querySelector('[data-testid="pdf-tools-files"]')).not.toBeNull()
    await systemBack()
    expect(title()).toBe(en('pdfToolsWindowTitle'))
    expect(onClose).not.toHaveBeenCalled()
    await click(appBarBack())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('merge: the given files in order, inspected one at a time', async () => {
    const engine = makeEngine()
    const gate = engine.holdInspections()
    const inputs = [input('one.pdf', 'application/pdf', 100), input('two.pdf'), input('three.pdf')]
    const { onClose } = await renderFlow({ start: { kind: 'merge', inputs }, engine })
    expect(title()).toBe(en('pdfToolsToolMerge'))
    expect(rowNames()).toEqual(['one.pdf', 'two.pdf', 'three.pdf'])
    expect(engine.inspected).toEqual(['one.pdf'])
    expect(button(en('pdfToolsNext')).disabled).toBe(true)
    gate.release()
    await flush()
    expect(engine.inspected).toEqual(['one.pdf', 'two.pdf'])
    gate.release()
    await flush()
    gate.release()
    await flush()
    expect(engine.inspected).toEqual(['one.pdf', 'two.pdf', 'three.pdf'])
    expect(button(en('pdfToolsNext')).disabled).toBe(false)
    expect(rows()[1]!.textContent).toContain(en('pdfToolsPageCount', { n: 4 }))
    // back from the first step leaves the screen
    await click(appBarBack())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('imagesToPdf: the given photos, a picture picker taking several', async () => {
    await renderFlow({
      start: {
        kind: 'imagesToPdf',
        inputs: [input('p1.jpg', 'image/jpeg'), input('p2.heic', 'image/heic')],
      },
    })
    expect(title()).toBe(en('pdfToolsToolImagesToPdf'))
    expect(body().textContent).toContain(en('pdfToolsHintPhotos'))
    expect(rowNames()).toEqual(['p1.jpg', 'p2.heic'])
    const picker = body().querySelector<HTMLInputElement>('[data-testid="pdf-tools-file-input"]')!
    expect(picker.accept).toBe('image/*')
    expect(picker.multiple).toBe(true)
    // pictures show no page count
    expect(rows()[0]!.textContent).not.toContain(en('pdfToolsPageCountOne'))
  })

  it('one tool (the [Tools] tab): its files first, back closes', async () => {
    const { onClose } = await renderFlow({ start: { kind: 'tool', tool: 'compress' } })
    expect(title()).toBe(en('pdfToolsToolCompress'))
    const picker = body().querySelector<HTMLInputElement>('[data-testid="pdf-tools-file-input"]')!
    expect(picker.accept).toBe('application/pdf,.pdf')
    expect(picker.multiple).toBe(false)
    await systemBack()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('lets the engine go when the screen closes', async () => {
    const { engine } = await renderFlow({ start: { kind: 'tool', tool: 'reverse' } })
    await pickFiles([new File(['x'], 'a.pdf', { type: 'application/pdf' })])
    act(() => roots.pop()!.unmount())
    expect(engine.engine.dispose).toHaveBeenCalled()
  })
})

describe('files step', () => {
  it('adds, inspects, keeps problem rows, reorders and removes', async () => {
    const engine = makeEngine({
      'locked.pdf': { ok: false, problem: 'encrypted' },
      'bad.pdf': { ok: false, problem: 'unreadable' },
    })
    await renderFlow({ start: { kind: 'tool', tool: 'merge' }, engine })
    expect(button(en('pdfToolsNext')).disabled).toBe(true)
    await pickFiles([
      new File(['1'], 'a.pdf', { type: 'application/pdf' }),
      new File(['2'], 'locked.pdf', { type: '' }),
    ])
    expect(rowNames()).toEqual(['a.pdf', 'locked.pdf'])
    expect(rows()[1]!.textContent).toContain(en('pdfToolsProblemEncrypted'))
    expect((rows()[1] as HTMLElement).dataset.problem).toBe('encrypted')
    // one usable file is not enough to merge
    expect(button(en('pdfToolsNext')).disabled).toBe(true)

    await pickFiles([
      new File(['3'], 'b.pdf', { type: 'application/pdf' }),
      new File(['4'], 'bad.pdf', { type: 'application/pdf' }),
    ])
    expect(rowNames()).toEqual(['a.pdf', 'locked.pdf', 'b.pdf', 'bad.pdf'])
    expect(rows()[3]!.textContent).toContain(en('pdfToolsProblemUnreadable'))
    expect(button(en('pdfToolsNext')).disabled).toBe(false)

    // an empty type is read from the name; every read is a fresh array
    const lockedFile = engine.engine.inspect.mock.calls[1]![0] as ToolFile
    expect(lockedFile.mime).toBe('application/pdf')
    const aFile = engine.engine.inspect.mock.calls[0]![0] as ToolFile
    const first = await aFile.readBytes()
    const second = await aFile.readBytes()
    expect(first).not.toBe(second)
    expect([...first]).toEqual([...second])

    // each move and remove button is labelled with its action and names its row
    const up = rows()[2]!.querySelector<HTMLButtonElement>(
      `[aria-label="${en('pdfToolsMoveUp')}"]`,
    )!
    expect(up.getAttribute('aria-describedby')).toBeTruthy()
    await click(up)
    expect(rowNames()).toEqual(['a.pdf', 'b.pdf', 'locked.pdf', 'bad.pdf'])
    expect(
      rows()[0]!.querySelector<HTMLButtonElement>(`[aria-label="${en('pdfToolsMoveUp')}"]`)!
        .disabled,
    ).toBe(true)
    await click(
      rows()[0]!.querySelector<HTMLButtonElement>(`[aria-label="${en('pdfToolsMoveDown')}"]`)!,
    )
    expect(rowNames()).toEqual(['b.pdf', 'a.pdf', 'locked.pdf', 'bad.pdf'])
    await click(
      rows()[1]!.querySelector<HTMLButtonElement>(`[aria-label="${en('pdfToolsRemove')}"]`)!,
    )
    expect(rowNames()).toEqual(['b.pdf', 'locked.pdf', 'bad.pdf'])
    expect(button(en('pdfToolsNext')).disabled).toBe(true)
  })

  it('replaces the file of a one-file tool and runs only usable files', async () => {
    const engine = makeEngine({ 'scan.pdf': { ok: false, problem: 'not-encrypted' } })
    await renderFlow({ start: { kind: 'tool', tool: 'decrypt' }, engine })
    expect(body().textContent).toContain(en('pdfToolsHintDecrypt'))
    await pickFiles([new File(['1'], 'scan.pdf', { type: 'application/pdf' })])
    expect(rows()[0]!.textContent).toContain(en('pdfToolsProblemNotEncrypted'))
    expect(rows()[0]!.querySelector('[aria-label]')).toBeNull()
    expect(button(en('pdfToolsNext')).disabled).toBe(true)
    await click(button(en('pdfToolsReplaceFile')))
    await pickFiles([new File(['2'], 'locked.pdf', { type: 'application/pdf' })])
    expect(rowNames()).toEqual(['locked.pdf'])
    expect(button(en('pdfToolsNext')).disabled).toBe(false)
  })
})

describe('options and running', () => {
  it('shows the options error under the form and does not run', async () => {
    const { engine } = await renderFlow({ start: { kind: 'tool', tool: 'extract' } })
    await pickFiles([new File(['1'], 'a.pdf', { type: 'application/pdf' })])
    await click(button(en('pdfToolsNext')))
    expect(optionsSheet()).not.toBeNull()
    expect(body().querySelector('[data-testid="pdf-tools-options-error"]')).toBeNull()
    await click(button(en('pdfToolsStart')))
    expect(body().querySelector('[data-testid="pdf-tools-options-error"]')?.textContent).toBe(
      en('pdfToolsErrRange'),
    )
    expect(engine.runs).toHaveLength(0)
    // closing the sheet goes back to the files
    await click(button(en('pdfToolsClose')))
    expect(optionsSheet()).toBeNull()
    expect(body().querySelector('[data-testid="pdf-tools-files"]')).not.toBeNull()
  })

  it('runs with the checked options, shows the progress and the result', async () => {
    const { engine } = await toRunning({ kind: 'tool', tool: 'rotate' })
    expect(engine.runs).toHaveLength(1)
    const run = engine.runs[0]!
    expect(run.tool).toBe('rotate')
    expect(run.files.map((f) => f.name)).toEqual(['a.pdf'])
    expect(run.options).toEqual({ rotation: 90 })
    const bar = body().querySelector('[role="progressbar"]')!
    expect(bar.getAttribute('data-indeterminate')).toBe('true')
    await act(async () => run.onProgress?.(1, 3))
    expect(bar.getAttribute('aria-valuenow')).toBe('1')
    expect(bar.getAttribute('aria-valuemax')).toBe('3')
    expect(body().textContent).toContain(en('pdfToolsWorkingProgress', { done: 1, total: 3 }))
    await act(async () => run.done.resolve({ ok: true, files: [pdfResult('a-rotated.pdf', 2048)] }))
    await flush()
    expect(resultSheet()).not.toBeNull()
    expect(resultSheet()!.textContent).toContain(en('pdfToolsDoneOne', { name: 'a-rotated.pdf' }))
  })

  it('[Stop] ends the work and goes back to the options with a toast', async () => {
    const { engine, host } = await toRunning({ kind: 'tool', tool: 'reverse' })
    await click(button(en('pdfToolsStop')))
    expect(engine.engine.stop).toHaveBeenCalledTimes(1)
    expect(optionsSheet()).not.toBeNull()
    expect(host.host.showToast).toHaveBeenCalledWith(en('pdfToolsStopped'))
  })

  it('Back while running asks first: [Continue] keeps going, [Stop] stops', async () => {
    const { engine } = await toRunning({ kind: 'tool', tool: 'reverse' })
    await systemBack()
    const dialog = () => body().querySelector('[data-testid="pdf-tools-stop-confirm"]')
    expect(dialog()?.textContent).toContain(en('pdfToolsStopConfirm'))
    const order = [...dialog()!.querySelectorAll('button')].map((b) => b.textContent)
    // cancel on the left, the action on the right (both platforms)
    expect(order).toEqual([en('pdfToolsContinue'), en('pdfToolsStop')])
    expect(document.activeElement?.textContent).toBe(en('pdfToolsContinue'))
    await click(button(en('pdfToolsContinue')))
    expect(dialog()).toBeNull()
    expect(body().querySelector('[data-testid="pdf-tools-running"]')).not.toBeNull()
    expect(engine.engine.stop).not.toHaveBeenCalled()

    // Back on the dialog answers "continue"; the [‹] asks the same question
    await click(appBarBack())
    expect(dialog()).not.toBeNull()
    await systemBack()
    expect(dialog()).toBeNull()
    await click(appBarBack())
    await click(dialog()!.querySelectorAll('button')[1] as HTMLButtonElement)
    expect(engine.engine.stop).toHaveBeenCalledTimes(1)
    expect(optionsSheet()).not.toBeNull()
  })

  it('shows each refusal and failure in the options sheet', async () => {
    const cases: Array<[Exclude<ToolRunOutcome, { ok: true }>['reason'], MobileStringKey]> = [
      ['no-text', 'pdfToolsErrNoText'],
      ['no-annots', 'pdfToolsErrNoAnnots'],
      ['not-smaller', 'pdfToolsErrNotSmaller'],
      ['no-bookmarks', 'pdfToolsErrNoBookmarks'],
      ['wrong-password', 'pdfToolsErrWrongPassword'],
      ['failed', 'pdfToolsErrFailed'],
      ['repair-failed', 'pdfToolsRepairFailed'],
      ['too-large', 'pdfToolsTooLargeForDevice'],
    ]
    const { engine } = await toRunning({ kind: 'tool', tool: 'reverse' })
    for (const [i, [reason, key]] of cases.entries()) {
      await act(async () => engine.runs[i]!.done.resolve({ ok: false, reason }))
      await flush()
      expect(body().querySelector('[data-testid="pdf-tools-notice"]')?.textContent).toBe(en(key))
      await click(button(en('pdfToolsStart')))
    }
    // a password tool that fails made a file that did not check out
    expect(failureKey('encrypt', 'failed')).toBe('pdfToolsMakeFailed')
    expect(failureKey('decrypt', 'failed')).toBe('pdfToolsMakeFailed')
  })
})

describe('result sheet', () => {
  async function toResult(
    outcome: ToolRunOutcome,
    setup: Omit<FlowSetup, 'start'> & { start?: PdfToolsFlowStart } = {},
  ) {
    const made = await toRunning(setup.start ?? { kind: 'tool', tool: 'compress' }, setup)
    await act(async () => made.engine.runs[0]!.done.resolve(outcome))
    await flush()
    return made
  }

  it('hides [Open] without the host function or without an editor for the format', async () => {
    await toResult({ ok: true, files: [pdfResult('a-smaller.pdf')] }, { editorOpens: () => true })
    expect(buttons(en('pdfToolsOpen'))).toHaveLength(0)
  })

  it('hides [Open] when no editor opens the format', async () => {
    await toResult(
      { ok: true, files: [pdfResult('a-smaller.pdf')] },
      { host: makeHost({ withCopy: true }), editorOpens: (ext) => ext === 'txt' },
    )
    expect(buttons(en('pdfToolsOpen'))).toHaveLength(0)
  })

  it('opens a text result as an untitled copy and leaves', async () => {
    const host = makeHost({ withCopy: true })
    const { onClose } = await toResult(
      {
        ok: true,
        files: [{ name: 'a.txt', mime: 'text/plain', bytes: new TextEncoder().encode('hi') }],
      },
      { host, editorOpens: (ext) => ext === 'txt', start: { kind: 'tool', tool: 'toText' } },
    )
    await click(button(en('pdfToolsOpen')))
    expect(host.host.openUntitledCopy).toHaveBeenCalledWith({
      format: 'txt',
      name: 'a.txt',
      bytesBase64: btoa('hi'),
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows before → after for compress, shares and saves with a toast', async () => {
    const { host } = await toResult({
      ok: true,
      files: [pdfResult('a-smaller.pdf', 1024)],
      sizeBefore: 4096,
    })
    expect(body().querySelector('[data-testid="pdf-tools-result-size"]')?.textContent).toBe(
      en('pdfToolsSizeChange', { before: formatBytes(4096, 'en'), after: formatBytes(1024, 'en') }),
    )
    await click(button(en('pdfToolsShare')))
    expect(host.invoke).toHaveBeenCalledWith('mobile_pdf_tools_share', {
      suggestedName: 'a-smaller.pdf',
      mime: 'application/pdf',
      bytesBase64: expect.any(String),
    })
    await click(button(en('pdfToolsSaveCopy')))
    expect(host.invoke).toHaveBeenCalledWith(
      'mobile_pdf_tools_save_copy',
      expect.objectContaining({ suggestedName: 'a-smaller.pdf', mime: 'application/pdf' }),
    )
    expect(host.host.showToast).toHaveBeenCalledWith(en('pdfToolsSaved'))
  })

  it('is silent when the save dialog is closed and tells other failures', async () => {
    let answer: () => Promise<unknown> = async () => Promise.reject(cancelled)
    const host = makeHost({ invoke: () => answer() })
    await toResult({ ok: true, files: [pdfResult('a-smaller.pdf')] }, { host })
    await click(button(en('pdfToolsSaveCopy')))
    expect(host.host.showToast).not.toHaveBeenCalled()
    answer = async () => Promise.reject(new Error('disk'))
    await click(button(en('pdfToolsSaveCopy')))
    expect(host.host.showToast).toHaveBeenCalledWith({
      message: en('pdfToolsSaveFailed'),
      tone: 'error',
    })
    await click(button(en('pdfToolsShare')))
    expect(host.host.showToast).toHaveBeenCalledWith({
      message: en('pdfToolsShareFailed'),
      tone: 'error',
    })
  })

  it('offers one ZIP for split parts and each part on its own', async () => {
    const { engine, host } = await toResult(
      {
        ok: true,
        files: [pdfResult('a-1.pdf'), pdfResult('a-2.pdf'), pdfResult('a-3.pdf')],
        oversizedPages: [2],
      },
      { start: { kind: 'tool', tool: 'split' } },
    )
    expect(body().querySelectorAll('[data-testid="pdf-tools-result-row"]')).toHaveLength(3)
    expect(resultSheet()!.textContent).toContain(en('pdfToolsDoneMany', { n: 3 }))
    expect(resultSheet()!.textContent).toContain(en('pdfToolsSplitOversizedWarn', { pages: '2' }))
    await click(button(en('pdfToolsZipShareAll')))
    expect(engine.engine.zip).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'a-1.pdf' }), expect.anything(), expect.anything()],
      'a-split.zip',
    )
    expect(host.invoke).toHaveBeenCalledWith(
      'mobile_pdf_tools_share',
      expect.objectContaining({ suggestedName: 'a-split.zip', mime: 'application/zip' }),
    )
    // the ZIP is made once
    await click(button(en('pdfToolsZipSaveAll')))
    expect(engine.engine.zip).toHaveBeenCalledTimes(1)
    expect(host.invoke).toHaveBeenCalledWith(
      'mobile_pdf_tools_save_copy',
      expect.objectContaining({ suggestedName: 'a-split.zip' }),
    )
    // one part
    const second = body().querySelectorAll('[data-testid="pdf-tools-result-row"]')[1]!
    await click(second.querySelector<HTMLButtonElement>(`[aria-label="${en('pdfToolsShare')}"]`)!)
    expect(host.invoke).toHaveBeenLastCalledWith(
      'mobile_pdf_tools_share',
      expect.objectContaining({ suggestedName: 'a-2.pdf' }),
    )
  })

  it('asks before closing with results neither saved nor shared', async () => {
    const { onClose } = await toResult({ ok: true, files: [pdfResult('a-smaller.pdf')] })
    const dialog = () => body().querySelector('[data-testid="pdf-tools-discard-confirm"]')
    await click(
      resultSheet()!.querySelector<HTMLButtonElement>(`[aria-label="${en('pdfToolsClose')}"]`)!,
    )
    expect(dialog()?.textContent).toContain(en('pdfToolsDiscardConfirm'))
    expect([...dialog()!.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      en('pdfToolsCancel'),
      en('pdfToolsClose'),
    ])
    await click(button(en('pdfToolsCancel')))
    expect(dialog()).toBeNull()
    expect(resultSheet()).not.toBeNull()
    // Back on the sheet asks the same
    await systemBack()
    expect(dialog()).not.toBeNull()
    await click(dialog()!.querySelectorAll('button')[1] as HTMLButtonElement)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes without asking once every result was saved, back to the list from the menu', async () => {
    const { onClose } = await toResult(
      { ok: true, files: [pdfResult('a-reversed.pdf')] },
      { start: { kind: 'menu' } },
    )
    expect(onClose).not.toHaveBeenCalled()
    await click(button(en('pdfToolsSaveCopy')))
    await click(
      resultSheet()!.querySelector<HTMLButtonElement>(`[aria-label="${en('pdfToolsClose')}"]`)!,
    )
    expect(body().querySelector('[data-testid="pdf-tools-discard-confirm"]')).toBeNull()
    expect(body().querySelector('[data-testid="pdf-tools-list"]')).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('asks before opening one part while others are unsaved', async () => {
    const host = makeHost({ withCopy: true })
    const { onClose } = await toResult(
      { ok: true, files: [pdfResult('a-1.pdf'), pdfResult('a-2.pdf')] },
      { host, editorOpens: () => true, start: { kind: 'tool', tool: 'split' } },
    )
    const first = body().querySelectorAll('[data-testid="pdf-tools-result-row"]')[0]!
    await click(first.querySelector<HTMLButtonElement>(`[aria-label="${en('pdfToolsOpen')}"]`)!)
    const dialog = body().querySelector('[data-testid="pdf-tools-discard-confirm"]')!
    expect(dialog).not.toBeNull()
    expect(host.host.openUntitledCopy).not.toHaveBeenCalled()
    await click(dialog.querySelectorAll('button')[1] as HTMLButtonElement)
    expect(host.host.openUntitledCopy).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'pdf', name: 'a-1.pdf' }),
    )
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('blank pages', () => {
  async function toFind(pageCount: number, candidates: BlankPagesOutcome) {
    const made = await renderFlow({ start: { kind: 'tool', tool: 'blankPages' } })
    await pickFiles([new File(['1'], 'a.pdf', { type: 'application/pdf' })])
    await click(button(en('pdfToolsNext')))
    expect(optionsSheet()!.textContent).toContain(en('pdfToolsNoteBlank'))
    await click(button(en('pdfToolsFindBlank')))
    const find = made.engine.finds[0]!
    expect(find.file.name).toBe('a.pdf')
    await act(async () => find.onProgress?.(2, pageCount))
    expect(body().textContent).toContain(en('pdfToolsFindingBlank', { done: 2, total: pageCount }))
    await act(async () => find.done.resolve(candidates))
    await flush()
    return made
  }

  it('finds, preselects the empty pages and removes only the chosen ones', async () => {
    const { engine } = await toFind(5, {
      ok: true,
      pageCount: 5,
      candidates: [
        { page: 2, reason: 'empty', thumb: null },
        { page: 4, reason: 'nearly-white', thumb: null },
      ],
    })
    expect(body().textContent).toContain(en('pdfToolsBlankFound', { n: 2 }))
    const boxes = [...body().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    expect(boxes.map((b) => b.checked)).toEqual([true, false])
    const remove = () => button(en('pdfToolsRemoveChosenPages'))
    expect(remove().disabled).toBe(false)
    await click(boxes[0]!)
    expect(remove().disabled).toBe(true)
    await click(boxes[0]!)
    await click(boxes[1]!)
    await click(remove())
    expect(engine.runs[0]!.tool).toBe('blankPages')
    expect(engine.runs[0]!.options).toEqual({ removePages: '2,4' })
    await act(async () =>
      engine.runs[0]!.done.resolve({ ok: true, files: [pdfResult('a-no-blank.pdf')] }),
    )
    await flush()
    expect(resultSheet()).not.toBeNull()
  })

  it('cannot remove every page, says when none were found, and goes back to the files', async () => {
    await toFind(2, {
      ok: true,
      pageCount: 2,
      candidates: [
        { page: 1, reason: 'empty', thumb: null },
        { page: 2, reason: 'empty', thumb: null },
      ],
    })
    expect(button(en('pdfToolsRemoveChosenPages')).disabled).toBe(true)
    await systemBack()
    expect(body().querySelector('[data-testid="pdf-tools-files"]')).not.toBeNull()

    act(() => roots.pop()!.unmount())
    await toFind(3, { ok: true, pageCount: 3, candidates: [] })
    expect(body().textContent).toContain(en('pdfToolsBlankNone'))
    expect(button(en('pdfToolsRemoveChosenPages')).disabled).toBe(true)
  })
})

describe('home [Tools] tab', () => {
  it('draws the list in the tab and opens the tools layer on the picked tool', async () => {
    const engine = makeEngine()
    const { host } = makeHost()
    await render(<ToolsTab host={host} />, {
      createEngine: () => engine.engine,
      editorOpens: () => false,
    })
    expect(body().querySelector('[data-testid="pdf-tools-list"]')).not.toBeNull()
    expect(body().querySelector('[data-testid="pdf-tools-flow"]')).toBeNull()
    await click(body().querySelector<HTMLButtonElement>('[data-tool="merge"]')!)
    for (let i = 0; i < 50 && !body().querySelector('[data-testid="pdf-tools-flow"]'); i++)
      await flush(1)
    expect(title()).toBe(en('pdfToolsToolMerge'))
    expect(body().querySelector('[data-testid="pdf-tools-files"]')).not.toBeNull()
    await click(appBarBack())
    expect(body().querySelector('[data-testid="pdf-tools-flow"]')).toBeNull()
    expect(body().querySelector('[data-testid="pdf-tools-list"]')).not.toBeNull()
  })

  it('gives T6 a Flow that starts on the list', async () => {
    const { host } = makeHost()
    const { Flow } = pdfToolsLink
    await render(<Flow host={host} start={{ kind: 'menu' }} onClose={() => {}} />, {
      createEngine: () => makeEngine().engine,
    })
    for (let i = 0; i < 50 && !body().querySelector('[data-testid="pdf-tools-flow"]'); i++)
      await flush(1)
    expect(title()).toBe(en('pdfToolsWindowTitle'))
  })
})
