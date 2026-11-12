/**
 * The alert before a tab's first AI send: "this looks like sensitive info:
 * N in this document, M in the attachments".
 *
 * The rules (spec "first-send alert"):
 * - the first send of a tab counts the candidates once;
 * - none found: the send goes out and the tab is never asked again;
 * - some found: the alert is shown. "Review" sends nothing (the composer keeps
 *   its text and the editor opens the candidate list); "Send anyway" sends;
 * - after either choice the tab is never asked again.
 *
 * Pure and free of React. An editor keeps one check for as long as its tab
 * lives (not inside a panel that remounts), and awaits `check` in its send
 * path before anything goes out.
 */

/** What the person chose; only `send` lets the request out */
export type SensitiveSendAnswer = 'send' | 'review'

export interface SensitiveSendCounts {
  /** candidates in the open document: not hidden, not excluded, plus the spots that cannot be hidden */
  readonly documentCount: number
  /** candidates in the attachments of this request, read through the hiding-aware file reader */
  readonly attachmentCount: number
}

/**
 * Show the alert and wait for the answer. `null` means the alert went away
 * without a choice (the panel closed): nothing is sent and the tab is asked
 * again next time.
 */
export type SensitiveSendAsk = (
  counts: SensitiveSendCounts,
) => Promise<SensitiveSendAnswer | null> | SensitiveSendAnswer | null

export interface SensitiveSendCheck {
  /** true once the tab has been counted (and, if anything was found, answered) */
  readonly settled: boolean
  /**
   * Ask before a send. Resolves `send` (send now) or `review` (send nothing,
   * keep the composer text, open the candidate list). Counting runs only for
   * the first send of the tab; a send that comes while the alert is open waits
   * for the same answer. A count that throws leaves the tab unasked and
   * rejects, so the editor decides what its own failure means.
   */
  check(
    count: () => SensitiveSendCounts | Promise<SensitiveSendCounts>,
    ask: SensitiveSendAsk,
  ): Promise<SensitiveSendAnswer>
}

function whole(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** The counts as the alert shows them: whole, never negative */
export function sensitiveSendCountsOf(counts: SensitiveSendCounts): SensitiveSendCounts {
  return {
    documentCount: whole(counts.documentCount),
    attachmentCount: whole(counts.attachmentCount),
  }
}

export function createSensitiveSendCheck(): SensitiveSendCheck {
  let settled = false
  let pending: Promise<SensitiveSendAnswer> | null = null

  const run = async (
    count: () => SensitiveSendCounts | Promise<SensitiveSendCounts>,
    ask: SensitiveSendAsk,
  ): Promise<SensitiveSendAnswer> => {
    const counts = sensitiveSendCountsOf(await count())
    if (counts.documentCount + counts.attachmentCount === 0) {
      settled = true
      return 'send'
    }
    const answer = await ask(counts)
    if (answer === 'send' || answer === 'review') {
      settled = true
      return answer
    }
    // no choice was made: hold the send, ask again on the next one
    return 'review'
  }

  return {
    get settled() {
      return settled
    },
    check(count, ask) {
      if (settled) return Promise.resolve('send')
      if (pending) return pending
      const started = run(count, ask).finally(() => {
        pending = null
      })
      pending = started
      return started
    },
  }
}
