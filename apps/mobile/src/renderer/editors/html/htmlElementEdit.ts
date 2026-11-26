// Element editing of the HTML editor (spec 5.4): what "edit text" offers for the selected
// element, the desktop ops it compiles to, the structural elements that cannot be removed, and
// how a selection is found again after the source changes. Every edit is a desktop op compiled
// by the desktop `compileOps` into one patch set; nothing here applies anything.
import { defaultTreeAdapter, html as parse5Html, parseFragment } from 'parse5'
import {
  compileOps,
  type CompiledOps,
  type HtmlOp,
} from '../../../../../html/src/renderer/document/ops'
import type { ElementEntry, ParseMap } from '../../../../../html/src/renderer/document/parse-map'
import type { Patch } from '../../../../../html/src/renderer/document/patch'

/** The document's frame: never removed from the phone (spec 5.4). */
export const STRUCTURAL_TAGS: ReadonlySet<string> = new Set(['html', 'head', 'body'])

/** Elements without content of their own (the desktop ops refuse text on them). */
const VOID_TAGS: ReadonlySet<string> = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])

/**
 * Elements whose content is raw text (code, styles, fallbacks): escaping typed text into them
 * would change what they mean, so they are edited in the source.
 */
const RAW_TEXT_TAGS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'template',
  'iframe',
  'noembed',
  'noframes',
  'noscript',
  'xmp',
  'plaintext',
])

/** One direct text node of the element offered for editing. */
export interface HtmlTextPart {
  /** Index into the element's text nodes (`set_text_node`'s index). */
  readonly index: number
  /** The text as the reader sees it (character references decoded). */
  readonly value: string
}

/** What "edit text" offers for one element. */
export type HtmlTextEditPlan =
  /** Text only: one field, `set_text` over the whole content. */
  | { readonly kind: 'text'; readonly sid: number; readonly value: string }
  /** Mixed content: one field per direct text node that is not blank, `set_text_node`. */
  | { readonly kind: 'nodes'; readonly sid: number; readonly parts: readonly HtmlTextPart[] }
  /** Nothing to edit as text: the source view. */
  | { readonly kind: 'source'; readonly sid: number }

const RCDATA_CONTEXT = {
  textarea: defaultTreeAdapter.createElement('textarea', parse5Html.NS.HTML, []),
  title: defaultTreeAdapter.createElement('title', parse5Html.NS.HTML, []),
}

/**
 * The text a raw text node reads as: its character references decoded the way the HTML parser
 * decodes them. Parsed as the content of a `<textarea>` (or `<title>` for a title), so markup
 * characters stay text; a text node of the source never closes either element.
 */
export function decodeTextNode(raw: string, ownerTag: string): string {
  const context = ownerTag === 'title' ? RCDATA_CONTEXT.title : RCDATA_CONTEXT.textarea
  const fragment = parseFragment(context, raw, {})
  let out = ''
  for (const node of fragment.childNodes) {
    if ('value' in node) out += node.value
  }
  return out
}

/** Markup that cannot be inside one text node of normal content: a tag, end tag or comment. */
const MARKUP_IN_TEXT = /<[a-zA-Z/!?]/

/**
 * The source range really is one text node and nothing else. The parser's location of a text
 * node can stretch over markup it skipped (the whitespace after `</body>` is located across the
 * `</body>` and `</html>` tags): writing over such a range would delete those tags.
 */
function isPlainTextRange(raw: string, ownerTag: string): boolean {
  if (ownerTag === 'title' || ownerTag === 'textarea') {
    return !new RegExp(`</${ownerTag}`, 'i').test(raw)
  }
  return !MARKUP_IN_TEXT.test(raw)
}

function hasChildElement(map: ParseMap, sid: number): boolean {
  return map.elements.some((entry) => entry.parentSid === sid)
}

/** The text nodes cover the whole content, with nothing else (comments, child elements) in it. */
function contentIsTextOnly(entry: ElementEntry): boolean {
  let cursor = entry.inner[0]
  for (const [from, to] of entry.textNodes) {
    if (from !== cursor) return false
    cursor = to
  }
  return cursor === entry.inner[1]
}

/** What "edit text" offers for the element `sid` of `map` (built from `source`). */
export function planTextEdit(source: string, map: ParseMap, sid: number): HtmlTextEditPlan | null {
  const entry = map.bySid.get(sid)
  if (!entry) return null
  if (VOID_TAGS.has(entry.tag) || RAW_TEXT_TAGS.has(entry.tag) || !entry.endTag) {
    return { kind: 'source', sid }
  }
  if (!hasChildElement(map, sid) && contentIsTextOnly(entry)) {
    const raw = source.slice(entry.inner[0], entry.inner[1])
    if (!isPlainTextRange(raw, entry.tag)) return { kind: 'source', sid }
    return { kind: 'text', sid, value: decodeTextNode(raw, entry.tag) }
  }
  const parts: HtmlTextPart[] = []
  entry.textNodes.forEach(([from, to], index) => {
    const raw = source.slice(from, to)
    if (!isPlainTextRange(raw, entry.tag)) return
    const value = decodeTextNode(raw, entry.tag)
    // the layout whitespace between child elements is not text anyone reads
    if (value.trim() !== '') parts.push({ index, value })
  })
  if (parts.length === 0) return { kind: 'source', sid }
  return { kind: 'nodes', sid, parts }
}

/**
 * The ops for the edited fields of `plan`: only fields that changed. `values` has one entry per
 * field (one for `text`, one per part for `nodes`).
 */
export function textEditOps(plan: HtmlTextEditPlan, values: readonly string[]): HtmlOp[] {
  if (plan.kind === 'text') {
    const text = values[0] ?? plan.value
    return text === plan.value ? [] : [{ op: 'set_text', sid: plan.sid, text }]
  }
  if (plan.kind === 'nodes') {
    const ops: HtmlOp[] = []
    plan.parts.forEach((part, i) => {
      const text = values[i] ?? part.value
      if (text !== part.value) {
        ops.push({ op: 'set_text_node', sid: plan.sid, index: part.index, text })
      }
    })
    return ops
  }
  return []
}

export type RemoveElementResult =
  | { readonly ok: true; readonly compiled: CompiledOps }
  | { readonly ok: false; readonly reason: 'structural' | 'missing' }

/** `remove` for the element `sid`; the document's `<html>`, `<head>` and `<body>` are refused. */
export function compileRemove(source: string, map: ParseMap, sid: number): RemoveElementResult {
  const entry = map.bySid.get(sid)
  if (!entry) return { ok: false, reason: 'missing' }
  if (STRUCTURAL_TAGS.has(entry.tag)) return { ok: false, reason: 'structural' }
  return { ok: true, compiled: compileOps(source, map, [{ op: 'remove', sid }]) }
}

// ---- the selection across source changes ----

/** The selected element, held by where its start tag begins in the current source. */
export interface HtmlSelection {
  /** Source offset of the element's start tag. */
  readonly start: number
  readonly tag: string
  /** Its element id in the map of the current version; null until looked up again. */
  readonly sid: number | null
}

/**
 * Where `offset` (the start of an element) is after `patches` (sorted, not overlapping, against
 * the text the offset is in). null: a patch replaced the element's start, so it is gone.
 * An insertion exactly at the offset goes before the element.
 */
export function mapOffsetThroughPatches(offset: number, patches: readonly Patch[]): number | null {
  const sorted = [...patches].sort((a, b) => a.from - b.from || a.to - b.to)
  let shift = 0
  for (const patch of sorted) {
    if (patch.from > offset) break
    if (patch.from === patch.to) {
      shift += patch.text.length
      continue
    }
    if (patch.to > offset) return null
    shift += patch.text.length - (patch.to - patch.from)
  }
  return offset + shift
}

/**
 * The one patch that turns `before` into `after`: the common start and end are kept. Used where
 * no patch set describes the change (undo, redo, a whole-source replace).
 */
export function diffAsPatch(before: string, after: string): Patch {
  const max = Math.min(before.length, after.length)
  let head = 0
  while (head < max && before.charCodeAt(head) === after.charCodeAt(head)) head++
  let tail = 0
  while (
    tail < max - head &&
    before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)
  ) {
    tail++
  }
  return { from: head, to: before.length - tail, text: after.slice(head, after.length - tail) }
}

/** The element of `map` that starts at `selection.start` with the same tag; null when none does. */
export function findSelectedEntry(map: ParseMap, selection: HtmlSelection): ElementEntry | null {
  for (const entry of map.elements) {
    if (entry.startTag[0] === selection.start) return entry.tag === selection.tag ? entry : null
    if (entry.startTag[0] > selection.start) return null
  }
  return null
}
