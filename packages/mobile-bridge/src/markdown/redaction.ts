// Hidden ("withheld from the model") spans in a mobile Markdown document (spec 4.4).
//
// The file form is the PC Markdown editor's:
// `<span class="redact-span" data-redaction="" data-label="label">words</span>`
// (apps/markdown `editor/Redaction.ts` writes it, packages/file-parse
// `markdown-redaction.ts` reads it). The model never reads the source: it reads
// a view where every span is its `{{label}}` placeholder, and that view is used
// only when it equals what the shared reader (`redactMarkdownSource`) makes of
// the same source. Anything else fails closed.
import {
  placeholderInstruction as buildPlaceholderInstruction,
  placeholderSource,
  sanitizeLabel,
  type PlaceholderSpec,
} from '@genoffice/agent-core/redact-core'
// A relative import: the package entry `@genoffice/file-parse` pulls in heavy engines.
import { redactMarkdownSource } from '../../../file-parse/src/markdown-redaction'

export { sanitizeLabel }

/** Why a model request was not sent: the hidden-span marks could not be verified. */
export const HIDDEN_TEXT_UNVERIFIED_MESSAGE =
  'Hidden text marks could not be verified; nothing was sent.'

function hiddenTextUnverified(): Error {
  // Plain Error for now; becomes the shared blocked error once track T7 is merged.
  return new Error(HIDDEN_TEXT_UNVERIFIED_MESSAGE)
}

// The span markup, paired the way `redactMarkdownSource` pairs it: an opening
// tag with the mark name, then the first raw closing tag after it, which has to
// be a plain `</span>`.
const OPEN_RE = /<span\b[^>]*\bdata-redaction\b[^>]*>/gi
const LABEL_RE = /\bdata-label\s*=\s*(?:"([^"]*)"|'([^']*)')/i
const CLOSE_RE = /<\/span\b/gi
const PLAIN_CLOSE_RE = /<\/span[ \t\r\n]*>/iy

/** One hidden span: `[start, end)` is the whole markup, `[wordsStart, wordsEnd)` the words. */
export interface HiddenSpan {
  readonly start: number
  readonly end: number
  readonly wordsStart: number
  readonly wordsEnd: number
  /** The label as written (unsanitized), `private` when absent or blank. */
  readonly label: string
  /** The exact source text of the span, tags included. */
  readonly source: string
}

export interface HiddenSpanScan {
  readonly spans: readonly HiddenSpan[]
  /**
   * Where an opening tag starts that has no plain closing tag after it; null when
   * every opening tag was paired. Everything from there on may be hidden text.
   */
  readonly unpairedAt: number | null
}

/** Pairs every hidden span of the source; does not judge whether the pairing is certain. */
export function scanHiddenSpans(source: string): HiddenSpanScan {
  const spans: HiddenSpan[] = []
  const open = new RegExp(OPEN_RE)
  const close = new RegExp(CLOSE_RE)
  const plainClose = new RegExp(PLAIN_CLOSE_RE)
  let cursor = 0
  for (;;) {
    open.lastIndex = cursor
    const start = open.exec(source)
    if (!start) return { spans, unpairedAt: null }
    const wordsStart = start.index + start[0].length
    close.lastIndex = wordsStart
    const end = close.exec(source)
    if (!end) return { spans, unpairedAt: start.index }
    plainClose.lastIndex = end.index
    const tag = plainClose.exec(source)
    if (!tag) return { spans, unpairedAt: start.index }
    const spanEnd = end.index + tag[0].length
    const found = LABEL_RE.exec(start[0])
    const label = (found?.[1] ?? found?.[2] ?? 'private').trim() || 'private'
    spans.push({
      start: start.index,
      end: spanEnd,
      wordsStart,
      wordsEnd: end.index,
      label,
      source: source.slice(start.index, spanEnd),
    })
    cursor = spanEnd
  }
}

/** A placeholder of the view and the span it stands for. */
interface ViewPlaceholder {
  /** Offset of `{{` in the view. */
  readonly at: number
  readonly span: HiddenSpan
}

/** What the model reads of a Markdown document. */
export interface MarkdownRedactedView {
  /** The source with every hidden span replaced by its `{{label}}` placeholder. */
  readonly text: string
  readonly spans: readonly HiddenSpan[]
  /** The labels of the hidden spans, in order (for the placeholder instruction). */
  readonly labels: readonly string[]
  readonly placeholders: readonly ViewPlaceholder[]
}

/**
 * The model's view of `source`. Throws (an Error with
 * HIDDEN_TEXT_UNVERIFIED_MESSAGE, never any of the text) when the shared reader
 * refuses the marks or reads them differently from the spans found here.
 */
export function redactedMarkdownView(source: string): MarkdownRedactedView {
  let expected: string
  try {
    expected = redactMarkdownSource(source)
  } catch {
    throw hiddenTextUnverified()
  }
  const { spans, unpairedAt } = scanHiddenSpans(source)
  if (unpairedAt !== null) throw hiddenTextUnverified()
  const parts: string[] = []
  const placeholders: ViewPlaceholder[] = []
  let cursor = 0
  let length = 0
  for (const span of spans) {
    const kept = source.slice(cursor, span.start)
    parts.push(kept)
    length += kept.length
    const marker = placeholderSource(span.label)
    placeholders.push({ at: length, span })
    parts.push(marker)
    length += marker.length
    cursor = span.end
  }
  parts.push(source.slice(cursor))
  const text = parts.join('')
  if (text !== expected) throw hiddenTextUnverified()
  return { text, spans, labels: spans.map((s) => s.label), placeholders }
}

/** The PC Markdown editor's placeholder rules (apps/markdown `editor/redact.ts`). */
const MARKDOWN_PLACEHOLDER_SPEC: PlaceholderSpec = {
  subject: 'document',
  opening:
    'Each one stands in for text the reader has deliberately withheld from you; you cannot see what is inside and that is the point.',
  boundary: 'a line break',
  middle: [
    'Write the prose around them as if each stood for the words it replaces, so "call {{client phone}}" reads as a natural instruction to phone someone.',
    'If a request needs what a placeholder hides, write around it rather than guessing.',
  ],
}

/** The system prompt section for a document that has hidden spans. */
export function markdownPlaceholderInstruction(labels: readonly string[]): string {
  return buildPlaceholderInstruction(labels, MARKDOWN_PLACEHOLDER_SPEC)
}

const TOKEN_RE = /\{\{[^{}]*\}\}/g

interface Token {
  readonly at: number
  readonly text: string
}

function tokensOf(text: string): Token[] {
  return [...text.matchAll(TOKEN_RE)].map((m) => ({ at: m.index, text: m[0] }))
}

export type RestoreResult =
  { readonly ok: true; readonly source: string } | { readonly ok: false; readonly message: string }

function placeholderRefused(token: string): RestoreResult {
  return {
    ok: false,
    message: `Hidden placeholder ${token} cannot be changed or removed. The document was not changed.`,
  }
}

/**
 * Maps the model's edited view back to source (spec 4.4, steps 1-4): every
 * `{{…}}` of the old and new view, hidden or literal, must be the same list in
 * the same order; hidden ones go back to their span's source, literal ones stay;
 * and the result, viewed again, must be exactly what the model wrote.
 */
export function restoreRedactedEdit(view: MarkdownRedactedView, nextView: string): RestoreResult {
  const before = tokensOf(view.text)
  const hiddenAt = new Map(view.placeholders.map((p) => [p.at, p.span]))
  const kinds = before.map((token) => hiddenAt.get(token.at) ?? null)
  // every placeholder of the view is one whole token (it cannot be otherwise; checked anyway)
  if (kinds.filter(Boolean).length !== view.placeholders.length) throw hiddenTextUnverified()

  /** The hidden placeholder to name in a refusal: the first one at or after `index`. */
  const named = (index: number): string => {
    for (let i = Math.max(0, index); i < before.length; i++) {
      if (kinds[i]) return before[i]!.text
    }
    return placeholderSource(view.placeholders[0]?.span.label ?? 'private')
  }

  const after = tokensOf(nextView)
  const count = Math.max(before.length, after.length)
  for (let i = 0; i < count; i++) {
    if (before[i]?.text !== after[i]?.text) return placeholderRefused(named(i))
  }

  const parts: string[] = []
  let cursor = 0
  after.forEach((token, i) => {
    const span = kinds[i]
    if (!span) return
    parts.push(nextView.slice(cursor, token.at), span.source)
    cursor = token.at + token.text.length
  })
  parts.push(nextView.slice(cursor))
  const restored = parts.join('')

  let again: MarkdownRedactedView
  try {
    again = redactedMarkdownView(restored)
  } catch {
    return placeholderRefused(named(0))
  }
  if (again.text !== nextView || again.spans.length !== view.spans.length) {
    return placeholderRefused(named(0))
  }
  return { ok: true, source: restored }
}

// ---- the editor's hide and unhide (spec 4.4) ----

/** The span markup the PC editor writes; `label` must already be sanitized. */
export function hiddenSpanMarkup(label: string, words: string): string {
  return `<span class="redact-span" data-redaction="" data-label="${label}">${words}</span>`
}

/** The first `<prefix><n>` (n = 1, 2, …) no hidden span of the source is labelled with. */
export function nextHiddenLabel(source: string, prefix: string): string {
  const used = new Set(scanHiddenSpans(source).spans.map((s) => sanitizeLabel(s.label)))
  for (let n = 1; ; n++) {
    const label = sanitizeLabel(`${prefix}${n}`)
    if (!used.has(label)) return label
  }
}

/** The paired span the selection `[start, end)` lies in (a caret on its outer edge does not). */
export function hiddenSpanAt(source: string, start: number, end: number): HiddenSpan | null {
  for (const span of scanHiddenSpans(source).spans) {
    if (start < span.start || end > span.end) continue
    if (start === end && (start === span.start || start === span.end)) continue
    return span
  }
  return null
}

export type HideRefusal = 'empty' | 'multiline' | 'overlap' | 'unreadable'

export type HideResult =
  | {
      readonly ok: true
      readonly source: string
      /** Where the hidden words are in the new source. */
      readonly wordsStart: number
      readonly wordsEnd: number
    }
  | { readonly ok: false; readonly reason: HideRefusal }

/**
 * Wraps `[start, end)` of the source in a hidden span labelled `label` (sanitized
 * here; blank becomes `private`). Refused when nothing is selected, the selection
 * crosses a line break or touches existing span markup, or the result is not read
 * back with exactly one more span.
 */
export function hideSelection(
  source: string,
  start: number,
  end: number,
  label: string,
): HideResult {
  const from = Math.min(start, end)
  const to = Math.max(start, end)
  if (from === to) return { ok: false, reason: 'empty' }
  const words = source.slice(from, to)
  if (/[\r\n]/.test(words)) return { ok: false, reason: 'multiline' }
  const scan = scanHiddenSpans(source)
  const overlaps =
    scan.spans.some((s) => from < s.end && to > s.start) ||
    (scan.unpairedAt !== null && to > scan.unpairedAt)
  if (overlaps) return { ok: false, reason: 'overlap' }
  const name = sanitizeLabel(label) || 'private'
  const open = hiddenSpanMarkup(name, '').replace(/<\/span>$/, '')
  const next = `${source.slice(0, from)}${open}${words}</span>${source.slice(to)}`
  const wordsStart = from + open.length
  const wordsEnd = to + open.length
  let spans: readonly HiddenSpan[]
  try {
    spans = redactedMarkdownView(next).spans
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  // exactly one more span, and it covers exactly the selected words (a `</span>`
  // among them would end it early and leave the rest readable)
  const added = spans.find((s) => s.start === from)
  if (
    spans.length !== scan.spans.length + 1 ||
    !added ||
    added.wordsStart !== wordsStart ||
    added.wordsEnd !== wordsEnd
  ) {
    return { ok: false, reason: 'unreadable' }
  }
  return { ok: true, source: next, wordsStart, wordsEnd }
}

/** Removes the tags of `span` and keeps its words; where the words are in the result. */
export function unhideSpan(
  source: string,
  span: HiddenSpan,
): { readonly source: string; readonly wordsStart: number; readonly wordsEnd: number } {
  const words = source.slice(span.wordsStart, span.wordsEnd)
  return {
    source: `${source.slice(0, span.start)}${words}${source.slice(span.end)}`,
    wordsStart: span.start,
    wordsEnd: span.start + words.length,
  }
}

/** For the preview only: every paired hidden span shown as its plain words. */
export function revealHiddenSpans(source: string): string {
  const { spans } = scanHiddenSpans(source)
  if (spans.length === 0) return source
  const parts: string[] = []
  let cursor = 0
  for (const span of spans) {
    parts.push(source.slice(cursor, span.start), source.slice(span.wordsStart, span.wordsEnd))
    cursor = span.end
  }
  parts.push(source.slice(cursor))
  return parts.join('')
}
