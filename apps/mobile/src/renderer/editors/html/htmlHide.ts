// "Hide from AI" on an HTML element (spec 5.6). The marks are the desktop editor's:
// `data-gx-redact="label"` withholds an element's content, `data-gx-redact-<attr>="label"` one
// attribute's value. Writing a mark is the desktop plan (`document/redact-edit.ts`) for the
// selected element's start tag, compiled by the desktop ops; what is withheld is decided by the
// desktop projection (`ai/redact.ts`). Nothing here applies anything.
import {
  buildProjection,
  MARK_ATTR,
  MARK_ATTR_PREFIX,
  sanitizeLabel,
} from '../../../../../html/src/renderer/ai/redact'
import { compileOps } from '../../../../../html/src/renderer/document/ops'
import type { ElementEntry, ParseMap } from '../../../../../html/src/renderer/document/parse-map'
import type { Patch } from '../../../../../html/src/renderer/document/patch'
import { redactMarkPlan } from '../../../../../html/src/renderer/document/redact-edit'
import { STRUCTURAL_TAGS } from './htmlElementEdit'

/** One attribute of a start tag after its name, with or without a value (the desktop's scan). */
const ATTR_SCAN = /(\s+)([^\s"'<>/=]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/y

/** The attribute names of an element's start tag, in order. */
function attributeNames(source: string, entry: ElementEntry): string[] {
  const tag = source.slice(entry.startTag[0], entry.startTag[1])
  const name = /^<[^\s/>]+/.exec(tag)
  if (!name) return []
  ATTR_SCAN.lastIndex = name[0].length
  const out: string[] = []
  for (let m = ATTR_SCAN.exec(tag); m; m = ATTR_SCAN.exec(tag)) out.push(m[2]!)
  ATTR_SCAN.lastIndex = 0
  return out
}

/** The hide marks the element itself carries (not its children's). */
export function ownHideMarks(source: string, entry: ElementEntry): string[] {
  return attributeNames(source, entry).filter((attr) => {
    const lower = attr.toLowerCase()
    return lower === MARK_ATTR || lower.startsWith(MARK_ATTR_PREFIX)
  })
}

/** The elements that carry a hide mark themselves, for the preview's marking. */
export function hiddenElementSids(source: string, map: ParseMap): number[] {
  if (!/data-gx-redact/i.test(source)) return []
  return map.elements
    .filter((entry) => ownHideMarks(source, entry).length > 0)
    .map((entry) => entry.sid)
}

/** The first `<prefix><n>` (n = 1, 2, …) the document does not withhold anything under yet. */
export function nextHtmlHiddenLabel(source: string, map: ParseMap, prefix: string): string {
  const used = new Set(buildProjection(source, map).labels())
  for (let n = 1; ; n++) {
    const label = sanitizeLabel(`${prefix}${n}`)
    if (!used.has(label)) return label
  }
}

export type HtmlHideResult =
  | { readonly ok: true; readonly patches: Patch[] }
  | { readonly ok: false; readonly reason: 'structural' | 'cannot' | 'missing' }

/** The patch set that hides element `sid` from the model under `label`. */
export function planHide(
  source: string,
  map: ParseMap,
  sid: number,
  label: string,
): HtmlHideResult {
  const entry = map.bySid.get(sid)
  if (!entry) return { ok: false, reason: 'missing' }
  if (STRUCTURAL_TAGS.has(entry.tag)) return { ok: false, reason: 'structural' }
  // the whole start tag selected: the element's content, or every value of a void element
  const plan = redactMarkPlan(source, map, entry.startTag[0], entry.startTag[1], label)
  if (!plan) return { ok: false, reason: 'cannot' }
  const compiled = compileOps(source, map, plan.ops)
  if (compiled.errors.length > 0) return { ok: false, reason: 'cannot' }
  const patches = [...compiled.patches, ...plan.patches]
  return patches.length > 0 ? { ok: true, patches } : { ok: false, reason: 'cannot' }
}

/** The patch set that takes the element's own hide marks off; its words and attributes stay. */
export function planUnhide(source: string, map: ParseMap, sid: number): HtmlHideResult {
  const entry = map.bySid.get(sid)
  if (!entry) return { ok: false, reason: 'missing' }
  const marks = ownHideMarks(source, entry)
  if (marks.length === 0) return { ok: false, reason: 'cannot' }
  const compiled = compileOps(
    source,
    map,
    marks.map((name) => ({ op: 'set_attr' as const, sid, name, value: null })),
  )
  if (compiled.errors.length > 0 || compiled.patches.length === 0) {
    return { ok: false, reason: 'cannot' }
  }
  return { ok: true, patches: compiled.patches }
}
