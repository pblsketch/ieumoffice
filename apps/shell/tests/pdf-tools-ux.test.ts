import { describe, expect, it } from 'vitest'
import { runBatchItems } from '../src/main/pdf-tools/batch-orchestrator'
import { isBatchTool, isChainTarget } from '../src/main/pdf-tools/tools'
import type { PdfProgressEvent } from '../src/shared/pdf-tools-api'

describe('PDF tools v2 batch orchestrator', () => {
  it('skips un-unlocked encrypted files, continues past refusals/failures, and records target-not-met', async () => {
    const progress: PdfProgressEvent[] = []
    const res = await runBatchItems(
      [
        { id: '1', name: 'ok.pdf' },
        { id: '2', name: 'locked-not-unlocked.pdf', encrypted: true, unlocked: false },
        { id: '3', name: 'locked-unlocked.pdf', encrypted: true, unlocked: true },
        { id: '4', name: 'already-tiny.pdf' },
        { id: '5', name: 'big-target-miss.pdf' },
      ],
      async (item, _idx, reportPage) => {
        reportPage(1, 2)
        if (item.id === '1') {
          return { status: 'ok', outputs: [{ id: 'o1', name: 'ok-smaller.pdf', size: 500 }] }
        }
        if (item.id === '3') {
          return {
            status: 'ok',
            outputs: [{ id: 'o3', name: 'locked-unlocked-smaller.pdf', size: 600 }],
          }
        }
        if (item.id === '4') {
          return { status: 'skipped', reason: 'not-smaller' }
        }
        return {
          status: 'target-not-met',
          outputs: [{ id: 'o5', name: 'big-target-miss-smaller.pdf', size: 2_500_000 }],
          achievedBytes: 2_500_000,
          targetBytes: 2_000_000,
        }
      },
      { onProgress: (ev) => progress.push(ev) },
    )

    expect(res.canceled).toBe(false)
    expect(res.savedCount).toBe(3)
    expect(res.outputs.map((o) => o.id)).toEqual(['o1', 'o3', 'o5'])
    expect(res.outcomes).toEqual([
      {
        inputId: '1',
        name: 'ok.pdf',
        status: 'ok',
        outputs: [{ id: 'o1', name: 'ok-smaller.pdf', size: 500 }],
      },
      {
        inputId: '2',
        name: 'locked-not-unlocked.pdf',
        status: 'skipped',
        reason: 'unlocked-missing',
      },
      {
        inputId: '3',
        name: 'locked-unlocked.pdf',
        status: 'ok',
        outputs: [{ id: 'o3', name: 'locked-unlocked-smaller.pdf', size: 600 }],
      },
      {
        inputId: '4',
        name: 'already-tiny.pdf',
        status: 'skipped',
        reason: 'not-smaller',
      },
      {
        inputId: '5',
        name: 'big-target-miss.pdf',
        status: 'target-not-met',
        outputs: [{ id: 'o5', name: 'big-target-miss-smaller.pdf', size: 2_500_000 }],
        achievedBytes: 2_500_000,
        targetBytes: 2_000_000,
      },
    ])
    expect(progress.some((p) => p.currentName === 'ok.pdf' && p.fileTotal === 5)).toBe(true)
  })

  it('stops promptly on cancel and reports how many files were already saved', async () => {
    const controller = new AbortController()
    const seen: string[] = []
    const res = await runBatchItems(
      [
        { id: '1', name: 'a.pdf' },
        { id: '2', name: 'b.pdf' },
        { id: '3', name: 'c.pdf' },
      ],
      async (item) => {
        seen.push(item.id)
        if (item.id === '1') {
          controller.abort()
          return { status: 'ok', outputs: [{ id: 'o1', name: 'a-out.pdf', size: 100 }] }
        }
        return { status: 'ok', outputs: [{ id: 'o2', name: 'b-out.pdf', size: 100 }] }
      },
      { signal: controller.signal },
    )
    expect(res.canceled).toBe(true)
    expect(res.savedCount).toBe(1)
    expect(seen).toEqual(['1'])
  })

  it('enforces split exclusion from batch and chaining', () => {
    expect(isBatchTool('split')).toBe(false)
    expect(isChainTarget('split')).toBe(false)
    expect(isBatchTool('rotate')).toBe(true)
    expect(isChainTarget('encrypt')).toBe(true)
  })
})
