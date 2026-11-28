import { describe, expect, it, vi } from 'vitest'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { GENERATE_EDITOR_CHANNELS } from '@genoffice/electron-utils/generate-editor-channels'
import { registerGenerateEditorIpc } from '../src/main/generate/generate-editor-ipc'

describe('registerGenerateEditorIpc', () => {
  it('resolves the caller tab path on the main side and never trusts renderer paths', () => {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
    const ipcMain = {
      removeHandler: (ch: string) => handlers.delete(ch),
      handle: (ch: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) =>
        handlers.set(ch, fn),
    } as unknown as IpcMain

    const openForDocument = vi.fn()
    registerGenerateEditorIpc(ipcMain, {
      resolveTabForSender: (id) =>
        id === 42
          ? { webContentsId: 42, filePath: 'C:/docs/report.docx', title: 'report.docx' }
          : id === 99
            ? { webContentsId: 99, title: 'Untitled' }
            : null,
      openForDocument,
    })

    const handler = handlers.get(GENERATE_EDITOR_CHANNELS.openForCurrentTab)!
    expect(handler({ sender: { id: 42 } } as IpcMainInvokeEvent)).toEqual({ ok: true })
    expect(openForDocument).toHaveBeenCalledWith({
      webContentsId: 42,
      filePath: 'C:/docs/report.docx',
      title: 'report.docx',
    })

    expect(handler({ sender: { id: 99 } } as IpcMainInvokeEvent)).toEqual({
      ok: false,
      reason: 'unsaved',
    })
    expect(handler({ sender: { id: 7 } } as IpcMainInvokeEvent)).toEqual({
      ok: false,
      reason: 'not-found',
    })
  })
})
