import { describe, expect, it } from 'vitest'

import {
  IME_DUPLICATE_INPUT_WINDOW_MS,
  imeInputRepeatsCommit,
} from '../src/renderer/ime-input-guard'

describe('IME input guard', () => {
  it('suppresses an input that repeats the composition commit', () => {
    expect(imeInputRepeatsCommit('ㅁ', 'ㅁ', 0)).toBe(true)
    expect(imeInputRepeatsCommit('한', '한', 40)).toBe(true)
  })

  it('keeps a different character or a later edit', () => {
    expect(imeInputRepeatsCommit('ㅁ', '★', 10)).toBe(false)
    expect(imeInputRepeatsCommit('', 'ㅁ', 10)).toBe(false)
    expect(imeInputRepeatsCommit('ㅁ', 'ㅁ', IME_DUPLICATE_INPUT_WINDOW_MS + 1)).toBe(false)
    expect(imeInputRepeatsCommit('ㅁ', 'ㅁ', -1)).toBe(false)
  })
})
