/** @vitest-environment jsdom */
/**
 * The first-send alert of the spreadsheet editor: counted once per tab, Review
 * sends nothing and opens the candidate list, Send anyway lets it through, and
 * neither asks again in that tab.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SensitiveSendAnswer } from '@genoffice/ui'

import { useSheetHiding, type SheetHidingUi } from '../src/renderer/hiding/use-sheet-hiding'
import type { WorkbookReadContext } from '../src/renderer/ai/workbook-readers'
import type { UniverRuntime } from '../src/renderer/univer-state'

const workbook = {
  getSheets: () => [{ getSheetId: () => 's1', getSheetName: () => '명단', getNotes: () => [] }],
  getDefinedNames: () => [],
}
const runtime = { univerAPI: { getActiveWorkbook: () => workbook } } as unknown as UniverRuntime
const readContext = (): WorkbookReadContext =>
  ({
    univerRef: { current: runtime },
    lazyWorkbookRef: { current: null },
    adapterRef: {
      current: {
        getSnapshot: () => ({
          sheets: [
            { id: 's1', cells: { A1: { value: '연락처' }, A2: { value: '010-1234-5678' } } },
          ],
        }),
      },
    },
  }) as unknown as WorkbookReadContext

let host: HTMLDivElement
let root: Root
let ui: SheetHidingUi | null = null

function Harness({ localAi }: { localAi: boolean }) {
  ui = useSheetHiding({
    univerRef: { current: runtime },
    lang: 'en',
    setMessage: () => {},
    readColumn: async () => [],
    readContext,
    sessionId: () => null,
    localAi,
  })
  return ui.panel
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  ui = null
  vi.unstubAllGlobals()
})

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)))
const button = (text: string) =>
  [...host.querySelectorAll('button')].find((candidate) => candidate.textContent === text)

describe('the first-send alert', () => {
  it('Review sends nothing, opens the list, and the tab is not asked again', async () => {
    act(() => root.render(createElement(Harness, { localAi: false })))
    let answer: SensitiveSendAnswer | null = null
    void ui!.beforeSend([]).then((value) => {
      answer = value
    })
    await flush()
    await flush()
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain('1 in this document')
    act(() => button('Review')!.click())
    await flush()
    expect(answer).toBe('review')
    expect(host.textContent).toContain('010-1234-5678')
    await expect(ui!.beforeSend([])).resolves.toBe('send')
    expect(host.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('Send anyway lets the request out, and says "the AI on this PC" for a local AI', async () => {
    act(() => root.render(createElement(Harness, { localAi: true })))
    const pending = ui!.beforeSend([])
    await flush()
    await flush()
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain('on this PC')
    act(() => button('Send anyway')!.click())
    await expect(pending).resolves.toBe('send')
  })
})
