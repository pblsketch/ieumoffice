/**
 * Which desktop status-bar lines are worth a toast on the phone.
 *
 * The desktop shows every message in a status bar that nobody has to close.
 * The phone has toasts, so the reused desktop modules' chatter would pop up
 * after ordinary edits ("Streaming book.xlsx: 2,002 rows available" after a
 * row insert). Refusals, errors and results the person asked for stay
 * toasts; the lines below do not:
 * - the lazy loader's progress (apps/sheets/src/renderer/univer-sync.ts:
 *   streaming, indexing, the formula closure, the engine recalc fallback,
 *   "fully loaded");
 * - the per-click confirmations of an apply (ribbon-actions.ts,
 *   op-executor.ts), which the grid already shows.
 *
 * A line is matched against the desktop template in the module language,
 * with each `{param}` free.
 */
import { getLang, t, type StringKey } from '../../../../../../sheets/src/renderer/i18n/locale'

export const PC_STATUS_LINE_KEYS = [
  'appStreamingRows',
  'appIndexing',
  'appClosureActive',
  'appRecalcDone',
  'appRecalcPartial',
  'appFullyLoaded',
  'appAppliedToSelection',
  'appAppliedJournaled',
] as const satisfies readonly StringKey[]

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function templatePattern(template: string): RegExp {
  const literals = template.split(/\{\w+\}/)
  return new RegExp(`^${literals.map(escapeRegExp).join('[\\s\\S]*?')}$`)
}

let cached: { lang: string; patterns: readonly RegExp[] } | null = null

function statusPatterns(): readonly RegExp[] {
  const lang = getLang()
  if (cached?.lang !== lang) {
    cached = { lang, patterns: PC_STATUS_LINE_KEYS.map((key) => templatePattern(t(key))) }
  }
  return cached.patterns
}

/** True for a desktop progress or confirmation line (not a toast on the phone). */
export function isPcStatusLine(message: string): boolean {
  const trimmed = message.trim()
  return statusPatterns().some((pattern) => pattern.test(trimmed))
}

/** Wraps a toast sink so that desktop status lines go to `status` instead. */
export function toastUnlessStatus(
  toast: (message: string) => void,
  status: (message: string) => void = (message) => console.info('[sheets]', message),
): (message: string) => void {
  return (message) => (isPcStatusLine(message) ? status(message) : toast(message))
}
