/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOptions, type PageSize } from '@genoffice/print-layout/plan'
import {
  SAVE_IMAGES_DEST,
  SAVE_PDF_DEST,
  SimplePrintDialog,
  SYSTEM_DIALOG,
  type SimplePrintDialogProps,
} from '../src/print-layout'

const A4: PageSize = { widthPt: 595.28, heightPt: 841.89 }
const pages = (n: number): PageSize[] => Array.from({ length: n }, () => ({ ...A4 }))

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const $ = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)
const $$ = <T extends Element = HTMLElement>(sel: string) => [...host.querySelectorAll<T>(sel)]
const click = (el: Element | null) => act(() => (el as HTMLElement).click())

function type(el: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function selectValue(el: HTMLSelectElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const DEFAULT_JOB = { deviceName: '', copies: 1, collate: true, duplex: 'simplex' }

function mount(overrides: Partial<SimplePrintDialogProps> = {}) {
  const props: SimplePrintDialogProps = {
    lang: 'en',
    rangeChoice: 'all-custom',
    pages: pages(4),
    capabilities: { showPaperAndFit: true },
    onPlainPrint: vi.fn(),
    onPrint: vi.fn(),
    onSavePdf: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  }
  act(() => root.render(createElement(SimplePrintDialog, props)))
  return props
}

describe('SimplePrintDialog', () => {
  it('prints down the current path when system dialog is chosen and nothing changed', () => {
    const props = mount()
    expect($('[role="dialog"]')).not.toBeNull()
    expect($('button[data-pl="save-pdf"]')).toBeNull()
    selectValue($<HTMLSelectElement>('select[data-print="printer"]')!, SYSTEM_DIALOG)
    click($('button[data-pl="print"]'))
    expect(props.onPlainPrint).toHaveBeenCalledWith({ kind: 'all' })
    expect(props.onPrint).not.toHaveBeenCalled()
  })

  it('sends the in-app printer and duplex choice through onPrint even at default layout', () => {
    const props = mount()
    selectValue($<HTMLSelectElement>('select[data-print="duplex"]')!, 'longEdge')
    click($('button[data-pl="print"]'))
    expect(props.onPlainPrint).not.toHaveBeenCalled()
    expect(props.onPrint).toHaveBeenCalledWith({ kind: 'all' }, createDefaultOptions(), {
      ...DEFAULT_JOB,
      duplex: 'longEdge',
    })
  })

  it('integrates Save as PDF and Save as images into the destination dropdown and updates primary button text', () => {
    const onSaveImages = vi.fn()
    const props = mount({ onSaveImages })
    const dest = $<HTMLSelectElement>('select[data-print="printer"]')!
    const primary = $<HTMLButtonElement>('button[data-pl="print"]')!
    expect(primary.textContent).toBe('Print')
    click($('input[data-pl="reverse"]'))
    const expected = createDefaultOptions()
    expected.reverse = true
    click(primary)
    expect(props.onPlainPrint).not.toHaveBeenCalled()
    expect(props.onPrint).toHaveBeenCalledWith({ kind: 'all' }, expected, DEFAULT_JOB)

    // Switch destination to Save as PDF
    selectValue(dest, SAVE_PDF_DEST)
    expect(primary.textContent).toBe('Save')
    expect($('input[data-print="copies"]')).toBeNull()
    click(primary)
    expect(props.onSavePdf).toHaveBeenCalledWith({ kind: 'all' }, expected)

    // Switch destination to Save as images (JPG 80% + ZIP)
    selectValue(dest, SAVE_IMAGES_DEST)
    expect(primary.textContent).toBe('Save')
    selectValue($<HTMLSelectElement>('select[data-print="image-format"]')!, 'jpg')
    selectValue($<HTMLSelectElement>('select[data-print="image-quality"]')!, '80')
    selectValue($<HTMLSelectElement>('select[data-print="image-bundle"]')!, 'zip')
    click(primary)
    expect(onSaveImages).toHaveBeenCalledWith({ kind: 'all' }, expected, {
      format: 'jpg',
      quality: 80,
      bundle: 'zip',
    })
  })

  it('reads a custom range and refuses a malformed one', () => {
    const onRangeChange = vi.fn()
    const props = mount({ onRangeChange })
    selectValue($<HTMLSelectElement>('select[data-print="printer"]')!, SYSTEM_DIALOG)
    click($$<HTMLInputElement>('input[data-pl="range"]').find((r) => r.value === 'custom')!)
    const text = $<HTMLInputElement>('input[data-pl="range-text"]')!
    type(text, '3-1')
    click($('button[data-pl="print"]'))
    expect(props.onPlainPrint).not.toHaveBeenCalled()
    expect($('[data-pl="range-invalid"]')?.textContent).toBe('Write the page range like "1-3, 5".')
    type(text, '1-2, 4')
    click($('button[data-pl="print"]'))
    expect(props.onPlainPrint).toHaveBeenCalledWith({
      kind: 'custom',
      text: '1-2, 4',
      ranges: [
        { from: 1, to: 2 },
        { from: 4, to: 4 },
      ],
    })
    expect(onRangeChange).toHaveBeenLastCalledWith({
      kind: 'custom',
      text: '1-2, 4',
      ranges: [
        { from: 1, to: 2 },
        { from: 4, to: 4 },
      ],
    })
  })

  it('offers all pages and the current page for page-based editors', () => {
    const props = mount({ rangeChoice: 'all-current' })
    selectValue($<HTMLSelectElement>('select[data-print="printer"]')!, SYSTEM_DIALOG)
    expect($$<HTMLInputElement>('input[data-pl="range"]').map((r) => r.value)).toEqual([
      'all',
      'current',
    ])
    click($$<HTMLInputElement>('input[data-pl="range"]')[1]!)
    click($('button[data-pl="print"]'))
    expect(props.onPlainPrint).toHaveBeenCalledWith({ kind: 'current' })
  })

  it('has no range choice for one-page editors', () => {
    mount({ rangeChoice: 'none' })
    expect($('input[data-pl="range"]')).toBeNull()
  })

  it('blocks printing while the options cannot print or a job runs', () => {
    const props = mount({ pages: pages(1) })
    click($$<HTMLInputElement>('input[data-pl="sides"]').find((r) => r.value === 'even')!)
    expect($<HTMLButtonElement>('button[data-pl="print"]')!.disabled).toBe(true)
    expect($('[data-pl="issue"]')?.textContent).toBe('The chosen sides have nothing to print.')
    const onCancelJob = vi.fn()
    mount({ ...props, job: { progress: { done: 1, total: 3 }, onCancel: onCancelJob } })
    expect($<HTMLButtonElement>('button[data-pl="print"]')!.disabled).toBe(true)
    expect(host.textContent).toContain('1 of 3 pages')
    click($('button[data-pl="job-cancel"]'))
    expect(onCancelJob).toHaveBeenCalled()
  })

  it('renders live split-pane preview on demand and releases session on unmount', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:live-0', revokeObjectURL: vi.fn() }),
    )
    const onPreviewFaces = vi.fn(async (_range, _opts, indices: number[]) => ({
      totalFaces: 4,
      faceSizes: pages(4),
      faces: indices.map((index) => ({
        index,
        png: new Uint8Array([1, 2, 3]),
        widthPt: A4.widthPt,
        heightPt: A4.heightPt,
      })),
    }))
    const onClosePreview = vi.fn()
    mount({ rangeChoice: 'all-current', onPreviewFaces, onClosePreview })
    expect($('[data-pl="live-preview"]')).not.toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(onPreviewFaces).toHaveBeenCalled()
    expect($('img[data-pl="live-img"]')).not.toBeNull()
    act(() => root.unmount())
    expect(onClosePreview).toHaveBeenCalledTimes(1)
    root = createRoot(host)
    vi.useRealTimers()
  })

  it('closes with Cancel and with Escape', () => {
    const props = mount()
    click($('button[data-pl="cancel"]'))
    expect(props.onCancel).toHaveBeenCalledTimes(1)
    act(() => {
      $('.gs-pl-mask')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(props.onCancel).toHaveBeenCalledTimes(2)
  })
})
