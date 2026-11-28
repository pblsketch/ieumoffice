import { contextBridge, ipcRenderer } from 'electron'
import {
  QUICK_SWITCHER_CHANNELS,
  type QuickSwitcherBridge,
  type QuickSwitcherQueryResult,
} from '../shared/quick-switcher-api'

const bridge: QuickSwitcherBridge = {
  query: (q: string) =>
    ipcRenderer.invoke(QUICK_SWITCHER_CHANNELS.query, q).then((r) => r as QuickSwitcherQueryResult),
  execute: (itemId: string) =>
    ipcRenderer.invoke(QUICK_SWITCHER_CHANNELS.execute, itemId).then((ok) => ok === true),
  close: () => ipcRenderer.invoke(QUICK_SWITCHER_CHANNELS.close),
  lang: () => ipcRenderer.invoke(QUICK_SWITCHER_CHANNELS.lang).then((l) => String(l ?? 'ko')),
  theme: () =>
    ipcRenderer
      .invoke(QUICK_SWITCHER_CHANNELS.theme)
      .then((t) => (t === 'light' || t === 'dark' ? t : 'system')),
}

contextBridge.exposeInMainWorld('aiOfficeQuickSwitcher', bridge)
