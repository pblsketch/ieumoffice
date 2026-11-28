// Live model list for the `custom` provider — a user-hosted OpenAI-compatible
// endpoint (OMLX, Ollama, LM Studio, vLLM, OpenRouter…) — over the one endpoint
// they all implement: `GET {baseUrl}/models` returning `{ data: [{ id }] }`.
// `codex` gets the same list from its app-server's `model/list`; the settings
// screen turns either into a picker.
//
// Not `aiFetch`: that retries through the rescue fetch and warns on a network
// failure, which is right for a chat turn and wrong for a background probe of a
// local server that is very often simply not running. The user agent it would
// have added is still set, since gateways reject a bare `node`.
import type { CodexModelCatalog, OllamaModelInfo } from './types'
import { withUserAgent } from './fetch'
import { endpointUrl, readCappedResponseText } from './protocols/shared'
import { createStreamWatchdog } from './watchdog'

/** a server this slow is not usable for chat either, and the settings field must stay responsive */
const REQUEST_TIMEOUT_MS = 5000

/** ids past this are dropped; the picker is a settings control, not a catalog browser */
const MAX_MODELS = 2000

/** a model list is a few hundred KB at worst; past this the endpoint is not what it claims */
const MAX_BODY_BYTES = 2 * 1024 * 1024

/** "no list" — the caller leaves the free-text model box in place */
function emptyCatalog(): CodexModelCatalog {
  return { models: [], defaultModel: '' }
}

/**
 * The model ids a user-hosted OpenAI-compatible endpoint advertises.
 *
 * Never throws and never rejects: a refused, unreachable, slow, oversized,
 * non-JSON or unexpectedly shaped answer all return an empty catalogue, because
 * the settings screen must keep its text box usable when the server is offline.
 * A valid response also carries `reachable: true`, so server management can
 * distinguish an empty server from a failed probe.
 *
 * The key is sent as `Authorization: Bearer …` only when one is given — an empty
 * `Bearer ` is a malformed credential that strict servers reject, and local
 * servers usually need no key at all.
 *
 * Server order is preserved, duplicate, non-string and blank ids are dropped,
 * and `defaultModel` is always `''`: `/models` carries no `isDefault` marker to
 * read, and real lists mix embedding and conversion models in with the chat
 * ones, so the first entry is a guess that can be actively wrong.
 *
 * Callers hand it already-coerced arguments; `listCustomModelsForIpc` owns the
 * validation of anything arriving from outside.
 */
export async function listCustomModels(
  baseUrl: string,
  apiKey?: string,
): Promise<CodexModelCatalog> {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (!base) return emptyCatalog()
  const key = (apiKey ?? '').trim()
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (key) headers.Authorization = `Bearer ${key}`

  const watchdog = createStreamWatchdog(undefined, REQUEST_TIMEOUT_MS)
  try {
    return await watchdog.guard(async () => {
      const response = await fetch(
        endpointUrl(base, 'models'),
        withUserAgent({ headers, signal: watchdog.signal }),
      )
      if (!response.ok) return emptyCatalog()
      const text = await readCappedResponseText(response, { maxBytes: MAX_BODY_BYTES })
      const body = JSON.parse(text) as { data?: unknown } | null
      const data = body?.data
      if (!Array.isArray(data)) return emptyCatalog()
      const seen = new Set<string>()
      for (const entry of data) {
        const id = (entry as { id?: unknown } | null)?.id
        if (typeof id !== 'string') continue
        const trimmed = id.trim()
        if (trimmed) seen.add(trimmed)
        if (seen.size >= MAX_MODELS) break
      }
      return { models: [...seen], defaultModel: '', reachable: true }
    })
  } catch {
    return emptyCatalog()
  }
}

/**
 * `listCustomModels` behind an `unknown` IPC payload.
 *
 * The validation lives here rather than in the main process so the hook there
 * stays one line: `{ baseUrl: string; apiKey?: string }`, anything else coerced
 * to "no base URL", which returns the empty catalogue.
 */
export function listCustomModelsForIpc(input: unknown): Promise<CodexModelCatalog> {
  const raw = (input ?? {}) as { baseUrl?: unknown; apiKey?: unknown }
  return listCustomModels(
    typeof raw.baseUrl === 'string' ? raw.baseUrl : '',
    typeof raw.apiKey === 'string' ? raw.apiKey : undefined,
  )
}

const NO_MODEL_INFO: OllamaModelInfo = { vision: false, capabilities: [] }

/**
 * What one Ollama model can do, from `POST {origin}/api/show` — the OpenAI-
 * compatible `/models` list carries ids only. `capabilities` is empty when the
 * server is not Ollama, the model is unknown, or the probe fails, so callers
 * should treat it as "not checked" rather than "text-only".
 * Never throws, for the same reason `listCustomModels` does not.
 */
export async function showOllamaModel(
  baseUrl: string,
  model: string,
  apiKey?: string,
): Promise<OllamaModelInfo> {
  const name = model.trim().slice(0, 256)
  if (!name) return NO_MODEL_INFO
  let origin: string
  try {
    origin = new URL(baseUrl.trim()).origin
  } catch {
    return NO_MODEL_INFO
  }
  const key = (apiKey ?? '').trim()
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  if (key) headers.Authorization = `Bearer ${key}`
  const watchdog = createStreamWatchdog(undefined, REQUEST_TIMEOUT_MS)
  try {
    return await watchdog.guard(async () => {
      const response = await fetch(
        `${origin}/api/show`,
        withUserAgent({
          method: 'POST',
          headers,
          body: JSON.stringify({ model: name }),
          signal: watchdog.signal,
        }),
      )
      if (!response.ok) return NO_MODEL_INFO
      const text = await readCappedResponseText(response, { maxBytes: MAX_BODY_BYTES })
      const body = JSON.parse(text) as { capabilities?: unknown } | null
      const capabilities = Array.isArray(body?.capabilities)
        ? body.capabilities.filter((c): c is string => typeof c === 'string')
        : []
      return { vision: capabilities.includes('vision'), capabilities }
    })
  } catch {
    return NO_MODEL_INFO
  }
}

/** `showOllamaModel` behind an `unknown` IPC payload, like `listCustomModelsForIpc`. */
export function showOllamaModelForIpc(input: unknown): Promise<OllamaModelInfo> {
  const raw = (input ?? {}) as { baseUrl?: unknown; model?: unknown; apiKey?: unknown }
  return showOllamaModel(
    typeof raw.baseUrl === 'string' ? raw.baseUrl : '',
    typeof raw.model === 'string' ? raw.model : '',
    typeof raw.apiKey === 'string' ? raw.apiKey : undefined,
  )
}
