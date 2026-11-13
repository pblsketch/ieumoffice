/**
 * Editor choice spec 8.3 / 8.5 / 9: while AI features are off the main
 * process starts no subscription program and asks no key provider, and turned
 * back on it checks the subscriptions once. Every program here is a fake: the
 * status service and the launchers only count their calls.
 */
import { describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import type { AppChoice } from '@genoffice/electron-utils/app-choice'
import {
  createSubscriptionStatusService,
  registerSubscriptionIpc,
  SUBSCRIPTION_IPC_CHANNELS,
  type SubscriptionDetection,
  type SubscriptionIpcDeps,
  type SubscriptionStatusMap,
  type SubscriptionStatusService,
} from '@genoffice/ai-provider/subscription'
import { defaultAiSettings } from '@genoffice/ai-provider'
import type { KeyModelRefresher } from '@genoffice/ai-provider/key-models'
import {
  aiGatedKeyModelRefresher,
  aiGatedSubscriptionDeps,
  onAiFeaturesBack,
  resumeAiBackgroundWork,
} from '../../docs/src/main/ai-background'
import { aiOffRefusalText, watchAiFeatures } from '../src/main/ai-off-main'

const STATUSES = {
  codex: { provider: 'codex', state: 'checking' },
} as unknown as SubscriptionStatusMap

function fakeDeps() {
  const service = {
    getStatuses: vi.fn(() => STATUSES),
    check: vi.fn(async () => STATUSES),
    setOff: vi.fn(async () => ({ ok: true, statuses: STATUSES })),
    setMeteredAccepted: vi.fn(async () => ({ ok: true, statuses: STATUSES })),
  } as unknown as SubscriptionStatusService & {
    check: ReturnType<typeof vi.fn>
    setOff: ReturnType<typeof vi.fn>
  }
  const launched = { ok: true } as const
  const deps = {
    service,
    launchLogin: vi.fn(async () => launched),
    launchLogout: vi.fn(async () => launched),
    launchInstall: vi.fn(async () => launched),
    launchUpdate: vi.fn(async () => launched),
    cancelLogin: vi.fn(async () => launched),
  } as unknown as SubscriptionIpcDeps & Record<string, ReturnType<typeof vi.fn>>
  return { service, deps }
}

describe('the subscription channels while AI is off', () => {
  it('answer a check with the statuses as known, asking no program', async () => {
    let on = false
    const { service, deps } = fakeDeps()
    const gated = aiGatedSubscriptionDeps(deps, () => on)
    await expect(gated.service.check()).resolves.toBe(STATUSES)
    await gated.service.check(['codex'], { fresh: true })
    expect(service.check).not.toHaveBeenCalled()
    on = true
    await gated.service.check(['codex'])
    expect(service.check).toHaveBeenCalledTimes(1)
    expect(service.check).toHaveBeenCalledWith(['codex'], undefined)
  })

  it('refuse every program start, and let ending a login through', async () => {
    let on = false
    const { deps } = fakeDeps()
    const gated = aiGatedSubscriptionDeps(deps, () => on)
    for (const launch of [
      'launchLogin',
      'launchLogout',
      'launchInstall',
      'launchUpdate',
    ] as const) {
      await expect(gated[launch]('claude-code')).resolves.toEqual({ ok: false, reason: 'invalid' })
      expect(deps[launch]).not.toHaveBeenCalled()
    }
    await gated.cancelLogin('claude-code')
    expect(deps.cancelLogin).toHaveBeenCalledTimes(1)
    on = true
    await gated.launchLogin('codex', 'window')
    expect(deps.launchLogin).toHaveBeenCalledWith('codex', 'window')
  })

  it('do not turn a program back on (which checks it) and keep the rest of the service', async () => {
    let on = false
    const { service, deps } = fakeDeps()
    const gated = aiGatedSubscriptionDeps(deps, () => on)
    await expect(gated.service.setOff('codex', false)).resolves.toEqual({
      ok: false,
      statuses: STATUSES,
    })
    expect(service.setOff).not.toHaveBeenCalled()
    expect(gated.service.getStatuses()).toBe(STATUSES)
    on = true
    await gated.service.setOff('codex', false)
    expect(service.setOff).toHaveBeenCalledWith('codex', false)
  })
})

/**
 * The real channels the AI panels and Settings call (statuses, recheck, login,
 * logout, install, update) over a real status service, with the program
 * check replaced by a fake that counts: an editor panel that mounts for a
 * moment before it hears AI is off starts no program.
 */
function realChannels(aiOn: () => boolean) {
  const detect = vi.fn(
    async (provider: SubscriptionDetection['provider']): Promise<SubscriptionDetection> => ({
      provider,
      state: 'not-installed',
    }),
  )
  const settings = defaultAiSettings()
  const service = createSubscriptionStatusService({
    getSettings: () => settings,
    setMeteredAccepted: () => undefined,
    setSubscriptionOff: () => undefined,
    acceptanceStore: { read: async () => ({}), write: async () => undefined },
    detect,
  })
  const launched = vi.fn(async () => ({ ok: true }) as const)
  const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>()
  registerSubscriptionIpc(
    { handle: (channel, listener) => void handlers.set(channel, listener) },
    aiGatedSubscriptionDeps(
      {
        service,
        launchLogin: launched,
        launchLogout: launched,
        launchInstall: launched,
        launchUpdate: launched,
        cancelLogin: launched,
      },
      aiOn,
    ),
  )
  const call = (channel: string, payload?: unknown) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`no handler for ${channel}`)
    return handler({}, payload)
  }
  return { detect, launched, call }
}

describe('the subscription channels the screens call, while AI is off', () => {
  it('answer statuses and a recheck without starting any program', async () => {
    let on = false
    const { detect, launched, call } = realChannels(() => on)
    const first = (await call(SUBSCRIPTION_IPC_CHANNELS.statuses)) as SubscriptionStatusMap
    expect(first.codex.state).toBe('checking')
    const again = (await call(SUBSCRIPTION_IPC_CHANNELS.recheck, {
      providers: ['claude-code'],
    })) as SubscriptionStatusMap
    expect(again['claude-code'].state).toBe('checking')
    for (const channel of [
      SUBSCRIPTION_IPC_CHANNELS.login,
      SUBSCRIPTION_IPC_CHANNELS.logout,
      SUBSCRIPTION_IPC_CHANNELS.install,
      SUBSCRIPTION_IPC_CHANNELS.update,
    ]) {
      await expect(call(channel, { provider: 'codex' })).resolves.toEqual({
        ok: false,
        reason: 'invalid',
      })
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(detect).not.toHaveBeenCalled()
    expect(launched).not.toHaveBeenCalled()

    // turned back on, the same channels check as before
    on = true
    const checked = (await call(SUBSCRIPTION_IPC_CHANNELS.recheck)) as SubscriptionStatusMap
    expect(detect).toHaveBeenCalled()
    expect(checked.codex.state).toBe('not-installed')
  })
})

describe('the key providers model listing while AI is off', () => {
  it('lists nothing, and lists again once AI is on', () => {
    let on = false
    const refresher: KeyModelRefresher = { refreshChanged: vi.fn(), idle: async () => undefined }
    const gated = aiGatedKeyModelRefresher(refresher, () => on)
    gated.refreshChanged()
    expect(refresher.refreshChanged).not.toHaveBeenCalled()
    on = true
    gated.refreshChanged()
    expect(refresher.refreshChanged).toHaveBeenCalledTimes(1)
  })
})

describe('turning AI back on', () => {
  it('lets every start point catch up once, even after one fails', () => {
    const first = vi.fn(() => {
      throw new Error('broken')
    })
    const second = vi.fn()
    const stopFirst = onAiFeaturesBack(first)
    const stopSecond = onAiFeaturesBack(second)
    resumeAiBackgroundWork()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    stopFirst()
    stopSecond()
    resumeAiBackgroundWork()
    expect(second).toHaveBeenCalledTimes(1)
  })
})

function fakeChoice(aiFeatures: boolean) {
  let current: AppChoice = { off: [], aiFeatures, locked: false }
  const listeners = new Set<(choice: AppChoice) => void>()
  return {
    effective: () => current,
    onChange(listener: (choice: AppChoice) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next: Partial<AppChoice>) {
      current = { ...current, ...next }
      for (const listener of listeners) listener(current)
    },
  }
}

describe('watchAiFeatures', () => {
  it('re-checks once when AI comes back on, and closes AI windows when it goes off', () => {
    const choice = fakeChoice(false)
    const turnedOn = vi.fn()
    const turnedOff = vi.fn()
    watchAiFeatures({ choice, turnedOn, turnedOff })
    // an editor switched while AI stays off is not a switch of AI
    choice.set({ off: ['epub'] })
    expect(turnedOn).not.toHaveBeenCalled()
    choice.set({ aiFeatures: true })
    choice.set({ off: [] })
    expect(turnedOn).toHaveBeenCalledTimes(1)
    expect(turnedOff).not.toHaveBeenCalled()
    choice.set({ aiFeatures: false })
    expect(turnedOff).toHaveBeenCalledTimes(1)
    expect(turnedOn).toHaveBeenCalledTimes(1)
  })

  it('does nothing at start: an app launched with AI off starts no check', () => {
    const turnedOn = vi.fn()
    const turnedOff = vi.fn()
    watchAiFeatures({ choice: fakeChoice(false), turnedOn, turnedOff })
    watchAiFeatures({ choice: fakeChoice(true), turnedOn, turnedOff })
    expect(turnedOn).not.toHaveBeenCalled()
    expect(turnedOff).not.toHaveBeenCalled()
  })

  it('stops hearing after the unsubscribe', () => {
    const choice = fakeChoice(true)
    const turnedOff = vi.fn()
    const stop = watchAiFeatures({ choice, turnedOn: vi.fn(), turnedOff })
    stop()
    choice.set({ aiFeatures: false })
    expect(turnedOff).not.toHaveBeenCalled()
  })
})

describe('the refusal text', () => {
  it('is written for every screen language', () => {
    const en = aiOffRefusalText('en')
    expect(aiOffRefusalText('ko')).not.toBe(en)
    for (const lang of LANGS) {
      const text = aiOffRefusalText(lang)
      expect(text.length, lang).toBeGreaterThan(0)
      if (lang !== 'en') expect(text, `${lang} copies English`).not.toBe(en)
    }
  })
})
