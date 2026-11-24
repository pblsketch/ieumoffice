/**
 * The Hangul document tools of the AI on mobile: the PC editor's skill
 * (apps/hwp/src/renderer/ai/hwp-skill.ts) over the same studio plugin
 * (`ieum-agent`), which the mobile page editor already carries. Loaded only
 * when the AI runs (AI is off by default on mobile), so the skill and its
 * labels in 22 languages stay out of the app's first load.
 *
 * What the phone has no way to do is not offered: the web (search, pages,
 * pictures from the web), making or looking at pictures, attachments.
 */
import { createI18n, type Lang } from '@genoffice/i18n'
import type { AgentSkill } from '@genoffice/agent-core'
import type { AgentBridge } from '../../../../hwp/src/renderer/ai/agent-bridge'
import {
  createHwpSkill,
  HWP_EDIT_TOOLS,
  type HwpChange,
} from '../../../../hwp/src/renderer/ai/hwp-skill'
import { hwpChangeCount, undoOutcome } from '../../../../hwp/src/renderer/ai/run-changes'
import { aiLangDirective } from '../../../../hwp/src/renderer/i18n/locale'
import { strings } from '../../../../hwp/src/renderer/i18n/strings'

const label = createI18n(strings)

/** Calls one method of the page editor's plugin (HwpMobileEditor.callPlugin). */
export type PluginCall = (method: string, ...args: unknown[]) => Promise<unknown>

/** What one run changed, and the way to take it back. */
export interface MobileHwpRunChanges {
  /** places changed (a replace-all or filled cells count each place) */
  readonly places: number
  /** takes the run back in the page editor: all of it, part of it, or none of it */
  readonly undo: () => Promise<'reverted' | 'partial' | 'refused'>
}

export interface MobileHwpAgent {
  /** the PC skill, without the view/edit gate (the caller wraps it) */
  readonly skill: AgentSkill
  /** the tools that change the document */
  readonly editTools: ReadonlySet<string>
  /** Before a run: forgets the last run and reads the document state the message goes with. */
  begin(): Promise<void>
  /** After a run: what it changed, or null when it changed nothing. */
  finish(): MobileHwpRunChanges | null
}

/** The plugin's methods, each one a call through the page editor. */
function pluginBridge(call: PluginCall): AgentBridge {
  return new Proxy({} as AgentBridge, {
    get: (_target, method) =>
      typeof method === 'string' ? (...args: unknown[]) => call(method, ...args) : undefined,
  })
}

export function createMobileHwpAgent(call: PluginCall, lang: () => Lang): MobileHwpAgent {
  const bridge = pluginBridge(call)
  let changes: HwpChange[] = []
  let foreign: number | null = null
  const hwp = createHwpSkill({
    bridge,
    label: (key, params) => label(lang(), key, params),
    onChange: (change) => changes.push(change),
    // the memo panel's yes/no is not on the phone: an edit that would remove a memo is refused
    confirmMemoRemoval: async () => false,
    imageGenAvailable: () => false,
    pictureAnalysisAvailable: () => false,
    webAvailable: () => false,
  })
  const pc = hwp.skill
  const skill: AgentSkill = {
    id: pc.id,
    // the PC adds the reply language in its panel; here the skill carries it
    get systemPrompt() {
      return pc.systemPrompt + aiLangDirective(lang())
    },
    get tools() {
      return pc.tools
    },
    buildContext: () => pc.buildContext?.() ?? '',
    executeTool: (toolCall, signal) => pc.executeTool(toolCall, signal),
    verifyResponse: pc.verifyResponse
      ? (text, executed) => pc.verifyResponse!(text, executed)
      : undefined,
  }
  return {
    skill,
    editTools: HWP_EDIT_TOOLS,
    async begin() {
      changes = []
      hwp.beginRun()
      const [counted] = await Promise.all([
        (bridge.foreignChanges() as Promise<number>).catch(() => null),
        hwp.refreshContext(),
      ])
      foreign = counted
    },
    finish() {
      if (changes.length === 0) return null
      const steps = changes.length
      const places = hwpChangeCount(changes)
      const foreignAtStart = foreign
      changes = []
      return {
        places,
        undo: () =>
          // without the count at the start the plugin cannot tell the run's steps from others
          foreignAtStart === null
            ? Promise.resolve(undoOutcome(null))
            : bridge.undo(steps, foreignAtStart).then(
                (result) => undoOutcome(result),
                () => undoOutcome(null),
              ),
      }
    },
  }
}
