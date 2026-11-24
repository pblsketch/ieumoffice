/**
 * Reads a stored question tool activity back for the read-only card of a
 * reopened chat. Three record shapes exist:
 *
 * - new: `ask_questions` with an A2UI `createSurface` input and an A2UI `action` output;
 * - old `ask_questions`: input `{ title, questions: [...] }`, output
 *   `{ ok, submitted, answers }` or `{ ok, skipped }`;
 * - old `ask_clarification` (HTML, slides): input `{ questions: [...] }`, output text
 *   `User answers:\n<question>: <answer>...` followed by a next-step line meant for
 *   the model, which is dropped here.
 *
 * The store cuts each field at 16,000 characters, so the input may be missing,
 * cut or unreadable; then only the answers left in the output are shown. Never throws.
 */
import {
  A2UI_PROTOCOL_VERSION,
  QUESTION_SKIP_ACTION,
  QUESTION_SUBMIT_ACTION,
  validateQuestionSurface,
  type ChoicePickerInput,
  type QuestionAnswerValue,
  type QuestionCardAnswer,
  type QuestionChoiceOption,
  type QuestionInput,
  type QuestionSurfaceView,
} from './a2ui-question-card'

const ASK_QUESTIONS = 'ask_questions'
const ASK_CLARIFICATION = 'ask_clarification'

/** A stored tool activity (the fields of `ToolActivity` this reader uses). */
export interface QuestionRecordSource {
  readonly name: string
  readonly input?: unknown
  readonly output?: unknown
  readonly isError?: boolean | undefined
}

export type QuestionRecordShape = 'a2ui' | 'ask_questions' | 'ask_clarification'

/** One recorded answer. `text` is an old free-form answer shown as written. */
export type RecordedAnswer =
  | { readonly kind: 'value'; readonly value: QuestionAnswerValue }
  | { readonly kind: 'decideForMe' }
  | { readonly kind: 'text'; readonly text: string }

/** An answer left without its question: `id` when the record names it. */
export interface RecordedAnswerLine {
  readonly id?: string
  readonly answer: RecordedAnswer
}

export type QuestionRecord =
  /** Questions and the chosen answers; inputs without an entry have no recorded answer. */
  | {
      readonly kind: 'answered'
      readonly shape: QuestionRecordShape
      readonly view: QuestionSurfaceView
      readonly answers: Readonly<Record<string, RecordedAnswer>>
    }
  /** A skipped card; `view` is missing when the input could not be read. */
  | {
      readonly kind: 'skipped'
      readonly shape: QuestionRecordShape
      readonly view?: QuestionSurfaceView
    }
  /** The input could not be read: only the answers are left. */
  | {
      readonly kind: 'answers-only'
      readonly shape: QuestionRecordShape
      readonly lines: readonly RecordedAnswerLine[]
    }
  /** Not a shown question card (error, no answer, other tool). */
  | { readonly kind: 'nothing' }

const NOTHING: QuestionRecord = { kind: 'nothing' }

type Obj = Record<string, unknown>

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parses stored JSON text (one extra level when it was stored double-encoded). */
function jsonOf(value: unknown): unknown {
  if (typeof value !== 'string') return value
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return undefined
  }
  if (typeof parsed === 'string') {
    try {
      return JSON.parse(parsed)
    } catch {
      return undefined
    }
  }
  return parsed
}

function answerValueOf(value: unknown): QuestionAnswerValue | undefined {
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value.slice()
  return undefined
}

/**
 * Reads an A2UI `action` message of the question card (object or JSON text) into
 * the card answer it records; null when it is not one.
 */
export function parseQuestionAction(raw: unknown): QuestionCardAnswer | null {
  try {
    const message = jsonOf(raw)
    if (!isObj(message) || message.version !== A2UI_PROTOCOL_VERSION) return null
    const action = message.action
    if (!isObj(action)) return null
    if (action.name === QUESTION_SKIP_ACTION) return { kind: 'skip' }
    if (action.name !== QUESTION_SUBMIT_ACTION) return null
    const context = action.context
    if (!isObj(context) || !isObj(context.answers)) return null
    const answers: Record<string, QuestionAnswerValue> = {}
    for (const [id, value] of Object.entries(context.answers)) {
      const read = answerValueOf(value)
      if (read !== undefined) answers[id] = read
    }
    const decideForMe = Array.isArray(context.decideForMe)
      ? context.decideForMe.filter((id): id is string => typeof id === 'string')
      : []
    return { kind: 'submit', answers, decideForMe }
  } catch {
    return null
  }
}

/** What an output records, in one form for all shapes. */
type Outcome =
  | { readonly kind: 'skip' }
  | { readonly kind: 'submit'; readonly lines: readonly RecordedAnswerLine[] }

function outcomeOfAction(answer: QuestionCardAnswer): Outcome {
  if (answer.kind === 'skip') return answer
  const lines: RecordedAnswerLine[] = []
  for (const [id, value] of Object.entries(answer.answers)) {
    lines.push({ id, answer: { kind: 'value', value } })
  }
  for (const id of answer.decideForMe) lines.push({ id, answer: { kind: 'decideForMe' } })
  return { kind: 'submit', lines }
}

/** Old `ask_questions` output: `{ ok: true, submitted: true, answers }` or `{ ok: true, skipped: true }`. */
function outcomeOfOldOutput(output: unknown): Outcome | undefined {
  if (!isObj(output) || output.ok !== true) return undefined
  if (output.skipped === true) return { kind: 'skip' }
  if (output.submitted !== true || !isObj(output.answers)) return undefined
  const lines: RecordedAnswerLine[] = []
  for (const [id, value] of Object.entries(output.answers)) {
    const read = answerValueOf(value)
    if (read !== undefined) lines.push({ id, answer: { kind: 'value', value: read } })
  }
  return { kind: 'submit', lines }
}

// ── old ask_questions input ─────────────────────────────────

function optionsOf(raw: unknown): QuestionChoiceOption[] {
  if (!Array.isArray(raw)) return []
  const options: QuestionChoiceOption[] = []
  for (const option of raw) {
    if (typeof option === 'string' && option.trim()) {
      options.push({ label: option.trim(), value: option.trim() })
    } else if (
      isObj(option) &&
      typeof option.label === 'string' &&
      typeof option.value === 'string' &&
      option.label.trim()
    ) {
      options.push({ label: option.label.trim(), value: option.value.trim() })
    }
  }
  return options
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Old `ask_questions` input as a view (lenient: it was accepted when it ran). */
function viewOfOldAskQuestions(input: unknown): QuestionSurfaceView | undefined {
  if (!isObj(input) || !Array.isArray(input.questions)) return undefined
  const inputs: QuestionInput[] = []
  input.questions.forEach((q: unknown, i: number) => {
    if (!isObj(q)) return
    const label = textOf(q.label)
    if (!label) return
    const id = textOf(q.id) ?? `q${i + 1}`
    const description = textOf(q.description)
    const base = {
      id,
      label,
      ...(description ? { description } : {}),
      required: q.required === true,
    }
    if (q.type === 'text') {
      inputs.push({
        ...base,
        kind: 'TextField',
        variant: 'shortText',
        initial: typeof q.default === 'string' ? q.default : '',
      })
      return
    }
    if (q.type !== 'radio' && q.type !== 'select' && q.type !== 'checkbox') return
    const initial =
      typeof q.default === 'string'
        ? [q.default]
        : Array.isArray(q.default)
          ? q.default.filter((v): v is string => typeof v === 'string')
          : []
    inputs.push({
      ...base,
      kind: 'ChoicePicker',
      variant: q.type === 'checkbox' ? 'multipleSelection' : 'mutuallyExclusive',
      options: optionsOf(q.options),
      initial,
    })
  })
  if (!inputs.length) return undefined
  const title = textOf(input.title)
  const description = textOf(input.description)
  return {
    surfaceId: textOf(input.id) ?? 'question-form',
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    inputs,
  }
}

// ── old ask_clarification ───────────────────────────────────

/** Old `ask_clarification` input as a view: string options, `multi` for several. */
function viewOfClarification(input: unknown): QuestionSurfaceView | undefined {
  if (!isObj(input) || !Array.isArray(input.questions)) return undefined
  const inputs: ChoicePickerInput[] = []
  input.questions.forEach((q: unknown, i: number) => {
    if (!isObj(q)) return
    const label = textOf(q.label)
    const options = Array.isArray(q.options)
      ? q.options
          .map((o: unknown) => (typeof o === 'string' ? o : String(o)))
          .filter((o) => o.trim())
          .map((o) => ({ label: o, value: o }))
      : []
    if (!label || !options.length) return
    const description = textOf(q.description)
    inputs.push({
      kind: 'ChoicePicker',
      id: q.id !== undefined && q.id !== null && String(q.id) ? String(q.id) : `q${i + 1}`,
      label,
      ...(description ? { description } : {}),
      required: false,
      variant: q.multi === true ? 'multipleSelection' : 'mutuallyExclusive',
      options,
      initial: [],
    })
  })
  return inputs.length ? { surfaceId: ASK_CLARIFICATION, inputs } : undefined
}

const CLARIFY_SKIPPED = /^The user skipped the questionnaire\b/i
const CLARIFY_HEADER = /^User (?:questionnaire )?answers:\s*$/i
/** Start of a line telling the model what to do next ("Now call plan_page ..."). */
const NEXT_STEP_START = /^(?:now|then|next|decide|call|generate)\b/i
/** A tool name such as `plan_page` or `generate_deck`. */
const TOOL_NAME = /\b[a-z]+_[a-z_]+\b/

/** Answer lines hold "question: answer"; a trailing line without that is a next-step note. */
function isNextStepLine(line: string): boolean {
  if (line.includes(': ')) return false
  return NEXT_STEP_START.test(line) || TOOL_NAME.test(line)
}

/** The `question: answer` lines of an old clarification output, or a skip. */
function clarificationOutcome(output: unknown): { skip: true } | { lines: string[] } | undefined {
  if (typeof output !== 'string') return undefined
  const lines = output.split(/\r?\n/)
  while (lines.length && !lines[0]!.trim()) lines.shift()
  if (!lines.length) return undefined
  const head = lines[0]!.trim()
  if (CLARIFY_SKIPPED.test(head)) return { skip: true }
  if (!CLARIFY_HEADER.test(head)) return undefined
  const body = lines.slice(1)
  while (body.length) {
    const last = body[body.length - 1]!.trim()
    if (!last || isNextStepLine(last)) body.pop()
    else break
  }
  return body.length ? { lines: body } : undefined
}

/** Maps a clarification answer text onto the options it names, else keeps the text. */
function clarificationAnswer(input: ChoicePickerInput, text: string): RecordedAnswer {
  const values = new Set(input.options.map((o) => o.value))
  const parts = text.split('、').map((p) => p.trim())
  if (parts.length && parts.every((p) => values.has(p))) return { kind: 'value', value: parts }
  return { kind: 'text', text }
}

function readClarification(source: QuestionRecordSource): QuestionRecord {
  const outcome = clarificationOutcome(source.output)
  if (!outcome) return NOTHING
  const view = viewOfClarification(jsonOf(source.input))
  if ('skip' in outcome) {
    return view
      ? { kind: 'skipped', shape: ASK_CLARIFICATION, view }
      : { kind: 'skipped', shape: ASK_CLARIFICATION }
  }
  const verbatim: QuestionRecord = {
    kind: 'answers-only',
    shape: ASK_CLARIFICATION,
    lines: outcome.lines
      .filter((line) => line.trim())
      .map((line) => ({ answer: { kind: 'text', text: line } })),
  }
  if (!view) return verbatim

  // longest label first, so "Tone of voice" wins over "Tone"
  const byLabel = [...view.inputs].sort((a, b) => b.label.length - a.label.length)
  const texts = new Map<string, string>()
  let current: string | undefined
  for (const line of outcome.lines) {
    const match = byLabel.find((q) => line.startsWith(`${q.label}: `))
    if (match) {
      current = match.id
      texts.set(match.id, line.slice(match.label.length + 2))
    } else if (current !== undefined) {
      // a free-text answer that ran over several lines
      texts.set(current, `${texts.get(current)}\n${line}`)
    } else {
      return verbatim
    }
  }
  const answers: Record<string, RecordedAnswer> = {}
  for (const input of view.inputs) {
    const text = texts.get(input.id)
    if (text === undefined) continue
    answers[input.id] = text.includes('\n')
      ? { kind: 'text', text }
      : clarificationAnswer(input as ChoicePickerInput, text)
  }
  return { kind: 'answered', shape: ASK_CLARIFICATION, view, answers }
}

// ── ask_questions (new and old) ─────────────────────────────

function readAskQuestions(source: QuestionRecordSource): QuestionRecord {
  const input = jsonOf(source.input)
  const output = jsonOf(source.output)

  let view: QuestionSurfaceView | undefined
  let shape: QuestionRecordShape | undefined
  if (isObj(input) && ('createSurface' in input || 'version' in input)) {
    shape = 'a2ui'
    const checked = validateQuestionSurface(input)
    if (checked.ok) view = checked.view
  } else if (isObj(input) && 'questions' in input) {
    shape = ASK_QUESTIONS
    view = viewOfOldAskQuestions(input)
  }

  const action = parseQuestionAction(output)
  let outcome: Outcome | undefined
  if (action) {
    outcome = outcomeOfAction(action)
    shape ??= 'a2ui'
  } else {
    outcome = outcomeOfOldOutput(output)
    if (outcome) shape ??= ASK_QUESTIONS
  }
  if (!outcome || !shape) return NOTHING

  if (outcome.kind === 'skip') {
    return view ? { kind: 'skipped', shape, view } : { kind: 'skipped', shape }
  }
  if (!view) {
    return outcome.lines.length ? { kind: 'answers-only', shape, lines: outcome.lines } : NOTHING
  }
  const answers: Record<string, RecordedAnswer> = {}
  const byId = new Map(outcome.lines.map((line) => [line.id, line.answer]))
  for (const input of view.inputs) {
    let answer = byId.get(input.id)
    if (!answer) continue
    // old single-choice answers were a bare string
    if (
      answer.kind === 'value' &&
      input.kind === 'ChoicePicker' &&
      typeof answer.value === 'string'
    ) {
      answer = { kind: 'value', value: [answer.value] }
    }
    answers[input.id] = answer
  }
  return { kind: 'answered', shape, view, answers }
}

/**
 * Classifies one stored tool activity for the read-only card: an answered card
 * (new A2UI, old `ask_questions` or old `ask_clarification` shape), a skipped
 * card, answers left without their questions, or nothing to draw. Never throws.
 */
export function readQuestionRecord(source: QuestionRecordSource): QuestionRecord {
  try {
    if (!isObj(source) || source.isError === true) return NOTHING
    if (source.name === ASK_QUESTIONS) return readAskQuestions(source)
    if (source.name === ASK_CLARIFICATION) return readClarification(source)
    return NOTHING
  } catch {
    return NOTHING
  }
}
