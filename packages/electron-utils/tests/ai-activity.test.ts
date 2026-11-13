import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  onAiJobsChanged,
  registerAiJob,
  runningAiJobCount,
  stopAllAiJobs,
} from '../src/ai-activity'

const handles: Array<() => void> = []
function track(handle: () => void): () => void {
  handles.push(handle)
  return handle
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle()
})

describe('AI job registry', () => {
  it('counts the registered jobs and forgets an unregistered one', () => {
    expect(runningAiJobCount()).toBe(0)
    const a = track(registerAiJob({ kind: 'chat', stop: () => undefined }))
    track(registerAiJob({ kind: 'generate', stop: () => undefined }))
    expect(runningAiJobCount()).toBe(2)
    a()
    expect(runningAiJobCount()).toBe(1)
    // a second call of the same handle does nothing
    a()
    expect(runningAiJobCount()).toBe(1)
  })

  it('stops every job, waits for the stops and answers how many it stopped', async () => {
    const order: string[] = []
    track(
      registerAiJob({
        kind: 'document-job',
        stop: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5))
          order.push('slow')
        },
      }),
    )
    track(registerAiJob({ kind: 'agent', stop: () => void order.push('fast') }))
    const stopped = await stopAllAiJobs()
    expect(stopped).toBe(2)
    expect(order.sort()).toEqual(['fast', 'slow'])
    expect(runningAiJobCount()).toBe(0)
  })

  it('still stops the others when one stop throws', async () => {
    const stop = vi.fn()
    track(
      registerAiJob({
        kind: 'chat',
        stop: () => {
          throw new Error('boom')
        },
      }),
    )
    track(
      registerAiJob({
        kind: 'home-ask',
        stop: async () => {
          throw new Error('async boom')
        },
      }),
    )
    track(registerAiJob({ kind: 'chat', stop }))
    expect(await stopAllAiJobs()).toBe(3)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(runningAiJobCount()).toBe(0)
  })

  it('answers 0 when nothing runs', async () => {
    expect(await stopAllAiJobs()).toBe(0)
  })

  it('does not stop a job registered while the others are being stopped', async () => {
    const late = vi.fn()
    track(
      registerAiJob({
        kind: 'chat',
        stop: () => {
          track(registerAiJob({ kind: 'chat', stop: late }))
        },
      }),
    )
    expect(await stopAllAiJobs()).toBe(1)
    expect(late).not.toHaveBeenCalled()
    expect(runningAiJobCount()).toBe(1)
  })

  it('tells listeners the count after every change', async () => {
    const seen: number[] = []
    const off = onAiJobsChanged((count) => seen.push(count))
    const a = track(registerAiJob({ kind: 'chat', stop: () => undefined }))
    track(registerAiJob({ kind: 'chat', stop: () => undefined }))
    a()
    await stopAllAiJobs()
    off()
    track(registerAiJob({ kind: 'chat', stop: () => undefined }))
    expect(seen).toEqual([1, 2, 1, 0])
  })
})
