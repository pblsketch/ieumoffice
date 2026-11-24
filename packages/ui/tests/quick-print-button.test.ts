/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultPrinterLabel,
  QUICK_PRINT_CONFIRM_THRESHOLD,
  QuickPrintButton,
  SAVE_IMAGES_DEST,
  SAVE_PDF_DEST,
  type QuickPrintPrefStore,
} from '../src/print-layout'

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

const click = async (el: Element | null) => {
  expect(el).not.toBeNull()
  await act(async () => {
    ;(el as HTMLElement).click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('defaultPrinterLabel', () => {
  it('picks the OS default printer when marked, falling back to first printer or generic label', () => {
    expect(defaultPrinterLabel([], 'Default printer')).toBe('Default printer')
    expect(
      defaultPrinterLabel(
        [
          { name: 'Office', displayName: 'Office Laser' },
          { name: 'Desk', displayName: 'Desk Inkjet', isDefault: true },
        ],
        'Default printer',
      ),
    ).toBe('Desk Inkjet')
    expect(
      defaultPrinterLabel([{ name: 'Only', displayName: 'Only Printer' }], 'Default printer'),
    ).toBe('Only Printer')
  })
})

describe('QuickPrintButton', () => {
  it('opens the print dialog on main click by default, and supports Save PDF / Save images from the dropdown', async () => {
    const onOpenDialog = vi.fn()
    const onQuickPrint = vi.fn()
    const listPrinters = vi.fn(async () => [
      { name: 'HP', displayName: 'HP Office', isDefault: true },
    ])

    await act(async () => {
      root.render(
        createElement(QuickPrintButton, {
          lang: 'ko',
          listPrinters,
          onOpenDialog,
          onQuickPrint,
        }),
      )
    })

    await click(host.querySelector('[data-quick-print="main"]'))
    expect(onOpenDialog).toHaveBeenCalledTimes(1)
    expect(onOpenDialog).toHaveBeenLastCalledWith()
    expect(onQuickPrint).not.toHaveBeenCalled()

    await click(host.querySelector('[data-quick-print="menu-toggle"]'))
    const menu = document.body.querySelector('[data-quick-print="menu"]')
    expect(menu).not.toBeNull()
    expect(menu?.textContent).toContain('HP Office')

    await click(document.body.querySelector('[data-quick-print="save-pdf"]'))
    expect(onOpenDialog).toHaveBeenLastCalledWith(SAVE_PDF_DEST)

    await click(host.querySelector('[data-quick-print="menu-toggle"]'))
    await click(document.body.querySelector('[data-quick-print="save-images"]'))
    expect(onOpenDialog).toHaveBeenLastCalledWith(SAVE_IMAGES_DEST)
  })

  it('disables Save PDF and Save images when saveRestricted is true', async () => {
    const onOpenDialog = vi.fn()
    const onQuickPrint = vi.fn()

    await act(async () => {
      root.render(
        createElement(QuickPrintButton, {
          lang: 'en',
          saveRestricted: true,
          onOpenDialog,
          onQuickPrint,
        }),
      )
    })

    await click(host.querySelector('[data-quick-print="menu-toggle"]'))
    const savePdf = document.body.querySelector<HTMLButtonElement>('[data-quick-print="save-pdf"]')
    const saveImg = document.body.querySelector<HTMLButtonElement>(
      '[data-quick-print="save-images"]',
    )
    expect(savePdf?.disabled).toBe(true)
    expect(saveImg?.disabled).toBe(true)
    expect(document.body.querySelector('[data-quick-print="save-restricted-note"]')).not.toBeNull()
  })

  it('persists click-to-quick-print toggle and runs Quick Print on main click when enabled', async () => {
    let stored = false
    const prefStore: QuickPrintPrefStore = {
      getQuickPrintPref: vi.fn(async () => stored),
      setQuickPrintPref: vi.fn(async (next: boolean) => {
        stored = next
        return next
      }),
    }
    const onOpenDialog = vi.fn()
    const onQuickPrint = vi.fn()
    const listPrinters = vi.fn(async () => [
      { name: 'Brother', displayName: 'Brother HL', isDefault: true },
    ])

    await act(async () => {
      root.render(
        createElement(QuickPrintButton, {
          lang: 'en',
          listPrinters,
          prefStore,
          getPageCount: () => 3,
          onOpenDialog,
          onQuickPrint,
        }),
      )
      await Promise.resolve()
    })

    await click(host.querySelector('[data-quick-print="menu-toggle"]'))
    await click(document.body.querySelector('[data-quick-print="toggle-default"]'))
    expect(stored).toBe(true)
    expect(host.querySelector('.gs-qp-direct')).not.toBeNull()

    await click(host.querySelector('[data-quick-print="main"]'))
    expect(onQuickPrint).toHaveBeenCalledTimes(1)
    expect(onQuickPrint).toHaveBeenCalledWith('Brother HL')
    expect(onOpenDialog).not.toHaveBeenCalled()
  })

  it('prompts for confirmation when page count >= threshold and lets user open dialog or proceed', async () => {
    const onOpenDialog = vi.fn()
    const onQuickPrint = vi.fn()
    const listPrinters = vi.fn(async () => [
      { name: 'Canon', displayName: 'Canon MF', isDefault: true },
    ])

    await act(async () => {
      root.render(
        createElement(QuickPrintButton, {
          lang: 'ko',
          listPrinters,
          getPageCount: () => QUICK_PRINT_CONFIRM_THRESHOLD,
          onOpenDialog,
          onQuickPrint,
        }),
      )
    })

    await click(host.querySelector('[data-quick-print="menu-toggle"]'))
    await click(document.body.querySelector('[data-quick-print="quick-print"]'))
    expect(onQuickPrint).not.toHaveBeenCalled()
    const dialog = document.body.querySelector('[data-quick-print="confirm-dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain(String(QUICK_PRINT_CONFIRM_THRESHOLD))
    expect(dialog?.textContent).toContain('Canon MF')

    // User can jump straight to the print dialog from the guard
    await click(document.body.querySelector('[data-quick-print="confirm-open-dialog"]'))
    expect(onOpenDialog).toHaveBeenCalledTimes(1)
    expect(onQuickPrint).not.toHaveBeenCalled()

    // Or confirm Quick Print
    await click(host.querySelector('[data-quick-print="menu-toggle"]'))
    await click(document.body.querySelector('[data-quick-print="quick-print"]'))
    await click(document.body.querySelector('[data-quick-print="confirm-proceed"]'))
    expect(onQuickPrint).toHaveBeenCalledTimes(1)
    expect(onQuickPrint).toHaveBeenCalledWith('Canon MF')
  })

  it('falls back to opening the print dialog when no OS printer is installed', async () => {
    const onOpenDialog = vi.fn()
    const onQuickPrint = vi.fn()
    const onNoPrinter = vi.fn()
    const listPrinters = vi.fn(async () => [])

    await act(async () => {
      root.render(
        createElement(QuickPrintButton, {
          lang: 'en',
          listPrinters,
          onOpenDialog,
          onQuickPrint,
          onNoPrinter,
        }),
      )
    })

    await click(host.querySelector('[data-quick-print="menu-toggle"]'))
    await click(document.body.querySelector('[data-quick-print="quick-print"]'))
    expect(onQuickPrint).not.toHaveBeenCalled()
    expect(onNoPrinter).toHaveBeenCalledTimes(1)
    expect(onOpenDialog).toHaveBeenCalledTimes(1)
  })
})
