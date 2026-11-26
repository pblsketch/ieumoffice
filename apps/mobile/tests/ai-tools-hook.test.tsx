import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AgentSkill } from '@genoffice/agent-core'
import { preloadMobileKeyProviderProtocols } from '@genoffice/mobile-bridge/ai-bridge'
import type { ActiveDocState } from '@genoffice/mobile-bridge/session-state'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { BackStackProvider } from '../src/renderer/shell/backStack'
import type { EditorDocument } from '../src/renderer/editors/editorKind'
import { useMobileAi, type MobileAi } from '../src/renderer/ai/useMobileAi'
import {
  addMobileAiAttachment,
  getMobileAiTools,
  listMobileAiAttachments,
} from '../src/renderer/ai/tools'
import { PNG_BYTES, SSE_HEADERS, makeFakeRust, sse, type NetStart } from './ai-tools-fake'

// useMobileAi binds the shared AI tools and wraps every run with the internet
// guard (decision 0062): the first turn lists the web tools, an address the
// conversation never showed is asked about in the AI sheet, and a document
// change forgets the allowed addresses and the attached photos.

const DOC: ActiveDocState = {
  session: {
    sessionId: 's1',
    docKey: 'doc-1',
    name: 'a.md',
    ext: 'md',
    format: 'md',
    writable: true,
    ephemeral: false,
  },
  dirty: false,
  encrypted: false,
  distribution: false,
  trackingDropped: false,
  isUntitled: false,
}

function toolCallTurn(name: string, input: unknown): string {
  return sse(
    [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: `call_${name}`,
                  function: { name, arguments: JSON.stringify(input) },
                },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ],
    true,
  )
}

const TEXT_TURN = sse([{ choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }] }], true)

function docSkill(executed: string[]): AgentSkill {
  return {
    id: 'doc',
    systemPrompt: 'You edit documents.',
    tools: ['read_url', 'edit_doc'].map((name) => ({
      name,
      description: name,
      inputSchema: { type: 'object' },
    })),
    executeTool: (call) => {
      executed.push(call.name)
      return { output: `ran ${call.name}`, summary: call.name }
    },
  }
}

const roots: Root[] = []
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
})

beforeAll(async () => {
  await preloadMobileKeyProviderProtocols()
}, 60_000)

const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)))

async function mount(turns: string[], executed: string[]) {
  const relayBodies: string[] = []
  const rust = makeFakeRust({
    relay: (start: NetStart) => {
      relayBodies.push(start.body ?? '')
      return { status: 200, headers: SSE_HEADERS, body: turns.shift() ?? TEXT_TURN }
    },
  })
  const editorDoc = {
    createAiRun: async () => ({ skill: docSkill(executed) }),
  } as unknown as EditorDocument
  const holder: { ai: MobileAi | null } = { ai: null }
  function Harness() {
    const ai = useMobileAi({
      client: rust.client,
      aiEnabled: true,
      canMutate: true,
      getActiveDoc: () => DOC,
      getOpenedDocument: () => editorDoc,
      getMode: () => 'edit',
      setModeEdit: () => {},
      getLang: () => 'ko',
      openSettings: () => {},
    })
    holder.ai = ai
    return ai.panel
  }
  const div = document.createElement('div')
  document.body.appendChild(div)
  const root = createRoot(div)
  roots.push(root)
  await act(async () => {
    root.render(
      <MobileLocaleProvider lang="ko">
        <BackStackProvider>
          <Harness />
        </BackStackProvider>
      </MobileLocaleProvider>,
    )
  })
  return { rust, relayBodies, ai: () => holder.ai! }
}

describe('useMobileAi with the AI tools', () => {
  it('lists the web tools on the first turn and asks before an unknown address', async () => {
    const executed: string[] = []
    const { relayBodies, ai } = await mount(
      [toolCallTurn('read_url', { url: 'https://unknown.example/a' })],
      executed,
    )
    let sent!: Promise<void>
    act(() => {
      sent = ai().send('read that page')
    })
    await settle()
    const firstTools = (
      JSON.parse(relayBodies[0]!) as { tools: Array<{ function: { name: string } }> }
    ).tools.map((t) => t.function.name)
    expect(firstTools).toContain('read_url')
    expect(getMobileAiTools().availability().web).toBe(true)

    const sheet = document.querySelector('[data-testid="ai-outbound-sheet"]')
    expect(sheet).not.toBeNull()
    expect(sheet!.textContent).toContain('https://unknown.example/a')
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="ai-outbound-allow"]')!.click(),
    )
    await act(async () => sent)
    expect(executed).toEqual(['read_url'])
  })

  it('a document change forgets the allowed addresses and the attached photos', async () => {
    const executed: string[] = []
    const { ai } = await mount(
      [
        toolCallTurn('read_url', { url: 'https://unknown.example/a' }),
        TEXT_TURN,
        toolCallTurn('read_url', { url: 'https://unknown.example/a' }),
        TEXT_TURN,
        toolCallTurn('read_url', { url: 'https://unknown.example/a' }),
      ],
      executed,
    )
    const allowNext = async () => {
      await settle()
      const allow = document.querySelector<HTMLButtonElement>('[data-testid="ai-outbound-allow"]')
      expect(allow).not.toBeNull()
      await act(async () => allow!.click())
    }
    let sent!: Promise<void>
    act(() => {
      sent = ai().send('read it')
    })
    await allowNext()
    await act(async () => sent)

    // same conversation: no second question
    act(() => {
      sent = ai().send('read it again')
    })
    await settle()
    expect(document.querySelector('[data-testid="ai-outbound-sheet"]')).toBeNull()
    await act(async () => sent)
    expect(executed).toEqual(['read_url', 'read_url'])

    addMobileAiAttachment({ name: 'p.png', mime: 'image/png', bytes: PNG_BYTES })
    act(() => ai().resetForDocument('doc-2'))
    expect(listMobileAiAttachments()).toEqual([])

    act(() => {
      sent = ai().send('read it on the new document')
    })
    await settle()
    expect(document.querySelector('[data-testid="ai-outbound-sheet"]')).not.toBeNull()
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="ai-outbound-block"]')!.click(),
    )
    await act(async () => sent)
    expect(executed).toEqual(['read_url', 'read_url'])
  })
})
