import type { IpcMain } from 'electron'
import {
  VERSION_TIMELINE_CHANNELS,
  type RecordVersionInput,
  type RecordVersionResult,
} from '@genoffice/electron-utils/version-timeline-channels'
import { docKeyFromPath, isValidDocKey, type VersionTimelineStore } from '@genoffice/electron-utils'

function normalizeDocKey(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  return isValidDocKey(trimmed) ? trimmed : docKeyFromPath(trimmed)
}

/** Registers main-process IPC handlers for the persistent visual-editor Version Timeline. */
export function registerVersionTimelineIpc(ipcMain: IpcMain, store: VersionTimelineStore): void {
  for (const ch of Object.values(VERSION_TIMELINE_CHANNELS)) {
    ipcMain.removeHandler(ch)
  }

  ipcMain.handle(VERSION_TIMELINE_CHANNELS.list, (_event, docKey: unknown) => {
    if (typeof docKey !== 'string') return []
    const key = normalizeDocKey(docKey)
    return key ? store.list(key) : []
  })

  ipcMain.handle(
    VERSION_TIMELINE_CHANNELS.record,
    (_event, input: unknown): RecordVersionResult => {
      if (!input || typeof input !== 'object') {
        return { ok: false, skipped: true, reason: 'invalid' }
      }
      const typed = input as RecordVersionInput
      // Double-enforce encrypted PPTX rejection on the main boundary
      if (typed.encrypted === true) {
        return { ok: false, skipped: true, reason: 'encrypted' }
      }
      const key = typeof typed.docKey === 'string' ? normalizeDocKey(typed.docKey) : ''
      if (!key) {
        return { ok: false, skipped: true, reason: 'invalid' }
      }
      return store.record({ ...typed, docKey: key })
    },
  )

  ipcMain.handle(VERSION_TIMELINE_CHANNELS.readSnapshot, (_event, docKey: unknown, id: unknown) => {
    if (typeof docKey !== 'string' || typeof id !== 'string') return null
    const key = normalizeDocKey(docKey)
    return key ? store.readSnapshot(key, id) : null
  })

  ipcMain.handle(VERSION_TIMELINE_CHANNELS.deleteEntry, (_event, docKey: unknown, id: unknown) => {
    if (typeof docKey !== 'string' || typeof id !== 'string') return false
    const key = normalizeDocKey(docKey)
    return key ? store.deleteEntry(key, id) : false
  })

  ipcMain.handle(VERSION_TIMELINE_CHANNELS.clearAll, () => store.clearAll())

  ipcMain.handle(VERSION_TIMELINE_CHANNELS.getStats, () => store.getStats())
}
