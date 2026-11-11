import JSZip from 'jszip'
import { expect, it } from 'vitest'
import { assertZipSourceInflatesWithinLimits, readZipSourcePart } from '../src/index'

function source(bytes: Uint8Array) {
  const reads: { at: number; length: number }[] = []
  return {
    reads,
    input: {
      size: bytes.length,
      async read(at: number, length: number) {
        reads.push({ at, length })
        return bytes.slice(at, at + length)
      },
    },
  }
}

it('coalesces many tiny adjacent headers and keeps independent retained copies', async () => {
  const zip = new JSZip()
  for (let i = 0; i < 600; i++)
    zip.file(`item-${i}`, `value-${i}`, { date: new Date('2026-01-01Z'), compression: 'STORE' })
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  const { reads, input } = source(bytes)
  const parts = await assertZipSourceInflatesWithinLimits(input)
  expect(parts.length).toBe(600)
  expect(reads.length).toBeLessThan(40)
  expect(Math.max(...reads.map((r) => r.length))).toBeLessThanOrEqual(1024 * 1024)
  for (const index of [0, 99, 599]) {
    const part = parts[index]!
    expect(new TextDecoder().decode(await readZipSourcePart(input, part))).toBe(`value-${index}`)
    const original = part.centralHeader.slice()
    parts[(index + 1) % parts.length]!.centralHeader.fill(0)
    expect(part.centralHeader).toEqual(original)
  }
})

it('handles local names beyond the read-ahead window and central headers crossing a window', async () => {
  const zip = new JSZip()
  for (let i = 0; i < 250; i++)
    zip.file(`${i}-${'a'.repeat(5000)}`, 'content', { compression: 'STORE' })
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  const { input, reads } = source(bytes)
  const parts = await assertZipSourceInflatesWithinLimits(input)
  expect(parts).toHaveLength(250)
  for (const index of [0, 208, 249]) {
    expect(new TextDecoder().decode(await readZipSourcePart(input, parts[index]!))).toBe('content')
    expect(parts[index]!.localHeader.length).toBeGreaterThan(4096)
  }
  expect(reads.every((r) => r.at >= 0 && r.at + r.length <= bytes.length)).toBe(true)
})

it('does not allocate a whole exaggerated central-directory span or read outside the source', async () => {
  const zip = new JSZip()
  zip.file('one', 'ok', { compression: 'STORE' })
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  const originalSize = bytes.length
  // A valid source may contain trailing padding. Keep the actual EOCD in its tail.
  const padded = new Uint8Array(4 * 1024 * 1024 + originalSize)
  padded.set(bytes.subarray(0, bytes.length - 22))
  padded.set(bytes.subarray(bytes.length - 22), padded.length - 22)
  const view = new DataView(padded.buffer)
  const central = view.getUint32(padded.length - 22 + 16, true)
  view.setUint32(padded.length - 22 + 12, padded.length - 22 - central, true)
  const { input, reads } = source(padded)
  expect(await assertZipSourceInflatesWithinLimits(input)).toHaveLength(1)
  expect(Math.max(...reads.map((r) => r.length))).toBeLessThanOrEqual(1024 * 1024)
  const damaged = bytes.slice()
  new DataView(damaged.buffer).setUint32(bytes.length - 22 + 12, 45, true)
  await expect(assertZipSourceInflatesWithinLimits(source(damaged).input)).rejects.toThrow(
    /corrupt central/,
  )
})
