import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { hashBookBytes } from '../src/main/book-hash'

describe('the session document key', () => {
  it('keeps SHA-256 unchanged for empty bytes and a view into a larger buffer', async () => {
    expect(await hashBookBytes(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    const buffer = new Uint8Array([255, 97, 98, 99, 255])
    expect(await hashBookBytes(buffer.subarray(1, 4))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect([...buffer]).toEqual([255, 97, 98, 99, 255])
  })

  it('hashes every chunk without blocking the event loop for the whole book', async () => {
    const bytes = new Uint8Array(16 * 1024 * 1024 + 17)
    bytes[8 * 1024 * 1024] = 31
    bytes[bytes.length - 1] = 255
    const expected = createHash('sha256').update(bytes).digest('hex')
    let inputHandled = false
    setImmediate(() => {
      inputHandled = true
    })
    expect(await hashBookBytes(bytes)).toBe(expected)
    expect(inputHandled).toBe(true)
  })
})
