import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LANGS, productName } from '@genoffice/i18n'
import type { DriveAttachResult, DriveEntry, DriveListResult } from '../src/shared/drive-api'
import {
  DRIVE_PICKER_CHANNELS,
  type DrivePickerPickMoreResult,
} from '../src/shared/drive-picker-api'
import { driveUiStrings, driveUiText } from '../src/renderer/src/i18n/strings-drive'
import type { DriveAttachBlockReason, DrivePickerDeps } from '../src/main/drive/drive-picker-window'
import { MAX_ATTACH_FILES } from '../src/main/drive/drive-attach'

type Handler = (event?: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()
const winOptions: Array<Record<string, unknown>> = []
const windows: FakeBrowserWindow[] = []
let nextWcId = 1

class FakeWebContents {
  readonly id: number
  constructor() {
    this.id = nextWcId++
  }
  setWindowOpenHandler(): void {}
  send(): void {}
}

class FakeBrowserWindow {
  webContents = new FakeWebContents()
  options: Record<string, unknown>
  shown = false
  focused = false
  destroyed = false
  private readyCb: (() => void) | null = null
  private closedCb: (() => void) | null = null

  constructor(options: Record<string, unknown> = {}) {
    this.options = options
    winOptions.push(options)
    windows.push(this)
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  show(): void {
    this.shown = true
  }
  focus(): void {
    this.focused = true
  }
  removeMenu(): void {}
  once(event: string, cb: () => void): void {
    if (event === 'ready-to-show') this.readyCb = cb
  }
  on(event: string, cb: () => void): void {
    if (event === 'closed') this.closedCb = cb
  }
  loadURL(): Promise<void> {
    return Promise.resolve()
  }
  loadFile(): Promise<void> {
    return Promise.resolve()
  }
  close(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.closedCb?.()
  }
  fireReady(): void {
    this.readyCb?.()
  }
}

vi.mock('electron', () => ({
  BrowserWindow: FakeBrowserWindow,
  ipcMain: {
    handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
  },
  shell: { openExternal: vi.fn() },
}))

const ENTRIES: DriveEntry[] = [
  {
    id: 'file-a',
    name: 'plan.docx',
    type: 'document',
    modifiedTime: '2026-11-20T00:00:00Z',
    openable: true,
    canEdit: true,
    google: false,
  },
  {
    id: 'file-b',
    name: 'notes',
    type: 'document',
    modifiedTime: '2026-11-21T00:00:00Z',
    openable: true,
    canEdit: true,
    google: true,
  },
  {
    id: 'file-video',
    name: 'clip.mp4',
    type: 'other',
    modifiedTime: '2026-11-22T00:00:00Z',
    openable: false,
    canEdit: true,
    google: false,
  },
]

function makeDeps(over: Partial<DrivePickerDeps> = {}) {
  const deps = {
    list: vi.fn(async (): Promise<DriveListResult> => ({ ok: true, files: ENTRIES })),
    pickMore: vi.fn(async (): Promise<DrivePickerPickMoreResult> => ({
      ok: true,
      picked: ['file-new'],
    })),
    cancelPickMore: vi.fn(),
    download: vi.fn(async (ids: readonly string[]) => ({
      paths: ids.map((id) => `/tmp/${id}`),
      skipped: 0,
      failed: 0,
    })),
    guard: vi.fn((): DriveAttachBlockReason | null => null),
    lang: () => 'ko' as const,
    theme: () => 'light' as const,
    ...over,
  }
  return deps
}

async function load(deps: DrivePickerDeps = makeDeps()) {
  const mod = await import('../src/main/drive/drive-picker-window')
  return { picker: mod.createDrivePicker(deps), deps }
}

const pickerWindow = (): FakeBrowserWindow => windows.at(-1)!
const atPicker = () => ({ sender: pickerWindow().webContents })

function invoke(channel: string, event?: unknown, ...args: unknown[]): unknown {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`no handler for ${channel}`)
  return handler(event, ...args)
}

beforeEach(() => {
  vi.resetModules()
  handlers.clear()
  winOptions.length = 0
  windows.length = 0
  nextWcId = 1
})

describe('validateDrivePickIds', () => {
  it('keeps unique valid ids present in knownIds up to maxPicks', async () => {
    const { validateDrivePickIds } = await import('../src/main/drive/drive-picker-window')
    const known = new Set(['a', 'b', 'c', 'd'])
    expect(
      validateDrivePickIds(['a', 'b', 'a', '../bad', 'unknown', 123, 'c', 'd'], known, 3),
    ).toEqual(['a', 'b', 'c'])
  })

  it('returns empty for non-arrays or empty knownIds', async () => {
    const { validateDrivePickIds } = await import('../src/main/drive/drive-picker-window')
    expect(validateDrivePickIds('a', new Set(['a']))).toEqual([])
    expect(validateDrivePickIds(['a'], new Set())).toEqual([])
  })
})

describe('createDrivePicker window', () => {
  it('opens a sandboxed modal window and answers init only to its own webContents', async () => {
    const { picker } = await load()
    const parent = new FakeBrowserWindow()
    const pending = picker.open(parent as unknown as Electron.BrowserWindow)
    const win = pickerWindow()
    expect(win.options.parent).toBe(parent)
    expect(win.options.modal).toBe(true)
    expect(win.options.title).toBe(
      `${driveUiText('ko', 'drivePickerTitle')} - ${productName('ko')}`,
    )
    expect(win.options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    })
    expect(invoke(DRIVE_PICKER_CHANNELS.getInit, atPicker())).toEqual({
      lang: 'ko',
      theme: 'light',
    })
    expect(invoke(DRIVE_PICKER_CHANNELS.getInit, { sender: new FakeWebContents() })).toBeNull()
    win.fireReady()
    expect(win.shown).toBe(true)
    invoke(DRIVE_PICKER_CHANNELS.cancel, atPicker())
    await expect(pending).resolves.toEqual({ ok: false, reason: 'cancelled' })
  })

  it('validates chosen ids against listed openable entries and downloads them without opening Google again', async () => {
    const deps = makeDeps()
    const { picker } = await load(deps)
    const pending = picker.open(null)
    await invoke(DRIVE_PICKER_CHANNELS.list, atPicker(), { kind: 'recent' })
    const chosen = await invoke(DRIVE_PICKER_CHANNELS.choose, atPicker(), [
      'file-a',
      'file-video',
      'not-listed',
      'file-b',
      'file-a',
    ])
    expect(chosen).toEqual({ ok: true })
    expect(deps.pickMore).not.toHaveBeenCalled()
    expect(deps.download).toHaveBeenCalledWith(['file-a', 'file-b'])
    await expect(pending).resolves.toEqual({
      ok: true,
      paths: ['/tmp/file-a', '/tmp/file-b'],
      skipped: 0,
      failed: 0,
    })
    expect(pickerWindow().destroyed).toBe(true)
  })

  it('allows adding more files via Google picker and then attaching newly picked ids', async () => {
    const deps = makeDeps()
    const { picker } = await load(deps)
    const pending = picker.open(null)
    const added = await invoke(DRIVE_PICKER_CHANNELS.pickMore, atPicker())
    expect(added).toEqual({ ok: true, picked: ['file-new'] })
    await invoke(DRIVE_PICKER_CHANNELS.choose, atPicker(), ['file-new'])
    expect(deps.download).toHaveBeenCalledWith(['file-new'])
    await expect(pending).resolves.toEqual({
      ok: true,
      paths: ['/tmp/file-new'],
      skipped: 0,
      failed: 0,
    })
  })

  it('re-checks the guard before downloading', async () => {
    const deps = makeDeps({ guard: vi.fn(() => 'free-ai' as const) })
    const { picker } = await load(deps)
    const pending = picker.open(null)
    await invoke(DRIVE_PICKER_CHANNELS.list, atPicker(), { kind: 'recent' })
    await invoke(DRIVE_PICKER_CHANNELS.choose, atPicker(), ['file-a'])
    expect(deps.download).not.toHaveBeenCalled()
    await expect(pending).resolves.toEqual({ ok: false, reason: 'free-ai' })
  })

  it('caps downloads at MAX_ATTACH_FILES', async () => {
    const manyEntries: DriveEntry[] = Array.from({ length: MAX_ATTACH_FILES + 5 }, (_, i) => ({
      id: `f-${i}`,
      name: `doc-${i}.pdf`,
      type: 'pdf',
      modifiedTime: '2026-11-20T00:00:00Z',
      openable: true,
      canEdit: true,
      google: false,
    }))
    const deps = makeDeps({
      list: vi.fn(async (): Promise<DriveListResult> => ({ ok: true, files: manyEntries })),
    })
    const { picker } = await load(deps)
    const pending = picker.open(null)
    await invoke(DRIVE_PICKER_CHANNELS.list, atPicker(), { kind: 'recent' })
    await invoke(
      DRIVE_PICKER_CHANNELS.choose,
      atPicker(),
      manyEntries.map((e) => e.id),
    )
    expect(deps.download.mock.calls[0]![0]).toHaveLength(MAX_ATTACH_FILES)
    const result = (await pending) as DriveAttachResult
    expect(result.ok && result.paths).toHaveLength(MAX_ATTACH_FILES)
  })

  it('returns busy and focuses the existing window on a second open', async () => {
    const { picker } = await load()
    const first = picker.open(null)
    const win = pickerWindow()
    const second = await picker.open(null)
    expect(second).toEqual({ ok: false, reason: 'busy' })
    expect(win.shown).toBe(true)
    expect(win.focused).toBe(true)
    win.close()
    await expect(first).resolves.toEqual({ ok: false, reason: 'cancelled' })
  })

  it('cancels an in-flight Google picker when the window closes', async () => {
    let resolvePick: ((v: DrivePickerPickMoreResult) => void) | null = null
    const deps = makeDeps({
      pickMore: vi.fn(
        () => new Promise<DrivePickerPickMoreResult>((resolve) => (resolvePick = resolve)),
      ),
    })
    const { picker } = await load(deps)
    const pending = picker.open(null)
    const morePromise = invoke(DRIVE_PICKER_CHANNELS.pickMore, atPicker()) as Promise<unknown>
    pickerWindow().close()
    expect(deps.cancelPickMore).toHaveBeenCalledTimes(1)
    resolvePick!({ ok: false, reason: 'cancelled' })
    await morePromise
    await expect(pending).resolves.toEqual({ ok: false, reason: 'cancelled' })
  })
})

describe('drive strings and shell build wiring', () => {
  const keys = Object.keys(driveUiStrings.zh).sort()

  it('fills every Drive UI string key across all UI languages with expected placeholders', () => {
    for (const lang of LANGS) {
      const dict = driveUiStrings[lang] as Record<string, string>
      expect(Object.keys(dict).sort(), lang).toEqual(keys)
      for (const key of keys) expect(dict[key].trim(), `${lang}.${key}`).not.toBe('')
      expect(dict.driveAddedMany, lang).toContain('{n}')
      expect(dict.drivePickerSelected, lang).toContain('{n}')
      expect(dict.drivePickerLimit, lang).toContain('{max}')
    }
  })

  it('registers drive-picker in both preload and renderer inputs of electron.vite.config.ts', () => {
    const cfg = readFileSync(
      fileURLToPath(new URL('../electron.vite.config.ts', import.meta.url)),
      'utf8',
    )
    expect(cfg).toContain("'drive-picker': resolve(__dirname, 'src/preload/drive-picker.ts')")
    expect(cfg).toContain("'drive-picker': resolve(__dirname, 'src/renderer/drive-picker.html')")
  })
})
