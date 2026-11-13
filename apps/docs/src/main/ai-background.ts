import type { KeyModelRefresher } from '@genoffice/ai-provider/key-models'
import type {
  SubscriptionIpcDeps,
  SubscriptionLaunchResult,
} from '@genoffice/ai-provider/subscription'

/**
 * The AI work the main process does on its own, held back while AI features
 * are turned off in Settings (editor choice spec 8.3): the subscription
 * programs are neither checked (status, version, login) nor started from a
 * screen, and the key providers' model lists are not asked for. Turned back
 * on, the shell calls `resumeAiBackgroundWork` and each start point catches
 * up once (spec 8.5). Nothing stored is touched either way (spec 8.4).
 *
 * Electron-free: `aiOn` is the shell's choice as the editor mains read it
 * (`aiFeaturesOn` in @genoffice/electron-utils/app-choice).
 */

const resumers = new Set<() => void>()

/** Hear AI features coming back on; returns the unsubscribe */
export function onAiFeaturesBack(listener: () => void): () => void {
  resumers.add(listener)
  return () => {
    resumers.delete(listener)
  }
}

/** AI features came back on: every start point catches up once */
export function resumeAiBackgroundWork(): void {
  for (const resume of [...resumers]) {
    try {
      resume()
    } catch {
      // one start point failing does not keep the others back
    }
  }
}

/**
 * The subscription channels' dependencies with every check and program start
 * held back while AI is off: a check answers the statuses as last known
 * without asking the programs, and a login, logout, install, update or
 * turning a program back on (which checks it) is refused as `invalid`, the
 * answer a program turned off in this app already gets. Ending a login the
 * app started still goes through.
 */
export function aiGatedSubscriptionDeps(
  deps: SubscriptionIpcDeps,
  aiOn: () => boolean,
): SubscriptionIpcDeps {
  const { service } = deps
  const refused = async (): Promise<SubscriptionLaunchResult> => ({ ok: false, reason: 'invalid' })
  return {
    ...deps,
    service: {
      ...service,
      check: (providers, options) =>
        aiOn() ? service.check(providers, options) : Promise.resolve(service.getStatuses()),
      setOff: (provider, off) =>
        aiOn()
          ? service.setOff(provider, off)
          : Promise.resolve({ ok: false, statuses: service.getStatuses() }),
    },
    launchLogin: (provider, mode) => (aiOn() ? deps.launchLogin(provider, mode) : refused()),
    launchLogout: (provider) => (aiOn() ? deps.launchLogout(provider) : refused()),
    launchInstall: (provider) => (aiOn() ? deps.launchInstall(provider) : refused()),
    launchUpdate: (provider) => (aiOn() ? deps.launchUpdate(provider) : refused()),
  }
}

/** The key providers' model listing (decisions 0087, 0138), asked nothing while AI is off */
export function aiGatedKeyModelRefresher(
  refresher: KeyModelRefresher,
  aiOn: () => boolean,
): KeyModelRefresher {
  return {
    refreshChanged: () => {
      if (aiOn()) refresher.refreshChanged()
    },
    idle: () => refresher.idle(),
  }
}
