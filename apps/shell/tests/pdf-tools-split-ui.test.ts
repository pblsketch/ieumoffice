// @vitest-environment jsdom
/**
 * PDF Tools window Split UI tests: picking a PDF loads bookmarks, all 4 modes
 * update the live preview and button readiness, running sends the structured
 * split options, oversized-page warnings surface in the completion banner, and
 * "Cut visually in editor" hands off the opaque input id.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PdfToolsWindow } from '../src/renderer/src/pdf-tools/PdfToolsWindow'
import type { PdfToolsWindowApi } from '../src/shared/pdf-tools-api'

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function makeMockApi(over: Partial<PdfToolsWindowApi> = {}): PdfToolsWindowApi {
  return {
    getInit: vi.fn().mockResolvedValue({ lang: 'en', theme: 'light' }),
    onThemeChanged: vi.fn().mockReturnValue(() => {}),
    pickInputs: vi.fn().mockResolvedValue({
      inputs: [{ id: 'doc-1', kind: 'pdf', name: 'Report.pdf', pages: 6, size: 120_000 }],
      rejected: [],
    }),
    dropInputs: vi.fn().mockResolvedValue({ inputs: [], rejected: [] }),
    releaseInputs: vi.fn().mockResolvedValue(undefined),
    unlockInput: vi.fn().mockResolvedValue({ ok: true, pages: 6 }),
    promoteResult: vi.fn().mockResolvedValue({ ok: false, error: 'failed' }),
    promoteInput: vi.fn().mockResolvedValue({ ok: false, error: 'failed' }),
    auditSpace: vi.fn().mockResolvedValue({ ok: false, error: 'failed' }),
    ocrAvailable: vi.fn().mockResolvedValue({ available: false, platform: 'test' }),
    renderThumbs: vi.fn().mockResolvedValue({ ok: false, error: 'failed' }),
    cancelThumbs: vi.fn().mockResolvedValue(undefined),
    onMixStatus: vi.fn().mockReturnValue(() => {}),
    confirmSavePartial: vi.fn().mockResolvedValue({ ok: false, error: 'failed' }),
    openInEditorWithInput: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockResolvedValue({
      ok: true,
      outputs: [
        { id: 'out-1', name: 'Report-1.pdf', size: 60_000 },
        { id: 'out-2', name: 'Report-2.pdf', size: 60_000 },
      ],
    }),
    openResult: vi.fn().mockResolvedValue(undefined),
    revealResult: vi.fn().mockResolvedValue(undefined),
    openInEditor: vi.fn().mockResolvedValue(undefined),
    openSplitInEditor: vi.fn().mockResolvedValue(undefined),
    readBookmarks: vi.fn().mockResolvedValue({
      ok: true,
      bookmarks: [
        { title: 'Chapter 1', level: 1, page: 1 },
        { title: 'Chapter 2', level: 1, page: 4 },
      ],
    }),
    findBlankPages: vi.fn().mockResolvedValue({ ok: true, pageCount: 6, candidates: [] }),
    cancelFind: vi.fn().mockResolvedValue(undefined),
    cancelRun: vi.fn().mockResolvedValue(undefined),
    onProgress: vi.fn().mockReturnValue(() => {}),
    takeStart: vi.fn().mockResolvedValue(null),
    onStartReady: vi.fn().mockReturnValue(() => {}),
    close: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}

async function mountTools(api: PdfToolsWindowApi) {
  ;(window as unknown as { aiOfficePdfTools: PdfToolsWindowApi }).aiOfficePdfTools = api
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(PdfToolsWindow, { lang: 'en' }))
  })
  return container
}

async function click(el: Element | null) {
  expect(el).not.toBeNull()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
}

async function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  await act(async () => {
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('PdfToolsWindow Split UI', () => {
  it('loads bookmarks, previews split files, runs with structured options, and hands off to editor', async () => {
    const api = makeMockApi({
      run: vi.fn().mockResolvedValue({
        ok: true,
        outputs: [
          { id: 'out-1', name: 'Report_p1-3.pdf', size: 50_000 },
          { id: 'out-2', name: 'Report_p4-6.pdf', size: 50_000 },
        ],
        oversizedPages: [5],
      }),
    })
    const el = await mountTools(api)

    // Open Split PDF card
    const splitCard = [...el.querySelectorAll<HTMLButtonElement>('.pt-card')].find((b) =>
      b.textContent?.includes('Split PDF'),
    )
    await click(splitCard!)

    // Pick a 6-page PDF
    const pickBtn = [...el.querySelectorAll<HTMLButtonElement>('.pt-btn')].find((b) =>
      b.textContent?.includes('Choose PDF'),
    )
    await click(pickBtn!)
    expect(api.readBookmarks).toHaveBeenCalledWith('doc-1')

    // Default ranges for 6 pages: "1-3, 4-6" -> 2 files preview
    expect(el.querySelector('.pt-split-preview-count')?.textContent).toContain('2')

    // Invalid range disables Run button
    const rangeInput = el.querySelector('.pt-fields input[type="text"]') as HTMLInputElement
    const runBtn = el.querySelector('.pt-btn-primary') as HTMLButtonElement
    await setValue(rangeInput, '1-99')
    expect(runBtn.disabled).toBe(true)

    // Restore valid range & switch to Bookmarks tab
    await setValue(rangeInput, '1-2, 3-6')
    expect(runBtn.disabled).toBe(false)

    const tabs = el.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    await click(tabs[2]!) // Bookmarks
    await click(el.querySelector('.pt-split-link'))
    const fileNames = [...el.querySelectorAll('.pt-split-file-name')].map((n) => n.textContent)
    expect(fileNames).toEqual(['1_Chapter 1.pdf', '2_Chapter 2.pdf'])

    // Click Run and confirm oversized warning surfaces
    await click(runBtn)
    expect(api.run).toHaveBeenCalledWith({
      tool: 'split',
      inputIds: ['doc-1'],
      options: expect.objectContaining({
        splitMode: 'bookmarks',
        splitBookmarkLevel: 1,
        splitPattern: 'bookmark',
        splitCreateSubfolder: true,
      }),
    })
    expect(el.querySelector('.pt-note-done')?.textContent).toContain('5')

    // Click "Cut visually in editor"
    const visualBtn = [...el.querySelectorAll<HTMLButtonElement>('.pt-btn')].find((b) =>
      b.textContent?.includes('Cut visually'),
    )
    await click(visualBtn!)
    expect(api.openSplitInEditor).toHaveBeenCalledWith('doc-1')
  })

  it('disables Run on bookmarks tab when the PDF has no bookmarks', async () => {
    const api = makeMockApi({
      readBookmarks: vi.fn().mockResolvedValue({ ok: true, bookmarks: [] }),
    })
    const el = await mountTools(api)

    const splitCard = [...el.querySelectorAll<HTMLButtonElement>('.pt-card')].find((b) =>
      b.textContent?.includes('Split PDF'),
    )
    await click(splitCard!)
    const pickBtn = [...el.querySelectorAll<HTMLButtonElement>('.pt-btn')].find((b) =>
      b.textContent?.includes('Choose PDF'),
    )
    await click(pickBtn!)

    const tabs = el.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    await click(tabs[2]!) // Bookmarks
    const runBtn = el.querySelector('.pt-btn-primary') as HTMLButtonElement
    expect(runBtn.disabled).toBe(true)
  })
})
