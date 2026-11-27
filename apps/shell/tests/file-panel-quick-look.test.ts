import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'

const ipcState = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => unknown>(),
  lastMenuTemplate: [] as Array<Record<string, unknown>>,
}))

vi.mock('electron', () => ({
  BrowserWindow: class {
    static getFocusedWindow = vi.fn(() => null)
  },
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      ipcState.handlers.set(channel, fn)
    }),
    on: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      ipcState.listeners.set(channel, fn)
    }),
  },
  Menu: {
    buildFromTemplate: vi.fn((template: Array<Record<string, unknown>>) => {
      ipcState.lastMenuTemplate = template
      return {
        items: template,
        popup: vi.fn((opts?: { callback?: () => void }) => opts?.callback?.()),
      }
    }),
    getApplicationMenu: vi.fn(() => null),
    setApplicationMenu: vi.fn(),
  },
  Tray: class {},
  screen: {
    getDisplayMatching: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    })),
  },
  shell: {
    showItemInFolder: vi.fn(),
    openExternal: vi.fn(),
  },
}))

import { FILE_PANEL_CHANNELS } from '../src/shared/file-panel-api'
import {
  installFilePanel,
  isPanelAllowedPath,
  registerFilePanelIpc,
  setFilePanelOpen,
} from '../src/main/file-panel'
import { filePanelMenuText } from '../src/main/file-panel-strings'
import {
  QUICK_LOOK_CARD_PADDING,
  QUICK_LOOK_DEFAULT_HEIGHT,
  QUICK_LOOK_DEFAULT_WIDTH,
  QUICK_LOOK_PANEL_GAP,
  computeFilePanelQuickLookBounds,
} from '../src/main/quick-look/quick-look-window'
import { filePreviewNav, stepPreviewPath } from '../src/renderer/src/file-panel/file-panel-model'
import { filePanelText } from '../src/renderer/src/i18n/strings-file-panel'

describe('file panel Quick Look path permissions', () => {
  const open = ['/work/project/report.docx']
  const insideRoot = (p: string) => p.startsWith('/roots/docs/')
  const revealable = (p: string) => p === '/recent/memo.hwp'

  it('allows files in roots, revealable files, and files in or below an open document folder', () => {
    expect(isPanelAllowedPath('/roots/docs/spec.md', insideRoot, revealable, open)).toBe(true)
    expect(isPanelAllowedPath('/recent/memo.hwp', insideRoot, revealable, open)).toBe(true)
    expect(isPanelAllowedPath('/work/project/sibling.xlsx', insideRoot, revealable, open)).toBe(
      true,
    )
    expect(isPanelAllowedPath('/work/project/sub/draft.md', insideRoot, revealable, open)).toBe(
      true,
    )
  })

  it('rejects paths outside roots, recents, and open document folders', () => {
    expect(isPanelAllowedPath('/work/other.md', insideRoot, revealable, open)).toBe(false)
    expect(isPanelAllowedPath('/work/project-old/a.md', insideRoot, revealable, open)).toBe(false)
    expect(isPanelAllowedPath('/etc/passwd', insideRoot, revealable, open)).toBe(false)
    expect(isPanelAllowedPath('/work/project/sibling.xlsx', insideRoot, revealable, [])).toBe(false)
  })
})

describe('file panel Quick Look navigation model', () => {
  const list = ['C:\\docs\\alpha.md', 'C:\\docs\\beta.docx', 'C:\\docs\\gamma.pdf']

  it('computes position and prev/next flags with case-insensitive Windows path matching', () => {
    expect(filePreviewNav(list, 'c:\\docs\\alpha.md')).toEqual({
      index: 0,
      total: 3,
      canPrev: false,
      canNext: true,
    })
    expect(filePreviewNav(list, 'C:\\docs\\beta.docx')).toEqual({
      index: 1,
      total: 3,
      canPrev: true,
      canNext: true,
    })
    expect(filePreviewNav(list, 'C:\\docs\\gamma.pdf')).toEqual({
      index: 2,
      total: 3,
      canPrev: true,
      canNext: false,
    })
    expect(filePreviewNav(list, 'C:\\docs\\missing.md')).toEqual({
      index: -1,
      total: 3,
      canPrev: false,
      canNext: false,
    })
  })

  it('steps up and down within bounds and stops at list ends', () => {
    expect(stepPreviewPath(list, 'C:\\docs\\alpha.md', -1)).toBeNull()
    expect(stepPreviewPath(list, 'C:\\docs\\alpha.md', 1)).toEqual({
      path: 'C:\\docs\\beta.docx',
      index: 1,
      total: 3,
      canPrev: true,
      canNext: true,
      direction: 'down',
    })
    expect(stepPreviewPath(list, 'C:\\docs\\gamma.pdf', -1)).toEqual({
      path: 'C:\\docs\\beta.docx',
      index: 1,
      total: 3,
      canPrev: true,
      canNext: true,
      direction: 'up',
    })
    expect(stepPreviewPath(list, 'C:\\docs\\gamma.pdf', 1)).toBeNull()
  })
})

describe('file panel Quick Look window placement', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 }

  it('places the card 12px right of the panel edge and vertically centered over the document', () => {
    const shell = { x: 100, y: 50, width: 1400, height: 860 }
    const panelInset = 264
    const topInset = 40
    const bounds = computeFilePanelQuickLookBounds(shell, panelInset, topInset, workArea)

    expect(bounds.width).toBe(QUICK_LOOK_DEFAULT_WIDTH)
    expect(bounds.height).toBe(QUICK_LOOK_DEFAULT_HEIGHT)
    expect(bounds.x).toBe(shell.x + panelInset + QUICK_LOOK_PANEL_GAP - QUICK_LOOK_CARD_PADDING)
    const docY = shell.y + topInset
    const docH = shell.height - topInset
    expect(bounds.y).toBe(Math.round(docY + (docH - bounds.height) / 2))
  })

  it('shrinks to fit a narrower document area and clamps inside the display workArea', () => {
    const shell = { x: 1300, y: 400, width: 920, height: 600 }
    const bounds = computeFilePanelQuickLookBounds(shell, 260, 40, workArea)

    expect(bounds.width).toBe(920 - 260 - QUICK_LOOK_CARD_PADDING)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(workArea.x + workArea.width)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(workArea.y + workArea.height)
    expect(bounds.x).toBeGreaterThanOrEqual(workArea.x)
    expect(bounds.y).toBeGreaterThanOrEqual(workArea.y)
  })
})

describe('file panel Quick Look IPC and lifecycle', () => {
  let tmpDir = ''

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true })
      tmpDir = ''
    }
  })

  it('enforces sender, scope, and regular-file checks on quickLookOpen and closes on panel hide', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'fp-ql-'))
    const allowedDir = join(tmpDir, 'allowed')
    const outsideDir = join(tmpDir, 'outside')
    mkdirSync(allowedDir)
    mkdirSync(outsideDir)
    const allowedFile = join(allowedDir, 'notes.md')
    const outsideFile = join(outsideDir, 'secret.md')
    writeFileSync(allowedFile, '# hello', 'utf8')
    writeFileSync(outsideFile, '# secret', 'utf8')

    const openQuickLook = vi.fn(async () => true)
    const closeQuickLook = vi.fn()
    const shellWin = {
      isDestroyed: () => false,
      webContents: { id: 42, send: vi.fn() },
    }

    ipcState.handlers.clear()
    ipcState.listeners.clear()
    installFilePanel({
      settingsPath: () => 'settings.json',
      readSetting: () => ({ open: true, width: 264 }),
      writeSetting: vi.fn(),
      shellWindow: () => shellWin as never,
      applyLayout: vi.fn(),
      uiScale: () => 1,
      lang: () => 'ko',
      viewMenuLabel: () => 'View',
      openFilePaths: () => [join(allowedDir, 'current.md')],
      listFolder: () => ({ dir: '', folders: [], files: [] }),
      isRevealable: () => false,
      openQuickLook,
      closeQuickLook,
    })
    registerFilePanelIpc(() => false)

    const openHandler = ipcState.handlers.get(FILE_PANEL_CHANNELS.quickLookOpen)!
    const closeListener = ipcState.listeners.get(FILE_PANEL_CHANNELS.quickLookClose)!
    const menuHandler = ipcState.handlers.get(FILE_PANEL_CHANNELS.itemMenu)!

    // Rejects non-shell sender
    expect(
      await openHandler({ sender: { id: 999 } }, allowedFile, {
        canPrev: false,
        canNext: true,
        direction: 'none',
      }),
    ).toBe(false)
    // Rejects path outside allowed scope
    expect(
      await openHandler({ sender: { id: 42 } }, outsideFile, {
        canPrev: false,
        canNext: true,
        direction: 'none',
      }),
    ).toBe(false)
    // Rejects directory even inside allowed scope
    expect(
      await openHandler({ sender: { id: 42 } }, allowedDir, {
        canPrev: false,
        canNext: false,
        direction: 'none',
      }),
    ).toBe(false)
    expect(openQuickLook).not.toHaveBeenCalled()

    // Accepts allowed regular file and normalizes nav payload
    expect(
      await openHandler({ sender: { id: 42 } }, allowedFile, {
        canPrev: true,
        canNext: false,
        direction: 'up',
        index: 2,
        total: 5,
      }),
    ).toBe(true)
    expect(openQuickLook).toHaveBeenCalledWith(allowedFile, {
      canPrev: true,
      canNext: false,
      direction: 'up',
      index: 2,
      total: 5,
    })

    // Close listener checks sender
    closeListener({ sender: { id: 999 } })
    expect(closeQuickLook).not.toHaveBeenCalled()
    closeListener({ sender: { id: 42 } })
    expect(closeQuickLook).toHaveBeenCalledTimes(1)

    // Hiding the file panel closes any active file-panel Quick Look
    setFilePanelOpen(false)
    expect(closeQuickLook).toHaveBeenCalledTimes(2)

    // File context menu includes Quick Look; folder menu omits it
    await menuHandler({ sender: { id: 42 } }, 'file', allowedFile, 10, 20, false)
    expect(ipcState.lastMenuTemplate.map((item) => item.label)).toContain('빠른 미리보기')
    await menuHandler({ sender: { id: 42 } }, 'folder', allowedDir, 10, 20, false)
    expect(ipcState.lastMenuTemplate.map((item) => item.label)).not.toContain('빠른 미리보기')
  })
})

describe('file panel Quick Look 22-language labels', () => {
  it('populates quickLook and itemQuickLook for every supported language', () => {
    for (const lang of LANGS) {
      const uiLabel = filePanelText(lang, 'quickLook')
      const menuLabel = filePanelMenuText(lang, 'itemQuickLook')
      expect(uiLabel.trim().length, `ui ${lang}`).toBeGreaterThan(0)
      expect(menuLabel.trim().length, `menu ${lang}`).toBeGreaterThan(0)
      if (lang !== 'en') {
        expect(uiLabel, `ui ${lang} should be translated`).not.toBe('Quick Look')
        expect(menuLabel, `menu ${lang} should be translated`).not.toBe('Quick Look')
      }
    }
  })
})
