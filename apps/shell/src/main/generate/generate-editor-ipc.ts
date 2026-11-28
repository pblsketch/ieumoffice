import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  GENERATE_EDITOR_CHANNELS,
  type GenerateEditorOpenResult,
} from '@genoffice/electron-utils/generate-editor-channels'

export interface OpenTabDocInfo {
  readonly webContentsId: number
  readonly filePath?: string | undefined
  readonly title: string
  readonly parent?: BrowserWindow | null | undefined
}

export interface GenerateEditorIpcDeps {
  /** Resolves the open tab owned by `senderId`, or null when the caller is not an open editor tab. */
  readonly resolveTabForSender: (senderId: number) => OpenTabDocInfo | null
  /** Opens the Generate Window for the resolved tab document. */
  readonly openForDocument: (doc: OpenTabDocInfo) => void
}

/**
 * Registers the editor-only IPC channel for "Create another document".
 * Never accepts a renderer-supplied path: always resolves the caller sender's
 * actual open tab from main-process state, preserving the Home-only boundary
 * on `generate:open-with-paths`.
 */
export function registerGenerateEditorIpc(ipcMain: IpcMain, deps: GenerateEditorIpcDeps): void {
  ipcMain.removeHandler(GENERATE_EDITOR_CHANNELS.openForCurrentTab)
  ipcMain.handle(
    GENERATE_EDITOR_CHANNELS.openForCurrentTab,
    (event: IpcMainInvokeEvent): GenerateEditorOpenResult => {
      const tab = deps.resolveTabForSender(event.sender.id)
      if (!tab) return { ok: false, reason: 'not-found' }
      if (!tab.filePath) return { ok: false, reason: 'unsaved' }
      deps.openForDocument(tab)
      return { ok: true }
    },
  )
}
