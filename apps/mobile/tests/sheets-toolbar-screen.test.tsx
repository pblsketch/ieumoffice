// The edit toolbar on screen: the four group buttons in the phone's bottom
// bar (edit mode only), [AI] only while AI is on, each group's sheet
// non-modal over a usable grid, and a button press reaching the workbook and
// its edit journal.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import { MobileLocaleProvider, translateMobile, type MobileStringKey } from '../src/renderer/i18n'
import { EditorShell } from '../src/renderer/shell/EditorShell'
import type { EditorHost } from '../src/renderer/editors/editorKind'
import type { MobileGrid } from '../src/renderer/editors/sheets/grid/mobileGrid'
import type { OpenedSheetsWorkbook } from '../src/renderer/editors/sheets/session'
import type { SheetsGridAccess } from '../src/renderer/editors/sheets/workspace/slots'
import { useToolbarWorkspaceItems } from '../src/renderer/editors/sheets/toolbar/workspaceSlot'
import { boot, seed, settle } from './helpers/sheetsToolbarBoot'

const containers: HTMLElement[] = []

afterEach(() => {
  while (containers.length > 0) containers.pop()?.remove()
})

function fakeHost() {
  return {
    showToast: vi.fn(),
    markDirty: vi.fn(),
    contentChanged: vi.fn(),
    setNotice: vi.fn(),
  } as unknown as EditorHost & {
    showToast: ReturnType<typeof vi.fn>
    markDirty: ReturnType<typeof vi.fn>
  }
}

function gridOf(phone: ReturnType<typeof boot> | null): SheetsGridAccess {
  if (!phone) return { grid: null, handle: null }
  const grid = {
    element: document.createElement('div'),
    runtime: phone.runtime,
    lazyWorkbookRef: phone.lazyWorkbookRef,
  } as unknown as MobileGrid
  return { grid, handle: null }
}

function Screen({
  host,
  grid,
  mode,
  aiEnabled,
  onGridPress,
}: {
  readonly host: EditorHost
  readonly grid: SheetsGridAccess
  readonly mode: DocumentMode
  readonly aiEnabled: boolean
  readonly onGridPress: () => void
}) {
  const t = (key: MobileStringKey) => translateMobile('en', key)
  const items = useToolbarWorkspaceItems({
    host,
    opened: {} as OpenedSheetsWorkbook,
    grid,
    mode,
    canEdit: true,
    lang: 'en',
    theme: 'light',
    t,
  })
  return (
    <EditorShell
      docTitle="book.xlsx"
      docFormat="xlsx"
      saveState="saved"
      mode={mode}
      canEdit
      aiEnabled={aiEnabled}
      quickActions={items.quickActions ?? []}
      moreItems={items.moreItems ?? []}
      aiPanelContent={<div />}
      onBack={() => {}}
      onEnterEdit={() => {}}
      onDone={() => {}}
      onExitEdit={() => {}}
      onSave={() => {}}
      onSaveAs={() => {}}
      onShare={() => {}}
      onFitToWidth={() => {}}
      onOpenBackups={() => {}}
    >
      <div data-testid="grid-stand-in" onClick={onGridPress} />
      {items.overlay}
    </EditorShell>
  )
}

function render(props: Parameters<typeof Screen>[0]): HTMLElement {
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
  const div = document.createElement('div')
  document.body.appendChild(div)
  containers.push(div)
  act(() => {
    createRoot(div).render(
      <MobileLocaleProvider lang="en">
        <Screen {...props} />
      </MobileLocaleProvider>,
    )
  })
  return div
}

async function waitFor<T>(find: () => T | null | undefined, ms = 30_000): Promise<T> {
  const started = Date.now()
  for (;;) {
    const found = find()
    if (found) return found
    if (Date.now() - started > ms) throw new Error('timed out')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }
}

const GROUP_IDS = ['format', 'rows', 'sort', 'insert']

function bar(el: HTMLElement): HTMLElement | null {
  return el.querySelector('[data-testid="phone-quick-toolbar"]')
}

describe('the sheets edit toolbar on screen', () => {
  it('shows the four groups in edit mode, with no AI slot while AI is off', () => {
    const el = render({
      host: fakeHost(),
      grid: gridOf(null),
      mode: 'edit',
      aiEnabled: false,
      onGridPress: () => {},
    })
    const groups = [...el.querySelectorAll('[data-testid^="sheets-toolbar-"]')].map((node) =>
      node.getAttribute('data-testid'),
    )
    expect(groups).toEqual(GROUP_IDS.map((id) => `sheets-toolbar-${id}`))
    expect(el.querySelector('[data-testid="phone-ai-open-btn"]')).toBeNull()
    // The buttons fill the bar from the start, nothing left where [AI] would be.
    const buttons = [...bar(el)!.querySelectorAll('button')]
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Cell format',
      'Rows & columns',
      'Sort & filter',
      'Insert',
    ])
  })

  it('puts [AI] at the right end only while AI is on', () => {
    const el = render({
      host: fakeHost(),
      grid: gridOf(null),
      mode: 'edit',
      aiEnabled: true,
      onGridPress: () => {},
    })
    const buttons = [...bar(el)!.querySelectorAll('button')]
    expect(buttons.at(-1)?.getAttribute('data-testid')).toBe('phone-ai-open-btn')
    expect(buttons).toHaveLength(5)
  })

  it('has no toolbar in view mode, and keeps Find in the More sheet', () => {
    const el = render({
      host: fakeHost(),
      grid: gridOf(null),
      mode: 'view',
      aiEnabled: false,
      onGridPress: () => {},
    })
    expect(el.querySelector('[data-testid^="sheets-toolbar-"]')).toBeNull()
    act(() => {
      el.querySelector<HTMLButtonElement>('[data-testid="editor-more-btn"]')!.click()
    })
    expect(el.querySelector('[data-testid="editor-more-sheetsFind"]')?.textContent).toContain(
      'Find',
    )
  })

  it('opens a group as a non-modal sheet that leaves the grid usable', async () => {
    const phone = boot()
    seed(phone.sheet)
    const onGridPress = vi.fn()
    const el = render({
      host: fakeHost(),
      grid: gridOf(phone),
      mode: 'edit',
      aiEnabled: false,
      onGridPress,
    })
    act(() => {
      el.querySelector<HTMLElement>('[data-testid="sheets-toolbar-format"]')!.click()
    })
    const sheet = await waitFor(() =>
      el.querySelector<HTMLElement>('[data-testid="sheets-toolbar-sheet-format"]'),
    )
    expect(sheet.classList.contains('mobile-sheet-layer-nonmodal')).toBe(true)
    expect(sheet.classList.contains('mobile-sheet-backdrop')).toBe(false)
    expect(sheet.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('false')
    act(() => {
      el.querySelector<HTMLElement>('[data-testid="grid-stand-in"]')!.click()
    })
    expect(onGridPress).toHaveBeenCalledTimes(1)
    expect(el.querySelector('[data-testid="sheets-toolbar-sheet-format"]')).not.toBeNull()
    // Another group replaces it; pressing the open group again closes it.
    act(() => {
      el.querySelector<HTMLElement>('[data-testid="sheets-toolbar-sort"]')!.click()
    })
    await waitFor(() => el.querySelector('[data-testid="sheets-toolbar-sheet-sort"]'))
    expect(el.querySelector('[data-testid="sheets-toolbar-sheet-format"]')).toBeNull()
    act(() => {
      el.querySelector<HTMLElement>('[data-testid="sheets-toolbar-sort"]')!.click()
    })
    expect(el.querySelector('[data-testid="sheets-toolbar-sheet-sort"]')).toBeNull()
    phone.uninstall()
  }, 180_000)

  it('sends a press to the workbook, echoes it and records it in the journal', async () => {
    const phone = boot()
    seed(phone.sheet)
    phone.workbook.setActiveRange(phone.sheet.getRange('B1'))
    const host = fakeHost()
    const el = render({
      host,
      grid: gridOf(phone),
      mode: 'edit',
      aiEnabled: false,
      onGridPress() {},
    })
    act(() => {
      el.querySelector<HTMLElement>('[data-testid="sheets-toolbar-format"]')!.click()
    })
    const bold = await waitFor(() =>
      el.querySelector<HTMLButtonElement>('[data-testid="sheets-tb-bold"]'),
    )
    expect(bold.getAttribute('aria-pressed')).toBe('false')
    phone.executed.length = 0
    act(() => bold.click())
    await settle()
    expect(phone.executed).toContain('sheet.command.set-style')
    expect(phone.state.editJournal.cells.size).toBeGreaterThan(0)
    await waitFor(() => bold.getAttribute('aria-pressed') === 'true')

    // The number format list: a choice sends the desktop's pattern.
    act(() => {
      el.querySelector<HTMLElement>('[data-testid="sheets-tb-picker-numberFormat"]')!.click()
    })
    const list = await waitFor(() =>
      el.querySelector<HTMLElement>('[data-testid="sheets-tb-list-numberFormat"]'),
    )
    const percent = [...list.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((button) =>
      button.textContent?.includes('Percent'),
    )!
    act(() => percent.click())
    await settle()
    expect(phone.sheet.getRange('B1').getNumberFormat()).toBe('0.00%')
    phone.uninstall()
  }, 180_000)

  it('offers no edit command for charts, pivots or conditional formatting in any sheet', async () => {
    const phone = boot()
    const el = render({
      host: fakeHost(),
      grid: gridOf(phone),
      mode: 'edit',
      aiEnabled: false,
      onGridPress() {},
    })
    for (const id of GROUP_IDS) {
      act(() => {
        el.querySelector<HTMLElement>(`[data-testid="sheets-toolbar-${id}"]`)!.click()
      })
      const sheet = await waitFor(() =>
        el.querySelector<HTMLElement>(`[data-testid="sheets-toolbar-sheet-${id}"]`),
      )
      const commands = [...sheet.querySelectorAll('[data-command]')].map((node) =>
        node.getAttribute('data-command'),
      )
      expect(commands.length, id).toBeGreaterThan(0)
      for (const command of commands) {
        expect(command).not.toMatch(/chart|pivot|^cf-|conditional|sparkline|slicer/)
      }
      act(() => {
        el.querySelector<HTMLElement>(`[data-testid="sheets-toolbar-${id}"]`)!.click()
      })
    }
    phone.uninstall()
  }, 180_000)

  it("shows the desktop's full-load offer before sorting a streamed workbook", async () => {
    const phone = boot({ preloadComplete: false })
    ;(phone.state as { formulaMode: boolean }).formulaMode = false
    seed(phone.sheet)
    phone.workbook.setActiveRange(phone.sheet.getRange('A1:A3'))
    const el = render({
      host: fakeHost(),
      grid: gridOf(phone),
      mode: 'edit',
      aiEnabled: false,
      onGridPress() {},
    })
    act(() => {
      el.querySelector<HTMLElement>('[data-testid="sheets-toolbar-sort"]')!.click()
    })
    const sortAsc = await waitFor(() =>
      el.querySelector<HTMLButtonElement>('[data-testid="sheets-tb-sortAsc"]'),
    )
    act(() => sortAsc.click())
    const offer = await waitFor(() =>
      document.querySelector<HTMLElement>('[data-testid="sheets-full-load-sheet"]'),
    )
    expect(offer.textContent).toContain('Load all')
    expect(phone.sheet.getRange('A1').getValue()).toBe(3)
    phone.uninstall()
  }, 180_000)
})
