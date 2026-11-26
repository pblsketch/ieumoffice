import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ADDRESS_DECLINED,
  AgentLoop,
  INTERNET_TOOLS_OFF,
  type AgentMessage,
  type AgentSkill,
  type AgentStreamRequest,
  type AgentTransport,
} from '@genoffice/agent-core'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { BackStackProvider } from '../src/renderer/shell/backStack'
import {
  createMobileOutboundBridge,
  guardMobileOutbound,
  type MobileOutboundBridge,
} from '../src/renderer/ai/outbound'
import { OutboundConfirmHost } from '../src/renderer/ai/OutboundConfirmSheet'

// The mobile bridge for decision 0062 (guardOutbound): the internet switch read
// before the run, the address question in the AI sheet ("막기"/"허용", Back and
// close block), and the addresses allowed for the conversation.

const TOOLS = ['web_search', 'read_url', 'edit_doc']

function makeSkill(executed: string[]): AgentSkill {
  return {
    id: 'doc',
    systemPrompt: 'You edit documents.',
    tools: TOOLS.map((name) => ({ name, description: name, inputSchema: { type: 'object' } })),
    executeTool: (call) => {
      executed.push(`${call.name} ${JSON.stringify(call.input)}`)
      return { output: `ran ${call.name}`, summary: call.name }
    },
  }
}

function bridgeWith(on: { value: boolean }) {
  return createMobileOutboundBridge({ readInternetTools: async () => on.value })
}

const roots: Root[] = []
const containers: HTMLElement[] = []

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  for (const div of containers.splice(0)) div.remove()
})

async function mountHost(bridge: MobileOutboundBridge) {
  const div = document.createElement('div')
  document.body.appendChild(div)
  containers.push(div)
  const root = createRoot(div)
  roots.push(root)
  await act(async () => {
    root.render(
      <MobileLocaleProvider lang="ko">
        <BackStackProvider>
          <OutboundConfirmHost bridge={bridge} />
        </BackStackProvider>
      </MobileLocaleProvider>,
    )
  })
}

const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)))

describe('the internet switch', () => {
  it('is read before the run, so the first turn already lists the web tools', async () => {
    const on = { value: true }
    const bridge = bridgeWith(on)
    const seen: string[][] = []
    const transport: AgentTransport = {
      stream(request: AgentStreamRequest, callbacks) {
        seen.push(request.tools.map((t) => t.name))
        queueMicrotask(() => {
          callbacks.onDelta('ok')
          callbacks.onDone()
        })
        return { cancel() {} }
      },
    }
    await bridge.prime()
    let loop: AgentLoop | null = null
    const skill = guardMobileOutbound(makeSkill([]), bridge, () => loop?.messages ?? [])
    await new Promise<void>((resolve) => {
      loop = new AgentLoop({ transport, skill, events: { onDone: () => resolve() } })
      loop.run('hello')
    })
    expect(seen[0]).toEqual(TOOLS)
  })

  it('off removes the outbound tools and refuses their calls', async () => {
    const on = { value: false }
    const bridge = bridgeWith(on)
    await bridge.prime()
    const executed: string[] = []
    const skill = guardMobileOutbound(makeSkill(executed), bridge, () => [])
    await Promise.resolve()
    expect(skill.tools.map((t) => t.name)).toEqual(['edit_doc'])
    const refused = await skill.executeTool({ id: '1', name: 'web_search', input: { query: 'x' } })
    expect(refused).toMatchObject({ isError: true, output: INTERNET_TOOLS_OFF })
    expect(executed).toEqual([])
  })

  it('a change during the run reaches the guard through the listener', async () => {
    const on = { value: true }
    const bridge = bridgeWith(on)
    await bridge.prime()
    const skill = guardMobileOutbound(makeSkill([]), bridge, () => [])
    await Promise.resolve()
    expect(skill.tools.map((t) => t.name)).toEqual(TOOLS)
    bridge.notifyInternetTools(false)
    expect(skill.tools.map((t) => t.name)).toEqual(['edit_doc'])
    bridge.endRun()
    // a finished run's guard hears nothing more
    bridge.notifyInternetTools(true)
    expect(skill.tools.map((t) => t.name)).toEqual(['edit_doc'])
  })
})

describe('the address question', () => {
  it('asks in the sheet for an address the conversation never showed, and remembers an allow', async () => {
    const bridge = bridgeWith({ value: true })
    await mountHost(bridge)
    const executed: string[] = []
    const messages: AgentMessage[] = [{ role: 'user', text: 'read the page' }]
    const run = async () => {
      await bridge.prime()
      return guardMobileOutbound(makeSkill(executed), bridge, () => messages)
    }

    const first = await run()
    const pending = first.executeTool({
      id: '1',
      name: 'read_url',
      input: { url: 'https://unknown.example/a' },
    })
    await flush()
    const sheet = document.querySelector('[data-testid="ai-outbound-sheet"]')
    expect(sheet).not.toBeNull()
    expect(sheet!.textContent).toContain('https://unknown.example/a')
    expect(sheet!.textContent).toContain('주소에 문서 내용')
    const allow = document.querySelector<HTMLButtonElement>('[data-testid="ai-outbound-allow"]')
    await act(async () => allow!.click())
    expect(await pending).toMatchObject({ output: 'ran read_url' })
    expect(document.querySelector('[data-testid="ai-outbound-sheet"]')).toBeNull()

    // the next run of the same conversation does not ask again
    const second = await run()
    expect(
      await second.executeTool({
        id: '2',
        name: 'read_url',
        input: { url: 'https://unknown.example/a' },
      }),
    ).toMatchObject({ output: 'ran read_url' })
    expect(document.querySelector('[data-testid="ai-outbound-sheet"]')).toBeNull()

    // a new conversation (another document) asks again
    bridge.reset()
    const third = await run()
    const again = third.executeTool({
      id: '3',
      name: 'read_url',
      input: { url: 'https://unknown.example/a' },
    })
    await flush()
    expect(document.querySelector('[data-testid="ai-outbound-sheet"]')).not.toBeNull()
    const block = document.querySelector<HTMLButtonElement>('[data-testid="ai-outbound-block"]')
    await act(async () => block!.click())
    expect(await again).toMatchObject({ isError: true, output: ADDRESS_DECLINED })
    expect(executed).toHaveLength(2)
  })

  it('does not ask for an address that stands in a tool result or the person’s message', async () => {
    const bridge = bridgeWith({ value: true })
    const confirm = vi.spyOn(bridge, 'confirmAddresses')
    await bridge.prime()
    const messages: AgentMessage[] = [
      { role: 'user', text: 'see https://told.example/x' },
      {
        role: 'assistant',
        text: '',
        toolCalls: [{ id: 's', name: 'web_search', input: { query: 'q' } }],
      },
      {
        role: 'tool',
        results: [{ id: 's', name: 'web_search', output: 'found https://found.example/page' }],
      },
    ]
    const skill = guardMobileOutbound(makeSkill([]), bridge, () => messages)
    for (const url of ['https://found.example/page', 'https://told.example/x']) {
      expect(await skill.executeTool({ id: url, name: 'read_url', input: { url } })).toMatchObject({
        output: 'ran read_url',
      })
    }
    expect(confirm).not.toHaveBeenCalled()
  })

  it('treats Back, closing and a missing sheet as blocking', async () => {
    const bridge = bridgeWith({ value: true })
    await bridge.prime()
    const skill = guardMobileOutbound(makeSkill([]), bridge, () => [])
    // no sheet host on screen: nothing can be asked, so it is blocked
    expect(
      await skill.executeTool({ id: '0', name: 'read_url', input: { url: 'https://a.example/' } }),
    ).toMatchObject({ output: ADDRESS_DECLINED })

    await mountHost(bridge)
    const viaBack = skill.executeTool({
      id: '1',
      name: 'read_url',
      input: { url: 'https://b.example/' },
    })
    await flush()
    expect(document.querySelector('[data-testid="ai-outbound-sheet"]')).not.toBeNull()
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(await viaBack).toMatchObject({ output: ADDRESS_DECLINED })

    const viaClose = skill.executeTool({
      id: '2',
      name: 'read_url',
      input: { url: 'https://c.example/' },
    })
    await flush()
    const close = document.querySelector<HTMLButtonElement>(
      '[data-testid="ai-outbound-sheet"] .mobile-sheet-header button',
    )
    await act(async () => close!.click())
    expect(await viaClose).toMatchObject({ output: ADDRESS_DECLINED })

    // reset while a question is open blocks it too
    const viaReset = skill.executeTool({
      id: '3',
      name: 'read_url',
      input: { url: 'https://d.example/' },
    })
    await flush()
    act(() => bridge.reset())
    expect(await viaReset).toMatchObject({ output: ADDRESS_DECLINED })
  })

  it('shows an address up to 300 characters', async () => {
    const bridge = bridgeWith({ value: true })
    await mountHost(bridge)
    const long = `https://long.example/${'a'.repeat(400)}`
    const answer = bridge.confirmAddresses('read_url', [long])
    await flush()
    const shown = document.querySelector('[data-testid="ai-outbound-address"]')!.textContent!
    expect(shown.startsWith(long.slice(0, 300))).toBe(true)
    expect(shown.length).toBeLessThanOrEqual(301)
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="ai-outbound-block"]')!.click(),
    )
    expect(await answer).toBe(false)
  })
})
