// A scripted stand-in for Rust's AI commands (search, public address, relay,
// tool settings, result store), shared by the AI tool tests. Nothing here
// reaches a network or holds a key: the webview only ever sees the
// `__sealed__:<id>` placeholder.
import {
  createMobileClient,
  type MobileAiSettingsSnapshot,
  type MobileClient,
  type MobileTransport,
} from '@genoffice/mobile-bridge/transport'
import type { MobileAiToolSettings } from '@genoffice/mobile-bridge/ai-bridge'

export interface NetStart {
  readonly command: string
  readonly requestId: string
  readonly url: string
  readonly method: string
  readonly headers: Array<[string, string]>
  readonly body?: string
}

export type NetReply =
  | {
      readonly status: number
      readonly headers?: Array<[string, string]>
      readonly body?: string | Uint8Array
      /** head.url of a public address request (the address after redirects) */
      readonly url?: string
      readonly contentType?: string | null
    }
  /** refused before any network work: the start rejects, no events */
  | { readonly refuse: { readonly code: string; readonly messageKey: string } }
  /** failed after the start: an `error` event and a rejection with the same code */
  | { readonly fail: { readonly code: string; readonly messageKey: string } }
  /** never answers (no events, the start stays pending): only a cancel ends it */
  | { readonly hang: true }

export type NetScript = (start: NetStart) => NetReply

export const JSON_HEADERS: Array<[string, string]> = [['content-type', 'application/json']]
export const SSE_HEADERS: Array<[string, string]> = [['content-type', 'text/event-stream']]

export const TOOL_SETTINGS_ON: MobileAiToolSettings = {
  internetTools: true,
  imageGeneration: false,
  imageProvider: null,
  imageModel: null,
  imageProvidersReady: [],
}

export function keySnapshot(provider: string, model: string, freeOnly = false) {
  return {
    selectedProvider: provider,
    modelByProvider: { [provider]: model },
    configuredProviders: {
      [provider]: { hasKey: true, ...(freeOnly ? { freeOnly: true } : {}), models: [model] },
    },
    chatgptVisible: false,
    subscriptionNoticeVersion: 0,
  } satisfies MobileAiSettingsSnapshot
}

export function sse(events: readonly unknown[], done = false): string {
  const lines = events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`)
  return lines.join('') + (done ? 'data: [DONE]\n\n' : '')
}

export interface FakeRust {
  readonly client: MobileClient
  readonly commands: string[]
  readonly starts: NetStart[]
  readonly cancels: string[]
  readonly stored: Map<string, { dataBase64: string; mime: string }>
  /** null: the read fails */
  toolSettings: MobileAiToolSettings | null
  aiSettings: MobileAiSettingsSnapshot
  search: NetScript
  web: NetScript
  relay: NetScript
}

const NO_REPLY: NetScript = () => ({
  refuse: { code: 'INTERNAL_ERROR', messageKey: 'test.noScript' },
})

function bytesOf(body: string | Uint8Array | undefined): Uint8Array {
  if (body === undefined) return new Uint8Array()
  return typeof body === 'string' ? new TextEncoder().encode(body) : body
}

export function makeFakeRust(init: Partial<Omit<FakeRust, 'client'>> = {}): FakeRust {
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  const emit = (event: string, payload: unknown) => {
    for (const handler of listeners.get(event) ?? []) handler(payload)
  }
  let resultCounter = 0

  const fake: Omit<FakeRust, 'client'> = {
    commands: [],
    starts: [],
    cancels: [],
    stored: new Map(),
    toolSettings: TOOL_SETTINGS_ON,
    aiSettings: keySnapshot('openrouter', 'meta-llama/llama-3.3-70b-instruct:free', true),
    search: NO_REPLY,
    web: NO_REPLY,
    relay: NO_REPLY,
    ...init,
  }

  const runNet = <T>(command: string, event: string, args: Record<string, unknown>): Promise<T> => {
    const start: NetStart = {
      command,
      requestId: String(args.requestId),
      url: String(args.url),
      method: String(args.method ?? 'GET'),
      headers: (args.headers as Array<[string, string]> | undefined) ?? [],
      ...(typeof args.body === 'string' ? { body: args.body } : {}),
    }
    fake.starts.push(start)
    const script =
      command === 'mobile_ai_search_start'
        ? fake.search
        : command === 'mobile_ai_web_fetch_start'
          ? fake.web
          : fake.relay
    const reply = script(start)
    if ('refuse' in reply) return Promise.reject(reply.refuse)
    if ('hang' in reply) return new Promise<T>(() => {})
    let seq = 0
    const send = (body: Record<string, unknown>) =>
      emit(event, { requestId: start.requestId, seq: seq++, ...body })
    return new Promise<T>((resolve, reject) => {
      setTimeout(() => {
        if ('fail' in reply) {
          send({ type: 'error', ...reply.fail })
          reject(reply.fail)
          return
        }
        send({
          type: 'head',
          status: reply.status,
          headers: reply.headers ?? [],
          ...(event === 'mobile:ai-web-event'
            ? { url: reply.url ?? start.url, contentType: reply.contentType ?? null }
            : {}),
        })
        // the body arrives in uneven pieces, as the network splits it
        const bytes = bytesOf(reply.body)
        for (let at = 0; at < bytes.length; at += 4093) {
          send({
            type: 'chunk',
            dataBase64: Buffer.from(bytes.subarray(at, at + 4093)).toString('base64'),
          })
        }
        send({ type: 'end' })
        resolve({ ok: true } as T)
      }, 0)
    })
  }

  const transport: MobileTransport = {
    async invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
      fake.commands.push(command)
      switch (command) {
        case 'mobile_get_ai_settings':
          return fake.aiSettings as T
        case 'mobile_chatgpt_status':
          return { state: 'hidden' } as T
        case 'mobile_ai_get_tool_settings': {
          if (!fake.toolSettings) {
            throw { code: 'INTERNAL_ERROR', messageKey: 'mobile.ai.toolSettingsRead' }
          }
          return fake.toolSettings as T
        }
        case 'mobile_ai_search_start':
        case 'mobile_ai_web_fetch_start':
          return runNet<T>(command, 'mobile:ai-web-event', args)
        case 'mobile_ai_relay_start':
          return runNet<T>(command, 'mobile:ai-relay-event', args)
        case 'mobile_ai_web_cancel':
        case 'mobile_ai_relay_cancel':
          fake.cancels.push(String(args.requestId))
          return { ok: true } as T
        case 'mobile_ai_results_put_image': {
          resultCounter += 1
          const mime = String(args.mime)
          const ext = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp'
          const address = `ai-result://00000000-0000-4000-8000-${String(resultCounter).padStart(12, '0')}.${ext}`
          fake.stored.set(address, { dataBase64: String(args.dataBase64), mime })
          return {
            address,
            mime,
            bytes: Buffer.from(String(args.dataBase64), 'base64').length,
          } as T
        }
        case 'mobile_ai_results_read_image': {
          const found = fake.stored.get(String(args.address))
          if (!found) throw { code: 'INVALID_ARGUMENT', messageKey: 'mobile.ai.resultNotFound' }
          return {
            ...found,
            bytes: Buffer.from(found.dataBase64, 'base64').length,
          } as T
        }
        default:
          throw { code: 'INTERNAL_ERROR', messageKey: `test.unknown.${command}` }
      }
    },
    async listen<T>(event: string, handler: (payload: T) => void) {
      const set = listeners.get(event) ?? new Set()
      set.add(handler as (payload: unknown) => void)
      listeners.set(event, set)
      return () => set.delete(handler as (payload: unknown) => void)
    },
  }
  return Object.assign(fake, { client: createMobileClient(transport) })
}

export function headerOf(start: NetStart, name: string): string | undefined {
  return start.headers.find(([n]) => n.toLowerCase() === name)?.[1]
}

/** A tiny PNG: the signature and an IHDR chunk are enough for the sniffers. */
export const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
])
export const PNG_BASE64 = Buffer.from(PNG_BYTES).toString('base64')
