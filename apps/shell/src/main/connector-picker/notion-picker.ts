import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { ConnectorAttachWireResult } from '@genoffice/electron-utils/connector-attach-channels'
import type { ConnectorPickerItem } from '../../shared/connector-picker-api'
import { atomicWriteFile } from '../atomic-write'
import {
  downloadImageToBytes,
  type NormalizedImage,
  type WebpToPngConverter,
} from '../mcp-client/mcp-images'

/** Subdirectory under OS temp dir where Notion page snapshots and images are stored */
export const NOTION_ATTACH_SUBDIR = 'ieumoffice-notion-attach'
/** Maximum number of Notion pages that may be attached in one pick */
export const MAX_NOTION_PICKS = 20
/** Maximum number of images automatically downloaded across selected Notion pages */
export const MAX_NOTION_ATTACHED_IMAGES = 20
/** Cleanup threshold for cached Notion attach snapshots (7 days) */
const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface NotionToolDescriptor {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface NotionToolPair {
  searchTool: NotionToolDescriptor
  fetchTool: NotionToolDescriptor
  searchQueryParam: string
  fetchIdParam: string
}

function schemaStringProp(
  schema: Record<string, unknown> | undefined,
  preferred: readonly string[],
): string | null {
  const props = schema?.properties
  if (!props || typeof props !== 'object') return null
  const record = props as Record<string, unknown>
  for (const key of preferred) {
    if (key in record) return key
  }
  for (const [key, val] of Object.entries(record)) {
    if (val && typeof val === 'object' && (val as { type?: unknown }).type === 'string') {
      return key
    }
  }
  return null
}

/**
 * Discover the Notion search and fetch tools from a server's advertised tool
 * catalog using tool names and input schemas rather than hardcoded exact names.
 */
export function findNotionTools(tools: readonly NotionToolDescriptor[]): NotionToolPair | null {
  const scoreSearch = (t: NotionToolDescriptor): number => {
    const n = t.name.toLowerCase()
    if (n === 'notion-search' || n === 'notion_search' || n === 'search') return 100
    if (n.includes('search') && !n.includes('user')) return 70
    return 0
  }
  const scoreFetch = (t: NotionToolDescriptor): number => {
    const n = t.name.toLowerCase()
    if (n === 'notion-fetch' || n === 'notion_fetch' || n === 'fetch') return 100
    if (
      n.includes('fetch') ||
      n.includes('get-page') ||
      n.includes('get_page') ||
      n.includes('retrieve-page') ||
      n.includes('retrieve_page')
    ) {
      return 70
    }
    return 0
  }

  let searchTool: NotionToolDescriptor | null = null
  let bestSearch = 0
  let fetchTool: NotionToolDescriptor | null = null
  let bestFetch = 0

  for (const t of tools) {
    const s = scoreSearch(t)
    if (s > bestSearch) {
      bestSearch = s
      searchTool = t
    }
    const f = scoreFetch(t)
    if (f > bestFetch) {
      bestFetch = f
      fetchTool = t
    }
  }

  if (!searchTool || !fetchTool) return null
  return {
    searchTool,
    fetchTool,
    searchQueryParam:
      schemaStringProp(searchTool.inputSchema, ['query', 'q', 'text', 'keyword']) ?? 'query',
    fetchIdParam:
      schemaStringProp(fetchTool.inputSchema, ['id', 'page_id', 'pageId', 'url']) ?? 'id',
  }
}

const EXCLUDED_NOTION_TYPES = new Set([
  'database',
  'data_source',
  'datasource',
  'user',
  'comment',
  'block',
])

function extractTitle(entry: Record<string, unknown>): string {
  if (typeof entry.title === 'string' && entry.title.trim()) return entry.title.trim()
  if (typeof entry.name === 'string' && entry.name.trim()) return entry.name.trim()
  // Notion API-style properties.title / properties.Name
  const props = entry.properties
  if (props && typeof props === 'object') {
    for (const val of Object.values(props as Record<string, unknown>)) {
      if (val && typeof val === 'object') {
        const titleArr = (val as { title?: unknown }).title
        if (Array.isArray(titleArr)) {
          const joined = titleArr
            .map((t) =>
              t &&
              typeof t === 'object' &&
              typeof (t as { plain_text?: unknown }).plain_text === 'string'
                ? (t as { plain_text: string }).plain_text
                : '',
            )
            .join('')
            .trim()
          if (joined) return joined
        }
      }
    }
  }
  return ''
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    // Check for fenced ```json block or first JSON object/array
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fenced) {
      try {
        return JSON.parse(fenced[1]!.trim())
      } catch {
        // fall through
      }
    }
    const start = trimmed.search(/[{[]/)
    if (start >= 0) {
      try {
        return JSON.parse(trimmed.slice(start))
      } catch {
        // fall through
      }
    }
    return null
  }
}

/**
 * Parse Notion search tool output and keep only individual pages (databases,
 * data sources, users, and comments are excluded).
 */
export function parseNotionSearchResults(output: string): ConnectorPickerItem[] {
  const parsed = tryParseJson(output)
  let rawList: unknown[] = []
  if (Array.isArray(parsed)) {
    rawList = parsed
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    for (const key of ['results', 'pages', 'items', 'data']) {
      if (Array.isArray(obj[key])) {
        rawList = obj[key] as unknown[]
        break
      }
    }
  }

  const items: ConnectorPickerItem[] = []
  const seen = new Set<string>()
  for (const row of rawList) {
    if (!row || typeof row !== 'object') continue
    const rec = row as Record<string, unknown>
    const kind = String(rec.type ?? rec.object ?? '')
      .trim()
      .toLowerCase()
    if (kind && EXCLUDED_NOTION_TYPES.has(kind)) continue
    const id =
      typeof rec.id === 'string' && rec.id.trim()
        ? rec.id.trim()
        : typeof rec.url === 'string' && rec.url.trim()
          ? rec.url.trim()
          : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    const title = extractTitle(rec) || id
    const subtitleRaw = rec.timestamp ?? rec.last_edited_time ?? rec.updated_at ?? rec.url ?? ''
    const subtitle = typeof subtitleRaw === 'string' ? subtitleRaw.trim() : ''
    items.push({ id, title, subtitle })
  }
  return items
}

/** Remove temporary Notion snapshot and image files older than 7 days */
export async function cleanupOldNotionSnapshots(
  attachDir: string,
  nowMs: number = Date.now(),
): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(attachDir)
  } catch {
    return
  }
  const cutoff = nowMs - SNAPSHOT_MAX_AGE_MS
  await Promise.all(
    entries.map(async (name) => {
      if (!/\.(md|png|jpe?g|gif|webp)$/i.test(name)) return
      const full = join(attachDir, name)
      try {
        const info = await stat(full)
        if (info.isFile() && info.mtimeMs < cutoff) {
          await unlink(full)
        }
      } catch {
        // ignore stale or vanished files
      }
    }),
  )
}

function safeBaseName(title: string, id: string, index: number): string {
  let noCtrl = ''
  for (const ch of title) {
    noCtrl += ch.charCodeAt(0) < 32 ? ' ' : ch
  }
  const cleaned = noCtrl
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 56)
  const base = cleaned || `notion-page-${index + 1}`
  const shortId = id.replace(/[^a-zA-Z0-9_-]/g, '').slice(-8) || `${Date.now().toString(36)}`
  return `${base}-${shortId}`
}

function safeSnapshotName(title: string, id: string, index: number): string {
  return `${safeBaseName(title, id, index)}.md`
}

/**
 * Unwrap Notion MCP's fetch envelope (JSON `{ title, url, text }` plus
 * `<page>` / `<ancestor-path>` / `<iconMetadata>` / `<content>` XML wrappers)
 * into clean, readable Markdown so attached snapshots stay compact and legible.
 */
export function unwrapNotionFetchMarkdown(rawOutput: string, fallbackTitle?: string): string {
  let title = (fallbackTitle ?? '').trim()
  let text = rawOutput.trim()

  const parsed = tryParseJson(text)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const rec = parsed as Record<string, unknown>
    if (typeof rec.title === 'string' && rec.title.trim()) {
      title = rec.title.trim()
    }
    if (typeof rec.text === 'string' && rec.text.trim()) {
      text = rec.text.trim()
    } else if (typeof rec.markdown === 'string' && rec.markdown.trim()) {
      text = rec.markdown.trim()
    } else if (typeof rec.content === 'string' && rec.content.trim()) {
      text = rec.content.trim()
    }
  }

  // Strip Notion MCP's conversational preamble ("Here is the result of \"fetch\"...")
  text = text.replace(/^Here is the result of ["']?fetch["']?[^\n]*\n+/i, '').trim()

  // Extract inner <content>...</content> when wrapped in Notion's <page> XML envelope
  const contentMatch = text.match(/<content>([\s\S]*?)<\/content>/i)
  if (contentMatch) {
    text = contentMatch[1]!.trim()
  } else {
    text = text
      .replace(/<ancestor-path>[\s\S]*?<\/ancestor-path>/gi, '')
      .replace(/<iconMetadata>[\s\S]*?<\/iconMetadata>/gi, '')
      .replace(/<properties>[\s\S]*?<\/properties>/gi, '')
      .replace(/<\/?page\b[^>]*>/gi, '')
      .trim()
  }

  // Collapse runs of 3+ blank lines and normalize CRLF
  text = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!text) return title ? `# ${title}\n` : ''
  if (title && !/^#\s+/.test(text)) {
    return `# ${title}\n\n${text}\n`
  }
  return `${text}\n`
}

export interface NotionImageTarget {
  /** Start offset in the markdown string */
  start: number
  /** End offset in the markdown string */
  end: number
  /** Original matched tag or Markdown image syntax */
  raw: string
  /** Downloadable HTTPS URL */
  url: string
  /** Optional alt text from Markdown syntax */
  alt?: string
}

const CODE_FENCE_RE = /```[\s\S]*?```|`[^`\n]*`/g

function codeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (const m of text.matchAll(CODE_FENCE_RE)) {
    if (m.index !== undefined) ranges.push([m.index, m.index + m[0].length])
  }
  return ranges
}

function insideRanges(index: number, ranges: readonly [number, number][]): boolean {
  for (const [s, e] of ranges) {
    if (index >= s && index < e) return true
    if (s > index) break
  }
  return false
}

/**
 * Locate downloadable HTTPS image references inside unwrapped Notion Markdown
 * (`![alt](https://...)`, `<image source="https://..."/>`, `<img src="..."/>`,
 * or `<image>https://...</image>`), skipping code blocks.
 */
export function extractNotionImageTargets(markdown: string): NotionImageTarget[] {
  const excluded = codeRanges(markdown)
  const matches: NotionImageTarget[] = []
  const add = (start: number, end: number, raw: string, url: string, alt?: string) => {
    if (insideRanges(start, excluded)) return
    const trimmed = url.trim().replace(/[)>]+$/, '')
    if (!/^https:\/\//i.test(trimmed)) return
    // Avoid overlapping spans
    if (matches.some((m) => start < m.end && end > m.start)) return
    matches.push({ start, end, raw, url: trimmed, ...(alt ? { alt } : {}) })
  }

  for (const m of markdown.matchAll(
    /<(?:image|img)\b[^>]*\b(?:source|src|url)\s*=\s*["'](https:\/\/[^"']+)["'][^>]*>/gi,
  )) {
    if (m.index !== undefined && m[1]) {
      add(m.index, m.index + m[0].length, m[0], m[1])
    }
  }
  for (const m of markdown.matchAll(/<image\b[^>]*>\s*(https:\/\/[^<\s]+)\s*<\/image>/gi)) {
    if (m.index !== undefined && m[1]) {
      add(m.index, m.index + m[0].length, m[0], m[1])
    }
  }
  for (const m of markdown.matchAll(/!\[([^\]]*)\]\(\s*(https:\/\/[^\s)]+)(?:\s+[^)]*)?\)/gi)) {
    if (m.index !== undefined && m[2]) {
      add(m.index, m.index + m[0].length, m[0], m[2], m[1]?.trim() || undefined)
    }
  }

  matches.sort((a, b) => a.start - b.start)
  return matches
}

function countNonTextElements(markdown: string): number {
  const tagMatches =
    markdown.match(/<(?:image|img|file|video|audio|pdf|embed|bookmark)\b[^>]*>/gi)?.length ?? 0
  const mdImageMatches = markdown.match(/!\[[^\]]*\]\([^)]+\)/g)?.length ?? 0
  return tagMatches + mdImageMatches
}

export type NotionPickerCallAnswer =
  { ok: true; output: string; isError: boolean } | { ok: false; error: string }

export interface FetchNotionPagesParams {
  serverId: string
  selectedItems: readonly ConnectorPickerItem[]
  fetchTool: NotionToolDescriptor
  fetchIdParam?: string
  callForUserPicker: (
    serverId: string,
    tool: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<NotionPickerCallAnswer>
  attachDir: string
  signal?: AbortSignal
  /** Optional custom image downloader (defaults to SSRF-guarded `downloadImageToBytes`) */
  downloadImage?: (url: string, signal?: AbortSignal) => Promise<NormalizedImage | null>
  /** Optional WebP -> PNG converter for broad editor compatibility */
  convertWebpToPng?: WebpToPngConverter
  /** Maximum total images downloaded across selected pages (defaults to 20) */
  maxImages?: number
}

/**
 * Fetch up to 20 selected Notion pages through the user-picker channel, save
 * each page's cleaned Markdown content as a temporary `.md` file in `attachDir`,
 * and automatically download embedded page images alongside the snapshot so AI
 * editors can view and insert them directly.
 */
export async function fetchNotionPagesToTemp(
  params: FetchNotionPagesParams,
): Promise<ConnectorAttachWireResult> {
  const items = params.selectedItems.slice(0, MAX_NOTION_PICKS)
  if (items.length === 0) return { ok: false, reason: 'cancelled' }

  await mkdir(params.attachDir, { recursive: true })
  const idParam =
    params.fetchIdParam ??
    schemaStringProp(params.fetchTool.inputSchema, ['id', 'page_id', 'pageId', 'url']) ??
    'id'

  const downloadImage =
    params.downloadImage ??
    ((url: string, signal?: AbortSignal) =>
      downloadImageToBytes(url, { signal, convertWebpToPng: params.convertWebpToPng }))
  const maxImages = params.maxImages ?? MAX_NOTION_ATTACHED_IMAGES

  const notePaths: string[] = []
  const imagePaths: string[] = []
  const downloadedByUrl = new Map<string, string>()
  let failed = 0
  let omittedNonText = 0

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    const res = await params.callForUserPicker(
      params.serverId,
      params.fetchTool.name,
      { [idParam]: item.id },
      params.signal,
    )
    if (!res.ok || res.isError || !res.output.trim()) {
      failed += 1
      continue
    }
    const cleaned = unwrapNotionFetchMarkdown(res.output, item.title)
    if (!cleaned.trim()) {
      failed += 1
      continue
    }

    const totalNonText = countNonTextElements(cleaned)
    const imageTargets = extractNotionImageTargets(cleaned)
    const pageBase = safeBaseName(item.title, item.id, i)
    const replacements: Array<{ start: number; end: number; text: string }> = []
    let resolvedOnPage = 0
    let imgIndex = 0

    for (const target of imageTargets) {
      if (params.signal?.aborted) break
      let fileName = downloadedByUrl.get(target.url)
      if (!fileName) {
        if (imagePaths.length >= maxImages) continue
        const downloaded = await downloadImage(target.url, params.signal)
        if (!downloaded) continue
        imgIndex += 1
        fileName = `${pageBase}-img-${imgIndex}.${downloaded.ext}`
        const imgPath = join(params.attachDir, fileName)
        await atomicWriteFile(imgPath, downloaded.bytes)
        imagePaths.push(imgPath)
        downloadedByUrl.set(target.url, fileName)
      }
      resolvedOnPage += 1
      const label = target.alt ? `![${target.alt}](${fileName})` : `${target.raw}`
      replacements.push({
        start: target.start,
        end: target.end,
        text: `${label} [Attached image: ${fileName}]`,
      })
    }

    let finalMarkdown = cleaned
    for (let r = replacements.length - 1; r >= 0; r--) {
      const rep = replacements[r]!
      finalMarkdown = finalMarkdown.slice(0, rep.start) + rep.text + finalMarkdown.slice(rep.end)
    }

    omittedNonText += Math.max(0, totalNonText - resolvedOnPage)
    const filePath = join(params.attachDir, safeSnapshotName(item.title, item.id, i))
    await atomicWriteFile(filePath, Buffer.from(finalMarkdown, 'utf8'))
    notePaths.push(filePath)
  }

  const paths = [...notePaths, ...imagePaths]
  if (notePaths.length === 0) {
    return { ok: false, reason: 'failed' }
  }
  return {
    ok: true,
    paths,
    ...(failed > 0 ? { failed } : {}),
    ...(omittedNonText > 0 ? { omittedNonText } : {}),
  }
}
