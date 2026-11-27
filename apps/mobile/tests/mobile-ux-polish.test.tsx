import fs from 'node:fs'
import path from 'node:path'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import type { FavoriteEntry, FolderEntry, LinkedFolder } from '@genoffice/mobile-bridge/home'
import type {
  MobileAppPrefs,
  MobileClient,
  RecentDocEntry,
} from '@genoffice/mobile-bridge/transport'
import { HomeScreen } from '../src/renderer/components/HomeScreen'
import { buildFlowDocument, FLOW_FRAME_CSS } from '../src/renderer/editors/hwpFlow'
import { DEFAULT_READER_SETTINGS, scrollCss } from '../src/renderer/editors/readers/epub/epubView'
import {
  resetHomeFrameForTest,
  sortFavoriteEntries,
  sortFolderEntries,
  sortRecentEntries,
} from '../src/renderer/home/frame/frameModel'
import { resetHomeRuntimeForTest } from '../src/renderer/home/homeRuntime'
import type { HomeHost } from '../src/renderer/home/homeHost'
import { resetHomePrefsForTest } from '../src/renderer/home/prefsStore'
import { MobileLocaleProvider, translateMobile } from '../src/renderer/i18n'
import { BackStackProvider } from '../src/renderer/shell/backStack'
import { EditorShell, type EditorShellProps } from '../src/renderer/shell/EditorShell'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function render(ui: ReactNode) {
  act(() => {
    root.render(
      <MobileLocaleProvider lang="ko">
        <BackStackProvider>{ui}</BackStackProvider>
      </MobileLocaleProvider>,
    )
  })
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
  })
}

function byTestId(id: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${id}"]`)
}

function click(el: Element | null) {
  expect(el).not.toBeNull()
  act(() => {
    ;(el as HTMLElement).click()
  })
}

function makeRecent(id: string, name: string, openedAt: number): RecentDocEntry {
  return {
    id,
    docKey: `doc:${id}`,
    name,
    format: id.endsWith('md') ? 'md' : 'hwpx',
    openedAt,
  }
}

function makeFakeHost(overrides?: {
  folders?: LinkedFolder[]
  folderEntries?: Record<string, FolderEntry[]>
}): { host: HomeHost; linkFolderMock: ReturnType<typeof vi.fn> } {
  const stored: MobileAppPrefs = {
    lang: 'ko',
    theme: 'system',
    hwpDefaultFormat: 'hwpx',
    aiEnabled: false,
  }
  const linkFolderMock = vi.fn(async () => ({
    id: 'f-new',
    name: 'NewFolder',
    status: 'ok' as const,
    addedAt: 2,
  }))
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'mobile_home_list_favorites') return []
    if (command === 'mobile_home_list_groups') return []
    if (command === 'mobile_home_list_folders') return overrides?.folders ?? []
    if (command === 'mobile_home_list_folder') {
      const folderId = String(args?.folderId ?? '')
      return overrides?.folderEntries?.[folderId] ?? []
    }
    if (command === 'mobile_home_link_folder') return await linkFolderMock()
    return { ok: true }
  })
  const client = {
    transport: { invoke, listen: vi.fn() },
    getAppPrefs: vi.fn(async () => stored),
    setAppPrefs: vi.fn(async (patch: Partial<MobileAppPrefs>) => ({ ...stored, ...patch })),
    removeRecentDoc: vi.fn(async () => ({ ok: true })),
  } as unknown as MobileClient
  const host: HomeHost = {
    client,
    openSession: vi.fn(async () => {}),
    createNew: vi.fn(async () => {}),
    showToast: vi.fn(),
    refreshHome: vi.fn(async () => {}),
    openSettings: vi.fn(),
  }
  return { host, linkFolderMock }
}

function shellProps(overrides: Partial<EditorShellProps> = {}): EditorShellProps {
  return {
    docTitle: '보고서.hwpx',
    docFormat: 'hwpx',
    saveState: 'saved',
    mode: 'edit',
    canEdit: true,
    aiEnabled: false,
    quickActions: [
      { id: 'undo', label: '되돌리기', onPress: vi.fn() },
      { id: 'bold', label: '굵게', onPress: vi.fn() },
    ],
    aiPanelContent: <div>AI</div>,
    onBack: vi.fn(),
    onEnterEdit: vi.fn(),
    onDone: vi.fn(),
    onExitEdit: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onShare: vi.fn(),
    onFitToWidth: vi.fn(),
    onOpenBackups: vi.fn(),
    children: <textarea data-testid="stage-textarea" defaultValue="hello" />,
    ...overrides,
  }
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true, writable: true })
  vi.spyOn(window.history, 'back').mockImplementation(() => {
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  resetHomeFrameForTest()
  resetHomeRuntimeForTest()
  resetHomePrefsForTest()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.restoreAllMocks()
  resetHomeFrameForTest()
  resetHomeRuntimeForTest()
  resetHomePrefsForTest()
})

describe('Proposal 1: Enhanced [+] create sheet', () => {
  it('shows secondary actions including Add folder and shows folder location inside FolderBrowser', async () => {
    const { host, linkFolderMock } = makeFakeHost({
      folders: [{ id: 'f1', name: '업무 문서', status: 'ok', addedAt: 1 }],
      folderEntries: {
        f1: [
          {
            id: 'e1',
            name: '계획안.hwpx',
            isDir: false,
            isPicture: false,
            format: 'hwpx',
            modifiedAt: 200,
          },
          {
            id: 'e2',
            name: '가이드.md',
            isDir: false,
            isPicture: false,
            format: 'md',
            modifiedAt: 100,
          },
        ],
      },
    })
    render(
      <HomeScreen
        recentDocs={[makeRecent('1', '회의록.hwpx', 1000)]}
        recoveryEntries={[]}
        permissionDeniedRecentId={null}
        defaultHwpFormat="hwpx"
        onCreateNew={vi.fn()}
        onOpenFile={vi.fn()}
        onOpenRecent={vi.fn()}
        onRemoveRecent={vi.fn()}
        onRestoreRecovery={vi.fn()}
        onDiscardRecovery={vi.fn()}
        onOpenSettings={vi.fn()}
        host={host}
      />,
    )
    await flush()

    // On Recent tab: no location banner, Add folder button works
    click(byTestId('home-fab'))
    expect(byTestId('home-create-sheet')).not.toBeNull()
    expect(byTestId('home-create-location')).toBeNull()
    expect(byTestId('home-create-open-file')).not.toBeNull()
    expect(byTestId('home-create-add-folder')).not.toBeNull()

    click(byTestId('home-create-add-folder'))
    await flush()
    expect(linkFolderMock).toHaveBeenCalledTimes(1)
    expect(byTestId('home-create-sheet')).toBeNull()

    // Switch to Folders tab, open a folder, then tap [+] -> shows current folder context
    click(byTestId('home-tab-folders'))
    await flush()
    click(byTestId('home-folders-open-f1'))
    await flush()
    click(byTestId('home-fab'))
    expect(byTestId('home-create-location')?.textContent).toContain('업무 문서')
  })
})

describe('Proposal 2: Home list sort & card-grid view toolbar', () => {
  it('sorts recent, favorites, and folder entries accurately', () => {
    const recents = [
      makeRecent('1', '다.hwpx', 100),
      makeRecent('2', '가.hwpx', 300),
      makeRecent('3', '나.hwpx', 200),
    ]
    expect(sortRecentEntries(recents, 'date', 'desc').map((r) => r.name)).toEqual([
      '가.hwpx',
      '나.hwpx',
      '다.hwpx',
    ])
    expect(sortRecentEntries(recents, 'name', 'asc').map((r) => r.name)).toEqual([
      '가.hwpx',
      '나.hwpx',
      '다.hwpx',
    ])
    expect(sortRecentEntries(recents, 'name', 'desc').map((r) => r.name)).toEqual([
      '다.hwpx',
      '나.hwpx',
      '가.hwpx',
    ])

    const favs: FavoriteEntry[] = [
      { docKey: 'a', name: 'B.hwpx', format: 'hwpx', addedAt: 10, groupId: null },
      { docKey: 'b', name: 'A.hwpx', format: 'hwpx', addedAt: 20, groupId: null },
    ]
    expect(sortFavoriteEntries(favs, 'name', 'asc').map((f) => f.name)).toEqual([
      'A.hwpx',
      'B.hwpx',
    ])

    const files: FolderEntry[] = [
      { id: '1', name: 'z.hwpx', isDir: false, isPicture: false, format: 'hwpx', modifiedAt: 500 },
      { id: '2', name: 'a.hwpx', isDir: false, isPicture: false, format: 'hwpx', modifiedAt: 100 },
    ]
    expect(sortFolderEntries(files, 'date', 'desc').map((f) => f.name)).toEqual([
      'z.hwpx',
      'a.hwpx',
    ])
    expect(sortFolderEntries(files, 'name', 'asc').map((f) => f.name)).toEqual(['a.hwpx', 'z.hwpx'])
  })

  it('reorders rendered rows, opens the exact sorted item, and toggles list/card view', async () => {
    const onOpenRecent = vi.fn()
    const recentDocs = [
      makeRecent('1', '차트.hwpx', 300),
      makeRecent('2', '가이드.hwpx', 100),
      makeRecent('3', '메모.hwpx', 200),
    ]
    render(
      <HomeScreen
        recentDocs={recentDocs}
        recoveryEntries={[]}
        permissionDeniedRecentId={null}
        defaultHwpFormat="hwpx"
        onCreateNew={vi.fn()}
        onOpenFile={vi.fn()}
        onOpenRecent={onOpenRecent}
        onRemoveRecent={vi.fn()}
        onRestoreRecovery={vi.fn()}
        onDiscardRecovery={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    )
    await flush()

    const namesInDom = () =>
      [...container.querySelectorAll('.mobile-doc-list .mobile-list-name')].map(
        (n) => n.textContent,
      )

    // Default: date desc -> 차트 (300), 메모 (200), 가이드 (100)
    expect(namesInDom()).toEqual(['차트.hwpx', '메모.hwpx', '가이드.hwpx'])
    expect(byTestId('home-recent-list')?.getAttribute('data-view')).toBe('list')

    // Switch to Name (asc) -> 가이드, 메모, 차트
    click(byTestId('home-sort-field-btn'))
    expect(namesInDom()).toEqual(['가이드.hwpx', '메모.hwpx', '차트.hwpx'])

    // Clicking the first sorted row opens '가이드.hwpx' (id '2'), not the original index 0
    const firstOpenBtn = container.querySelector('.mobile-doc-list .home-act-row-btn')
    click(firstOpenBtn)
    expect(onOpenRecent).toHaveBeenCalledWith(
      expect.objectContaining({ id: '2', name: '가이드.hwpx' }),
    )

    // Reverse sort direction -> 차트, 메모, 가이드
    click(byTestId('home-sort-dir-btn'))
    expect(namesInDom()).toEqual(['차트.hwpx', '메모.hwpx', '가이드.hwpx'])

    // Toggle card grid view
    click(byTestId('home-view-mode-btn'))
    expect(byTestId('home-recent-list')?.getAttribute('data-view')).toBe('grid')
    expect(byTestId('home-view-mode-btn')?.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('Proposal 3: Editor [+] insert separation and keyboard lock', () => {
  it('separates insert group into [+] sheet while keeping [Aa] for text/paragraph formats', () => {
    const onInsertTable = vi.fn()
    const onBold = vi.fn()
    render(
      <EditorShell
        {...shellProps({
          formatGroups: [
            {
              id: 'text',
              title: '글자',
              items: [{ id: 'bold', label: '굵게', onPress: onBold }],
            },
            {
              id: 'insert',
              title: '넣기',
              items: [{ id: 'insertTable', label: '표 넣기', onPress: onInsertTable }],
            },
          ],
        })}
      />,
    )

    // Both [+] and [Aa] buttons exist
    expect(byTestId('insert-panel-btn')).not.toBeNull()
    expect(byTestId('format-panel-btn')).not.toBeNull()

    // Open [Aa] -> shows text group, does NOT contain insert group
    click(byTestId('format-panel-btn'))
    expect(byTestId('editor-format-sheet')).not.toBeNull()
    expect(byTestId('editor-insert-sheet')).toBeNull()
    expect(byTestId('editor-format-sheet')?.textContent).toContain('굵게')
    expect(byTestId('editor-format-sheet')?.textContent).not.toContain('표 넣기')

    // Open [+] -> closes [Aa], opens insert sheet, clicking item runs action & closes sheet
    click(byTestId('insert-panel-btn'))
    expect(byTestId('editor-format-sheet')).toBeNull()
    expect(byTestId('editor-insert-sheet')).not.toBeNull()
    click(byTestId('editor-insert-insertTable'))
    expect(onInsertTable).toHaveBeenCalledTimes(1)
    expect(byTestId('editor-insert-sheet')).toBeNull()
  })

  it('locks and unlocks soft keyboard activation on stage editables', () => {
    render(<EditorShell {...shellProps()} />)
    const textarea = byTestId('stage-textarea') as HTMLTextAreaElement
    expect(textarea.getAttribute('inputmode')).toBeNull()

    click(byTestId('keyboard-lock-btn'))
    expect(byTestId('keyboard-lock-btn')?.getAttribute('aria-pressed')).toBe('true')
    expect(
      container.querySelector('.mobile-editor-stage')?.getAttribute('data-keyboard-locked'),
    ).toBe('true')
    expect(textarea.getAttribute('inputmode')).toBe('none')

    // Focusing an editable inside the locked stage blurs it immediately
    act(() => {
      textarea.focus()
    })
    expect(document.activeElement).not.toBe(textarea)

    // Unlocking restores inputmode
    click(byTestId('keyboard-lock-btn'))
    expect(byTestId('keyboard-lock-btn')?.getAttribute('aria-pressed')).toBe('false')
    expect(textarea.getAttribute('inputmode')).toBeNull()
  })

  it('hides keyboard lock toggle in view mode and on read-only documents', () => {
    render(<EditorShell {...shellProps({ mode: 'view', canEdit: true })} />)
    expect(byTestId('keyboard-lock-btn')).toBeNull()

    render(<EditorShell {...shellProps({ mode: 'edit', canEdit: false })} />)
    expect(byTestId('keyboard-lock-btn')).toBeNull()
  })
})

describe('Proposal 4: [⋯] More sheet sections and inline paired actions', () => {
  it('separates Document tools and File actions with a divider and renders inline pairs', () => {
    const onFlow = vi.fn()
    const onPage = vi.fn()
    render(
      <EditorShell
        {...shellProps({
          moreItems: [
            { id: 'docCheck', label: '문서 점검', onPress: vi.fn() },
            { id: 'webExportDocx', label: 'Word로 내보내기', section: 'file', onPress: vi.fn() },
          ],
          morePairs: [
            {
              id: 'hwpView',
              label: '화면 보기',
              section: 'document',
              actions: [
                { id: 'flowView', label: '읽기 화면', active: true, onPress: onFlow },
                { id: 'pageView', label: '쪽 화면', active: false, onPress: onPage },
              ],
            },
          ],
        })}
      />,
    )

    click(byTestId('editor-more-btn'))
    const docSection = byTestId('more-section-document')
    const fileSection = byTestId('more-section-file')
    expect(docSection).not.toBeNull()
    expect(fileSection).not.toBeNull()
    expect(document.querySelector('.mobile-menu-divider')).not.toBeNull()

    // Document section holds paired view buttons, docCheck, and fitToWidth
    expect(
      docSection
        ?.querySelector('[data-testid="more-pair-hwpView-flowView"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true')
    expect(docSection?.querySelector('[data-testid="editor-more-docCheck"]')).not.toBeNull()
    expect(docSection?.querySelector('[data-testid="editor-fit-width-btn"]')).not.toBeNull()

    // File section holds Save As, Share, file-section export, and Backups
    expect(fileSection?.querySelector('[data-testid="editor-save-as-btn"]')).not.toBeNull()
    expect(fileSection?.querySelector('[data-testid="editor-sheet-share-btn"]')).not.toBeNull()
    expect(fileSection?.querySelector('[data-testid="editor-more-webExportDocx"]')).not.toBeNull()
    expect(fileSection?.querySelector('[data-testid="editor-backups-btn"]')).not.toBeNull()

    // Clicking paired action triggers callback and closes sheet
    click(byTestId('more-pair-hwpView-pageView'))
    expect(onPage).toHaveBeenCalledTimes(1)
    expect(byTestId('editor-more-sheet')).toBeNull()
  })
})

describe('22-language i18n completeness for new UX keys', () => {
  const newKeys = [
    'homeCreateLocation',
    'homeCreateAddFolder',
    'homeListSortLabel',
    'homeListSortDate',
    'homeListSortName',
    'homeListSortDesc',
    'homeListSortAsc',
    'homeListViewList',
    'homeListViewGrid',
    'insertPanel',
    'keyboardLock',
    'keyboardUnlock',
    'moreSectionDocument',
    'moreSectionFile',
    'viewModeLabel',
  ] as const

  it('provides non-empty translations in all 22 languages', () => {
    expect(LANGS).toHaveLength(22)
    for (const lang of LANGS) {
      for (const key of newKeys) {
        const value = translateMobile(lang, key, { name: 'Docs' })
        expect(value, `${lang}.${key}`).toBeTruthy()
      }
    }
  })
})

describe('Store-prep layout fixes: create sheet height & tablet reading measure', () => {
  it('lets the create sheet hug content up to safe viewport max-height with single-row responsive actions', () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, '../src/renderer/home/frame/homeFrame.css'),
      'utf8',
    )
    expect(css).toContain(
      ".mobile-sheet-layer[data-testid='home-create-sheet'] .mobile-sheet-surface[data-detent='medium']",
    )
    expect(css).toContain('height: auto;')
    expect(css).toContain(
      'max-height: calc(100dvh - var(--m-safe-top) - var(--m-kb) - var(--m-space-6));',
    )
    expect(css).toContain(
      'grid-template-columns: repeat(auto-fit, minmax(min(100%, 6.5rem), 1fr));',
    )

    const tokensCss = fs.readFileSync(
      path.resolve(__dirname, '../src/renderer/styles/mobile-tokens.css'),
      'utf8',
    )
    expect(tokensCss).toContain('--m-measure: 40rem;')
    expect(tokensCss).toContain(
      'max-width: min(100%, calc(var(--m-measure) + 2 * var(--m-space-5)));',
    )
  })

  it('constrains HWP reading view and EPUB scroll reading measure to 40rem centered at >= 840px', () => {
    expect(FLOW_FRAME_CSS).toContain('@media (min-width: 840px)')
    expect(FLOW_FRAME_CSS).toContain('max-width: min(100%, calc(40rem / var(--flow-zoom, 1.2)));')
    expect(FLOW_FRAME_CSS).toContain('margin-inline: auto;')
    expect(buildFlowDocument('<p>본문</p>', 1.2, 'ko')).toContain('@media (min-width: 840px)')

    const epubScroll = scrollCss(DEFAULT_READER_SETTINGS, 'light', {
      paper: '#ffffff',
      ink: '#1b1b1b',
      nightPaper: '#1c1c1e',
      nightInk: '#d9d7d2',
      nightLink: '#8ab4f8',
      sepiaPaper: '#f5ecd7',
      sepiaInk: '#4a3b2a',
      hitBg: '#ffe066',
      hitInk: '#000000',
      aiChangedBg: '#d0ebff',
      aiChangedLine: '#1971c2',
    })
    expect(epubScroll).toContain('@media (min-width: 840px)')
    expect(epubScroll).toContain('max-width: min(100%, 40rem); margin-inline: auto;')
  })
})
