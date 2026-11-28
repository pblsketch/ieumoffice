import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const execFileMock = vi.fn()
const trayCtorMock = vi.fn()
const trayDestroyMock = vi.fn()
const hookSetEnabledMock = vi.fn()
const hookStopMock = vi.fn()

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ieum-test' },
  BrowserWindow: { fromWebContents: () => null },
  Menu: { buildFromTemplate: () => ({}) },
  Tray: class {
    constructor(icon: unknown) {
      trayCtorMock(icon)
    }
    on() {}
    setToolTip() {}
    setContextMenu() {}
    destroy() {
      trayDestroyMock()
    }
  },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
  webContents: { getAllWebContents: () => [] },
}))

vi.mock('../src/main/quick-look/win-explorer-hook', () => ({
  WinExplorerQuickLookHook: class {
    setEnabled(v: boolean) {
      hookSetEnabledMock(v)
    }
    stop() {
      hookStopMock()
    }
  },
}))

vi.mock('../src/main/default-app', async () => {
  const actual =
    await vi.importActual<typeof import('../src/main/default-app')>('../src/main/default-app')
  return {
    ...actual,
    execFileRunner: (...args: unknown[]) => execFileMock(...args),
  }
})

const {
  QUICK_LOOK_STARTUP_DELAY_MS,
  configureQuickLookWindow,
  shouldKeepQuickLookInTray,
  stopQuickLookRuntime,
} = await import('../src/main/quick-look/quick-look-window')

const { POINTER_SIZE_FOCUS_COOLDOWN_MS, POINTER_SIZE_INITIAL_DELAY_MS, installPointerSize } =
  await import('../src/main/pointer-size')

describe('startup optimizations', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    execFileMock.mockReset()
    trayCtorMock.mockReset()
    trayDestroyMock.mockReset()
    hookSetEnabledMock.mockReset()
    hookStopMock.mockReset()
  })

  afterEach(() => {
    stopQuickLookRuntime()
    vi.useRealTimers()
  })

  it('defers QuickLook Explorer hook and tray creation past startup, and flushes if window closes into tray early', () => {
    if (process.platform !== 'win32') return
    const trayIcon = vi.fn(() => ({ fake: true }) as unknown as Electron.NativeImage)
    configureQuickLookWindow({
      parentWindow: () => null,
      lang: () => 'en',
      theme: () => 'system',
      trayIcon,
      readSettings: () => ({ explorerSpacePreview: true, keepInTray: true }),
      writeSettings: () => {},
      openInEditor: () => {},
      showShellWindow: () => {},
      quitApp: () => {},
    })

    // Neither the helper hook nor the tray icon is touched synchronously at boot.
    expect(hookSetEnabledMock).not.toHaveBeenCalled()
    expect(trayIcon).not.toHaveBeenCalled()
    expect(trayCtorMock).not.toHaveBeenCalled()

    // Closing the window into tray before the timer fires flushes immediately.
    expect(shouldKeepQuickLookInTray()).toBe(true)
    expect(hookSetEnabledMock).toHaveBeenCalledWith(true)
    expect(trayIcon).toHaveBeenCalledTimes(1)
    expect(trayCtorMock).toHaveBeenCalledTimes(1)

    // Advancing past the delay does not recreate the tray.
    vi.advanceTimersByTime(QUICK_LOOK_STARTUP_DELAY_MS + 100)
    expect(trayCtorMock).toHaveBeenCalledTimes(1)
  })

  it('cancels the deferred QuickLook startup timer when stopped before it fires', () => {
    if (process.platform !== 'win32') return
    configureQuickLookWindow({
      parentWindow: () => null,
      lang: () => 'en',
      theme: () => 'system',
      trayIcon: () => ({ fake: true }) as unknown as Electron.NativeImage,
      readSettings: () => ({ explorerSpacePreview: true, keepInTray: false }),
      writeSettings: () => {},
      openInEditor: () => {},
      showShellWindow: () => {},
      quitApp: () => {},
    })
    stopQuickLookRuntime()
    vi.advanceTimersByTime(QUICK_LOOK_STARTUP_DELAY_MS + 100)
    expect(hookSetEnabledMock).not.toHaveBeenCalled()
  })

  it('defers initial pointer-size lookup and throttles rapid focus re-checks', async () => {
    if (process.platform !== 'win32') return
    execFileMock.mockResolvedValue(
      '\r\nHKEY_CURRENT_USER\\Control Panel\\Cursors\r\n    CursorBaseSize    REG_DWORD    0x20\r\n',
    )
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
    const fakeApp = {
      on: (event: string, fn: (...args: unknown[]) => void) => {
        const list = listeners.get(event) ?? []
        list.push(fn)
        listeners.set(event, list)
      },
      once: (event: string, fn: (...args: unknown[]) => void) => {
        const list = listeners.get(event) ?? []
        list.push(fn)
        listeners.set(event, list)
      },
    } as unknown as Electron.App

    installPointerSize(fakeApp)
    // Nothing spawned synchronously before window creation.
    expect(execFileMock).not.toHaveBeenCalled()

    // Initial window focus before the startup delay expires does not spawn reg.exe early.
    for (const fn of listeners.get('browser-window-focus') ?? []) fn()
    expect(execFileMock).not.toHaveBeenCalled()

    // After the startup delay, the initial check runs once.
    await vi.advanceTimersByTimeAsync(POINTER_SIZE_INITIAL_DELAY_MS)
    expect(execFileMock).toHaveBeenCalledTimes(1)

    // Another focus within the cooldown window is skipped.
    for (const fn of listeners.get('browser-window-focus') ?? []) fn()
    await Promise.resolve()
    expect(execFileMock).toHaveBeenCalledTimes(1)

    // After the cooldown window, focus re-checks normally.
    await vi.advanceTimersByTimeAsync(POINTER_SIZE_FOCUS_COOLDOWN_MS + 50)
    for (const fn of listeners.get('browser-window-focus') ?? []) fn()
    await Promise.resolve()
    expect(execFileMock).toHaveBeenCalledTimes(2)
  })

  it('keeps V8 compile-cache bootstrap isolated to the product profile and loads shell-main synchronously', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../src/main/bootstrap.ts', import.meta.url)),
      'utf8',
    )
    expect(src).toContain('enableCompileCache')
    expect(src).toContain('DEV_USER_DATA_DIR_NAME')
    expect(src).toContain('./shell-main.js')
    expect(src).not.toContain('.genoffice')
    expect(src).not.toContain('GenOffice-Dev')
  })
})
