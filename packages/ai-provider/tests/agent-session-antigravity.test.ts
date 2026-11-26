/**
 * Antigravity Agent Mode runner tests (decision 0170, extending decision 0032).
 *
 * Uses a fake Node ACP stdio server to exercise:
 * - isolated `--gemini-dir/antigravity-cli/settings.json` creation;
 * - HTTP MCP server registration with Bearer tokens and systemPrompt append;
 * - tier enforcement (`metered-not-accepted`, `signed-out`);
 * - `agentPolicyVerdict` mediation on `session/request_permission` (auto-allow
 *   app MCP tools, auto-deny unauthorized MCP / protected paths / open documents,
 *   user prompt for `run_command`);
 * - streaming text/tool events and clean `stop()`.
 */
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  antigravityAgentAction,
  antigravityAgentMcpServers,
  antigravitySessionSettings,
  isAntigravityAppMcpTool,
  startAntigravityAgentSession,
  type AgentMcpRelay,
  type AgentSessionEvent,
} from '../src/agent-session'
import { AiRunError } from '../src/run-error'
import type { SubscriptionProgram } from '../src/subscription/locate'

const tempDirs: string[] = []

async function makeTempDir(prefix = 'agy-agent-test-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
})

describe('antigravityAgentAction and MCP allowlist helpers', () => {
  const relays: AgentMcpRelay[] = [
    { name: 'notion', url: 'http://127.0.0.1:4100/mcp', token: 'tok-n', tools: ['search'] },
  ]

  it('recognizes allowlisted app MCP tools across underscore and hyphen naming', () => {
    expect(isAntigravityAppMcpTool('mcp_ieumoffice-editor_open_documents')).toBe(true)
    expect(isAntigravityAppMcpTool('mcp_ieumoffice_editor_insert_content')).toBe(true)
    expect(isAntigravityAppMcpTool('mcp__ieumoffice-editor__apply_ops')).toBe(true)
    expect(isAntigravityAppMcpTool('mcp_ieumoffice_editor_not_in_allowlist')).toBe(false)
    expect(isAntigravityAppMcpTool('mcp_other_open_documents')).toBe(false)
  })

  it('classifies app MCP, relayed MCP, unauthorized MCP, file ops, commands, and web tools', () => {
    expect(
      antigravityAgentAction({ name: 'mcp_ieumoffice_editor_open_documents' }, relays, 'win32'),
    ).toEqual({
      kind: 'app-tool',
      tool: 'mcp_ieumoffice_editor_open_documents',
      paths: [],
    })

    expect(antigravityAgentAction({ name: 'mcp_notion_search' }, relays, 'win32')).toEqual({
      kind: 'app-tool',
      tool: 'mcp_notion_search',
      server: 'notion',
      paths: [],
    })

    expect(antigravityAgentAction({ name: 'mcp_rogue_exec' }, relays, 'win32')).toEqual({
      kind: 'other',
      tool: 'mcp_rogue_exec',
      paths: [],
      unauthorizedMcp: true,
    })

    expect(
      antigravityAgentAction(
        {
          name: 'read_file',
          kind: 'read',
          locations: [{ path: '/C:/Users/me/.gemini/settings.json' }],
        },
        relays,
        'win32',
      ),
    ).toEqual({
      kind: 'read',
      tool: 'read_file',
      paths: ['C:/Users/me/.gemini/settings.json'],
    })

    expect(
      antigravityAgentAction(
        {
          name: 'write_file',
          kind: 'edit',
          rawInput: { Path: '/C:/proj/report.docx' },
        },
        relays,
        'win32',
      ),
    ).toEqual({
      kind: 'write',
      tool: 'write_file',
      paths: ['C:/proj/report.docx'],
    })

    expect(
      antigravityAgentAction(
        {
          name: 'run_command',
          kind: 'execute',
          rawInput: { CommandLine: 'echo hi', Cwd: '/C:/proj' },
        },
        relays,
        'win32',
      ),
    ).toEqual({
      kind: 'command',
      tool: 'run_command',
      command: 'echo hi',
      cwd: 'C:/proj',
      paths: ['C:/proj'],
    })

    expect(
      antigravityAgentAction(
        { name: 'read_url', kind: 'fetch', rawInput: { url: 'https://example.com/a' } },
        relays,
        'win32',
      ),
    ).toEqual({
      kind: 'web-fetch',
      tool: 'read_url',
      target: 'https://example.com/a',
      host: 'example.com',
      paths: [],
    })
  })

  it('builds HTTP mcpServers with Bearer headers and secure session settings', () => {
    const servers = antigravityAgentMcpServers(
      { url: 'http://127.0.0.1:4000/mcp', token: 'app-tok' },
      relays,
    )
    expect(servers).toEqual([
      {
        type: 'http',
        name: 'ieumoffice-editor',
        url: 'http://127.0.0.1:4000/mcp',
        headers: [{ name: 'Authorization', value: 'Bearer app-tok' }],
      },
      {
        type: 'http',
        name: 'notion',
        url: 'http://127.0.0.1:4100/mcp',
        headers: [{ name: 'Authorization', value: 'Bearer tok-n' }],
      },
    ])

    expect(antigravitySessionSettings()).toMatchObject({
      toolPermission: 'request-review',
      allowNonWorkspaceAccess: false,
      enableTerminalSandbox: true,
    })
  })
})

/**
 * Fake Node ACP agent server that replays permission checks and streaming updates.
 */
async function makeFakeAgentAcp(config: {
  tierId?: string | null
  authRequired?: boolean
  permissionScenario?: Array<{
    toolCall: Record<string, unknown>
    expectOutcome: 'allow' | 'deny'
  }>
}): Promise<{ program: SubscriptionProgram; recordFile: string }> {
  const dir = await makeTempDir('agy-fake-agent-')
  const scriptPath = join(dir, 'fake-agent-acp.mjs')
  const recordFile = join(dir, 'record.jsonl')
  const source = `
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const cfg = ${JSON.stringify(config)}
const recordFile = ${JSON.stringify(recordFile)}
const record = (entry) => appendFileSync(recordFile, JSON.stringify(entry) + '\\n', 'utf8')
const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n')

let nextServerId = 100
const pendingClient = new Map()
const askPermission = (toolCall) =>
  new Promise((resolve) => {
    const id = nextServerId++
    pendingClient.set(id, resolve)
    send({
      jsonrpc: '2.0',
      id,
      method: 'session/request_permission',
      params: {
        sessionId: 'sess-agent-1',
        toolCall,
        options: [
          { optionId: 'allow', kind: 'allow_once', name: 'Allow' },
          { optionId: 'deny', kind: 'reject_once', name: 'Deny' },
        ],
      },
    })
  })

record({ event: 'spawn', argv: process.argv.slice(2) })

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', async (line) => {
  if (!line.trim()) return
  const msg = JSON.parse(line)
  if (msg.id !== undefined && msg.method === undefined) {
    const resolver = pendingClient.get(msg.id)
    if (resolver) {
      pendingClient.delete(msg.id)
      resolver(msg.result)
    }
    return
  }
  record({ method: msg.method, params: msg.params })
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: true } } },
    })
    return
  }
  if (msg.method === 'session/new') {
    if (cfg.authRequired) {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'Authentication required' } })
      return
    }
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        sessionId: 'sess-agent-1',
        ...(cfg.tierId ? { _meta: { antigravity: { tier: { id: cfg.tierId } } } } : {}),
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
          availableModels: [{ modelId: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' }],
        },
      },
    })
    return
  }
  if (msg.method === 'session/set_config_option' || msg.method === 'session/set_model' || msg.method === 'session/close') {
    send({ jsonrpc: '2.0', id: msg.id, result: {} })
    return
  }
  if (msg.method === 'session/prompt') {
    for (const step of cfg.permissionScenario ?? []) {
      const answer = await askPermission(step.toolCall)
      record({ permissionAnswer: step.toolCall.name, answer })
    }
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess-agent-1',
        update: {
          sessionUpdate: 'tool_call',
          name: 'mcp_ieumoffice_editor_open_documents',
          status: 'in_progress',
        },
      },
    })
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess-agent-1',
        update: {
          sessionUpdate: 'tool_call_update',
          name: 'mcp_ieumoffice_editor_open_documents',
          status: 'completed',
        },
      },
    })
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess-agent-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Done via Antigravity ACP.' },
        },
      },
    })
    send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
    return
  }
})
`
  await writeFile(scriptPath, source, 'utf8')
  return {
    program: {
      provider: 'antigravity',
      command: process.execPath,
      prefixArgs: [scriptPath],
      env: {},
      entry: scriptPath,
      source: 'configured',
    },
    recordFile,
  }
}

describe('startAntigravityAgentSession', () => {
  it('enforces metered-not-accepted and signed-out on startup', async () => {
    const projectRoot = await makeTempDir('agy-proj-')
    const sessionDir = await makeTempDir('agy-sess-')

    const unknownTier = await makeFakeAgentAcp({ tierId: null })
    await expect(
      startAntigravityAgentSession(
        {
          projectRoot,
          sessionDir,
          mode: 'ask-commands',
          model: '',
          instructions: '',
          openDocuments: [],
          protectedPaths: [],
          meteredAccepted: false,
        },
        () => undefined,
        { locate: async () => unknownTier.program, registry: null },
      ),
    ).rejects.toMatchObject({ kind: 'metered-not-accepted', provider: 'antigravity' })

    const signedOut = await makeFakeAgentAcp({ authRequired: true })
    await expect(
      startAntigravityAgentSession(
        {
          projectRoot,
          sessionDir,
          mode: 'ask-commands',
          model: '',
          instructions: '',
          openDocuments: [],
          protectedPaths: [],
        },
        () => undefined,
        { locate: async () => signedOut.program, registry: null },
      ),
    ).rejects.toBeInstanceOf(AiRunError)
  })

  it('writes isolated settings, mediates permissions via agentPolicyVerdict, streams updates, and stops cleanly', async () => {
    const projectRoot = await makeTempDir('agy-proj-')
    const sessionDir = await makeTempDir('agy-sess-')
    const protectedGemini = join(projectRoot, '..', '.gemini')
    const openDoc = join(projectRoot, 'open.docx')

    const { program, recordFile } = await makeFakeAgentAcp({
      tierId: 'g1-ultra-lite-tier',
      permissionScenario: [
        // 1. Allowlisted app MCP tool -> auto-allowed
        { toolCall: { name: 'mcp_ieumoffice_editor_open_documents' }, expectOutcome: 'allow' },
        // 2. Unauthorized MCP tool -> auto-denied
        { toolCall: { name: 'mcp_rogue_exec' }, expectOutcome: 'deny' },
        // 3. Read protected ~/.gemini path -> auto-denied
        {
          toolCall: {
            name: 'read_file',
            kind: 'read',
            locations: [{ path: join(protectedGemini, 'settings.json') }],
          },
          expectOutcome: 'deny',
        },
        // 4. Write open document on disk -> auto-denied
        {
          toolCall: { name: 'write_file', kind: 'edit', rawInput: { Path: openDoc } },
          expectOutcome: 'deny',
        },
        // 5. Command in ask-commands -> asks user, user allows
        {
          toolCall: {
            name: 'run_command',
            kind: 'execute',
            rawInput: { CommandLine: 'dir', Cwd: projectRoot },
          },
          expectOutcome: 'allow',
        },
      ],
    })

    const events: AgentSessionEvent[] = []
    const holder: { session?: Awaited<ReturnType<typeof startAntigravityAgentSession>> } = {}
    const session = await startAntigravityAgentSession(
      {
        projectRoot,
        sessionDir,
        mode: 'ask-commands',
        model: 'gemini-3.8-flash',
        effort: 'low',
        instructions: 'Use Korean.',
        openDocuments: [openDoc],
        protectedPaths: [protectedGemini],
        appMcp: { url: 'http://127.0.0.1:4242/mcp', token: 'app-secret' },
      },
      (event) => {
        events.push(event)
        if (event.type === 'permission') {
          holder.session?.answer(event.request.id, { allow: true })
        }
      },
      { locate: async () => program, registry: null },
    )
    holder.session = session

    // Isolated settings.json exists under sessionDir
    const writtenSettings = JSON.parse(
      await readFile(
        join(sessionDir, 'antigravity-gemini', 'antigravity-cli', 'settings.json'),
        'utf8',
      ),
    ) as Record<string, unknown>
    expect(writtenSettings.toolPermission).toBe('request-review')
    expect(writtenSettings.enableTerminalSandbox).toBe(true)

    await session.send('Check open documents')
    session.stop()

    const records = (await readFile(recordFile, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    const spawnRecord = records.find((r) => r.event === 'spawn')
    expect(spawnRecord?.argv).toContain('--sandbox')
    expect(spawnRecord?.argv).toContain('--process-per-session')
    expect(spawnRecord?.argv).toContain('--include-default-customizations=false')
    expect(spawnRecord?.argv).not.toContain('--dangerously-skip-permissions')

    const sessionNewRecord = records.find((r) => r.method === 'session/new')
    const sessionNewParams = sessionNewRecord?.params as Record<string, unknown>
    expect(sessionNewParams.mcpServers).toEqual([
      {
        type: 'http',
        name: 'ieumoffice-editor',
        url: 'http://127.0.0.1:4242/mcp',
        headers: [{ name: 'Authorization', value: 'Bearer app-secret' }],
      },
    ])
    expect(sessionNewParams._meta).toEqual({
      antigravity: { systemPrompt: { append: 'Use Korean.' } },
    })

    const answers = records
      .filter((r) => 'permissionAnswer' in r)
      .map((r) => [
        r.permissionAnswer,
        (r.answer as { outcome?: { optionId?: string } })?.outcome?.optionId,
      ])
    expect(answers).toEqual([
      ['mcp_ieumoffice_editor_open_documents', 'allow'],
      ['mcp_rogue_exec', 'deny'],
      ['read_file', 'deny'],
      ['write_file', 'deny'],
      ['run_command', 'allow'],
    ])

    // Only run_command asked the user
    const prompted = events.filter((e) => e.type === 'permission')
    expect(prompted).toHaveLength(1)
    expect(prompted[0]!.type === 'permission' && prompted[0]!.request.tool).toBe('run_command')

    // Text, tool updates, turn-done, and ended were emitted
    expect(events.some((e) => e.type === 'text' && e.text === 'Done via Antigravity ACP.')).toBe(
      true,
    )
    expect(events.some((e) => e.type === 'turn-done' && e.ok)).toBe(true)
    expect(events.some((e) => e.type === 'ended')).toBe(true)
  })
})
