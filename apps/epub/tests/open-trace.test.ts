// @vitest-environment node
import { performance } from 'node:perf_hooks'
import { afterEach, describe, expect, it } from 'vitest'
import { traceEpubOpen } from '../src/main/open-trace'

const records = () =>
  performance
    .getEntriesByType('measure')
    .filter((entry) => entry.name.startsWith('ieum.epub.open.'))
afterEach(() => {
  for (const entry of records()) performance.clearMeasures(entry.name)
})

describe('bounded EPUB open attribution', () => {
  it('returns the original result and correlates nested stages without document details', async () => {
    const trace = traceEpubOpen()
    const value = { ok: true }
    expect(await trace('total', () => trace('snapshot', async () => value))).toBe(value)
    const entries = records()
    expect(entries).toHaveLength(2)
    expect(
      new Set(entries.map((entry) => (entry as PerformanceMeasure).detail.operation)).size,
    ).toBe(1)
    expect(entries.every((entry) => entry.duration >= 0)).toBe(true)
    expect(Object.keys((entries[0] as PerformanceMeasure).detail)).toEqual([
      'operation',
      'elapsedMs',
    ])
  })

  it('preserves the exact opening error while measuring the failed stage', async () => {
    const error = new Error('read failed')
    await expect(
      traceEpubOpen()('snapshot', async () => {
        throw error
      }),
    ).rejects.toBe(error)
    expect(records().map((entry) => entry.name)).toEqual(['ieum.epub.open.snapshot'])
  })

  it('bounds same-stage records across repeated opens', async () => {
    for (let i = 0; i < 100; i++) await traceEpubOpen()('total', async () => i)
    expect(records()).toHaveLength(1)
  })
})
