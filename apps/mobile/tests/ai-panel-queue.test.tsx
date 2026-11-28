import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { preloadMobileKeyProviderProtocols } from '@genoffice/mobile-bridge/ai-bridge'
import {
  isMobileAiRunning,
  mobileAiQueuedCount,
  stopAllMobileAi,
} from '../src/renderer/ai/runState'
import {
  byTestId,
  click,
  deferred,
  makeFakeAiRust,
  messageTexts,
  mountAi,
  relayJson,
  reply,
  settle,
  textTurn,
  typeAndSend,
  unmountAll,
  waitFor,
  type RelayReply,
} from './ai-panel-fake'

// The queue above the composer (spec 3.4, PC's useChatRunQueue): a message
// sent while a run is going waits in the strip; a finished or failed run sends
// the next one, a Stop holds the queue, queued messages can be edited, moved
// and removed, a document change empties it, and turning AI off stops the run
// and empties the queue. The run state store (AI-T6 reads it) follows along.

beforeAll(async () => {
  await preloadMobileKeyProviderProtocols()
}, 60_000)

afterEach(() => unmountAll())

const queueTexts = () =>
  [...document.querySelectorAll('[data-testid="ai-queue-item"] .mobile-ai-queue-text')].map(
    (el) => el.textContent ?? '',
  )

const lastUserText = (body: string) => {
  const messages = relayJson({ requestId: '', url: '', body }).messages
  const users = messages.filter((m) => m.role === 'user')
  const content = users.at(-1)?.content
  return typeof content === 'string' ? content : JSON.stringify(content)
}

describe('the queue strip', () => {
  it('sends the next message when the run finishes', async () => {
    const first = deferred<RelayReply>()
    const rust = makeFakeAiRust({
      relay: (_start, index) => (index === 0 ? first.promise : reply(textTurn('second done'))),
    })
    await mountAi(rust)
    await typeAndSend('first')
    await waitFor(() => rust.relayStarts.length === 1)
    await typeAndSend('second')
    expect(queueTexts()).toEqual(['second'])
    expect(byTestId('ai-queue-count')?.textContent).toBe('1개 대기 중')
    expect(isMobileAiRunning()).toBe(true)
    expect(mobileAiQueuedCount()).toBe(1)

    await act(async () => first.resolve(reply(textTurn('first done'))))
    await waitFor(() => rust.relayStarts.length === 2)
    expect(lastUserText(rust.relayStarts[1]!.body)).toContain('second')
    await waitFor(() => messageTexts().includes('second done'))
    expect(byTestId('ai-queue-strip')).toBeNull()
    expect(isMobileAiRunning()).toBe(false)
    expect(mobileAiQueuedCount()).toBe(0)
  })

  it('sends the next message when the run fails', async () => {
    const first = deferred<RelayReply>()
    const rust = makeFakeAiRust({
      relay: (_start, index) => (index === 0 ? first.promise : reply(textTurn('second done'))),
    })
    await mountAi(rust)
    await typeAndSend('first')
    await waitFor(() => rust.relayStarts.length === 1)
    await typeAndSend('second')
    await act(async () =>
      first.resolve({
        status: 400,
        headers: [['content-type', 'application/json']],
        body: '{"error":{"message":"bad request"}}',
      }),
    )
    await waitFor(() => rust.relayStarts.length === 2)
    await waitFor(() => messageTexts().includes('second done'))
  })

  it('holds the queue on Stop and goes on with [resume]', async () => {
    const rust = makeFakeAiRust({
      relay: (_start, index) => (index === 0 ? 'hang' : reply(textTurn('second done'))),
    })
    await mountAi(rust)
    await typeAndSend('first')
    await waitFor(() => rust.relayStarts.length === 1)
    await typeAndSend('second')
    await click(byTestId('ai-stop-btn'))
    await waitFor(() => rust.relayCancels.length === 1)
    // longer than the queue's idle pump interval (400 ms): nothing starts on its own
    await settle(600)
    expect(rust.relayStarts).toHaveLength(1)
    expect(queueTexts()).toEqual(['second'])
    expect(byTestId('ai-queue-strip')?.dataset.paused).toBe('true')

    await click(byTestId('ai-queue-resume'))
    await waitFor(() => rust.relayStarts.length === 2)
    expect(lastUserText(rust.relayStarts[1]!.body)).toContain('second')
  })

  it('edits, moves and removes queued messages', async () => {
    const rust = makeFakeAiRust({ relay: () => 'hang' })
    await mountAi(rust)
    await typeAndSend('running')
    await waitFor(() => rust.relayStarts.length === 1)
    await typeAndSend('one')
    await typeAndSend('two')
    await typeAndSend('three')
    expect(queueTexts()).toEqual(['one', 'two', 'three'])

    const items = () => [...document.querySelectorAll('[data-testid="ai-queue-item"]')]
    await click(items()[2]!.querySelector('[data-action="up"]'))
    expect(queueTexts()).toEqual(['one', 'three', 'two'])
    await click(items()[0]!.querySelector('[data-action="remove"]'))
    expect(queueTexts()).toEqual(['three', 'two'])

    await click(items()[1]!.querySelector('[data-action="edit"]'))
    const input = document.querySelector<HTMLInputElement>('.mobile-ai-queue-input')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(input, 'two, edited')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(queueTexts()).toEqual(['three', 'two, edited'])
    // editing never set anything off
    expect(rust.relayStarts).toHaveLength(1)
  })

  it('empties on a document change', async () => {
    const rust = makeFakeAiRust({ relay: () => 'hang' })
    const mounted = await mountAi(rust)
    await typeAndSend('running')
    await waitFor(() => rust.relayStarts.length === 1)
    await typeAndSend('queued')
    expect(queueTexts()).toEqual(['queued'])
    await act(async () => mounted.ai().resetForDocument('doc-2'))
    await settle(600)
    expect(byTestId('ai-queue-strip')).toBeNull()
    expect(rust.relayStarts).toHaveLength(1)
    expect(messageTexts()).toEqual([])
  })

  it('stops the run and empties the queue when AI is turned off', async () => {
    const rust = makeFakeAiRust({ relay: () => 'hang' })
    const mounted = await mountAi(rust)
    await typeAndSend('running')
    await waitFor(() => rust.relayStarts.length === 1)
    await typeAndSend('queued')
    expect(mobileAiQueuedCount()).toBe(1)
    await mounted.setAiEnabled(false)
    await waitFor(() => rust.relayCancels.length === 1)
    await settle(600)
    expect(isMobileAiRunning()).toBe(false)
    expect(mobileAiQueuedCount()).toBe(0)
    await mounted.setAiEnabled(true)
    await settle(600)
    expect(rust.relayStarts).toHaveLength(1)
    expect(byTestId('ai-queue-strip')).toBeNull()
  })

  it('stops everything through the run state store (the settings sheet of AI-T6)', async () => {
    const rust = makeFakeAiRust({ relay: () => 'hang' })
    await mountAi(rust)
    await typeAndSend('running')
    await waitFor(() => rust.relayStarts.length === 1)
    await typeAndSend('queued')
    act(() => stopAllMobileAi())
    await waitFor(() => rust.relayCancels.length === 1)
    await settle(600)
    expect(rust.relayStarts).toHaveLength(1)
    expect(isMobileAiRunning()).toBe(false)
    expect(mobileAiQueuedCount()).toBe(0)
  })
})

describe('a document that keeps AI away', () => {
  it('sends nothing when the opened document has aiAvailable false', async () => {
    const rust = makeFakeAiRust({})
    const mounted = await mountAi(rust)
    mounted.setDoc({
      aiAvailable: false,
      createAiRun: async () => {
        throw new Error('must not be asked')
      },
    })
    await act(async () => mounted.ai().send('hello'))
    await typeAndSend('hello again')
    await settle(100)
    expect(rust.relayStarts).toHaveLength(0)
    expect(mounted.contexts).toHaveLength(0)
    expect(messageTexts()).toEqual([])
  })
})
