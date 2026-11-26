// The preview copy of an HTML document (spec 5.2): the source with the desktop editor's element
// ids and a Content-Security-Policy that keeps the document's scripts, plugins, frames, forms and
// base URL out. It goes into a script-less sandboxed frame only; save, share, recovery copies,
// AI and export always use the source itself (the export frame gets the source with the same
// policy and no element ids, buildExportCopy).
import { buildParseMap, type ParseMap } from '../../../../../html/src/renderer/document/parse-map'
import { instrumentForPreview, SID_ATTR } from '../../../../../html/src/renderer/preview/instrument'

export { SID_ATTR }

/** The policy of the preview copy. http(s) images, styles and fonts still load (owner, 11-26 Q4). */
export const PREVIEW_CSP =
  "script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'"

/** The one and only sandbox of the document frame: never one that lets scripts run (spec 8-1). */
export const PREVIEW_SANDBOX = 'allow-same-origin'

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`

/** What the desktop function appends for its inspector when given no inspector source. */
const EMPTY_INSPECTOR = '<script data-gx-inspector></script>'

/** A doctype after any leading whitespace and comments. */
const LEADING_DOCTYPE = /^(?:\s|<!--[\s\S]*?-->)*<!doctype[^>]*>/i

/** A `<meta>` start tag, reading quoted values whole (a `>` inside one does not end the tag). */
const META_TAG = /<meta(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>?/gi

/** One attribute of a start tag: its name, then an optional quoted or unquoted value. */
const TAG_ATTRIBUTE = /([^\s/>"'=]+)(\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g

/** Decodes HTML numeric character references and ASCII whitespace entities in an attribute value. */
function decodeMetaAttributeValue(value: string): string {
  return value
    .replace(/&#(?:x([0-9a-f]+)|(\d+));?/gi, (_match, hex: string | undefined, dec: string | undefined) => {
      const codePoint = hex ? Number.parseInt(hex, 16) : Number.parseInt(dec ?? '', 10)
      if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return ''
      return String.fromCodePoint(codePoint)
    })
    .replace(/&(?:tab|newline);/gi, ' ')
}

/**
 * `<meta http-equiv="refresh">` would move the frame to another page. In the copies only, the
 * `http-equiv` attribute of such a tag is renamed, however it is spelled (`<meta/http-equiv=…>`,
 * character references like `&#114;efresh`, a `>` in an earlier quoted value, any case or quoting).
 * Other `<meta>` tags stay as they are.
 */
function neutraliseMetaRefresh(html: string): string {
  return html.replace(META_TAG, (tag) => {
    TAG_ATTRIBUTE.lastIndex = 5 // after `<meta`
    let out = ''
    let copied = 0
    for (let m = TAG_ATTRIBUTE.exec(tag); m; m = TAG_ATTRIBUTE.exec(tag)) {
      const value = m[3] ?? m[4] ?? m[5]
      if (
        m[1].toLowerCase() === 'http-equiv' &&
        value !== undefined &&
        decodeMetaAttributeValue(value).trim().toLowerCase() === 'refresh'
      ) {
        out += `${tag.slice(copied, m.index)}data-gx-${m[1]}`
        copied = m.index + m[1].length
      }
    }
    return out + tag.slice(copied)
  })
}

/**
 * The desktop instrumenter with no inspector: its element ids, without the `<script
 * data-gx-inspector>` it always adds (scripts never run here, and the copy must carry none).
 */
function instrumentWithoutInspector(text: string, map: ParseMap): string {
  const out = instrumentForPreview(text, map, '')
  const bodyClose = out.search(/<\/body\s*>/i)
  if (bodyClose >= EMPTY_INSPECTOR.length) {
    const at = bodyClose - EMPTY_INSPECTOR.length
    if (out.slice(at, bodyClose) === EMPTY_INSPECTOR) return out.slice(0, at) + out.slice(bodyClose)
  }
  if (out.endsWith(EMPTY_INSPECTOR)) return out.slice(0, -EMPTY_INSPECTOR.length)
  // the desktop function changed how it adds the inspector: fail closed rather than guess
  throw new Error('The preview instrumenter added its inspector in an unexpected place.')
}

/** Where the CSP goes, in source offsets: first in top-level `<head>`, else after the doctype, else at the start. */
function cspOffset(source: string, map: ParseMap): number {
  const head = map.elements.find(
    (entry) => entry.tag === 'head' && (entry.path === 'head' || entry.path === 'html > head'),
  )
  if (head) return head.startTag[1]
  return LEADING_DOCTYPE.exec(source)?.[0].length ?? 0
}

/** The element map of `source`; `previous` keeps the element ids of unchanged elements. */
export function mapDocument(source: string, version: number, previous: ParseMap | null): ParseMap {
  return buildParseMap(source, version, previous)
}

/** The frame's copy of `source`. Never written anywhere. */
export function buildPreviewCopy(source: string, map: ParseMap): string {
  // The CSP goes in first; the start tags after it move by its length, so the ids still land
  // on the tags the map points at (the instrumenter reads only start tags and ids).
  const at = cspOffset(source, map)
  const withMeta = source.slice(0, at) + CSP_META + source.slice(at)
  const shift = CSP_META.length
  const shifted: ParseMap = {
    ...map,
    elements: map.elements.map((entry) =>
      entry.startTag[0] >= at
        ? { ...entry, startTag: [entry.startTag[0] + shift, entry.startTag[1] + shift] }
        : entry,
    ),
  }
  return neutraliseMetaRefresh(instrumentWithoutInspector(withMeta, shifted))
}

/**
 * The Word and ODT exports' copy of `source` (spec 5.7): the preview's policy and meta-refresh
 * guard, without the element ids. The converter then sees the document the preview shows.
 * Never written anywhere; the exported file is made from what the frame shows.
 */
export function buildExportCopy(source: string, map: ParseMap): string {
  const at = cspOffset(source, map)
  return neutraliseMetaRefresh(source.slice(0, at) + CSP_META + source.slice(at))
}

/** The source (not a preview copy) has a script element that the phone does not run. */
export function hasDocumentScript(map: ParseMap): boolean {
  return map.elements.some((entry) => entry.tag === 'script')
}
