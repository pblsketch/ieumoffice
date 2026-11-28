import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { streamForProvider } from '../src/stream'
import { AI_CONNECT_TIMEOUT_MS } from '../src/watchdog'

/**
 * A local server loads the model on the first request, so the settings screen
 * gives such an endpoint a longer first-response limit. `streamForProvider`'s
 * optional eighth argument carries that limit into the OpenAI-compatible
 * watchdog; callers that pass nothing keep the default connect timeout.
 *
 * A fetch that never answers models the case the watchdog exists for: the
 * server accepted the connection but the model is not producing anything yet.
 */

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function hangingFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const signal = init.signal
      return new Promise((_, reject) => {
        if (signal?.aborted) return reject(new Error('aborted'))
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    }),
  )
}

// PosidOffice: a timed-out turn on a custom (Ollama) endpoint ends with the
// Ollama help text instead of an error, so the tests read the reply
let replied = ''

function run(toolsTimeoutMs?: number): Promise<void> {
  replied = ''
  return streamForProvider(
    'custom',
    { apiKey: '', model: 'qwen3:8b', baseUrl: 'http://127.0.0.1:11434/v1' },
    'system',
    [{ role: 'user', text: 'hi' }],
    [],
    100,
    {
      signal: new AbortController().signal,
      onDelta: (text) => {
        replied += text
      },
      onToolCall: () => undefined,
    },
    toolsTimeoutMs === undefined ? undefined : { timeoutMs: toolsTimeoutMs },
  )
}

describe('streamForProvider timeout', () => {
  it('aborts a delayed response at the timeout it was given', async () => {
    hangingFetch()
    let settled = false
    const outcome = run(5_000).then(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(4_999)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await outcome
    expect(replied).toMatch(/timed out/)
  })

  it('keeps the default connect timeout when no timeout is given', async () => {
    hangingFetch()
    let settled = false
    const outcome = run().then(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(AI_CONNECT_TIMEOUT_MS - 1)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await outcome
    expect(replied).toMatch(/timed out/)
  })
})
