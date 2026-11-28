import { describe, expect, it, vi } from 'vitest'
import {
  AgentLoop,
  createIpcTransport,
  type AgentSkill,
  type AgentToolCall,
  type AgentTransport,
  type IpcStreamChunk,
} from '../src'

function makeSkill(exec: AgentSkill['executeTool']): AgentSkill {
  return {
    id: 'test-doc',
    systemPrompt: 'Edit the document.',
    tools: [
      {
        name: 'insert_text',
        description: 'Insert text into the document',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            count: { type: 'number' },
          },
          required: ['text'],
        },
      },
    ],
    buildContext: () => 'DOC',
    executeTool: exec,
  }
}

describe('AgentLoop ACP-native live tool mode (decision 0170)', () => {
  it('executes live tool calls with coercion, snapshot capture, and history recording without a second turn', async () => {
    let streamCalls = 0
    const receivedResults: Array<{ output: string; isError?: boolean }> = []
    const events: string[] = []

    const transport: AgentTransport = {
      stream(_request, callbacks) {
        streamCalls++
        void (async () => {
          callbacks.onDelta('Working... ')
          const r1 = await callbacks.onLiveToolCall!({
            id: 'call-1',
            name: 'insert_text',
            input: { text: 'Hello', count: '3' },
          })
          receivedResults.push({ output: r1.output, isError: r1.isError })
          // Missing required field should return a validation error without calling skill
          const r2 = await callbacks.onLiveToolCall!({
            id: 'call-2',
            name: 'insert_text',
            input: {},
          })
          receivedResults.push({ output: r2.output, isError: r2.isError })
          callbacks.onDelta('All done.')
          callbacks.onDone({ acpNative: true })
        })()
        return { cancel: () => undefined }
      },
    }

    const executeTool = vi.fn(async (call: AgentToolCall) => {
      events.push(`exec:${call.name}:${String(call.input.text)}:${typeof call.input.count}`)
      return { output: `ok:${String(call.input.text)}`, summary: 'Inserted text', mutated: true }
    })
    const captureSnapshot = vi.fn(() => {
      events.push('snapshot')
    })

    await new Promise<void>((resolve, reject) => {
      const loop = new AgentLoop({
        transport,
        skill: makeSkill(executeTool),
        captureSnapshot,
        events: {
          onToolStart: (c) => events.push(`start:${c.name}`),
          onToolExecuted: ({ call, execution }) =>
            events.push(`done:${call.name}:${execution.isError ? 'err' : 'ok'}`),
          onTurnEnd: () => events.push('turn-end'),
          onDone: () => resolve(),
          onError: (e) => reject(new Error(e)),
        },
      })
      loop.run('Write Hello')
    })

    // Only ONE transport stream call (no brain-only follow-up loop)
    expect(streamCalls).toBe(1)
    // Snapshot captured once before the first mutating tool
    expect(captureSnapshot).toHaveBeenCalledTimes(1)
    expect(executeTool).toHaveBeenCalledTimes(1)
    // Numeric string '3' was coerced to number before executeTool
    expect(events).toEqual([
      'start:insert_text',
      'snapshot',
      'exec:insert_text:Hello:number',
      'done:insert_text:ok',
      'turn-end',
      'done:insert_text:err',
    ])
    expect(receivedResults[0]).toEqual({ output: 'ok:Hello', isError: undefined })
    expect(receivedResults[1]?.isError).toBe(true)
  })

  it('wires acp-tool-call chunks through createIpcTransport and sends results over sendAcpToolResult', async () => {
    let listener: ((chunk: IpcStreamChunk) => void) | null = null
    const sentResults: Array<{
      requestId: string
      callId: string
      output: string
      isError?: boolean | undefined
    }> = []

    const transport = createIpcTransport<{ provider: string }>({
      onStream: (handler) => {
        listener = handler
        return () => {
          listener = null
        }
      },
      start: async (req) => {
        setTimeout(() => {
          listener?.({ requestId: req.requestId, type: 'delta', text: 'Before ' })
          listener?.({
            requestId: req.requestId,
            type: 'acp-tool-call',
            callId: 'cid-42',
            toolCall: { id: 'tc-42', name: 'insert_text', input: { text: 'Via IPC' } },
          })
        }, 0)
      },
      cancel: () => undefined,
      getSettings: () => ({ provider: 'antigravity' }),
      unknownErrorText: () => 'unknown',
      timeoutErrorText: () => 'timeout',
      sendAcpToolResult: async (payload) => {
        sentResults.push(payload)
        listener?.({ requestId: payload.requestId, type: 'delta', text: 'After' })
        listener?.({ requestId: payload.requestId, type: 'done', acpNative: true })
      },
    })

    const executeTool = vi.fn(async (call: AgentToolCall) => ({
      output: `wrote:${String(call.input.text)}`,
      summary: 'Inserted via IPC',
      mutated: true,
    }))

    let finalText = ''
    let loopHistoryRoles: string[] = []
    let firstAssistantText = ''
    await new Promise<void>((resolve, reject) => {
      const loop = new AgentLoop({
        transport,
        skill: makeSkill(executeTool),
        events: {
          onDone: ({ text }) => {
            finalText = text
            loopHistoryRoles = loop.messages.map((m) => m.role)
            const firstAssistant = loop.messages[1]
            firstAssistantText = firstAssistant?.role === 'assistant' ? firstAssistant.text : ''
            resolve()
          },
          onError: (e) => reject(new Error(e)),
        },
      })
      loop.run('Run via IPC')
    })

    expect(firstAssistantText).toBe('Before ')
    expect(finalText).toBe('After')
    expect(loopHistoryRoles).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(sentResults).toHaveLength(1)
    expect(sentResults[0]?.callId).toBe('cid-42')
    expect(sentResults[0]?.output).toBe('wrote:Via IPC')
    expect(sentResults[0]?.isError).toBeUndefined()
  })
})
