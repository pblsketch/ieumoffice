import { act, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileRef } from '@genoffice/mobile-bridge/home'
import type { MobileClient } from '@genoffice/mobile-bridge/transport'
import {
  favoriteFileItem,
  folderFileItem,
  HomeFileRow,
  HomeSelectionBar,
  HomeSelectionHeader,
  recentFileItem,
  rowMenuActions,
  selectionBarActions,
  useHomeFileActions,
  useHomeSelection,
  validateBaseName,
  type HomeActionsHost,
  type HomeBulkAction,
  type HomeFileItem,
  type HomeListKind,
} from '../src/renderer/home/actions'
import type { PdfToolStart, PdfToolsLink } from '../src/renderer/home/pdfToolsLink'
import { providePdfToolsLink } from '../src/renderer/home/pdfToolsLink'
import { resetHomePrefsForTest, setEditorOn } from '../src/renderer/home/prefsStore'
import { resetHomeRuntimeForTest } from '../src/renderer/home/homeRuntime'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { BackStackProvider } from '../src/renderer/shell/backStack'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Handler = (args: Record<string, unknown> | undefined) => unknown

interface Fake {
  readonly host: HomeActionsHost
  readonly invoke: ReturnType<typeof vi.fn>
  readonly removeRecentDoc: ReturnType<typeof vi.fn>
  readonly showToast: ReturnType<typeof vi.fn>
  readonly refreshHome: ReturnType<typeof vi.fn>
  calls(command: string): (Record<string, unknown> | undefined)[]
}

/** A backend that answers the commands it knows and `{ ok: true }` to the rest, like the preview. */
function fakeHost(handlers: Record<string, Handler> = {}): Fake {
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    const handler = handlers[command]
    return handler ? handler(args) : { ok: true }
  })
  const removeRecentDoc = vi.fn(async () => ({ ok: true }))
  const showToast = vi.fn()
  const refreshHome = vi.fn(async () => {})
  const client = {
    transport: { invoke, listen: vi.fn() },
    removeRecentDoc,
  } as unknown as MobileClient
  return {
    host: { client, showToast, refreshHome },
    invoke,
    removeRecentDoc,
    showToast,
    refreshHome,
    calls: (command) =>
      invoke.mock.calls
        .filter((call) => call[0] === command)
        .map((call) => call[1] as Record<string, unknown> | undefined),
  }
}

const roots: Root[] = []
const containers: HTMLElement[] = []

function render(node: ReactNode): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  containers.push(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(
      <MobileLocaleProvider lang="ko">
        <BackStackProvider>{node}</BackStackProvider>
      </MobileLocaleProvider>,
    )
  })
  return container
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

function byTestId(id: string): HTMLElement | null {
  return document.body.querySelector(`[data-testid="${id}"]`)
}

function click(el: Element | null): void {
  if (!el) throw new Error('element missing')
  act(() => {
    ;(el as HTMLElement).click()
  })
}

function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const recentRef = (id: string): FileRef => ({ kind: 'recent', id })

function recentItem(id: string, name: string, favorite = false): HomeFileItem {
  return recentFileItem(
    { id, docKey: `doc-${id}`, name, format: name.endsWith('.pdf') ? 'pdf' : 'md', openedAt: 1 },
    { favorite },
  )
}

function folderItem(entryId: string, name: string, isPicture: boolean): HomeFileItem {
  return folderFileItem('f1', {
    id: entryId,
    name,
    isDir: false,
    isPicture,
    format: isPicture ? undefined : name.endsWith('.pdf') ? 'pdf' : 'md',
  })
}

const noLink = null as unknown as PdfToolsLink
const someLink: PdfToolsLink = { Flow: () => null }

beforeEach(() => {
  // A browser answers history.back() with a popstate; jsdom does it later, so answer at once here
  // to keep each test's back stack in step.
  vi.spyOn(window.history, 'back').mockImplementation(() => {
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  resetHomePrefsForTest()
  resetHomeRuntimeForTest()
  providePdfToolsLink(noLink)
})

afterEach(() => {
  act(() => {
    while (roots.length > 0) roots.pop()?.unmount()
  })
  while (containers.length > 0) containers.pop()?.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function barButtons(): string[] {
  return [...document.body.querySelectorAll('[data-testid^="home-act-bar-"]')]
    .map((el) => el.getAttribute('data-testid') ?? '')
    .filter((id) => id !== 'home-act-bar-more-sheet')
}

function moreItems(): string[] {
  return [...document.body.querySelectorAll('[data-testid^="home-act-more-"]')].map(
    (el) => el.getAttribute('data-testid') ?? '',
  )
}

function renderBar(listKind: HomeListKind, items: readonly HomeFileItem[], onAction = vi.fn()) {
  render(<HomeSelectionBar listKind={listKind} items={items} onAction={onAction} />)
  return onAction
}

describe('selection bar composition', () => {
  it('recent and favorites lists: share, remove from list, and more (favorite, group, delete)', () => {
    for (const kind of ['recent', 'favorites'] as const) {
      const items = [recentItem('a', 'a.md', true), recentItem('b', 'b.md', true)]
      renderBar(kind, items)
      expect(barButtons()).toEqual([
        'home-act-bar-share',
        'home-act-bar-removeFromList',
        'home-act-bar-more',
      ])
      click(byTestId('home-act-bar-more'))
      expect(moreItems()).toEqual([
        'home-act-more-favoriteRemove',
        'home-act-more-moveToGroup',
        'home-act-more-delete',
      ])
      act(() => {
        while (roots.length > 0) roots.pop()?.unmount()
      })
    }
  })

  it('folder list: share, delete, and more (favorite, group) without remove from list', () => {
    renderBar('folder', [folderItem('1', 'a.md', false)])
    expect(barButtons()).toEqual(['home-act-bar-share', 'home-act-bar-delete', 'home-act-bar-more'])
    click(byTestId('home-act-bar-more'))
    // not starred: no "move to group"
    expect(moreItems()).toEqual(['home-act-more-favoriteAdd'])
  })

  it('offers "move to group" only when every picked file is starred', () => {
    const mixed = selectionBarActions([recentItem('a', 'a.md', true), recentItem('b', 'b.md')], {
      listKind: 'recent',
      pdfToolsReady: false,
    })
    expect(mixed.more).toEqual(['favoriteAdd', 'delete'])
    const starred = selectionBarActions([recentItem('a', 'a.md', true)], {
      listKind: 'recent',
      pdfToolsReady: false,
    })
    expect(starred.more).toEqual(['favoriteRemove', 'moveToGroup', 'delete'])
  })

  it('adds [merge] for all PDFs only when PDF tools are on and T3 is linked', async () => {
    const pdfs = [folderItem('1', 'a.pdf', false), folderItem('2', 'b.pdf', false)]
    // no link yet
    renderBar('folder', pdfs)
    expect(byTestId('home-act-bar-merge')).toBeNull()
    act(() => {
      providePdfToolsLink(someLink)
    })
    expect(byTestId('home-act-bar-merge')).not.toBeNull()
    expect(byTestId('home-act-bar-imagesToPdf')).toBeNull()
    // PDF tools turned off in settings
    await act(async () => {
      await setEditorOn('pdfTools', false)
    })
    expect(byTestId('home-act-bar-merge')).toBeNull()
  })

  it('adds [make PDF] for all pictures, and nothing for a mix', () => {
    act(() => {
      providePdfToolsLink(someLink)
    })
    renderBar('folder', [folderItem('1', 'a.jpg', true), folderItem('2', 'b.png', true)])
    expect(byTestId('home-act-bar-imagesToPdf')).not.toBeNull()
    expect(byTestId('home-act-bar-merge')).toBeNull()
    const mixed = selectionBarActions(
      [folderItem('1', 'a.jpg', true), folderItem('2', 'b.pdf', false)],
      {
        listKind: 'folder',
        pdfToolsReady: true,
      },
    )
    expect(mixed.bar).toEqual(['share', 'delete'])
  })
})

describe('row menu', () => {
  it('shows "move to group" only for starred files and "remove from list" only in the recent list', () => {
    expect(rowMenuActions(recentItem('a', 'a.md'), 'recent')).not.toContain('moveToGroup')
    expect(rowMenuActions(recentItem('a', 'a.md', true), 'recent')).toContain('moveToGroup')
    expect(rowMenuActions(recentItem('a', 'a.md'), 'recent')).toContain('removeFromList')
    expect(
      rowMenuActions(
        favoriteFileItem({ docKey: 'k', name: 'x.md', format: 'md', groupId: null, addedAt: 1 }),
        'favorites',
      ),
    ).not.toContain('removeFromList')
    expect(rowMenuActions(folderItem('1', 'a.md', false), 'folder')).not.toContain('removeFromList')
    for (const kind of ['recent', 'favorites', 'folder'] as const) {
      const actions = rowMenuActions(recentItem('a', 'a.md', true), kind)
      expect(actions).toEqual(
        expect.arrayContaining(['share', 'rename', 'duplicate', 'delete', 'select']),
      )
    }
  })
})

interface HarnessProps {
  readonly fake: Fake
  readonly listKind: HomeListKind
  readonly items: readonly HomeFileItem[]
  readonly onOpenPdfTool?: (start: PdfToolStart) => void
  readonly expose?: (api: {
    runBulk: (action: HomeBulkAction, items: readonly HomeFileItem[]) => void
  }) => void
}

/** How a list composes the parts: rows, header, bar, and the action runner. */
function Harness({ fake, listKind, items, onOpenPdfTool, expose }: HarnessProps) {
  const selection = useHomeSelection(items)
  const actions = useHomeFileActions({
    listKind,
    host: fake.host,
    onOpenPdfTool,
    onStartSelect: (item) => selection.start(item.key),
    onSelectionDone: selection.clear,
  })
  expose?.({ runBulk: actions.runBulk })
  const [opened, setOpened] = useState<string | null>(null)
  return (
    <div>
      {selection.selecting && (
        <HomeSelectionHeader count={selection.selectedKeys.length} onClose={selection.clear} />
      )}
      <ul>
        {items.map((item) => (
          <HomeFileRow
            key={item.key}
            item={item}
            selecting={selection.selecting}
            selected={selection.isSelected(item.key)}
            onOpen={() => setOpened(item.key)}
            onToggleSelect={() => selection.toggle(item.key)}
            onStartSelect={() => selection.start(item.key)}
            onOpenMenu={() => actions.openRowMenu(item)}
          />
        ))}
      </ul>
      {selection.selecting && (
        <HomeSelectionBar
          listKind={listKind}
          items={selection.selectedItems}
          onAction={(action) => actions.runBulk(action, selection.selectedItems)}
        />
      )}
      {actions.element}
      <span data-testid="opened">{opened ?? ''}</span>
    </div>
  )
}

describe('entering and leaving selection', () => {
  it('long-press on a row enters selection with that row picked', () => {
    vi.useFakeTimers()
    const fake = fakeHost()
    const items = [recentItem('a', 'a.md'), recentItem('b', 'b.md')]
    render(<Harness fake={fake} listKind="recent" items={items} />)
    const row = byTestId(`home-file-row-open-${items[0].key}`)
    act(() => {
      row?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }))
    })
    act(() => {
      vi.advanceTimersByTime(700)
    })
    act(() => {
      row?.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 5, clientY: 5 }))
    })
    expect(byTestId('home-act-selection-header')?.textContent).toContain('1')
    expect(row?.getAttribute('aria-checked')).toBe('true')
    // the click that ends the long press does not open the file
    click(row)
    expect(byTestId('opened')?.textContent).toBe('')
  })

  it('the row menu item "Select" enters selection too', () => {
    const fake = fakeHost()
    const items = [recentItem('a', 'a.md'), recentItem('b', 'b.md')]
    render(<Harness fake={fake} listKind="recent" items={items} />)
    expect(byTestId('home-act-selection-header')).toBeNull()
    click(byTestId(`home-file-row-more-${items[1].key}`))
    click(byTestId('home-act-menu-select'))
    expect(byTestId('home-act-selection-header')).not.toBeNull()
    expect(byTestId(`home-file-row-open-${items[1].key}`)?.getAttribute('aria-checked')).toBe(
      'true',
    )
    // taps now pick instead of opening
    click(byTestId(`home-file-row-open-${items[0].key}`))
    expect(byTestId('home-act-selection-header')?.textContent).toContain('2')
    expect(byTestId('opened')?.textContent).toBe('')
  })

  it('Back closes the selection as one layer, and so does [close]', () => {
    const fake = fakeHost()
    const items = [recentItem('a', 'a.md')]
    render(<Harness fake={fake} listKind="recent" items={items} />)
    click(byTestId(`home-file-row-more-${items[0].key}`))
    click(byTestId('home-act-menu-select'))
    expect(byTestId('home-act-selection-header')).not.toBeNull()
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(byTestId('home-act-selection-header')).toBeNull()

    click(byTestId(`home-file-row-more-${items[0].key}`))
    click(byTestId('home-act-menu-select'))
    click(byTestId('home-act-selection-close'))
    expect(byTestId('home-act-selection-header')).toBeNull()
  })
})

describe('rename', () => {
  it('refuses an empty name or one with a slash before asking the backend', async () => {
    expect(validateBaseName('  ')).toBe('homeActNameInvalid')
    expect(validateBaseName('a/b')).toBe('homeActNameInvalid')
    expect(validateBaseName('a\\b')).toBe('homeActNameInvalid')
    expect(validateBaseName('report')).toBeNull()

    const fake = fakeHost({
      mobile_home_rename: (args) => {
        if (args?.newBaseName === 'taken') {
          throw { code: 'INVALID_ARGUMENT', messageKey: 'mobile.home.nameTaken' }
        }
        return { kind: 'recent', id: 'a2' }
      },
    })
    const items = [recentItem('a', 'report.md')]
    render(<Harness fake={fake} listKind="recent" items={items} />)
    click(byTestId(`home-file-row-more-${items[0].key}`))
    click(byTestId('home-act-menu-rename'))
    const input = byTestId('home-act-rename-input') as HTMLInputElement
    expect(input.value).toBe('report')
    // the extension is shown but not editable
    expect(byTestId('home-act-rename-ext')?.textContent).toBe('.md')

    typeInto(input, '')
    click(byTestId('home-act-rename-submit'))
    await flush()
    expect(byTestId('home-act-rename-error')?.textContent).toBeTruthy()
    typeInto(input, 'a/b')
    click(byTestId('home-act-rename-submit'))
    await flush()
    expect(fake.calls('mobile_home_rename')).toHaveLength(0)

    typeInto(input, 'taken')
    click(byTestId('home-act-rename-submit'))
    await flush()
    expect(fake.calls('mobile_home_rename')).toHaveLength(1)
    expect(byTestId('home-act-rename-error')?.textContent).toContain('같은 이름')
    expect(byTestId('home-act-rename-sheet')).not.toBeNull()

    typeInto(input, 'final')
    click(byTestId('home-act-rename-submit'))
    await flush()
    expect(fake.calls('mobile_home_rename')[1]).toEqual({
      fileRef: recentRef('a'),
      newBaseName: 'final',
    })
    expect(byTestId('home-act-rename-sheet')).toBeNull()
    expect(fake.refreshHome).toHaveBeenCalled()
  })
})

describe('delete', () => {
  for (const [platform, wording] of [
    ['android', '되돌릴 수 없습니다'],
    ['ios', '휴지통'],
  ] as const) {
    it(`asks once for n files with the ${platform} wording`, async () => {
      const fake = fakeHost({
        mobile_home_app_info: () => ({ version: '1', platform, osVersion: '1' }),
        mobile_home_delete: (args) => ({ deleted: args?.refs, failed: [] }),
      })
      const items = [recentItem('a', 'a.md'), recentItem('b', 'b.md'), recentItem('c', 'c.md')]
      let runBulk: ((action: HomeBulkAction, list: readonly HomeFileItem[]) => void) | null = null
      render(
        <Harness
          fake={fake}
          listKind="recent"
          items={items}
          expose={(api) => {
            runBulk = api.runBulk
          }}
        />,
      )
      act(() => runBulk?.('delete', items))
      await flush()
      const dialogs = document.body.querySelectorAll('[data-testid="home-act-confirm"]')
      expect(dialogs).toHaveLength(1)
      expect(dialogs[0].textContent).toContain(wording)
      expect(dialogs[0].textContent).toContain('3')
      expect(fake.calls('mobile_home_delete')).toHaveLength(0)
      click(byTestId('home-act-confirm-ok'))
      await flush()
      expect(fake.calls('mobile_home_delete')).toEqual([
        { refs: [recentRef('a'), recentRef('b'), recentRef('c')] },
      ])
      expect(byTestId('home-act-confirm')).toBeNull()
    })
  }
})

describe('other actions', () => {
  it('duplicate passes the localized copy word, remove-from-recent uses removeRecentDoc', async () => {
    const fake = fakeHost({ mobile_home_duplicate: () => ({ kind: 'recent', id: 'z' }) })
    const items = [recentItem('a', 'a.md')]
    render(<Harness fake={fake} listKind="recent" items={items} />)
    click(byTestId(`home-file-row-more-${items[0].key}`))
    click(byTestId('home-act-menu-duplicate'))
    await flush()
    expect(fake.calls('mobile_home_duplicate')).toEqual([
      { fileRef: recentRef('a'), copySuffix: '복사본' },
    ])
    click(byTestId(`home-file-row-more-${items[0].key}`))
    click(byTestId('home-act-menu-removeFromList'))
    await flush()
    expect(fake.removeRecentDoc).toHaveBeenCalledWith('a')
  })

  it('renders without a client and treats non-array answers as empty', async () => {
    const items = [recentItem('a', 'a.md', true)]
    const fake = fakeHost()
    render(<Harness fake={fake} listKind="favorites" items={items} />)
    click(byTestId(`home-file-row-more-${items[0].key}`))
    click(byTestId('home-act-menu-moveToGroup'))
    await flush()
    // the fake answered listGroups with { ok: true }: no groups, but "no group" and "new group"
    expect(byTestId('home-act-group-sheet')).not.toBeNull()
    expect(byTestId('home-act-group-none')).not.toBeNull()
    expect(byTestId('home-act-group-new')).not.toBeNull()

    function NoHost() {
      const actions = useHomeFileActions({ listKind: 'recent', host: null })
      return (
        <>
          <HomeFileRow
            item={items[0]}
            selecting={false}
            selected={false}
            onOpen={() => {}}
            onToggleSelect={() => {}}
            onStartSelect={() => {}}
            onOpenMenu={() => actions.openRowMenu(items[0])}
          />
          {actions.element}
        </>
      )
    }
    expect(() => render(<NoHost />)).not.toThrow()
  })
})

describe('PDF tools inputs', () => {
  it('builds merge inputs in pick order and reads bytes only when asked', async () => {
    act(() => {
      providePdfToolsLink(someLink)
    })
    const fake = fakeHost({
      mobile_home_read_bytes: () => ({
        bytesBase64: 'AQID',
        name: 'a.pdf',
        mime: 'application/pdf',
      }),
    })
    const items = [folderItem('1', 'a.pdf', false), folderItem('2', 'b.pdf', false)]
    const onOpenPdfTool = vi.fn()
    let runBulk: ((action: HomeBulkAction, list: readonly HomeFileItem[]) => void) | null = null
    render(
      <Harness
        fake={fake}
        listKind="folder"
        items={items}
        onOpenPdfTool={onOpenPdfTool}
        expose={(api) => {
          runBulk = api.runBulk
        }}
      />,
    )
    act(() => runBulk?.('merge', [items[1], items[0]]))
    await flush()
    expect(onOpenPdfTool).toHaveBeenCalledTimes(1)
    const start = onOpenPdfTool.mock.calls[0][0] as PdfToolStart
    expect(start.kind).toBe('merge')
    if (start.kind !== 'merge') return
    expect(start.inputs.map((input) => input.name)).toEqual(['b.pdf', 'a.pdf'])
    expect(start.inputs.every((input) => input.mime === 'application/pdf')).toBe(true)
    expect(fake.calls('mobile_home_read_bytes')).toHaveLength(0)
    const bytes = await start.inputs[0].readBytes()
    expect([...bytes]).toEqual([1, 2, 3])
    expect(fake.calls('mobile_home_read_bytes')).toEqual([
      { fileRef: { kind: 'folder', folderId: 'f1', entryId: '2' } },
    ])
  })

  it('builds picture inputs with picture types for [make PDF]', async () => {
    const fake = fakeHost()
    const items = [folderItem('1', 'a.jpg', true), folderItem('2', 'b.PNG', true)]
    const onOpenPdfTool = vi.fn()
    let runBulk: ((action: HomeBulkAction, list: readonly HomeFileItem[]) => void) | null = null
    render(
      <Harness
        fake={fake}
        listKind="folder"
        items={items}
        onOpenPdfTool={onOpenPdfTool}
        expose={(api) => {
          runBulk = api.runBulk
        }}
      />,
    )
    act(() => runBulk?.('imagesToPdf', items))
    await flush()
    const start = onOpenPdfTool.mock.calls[0][0] as PdfToolStart
    expect(start.kind).toBe('imagesToPdf')
    if (start.kind !== 'imagesToPdf') return
    expect(start.inputs.map((input) => input.mime)).toEqual(['image/jpeg', 'image/png'])
    expect(fake.calls('mobile_home_read_bytes')).toHaveLength(0)
  })
})
