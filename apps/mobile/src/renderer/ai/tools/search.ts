/**
 * Keyless web and picture search on mobile, through Rust's search request
 * (fixed search hosts, no keys, no cookies). The rules are PC's:
 * packages/ai-search/src/index.ts (webSearch without keys: Parallel's Search
 * MCP, then DuckDuckGo HTML; imageSearch: DuckDuckGo images, then
 * filterUsableImages) and packages/ai-search/src/parallel-mcp.ts. That PC
 * module pulls in Node-only code and the MCP SDK, so the same steps are
 * written here; keep both in step.
 */
import { mobileSearchFetch } from '@genoffice/mobile-bridge/ai-bridge'
import type { MobileClient } from '@genoffice/mobile-bridge/transport'
import {
  asRecord,
  isCopyrightHost,
  safeHost,
  type ImageSearchResult,
  type WebSearchResult,
} from '../../../../../../packages/ai-search/src/shared'
import { toolError, type ImageSearchAnswer, type WebSearchAnswer } from './types'

const PARALLEL_MCP_URL = 'https://search.parallel.ai/mcp'
/** PC parallel-mcp.ts: the whole handshake and call within 15 seconds */
const PARALLEL_TIMEOUT_MS = 15_000
/** PC index.ts FALLBACK_TIMEOUT_MS */
const FALLBACK_TIMEOUT_MS = 5_000
/** the MCP SDK version PC's client speaks first */
const MCP_PROTOCOL_VERSION = '2025-11-25'

/** PC index.ts BROWSER_HEADERS */
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
}

/** PC index.ts normalizeSearchArgs: 1..20 results, the query cut at 500 characters */
export function normalizeSearchArgs(
  query: unknown,
  maxResults: unknown,
  fallback: number,
): { query: string; max: number } {
  const max =
    typeof maxResults === 'number' && Number.isFinite(maxResults)
      ? Math.min(Math.max(1, Math.floor(maxResults)), 20)
      : fallback
  return { query: typeof query === 'string' ? query.slice(0, 500) : '', max }
}

/** A deadline for one search step; `done` must run when the step ends. */
function deadline(ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, done: () => clearTimeout(timer) }
}

// ---------------------------------------------------------------------------
// Parallel Search MCP (Streamable HTTP, JSON-RPC written by hand)
// ---------------------------------------------------------------------------

interface JsonRpcReply {
  readonly id?: unknown
  readonly result?: unknown
  readonly error?: unknown
}

/** The JSON-RPC messages of an SSE body (`data:` lines of each event). */
function sseMessages(text: string): unknown[] {
  const out: unknown[] = []
  for (const block of text.replace(/\r\n?/g, '\n').split('\n\n')) {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n')
    if (!data) continue
    try {
      out.push(JSON.parse(data))
    } catch {
      // a keep-alive or a non-JSON event is not a reply
    }
  }
  return out
}

/** The reply to request `id` from a JSON or SSE answer. */
async function rpcReply(response: Response, id: number): Promise<JsonRpcReply | null> {
  const type = (response.headers.get('content-type') ?? '').toLowerCase()
  const text = await response.text()
  const messages: unknown[] = type.includes('text/event-stream')
    ? sseMessages(text)
    : (() => {
        try {
          const parsed: unknown = JSON.parse(text)
          return Array.isArray(parsed) ? parsed : [parsed]
        } catch {
          return []
        }
      })()
  for (const message of messages) {
    const m = asRecord(message)
    if (m.id === id && ('result' in m || 'error' in m)) return m as JsonRpcReply
  }
  return null
}

/** The structured search result of a tools/call reply, as PC parallelMcpSearch reads it. */
function toolCallData(result: unknown): unknown {
  const r = asRecord(result)
  if (r.isError) return null
  if (r.structuredContent) return r.structuredContent
  if (Array.isArray(r.content)) {
    for (const block of r.content) {
      const b = asRecord(block)
      if (b.type !== 'text' || typeof b.text !== 'string') continue
      try {
        return JSON.parse(b.text) as unknown
      } catch {
        // non-JSON explanatory text is not a search result
      }
    }
  }
  return null
}

async function parallelMcpSearch(client: MobileClient, query: string): Promise<unknown> {
  const { signal, done } = deadline(PARALLEL_TIMEOUT_MS)
  let sessionId: string | null = null
  let protocolVersion: string | null = null
  const headers = (): Record<string, string> => ({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    ...(protocolVersion ? { 'mcp-protocol-version': protocolVersion } : {}),
  })
  const post = (message: unknown) =>
    mobileSearchFetch(client, PARALLEL_MCP_URL, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(message),
      signal,
    })
  try {
    const init = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'genoffice', version: '0.1.0' },
      },
    })
    if (!init.ok) {
      await init.body?.cancel().catch(() => {})
      return null
    }
    sessionId = init.headers.get('mcp-session-id')
    const initReply = await rpcReply(init, 1)
    if (!initReply || initReply.error) return null
    const negotiated = asRecord(initReply.result).protocolVersion
    protocolVersion = typeof negotiated === 'string' ? negotiated : MCP_PROTOCOL_VERSION

    // the MCP lifecycle: the client says it is ready before the first request
    const ready = await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
    await ready.body?.cancel().catch(() => {})

    const call = await post({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'web_search', arguments: { objective: query, search_queries: [query] } },
    })
    if (!call.ok) {
      await call.body?.cancel().catch(() => {})
      return null
    }
    const callReply = await rpcReply(call, 2)
    if (!callReply || callReply.error) return null
    return toolCallData(callReply.result)
  } finally {
    done()
    if (sessionId && !signal.aborted) {
      // ending the session is cleanup; its failure never discards results
      await mobileSearchFetch(client, PARALLEL_MCP_URL, {
        method: 'DELETE',
        headers: headers(),
      })
        .then((r) => r.body?.cancel())
        .catch(() => {})
    }
  }
}

/** PC index.ts parallelWebSearch (no key: the anonymous MCP). */
async function parallelWebSearch(
  client: MobileClient,
  query: string,
  maxResults: number,
): Promise<WebSearchResult[] | null> {
  try {
    const data = asRecord(await parallelMcpSearch(client, query))
    const raw: unknown[] = Array.isArray(data.results) ? data.results : []
    const results: WebSearchResult[] = []
    for (const item of raw) {
      if (results.length >= maxResults) break
      const result = asRecord(item)
      if (typeof result.url !== 'string' || !/^https?:\/\//i.test(result.url)) continue
      const excerpts: unknown[] = Array.isArray(result.excerpts) ? result.excerpts : []
      results.push({
        title: typeof result.title === 'string' && result.title ? result.title : result.url,
        url: result.url,
        snippet: excerpts
          .filter((excerpt): excerpt is string => typeof excerpt === 'string')
          .join('\n'),
      })
    }
    return results.length ? results : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// DuckDuckGo (PC index.ts duckWebSearch / duckImageSearch)
// ---------------------------------------------------------------------------

async function duckText(
  client: MobileClient,
  url: string,
  headers: Record<string, string>,
): Promise<string> {
  const { signal, done } = deadline(FALLBACK_TIMEOUT_MS)
  try {
    const resp = await mobileSearchFetch(client, url, { headers, signal })
    if (!resp.ok) {
      await resp.body?.cancel().catch(() => {})
      throw new Error(`http ${resp.status}`)
    }
    return await resp.text()
  } finally {
    done()
  }
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

function decodeDuckUrl(href: string): string {
  // DuckDuckGo result links are often /l/?uddg=<encoded>
  const m = /[?&]uddg=([^&]+)/.exec(href)
  if (m) {
    try {
      return decodeURIComponent(m[1]!)
    } catch {
      return ''
    }
  }
  return href.startsWith('http') ? href : ''
}

async function duckWebSearch(
  client: MobileClient,
  query: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const html = await duckText(
    client,
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    BROWSER_HEADERS,
  )
  const results: WebSearchResult[] = []
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null && results.length < maxResults) {
    const url = decodeDuckUrl(m[1]!)
    const title = stripTags(m[2]!)
    if (url && title) results.push({ title, url, snippet: '' })
  }
  return results
}

async function duckImageSearch(
  client: MobileClient,
  query: string,
  maxResults: number,
): Promise<ImageSearchResult[]> {
  // DuckDuckGo i.js needs a vqd token, so it takes two steps
  const tokenHtml = await duckText(
    client,
    `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
    BROWSER_HEADERS,
  )
  const vqd = /vqd=["']?([\d-]+)["']?/.exec(tokenHtml)?.[1]
  if (!vqd) throw new Error('no vqd token')
  const json = await duckText(
    client,
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}`,
    { ...BROWSER_HEADERS, Referer: 'https://duckduckgo.com/' },
  )
  const data = asRecord(JSON.parse(json))
  const list: unknown[] = Array.isArray(data.results) ? data.results : []
  const out: ImageSearchResult[] = []
  for (const item of list) {
    const img = asRecord(item)
    const imageUrl = String(img.image ?? '')
    if (!imageUrl || isCopyrightHost(imageUrl)) continue
    const entry: ImageSearchResult = {
      title: String(img.title ?? ''),
      imageUrl,
      sourceUrl: String(img.url ?? ''),
      source: safeHost(img.url),
    }
    if (typeof img.width === 'number') entry.width = img.width
    if (typeof img.height === 'number') entry.height = img.height
    out.push(entry)
    if (out.length >= maxResults) break
  }
  return out
}

/** PC index.ts MIN_USABLE_IMAGE_PX / filterUsableImages (that module is Node-only). */
export const MIN_USABLE_IMAGE_PX = 200

export function filterUsableImages(images: ImageSearchResult[]): ImageSearchResult[] {
  return images.filter((im) => {
    if (typeof im.width !== 'number' && typeof im.height !== 'number') return true
    return (
      (im.width ?? Number.POSITIVE_INFINITY) >= MIN_USABLE_IMAGE_PX &&
      (im.height ?? Number.POSITIVE_INFINITY) >= MIN_USABLE_IMAGE_PX
    )
  })
}

function failureText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function mobileWebSearch(
  client: MobileClient,
  query: unknown,
  maxResults: unknown,
): Promise<WebSearchAnswer> {
  // PC webSearch defaults to six results
  const { query: q, max } = normalizeSearchArgs(query, maxResults, 6)
  if (!q.trim()) return toolError('invalid_input', 'The search query is empty.')
  const parallel = await parallelWebSearch(client, q, max)
  if (parallel) return { results: parallel, method: 'parallel' }
  try {
    return { results: await duckWebSearch(client, q, max), method: 'duckduckgo' }
  } catch (err) {
    // an unreachable backend must not read as an empty result set
    return toolError('network', `The web search could not be reached: ${failureText(err)}`)
  }
}

export async function mobileImageSearch(
  client: MobileClient,
  query: unknown,
  maxResults: unknown,
): Promise<ImageSearchAnswer> {
  // PC imageSearch defaults to eight results
  const { query: q, max } = normalizeSearchArgs(query, maxResults, 8)
  if (!q.trim()) return toolError('invalid_input', 'The search query is empty.')
  try {
    return {
      images: filterUsableImages(await duckImageSearch(client, q, max)),
      method: 'duckduckgo',
    }
  } catch (err) {
    return toolError('network', `The picture search could not be reached: ${failureText(err)}`)
  }
}
