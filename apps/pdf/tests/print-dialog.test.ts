/**
 * The PDF print dialog with the shared page layout panel: the "picked pages"
 * range is there only for two or more picked thumbnails, the layout options
 * start from the defaults every time the dialog opens, and Print hands the
 * chosen pages and options to the editor.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { createDefaultOptions } from '@genoffice/print-layout/plan'
import { SAVE_IMAGES_DEST, SAVE_PDF_DEST } from '@genoffice/ui'
import { PrintDialog, type PrintDialogProps } from '../src/renderer/PrintDialog'
import { strings } from '../src/renderer/i18n/strings'

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

const t = ((key: string) =>
  strings.en[key as keyof typeof strings.en] ?? key) as PrintDialogProps['t']

async function mount(over: Partial<PrintDialogProps> = {}) {
  const props: PrintDialogProps = {
    lang: 'en',
    t,
    pageCount: 6,
    currentPage: 2,
    pickedPages: [],
    includeAnnotations: true,
    onIncludeAnnotationsChange: vi.fn(),
    pageSizes: (pages) =>
      (pages ?? [1, 2, 3, 4, 5, 6]).map(() => ({ widthPt: 595, heightPt: 842 })),
    onPrint: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root!.render(createElement(PrintDialog, props)))
  return props
}

const q = <T extends Element>(sel: string) => container!.querySelector<T>(sel)
const range = (v: string) => q<HTMLInputElement>(`input[data-print-range="${v}"]`)!
const printButton = () => q<HTMLButtonElement>('[data-print-confirm]')!
const printerSelect = () => q<HTMLSelectElement>('[data-print="printer"]')!
const copiesInput = () => q<HTMLInputElement>('[data-print="copies"]')!
const collateInput = () => q<HTMLInputElement>('[data-print="collate"]')!
const duplexSelect = () => q<HTMLSelectElement>('[data-print="duplex"]')!
const click = (el: Element) => act(async () => (el as HTMLElement).click())
const setValue = async (el: HTMLInputElement | HTMLSelectElement, value: string) => {
  const proto =
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    )
  })
}
const DEFAULT_JOB = { deviceName: '', copies: 1, collate: true, duplex: 'simplex' }

describe('PrintDialog', () => {
  it('shows the shared layout panel with paper and scaling', async () => {
    await mount()
    expect(q('[data-pl="mode"]')).not.toBeNull()
    expect(q('[data-pl="paper"]')).not.toBeNull()
    expect(q('[data-pl="scaling"]')).not.toBeNull()
  })

  it('offers "picked pages" only for two or more picked thumbnails', async () => {
    await mount({ pickedPages: [] })
    expect(range('picked').disabled).toBe(true)
    await act(async () => root!.unmount())
    container!.remove()
    await mount({ pickedPages: [5] })
    expect(range('picked').disabled).toBe(true)
    await act(async () => root!.unmount())
    container!.remove()
    await mount({ pickedPages: [3, 5] })
    expect(range('picked').disabled).toBe(false)
  })

  it('prints at default options with the same page lists as before', async () => {
    const props = await mount({ pickedPages: [3, 5] })
    await click(printButton())
    await click(range('current'))
    await click(printButton())
    await click(range('picked'))
    await click(printButton())
    const onPrint = props.onPrint as ReturnType<typeof vi.fn>
    expect(onPrint.mock.calls).toEqual([
      [undefined, createDefaultOptions(), DEFAULT_JOB],
      [[2], createDefaultOptions(), DEFAULT_JOB],
      [[3, 5], createDefaultOptions(), DEFAULT_JOB],
    ])
  })

  it('passes chosen printer, copies, collate and duplex to onPrint', async () => {
    const listPrinters = vi.fn(async () => [{ name: 'HP-Office', displayName: 'HP Office' }])
    const props = await mount({ listPrinters })
    expect(listPrinters).toHaveBeenCalledTimes(1)
    await setValue(printerSelect(), 'HP-Office')
    await setValue(copiesInput(), '3')
    await click(collateInput())
    await setValue(duplexSelect(), 'longEdge')
    await click(printButton())
    expect(props.onPrint).toHaveBeenCalledWith(undefined, createDefaultOptions(), {
      deviceName: 'HP-Office',
      copies: 3,
      collate: false,
      duplex: 'longEdge',
    })
  })

  it('disables copies, collate and duplex when system print dialog is chosen', async () => {
    const props = await mount()
    await setValue(printerSelect(), '\u0000system-dialog')
    expect(copiesInput().disabled).toBe(true)
    expect(collateInput().disabled).toBe(true)
    expect(duplexSelect().disabled).toBe(true)
    await click(printButton())
    expect(props.onPrint).toHaveBeenCalledWith(undefined, createDefaultOptions(), {
      deviceName: null,
    })
  })

  it('couples duplex with booklet and odd/even, and locks collate for layout options', async () => {
    await mount()
    await setValue(copiesInput(), '2')
    await click(collateInput())
    expect(collateInput().checked).toBe(false)

    await setValue(duplexSelect(), 'longEdge')
    await click(q('input[data-pl="mode"][value="booklet"]')!)
    expect(duplexSelect().value).toBe('shortEdge')
    expect(collateInput().checked).toBe(true)
    expect(collateInput().disabled).toBe(true)

    await click(q('input[data-pl="sides"][value="odd"]')!)
    expect(duplexSelect().value).toBe('simplex')

    await click(q('input[data-pl="mode"][value="single"]')!)
    await click(q('input[data-pl="sides"][value="all"]')!)
    expect(duplexSelect().value).toBe('longEdge')
    expect(collateInput().checked).toBe(false)
    expect(collateInput().disabled).toBe(false)
  })

  it('hands chosen layout options to the editor', async () => {
    const props = await mount()
    const nup = container!.querySelector<HTMLInputElement>('input[data-pl="mode"][value="nup"]')!
    await click(nup)
    await click(printButton())
    const [pages, options] = (props.onPrint as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(pages).toBeUndefined()
    expect(options.mode).toBe('nup')
  })

  it('starts from the default options every time it opens', async () => {
    await mount()
    await click(container!.querySelector('input[data-pl="mode"][value="booklet"]')!)
    expect(q<HTMLInputElement>('input[data-pl="mode"][value="booklet"]')!.checked).toBe(true)
    await act(async () => root!.unmount())
    container!.remove()
    await mount()
    expect(q<HTMLInputElement>('input[data-pl="mode"][value="single"]')!.checked).toBe(true)
  })

  it('marks a custom range that does not parse instead of printing', async () => {
    const props = await mount()
    await click(range('custom'))
    const field = q<HTMLInputElement>('input[data-print="range-custom"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(field, '9')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(printButton())
    expect(props.onPrint).not.toHaveBeenCalled()
    expect(q('input[data-print="range-custom"].invalid')).not.toBeNull()
  })
})

describe('a PDF with permission restrictions', () => {
  const savePdfOption = () => [...printerSelect().options].find((o) => o.value === SAVE_PDF_DEST)
  const saveImagesOption = () =>
    [...printerSelect().options].find((o) => o.value === SAVE_IMAGES_DEST)
  const reason = () => q('[data-print-save-restricted]')

  it('disables Save as PDF and Save as images in the destination list and says why', async () => {
    const onSavePdf = vi.fn()
    const onSaveImages = vi.fn()
    await mount({ onSavePdf, onSaveImages, saveRestricted: true })
    expect(savePdfOption()?.disabled).toBe(true)
    expect(saveImagesOption()?.disabled).toBe(true)
    expect(reason()).not.toBeNull()
    // printing stays available
    expect(printButton().disabled).toBe(false)
  })

  it('enables Save as PDF and Save as images with no restriction line for an unrestricted PDF', async () => {
    const onSavePdf = vi.fn()
    const onSaveImages = vi.fn()
    await mount({ onSavePdf, onSaveImages })
    expect(savePdfOption()?.disabled).toBe(false)
    expect(saveImagesOption()?.disabled).toBe(false)
    expect(reason()).toBeNull()

    await setValue(printerSelect(), SAVE_IMAGES_DEST)
    await click(printButton())
    expect(onSaveImages).toHaveBeenCalledWith(undefined, createDefaultOptions(), {
      format: 'png',
      quality: 90,
      bundle: 'files',
    })
  })
})

describe('restricted save wording', () => {
  it('exists in every UI language, translated rather than copied from English', () => {
    expect(strings.ko.printSaveRestricted).toBe(
      '권한이 걸린 PDF라 배치한 결과를 PDF로 저장할 수 없습니다. 인쇄는 할 수 있습니다.',
    )
    expect(strings.en.printSaveRestricted).toBe(
      'This PDF has permission restrictions, so the arranged result cannot be saved as a PDF. You can still print it.',
    )
    expect(LANGS).toContain('tr')
    for (const lang of LANGS) {
      const text = strings[lang].printSaveRestricted
      expect(typeof text).toBe('string')
      expect(text.trim()).not.toBe('')
      if (lang !== 'en') expect(text).not.toBe(strings.en.printSaveRestricted)
    }
  })
})

describe('"picked pages" range wording', () => {
  it('exists in every UI language, translated rather than copied from English', () => {
    expect(strings.ko.printRangePicked).toBe('고른 페이지')
    expect(strings.en.printRangePicked).toBe('Selected pages')
    for (const lang of LANGS) {
      const text = strings[lang].printRangePicked
      expect(typeof text).toBe('string')
      expect(text.trim()).not.toBe('')
      if (lang !== 'en') expect(text).not.toBe(strings.en.printRangePicked)
    }
  })
})
