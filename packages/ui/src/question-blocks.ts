/**
 * Question blocks in the reply text of a tool-less model (spec 3.4, 5.2).
 *
 * - `<a2ui-json>` ... `</a2ui-json>` holds an A2UI message array with exactly one
 *   `createSurface` message, checked by the shared `validateQuestionSurface`. A
 *   Markdown code fence inside the tags or around the block is stripped.
 * - `<question-form>` ... `</question-form>` is the old JSON shape. It is only read
 *   to show old conversations and always draws as a read-only card.
 *
 * Only the first valid block of a reply becomes a card; later blocks and broken
 * blocks stay as plain text. While a reply streams in, a partial opening tag at
 * its end is held back and an opened block shows the pending card, so tag text
 * never flashes on screen.
 */

import {
  validateQuestionSurface,
  type QuestionInput,
  type QuestionSurfaceView,
} from '@genoffice/agent-core'

// ── old `<question-form>` shape (read for old conversations only) ──

export type QuestionOption = string | { readonly label: string; readonly value: string }

export type QuestionFieldType = 'radio' | 'checkbox' | 'select' | 'text'

export interface QuestionField {
  readonly id: string
  readonly label: string
  readonly type: QuestionFieldType
  readonly options?: readonly QuestionOption[] | undefined
  readonly default?: string | readonly string[] | undefined
  readonly required?: boolean | undefined
  readonly allowCustom?: boolean | undefined
  readonly maxSelections?: number | undefined
  readonly description?: string | undefined
}

export interface QuestionFormSpec {
  readonly id: string
  readonly title: string
  readonly description?: string | undefined
  readonly questions: readonly QuestionField[]
}

export interface NormalizedQuestionOption {
  readonly label: string
  readonly value: string
}

export const QUESTION_FORM_MIN_QUESTIONS = 1
export const QUESTION_FORM_MAX_QUESTIONS = 5
export const QUESTION_FORM_MAX_OPTIONS = 7

const VALID_TYPES = new Set<QuestionFieldType>(['radio', 'checkbox', 'select', 'text'])

export function normalizeQuestionOption(opt: QuestionOption): NormalizedQuestionOption {
  if (typeof opt === 'string') return { label: opt, value: opt }
  return { label: opt.label, value: opt.value }
}

/** Validates and normalizes an untrusted value into a `QuestionFormSpec`, or returns null. */
export function validateQuestionFormSpec(raw: unknown): QuestionFormSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : 'question-form'
  const title = typeof obj.title === 'string' ? obj.title.trim() : ''
  if (!title) return null
  if (!Array.isArray(obj.questions)) return null
  if (
    obj.questions.length < QUESTION_FORM_MIN_QUESTIONS ||
    obj.questions.length > QUESTION_FORM_MAX_QUESTIONS
  ) {
    return null
  }

  const questions: QuestionField[] = []
  const seenIds = new Set<string>()
  for (let i = 0; i < obj.questions.length; i++) {
    const qRaw = obj.questions[i]
    if (!qRaw || typeof qRaw !== 'object' || Array.isArray(qRaw)) return null
    const q = qRaw as Record<string, unknown>
    const qId = typeof q.id === 'string' && q.id.trim() ? q.id.trim() : `q${i + 1}`
    if (seenIds.has(qId)) return null
    seenIds.add(qId)
    const label = typeof q.label === 'string' ? q.label.trim() : ''
    if (!label) return null
    const type = q.type as QuestionFieldType
    if (!VALID_TYPES.has(type)) return null

    let options: QuestionOption[] | undefined
    if (type !== 'text') {
      if (!Array.isArray(q.options) || q.options.length === 0) return null
      if (q.options.length > QUESTION_FORM_MAX_OPTIONS) return null
      options = []
      for (const opt of q.options) {
        if (typeof opt === 'string' && opt.trim()) {
          options.push(opt.trim())
        } else if (
          opt &&
          typeof opt === 'object' &&
          !Array.isArray(opt) &&
          typeof (opt as { label?: unknown }).label === 'string' &&
          typeof (opt as { value?: unknown }).value === 'string' &&
          (opt as { label: string }).label.trim() &&
          (opt as { value: string }).value.trim()
        ) {
          options.push({
            label: (opt as { label: string }).label.trim(),
            value: (opt as { value: string }).value.trim(),
          })
        } else {
          return null
        }
      }
    }

    let defaultVal: string | string[] | undefined
    if (typeof q.default === 'string') {
      defaultVal = q.default
    } else if (Array.isArray(q.default) && q.default.every((v) => typeof v === 'string')) {
      defaultVal = [...(q.default as string[])]
    }

    questions.push({
      id: qId,
      label,
      type,
      ...(options ? { options } : {}),
      ...(defaultVal !== undefined ? { default: defaultVal } : {}),
      ...(typeof q.required === 'boolean' ? { required: q.required } : {}),
      ...(typeof q.allowCustom === 'boolean' ? { allowCustom: q.allowCustom } : {}),
      ...(typeof q.maxSelections === 'number' &&
      Number.isInteger(q.maxSelections) &&
      q.maxSelections > 0
        ? { maxSelections: q.maxSelections }
        : {}),
      ...(typeof q.description === 'string' && q.description.trim()
        ? { description: q.description.trim() }
        : {}),
    })
  }

  return {
    id,
    title,
    ...(typeof obj.description === 'string' && obj.description.trim()
      ? { description: obj.description.trim() }
      : {}),
    questions,
  }
}

/** A `<question-form>` spec as the view the shared card draws. */
export function questionFormView(spec: QuestionFormSpec): QuestionSurfaceView {
  const inputs: QuestionInput[] = spec.questions.map((q) => {
    const base = {
      id: q.id,
      label: q.label,
      ...(q.description ? { description: q.description } : {}),
      required: q.required === true,
    }
    if (q.type === 'text') {
      return {
        ...base,
        kind: 'TextField',
        variant: 'shortText',
        initial: typeof q.default === 'string' ? q.default : '',
      }
    }
    const options = (q.options ?? []).map(normalizeQuestionOption)
    const values = new Set(options.map((o) => o.value))
    const defaults = typeof q.default === 'string' ? [q.default] : [...(q.default ?? [])]
    const multi = q.type === 'checkbox'
    const initial = defaults.filter((v) => values.has(v))
    return {
      ...base,
      kind: 'ChoicePicker',
      variant: multi ? 'multipleSelection' : 'mutuallyExclusive',
      options,
      initial: multi ? initial : initial.slice(0, 1),
    }
  })
  return {
    surfaceId: spec.id,
    title: spec.title,
    ...(spec.description ? { description: spec.description } : {}),
    inputs,
  }
}

// ── block parser ──

export const A2UI_JSON_OPEN_TAG = '<a2ui-json>'
export const A2UI_JSON_CLOSE_TAG = '</a2ui-json>'
export const QUESTION_FORM_OPEN_TAG = '<question-form>'
export const QUESTION_FORM_CLOSE_TAG = '</question-form>'

/** `a2ui`: a new block (answerable in the live chat). `question-form`: an old block (read-only). */
export type QuestionBlockFormat = 'a2ui' | 'question-form'

export type QuestionBlockSegment =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'card'
      readonly format: QuestionBlockFormat
      readonly view: QuestionSurfaceView
    }
  /** An opened block still streaming in. */
  | { readonly kind: 'pending' }

interface BlockTags {
  readonly format: QuestionBlockFormat
  readonly open: string
  readonly close: string
}

const BLOCK_TAGS: readonly BlockTags[] = [
  { format: 'a2ui', open: A2UI_JSON_OPEN_TAG, close: A2UI_JSON_CLOSE_TAG },
  { format: 'question-form', open: QUESTION_FORM_OPEN_TAG, close: QUESTION_FORM_CLOSE_TAG },
]

const FENCE_LINE = /^[ \t]*```/
/** A fence line (with an optional info string) and a line break, then only blanks. */
const OPENING_FENCE_AT_END = /(^|\n)[ \t]*```[^`\n]*\r?\n[ \t]*$/
const INNER_FENCE = /^```[^\n]*\n([\s\S]*?)\n?[ \t]*```$/
/** The block's closing fence right after it: an optional line break and a fence line. */
const CLOSING_FENCE = /^[ \t]*\r?\n?[ \t]*```[ \t]*(?=\r?\n|$)/
/** While streaming: what may still grow into the closing fence. */
const CLOSING_FENCE_SO_FAR = /^[ \t]*(\r?\n[ \t]*`{0,3})?$/

/** The body without a code fence wrapped around it inside the tags. */
function unfence(body: string): string {
  const trimmed = body.trim()
  const match = INNER_FENCE.exec(trimmed)
  return match ? match[1]!.trim() : trimmed
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** The view of a block body, or null when the block is broken. */
function viewOfBlock(format: QuestionBlockFormat, body: string): QuestionSurfaceView | null {
  const parsed = parseJson(unfence(body))
  if (format === 'question-form') {
    const spec = validateQuestionFormSpec(parsed)
    return spec ? questionFormView(spec) : null
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) return null
  const checked = validateQuestionSurface(parsed[0])
  return checked.ok ? checked.view : null
}

/**
 * The text without an opening code fence line at its end (only blanks after it).
 * A fence line counts as opening only when the text holds an odd number of them,
 * so the closing fence of an earlier code block stays.
 */
function withoutOpeningFence(text: string): string | null {
  const match = OPENING_FENCE_AT_END.exec(text)
  if (!match) return null
  const fences = text.split('\n').filter((line) => FENCE_LINE.test(line)).length
  return fences % 2 === 1 ? text.slice(0, match.index + match[1]!.length) : null
}

/** The length of the longest tail of `text` that is a proper prefix of an opening tag. */
function openTagPrefixLength(text: string): number {
  for (let n = Math.min(text.length, QUESTION_FORM_OPEN_TAG.length - 1); n > 0; n--) {
    const tail = text.slice(text.length - n)
    if (BLOCK_TAGS.some((tags) => tags.open.length > n && tags.open.startsWith(tail))) return n
  }
  return 0
}

function nextOpening(text: string, from: number): { start: number; tags: BlockTags } | null {
  let found: { start: number; tags: BlockTags } | null = null
  for (const tags of BLOCK_TAGS) {
    const start = text.indexOf(tags.open, from)
    if (start !== -1 && (!found || start < found.start)) found = { start, tags }
  }
  return found
}

/**
 * Splits a reply into plain text segments, at most one question card and, while
 * `streaming`, a pending segment for a block not yet closed.
 */
export function parseQuestionBlocks(
  text: string,
  streaming: boolean = false,
): QuestionBlockSegment[] {
  const segments: QuestionBlockSegment[] = []
  let plain = ''
  const flush = () => {
    if (plain) segments.push({ kind: 'text', text: plain })
    plain = ''
  }
  let cursor = 0
  let carded = false

  while (cursor <= text.length) {
    const next = nextOpening(text, cursor)
    if (!next) {
      const rest = text.slice(cursor)
      // a tag may be on its way: hold back its start (and a fence opened for it)
      const hold = streaming && !carded ? openTagPrefixLength(rest) : 0
      plain += rest.slice(0, rest.length - hold)
      if (hold > 0) plain = withoutOpeningFence(plain) ?? plain
      break
    }

    const { start, tags } = next
    plain += text.slice(cursor, start)
    const bodyStart = start + tags.open.length
    const end = text.indexOf(tags.close, bodyStart)
    if (end === -1) {
      if (streaming && !carded) {
        plain = withoutOpeningFence(plain) ?? plain
        flush()
        segments.push({ kind: 'pending' })
      } else {
        plain += text.slice(start)
      }
      break
    }

    const blockEnd = end + tags.close.length
    const view = carded ? null : viewOfBlock(tags.format, text.slice(bodyStart, end))
    if (!view) {
      plain += text.slice(start, blockEnd)
      cursor = blockEnd
      continue
    }

    cursor = blockEnd
    const unfenced = withoutOpeningFence(plain)
    if (unfenced !== null) {
      plain = unfenced
      const after = text.slice(blockEnd)
      const closing = CLOSING_FENCE.exec(after)
      if (closing) cursor += closing[0].length
      else if (streaming && CLOSING_FENCE_SO_FAR.test(after)) cursor = text.length
    }
    flush()
    segments.push({ kind: 'card', format: tags.format, view })
    carded = true
  }

  flush()
  return segments
}
