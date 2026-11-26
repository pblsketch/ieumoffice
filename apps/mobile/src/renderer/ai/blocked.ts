/**
 * "Not sent because of hidden content" (docs/plans/mobile-v1/T7.md section 1).
 *
 * An editor that cannot tell for certain which parts of its document are
 * hidden throws this instead of sending the document to the AI: from its
 * `createAiRun` (before sending) or from its skill's `buildContext` /
 * `executeTool` (when it reads the document again during a run). useMobileAi
 * catches it at all three places, shows the hidden-content notice instead of a
 * connection error, puts the unsent message back into the composer and holds
 * the queue. Nothing goes to the model after it.
 */

/** Why the document was not sent. Add a kind here together with its notice text (track T7). */
export type MobileAiBlockedKind = 'hidden-unverified'

export class MobileAiBlockedError extends Error {
  readonly kind: MobileAiBlockedKind

  /** `detail` is English, for logs only; it is never shown on screen. */
  constructor(kind: MobileAiBlockedKind, detail?: string) {
    super(detail ?? `The document was not sent to the AI (${kind}).`)
    this.name = 'MobileAiBlockedError'
    this.kind = kind
  }
}

const KINDS: readonly MobileAiBlockedKind[] = ['hidden-unverified']

/**
 * Whether `error` is a block. Besides `instanceof`, a plain error carrying the
 * same name and a known kind counts too, so a copy of this module in another
 * chunk is still recognised.
 */
export function isMobileAiBlocked(error: unknown): error is MobileAiBlockedError {
  if (error instanceof MobileAiBlockedError) return true
  if (!error || typeof error !== 'object') return false
  const candidate = error as { name?: unknown; kind?: unknown }
  return (
    candidate.name === 'MobileAiBlockedError' &&
    (KINDS as readonly unknown[]).includes(candidate.kind)
  )
}
