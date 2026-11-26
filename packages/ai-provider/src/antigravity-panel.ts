/**
 * ACP-native Basic AI Panel runner for Google Antigravity (decision 0170,
 * Phase 2).
 *
 * Runs the unmodified official `agy acp` server as a genuine multi-turn ACP v1
 * client with a per-session loopback HTTP MCP server (`ieumoffice_panel`) that
 * exposes ONLY the active editor's live `AgentToolDef[]` tools.
 *
 * Security invariants:
 * - Isolated per-session `--gemini-dir` + empty `cwd` (no user files on disk)
 *   + `--sandbox` + `--include-default-customizations=false` + `--disable-telemetry`;
 *   `--dangerously-skip-permissions` is never passed.
 * - `antigravity-cli/settings.json` locks `toolPermission: 'request-review'`,
 *   `allowNonWorkspaceAccess: false`, `enableTerminalSandbox: true`.
 * - Every `session/request_permission` allows ONLY allowlisted tools on
 *   `ieumoffice_panel` present in the current turn's `tools` list; every
 *   built-in tool (`read_file`, `write_file`, `edit_file`, `run_command`,
 *   `search_web`, `read_url`, `list_dir`, etc.) and any unknown `mcp_*` tool
 *   is unconditionally denied (`reject_once`).
 * - Defense-in-depth: if `agy` ever reports a non-allowed tool completing
 *   without permission, the process tree is terminated immediately and the turn
 *   fails with `AiRunError('unsafe-tools')`.
 * - Actual tool execution happens inside the editor renderer's `AgentLoop`, so
 *   redaction (`{{label}}`), undo snapshots, yellow change cards, Drive guards,
 *   outbound switches, and User MCP `keepResultsInside` / permission cards stay
 *   100% intact.
 * - `session/new` tier check enforces `metered-not-accepted` for unknown/non-g1
 *   tiers unless explicitly accepted.
 */
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AgentMessage,
  AgentToolCall,
  AgentToolDef,
  AgentToolResult,
} from '@genoffice/agent-core'
import { PRODUCT_NAME } from '@genoffice/i18n'
import {
  ANTIGRAVITY_TEMP_PREFIX,
  AcpRpcRejection,
  antigravityAcpLaunchArgs,
  attachAcpClient,
  isAcpAuthRequiredError,
  parseAntigravityModels,
  parseAntigravityTier,
  type AcpClient,
} from './antigravity-acp'
import { antigravitySessionSettings } from './agent-session/antigravity'
import { aiEffortOf } from './effort'
import type { StreamCallbacks } from './protocols/shared'
import { AiRunError } from './run-error'
import { sharedSubscriptionStatuses } from './subscription/ipc'
import { onSubscriptionLoginChange, onSubscriptionOffChange } from './subscription/launch'
import { resolveSubscriptionProgram, type SubscriptionProgram } from './subscription/locate'
import {
  spawnSubscriptionProgram,
  type SubscriptionChildLike,
  type SubscriptionChildRegistry,
  type SubscriptionSpawn,
} from './subscription/process'
import { createTrackedTempDir, removeTrackedTempDir } from './subscription/temp-dirs'
import type { AiProviderConfig } from './types'

const PROVIDER = 'antigravity' as const
export const PANEL_MCP_SERVER_NAME = 'ieumoffice_panel'
const CLIENT_NAME = PRODUCT_NAME.toLowerCase()
const CLIENT_VERSION = '1.0.0'
const PANEL_REQUEST_TIMEOUT_MS = 30_000
const PANEL_TURN_TIMEOUT_MS = 15 * 60_000
const PANEL_IDLE_MS = 120_000
const MAX_MCP_BODY_BYTES = 16 * 1024 * 1024
const MAX_HISTORY_TEXT_CHARS = 120_000

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * Match an ACP MCP tool name belonging to `ieumoffice_panel` and return the
 * bare editor tool name ONLY when it is in `allowedToolNames`.
 */
export function matchPanelMcpTool(
  rawName: string,
  allowedToolNames: ReadonlySet<string>,
): string | undefined {
  const prefixes = [`mcp_${PANEL_MCP_SERVER_NAME}_`, `mcp__${PANEL_MCP_SERVER_NAME}__`]
  for (const prefix of prefixes) {
    if (rawName.startsWith(prefix)) {
      const bare = rawName.slice(prefix.length)
      if (allowedToolNames.has(bare)) return bare
    }
  }
  return undefined
}

function selectOptionId(
  optionsRaw: unknown,
  allow: boolean,
): { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' } {
  const options = Array.isArray(optionsRaw) ? optionsRaw : []
  const wantKinds = allow ? ['allow_once', 'allow'] : ['reject_once', 'reject']
  for (const kind of wantKinds) {
    const match = options.find((opt) => asRecord(opt)?.kind === kind)
    const id = asRecord(match)?.optionId
    if (typeof id === 'string' && id) return { outcome: 'selected', optionId: id }
  }
  return { outcome: 'cancelled' }
}

function buildPanelSystemAppend(system: string, tools: readonly AgentToolDef[]): string {
  const toolRule =
    tools.length > 0
      ? [
          `You are running inside ${PRODUCT_NAME}'s document AI panel via ACP.`,
          `Use ONLY the MCP tools provided by the "${PANEL_MCP_SERVER_NAME}" server to read or edit the open document and perform requested actions.`,
          'Never attempt to read or write local files on disk, run shell commands, or call built-in filesystem/terminal/web tools — those are disabled in this panel.',
        ].join(' ')
      : [
          `You are running inside ${PRODUCT_NAME}'s document AI panel via ACP with tools disabled for this turn.`,
          'Answer directly in text only. Never attempt to call any tools, read or write files, or run commands.',
        ].join(' ')
  return system.trim() ? `${toolRule}\n\n${system}` : toolRule
}

function formatPriorHistoryPrefix(messages: readonly AgentMessage[]): string {
  if (messages.length <= 1) return ''
  // Everything before the trailing user message is prior conversation context
  const prior = messages.slice(0, -1)
  const lines: string[] = []
  for (const msg of prior) {
    if (msg.role === 'user') {
      if (msg.text.trim()) lines.push(`User: ${msg.text.trim()}`)
    } else if (msg.role === 'assistant') {
      if (msg.text.trim()) lines.push(`Assistant: ${msg.text.trim()}`)
      if (msg.toolCalls?.length) {
        lines.push(`Assistant called tools: ${msg.toolCalls.map((c) => c.name).join(', ')}`)
      }
    } else if (msg.role === 'tool') {
      for (const r of msg.results) {
        const snippet = r.output.length > 1_500 ? `${r.output.slice(0, 1_500)}…` : r.output
        lines.push(`Tool (${r.name}${r.isError ? ', error' : ''}): ${snippet}`)
      }
    }
  }
  if (!lines.length) return ''
  let joined = lines.join('\n\n')
  if (joined.length > MAX_HISTORY_TEXT_CHARS) {
    joined = `…(earlier messages trimmed)\n\n${joined.slice(joined.length - MAX_HISTORY_TEXT_CHARS)}`
  }
  return `<conversation_history>\n${joined}\n</conversation_history>\n\n`
}

function buildPromptBlocks(
  messages: readonly AgentMessage[],
  includeHistory: boolean,
): Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> {
  const blocks: Array<
    { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
  > = []
  const last = messages.at(-1)
  const historyPrefix = includeHistory ? formatPriorHistoryPrefix(messages) : ''
  if (last && last.role === 'user') {
    const text = `${historyPrefix}${last.text}`.trim()
    if (text) blocks.push({ type: 'text', text })
    if (last.images?.length) {
      for (const img of last.images) {
        if (img.base64 && img.mime) {
          blocks.push({ type: 'image', data: img.base64, mimeType: img.mime })
        }
      }
    }
  } else {
    const fallback = historyPrefix.trim() || 'Continue.'
    blocks.push({ type: 'text', text: fallback })
  }
  if (!blocks.length) blocks.push({ type: 'text', text: 'Continue.' })
  return blocks
}

function countUserMessages(messages: readonly AgentMessage[]): number {
  let n = 0
  for (const m of messages) if (m.role === 'user') n++
  return n
}

function sessionSignatureOf(
  config: AiProviderConfig,
  system: string,
  tools: readonly AgentToolDef[],
): string {
  const payload = JSON.stringify({
    cliPath: config.cliPath ?? '',
    model: config.model ?? '',
    effort: config.effort ?? '',
    system,
    tools: tools.map((t) => ({ name: t.name, description: t.description, schema: t.inputSchema })),
  })
  return createHash('sha256').update(payload).digest('hex')
}

// ── Per-session loopback HTTP MCP server ──

interface PanelMcpServer {
  readonly url: string
  readonly token: string
  setTurn(
    tools: readonly AgentToolDef[],
    executor: ((call: AgentToolCall) => Promise<AgentToolResult>) | undefined,
  ): void
  stop(): Promise<void>
}

async function startPanelMcpServer(initialTools: readonly AgentToolDef[]): Promise<PanelMcpServer> {
  const token = randomBytes(24).toString('hex')
  let activeTools: readonly AgentToolDef[] = initialTools
  let activeAllowed: ReadonlySet<string> = new Set(initialTools.map((t) => t.name))
  let activeExecutor: ((call: AgentToolCall) => Promise<AgentToolResult>) | undefined

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== '/mcp') {
      res.writeHead(404).end()
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405).end()
      return
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }

    const chunks: Buffer[] = []
    let size = 0
    let aborted = false
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_MCP_BODY_BYTES) {
        aborted = true
        res.writeHead(413).end()
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (aborted) return
      let msg: { id?: unknown; method?: string; params?: unknown }
      try {
        msg = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          id?: unknown
          method?: string
          params?: unknown
        }
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          }),
        )
        return
      }

      const sendJson = (payload: Record<string, unknown>): void => {
        if (res.writableEnded) return
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(payload))
      }

      const method = msg.method ?? ''
      if (method === 'notifications/initialized' || msg.id === undefined) {
        res.writeHead(202).end()
        return
      }
      if (method === 'initialize') {
        sendJson({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: PANEL_MCP_SERVER_NAME, version: CLIENT_VERSION },
          },
        })
        return
      }
      if (method === 'ping') {
        sendJson({ jsonrpc: '2.0', id: msg.id, result: {} })
        return
      }
      if (method === 'tools/list') {
        sendJson({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            tools: activeTools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          },
        })
        return
      }
      if (method === 'tools/call') {
        const params = asRecord(msg.params)
        const name = typeof params?.name === 'string' ? params.name : ''
        const rawArgs = asRecord(params?.arguments) ?? {}
        if (!name || !activeAllowed.has(name)) {
          sendJson({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              content: [{ type: 'text', text: `Tool "${name}" is not available in this turn.` }],
              isError: true,
            },
          })
          return
        }
        const executor = activeExecutor
        if (!executor) {
          sendJson({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              content: [{ type: 'text', text: 'No active editor turn to execute this tool.' }],
              isError: true,
            },
          })
          return
        }
        const call: AgentToolCall = {
          id: `agy-${randomUUID()}`,
          name,
          input: rawArgs,
        }
        void executor(call)
          .then((result) => {
            sendJson({
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                content: [{ type: 'text', text: result.output }],
                ...(result.isError ? { isError: true } : {}),
              },
            })
          })
          .catch((err: unknown) => {
            const text = err instanceof Error ? err.message : String(err)
            sendJson({
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                content: [{ type: 'text', text }],
                isError: true,
              },
            })
          })
        return
      }
      sendJson({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: `Method not found: ${method}` },
      })
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const addr = server.address()
  if (!addr || typeof addr === 'string') {
    server.close()
    throw new Error('Failed to bind Antigravity panel MCP server')
  }
  return {
    url: `http://127.0.0.1:${addr.port}/mcp`,
    token,
    setTurn(tools, executor) {
      activeTools = tools
      activeAllowed = new Set(tools.map((t) => t.name))
      activeExecutor = executor
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

// ── Pooled persistent ACP panel sessions ──

interface ActiveTurnHooks {
  allowedToolNames: ReadonlySet<string>
  seenTools: Map<string, string>
  onDelta: (text: string) => void
  onReasoningDelta?: ((text: string) => void) | undefined
  onActivity?: (() => void) | undefined
  onUnsafeTool: (toolName: string) => void
}

interface PooledPanelSession {
  readonly key: string
  readonly signature: string
  readonly acpSessionId: string
  readonly client: AcpClient
  readonly mcp?: PanelMcpServer | undefined
  readonly rootTemp: string
  readonly removeTempDir: (dir: string) => Promise<void>
  lastUserMessages: number
  busy: boolean
  closed: boolean
  idleTimer?: ReturnType<typeof setTimeout> | undefined
  activeTurn?: ActiveTurnHooks | undefined
}

const sessionPool = new Map<string, PooledPanelSession>()

async function disposeSession(session: PooledPanelSession, forceKill = false): Promise<void> {
  if (session.closed) return
  session.closed = true
  if (session.idleTimer) {
    clearTimeout(session.idleTimer)
    session.idleTimer = undefined
  }
  if (sessionPool.get(session.key) === session) {
    sessionPool.delete(session.key)
  }
  session.activeTurn = undefined
  session.mcp?.setTurn([], undefined)
  if (!forceKill && session.acpSessionId) {
    await session.client
      .request('session/close', { sessionId: session.acpSessionId }, 2_000)
      .catch(() => undefined)
  }
  if (forceKill) {
    session.client.kill()
  } else {
    await session.client.close().catch(() => undefined)
  }
  await session.mcp?.stop().catch(() => undefined)
  await session.removeTempDir(session.rootTemp).catch(() => undefined)
}

function armSessionIdle(session: PooledPanelSession, idleMs: number): void {
  if (session.idleTimer) {
    clearTimeout(session.idleTimer)
    session.idleTimer = undefined
  }
  if (session.closed || idleMs <= 0) return
  session.idleTimer = setTimeout(() => {
    if (!session.busy) void disposeSession(session)
  }, idleMs)
  session.idleTimer.unref?.()
}

/** End all pooled Antigravity Basic AI Panel sessions (login/logout, off-in-app, shutdown, tests) */
export async function closeAllAntigravityPanelSessions(): Promise<void> {
  const all = [...sessionPool.values()]
  sessionPool.clear()
  await Promise.all(all.map((s) => disposeSession(s, true)))
}

onSubscriptionLoginChange((provider) => {
  if (provider === PROVIDER) void closeAllAntigravityPanelSessions()
})

onSubscriptionOffChange((change) => {
  if (change.provider === PROVIDER) void closeAllAntigravityPanelSessions()
})

export interface AntigravityPanelDeps {
  locate?:
    ((options: { configuredPath?: string | undefined }) => Promise<SubscriptionProgram>) | undefined
  spawn?: SubscriptionSpawn | undefined
  killTree?: ((child: SubscriptionChildLike) => void) | undefined
  registry?: SubscriptionChildRegistry | null | undefined
  baseEnv?: NodeJS.ProcessEnv | undefined
  createTempDir?: (() => Promise<string>) | undefined
  removeTempDir?: ((dir: string) => Promise<void>) | undefined
  meteredAccepted?: (() => boolean) | undefined
  idleMs?: number | undefined
  turnTimeoutMs?: number | undefined
}

async function createPanelSession(
  key: string,
  signature: string,
  config: AiProviderConfig,
  system: string,
  tools: readonly AgentToolDef[],
  deps: AntigravityPanelDeps,
): Promise<PooledPanelSession> {
  const program = await (deps.locate
    ? deps.locate({ configuredPath: config.cliPath })
    : resolveSubscriptionProgram(PROVIDER, { configuredPath: config.cliPath }))

  const removeTempDir = deps.removeTempDir ?? removeTrackedTempDir
  const rootTemp = await (deps.createTempDir
    ? deps.createTempDir()
    : createTrackedTempDir(ANTIGRAVITY_TEMP_PREFIX))
  const workDir = join(rootTemp, 'work')
  const geminiDir = join(rootTemp, 'gemini')
  const cliDir = join(geminiDir, 'antigravity-cli')

  let mcp: PanelMcpServer | undefined
  let client: AcpClient | undefined
  let sessionObjRef: PooledPanelSession | undefined

  try {
    await Promise.all([mkdir(workDir, { recursive: true }), mkdir(cliDir, { recursive: true })])
    await writeFile(
      join(cliDir, 'settings.json'),
      JSON.stringify(antigravitySessionSettings(), null, 2),
      'utf8',
    )

    if (tools.length > 0) {
      mcp = await startPanelMcpServer(tools)
    }

    const args = antigravityAcpLaunchArgs({
      geminiDir,
      processPerSession: true,
      sandbox: true,
    })
    const child = spawnSubscriptionProgram(program, args, {
      cwd: workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      baseEnv: deps.baseEnv,
      spawn: deps.spawn,
      registry: deps.registry,
    }) as ChildProcessWithoutNullStreams

    client = attachAcpClient(
      child,
      {
        onRequest(rpcId, method, params) {
          if (method !== 'session/request_permission') {
            client?.respondError(rpcId, -32601, 'Unsupported client method')
            return
          }
          const rec = asRecord(params)
          const toolCall = asRecord(rec?.toolCall)
          const rawName =
            (typeof toolCall?.name === 'string' && toolCall.name.trim()) ||
            (typeof toolCall?.title === 'string' && toolCall.title.trim()) ||
            ''
          const turn = sessionObjRef?.activeTurn
          const allowed =
            !!turn && !!rawName && matchPanelMcpTool(rawName, turn.allowedToolNames) !== undefined
          client?.respond(rpcId, { outcome: selectOptionId(rec?.options, allowed) })
        },
        onNotification(method, params) {
          if (method !== 'session/update') return
          const turn = sessionObjRef?.activeTurn
          if (!turn) return
          const update = asRecord(asRecord(params)?.update)
          if (!update) return
          const kind = update.sessionUpdate
          if (kind === 'agent_message_chunk') {
            const text = asRecord(update.content)?.text
            if (typeof text === 'string' && text) turn.onDelta(text)
            return
          }
          if (kind === 'agent_thought_chunk') {
            const text = asRecord(update.content)?.text
            if (typeof text === 'string' && text) turn.onReasoningDelta?.(text)
            return
          }
          if (kind === 'tool_call' || kind === 'tool_call_update') {
            turn.onActivity?.()
            const toolCallId = typeof update.toolCallId === 'string' ? update.toolCallId.trim() : ''
            const rawName =
              (typeof update.name === 'string' && update.name.trim()) ||
              (typeof update.title === 'string' && update.title.trim()) ||
              ''
            if (toolCallId && rawName) turn.seenTools.set(toolCallId, rawName)
            const effectiveName =
              rawName || (toolCallId ? (turn.seenTools.get(toolCallId) ?? '') : '')
            const statusRaw = update.status
            // Defense-in-depth: if any non-panel built-in tool actually completes
            // without being blocked, terminate the session immediately.
            if (
              statusRaw === 'completed' &&
              effectiveName &&
              matchPanelMcpTool(effectiveName, turn.allowedToolNames) === undefined
            ) {
              turn.onUnsafeTool(effectiveName)
            }
          }
        },
        onClose() {
          if (sessionObjRef) {
            sessionObjRef.closed = true
            if (sessionPool.get(key) === sessionObjRef) sessionPool.delete(key)
          }
        },
      },
      { killTree: deps.killTree },
    )

    await client.request(
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
      },
      PANEL_REQUEST_TIMEOUT_MS,
    )

    const mcpServers = mcp
      ? [
          {
            type: 'http' as const,
            name: PANEL_MCP_SERVER_NAME,
            url: mcp.url,
            headers: [{ name: 'Authorization', value: `Bearer ${mcp.token}` }],
          },
        ]
      : []

    let sessionRes: unknown
    try {
      sessionRes = await client.request(
        'session/new',
        {
          cwd: workDir,
          mcpServers,
          _meta: {
            antigravity: {
              systemPrompt: { append: buildPanelSystemAppend(system, tools) },
            },
          },
        },
        PANEL_REQUEST_TIMEOUT_MS,
      )
    } catch (error) {
      if (error instanceof AcpRpcRejection && isAcpAuthRequiredError(error.rpcError)) {
        throw new AiRunError('signed-out', 'Antigravity CLI is not signed in', {
          provider: PROVIDER,
        })
      }
      throw error
    }

    const sessionObj = asRecord(sessionRes)
    const acpSessionId = typeof sessionObj?.sessionId === 'string' ? sessionObj.sessionId : ''
    if (!acpSessionId) {
      throw new AiRunError('not-connected', 'Antigravity ACP did not return a session id', {
        provider: PROVIDER,
      })
    }

    const login = parseAntigravityTier(sessionObj?._meta)
    const meteredAccepted = deps.meteredAccepted
      ? deps.meteredAccepted()
      : sharedSubscriptionStatuses().antigravity?.meteredAccepted === true
    if (login.signedIn && login.loginMethod !== 'subscription' && !meteredAccepted) {
      throw new AiRunError(
        'metered-not-accepted',
        'Antigravity login is not a verified subscription plan and metered usage was not accepted',
        { provider: PROVIDER },
      )
    }

    // Apply requested model and effort when configured
    const listedModels = parseAntigravityModels(sessionRes)
    const selectedModel = (config.model ?? '').trim()
    const requestedEffort = aiEffortOf(config.effort)
    if (selectedModel) {
      const groupedEntry = listedModels?.find((m) => m.id === selectedModel)
      if (groupedEntry) {
        await client
          .request(
            'session/set_config_option',
            { sessionId: acpSessionId, configId: 'model', value: selectedModel },
            PANEL_REQUEST_TIMEOUT_MS,
          )
          .catch(() =>
            client!.request(
              'session/set_model',
              { sessionId: acpSessionId, modelId: selectedModel },
              PANEL_REQUEST_TIMEOUT_MS,
            ),
          )
        if (requestedEffort && groupedEntry.efforts?.includes(requestedEffort)) {
          await client
            .request(
              'session/set_config_option',
              { sessionId: acpSessionId, configId: 'thought_level', value: requestedEffort },
              PANEL_REQUEST_TIMEOUT_MS,
            )
            .catch(() => undefined)
        }
      } else {
        await client
          .request(
            'session/set_model',
            { sessionId: acpSessionId, modelId: selectedModel },
            PANEL_REQUEST_TIMEOUT_MS,
          )
          .catch(() => undefined)
      }
    } else if (requestedEffort) {
      await client
        .request(
          'session/set_config_option',
          { sessionId: acpSessionId, configId: 'thought_level', value: requestedEffort },
          PANEL_REQUEST_TIMEOUT_MS,
        )
        .catch(() => undefined)
    }

    const pooled: PooledPanelSession = {
      key,
      signature,
      acpSessionId,
      client,
      mcp,
      rootTemp,
      removeTempDir,
      lastUserMessages: 0,
      busy: false,
      closed: false,
    }
    sessionObjRef = pooled
    return pooled
  } catch (error) {
    client?.kill()
    await mcp?.stop().catch(() => undefined)
    await removeTempDir(rootTemp).catch(() => undefined)
    throw error
  }
}

/**
 * Run one interactive Basic AI Panel turn on Google Antigravity via ACP.
 * Tool calls requested by `agy acp` are executed live in the editor renderer
 * through `cb.onAcpToolCall`, and `cb.onAcpNativeDone` marks the turn complete
 * so `AgentLoop` does not launch a second brain-only round-trip.
 */
export async function streamAntigravityPanel(
  config: AiProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  cb: StreamCallbacks,
  deps: AntigravityPanelDeps = {},
): Promise<void> {
  if (cb.signal.aborted) return
  if (tools.length > 0 && !cb.onAcpToolCall) {
    throw new AiRunError(
      'not-connected',
      'Antigravity runs via ACP and requires an interactive editor MCP bridge for tools',
      { provider: PROVIDER },
    )
  }

  const persistent = Boolean(cb.sessionId)
  const key = cb.sessionId || `ephemeral-${randomUUID()}`
  const signature = sessionSignatureOf(config, system, tools)
  const userCount = countUserMessages(messages)
  const idleMs = deps.idleMs ?? PANEL_IDLE_MS
  const turnTimeoutMs = deps.turnTimeoutMs ?? PANEL_TURN_TIMEOUT_MS

  let session = persistent ? sessionPool.get(key) : undefined
  const reusable =
    !!session &&
    !session.closed &&
    !session.busy &&
    session.signature === signature &&
    userCount === session.lastUserMessages + 1

  if (session && !reusable) {
    await disposeSession(session)
    session = undefined
  }

  const fresh = !session
  if (!session) {
    session = await createPanelSession(key, signature, config, system, tools, deps)
    if (persistent) sessionPool.set(key, session)
  }

  if (cb.signal.aborted) {
    if (!persistent) await disposeSession(session, true)
    else armSessionIdle(session, idleMs)
    return
  }

  if (session.idleTimer) {
    clearTimeout(session.idleTimer)
    session.idleTimer = undefined
  }
  session.busy = true

  let unsafeError: AiRunError | undefined
  const allowedToolNames = new Set(tools.map((t) => t.name))
  const currentSession = session

  session.activeTurn = {
    allowedToolNames,
    seenTools: new Map(),
    onDelta: (text) => {
      if (!cb.signal.aborted && !unsafeError) cb.onDelta(text)
    },
    onReasoningDelta: (text) => {
      if (!cb.signal.aborted && !unsafeError) cb.onReasoningDelta?.(text)
    },
    onActivity: () => cb.onActivity?.(),
    onUnsafeTool: (toolName) => {
      if (unsafeError) return
      unsafeError = new AiRunError(
        'unsafe-tools',
        `Antigravity executed unauthorized built-in tool: ${toolName}`,
        { provider: PROVIDER },
      )
      void disposeSession(currentSession, true)
    },
  }

  session.mcp?.setTurn(tools, cb.onAcpToolCall)

  const onAbort = (): void => {
    currentSession.client.notify('session/cancel', { sessionId: currentSession.acpSessionId })
    void disposeSession(currentSession, true)
  }
  cb.signal.addEventListener('abort', onAbort, { once: true })

  try {
    const prompt = buildPromptBlocks(messages, fresh)
    const promptRes = await session.client.request(
      'session/prompt',
      {
        sessionId: session.acpSessionId,
        prompt,
      },
      turnTimeoutMs,
    )
    if (unsafeError) throw unsafeError
    if (cb.signal.aborted) return

    const stopReason = asRecord(promptRes)?.stopReason
    if (typeof stopReason === 'string' && stopReason) {
      cb.onStopReason?.(stopReason)
    }
    session.lastUserMessages = userCount
    cb.onAcpNativeDone?.()
  } catch (error) {
    if (unsafeError) throw unsafeError
    if (cb.signal.aborted) return
    await disposeSession(session, true)
    if (error instanceof AiRunError) throw error
    if (error instanceof AcpRpcRejection && isAcpAuthRequiredError(error.rpcError)) {
      throw new AiRunError('signed-out', 'Antigravity sign-in expired', { provider: PROVIDER })
    }
    const msg = error instanceof Error ? error.message : String(error)
    if (/rate.?limit|quota|429|resource_exhausted/i.test(msg)) {
      throw new AiRunError('rate-limit', msg, { provider: PROVIDER })
    }
    throw error
  } finally {
    cb.signal.removeEventListener('abort', onAbort)
    session.activeTurn = undefined
    session.mcp?.setTurn([], undefined)
    session.busy = false
    if (!persistent || session.closed) {
      await disposeSession(session, session.closed)
    } else {
      armSessionIdle(session, idleMs)
    }
  }
}
