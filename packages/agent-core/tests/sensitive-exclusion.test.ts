import { describe, expect, it } from 'vitest'
import { createExclusionKey, exclusionHash } from '../src/sensitive-exclusion'

/**
 * What the app keeps for a dismissed candidate: the kind and a keyed hash.
 * Never the value — the record lives in the app's data folder, and a value
 * kept there would be the very thing the reader chose not to hide, sitting in
 * a second place.
 */

const KEY = new Uint8Array(32).map((_, i) => i + 1)

describe('the exclusion hash', () => {
  it('is stable for the same key, kind and value', async () => {
    const a = await exclusionHash(KEY, 'phone', '010-1234-5678')
    const b = await exclusionHash(KEY, 'phone', '010-1234-5678')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('treats values that compare equal as equal', async () => {
    expect(await exclusionHash(KEY, 'phone', '010 1234 5678')).toBe(
      await exclusionHash(KEY, 'phone', '01012345678'),
    )
  })

  it('differs by kind, value and key', async () => {
    const base = await exclusionHash(KEY, 'phone', '01012345678')
    expect(await exclusionHash(KEY, 'account', '01012345678')).not.toBe(base)
    expect(await exclusionHash(KEY, 'phone', '01012345679')).not.toBe(base)
    const other = new Uint8Array(32).fill(7)
    expect(await exclusionHash(other, 'phone', '01012345678')).not.toBe(base)
  })

  it('never contains the value, in any form', async () => {
    for (const value of ['01012345678', '홍길동', 'hong@example.com', 'abcdef']) {
      const hash = await exclusionHash(KEY, 'name', value)
      expect(hash).not.toContain(value)
      expect(hash).not.toContain(Buffer.from(value).toString('hex'))
      expect(hash).not.toContain(Buffer.from(value).toString('base64'))
    }
  })

  it('refuses a key too short to keep the hash from being guessed', async () => {
    await expect(exclusionHash(new Uint8Array(8), 'name', 'x')).rejects.toThrow()
  })
})

describe('the exclusion key', () => {
  it('is 32 random bytes', () => {
    const a = createExclusionKey()
    const b = createExclusionKey()
    expect(a).toBeInstanceOf(Uint8Array)
    expect(a).toHaveLength(32)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })
})
