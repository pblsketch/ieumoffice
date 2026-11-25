import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMobileClient,
  type MobileAiSettingsSnapshot,
  type MobileAiStreamChunk,
  type MobileAppPrefs,
  type MobileTransport,
} from '@genoffice/mobile-bridge/transport'
import type { EditorKind } from '../src/renderer/editors/editorKind'
import { MobileApp } from '../src/renderer/App'

// Pins the AI run App hands its documents (moved into useMobileAi for track T7):
// the AI-off gate, a kind without createAiRun, a failed preparation, the reset on a
// document change and the cancel when the app goes to the background.
// Every stream here is a scripted mock; no provider or key is ever called.

type AiRunMode = 'normal' | 'absent' | 'throw'

const aiRun = vi.hoisted(() => ({ mode: 'normal' as AiRunMode }))

vi.mock('../src/renderer/editors/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/renderer/editors/registry')>()
  const wrap = (kind: EditorKind): EditorKind => ({
    ...kind,
    async open(request) {
      const opened = await kind.open(request)
      return {
        ...opened,
        start(host) {
          const doc = opened.start(host)
          if (aiRun.mode === 'absent') return { ...doc, createAiRun: undefined }
          if (aiRun.mode === 'throw') {
            return {
              ...doc,
              createAiRun: async () => {
                throw new Error('tools not ready')
              },
            }
          }
          return doc
        },
      }
    },
  })
  return {
    ...actual,
    findEditorKind: (format: Parameters<typeof actual.findEditorKind>[0]) => {
      const kind = actual.findEditorKind(format)
      return kind ? wrap(kind) : null
    },
  }
})

type StreamScript = 'reply' | 'hang'

function makeTransport(options: { aiEnabled: boolean; stream: StreamScript }) {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  let prefs: MobileAppPrefs = {
    lang: 'ko',
    theme: 'system',
    hwpDefaultFormat: 'hwp',
    aiEnabled: options.aiEnabled,
  }
  // An explicitly chosen free OpenRouter key: the send gate lets the run through.
  const aiSettings: MobileAiSettingsSnapshot = {
    selectedProvider: 'openrouter',
    modelByProvider: { openrouter: 'meta-llama/llama-3.3-70b-instruct:free' },
    configuredProviders: {
      openrouter: {
        hasKey: true,
        freeOnly: true,
        models: ['meta-llama/llama-3.3-70b-instruct:free'],
      },
    },
    chatgptVisible: false,
    subscriptionNoticeVersion: 0,
  }
  let untitled = 0
  let chunkListener: ((chunk: MobileAiStreamChunk) => void) | null = null

  const transport: MobileTransport = {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      calls.push({ command, args })
      switch (command) {
        case 'mobile_get_app_prefs':
          return prefs as T
        case 'mobile_set_app_prefs':
          prefs = { ...prefs, ...(args as Partial<MobileAppPrefs>) }
          return prefs as T
        case 'mobile_get_ai_settings':
        case 'mobile_set_ai_settings':
          return aiSettings as T
        case 'mobile_chatgpt_status':
          return { state: 'hidden' } as T
        case 'mobile_list_recent_docs':
        case 'mobile_recovery_list':
        case 'mobile_hwp_backup_list':
          return [] as T
        case 'mobile_consume_pending_open_intent':
          return null as T
        case 'mobile_create_untitled_session':
          untitled += 1
          return {
            sessionId: `untitled-${untitled}`,
            docKey: `untitled-key-${untitled}`,
            name: 'Untitled.md',
            ext: 'md',
            format: 'md',
            writable: false,
            ephemeral: false,
          } as T
        case 'mobile_ai_stream_start': {
          const requestId = String((args as { requestId: string }).requestId)
          if (options.stream === 'reply') {
            queueMicrotask(() => {
              chunkListener?.({ requestId, type: 'delta', text: 'Mock reply' })
              chunkListener?.({ requestId, type: 'done', stopReason: 'end_turn' })
            })
          }
          return { ok: true } as T
        }
        default:
          return { ok: true } as T
      }
    },
    async listen<T>(event: string, handler: (payload: T) => void) {
      if (event !== 'mobile:ai-stream-chunk') return () => {}
      chunkListener = handler as (chunk: MobileAiStreamChunk) => void
      return () => {
        chunkListener = null
      }
    },
  }
  return { client: createMobileClient(transport), calls }
}

const containers: HTMLElement[] = []
const originalWidth = window.innerWidth

beforeEach(() => {
  aiRun.mode = 'normal'
  // phone layout: the AI opens in a sheet from the quick toolbar
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
})

afterEach(() => {
  while (containers.length > 0) containers.pop()?.remove()
  Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true })
  Reflect.deleteProperty(document, 'visibilityState')
})

const settle = () => new Promise((r) => setTimeout(r, 30))

async function renderApp(client: ReturnType<typeof createMobileClient>): Promise<HTMLElement> {
  const div = document.createElement('div')
  document.body.appendChild(div)
  containers.push(div)
  const root = createRoot(div)
  await act(async () => {
    root.render(<MobileApp client={client} />)
    await settle()
  })
  return div
}

async function click(el: Element | null) {
  expect(el).not.toBeNull()
  await act(async () => {
    ;(el as HTMLElement).click()
    await settle()
  })
}

async function newMarkdown(div: HTMLElement) {
  await click(div.querySelector('[data-testid="home-new-md-btn"]'))
  expect(div.querySelector('[data-editor="markdown"]')).not.toBeNull()
}

async function sendPrompt(div: HTMLElement, prompt: string) {
  await click(div.querySelector('[data-testid="phone-ai-open-btn"]'))
  const input = div.querySelector<HTMLInputElement>('.mobile-ai-composer-input')
  expect(input).not.toBeNull()
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, prompt)
    input!.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    input!.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
  })
}

const streamStarts = (calls: Array<{ command: string }>) =>
  calls.filter((c) => c.command === 'mobile_ai_stream_start').length

describe('the mobile AI run', () => {
  it('keeps every AI entry point hidden and sends nothing while AI is off', async () => {
    const { client, calls } = makeTransport({ aiEnabled: false, stream: 'reply' })
    const div = await renderApp(client)
    await newMarkdown(div)
    expect(div.querySelector('[data-testid="phone-ai-open-btn"]')).toBeNull()
    expect(div.querySelector('[data-testid="phone-view-ai-btn"]')).toBeNull()
    expect(div.querySelector('[data-testid="mobile-ai-panel"]')).toBeNull()
    expect(streamStarts(calls)).toBe(0)
  })

  it('answers through the mock stream and clears the conversation on the next document', async () => {
    const { client, calls } = makeTransport({ aiEnabled: true, stream: 'reply' })
    const div = await renderApp(client)
    await newMarkdown(div)
    await sendPrompt(div, 'Summarize this')
    expect(streamStarts(calls)).toBe(1)
    const list = div.querySelector('[data-testid="ai-message-list"]')!
    expect(list.textContent).toContain('Summarize this')
    expect(list.textContent).toContain('Mock reply')

    await click(div.querySelector('[data-testid="editor-back-btn"]'))
    await newMarkdown(div)
    await click(div.querySelector('[data-testid="phone-ai-open-btn"]'))
    const fresh = div.querySelector('[data-testid="ai-message-list"]')!
    expect(fresh.textContent).not.toContain('Summarize this')
    expect(fresh.textContent).not.toContain('Mock reply')
  })

  it('does not start a stream for a document without createAiRun', async () => {
    aiRun.mode = 'absent'
    const { client, calls } = makeTransport({ aiEnabled: true, stream: 'reply' })
    const div = await renderApp(client)
    await newMarkdown(div)
    await sendPrompt(div, 'Summarize this')
    expect(streamStarts(calls)).toBe(0)
    expect(div.querySelector('[data-testid="ai-message-list"]')!.textContent).not.toContain(
      'Summarize this',
    )
    expect(div.querySelector('[data-testid="ai-recovery-error"]')).toBeNull()
  })

  it('shows the connection-error notice when the document fails to prepare its tools', async () => {
    aiRun.mode = 'throw'
    const { client, calls } = makeTransport({ aiEnabled: true, stream: 'reply' })
    const div = await renderApp(client)
    await newMarkdown(div)
    await sendPrompt(div, 'Summarize this')
    expect(streamStarts(calls)).toBe(0)
    expect(div.querySelector('[data-testid="ai-recovery-error"]')).not.toBeNull()
    expect(div.querySelector('[data-testid="ai-message-list"]')!.textContent).toContain(
      'Summarize this',
    )
    // not streaming any more: the send button is back in place of stop
    expect(div.querySelector('.mobile-ai-composer button[type="submit"]')).not.toBeNull()
  })

  it('cancels the running stream when the app goes to the background', async () => {
    const { client, calls } = makeTransport({ aiEnabled: true, stream: 'hang' })
    const div = await renderApp(client)
    await newMarkdown(div)
    await sendPrompt(div, 'Summarize this')
    expect(streamStarts(calls)).toBe(1)
    expect(div.querySelector('.mobile-ai-composer button[type="submit"]')).toBeNull()

    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      await settle()
    })
    expect(calls.some((c) => c.command === 'mobile_ai_stream_cancel')).toBe(true)
    expect(div.querySelector('.mobile-ai-composer button[type="submit"]')).not.toBeNull()
  })
})
