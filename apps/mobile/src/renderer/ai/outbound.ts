/**
 * The mobile side of decision 0062 (packages/agent-core/src/outbound-guard.ts):
 * the bridge `guardOutbound` asks about the internet switch and about an
 * address the conversation never showed. PC asks with an OS dialog; the phone
 * asks with a sheet over the AI sheet (OutboundConfirmSheet.tsx), "막기" or
 * "허용", where the default, closing and Back all block.
 *
 * - The switch is read before the run is wrapped (`prime`), so the first
 *   turn's tool list already holds the web tools; later checks read it again.
 * - The addresses the person allowed live here, not in the guard (a new guard
 *   wraps every run): they hold for the conversation and are forgotten by
 *   `reset` (another document, a new conversation).
 * - No global `window` bridge is installed.
 */
import { guardOutbound, type AgentMessage, type AgentSkill } from '@genoffice/agent-core'
import type { OutboundBridgeLike } from '@genoffice/agent-core'

/** One question on screen: the tool and the addresses it would fetch. */
export interface MobileOutboundQuestion {
  readonly id: number
  readonly tool: string
  readonly addresses: readonly string[]
}

export interface MobileOutboundBridge extends OutboundBridgeLike {
  /** Reads the switch now; the next `internetToolsEnabled` answers with it at once. */
  prime(): Promise<boolean>
  /** A change of the switch made during a run (the settings screen). */
  notifyInternetTools(on: boolean): void
  /** Drops the switch listeners of the run that ended. */
  endRun(): void
  /** Forgets the allowed addresses and blocks an open question (new conversation). */
  reset(): void
  /** The question on screen, if any (for the sheet host). */
  question(): MobileOutboundQuestion | null
  subscribe(listener: () => void): () => void
  /** The person's answer to the open question. */
  answer(allow: boolean): void
  /** A sheet host is on screen; returns its release. Without one, nothing can be asked. */
  attachHost(): () => void
}

export interface MobileOutboundBridgeOptions {
  /** "AI on" and "Let AI use internet tools" as Rust has them now; false on any failure */
  readInternetTools(): Promise<boolean>
}

export function createMobileOutboundBridge(
  options: MobileOutboundBridgeOptions,
): MobileOutboundBridge {
  let primed: boolean | null = null
  const switchListeners = new Set<(on: boolean) => void>()
  const allowed = new Set<string>()
  const changeListeners = new Set<() => void>()
  let hosts = 0
  let seq = 0
  let open: { question: MobileOutboundQuestion; resolve: (allow: boolean) => void } | null = null

  const changed = () => {
    for (const listener of [...changeListeners]) listener()
  }
  const settle = (allow: boolean) => {
    const current = open
    if (!current) return
    open = null
    if (allow) for (const a of current.question.addresses) allowed.add(a)
    current.resolve(allow)
    changed()
  }
  const read = async (): Promise<boolean> => {
    try {
      return (await options.readInternetTools()) === true
    } catch {
      return false
    }
  }

  return {
    async prime() {
      primed = await read()
      return primed
    },
    internetToolsEnabled() {
      if (primed !== null) {
        const value = primed
        primed = null
        return Promise.resolve(value)
      }
      return read()
    },
    onInternetToolsChanged(listener) {
      switchListeners.add(listener)
      return () => switchListeners.delete(listener)
    },
    notifyInternetTools(on) {
      for (const listener of [...switchListeners]) listener(on)
    },
    endRun() {
      switchListeners.clear()
      primed = null
    },
    confirmAddresses(tool, addresses) {
      const unknown = [...new Set(addresses)].filter((a) => !allowed.has(a))
      if (unknown.length === 0) return Promise.resolve(true)
      // nothing on screen can ask: blocked, as when PC cannot show its dialog
      if (hosts === 0) return Promise.resolve(false)
      // one question at a time; an older one still open is blocked
      settle(false)
      seq += 1
      return new Promise<boolean>((resolve) => {
        open = { question: { id: seq, tool, addresses: unknown }, resolve }
        changed()
      })
    },
    reset() {
      allowed.clear()
      settle(false)
    },
    question: () => open?.question ?? null,
    subscribe(listener) {
      changeListeners.add(listener)
      return () => changeListeners.delete(listener)
    },
    answer(allow) {
      settle(allow)
    },
    attachHost() {
      hosts += 1
      let released = false
      return () => {
        if (released) return
        released = true
        hosts -= 1
        // the sheet left the screen with a question open: blocked
        if (hosts === 0) settle(false)
      }
    },
  }
}

/** Wraps a run's composed skill with decision 0062; `messages` is the loop's whole history. */
export function guardMobileOutbound(
  skill: AgentSkill,
  bridge: MobileOutboundBridge,
  messages: () => readonly AgentMessage[],
): AgentSkill {
  return guardOutbound(skill, bridge, messages)
}
