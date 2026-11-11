/**
 * A small reader for the WebDAV `207 Multi-Status` body of a PROPFIND. It
 * matches elements by local name, so any namespace prefix (`d:`, `D:`, none)
 * works, and it never resolves entities or DTDs: the body comes from a server
 * the person typed in, and a real XML parser would be one more way for it to
 * reach this PC.
 */

export interface DavResource {
  /** the server path as given in `href`, percent-decoded, no trailing slash except for the root */
  path: string
  /** the last path segment, or the server's display name */
  name: string
  isCollection: boolean
  /** bytes; absent for collections and servers that do not say */
  size?: number
  /** ISO time, or '' when the server gives none */
  modified: string
  /** the entity tag as sent (quotes and `W/` kept), or null */
  etag: string | null
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole
    }
    return ENTITIES[body.toLowerCase()] ?? whole
  })
}

/** One tag found by the scanner; `start`..`end` is the tag itself, `end` just past its `>` */
interface Tag {
  /** local name, lower case, without any namespace prefix */
  local: string
  kind: 'open' | 'close' | 'empty'
  start: number
  end: number
}

const TAG_NAME = /^<(\/?)(?:[\w.-]+:)?([\w.-]+)/
const MAX_TAG_HEAD = 400

/**
 * Every tag of `xml`, found in a single pass with `indexOf`. The body is up to
 * 16 MB and comes from a server that may be broken or hostile: a pattern that
 * looks for each closing tag from every opening tag can take quadratic time on
 * a body full of unclosed tags, and this cannot. Comments and CDATA are skipped.
 */
function tagsOf(xml: string): Tag[] {
  const out: Tag[] = []
  let i = 0
  for (;;) {
    i = xml.indexOf('<', i)
    if (i < 0) break
    if (xml.startsWith('<!--', i)) {
      const close = xml.indexOf('-->', i + 4)
      if (close < 0) break
      i = close + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', i)) {
      const close = xml.indexOf(']]>', i + 9)
      if (close < 0) break
      i = close + 3
      continue
    }
    const gt = xml.indexOf('>', i)
    if (gt < 0) break
    const name = TAG_NAME.exec(xml.slice(i, Math.min(gt + 1, i + MAX_TAG_HEAD)))
    if (name) {
      out.push({
        local: name[2]!.toLowerCase(),
        kind: name[1] ? 'close' : xml[gt - 1] === '/' ? 'empty' : 'open',
        start: i,
        end: gt + 1,
      })
    }
    i = gt + 1
  }
  return out
}

/** The insides of each element with this local name, in order (these elements do not nest) */
function blocksOf(xml: string, tags: readonly Tag[], local: string): string[] {
  const out: string[] = []
  let from = -1
  for (const tag of tags) {
    if (tag.local !== local) continue
    if (tag.kind === 'open') {
      from = tag.end
    } else if (tag.kind === 'close' && from >= 0) {
      out.push(xml.slice(from, tag.start))
      from = -1
    }
  }
  return out
}

/** The text of the first element with this local name inside `xml`, or null */
function elementText(
  xml: string,
  local: string,
  tags: readonly Tag[] = tagsOf(xml),
): string | null {
  let from = -1
  for (const tag of tags) {
    if (tag.local !== local) continue
    if (tag.kind === 'empty') return from < 0 ? '' : null
    if (tag.kind === 'open' && from < 0) from = tag.end
    else if (tag.kind === 'close' && from >= 0) {
      const inner = xml.slice(from, tag.start)
      const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(inner)
      return cdata ? (cdata[1] ?? '') : decodeEntities(inner.trim())
    }
  }
  return null
}

function hasElement(xml: string, local: string): boolean {
  return tagsOf(xml).some((tag) => tag.local === local && tag.kind !== 'close')
}

/** A `propstat` block is good when its status line says 2xx */
function okStatus(status: string | null): boolean {
  const match = status ? /\s(\d{3})(?:\s|$)/.exec(status) : null
  return match ? match[1]!.startsWith('2') : false
}

function decodePath(href: string): string | null {
  let path = href.trim()
  // an absolute URL: keep only the path
  const absolute = /^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/.*)?$/i.exec(path)
  if (absolute) path = absolute[1] ?? '/'
  const cut = path.search(/[?#]/)
  if (cut >= 0) path = path.slice(0, cut)
  try {
    path = decodeURIComponent(path)
  } catch {
    return null
  }
  if (!path.startsWith('/')) path = `/${path}`
  // `..` never appears in a server's own listing; a listing that has one is not trusted
  if (path.split('/').includes('..')) return null
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

function modifiedIso(value: string | null): string {
  if (!value) return ''
  const time = Date.parse(value)
  return Number.isNaN(time) ? '' : new Date(time).toISOString()
}

/** The most `response` elements read from one body; a listing is never larger in practice */
const MAX_RESPONSES = 100_000

/** Every `response` of a multi-status body that carries usable properties */
export function parseMultiStatus(body: string): DavResource[] {
  const out: DavResource[] = []
  const responses = blocksOf(body, tagsOf(body), 'response')
  for (const response of responses.slice(0, MAX_RESPONSES)) {
    const responseTags = tagsOf(response)
    const href = elementText(response, 'href', responseTags)
    const path = href === null ? null : decodePath(href)
    if (!path) continue
    // only the propstat blocks the server answered with 2xx
    const stats = blocksOf(response, responseTags, 'propstat')
    const good = stats.filter((stat) => okStatus(elementText(stat, 'status'))).join('\n')
    const props = stats.length > 0 ? good : response
    if (stats.length > 0 && !good) continue
    const propTags = tagsOf(props)
    const resourceType = blocksOf(props, propTags, 'resourcetype')[0] ?? ''
    const isCollection = hasElement(resourceType, 'collection')
    const lengthText = elementText(props, 'getcontentlength', propTags)
    const size = lengthText !== null && /^\d+$/.test(lengthText) ? Number(lengthText) : undefined
    const display = elementText(props, 'displayname', propTags)
    const last = path === '/' ? '' : path.slice(path.lastIndexOf('/') + 1)
    const resource: DavResource = {
      path,
      name: last || display || '/',
      isCollection,
      modified: modifiedIso(elementText(props, 'getlastmodified', propTags)),
      etag: elementText(props, 'getetag', propTags) || null,
    }
    if (size !== undefined && !isCollection) resource.size = size
    out.push(resource)
  }
  return out
}

/** The body of a PROPFIND asking for exactly what the app reads */
export const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<d:propfind xmlns:d="DAV:"><d:prop>' +
  '<d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getetag/><d:displayname/>' +
  '</d:prop></d:propfind>'
