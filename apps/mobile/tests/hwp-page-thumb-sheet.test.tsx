import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { BackStackProvider } from '../src/renderer/shell/backStack'
import { HwpPageThumbSheet } from '../src/renderer/components/HwpPageThumbSheet'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Array<{ root: ReturnType<typeof createRoot>; container: HTMLElement }> = []

afterEach(() => {
  while (roots.length > 0) {
    const entry = roots.pop()
    if (!entry) continue
    act(() => {
      entry.root.unmount()
    })
    entry.container.remove()
  }
})

describe('HwpPageThumbSheet', () => {
  it('loads page count, renders thumbnails, and navigates on tap', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push({ root, container })

    const onClose = vi.fn()
    const onSelectPage = vi.fn()
    const loadPreviewPage = vi.fn(async (page: number) => ({
      pageCount: 3,
      page,
      svg: `<svg width="100" height="140"><text>Page ${page + 1}</text></svg>`,
      width: 100,
      height: 140,
    }))

    act(() => {
      root.render(
        <MobileLocaleProvider lang="ko">
          <BackStackProvider>
            <HwpPageThumbSheet
              open={true}
              onClose={onClose}
              getPageCount={async () => 3}
              loadPreviewPage={loadPreviewPage}
              onSelectPage={onSelectPage}
            />
          </BackStackProvider>
        </MobileLocaleProvider>,
      )
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const cells = container.querySelectorAll('button[data-testid^="hwp-page-thumb-"]')
    expect(cells.length).toBe(3)
    expect(loadPreviewPage).toHaveBeenCalledTimes(3)

    act(() => {
      ;(cells[1] as HTMLButtonElement).click()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSelectPage).toHaveBeenCalledWith(1)
  })
})
