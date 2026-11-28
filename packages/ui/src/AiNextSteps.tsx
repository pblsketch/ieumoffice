import React from 'react'
import type { Lang } from '@genoffice/i18n'
import { computeNextSteps, type NextStepContext, type NextStepDescriptor } from './next-steps-rules'
import { nextStepsText } from './strings-next-steps'
import './ai-next-steps.css'

export interface AiNextStepsProps {
  readonly context: NextStepContext
  readonly lang: Lang
  readonly disabled?: boolean | undefined
  /** Invoked for AI chips (must route through `useAiSendGate` in the caller). */
  readonly onRunAi?: ((prompt: string, step: NextStepDescriptor) => void) | undefined
  readonly onImproveSkill?: ((skillName: string) => void) | undefined
  readonly onGenerateOtherDoc?: (() => void) | undefined
  readonly onOpenTweaks?: (() => void) | undefined
}

function labelFor(lang: Lang, step: NextStepDescriptor): string {
  switch (step.id) {
    case 'fix-quality':
      return nextStepsText(lang, 'fixQuality')
    case 'improve-skill':
      return nextStepsText(lang, 'improveSkill')
    case 'generate-other-doc':
      return nextStepsText(lang, 'generateOtherDoc')
    case 'open-tweaks':
      return nextStepsText(lang, 'openTweaks')
  }
}

export function AiNextSteps({
  context,
  lang,
  disabled = false,
  onRunAi,
  onImproveSkill,
  onGenerateOtherDoc,
  onOpenTweaks,
}: AiNextStepsProps): React.JSX.Element | null {
  const steps = computeNextSteps(context)
  if (steps.length === 0) return null

  const handleClick = (step: NextStepDescriptor) => {
    if (disabled) return
    switch (step.id) {
      case 'fix-quality':
        onRunAi?.(nextStepsText(lang, 'fixQualityPrompt'), step)
        break
      case 'improve-skill':
        if (step.skillName) onImproveSkill?.(step.skillName)
        break
      case 'generate-other-doc':
        onGenerateOtherDoc?.()
        break
      case 'open-tweaks':
        onOpenTweaks?.()
        break
    }
  }

  return (
    <div
      className="ai-next-steps"
      role="group"
      aria-label={nextStepsText(lang, 'groupLabel')}
      data-testid="ai-next-steps"
    >
      {steps.map((step) => (
        <button
          key={step.id}
          type="button"
          className="ai-next-step-chip"
          data-step-id={step.id}
          data-step-kind={step.kind}
          disabled={disabled}
          onClick={() => handleClick(step)}
        >
          {labelFor(lang, step)}
        </button>
      ))}
    </div>
  )
}
