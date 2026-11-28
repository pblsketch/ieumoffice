import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { DriveListResult, DriveListingRequest } from '../shared/drive-api'
import {
  DRIVE_PICKER_CHANNELS,
  DRIVE_PICKER_PAGE_KEY,
  type DrivePickerApi,
  type DrivePickerChooseResult,
  type DrivePickerInit,
  type DrivePickerPickMoreResult,
  type DrivePickerTheme,
} from '../shared/drive-picker-api'

function themeOf(value: unknown): DrivePickerTheme {
  return value === 'light' || value === 'dark' ? value : 'system'
}

// The "Attach from Google Drive" window's narrow API: list already-chosen
// Drive files, optionally add more via Google's picker, send ticked ids, or
// cancel. Tokens stay in the main process; the window deals only in file ids.
const api: DrivePickerApi = {
  async getInit() {
    const init = (await ipcRenderer.invoke(DRIVE_PICKER_CHANNELS.getInit)) as DrivePickerInit | null
    return { lang: init?.lang ?? 'en', theme: themeOf(init?.theme) }
  },
  onThemeChanged(handler) {
    const listener = (_event: IpcRendererEvent, theme: unknown) => handler(themeOf(theme))
    ipcRenderer.on('app:theme-changed', listener)
    return () => ipcRenderer.removeListener('app:theme-changed', listener)
  },
  list: (listing: DriveListingRequest, pageToken?: string) =>
    ipcRenderer.invoke(DRIVE_PICKER_CHANNELS.list, listing, pageToken) as Promise<DriveListResult>,
  pickMore: () =>
    ipcRenderer.invoke(DRIVE_PICKER_CHANNELS.pickMore) as Promise<DrivePickerPickMoreResult>,
  choose: (ids) =>
    ipcRenderer.invoke(DRIVE_PICKER_CHANNELS.choose, ids) as Promise<DrivePickerChooseResult>,
  async cancel() {
    await ipcRenderer.invoke(DRIVE_PICKER_CHANNELS.cancel)
  },
}
contextBridge.exposeInMainWorld(DRIVE_PICKER_PAGE_KEY, api)
