import { PRODUCT_NAME } from '@genoffice/i18n'
import type { OpFailure } from './op-errors'
import { CliError, EXIT } from './result'

/**
 * Hidden content (민감정보 가리기) on the command line and its MCP server.
 *
 * A document can mark parts of itself as withheld from AI: a Hangul hiding memo,
 * an Excel `IeumHide_` name, a Word / deck / Markdown / HTML mark. Everything this
 * command line prints is read by a program, often a model, so every output that
 * carries document text shows a hidden part as its `{{label}}` and nothing else.
 * There is no option to get the words back: the person reads them in the app.
 *
 * Edits follow from that. An op that finds its target by text never sees hidden
 * words (it finds nothing, as for any text that is not there). An op that points
 * at a place and would change, remove or move hidden content is refused with
 * `hidden_content`, in the shapes below. They are a contract: `error:
 * "hidden_content"`, `detail.reason` (`edit` or `convert`) and `detail.labels`
 * do not change.
 */

export type HiddenReason = 'edit' | 'convert'

const SUGGESTION = `open the document in ${PRODUCT_NAME} and let the person make this change; hidden parts cannot be read or changed from here`

/** distinct labels in first-seen order */
export function uniqueLabels(labels: Iterable<string>): string[] {
  return [...new Set(labels)]
}

/** The refusal of one edit or of a conversion: exit 1, `error: "hidden_content"`. */
export function hiddenContentError(
  reason: HiddenReason,
  labels: Iterable<string>,
  message?: string,
): CliError {
  return new CliError(
    EXIT.usage,
    message ??
      (reason === 'convert'
        ? 'the document hides content from AI, so it is not converted here'
        : 'this edit would change, remove or move content the document hides from AI'),
    { reason, labels: uniqueLabels(labels) },
    { reason: 'hidden_content', suggestion: SUGGESTION },
  )
}

/** One op of a batch refused for hidden content, in the batch's `OpFailure` shape. */
export function hiddenFailure(
  index: number,
  op: string,
  labels: Iterable<string>,
  error = 'not applied: this op would change, remove or move content the document hides from AI',
): OpFailure {
  return {
    index,
    op,
    error,
    reason: 'hidden_content',
    hidden: { reason: 'edit', labels: uniqueLabels(labels) },
  }
}

/** What to do after a hidden-content refusal of a batch op. */
export const HIDDEN_SUGGESTION = SUGGESTION

/**
 * The detail of a batch rejection whose first failure is a hidden-content one:
 * the batch fields as they are, with the non-batch fields beside them so the two
 * shapes read alike.
 */
export function withHiddenDetail(
  detail: Record<string, unknown> | undefined,
  first: OpFailure | undefined,
): Record<string, unknown> | undefined {
  if (!first?.hidden) return detail
  return { ...detail, reason: first.hidden.reason, labels: first.hidden.labels }
}

/**
 * A file whose hiding cannot be read safely (a mark this reader cannot place)
 * is not read at all: less is shown rather than hidden words.
 */
export function unreadableHiding(cause?: unknown): CliError {
  const why = cause instanceof Error && cause.message ? ` (${cause.message})` : ''
  return new CliError(
    EXIT.file,
    `the document hides content from AI in a way that cannot be read safely here${why}; nothing was read`,
    undefined,
    { reason: 'unsupported', suggestion: `open the document in ${PRODUCT_NAME} instead` },
  )
}
