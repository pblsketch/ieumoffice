/**
 * The readable answer text of a question card (spec 3.4), in the person's UI
 * language: a title line `[title]` and one `- question: answer` line per input,
 * or `[title] <skipped line>` when the card was skipped. ChoicePicker answers are
 * the chosen option labels joined by a comma, CheckBox answers yes/no, TextField
 * answers the text, Slider answers the number, an empty value is the no-answer
 * word and an input left to the AI is the decide-for-me phrase. No JSON.
 *
 * The text-block path sends it as the person's message, the read-only card draws
 * the same answer words, and the HTML brief writer copies it.
 */
import type { Lang } from '@genoffice/i18n'
import type {
  QuestionAnswerValue,
  QuestionCardAnswer,
  QuestionInput,
  QuestionRecord,
  QuestionSurfaceView,
  RecordedAnswer,
} from '@genoffice/agent-core'
import { questionCardText } from './strings-question-card'

const LIST_SEPARATOR = ', '

/** The card title, or the untitled heading when the model gave none. */
export function questionCardTitleText(
  lang: Lang,
  view: Pick<QuestionSurfaceView, 'title'> | undefined,
): string {
  const title = view?.title?.trim()
  return title || questionCardText(lang, 'untitled')
}

/**
 * One answer value as text. With the input, choice values become their option
 * labels; without it (a record whose questions were lost) values stay as written.
 */
export function questionAnswerValueText(
  lang: Lang,
  input: QuestionInput | undefined,
  value: QuestionAnswerValue | undefined,
): string {
  const none = questionCardText(lang, 'noAnswer')
  if (value === undefined) return none
  if (typeof value === 'boolean') return questionCardText(lang, value ? 'yes' : 'no')
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : none
  const values: readonly string[] = typeof value === 'string' ? [value] : value
  if (input?.kind === 'ChoicePicker') {
    const labels = values.map((v) => input.options.find((o) => o.value === v)?.label ?? v)
    return labels.length ? labels.join(LIST_SEPARATOR) : none
  }
  const text = values.join(LIST_SEPARATOR)
  return text.trim() ? text : none
}

/** A stored answer as text: a value, the decide-for-me phrase or an old free-form answer. */
export function recordedAnswerText(
  lang: Lang,
  input: QuestionInput | undefined,
  answer: RecordedAnswer | undefined,
): string {
  if (!answer) return questionCardText(lang, 'noAnswer')
  switch (answer.kind) {
    case 'decideForMe':
      return questionCardText(lang, 'decideForMe')
    case 'text':
      return answer.text.trim() ? answer.text : questionCardText(lang, 'noAnswer')
    case 'value':
      return questionAnswerValueText(lang, input, answer.value)
  }
}

function skippedText(lang: Lang, view: QuestionSurfaceView | undefined): string {
  return `[${questionCardTitleText(lang, view)}] ${questionCardText(lang, 'answerSkipped')}`
}

function linesText(heading: string, lines: readonly string[]): string {
  return [`[${heading}]`, ...lines.map((line) => `- ${line}`)].join('\n')
}

/** The answer text of a card answer (submit or skip). */
export function questionAnswerText(
  lang: Lang,
  view: QuestionSurfaceView,
  answer: QuestionCardAnswer,
): string {
  if (answer.kind === 'skip') return skippedText(lang, view)
  const decided = new Set(answer.decideForMe)
  const lines = view.inputs.map((input) => {
    const text = decided.has(input.id)
      ? questionCardText(lang, 'decideForMe')
      : questionAnswerValueText(
          lang,
          input,
          Object.prototype.hasOwnProperty.call(answer.answers, input.id)
            ? answer.answers[input.id]
            : undefined,
        )
    return `${input.label}: ${text}`
  })
  return linesText(questionCardTitleText(lang, view), lines)
}

/** The answer text of a stored question record; empty when there is nothing to show. */
export function questionRecordText(lang: Lang, record: QuestionRecord): string {
  switch (record.kind) {
    case 'nothing':
      return ''
    case 'skipped':
      return skippedText(lang, record.view)
    case 'answered':
      return linesText(
        questionCardTitleText(lang, record.view),
        record.view.inputs.map(
          (input) => `${input.label}: ${recordedAnswerText(lang, input, record.answers[input.id])}`,
        ),
      )
    case 'answers-only':
      return linesText(
        questionCardText(lang, 'answersOnlyTitle'),
        record.lines.map((line) => {
          const text = recordedAnswerText(lang, undefined, line.answer)
          return line.id !== undefined ? `${line.id}: ${text}` : text
        }),
      )
  }
}
