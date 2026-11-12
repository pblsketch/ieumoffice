/** @vitest-environment jsdom */
// The HWP AI panel before a send (민감정보 가리기): a document whose hidden spans cannot all be
// placed sends nothing and says why; the tab's first send asks once about what looks
// sensitive, "Review" sends nothing and opens the list, "Send anyway" lets it go, and the tab
// is not asked again. No provider is reached: nothing is connected here, so a send that goes
// through ends at the connect prompt.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { defaultAiSettings } from '@genoffice/ai-provider'
import { createSensitiveSendCheck } from '@genoffice/ui'
import { AiPanel } from '../src/renderer/ai/AiPanel'
import type { AgentBridge } from '../src/renderer/ai/agent-bridge'
import type { HwpSensitiveGuard } from '../src/renderer/sensitive-info'

let container: HTMLElement
let root: Root | null = null
const streamed: unknown[] = []

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Element.prototype.scrollTo = () => undefined
  container = document.createElement('div')
  document.body.appendChild(container)
  Object.assign(window, {
    hwpApi: {
      getAiSettings: async () => defaultAiSettings(),
      setAiSettings: async () => undefined,
      onAiSettingsChanged: () => () => undefined,
      openAiModelSettings: vi.fn(async () => undefined),
      setAiPanelPrefs: vi.fn(async () => ({})),
      pickAttachments: async () => ({ accepted: [], rejected: [] }),
      addAttachmentPaths: async () => ({ accepted: [], rejected: [] }),
      addPastedImage: async () => ({ accepted: [], rejected: [] }),
      getPathForFile: () => '',
      readAttachmentImage: async () => ({ ok: false }),
      onAiStream: () => () => undefined,
      aiStream: async (...args: unknown[]) => {
        streamed.push(args)
      },
      aiStreamCancel: async () => undefined,
    },
  })
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  container.remove()
  streamed.length = 0
  delete (window as { hwpApi?: unknown }).hwpApi
  vi.unstubAllGlobals()
})

async function settle(turns = 10): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

const bridgeWith = (state: unknown) =>
  ({ hidingState: vi.fn(async () => state) }) as unknown as AgentBridge

async function sendWith(
  bridge: AgentBridge,
  sensitive: HwpSensitiveGuard | undefined,
  nonce: number,
): Promise<void> {
  await act(async () => {
    root!.render(
      createElement(AiPanel, {
        bridge,
        filePath: null,
        onCollapse: () => undefined,
        prefill: { text: '요약해 주세요.', nonce, autoRun: true },
        ...(sensitive ? { sensitive } : {}),
      }),
    )
  })
  await settle()
}

const composer = () => container.querySelector('textarea')?.value
const connectPrompt = () => container.querySelector('.ai-sub-prompt')
const alertBox = () => container.querySelector('.gs-sens-alert')
const button = (index: number) =>
  container.querySelectorAll<HTMLButtonElement>('.gs-sens-alert .gs-sens-btn')[index]!

describe('hwp AI panel: before a send', () => {
  it('sends nothing for a document whose hidden spans cannot be placed, and says why', async () => {
    root = createRoot(container)
    await sendWith(bridgeWith({ ok: false, reason: 'unplaced', count: 1 }), undefined, 1)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('AI')
    expect(connectPrompt()).toBeNull()
    expect(composer()).toBe('요약해 주세요.')
    expect(streamed).toEqual([])
  })

  it('also sends nothing when it cannot tell (the check failed)', async () => {
    root = createRoot(container)
    const bridge = {
      hidingState: vi.fn(async () => {
        throw new Error('the editor is not ready')
      }),
    } as unknown as AgentBridge
    await sendWith(bridge, undefined, 2)
    expect(connectPrompt()).toBeNull()
    expect(streamed).toEqual([])
  })

  it('asks once on the first send: Review sends nothing and opens the list', async () => {
    root = createRoot(container)
    const review = vi.fn()
    const count = vi.fn(async () => ({ documentCount: 2, attachmentCount: 0 }))
    const guard: HwpSensitiveGuard = { check: createSensitiveSendCheck(), count, review }
    await sendWith(bridgeWith({ ok: true, count: 0, labels: [] }), guard, 3)
    expect(alertBox()).not.toBeNull()
    expect(count).toHaveBeenCalledWith([])
    await act(async () => button(0).click())
    await settle()
    expect(review).toHaveBeenCalledTimes(1)
    expect(connectPrompt()).toBeNull()
    expect(composer()).toBe('요약해 주세요.')
    // the tab was answered: the next send is not asked again
    await sendWith(bridgeWith({ ok: true, count: 0, labels: [] }), guard, 4)
    expect(alertBox()).toBeNull()
    expect(count).toHaveBeenCalledTimes(1)
    expect(connectPrompt()).not.toBeNull()
  })

  it('lets the send go on "Send anyway"', async () => {
    root = createRoot(container)
    const guard: HwpSensitiveGuard = {
      check: createSensitiveSendCheck(),
      count: async () => ({ documentCount: 0, attachmentCount: 3 }),
      review: vi.fn(),
    }
    await sendWith(bridgeWith({ ok: true, count: 1, labels: ['이름'] }), guard, 5)
    expect(alertBox()).not.toBeNull()
    await act(async () => button(1).click())
    await settle()
    expect(alertBox()).toBeNull()
    expect(guard.review).not.toHaveBeenCalled()
    // through to the usual gate, which answers "not connected" here
    expect(connectPrompt()).not.toBeNull()
  })
})
