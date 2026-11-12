import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { PmMark, PmNode } from '../editor/convert'
import { textStyleKey, type BaseTextStyle } from './inherit-formatting'
import { REDACT_MARK, placeholderSource } from './redact'

/**
 * Keep tokens. The model reads a block as restricted HTML, and much of what a
 * block holds has no tag there: a footnote mark, a picture, a comment range, a
 * run in another colour. The model view prints each such object as an opaque
 * token, and a rewrite puts the original JSON back from it, so the model can
 * reword and move text around those objects but cannot lose one silently.
 *
 * Ids are content-addressed (a hash of the object's JSON). Reading and writing
 * derive them from the live document with the same projection, so nothing is
 * stored between the two: the live range is the registry.
 */

/** 'k' + 7 base36 characters of a hash over the object's canonical JSON */
export type KeepId = string & { readonly __brand: 'KeepId' }

export type KeepObject =
  /** a non-text inline node, or a run group whose text the model must not edit; restored verbatim */
  | { kind: 'atom'; id: KeepId; identity: string; what: string; text: string; inline: boolean }
  /** marks the tags cannot write; `style` undefined = the base style, null = no style */
  | {
      kind: 'span'
      id: KeepId
      identity: string
      marks: PmMark[]
      style: PmMark | null | undefined
      text: string
    }
  | { kind: 'link'; id: KeepId; identity: string; mark: PmMark; text: string }
  /** the reader's withheld runs, addressed only by their placeholder */
  | { kind: 'withheld'; placeholder: string }

export interface KeepEntry {
  readonly object: KeepObject
  count: number
  readonly blockIndex: number
  /** the original nodes of each occurrence, in document order */
  readonly occurrences: PmNode[][]
}

export interface KeepInventory {
  readonly entries: Map<string, KeepEntry>
  /** ids two different objects of the range hash to */
  readonly collisions: Set<string>
  /** how many blocks of the range each comment id is on */
  readonly commentBlocks: Map<string, number>
}

export type ViewItem =
  | {
      kind: 'text'
      from: number
      text: string
      tags: string[]
      link: KeepObject | null
      span: KeepObject | null
      node: PmNode
    }
  | { kind: 'br'; from: number }
  | { kind: 'formula'; from: number; latex: string }
  | { kind: 'token'; from: number; size: number; object: KeepObject; nodes: PmNode[] }
  | { kind: 'hidden'; from: number; size: number }

export type TextItem = Extract<ViewItem, { kind: 'text' }>

export type KeepIssue =
  | { kind: 'missing'; key: string; short: number }
  | { kind: 'duplicated'; key: string; extra: number }
  | { kind: 'unknown'; key: string }
  | { kind: 'misplaced'; key: string }
  | { kind: 'keptAndDropped'; key: string }
  | { kind: 'overDropped'; key: string }
  | { kind: 'badDrop'; detail: string }
  | { kind: 'splitComment'; key: string; commentId: string; blocks: number }
  | { kind: 'collision'; key: string }

export type DropList = ReadonlyMap<string, number>

// ---- classification ----

type MarkClass = 'tag' | 'link' | 'insert' | 'delete' | 'withheld' | 'fixed' | 'style' | 'span'

/** marks whose text is a computed or glyph result: the run group is one object the model cannot edit */
const FIXED_MARK_WHAT: Readonly<Record<string, string>> = {
  refField: 'cross-reference',
  instrField: 'field',
  docSym: 'symbol',
  ctrlCheckbox: 'checkbox',
}

const MARK_CLASS: Readonly<Record<string, MarkClass>> = {
  bold: 'tag',
  italic: 'tag',
  underline: 'tag',
  strike: 'tag',
  link: 'link',
  ins: 'insert',
  del: 'delete',
  [REDACT_MARK]: 'withheld',
  docTextStyle: 'style',
}

/** an unlisted mark rides in a span, so a mark type added later is kept, never dropped */
function markClass(type: string): MarkClass {
  if (FIXED_MARK_WHAT[type]) return 'fixed'
  return MARK_CLASS[type] ?? 'span'
}

/** printed in the same order the restricted HTML parser reads them back */
const TAGS: ReadonlyArray<readonly [string, string]> = [
  ['bold', 'strong'],
  ['italic', 'em'],
  ['underline', 'u'],
  ['strike', 's'],
]

/** how a keep atom names itself; an unlisted inline node type is an atom named after its type */
const ATOM_WHAT: Readonly<
  Record<string, (attrs: Record<string, unknown>) => { what: string; text?: string }>
> = {
  docNoteRef: (a) => ({
    what: `${a.kind === 'endnote' ? 'endnote' : 'footnote'} ${Number(a.num) || 1}`,
  }),
  docInlineImage: (a) => ({ what: a.rule ? 'horizontal line' : 'picture' }),
  docXeMark: (a) => ({ what: 'index entry', text: String(a.term ?? '') }),
  docRuby: (a) => ({ what: 'ruby', text: String(a.base ?? '') }),
  docInlineMath: (a) => ({ what: 'formula', text: String(a.text ?? '') }),
}

/** attrs that change without the object changing (renumbering, the AI highlight) */
const VOLATILE_ATTRS: Readonly<Record<string, readonly string[]>> = { docNoteRef: ['num'] }

const REVISION_MARKS = new Set(['ins', 'del'])
const TEXT_BLOCKS = new Set(['docParagraph', 'docHeading', 'docListItem'])

export const KEEP_NODE = '$keep'
export const SPAN_MARK = '$span'
export const LINK_MARK = '$link'
const ID_SHAPE = /^k[0-9a-z]{7}$/

// ---- identity ----

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`
}

function fnv1a(text: string, seed: number): number {
  let h = seed
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** id from 36 of 64 hashed bits; the full 64 tell two objects with one id apart */
function hashed(value: unknown): { id: KeepId; identity: string } {
  const text = canonical(value)
  const a = fnv1a(text, 0x811c9dc5)
  const b = fnv1a(text, 0x050c5d1f)
  const n = a * 16 + (b & 15)
  return { id: `k${n.toString(36).padStart(7, '0')}` as KeepId, identity: `${a}:${b}` }
}

function withoutRevision(node: PmNode): PmNode {
  const marks = node.marks?.filter((m) => !REVISION_MARKS.has(m.type))
  if (!node.marks || marks?.length === node.marks.length) return node
  const { marks: _drop, ...rest } = node
  return marks && marks.length > 0 ? { ...rest, marks } : rest
}

/** the parts of a node that make it this object */
function stable(node: PmNode): PmNode {
  const volatile = VOLATILE_ATTRS[node.type] ?? []
  const attrs = node.attrs
    ? Object.fromEntries(
        Object.entries(node.attrs).filter(([k]) => k !== 'aiChanged' && !volatile.includes(k)),
      )
    : undefined
  const base = withoutRevision(node)
  return { ...base, ...(attrs ? { attrs } : {}) }
}

/** the keep key of a restored inline atom, as the projection computes it */
export function atomKeyOf(node: PmNode): string {
  return hashed(['atom', [stable(node)]]).id
}

function keyOf(object: KeepObject): string {
  return object.kind === 'withheld' ? object.placeholder : object.id
}

// ---- projection: a block's inline content as the model sees it ----

const sizeOf = (node: PmNode): number => (node.type === 'text' ? (node.text ?? '').length : 1)
const isDeleted = (node: PmNode): boolean => (node.marks ?? []).some((m) => m.type === 'del')

function withheldPlaceholder(node: PmNode): string | null {
  const mark = (node.marks ?? []).find((m) => m.type === REDACT_MARK)
  if (!mark) return null
  const label = mark.attrs?.label
  return placeholderSource(typeof label === 'string' ? label : 'private')
}

function fixedMarks(node: PmNode): PmMark[] {
  return (node.marks ?? []).filter((m) => markClass(m.type) === 'fixed')
}

function latexOf(node: PmNode): string {
  return node.type === 'docInlineMath' ? String(node.attrs?.latex ?? '') : ''
}

function spanObject(node: PmNode, base: BaseTextStyle): KeepObject | null {
  const marks = (node.marks ?? []).filter((m) => markClass(m.type) === 'span')
  const own = (node.marks ?? []).find((m) => m.type === 'docTextStyle') ?? null
  const style = textStyleKey(own) === base.key ? undefined : own
  if (marks.length === 0 && style === undefined) return null
  const { id, identity } = hashed(['span', marks, style === undefined ? '=' : style])
  return { kind: 'span', id, identity, marks, style, text: node.text ?? '' }
}

function linkObject(node: PmNode): KeepObject | null {
  const mark = (node.marks ?? []).find((m) => m.type === 'link')
  if (!mark) return null
  const { id, identity } = hashed(['link', mark])
  return { kind: 'link', id, identity, mark, text: node.text ?? '' }
}

function atomObject(nodes: PmNode[]): KeepObject {
  const first = nodes[0]!
  const { id, identity } = hashed(['atom', nodes.map(stable)])
  if (first.type === 'text') {
    const fixed = fixedMarks(first)[0]
    return {
      kind: 'atom',
      id,
      identity,
      what: FIXED_MARK_WHAT[fixed?.type ?? ''] ?? 'field',
      text: nodes.map((n) => n.text ?? '').join(''),
      inline: false,
    }
  }
  const named = ATOM_WHAT[first.type]?.(first.attrs ?? {}) ?? { what: first.type }
  return { kind: 'atom', id, identity, what: named.what, text: named.text ?? '', inline: true }
}

function runFrom(content: readonly PmNode[], start: number, same: (n: PmNode) => boolean) {
  let end = start + 1
  while (end < content.length && same(content[end]!)) end++
  return content.slice(start, end)
}

/**
 * Classify a block's inline content. Withheld wins over every other class, so
 * no other branch ever reads a withheld run's text; a deleted run is hidden
 * but still occupies its positions.
 */
export function projectInline(content: readonly PmNode[], base: BaseTextStyle): ViewItem[] {
  const items: ViewItem[] = []
  let pos = 0
  let i = 0
  while (i < content.length) {
    const node = content[i]!
    if (isDeleted(node)) {
      items.push({ kind: 'hidden', from: pos, size: sizeOf(node) })
      pos += sizeOf(node)
      i++
      continue
    }
    const placeholder = withheldPlaceholder(node)
    let group: PmNode[] = [node]
    if (placeholder !== null) {
      group = runFrom(content, i, (n) => !isDeleted(n) && withheldPlaceholder(n) === placeholder)
      items.push({
        kind: 'token',
        from: pos,
        size: group.reduce((s, n) => s + sizeOf(n), 0),
        object: { kind: 'withheld', placeholder },
        nodes: group,
      })
    } else if (node.type === 'text') {
      const fixed = canonical(fixedMarks(node))
      if (fixed !== '[]') {
        group = runFrom(
          content,
          i,
          (n) =>
            n.type === 'text' &&
            !isDeleted(n) &&
            withheldPlaceholder(n) === null &&
            canonical(fixedMarks(n)) === fixed,
        )
        items.push({
          kind: 'token',
          from: pos,
          size: group.reduce((s, n) => s + sizeOf(n), 0),
          object: atomObject(group),
          nodes: group,
        })
      } else {
        items.push({
          kind: 'text',
          from: pos,
          text: node.text ?? '',
          tags: TAGS.filter(([mark]) => (node.marks ?? []).some((m) => m.type === mark)).map(
            ([mark]) => mark,
          ),
          link: linkObject(node),
          span: spanObject(node, base),
          node,
        })
      }
    } else if (node.type === 'hardBreak') {
      items.push({ kind: 'br', from: pos })
    } else if (latexOf(node)) {
      // editor-made formulas carry their LaTeX and rebuild from it losslessly
      items.push({ kind: 'formula', from: pos, latex: latexOf(node) })
    } else {
      items.push({ kind: 'token', from: pos, size: 1, object: atomObject([node]), nodes: [node] })
    }
    pos += group.reduce((s, n) => s + sizeOf(n), 0)
    i += group.length
  }
  return items
}

/** a selection edge inside a group the model cannot split moves to the group's edge */
export function widenToItems(
  items: readonly ViewItem[],
  from: number,
  to: number,
): { from: number; to: number } {
  for (const item of items) {
    if (item.kind !== 'token' || item.size < 2) continue
    const end = item.from + item.size
    if (item.from < from && from < end) from = item.from
    if (item.from < to && to < end) to = end
  }
  return { from, to }
}

// ---- printing ----

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const escapeAttr = (text: string): string => escapeHtml(text).replace(/"/g, '&quot;')
const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text

function keepTag(object: Extract<KeepObject, { kind: 'atom' }>): string {
  const text = object.text ? ` text="${escapeAttr(clip(object.text, 80))}"` : ''
  return `<keep id="${object.id}" what="${escapeAttr(object.what)}"${text}/>`
}

function textHtml(text: string, item: TextItem): string {
  let html = escapeHtml(text)
  for (const [mark, tag] of TAGS) if (item.tags.includes(mark)) html = `<${tag}>${html}</${tag}>`
  if (item.link?.kind === 'link') {
    const href = escapeAttr(String(item.link.mark.attrs?.href ?? ''))
    html = `<a href="${href}" id="${item.link.id}">${html}</a>`
  }
  if (item.span) html = `<span id="${keyOf(item.span)}">${html}</span>`
  return html
}

function tokenHtml(item: Exclude<ViewItem, TextItem>): string {
  if (item.kind === 'br') return '<br>'
  if (item.kind === 'formula') return `<formula>${escapeHtml(item.latex)}</formula>`
  if (item.kind === 'hidden') return ''
  return item.object.kind === 'atom' ? keepTag(item.object) : escapeHtml(keyOf(item.object))
}

/** the items as restricted HTML; with `sel` (offsets in the block), the selected span sits inside <sel>…</sel> */
export function itemsHtml(
  items: readonly ViewItem[],
  sel?: { from: number; to: number } | null,
): string {
  let html = ''
  let open = false
  let pending = sel && sel.from < sel.to ? sel : null
  const boundary = (at: number) => {
    if (!pending) return
    if (!open && at >= pending.from && at < pending.to) {
      html += '<sel>'
      open = true
    }
    if (open && at >= pending.to) {
      html += '</sel>'
      open = false
      pending = null
    }
  }
  let end = 0
  for (const item of items) {
    if (item.kind === 'text') {
      const stop = item.from + item.text.length
      const cuts = [item.from]
      if (pending)
        for (const c of [pending.from, pending.to]) if (c > item.from && c < stop) cuts.push(c)
      cuts.push(stop)
      for (let i = 0; i < cuts.length - 1; i++) {
        boundary(cuts[i]!)
        html += textHtml(item.text.slice(cuts[i]! - item.from, cuts[i + 1]! - item.from), item)
      }
      end = stop
      continue
    }
    boundary(item.from)
    html += tokenHtml(item)
    end = item.from + (item.kind === 'token' || item.kind === 'hidden' ? item.size : 1)
  }
  boundary(end)
  if (open) html += '</sel>'
  return html
}

// ---- inventory ----

export function emptyInventory(): KeepInventory {
  return { entries: new Map(), collisions: new Set(), commentBlocks: new Map() }
}

function identityOf(object: KeepObject): string {
  return object.kind === 'withheld' ? object.placeholder : object.identity
}

function addObject(inv: KeepInventory, object: KeepObject, nodes: PmNode[], blockIndex: number) {
  const key = keyOf(object)
  const entry = inv.entries.get(key)
  if (!entry) {
    inv.entries.set(key, { object, count: 1, blockIndex, occurrences: [nodes] })
    return
  }
  if (identityOf(entry.object) !== identityOf(object)) inv.collisions.add(key)
  entry.count++
  entry.occurrences.push(nodes)
}

function commentIdsOf(marks: readonly PmMark[] | undefined): string[] {
  const mark = (marks ?? []).find((m) => m.type === 'comment')
  return String(mark?.attrs?.ids ?? '')
    .split(' ')
    .filter(Boolean)
}

/**
 * Add what one block's items hold to the inventory. With `inside` (offsets in
 * the block, already widened), only the objects inside it count: a selection
 * rewrite answers for what it replaces.
 */
export function addItems(
  inv: KeepInventory,
  items: readonly ViewItem[],
  blockIndex: number,
  inside?: { from: number; to: number } | null,
): void {
  const comments = new Set<string>()
  for (const item of items) {
    if (item.kind === 'text') {
      if (inside && (item.from + item.text.length <= inside.from || item.from >= inside.to))
        continue
      if (item.link) addObject(inv, item.link, [], blockIndex)
      if (item.span) addObject(inv, item.span, [], blockIndex)
      for (const id of commentIdsOf(item.node.marks)) comments.add(id)
    } else if (item.kind === 'token') {
      if (inside && (item.from < inside.from || item.from + item.size > inside.to)) continue
      addObject(inv, item.object, item.nodes, blockIndex)
      for (const node of item.nodes) for (const id of commentIdsOf(node.marks)) comments.add(id)
    }
  }
  for (const id of comments) inv.commentBlocks.set(id, (inv.commentBlocks.get(id) ?? 0) + 1)
}

// ---- parsing the model's HTML ----

/** `<keep …/>`, `<keep …>` and `<keep …></keep>` all become an empty element; nothing is ever swallowed */
export function normalizeKeepTags(html: string): string {
  return html.replace(/<\/keep\s*>/gi, '').replace(/<keep\b([^>]*?)\/?>/gi, '<keep$1></keep>')
}

/** a token id on an element; other id values are ordinary attributes */
export function tokenIdOf(el: Element): string | null {
  const id = el.getAttribute('id')
  return id && ID_SHAPE.test(id) ? id : null
}

// ---- restoring originals from the model's tokens ----

export interface InlineDefaults {
  /** the docTextStyle text without a span of its own takes */
  readonly style: PmMark | null
  /** the span of the replaced text, which unspanned text continues */
  readonly span: KeepObject | null
  /** tag marks and link of the replaced text, continued when the fragment writes none */
  readonly tags: PmMark[]
  readonly link: KeepObject | null
  /** the fragment writes its own tags or links */
  readonly styled: boolean
}

export type Restored =
  | {
      ok: true
      nodes: PmNode[]
      used: ReadonlyMap<string, number>
      once: ReadonlyMap<string, number>
    }
  | { ok: false; issues: KeepIssue[] }

function setMark(marks: PmMark[], mark: PmMark): PmMark[] {
  return [...marks.filter((m) => m.type !== mark.type), mark]
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

class Restorer {
  readonly used = new Map<string, number>()
  readonly once = new Map<string, number>()
  readonly issues: KeepIssue[] = []
  private readonly unknown = new Set<string>()
  private readonly placeholders: RegExp | null

  constructor(
    readonly inv: KeepInventory,
    readonly defaults?: InlineDefaults,
  ) {
    const withheld = [...inv.entries.keys()].filter(
      (k) => inv.entries.get(k)!.object.kind === 'withheld',
    )
    this.placeholders =
      withheld.length > 0 ? new RegExp(withheld.map(escapeRegExp).join('|'), 'g') : null
  }

  /** one use of `key`; the entry and the ordinal of this use, null when the range has no such object */
  private use(key: string, kind: KeepObject['kind']): { entry: KeepEntry; ordinal: number } | null {
    const entry = this.inv.entries.get(key)
    if (!entry || entry.object.kind !== kind) {
      if (!this.unknown.has(key)) this.issues.push({ kind: 'unknown', key })
      this.unknown.add(key)
      return null
    }
    const ordinal = this.used.get(key) ?? 0
    this.used.set(key, ordinal + 1)
    return { entry, ordinal }
  }

  private original(hit: { entry: KeepEntry; ordinal: number }): PmNode[] {
    const all = hit.entry.occurrences
    return (all[Math.min(hit.ordinal, all.length - 1)] ?? []).map(withoutRevision)
  }

  block(node: PmNode): PmNode | null {
    if (node.type === KEEP_NODE) {
      const key = String(node.attrs?.id ?? '')
      if (this.use(key, 'atom')) this.issues.push({ kind: 'misplaced', key })
      return null
    }
    if (!TEXT_BLOCKS.has(node.type) || !node.content) return node
    return { ...node, content: this.inline(node.content) }
  }

  inline(content: readonly PmNode[]): PmNode[] {
    const out: PmNode[] = []
    for (const node of content) {
      if (node.type === KEEP_NODE) {
        const key = String(node.attrs?.id ?? '')
        const hit = this.use(key, 'atom')
        if (!hit) continue
        if (hit.entry.object.kind === 'atom' && hit.entry.object.inline)
          this.once.set(key, (this.once.get(key) ?? 0) + 1)
        out.push(...this.original(hit))
      } else if (node.type === 'text') {
        out.push(...this.text(node))
      } else {
        out.push(node)
      }
    }
    return out
  }

  private applySpan(
    marks: PmMark[],
    span: KeepObject,
  ): { marks: PmMark[]; style: PmMark | null | undefined } {
    if (span.kind !== 'span') return { marks, style: undefined }
    let next = marks
    for (const m of span.marks) next = setMark(next, m)
    return { marks: next, style: span.style }
  }

  private text(node: PmNode): PmNode[] {
    const own = node.marks ?? []
    let marks = own.filter((m) => m.type !== SPAN_MARK && m.type !== LINK_MARK)
    let style: PmMark | null | undefined
    const link = own.find((m) => m.type === LINK_MARK)
    if (link) {
      const hit = this.use(String(link.attrs?.id ?? ''), 'link')
      if (hit && hit.entry.object.kind === 'link') {
        const original = hit.entry.object.mark
        const href = link.attrs?.href
        marks = setMark(
          marks,
          typeof href === 'string' && href !== original.attrs?.href
            ? { ...original, attrs: { ...original.attrs, href, rId: null } }
            : original,
        )
      }
    }
    const spans = own.filter((m) => m.type === SPAN_MARK)
    for (const span of spans) {
      const hit = this.use(String(span.attrs?.id ?? ''), 'span')
      if (!hit) continue
      const applied = this.applySpan(marks, hit.entry.object)
      marks = applied.marks
      if (applied.style !== undefined) style = applied.style
    }
    const d = this.defaults
    if (d) {
      if (spans.length === 0 && d.span) {
        this.use(keyOf(d.span), 'span')
        const applied = this.applySpan(marks, d.span)
        marks = applied.marks
        if (applied.style !== undefined) style = applied.style
      }
      if (style === undefined) style = d.style
      if (!d.styled) {
        for (const tag of d.tags) marks = setMark(marks, tag)
        if (d.link?.kind === 'link' && !marks.some((m) => m.type === 'link')) {
          this.use(keyOf(d.link), 'link')
          marks = setMark(marks, d.link.mark)
        }
      }
    }
    if (style !== undefined) {
      marks = marks.filter((m) => m.type !== 'docTextStyle')
      if (style) marks.push(style)
    }
    const next: PmNode = { ...node }
    if (marks.length > 0) next.marks = marks
    else delete next.marks
    return this.withheld(next)
  }

  /** a placeholder of this range in the text becomes the reader's own runs again */
  private withheld(node: PmNode): PmNode[] {
    const text = node.text ?? ''
    const re = this.placeholders
    if (!re || !text.includes('{{')) return [node]
    const out: PmNode[] = []
    let cursor = 0
    re.lastIndex = 0
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m.index > cursor) out.push({ ...node, text: text.slice(cursor, m.index) })
      const hit = this.use(m[0], 'withheld')
      if (hit) out.push(...this.original(hit))
      cursor = m.index + m[0].length
    }
    if (cursor < text.length) out.push({ ...node, text: text.slice(cursor) })
    return out
  }

  check(drop: DropList): void {
    for (const [key, entry] of this.inv.entries) {
      const used = this.used.get(key) ?? 0
      const dropped = drop.get(key) ?? 0
      if (entry.object.kind === 'span' || entry.object.kind === 'link') {
        if (dropped > 0 && used > 0) this.issues.push({ kind: 'keptAndDropped', key })
        else if (dropped === 0 && used === 0) this.issues.push({ kind: 'missing', key, short: 1 })
        continue
      }
      const expected = entry.count - dropped
      if (used < expected) this.issues.push({ kind: 'missing', key, short: expected - used })
      else if (used > expected)
        this.issues.push({ kind: 'duplicated', key, extra: used - expected })
    }
    for (const key of this.inv.collisions) this.issues.push({ kind: 'collision', key })
  }

  result(nodes: PmNode[], drop: DropList): Restored {
    this.check(drop)
    return this.issues.length > 0
      ? { ok: false, issues: this.issues }
      : { ok: true, nodes, used: this.used, once: this.once }
  }
}

/**
 * Top-level blocks parsed from the model's HTML, with each token put back as
 * the original it names, checked against what the replaced range held.
 */
export function restoreBlocks(
  nodes: readonly PmNode[],
  inv: KeepInventory,
  drop: DropList,
): Restored {
  const restorer = new Restorer(inv)
  const out = nodes.map((n) => restorer.block(n)).filter((n): n is PmNode => n !== null)
  for (const [commentId, before] of inv.commentBlocks) {
    const after = out.filter((block) => blockCarriesComment(block, commentId)).length
    if (after > Math.max(1, before)) {
      const span = [...inv.entries.values()].find(
        (e) =>
          e.object.kind === 'span' &&
          e.object.marks.some((m) => commentIdsOf([m]).includes(commentId)),
      )
      restorer.issues.push({
        kind: 'splitComment',
        key: span ? keyOf(span.object) : '',
        commentId,
        blocks: after,
      })
    }
  }
  return restorer.result(out, drop)
}

function blockCarriesComment(block: PmNode, commentId: string): boolean {
  return (block.content ?? []).some((n) => commentIdsOf(n.marks).includes(commentId))
}

/** inline nodes parsed for a selection rewrite; unspanned text continues the replaced text */
export function restoreInline(
  nodes: readonly PmNode[],
  inv: KeepInventory,
  drop: DropList,
  defaults: InlineDefaults,
): Restored {
  const restorer = new Restorer(inv, defaults)
  return restorer.result(restorer.inline(nodes), drop)
}

/** the tool's `drop` input, strict: every entry names an object of the range */
export function parseDrop(raw: unknown, inv: KeepInventory): DropList | KeepIssue[] {
  if (raw === undefined || raw === null) return new Map()
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string'))
    return [{ kind: 'badDrop', detail: 'drop must be an array of token ids or {{…}} placeholders' }]
  const drop = new Map<string, number>()
  const issues: KeepIssue[] = []
  for (const key of raw as string[]) {
    const entry = inv.entries.get(key)
    if (!entry) {
      issues.push({ kind: 'unknown', key })
      continue
    }
    const n = (drop.get(key) ?? 0) + 1
    const spanLike = entry.object.kind === 'span' || entry.object.kind === 'link'
    if (!spanLike && n > entry.count) issues.push({ kind: 'overDropped', key })
    drop.set(key, spanLike ? 1 : n)
  }
  return issues.length > 0 ? issues : drop
}

// ---- what the model is told ----

function noun(entry: KeepEntry): string {
  const o = entry.object
  if (o.kind === 'atom')
    return o.inline ? o.what.replace(/^(foot|end)note \d+$/, '$1note mark') : o.what
  if (o.kind === 'span') return 'span'
  if (o.kind === 'link') return 'link'
  return 'private placeholder'
}

const plural = (n: number, word: string): string =>
  `${n} ${n === 1 ? word : word.endsWith('y') ? `${word.slice(0, -1)}ies` : `${word}s`}`

function countText(inv: KeepInventory, counts: ReadonlyMap<string, number>): string {
  const byNoun = new Map<string, number>()
  let commentSpans = 0
  for (const [key, n] of counts) {
    const entry = inv.entries.get(key)
    if (!entry || n <= 0) continue
    const spanLike = entry.object.kind === 'span' || entry.object.kind === 'link'
    const amount = spanLike ? 1 : n
    byNoun.set(noun(entry), (byNoun.get(noun(entry)) ?? 0) + amount)
    if (entry.object.kind === 'span' && entry.object.marks.some((m) => m.type === 'comment'))
      commentSpans++
  }
  if (byNoun.size === 0) return 'none'
  return [...byNoun]
    .map(([word, n]) =>
      word === 'span' && commentSpans > 0
        ? `${plural(n, word)} (${plural(commentSpans, 'comment')})`
        : plural(n, word),
    )
    .join(', ')
}

/** "Kept: … Dropped: …" for a successful rewrite; empty when the range held nothing to keep */
export function keepTallyText(
  inv: KeepInventory,
  used: ReadonlyMap<string, number>,
  drop: DropList,
): string {
  if (inv.entries.size === 0) return ''
  return `Kept: ${countText(inv, used)}. Dropped: ${countText(inv, drop)}.`
}

function describe(inv: KeepInventory, key: string): string {
  const entry = inv.entries.get(key)
  if (!entry) return `id "${key}"`
  const o = entry.object
  const where = `block ${entry.blockIndex}`
  if (o.kind === 'atom') return `${keepTag(o)} (${where})`
  if (o.kind === 'withheld')
    return `${o.placeholder} (${where}, a private placeholder: copy it exactly)`
  const comments = o.kind === 'span' ? o.marks.flatMap((m) => commentIdsOf([m])) : []
  const detail = comments.length > 0 ? `, comment ${comments.join(' ')}` : ''
  const tag = o.kind === 'span' ? `<span id="${o.id}">` : `<a id="${o.id}">`
  return `${tag} on "${clip(o.text, 40)}" (${where}${detail})`
}

/**
 * The refusal for a rewrite whose tokens do not add up, every issue at once so
 * one retry can fix them all. `whereIs` names the block of an id that belongs
 * to another part of the document.
 */
export function keepIssuesMessage(
  issues: readonly KeepIssue[],
  inv: KeepInventory,
  range: string,
  whereIs?: (key: string) => number | null,
): string {
  const lines = issues.map((issue) => {
    switch (issue.kind) {
      case 'missing':
        return `- missing${issue.short > 1 ? ` ${issue.short} times` : ''}: ${describe(inv, issue.key)}`
      case 'duplicated':
        return `- written ${issue.extra} time(s) too often: ${describe(inv, issue.key)}`
      case 'unknown': {
        const elsewhere = whereIs?.(issue.key) ?? null
        return elsewhere === null
          ? `- "${issue.key}" is not an object of ${range}; never invent an id or copy one from elsewhere`
          : `- "${issue.key}" belongs to block ${elsewhere}, outside ${range}; objects cannot move across a rewrite boundary, rewrite a range that holds both places`
      }
      case 'misplaced':
        return `- placed between blocks: ${describe(inv, issue.key)}; put it inside the paragraph it belongs to`
      case 'keptAndDropped':
        return `- both written and listed in drop: ${describe(inv, issue.key)}; do one or the other`
      case 'overDropped':
        return `- listed in drop more often than it occurs: ${describe(inv, issue.key)}`
      case 'badDrop':
        return `- ${issue.detail}`
      case 'splitComment':
        return `- comment ${issue.commentId} would cover ${issue.blocks} paragraphs: keep ${issue.key ? `<span id="${issue.key}">` : 'its span'} on the words of one paragraph`
      case 'collision':
        return `- two different objects share the id ${issue.key}; rewrite a smaller range`
    }
  })
  return [
    `Not applied: your HTML does not account for every object of ${range}.`,
    ...lines,
    'Put each object back with the words it belongs to, or list its id in drop if the user asked to remove that content. The document is unchanged.',
  ].join('\n')
}

// ---- what the model has seen in full, per editor and agent run ----

const shown = new WeakMap<Editor, WeakSet<ProseMirrorNode>>()

/** chat retention may trim old tool results, so what was shown counts for one agent run only */
export function beginModelRun(editor: Editor): void {
  shown.set(editor, new WeakSet())
}

/** nodes are immutable and structurally shared: a recorded node is exactly the content the model saw */
export function recordShown(editor: Editor, blocks: readonly ProseMirrorNode[]): void {
  let set = shown.get(editor)
  if (!set) shown.set(editor, (set = new WeakSet()))
  for (const block of blocks) set.add(block)
}

export function wasShown(editor: Editor, block: ProseMirrorNode): boolean {
  return shown.get(editor)?.has(block) ?? false
}
