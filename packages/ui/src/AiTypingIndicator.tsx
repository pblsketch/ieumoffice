import React, { useEffect, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import { aiDiagnosticsText } from './strings-ai-diagnostics'

/** Elapsed seconds before showing a gentle slow-response hint (tunable default). */
export const SLOW_RESPONSE_HINT_AFTER_S = 15

/** Some locales already end the label with an ellipsis — normalize to exactly one. */
function withEllipsis(label: string): string {
  return `${label.replace(/(?:…|\.{3})+$/u, '')}…`
}

/** Thinking indicator, two mutually exclusive phases:
 *  grow/shrink blue dots first, then after ~1.2s only the shimmer label with a " · Ns" elapsed hint after 3s,
 *  and a gentle slow-wait hint line after SLOW_RESPONSE_HINT_AFTER_S (15s).
 *  `paused` holds the elapsed count (e.g. while a question card waits for the person);
 *  counting resumes from the held value when it turns false.
 *  The .ai-typing-* style classes are provided by ai-panel.css / each app's styles.css. */
export function AiTypingIndicator({
  label,
  lang = 'en',
  slowHint,
  slowAfterSeconds = SLOW_RESPONSE_HINT_AFTER_S,
  paused = false,
}: {
  readonly label: string
  readonly lang?: Lang | undefined
  readonly slowHint?: string | undefined
  readonly slowAfterSeconds?: number | undefined
  readonly paused?: boolean | undefined
}): React.JSX.Element {
  const [elapsed, setElapsed] = useState(0)
  const [showLabel, setShowLabel] = useState(false)

  useEffect(() => {
    const phase = setTimeout(() => setShowLabel(true), 1200)
    return () => clearTimeout(phase)
  }, [])

  useEffect(() => {
    if (paused) return
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [paused])

  const showSlowHint = showLabel && !paused && elapsed >= slowAfterSeconds
  const slowHintText = slowHint ?? aiDiagnosticsText(lang, 'slowResponseHint')

  return (
    <span className="ai-typing" role="status" aria-label={label}>
      {showLabel ? (
        <span className="ai-typing-stack">
          <span className="ai-typing-label">
            {withEllipsis(label)}
            {elapsed >= 3 && (
              <span className="ai-typing-elapsed" aria-hidden>{` · ${elapsed}s`}</span>
            )}
          </span>
          {showSlowHint && <span className="ai-typing-slow-hint">{slowHintText}</span>}
        </span>
      ) : (
        <span className="ai-typing-dots" aria-hidden>
          <span className="ai-typing-dot-slot">
            <span className="ai-typing-dot-grow" />
          </span>
          <span className="ai-typing-dot-slot">
            <span className="ai-typing-dot-shrink" />
          </span>
        </span>
      )}
    </span>
  )
}

export function AiReplyProgress({
  reply,
  thinking,
  working,
  lang,
  paused,
}: {
  readonly reply: {
    readonly streaming?: boolean | undefined
    readonly tools?: readonly unknown[] | undefined
  }
  readonly thinking: string
  readonly working: string
  readonly lang?: Lang | undefined
  /** Holds the elapsed count, e.g. while a question card waits for the person. */
  readonly paused?: boolean | undefined
}): React.JSX.Element | null {
  if (!reply.streaming) return null
  return (
    <span className="ai-typing-row">
      <AiTypingIndicator
        label={reply.tools?.length ? working : thinking}
        lang={lang}
        paused={paused}
      />
    </span>
  )
}
