import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The shell side of the editor choice (src/main/editor-choice-main.ts): the
 * one function that answers the choice that applies, the IPC channels, the
 * broadcast to every window, the source the editor mains read and the
 * "ai-off" AI run check.
 */

const { handlers, sent, liveIds } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  sent: [] as Array<{ id: number; channel: string; payload: unknown }>,
  liveIds: new Set<number>([1, 2]),
}))

vi.mock('electron', () => {
  const contents = (id: number) => ({
    id,
    isDestroyed: () => false,
    send: (channel: string, payload: unknown) => sent.push({ id, channel, payload }),
  })
  return {
    ipcMain: {
      handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
        handlers.set(channel, fn)
      },
    },
    webContents: {
      getAllWebContents: () => [...liveIds].map(contents),
      fromId: (id: number) => (liveIds.has(id) ? contents(id) : undefined),
    },
  }
})

import { aiRunRefusal } from '@genoffice/electron-utils/ai-run-guard'
import { registerAiJob, runningAiJobCount } from '@genoffice/electron-utils/ai-activity'
import {
  APP_CHOICE_CHANNELS,
  EDITOR_ONLY_ITEM_IDS,
  appChoice,
} from '@genoffice/electron-utils/app-choice'
import { effectiveAppChoice, registerEditorChoiceIpc } from '../src/main/editor-choice-main'

const TEN_EDITORS = EDITOR_ONLY_ITEM_IDS

const dir = mkdtempSync(join(tmpdir(), 'editor-choice-main-'))
const settingsPath = join(dir, 'app-settings.json')

const service = registerEditorChoiceIpc({
  settingsPath: () => settingsPath,
  aiOffRefusal: () => 'AI is off',
})

function invoke(channel: string, ...args: unknown[]): unknown {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`no handler for ${channel}`)
  return handler({ sender: { id: 1 } }, ...args)
}

function stored(): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
}

beforeEach(() => {
  writeFileSync(settingsPath, JSON.stringify({ theme: 'dark', onboardingSeen: true }))
  sent.length = 0
})

afterEach(() => vi.restoreAllMocks())

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('reading', () => {
  it('answers everything on for a file without the keys', () => {
    expect(effectiveAppChoice(settingsPath)).toEqual({ off: [], aiFeatures: true, locked: false })
    expect(invoke(APP_CHOICE_CHANNELS.get)).toEqual({ off: [], aiFeatures: true, locked: false })
  })

  it('reads a stored file with all editors off as everything on', () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        editors: { off: [...TEN_EDITORS] },
      }),
    )
    expect(service.effective().off).toEqual([])
  })

  it('is the source the editor mains read', () => {
    writeFileSync(settingsPath, JSON.stringify({ editors: { off: ['hwp'] }, aiFeatures: false }))
    expect(appChoice()).toEqual({ off: ['hwp'], aiFeatures: false, locked: false })
  })
})

describe('changing', () => {
  it('stores the editors turned off, keeps other keys and tells every window', async () => {
    const heard: unknown[] = []
    const off = service.onChange((choice) => heard.push(choice))
    const next = await invoke(APP_CHOICE_CHANNELS.set, { off: ['epub', 'nope', 'docs'] })
    off()
    const choice = { off: ['docs', 'epub'], aiFeatures: true, locked: false }
    expect(next).toEqual(choice)
    expect(stored()).toEqual({
      theme: 'dark',
      onboardingSeen: true,
      editors: { off: ['docs', 'epub'] },
    })
    expect(sent.filter((m) => m.channel === APP_CHOICE_CHANNELS.changed)).toEqual([
      { id: 1, channel: APP_CHOICE_CHANNELS.changed, payload: choice },
      { id: 2, channel: APP_CHOICE_CHANNELS.changed, payload: choice },
    ])
    expect(heard).toEqual([choice])
  })

  it('stores nothing but an empty value once everything is on again', async () => {
    await invoke(APP_CHOICE_CHANNELS.set, { off: ['hwp'] })
    await invoke(APP_CHOICE_CHANNELS.set, { off: [] })
    expect(stored().editors).toEqual({})
  })

  it('refuses a value with every editor off and keeps the stored one', async () => {
    await invoke(APP_CHOICE_CHANNELS.set, { off: ['hwp'] })
    sent.length = 0
    const next = await invoke(APP_CHOICE_CHANNELS.set, { off: [...TEN_EDITORS] })
    expect(next).toEqual({ off: ['hwp'], aiFeatures: true, locked: false })
    expect(stored().editors).toEqual({ off: ['hwp'] })
    expect(sent).toEqual([])
  })

  it('writes AI off as false and removes the key when it is on again', async () => {
    await invoke(APP_CHOICE_CHANNELS.set, { aiFeatures: false })
    expect(stored().aiFeatures).toBe(false)
    expect(service.effective().aiFeatures).toBe(false)
    await invoke(APP_CHOICE_CHANNELS.set, { aiFeatures: true })
    expect('aiFeatures' in stored()).toBe(false)
    expect(service.effective().aiFeatures).toBe(true)
  })

  it('leaves the editors as they are when only AI changes', async () => {
    await invoke(APP_CHOICE_CHANNELS.set, { off: ['pdfTools'] })
    await invoke(APP_CHOICE_CHANNELS.set, { aiFeatures: false })
    expect(service.effective()).toEqual({ off: ['pdfTools'], aiFeatures: false, locked: false })
  })

  it('does not tell anyone when nothing changed', async () => {
    await invoke(APP_CHOICE_CHANNELS.set, { off: [] })
    await invoke(APP_CHOICE_CHANNELS.set, 'garbage')
    expect(sent).toEqual([])
  })
})

describe('the one-time picker', () => {
  it('is due after onboarding until it is marked seen', async () => {
    expect(invoke(APP_CHOICE_CHANNELS.pickDue)).toBe(true)
    await invoke(APP_CHOICE_CHANNELS.markPickSeen)
    expect(stored().editorPickSeen).toBe(true)
    expect(stored().theme).toBe('dark')
    expect(invoke(APP_CHOICE_CHANNELS.pickDue)).toBe(false)
  })

  it('is not due before onboarding was seen', () => {
    writeFileSync(settingsPath, JSON.stringify({}))
    expect(invoke(APP_CHOICE_CHANNELS.pickDue)).toBe(false)
  })
})

describe('the ai-off check', () => {
  it('refuses a run from an app screen while AI is off', async () => {
    expect(aiRunRefusal({ senderId: 1, provider: 'codex', model: '' })).toBeNull()
    await invoke(APP_CHOICE_CHANNELS.set, { aiFeatures: false })
    expect(aiRunRefusal({ senderId: 1, provider: 'codex', model: '' })).toBe('AI is off')
    // not a window of this app: not this check's business
    expect(aiRunRefusal({ senderId: 99, provider: 'codex', model: '' })).toBeNull()
  })
})

describe('running AI jobs', () => {
  it('answers the count and stops them all', async () => {
    const stop = vi.fn()
    registerAiJob({ kind: 'chat', stop })
    expect(invoke(APP_CHOICE_CHANNELS.aiJobCount)).toBe(1)
    expect(await invoke(APP_CHOICE_CHANNELS.stopAllAiJobs)).toBe(1)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(runningAiJobCount()).toBe(0)
  })

  it('tells every window when the count changes', () => {
    const done = registerAiJob({ kind: 'generate', stop: () => undefined })
    done()
    expect(
      sent.filter((m) => m.channel === APP_CHOICE_CHANNELS.aiJobsChanged).map((m) => m.payload),
    ).toEqual([1, 1, 0, 0])
  })
})
