import { act } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { preloadMobileKeyProviderProtocols } from '@genoffice/mobile-bridge/ai-bridge'
import { setAiTransientRetryDelays } from '../src/renderer/ai/net/providerFetch'
import { MobileAiBlockedError, isMobileAiBlocked } from '../src/renderer/ai/blocked'
import { translateMobile } from '../src/renderer/i18n'
import type { EditorAiContext } from '../src/renderer/editors/editorKind'
import {
  byTestId,
  click,
  composer,
  deferred,
  editSkill,
  freeOpenRouter,
  keyProvider,
  makeFakeAiRust,
  messageTexts,
  mountAi,
  reply,
  settle,
  textTurn,
  toolCallTurn,
  typeAndSend,
  unmountAll,
  waitFor,
  type RelayReply,
} from './ai-panel-fake'

// The AI panel's notices (spec 3.1 table, 3.4): each key-provider error code
// gets its own notice and action, and "not sent because of hidden content"
// (blocked.ts) thrown from createAiRun, buildContext or executeTool shows the
// hidden-content notice instead of a connection error, puts the message back
// into the composer, sends nothing more to the provider and holds the queue.

const JSON_HEADERS: Array<[string, string]> = [['content-type', 'application/json']]

beforeAll(async () => {
  await preloadMobileKeyProviderProtocols()
  setAiTransientRetryDelays([0])
}, 60_000)

afterAll(() => setAiTransientRetryDelays(null))

afterEach(() => unmountAll())

async function failWith(answer: RelayReply, snapshot = freeOpenRouter()) {
  const rust = makeFakeAiRust({ snapshot, relay: () => answer })
  const mounted = await mountAi(rust)
  await typeAndSend('hello')
  await waitFor(() => byTestId('ai-message-list') !== null && rust.relayStarts.length > 0)
  await settle(80)
  return { rust, mounted }
}

const alertIds = () =>
  [...document.querySelectorAll('[role="alert"]')].map((el) => el.getAttribute('data-testid'))

describe('the key-provider notices', () => {
  it('free-limit: today is used up, with the reset time when known', async () => {
    const resetAt = Date.now() + 3 * 60 * 60 * 1000
    await failWith({
      status: 429,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        error: {
          message: 'Rate limit exceeded: free-models-per-day. Add 10 credits to unlock more',
          code: 429,
          metadata: { headers: { 'X-RateLimit-Reset': String(resetAt) } },
        },
      }),
    })
    await waitFor(() => byTestId('ai-recovery-free-limit') !== null)
    expect(byTestId('ai-recovery-free-limit')!.textContent).toContain(
      translateMobile('ko', 'aiFreeLimitTitle'),
    )
    expect(byTestId('ai-free-limit-resets')).not.toBeNull()
    expect(alertIds()).toEqual(['ai-recovery-free-limit'])
  })

  it('free-tier-model: a paid model on the free connection opens the model sheet', async () => {
    const rust = makeFakeAiRust({ snapshot: freeOpenRouter('openai/gpt-5') })
    await mountAi(rust)
    await typeAndSend('hello')
    await waitFor(() => byTestId('ai-recovery-free-tier-model') !== null)
    // refused in the webview: nothing reached the relay
    expect(rust.relayStarts).toHaveLength(0)
    await click(byTestId('ai-notice-pick-model'))
    expect(byTestId('ai-model-sheet')).not.toBeNull()
  })

  it('credits: an HTTP 402', async () => {
    await failWith(
      { status: 402, headers: JSON_HEADERS, body: '{"error":{"message":"Insufficient credits"}}' },
      keyProvider('openai', 'gpt-5.6'),
    )
    await waitFor(() => byTestId('ai-recovery-credits') !== null)
    expect(alertIds()).toEqual(['ai-recovery-credits'])
  })

  it('overloaded: busy after the resends, with [send again]', async () => {
    const { rust } = await failWith({
      status: 503,
      headers: JSON_HEADERS,
      body: '{"error":"high demand"}',
    })
    await waitFor(() => byTestId('ai-recovery-overloaded') !== null)
    const before = rust.relayStarts.length
    rust.relay = () => reply(textTurn('fine now'))
    await click(byTestId('ai-notice-resend'))
    await waitFor(() => messageTexts().includes('fine now'))
    expect(rust.relayStarts.length).toBe(before + 1)
    expect(byTestId('ai-recovery-overloaded')).toBeNull()
  })

  it('auth: a 401 asks to check the connection and opens settings', async () => {
    const { mounted } = await failWith(
      { status: 401, headers: JSON_HEADERS, body: '{"error":{"message":"invalid key"}}' },
      keyProvider('anthropic', 'claude-sonnet-4-5'),
    )
    await waitFor(() => byTestId('ai-recovery-auth') !== null)
    await click(byTestId('ai-notice-open-settings'))
    expect(mounted.openSettings.calls).toBe(1)
  })

  it('network: the connection error with the key-provider title and [try again]', async () => {
    await failWith({ refuse: { code: 'NETWORK_ERROR', messageKey: 'mobile.ai.networkError' } })
    await waitFor(() => byTestId('ai-recovery-error') !== null)
    expect(byTestId('ai-recovery-error')!.textContent).toContain(
      translateMobile('ko', 'aiKeyConnectionErrorTitle'),
    )
    expect(byTestId('ai-recovery-error')!.querySelector('button')).not.toBeNull()
  })
})

describe('not sent because of hidden content', () => {
  const block = () => new MobileAiBlockedError('hidden-unverified', 'test: hidden parts unknown')

  it('recognises the error, also as a copy from another chunk', () => {
    expect(isMobileAiBlocked(block())).toBe(true)
    expect(block().kind).toBe('hidden-unverified')
    expect(
      isMobileAiBlocked(
        Object.assign(new Error('x'), { name: 'MobileAiBlockedError', kind: 'hidden-unverified' }),
      ),
    ).toBe(true)
    expect(isMobileAiBlocked(new Error('connection'))).toBe(false)
  })

  async function expectBlocked(rust: ReturnType<typeof makeFakeAiRust>, text: string) {
    await waitFor(() => byTestId('ai-blocked-hidden') !== null)
    expect(byTestId('ai-recovery-error')).toBeNull()
    expect(byTestId('ai-blocked-hidden')!.getAttribute('role')).toBe('alert')
    expect(byTestId('ai-blocked-hidden')!.textContent).toContain(
      translateMobile('ko', 'aiBlockedHiddenTitle'),
    )
    expect(messageTexts()).not.toContain(text)
    expect(composer().value).toBe(text)
    void rust
  }

  it('from createAiRun: nothing is sent, the message goes back, [send again] sends it', async () => {
    const rust = makeFakeAiRust({ relay: () => reply(textTurn('sent now')) })
    const mounted = await mountAi(rust, {
      doc: {
        createAiRun: async () => {
          throw block()
        },
      },
    })
    await typeAndSend('summarize')
    await expectBlocked(rust, 'summarize')
    expect(rust.relayStarts).toHaveLength(0)

    mounted.setDoc({
      createAiRun: async () => ({ skill: editSkill(() => ({ output: 'ok', summary: 'e' })) }),
    })
    await click(byTestId('ai-blocked-resend'))
    await waitFor(() => messageTexts().includes('sent now'))
    expect(rust.relayStarts).toHaveLength(1)
    expect(byTestId('ai-blocked-hidden')).toBeNull()
  })

  it('from buildContext: the run fails before anything is sent', async () => {
    const rust = makeFakeAiRust({})
    await mountAi(rust, {
      doc: {
        createAiRun: async () => ({
          skill: editSkill(() => ({ output: 'ok', summary: 'e' }), {
            buildContext: () => {
              throw block()
            },
          }),
        }),
      },
    })
    await typeAndSend('summarize')
    await expectBlocked(rust, 'summarize')
    await settle(200)
    expect(rust.relayStarts).toHaveLength(0)
  })

  it('from executeTool: the run stops, nothing more goes out, the queue holds, cards stay', async () => {
    const first = deferred<RelayReply>()
    const rust = makeFakeAiRust({
      relay: (_s, index) =>
        index === 0 ? reply(textTurn('changed it')) : index === 1 ? first.promise : 'hang',
    })
    const mounted = await mountAi(rust, {
      doc: {
        createAiRun: async (ctx: EditorAiContext) => ({
          skill: editSkill(() => ({ output: 'ok', summary: 'e' })),
          finish: () => ctx.setUndo({ summary: 'changed once', undo: () => ctx.setUndo(null) }),
        }),
      },
    })
    await typeAndSend('change it')
    await waitFor(() => document.querySelectorAll('[data-testid="ai-changes-card"]').length === 1)

    mounted.setDoc({
      createAiRun: async () => ({
        skill: editSkill(() => {
          throw block()
        }),
      }),
    })
    await typeAndSend('edit again')
    await waitFor(() => rust.relayStarts.length === 2)
    await typeAndSend('queued next')
    expect(byTestId('ai-queue-strip')).not.toBeNull()
    await act(async () => first.resolve(reply(toolCallTurn('edit_doc', {}))))
    await expectBlocked(rust, 'edit again')
    // longer than the queue's idle pump: no second model request, no queued run
    await settle(600)
    expect(rust.relayStarts).toHaveLength(2)
    expect(byTestId('ai-queue-strip')?.dataset.paused).toBe('true')
    expect(document.querySelectorAll('[data-testid="ai-changes-card"]')).toHaveLength(1)
  })
})
