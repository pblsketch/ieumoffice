/**
 * Main-process side of the file panel beside editor tabs (see
 * shared/file-panel-api.ts for why the views make room rather than the panel
 * floating). This module keeps the user's choice, persists it, lays the views
 * out through the tab manager, answers the renderer's channels and adds the
 * View-menu toggle.
 */
import { existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { BrowserWindow, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { isBesideDocument } from '@genoffice/electron-utils'
import type { Lang } from '@genoffice/i18n'
import {
  FILE_PANEL_ACCELERATOR,
  FILE_PANEL_CHANNELS,
  clampFilePanelWidth,
  filePanelInset,
  readFilePanelChoice,
  type FilePanelChoice,
  type FilePanelItemAction,
  type FilePanelQuickLookNav,
  type FilePanelQuickLookState,
  type FilePanelState,
} from '../shared/file-panel-api'
import type { FolderListing } from '../shared/home-api'
import type { TabKind } from '../shared/tabs-api'
import { filePanelMenuText } from './file-panel-strings'

/**
 * Whether `dir` is a folder the panel may list outside the tree roots: the
 * folder of an open document, or a folder below it. The same "the user's own
 * working folder" rule the open channel applies to files beside a document.
 */
export function isDocumentFolder(dir: string, openFilePaths: readonly string[]): boolean {
  const wanted = resolve(dir)
  return openFilePaths.some(
    (open) => resolve(dirname(resolve(open))) === wanted || isBesideDocument(open, wanted),
  )
}

/**
 * Whether `target` lies within the scope the file panel may reveal or preview:
 * inside a configured folder root, revealable from Home (recents, starred,
 * projects, or beside an open document), or inside an open document's folder
 * subtree.
 */
export function isPanelAllowedPath(
  target: string,
  insideAnyRoot: (path: string) => boolean,
  isRevealable: (path: string) => boolean,
  openFilePaths: readonly string[],
): boolean {
  return (
    insideAnyRoot(target) ||
    isRevealable(target) ||
    isDocumentFolder(target, openFilePaths) ||
    isDocumentFolder(dirname(resolve(target)), openFilePaths)
  )
}

/** View-menu item id; the live item's check mark follows the panel */
export const FILE_PANEL_MENU_ID = 'file-panel-toggle'

export interface FilePanelDeps {
  settingsPath: () => string
  readSetting: (path: string) => unknown
  writeSetting: (path: string, value: unknown) => void
  shellWindow: () => BrowserWindow | null
  applyLayout: (choice: FilePanelChoice) => void
  uiScale: () => number
  lang: () => Lang
  /** the localized label of the View menu, which the toggle goes into */
  viewMenuLabel: () => string
  openFilePaths: () => string[]
  listFolder: (dir: string) => FolderListing
  /** whether the home screen may already show this path (roots, recents, projects) */
  isRevealable: (path: string) => boolean
  /** show or update the floating Quick Look window beside the file panel */
  openQuickLook?: (path: string, nav: FilePanelQuickLookNav) => Promise<boolean>
  /** close the Quick Look window if it was opened by the file panel */
  closeQuickLook?: () => void
}

let deps: FilePanelDeps | null = null
let choice: FilePanelChoice = readFilePanelChoice(null)
let persistTimer: ReturnType<typeof setTimeout> | null = null

/** the state the renderer draws from */
export function filePanelState(): FilePanelState {
  return { ...choice, scale: deps?.uiScale() ?? 1 }
}

/** window px the panel takes from the document area right now */
export function currentFilePanelInset(windowWidth: number): number {
  return filePanelInset(filePanelState(), windowWidth)
}

function broadcast(): void {
  const win = deps?.shellWindow()
  if (win && !win.isDestroyed()) win.webContents.send(FILE_PANEL_CHANNELS.changed, filePanelState())
  syncMenuCheck()
}

function persist(): void {
  if (!deps) return
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = null
  deps.writeSetting(deps.settingsPath(), { ...choice })
}

function apply(next: FilePanelChoice, store: 'now' | 'later' | 'no'): void {
  choice = { open: next.open, width: clampFilePanelWidth(next.width) }
  deps?.applyLayout(choice)
  broadcast()
  if (store === 'now') persist()
  else if (store === 'later') {
    if (persistTimer) clearTimeout(persistTimer)
    // a drag sends a width every frame; the file is written once it settles
    persistTimer = setTimeout(persist, 400)
  }
}

export function setFilePanelOpen(open: boolean): void {
  if (choice.open === open) return
  if (!open) deps?.closeQuickLook?.()
  apply({ ...choice, open }, 'now')
}

export function toggleFilePanel(): void {
  setFilePanelOpen(!choice.open)
}

/** the interface scale changed: the painted width changes with it */
export function filePanelScaleChanged(): void {
  broadcast()
}

/** push preview open/update/close state to the shell renderer */
export function notifyFilePanelQuickLookChanged(state: FilePanelQuickLookState): void {
  const win = deps?.shellWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(FILE_PANEL_CHANNELS.quickLookChanged, state)
  }
}

/** ask the file panel renderer to step to the previous or next visible file */
export function notifyFilePanelQuickLookStep(delta: -1 | 1): void {
  const win = deps?.shellWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(FILE_PANEL_CHANNELS.quickLookStep, delta)
  }
}

/**
 * Read the stored choice and lay the views out with it. Call once the tab
 * manager exists and before the first editor view is shown, so a panel left
 * open does not make the document jump sideways after launch.
 */
export function installFilePanel(next: FilePanelDeps): void {
  deps = next
  choice = readFilePanelChoice(next.readSetting(next.settingsPath()))
  next.applyLayout(choice)
}

function fromShell(sender: Electron.WebContents): boolean {
  const win = deps?.shellWindow()
  return !!win && !win.isDestroyed() && sender.id === win.webContents.id
}

export function registerFilePanelIpc(insideAnyRoot: (path: string) => boolean): void {
  ipcMain.handle(FILE_PANEL_CHANNELS.get, () => filePanelState())
  ipcMain.on(FILE_PANEL_CHANNELS.setOpen, (event, open: unknown) => {
    if (fromShell(event.sender) && typeof open === 'boolean') setFilePanelOpen(open)
  })
  ipcMain.on(FILE_PANEL_CHANNELS.setWidth, (event, width: unknown, commit: unknown) => {
    if (!fromShell(event.sender) || typeof width !== 'number' || !Number.isFinite(width)) return
    apply({ ...choice, width }, commit === true ? 'now' : 'later')
  })
  ipcMain.handle(
    FILE_PANEL_CHANNELS.listDocumentFolder,
    (event, dir: unknown): FolderListing | null => {
      if (!deps || !fromShell(event.sender) || typeof dir !== 'string' || dir.length > 4096) {
        return null
      }
      // the tree roots have their own listing channel; this one only covers a
      // folder the user is already working in through an open document
      if (!insideAnyRoot(dir) && !isDocumentFolder(dir, deps.openFilePaths())) return null
      return deps.listFolder(dir)
    },
  )
  ipcMain.handle(
    FILE_PANEL_CHANNELS.itemMenu,
    (event, kind: unknown, path: unknown, x: unknown, y: unknown, canAddRoot: unknown) =>
      new Promise<FilePanelItemAction | null>((done) => {
        const win = deps?.shellWindow()
        if (!deps || !win || win.isDestroyed() || !fromShell(event.sender)) return done(null)
        if (kind !== 'file' && kind !== 'folder') return done(null)
        if (typeof path !== 'string' || !path || path.length > 4096) return done(null)
        const current = deps
        const canReveal = (target: string): boolean =>
          isPanelAllowedPath(target, insideAnyRoot, current.isRevealable, current.openFilePaths())
        const lang = deps.lang()
        let picked: FilePanelItemAction | null = null
        const item = (label: string, action: FilePanelItemAction): MenuItemConstructorOptions => ({
          label,
          click: () => {
            picked = action
          },
        })
        const template: MenuItemConstructorOptions[] = [
          ...(kind === 'file'
            ? [
                item(filePanelMenuText(lang, 'itemOpen'), 'open'),
                item(filePanelMenuText(lang, 'itemQuickLook'), 'quickLook'),
              ]
            : []),
          item(
            filePanelMenuText(
              lang,
              process.platform === 'darwin' ? 'itemRevealFinder' : 'itemRevealExplorer',
            ),
            'reveal',
          ),
          item(filePanelMenuText(lang, 'itemCopyPath'), 'copyPath'),
          ...(kind === 'folder' && canAddRoot === true
            ? [
                { type: 'separator' as const },
                item(filePanelMenuText(lang, 'itemAddRoot'), 'addRoot'),
              ]
            : []),
        ]
        Menu.buildFromTemplate(template).popup({
          window: win,
          x: typeof x === 'number' ? Math.round(x) : undefined,
          y: typeof y === 'number' ? Math.round(y) : undefined,
          // the click handler runs before the close callback
          callback: () => {
            if (picked === 'reveal' && canReveal(path) && existsSync(path)) {
              shell.showItemInFolder(path)
            }
            done(picked)
          },
        })
      }),
  )
  ipcMain.handle(
    FILE_PANEL_CHANNELS.quickLookOpen,
    async (event, rawPath: unknown, rawNav: unknown): Promise<boolean> => {
      if (!deps || !fromShell(event.sender)) return false
      if (typeof rawPath !== 'string' || !rawPath || rawPath.length > 4096) return false
      if (!isPanelAllowedPath(rawPath, insideAnyRoot, deps.isRevealable, deps.openFilePaths())) {
        return false
      }
      try {
        if (!statSync(rawPath).isFile()) return false
      } catch {
        return false
      }
      const rec =
        rawNav && typeof rawNav === 'object' ? (rawNav as Partial<FilePanelQuickLookNav>) : {}
      const direction = rec.direction === 'up' || rec.direction === 'down' ? rec.direction : 'none'
      const nav: FilePanelQuickLookNav = {
        canPrev: rec.canPrev === true,
        canNext: rec.canNext === true,
        direction,
        ...(typeof rec.index === 'number' && Number.isInteger(rec.index) && rec.index >= 0
          ? { index: rec.index }
          : {}),
        ...(typeof rec.total === 'number' && Number.isInteger(rec.total) && rec.total > 0
          ? { total: rec.total }
          : {}),
      }
      return (await deps.openQuickLook?.(rawPath, nav)) ?? false
    },
  )
  ipcMain.on(FILE_PANEL_CHANNELS.quickLookClose, (event) => {
    if (fromShell(event.sender)) deps?.closeQuickLook?.()
  })
}

/**
 * The View-menu toggle, first in the menu. Editor tabs only: Home has its own
 * sidebar and never shows the panel.
 */
export function withFilePanelMenuItem(kind: TabKind): void {
  if (!deps || kind === 'home') return
  const menu = Menu.getApplicationMenu()
  if (!menu) return
  if (menu.getMenuItemById(FILE_PANEL_MENU_ID)) {
    syncMenuCheck()
    return
  }
  const label = deps.viewMenuLabel()
  const view = menu.items.find((entry) => entry.label === label)
  if (!view?.submenu) return
  const built = Menu.buildFromTemplate([
    {
      id: FILE_PANEL_MENU_ID,
      label: filePanelMenuText(deps.lang(), 'menuToggle'),
      accelerator: FILE_PANEL_ACCELERATOR,
      // shown only: the key is taken in before-input-event (filePanelKeyAction),
      // where the HWP chords can keep it and a detached window cannot reach it
      registerAccelerator: false,
      type: 'checkbox',
      checked: choice.open,
      click: () => toggleFilePanel(),
    },
    { type: 'separator' },
  ]).items
  built.forEach((entry, index) => view.submenu!.insert(index, entry))
  // items added to the live menu only reach the native macOS bar after a set
  Menu.setApplicationMenu(menu)
}

function syncMenuCheck(): void {
  const item = Menu.getApplicationMenu()?.getMenuItemById(FILE_PANEL_MENU_ID)
  if (item && item.checked !== choice.open) item.checked = choice.open
}

/** The fields of Electron's `Input` the toggle key reads. */
export interface PanelKeyInput {
  type: string
  key: string
  code: string
  control: boolean
  meta: boolean
  shift: boolean
  alt: boolean
  isAutoRepeat?: boolean
}

/**
 * First letters of the HWP tab's Hancom sequences (`CHORDS` in
 * apps/hwp/studio-plugin/hancom-keys.mjs; a test keeps the two in step). Ctrl+N
 * and Ctrl+K take E as a second key, and Ctrl may still be held with Shift.
 */
export const HWP_CHORD_STARTERS: ReadonlySet<string> = new Set(['n', 'k', 'q', 'm', 'g'])
/** the starters Cmd opens on a Mac as well (`META_CHORDS` there) */
const HWP_META_CHORD_STARTERS: ReadonlySet<string> = new Set(['n', 'k', 'm', 'g'])

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock'])

/** webContents ids whose last key started an HWP sequence */
const chordWaiting = new Set<number>()

/** the letter a key press means, read off the physical key so a Korean IME does not hide it */
function letterOf(input: PanelKeyInput): string {
  const fromCode = /^Key([A-Z])$/.exec(input.code)?.[1]
  if (fromCode) return fromCode.toLowerCase()
  return /^[a-z]$/i.test(input.key) ? input.key.toLowerCase() : ''
}

/**
 * What a key press in a tab means for the files panel: `toggle` it, `swallow`
 * a held-down repeat of the toggle, or `pass` it on to the page. Called for
 * every keyDown so it can see an HWP sequence begin.
 */
export function filePanelKeyAction(
  contentsId: number,
  input: PanelKeyInput,
  isHwp: boolean,
  platform: NodeJS.Platform = process.platform,
): 'toggle' | 'swallow' | 'pass' {
  if (input.type !== 'keyDown' || MODIFIER_KEYS.has(input.key)) return 'pass'
  const mac = platform === 'darwin'
  const letter = letterOf(input)
  const waiting = chordWaiting.delete(contentsId)
  if (
    isHwp &&
    !input.shift &&
    !input.alt &&
    (input.control || (mac && input.meta && HWP_META_CHORD_STARTERS.has(letter))) &&
    HWP_CHORD_STARTERS.has(letter)
  ) {
    chordWaiting.add(contentsId)
    return 'pass'
  }
  const primary = mac ? input.meta && !input.control : input.control && !input.meta
  if (!primary || !input.shift || input.alt || letter !== 'e') return 'pass'
  // the second key of a sequence belongs to the HWP editor
  if (waiting) return 'pass'
  return input.isAutoRepeat ? 'swallow' : 'toggle'
}
