import { describe, expect, it, vi } from 'vitest'

const menuMock = vi.hoisted(() => ({
  buildFromTemplate: vi.fn((template: unknown[]) => ({ items: template })),
  getApplicationMenu: vi.fn((): unknown => null),
  setApplicationMenu: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: class {},
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  Menu: menuMock,
  shell: { showItemInFolder: vi.fn() },
}))

import {
  FILE_PANEL_ACCELERATOR,
  FILE_PANEL_DEFAULT_WIDTH,
  FILE_PANEL_MAX_WIDTH,
  FILE_PANEL_MIN_DOCUMENT_PX,
  FILE_PANEL_MIN_WIDTH,
  clampFilePanelWidth,
  filePanelInset,
  readFilePanelChoice,
} from '../src/shared/file-panel-api'
import {
  HWP_CHORD_STARTERS,
  filePanelKeyAction,
  installFilePanel,
  isDocumentFolder,
  withFilePanelMenuItem,
  type PanelKeyInput,
} from '../src/main/file-panel'
import { CHORDS } from '../../hwp/studio-plugin/hancom-keys.mjs'
import {
  baseName,
  isAtOrUnder,
  mergeFileMatches,
  nameMatches,
  parentDir,
  samePath,
  treeOrder,
} from '../src/renderer/src/file-panel/file-panel-model'
import type { RecentEntry } from '../src/shared/home-api'

function entry(path: string, extra: Partial<RecentEntry> = {}): RecentEntry {
  const name = baseName(path)
  return {
    path,
    name,
    ext: name.slice(name.lastIndexOf('.') + 1),
    mtimeMs: 0,
    sizeBytes: 1,
    starred: false,
    ...extra,
  }
}

describe('files panel width', () => {
  it('clamps the stored width into the drag limits', () => {
    expect(clampFilePanelWidth(10)).toBe(FILE_PANEL_MIN_WIDTH)
    expect(clampFilePanelWidth(9999)).toBe(FILE_PANEL_MAX_WIDTH)
    expect(clampFilePanelWidth(300.4)).toBe(300)
    expect(clampFilePanelWidth(Number.NaN)).toBe(FILE_PANEL_DEFAULT_WIDTH)
    expect(clampFilePanelWidth('wide')).toBe(FILE_PANEL_DEFAULT_WIDTH)
  })

  it('reads a damaged settings value as a closed panel at the default width', () => {
    expect(readFilePanelChoice(undefined)).toEqual({ open: false, width: FILE_PANEL_DEFAULT_WIDTH })
    expect(readFilePanelChoice([true])).toEqual({ open: false, width: FILE_PANEL_DEFAULT_WIDTH })
    expect(readFilePanelChoice({ open: 'yes', width: 9999 })).toEqual({
      open: false,
      width: FILE_PANEL_MAX_WIDTH,
    })
    expect(readFilePanelChoice({ open: true, width: 320 })).toEqual({ open: true, width: 320 })
  })

  it('takes nothing while closed and scales with the interface', () => {
    expect(filePanelInset({ open: false, width: 300, scale: 1 }, 1600)).toBe(0)
    expect(filePanelInset({ open: true, width: 300, scale: 1 }, 1600)).toBe(300)
    expect(filePanelInset({ open: true, width: 300, scale: 1.25 }, 1600)).toBe(375)
    expect(filePanelInset({ open: true, width: 300, scale: 0 }, 1600)).toBe(300)
  })

  it('leaves the document its minimum in a narrow window', () => {
    expect(filePanelInset({ open: true, width: 300, scale: 1 }, 500)).toBe(
      500 - FILE_PANEL_MIN_DOCUMENT_PX,
    )
    expect(filePanelInset({ open: true, width: 300, scale: 1 }, 200)).toBe(0)
  })
})

describe('document folders the panel may list', () => {
  const open = ['/home/me/work/report.docx']

  it('allows the folder of an open document and folders below it', () => {
    expect(isDocumentFolder('/home/me/work', open)).toBe(true)
    expect(isDocumentFolder('/home/me/work/drafts', open)).toBe(true)
  })

  it('refuses folders above or beside it', () => {
    expect(isDocumentFolder('/home/me', open)).toBe(false)
    expect(isDocumentFolder('/home/me/other', open)).toBe(false)
    expect(isDocumentFolder('/home/me/work-old', open)).toBe(false)
    expect(isDocumentFolder('/home/me/work', [])).toBe(false)
  })
})

describe('files panel model', () => {
  it('splits paths on either separator and keeps a drive or root', () => {
    expect(parentDir('C:\\docs\\a.docx')).toBe('C:\\docs')
    expect(parentDir('C:\\a.docx')).toBe('C:\\')
    expect(parentDir('/a.md')).toBe('/')
    expect(parentDir('/x/y/a.md')).toBe('/x/y')
    expect(parentDir('a.md')).toBeNull()
    expect(baseName('C:\\docs\\a.docx')).toBe('a.docx')
    expect(baseName('/x/y/')).toBe('y')
  })

  it('compares Windows paths without case and POSIX paths exactly', () => {
    expect(samePath('C:\\Docs\\A.docx', 'c:\\docs\\a.docx')).toBe(true)
    expect(samePath('/a/B.md', '/a/b.md')).toBe(false)
    expect(isAtOrUnder('C:\\Docs', 'c:\\docs\\sub\\a.hwp')).toBe(true)
    expect(isAtOrUnder('C:\\Docs', 'C:\\Docs2\\a.hwp')).toBe(false)
    expect(isAtOrUnder('/a', '/a')).toBe(true)
    expect(isAtOrUnder('/a', '/ab/c')).toBe(false)
  })

  it('orders a listing folders first, each by name with numbers in order', () => {
    const ordered = treeOrder({
      dir: '/d',
      folders: [
        { path: '/d/b', name: 'b', mtimeMs: 0, hasSubfolders: false },
        { path: '/d/A', name: 'A', mtimeMs: 0, hasSubfolders: false },
      ],
      files: [entry('/d/item10.md'), entry('/d/item2.md')],
    })
    expect(ordered.folders.map((f) => f.name)).toEqual(['A', 'b'])
    expect(ordered.files.map((f) => f.name)).toEqual(['item2.md', 'item10.md'])
  })

  it('matches every word of the query, ignoring case and accents', () => {
    expect(nameMatches('Rapport Équipe 2026.docx', 'equipe rap')).toBe(true)
    expect(nameMatches('Report.docx', 'budget')).toBe(false)
  })

  it('puts local name matches first and lists each file once', () => {
    const sibling = entry('C:\\w\\plan.hwp')
    const recent = entry('C:\\r\\plan-old.hwp')
    const indexed = [entry('c:\\w\\PLAN.hwp'), entry('C:\\x\\notes.md')]
    const merged = mergeFileMatches(
      'plan',
      [[sibling, entry('C:\\w\\other.md')], [recent]],
      indexed,
    )
    expect(merged.map((e) => e.path)).toEqual([
      'C:\\w\\plan.hwp',
      'C:\\r\\plan-old.hwp',
      // the index matched on content, so its hit stays even without the word in its name
      'C:\\x\\notes.md',
    ])
  })

  it('drops files that no longer exist', () => {
    const merged = mergeFileMatches('a', [[entry('/a.md', { missing: true })]], [])
    expect(merged).toEqual([])
  })
})

describe('files panel menu item', () => {
  function installWithViewMenu() {
    const insert = vi.fn()
    menuMock.getApplicationMenu.mockReturnValue({
      items: [{ label: 'View', submenu: { insert } }],
      getMenuItemById: () => null,
    })
    installFilePanel({
      settingsPath: () => 'settings.json',
      readSetting: () => ({ open: true, width: 300 }),
      writeSetting: vi.fn(),
      shellWindow: () => null,
      applyLayout: vi.fn(),
      uiScale: () => 1,
      lang: () => 'ko',
      viewMenuLabel: () => 'View',
      openFilePaths: () => [],
      listFolder: () => ({ dir: '', folders: [], files: [] }),
      isRevealable: () => false,
    })
    return insert
  }

  it('puts a checked toggle with the keyboard shortcut first in the View menu', () => {
    const insert = installWithViewMenu()
    withFilePanelMenuItem('docs')
    const template = menuMock.buildFromTemplate.mock.calls.at(-1)![0] as Array<
      Record<string, unknown>
    >
    expect(template[0]).toMatchObject({
      type: 'checkbox',
      checked: true,
      accelerator: FILE_PANEL_ACCELERATOR,
      // the key is taken in before-input-event; the menu only shows it
      registerAccelerator: false,
    })
    expect(insert).toHaveBeenCalledWith(0, template[0])
    expect(menuMock.setApplicationMenu).toHaveBeenCalled()
  })

  it('leaves the Home menu alone', () => {
    installWithViewMenu()
    menuMock.buildFromTemplate.mockClear()
    withFilePanelMenuItem('home')
    expect(menuMock.buildFromTemplate).not.toHaveBeenCalled()
  })
})

describe('files panel key', () => {
  let nextId = 1000
  const key = (letter: string, mods: Partial<PanelKeyInput> = {}): PanelKeyInput => ({
    type: 'keyDown',
    key: letter,
    code: /^[a-z]$/i.test(letter) ? `Key${letter.toUpperCase()}` : letter,
    control: false,
    meta: false,
    shift: false,
    alt: false,
    ...mods,
  })
  const ctrlShiftE = key('E', { control: true, shift: true })

  it('toggles on Ctrl+Shift+E and leaves every other key to the page', () => {
    const id = nextId++
    expect(filePanelKeyAction(id, ctrlShiftE, false, 'win32')).toBe('toggle')
    expect(filePanelKeyAction(id, key('e', { control: true }), false, 'win32')).toBe('pass')
    expect(filePanelKeyAction(id, key('E', { shift: true }), false, 'win32')).toBe('pass')
    expect(
      filePanelKeyAction(id, key('E', { control: true, shift: true, alt: true }), false, 'win32'),
    ).toBe('pass')
    expect(filePanelKeyAction(id, { ...ctrlShiftE, type: 'keyUp' }, false, 'win32')).toBe('pass')
  })

  it('reads the physical key, so a Korean IME does not hide it', () => {
    const hangul = { ...ctrlShiftE, key: 'ㄷ', code: 'KeyE' }
    expect(filePanelKeyAction(nextId++, hangul, false, 'win32')).toBe('toggle')
  })

  it('uses Cmd on macOS and swallows a held-down repeat', () => {
    const id = nextId++
    const cmd = key('E', { meta: true, shift: true })
    expect(filePanelKeyAction(id, cmd, false, 'darwin')).toBe('toggle')
    expect(filePanelKeyAction(id, ctrlShiftE, false, 'darwin')).toBe('pass')
    expect(filePanelKeyAction(id, { ...cmd, isAutoRepeat: true }, false, 'darwin')).toBe('swallow')
  })

  it('leaves the second key of an HWP sequence to the editor', () => {
    const id = nextId++
    // Ctrl+N, then Shift+E with Ctrl still held: Hangul's endnote
    expect(filePanelKeyAction(id, key('n', { control: true }), true, 'win32')).toBe('pass')
    expect(
      filePanelKeyAction(
        id,
        key('Shift', { code: 'ShiftLeft', control: true, shift: true }),
        true,
        'win32',
      ),
    ).toBe('pass')
    expect(filePanelKeyAction(id, ctrlShiftE, true, 'win32')).toBe('pass')
    // the sequence is over: the next press toggles
    expect(filePanelKeyAction(id, ctrlShiftE, true, 'win32')).toBe('toggle')
  })

  it('does not wait for a sequence outside the HWP tab', () => {
    const id = nextId++
    expect(filePanelKeyAction(id, key('n', { control: true }), false, 'win32')).toBe('pass')
    expect(filePanelKeyAction(id, ctrlShiftE, false, 'win32')).toBe('toggle')
  })

  it('knows every first letter the HWP sequences use', () => {
    expect([...HWP_CHORD_STARTERS].sort()).toEqual(Object.keys(CHORDS).sort())
  })
})
