/**
 * Fixes from the 390px preview of the PDF tools screens: an encrypted input
 * shows no "0 pages", preloaded inputs are inspected under React StrictMode
 * (the dev double mount disposes the first engine mid-inspection), failures in
 * the options sheet read as errors while pure notes stay neutral, and the
 * options sheet's primary action sits in its own (sticky) action row.
 */
import { act, StrictMode, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileClient } from '@genoffice/mobile-bridge/transport'
import type { HomeHost } from '../src/renderer/home/homeHost'
import { translateMobile, type MobileStringKey } from '../src/renderer/i18n'
import { BackStackProvider } from '../src/renderer/shell/backStack'
import { PdfToolsEngineError } from '../src/renderer/tools/engine/client'
import type {
  InspectResult,
  PdfToolsEngine,
  ToolFile,
  ToolRunOutcome,
} from '../src/renderer/tools/engine/types'
import { PdfToolsEnvProvider } from '../src/renderer/tools/env'
import PdfToolsFlowScreen from '../src/renderer/tools/flow/Flow'
import { formatBytes } from '../src/renderer/tools/flow/format'
import type { PdfToolsFlowStart } from '../src/renderer/tools/link'

// React's act() checks this flag
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const en = (key: MobileStringKey, params?: Record<string, string | number>) =>
  translateMobile('en', key, params)

// ---- fakes

/**
 * An engine shaped like the real client: inspections answer on a later tick,
 * and dispose() rejects the ones still running with a 'stopped' engine error.
 */
function makeRealisticEngine(answers: Record<string, InspectResult> = {}) {
  const pending = new Set<(err: unknown) => void>()
  let disposed = false
  let runOutcome: ToolRunOutcome = { ok: false, reason: 'failed' }
  const engine = {
    inspect: vi.fn(
      (file: ToolFile) =>
        new Promise<InspectResult & { sizeBytes: number }>((resolve, reject) => {
          if (disposed) {
            reject(new PdfToolsEngineError('stopped'))
            return
          }
          pending.add(reject)
          setTimeout(() => {
            if (!pending.delete(reject)) return
            resolve({ ...(answers[file.name] ?? { ok: true, pages: 3 }), sizeBytes: 2048 })
          }, 5)
        }),
    ),
    run: vi.fn(async () => runOutcome),
    findBlankPages: vi.fn(),
    zip: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(() => {
      disposed = true
      for (const reject of [...pending]) reject(new PdfToolsEngineError('stopped'))
      pending.clear()
    }),
  }
  return {
    engine: engine as unknown as PdfToolsEngine & typeof engine,
    setRunOutcome(outcome: ToolRunOutcome) {
      runOutcome = outcome
    },
  }
}

function makeHost() {
  const client = {
    transport: { invoke: vi.fn(async () => ({ ok: true })), listen: vi.fn() },
    pickOpenFile: vi.fn(),
  } as unknown as MobileClient
  return {
    client,
    openSession: vi.fn(async () => {}),
    createNew: vi.fn(async () => {}),
    showToast: vi.fn(),
    refreshHome: vi.fn(async () => {}),
    openSettings: vi.fn(),
  } as unknown as HomeHost
}

function input(name: string, mime = 'application/pdf') {
  return { name, mime, readBytes: vi.fn(async () => new Uint8Array([1, 2, 3])) }
}

// ---- rendering

const roots: Root[] = []
const containers: HTMLElement[] = []

beforeEach(() => {
  vi.spyOn(window.history, 'back').mockImplementation(() => {
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
})

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  while (containers.length > 0) containers.pop()?.remove()
  vi.restoreAllMocks()
})

async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
  }
}

async function render(node: ReactNode) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  containers.push(el)
  const root = createRoot(el)
  roots.push(root)
  await act(async () => {
    root.render(node)
  })
  await flush()
  return el
}

interface Setup {
  start: PdfToolsFlowStart
  strict?: boolean
  answers?: Record<string, InspectResult>
}

async function renderFlow({ start, strict = false, answers }: Setup) {
  const made: ReturnType<typeof makeRealisticEngine>[] = []
  const createEngine = () => {
    const next = makeRealisticEngine(answers)
    made.push(next)
    return next.engine
  }
  const screen = (
    <BackStackProvider>
      <PdfToolsEnvProvider value={{ createEngine, editorOpens: () => false }}>
        <PdfToolsFlowScreen host={makeHost()} start={start} onClose={vi.fn()} />
      </PdfToolsEnvProvider>
    </BackStackProvider>
  )
  await render(strict ? <StrictMode>{screen}</StrictMode> : screen)
  return { made }
}

const metas = () =>
  [...document.body.querySelectorAll('.pdf-tools-file-meta')].map((el) => el.textContent ?? '')
const problems = () =>
  [...document.body.querySelectorAll('.pdf-tools-file-problem')].map((el) => el.textContent ?? '')

function button(text: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text || b.getAttribute('aria-label') === text,
  )
  if (!found) throw new Error(`no button "${text}"`)
  return found
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click()
  })
  await flush()
}

async function pickFiles(files: File[]) {
  const picker = document.body.querySelector<HTMLInputElement>(
    '[data-testid="pdf-tools-file-input"]',
  )!
  Object.defineProperty(picker, 'files', { value: files, configurable: true })
  await act(async () => {
    picker.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await flush()
}

// ---- tests

describe('files step', () => {
  it('leaves the page count out when the engine reports 0 pages (encrypted input)', async () => {
    await renderFlow({
      start: { kind: 'tool', tool: 'decrypt' },
      answers: { 'locked.pdf': { ok: true, pages: 0 } },
    })
    await pickFiles([new File(['1'], 'locked.pdf', { type: 'application/pdf' })])
    // only the size: no "· 0 pages"
    expect(metas()).toEqual([formatBytes(1, 'en')])
  })

  it('still shows the page count when there are pages', async () => {
    await renderFlow({ start: { kind: 'tool', tool: 'rotate' } })
    await pickFiles([new File(['1'], 'a.pdf', { type: 'application/pdf' })])
    expect(metas()[0]).toContain(en('pdfToolsPageCount', { n: 3 }))
  })
})

describe('preloaded inputs under StrictMode', () => {
  it.each(['merge', 'imagesToPdf'] as const)(
    'inspects every %s input after the dev double mount instead of marking one unreadable',
    async (kind) => {
      const mime = kind === 'merge' ? 'application/pdf' : 'image/jpeg'
      const ext = kind === 'merge' ? 'pdf' : 'jpg'
      const { made } = await renderFlow({
        strict: true,
        start: { kind, inputs: [input(`one.${ext}`, mime), input(`two.${ext}`, mime)] },
      })
      // the first engine was disposed by the simulated unmount; a second one took over
      expect(made.length).toBeGreaterThanOrEqual(2)
      expect(made[0]!.engine.dispose).toHaveBeenCalled()
      expect(problems()).toEqual([])
      expect(
        document.body.querySelector('[data-testid="pdf-tools-file-row"][data-problem]'),
      ).toBeNull()
      expect(document.body.textContent).not.toContain(en('pdfToolsProblemUnreadable'))
      if (kind === 'merge') {
        expect(metas().every((m) => m.includes(en('pdfToolsPageCount', { n: 3 })))).toBe(true)
      }
      expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(0)
      expect(button(en('pdfToolsNext')).disabled).toBe(false)
    },
  )
})

describe('options sheet', () => {
  it('shows a refusal as an error with an icon, and keeps the action row in its own sticky row', async () => {
    const { made } = await renderFlow({ start: { kind: 'tool', tool: 'decrypt' } })
    await pickFiles([new File(['1'], 'locked.pdf', { type: 'application/pdf' })])
    await click(button(en('pdfToolsNext')))
    const sheet = document.body.querySelector('[data-testid="pdf-tools-options-sheet"]')!
    expect(sheet).not.toBeNull()
    const actions = sheet.querySelector('.pdf-tools-sheet-actions')
    expect(actions?.textContent).toContain(en('pdfToolsStart'))

    made.at(-1)!.setRunOutcome({ ok: false, reason: 'wrong-password' })
    const field = sheet.querySelector<HTMLInputElement>('input[type="password"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(field, 'nope')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(button(en('pdfToolsStart')))
    const notice = document.body.querySelector('[data-testid="pdf-tools-notice"]')!
    expect(notice.textContent).toBe(en('pdfToolsErrWrongPassword'))
    expect(notice.classList.contains('pdf-tools-problem')).toBe(true)
    expect(notice.classList.contains('pdf-tools-notice')).toBe(false)
    expect(notice.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
  })

  it('keeps the blank-page note neutral', async () => {
    await renderFlow({ start: { kind: 'tool', tool: 'blankPages' } })
    await pickFiles([new File(['1'], 'a.pdf', { type: 'application/pdf' })])
    await click(button(en('pdfToolsNext')))
    const sheet = document.body.querySelector('[data-testid="pdf-tools-options-sheet"]')!
    const note = [...sheet.querySelectorAll('p')].find(
      (p) => p.textContent === en('pdfToolsNoteBlank'),
    )
    expect(note).toBeDefined()
    expect(note!.classList.contains('pdf-tools-problem')).toBe(false)
    expect(note!.querySelector('svg')).toBeNull()
  })
})
