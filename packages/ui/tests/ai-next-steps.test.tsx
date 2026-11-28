// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { AiNextSteps } from '../src/AiNextSteps'
import { computeNextSteps, type NextStepContext } from '../src/next-steps-rules'
import { nextStepsText } from '../src/strings-next-steps'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const BASE: NextStepContext = {
  aiVisible: true,
  streaming: false,
  completedNormally: true,
  editorKind: 'slides',
  editedDocument: true,
  qualityIssueCount: 2,
  usedSkillName: 'presentation-deck',
  canGenerateOtherDoc: true,
  hasSavedPath: true,
}

describe('AiNextSteps deterministic rules and rendering', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('caps output at 3 chips and returns empty when AI is off, streaming, or errored', () => {
    expect(computeNextSteps(BASE).map((s) => s.id)).toEqual([
      'fix-quality',
      'improve-skill',
      'generate-other-doc',
    ])
    expect(computeNextSteps({ ...BASE, aiVisible: false })).toEqual([])
    expect(computeNextSteps({ ...BASE, streaming: true })).toEqual([])
    expect(computeNextSteps({ ...BASE, completedNormally: false })).toEqual([])
    expect(
      computeNextSteps({ ...BASE, qualityIssueCount: 0, usedSkillName: undefined }).map(
        (s) => s.id,
      ),
    ).toEqual(['generate-other-doc', 'open-tweaks'])
  })

  it('executes AI chips immediately on 1 click via onRunAi and UI chips without AI', () => {
    const onRunAi = vi.fn()
    const onGenerateOtherDoc = vi.fn()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    act(() => {
      root.render(
        <AiNextSteps
          context={BASE}
          lang="ko"
          onRunAi={onRunAi}
          onGenerateOtherDoc={onGenerateOtherDoc}
        />,
      )
    })

    const fixBtn = host.querySelector('[data-step-id="fix-quality"]') as HTMLButtonElement
    const genBtn = host.querySelector('[data-step-id="generate-other-doc"]') as HTMLButtonElement
    act(() => {
      fixBtn.click()
      genBtn.click()
    })
    expect(onRunAi).toHaveBeenCalledTimes(1)
    expect(onGenerateOtherDoc).toHaveBeenCalledTimes(1)

    act(() => {
      root.unmount()
    })
  })

  it('has native translations for all 22 languages', () => {
    const en = nextStepsText('en', 'fixQuality')
    for (const lang of LANGS) {
      const text = nextStepsText(lang, 'fixQuality')
      expect(text, lang).toBeTruthy()
      if (lang !== 'en') expect(text, lang).not.toBe(en)
    }
  })
})
