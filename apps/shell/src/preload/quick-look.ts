import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { Lang } from '@genoffice/i18n'
import {
  QUICK_LOOK_WINDOW_CHANNELS,
  type QuickLookInit,
  type QuickLookNavState,
  type QuickLookPayload,
  type QuickLookTheme,
  type QuickLookWindowApi,
} from '../shared/quick-look-api'

function themeOf(value: unknown): QuickLookTheme {
  return value === 'light' || value === 'dark' ? value : 'system'
}

// The main process only ever sends a valid language, so a plain pass-through is
// enough here. Do not value-import @genoffice/i18n: the shell preload pulls it
// in transitively, and a shared module would become one chunk a sandboxed
// preload cannot require (see tests/quick-look-wiring.test.ts).
function langOf(value: unknown): Lang {
  return typeof value === 'string' && value ? (value as Lang) : 'en'
}

function navOf(value: unknown): QuickLookNavState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const rec = value as Partial<QuickLookNavState>
  const direction = rec.direction === 'up' || rec.direction === 'down' ? rec.direction : 'none'
  const origin = rec.origin === 'file-panel' ? 'file-panel' : 'explorer'
  return {
    enabled: rec.enabled === true,
    canPrev: rec.canPrev === true,
    canNext: rec.canNext === true,
    direction,
    origin,
    ...(typeof rec.index === 'number' ? { index: rec.index } : {}),
    ...(typeof rec.total === 'number' ? { total: rec.total } : {}),
  }
}

const api: QuickLookWindowApi = {
  async getInit() {
    const init = (await ipcRenderer.invoke(
      QUICK_LOOK_WINDOW_CHANNELS.getInit,
    )) as QuickLookInit | null
    return {
      lang: langOf(init?.lang),
      theme: themeOf(init?.theme),
      payload: init?.payload ?? null,
      nav: navOf(init?.nav),
    }
  },
  onUpdate(handler) {
    const listener = (_event: IpcRendererEvent, payload: unknown) => {
      if (payload && typeof payload === 'object') {
        handler(payload as QuickLookPayload)
      }
    }
    ipcRenderer.on(QUICK_LOOK_WINDOW_CHANNELS.update, listener)
    return () => ipcRenderer.removeListener(QUICK_LOOK_WINDOW_CHANNELS.update, listener)
  },
  onNavChanged(handler) {
    const listener = (_event: IpcRendererEvent, nav: unknown) => {
      const parsed = navOf(nav)
      if (parsed) handler(parsed)
    }
    ipcRenderer.on(QUICK_LOOK_WINDOW_CHANNELS.navChanged, listener)
    return () => ipcRenderer.removeListener(QUICK_LOOK_WINDOW_CHANNELS.navChanged, listener)
  },
  onWillShow(handler) {
    const listener = () => handler()
    ipcRenderer.on(QUICK_LOOK_WINDOW_CHANNELS.willShow, listener)
    return () => ipcRenderer.removeListener(QUICK_LOOK_WINDOW_CHANNELS.willShow, listener)
  },
  onWillHide(handler) {
    const listener = () => handler()
    ipcRenderer.on(QUICK_LOOK_WINDOW_CHANNELS.willHide, listener)
    return () => ipcRenderer.removeListener(QUICK_LOOK_WINDOW_CHANNELS.willHide, listener)
  },
  onThemeChanged(handler) {
    const listener = (_event: IpcRendererEvent, theme: unknown) => handler(themeOf(theme))
    ipcRenderer.on(QUICK_LOOK_WINDOW_CHANNELS.themeChanged, listener)
    ipcRenderer.on('app:theme-changed', listener)
    return () => {
      ipcRenderer.removeListener(QUICK_LOOK_WINDOW_CHANNELS.themeChanged, listener)
      ipcRenderer.removeListener('app:theme-changed', listener)
    }
  },
  onLangChanged(handler) {
    const listener = (_event: IpcRendererEvent, lang: unknown) => handler(langOf(lang))
    ipcRenderer.on(QUICK_LOOK_WINDOW_CHANNELS.langChanged, listener)
    return () => ipcRenderer.removeListener(QUICK_LOOK_WINDOW_CHANNELS.langChanged, listener)
  },
  async step(delta) {
    if (delta === -1 || delta === 1) {
      await ipcRenderer.invoke(QUICK_LOOK_WINDOW_CHANNELS.step, delta)
    }
  },
  async openInEditor() {
    await ipcRenderer.invoke(QUICK_LOOK_WINDOW_CHANNELS.openInEditor)
  },
  async revealInFolder() {
    await ipcRenderer.invoke(QUICK_LOOK_WINDOW_CHANNELS.revealInFolder)
  },
  async close() {
    await ipcRenderer.invoke(QUICK_LOOK_WINDOW_CHANNELS.close)
  },
}

contextBridge.exposeInMainWorld('aiOfficeQuickLook', api)
