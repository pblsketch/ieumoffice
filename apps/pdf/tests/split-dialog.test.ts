// @vitest-environment jsdom
/**
 * Visual Split PDF dialog tests: scissor dividers toggle ranges live, all four
 * modes (ranges, fixed, bookmarks, maxSize) submit the expected SplitPlanRequest
 * and output options, and all 22 locales fill every key cleanly.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { SplitDialog, type SplitDialogProps } from '../src/renderer/SplitDialog'
import { splitStrings } from '../src/renderer/i18n/strings-split'

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

async function mount(over: Partial<SplitDialogProps> = {}) {
  const onSplit = vi.fn()
  const onCancelSplit = vi.fn()
  const onClose = vi.fn()
  const props: SplitDialogProps = {
    lang: 'en',
    doc: null,
    visList: [0, 1, 2, 3, 4, 5],
    rotations: new Map(),
    pageCount: 6,
    baseName: 'Report',
    bookmarks: [],
    bookmarksLoading: false,
    busy: false,
    progress: null,
    onSplit,
    onCancelSplit,
    onClose,
    ...over,
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(SplitDialog, props))
  })
  return { el: container, onSplit, onCancelSplit, onClose }
}

async function click(el: Element | null) {
  expect(el).not.toBeNull()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
}

async function setInputValue(input: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto =
    input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('SplitDialog UI', () => {
  it('toggles visual scissor dividers and submits custom ranges with output options', async () => {
    const { el, onSplit } = await mount({ initialCutAfter: [2] })
    const cuts = el.querySelectorAll('.pdf-split-cut-btn')
    expect(cuts).toHaveLength(5)
    expect(cuts[1]?.classList.contains('active')).toBe(true)

    // Add a second scissor cut after page 4 -> ranges become 1-2, 3-4, 5-6
    await click(cuts[3]!)
    expect(cuts[3]?.classList.contains('active')).toBe(true)
    expect(el.querySelector('.pdf-split-preview-count')?.textContent).toContain('3')

    // Expand preview file list
    await click(el.querySelector('.pdf-split-link-btn'))
    const items = [...el.querySelectorAll('.pdf-split-file-name')].map((n) => n.textContent)
    expect(items).toEqual(['Report-1.pdf', 'Report-2.pdf', 'Report-3.pdf'])

    // Submit
    await click(el.querySelector('.pdf-split-foot .pdf-modal-btn.primary'))
    expect(onSplit).toHaveBeenCalledWith(
      {
        mode: 'ranges',
        ranges: [
          { start: 1, end: 2 },
          { start: 3, end: 4 },
          { start: 5, end: 6 },
        ],
        mergeRanges: false,
      },
      { prefix: 'Report', pattern: 'numbered', createSubfolder: true },
    )
  })

  it('supports mergeRanges checkbox and disables submit on invalid range text', async () => {
    const { el, onSplit } = await mount()
    const rangeInput = el.querySelector('.pdf-split-section input[type="text"]') as HTMLInputElement
    await setInputValue(rangeInput, '1-99')
    const submitBtn = el.querySelector(
      '.pdf-split-foot .pdf-modal-btn.primary',
    ) as HTMLButtonElement
    expect(submitBtn.disabled).toBe(true)

    await setInputValue(rangeInput, '1-2, 5-6')
    expect(submitBtn.disabled).toBe(false)

    const mergeBox = el.querySelector(
      '.pdf-split-section input[type="checkbox"]',
    ) as HTMLInputElement
    await click(mergeBox)
    expect(el.querySelector('.pdf-split-preview-count')?.textContent).toContain('1')

    await click(submitBtn)
    expect(onSplit).toHaveBeenCalledWith(
      {
        mode: 'ranges',
        ranges: [
          { start: 1, end: 2 },
          { start: 5, end: 6 },
        ],
        mergeRanges: true,
      },
      { prefix: 'Report', pattern: 'numbered', createSubfolder: true },
    )
  })

  it('switches to fixed fileCount mode and updates scissor preview automatically', async () => {
    const { el, onSplit } = await mount()
    const tabs = el.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    await click(tabs[1]!) // By pages

    const radios = el.querySelectorAll<HTMLInputElement>('input[name="pdf-split-fixed-kind"]')
    await click(radios[1]!) // Split into equal files

    const presets = el.querySelectorAll<HTMLButtonElement>('.pdf-split-chip')
    // Pick "File 3" (3 equal files of 2 pages each -> cuts after page 2 and 4)
    const preset3 = [...presets].find((b) => b.textContent?.includes('3'))
    await click(preset3!)

    const activeCuts = [...el.querySelectorAll('.pdf-split-cut-btn')].map((b) =>
      b.classList.contains('active'),
    )
    expect(activeCuts).toEqual([false, true, false, true, false])

    await click(el.querySelector('.pdf-split-foot .pdf-modal-btn.primary'))
    expect(onSplit).toHaveBeenCalledWith(
      { mode: 'fixed', kind: 'fileCount', value: 3 },
      { prefix: 'Report', pattern: 'numbered', createSubfolder: true },
    )
  })

  it('switches to bookmarks mode, defaults naming to bookmark title, and handles empty bookmarks', async () => {
    const { el: emptyEl } = await mount({ bookmarks: [] })
    const emptyTabs = emptyEl.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    await click(emptyTabs[2]!)
    const disabledSubmit = emptyEl.querySelector(
      '.pdf-split-foot .pdf-modal-btn.primary',
    ) as HTMLButtonElement
    expect(disabledSubmit.disabled).toBe(true)

    await act(async () => root?.unmount())
    emptyEl.remove()
    root = null

    const bookmarks = [
      { title: 'Intro', level: 1, page: 2 },
      { title: 'Details', level: 2, page: 4 },
      { title: 'Summary', level: 1, page: 5 },
    ]
    const { el, onSplit } = await mount({ bookmarks })
    const tabs = el.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    await click(tabs[2]!)

    // Bookmark mode auto-switches default naming pattern to 'bookmark'
    await click(el.querySelector('.pdf-split-foot .pdf-modal-btn.primary'))
    expect(onSplit).toHaveBeenCalledWith(
      {
        mode: 'bookmarks',
        level: 1,
        includeLeadingPages: true,
        bookmarks,
      },
      { prefix: 'Report', pattern: 'bookmark', createSubfolder: true },
    )
  })

  it('supports maxSize mode with presets and shows progress + cancel while busy', async () => {
    const { el, onSplit } = await mount()
    const tabs = el.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    await click(tabs[3]!) // By file size

    const preset5 = [...el.querySelectorAll('.pdf-split-chip')].find((b) =>
      b.textContent?.includes('5 MB'),
    )
    await click(preset5!)

    await click(el.querySelector('.pdf-split-foot .pdf-modal-btn.primary'))
    expect(onSplit).toHaveBeenCalledWith(
      { mode: 'maxSize', maxBytes: 5 * 1024 * 1024 },
      { prefix: 'Report', pattern: 'numbered', createSubfolder: true },
    )

    await act(async () => root?.unmount())
    el.remove()
    root = null

    const { el: busyEl, onCancelSplit } = await mount({
      busy: true,
      progress: { done: 3, total: 6 },
    })
    expect(busyEl.querySelector('.pdf-split-progress')?.textContent).toContain('3/6')
    await click(busyEl.querySelector('.pdf-split-foot .pdf-modal-btn'))
    expect(onCancelSplit).toHaveBeenCalledTimes(1)
  })

  it('supports cut-all, clear-splits, add/remove range rows, and custom output options', async () => {
    const { el, onSplit } = await mount()
    const miniBtns = el.querySelectorAll<HTMLButtonElement>('.pdf-split-visual-actions button')
    // Cut every page -> 6 files
    await click(miniBtns[0]!)
    expect(el.querySelectorAll('.pdf-split-cut-btn.active')).toHaveLength(5)
    expect(el.querySelector('.pdf-split-preview-count')?.textContent).toContain('6')

    // Clear all cuts -> 1 file (1-6)
    await click(miniBtns[1]!)
    expect(el.querySelectorAll('.pdf-split-cut-btn.active')).toHaveLength(0)

    // Add a range row and customize prefix + range naming + disable subfolder
    await click(el.querySelector('.pdf-split-row-actions button'))
    expect(el.querySelectorAll('.pdf-split-range-row')).toHaveLength(2)

    const prefixInput = el.querySelector('.pdf-split-output input[type="text"]') as HTMLInputElement
    await setInputValue(prefixInput, 'Handout')
    const patternSelect = el.querySelector('.pdf-split-output select') as HTMLSelectElement
    await setInputValue(patternSelect, 'range')
    const subfolderBox = el.querySelector(
      '.pdf-split-output input[type="checkbox"]',
    ) as HTMLInputElement
    await click(subfolderBox)

    await click(el.querySelector('.pdf-split-foot .pdf-modal-btn.primary'))
    expect(onSplit).toHaveBeenCalledWith(
      {
        mode: 'ranges',
        ranges: [
          { start: 1, end: 6 },
          { start: 6, end: 6 },
        ],
        mergeRanges: false,
      },
      { prefix: 'Handout', pattern: 'range', createSubfolder: false },
    )
  })

  it('switches cleanly from fixed mode to ranges when clicking a visual scissor divider', async () => {
    const { el } = await mount()
    const tabs = el.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    await click(tabs[1]!) // By pages (default 1 per file -> 5 active cuts)
    expect(el.querySelectorAll('.pdf-split-cut-btn.active')).toHaveLength(5)

    // Remove the cut after page 1 -> should switch to Ranges tab with 4 remaining cuts
    const cuts = el.querySelectorAll('.pdf-split-cut-btn')
    await click(cuts[0]!)
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(el.querySelectorAll('.pdf-split-cut-btn.active')).toHaveLength(4)
  })
})

describe('splitStrings i18n', () => {
  it('fills every key in all 22 languages with non-empty copy', () => {
    const keys = Object.keys(splitStrings.zh).sort()
    for (const lang of LANGS) {
      const dict = (splitStrings as Record<string, Record<string, string>>)[lang]!
      expect(Object.keys(dict).sort(), lang).toEqual(keys)
      for (const key of keys) {
        expect(dict[key]!.trim(), `${lang}.${key}`).not.toBe('')
      }
    }
  })
})
