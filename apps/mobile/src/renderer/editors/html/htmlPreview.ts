// The preview copy of an HTML document (spec 5.2): the source with the desktop editor's element
// ids and a Content-Security-Policy that keeps the document's scripts, plugins, frames, forms and
// base URL out. It goes into a script-less sandboxed frame only; save, share, recovery copies,
// AI and export always use the source itself.
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

/** `<meta http-equiv="refresh">` would move the frame to another page; the copy drops its effect. */
const META_REFRESH = /(<meta\b[^>]*?\s)http-equiv(\s*=\s*(["']?)\s*refresh\b)/gi

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

/** Where the CSP goes, in source offsets: first in `<head>`, else after the doctype, else at the start. */
function cspOffset(source: string, map: ParseMap): number {
  const head = map.elements.find((entry) => entry.tag === 'head')
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
  return instrumentWithoutInspector(withMeta, shifted).replace(
    META_REFRESH,
    '$1data-gx-http-equiv$2',
  )
}

/** The source (not a preview copy) has a script element that the phone does not run. */
export function hasDocumentScript(map: ParseMap): boolean {
  return map.elements.some((entry) => entry.tag === 'script')
}
