/**
 * Antigravity CLI (`agy`) Agent Client Protocol (ACP v1) stdio client.
 *
 * Used strictly as an official ACP client (never wrapping `agy` as a brain-only
 * single-turn JSON harness). Handles:
 * - bounded line-delimited JSON-RPC 2.0 over stdio;
 * - isolated per-session `--gemini-dir` so user hooks, plugins, settings, and
 *   MCP servers under `~/.gemini` are excluded while the OS keyring sign-in is
 *   preserved without this app ever touching credential storage;
 * - zero-model-call sign-in, tier, and model discovery (`initialize` + `session/new`);
 * - ACP `logout` (with `auth/logout` fallback) when requested by the user.
 */
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { PRODUCT_NAME } from '@genoffice/i18n'
import { aiEffortOf, aiEffortsOf, type AiEffort } from './effort'
import type { AiSubscriptionModel } from './types'
import { subscriptionModelsOf } from './subscription/contract'
import {
  onSubscriptionLoginChange,
  onSubscriptionOffChange,
  setAntigravityLogoutSource,
} from './subscription/launch'
import { locateSubscriptionProgram, type SubscriptionProgram } from './subscription/locate'
import { setSubscriptionModelSource } from './subscription/models'
import {
  killProcessTree,
  spawnSubscriptionProgram,
  type SubscriptionChildLike,
  type SubscriptionChildRegistry,
  type SubscriptionSpawn,
} from './subscription/process'
import { setAntigravityStatusSource, type SubscriptionLogin } from './subscription/status'
import { createTrackedTempDir, removeTrackedTempDir } from './subscription/temp-dirs'

export const ANTIGRAVITY_TEMP_PREFIX = 'genoffice-antigravity-acp-'
const ANTIGRAVITY_CLIENT_NAME = PRODUCT_NAME.toLowerCase()
const ANTIGRAVITY_CLIENT_VERSION = '1.0.0'
const MAX_ACP_LINE_BYTES = 16 * 1024 * 1024
const MODEL_CACHE_TTL_MS = 30_000
const EXIT_GRACE_MS = 600
const ACP_AUTH_REQUIRED_CODE = -32000

export interface AcpRpcMessage {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: unknown
  result?: unknown
  error?: unknown
}

export interface AcpRpcError {
  code?: unknown
  message?: unknown
  data?: unknown
}

export interface AcpLaunchOptions {
  /** isolated directory passed to `--gemini-dir` (omitted only for `logout` so the CLI can clear its own auth store) */
  geminiDir?: string | undefined
  /** required when passing HTTP MCP servers in `session/new` */
  processPerSession?: boolean | undefined
  /** enable OS terminal sandbox containment */
  sandbox?: boolean | undefined
}

/**
 * Fixed ACP launch arguments for `agy`. Never includes user text or
 * `--dangerously-skip-permissions`.
 */
export function antigravityAcpLaunchArgs(options: AcpLaunchOptions): string[] {
  return [
    'acp',
    ...(options.processPerSession ? ['--process-per-session'] : []),
    ...(options.sandbox ? ['--sandbox'] : []),
    '--disable-telemetry',
    '--include-default-customizations=false',
    ...(options.geminiDir ? ['--gemini-dir', options.geminiDir] : []),
  ]
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * Short display identifier derived from a Google AI consumer tier id (`g1-*`).
 * Only known constant labels or narrow identifier-shaped `g1-*` ids pass;
 * arbitrary CLI strings are never copied into status.
 */
function tierPlanLabel(tierId: string): string | undefined {
  if (!/^g1-[a-z0-9_-]{1,28}$/i.test(tierId)) return undefined
  if (/ultra/i.test(tierId)) return 'ultra'
  if (/pro/i.test(tierId)) return 'pro'
  if (/plus/i.test(tierId)) return 'plus'
  if (/free/i.test(tierId)) return 'free'
  return tierId.toLowerCase()
}

/**
 * Derive subscription vs unknown/metered login from `session/new`'s `_meta`.
 * Only a consumer Google AI subscription tier (`g1-*`) counts as `subscription`;
 * anything else (enterprise, GCP pay-as-you-go, API key, missing tier) reads as
 * `unknown` so the app never assumes a potentially metered route is a plan.
 */
export function parseAntigravityTier(meta: unknown): SubscriptionLogin {
  const agy = asRecord(asRecord(meta)?.antigravity)
  const tier = asRecord(agy?.tier)
  const id = typeof tier?.id === 'string' ? tier.id.trim() : ''
  const planName = id ? tierPlanLabel(id) : undefined
  if (planName) {
    return {
      signedIn: true,
      loginMethod: 'subscription',
      planName,
      loginKind: 'antigravity-subscription',
    }
  }
  return {
    signedIn: true,
    loginMethod: 'unknown',
    loginKind: 'unknown',
  }
}

/** Whether an ACP JSON-RPC error indicates the CLI is signed out */
export function isAcpAuthRequiredError(error: unknown): boolean {
  const rec = asRecord(error)
  if (!rec) return false
  if (rec.code === ACP_AUTH_REQUIRED_CODE) return true
  return typeof rec.message === 'string' && /auth(?:entication)? required/i.test(rec.message)
}

/**
 * Parse `session/new`'s `configOptions` and `models.availableModels` into the
 * bounded `AiSubscriptionModel[]` list shown in pickers.
 */
export function parseAntigravityModels(sessionNew: unknown): AiSubscriptionModel[] | undefined {
  const result = asRecord(sessionNew)
  if (!result) return undefined
  const modelsObj = asRecord(result.models)
  const availableRaw = Array.isArray(modelsObj?.availableModels) ? modelsObj.availableModels : []
  const currentModelId =
    typeof modelsObj?.currentModelId === 'string' ? modelsObj.currentModelId : ''

  const configOptions = Array.isArray(result.configOptions) ? result.configOptions : []
  const modelOption = configOptions.find((entry) => asRecord(entry)?.id === 'model')
  const thoughtOption = configOptions.find((entry) => asRecord(entry)?.id === 'thought_level')
  const modelEntries = Array.isArray(asRecord(modelOption)?.options)
    ? (asRecord(modelOption)!.options as unknown[])
    : []
  const currentGroupId =
    typeof asRecord(modelOption)?.currentValue === 'string'
      ? (asRecord(modelOption)!.currentValue as string)
      : ''
  const currentThought = aiEffortOf(asRecord(thoughtOption)?.currentValue)

  const availableIds = availableRaw
    .map((item) => {
      const rec = asRecord(item)
      const id = typeof rec?.modelId === 'string' ? rec.modelId.trim() : ''
      const label = typeof rec?.name === 'string' ? rec.name.trim() : id
      return id ? { id, label } : null
    })
    .filter((entry): entry is { id: string; label: string } => entry !== null)

  if (modelEntries.length > 0) {
    const grouped: AiSubscriptionModel[] = []
    for (const rawEntry of modelEntries) {
      const entry = asRecord(rawEntry)
      const id = typeof entry?.value === 'string' ? entry.value.trim() : ''
      if (!id) continue
      const label = typeof entry?.name === 'string' ? entry.name.trim() : id
      const effortsRaw: AiEffort[] = []
      const prefix = `${id}-`
      for (const variant of availableIds) {
        if (!variant.id.startsWith(prefix)) continue
        const suffix = aiEffortOf(variant.id.slice(prefix.length))
        if (suffix && !effortsRaw.includes(suffix)) effortsRaw.push(suffix)
      }
      const efforts = aiEffortsOf(effortsRaw)
      const isDefault =
        id === currentGroupId || (!currentGroupId && currentModelId.startsWith(prefix))
      const defaultEffort =
        isDefault && currentThought && efforts?.includes(currentThought)
          ? currentThought
          : undefined
      grouped.push({
        id,
        label,
        ...(isDefault ? { isDefault: true } : {}),
        ...(efforts ? { efforts } : {}),
        ...(defaultEffort ? { defaultEffort } : {}),
      })
    }
    const cleaned = subscriptionModelsOf(grouped)
    if (cleaned?.length) return cleaned
  }

  if (availableIds.length > 0) {
    return subscriptionModelsOf(
      availableIds.map((item) => ({
        id: item.id,
        label: item.label,
        ...(item.id === currentModelId ? { isDefault: true } : {}),
      })),
    )
  }
  return undefined
}

// ── Bounded JSON-RPC stdio client ──

interface PendingRpc {
  method: string
  resolve: (result: unknown) => void
  reject: (error: AcpRpcRejection) => void
  timer: ReturnType<typeof setTimeout>
}

export class AcpRpcRejection extends Error {
  readonly method: string
  readonly rpcError?: AcpRpcError | undefined

  constructor(method: string, message: string, rpcError?: AcpRpcError) {
    super(message)
    this.name = 'AcpRpcRejection'
    this.method = method
    this.rpcError = rpcError
  }
}

export interface AcpClientHandlers {
  onNotification?: ((method: string, params: unknown) => void) | undefined
  onRequest?: ((id: unknown, method: string, params: unknown) => void) | undefined
  onClose?: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined
  onProtocolError?: ((error: Error) => void) | undefined
}

export interface AcpClient {
  readonly child: ChildProcessWithoutNullStreams
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>
  notify(method: string, params?: unknown): void
  respond(id: unknown, result: unknown): void
  respondError(id: unknown, code: number, message: string): void
  close(): Promise<void>
  kill(): void
}

/**
 * Wrap a spawned `agy acp` child process with bounded NDJSON JSON-RPC framing.
 * Lines exceeding `MAX_ACP_LINE_BYTES` fail the client and terminate the tree.
 */
export function attachAcpClient(
  child: ChildProcessWithoutNullStreams,
  handlers: AcpClientHandlers = {},
  deps: { killTree?: ((child: SubscriptionChildLike) => void) | undefined } = {},
): AcpClient {
  const pending = new Map<number, PendingRpc>()
  let nextId = 1
  let closed = false
  let killed = false
  const killFn = deps.killTree ?? ((proc) => killProcessTree(proc, { force: true }))

  const failAll = (error: AcpRpcRejection): void => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    pending.clear()
  }

  const writeLine = (payload: Record<string, unknown>): void => {
    if (closed || killed || !child.stdin.writable) return
    try {
      child.stdin.write(`${JSON.stringify(payload)}\n`)
    } catch {
      // broken pipe is handled on close/error
    }
  }

  const decoder = new StringDecoder('utf8')
  let buffer = ''
  let bufferedBytes = 0

  const handleLine = (raw: string): void => {
    const line = raw.trim()
    if (!line) return
    let parsed: AcpRpcMessage
    try {
      parsed = JSON.parse(line) as AcpRpcMessage
    } catch {
      return
    }
    if (parsed.id !== undefined && parsed.method === undefined) {
      const id = typeof parsed.id === 'number' ? parsed.id : Number(parsed.id)
      const entry = pending.get(id)
      if (!entry) return
      clearTimeout(entry.timer)
      pending.delete(id)
      if (parsed.error !== undefined) {
        const errObj = asRecord(parsed.error) as AcpRpcError | undefined
        const msg =
          typeof errObj?.message === 'string' && errObj.message
            ? errObj.message
            : `ACP ${entry.method} failed`
        entry.reject(new AcpRpcRejection(entry.method, msg, errObj))
      } else {
        entry.resolve(parsed.result)
      }
      return
    }
    if (parsed.id !== undefined && typeof parsed.method === 'string') {
      handlers.onRequest?.(parsed.id, parsed.method, parsed.params)
      return
    }
    if (typeof parsed.method === 'string') {
      handlers.onNotification?.(parsed.method, parsed.params)
    }
  }

  child.stdout.on('data', (chunk: Buffer) => {
    bufferedBytes += chunk.length
    if (bufferedBytes > MAX_ACP_LINE_BYTES) {
      const err = new AcpRpcRejection('stdout', 'ACP output line exceeded size limit')
      failAll(err)
      handlers.onProtocolError?.(err)
      if (!killed) {
        killed = true
        killFn(child)
      }
      return
    }
    buffer += decoder.write(chunk)
    let nl = buffer.indexOf('\n')
    while (nl !== -1) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      bufferedBytes = Buffer.byteLength(buffer, 'utf8')
      handleLine(line)
      nl = buffer.indexOf('\n')
    }
  })

  // drain stderr so the child never blocks on a full pipe; never copy text to status
  child.stderr.on('data', () => undefined)

  child.once('error', (error) => {
    closed = true
    failAll(new AcpRpcRejection('process', error.message))
  })

  child.once('close', (code, signal) => {
    closed = true
    const tail = (buffer + decoder.end()).trim()
    buffer = ''
    bufferedBytes = 0
    if (tail) handleLine(tail)
    failAll(
      new AcpRpcRejection(
        'process',
        `Antigravity ACP exited${code !== null ? ` with code ${code}` : ''}`,
      ),
    )
    handlers.onClose?.(code, signal)
  })

  return {
    child,
    request(method, params, timeoutMs = 20_000) {
      if (closed || killed) {
        return Promise.reject(new AcpRpcRejection(method, 'Antigravity ACP is not running'))
      }
      const id = nextId++
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new AcpRpcRejection(method, `Antigravity ACP timed out on ${method}`))
        }, timeoutMs)
        timer.unref?.()
        pending.set(id, { method, resolve, reject, timer })
        writeLine({ jsonrpc: '2.0', id, method, params })
      })
    },
    notify(method, params) {
      writeLine(
        params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params },
      )
    },
    respond(id, result) {
      writeLine({ jsonrpc: '2.0', id, result })
    },
    respondError(id, code, message) {
      writeLine({ jsonrpc: '2.0', id, error: { code, message } })
    },
    async close() {
      if (closed) return
      try {
        child.stdin.end()
      } catch {
        // already ended
      }
      await new Promise<void>((resolve) => {
        if (closed || child.exitCode !== null) {
          resolve()
          return
        }
        const timer = setTimeout(() => {
          if (!killed && !closed && child.exitCode === null) {
            killed = true
            killFn(child)
          }
          resolve()
        }, EXIT_GRACE_MS)
        timer.unref?.()
        child.once('close', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    },
    kill() {
      if (killed) return
      killed = true
      try {
        child.stdin.end()
      } catch {
        // ignore
      }
      killFn(child)
    },
  }
}

// ── Probe (status + models, zero model calls) and Logout ──

interface CachedModels {
  entry: string
  models: AiSubscriptionModel[]
  at: number
}

let cachedModels: CachedModels | null = null

export function clearAntigravityModelCache(): void {
  cachedModels = null
}

onSubscriptionLoginChange((provider) => {
  if (provider === 'antigravity') clearAntigravityModelCache()
})

onSubscriptionOffChange((change) => {
  if (change.provider === 'antigravity') clearAntigravityModelCache()
})

export interface AntigravityProbeDeps {
  spawn?: SubscriptionSpawn | undefined
  killTree?: ((child: SubscriptionChildLike) => void) | undefined
  registry?: SubscriptionChildRegistry | null | undefined
  baseEnv?: NodeJS.ProcessEnv | undefined
  createTempDir?: (() => Promise<string>) | undefined
  removeTempDir?: ((dir: string) => Promise<void>) | undefined
}

export interface AntigravityProbeResult {
  login: SubscriptionLogin
  models?: AiSubscriptionModel[] | undefined
}

/**
 * Inspect sign-in state, subscription tier, and available models by running
 * `agy acp` with `initialize` + `session/new` in an isolated temporary folder
 * (no prompt is sent and no model quota is consumed).
 */
export async function probeAntigravityAcp(
  program: SubscriptionProgram,
  options: { signal?: AbortSignal | undefined; timeoutMs?: number | undefined } = {},
  deps: AntigravityProbeDeps = {},
): Promise<AntigravityProbeResult | null> {
  const timeoutMs = options.timeoutMs ?? 20_000
  const rootTemp = await (deps.createTempDir
    ? deps.createTempDir()
    : createTrackedTempDir(ANTIGRAVITY_TEMP_PREFIX))
  const workDir = join(rootTemp, 'work')
  const geminiDir = join(rootTemp, 'gemini')
  let client: AcpClient | undefined

  const onAbort = (): void => {
    client?.kill()
  }
  if (options.signal?.aborted) {
    await (deps.removeTempDir ? deps.removeTempDir(rootTemp) : removeTrackedTempDir(rootTemp))
    return null
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })

  try {
    await Promise.all([mkdir(workDir, { recursive: true }), mkdir(geminiDir, { recursive: true })])
    const args = antigravityAcpLaunchArgs({
      geminiDir,
      processPerSession: false,
      sandbox: false,
    })
    const child = spawnSubscriptionProgram(program, args, {
      cwd: workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      baseEnv: deps.baseEnv,
      spawn: deps.spawn,
      registry: deps.registry,
    }) as ChildProcessWithoutNullStreams
    client = attachAcpClient(child, {}, { killTree: deps.killTree })

    await client.request(
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: ANTIGRAVITY_CLIENT_NAME, version: ANTIGRAVITY_CLIENT_VERSION },
      },
      timeoutMs,
    )

    let sessionRes: unknown
    try {
      sessionRes = await client.request('session/new', { cwd: workDir, mcpServers: [] }, timeoutMs)
    } catch (error) {
      if (error instanceof AcpRpcRejection && isAcpAuthRequiredError(error.rpcError)) {
        clearAntigravityModelCache()
        return { login: { signedIn: false } }
      }
      return null
    }

    const sessionObj = asRecord(sessionRes)
    const sessionId = typeof sessionObj?.sessionId === 'string' ? sessionObj.sessionId : ''
    if (sessionId) {
      await client.request('session/close', { sessionId }, 500).catch(() => undefined)
    }

    const login = parseAntigravityTier(sessionObj?._meta)
    const models = parseAntigravityModels(sessionRes)
    if (models?.length) {
      cachedModels = { entry: program.entry, models, at: Date.now() }
    }
    return { login, ...(models ? { models } : {}) }
  } catch {
    return null
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
    if (client) await client.close().catch(() => undefined)
    await (deps.removeTempDir ? deps.removeTempDir(rootTemp) : removeTrackedTempDir(rootTemp))
  }
}

/**
 * Sign out of the local Antigravity CLI via ACP `logout` (with `auth/logout`
 * fallback for protocol v2). The app never touches the OS keyring or
 * credential files directly.
 */
export async function logoutAntigravityAcp(
  program: SubscriptionProgram,
  options: { timeoutMs?: number | undefined; baseEnv?: NodeJS.ProcessEnv | undefined } = {},
  deps: AntigravityProbeDeps = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 20_000
  const rootTemp = await (deps.createTempDir
    ? deps.createTempDir()
    : createTrackedTempDir(ANTIGRAVITY_TEMP_PREFIX))
  const workDir = join(rootTemp, 'work')
  let client: AcpClient | undefined

  try {
    await mkdir(workDir, { recursive: true })
    // Omit --gemini-dir during logout (no session/prompt/tools are created) so `agy`
    // can clear its own local auth state and OS keyring entry cleanly.
    const args = antigravityAcpLaunchArgs({
      processPerSession: false,
      sandbox: false,
    })
    const child = spawnSubscriptionProgram(program, args, {
      cwd: workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      baseEnv: options.baseEnv ?? deps.baseEnv,
      spawn: deps.spawn,
      registry: deps.registry,
    }) as ChildProcessWithoutNullStreams
    client = attachAcpClient(child, {}, { killTree: deps.killTree })

    const initRes = await client.request(
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: ANTIGRAVITY_CLIENT_NAME, version: ANTIGRAVITY_CLIENT_VERSION },
      },
      timeoutMs,
    )
    const authCaps = asRecord(asRecord(asRecord(initRes)?.agentCapabilities)?.auth)
    if (!authCaps || !('logout' in authCaps)) return false
    try {
      // ACP v1 specifies method "logout"
      await client.request('logout', {}, timeoutMs)
    } catch (error) {
      // Fall back to ACP v2 "auth/logout" only when "logout" is not implemented (-32601)
      if (error instanceof AcpRpcRejection && error.rpcError?.code === -32601) {
        await client.request('auth/logout', {}, timeoutMs)
      } else {
        throw error
      }
    }
    clearAntigravityModelCache()
    return true
  } catch {
    return false
  } finally {
    if (client) await client.close().catch(() => undefined)
    await (deps.removeTempDir ? deps.removeTempDir(rootTemp) : removeTrackedTempDir(rootTemp))
  }
}

/** Read models from the recent probe cache or run a fresh zero-model-call probe */
export async function listAntigravitySubscriptionModels(
  context: { configuredPath: string | undefined; signal: AbortSignal },
  deps: AntigravityProbeDeps & {
    locate?: typeof locateSubscriptionProgram | undefined
  } = {},
): Promise<AiSubscriptionModel[] | undefined> {
  const program = await (deps.locate ?? locateSubscriptionProgram)('antigravity', {
    configuredPath: context.configuredPath,
  })
  if (!program) return undefined
  if (
    cachedModels &&
    cachedModels.entry === program.entry &&
    Date.now() - cachedModels.at < MODEL_CACHE_TTL_MS
  ) {
    return cachedModels.models
  }
  const probed = await probeAntigravityAcp(program, { signal: context.signal }, deps)
  return probed?.models
}

// Register sources for the subscription status service, model lister, and logout
setAntigravityStatusSource(async ({ program, signal, timeoutMs }) => {
  const result = await probeAntigravityAcp(program, { signal, timeoutMs })
  return result ? result.login : null
})

setAntigravityLogoutSource(({ program, timeoutMs, baseEnv, spawn }) =>
  logoutAntigravityAcp(program, { timeoutMs, baseEnv }, { spawn }),
)

setSubscriptionModelSource('antigravity', (context) => listAntigravitySubscriptionModels(context))
