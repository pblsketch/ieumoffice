/**
 * Antigravity CLI (`agy`) ACP v1 client, tier/model parsing, env sanitization,
 * locator, and brain-only refusal tests (decision 0170).
 *
 * Every process test spawns Node itself with a tiny fake ACP stdio script so
 * no test ever launches the real `agy` CLI or consumes user quota.
 */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  antigravityAcpLaunchArgs,
  clearAntigravityModelCache,
  isAcpAuthRequiredError,
  listAntigravitySubscriptionModels,
  logoutAntigravityAcp,
  parseAntigravityModels,
  parseAntigravityTier,
  probeAntigravityAcp,
} from '../src/antigravity-acp'
import { chatForProvider } from '../src/chat'
import { selectAiProvider } from '../src/provider-selection'
import {
  AI_BRAIN_SUBSCRIPTION_PROVIDERS,
  AI_SUBSCRIPTION_PROVIDERS,
  defaultAiSettings,
} from '../src/providers'
import { streamForProvider } from '../src/stream'
import { subscriptionChildEnv } from '../src/subscription/env'
import { locateSubscriptionProgram, type SubscriptionProgram } from '../src/subscription/locate'
import type { AiSubscriptionStatuses } from '../src/types'

const tempDirs: string[] = []

async function makeTempDir(prefix = 'agy-acp-test-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

/**
 * Create a fake ACP stdio server script executed by Node.
 * `config` controls initialize capabilities, session/new response/error, and
 * whether `auth/logout` is logged to a marker file.
 */
async function makeFakeAcpProgram(config: {
  authLogoutCap?: boolean
  logoutMethod?: 'logout' | 'auth/logout'
  sessionNewError?: { code: number; message: string }
  sessionNewResult?: Record<string, unknown>
  logFile?: string
}): Promise<SubscriptionProgram> {
  const dir = await makeTempDir('agy-fake-acp-')
  const scriptPath = join(dir, 'fake-acp.mjs')
  const source = `
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const cfg = ${JSON.stringify(config)}
const log = (msg) => {
  if (cfg.logFile) appendFileSync(cfg.logFile, JSON.stringify(msg) + '\\n', 'utf8')
}
const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n')

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  if (!line.trim()) return
  const msg = JSON.parse(line)
  log({ argv: process.argv.slice(2), method: msg.method })
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: {
          ...(cfg.authLogoutCap ? { auth: { logout: {} } } : {}),
        },
      },
    })
    return
  }
  if (msg.method === 'session/new') {
    if (cfg.sessionNewError) {
      send({ jsonrpc: '2.0', id: msg.id, error: cfg.sessionNewError })
    } else {
      send({ jsonrpc: '2.0', id: msg.id, result: cfg.sessionNewResult ?? { sessionId: 's-1' } })
    }
    return
  }
  if (msg.method === 'session/close') {
    send({ jsonrpc: '2.0', id: msg.id, result: {} })
    return
  }
  if (msg.method === 'logout' && cfg.logoutMethod !== 'auth/logout') {
    send({ jsonrpc: '2.0', id: msg.id, result: {} })
    return
  }
  if (msg.method === 'auth/logout' && cfg.logoutMethod === 'auth/logout') {
    send({ jsonrpc: '2.0', id: msg.id, result: {} })
    return
  }
  send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Unknown method' } })
})
`
  await writeFile(scriptPath, source, 'utf8')
  return {
    provider: 'antigravity',
    command: process.execPath,
    prefixArgs: [scriptPath],
    env: {},
    entry: scriptPath,
    source: 'configured',
  }
}

afterEach(async () => {
  clearAntigravityModelCache()
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
})

describe('antigravityAcpLaunchArgs', () => {
  it('always isolates --gemini-dir and disables default customizations and telemetry', () => {
    const args = antigravityAcpLaunchArgs({
      geminiDir: '/tmp/isolated-gemini',
      processPerSession: true,
      sandbox: true,
    })
    expect(args).toEqual([
      'acp',
      '--process-per-session',
      '--sandbox',
      '--disable-telemetry',
      '--include-default-customizations=false',
      '--gemini-dir',
      '/tmp/isolated-gemini',
    ])
    expect(args).not.toContain('--dangerously-skip-permissions')
  })

  it('omits --process-per-session and --sandbox when false (status/model probe)', () => {
    const args = antigravityAcpLaunchArgs({
      geminiDir: '/tmp/probe-gemini',
      processPerSession: false,
      sandbox: false,
    })
    expect(args).toEqual([
      'acp',
      '--disable-telemetry',
      '--include-default-customizations=false',
      '--gemini-dir',
      '/tmp/probe-gemini',
    ])
  })
})

describe('parseAntigravityTier', () => {
  it('recognizes consumer Google AI subscription tiers (g1-*)', () => {
    expect(parseAntigravityTier({ antigravity: { tier: { id: 'g1-ultra-lite-tier' } } })).toEqual({
      signedIn: true,
      loginMethod: 'subscription',
      planName: 'ultra',
      loginKind: 'antigravity-subscription',
    })
    expect(parseAntigravityTier({ antigravity: { tier: { id: 'g1-pro-tier' } } })).toMatchObject({
      loginMethod: 'subscription',
      planName: 'pro',
    })
    expect(parseAntigravityTier({ antigravity: { tier: { id: 'g1-plus-tier' } } })).toMatchObject({
      loginMethod: 'subscription',
      planName: 'plus',
    })
    expect(parseAntigravityTier({ antigravity: { tier: { id: 'g1-free-tier' } } })).toMatchObject({
      loginMethod: 'subscription',
      planName: 'free',
    })
  })

  it('treats missing, enterprise, or unrecognized tier ids as unknown (metered)', () => {
    expect(parseAntigravityTier(undefined)).toEqual({
      signedIn: true,
      loginMethod: 'unknown',
      loginKind: 'unknown',
    })
    expect(parseAntigravityTier({ antigravity: { tier: { id: 'standard-enterprise' } } })).toEqual({
      signedIn: true,
      loginMethod: 'unknown',
      loginKind: 'unknown',
    })
    expect(parseAntigravityTier({ antigravity: { tier: { id: 'g1-bad space!' } } })).toEqual({
      signedIn: true,
      loginMethod: 'unknown',
      loginKind: 'unknown',
    })
  })
})

describe('parseAntigravityModels', () => {
  it('groups configOptions models with effort variants from availableModels', () => {
    const parsed = parseAntigravityModels({
      configOptions: [
        {
          id: 'model',
          currentValue: 'gemini-3.8-flash',
          options: [
            { value: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
            { value: 'gemini-3.8-pro', name: 'Gemini 3.8 Pro' },
          ],
        },
        { id: 'thought_level', currentValue: 'low' },
      ],
      models: {
        currentModelId: 'gemini-3.8-flash-low',
        availableModels: [
          { modelId: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
          { modelId: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
          { modelId: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
          { modelId: 'gemini-3.8-pro-high', name: 'Gemini 3.8 Pro (High)' },
        ],
      },
    })
    expect(parsed).toEqual([
      {
        id: 'gemini-3.8-flash',
        label: 'Gemini 3.8 Flash',
        isDefault: true,
        efforts: ['low', 'medium', 'high'],
        defaultEffort: 'low',
      },
      {
        id: 'gemini-3.8-pro',
        label: 'Gemini 3.8 Pro',
        efforts: ['high'],
      },
    ])
  })

  it('falls back to flat availableModels when configOptions is absent', () => {
    const parsed = parseAntigravityModels({
      models: {
        currentModelId: 'gemini-3.8-flash-low',
        availableModels: [
          { modelId: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
          { modelId: 'gemini-3.8-pro-high', name: 'Gemini 3.8 Pro (High)' },
        ],
      },
    })
    expect(parsed).toEqual([
      { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)', isDefault: true },
      { id: 'gemini-3.8-pro-high', label: 'Gemini 3.8 Pro (High)' },
    ])
  })
})

describe('isAcpAuthRequiredError', () => {
  it('detects ACP -32000 and auth-required messages', () => {
    expect(isAcpAuthRequiredError({ code: -32000, message: 'Auth needed' })).toBe(true)
    expect(isAcpAuthRequiredError({ code: -32603, message: 'Authentication required' })).toBe(true)
    expect(isAcpAuthRequiredError({ code: -32601, message: 'Method not found' })).toBe(false)
  })
})

describe('Google/Gemini billing env stripping and binary locator', () => {
  it('strips Google/Gemini/Vertex billing redirect env vars case-insensitively on win32', () => {
    const env = subscriptionChildEnv({
      base: {
        PATH: 'C:\\Windows\\System32',
        GEMINI_API_KEY: 'secret-1',
        google_api_key: 'secret-2',
        GOOGLE_GEMINI_BASE_URL: 'https://evil.example',
        AGY_ADC_AUTH: '1',
        GOOGLE_CLOUD_PROJECT: 'my-gcp-project',
        GOOGLE_CLOUD_QUOTA_PROJECT: 'my-quota-project',
        GOOGLE_CLOUD_LOCATION: 'us-central1',
        GOOGLE_GENAI_USE_VERTEXAI: 'true',
      },
      platform: 'win32',
    })
    expect(env.PATH).toBe('C:\\Windows\\System32')
    for (const key of [
      'GEMINI_API_KEY',
      'google_api_key',
      'GOOGLE_GEMINI_BASE_URL',
      'AGY_ADC_AUTH',
      'GOOGLE_CLOUD_PROJECT',
      'GOOGLE_CLOUD_QUOTA_PROJECT',
      'GOOGLE_CLOUD_LOCATION',
      'GOOGLE_GENAI_USE_VERTEXAI',
    ]) {
      expect(env[key]).toBeUndefined()
    }
  })

  it('locates agy.exe under %LOCALAPPDATA%\\agy\\bin on Windows and common dirs on Unix', async () => {
    const root = await makeTempDir('agy-locate-')
    const winBin = join(root, 'LocalAppData', 'agy', 'bin')
    await mkdir(winBin, { recursive: true })
    const winExe = join(winBin, 'agy.exe')
    await writeFile(winExe, '', 'utf8')
    const winFound = await locateSubscriptionProgram('antigravity', {
      platform: 'win32',
      env: { PATH: '', LOCALAPPDATA: join(root, 'LocalAppData') },
    })
    expect(winFound?.command).toBe(winExe)

    const unixBin = join(root, '.local', 'bin')
    await mkdir(unixBin, { recursive: true })
    const unixExe = join(unixBin, 'agy')
    await writeFile(unixExe, '', { mode: 0o755 })
    const unixFound = await locateSubscriptionProgram('antigravity', {
      platform: 'linux',
      env: { PATH: '' },
      commonDirs: [unixBin],
    })
    expect(unixFound?.command).toBe(unixExe)
  })
})

describe('routing boundary (Phase 2 ToS policy)', () => {
  it('places antigravity last in interactive auto order and keeps it out of batch/headless lists', () => {
    expect(AI_SUBSCRIPTION_PROVIDERS).toEqual(['claude-code', 'chatgpt', 'codex', 'antigravity'])
    expect(AI_BRAIN_SUBSCRIPTION_PROVIDERS).not.toContain('antigravity')

    const settings = defaultAiSettings()
    const antigravityOnly: AiSubscriptionStatuses = {
      'claude-code': { provider: 'claude-code', state: 'signed-out', meteredAccepted: false },
      chatgpt: { provider: 'chatgpt', state: 'signed-out', meteredAccepted: false },
      codex: { provider: 'codex', state: 'signed-out', meteredAccepted: false },
      antigravity: {
        provider: 'antigravity',
        state: 'ready',
        loginMethod: 'subscription',
        planName: 'ultra',
        meteredAccepted: false,
      },
    }
    // Interactive auto falls through to antigravity when no earlier subscription is ready
    const interactive = selectAiProvider(settings, antigravityOnly)
    expect(interactive).toEqual({ connected: true, provider: 'antigravity', metered: false })

    // Earlier subscriptions still win over antigravity
    const withCodex = selectAiProvider(settings, {
      ...antigravityOnly,
      codex: {
        provider: 'codex',
        state: 'ready',
        loginMethod: 'subscription',
        meteredAccepted: false,
      },
    })
    expect(withCodex).toEqual({ connected: true, provider: 'codex', metered: false })

    // Batch/headless callers exclude antigravity cleanly
    const batch = selectAiProvider(settings, antigravityOnly, {
      subscriptions: AI_BRAIN_SUBSCRIPTION_PROVIDERS,
    })
    expect(batch.connected).toBe(false)
    const explicitBatch = selectAiProvider(
      { ...settings, provider: 'antigravity' },
      antigravityOnly,
      { subscriptions: AI_BRAIN_SUBSCRIPTION_PROVIDERS },
    )
    expect(explicitBatch.connected).toBe(false)
  })

  it('refuses brain-only streamForProvider and chatForProvider calls for antigravity', async () => {
    const config = { apiKey: '', model: '' }
    await expect(
      streamForProvider('antigravity', config, 'hi', [{ role: 'user', text: 'hi' }], [], 1024, {
        onDelta: () => undefined,
        onToolCall: () => undefined,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/ACP/i)

    const chatRes = await chatForProvider('antigravity', config, 'hi', 'hi')
    expect(chatRes.ok).toBe(false)
    if (!chatRes.ok) expect(chatRes.error).toMatch(/ACP/i)
  })
})

describe('probeAntigravityAcp, model cache, and logoutAntigravityAcp (fake stdio ACP)', () => {
  it('probes tier and models with zero model calls, caches models, and cleans up its temp folder', async () => {
    const createdTemps: string[] = []
    const program = await makeFakeAcpProgram({
      sessionNewResult: {
        sessionId: 'sess-probe-1',
        _meta: { antigravity: { tier: { id: 'g1-ultra-lite-tier', name: 'Google AI Ultra' } } },
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

    const result = await probeAntigravityAcp(
      program,
      { timeoutMs: 10_000 },
      {
        registry: null,
        createTempDir: async () => {
          const d = await makeTempDir('probe-isolated-')
          createdTemps.push(d)
          return d
        },
      },
    )

    expect(result?.login).toEqual({
      signedIn: true,
      loginMethod: 'subscription',
      planName: 'ultra',
      loginKind: 'antigravity-subscription',
    })
    expect(result?.models).toEqual([
      {
        id: 'gemini-3.8-flash',
        label: 'Gemini 3.8 Flash',
        isDefault: true,
        efforts: ['low'],
        defaultEffort: 'low',
      },
    ])
    // Isolated temp dir was cleaned up on probe completion
    expect(createdTemps.length).toBe(1)
    expect(existsSync(createdTemps[0]!)).toBe(false)

    // Subsequent model listing hits the 30s cache without spawning another child
    let spawnedAgain = false
    const cached = await listAntigravitySubscriptionModels(
      { configuredPath: undefined, signal: new AbortController().signal },
      {
        locate: async () => program,
        spawn: () => {
          spawnedAgain = true
          throw new Error('should not spawn on cache hit')
        },
      },
    )
    expect(spawnedAgain).toBe(false)
    expect(cached).toEqual(result?.models)
  })

  it('maps ACP -32000 on session/new to signed-out', async () => {
    const program = await makeFakeAcpProgram({
      sessionNewError: { code: -32000, message: 'Authentication required' },
    })
    const result = await probeAntigravityAcp(program, { timeoutMs: 10_000 }, { registry: null })
    expect(result).toEqual({ login: { signedIn: false } })
  })

  it('maps missing tier metadata to loginMethod unknown (metered)', async () => {
    const program = await makeFakeAcpProgram({
      sessionNewResult: { sessionId: 'sess-unknown' },
    })
    const result = await probeAntigravityAcp(program, { timeoutMs: 10_000 }, { registry: null })
    expect(result?.login).toEqual({
      signedIn: true,
      loginMethod: 'unknown',
      loginKind: 'unknown',
    })
  })

  it('calls ACP logout (with auth/logout fallback) when supported and returns false when absent', async () => {
    const withV1 = await makeFakeAcpProgram({ authLogoutCap: true })
    expect(await logoutAntigravityAcp(withV1, { timeoutMs: 10_000 }, { registry: null })).toBe(true)

    const withV2 = await makeFakeAcpProgram({
      authLogoutCap: true,
      logoutMethod: 'auth/logout',
    })
    expect(await logoutAntigravityAcp(withV2, { timeoutMs: 10_000 }, { registry: null })).toBe(true)

    const withoutCap = await makeFakeAcpProgram({ authLogoutCap: false })
    const notSupported = await logoutAntigravityAcp(
      withoutCap,
      { timeoutMs: 10_000 },
      { registry: null },
    )
    expect(notSupported).toBe(false)
  }, 15_000)
})
