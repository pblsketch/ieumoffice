// A scripted stand-in for Rust's AI settings commands (AI settings snapshot,
// self-hosted server, AI tool settings, AI result store, the sealed relay) and
// a harness that draws the real settings screen with the real useMobileAi, as
// App does. Nothing here reaches a network or holds a real key; the stored key
// never leaves this fake.
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { MobileAiToolSettings } from '@genoffice/mobile-bridge/ai-bridge'
import {
  createMobileClient,
  type MobileAiSettingsSnapshot,
  type MobileAppPrefs,
  type MobileAppPrefsPatch,
  type MobileTransport,
} from '@genoffice/mobile-bridge/transport'
import { useMobileAi } from '../src/renderer/ai/useMobileAi'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { SettingsScreen } from '../src/renderer/settings/SettingsScreen'
import { BackStackProvider } from '../src/renderer/shell/backStack'
import { DOC } from './ai-panel-fake'

export interface RelayStart {
  readonly requestId: string
  readonly url: string
  readonly method: string
  readonly headers: Array<[string, string]>
}

export type RelayAnswer =
  | { readonly status: number; readonly body?: string }
  | { readonly refuse: { readonly code: string; readonly messageKey: string } }
  | { readonly fail: { readonly code: string; readonly messageKey: string } }

export interface SettingsFake {
  readonly client: ReturnType<typeof createMobileClient>
  readonly commands: Array<{ command: string; args: Record<string, unknown> }>
  readonly relayStarts: RelayStart[]
  snapshot: MobileAiSettingsSnapshot
  endpoint: {
    baseUrl: string | null
    key: string | null
    model: string | null
    models: string[]
  }
  toolSettings: MobileAiToolSettings
  results: { bytes: number; files: number }
  relay: (start: RelayStart) => RelayAnswer
}

export const TOOLS_DEFAULT: MobileAiToolSettings = {
  internetTools: true,
  imageGeneration: false,
  imageProvider: null,
  imageModel: null,
  imageProvidersReady: [],
}

export const EMPTY_SNAPSHOT: MobileAiSettingsSnapshot = {
  selectedProvider: 'auto',
  modelByProvider: {},
  configuredProviders: {},
  chatgptVisible: false,
  subscriptionNoticeVersion: 0,
}

const refusal = (messageKey: string, code = 'INVALID_ARGUMENT') => ({ code, messageKey })

export function makeSettingsFake(init: Partial<Omit<SettingsFake, 'client'>> = {}): SettingsFake {
  let relayListener: ((payload: unknown) => void) | null = null
  const fake: Omit<SettingsFake, 'client'> = {
    commands: [],
    relayStarts: [],
    snapshot: EMPTY_SNAPSHOT,
    endpoint: { baseUrl: null, key: null, model: null, models: [] },
    toolSettings: TOOLS_DEFAULT,
    results: { bytes: 0, files: 0 },
    relay: () => ({ refuse: refusal('test.noScript', 'INTERNAL_ERROR') }),
    ...init,
  }

  const endpointView = () => ({
    baseUrl: fake.endpoint.baseUrl,
    hasKey: Boolean(fake.endpoint.key),
    model: fake.endpoint.model,
    models: [...fake.endpoint.models],
  })
  const syncSnapshot = () => {
    const configured = { ...fake.snapshot.configuredProviders }
    const models = { ...fake.snapshot.modelByProvider }
    if (fake.endpoint.baseUrl) {
      configured.custom = { hasKey: Boolean(fake.endpoint.key), models: [...fake.endpoint.models] }
    } else {
      delete configured.custom
    }
    if (fake.endpoint.model) models.custom = fake.endpoint.model
    else delete models.custom
    fake.snapshot = { ...fake.snapshot, configuredProviders: configured, modelByProvider: models }
  }

  const emit = (requestId: string, answer: RelayAnswer) => {
    let seq = 0
    const send = (body: Record<string, unknown>) =>
      relayListener?.({ requestId, seq: seq++, ...body })
    if ('fail' in answer) {
      send({ type: 'error', ...answer.fail })
      return
    }
    if ('refuse' in answer) return
    send({ type: 'head', status: answer.status, headers: [['content-type', 'application/json']] })
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
          const selected = args.selectedProvider
          if (selected === 'custom' && !fake.endpoint.baseUrl) {
            throw refusal('mobile.ai.customNotConfigured')
          }
          if (typeof selected === 'string') {
            fake.snapshot = { ...fake.snapshot, selectedProvider: selected }
          }
          return fake.snapshot as T
        }
        case 'mobile_chatgpt_status':
          return { state: 'hidden' } as T
        case 'mobile_ai_get_custom_endpoint':
          return endpointView() as T
        case 'mobile_ai_set_custom_endpoint': {
          // the same form check as Rust's validate_custom_base_url
          let url: URL
          try {
            url = new URL(String(args.baseUrl ?? '').trim())
          } catch {
            throw refusal('mobile.ai.customInvalidUrl')
          }
          if (url.protocol !== 'https:') throw refusal('mobile.ai.customHttpsOnly')
          if (url.username || url.password) throw refusal('mobile.ai.customCredentials')
          fake.endpoint.baseUrl = url.toString()
          if (typeof args.apiKey === 'string') fake.endpoint.key = args.apiKey.trim() || null
          if (typeof args.model === 'string') fake.endpoint.model = args.model.trim() || null
          if (Array.isArray(args.models)) fake.endpoint.models = args.models.map(String)
          syncSnapshot()
          return endpointView() as T
        }
        case 'mobile_ai_clear_custom_endpoint':
          fake.endpoint = { baseUrl: null, key: null, model: null, models: [] }
          if (fake.snapshot.selectedProvider === 'custom') {
            fake.snapshot = { ...fake.snapshot, selectedProvider: 'auto' }
          }
          syncSnapshot()
          return endpointView() as T
        case 'mobile_ai_get_tool_settings':
          return fake.toolSettings as T
        case 'mobile_ai_set_tool_settings': {
          const next = { ...fake.toolSettings }
          if (typeof args.internetTools === 'boolean') next.internetTools = args.internetTools
          if (typeof args.imageProvider === 'string') {
            if (args.imageProvider && !['openai', 'gemini'].includes(args.imageProvider)) {
              throw refusal('mobile.ai.imageProviderNotAllowed')
            }
            const provider = (args.imageProvider || null) as MobileAiToolSettings['imageProvider']
            if (provider !== next.imageProvider && typeof args.imageModel !== 'string') {
              next.imageModel = null
            }
            next.imageProvider = provider
          }
          if (typeof args.imageModel === 'string') next.imageModel = args.imageModel.trim() || null
          if (args.imageGeneration === true) {
            if (!next.imageProvider) throw refusal('mobile.ai.imageProviderMissing')
            if (!next.imageProvidersReady.includes(next.imageProvider)) {
              throw refusal('mobile.ai.imageProviderNoKey')
            }
            if (!next.imageModel) throw refusal('mobile.ai.imageModelMissing')
          }
          if (typeof args.imageGeneration === 'boolean') next.imageGeneration = args.imageGeneration
          fake.toolSettings = next
          return next as T
        }
        case 'mobile_ai_results_size':
          return { ...fake.results } as T
        case 'mobile_ai_results_clear':
          fake.results = { bytes: 0, files: 0 }
          return { ...fake.results } as T
        case 'mobile_ai_relay_start': {
          const start: RelayStart = {
            requestId: String(args.requestId),
            url: String(args.url),
            method: String(args.method ?? 'GET'),
            headers: (args.headers as Array<[string, string]> | undefined) ?? [],
          }
          fake.relayStarts.push(start)
          const answer = fake.relay(start)
          if ('refuse' in answer) throw answer.refuse
          setTimeout(() => emit(start.requestId, answer), 0)
          return { ok: true } as T
        }
        case 'mobile_ai_relay_cancel':
          return { ok: true } as T
        default:
          return { ok: true } as T
      }
    },
    async listen<T>(event: string, handler: (payload: T) => void) {
      if (event !== 'mobile:ai-relay-event') return () => {}
      relayListener = handler as (payload: unknown) => void
      return () => {
        relayListener = null
      }
    },
  }
  return Object.assign(fake, { client: createMobileClient(transport) })
}

const roots: Root[] = []

export function unmountAll(): void {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
}

export const settle = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)))

export interface MountedSettings {
  readonly prefs: () => MobileAppPrefs
}

/** The settings screen as App draws it: useMobileAi's settings props and slot. */
export async function mountSettings(
  fake: SettingsFake,
  options: { aiEnabled?: boolean } = {},
): Promise<MountedSettings> {
  const holder: { prefs: MobileAppPrefs | null } = { prefs: null }
  function Harness() {
    const [prefs, setPrefs] = useState<MobileAppPrefs>({
      lang: 'ko',
      theme: 'system',
      hwpDefaultFormat: 'hwp',
      aiEnabled: options.aiEnabled ?? true,
    })
    holder.prefs = prefs
    const ai = useMobileAi({
      client: fake.client,
      aiEnabled: prefs.aiEnabled,
      canMutate: true,
      getActiveDoc: () => DOC,
      getOpenedDocument: () => null,
      getMode: () => 'edit',
      setModeEdit: () => {},
      getLang: () => 'ko',
      openSettings: () => {},
    })
    return (
      <SettingsScreen
        {...ai.settingsProps}
        prefs={prefs}
        backups={[]}
        onBack={() => {}}
        onUpdatePrefs={(patch: MobileAppPrefsPatch) => setPrefs((prev) => ({ ...prev, ...patch }))}
        onRestoreBackup={async () => {}}
        onDeleteBackup={async () => {}}
        aiSlot={ai.settingsSlot}
      />
    )
  }
  const div = document.createElement('div')
  document.body.appendChild(div)
  const root = createRoot(div)
  roots.push(root)
  await act(async () => {
    root.render(
      <MobileLocaleProvider lang="ko">
        <BackStackProvider>
          <Harness />
        </BackStackProvider>
      </MobileLocaleProvider>,
    )
  })
  await settle()
  return { prefs: () => holder.prefs! }
}

export const byTestId = <T extends Element = HTMLElement>(id: string): T | null =>
  document.querySelector<T>(`[data-testid="${id}"]`)

export async function click(el: Element | null): Promise<void> {
  if (!el) throw new Error('nothing to click')
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await settle()
}

export async function typeInto(el: Element | null, value: string): Promise<void> {
  if (!(el instanceof HTMLInputElement)) throw new Error('not an input')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

export async function choose(el: Element | null, value: string): Promise<void> {
  if (!(el instanceof HTMLSelectElement)) throw new Error('not a select')
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await settle()
}

export function commandsNamed(fake: SettingsFake, command: string) {
  return fake.commands.filter((c) => c.command === command)
}

export function headerOf(start: RelayStart, name: string): string | undefined {
  return start.headers.find(([n]) => n.toLowerCase() === name)?.[1]
}
