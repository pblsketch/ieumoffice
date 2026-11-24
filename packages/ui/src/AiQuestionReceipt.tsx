/**
 * The read-only question card of a reopened chat. A stored question tool
 * activity (`ask_questions`, or the old `ask_clarification` of HTML and slides)
 * is read back with `readQuestionRecord` from `@genoffice/agent-core` and drawn
 * with `AiQuestionCardReadOnly`: an answered card, a skipped card, or the
 * answers left when the store cut the input. Records with nothing to show
 * (errors, calls without an answer) draw nothing.
 */
import React, { useMemo } from 'react'
import type { Lang } from '@genoffice/i18n'
import { readQuestionRecord } from '@genoffice/agent-core'
import { AiQuestionCardReadOnly } from './AiQuestionCard'

const QUESTION_TOOL_NAMES: ReadonlySet<string> = new Set(['ask_questions', 'ask_clarification'])

/**
 * One stored tool activity. Structural, so the stored chat type of the project
 * store and each editor's own variant (often without `input`) both fit.
 */
export interface QuestionToolActivity {
  readonly name: string
  readonly summary?: string | undefined
  readonly isError?: boolean | undefined
  readonly input?: unknown
  readonly output?: unknown
}

/** Whether a stored tool activity is a question card call (by tool name only). */
export function isQuestionToolActivity(activity: { readonly name: string }): boolean {
  return QUESTION_TOOL_NAMES.has(activity.name)
}

/** The question card activities of a list, in their order. */
export function questionToolActivities<T extends { readonly name: string }>(
  activities: readonly T[] | null | undefined,
): T[] {
  return activities ? activities.filter(isQuestionToolActivity) : []
}

export interface AiQuestionReceiptProps {
  readonly lang: Lang
  readonly activity: QuestionToolActivity
}

/** The read-only card of one stored question activity; nothing for any other activity. */
export function AiQuestionReceipt({
  lang,
  activity,
}: AiQuestionReceiptProps): React.JSX.Element | null {
  const { name, input, output, isError } = activity
  const record = useMemo(
    () =>
      QUESTION_TOOL_NAMES.has(name)
        ? readQuestionRecord({ name, input, output, isError })
        : undefined,
    [name, input, output, isError],
  )
  if (!record || record.kind === 'nothing') return null
  return <AiQuestionCardReadOnly lang={lang} content={record} />
}
