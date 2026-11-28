/**
 * The in-app "Attach from Google Drive" modal window: lets the person tick
 * already-chosen Drive files without opening the browser again, or click
 * "Add from Google Drive" to open Google's picker and bring in more files.
 *
 * Mirrors `doc-picker-window.ts`: one modal window at a time, validating every
 * submitted file id against the ids that main listed or received from Google's
 * picker during this window session.
 */
import { join } from 'node:path'
import { BrowserWindow, ipcMain, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { productName, type Lang } from '@genoffice/i18n'
import { safeExternalUrl } from '@genoffice/electron-utils'
import type { DriveAttachResult, DriveListResult } from '../../shared/drive-api'
import {
  DRIVE_PICKER_CHANNELS,
  type DrivePickerChooseResult,
  type DrivePickerInit,
  type DrivePickerPickMoreResult,
  type DrivePickerTheme,
} from '../../shared/drive-picker-api'
import { driveUiText } from '../../renderer/src/i18n/strings-drive'
import { MAX_ATTACH_FILES, type AttachDownload } from './drive-attach'

const DRIVE_ID_RE = /^[\w-]{1,200}$/

export type DriveAttachBlockReason = 'not-connected' | 'training' | 'free-ai'

export interface DrivePickerDeps {
  list: (raw: unknown, pageToken: unknown) => Promise<DriveListResult>
  pickMore: () => Promise<DrivePickerPickMoreResult>
  cancelPickMore: () => void
  download: (ids: readonly string[]) => Promise<AttachDownload>
  /** Re-checked before downloading; returns a refusal reason or null when allowed */
  guard: () => DriveAttachBlockReason | null
  lang: () => Lang
  theme: () => DrivePickerTheme
}

/**
 * Keep only well-formed Drive file ids that main listed as openable or
 * received from Google's picker in this session, without duplicates, up to
 * `maxPicks`. Anything else is dropped silently.
 */
export function validateDrivePickIds(
  raw: unknown,
  knownIds: ReadonlySet<string>,
  maxPicks: number = MAX_ATTACH_FILES,
): string[] {
  if (!Array.isArray(raw) || knownIds.size === 0 || maxPicks <= 0) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string' || !DRIVE_ID_RE.test(item)) continue
    if (!knownIds.has(item) || seen.has(item)) continue
    seen.add(item)
    out.push(item)
    if (out.length >= maxPicks) break
  }
  return out
}

export function createDrivePicker(deps: DrivePickerDeps) {
  let win: BrowserWindow | null = null
  let settle: ((result: DriveAttachResult) => void) | null = null
  let knownIds = new Set<string>()
  let choosing = false
  let pickingMore = false

  const fromWindow = (event: IpcMainInvokeEvent) =>
    !!win && !win.isDestroyed() && event.sender === win.webContents

  const finish = (result: DriveAttachResult) => {
    const done = settle
    settle = null
    choosing = false
    done?.(result)
    if (win && !win.isDestroyed()) win.close()
  }

  ipcMain.handle(DRIVE_PICKER_CHANNELS.getInit, (event): DrivePickerInit | null =>
    fromWindow(event) ? { lang: deps.lang(), theme: deps.theme() } : null,
  )

  ipcMain.handle(
    DRIVE_PICKER_CHANNELS.list,
    async (event, raw: unknown, pageToken: unknown): Promise<DriveListResult> => {
      if (!fromWindow(event)) return { ok: false, kind: 'not-connected' }
      const result = await deps.list(raw, pageToken)
      if (result.ok) {
        for (const entry of result.files) {
          if (entry.openable && DRIVE_ID_RE.test(entry.id)) knownIds.add(entry.id)
        }
      }
      return result
    },
  )

  ipcMain.handle(
    DRIVE_PICKER_CHANNELS.pickMore,
    async (event): Promise<DrivePickerPickMoreResult> => {
      if (!fromWindow(event)) return { ok: false, reason: 'not-connected' }
      if (choosing || pickingMore) return { ok: false, reason: 'busy' }
      pickingMore = true
      try {
        const result = await deps.pickMore()
        if (result.ok) {
          for (const id of result.picked) {
            if (DRIVE_ID_RE.test(id)) knownIds.add(id)
          }
        }
        return result
      } finally {
        pickingMore = false
      }
    },
  )

  ipcMain.handle(
    DRIVE_PICKER_CHANNELS.choose,
    async (event, raw: unknown): Promise<DrivePickerChooseResult> => {
      if (!fromWindow(event)) return { ok: false, kind: 'unavailable' }
      if (choosing) return { ok: false, kind: 'unavailable' }
      const blocked = deps.guard()
      if (blocked) {
        finish({ ok: false, reason: blocked })
        return { ok: true }
      }
      const ids = validateDrivePickIds(raw, knownIds, MAX_ATTACH_FILES)
      if (ids.length === 0) {
        finish({ ok: false, reason: 'cancelled' })
        return { ok: true }
      }
      choosing = true
      try {
        const got = await deps.download(ids)
        if (!settle) return { ok: true }
        finish({ ok: true, ...got })
        return { ok: true }
      } catch {
        if (settle) finish({ ok: false, reason: 'failed' })
        return { ok: false, kind: 'unavailable' }
      } finally {
        choosing = false
      }
    },
  )

  ipcMain.handle(DRIVE_PICKER_CHANNELS.cancel, (event) => {
    if (!fromWindow(event)) return
    if (pickingMore) deps.cancelPickMore()
    finish({ ok: false, reason: 'cancelled' })
  })

  function open(parent: BrowserWindow | null): Promise<DriveAttachResult> {
    if (win && !win.isDestroyed()) {
      win.show()
      win.focus()
      return Promise.resolve({ ok: false, reason: 'busy' })
    }
    const lang = deps.lang()
    const next = new BrowserWindow({
      width: 720,
      height: 640,
      minWidth: 480,
      minHeight: 420,
      ...(parent && !parent.isDestroyed() ? { parent, modal: true } : {}),
      show: false,
      center: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      title: `${driveUiText(lang, 'drivePickerTitle')} - ${productName(lang)}`,
      webPreferences: {
        preload: join(__dirname, '../preload/drive-picker.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    win = next
    knownIds = new Set<string>()
    choosing = false
    pickingMore = false
    next.removeMenu()
    next.webContents.setWindowOpenHandler(({ url }) => {
      const target = safeExternalUrl(url)
      if (target) void shell.openExternal(target)
      return { action: 'deny' }
    })
    const result = new Promise<DriveAttachResult>((resolve) => (settle = resolve))
    next.once('ready-to-show', () => next.show())
    next.on('closed', () => {
      if (win === next) win = null
      knownIds = new Set<string>()
      if (pickingMore) {
        pickingMore = false
        deps.cancelPickMore()
      }
      choosing = false
      const done = settle
      settle = null
      done?.({ ok: false, reason: 'cancelled' })
    })
    if (process.env.ELECTRON_RENDERER_URL) {
      void next.loadURL(`${process.env.ELECTRON_RENDERER_URL}/drive-picker.html`)
    } else {
      void next.loadFile(join(__dirname, '../renderer/drive-picker.html'))
    }
    return result
  }

  return {
    open,
    isOpen: () => !!win && !win.isDestroyed(),
    close: () => {
      if (win && !win.isDestroyed()) win.close()
    },
  }
}
