// The PC recovery-copy rules (apps/pdf/src/renderer/recovery/copy-scheduler.ts)
// applied to the app's own recovery calls: App already calls `writeRecovery` about
// 2 s after each change and every 30 s while unsaved, so instead of a second timer
// this gate decides per call whether a copy is due.
//
// PC rules kept: a copy only when the edits changed since the last copy; it waits
// until input paused about 2 s and no save is writing; about every 30 s at most; a
// failed write skips the next rounds (back-off) and then tries again — copies are
// never turned off. When the app goes to the background (PC `flushNow`, the OS
// ending the session) a due copy is written without waiting for the pause.
import {
  RECOVERY_COPY_BACKOFF_TICKS,
  RECOVERY_COPY_IDLE_MS,
  RECOVERY_COPY_INTERVAL_MS,
  type RecoveryCopyWrite,
} from '../../../../../../pdf/src/renderer/recovery/copy-scheduler'

export interface RecoveryGateOptions {
  readonly now?: () => number
  readonly intervalMs?: number
  readonly idleMs?: number
  readonly backoffTicks?: number
}

export interface RecoveryGate {
  /** The edits changed (counts as input). */
  bump(): void
  /** The copy was deleted or made pointless (a save): the next due call writes again if still edited. */
  invalidate(): void
  /** Whether a copy should be written now. `flush`: the app is going away, skip the pause and spacing. */
  due(input: { readonly busy: boolean; readonly flush?: boolean }): boolean
  /** Runs one copy write and records its outcome. */
  run(write: () => Promise<RecoveryCopyWrite>): Promise<RecoveryCopyWrite>
}

export function createRecoveryGate(options: RecoveryGateOptions = {}): RecoveryGate {
  const now = options.now ?? (() => Date.now())
  const intervalMs = options.intervalMs ?? RECOVERY_COPY_INTERVAL_MS
  const idleMs = options.idleMs ?? RECOVERY_COPY_IDLE_MS
  const backoffMs = (options.backoffTicks ?? RECOVERY_COPY_BACKOFF_TICKS) * intervalMs

  let revision = 0
  let copied: number | null = null
  let lastInputAt = Number.NEGATIVE_INFINITY
  let lastWriteAt = Number.NEGATIVE_INFINITY
  let blockedUntil = Number.NEGATIVE_INFINITY
  let writing = false

  return {
    bump() {
      revision += 1
      lastInputAt = now()
    },
    invalidate() {
      copied = null
    },
    due({ busy, flush = false }) {
      if (writing || busy || revision === copied) return false
      if (flush) return true
      const at = now()
      if (at < blockedUntil) return false
      if (at - lastInputAt < idleMs) return false
      return at - lastWriteAt >= intervalMs
    },
    async run(write) {
      const at = revision
      writing = true
      let result: RecoveryCopyWrite
      try {
        result = await write()
      } catch {
        result = 'failed'
      } finally {
        writing = false
      }
      lastWriteAt = now()
      if (result === 'written') copied = at
      else if (result === 'failed') blockedUntil = lastWriteAt + backoffMs
      return result
    },
  }
}
