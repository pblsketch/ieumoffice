/**
 * Renders an assistant reply's Markdown body with its question block (spec 3.4,
 * 5.2): an `<a2ui-json>` block of the live conversation is the answerable
 * `AiQuestionCard`; an old `<question-form>` block, and every block of a reply
 * restored from a saved conversation, is a read-only card showing the questions
 * only. A block still streaming in shows the pending card. All model text is
 * plain text.
 */
import React from 'react'
import type { Lang } from '@genoffice/i18n'
import type { QuestionCardAnswer, QuestionSurfaceView } from '@genoffice/agent-core'
import { Markdown, type MarkdownImage, type MarkdownNav } from './Markdown'
import {
  AiQuestionCard,
  AiQuestionCardPending,
  AiQuestionCardReadOnly,
  type QuestionCardStatus,
  type QuestionCardSubmission,
} from './AiQuestionCard'
import { parseQuestionBlocks } from './question-blocks'

export interface AiAssistantBodyProps {
  lang: Lang
  text: string
  nav?: MarkdownNav | undefined
  navs?: readonly MarkdownNav[] | undefined
  images?: MarkdownImage | undefined
  streaming?: boolean | undefined
  /**
   * The reply was restored from a saved conversation: its question blocks are
   * read-only cards with the questions alone (no answered/skipped state; the
   * answer is the person's next message).
   */
  restored?: boolean | undefined
  /** Status of the reply's `<a2ui-json>` card in the live conversation (default `open`). */
  questionStatus?: QuestionCardStatus | undefined
  /** The answer given to that card, shown once it is `submitted`. */
  questionAnswer?: QuestionCardAnswer | undefined
  onQuestionSubmit?:
    ((view: QuestionSurfaceView, answer: QuestionCardSubmission) => void) | undefined
  onQuestionSkip?: ((view: QuestionSurfaceView) => void) | undefined
}

export function AiAssistantBody({
  lang,
  text,
  nav,
  navs,
  images,
  streaming = false,
  restored = false,
  questionStatus = 'open',
  questionAnswer,
  onQuestionSubmit,
  onQuestionSkip,
}: AiAssistantBodyProps): React.JSX.Element {
  const mdExtras = {
    ...(nav !== undefined ? { nav } : {}),
    ...(navs !== undefined ? { navs } : {}),
    ...(images !== undefined ? { images } : {}),
  }
  const segments = parseQuestionBlocks(text, streaming)
  const first = segments[0]
  if (segments.length <= 1 && (!first || first.kind === 'text')) {
    return <Markdown text={first?.text ?? ''} {...mdExtras} />
  }
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === 'text') {
          return <Markdown key={i} text={seg.text} {...mdExtras} />
        }
        if (seg.kind === 'pending') {
          return <AiQuestionCardPending key={i} lang={lang} />
        }
        const view = seg.view
        if (restored || seg.format === 'question-form') {
          return (
            <AiQuestionCardReadOnly key={i} lang={lang} content={{ kind: 'questions', view }} />
          )
        }
        return (
          <AiQuestionCard
            key={i}
            lang={lang}
            view={view}
            status={questionStatus}
            answer={questionAnswer}
            onSubmit={(answer) => onQuestionSubmit?.(view, answer)}
            onSkip={() => onQuestionSkip?.(view)}
          />
        )
      })}
    </>
  )
}
