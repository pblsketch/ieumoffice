/**
 * Pure local deterministic rules for post-response contextual Next-Step chips (`AiNextSteps`).
 * Consumes zero model tokens and runs strictly in the renderer.
 */

export type NextStepId = 'fix-quality' | 'improve-skill' | 'generate-other-doc' | 'open-tweaks'

export interface NextStepContext {
  readonly aiVisible: boolean
  readonly streaming: boolean
  readonly completedNormally: boolean
  readonly editorKind: string
  readonly editedDocument: boolean
  readonly qualityIssueCount: number
  readonly usedSkillName?: string | undefined
  readonly canGenerateOtherDoc: boolean
  readonly hasSavedPath: boolean
}

export interface NextStepDescriptor {
  readonly id: NextStepId
  /** `'ai'` chips execute immediately on 1 click via `useAiSendGate`; `'ui'` chips open UI with 0 AI calls */
  readonly kind: 'ai' | 'ui'
  readonly skillName?: string | undefined
}

const VISUAL_EDITORS = new Set(['slides', 'html', 'whiteboard'])
export const MAX_NEXT_STEPS = 3

/** Computes up to 3 contextual next-step actions deterministically with 0 model calls. */
export function computeNextSteps(ctx: NextStepContext): NextStepDescriptor[] {
  if (!ctx.aiVisible || ctx.streaming || !ctx.completedNormally) return []

  const isVisual = VISUAL_EDITORS.has(ctx.editorKind)
  const chips: NextStepDescriptor[] = []

  if (isVisual && ctx.qualityIssueCount > 0) {
    chips.push({ id: 'fix-quality', kind: 'ai' })
  }
  if (ctx.usedSkillName && ctx.usedSkillName.trim()) {
    chips.push({ id: 'improve-skill', kind: 'ui', skillName: ctx.usedSkillName.trim() })
  }
  if (ctx.editedDocument && ctx.canGenerateOtherDoc && ctx.hasSavedPath) {
    chips.push({ id: 'generate-other-doc', kind: 'ui' })
  }
  if (isVisual && ctx.editedDocument) {
    chips.push({ id: 'open-tweaks', kind: 'ui' })
  }

  return chips.slice(0, MAX_NEXT_STEPS)
}

/** Invokes the editor-only generate-window bridge exposed by editor preloads. */
export function openGenerateForCurrentDocument(): void {
  const api = (
    window as unknown as {
      aiOfficeGenerateEditor?: { openForCurrentTab(): Promise<unknown> }
    }
  ).aiOfficeGenerateEditor
  void api?.openForCurrentTab().catch(() => {})
}
