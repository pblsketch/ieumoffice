import { describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { QUICK_SWITCHER_ACCELERATOR } from '../src/shared/quick-switcher-api'
import { createQuickSwitcherController } from '../src/main/quick-switcher-window'
import { quickSwitcherText } from '../src/renderer/src/i18n/strings-quick-switcher'

describe('Quick Switcher controller and security boundary', () => {
  it('uses Ctrl+Shift+P / Cmd+Shift+P without conflicting with Ctrl+K', () => {
    expect(QUICK_SWITCHER_ACCELERATOR).toBe('CommandOrControl+Shift+P')
  })

  it('aggregates 4 groups, filters AI/disabled-editor commands, and rejects forged item IDs', async () => {
    const activateTab = vi.fn()
    const openFile = vi.fn()
    const runAiCmd = vi.fn()
    const runSettings = vi.fn()
    let aiVisible = false

    const ctrl = createQuickSwitcherController({
      isAiVisible: () => aiVisible,
      isEditorEnabled: (kind) => kind !== 'diagram',
      getLang: () => 'ko',
      listOpenTabs: () => [
        {
          id: 't1',
          title: 'Q3 Report.docx',
          path: '/docs/q3.docx',
          editorKind: 'docs',
          activate: activateTab,
        },
      ],
      listRecentFiles: () => [
        { path: '/docs/notes.md', title: 'notes.md', editorKind: 'markdown' },
      ],
      listProjectFiles: async () => [
        { path: '/proj/plan.html', relPath: 'plan.html', name: 'plan.html' },
      ],
      openFile,
      listCommands: () => [
        { id: 'ai', title: 'Toggle AI Panel', aiOnly: true, run: runAiCmd },
        { id: 'new-diag', title: 'New Diagram', editorKind: 'diagram', run: vi.fn() },
        { id: 'settings', title: 'Open Settings', run: runSettings },
      ],
    })

    const resOff = await ctrl.query('')
    expect(resOff.items.map((i) => i.group)).toEqual([
      'open-tab',
      'recent-file',
      'project-file',
      'command',
    ])
    expect(resOff.items.some((i) => i.title === 'Toggle AI Panel')).toBe(false)
    expect(resOff.items.some((i) => i.title === 'New Diagram')).toBe(false)

    // Forged/unknown ID is strictly rejected
    expect(await ctrl.execute('cmd:forged')).toBe(false)
    expect(runSettings).not.toHaveBeenCalled()

    // Valid shell-issued ID executes cleanly
    const tabItem = resOff.items.find((i) => i.group === 'open-tab')!
    expect(await ctrl.execute(tabItem.id)).toBe(true)
    expect(activateTab).toHaveBeenCalledTimes(1)

    // When AI is on, AI commands appear
    aiVisible = true
    const resOn = await ctrl.query('AI')
    expect(resOn.items.some((i) => i.title === 'Toggle AI Panel')).toBe(true)
  })

  it('has native translations for all 22 languages', () => {
    const en = quickSwitcherText('en', 'groupCommand')
    for (const lang of LANGS) {
      const text = quickSwitcherText(lang, 'groupCommand')
      expect(text, lang).toBeTruthy()
      if (lang !== 'en') expect(text, lang).not.toBe(en)
    }
  })
})
