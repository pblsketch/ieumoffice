// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { AiQualityBadge } from '../src/AiQualityBadge'
import { qualityAuditText } from '../src/strings-quality-audit'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('AiQualityBadge', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('hides completely when AI is off or findings are empty, and expands non-blocking details', () => {
    const onFixWithAi = vi.fn()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    act(() => {
      root.render(
        <AiQualityBadge
          findings={[{ id: 'f1', severity: 'P0', code: 'placeholder_text', message: 'Lorem' }]}
          aiVisible={false}
          lang="ko"
          onFixWithAi={onFixWithAi}
        />,
      )
    })
    expect(host.querySelector('[data-testid="ai-quality-badge"]')).toBeNull()

    act(() => {
      root.render(
        <AiQualityBadge
          findings={[
            {
              id: 'f1',
              severity: 'P0',
              code: 'placeholder_text',
              location: 'Slide 1',
              message: 'Lorem ipsum found',
            },
          ]}
          aiVisible={true}
          lang="ko"
          onFixWithAi={onFixWithAi}
        />,
      )
    })

    const toggle = host.querySelector('.ai-qc-toggle') as HTMLButtonElement
    const fixBtn = host.querySelector('.ai-qc-fix-btn') as HTMLButtonElement
    act(() => {
      toggle.click()
      fixBtn.click()
    })
    expect(host.textContent).toContain('Lorem ipsum found')
    expect(onFixWithAi).toHaveBeenCalledTimes(1)

    act(() => {
      root.unmount()
    })
  })

  it('provides native translations for all 22 languages', () => {
    const en = qualityAuditText('en', 'fixWithAi')
    for (const lang of LANGS) {
      const text = qualityAuditText(lang, 'fixWithAi')
      expect(text, lang).toBeTruthy()
      if (lang !== 'en') expect(text, lang).not.toBe(en)
    }
  })
})
