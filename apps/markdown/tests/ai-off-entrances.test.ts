// Settings › Editors and AI: while AI is off the Markdown ribbon has no AI
// entry (assistant, one-click AI actions, withholding from AI); turning AI back
// on brings them back without a reload. The choice comes in through the same
// provider main.tsx mounts, fed by a fake of the preload's read-and-hear bridge.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { aiSubscriptionText, type AppChoiceSource, type AppChoiceState } from '@genoffice/ui'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { Ribbon } from '../src/renderer/components/Ribbon'
import { AiVisibilityProvider } from '../src/renderer/ai-visibility'
import { t } from '../src/renderer/i18n/locale'

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
})

const choice = (aiFeatures: boolean): AppChoiceState => ({ off: [], aiFeatures, locked: false })

function fakeSource(current: AppChoiceState) {
  const listeners = new Set<(c: AppChoiceState) => void>()
  const source: AppChoiceSource = {
    get: async () => current,
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    source,
    change(next: AppChoiceState) {
      current = next
      for (const listener of listeners) listener(next)
    },
  }
}

async function renderRibbon(source: AppChoiceSource, initial: AppChoiceState) {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
      slashItems: () => [],
    }),
    content: '<p>body</p>',
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const ribbon = createElement(Ribbon, {
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
    onToggleAi: vi.fn(),
    onAiPreset: vi.fn(),
    redactEnabled: false,
    onToggleRedact: vi.fn(),
  })
  await act(async () => {
    root.render(createElement(AiVisibilityProvider, { source, initial, children: ribbon }))
  })
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
    editor.destroy()
  })
  return container
}

const aiEntrances = (container: HTMLElement) =>
  [aiSubscriptionText('zh', 'aiAssistant'), t('ribbonAiActions'), t('ribbonRedact')].flatMap(
    (label) => {
      const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
      return button ? [button] : []
    },
  )

describe('Markdown ribbon AI entrances follow the AI switch', () => {
  it('shows none while AI is off, and all of them once AI is turned on', async () => {
    const bridge = fakeSource(choice(false))
    const container = await renderRibbon(bridge.source, choice(false))
    expect(aiEntrances(container)).toHaveLength(0)
    expect(container.querySelector('.rb-style')).not.toBeNull()

    await act(async () => bridge.change(choice(true)))
    const entrances = aiEntrances(container)
    expect(entrances).toHaveLength(3)
    act(() => entrances[1]!.click())
    expect(container.querySelectorAll('[role="menuitem"]')).toHaveLength(4)

    await act(async () => bridge.change(choice(false)))
    expect(aiEntrances(container)).toHaveLength(0)
    expect(container.querySelector('[role="menu"]')).toBeNull()
  })

  it('draws no AI entry before the first answer when the start value is off', async () => {
    const silent: AppChoiceSource = { get: () => new Promise(() => {}), onChange: () => () => {} }
    const container = await renderRibbon(silent, choice(false))
    expect(aiEntrances(container)).toHaveLength(0)
  })
})
