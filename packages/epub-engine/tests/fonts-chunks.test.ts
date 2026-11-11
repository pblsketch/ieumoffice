import { expect, it } from 'vitest'
import {
  ADOBE_FONT_OBFUSCATION,
  IDPF_FONT_OBFUSCATION,
  fontObfuscationKey,
  obfuscateFontWithKey,
} from '../src/fonts'

it.each([ADOBE_FONT_OBFUSCATION, IDPF_FONT_OBFUSCATION] as const)(
  'keeps XOR offsets across arbitrary chunk boundaries (%s)',
  (algorithm) => {
    const input = Uint8Array.from({ length: 3000 }, (_, i) => i & 255)
    const key = fontObfuscationKey(algorithm, 'urn:uuid:12345678-90ab-cdef-1234-567890abcdef')!
    const expected = obfuscateFontWithKey(input, algorithm, key)
    const chunks = new Uint8Array(input.length)
    for (let at = 0; at < input.length; at += 17)
      chunks.set(obfuscateFontWithKey(input.subarray(at, at + 17), algorithm, key, at), at)
    expect(chunks).toEqual(expected)
    expect(input[0]).toBe(0)
  },
)
