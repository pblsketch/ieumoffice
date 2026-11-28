import { describe, expect, it, vi } from 'vitest'
import type { AgentSkill, AgentToolCall } from '@genoffice/agent-core'
import {
  AI_SUBSCRIPTION_NOTICE_VERSION,
  isKeyProviderConfigured,
} from '@genoffice/ai-provider/browser'
import {
  SEALED_KEY_PLACEHOLDER,
  assertValidMobileModelSelection,
  createMobileAgentTransport,
  createMobileAiMemoryStore,
  evaluateMobileAiSendGate,
  projectMobileAiSettings,
  projectMobileSubscriptionStatuses,
  selectMobileAiProvider,
} from '../src/ai-bridge'
import { createMobileSessionController } from '../src/session-state'
import {
  createMobileClient,
  type MobileAiSettingsSnapshot,
  type MobileAiStreamChunk,
  type MobileChatGptStatus,
  type MobileDocSession,
  type MobileTransport,
} from '../src/transport'
import {
  canMutateDocument,
  initialDocumentMode,
  wrapSkillWithViewEditGate,
  type DocumentMode,
} from '../src/view-edit-gate'

function makeSession(overrides: Partial<MobileDocSession> = {}): MobileDocSession {
  return {
    sessionId: 'sess-1',
    docKey: '0123456789abcdef',
    name: 'notes.md',
    ext: 'md',
    format: 'md',
    writable: true,
    ephemeral: false,
    uriHint: 'content://doc/1',
    ...overrides,
  }
}

describe('MobileSessionController unsaved switch guard', () => {
  it('keeps the active session intact when the user cancels a dirty switch', async () => {
    const discarded: string[] = []
    const resets: Array<[string | null, string | null]> = []
    const controller = createMobileSessionController({
      confirmUnsavedSwitch: async () => 'cancel',
      saveCurrentDocument: async () => true,
      discardRecovery: async (docKey) => {
        discarded.push(docKey)
      },
      onResetAiMemory: (prev, next) => resets.push([prev, next]),
    })

    const first = makeSession({ sessionId: 's1', docKey: 'doc-a' })
    await controller.switchTo(async () => ({ session: first }))
    controller.markDirty(true)

    const second = makeSession({ sessionId: 's2', docKey: 'doc-b' })
    const outcome = await controller.switchTo(async () => ({ session: second }))

    expect(outcome.switched).toBe(false)
    expect(outcome.reason).toBe('cancelled')
    expect(controller.getActive()?.session.docKey).toBe('doc-a')
    expect(controller.getActive()?.dirty).toBe(true)
    expect(discarded).toEqual([])
    expect(resets).toEqual([[null, 'doc-a']])
  })

  it('discards recovery and resets AI memory when switching after discard', async () => {
    const discarded: string[] = []
    const memory = createMobileAiMemoryStore()
    const controller = createMobileSessionController({
      confirmUnsavedSwitch: async () => 'discard',
      saveCurrentDocument: async () => true,
      discardRecovery: async (docKey) => {
        discarded.push(docKey)
      },
      onResetAiMemory: (_prev, next) => memory.resetForDoc(next),
    })

    const first = makeSession({ sessionId: 's1', docKey: 'doc-a' })
    await controller.switchTo(async () => ({ session: first }))
    memory.append({ role: 'user', text: 'Summarize doc A' })
    expect(memory.getMessages()).toHaveLength(1)

    controller.markDirty(true)
    const second = makeSession({ sessionId: 's2', docKey: 'doc-b' })
    const outcome = await controller.handleExternalOpenIntent({ session: second })

    expect(outcome.switched).toBe(true)
    expect(controller.getActive()?.session.docKey).toBe('doc-b')
    expect(discarded).toEqual(['doc-a'])
    expect(memory.getMessages()).toHaveLength(0)

    await controller.closeActive()
    expect(controller.getActive()).toBeNull()
    expect(memory.getDocKey()).toBeNull()
  })

  it('aborts switch if save fails during dirty transition', async () => {
    const controller = createMobileSessionController({
      confirmUnsavedSwitch: async () => 'save',
      saveCurrentDocument: async () => false,
    })

    await controller.switchTo(async () => ({ session: makeSession({ docKey: 'doc-a' }) }))
    controller.markDirty(true)
    const outcome = await controller.switchTo(async () => ({
      session: makeSession({ docKey: 'doc-b' }),
    }))

    expect(outcome.switched).toBe(false)
    expect(outcome.reason).toBe('save-failed')
    expect(controller.getActive()?.session.docKey).toBe('doc-a')
  })
})

describe('view-first mode and AI edit gate', () => {
  const baseSkill: AgentSkill = {
    id: 'test-editor',
    systemPrompt: 'Editor rules.',
    tools: [
      { name: 'read_doc', description: 'Read document', inputSchema: { type: 'object' } },
      { name: 'edit_doc', description: 'Edit document', inputSchema: { type: 'object' } },
    ],
    executeTool: (call: AgentToolCall) => ({
      output: `ran:${call.name}`,
      mutated: call.name === 'edit_doc',
      summary: call.name,
    }),
  }

  it('starts opened docs in view mode and untitled docs in edit mode', () => {
    expect(initialDocumentMode({ isUntitled: false })).toBe('view')
    expect(initialDocumentMode({ isUntitled: true })).toBe('edit')
  })

  it('allows read tools in view mode and auto-switches to edit mode on mutating tools', async () => {
    let mode: DocumentMode = 'view'
    const switched: string[] = []
    const wrapped = wrapSkillWithViewEditGate(baseSkill, {
      isMutatingTool: (name) => name === 'edit_doc',
      getMode: () => mode,
      getCapabilities: () => ({ writable: true, encrypted: false, distribution: false }),
      switchToEdit: () => {
        mode = 'edit'
      },
      onAutoSwitchedToEdit: (name) => switched.push(name),
    })

    expect(wrapped.tools.map((t) => t.name)).toEqual(['read_doc', 'edit_doc'])
    const readRes = await wrapped.executeTool({ id: '1', name: 'read_doc', input: {} })
    expect(readRes.output).toBe('ran:read_doc')
    expect(mode).toBe('view')
    expect(switched).toEqual([])

    const editRes = await wrapped.executeTool({ id: '2', name: 'edit_doc', input: {} })
    expect(editRes.output).toBe('ran:edit_doc')
    expect(mode).toBe('edit')
    expect(switched).toEqual(['edit_doc'])
  })

  it('strips mutating tools and rejects mutation calls on read-only, encrypted, or distribution docs', async () => {
    for (const caps of [
      { writable: false, encrypted: false, distribution: false },
      { writable: true, encrypted: true, distribution: false },
      { writable: true, encrypted: false, distribution: true },
    ]) {
      expect(canMutateDocument(caps)).toBe(false)
      let switchCount = 0
      const wrapped = wrapSkillWithViewEditGate(baseSkill, {
        isMutatingTool: (name) => name === 'edit_doc',
        getMode: () => 'view',
        getCapabilities: () => caps,
        switchToEdit: () => {
          switchCount += 1
        },
      })

      expect(wrapped.tools.map((t) => t.name)).toEqual(['read_doc'])
      const res = await wrapped.executeTool({ id: '1', name: 'edit_doc', input: {} })
      expect(res.isError).toBe(true)
      expect(switchCount).toBe(0)
    }
  })
})

describe('AI projection, selectAiProvider, aiSendGate, and stream transport', () => {
  const baseSnapshot: MobileAiSettingsSnapshot = {
    selectedProvider: 'auto',
    modelByProvider: {
      openai: 'gpt-4o-mini',
      openrouter: 'meta-llama/llama-3.3-70b-instruct:free',
    },
    configuredProviders: {
      openai: { hasKey: true, models: ['gpt-4o-mini'] },
      openrouter: {
        hasKey: true,
        freeOnly: true,
        models: ['meta-llama/llama-3.3-70b-instruct:free'],
      },
    },
    chatgptVisible: false,
    subscriptionNoticeVersion: 0,
  }

  it('marks claude-code/codex off, projects hidden chatgpt to signed-out, and never auto-falls back to keys', () => {
    const statuses = projectMobileSubscriptionStatuses({ state: 'hidden' })
    expect(statuses['claude-code']?.state).toBe('off')
    expect(statuses.codex?.state).toBe('off')
    expect(statuses.chatgpt?.state).toBe('signed-out')

    const choice = selectMobileAiProvider(baseSnapshot, { state: 'hidden' })
    expect(choice.connected).toBe(false)
    if (!choice.connected) {
      expect(choice.reason).toBe('no-subscription')
    }

    const gate = evaluateMobileAiSendGate(baseSnapshot, { state: 'hidden' })
    expect(gate.kind).toBe('connect')
  })

  it('uses __sealed__ placeholder so explicitly selected key providers are recognized without raw keys', () => {
    const snapshot: MobileAiSettingsSnapshot = {
      ...baseSnapshot,
      selectedProvider: 'openai',
    }
    const projected = projectMobileAiSettings(snapshot)
    expect(projected.providers.openai.apiKey).toBe(SEALED_KEY_PLACEHOLDER)
    expect(isKeyProviderConfigured(projected, 'openai')).toBe(true)

    const choice = selectMobileAiProvider(snapshot, { state: 'hidden' })
    expect(choice).toEqual({ connected: true, provider: 'openai', metered: false })

    const gate = evaluateMobileAiSendGate(snapshot, { state: 'hidden' })
    expect(gate.kind).toBe('run')
  })

  it('enforces subscription notice version for ready ChatGPT connections', () => {
    const readyChatgpt: MobileChatGptStatus = {
      state: 'ready',
      account: 'user@example.com',
      sharing: true,
    }
    const unacked: MobileAiSettingsSnapshot = {
      ...baseSnapshot,
      chatgptVisible: true,
      subscriptionNoticeVersion: 0,
    }
    expect(evaluateMobileAiSendGate(unacked, readyChatgpt).kind).toBe('notice')

    const acked: MobileAiSettingsSnapshot = {
      ...unacked,
      subscriptionNoticeVersion: AI_SUBSCRIPTION_NOTICE_VERSION,
    }
    expect(evaluateMobileAiSendGate(acked, readyChatgpt).kind).toBe('run')
  })

  it('enforces OpenRouter freeOnly :free models while allowing paid models on BYOK', () => {
    expect(() =>
      assertValidMobileModelSelection('openrouter', 'openai/gpt-4o', {
        hasKey: true,
        freeOnly: true,
        models: [],
      }),
    ).toThrow(/INVALID_ARGUMENT/)

    expect(() =>
      assertValidMobileModelSelection('openrouter', 'meta-llama/llama-3.3-70b-instruct:free', {
        hasKey: true,
        freeOnly: true,
        models: [],
      }),
    ).not.toThrow()

    expect(() =>
      assertValidMobileModelSelection('openrouter', 'openai/gpt-4o', {
        hasKey: true,
        freeOnly: false,
        models: [],
      }),
    ).not.toThrow()
  })

  it('streams chunks and forwards cancel via MobileAgentTransport', async () => {
    let listener: ((chunk: MobileAiStreamChunk) => void) | null = null
    const cancelledIds: string[] = []
    const transport: MobileTransport = {
      async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
        if (command === 'mobile_ai_stream_start') {
          const req = args as { requestId: string }
          queueMicrotask(() => {
            listener?.({ requestId: req.requestId, type: 'delta', text: 'Hello ' })
            listener?.({ requestId: req.requestId, type: 'delta', text: 'mobile' })
            listener?.({ requestId: req.requestId, type: 'done', stopReason: 'end_turn' })
          })
          return { ok: true } as T
        }
        if (command === 'mobile_ai_stream_cancel') {
          cancelledIds.push(String((args as { requestId: string }).requestId))
          return { ok: true } as T
        }
        throw new Error(`unexpected command ${command}`)
      },
      async listen<T>(_event: string, handler: (payload: T) => void) {
        listener = handler as (chunk: MobileAiStreamChunk) => void
        return () => {
          listener = null
        }
      },
    }

    const client = createMobileClient(transport)
    const agentTransport = createMobileAgentTransport(client)
    const deltas: string[] = []
    const onDone = vi.fn()

    await new Promise<void>((resolve) => {
      agentTransport.stream(
        { system: 'sys', messages: [{ role: 'user', text: 'hi' }], tools: [] },
        {
          onDelta: (t) => deltas.push(t),
          onToolCall: () => {},
          onDone: () => {
            onDone()
            resolve()
          },
          onError: () => resolve(),
        },
      )
    })

    expect(deltas.join('')).toBe('Hello mobile')
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(cancelledIds).toEqual([])
  })
})
