// @vitest-environment node
/**
 * App-wide outline style-to-level mapping persistence in userData/app-settings.json
 * and main-process IPC handler + broadcast behavior.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

interface FakeContents {
  id: number
  destroyed: boolean
  isDestroyed(): boolean
  setWindowOpenHandler(handler: unknown): void
  loadURL(url: string): Promise<void>
  send: ReturnType<typeof vi.fn>
  on(event: string, listener: (...args: unknown[]) => void): void
  once(event: string, listener: (...args: unknown[]) => void): void
}

let nextId = 1
const contentsById = new Map<number, FakeContents>()

function fakeContents(): FakeContents {
  const id = nextId++
  const contents: FakeContents = {
    id,
    destroyed: false,
    isDestroyed: () => contents.destroyed,
    setWindowOpenHandler: () => {},
    loadURL: async () => {},
    send: vi.fn(),
    on: () => {},
    once: () => {},
  }
  contentsById.set(id, contents)
  return contents
}

const userData = { dir: '' }

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    whenReady: () => new Promise(() => {}),
    getPath: (name: string) =>
      name === 'userData' ? userData.dir : join(tmpdir(), `hwp-outline-test-${name}`),
    getLocale: () => 'ko-KR',
  },
  dialog: {
    showMessageBox: vi.fn(async () => ({ response: 1 })),
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
  },
  shell: { openExternal: vi.fn(async () => {}), showItemInFolder: vi.fn() },
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
  net: {},
  ipcRenderer: {},
  webUtils: {},
  BrowserWindow: { fromWebContents: () => null, getFocusedWindow: () => null },
  WebContentsView: class {
    webContents = fakeContents()
  },
  webContents: {
    fromId: (id: number) => contentsById.get(id) ?? null,
  },
  ipcMain: {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn),
    on: (channel: string, fn: Handler) => handlers.set(channel, fn),
    removeHandler: vi.fn(),
  },
}))

vi.mock('@genoffice/file-parse', () => ({
  hwpToText: vi.fn(async () => ''),
  parseFileToText: vi.fn(async () => ({ kind: 'text', text: '' })),
  ATTACHABLE_EXTS: new Set<string>(),
  ATTACHABLE_IMAGE_EXTS: new Set<string>(),
  ATTACHABLE_MAX_BYTES: 25 * 1024 * 1024,
  attachableMaxBytes: () => 25 * 1024 * 1024,
  ATTACHABLE_IMAGE_MAX_BYTES: 5 * 1024 * 1024,
}))

import { createHwpView } from '../src/main/hwp-main'
import {
  DEFAULT_OUTLINE_STYLE_MAP,
  HWP_OUTLINE_STYLE_MAP_KEY,
  readHwpOutlineStyleMap,
  writeHwpOutlineStyleMap,
} from '../src/main/outline-settings'
import { HWP_CHANNELS } from '../src/shared/ipc'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'genoffice-hwp-outline-settings-'))
  userData.dir = join(dir, 'userData')
  mkdirSync(userData.dir, { recursive: true })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function settingsApp() {
  return { getPath: (): string => userData.dir }
}

function readRawSettings(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(userData.dir, 'app-settings.json'), 'utf8')) as Record<
    string,
    unknown
  >
}

describe('outline-settings persistence in userData/app-settings.json', () => {
  it('returns default 제목 1..10 + Heading 1..10 when app-settings.json is missing or invalid', () => {
    const map = readHwpOutlineStyleMap(settingsApp())
    expect(map).toEqual(DEFAULT_OUTLINE_STYLE_MAP)
    expect(Object.keys(map)).toHaveLength(20)

    writeFileSync(join(userData.dir, 'app-settings.json'), '{broken json')
    expect(readHwpOutlineStyleMap(settingsApp())).toEqual(DEFAULT_OUTLINE_STYLE_MAP)

    writeFileSync(
      join(userData.dir, 'app-settings.json'),
      JSON.stringify({ [HWP_OUTLINE_STYLE_MAP_KEY]: 'not-an-object' }),
    )
    expect(readHwpOutlineStyleMap(settingsApp())).toEqual(DEFAULT_OUTLINE_STYLE_MAP)
  })

  it('preserves unrelated keys in app-settings.json when writing and resetting', async () => {
    writeFileSync(
      join(userData.dir, 'app-settings.json'),
      JSON.stringify({
        hwpDefaultFormat: 'hwpx',
        language: 'ko',
        theme: 'dark',
        nested: { keep: true },
      }),
    )

    const saved = await writeHwpOutlineStyleMap(settingsApp(), {
      '제목 1': 1,
      논문장: 1,
      논문절: 2,
    })
    expect(saved).toEqual({ '제목 1': 1, 논문장: 1, 논문절: 2 })
    expect(readHwpOutlineStyleMap(settingsApp())).toEqual({ '제목 1': 1, 논문장: 1, 논문절: 2 })

    const onDisk = readRawSettings()
    expect(onDisk.hwpDefaultFormat).toBe('hwpx')
    expect(onDisk.language).toBe('ko')
    expect(onDisk.theme).toBe('dark')
    expect(onDisk.nested).toEqual({ keep: true })
    expect(onDisk[HWP_OUTLINE_STYLE_MAP_KEY]).toEqual({ '제목 1': 1, 논문장: 1, 논문절: 2 })

    // Passing null resets back to defaults without touching unrelated keys
    const reset = await writeHwpOutlineStyleMap(settingsApp(), null)
    expect(reset).toEqual(DEFAULT_OUTLINE_STYLE_MAP)
    expect(readHwpOutlineStyleMap(settingsApp())).toEqual(DEFAULT_OUTLINE_STYLE_MAP)

    const afterReset = readRawSettings()
    expect(afterReset.hwpDefaultFormat).toBe('hwpx')
    expect(afterReset.language).toBe('ko')
    expect(afterReset.theme).toBe('dark')
    expect(afterReset.nested).toEqual({ keep: true })
    expect(HWP_OUTLINE_STYLE_MAP_KEY in afterReset).toBe(false)
  })

  it('persists an explicit empty map {} so removed defaults stay removed', async () => {
    const saved = await writeHwpOutlineStyleMap(settingsApp(), {})
    expect(saved).toEqual({})
    expect(readRawSettings()[HWP_OUTLINE_STYLE_MAP_KEY]).toEqual({})
    expect(readHwpOutlineStyleMap(settingsApp())).toEqual({})
  })

  it('strips invalid style names and out-of-range or non-integer levels safely', async () => {
    const saved = await writeHwpOutlineStyleMap(settingsApp(), {
      '  장제목  ': 1,
      '': 1,
      '   ': 2,
      zero: 0,
      eleven: 11,
      floatVal: 1.5,
      negative: -3,
      maxLevel: 10,
    })
    expect(saved).toEqual({ 장제목: 1, maxLevel: 10 })
    expect(readHwpOutlineStyleMap(settingsApp())).toEqual({ 장제목: 1, maxLevel: 10 })
  })

  it('creates missing userData directories before writing app-settings.json', async () => {
    const missingUserData = join(dir, 'nested', 'not-created-yet')
    const missingApp = { getPath: (): string => missingUserData }
    const saved = await writeHwpOutlineStyleMap(missingApp, { 장제목: 1 })
    expect(saved).toEqual({ 장제목: 1 })
    expect(readHwpOutlineStyleMap(missingApp)).toEqual({ 장제목: 1 })
  })
})

describe('outline style map IPC handlers and view broadcasts', () => {
  it('handles get/set outline style map IPC and broadcasts changes to live HWP views', async () => {
    const v1 = createHwpView().webContents as unknown as FakeContents
    const v2 = createHwpView().webContents as unknown as FakeContents
    const v3 = createHwpView().webContents as unknown as FakeContents
    v3.destroyed = true

    const getHandler = handlers.get(HWP_CHANNELS.getOutlineStyleMap)
    const setHandler = handlers.get(HWP_CHANNELS.setOutlineStyleMap)
    expect(getHandler).toBeTypeOf('function')
    expect(setHandler).toBeTypeOf('function')

    expect(await getHandler!({ sender: v1 })).toEqual(DEFAULT_OUTLINE_STYLE_MAP)

    const updated = await setHandler!({ sender: v1 }, { 장제목: 1, 절제목: 2 })
    expect(updated).toEqual({ 장제목: 1, 절제목: 2 })
    expect(await getHandler!({ sender: v2 })).toEqual({ 장제목: 1, 절제목: 2 })

    expect(v1.send).toHaveBeenCalledWith(HWP_CHANNELS.outlineStyleMapChanged, {
      장제목: 1,
      절제목: 2,
    })
    expect(v2.send).toHaveBeenCalledWith(HWP_CHANNELS.outlineStyleMapChanged, {
      장제목: 1,
      절제목: 2,
    })
    expect(v3.send).not.toHaveBeenCalled()

    // Reset via null broadcasts default map
    v1.send.mockClear()
    v2.send.mockClear()
    const reset = await setHandler!({ sender: v2 }, null)
    expect(reset).toEqual(DEFAULT_OUTLINE_STYLE_MAP)
    expect(v1.send).toHaveBeenCalledWith(
      HWP_CHANNELS.outlineStyleMapChanged,
      DEFAULT_OUTLINE_STYLE_MAP,
    )
    expect(v2.send).toHaveBeenCalledWith(
      HWP_CHANNELS.outlineStyleMapChanged,
      DEFAULT_OUTLINE_STYLE_MAP,
    )
  })

  it('ignores malformed setOutlineStyleMap IPC payloads without wiping settings or broadcasting', async () => {
    const v1 = createHwpView().webContents as unknown as FakeContents
    const v2 = createHwpView().webContents as unknown as FakeContents
    const getHandler = handlers.get(HWP_CHANNELS.getOutlineStyleMap)!
    const setHandler = handlers.get(HWP_CHANNELS.setOutlineStyleMap)!

    await setHandler({ sender: v1 }, { 장제목: 1, 절제목: 2 })
    v1.send.mockClear()
    v2.send.mockClear()

    for (const badPayload of [undefined, 'bad', 42, true, ['제목 1']]) {
      const result = await setHandler({ sender: v1 }, badPayload)
      expect(result).toEqual({ 장제목: 1, 절제목: 2 })
    }

    expect(await getHandler({ sender: v2 })).toEqual({ 장제목: 1, 절제목: 2 })
    expect(readRawSettings()[HWP_OUTLINE_STYLE_MAP_KEY]).toEqual({ 장제목: 1, 절제목: 2 })
    expect(v1.send).not.toHaveBeenCalled()
    expect(v2.send).not.toHaveBeenCalled()
  })
})
