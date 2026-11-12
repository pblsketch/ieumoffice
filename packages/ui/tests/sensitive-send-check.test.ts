import { describe, expect, it, vi } from 'vitest'
import {
  createSensitiveSendCheck,
  sensitiveSendCountsOf,
  type SensitiveSendAnswer,
  type SensitiveSendCounts,
} from '../src/sensitive-send-check'

/**
 * The send path an editor writes around the check: nothing goes out unless
 * the check answers `send`.
 */
function sendPath(check = createSensitiveSendCheck()) {
  const sent: string[] = []
  const reviews: string[] = []
  return {
    check,
    sent,
    reviews,
    async send(
      text: string,
      counts: SensitiveSendCounts,
      ask: (
        c: SensitiveSendCounts,
      ) => SensitiveSendAnswer | null | Promise<SensitiveSendAnswer | null>,
    ) {
      const answer = await check.check(() => counts, ask)
      if (answer === 'send') sent.push(text)
      else reviews.push(text)
      return answer
    },
  }
}

describe('createSensitiveSendCheck', () => {
  it('asks on the first send and never again after "send anyway"', async () => {
    const p = sendPath()
    const ask = vi.fn(() => 'send' as const)
    expect(await p.send('one', { documentCount: 2, attachmentCount: 1 }, ask)).toBe('send')
    expect(await p.send('two', { documentCount: 5, attachmentCount: 5 }, ask)).toBe('send')
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledWith({ documentCount: 2, attachmentCount: 1 })
    expect(p.sent).toEqual(['one', 'two'])
    expect(p.check.settled).toBe(true)
  })

  it('"review" sends nothing, and the next send is not asked again', async () => {
    const p = sendPath()
    const ask = vi.fn(() => 'review' as const)
    expect(await p.send('draft', { documentCount: 1, attachmentCount: 0 }, ask)).toBe('review')
    expect(p.sent).toEqual([])
    expect(p.reviews).toEqual(['draft'])
    expect(await p.send('draft', { documentCount: 1, attachmentCount: 0 }, ask)).toBe('send')
    expect(ask).toHaveBeenCalledTimes(1)
    expect(p.sent).toEqual(['draft'])
  })

  it('counts only on the first send: nothing found sends and settles the tab', async () => {
    const p = sendPath()
    const ask = vi.fn(() => 'review' as const)
    const count = vi.fn(() => ({ documentCount: 0, attachmentCount: 0 }))
    expect(await p.check.check(count, ask)).toBe('send')
    expect(await p.check.check(count, ask)).toBe('send')
    expect(count).toHaveBeenCalledTimes(1)
    expect(ask).not.toHaveBeenCalled()
  })

  it('asks when only an attachment has candidates', async () => {
    const ask = vi.fn(() => 'review' as const)
    expect(
      await createSensitiveSendCheck().check(() => ({ documentCount: 0, attachmentCount: 3 }), ask),
    ).toBe('review')
    expect(ask).toHaveBeenCalledWith({ documentCount: 0, attachmentCount: 3 })
  })

  it('a send while the alert is open waits for the same answer instead of asking twice', async () => {
    const check = createSensitiveSendCheck()
    let answer: (a: SensitiveSendAnswer) => void = () => {}
    const ask = vi.fn(() => new Promise<SensitiveSendAnswer>((r) => (answer = r)))
    const counts = () => ({ documentCount: 1, attachmentCount: 0 })
    const first = check.check(counts, ask)
    const second = check.check(counts, ask)
    await Promise.resolve()
    await Promise.resolve()
    answer('review')
    expect(await first).toBe('review')
    expect(await second).toBe('review')
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('an alert dismissed without a choice holds the send and asks again next time', async () => {
    const check = createSensitiveSendCheck()
    const counts = () => ({ documentCount: 1, attachmentCount: 0 })
    expect(await check.check(counts, () => null)).toBe('review')
    expect(check.settled).toBe(false)
    const ask = vi.fn(() => 'send' as const)
    expect(await check.check(counts, ask)).toBe('send')
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('a count that throws rejects and leaves the tab unasked', async () => {
    const check = createSensitiveSendCheck()
    await expect(
      check.check(
        () => {
          throw new Error('boom')
        },
        () => 'send',
      ),
    ).rejects.toThrow('boom')
    expect(check.settled).toBe(false)
    const ask = vi.fn(() => 'review' as const)
    expect(await check.check(() => ({ documentCount: 1, attachmentCount: 0 }), ask)).toBe('review')
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('cleans counts to whole non-negative numbers', () => {
    expect(sensitiveSendCountsOf({ documentCount: 2.7, attachmentCount: -1 })).toEqual({
      documentCount: 2,
      attachmentCount: 0,
    })
    expect(sensitiveSendCountsOf({ documentCount: Number.NaN, attachmentCount: 4 })).toEqual({
      documentCount: 0,
      attachmentCount: 4,
    })
  })
})
