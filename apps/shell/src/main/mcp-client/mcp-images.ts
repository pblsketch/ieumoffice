import {
  fetchRemoteImage,
  MAX_GENERATED_IMAGE_BYTES,
  readBodyCapped,
  storeGeneratedImage,
} from '@genoffice/electron-utils'
import type { McpPresetId } from '../../shared/mcp-servers-api'

/**
 * Validated image sniffing, optional WebP->PNG conversion, and safe local
 * caching for images arriving from Obsidian vaults, Notion/Canva connectors,
 * and MCP tool responses.
 *
 * Every cached image is written into the app's dedicated generated-image store
 * (`storeGeneratedImage`), whose UUID-named `file://` URLs are the only local
 * `file://` URLs accepted by editor `fetchRemoteImage` / `fetchImageBytes`.
 */

export interface SniffedImageFormat {
  mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  ext: 'png' | 'jpg' | 'gif' | 'webp'
}

export interface NormalizedImage {
  bytes: Uint8Array
  mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  ext: 'png' | 'jpg' | 'gif' | 'webp'
}

export type WebpToPngConverter = (bytes: Uint8Array) => Uint8Array | null

/** Default size ceiling for downloaded connector/MCP images (5 MB, matches chat attachments) */
export const MAX_CONNECTOR_IMAGE_BYTES = 5 * 1024 * 1024
/** Maximum images automatically cached per single MCP tool response */
export const MAX_CACHED_IMAGES_PER_CALL = 10

/** Detect PNG, JPEG, GIF, or WebP from magic bytes; returns null for non-image payloads */
export function sniffImageFormat(bytes: Uint8Array): SniffedImageFormat | null {
  if (bytes.byteLength < 12) return null
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mime: 'image/png', ext: 'png' }
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' }
  }
  // GIF87a / GIF89a
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return { mime: 'image/gif', ext: 'gif' }
  }
  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mime: 'image/webp', ext: 'webp' }
  }
  return null
}

/**
 * Validate image bytes by magic header and convert WebP to PNG when a converter
 * is supplied, since several document editors (Docs, Hangul, Sheets, Mindmap)
 * embed only PNG/JPEG/GIF.
 */
export function normalizeImageForEditors(
  bytes: Uint8Array,
  convertWebpToPng?: WebpToPngConverter,
): NormalizedImage | null {
  const fmt = sniffImageFormat(bytes)
  if (!fmt) return null
  if (fmt.ext === 'webp' && convertWebpToPng) {
    try {
      const png = convertWebpToPng(bytes)
      if (png && sniffImageFormat(png)?.ext === 'png') {
        return { bytes: png, mime: 'image/png', ext: 'png' }
      }
    } catch {
      // Fall back to original WebP bytes if conversion fails
    }
  }
  return { bytes, mime: fmt.mime, ext: fmt.ext }
}

/** Validate and persist image bytes into the app's generated-image store; returns a file:// URL */
export function storeMcpImageBytes(
  bytes: Uint8Array,
  options: {
    convertWebpToPng?: WebpToPngConverter
    maxBytes?: number
    store?: (bytes: Uint8Array, mime: string) => string
  } = {},
): string | null {
  const cap = options.maxBytes ?? MAX_GENERATED_IMAGE_BYTES
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > cap) {
    return null
  }
  const normalized = normalizeImageForEditors(bytes, options.convertWebpToPng)
  if (!normalized || normalized.bytes.byteLength > MAX_GENERATED_IMAGE_BYTES) return null
  try {
    return (options.store ?? storeGeneratedImage)(normalized.bytes, normalized.mime)
  } catch {
    return null
  }
}

/** Decode base64 from an MCP `image` content block, validate magic bytes, and cache locally */
export function storeMcpImageBase64(
  base64: string,
  options: {
    convertWebpToPng?: WebpToPngConverter
    maxBytes?: number
    store?: (bytes: Uint8Array, mime: string) => string
  } = {},
): string | null {
  const trimmed = base64.trim()
  if (!trimmed) return null
  const cap = options.maxBytes ?? MAX_GENERATED_IMAGE_BYTES
  // Fast upper-bound check before allocating the decoded buffer
  if (Math.ceil((trimmed.length * 3) / 4) > cap + 64) return null
  try {
    const buf = Buffer.from(trimmed, 'base64')
    if (buf.byteLength === 0 || buf.byteLength > cap) return null
    return storeMcpImageBytes(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), options)
  } catch {
    return null
  }
}

export interface DownloadImageOptions {
  signal?: AbortSignal
  maxBytes?: number
  convertWebpToPng?: WebpToPngConverter
  fetchImage?: (url: string, signal?: AbortSignal) => Promise<Response | null>
}

/**
 * Download an HTTPS image through the SSRF-guarded `fetchRemoteImage` pipeline,
 * cap its body size, verify magic bytes, and optionally convert WebP to PNG.
 */
export async function downloadImageToBytes(
  rawUrl: string,
  options: DownloadImageOptions = {},
): Promise<NormalizedImage | null> {
  if (options.signal?.aborted) return null
  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null

  const maxBytes = options.maxBytes ?? MAX_CONNECTOR_IMAGE_BYTES
  const fetchFn =
    options.fetchImage ?? ((url: string) => fetchRemoteImage(url, { retryDelaysMs: [300] }))
  try {
    const resp = await fetchFn(parsed.toString(), options.signal)
    if (options.signal?.aborted) return null
    if (!resp?.ok) {
      await resp?.body?.cancel().catch(() => {})
      return null
    }
    const bytes = await readBodyCapped(resp, maxBytes)
    if (options.signal?.aborted) return null
    return normalizeImageForEditors(bytes, options.convertWebpToPng)
  } catch {
    return null
  }
}

function hostMatchesSuffix(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`)
}

/**
 * Whether `rawUrl` belongs to the official media/export CDN of a curated remote
 * preset. Restricting automatic background caching during AI MCP tool calls to
 * official hosts prevents prompt-injected third-party tracking/exfiltration URLs
 * embedded in page text from being fetched automatically.
 */
export function isTrustedPresetImageUrl(presetId: McpPresetId | null, rawUrl: string): boolean {
  if (presetId !== 'notion' && presetId !== 'canva') return false
  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local') ||
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host)
  ) {
    return false
  }
  if (presetId === 'canva') {
    return (
      hostMatchesSuffix(host, 'canva.com') ||
      hostMatchesSuffix(host, 'canva-static.com') ||
      hostMatchesSuffix(host, 'canva.cn') ||
      hostMatchesSuffix(host, 'canva.site')
    )
  }
  // Notion hosted images & signed S3 attachments
  if (
    host === 'prod-files-secure.s3.us-west-2.amazonaws.com' ||
    host === 'file.notion.so' ||
    host === 'img.notionusercontent.com' ||
    host === 'images.unsplash.com' ||
    hostMatchesSuffix(host, 'notion-static.com') ||
    hostMatchesSuffix(host, 'notionusercontent.com')
  ) {
    return true
  }
  if (hostMatchesSuffix(host, 'notion.so') && /^\/(?:image|signed)\//i.test(parsed.pathname)) {
    return true
  }
  if (
    host === 's3.us-west-2.amazonaws.com' &&
    parsed.pathname.startsWith('/secure.notion-static.com/')
  ) {
    return true
  }
  return false
}

function cleanMatchedUrl(raw: string): string {
  return raw.trim().replace(/[),.;>]+$/, '')
}

/**
 * Extract trusted image URLs referenced inside a Notion or Canva MCP tool
 * output (Markdown images, Notion `<image>` tags, or JSON download/thumbnail fields).
 */
export function extractTrustedPresetImageUrls(
  presetId: McpPresetId | null,
  text: string,
): string[] {
  if (presetId !== 'notion' && presetId !== 'canva') return []
  const found: string[] = []
  const seen = new Set<string>()
  const push = (candidate: string) => {
    const cleaned = cleanMatchedUrl(candidate)
    if (!cleaned || seen.has(cleaned)) return
    if (!isTrustedPresetImageUrl(presetId, cleaned)) return
    seen.add(cleaned)
    found.push(cleaned)
  }

  if (presetId === 'notion') {
    // Markdown image syntax: ![alt](https://...)
    for (const m of text.matchAll(/!\[[^\]]*\]\(\s*(https:\/\/[^\s)]+)/gi)) {
      if (m[1]) push(m[1])
    }
    // Notion XML / HTML tags: <image source="..."/>, <image url="..."/>, <img src="..."/>
    for (const m of text.matchAll(
      /<(?:image|img)\b[^>]*\b(?:source|src|url)\s*=\s*["'](https:\/\/[^"']+)["'][^>]*>/gi,
    )) {
      if (m[1]) push(m[1])
    }
    // <image>https://...</image>
    for (const m of text.matchAll(/<image\b[^>]*>\s*(https:\/\/[^<\s]+)\s*<\/image>/gi)) {
      if (m[1]) push(m[1])
    }
    // Bare signed Notion S3 image URLs inside structured JSON fields
    for (const m of text.matchAll(
      /https:\/\/(?:prod-files-secure\.s3\.us-west-2\.amazonaws\.com|img\.notionusercontent\.com|file\.notion\.so)[^\s"'<>)]+/gi,
    )) {
      push(m[0])
    }
    return found
  }

  // Canva: scan JSON thumbnail/export download URLs, skipping non-image exports (.pptx/.pdf)
  for (const m of text.matchAll(/https:\/\/[^\s"'<>\\)]+/gi)) {
    const url = cleanMatchedUrl(m[0])
    if (/\.(?:pptx|pdf|mp4|gif\.zip|zip)(?:[?#]|$)/i.test(url)) continue
    push(url)
  }
  return found
}

export interface CachePresetImagesOptions {
  signal?: AbortSignal
  maxImages?: number
  downloadImage?: (url: string, signal?: AbortSignal) => Promise<NormalizedImage | null>
  storeImage?: (bytes: Uint8Array, mime: string) => string
  convertWebpToPng?: WebpToPngConverter
}

/**
 * Download trusted Notion/Canva image URLs found in an MCP tool output into the
 * local generated-image store and append a clean URL mapping note so the AI can
 * embed them into any editor document even while `keepResultsInside` is active.
 */
export async function cacheTrustedPresetImagesInOutput(
  presetId: McpPresetId | null,
  output: string,
  options: CachePresetImagesOptions = {},
): Promise<string> {
  if (!output || (presetId !== 'notion' && presetId !== 'canva')) return output
  const urls = extractTrustedPresetImageUrls(presetId, output).slice(
    0,
    options.maxImages ?? MAX_CACHED_IMAGES_PER_CALL,
  )
  if (urls.length === 0) return output

  const download =
    options.downloadImage ??
    ((url: string, signal?: AbortSignal) =>
      downloadImageToBytes(url, { signal, convertWebpToPng: options.convertWebpToPng }))
  const mappings: string[] = []

  for (const url of urls) {
    if (options.signal?.aborted) break
    const img = await download(url, options.signal)
    if (!img) continue
    const localUrl = storeMcpImageBytes(img.bytes, {
      convertWebpToPng: options.convertWebpToPng,
      store: options.storeImage,
    })
    if (localUrl) {
      mappings.push(`- ${url} -> ${localUrl}`)
    }
  }

  if (mappings.length === 0) return output
  return (
    `${output}\n\n` +
    'Cached images (ready to insert directly into the document using these local file:// URLs):\n' +
    mappings.join('\n')
  )
}
