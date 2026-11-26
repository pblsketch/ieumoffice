// A harness for the AI sheet tests (track T7 AI-T5): useMobileAi mounted with a
// scripted Rust (AI settings, tool settings, the sealed relay) and a scripted
// document. Nothing here reaches a network or holds a key: the relay answers
// with provider-shaped SSE written in the tests.
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AgentSkill, ToolExecution } from '@genoffice/agent-core'
import type { Lang } from '@genoffice/i18n'
import type { MobileAiToolSettings } from '@genoffice/mobile-bridge/ai-bridge'
import type { ActiveDocState } from '@genoffice/mobile-bridge/session-state'
import {
  createMobileClient,
  type MobileAiSettingsSnapshot,
  type MobileTransport,
} from '@genoffice/mobile-bridge/transport'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { BackStackProvider } from '../src/renderer/shell/backStack'
import type {
  EditorAiContext,
  EditorAiRun,
  EditorDocument,
} from '../src/renderer/editors/editorKind'
import { useMobileAi, type MobileAi } from '../src/renderer/ai/useMobileAi'
import { SSE_HEADERS, sse } from './ai-tools-fake'

export const DOC: ActiveDocState = {
  session: {
    sessionId: 's1',
    docKey: 'doc-1',
    name: 'a.md',
    ext: 'md',
    format: 'md',
    writable: true,
    ephemeral: false,
  },
  dirty: false,
  encrypted: false,
  distribution: false,
  trackingDropped: false,
  isUntitled: false,
}

export const FREE_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free'

export function freeOpenRouter(
  model = FREE_MODEL,
  listed: readonly string[] = [],
): MobileAiSettingsSnapshot {
  return {
    selectedProvider: 'openrouter',
    modelByProvider: { openrouter: model },
    configuredProviders: { openrouter: { hasKey: true, freeOnly: true, models: [...listed] } },
    chatgptVisible: false,
    subscriptionNoticeVersion: 0,
  }
}

export function keyProvider(provider: string, model: string): MobileAiSettingsSnapshot {
  return {
    selectedProvider: provider,
    modelByProvider: { [provider]: model },
    configuredProviders: { [provider]: { hasKey: true, models: [model] } },
    chatgptVisible: false,
    subscriptionNoticeVersion: 0,
  }
}

export const TOOLS_OFF: MobileAiToolSettings = {
  internetTools: false,
  imageGeneration: false,
  imageProvider: null,
  imageModel: null,
  imageProvidersReady: [],
}

export interface RelayStart {
  readonly requestId: string
  readonly url: string
  readonly body: string
}

export type RelayReply =
  | { readonly status: number; readonly headers?: Array<[string, string]>; readonly body?: string }
  | { readonly refuse: { readonly code: string; readonly messageKey: string } }
  | { readonly fail: { readonly code: string; readonly messageKey: string } }

/** A reply, or a promise of one (the turn waits until the test settles it), or 'hang' (never). */
export type RelayScript = (
  start: RelayStart,
  index: number,
) => RelayReply | Promise<RelayReply> | 'hang'

export const textTurn = (text: string) =>
  sse([{ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }], true)

export function toolCallTurn(name: string, input: unknown): string {
  return sse(
    [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: `call_${name}`,
                  function: { name, arguments: JSON.stringify(input) },
                },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ],
    true,
  )
}

export const reply = (body: string): RelayReply => ({ status: 200, headers: SSE_HEADERS, body })

export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

export interface FakeAiRust {
  readonly client: ReturnType<typeof createMobileClient>
  readonly commands: Array<{ command: string; args: Record<string, unknown> }>
  readonly relayStarts: RelayStart[]
  readonly relayCancels: string[]
  snapshot: MobileAiSettingsSnapshot
  toolSettings: MobileAiToolSettings
  relay: RelayScript
}

export function makeFakeAiRust(init: {
  snapshot?: MobileAiSettingsSnapshot
  toolSettings?: MobileAiToolSettings
  relay?: RelayScript
}): FakeAiRust {
  let listener: ((payload: unknown) => void) | null = null
  const fake = {
    commands: [] as Array<{ command: string; args: Record<string, unknown> }>,
    relayStarts: [] as RelayStart[],
    relayCancels: [] as string[],
    snapshot: init.snapshot ?? freeOpenRouter(),
    toolSettings: init.toolSettings ?? TOOLS_OFF,
    relay: init.relay ?? (() => reply(textTurn('Done.'))),
  }
  const emitReply = (requestId: string, answer: RelayReply) => {
    if (fake.relayCancels.includes(requestId)) return
    let seq = 0
    const send = (body: Record<string, unknown>) => listener?.({ requestId, seq: seq++, ...body })
    if ('fail' in answer) {
      send({ type: 'error', ...answer.fail })
      return
    }
    if ('refuse' in answer) return
    send({ type: 'head', status: answer.status, headers: answer.headers ?? [] })
    if (answer.body) {
      send({ type: 'chunk', dataBase64: Buffer.from(answer.body).toString('base64') })
    }
    send({ type: 'end' })
  }

  const transport: MobileTransport = {
    async invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
      fake.commands.push({ command, args })
      switch (command) {
        case 'mobile_get_ai_settings':
          return fake.snapshot as T
        case 'mobile_set_ai_settings': {
          const patch = args as {
            selectedProvider?: string
            modelPatch?: { provider: string; model: string }
          }
          fake.snapshot = {
            ...fake.snapshot,
            ...(patch.selectedProvider ? { selectedProvider: patch.selectedProvider } : {}),
            ...(patch.modelPatch
              ? {
                  modelByProvider: {
                    ...fake.snapshot.modelByProvider,
                    [patch.modelPatch.provider]: patch.modelPatch.model,
                  },
                }
              : {}),
          }
          return fake.snapshot as T
        }
        case 'mobile_chatgpt_status':
          return { state: 'hidden' } as T
        case 'mobile_ai_get_tool_settings':
          return fake.toolSettings as T
        case 'mobile_ai_relay_start': {
          const start: RelayStart = {
            requestId: String(args.requestId),
            url: String(args.url),
            body: typeof args.body === 'string' ? args.body : '',
          }
          const index = fake.relayStarts.length
          fake.relayStarts.push(start)
          const answer = fake.relay(start, index)
          if (answer === 'hang') return { ok: true } as T
          if (!(answer instanceof Promise) && 'refuse' in answer) throw answer.refuse
          void Promise.resolve(answer).then((settled) =>
            setTimeout(() => emitReply(start.requestId, settled), 0),
          )
          return { ok: true } as T
        }
        case 'mobile_ai_relay_cancel':
          fake.relayCancels.push(String(args.requestId))
          return { ok: true } as T
        default:
          return { ok: true } as T
      }
    },
    async listen<T>(event: string, handler: (payload: T) => void) {
      if (event !== 'mobile:ai-relay-event') return () => {}
      listener = handler as (payload: unknown) => void
      return () => {
        listener = null
      }
    },
  }
  return Object.assign(fake, { client: createMobileClient(transport) })
}

/** The document's skill: one editing tool; what it does is up to the test. */
export function editSkill(
  execute: (name: string) => ToolExecution | Promise<ToolExecution>,
  extra: Partial<AgentSkill> = {},
): AgentSkill {
  return {
    id: 'doc',
    systemPrompt: 'You edit documents.',
    tools: [{ name: 'edit_doc', description: 'edit', inputSchema: { type: 'object' } }],
    executeTool: (call) => execute(call.name),
    ...extra,
  }
}

export interface DocScript {
  createAiRun?: (ctx: EditorAiContext) => Promise<EditorAiRun>
  aiAvailable?: boolean
}

export interface Mounted {
  readonly rust: FakeAiRust
  readonly ai: () => MobileAi
  readonly contexts: EditorAiContext[]
  readonly openSettings: { calls: number }
  setAiEnabled(on: boolean): Promise<void>
  setDoc(script: DocScript): void
}

const roots: Root[] = []

export function unmountAll(): void {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
}

export const settle = (ms = 40) => act(async () => new Promise((r) => setTimeout(r, ms)))

export async function mountAi(
  rust: FakeAiRust,
  options: { doc?: DocScript; lang?: Lang; aiEnabled?: boolean } = {},
): Promise<Mounted> {
  const contexts: EditorAiContext[] = []
  let script: DocScript = options.doc ?? {
    createAiRun: async () => ({ skill: editSkill(() => ({ output: 'ok', summary: 'edit' })) }),
  }
  const editorDoc = (): EditorDocument =>
    ({
      ...(script.aiAvailable === false ? { aiAvailable: false } : {}),
      createAiRun: script.createAiRun
        ? async (ctx: EditorAiContext) => {
            contexts.push(ctx)
            return script.createAiRun!(ctx)
          }
        : undefined,
    }) as unknown as EditorDocument
  const holder: { ai: MobileAi | null; setOn: ((on: boolean) => void) | null } = {
    ai: null,
    setOn: null,
  }
  const openSettings = { calls: 0 }
  function Harness() {
    const [on, setOn] = useState(options.aiEnabled ?? true)
    holder.setOn = setOn
    const ai = useMobileAi({
      client: rust.client,
      aiEnabled: on,
      canMutate: true,
      getActiveDoc: () => DOC,
      getOpenedDocument: () => editorDoc(),
      getMode: () => 'edit',
      setModeEdit: () => {},
      getLang: () => options.lang ?? 'ko',
      openSettings: () => {
        openSettings.calls += 1
      },
    })
    holder.ai = ai
    return ai.panel
  }
  const div = document.createElement('div')
  document.body.appendChild(div)
  const root = createRoot(div)
  roots.push(root)
  await act(async () => {
    root.render(
      <MobileLocaleProvider lang={options.lang ?? 'ko'}>
        <BackStackProvider>
          <Harness />
        </BackStackProvider>
      </MobileLocaleProvider>,
    )
  })
  await act(async () => holder.ai!.refreshAiState())
  return {
    rust,
    ai: () => holder.ai!,
    contexts,
    openSettings,
    async setAiEnabled(on) {
      await act(async () => holder.setOn?.(on))
    },
    setDoc(next) {
      script = next
    },
  }
}

export const q = <T extends Element = HTMLElement>(selector: string): T | null =>
  document.querySelector<T>(selector)

export const byTestId = <T extends Element = HTMLElement>(id: string): T | null =>
  q<T>(`[data-testid="${id}"]`)

export async function click(el: Element | null): Promise<void> {
  if (!el) throw new Error('nothing to click')
  await act(async () => {
    ;(el as HTMLElement).click()
  })
}

export function composer(): HTMLInputElement {
  const input = q<HTMLInputElement>('.mobile-ai-composer-input')
  if (!input) throw new Error('no composer')
  return input
}

/** Types into the composer and submits it, as a person would. */
export async function typeAndSend(text: string): Promise<void> {
  const input = composer()
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

/** Waits (real time) until `check` holds, up to `ms`. */
export async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out')
    await settle(20)
  }
}

export const messageTexts = (): string[] =>
  [...document.querySelectorAll('[data-testid="ai-message-list"] .mobile-ai-bubble')].map(
    (el) => el.textContent ?? '',
  )

/** The JSON body of a relay request (OpenAI-compatible chat). */
export function relayJson(start: RelayStart): {
  model: string
  messages: Array<{ role: string; content: unknown }>
} {
  return JSON.parse(start.body) as {
    model: string
    messages: Array<{ role: string; content: unknown }>
  }
}
