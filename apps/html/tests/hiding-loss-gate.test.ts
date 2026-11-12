import { describe, expect, it, vi } from 'vitest'
import { htmlHidingLossAllowed } from '../src/main/hiding-loss-gate'

const MARKED = '<p>담임 <span data-gx-redact="학생 이름">홍길동</span></p>'

describe('the Word and ODT exports of a page with hiding marks', () => {
  it('ask once and stop on Cancel', async () => {
    const show = vi.fn(async () => ({ response: 1 }))
    expect(await htmlHidingLossAllowed(MARKED, false, show)).toBe(false)
    expect(show).toHaveBeenCalledTimes(1)
    expect(show.mock.calls[0][0].message).toMatch(/1/)
  })

  it('go on with Continue', async () => {
    const show = vi.fn(async () => ({ response: 0 }))
    expect(await htmlHidingLossAllowed(MARKED, false, show)).toBe(true)
  })

  it('do not ask for a page without marks, or from the command line', async () => {
    const show = vi.fn(async () => ({ response: 1 }))
    expect(await htmlHidingLossAllowed('<p>홍길동</p>', false, show)).toBe(true)
    expect(await htmlHidingLossAllowed(MARKED, true, show)).toBe(true)
    expect(show).not.toHaveBeenCalled()
  })
})
