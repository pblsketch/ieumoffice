import { spawn as nodeSpawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentToolCall, AgentToolDef } from '@genoffice/agent-core'
import {
  PANEL_MCP_SERVER_NAME,
  closeAllAntigravityPanelSessions,
  matchPanelMcpTool,
  streamAntigravityPanel,
  type AntigravityPanelDeps,
} from '../src/antigravity-panel'
import { AiRunError } from '../src/run-error'
import type { SubscriptionProgram } from '../src/subscription/locate'
import type { SubscriptionSpawn } from '../src/subscription/process'

const tempDirs: string[] = []

afterEach(async () => {
  await closeAllAntigravityPanelSessions()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

/**
 * Create a fake Node-based ACP v1 stdio server script that implements the
 * subset of ACP needed to test `streamAntigravityPanel` without calling any
 * real CLI or consuming user quota.
 */
async function createFakePanelAcpServer(mode: string): Promise<{
  scriptPath: string
  deps: AntigravityPanelDeps
  spawns: string[][]
  createdTemps: string[]
  removedTemps: string[]
}> {
  const dir = await makeTempDir('fake-agy-panel-')
  const scriptPath = join(dir, 'fake-agy-panel.mjs')
  const code = `
import { createInterface } from 'node:readline'

const mode = ${JSON.stringify(mode)}
const rl = createInterface({ input: process.stdin })
let mcpUrl = ''
let mcpAuth = ''
let rpcSeq = 100
let promptCount = 0
const pending = new Map()

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\\n')
}

function ask(method, params) {
  const id = rpcSeq++
  send({ jsonrpc: '2.0', id, method, params })
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

async function callMcp(body, authOverride) {
  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authOverride !== null ? { Authorization: authOverride ?? mcpAuth } : {}),
    },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: res.status === 200 ? await res.json() : null }
}

rl.on('line', async (line) => {
  if (!line.trim()) return
  const msg = JSON.parse(line)
  if (msg.id !== undefined && !msg.method) {
    const p = pending.get(msg.id)
    if (p) {
      pending.delete(msg.id)
      if (msg.error) p.reject(msg.error)
      else p.resolve(msg.result)
    }
    return
  }

  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1 } })
    return
  }

  if (msg.method === 'session/new') {
    const servers = msg.params?.mcpServers ?? []
    const panel = servers.find((s) => s.name === '${PANEL_MCP_SERVER_NAME}')
    if (panel) {
      mcpUrl = panel.url
      const hdr = (panel.headers ?? []).find((h) => h.name === 'Authorization')
      mcpAuth = hdr?.value ?? ''
    }
    const tierId = mode === 'metered-tier' ? 'unknown-paygo-tier' : 'g1-ultra-tier'
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        sessionId: 'sess-panel-1',
        _meta: { antigravity: { tier: { id: tierId, name: 'Test Tier' } } },
        configOptions: [
          {
            id: 'model',
            currentValue: 'gemini-3.8-flash',
            options: [{ value: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }],
          },
          { id: 'thought_level', currentValue: 'low' },
        ],
        models: {
          currentModelId: 'gemini-3.8-flash-low',
          availableModels: [
            { modelId: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
            { modelId: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
          ],
        },
      },
    })
    return
  }

  if (msg.method === 'session/set_config_option' || msg.method === 'session/set_model') {
    send({ jsonrpc: '2.0', id: msg.id, result: {} })
    return
  }

  if (msg.method === 'session/close') {
    send({ jsonrpc: '2.0', id: msg.id, result: {} })
    return
  }

  if (msg.method === 'session/prompt') {
    promptCount++
    const blocks = msg.params?.prompt ?? []

    if (mode === 'mcp-roundtrip') {
      // Verify unauthorized Bearer is rejected with 401
      const unauth = await callMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'Bearer wrong')
      if (unauth.status !== 401) throw new Error('Expected 401 for wrong bearer')

      // List tools with valid Bearer
      const list = await callMcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      const names = (list.json?.result?.tools ?? []).map((t) => t.name)

      // Ask permission for allowed panel MCP tool
      const permAllow = await ask('session/request_permission', {
        sessionId: 'sess-panel-1',
        toolCall: { name: 'mcp_${PANEL_MCP_SERVER_NAME}_insert_heading', toolCallId: 'tc-1' },
        options: [
          { optionId: 'allow', kind: 'allow_once' },
          { optionId: 'deny', kind: 'reject_once' },
        ],
      })
      if (permAllow?.outcome?.optionId !== 'allow') {
        throw new Error('Expected allow for panel MCP tool')
      }

      // Ask permission for built-in run_command -> MUST BE DENIED
      const permDenyBuiltin = await ask('session/request_permission', {
        sessionId: 'sess-panel-1',
        toolCall: { name: 'run_command', toolCallId: 'tc-2' },
        options: [
          { optionId: 'allow', kind: 'allow_once' },
          { optionId: 'deny', kind: 'reject_once' },
        ],
      })
      if (permDenyBuiltin?.outcome?.optionId !== 'deny') {
        throw new Error('Expected deny for built-in run_command')
      }

      // Ask permission for unknown MCP server -> MUST BE DENIED
      const permDenyUnknownMcp = await ask('session/request_permission', {
        sessionId: 'sess-panel-1',
        toolCall: { name: 'mcp_evil_server_steal', toolCallId: 'tc-3' },
        options: [
          { optionId: 'allow', kind: 'allow_once' },
          { optionId: 'deny', kind: 'reject_once' },
        ],
      })
      if (permDenyUnknownMcp?.outcome?.optionId !== 'deny') {
        throw new Error('Expected deny for unknown MCP tool')
      }

      // Execute allowed MCP tool over HTTP
      const callRes = await callMcp({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'insert_heading', arguments: { text: 'Hello Doc' } },
      })
      const toolOut = callRes.json?.result?.content?.[0]?.text ?? ''

      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'sess-panel-1',
          update: { sessionUpdate: 'agent_thought_chunk', content: { text: 'thinking...' } },
        },
      })
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'sess-panel-1',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { text: \`Done (tools=\${names.join(',')}; out=\${toolOut})\` },
          },
        },
      })
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
      return
    }

    if (mode === 'unsafe-builtin-complete') {
      // Simulate a compromised/buggy CLI completing read_file without permission
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'sess-panel-1',
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'tc-evil',
            name: 'read_file',
            status: 'in_progress',
          },
        },
      })
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'sess-panel-1',
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'tc-evil',
            status: 'completed',
          },
        },
      })
      return
    }

    if (mode === 'multi-turn') {
      const hasImage = blocks.some((b) => b.type === 'image')
      const textBlock = blocks.find((b) => b.type === 'text')?.text ?? ''
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'sess-panel-1',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { text: \`turn=\${promptCount};img=\${hasImage};text=\${textBlock}\` },
          },
        },
      })
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
      return
    }
  }
})
`
  await writeFile(scriptPath, code, 'utf8')

  const spawns: string[][] = []
  const createdTemps: string[] = []
  const removedTemps: string[] = []

  const spawn: SubscriptionSpawn = ((_cmd: string, args: readonly string[], options: unknown) => {
    spawns.push([...args])
    return nodeSpawn(process.execPath, [scriptPath], options as Parameters<typeof nodeSpawn>[2])
  }) as unknown as SubscriptionSpawn

  const deps: AntigravityPanelDeps = {
    locate: async (): Promise<SubscriptionProgram> => ({
      provider: 'antigravity',
      command: process.execPath,
      prefixArgs: [],
      entry: process.execPath,
      env: {},
      source: 'configured',
    }),
    spawn,
    registry: null,
    createTempDir: async () => {
      const t = await makeTempDir('agy-panel-iso-')
      createdTemps.push(t)
      return t
    },
    removeTempDir: async (d) => {
      removedTemps.push(d)
      await rm(d, { recursive: true, force: true }).catch(() => undefined)
    },
    meteredAccepted: () => false,
    idleMs: 60_000,
  }

  return { scriptPath, deps, spawns, createdTemps, removedTemps }
}

const SAMPLE_TOOLS: AgentToolDef[] = [
  {
    name: 'insert_heading',
    description: 'Insert a heading into the open document',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
]

describe('matchPanelMcpTool', () => {
  const allowed = new Set(['insert_heading', 'read_doc'])

  it('allows only current-turn tools on ieumoffice_panel', () => {
    expect(matchPanelMcpTool('mcp_ieumoffice_panel_insert_heading', allowed)).toBe('insert_heading')
    expect(matchPanelMcpTool('mcp__ieumoffice_panel__read_doc', allowed)).toBe('read_doc')
  })

  it('rejects built-in tools, unlisted panel tools, and other MCP servers', () => {
    expect(matchPanelMcpTool('read_file', allowed)).toBeUndefined()
    expect(matchPanelMcpTool('write_file', allowed)).toBeUndefined()
    expect(matchPanelMcpTool('run_command', allowed)).toBeUndefined()
    expect(matchPanelMcpTool('search_web', allowed)).toBeUndefined()
    expect(matchPanelMcpTool('mcp_ieumoffice_panel_delete_all', allowed)).toBeUndefined()
    expect(matchPanelMcpTool('mcp_other_insert_heading', allowed)).toBeUndefined()
  })
})

describe('streamAntigravityPanel', () => {
  it('bridges editor tools over authenticated loopback HTTP MCP and denies built-in/unknown tools', async () => {
    const fake = await createFakePanelAcpServer('mcp-roundtrip')
    const deltas: string[] = []
    const reasoning: string[] = []
    const executedCalls: AgentToolCall[] = []
    let acpNativeDone = false

    await streamAntigravityPanel(
      { apiKey: '', model: 'gemini-3.8-flash', effort: 'low' },
      'Be helpful.',
      [{ role: 'user', text: 'Add a heading' }],
      SAMPLE_TOOLS,
      {
        sessionId: 'tab-word-1',
        signal: new AbortController().signal,
        onDelta: (t) => deltas.push(t),
        onReasoningDelta: (t) => reasoning.push(t),
        onToolCall: () => undefined,
        onAcpToolCall: async (call) => {
          executedCalls.push(call)
          return { id: call.id, name: call.name, output: `inserted:${String(call.input.text)}` }
        },
        onAcpNativeDone: () => {
          acpNativeDone = true
        },
      },
      fake.deps,
    )

    expect(acpNativeDone).toBe(true)
    expect(reasoning).toEqual(['thinking...'])
    expect(executedCalls).toHaveLength(1)
    expect(executedCalls[0]?.name).toBe('insert_heading')
    expect(executedCalls[0]?.input).toEqual({ text: 'Hello Doc' })
    expect(deltas.join('')).toBe('Done (tools=insert_heading; out=inserted:Hello Doc)')

    // Verify hardened CLI args (no --dangerously-skip-permissions, always --sandbox)
    expect(fake.spawns).toHaveLength(1)
    const args = fake.spawns[0]!
    expect(args).toContain('acp')
    expect(args).toContain('--sandbox')
    expect(args).toContain('--include-default-customizations=false')
    expect(args).not.toContain('--dangerously-skip-permissions')
  })

  it('reuses the live ACP session across follow-up turns and forwards multimodal images', async () => {
    const fake = await createFakePanelAcpServer('multi-turn')
    const deltas1: string[] = []
    const deltas2: string[] = []

    await streamAntigravityPanel(
      { apiKey: '', model: 'gemini-3.8-flash', effort: 'low' },
      'System.',
      [{ role: 'user', text: 'First question' }],
      [],
      {
        sessionId: 'tab-word-reuse',
        signal: new AbortController().signal,
        onDelta: (t) => deltas1.push(t),
        onToolCall: () => undefined,
        onAcpNativeDone: () => undefined,
      },
      fake.deps,
    )

    await streamAntigravityPanel(
      { apiKey: '', model: 'gemini-3.8-flash', effort: 'low' },
      'System.',
      [
        { role: 'user', text: 'First question' },
        { role: 'assistant', text: deltas1.join('') },
        {
          role: 'user',
          text: 'Describe image',
          images: [{ base64: 'AAAA', mime: 'image/png' }],
        },
      ],
      [],
      {
        sessionId: 'tab-word-reuse',
        signal: new AbortController().signal,
        onDelta: (t) => deltas2.push(t),
        onToolCall: () => undefined,
        onAcpNativeDone: () => undefined,
      },
      fake.deps,
    )

    // Only ONE process spawned across both turns!
    expect(fake.spawns).toHaveLength(1)
    expect(deltas1.join('')).toBe('turn=1;img=false;text=First question')
    expect(deltas2.join('')).toBe('turn=2;img=true;text=Describe image')

    await closeAllAntigravityPanelSessions()
    expect(fake.removedTemps).toEqual(fake.createdTemps)
  })

  it('kills the session with unsafe-tools if a non-allowed built-in tool completes via session/update', async () => {
    const fake = await createFakePanelAcpServer('unsafe-builtin-complete')
    const killSpy = vi.fn((child) => {
      try {
        child.kill('SIGKILL')
      } catch {
        // already exited
      }
    })

    await expect(
      streamAntigravityPanel(
        { apiKey: '', model: 'gemini-3.8-flash' },
        'System.',
        [{ role: 'user', text: 'Read secret' }],
        SAMPLE_TOOLS,
        {
          sessionId: 'tab-unsafe',
          signal: new AbortController().signal,
          onDelta: () => undefined,
          onToolCall: () => undefined,
          onAcpToolCall: async (c) => ({ id: c.id, name: c.name, output: 'ok' }),
          onAcpNativeDone: () => undefined,
        },
        { ...fake.deps, killTree: killSpy },
      ),
    ).rejects.toMatchObject({ kind: 'unsafe-tools' })

    expect(killSpy).toHaveBeenCalled()
    expect(fake.removedTemps).toEqual(fake.createdTemps)
  })

  it('blocks unaccepted non-consumer tiers with metered-not-accepted', async () => {
    const fake = await createFakePanelAcpServer('metered-tier')
    let caught: unknown
    try {
      await streamAntigravityPanel(
        { apiKey: '', model: '' },
        'System.',
        [{ role: 'user', text: 'Hi' }],
        [],
        {
          sessionId: 'tab-metered',
          signal: new AbortController().signal,
          onDelta: () => undefined,
          onToolCall: () => undefined,
          onAcpNativeDone: () => undefined,
        },
        fake.deps,
      )
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(AiRunError)
    expect((caught as AiRunError).kind).toBe('metered-not-accepted')
    expect(fake.removedTemps).toEqual(fake.createdTemps)
  })
})
