import type { AgentSkill } from '@genoffice/agent-core'
import basePrompt from './prompts/base.md?raw'
import { verifySheetsResponse } from './response-verify'
import {
  WORKBOOK_TOOLS,
  buildWorkbookContext,
  executeWorkbookTool,
  type SheetsSkillDeps,
  type ToolExecution,
} from './tools'
import {
  HIDING_UNAVAILABLE,
  hidingContextNote,
  withSheetHiding,
  type SheetHidingHooks,
} from '../hiding/skill-guard'

/** Sensitive-info hiding for the skill: the hooks plus the step that loads what it needs first. */
export interface WorkbookSkillHiding extends SheetHidingHooks {
  /** fetch what the dependency analysis needs before a tool runs (async, once per session) */
  readonly prepare: () => Promise<void>
}

/**
 * The workbook DSL as an AgentSkill: mirrors createDocsSkill's shape
 * (systemPrompt + tools + buildContext + executeTool) so it plugs into the
 * same packages/agent-core AgentLoop docx uses.
 *
 * Prompt layout: the always-loaded base prompt (prompts/base.md) stays small
 * — workflow, op catalog, cross-cutting discipline — while per-domain field
 * definitions and conventions live in prompts/guides/*.md, loaded on demand
 * via load_guide.
 *
 * With `hiding`, every tool reads and writes through `withSheetHiding`, and a
 * workbook whose hiding marks cannot be resolved gives the model nothing.
 */
export function createWorkbookSkill(
  deps: SheetsSkillDeps,
  hiding?: WorkbookSkillHiding,
): AgentSkill {
  if (!hiding) {
    return {
      id: 'sheets',
      systemPrompt: basePrompt,
      tools: WORKBOOK_TOOLS,
      buildContext: () => buildWorkbookContext(deps),
      executeTool: (call) => executeWorkbookTool(call, deps),
      verifyResponse: verifySheetsResponse,
    }
  }
  const guarded = withSheetHiding(deps, hiding)
  const refused = (summary: string): ToolExecution => ({
    output: HIDING_UNAVAILABLE,
    isError: true,
    mutated: false,
    summary,
  })
  return {
    id: 'sheets',
    systemPrompt: basePrompt,
    tools: WORKBOOK_TOOLS,
    buildContext: () => {
      const state = hiding.state()
      if (!state.ok) return HIDING_UNAVAILABLE
      const base = buildWorkbookContext(guarded)
      const note = hidingContextNote(state.view, deps.getActiveSheetInfo().sheets)
      return note ? `${base}\n${note}` : base
    },
    executeTool: async (call) => {
      await hiding.prepare()
      if (!hiding.state().ok) return refused(call.name)
      try {
        return await executeWorkbookTool(call, guarded)
      } catch (error) {
        if (error instanceof Error && error.message === HIDING_UNAVAILABLE)
          return refused(call.name)
        throw error
      }
    },
    verifyResponse: verifySheetsResponse,
  }
}
