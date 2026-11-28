/**
 * Strict non-sensitive diagnostics bundle builder (`app-info.json` +
 * re-validated `crash-summary.jsonl`) and minimal store-mode ZIP serializer.
 * Security invariant: zero document contents, file paths, open tab titles,
 * user emails, API keys/tokens, or raw error messages ever enter the preview or ZIP.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IpcMain } from 'electron'
import { CRASH_LOG_FILE } from './crash-log'

export const DIAGNOSTICS_CHANNELS = {
  preview: 'diagnostics:preview',
  saveZip: 'diagnostics:save-zip',
} as const

export interface DiagnosticsFilePreview {
  readonly name: string
  readonly content: string
  readonly bytes: number
}

export interface DiagnosticsPreview {
  readonly files: readonly DiagnosticsFilePreview[]
  readonly summaryText: string
}

export interface DiagnosticsInput {
  readonly appVersion: string
  readonly platform: string
  readonly arch: string
  readonly osRelease: string
  readonly uiLang: string
  readonly subscriptions: Record<
    string,
    { readonly state: string; readonly version?: string | undefined }
  >
  readonly crashLogRaw?: string | undefined
}

const SAFE_WORD = /^[A-Za-z0-9][A-Za-z0-9 _.:-]{0,47}$/
const SAFE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/
const ALLOWED_CRASH_KINDS = new Set([
  'renderer',
  'child-process',
  'main-exception',
  'main-rejection',
  'low-memory',
  'main-gone',
  'agent-start',
  'ai-run-stop',
])
const CRASH_WORD_FIELDS = ['reason', 'editor', 'process', 'program', 'cause', 'tool'] as const
const CRASH_INT_FIELDS = [
  'exitCode',
  'appMB',
  'freeMB',
  'totalMB',
  'aiStreams',
  'cliChildren',
  'mainMB',
  'heapMB',
  'heapLimitMB',
  'upMin',
  'beatAgeMin',
  'executed',
  'changed',
] as const

function safeToken(v: unknown, fallback = 'unknown'): string {
  return typeof v === 'string' && SAFE_WORD.test(v) ? v : fallback
}

/** Re-validates raw JSONL crash-log lines strictly against the `crash-log.ts` whitelist. */
export function sanitizeCrashSummary(raw: string | undefined, maxLines = 100): string {
  if (!raw) return ''
  const lines = raw
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .slice(-maxLines)
  const out: string[] = []
  for (const line of lines) {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    const obj = parsed as Record<string, unknown>
    if (typeof obj.kind !== 'string' || !ALLOWED_CRASH_KINDS.has(obj.kind)) continue
    const clean: Record<string, string | number> = { kind: obj.kind }
    if (typeof obj.at === 'string' && SAFE_ISO.test(obj.at)) clean.at = obj.at
    for (const k of CRASH_WORD_FIELDS) {
      if (typeof obj[k] === 'string' && SAFE_WORD.test(obj[k] as string)) {
        clean[k] = obj[k] as string
      }
    }
    for (const k of CRASH_INT_FIELDS) {
      if (typeof obj[k] === 'number' && Number.isInteger(obj[k])) {
        clean[k] = obj[k] as number
      }
    }
    out.push(JSON.stringify(clean))
  }
  return out.join('\n')
}

export function buildDiagnosticsPreview(input: DiagnosticsInput): DiagnosticsPreview {
  const safeSubs: Record<string, { state: string; version?: string }> = {}
  for (const [key, val] of Object.entries(input.subscriptions ?? {})) {
    if (!SAFE_WORD.test(key) || !val || typeof val !== 'object') continue
    const entry: { state: string; version?: string } = { state: safeToken(val.state) }
    if (typeof val.version === 'string' && SAFE_WORD.test(val.version)) {
      entry.version = val.version
    }
    safeSubs[key] = entry
  }

  const appInfo = {
    appVersion: safeToken(input.appVersion),
    platform: safeToken(input.platform),
    arch: safeToken(input.arch),
    osRelease: safeToken(input.osRelease),
    uiLang: safeToken(input.uiLang),
    subscriptions: safeSubs,
  }
  const appInfoText = JSON.stringify(appInfo, null, 2)
  const crashSummaryText = sanitizeCrashSummary(input.crashLogRaw)

  const files: DiagnosticsFilePreview[] = [
    { name: 'app-info.json', content: appInfoText, bytes: Buffer.byteLength(appInfoText, 'utf8') },
    {
      name: 'crash-summary.jsonl',
      content: crashSummaryText,
      bytes: Buffer.byteLength(crashSummaryText, 'utf8'),
    },
  ]

  const summaryText = [
    `Version: ${appInfo.appVersion}`,
    `OS: ${appInfo.platform} ${appInfo.arch} (${appInfo.osRelease})`,
    `Language: ${appInfo.uiLang}`,
    `Subscriptions: ${
      Object.entries(safeSubs)
        .map(([k, v]) => `${k}=${v.state}${v.version ? `(${v.version})` : ''}`)
        .join(', ') || 'none'
    }`,
    `Crash records: ${crashSummaryText ? crashSummaryText.split('\n').length : 0}`,
  ].join('\n')

  return { files, summaryText }
}

// Standard CRC-32 table for ZIP archive headers
const CRC_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[i] = c >>> 0
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Builds a valid, zero-dependency standard store-mode ZIP buffer from preview files. */
export function buildDiagnosticsZip(preview: DiagnosticsPreview): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const file of preview.files) {
    const nameBuf = Buffer.from(file.name, 'utf8')
    const dataBuf = Buffer.from(file.content, 'utf8')
    const crc = crc32(dataBuf)

    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(dataBuf.length, 18)
    local.writeUInt32LE(dataBuf.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    nameBuf.copy(local, 30)
    localParts.push(local, dataBuf)

    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(dataBuf.length, 20)
    central.writeUInt32LE(dataBuf.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    nameBuf.copy(central, 46)
    centralParts.push(central)

    offset += local.length + dataBuf.length
  }

  const centralBuf = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(preview.files.length, 8)
  eocd.writeUInt16LE(preview.files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralBuf, eocd])
}

export function registerDiagnosticsIpc(
  ipcMain: IpcMain,
  deps: {
    readonly userDataDir: () => string
    readonly collectInput: () => Omit<DiagnosticsInput, 'crashLogRaw'>
    readonly pickSavePath: (defaultName: string) => Promise<string | null>
  },
): void {
  ipcMain.removeHandler(DIAGNOSTICS_CHANNELS.preview)
  ipcMain.removeHandler(DIAGNOSTICS_CHANNELS.saveZip)

  const makePreview = (): DiagnosticsPreview => {
    const crashPath = join(deps.userDataDir(), CRASH_LOG_FILE)
    const crashLogRaw = existsSync(crashPath) ? readFileSync(crashPath, 'utf8') : undefined
    return buildDiagnosticsPreview({ ...deps.collectInput(), crashLogRaw })
  }

  ipcMain.handle(DIAGNOSTICS_CHANNELS.preview, () => makePreview())
  ipcMain.handle(DIAGNOSTICS_CHANNELS.saveZip, async () => {
    const preview = makePreview()
    const stamp = new Date().toISOString().slice(0, 10)
    const outPath = await deps.pickSavePath(`ieumoffice-diagnostics-${stamp}.zip`)
    if (!outPath) return { ok: false, cancelled: true }
    writeFileSync(outPath, buildDiagnosticsZip(preview))
    return { ok: true }
  })
}
