/**
 * The alert before a tab's first AI send and the candidate list, as the AI
 * panels mount them (`useSensitiveInfo`): counted once per tab (document and
 * the request's attachments), "Review" sends nothing and opens the list, the
 * local-AI wording, and a confirm handing the spots to the editor's command.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SensitiveInfoController } from '../src/renderer/ai/use-sensitive-info'
import type { SensitiveSpot } from '../src/renderer/ai/sensitive-find'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Every test imports the hook afresh (vi.resetModules), so the first one pays the
// whole transform; on a loaded machine that alone passes the default timeout.
vi.setConfig({ testTimeout: 60_000 })

type Loc = { piece: number }

let host: HTMLDivElement
let root: Root
let ctl: SensitiveInfoController
const hide = vi.fn(async (_spots: SensitiveSpot<Loc>[]) => {})

async function mount(opts: { text: string; attachments?: string[]; localAi?: boolean }) {
  // a fresh module per test: the first-send answer lives as long as the tab (module scope)
  vi.resetModules()
  const { useSensitiveInfo } = await import('../src/renderer/ai/use-sensitive-info')
  const { createSensitiveExclusionMemory } = await import('../src/renderer/ai/sensitive-find')
  const memory = createSensitiveExclusionMemory(null, () => null)
  function Probe() {
    ctl = useSensitiveInfo<Loc>({
      lang: 'en',
      localAi: opts.localAi ?? false,
      memory,
      collect: async () => ({
        pieces: [{ text: opts.text, location: { piece: 0 } }],
        locationText: () => 'Slide 1',
      }),
      hide,
      attachmentTexts: async () => opts.attachments ?? [],
    })
    return createElement('div', null, ctl.button, ctl.panel)
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(createElement(Probe)))
}

const flush = () => act(async () => new Promise((r) => setTimeout(r, 20)))
const button = (text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === text)

beforeEach(() => hide.mockClear())
afterEach(() => {
  // a test that timed out before mounting leaves nothing to unmount
  if (root) act(() => root.unmount())
  host?.remove()
})

describe('first-send alert', () => {
  it('nothing found: the send goes out and the tab is never asked again', async () => {
    await mount({ text: 'nothing to see here' })
    let answer: string | undefined
    await act(async () => {
      answer = await ctl.beforeSend()
    })
    expect(answer).toBe('send')
    expect(ctl.settled()).toBe(true)
    expect(host.querySelector('.gs-sens-alert')).toBeNull()
  })

  it('counts the document and the attachments; Review sends nothing and opens the list', async () => {
    await mount({
      text: 'Call 010-1234-5678 today',
      attachments: ['contact: a.person@example.com'],
    })
    let answer: Promise<string> | undefined
    await act(async () => {
      answer = ctl.beforeSend()
    })
    await flush()
    const alert = host.querySelector('.gs-sens-alert')!
    expect(alert.textContent).toContain('1 in this document, 1 in attachments')
    expect(alert.textContent).toContain('goes to the AI as it is')
    expect(alert.textContent).not.toContain('on this PC')
    await act(async () => button('Review')!.click())
    expect(await answer).toBe('review')
    await flush()
    // the list is open with the candidate and the attachment hint
    const list = host.querySelector('.gs-sens-list')!
    expect(list.textContent).toContain('010-1234-5678')
    expect(list.textContent).toContain('Found in attachments: 1')
    // answered: the next send goes straight out
    let next: string | undefined
    await act(async () => {
      next = await ctl.beforeSend()
    })
    expect(next).toBe('send')
  })

  it('says "the AI on this PC" for a local AI and still asks', async () => {
    await mount({ text: 'mail me at someone@example.org', localAi: true })
    let answer: Promise<string> | undefined
    await act(async () => {
      answer = ctl.beforeSend()
    })
    await flush()
    expect(host.querySelector('.gs-sens-alert')!.textContent).toContain('the AI on this PC')
    await act(async () => button('Send anyway')!.click())
    expect(await answer).toBe('send')
    expect(ctl.settled()).toBe(true)
  })
})

describe('the candidate list', () => {
  it('opens from the button and hands a confirmed spot to the editor', async () => {
    await mount({ text: 'Call 010-1234-5678 today' })
    await act(async () => button('Find sensitive info')!.click())
    await flush()
    expect(host.querySelector('.gs-sens-row')).not.toBeNull()
    await act(async () => button('Hide')!.click())
    await flush()
    expect(hide).toHaveBeenCalledTimes(1)
    expect(hide.mock.calls[0]![0]).toEqual([
      expect.objectContaining({ kind: 'phone', value: '010-1234-5678', label: 'Phone-01' }),
    ])
  })

  it('an excluded spot leaves the list and is not counted again', async () => {
    await mount({ text: 'Call 010-1234-5678 today' })
    await act(async () => button('Find sensitive info')!.click())
    await flush()
    await act(async () => button('Exclude')!.click())
    await flush()
    expect(host.querySelector('.gs-sens-row')).toBeNull()
    let answer: string | undefined
    await act(async () => {
      answer = await ctl.beforeSend()
    })
    expect(answer).toBe('send')
  })
})
