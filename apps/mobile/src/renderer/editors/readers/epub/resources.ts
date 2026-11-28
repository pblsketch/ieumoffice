/**
 * Book resources for the drawing copy of one chapter. The phone has no
 * `epub-asset:` scheme, so every picture, stylesheet and font a chapter uses
 * is served as a `blob:` URL of the book's own zip entry.
 *
 * Paths are resolved only with the engine's `resolveHref` (`..` stops at the
 * zip root, a target with a scheme is never an entry). Only entries of the
 * open book are served, never a script entry, and each entry gets one URL per
 * chapter. A reference that cannot be served (missing entry, remote or other
 * scheme target, script) is removed, so nothing is fetched from outside.
 */
import { hasUrlScheme, resolveHref, type EpubBook } from '@genoffice/epub-engine/core'

/** Display types by file extension, used when the manifest does not name the entry. */
const EXTENSION_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  css: 'text/css',
  otf: 'font/otf',
  ttf: 'font/ttf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  xhtml: 'application/xhtml+xml',
  html: 'text/html',
  htm: 'text/html',
  xml: 'application/xml',
  js: 'text/javascript',
  mjs: 'text/javascript',
}

const SCRIPT_EXTENSIONS = new Set(['js', 'mjs'])

const extensionOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** The entry's type: the manifest's media type, else one from its extension. */
export function entryMediaType(book: EpubBook, path: string): string {
  const lower = path.toLowerCase()
  const item = book.manifest.find(
    (entry) => entry.path !== null && entry.path.toLowerCase() === lower,
  )
  const declared = item?.mediaType.trim().toLowerCase()
  if (declared) return declared
  return EXTENSION_TYPES[extensionOf(path)] ?? 'application/octet-stream'
}

/** A script entry is never served: a script media type, or a `.js`/`.mjs` name. */
export function isScriptEntry(path: string, mediaType: string): boolean {
  const type = mediaType.toLowerCase()
  return (
    type.includes('javascript') ||
    type.includes('ecmascript') ||
    SCRIPT_EXTENSIONS.has(extensionOf(path))
  )
}

/** Mints and revokes the blob URLs of one chapter. */
export interface UrlRecord {
  urls: string[]
  /** set once the URLs were revoked; a URL minted afterwards is revoked at once */
  released: boolean
}

export function revokeRecord(record: UrlRecord): void {
  record.released = true
  for (const url of record.urls) URL.revokeObjectURL(url)
  record.urls = []
}

/** The value kept, replaced or removed (null). */
type RefResult = string | null

const DATA_URL = /^data:/i

function cssUnescape(text: string): string {
  return text.replace(
    /\\(?:([0-9a-fA-F]{1,6})\s?|([\s\S]))/g,
    (_, hex: string | undefined, ch: string | undefined) => {
      if (hex !== undefined) {
        const code = parseInt(hex, 16)
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\uFFFD'
      }
      return ch === '\n' ? '' : (ch ?? '')
    },
  )
}

function unquote(raw: string): string {
  const first = raw[0]
  if ((first === '"' || first === "'") && raw.length >= 2 && raw.endsWith(first)) {
    return cssUnescape(raw.slice(1, -1))
  }
  return cssUnescape(raw)
}

const Q_DOUBLE = String.raw`"(?:[^"\\]|\\[\s\S])*"`
const Q_SINGLE = String.raw`'(?:[^'\\]|\\[\s\S])*'`
const QUOTED = `${Q_DOUBLE}|${Q_SINGLE}`
const URL_ARG = String.raw`\s*(${QUOTED}|[^)"'\s]*)\s*\)`

/**
 * One pass over a stylesheet: comments and strings are skipped as they are;
 * `@import` (url or string form, with its media list) and `url(…)` are the
 * places that load something.
 */
const CSS_TOKENS = new RegExp(
  [
    String.raw`\/\*[\s\S]*?\*\/`,
    // `@namespace p url(...)` names a namespace and loads nothing: kept as written
    String.raw`@namespace\b[^;{}]*;?`,
    String.raw`@import\s*(?:url\(${URL_ARG}|(${QUOTED}))([^;{}]*;?)`,
    QUOTED,
    String.raw`\burl\(${URL_ARG}`,
  ].join('|'),
  'gi',
)

/** Keeps a style element's text from closing the element in the HTML the frame parses. */
export function escapeStyleText(css: string): string {
  return css.replace(/<\/(style)/gi, '<\\/$1')
}

/** The resources of one chapter's drawing copy. */
export class ChapterResources {
  private readonly entryUrls = new Map<string, Promise<string | null>>()
  private readonly sheetUrls = new Map<string, Promise<string | null>>()

  constructor(
    private readonly book: EpubBook,
    private readonly record: UrlRecord,
  ) {}

  private mint(bytes: BlobPart, type: string): string | null {
    const url = URL.createObjectURL(new Blob([bytes], { type }))
    if (this.record.released) {
      // the book was closed while this chapter was being drawn
      URL.revokeObjectURL(url)
      return null
    }
    this.record.urls.push(url)
    return url
  }

  /** The entry's type when it may be served, else null. */
  private servable(path: string): string | null {
    if (path === '' || !this.book.has(path)) return null
    const type = entryMediaType(this.book, path)
    return isScriptEntry(path, type) ? null : type
  }

  /** The blob URL of a zip entry, or null when it cannot be served. One per entry. */
  entryUrl(path: string): Promise<string | null> {
    let known = this.entryUrls.get(path)
    if (!known) {
      known = (async () => {
        const type = this.servable(path)
        if (type === null) return null
        const bytes = await this.book.readForRendering(path)
        return bytes ? this.mint(bytes as Uint8Array<ArrayBuffer>, type) : null
      })()
      this.entryUrls.set(path, known)
    }
    return known
  }

  /** A stylesheet entry's text without a byte order mark, or null when it cannot be served. */
  async stylesheetText(path: string): Promise<string | null> {
    if (this.servable(path) === null) return null
    const decoded = await this.book.readText(path)
    return decoded ? decoded.text.replace(/^\uFEFF/, '') : null
  }

  /**
   * A resource reference found in the entry `basePath`, served from the book:
   * the blob URL (its fragment kept), the reference unchanged for `data:` and
   * same-document `#…`, or null to remove it.
   */
  async ref(basePath: string, value: string): Promise<RefResult> {
    const trimmed = value.trim()
    if (trimmed === '') return null
    if (DATA_URL.test(trimmed) || trimmed.startsWith('#')) return trimmed
    if (hasUrlScheme(trimmed)) return null
    const resolved = resolveHref(basePath, trimmed)
    if (!resolved) return null
    const url = await this.entryUrl(resolved.path)
    if (url === null) return null
    const hash = trimmed.indexOf('#')
    return hash < 0 ? url : url + trimmed.slice(hash)
  }

  /** A stylesheet entry rewritten and served as a blob URL, for `@import`; null when it cannot be. */
  private sheetUrl(path: string, importing: ReadonlySet<string>): Promise<string | null> {
    let known = this.sheetUrls.get(path)
    if (!known) {
      known = (async () => {
        const text = await this.stylesheetText(path)
        if (text === null) return null
        const css = await this.rewriteCss(text, path, new Set([...importing, path]))
        return this.mint(css, 'text/css')
      })()
      this.sheetUrls.set(path, known)
    }
    return known
  }

  /**
   * Rewrites every `url(…)` and `@import` of a stylesheet found in the entry
   * `basePath`. `importing` holds the sheets of the current import chain: an
   * import back into it is dropped.
   */
  async rewriteCss(
    css: string,
    basePath: string,
    importing: ReadonlySet<string> = new Set(),
  ): Promise<string> {
    const parts: string[] = []
    let last = 0
    for (const match of css.matchAll(CSS_TOKENS)) {
      const at = match.index
      parts.push(css.slice(last, at))
      last = at + match[0].length
      const [whole, importUrl, importString, importRest, plainUrl] = match
      if (importUrl !== undefined || importString !== undefined) {
        parts.push(
          await this.rewriteImport(
            unquote(importUrl ?? importString ?? ''),
            importRest ?? '',
            basePath,
            importing,
          ),
        )
      } else if (plainUrl !== undefined) {
        const target = unquote(plainUrl)
        if (target.trim().startsWith('#')) {
          parts.push(whole)
        } else {
          const value = await this.ref(basePath, target)
          parts.push(
            value === null
              ? 'none'
              : `url("${value.replace(/["\\\n]/g, (c) => `\\${c === '\n' ? 'a ' : c}`)}")`,
          )
        }
      } else {
        // a comment, a string or an @namespace rule
        parts.push(whole)
      }
    }
    parts.push(css.slice(last))
    return parts.join('')
  }

  private async rewriteImport(
    target: string,
    rest: string,
    basePath: string,
    importing: ReadonlySet<string>,
  ): Promise<string> {
    const trimmed = target.trim()
    const ending = rest.endsWith(';') ? rest : `${rest};`
    if (DATA_URL.test(trimmed))
      return `@import url("${trimmed.replace(/["\\]/g, '\\$&')}")${ending}`
    if (trimmed === '' || hasUrlScheme(trimmed)) return ''
    const resolved = resolveHref(basePath, trimmed)
    if (
      !resolved ||
      resolved.path === '' ||
      importing.has(resolved.path) ||
      resolved.path === basePath
    )
      return ''
    const url = await this.sheetUrl(resolved.path, importing)
    return url === null ? '' : `@import url("${url}")${ending}`
  }
}
