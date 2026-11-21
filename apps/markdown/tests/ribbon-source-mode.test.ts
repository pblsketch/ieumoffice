import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { Ribbon } from '../src/renderer/components/Ribbon'
import { aiSubscriptionText } from '@genoffice/ui'
import { strings } from '../src/renderer/i18n/strings'

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
})

/**
 * @param sourceMode the .txt/.json "this file is source text" flag from genoffice#1848
 * @param sourceViewOpen this PR's markdown source view, kept a separate flag
 *   because the two mean different things and can never both be on
 */
function renderRibbon(sourceMode: boolean, sourceViewOpen = false, content = '<p>body</p>') {
  const onToggleAi = vi.fn()
  const onAiPreset = vi.fn()
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
      slashItems: () => [],
    }),
    content,
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      createElement(Ribbon, {
        editor,
        disabled: false,
        dirty: false,
        onSave: vi.fn(),
        onSaveAs: vi.fn(),
        onFind: vi.fn(),
        autoSave: false,
        onToggleAutoSave: vi.fn(),
        imageEnabled: true,
        onInsertImage: vi.fn(),
        frontmatterOpen: false,
        onToggleFrontmatter: vi.fn(),
        outlineOpen: false,
        onToggleOutline: vi.fn(),
        spellcheck: true,
        onToggleSpellcheck: vi.fn(),
        aiOpen: false,
        onToggleAi,
        onAiPreset,
        sourceMode,
        sourceViewOpen,
        onToggleSource: vi.fn(),
        onImageHost: vi.fn(),
        backlinksOpen: false,
        onToggleBacklinks: vi.fn(),
        tagsOpen: false,
        onToggleTags: vi.fn(),
        onOpenGraph: vi.fn(),
        mdTheme: 'default',
        onMarkdownTheme: vi.fn(),
        editorFont: null,
        onEditorFont: vi.fn(),
        onCopyBlockLink: vi.fn(),
        redactEnabled: false,
        onToggleRedact: vi.fn(),
      }),
    )
  })
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
    editor.destroy()
  })
  return { container, editor, onToggleAi, onAiPreset }
}

function button(container: HTMLElement, label: string) {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
}

function menuButton(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.rb-menu-item')).find(
    (item) => item.querySelector(':scope > span:not([aria-hidden])')?.textContent === label,
  )
}

describe('Ribbon source mode', () => {
  it('keeps the file and AI controls and only the applicable view commands in .txt/.json', () => {
    const { container } = renderRibbon(true)
    expect(container.querySelector('.rb-style')).toBeNull()
    for (const label of [
      strings.zh.ribbonList,
      strings.zh.ribbonInsert,
      strings.zh.sourceView,
      strings.zh.ribbonRedact,
    ]) {
      expect(button(container, label)).toBeNull()
    }
    expect(container.querySelectorAll('.ribbon-tabs .qa-btn')).toHaveLength(5)
    expect(container.querySelector('.autosave-toggle')).not.toBeNull()
    expect(button(container, strings.zh.ribbonAiActions)?.disabled).toBe(false)

    act(() => button(container, strings.zh.ribbonView)!.click())
    expect(menuButton(container, strings.zh.spellcheck)?.getAttribute('aria-checked')).toBe('true')
    expect(menuButton(container, strings.zh.mdThemeTitle)?.disabled).toBe(true)
    expect(menuButton(container, strings.zh.editorFontTitle)).toBeUndefined()
  })

  it('disables edits in Markdown source view and keeps the source toggle and host settings usable', () => {
    const open = renderRibbon(false, true).container
    const plain = renderRibbon(false).container
    expect(button(open, strings.zh.sourceView)?.getAttribute('aria-pressed')).toBe('true')
    expect(button(open, strings.zh.ribbonList)?.disabled).toBe(true)
    expect(button(plain, strings.zh.ribbonList)?.disabled).toBe(false)
    expect(button(open, strings.zh.bold)?.disabled).toBe(true)
    expect(button(plain, strings.zh.bold)?.disabled).toBe(false)

    act(() => button(open, strings.zh.ribbonInsert)!.click())
    for (const label of [strings.zh.insertTable, strings.zh.insertImage, strings.zh.insertHr]) {
      expect(menuButton(open, label)?.disabled).toBe(true)
    }
    expect(menuButton(open, strings.zh.imageHostTitle)?.disabled).toBe(false)
  })

  it('keeps Save As live in both modes and Find live only outside the source view', () => {
    const quick = (container: HTMLElement) =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('.ribbon-tabs .qa-btn'))
    const [, saveAsPlain, , , findPlain] = quick(renderRibbon(false).container)
    const [, saveAsSource, , , findSource] = quick(renderRibbon(true).container)
    const [, saveAsView, , , findView] = quick(renderRibbon(false, true).container)
    expect(saveAsPlain!.disabled).toBe(false)
    expect(saveAsSource!.disabled).toBe(false)
    expect(saveAsView!.disabled).toBe(false)
    expect(findPlain!.disabled).toBe(false)
    expect(findSource!.disabled).toBe(false)
    expect(findView!.disabled).toBe(true)
  })

  it.each([
    ['plain source', true, false, '<p>body</p>'],
    ['Markdown source view', false, true, '<p>body</p>'],
    ['empty Markdown', false, false, '<p></p>'],
  ] as const)(
    'keeps chat available and disables AI presets for %s',
    (_, sourceMode, sourceViewOpen, content) => {
      const { container, onToggleAi, onAiPreset } = renderRibbon(
        sourceMode,
        sourceViewOpen,
        content,
      )
      act(() => button(container, aiSubscriptionText('zh', 'aiAssistant'))!.click())
      expect(onToggleAi).toHaveBeenCalledOnce()

      act(() => button(container, strings.zh.ribbonAiActions)!.click())
      const entries = container.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')
      expect(entries).toHaveLength(4)
      for (const entry of entries) {
        expect(entry.disabled).toBe(true)
        act(() => entry.click())
      }
      expect(onAiPreset).not.toHaveBeenCalled()
    },
  )

  it('opens the assistant separately and uses the current editor selection for rewrite presets', () => {
    const { container, editor, onToggleAi, onAiPreset } = renderRibbon(false)
    const presets = button(container, strings.zh.ribbonAiActions)!
    expect(menuButton(container, strings.zh.aiSummarizeBtn)).toBeUndefined()
    act(() => button(container, aiSubscriptionText('zh', 'aiAssistant'))!.click())
    expect(onToggleAi).toHaveBeenCalledOnce()
    expect(onAiPreset).not.toHaveBeenCalled()

    const pick = (label: string) => {
      act(() => presets.click())
      act(() => menuButton(container, label)!.click())
      expect(presets.getAttribute('aria-expanded')).toBe('false')
    }
    pick(strings.zh.aiPolishBtn)
    expect(onAiPreset).toHaveBeenLastCalledWith(strings.zh.aiPolishPrompt)
    act(() => editor.commands.setTextSelection({ from: 1, to: 4 }))
    pick(strings.zh.aiPolishBtn)
    expect(onAiPreset).toHaveBeenLastCalledWith(strings.zh.aiPolishSelectionPrompt)
    pick(strings.zh.aiTidyBtn)
    expect(onAiPreset).toHaveBeenLastCalledWith(strings.zh.aiTidySelectionPrompt)
    pick(strings.zh.aiSummarizeBtn)
    expect(onAiPreset).toHaveBeenLastCalledWith(strings.zh.aiSummarizePrompt)
    pick(strings.zh.aiMindMapBtn)
    expect(onAiPreset).toHaveBeenLastCalledWith(strings.zh.aiMindMapPrompt)
    expect(onToggleAi).toHaveBeenCalledOnce()
  })
})
