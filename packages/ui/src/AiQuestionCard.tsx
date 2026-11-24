/**
 * The shared inline question card. It draws the checked view of one A2UI
 * `createSurface` message (`validateQuestionSurface` in `@genoffice/agent-core`)
 * in a fixed app layout: title, description, the inputs top to bottom, the
 * footer text, then the app's Send and Skip buttons. Every ChoicePicker gets an
 * app-added "decide for me" choice at the end. All model text is plain text.
 *
 * `AiQuestionCardReadOnly` draws a card that can no longer be answered: a
 * stored record (answered, skipped, answers only) or the questions alone.
 */
import React, { useId, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import type {
  ChoicePickerInput,
  QuestionAnswerValue,
  QuestionCardAnswer,
  QuestionInput,
  QuestionSurfaceView,
  RecordedAnswer,
  RecordedAnswerLine,
  SliderInput,
  TextFieldInput,
} from '@genoffice/agent-core'
import { questionCardTitleText, recordedAnswerText } from './question-answer-text'
import { questionCardText } from './strings-question-card'
import './ai-question-card.css'

/** `open` is the only state that can be answered. */
export type QuestionCardStatus = 'open' | 'submitted' | 'skipped' | 'superseded'

/** What Send hands back: every input not left to the AI, and the ids left to it. */
export type QuestionCardSubmission = Extract<QuestionCardAnswer, { kind: 'submit' }>

/**
 * What a read-only card shows. The first three match the drawable kinds of
 * `readQuestionRecord`, so a stored record can be passed as it is.
 */
export type QuestionCardReadOnlyContent =
  /** Questions and the chosen answers; inputs without an entry show the no-answer word. */
  | {
      readonly kind: 'answered'
      readonly view: QuestionSurfaceView
      readonly answers: Readonly<Record<string, RecordedAnswer>>
    }
  /** A skipped card; the questions are listed when they are known. */
  | { readonly kind: 'skipped'; readonly view?: QuestionSurfaceView | undefined }
  /** Answers left without their questions. */
  | { readonly kind: 'answers-only'; readonly lines: readonly RecordedAnswerLine[] }
  /** The questions alone, with no state (a reopened text block). */
  | { readonly kind: 'questions'; readonly view: QuestionSurfaceView }

export interface AiQuestionCardProps {
  readonly view: QuestionSurfaceView
  readonly status: QuestionCardStatus
  readonly lang: Lang
  /** The answer given, shown once the card is `submitted`. */
  readonly answer?: QuestionCardAnswer | undefined
  readonly onSubmit?: ((answer: QuestionCardSubmission) => void) | undefined
  readonly onSkip?: (() => void) | undefined
}

export interface AiQuestionCardReadOnlyProps {
  readonly lang: Lang
  readonly content: QuestionCardReadOnlyContent
}

export function AiQuestionCardPending({ lang }: { readonly lang: Lang }): React.JSX.Element {
  return (
    <div className="ai-qcard-pending" role="status">
      {questionCardText(lang, 'preparing')}
    </div>
  )
}

// ── shared pieces ───────────────────────────────────────────

function CardHeader({
  title,
  badge,
}: {
  readonly title: string
  readonly badge?: string | undefined
}): React.JSX.Element {
  return (
    <div className="ai-qcard-header">
      <span className="ai-qcard-title" dir="auto">
        {title}
      </span>
      {badge && <span className="ai-qcard-badge">{badge}</span>}
    </div>
  )
}

function Description({
  className,
  text,
}: {
  readonly className: string
  readonly text?: string | undefined
}): React.JSX.Element | null {
  if (!text) return null
  return (
    <p className={className} dir="auto">
      {text}
    </p>
  )
}

function isEmptyAnswer(value: QuestionAnswerValue | undefined): boolean {
  if (value === undefined) return true
  if (Array.isArray(value)) return value.length === 0
  return typeof value === 'string' && !value.trim()
}

// ── read-only ───────────────────────────────────────────────

function SummaryRow({
  label,
  text,
  muted,
}: {
  readonly label: string
  readonly text?: string | undefined
  readonly muted?: boolean | undefined
}): React.JSX.Element {
  return (
    <li className="ai-qcard-summary-row">
      <span className="ai-qcard-summary-label" dir="auto">
        {label}
      </span>
      {text !== undefined && (
        <span
          className={`ai-qcard-summary-answer${muted ? ' ai-qcard-summary-muted' : ''}`}
          dir="auto"
        >
          {text}
        </span>
      )}
    </li>
  )
}

/** The question rows without answers; choice lists show their option labels. */
function QuestionRows({ view }: { readonly view: QuestionSurfaceView }): React.JSX.Element {
  return (
    <ul className="ai-qcard-summary">
      {view.inputs.map((input) => (
        <SummaryRow
          key={input.id}
          label={input.label}
          text={
            input.kind === 'ChoicePicker' ? input.options.map((o) => o.label).join(', ') : undefined
          }
          muted
        />
      ))}
    </ul>
  )
}

function ReadOnlyCard({
  lang,
  content,
  status,
}: {
  readonly lang: Lang
  readonly content: QuestionCardReadOnlyContent
  /** The state badge; none for `questions` content of a reopened text block. */
  readonly status?: Exclude<QuestionCardStatus, 'open'> | undefined
}): React.JSX.Element {
  const view = 'view' in content ? content.view : undefined
  const badge =
    status === 'submitted'
      ? questionCardText(lang, 'statusSubmitted')
      : status === 'skipped'
        ? questionCardText(lang, 'statusSkipped')
        : status === 'superseded'
          ? questionCardText(lang, 'statusSuperseded')
          : undefined
  const title =
    content.kind === 'answers-only'
      ? questionCardText(lang, 'answersOnlyTitle')
      : questionCardTitleText(lang, view)
  return (
    <div
      className="ai-qcard ai-qcard-locked"
      data-testid="ai-question-card"
      data-status={status ?? 'read-only'}
      data-content={content.kind}
    >
      <CardHeader title={title} badge={badge} />
      {content.kind === 'answers-only' ? (
        <>
          <p className="ai-qcard-desc">{questionCardText(lang, 'answersOnlyNote')}</p>
          <ul className="ai-qcard-summary">
            {content.lines.map((line, i) => {
              const text = recordedAnswerText(lang, undefined, line.answer)
              return line.id !== undefined ? (
                <SummaryRow key={i} label={line.id} text={text} />
              ) : (
                <SummaryRow key={i} label={text} />
              )
            })}
          </ul>
        </>
      ) : (
        <>
          <Description className="ai-qcard-desc" text={view?.description} />
          {content.kind === 'answered' ? (
            <ul className="ai-qcard-summary">
              {content.view.inputs.map((input) => (
                <SummaryRow
                  key={input.id}
                  label={input.label}
                  text={recordedAnswerText(lang, input, content.answers[input.id])}
                />
              ))}
            </ul>
          ) : (
            view && <QuestionRows view={view} />
          )}
          <Description className="ai-qcard-footer" text={view?.footer} />
        </>
      )}
    </div>
  )
}

/** A card that can no longer be answered: a stored record, or the questions alone. */
export function AiQuestionCardReadOnly({
  lang,
  content,
}: AiQuestionCardReadOnlyProps): React.JSX.Element {
  const status =
    content.kind === 'answered' ? 'submitted' : content.kind === 'skipped' ? 'skipped' : undefined
  return <ReadOnlyCard lang={lang} content={content} status={status} />
}

function recordedAnswersOf(
  view: QuestionSurfaceView,
  answer: QuestionCardSubmission,
): Record<string, RecordedAnswer> {
  const decided = new Set(answer.decideForMe)
  const out: Record<string, RecordedAnswer> = {}
  for (const input of view.inputs) {
    if (decided.has(input.id)) out[input.id] = { kind: 'decideForMe' }
    else if (Object.prototype.hasOwnProperty.call(answer.answers, input.id)) {
      out[input.id] = { kind: 'value', value: answer.answers[input.id]! }
    }
  }
  return out
}

function closedContent(
  view: QuestionSurfaceView,
  status: Exclude<QuestionCardStatus, 'open'>,
  answer: QuestionCardAnswer | undefined,
): QuestionCardReadOnlyContent {
  if (status === 'submitted' && answer?.kind === 'submit') {
    return { kind: 'answered', view, answers: recordedAnswersOf(view, answer) }
  }
  if (status === 'skipped') return { kind: 'skipped', view }
  return { kind: 'questions', view }
}

// ── open card ───────────────────────────────────────────────

interface FormState {
  readonly values: Readonly<Record<string, QuestionAnswerValue>>
  /** ChoicePicker ids left to the AI. */
  readonly decided: ReadonlySet<string>
}

function initialState(view: QuestionSurfaceView): FormState {
  const values: Record<string, QuestionAnswerValue> = {}
  for (const input of view.inputs) values[input.id] = input.initial
  return { values, decided: new Set() }
}

/** Numbers only: an optional minus, digits and one decimal point. */
const NUMBER_TEXT = /^-?\d*(?:\.\d*)?$/

/** a number field holding only a sign or a point has no number in it yet */
const NUMBER_UNFINISHED = /^-?\.?$/

/** the value an input sends: a number field's unfinished entry counts as empty */
function settledValue(
  input: QuestionInput,
  value: QuestionAnswerValue | undefined,
): QuestionAnswerValue | undefined {
  if (input.kind === 'TextField' && input.variant === 'number' && typeof value === 'string') {
    return NUMBER_UNFINISHED.test(value.trim()) ? '' : value
  }
  return value
}

function FieldLabel({
  id,
  input,
  lang,
}: {
  readonly id: string
  readonly input: QuestionInput
  readonly lang: Lang
}): React.JSX.Element {
  return (
    <div className="ai-qcard-label" id={id}>
      <span dir="auto">{input.label}</span>
      {input.required && (
        <span className="ai-qcard-req">{questionCardText(lang, 'requiredMark')}</span>
      )}
    </div>
  )
}

function ChoicePickerField({
  input,
  labelId,
  lang,
  value,
  decided,
  onPick,
  onDecide,
}: {
  readonly input: ChoicePickerInput
  readonly labelId: string
  readonly lang: Lang
  readonly value: readonly string[]
  readonly decided: boolean
  readonly onPick: (optionValue: string) => void
  readonly onDecide: () => void
}): React.JSX.Element {
  const single = input.variant === 'mutuallyExclusive'
  const role = single ? 'radio' : 'checkbox'
  return (
    <div
      className="ai-qcard-options"
      role={single ? 'radiogroup' : 'group'}
      aria-labelledby={input.accessibilityLabel ? undefined : labelId}
      aria-label={input.accessibilityLabel}
    >
      {input.options.map((opt) => {
        const selected = !decided && value.includes(opt.value)
        return (
          <button
            key={opt.value}
            type="button"
            role={role}
            aria-checked={selected}
            className={`ai-qcard-opt${selected ? ' ai-qcard-opt-selected' : ''}`}
            dir="auto"
            onClick={() => onPick(opt.value)}
          >
            {opt.label}
          </button>
        )
      })}
      <button
        type="button"
        role={role}
        aria-checked={decided}
        data-decide-for-me=""
        className={`ai-qcard-opt ai-qcard-opt-decide${decided ? ' ai-qcard-opt-selected' : ''}`}
        onClick={onDecide}
      >
        {questionCardText(lang, 'decideForMe')}
      </button>
    </div>
  )
}

function TextFieldControl({
  input,
  labelId,
  value,
  onChange,
}: {
  readonly input: TextFieldInput
  readonly labelId: string
  readonly value: string
  readonly onChange: (text: string) => void
}): React.JSX.Element {
  const shared = {
    className: 'ai-qcard-input',
    dir: 'auto' as const,
    value,
    placeholder: input.placeholder,
    'aria-labelledby': input.accessibilityLabel ? undefined : labelId,
    'aria-label': input.accessibilityLabel,
  }
  if (input.variant === 'longText') {
    return <textarea {...shared} rows={3} onChange={(e) => onChange(e.target.value)} />
  }
  const number = input.variant === 'number'
  return (
    <input
      {...shared}
      type="text"
      inputMode={number ? 'decimal' : undefined}
      onChange={(e) => {
        const next = e.target.value
        if (number && !NUMBER_TEXT.test(next)) return
        onChange(next)
      }}
    />
  )
}

function SliderControl({
  input,
  labelId,
  value,
  onChange,
}: {
  readonly input: SliderInput
  readonly labelId: string
  readonly value: number
  readonly onChange: (n: number) => void
}): React.JSX.Element {
  // A2UI `steps` is the number of divisions; without it the slider is continuous
  const step = input.steps ? (input.max - input.min) / input.steps : 'any'
  return (
    <div className="ai-qcard-slider">
      <input
        type="range"
        min={input.min}
        max={input.max}
        step={step}
        value={value}
        aria-labelledby={input.accessibilityLabel ? undefined : labelId}
        aria-label={input.accessibilityLabel}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(n)
        }}
      />
      <output className="ai-qcard-slider-value" dir="auto">
        {String(value)}
      </output>
    </div>
  )
}

function OpenCard({
  view,
  lang,
  onSubmit,
  onSkip,
}: {
  readonly view: QuestionSurfaceView
  readonly lang: Lang
  readonly onSubmit?: ((answer: QuestionCardSubmission) => void) | undefined
  readonly onSkip?: (() => void) | undefined
}): React.JSX.Element {
  const [state, setState] = useState<FormState>(() => initialState(view))
  const baseId = useId()

  const setValue = (id: string, value: QuestionAnswerValue) =>
    setState((prev) => ({ ...prev, values: { ...prev.values, [id]: value } }))

  const pick = (input: ChoicePickerInput, optionValue: string) =>
    setState((prev) => {
      const current = prev.decided.has(input.id) ? [] : (prev.values[input.id] as readonly string[])
      let next: string[]
      if (input.variant === 'mutuallyExclusive') next = [optionValue]
      else if (current.includes(optionValue)) next = current.filter((v) => v !== optionValue)
      else next = [...current, optionValue]
      const decided = new Set(prev.decided)
      decided.delete(input.id)
      return { values: { ...prev.values, [input.id]: next }, decided }
    })

  const decide = (input: ChoicePickerInput) =>
    setState((prev) => {
      const decided = new Set(prev.decided)
      // a single-choice group keeps its choice like a radio; a multi-choice group toggles
      if (decided.has(input.id) && input.variant === 'multipleSelection') decided.delete(input.id)
      else decided.add(input.id)
      return { values: { ...prev.values, [input.id]: [] }, decided }
    })

  const canSubmit = view.inputs.every(
    (input) =>
      !input.required ||
      state.decided.has(input.id) ||
      !isEmptyAnswer(settledValue(input, state.values[input.id])),
  )

  const submit = () => {
    if (!canSubmit) return
    const answers: Record<string, QuestionAnswerValue> = {}
    const decideForMe: string[] = []
    for (const input of view.inputs) {
      if (state.decided.has(input.id)) decideForMe.push(input.id)
      else answers[input.id] = settledValue(input, state.values[input.id]) ?? input.initial
    }
    onSubmit?.({ kind: 'submit', answers, decideForMe })
  }

  return (
    <div className="ai-qcard" data-testid="ai-question-card" data-status="open">
      <CardHeader title={questionCardTitleText(lang, view)} />
      <Description className="ai-qcard-desc" text={view.description} />
      {view.inputs.map((input, index) => {
        const labelId = `${baseId}-q${index}`
        const value = state.values[input.id] ?? input.initial
        return (
          <div
            className="ai-qcard-field"
            key={input.id}
            data-input-id={input.id}
            data-kind={input.kind}
          >
            {input.kind !== 'CheckBox' && <FieldLabel id={labelId} input={input} lang={lang} />}
            {input.description && (
              <span className="ai-qcard-field-desc" dir="auto">
                {input.description}
              </span>
            )}
            {input.kind === 'ChoicePicker' && (
              <ChoicePickerField
                input={input}
                labelId={labelId}
                lang={lang}
                value={Array.isArray(value) ? value : []}
                decided={state.decided.has(input.id)}
                onPick={(v) => pick(input, v)}
                onDecide={() => decide(input)}
              />
            )}
            {input.kind === 'CheckBox' && (
              <label className="ai-qcard-check">
                <input
                  type="checkbox"
                  checked={value === true}
                  aria-label={input.accessibilityLabel}
                  onChange={(e) => setValue(input.id, e.target.checked)}
                />
                <span dir="auto">{input.label}</span>
              </label>
            )}
            {input.kind === 'TextField' && (
              <TextFieldControl
                input={input}
                labelId={labelId}
                value={typeof value === 'string' ? value : ''}
                onChange={(text) => setValue(input.id, text)}
              />
            )}
            {input.kind === 'Slider' && (
              <SliderControl
                input={input}
                labelId={labelId}
                value={typeof value === 'number' ? value : input.initial}
                onChange={(n) => setValue(input.id, n)}
              />
            )}
          </div>
        )
      })}
      <Description className="ai-qcard-footer" text={view.footer} />
      <div className="ai-qcard-actions">
        <button
          type="button"
          className="ai-qcard-btn-primary"
          disabled={!canSubmit}
          onClick={submit}
        >
          {questionCardText(lang, 'send')}
        </button>
        <button type="button" className="ai-qcard-btn-secondary" onClick={() => onSkip?.()}>
          {questionCardText(lang, 'skipLetAi')}
        </button>
      </div>
    </div>
  )
}

/**
 * A card starts over from its starting values when it is given a different view.
 * Keyed by content, not identity: a parent that re-reads the same block on every
 * render must not wipe what the person is entering.
 */
function keyOfView(view: QuestionSurfaceView): string {
  return JSON.stringify(view)
}

export function AiQuestionCard({
  view,
  status,
  lang,
  answer,
  onSubmit,
  onSkip,
}: AiQuestionCardProps): React.JSX.Element {
  if (status !== 'open') {
    return (
      <ReadOnlyCard lang={lang} content={closedContent(view, status, answer)} status={status} />
    )
  }
  return (
    <OpenCard key={keyOfView(view)} view={view} lang={lang} onSubmit={onSubmit} onSkip={onSkip} />
  )
}
