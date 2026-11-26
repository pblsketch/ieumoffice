/**
 * The mobile stand-in for `packages/ai-provider/src/fetch.ts`. The track build
 * plugin (config/tracks/ai.ts) hands it to the modules inside
 * `packages/ai-provider/src/` that import `fetch`, in the bundle and in the
 * tests, so PC's protocol code runs unchanged in the webview while its requests
 * leave through Rust's sealed relay: the webview has no keys and never reaches
 * a provider on its own network.
 *
 * Every export of the PC module is here. The helpers with nothing to do with
 * the network are PC's own (imported by path, which the plugin leaves alone);
 * `aiFetch` keeps PC's resend rules for busy answers (503, 529, a 429 that is
 * not today's free allowance), the Retry-After cap and stopping on abort. A
 * phone has no second network stack, so there is no rescue fetch and no block
 * page retry.
 */
import { mobileAiRelayFetch } from '@genoffice/mobile-bridge/ai-bridge'
import {
  freeLimitOf,
  isFreeTierModelRefusal,
} from '../../../../../../packages/ai-provider/src/free-ai'
import {
  setAiTransientRetryDelays as setPcTransientRetryDelays,
  withUserAgent,
  type AiFetchResend,
  type AiFetchWatch,
} from '../../../../../../packages/ai-provider/src/fetch'

export {
  AI_DEFAULT_USER_AGENT,
  setAiUserAgent,
  setRescueFetch,
  withUserAgent,
} from '../../../../../../packages/ai-provider/src/fetch'
export type { AiFetchResend, AiFetchWatch }

/** The waits before each resend after a transient refusal, as on PC. */
const DEFAULT_TRANSIENT_RETRY_DELAYS_MS: readonly number[] = [2000, 5000]
let transientRetryDelays: readonly number[] = DEFAULT_TRANSIENT_RETRY_DELAYS_MS

/** Tests shorten or turn off the waits; null restores the default (PC's copy follows along) */
export function setAiTransientRetryDelays(delays: readonly number[] | null): void {
  transientRetryDelays = delays ?? DEFAULT_TRANSIENT_RETRY_DELAYS_MS
  setPcTransientRetryDelays(delays)
}

/** a Retry-After longer than this is not waited for: the failure is reported instead */
const MAX_RETRY_AFTER_MS = 20_000

function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get('retry-after')
  if (!raw) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const at = Date.parse(raw)
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined
}

function wait(ms: number, signal: AbortSignal | null | undefined): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false)
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      resolve(false)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Whether a refusal is worth one more try: a busy answer, or a 429 that is not
 * today's free allowance being used up (that one lasts until the reset).
 */
async function isTransientRefusal(response: Response): Promise<boolean> {
  if (response.status === 503 || response.status === 529) return true
  if (response.status !== 429) return false
  try {
    const text = `HTTP 429: ${await response.clone().text()}`
    return !freeLimitOf(text) && !isFreeTierModelRefusal(text)
  } catch {
    return true
  }
}

function relayOnce(url: string, init: RequestInit): Promise<Response> {
  return mobileAiRelayFetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  })
}

export async function aiFetch(
  url: string,
  rawInit: RequestInit,
  watch?: AiFetchWatch,
): Promise<Response> {
  const init = withUserAgent(rawInit)
  const signal = init.signal as AbortSignal | null | undefined
  let response = await relayOnce(url, init)
  const resendable = init.body == null || typeof init.body === 'string'
  for (const delay of transientRetryDelays) {
    if (!resendable || signal?.aborted || !(await isTransientRefusal(response))) break
    const after = retryAfterMs(response)
    if (after !== undefined && after > MAX_RETRY_AFTER_MS) break
    if (!(await wait(after ?? delay, signal))) break
    // the refused answer is dropped unread; only the last one reaches the caller
    void response.body?.cancel().catch(() => {})
    watch?.onResend?.('busy')
    response = await relayOnce(url, init)
  }
  return response
}
