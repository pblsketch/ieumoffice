import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BrowserWindow, Menu, Tray, ipcMain, screen, shell } from 'electron'
import type { IpcMainInvokeEvent, NativeImage } from 'electron'
import { productName, type Lang } from '@genoffice/i18n'
import { safeExternalUrl } from '@genoffice/electron-utils'
import {
  QUICK_LOOK_WINDOW_CHANNELS,
  isQuickLookSupportedPath,
  type QuickLookInit,
  type QuickLookNavState,
  type QuickLookOrigin,
  type QuickLookPayload,
  type QuickLookTheme,
} from '../../shared/quick-look-api'
import {
  QUICK_LOOK_HOME_CHANNELS,
  normalizeQuickLookSettings,
  type QuickLookSettings,
} from '../../shared/quick-look-home'
import { quickLookText } from '../../renderer/src/i18n/strings-quick-look'
import { clearQuickLookCache, extractQuickLook } from './extract'
import { WinExplorerQuickLookHook } from './win-explorer-hook'

export interface QuickLookRect {
  x: number
  y: number
  width: number
  height: number
}

export const QUICK_LOOK_DEFAULT_WIDTH = 812
export const QUICK_LOOK_DEFAULT_HEIGHT = 652
export const QUICK_LOOK_MIN_WIDTH = 500
export const QUICK_LOOK_MIN_HEIGHT = 400
/** Transparent window shadow padding around the card (.ql-standalone-body #root). */
export const QUICK_LOOK_CARD_PADDING = 16
/** Visible gap between the file panel's right edge and the preview card's left edge. */
export const QUICK_LOOK_PANEL_GAP = 12

/**
 * Compute the floating Quick Look window bounds beside the open file panel,
 * sitting over the document area and clamped to the display workArea.
 */
export function computeFilePanelQuickLookBounds(
  shellContentBounds: QuickLookRect,
  panelInset: number,
  topInset: number,
  workArea: QuickLookRect,
): QuickLookRect {
  const safePanel = Math.max(0, panelInset)
  const safeTop = Math.max(0, topInset)
  const docX = shellContentBounds.x + safePanel
  const docY = shellContentBounds.y + safeTop
  const docW = Math.max(0, shellContentBounds.width - safePanel)
  const docH = Math.max(0, shellContentBounds.height - safeTop)

  const width = Math.round(
    Math.min(
      workArea.width,
      QUICK_LOOK_DEFAULT_WIDTH,
      Math.max(QUICK_LOOK_MIN_WIDTH, docW - QUICK_LOOK_CARD_PADDING),
    ),
  )
  const height = Math.round(
    Math.min(
      workArea.height,
      QUICK_LOOK_DEFAULT_HEIGHT,
      Math.max(QUICK_LOOK_MIN_HEIGHT, docH - QUICK_LOOK_CARD_PADDING),
    ),
  )

  const rawX = Math.round(docX + QUICK_LOOK_PANEL_GAP - QUICK_LOOK_CARD_PADDING)
  const rawY = Math.round(docY + (docH - height) / 2)
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - width)
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - height)

  return {
    x: Math.min(maxX, Math.max(workArea.x, rawX)),
    y: Math.min(maxY, Math.max(workArea.y, rawY)),
    width,
    height,
  }
}

export interface QuickLookWindowDeps {
  parentWindow(): BrowserWindow | null
  lang(): Lang
  theme(): QuickLookTheme
  trayIcon(): NativeImage | null
  readSettings(): QuickLookSettings
  writeSettings(next: QuickLookSettings): void
  openInEditor(filePath: string): void
  showShellWindow(): void
  quitApp(): void
  /** current file-panel width and tab-strip height in window DIP px */
  filePanelLayout?: () => { panelInset: number; topInset: number } | null
  /** notify the shell file panel whenever its preview opens, updates, or closes */
  onFilePanelStateChanged?: (state: { open: boolean; path: string | null }) => void
  /** ask the shell file panel to navigate up (-1) or down (+1) in its visible file list */
  onFilePanelStep?: (delta: -1 | 1) => void
}

const DEFAULT_NAV: QuickLookNavState = {
  enabled: false,
  canPrev: false,
  canNext: false,
  direction: 'none',
  origin: 'explorer',
}

let deps: QuickLookWindowDeps | null = null
let win: BrowserWindow | null = null
let tray: Tray | null = null
let ipcRegistered = false
let currentFilePath: string | null = null
let currentPayload: QuickLookPayload | null = null
let currentSource: QuickLookOrigin | null = null
let currentNav: QuickLookNavState = { ...DEFAULT_NAV }
let lastBoundsMode: QuickLookOrigin | null = null
let explorerHook: WinExplorerQuickLookHook | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
let blurCheckTimer: ReturnType<typeof setTimeout> | null = null
let deferredSyncTimer: ReturnType<typeof setTimeout> | null = null

const EXIT_ANIMATION_MS = 140
const BLUR_SETTLE_MS = 80
/** Delay background Explorer hook + tray setup so it never blocks shell window creation. */
export const QUICK_LOOK_STARTUP_DELAY_MS = 1500

function clearDeferredSyncTimer(): void {
  if (deferredSyncTimer !== null) {
    clearTimeout(deferredSyncTimer)
    deferredSyncTimer = null
  }
}

function clearHideTimer(): void {
  if (hideTimer !== null) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

function clearBlurCheckTimer(): void {
  if (blurCheckTimer !== null) {
    clearTimeout(blurCheckTimer)
    blurCheckTimer = null
  }
}

function destroyQuickLookWindow(): void {
  clearHideTimer()
  clearBlurCheckTimer()
  const wasFilePanel = currentSource === 'file-panel'
  currentFilePath = null
  currentPayload = null
  currentSource = null
  currentNav = { ...DEFAULT_NAV }
  lastBoundsMode = null
  if (win && !win.isDestroyed()) {
    win.destroy()
  }
  win = null
  if (wasFilePanel) {
    deps?.onFilePanelStateChanged?.({ open: false, path: null })
  }
}

function fromQuickLookWindow(event: IpcMainInvokeEvent): boolean {
  return win !== null && !win.isDestroyed() && event.sender === win.webContents
}

function fromParentOrAnyShellWindow(event: IpcMainInvokeEvent): boolean {
  const parent = deps?.parentWindow()
  if (parent && !parent.isDestroyed() && event.sender === parent.webContents) {
    return true
  }
  const senderWin = BrowserWindow.fromWebContents(event.sender)
  return senderWin !== null && !senderWin.isDestroyed()
}

function isPreviewableRegularFile(filePath: string): boolean {
  if (!filePath || !isQuickLookSupportedPath(filePath)) return false
  try {
    const st = statSync(filePath)
    return st.isFile()
  } catch {
    return false
  }
}

function syncTrayMenu(): void {
  if (!tray || !deps) return
  const lang = deps.lang()
  const appTitle = productName(lang)
  tray.setToolTip(`${appTitle} — ${quickLookText(lang, 'windowTitle')}`)
  const menu = Menu.buildFromTemplate([
    {
      label: quickLookText(lang, 'trayOpen'),
      click: () => deps?.showShellWindow(),
    },
    { type: 'separator' },
    {
      label: quickLookText(lang, 'trayQuit'),
      click: () => deps?.quitApp(),
    },
  ])
  tray.setContextMenu(menu)
}

export function syncQuickLookRuntime(): void {
  clearDeferredSyncTimer()
  if (!deps) return
  const settings = deps.readSettings()

  if (process.platform === 'win32') {
    if (!explorerHook) {
      explorerHook = new WinExplorerQuickLookHook({
        onSpace: (filePath) => {
          void handleExplorerSpace(filePath)
        },
        onNavigate: (filePath) => {
          void handleExplorerNavigate(filePath)
        },
        onEscape: () => {
          closeQuickLookWindow()
        },
      })
    }
    explorerHook.setEnabled(settings.explorerSpacePreview)
    if (!settings.explorerSpacePreview && currentSource !== 'file-panel') {
      destroyQuickLookWindow()
    }

    const wantTray = settings.explorerSpacePreview && settings.keepInTray
    if (wantTray && !tray) {
      const icon = deps.trayIcon()
      if (icon) {
        try {
          tray = new Tray(icon)
          tray.on('click', () => deps?.showShellWindow())
          tray.on('double-click', () => deps?.showShellWindow())
          syncTrayMenu()
        } catch {
          tray = null
        }
      }
    } else if (!wantTray && tray) {
      tray.destroy()
      tray = null
    } else if (tray) {
      syncTrayMenu()
    }
  }
}

export function shouldKeepQuickLookInTray(): boolean {
  if (process.platform !== 'win32' || !deps) return false
  const settings = deps.readSettings()
  const keep = settings.explorerSpacePreview && settings.keepInTray
  // If the user closes the window before the deferred startup timer fires,
  // ensure the tray icon exists immediately so the app stays reachable.
  if (keep && deferredSyncTimer !== null) syncQuickLookRuntime()
  return keep
}

export function stopQuickLookRuntime(): void {
  clearDeferredSyncTimer()
  explorerHook?.stop()
  explorerHook = null
  if (tray) {
    tray.destroy()
    tray = null
  }
  destroyQuickLookWindow()
  clearQuickLookCache()
}

function scheduleFilePanelBlurCheck(): void {
  clearBlurCheckTimer()
  if (currentSource !== 'file-panel') return
  blurCheckTimer = setTimeout(() => {
    blurCheckTimer = null
    if (currentSource !== 'file-panel') return
    const focused = BrowserWindow.getFocusedWindow()
    const parent = deps?.parentWindow() ?? null
    const inQuickLook = win !== null && !win.isDestroyed() && focused === win
    const inShell = parent !== null && !parent.isDestroyed() && focused === parent
    if (!inQuickLook && !inShell) {
      closeQuickLookWindow({ restoreFocus: false })
    }
  }, BLUR_SETTLE_MS)
}

export function handleShellWindowBlurForQuickLook(): void {
  if (currentSource === 'file-panel') {
    scheduleFilePanelBlurCheck()
  }
}

export function handleEditorFocusForQuickLook(): void {
  if (currentSource === 'file-panel') {
    closeQuickLookWindow({ restoreFocus: false })
  }
}

export function closeFilePanelQuickLook(options?: { restoreFocus?: boolean }): void {
  if (currentSource !== 'file-panel') return
  closeQuickLookWindow(options)
}

export function closeQuickLookWindow(options?: { restoreFocus?: boolean }): void {
  clearHideTimer()
  clearBlurCheckTimer()
  const prevSource = currentSource
  const hadFocus = win !== null && !win.isDestroyed() && win.isFocused()
  currentFilePath = null
  currentPayload = null
  currentSource = null
  currentNav = { ...DEFAULT_NAV }
  if (prevSource === 'file-panel') {
    deps?.onFilePanelStateChanged?.({ open: false, path: null })
  }
  if (!win || win.isDestroyed()) {
    win = null
    return
  }
  if (!win.isVisible()) return
  win.webContents.send(QUICK_LOOK_WINDOW_CHANNELS.willHide)
  const targetWin = win
  hideTimer = setTimeout(() => {
    hideTimer = null
    if (currentFilePath === null && targetWin && !targetWin.isDestroyed()) {
      targetWin.hide()
    }
  }, EXIT_ANIMATION_MS)
  if (prevSource === 'file-panel' && hadFocus && options?.restoreFocus !== false) {
    const parent = deps?.parentWindow()
    if (parent && !parent.isDestroyed() && parent.isVisible()) {
      parent.focus()
    }
  }
}

function resolveFilePanelBounds(): QuickLookRect | null {
  const parent = deps?.parentWindow()
  const layout = deps?.filePanelLayout?.()
  if (!parent || parent.isDestroyed() || !layout) return null
  const contentBounds = parent.getContentBounds()
  const workArea = screen.getDisplayMatching(parent.getBounds()).workArea
  return computeFilePanelQuickLookBounds(
    contentBounds,
    layout.panelInset,
    layout.topInset,
    workArea,
  )
}

function createQuickLookBrowserWindow(
  lang: Lang,
  fileName: string,
  bounds: QuickLookRect | null,
): BrowserWindow {
  const next = new BrowserWindow({
    width: bounds?.width ?? QUICK_LOOK_DEFAULT_WIDTH,
    height: bounds?.height ?? QUICK_LOOK_DEFAULT_HEIGHT,
    ...(bounds ? { x: bounds.x, y: bounds.y } : { center: true }),
    minWidth: QUICK_LOOK_MIN_WIDTH,
    minHeight: QUICK_LOOK_MIN_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    minimizable: false,
    maximizable: true,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: `${fileName} — ${quickLookText(lang, 'windowTitle')} - ${productName(lang)}`,
    webPreferences: {
      preload: join(__dirname, '../preload/quick-look.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win = next
  next.removeMenu()
  next.webContents.setWindowOpenHandler(({ url }) => {
    const target = safeExternalUrl(url)
    if (target) void shell.openExternal(target)
    return { action: 'deny' }
  })
  next.on('blur', () => {
    if (win === next && currentSource === 'file-panel') {
      scheduleFilePanelBlurCheck()
    }
  })
  next.once('ready-to-show', () => {
    if (win === next && !next.isDestroyed() && currentFilePath !== null) {
      next.showInactive()
    }
  })
  next.on('closed', () => {
    if (win === next) {
      clearHideTimer()
      clearBlurCheckTimer()
      const wasFilePanel = currentSource === 'file-panel'
      win = null
      currentFilePath = null
      currentPayload = null
      currentSource = null
      currentNav = { ...DEFAULT_NAV }
      lastBoundsMode = null
      if (wasFilePanel) {
        deps?.onFilePanelStateChanged?.({ open: false, path: null })
      }
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void next.loadURL(`${process.env.ELECTRON_RENDERER_URL}/quick-look.html`)
  } else {
    void next.loadFile(join(__dirname, '../renderer/quick-look.html'))
  }
  return next
}

async function handleExplorerSpace(rawPath: string): Promise<void> {
  if (!deps) return
  const resolved = resolve(rawPath)
  if (!isPreviewableRegularFile(resolved)) return

  if (
    win &&
    !win.isDestroyed() &&
    win.isVisible() &&
    hideTimer === null &&
    currentSource === 'explorer' &&
    currentFilePath === resolved
  ) {
    closeQuickLookWindow()
    return
  }

  await showQuickLookWindowForPath(resolved)
}

async function handleExplorerNavigate(rawPath: string): Promise<void> {
  if (
    !deps ||
    !win ||
    win.isDestroyed() ||
    !win.isVisible() ||
    hideTimer !== null ||
    currentSource !== 'explorer'
  ) {
    return
  }
  const resolved = resolve(rawPath)
  if (currentFilePath === resolved || !isPreviewableRegularFile(resolved)) return

  currentFilePath = resolved
  const payload = await extractQuickLook(resolved)
  if (currentFilePath !== resolved) return
  currentPayload = payload
  if (win && !win.isDestroyed()) {
    win.setTitle(`${payload.name} — ${quickLookText(deps.lang(), 'windowTitle')}`)
    win.webContents.send(QUICK_LOOK_WINDOW_CHANNELS.update, payload)
  }
}

export async function showFilePanelQuickLook(
  filePath: string,
  nav: Omit<QuickLookNavState, 'enabled' | 'origin'>,
): Promise<boolean> {
  if (!deps) return false
  clearHideTimer()
  clearBlurCheckTimer()
  const resolved = resolve(filePath)
  const wasPanelVisible =
    win !== null && !win.isDestroyed() && win.isVisible() && currentSource === 'file-panel'

  currentSource = 'file-panel'
  currentFilePath = resolved
  currentNav = {
    enabled: true,
    canPrev: nav.canPrev,
    canNext: nav.canNext,
    direction: nav.direction,
    origin: 'file-panel',
    ...(nav.index !== undefined ? { index: nav.index } : {}),
    ...(nav.total !== undefined ? { total: nav.total } : {}),
  }
  deps.onFilePanelStateChanged?.({ open: true, path: resolved })

  const payload = await extractQuickLook(resolved)
  if (currentFilePath !== resolved || currentSource !== 'file-panel') return false
  currentPayload = payload

  const lang = deps.lang()
  if (win && !win.isDestroyed()) {
    win.setTitle(`${payload.name} — ${quickLookText(lang, 'windowTitle')}`)
    if (!wasPanelVisible) {
      const bounds = resolveFilePanelBounds()
      if (bounds) win.setBounds(bounds)
      lastBoundsMode = 'file-panel'
      win.webContents.send(QUICK_LOOK_WINDOW_CHANNELS.navChanged, currentNav)
      win.webContents.send(QUICK_LOOK_WINDOW_CHANNELS.willShow)
      win.webContents.send(QUICK_LOOK_WINDOW_CHANNELS.update, payload)
      if (!win.isVisible()) {
        win.showInactive()
      }
    } else {
      // Switching files while open: keep window position/size untouched to prevent flicker.
      win.webContents.send(QUICK_LOOK_WINDOW_CHANNELS.navChanged, currentNav)
      win.webContents.send(QUICK_LOOK_WINDOW_CHANNELS.update, payload)
    }
    return true
  }

  const bounds = resolveFilePanelBounds()
  lastBoundsMode = 'file-panel'
  createQuickLookBrowserWindow(lang, payload.name, bounds)
  return true
}

export async function showQuickLookWindowForPath(filePath: string): Promise<void> {
  if (!deps) return
  clearHideTimer()
  clearBlurCheckTimer()
  if (currentSource === 'file-panel') {
    deps.onFilePanelStateChanged?.({ open: false, path: null })
  }
  const resolved = resolve(filePath)
  currentSource = 'explorer'
  currentFilePath = resolved
  currentNav = { ...DEFAULT_NAV }
  const payload = await extractQuickLook(resolved)
  if (currentFilePath !== resolved || currentSource !== 'explorer') return
  currentPayload = payload

  const lang = deps.lang()
  if (win && !win.isDestroyed()) {
    if (lastBoundsMode !== 'explorer') {
      win.setSize(QUICK_LOOK_DEFAULT_WIDTH, QUICK_LOOK_DEFAULT_HEIGHT)
      win.center()
      lastBoundsMode = 'explorer'
    }
    win.setTitle(`${payload.name} — ${quickLookText(lang, 'windowTitle')}`)
    win.webContents.send(QUICK_LOOK_WINDOW_CHANNELS.navChanged, currentNav)
    win.webContents.send(QUICK_LOOK_WINDOW_CHANNELS.willShow)
    win.webContents.send(QUICK_LOOK_WINDOW_CHANNELS.update, payload)
    if (!win.isVisible()) {
      win.showInactive()
    }
    return
  }

  lastBoundsMode = 'explorer'
  createQuickLookBrowserWindow(lang, payload.name, null)
}

export function notifyQuickLookLangOrThemeChanged(): void {
  syncTrayMenu()
  if (!deps || !win || win.isDestroyed()) return
  win.webContents.send(QUICK_LOOK_WINDOW_CHANNELS.langChanged, deps.lang())
  win.webContents.send(QUICK_LOOK_WINDOW_CHANNELS.themeChanged, deps.theme())
}

function registerIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true

  ipcMain.handle(QUICK_LOOK_HOME_CHANNELS.preview, async (event, filePath: unknown) => {
    if (!fromParentOrAnyShellWindow(event) || typeof filePath !== 'string' || !filePath.trim()) {
      return null
    }
    return extractQuickLook(filePath)
  })

  ipcMain.handle(QUICK_LOOK_HOME_CHANNELS.getSettings, (event) => {
    if (!fromParentOrAnyShellWindow(event) || !deps) {
      return normalizeQuickLookSettings(undefined)
    }
    return deps.readSettings()
  })

  ipcMain.handle(QUICK_LOOK_HOME_CHANNELS.setSettings, (event, partial: unknown) => {
    if (!fromParentOrAnyShellWindow(event) || !deps) {
      return normalizeQuickLookSettings(undefined)
    }
    const current = deps.readSettings()
    const rec =
      partial && typeof partial === 'object' ? (partial as Partial<QuickLookSettings>) : {}
    const next = normalizeQuickLookSettings({
      explorerSpacePreview:
        typeof rec.explorerSpacePreview === 'boolean'
          ? rec.explorerSpacePreview
          : current.explorerSpacePreview,
      keepInTray: typeof rec.keepInTray === 'boolean' ? rec.keepInTray : current.keepInTray,
    })
    deps.writeSettings(next)
    syncQuickLookRuntime()
    return next
  })

  ipcMain.handle(QUICK_LOOK_WINDOW_CHANNELS.getInit, (event): QuickLookInit | null => {
    if (!fromQuickLookWindow(event) || !deps) return null
    return {
      lang: deps.lang(),
      theme: deps.theme(),
      payload: currentPayload,
      nav: currentNav,
    }
  })

  ipcMain.handle(QUICK_LOOK_WINDOW_CHANNELS.step, (event, delta: unknown) => {
    if (!fromQuickLookWindow(event) || currentSource !== 'file-panel') return
    if (delta === -1 || delta === 1) {
      deps?.onFilePanelStep?.(delta)
    }
  })

  ipcMain.handle(QUICK_LOOK_WINDOW_CHANNELS.openInEditor, (event) => {
    if (!fromQuickLookWindow(event) || !deps) return
    const target = currentFilePath
    closeQuickLookWindow({ restoreFocus: false })
    if (target && existsSync(target)) {
      deps.openInEditor(target)
    }
  })

  ipcMain.handle(QUICK_LOOK_WINDOW_CHANNELS.revealInFolder, (event) => {
    if (!fromQuickLookWindow(event)) return
    const target = currentFilePath
    if (target && existsSync(target)) {
      shell.showItemInFolder(target)
    }
  })

  ipcMain.handle(QUICK_LOOK_WINDOW_CHANNELS.close, (event) => {
    if (!fromQuickLookWindow(event)) return
    closeQuickLookWindow()
  })
}

export function configureQuickLookWindow(nextDeps: QuickLookWindowDeps): void {
  deps = nextDeps
  registerIpc()
  clearDeferredSyncTimer()
  // Defer spawning the Windows Explorer hook and tray icon past initial window paint.
  deferredSyncTimer = setTimeout(() => {
    deferredSyncTimer = null
    syncQuickLookRuntime()
  }, QUICK_LOOK_STARTUP_DELAY_MS)
  deferredSyncTimer.unref?.()
}
