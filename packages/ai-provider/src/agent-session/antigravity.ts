/**
 * Agent mode on Google Antigravity (decision 0170, extending decision 0032):
 * runs the official unmodified `agy acp` server as an ACP v1 stdio client in
 * the user's project folder, with `--sandbox`, `--process-per-session`, and an
 * isolated `--gemini-dir` so user settings, hooks, plugins, and unrelated MCP
 * servers under `~/.gemini` never enter the session while the OS keyring login
 * is reused without touching credential files.
 *
 * Open-document tools and relayed user MCP servers travel as standard ACP HTTP
 * `mcpServers` with per-session Bearer tokens, and every permission request is
 * evaluated by `agentPolicyVerdict` before allowing, denying, or prompting the
 * user. `--dangerously-skip-permissions` is never passed.
 */
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  AcpRpcRejection,
  antigravityAcpLaunchArgs,
  attachAcpClient,
  isAcpAuthRequiredError,
  parseAntigravityModels,
  parseAntigravityTier,
  type AcpClient,
} from '../antigravity-acp'
import { aiEffortOf } from '../effort'
import { AiRunError } from '../run-error'
import { resolveSubscriptionProgram, type SubscriptionProgram } from '../subscription/locate'
import {
  spawnSubscriptionProgram,
  type SubscriptionChildLike,
  type SubscriptionChildRegistry,
  type SubscriptionSpawn,
} from '../subscription/process'
import { AGENT_APP_MCP_TOOLS, APP_MCP_SERVER_NAME, agentUsableRelays } from './claude'
import { agentPolicyVerdict, webHostOf } from './policy'
import { AgentProgramError } from './program-problem'
import type {
  AgentAction,
  AgentMcpRelay,
  AgentPermissionAnswer,
  AgentSession,
  AgentSessionAllowances,
  AgentSessionEvent,
  AgentSessionOptions,
} from './types'

const PROVIDER = 'antigravity' as const
const REQUEST_TIMEOUT_MS = 30_000
const TURN_TIMEOUT_MS = 30 * 60_000
const DEFAULT_IDLE_MS = 30 * 60_000

const APP_MCP_TOOL_SET: ReadonlySet<string> = new Set(AGENT_APP_MCP_TOOLS)

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringField(record: Record<string, unknown> | undefined, keys: readonly string[]): string {
  if (!record) return ''
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function normalizeWindowsAcpPath(raw: string, platform: NodeJS.Platform): string {
  // ACP locations on Windows occasionally arrive with a leading slash: `/C:/...`
  if (platform === 'win32' && /^\/[A-Za-z]:[\\/]/.test(raw)) return raw.slice(1)
  return raw
}

/**
 * Match an Antigravity ACP MCP tool name (`mcp_<server>_<tool>` or
 * `mcp__<server>__<tool>`, allowing `-` → `_` normalization in server names).
 */
function matchMcpToolPrefix(name: string, serverName: string): string | undefined {
  const normalized = serverName.replace(/-/g, '_')
  const prefixes = [
    `mcp_${serverName}_`,
    ...(normalized !== serverName ? [`mcp_${normalized}_`] : []),
    `mcp__${serverName}__`,
  ]
  for (const prefix of prefixes) {
    if (name.startsWith(prefix)) return name.slice(prefix.length)
  }
  return undefined
}

/** Whether `name` is one of the allowed tools on the app's own MCP server */
export function isAntigravityAppMcpTool(name: string): boolean {
  const bare = matchMcpToolPrefix(name, APP_MCP_SERVER_NAME)
  return bare !== undefined && APP_MCP_TOOL_SET.has(bare)
}

/** Match an allowed tool on one of this session's user MCP relays */
export function antigravityRelayToolOf(
  name: string,
  relays: readonly AgentMcpRelay[] | undefined,
): { relay: AgentMcpRelay; tool: string } | undefined {
  for (const relay of agentUsableRelays(relays)) {
    const bare = matchMcpToolPrefix(name, relay.name)
    if (bare !== undefined && relay.tools.includes(bare)) {
      return { relay, tool: bare }
    }
  }
  return undefined
}

function extractPaths(
  toolCall: Record<string, unknown>,
  rawInput: Record<string, unknown> | undefined,
  platform: NodeJS.Platform,
): string[] {
  const out: string[] = []
  const add = (value: unknown): void => {
    if (typeof value !== 'string') return
    const trimmed = normalizeWindowsAcpPath(value.trim(), platform)
    if (trimmed && !out.includes(trimmed)) out.push(trimmed)
  }
  if (Array.isArray(toolCall.locations)) {
    for (const loc of toolCall.locations) add(asRecord(loc)?.path)
  }
  if (rawInput) {
    for (const key of [
      'Path',
      'path',
      'TargetFile',
      'target_file',
      'FilePath',
      'file_path',
      'DirectoryPath',
      'SearchPath',
      'Cwd',
      'cwd',
    ]) {
      add(rawInput[key])
    }
    if (Array.isArray(rawInput.filePaths)) {
      for (const p of rawInput.filePaths) add(p)
    }
  }
  return out
}

/**
 * Translate an ACP `toolCall` (from `session/request_permission` or
 * `session/update`) into the app's `AgentAction` shape for policy evaluation
 * and UI display.
 */
export function antigravityAgentAction(
  toolCallRaw: unknown,
  relays: readonly AgentMcpRelay[] | undefined,
  platform: NodeJS.Platform = process.platform,
): AgentAction & { unauthorizedMcp?: true | undefined } {
  const toolCall = asRecord(toolCallRaw) ?? {}
  const name = typeof toolCall.name === 'string' ? toolCall.name.trim() : ''
  const acpKind = typeof toolCall.kind === 'string' ? toolCall.kind.trim().toLowerCase() : ''
  const title = typeof toolCall.title === 'string' ? toolCall.title.trim() : ''
  const rawInput = asRecord(toolCall.rawInput) ?? asRecord(toolCall.args)
  const paths = extractPaths(toolCall, rawInput, platform)

  if (name && isAntigravityAppMcpTool(name)) {
    return { kind: 'app-tool', tool: name, paths }
  }
  if (name) {
    const relayHit = antigravityRelayToolOf(name, relays)
    if (relayHit) {
      return { kind: 'app-tool', tool: name, server: relayHit.relay.name, paths }
    }
    if (name.startsWith('mcp_') || name.startsWith('mcp__')) {
      // Unrecognized MCP tool not opened by this session: refuse unconditionally
      return { kind: 'other', tool: name, paths, unauthorizedMcp: true }
    }
  }

  const lower = name.toLowerCase()
  if (acpKind === 'execute' || lower === 'run_command' || lower === 'command_execution') {
    const command = stringField(rawInput, ['CommandLine', 'command', 'cmd']) || title
    const cwd = stringField(rawInput, ['Cwd', 'cwd'])
    const summary = stringField(rawInput, ['toolSummary'])
    return {
      kind: 'command',
      tool: name || 'run_command',
      ...(command ? { command } : {}),
      ...(summary ? { summary } : {}),
      ...(cwd ? { cwd: normalizeWindowsAcpPath(cwd, platform) } : {}),
      paths,
    }
  }

  if (
    acpKind === 'edit' ||
    acpKind === 'delete' ||
    acpKind === 'move' ||
    lower.includes('write') ||
    lower.includes('edit') ||
    lower.includes('replace') ||
    lower.includes('delete')
  ) {
    return { kind: 'write', tool: name || 'write_file', paths }
  }

  if (
    acpKind === 'read' ||
    acpKind === 'search' ||
    lower === 'read_file' ||
    lower === 'view_file' ||
    lower === 'list_dir' ||
    lower === 'find_by_name' ||
    lower === 'grep_search'
  ) {
    return { kind: 'read', tool: name || 'read_file', paths }
  }

  if (lower.includes('search_web') || lower === 'web_search') {
    const query = stringField(rawInput, ['query', 'Query']) || title
    return {
      kind: 'web-search',
      tool: name || 'search_web',
      ...(query ? { target: query } : {}),
      paths: [],
    }
  }

  if (
    acpKind === 'fetch' ||
    lower.includes('read_url') ||
    lower.includes('web_fetch') ||
    lower.includes('url')
  ) {
    const url = stringField(rawInput, ['url', 'Url', 'URL']) || title
    const host = webHostOf(url)
    return {
      kind: 'web-fetch',
      tool: name || 'read_url',
      ...(url ? { target: url } : {}),
      ...(host ? { host } : {}),
      paths: [],
    }
  }

  return { kind: 'other', tool: name || title || 'tool', paths }
}

/** ACP `mcpServers` entries for the app server and session relays */
export function antigravityAgentMcpServers(
  appMcp: AgentSessionOptions['appMcp'],
  relays: readonly AgentMcpRelay[] | undefined,
): Array<{
  type: 'http'
  name: string
  url: string
  headers: Array<{ name: string; value: string }>
}> {
  const servers: Array<{
    type: 'http'
    name: string
    url: string
    headers: Array<{ name: string; value: string }>
  }> = []
  if (appMcp) {
    servers.push({
      type: 'http',
      name: APP_MCP_SERVER_NAME,
      url: appMcp.url,
      headers: [{ name: 'Authorization', value: `Bearer ${appMcp.token}` }],
    })
  }
  for (const relay of agentUsableRelays(relays)) {
    servers.push({
      type: 'http',
      name: relay.name,
      url: relay.url,
      headers: [{ name: 'Authorization', value: `Bearer ${relay.token}` }],
    })
  }
  return servers
}

/**
 * Isolated `settings.json` written inside the session's private `--gemini-dir`
 * so user settings never leak and default execution stays in `request-review`
 * with terminal sandboxing on and non-workspace access disabled.
 */
export function antigravitySessionSettings(): Record<string, unknown> {
  return {
    agentMode: '',
    toolPermission: 'request-review',
    allowNonWorkspaceAccess: false,
    enableTerminalSandbox: true,
    notifications: false,
    showTips: false,
    showFeedbackSurvey: false,
  }
}

export interface AntigravityAgentSessionOptions extends AgentSessionOptions {
  /** whether the user explicitly accepted a metered/unknown login */
  meteredAccepted?: boolean | undefined
}

export interface AntigravityAgentDeps {
  locate?:
    ((options: { configuredPath?: string | undefined }) => Promise<SubscriptionProgram>) | undefined
  spawn?: SubscriptionSpawn | undefined
  killTree?: ((child: SubscriptionChildLike) => void) | undefined
  registry?: SubscriptionChildRegistry | null | undefined
  baseEnv?: NodeJS.ProcessEnv | undefined
  platform?: NodeJS.Platform | undefined
  idleMs?: number | undefined
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

/**
 * Start an Antigravity agent session in `options.projectRoot` using `agy acp`.
 * Resolves once `initialize` and `session/new` have succeeded and the login
 * tier has been checked against `meteredAccepted`.
 */
export async function startAntigravityAgentSession(
  options: AntigravityAgentSessionOptions,
  onEvent: (event: AgentSessionEvent) => void,
  deps: AntigravityAgentDeps = {},
): Promise<AgentSession> {
  const platform = deps.platform ?? process.platform
  const program = await (deps.locate
    ? deps.locate({ configuredPath: options.cliPath })
    : resolveSubscriptionProgram(PROVIDER, { configuredPath: options.cliPath }))

  const geminiDir = join(options.sessionDir, 'antigravity-gemini')
  const cliDir = join(geminiDir, 'antigravity-cli')
  await mkdir(cliDir, { recursive: true })
  await writeFile(
    join(cliDir, 'settings.json'),
    JSON.stringify(antigravitySessionSettings(), null, 2),
    'utf8',
  )

  const usableRelays = agentUsableRelays(options.userMcpRelays)
  const openDocuments = new Set(options.openDocuments)
  const allowances: AgentSessionAllowances & { webHosts: Set<string> } = {
    webSearch: false,
    webHosts: new Set<string>(),
  }
  const pendingPermissions = new Map<
    string,
    {
      rpcId: unknown
      optionsRaw: unknown
      action: AgentAction
    }
  >()

  let stopped = false
  let endedEmitted = false
  let sessionId = ''
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const idleMs = deps.idleMs ?? DEFAULT_IDLE_MS

  const emitEnded = (): void => {
    if (endedEmitted) return
    endedEmitted = true
    onEvent({ type: 'ended' })
  }

  const clearIdle = (): void => {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = undefined
    }
  }

  const args = antigravityAcpLaunchArgs({
    geminiDir,
    processPerSession: true,
    sandbox: true,
  })
  const child = spawnSubscriptionProgram(program, args, {
    cwd: options.projectRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    baseEnv: deps.baseEnv,
    spawn: deps.spawn,
    registry: deps.registry,
  }) as ChildProcessWithoutNullStreams

  let turnRunning = false

  const client: AcpClient = attachAcpClient(
    child,
    {
      onRequest(rpcId, method, params) {
        if (method !== 'session/request_permission') {
          client.respondError(rpcId, -32601, 'Unsupported client method')
          return
        }
        const rec = asRecord(params)
        const action = antigravityAgentAction(rec?.toolCall, usableRelays, platform)
        if (action.unauthorizedMcp) {
          onEvent({ type: 'tool', action, status: 'denied' })
          client.respond(rpcId, { outcome: selectOptionId(rec?.options, false) })
          return
        }
        const verdict = agentPolicyVerdict(action, {
          mode: options.mode,
          projectRoot: options.projectRoot,
          openDocuments: [...openDocuments],
          protectedPaths: options.protectedPaths,
          skillBundleDir: options.skillBundleDir,
          allowances,
          platform,
        })
        if (verdict.decision === 'allow') {
          client.respond(rpcId, { outcome: selectOptionId(rec?.options, true) })
          return
        }
        if (verdict.decision === 'deny') {
          onEvent({ type: 'tool', action, status: 'denied' })
          client.respond(rpcId, { outcome: selectOptionId(rec?.options, false) })
          return
        }
        const requestId = randomUUID()
        pendingPermissions.set(requestId, { rpcId, optionsRaw: rec?.options, action })
        onEvent({
          type: 'permission',
          request: {
            ...action,
            id: requestId,
            provider: PROVIDER,
          },
        })
      },
      onNotification(method, params) {
        if (method !== 'session/update') return
        const update = asRecord(asRecord(params)?.update)
        if (!update) return
        const kind = update.sessionUpdate
        if (kind === 'agent_message_chunk') {
          const text = asRecord(update.content)?.text
          if (typeof text === 'string' && text) onEvent({ type: 'text', text })
          return
        }
        if (kind === 'tool_call' || kind === 'tool_call_update') {
          const statusRaw = update.status
          const action = antigravityAgentAction(update, usableRelays, platform)
          if (statusRaw === 'in_progress') {
            onEvent({ type: 'tool', action, status: 'running' })
          } else if (statusRaw === 'completed') {
            onEvent({ type: 'tool', action, status: 'done' })
          } else if (statusRaw === 'failed') {
            onEvent({ type: 'tool', action, status: 'failed' })
          }
        }
      },
      onClose() {
        clearIdle()
        if (!stopped && turnRunning) {
          onEvent({ type: 'turn-done', ok: false })
        }
        emitEnded()
      },
    },
    { killTree: deps.killTree },
  )

  const stopSession = (): void => {
    if (stopped) return
    stopped = true
    clearIdle()
    for (const entry of pendingPermissions.values()) {
      client.respond(entry.rpcId, { outcome: { outcome: 'cancelled' } })
    }
    pendingPermissions.clear()
    if (sessionId) {
      void client.request('session/close', { sessionId }, 2_000).catch(() => undefined)
    }
    client.kill()
    emitEnded()
  }

  const armIdle = (): void => {
    clearIdle()
    if (stopped || idleMs <= 0) return
    idleTimer = setTimeout(() => stopSession(), idleMs)
    idleTimer.unref?.()
  }

  try {
    await client.request(
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'ieumoffice', version: '1.0.0' },
      },
      REQUEST_TIMEOUT_MS,
    )

    const mcpServers = antigravityAgentMcpServers(options.appMcp, usableRelays)
    const sessionNewParams: Record<string, unknown> = {
      cwd: options.projectRoot,
      mcpServers,
      ...(options.instructions
        ? { _meta: { antigravity: { systemPrompt: { append: options.instructions } } } }
        : {}),
    }

    let sessionRes: unknown
    try {
      sessionRes = await client.request('session/new', sessionNewParams, REQUEST_TIMEOUT_MS)
    } catch (error) {
      if (error instanceof AcpRpcRejection && isAcpAuthRequiredError(error.rpcError)) {
        throw new AiRunError('signed-out', 'Antigravity CLI is not signed in', {
          provider: PROVIDER,
        })
      }
      throw error
    }

    const sessionObj = asRecord(sessionRes)
    sessionId = typeof sessionObj?.sessionId === 'string' ? sessionObj.sessionId : ''
    if (!sessionId) {
      throw new AgentProgramError(
        { type: 'refused', step: 'session/new' },
        'Antigravity ACP did not return a session id',
      )
    }

    // Verify subscription vs metered before accepting any user message
    const login = parseAntigravityTier(sessionObj?._meta)
    if (login.signedIn && login.loginMethod !== 'subscription' && !options.meteredAccepted) {
      throw new AiRunError(
        'metered-not-accepted',
        'Antigravity login is not a verified subscription plan and metered usage was not accepted',
        { provider: PROVIDER },
      )
    }

    // Apply requested model and effort when configured and supported
    const listedModels = parseAntigravityModels(sessionRes)
    const selectedModel = options.model.trim()
    const requestedEffort = aiEffortOf(options.effort)
    let activeModel: string | undefined =
      typeof asRecord(sessionObj?.models)?.currentModelId === 'string'
        ? (asRecord(sessionObj?.models)!.currentModelId as string)
        : undefined

    if (selectedModel) {
      const groupedEntry = listedModels?.find((m) => m.id === selectedModel)
      if (groupedEntry) {
        await client
          .request(
            'session/set_config_option',
            { sessionId, configId: 'model', value: selectedModel },
            REQUEST_TIMEOUT_MS,
          )
          .catch(() =>
            client!.request(
              'session/set_model',
              { sessionId, modelId: selectedModel },
              REQUEST_TIMEOUT_MS,
            ),
          )
        activeModel = selectedModel
        if (requestedEffort && groupedEntry.efforts?.includes(requestedEffort)) {
          await client
            .request(
              'session/set_config_option',
              { sessionId, configId: 'thought_level', value: requestedEffort },
              REQUEST_TIMEOUT_MS,
            )
            .catch(() => undefined)
        }
      } else {
        await client
          .request('session/set_model', { sessionId, modelId: selectedModel }, REQUEST_TIMEOUT_MS)
          .catch(() => undefined)
        activeModel = selectedModel
      }
    } else if (requestedEffort) {
      await client
        .request(
          'session/set_config_option',
          { sessionId, configId: 'thought_level', value: requestedEffort },
          REQUEST_TIMEOUT_MS,
        )
        .catch(() => undefined)
    }

    onEvent({
      type: 'started',
      provider: PROVIDER,
      ...(activeModel ? { model: activeModel } : {}),
      skills: [],
    })
    armIdle()
  } catch (error) {
    client.kill()
    if (error instanceof AiRunError || error instanceof AgentProgramError) throw error
    if (error instanceof AcpRpcRejection) {
      const code = typeof error.rpcError?.code === 'number' ? error.rpcError.code : undefined
      throw new AgentProgramError(
        code !== undefined
          ? { type: 'refused', step: error.method, code }
          : { type: 'no-answer', step: error.method },
        error.message,
      )
    }
    throw error
  }

  return {
    provider: PROVIDER,
    async send(text: string): Promise<void> {
      if (stopped || !client) return
      clearIdle()
      turnRunning = true
      try {
        await client.request(
          'session/prompt',
          {
            sessionId,
            prompt: [{ type: 'text', text }],
          },
          TURN_TIMEOUT_MS,
        )
        turnRunning = false
        if (!stopped) {
          onEvent({ type: 'turn-done', ok: true })
          armIdle()
        }
      } catch (error) {
        turnRunning = false
        if (stopped) return
        if (error instanceof AcpRpcRejection && isAcpAuthRequiredError(error.rpcError)) {
          onEvent({ type: 'error', kind: 'signed-out', message: 'Antigravity sign-in expired' })
        } else {
          const msg = error instanceof Error ? error.message : String(error)
          const rateLimited = /rate.?limit|quota|429|resource_exhausted/i.test(msg)
          onEvent({
            type: 'error',
            ...(rateLimited ? { kind: 'rate-limit' as const } : {}),
            message: msg,
          })
        }
        onEvent({ type: 'turn-done', ok: false })
        armIdle()
      }
    },
    answer(id: string, answer: AgentPermissionAnswer): void {
      const pending = pendingPermissions.get(id)
      if (!pending || stopped || !client) return
      pendingPermissions.delete(id)
      if (answer.allow && answer.scope === 'session') {
        if (pending.action.kind === 'web-search') allowances.webSearch = true
        if (pending.action.kind === 'web-fetch' && pending.action.host) {
          allowances.webHosts.add(pending.action.host)
        }
      }
      if (!answer.allow) {
        onEvent({ type: 'tool', action: pending.action, status: 'denied' })
      }
      client.respond(pending.rpcId, {
        outcome: selectOptionId(pending.optionsRaw, answer.allow),
      })
    },
    setOpenDocuments(paths: string[]): void {
      openDocuments.clear()
      for (const path of paths) openDocuments.add(path)
    },
    stop(): void {
      stopSession()
    },
  }
}
