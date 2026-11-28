import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderEntry, LinkedFolder } from '@genoffice/mobile-bridge/home'
import type { MobileClient, MobileDocSession } from '@genoffice/mobile-bridge/transport'
import { FoldersTab } from '../src/renderer/home/FoldersTab'
import type { HomeHost } from '../src/renderer/home/homeHost'
import { resetHomeRuntimeForTest } from '../src/renderer/home/homeRuntime'
import {
  providePdfToolsLink,
  type PdfToolFlowProps,
  type PdfToolsLink,
} from '../src/renderer/home/pdfToolsLink'
import { resetHomePrefsForTest, setEditorOn } from '../src/renderer/home/prefsStore'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { BackStackProvider } from '../src/renderer/shell/backStack'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Handler = (args: Record<string, unknown> | undefined) => unknown

interface Fake {
  readonly host: HomeHost
  readonly invoke: ReturnType<typeof vi.fn>
  readonly openSession: ReturnType<typeof vi.fn>
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
  const openSession = vi.fn(async () => {})
  const showToast = vi.fn()
  const refreshHome = vi.fn(async () => {})
  const client = { transport: { invoke, listen: vi.fn() } } as unknown as MobileClient
  const host: HomeHost = {
    client,
    openSession,
    createNew: vi.fn(async () => {}),
    showToast,
    refreshHome,
    openSettings: vi.fn(),
  }
  return {
    host,
    invoke,
    openSession,
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
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

function byTestId(id: string): HTMLElement | null {
  return document.body.querySelector(`[data-testid="${id}"]`)
}

async function click(el: Element | null): Promise<void> {
  if (!el) throw new Error('element missing')
  act(() => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

/** Android's system Back: the web view goes back one history entry. */
async function systemBack(): Promise<void> {
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await flush()
}

const okFolder: LinkedFolder = { id: 'f1', name: '수업 자료', status: 'ok', addedAt: 1 }
const lostFolder: LinkedFolder = {
  id: 'f2',
  name: '옛 자료',
  status: 'lost',
  lostReason: 'missing',
  addedAt: 2,
}

function dir(id: string, name: string): FolderEntry {
  return { id, name, isDir: true, isPicture: false }
}

function doc(id: string, name: string, format: FolderEntry['format']): FolderEntry {
  return { id, name, isDir: false, isPicture: false, format, modifiedAt: 1 }
}

function picture(id: string, name: string): FolderEntry {
  return { id, name, isDir: false, isPicture: true, modifiedAt: 1 }
}

/** Folder contents by path ("" = the linked folder's top). */
const TREE: Record<string, FolderEntry[]> = {
  '': [
    dir('d1', '1학기'),
    doc('e1', '안내문.hwpx', 'hwpx'),
    picture('p1', '칠판.jpg'),
    picture('p2', '활동.png'),
  ],
  '1학기': [dir('d2', '3월'), doc('e2', '계획.md', 'md')],
  '1학기/3월': [doc('e3', '수업.pdf', 'pdf')],
}

function folderHandlers(extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    mobile_home_list_folders: () => [okFolder, lostFolder],
    mobile_home_list_folder: (args) => TREE[((args?.path as string[]) ?? []).join('/')] ?? [],
    ...extra,
  }
}

const session = { sessionId: 's1', format: 'hwpx', name: '안내문.hwpx' } as MobileDocSession

beforeEach(() => {
  // A browser answers history.back() with a popstate; jsdom does it later, so answer at once here
  // to keep each test's back stack in step.
  vi.spyOn(window.history, 'back').mockImplementation(() => {
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  resetHomePrefsForTest()
  resetHomeRuntimeForTest()
  providePdfToolsLink(null as unknown as PdfToolsLink)
})

afterEach(() => {
  act(() => {
    while (roots.length > 0) roots.pop()?.unmount()
  })
  while (containers.length > 0) containers.pop()?.remove()
  vi.restoreAllMocks()
})

async function openFolder(fake: Fake): Promise<void> {
  render(<FoldersTab host={fake.host} />)
  await flush()
  await click(byTestId('home-folders-open-f1'))
}

function pathText(): string {
  return byTestId('home-folders-path')?.textContent ?? ''
}

describe('folders tab', () => {
  it('renders with an empty host as the empty state, without the bridge', () => {
    expect(() => render(<FoldersTab host={{} as HomeHost} />)).not.toThrow()
    expect(byTestId('home-folders-empty')).not.toBeNull()
    expect(byTestId('home-folders-link')).not.toBeNull()
    // pressing [link folder] without a client does nothing and does not throw
    act(() => byTestId('home-folders-link')?.click())
  })

  it('shows the empty state when the backend answers something that is not a list', async () => {
    const fake = fakeHost()
    render(<FoldersTab host={fake.host} />)
    await flush()
    expect(fake.calls('mobile_home_list_folders')).toHaveLength(1)
    expect(byTestId('home-folders-empty')).not.toBeNull()
  })

  it('lists linked folders and shows a lost one with its reason and [link again]', async () => {
    const fake = fakeHost(
      folderHandlers({ mobile_home_link_folder: () => ({ ...lostFolder, status: 'ok' }) }),
    )
    render(<FoldersTab host={fake.host} />)
    await flush()
    expect(byTestId('home-folders-folder-f1')?.textContent).toContain('수업 자료')
    const lostRow = byTestId('home-folders-folder-f2')
    expect(lostRow?.textContent).toContain('옛 자료')
    // the reason is written out, not only colored
    expect(lostRow?.textContent).toContain('폴더를 찾을 수 없습니다')
    expect(byTestId('home-folders-relink-f1')).toBeNull()
    await click(byTestId('home-folders-relink-f2'))
    expect(fake.calls('mobile_home_link_folder')).toEqual([{ replaceId: 'f2' }])
    // the list is read again after the folder was replaced
    expect(fake.calls('mobile_home_list_folders')).toHaveLength(2)
  })

  it('[link folder] asks the picker once and does nothing more when it is cancelled', async () => {
    const fake = fakeHost({
      mobile_home_list_folders: () => [okFolder],
      mobile_home_link_folder: () => {
        throw { code: 'USER_CANCELLED', messageKey: 'mobile.userCancelled' }
      },
    })
    render(<FoldersTab host={fake.host} />)
    await flush()
    await click(byTestId('home-folders-link'))
    expect(fake.calls('mobile_home_link_folder')).toEqual([{}])
    expect(fake.showToast).not.toHaveBeenCalled()
    expect(fake.calls('mobile_home_list_folders')).toHaveLength(1)
  })

  it('removing a folder confirms with the entry count, then unlinks and refreshes the home', async () => {
    const fake = fakeHost(
      folderHandlers({
        mobile_home_count_folder_entries: () => ({ count: 3 }),
        mobile_home_unlink_folder: () => ({ removedEntries: 3 }),
      }),
    )
    render(<FoldersTab host={fake.host} />)
    await flush()
    await click(byTestId('home-folders-more-f1'))
    await click(byTestId('home-folders-menu-remove'))
    expect(fake.calls('mobile_home_count_folder_entries')).toEqual([{ id: 'f1' }])
    const dialog = byTestId('home-folders-remove-confirm')
    expect(dialog?.textContent).toContain('3개 줄도 함께 빠집니다')
    expect(fake.calls('mobile_home_unlink_folder')).toHaveLength(0)
    await click(byTestId('home-folders-remove-confirm-ok'))
    expect(fake.calls('mobile_home_unlink_folder')).toEqual([{ id: 'f1' }])
    expect(fake.refreshHome).toHaveBeenCalled()
    expect(fake.calls('mobile_home_list_folders')).toHaveLength(2)
    expect(byTestId('home-folders-remove-confirm')).toBeNull()
  })

  it('cancelling the remove confirm leaves the folder linked', async () => {
    const fake = fakeHost(
      folderHandlers({ mobile_home_count_folder_entries: () => ({ count: 0 }) }),
    )
    render(<FoldersTab host={fake.host} />)
    await flush()
    await click(byTestId('home-folders-more-f1'))
    await click(byTestId('home-folders-menu-remove'))
    await click(byTestId('home-folders-remove-confirm-cancel'))
    expect(fake.calls('mobile_home_unlink_folder')).toHaveLength(0)
    expect(byTestId('home-folders-remove-confirm')).toBeNull()
  })

  it('enters sub-folders and goes back one level with [‹] and with the system Back', async () => {
    const fake = fakeHost(folderHandlers())
    await openFolder(fake)
    expect(fake.calls('mobile_home_list_folder')).toEqual([{ folderId: 'f1', path: [] }])
    expect(pathText()).toContain('수업 자료')
    // sub-folders come first, then files in the backend's order
    const rows = [...document.body.querySelectorAll('[data-testid^="home-folders-entry-"]')].map(
      (el) => el.getAttribute('data-testid'),
    )
    expect(rows[0]).toBe('home-folders-entry-d1')
    expect(byTestId('home-file-row-folder:f1:e1')).not.toBeNull()
    expect(byTestId('home-file-row-folder:f1:p1')).not.toBeNull()

    await click(byTestId('home-folders-entry-d1'))
    await click(byTestId('home-folders-entry-d2'))
    expect(fake.calls('mobile_home_list_folder').at(-1)).toEqual({
      folderId: 'f1',
      path: ['1학기', '3월'],
    })
    expect(pathText()).toContain('3월')
    expect(byTestId('home-file-row-folder:f1:e3')).not.toBeNull()

    await click(byTestId('home-folders-back'))
    expect(fake.calls('mobile_home_list_folder').at(-1)).toEqual({
      folderId: 'f1',
      path: ['1학기'],
    })
    expect(pathText()).not.toContain('3월')

    await systemBack()
    expect(fake.calls('mobile_home_list_folder').at(-1)).toEqual({ folderId: 'f1', path: [] })
    expect(byTestId('home-folders-browse')).not.toBeNull()

    await systemBack()
    expect(byTestId('home-folders-browse')).toBeNull()
    expect(byTestId('home-folders-folder-f1')).not.toBeNull()
  })

  it('tapping a document opens it through the folder and hands the session to the app', async () => {
    const fake = fakeHost(folderHandlers({ mobile_home_open_folder_entry: () => session }))
    await openFolder(fake)
    await click(byTestId('home-file-row-open-folder:f1:e1'))
    expect(fake.calls('mobile_home_open_folder_entry')).toEqual([{ folderId: 'f1', entryId: 'e1' }])
    expect(fake.openSession).toHaveBeenCalledWith(session)
  })

  it('a format that cannot be opened shows the existing notice', async () => {
    const fake = fakeHost(
      folderHandlers({
        mobile_home_open_folder_entry: () => {
          throw { code: 'INVALID_ARGUMENT', messageKey: 'mobile.format.notOpenable' }
        },
      }),
    )
    await openFolder(fake)
    await click(byTestId('home-file-row-open-folder:f1:e1'))
    expect(fake.openSession).not.toHaveBeenCalled()
    expect(fake.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: '이 파일 형식은 열 수 없습니다.' }),
    )
  })

  it('a folder that lost its permission while opening goes back to the list marked lost', async () => {
    const fake = fakeHost({
      mobile_home_list_folders: () => [okFolder],
      mobile_home_list_folder: () => TREE[''],
      mobile_home_open_folder_entry: () => {
        throw { code: 'PERMISSION_DENIED', messageKey: 'mobile.home.folderLost' }
      },
    })
    await openFolder(fake)
    await click(byTestId('home-file-row-open-folder:f1:e1'))
    expect(fake.openSession).not.toHaveBeenCalled()
    expect(byTestId('home-folders-browse')).toBeNull()
    expect(byTestId('home-folders-relink-f1')).not.toBeNull()
    expect(fake.showToast).toHaveBeenCalled()
  })

  it('tapping a picture starts selection with it picked', async () => {
    const fake = fakeHost(folderHandlers())
    await openFolder(fake)
    await click(byTestId('home-file-row-open-folder:f1:p1'))
    expect(fake.calls('mobile_home_open_folder_entry')).toHaveLength(0)
    expect(byTestId('home-act-selection-header')?.textContent).toContain('1개 선택됨')
    expect(byTestId('home-file-row-folder:f1:p1')?.getAttribute('data-selected')).toBe('true')
    expect(byTestId('home-act-bar-share')).not.toBeNull()
    expect(byTestId('home-act-bar-delete')).not.toBeNull()
    // Back closes the selection first, and stays in the folder
    await systemBack()
    expect(byTestId('home-act-selection-header')).toBeNull()
    expect(byTestId('home-folders-browse')).not.toBeNull()
  })

  it('a picture-only selection offers [make PDF] only with PDF tools on and T3 linked', async () => {
    const fake = fakeHost(folderHandlers())
    await openFolder(fake)
    await click(byTestId('home-file-row-open-folder:f1:p1'))
    await click(byTestId('home-file-row-open-folder:f1:p2'))
    expect(byTestId('home-act-selection-header')?.textContent).toContain('2개 선택됨')
    // no T3 link yet
    expect(byTestId('home-act-bar-imagesToPdf')).toBeNull()

    const starts: PdfToolFlowProps['start'][] = []
    const Flow = ({ start, onClose }: PdfToolFlowProps) => {
      starts.push(start)
      return (
        <button type="button" data-testid="t3-flow-close" onClick={onClose}>
          close
        </button>
      )
    }
    act(() => providePdfToolsLink({ Flow }))
    await act(async () => {
      await setEditorOn('pdfTools', false)
    })
    expect(byTestId('home-act-bar-imagesToPdf')).toBeNull()
    await act(async () => {
      await setEditorOn('pdfTools', true)
    })
    expect(byTestId('home-act-bar-imagesToPdf')).not.toBeNull()
    expect(byTestId('home-act-bar-merge')).toBeNull()

    await click(byTestId('home-act-bar-imagesToPdf'))
    expect(byTestId('home-folders-tool-layer')).not.toBeNull()
    const start = starts.at(-1)
    expect(start?.kind).toBe('imagesToPdf')
    if (start?.kind === 'imagesToPdf') {
      expect(start.inputs.map((input) => input.name)).toEqual(['칠판.jpg', '활동.png'])
    }
    await click(byTestId('t3-flow-close'))
    expect(byTestId('home-folders-tool-layer')).toBeNull()
  })

  it('a document in the selection keeps [make PDF] away', async () => {
    const fake = fakeHost(folderHandlers())
    act(() => providePdfToolsLink({ Flow: () => null }))
    await openFolder(fake)
    await click(byTestId('home-file-row-open-folder:f1:p1'))
    await click(byTestId('home-file-row-open-folder:f1:e1'))
    expect(byTestId('home-act-selection-header')?.textContent).toContain('2개 선택됨')
    expect(byTestId('home-act-bar-imagesToPdf')).toBeNull()
    expect(fake.calls('mobile_home_open_folder_entry')).toHaveLength(0)
  })
})
