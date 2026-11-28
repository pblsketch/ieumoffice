import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { preloadMobileKeyProviderProtocols } from '@genoffice/mobile-bridge/ai-bridge'
import {
  byTestId,
  deferred,
  makeFakeAiRust,
  messageTexts,
  mountAi,
  reply,
  settle,
  textTurn,
  typeAndSend,
  unmountAll,
  waitFor,
  type RelayReply,
} from './ai-panel-fake'

// The AI sheet's message list follows what arrives while the person is at its
// end (found in the T7 preview walk: a reply below the fold stayed hidden), and
// stays put once the person has scrolled up to read. jsdom has no layout, so
// the list's sizes are stubbed.

beforeAll(async () => {
  await preloadMobileKeyProviderProtocols()
}, 60_000)

afterEach(() => unmountAll())

/** Gives the message list a fixed size and a scrollTop that keeps what is set. */
function stubListGeometry(list: HTMLElement, height = 1000, visible = 200) {
  let top = 0
  Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => height })
  Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => visible })
  Object.defineProperty(list, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = value
    },
  })
}

describe('the AI message list', () => {
  it('scrolls to the newest reply while the person is at the end', async () => {
    const rust = makeFakeAiRust({ relay: () => reply(textTurn('the answer')) })
    await mountAi(rust)
    const list = byTestId('ai-message-list')!
    stubListGeometry(list)
    await typeAndSend('question')
    await waitFor(() => messageTexts().includes('the answer'))
    expect(list.scrollTop).toBe(1000)
  })

  it('stays where the person scrolled to, and follows again after they send', async () => {
    const second = deferred<RelayReply>()
    const rust = makeFakeAiRust({
      relay: (_start, index) => (index === 1 ? second.promise : reply(textTurn(`reply ${index}`))),
    })
    await mountAi(rust)
    const list = byTestId('ai-message-list')!
    stubListGeometry(list)
    await typeAndSend('first')
    await waitFor(() => messageTexts().includes('reply 0'))

    await typeAndSend('second')
    await waitFor(() => rust.relayStarts.length === 2)
    expect(list.scrollTop).toBe(1000)
    // the person scrolls up to read while the answer is on its way
    list.scrollTop = 100
    list.dispatchEvent(new Event('scroll'))
    second.resolve(reply(textTurn('late reply')))
    await waitFor(() => messageTexts().includes('late reply'))
    await settle()
    expect(list.scrollTop).toBe(100)

    await typeAndSend('third')
    await waitFor(() => messageTexts().includes('reply 2'))
    expect(list.scrollTop).toBe(1000)
  })
})
