/**
 * Reading a self-hosted server's model list (`<base>/models`, the
 * OpenAI-compatible shape) through the sealed relay. The endpoint must be
 * saved first: the relay only lets a request through to the saved host. A key
 * is never in the webview: when one is saved the request carries the
 * `__sealed__:custom` placeholder, which Rust swaps; with no key the header is
 * left out (the placeholder alone would be refused).
 */
import {
  mobileRelayFetch,
  sealedKeyOf,
  type MobileAiCommandClient,
  type MobileAiCustomEndpoint,
} from '@genoffice/mobile-bridge/ai-bridge'

/** `<base>/models`, keeping the base path (`https://host/v1` -> `https://host/v1/models`). */
export function customModelsUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/models`
  url.hash = ''
  return url.toString()
}

function idOf(entry: unknown): string | null {
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object') {
    const record = entry as Record<string, unknown>
    if (typeof record.id === 'string') return record.id
    if (typeof record.name === 'string') return record.name
  }
  return null
}

/** Model ids out of `{ data: [{ id }] }`, `{ models: [...] }` or a bare array. */
export function customModelIds(body: unknown): string[] {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const list: unknown = Array.isArray(body) ? body : (record.data ?? record.models)
  const ids: string[] = []
  for (const entry of Array.isArray(list) ? list : []) {
    const id = idOf(entry)?.trim()
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/** The saved server's models; throws when the list cannot be read or is empty. */
export async function listCustomServerModels(
  client: MobileAiCommandClient,
  endpoint: MobileAiCustomEndpoint,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!endpoint.baseUrl) throw new Error('No self-hosted server is saved.')
  const headers: Record<string, string> = { accept: 'application/json' }
  if (endpoint.hasKey) headers.authorization = `Bearer ${sealedKeyOf('custom')}`
  const response = await mobileRelayFetch(client, customModelsUrl(endpoint.baseUrl), {
    method: 'GET',
    headers,
    signal,
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`The model list answered HTTP ${response.status}.`)
  }
  const ids = customModelIds(await response.json())
  if (ids.length === 0) throw new Error('The model list is empty.')
  return ids
}
