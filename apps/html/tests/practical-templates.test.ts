/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { auditHtmlQuality } from '@genoffice/agent-core'
import { LANGS } from '@genoffice/i18n'
import type { AppChoiceSource, AppChoiceState } from '@genoffice/ui'
import {
  PRACTICAL_HTML_TEMPLATES,
  findPracticalHtmlTemplate,
} from '../src/renderer/templates/practical-templates'
import { htmlTemplatesText, practicalTemplateLabel } from '../src/renderer/i18n/strings-templates'
import { Ribbon } from '../src/renderer/components/Ribbon'
import { AiVisibilityProvider } from '../src/renderer/ai-visibility'

describe('practical HTML templates', () => {
  it('ships 5 offline 1-page templates with @page rules, zero external URLs, and zero QC findings', () => {
    expect(PRACTICAL_HTML_TEMPLATES.map((t) => t.id)).toEqual([
      'meeting-minutes',
      'project-prd',
      'performance-summary',
      'team-okr',
      'quote-invoice',
    ])
    for (const tpl of PRACTICAL_HTML_TEMPLATES) {
      expect(tpl.html).toContain('<!DOCTYPE html>')
      expect(tpl.html).toContain('@page')
      expect(tpl.html).not.toMatch(/https?:\/\//i)
      expect(tpl.html).not.toMatch(/cdn\./i)
      expect(auditHtmlQuality(tpl.html)).toEqual([])
      expect(findPracticalHtmlTemplate(tpl.id)?.id).toBe(tpl.id)
    }
  })

  it('localizes template labels and picker strings across all UI languages', () => {
    for (const lang of LANGS) {
      expect(htmlTemplatesText(lang, 'templatesBtn').trim().length).toBeGreaterThan(0)
      expect(htmlTemplatesText(lang, 'templatesTitle').trim().length).toBeGreaterThan(0)
      expect(htmlTemplatesText(lang, 'templatesSubtitle').trim().length).toBeGreaterThan(0)
      expect(htmlTemplatesText(lang, 'templatesReplaceConfirm').trim().length).toBeGreaterThan(0)
      for (const tpl of PRACTICAL_HTML_TEMPLATES) {
        const label = practicalTemplateLabel(lang, tpl.id)
        expect(label.title.trim().length).toBeGreaterThan(0)
        expect(label.summary.trim().length).toBeGreaterThan(0)
      }
    }
  })
})

describe('HTML ribbon Templates menu in AI-OFF mode', () => {
  beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
  afterEach(() => vi.unstubAllGlobals())

  it('remains available when AI is turned off and applies the selected template', async () => {
    const offState: AppChoiceState = { off: [], aiFeatures: false, locked: false }
    const source: AppChoiceSource = {
      get: async () => offState,
      onChange: () => () => {},
    }
    const onApplyTemplate = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(
          createElement(AiVisibilityProvider, {
            source,
            initial: offState,
            children: createElement(Ribbon, {
              disabled: false,
              dirty: false,
              onSave: vi.fn(),
              onSaveAs: vi.fn(),
              onFind: vi.fn(),
              autoSave: false,
              onToggleAutoSave: vi.fn(),
              aiOpen: false,
              onToggleAi: vi.fn(),
              onAiPreset: vi.fn(),
              canUndo: false,
              canRedo: false,
              onUndo: vi.fn(),
              onRedo: vi.fn(),
              view: 'preview',
              onView: vi.fn(),
              canInsert: true,
              onInsert: vi.fn(),
              onInsertSkeleton: vi.fn(),
              canInsertSkeleton: true,
              onApplyTemplate,
              canvasMode: 'edit',
              onPresent: vi.fn(),
            }),
          }),
        )
      })
      expect(container.querySelector('.ai-entry')).toBeNull()
      const btn = container.querySelector<HTMLButtonElement>(
        '[data-testid="html-ribbon-templates-btn"]',
      )!
      expect(btn).not.toBeNull()
      act(() => btn.click())
      const items = container.querySelectorAll<HTMLButtonElement>('.rb-template-item')
      expect(items.length).toBe(5)
      act(() => items[1]!.click())
      expect(onApplyTemplate).toHaveBeenCalledWith('project-prd')
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })
})
