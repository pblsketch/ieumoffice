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
  isMobileAiToolError,
  listMobileAiAttachments,
} from '../src/renderer/ai/tools'
import { stopAllMobileAi } from '../src/renderer/ai/runState'
import {
  PNG_BYTES,
  SSE_HEADERS,
  makeFakeRust,
  sse,
  type NetScript,
  type NetStart,
} from './ai-tools-fake'

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

/** Waits (inside act) until `find` returns something; a slow disk can take longer than one settle. */
async function waitFor<T>(find: () => T | null | undefined, ms = 5000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const found = find()
    if (found !== null && found !== undefined) return found
    if (Date.now() - start > ms) throw new Error('waitFor timed out')
    await act(async () => new Promise((r) => setTimeout(r, 20)))
  }
}

const byTestId = <T extends Element = HTMLElement>(id: string) =>
  document.querySelector<T>(`[data-testid="${id}"]`)

/** A skill whose read_url really runs the shared tool (its request goes to the fake Rust). */
function readingSkill(answers: string[]): AgentSkill {
  return {
    id: 'doc',
    systemPrompt: 'You read pages.',
    tools: [{ name: 'read_url', description: 'read_url', inputSchema: { type: 'object' } }],
    executeTool: async (call) => {
      const page = await getMobileAiTools().readUrl(String(call.input.url))
      const output = isMobileAiToolError(page) ? `error ${page.errorCode}` : page.text
      answers.push(output)
      return { output, summary: 'read_url' }
    },
  }
}

async function mount(
  turns: string[],
  executed: string[],
  extra: { skill?: AgentSkill; web?: NetScript } = {},
) {
  const relayBodies: string[] = []
  const rust = makeFakeRust({
    relay: (start: NetStart) => {
      relayBodies.push(start.body ?? '')
      return { status: 200, headers: SSE_HEADERS, body: turns.shift() ?? TEXT_TURN }
    },
    ...(extra.web ? { web: extra.web } : {}),
  })
  const editorDoc = {
    createAiRun: async () => ({ skill: extra.skill ?? docSkill(executed) }),
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
    const sheet = await waitFor(() => byTestId('ai-outbound-sheet'))
    const firstTools = (
      JSON.parse(relayBodies[0]!) as { tools: Array<{ function: { name: string } }> }
    ).tools.map((t) => t.function.name)
    expect(firstTools).toContain('read_url')
    expect(getMobileAiTools().availability().web).toBe(true)

    expect(sheet.textContent).toContain('https://unknown.example/a')
    await act(async () => byTestId<HTMLButtonElement>('ai-outbound-allow')!.click())
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
      const allow = await waitFor(() => byTestId<HTMLButtonElement>('ai-outbound-allow'))
      await act(async () => allow.click())
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
    const block = await waitFor(() => byTestId<HTMLButtonElement>('ai-outbound-block'))
    await act(async () => block.click())
    await act(async () => sent)
    expect(executed).toEqual(['read_url', 'read_url'])
  })

  it.each([
    ['the panel Stop', (ai: MobileAi) => ai.cancel()],
    ['stop everything (turning AI off)', () => stopAllMobileAi()],
    ['a document change', (ai: MobileAi) => ai.resetForDocument('doc-2')],
  ])('%s cuts the tool request in flight', async (_label, stop) => {
    const answers: string[] = []
    const { rust, ai } = await mount(
      [toolCallTurn('read_url', { url: 'https://known.example/a' })],
      [],
      { skill: readingSkill(answers), web: () => ({ hang: true }) },
    )
    let sent!: Promise<void>
    act(() => {
      // the address is in the conversation: nothing is asked
      sent = ai().send('read https://known.example/a')
    })
    const fetchStart = await waitFor(() =>
      rust.starts.find((s) => s.command === 'mobile_ai_web_fetch_start'),
    )
    act(() => stop(ai()))
    await act(async () => sent)
    await waitFor(() => (answers.length > 0 ? answers : null))
    expect(rust.cancels).toContain(fetchStart.requestId)
    expect(answers).toEqual(['error cancelled'])
  })
})
