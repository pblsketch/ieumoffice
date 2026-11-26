/**
 * read_url on mobile: one http(s) page through Rust's public address request
 * (address check on every hop, five redirects, 10 MB, 30 s), its readable
 * text handed out 50,000 characters at a time. The rules are PC's
 * packages/ai-search/src/read-url.ts (that module is Node-only: SSRF guard,
 * settings file); HTML goes through PC's own htmlToText. Mobile has no GitHub
 * token, so a GitHub blob is read from raw.githubusercontent.com as PC does
 * without one. Never throws.
 */
import { mobileWebFetch, type MobileAiCommandClient } from '@genoffice/mobile-bridge/ai-bridge'
import { htmlToText } from '../../../../../../packages/ai-search/src/html-text'
import { toolError, type MobileAiToolError, type ReadUrlAnswer, type ReadUrlPage } from './types'
import { onMobileAiToolsReset } from './state'
import { webFetchFailure } from './webText'

/** PC READ_URL_PAGE_CHARS */
export const READ_URL_PAGE_CHARS = 50_000
/** PC read-url.ts page cache: three minutes, eight pages */
const READ_URL_CACHE_TTL_MS = 3 * 60_000
const READ_URL_CACHE_MAX_ENTRIES = 8
const USER_AGENT = 'Mozilla/5.0'

interface PageCacheEntry {
  readonly finalUrl: string
  readonly title?: string
  readonly text: string
  readonly expiresAt: number
}

const pageCache = new Map<string, PageCacheEntry>()

// a new conversation forgets the pages read so far
onMobileAiToolsReset(() => pageCache.clear())

function cachedPage(key: string, now: number): PageCacheEntry | undefined {
  const entry = pageCache.get(key)
  if (!entry) return undefined
  if (entry.expiresAt <= now) {
    for (const [k, v] of pageCache) if (v === entry) pageCache.delete(k)
    return undefined
  }
  return entry
}

function cachePage(entry: PageCacheEntry, requestUrl: string): void {
  for (const key of new Set([entry.finalUrl, requestUrl])) {
    pageCache.delete(key)
    pageCache.set(key, entry)
  }
  // the oldest pages go first once more than eight distinct pages are held
  while (new Set(pageCache.values()).size > READ_URL_CACHE_MAX_ENTRIES) {
    const oldestKey = pageCache.keys().next().value
    if (oldestKey === undefined) break
    const oldest = pageCache.get(oldestKey)
    for (const [k, v] of pageCache) if (v === oldest) pageCache.delete(k)
  }
}

function clip(value: string): string {
  return value.length > 120 ? `${value.slice(0, 120)}...` : value
}

/** PC githubRequest without a token: a blob address reads from raw.githubusercontent.com. */
function githubRawUrl(target: URL): string {
  const host = target.hostname.toLowerCase()
  if (host !== 'github.com' && host !== 'www.github.com') return target.toString()
  const parts = target.pathname.split('/').filter((part) => part !== '')
  if (parts.length < 5) return target.toString()
  const [owner, repo, kind, ref, ...rest] = parts
  const file = rest.join('/')
  if (kind !== 'blob' || !owner || !repo || !ref || !file) return target.toString()
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${file}`
}

/** PC isReadableType */
function isReadableType(mime: string): boolean {
  return (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime.endsWith('+json') ||
    mime === 'application/xml' ||
    mime === 'text/xml' ||
    mime === 'application/xhtml+xml' ||
    mime === 'application/vnd.github.raw'
  )
}

function unsupportedType(mime: string): MobileAiToolError {
  const what = mime !== '' ? `a ${mime} file` : 'a binary file'
  return toolError(
    'unsupported_type',
    `This address is ${what}, not a web page. Download it and attach the file instead.`,
  )
}

function hasNulByte(bytes: Uint8Array): boolean {
  for (const byte of bytes) if (byte === 0) return true
  return false
}

function bomEncoding(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return 'utf-8'
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
  return undefined
}

function metaCharset(bytes: Uint8Array): string | undefined {
  const head = new TextDecoder('windows-1252').decode(bytes.subarray(0, 4096))
  return /<meta[^>]*charset\s*=\s*["']?\s*([a-z0-9_:.-]+)/i.exec(head)?.[1]
}

function decodeBody(
  bytes: Uint8Array,
  declaredCharset: string | undefined,
  allowMeta: boolean,
  bom: string | undefined,
): string {
  const label = bom ?? declaredCharset ?? (allowMeta ? metaCharset(bytes) : undefined) ?? 'utf-8'
  try {
    return new TextDecoder(label.trim().toLowerCase()).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

function declaredCharsetOf(rawContentType: string | null): string | undefined {
  return /charset\s*=\s*["']?([^;"'\s]+)/i.exec(rawContentType ?? '')?.[1]
}

function looksLikeHtml(text: string): boolean {
  return /^\s*(<!doctype\s+html|<html[\s>])/i.test(text)
}

function normalizeOffset(offset: unknown): number {
  return typeof offset === 'number' && Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0
}

function slicePage(entry: PageCacheEntry, offset: number): ReadUrlPage {
  const totalChars = entry.text.length
  const text = offset >= totalChars ? '' : entry.text.slice(offset, offset + READ_URL_PAGE_CHARS)
  const end = offset + text.length
  const truncated = end < totalChars
  return {
    url: entry.finalUrl,
    ...(entry.title !== undefined ? { title: entry.title } : {}),
    text,
    offset,
    totalChars,
    truncated,
    ...(truncated ? { nextOffset: end } : {}),
  }
}

export async function mobileReadUrl(
  client: MobileAiCommandClient,
  url: unknown,
  offset: unknown,
  signal?: AbortSignal,
): Promise<ReadUrlAnswer> {
  const start = normalizeOffset(offset)
  if (typeof url !== 'string') {
    return toolError('invalid_url', 'The address must be an http or https URL.')
  }
  const trimmed = url.trim()
  let target: URL
  try {
    target = new URL(trimmed)
  } catch {
    return toolError('invalid_url', `Not a usable web address: ${clip(trimmed)}`)
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return toolError('invalid_url', 'Only http and https addresses can be read.')
  }
  const requestUrl = githubRawUrl(target)
  const cached = cachedPage(requestUrl, Date.now())
  if (cached) return slicePage(cached, start)

  let response: Response
  try {
    response = await mobileWebFetch(client, requestUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal,
    })
  } catch (err) {
    return webFetchFailure(err)
  }
  const finalUrl = response.url || requestUrl
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    return toolError('http_error', `The server answered with HTTP ${response.status}.`, {
      status: response.status,
    })
  }
  const rawContentType = response.headers.get('content-type')
  const mime = (rawContentType ?? '').split(';')[0]!.trim().toLowerCase()
  const sniff = mime === '' || mime === 'application/octet-stream'
  if (!sniff && !isReadableType(mime)) {
    await response.body?.cancel().catch(() => {})
    return unsupportedType(mime)
  }

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch (err) {
    return webFetchFailure(err)
  }
  const bom = bomEncoding(bytes)
  if (sniff && bom === undefined && hasNulByte(bytes)) return unsupportedType('')

  let converted: { title?: string; text: string }
  try {
    const allowMeta = mime === 'text/html' || mime === 'application/xhtml+xml'
    const decoded = decodeBody(bytes, declaredCharsetOf(rawContentType), allowMeta, bom)
    const asHtml =
      mime === 'text/html' || mime === 'application/xhtml+xml' || (sniff && looksLikeHtml(decoded))
    converted = asHtml ? htmlToText(decoded, finalUrl) : { text: decoded }
  } catch {
    return unsupportedType('')
  }
  if (converted.text.trim() === '') {
    return toolError('empty', 'The page had no readable text.')
  }
  const entry: PageCacheEntry = {
    finalUrl,
    ...(converted.title !== undefined ? { title: converted.title } : {}),
    text: converted.text,
    expiresAt: Date.now() + READ_URL_CACHE_TTL_MS,
  }
  cachePage(entry, requestUrl)
  return slicePage(entry, start)
}
