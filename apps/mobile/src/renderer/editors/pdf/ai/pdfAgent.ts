/**
 * The PDF document tools of the AI on mobile: the PC editor's skill
 * (apps/pdf/src/renderer/ai/pdf-skill.ts, `surface: 'mobile'`) over the mobile model
 * and edit session (./deps.ts). Loaded only when the AI runs (AI is off by default on
 * mobile), so the skill and the PC labels in 22 languages stay out of the first load.
 *
 * Offered: reading, annotations, forms and pending page edits (MOBILE_PDF_TOOLS);
 * apply_ops takes only the ops in ./applyOps.ts. Every edit is one batch through the
 * session's dispatch, and one run's batches are taken back together (PC
 * ai-run-changes.ts: only while they are still the newest undo steps).
 */
import type { AgentSkill, AgentToolDef } from '@genoffice/agent-core'
import { createI18n, type Lang } from '@genoffice/i18n'
import { createPdfSkill } from '../../../../../../pdf/src/renderer/ai/pdf-skill'
import {
  runRevertVerdict,
  type PdfRevertVerdict,
} from '../../../../../../pdf/src/renderer/ai/ai-run-changes'
import { aiLangDirective } from '../../../../../../pdf/src/renderer/i18n/locale'
import { strings } from '../../../../../../pdf/src/renderer/i18n/strings'
import type { EditSnapshot, Op } from '../edit/types'
import { mobileApplyOpsTool, mobileOpProblems, refusedBatch } from './applyOps'
import type { PdfAiEnv } from './createAiRun'
import { createMobilePdfAiDeps, prepareModelFacts } from './deps'
import { relabelSummary } from './relabel'

const label = createI18n(strings)

/** The offered tools that change the document (the view/edit gate switches or refuses). */
export const PDF_EDIT_TOOLS: ReadonlySet<string> = new Set([
  'markup_text',
  'add_note',
  'reply_note',
  'edit_note',
  'delete_markup',
  'delete_note',
  'add_form_mark',
  'insert_blank_page',
  'apply_ops',
])

/** What one run changed, and the way to take it back. */
export interface MobilePdfRunChanges {
  /** edit ops the run applied */
  readonly places: number
  /** takes the whole run back, or refuses when the document changed since (or the steps expired) */
  undo(): 'reverted' | Exclude<PdfRevertVerdict, 'ok'>
}

export interface MobilePdfAgent {
  /** the PC skill, without the view/edit gate (the caller wraps it) */
  readonly skill: AgentSkill
  readonly editTools: ReadonlySet<string>
  /** Before a run: forgets the last run and reads what the tools need of the document. */
  begin(): Promise<void>
  /** After a run: what it changed, or null when it changed nothing. */
  finish(): MobilePdfRunChanges | null
}

export function createMobilePdfAgent(env: PdfAiEnv, lang: () => Lang): MobilePdfAgent {
  const store = env.editSession.store
  /** the undo snapshot each applied batch of this run pushed, oldest first */
  let snaps: EditSnapshot[] = []
  let applied = 0

  const deps = createMobilePdfAiDeps(env, {
    dispatch: (ops: Op[]) => {
      // an AI batch carries no coalesce key, so the snapshot before it is its undo step
      const before = store.getSnapshot()
      const plan = env.editSession.services.dispatch(ops)
      if (plan.failures.length === 0 && plan.ops.length > 0) {
        snaps.push(before)
        applied += plan.ops.length
      }
      return plan
    },
  })
  const pc = createPdfSkill(deps, { surface: 'mobile' })
  let tools: readonly AgentToolDef[] | null = null
  const toolsNow = () => {
    tools ??= pc.tools.map((tool) => (tool.name === 'apply_ops' ? mobileApplyOpsTool(tool) : tool))
    return tools as AgentToolDef[]
  }

  const skill: AgentSkill = {
    id: pc.id,
    // the PC adds the reply language in its panel; here the skill carries it
    get systemPrompt() {
      return pc.systemPrompt + aiLangDirective(lang())
    },
    get tools() {
      return toolsNow()
    },
    buildContext: () => pc.buildContext?.() ?? '',
    async executeTool(call, signal) {
      if (call.name === 'apply_ops') {
        const problems = mobileOpProblems(call.input.ops, store.getSnapshot())
        if (problems.length > 0) {
          const count = Array.isArray(call.input.ops) ? call.input.ops.length : 0
          return refusedBatch(problems, label(lang(), 'aiToolApplyOps', { count }))
        }
      }
      const result = await pc.executeTool(call, signal)
      return result.summary
        ? { ...result, summary: relabelSummary(result.summary, lang()) }
        : result
    },
  }

  return {
    skill,
    editTools: PDF_EDIT_TOOLS,
    async begin() {
      snaps = []
      applied = 0
      await prepareModelFacts(env.editSession.getModel())
    },
    finish() {
      if (snaps.length === 0) return null
      const run = snaps
      const places = applied
      snaps = []
      applied = 0
      return {
        places,
        undo() {
          const verdict = runRevertVerdict(run, store.undoSnapshots())
          if (verdict !== 'ok') return verdict
          // as if Undo were pressed once per batch: Redo can replay the run
          for (let i = 0; i < run.length; i++) {
            if (!store.undo()) return 'refused'
          }
          return 'reverted'
        },
      }
    },
  }
}
