/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOptions } from '@genoffice/print-layout/plan'
import { SYSTEM_DIALOG } from '@genoffice/ui'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { WhiteboardPrintDialog } from '../src/renderer/PrintDialog'
import type { PrintPage } from '../src/shared/ipc'

const PAGE_1: PrintPage = {
  svg: '<svg id="p1"></svg>',
  width: 800,
  height: 600,
  pageWidth: 800,
  pageHeight: 600,
}
const PAGE_2: PrintPage = {
  svg: '<svg id="p2"></svg>',
  width: 600,
  height: 800,
  pageWidth: 600,
  pageHeight: 800,
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  ;(window as unknown as { whiteboardApi: unknown }).whiteboardApi = {
    core: { onLanguageChanged: () => () => {} },
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete (window as { whiteboardApi?: unknown }).whiteboardApi
  vi.unstubAllGlobals()
})

const $ = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)
const click = (el: Element | null) => act(() => (el as HTMLElement).click())
const selectValue = (el: HTMLSelectElement | null, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el!, value)
    el!.dispatchEvent(new Event('change', { bubbles: true }))
  })
const settle = () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0))
  })

async function open() {
  const plainPrint = vi.fn(async () => ({ ok: true }))
  const printLayout = {
    preview: vi.fn(async () => ({ ok: true as const, faces: [] })),
    print: vi.fn(async () => ({ ok: true as const })),
    savePdf: vi.fn(async () => ({ ok: true as const, path: 'C:/out.pdf' })),
    cancel: vi.fn(async () => {}),
    onProgress: vi.fn(() => () => {}),
    getLabelSpec: vi.fn(async () => null),
    setLabelSpec: vi.fn(async () => ({ ok: true as const })),
    listPrinters: vi.fn(async () => [{ name: 'HP', displayName: 'HP Office' }]),
  }
  const onClose = vi.fn()
  const onMessage = vi.fn()
  act(() =>
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(WhiteboardPrintDialog, {
          api: { exporting: { print: plainPrint, printLayout } as never },
          title: 'Board',
          buildPages: (scope) => (scope === 'current' ? [PAGE_2] : [PAGE_1, PAGE_2]),
          onClose,
          onMessage,
        }),
      ),
    ),
  )
  await settle()
  return { plainPrint, printLayout, onClose, onMessage }
}

describe('WhiteboardPrintDialog', () => {
  it('uses plain print when system dialog is chosen at default options', async () => {
    const { plainPrint, printLayout, onClose } = await open()
    selectValue($<HTMLSelectElement>('select[data-print="printer"]'), SYSTEM_DIALOG)
    click($('button[data-pl="print"]'))
    await settle()
    expect(plainPrint).toHaveBeenCalledWith({ pages: [PAGE_1, PAGE_2], title: 'Board' })
    expect(printLayout.print).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('sends duplex job through printLayout when an in-app printer is chosen', async () => {
    const { plainPrint, printLayout, onClose } = await open()
    selectValue($<HTMLSelectElement>('select[data-print="duplex"]'), 'longEdge')
    click($('button[data-pl="print"]'))
    await settle()
    expect(plainPrint).not.toHaveBeenCalled()
    expect(printLayout.print).toHaveBeenCalledWith({
      options: createDefaultOptions(),
      editor: { pages: [PAGE_1, PAGE_2], title: 'Board' },
      job: { deviceName: '', copies: 1, collate: true, duplex: 'longEdge' },
    })
    expect(onClose).toHaveBeenCalled()
  })
})
