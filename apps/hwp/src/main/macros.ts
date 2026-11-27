/**
 * App-wide Hangul macro store persisted in `userData/hwp-macros.json` and
 * plain-text `.ieummacro` import/export helpers.
 *
 * Pure Node module with zero Electron imports so both the HWP main process and
 * CLI tools can read and mutate macros directly.
 *
 * Security invariants:
 * - Macros are stored exclusively in app data (`<userData>/hwp-macros.json`).
 *   Document files are never inspected or executed for embedded macros.
 * - Every disk mutation performs a synchronous read-modify-write via a unique
 *   temporary file (`wx` + `flush: true`) and atomic `renameSync`.
 * - Corrupt, oversized, or unreadable store files are preserved untouched with
 *   a deduplicated `.corrupt-<timestamp>` backup copy, and all writes are refused.
 * - Untrusted `.ieummacro` files are size-checked before reading, strictly
 *   validated as plain UTF-8 text, and previewed without saving until confirmed.
 */
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  constants as fsConstants,
  copyFileSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { SettingsPathProvider } from '@genoffice/electron-utils'

export const MACROS_FILE_NAME = 'hwp-macros.json'
export const MACROS_SCHEMA_VERSION = 1
export const MACRO_SLOT_MIN = 1
export const MACRO_SLOT_MAX = 11
export const MAX_MACROS_FILE_BYTES = 2 * 1024 * 1024
export const MAX_MACRO_IMPORT_BYTES = 256 * 1024
export const MAX_MACRO_SCRIPT_BYTES = 256 * 1024
export const MAX_MACRO_NAME_CHARS = 120
export const MAX_MACRO_DESCRIPTION_CHARS = 500
export const MACROS_NEAR_LIMIT_RATIO = 0.85
export const MACRO_ORIGINS = ['recorded', 'manual', 'ai', 'imported'] as const
export const MACRO_FILE_EXT = '.ieummacro'
export const MACRO_FILE_FORMAT_VERSION = 1

export type MacroOrigin = (typeof MACRO_ORIGINS)[number]

export interface MacroRecord {
  id: string
  name: string
  description?: string
  script: string
  slot: number | null
  origin: MacroOrigin
  createdAt: string
  updatedAt: string
}

export interface MacroCreateInput {
  name: string
  description?: string
  script: string
  slot?: number | null
  origin?: MacroOrigin
}

export interface MacroUpdatePatch {
  name?: string
  description?: string | null
  script?: string
  slot?: number | null
}

export interface MacroImportCommitInput {
  name: string
  description?: string
  script: string
  /** Ignored during import: imported macros always start with `slot: null`. */
  slot?: null
}

export type MacroSyntaxCheckResult =
  { ok: true } | { ok: false; error: string; line: number; column: number }

export type MacroSyntaxChecker = (script: string) => MacroSyntaxCheckResult

export interface MacroImportPreview {
  name: string
  description?: string
  script: string
  /** Shortcut slots are never imported from `.ieummacro` files. */
  slot?: null
  syntax?: MacroSyntaxCheckResult
}

export type MacroStoreFailureReason = 'library_corrupt' | 'library_too_large' | 'library_read_error'

export type MacrosState =
  | {
      ok: true
      exists: boolean
      macros: MacroRecord[]
      sizeBytes: number
      maxBytes: number
      nearLimit: boolean
    }
  | {
      ok: false
      reason: MacroStoreFailureReason
      error: string
      corruptBackupPath?: string
      sizeBytes?: number
      maxBytes: number
    }

export type MacroSlotValidationResult =
  { ok: true; slot: number | null } | { ok: false; error: string }

export type MacroAddResult =
  | {
      ok: true
      macro: MacroRecord
      macros: MacroRecord[]
      sizeBytes: number
      maxBytes: number
      nearLimit: boolean
    }
  | {
      ok: false
      reason: 'invalid_input' | 'too_large' | MacroStoreFailureReason | 'unauthorized'
      error: string
      corruptBackupPath?: string
      sizeBytes?: number
      maxBytes?: number
      actualBytes?: number
    }

export type MacroUpdateResult =
  | {
      ok: true
      macro: MacroRecord
      macros: MacroRecord[]
      sizeBytes: number
      maxBytes: number
      nearLimit: boolean
    }
  | {
      ok: false
      reason: 'invalid_input' | 'not_found' | 'too_large' | MacroStoreFailureReason | 'unauthorized'
      error: string
      corruptBackupPath?: string
      sizeBytes?: number
      maxBytes?: number
      actualBytes?: number
    }

export type MacroDeleteResult =
  | {
      ok: true
      deletedId: string
      macros: MacroRecord[]
      sizeBytes: number
      maxBytes: number
      nearLimit: boolean
    }
  | {
      ok: false
      reason: 'invalid_input' | 'not_found' | 'too_large' | MacroStoreFailureReason | 'unauthorized'
      error: string
      corruptBackupPath?: string
      sizeBytes?: number
      maxBytes?: number
      actualBytes?: number
    }

export type MacroAssignSlotResult = MacroUpdateResult

export type MacroParseFileResult =
  | {
      ok: true
      preview: MacroImportPreview
    }
  | {
      ok: false
      reason: 'too_large' | 'invalid_format'
      error: string
      maxBytes?: number
      actualBytes?: number
    }

export type MacroPreviewFileImportResult =
  | {
      ok: true
      fileName: string
      preview: MacroImportPreview
    }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'unreadable'
        | 'too_large'
        | 'invalid_format'
        | MacroStoreFailureReason
        | 'unauthorized'
      error: string
      corruptBackupPath?: string
      sizeBytes?: number
      maxBytes?: number
      actualBytes?: number
    }

export type MacroCommitImportResult = MacroAddResult

export type MacroWriteExportResult =
  | { ok: true; path: string; macroId: string; name: string }
  | { ok: false; reason: 'invalid_input' | 'write_failed'; error: string }

const BACKUP_SAMPLE_BYTES = 4096
const HEADER_VERSION_RE = /^\/\/\s*@ieum-macro\s*:\s*(\d+)\s*$/
const HEADER_FIELD_RE = /^\/\/\s*@([a-z-]+)\s*:\s*(.*)$/
const HEADER_SEPARATOR_RE = /^\/\/\s*---\s*$/
const HEADER_BLANK_COMMENT_RE = /^\/\/\s*$/
const LINE_BREAKS_RE = /[\r\n\t]+/g
const UTF8_STRICT_DECODER = new TextDecoder('utf-8', { fatal: true })

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isValidOrigin(value: unknown): value is MacroOrigin {
  return typeof value === 'string' && (MACRO_ORIGINS as readonly string[]).includes(value)
}

function stripNonWhitespaceControlChars(raw: string): string {
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    if (
      (code >= 0x00 && code <= 0x08) ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      code === 0x7f
    ) {
      continue
    }
    out += raw[i]
  }
  return out
}

function sanitizeHeaderLineText(raw: string): string {
  return stripNonWhitespaceControlChars(raw).replace(LINE_BREAKS_RE, ' ').trim()
}

function normalizeScriptLineEndings(raw: string): string {
  return raw.replace(/\r\n?/g, '\n')
}

function resolveStoreMaxBytes(maxBytes?: number): number {
  return typeof maxBytes === 'number' && Number.isFinite(maxBytes) && maxBytes > 0
    ? Math.floor(maxBytes)
    : MAX_MACROS_FILE_BYTES
}

function resolveImportMaxBytes(maxBytes?: number): number {
  return typeof maxBytes === 'number' && Number.isFinite(maxBytes) && maxBytes > 0
    ? Math.floor(maxBytes)
    : MAX_MACRO_IMPORT_BYTES
}

function isNearLimit(sizeBytes: number, maxBytes: number): boolean {
  return sizeBytes >= Math.floor(maxBytes * MACROS_NEAR_LIMIT_RATIO)
}

/**
 * Validate a macro shortcut slot (`null`/`undefined` or integer `1..11`).
 * Explicitly rejects `0`, negative numbers, values above `11`, non-integers,
 * and out-of-range integers such as `2147483648`.
 */
export function validateMacroSlot(slot: unknown): MacroSlotValidationResult {
  if (slot === null || slot === undefined) {
    return { ok: true, slot: null }
  }
  if (typeof slot !== 'number' || !Number.isInteger(slot)) {
    return {
      ok: false,
      error: `Macro shortcut slot must be null or an integer between ${MACRO_SLOT_MIN} and ${MACRO_SLOT_MAX}`,
    }
  }
  if (slot < MACRO_SLOT_MIN || slot > MACRO_SLOT_MAX) {
    return {
      ok: false,
      error: `Macro shortcut slot must be between ${MACRO_SLOT_MIN} and ${MACRO_SLOT_MAX} (got ${slot})`,
    }
  }
  return { ok: true, slot }
}

function validateMacroName(
  raw: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Macro name must be a string' }
  }
  if (raw.includes('\0')) {
    return { ok: false, error: 'Macro name cannot contain NUL bytes' }
  }
  const cleaned = sanitizeHeaderLineText(raw)
  if (!cleaned) {
    return { ok: false, error: 'Macro name cannot be empty' }
  }
  if (cleaned.length > MAX_MACRO_NAME_CHARS) {
    return {
      ok: false,
      error: `Macro name exceeds maximum length of ${MAX_MACRO_NAME_CHARS} characters`,
    }
  }
  return { ok: true, value: cleaned }
}

function validateMacroDescription(
  raw: unknown,
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: undefined }
  }
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Macro description must be a string' }
  }
  if (raw.includes('\0')) {
    return { ok: false, error: 'Macro description cannot contain NUL bytes' }
  }
  const cleaned = sanitizeHeaderLineText(raw)
  if (!cleaned) {
    return { ok: true, value: undefined }
  }
  if (cleaned.length > MAX_MACRO_DESCRIPTION_CHARS) {
    return {
      ok: false,
      error: `Macro description exceeds maximum length of ${MAX_MACRO_DESCRIPTION_CHARS} characters`,
    }
  }
  return { ok: true, value: cleaned }
}

function validateMacroScript(
  raw: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Macro script must be a string' }
  }
  if (raw.includes('\0')) {
    return { ok: false, error: 'Macro script cannot contain NUL bytes' }
  }
  const normalized = normalizeScriptLineEndings(raw)
  if (!normalized.trim()) {
    return { ok: false, error: 'Macro script cannot be empty' }
  }
  const byteLength = Buffer.byteLength(normalized, 'utf8')
  if (byteLength > MAX_MACRO_SCRIPT_BYTES) {
    return {
      ok: false,
      error: `Macro script exceeds maximum size of ${MAX_MACRO_SCRIPT_BYTES} bytes (got ${byteLength} bytes)`,
    }
  }
  return { ok: true, value: normalized }
}

function writeTextFileAtomicallySync(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(tempPath, content, {
      encoding: 'utf8',
      flag: 'wx',
      flush: true,
    })
    renameSync(tempPath, filePath)
  } catch (error) {
    try {
      unlinkSync(tempPath)
    } catch {
      // The write may have failed before the temporary file was created.
    }
    throw error
  }
}

function formatBackupTimestamp(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

function readHeadTailSample(filePath: string, fileSize: number): Buffer | null {
  let fd: number | null = null
  try {
    fd = openSync(filePath, 'r')
    if (fileSize <= BACKUP_SAMPLE_BYTES * 2) {
      const buf = Buffer.alloc(fileSize)
      let offset = 0
      while (offset < fileSize) {
        const read = readSync(fd, buf, offset, fileSize - offset, offset)
        if (read <= 0) break
        offset += read
      }
      return buf.subarray(0, offset)
    }
    const head = Buffer.alloc(BACKUP_SAMPLE_BYTES)
    const tail = Buffer.alloc(BACKUP_SAMPLE_BYTES)
    const headRead = readSync(fd, head, 0, BACKUP_SAMPLE_BYTES, 0)
    const tailRead = readSync(fd, tail, 0, BACKUP_SAMPLE_BYTES, fileSize - BACKUP_SAMPLE_BYTES)
    return Buffer.concat([head.subarray(0, headRead), tail.subarray(0, tailRead)])
  } catch {
    return null
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // Ignore close errors when inspecting backup candidates.
      }
    }
  }
}

function listCorruptBackupPaths(filePath: string): string[] {
  const dir = dirname(filePath)
  const prefix = `${basename(filePath)}.corrupt-`
  try {
    return readdirSync(dir)
      .filter((name) => name.startsWith(prefix))
      .sort()
      .reverse()
      .map((name) => join(dir, name))
  } catch {
    return []
  }
}

function createCorruptBackupFromBytes(filePath: string, rawBytes: Buffer): string | undefined {
  for (const existingPath of listCorruptBackupPaths(filePath)) {
    try {
      const existingStat = statSync(existingPath)
      if (existingStat.isFile() && existingStat.size === rawBytes.byteLength) {
        if (readFileSync(existingPath).equals(rawBytes)) {
          return existingPath
        }
      }
    } catch {
      // Skip unreadable backup candidates.
    }
  }

  const base = `${filePath}.corrupt-${formatBackupTimestamp()}`
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`
    try {
      writeFileSync(candidate, rawBytes, { flag: 'wx', flush: true })
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === 'EEXIST') continue
      return undefined
    }
  }
  return undefined
}

function createCorruptBackupFromDisk(filePath: string, fileSize: number): string | undefined {
  const sourceSample = readHeadTailSample(filePath, fileSize)
  if (sourceSample) {
    for (const existingPath of listCorruptBackupPaths(filePath)) {
      try {
        const existingStat = statSync(existingPath)
        if (existingStat.isFile() && existingStat.size === fileSize) {
          const existingSample = readHeadTailSample(existingPath, existingStat.size)
          if (existingSample && existingSample.equals(sourceSample)) {
            return existingPath
          }
        }
      } catch {
        // Skip unreadable backup candidates.
      }
    }
  }

  const base = `${filePath}.corrupt-${formatBackupTimestamp()}`
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`
    try {
      copyFileSync(filePath, candidate, fsConstants.COPYFILE_EXCL)
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === 'EEXIST') continue
      return undefined
    }
  }
  return undefined
}

function storeFailureOf(state: Extract<MacrosState, { ok: false }>): {
  ok: false
  reason: MacroStoreFailureReason
  error: string
  corruptBackupPath?: string
  sizeBytes?: number
  maxBytes: number
} {
  return {
    ok: false,
    reason: state.reason,
    error: state.error,
    ...(state.corruptBackupPath ? { corruptBackupPath: state.corruptBackupPath } : {}),
    ...(state.sizeBytes !== undefined ? { sizeBytes: state.sizeBytes } : {}),
    maxBytes: state.maxBytes,
  }
}

type SaveMacrosResult =
  | { ok: true; sizeBytes: number; maxBytes: number; nearLimit: boolean }
  | { ok: false; reason: 'too_large'; error: string; maxBytes: number; actualBytes: number }

function saveMacrosSync(
  filePath: string,
  macros: readonly MacroRecord[],
  maxBytes = MAX_MACROS_FILE_BYTES,
): SaveMacrosResult {
  const limit = resolveStoreMaxBytes(maxBytes)
  const payload = {
    version: MACROS_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    macros,
  }
  const serialized = `${JSON.stringify(payload, null, 2)}\n`
  const sizeBytes = Buffer.byteLength(serialized, 'utf8')
  if (sizeBytes > limit) {
    return {
      ok: false,
      reason: 'too_large',
      error: `Macro store exceeds maximum size of ${limit} bytes (got ${sizeBytes} bytes)`,
      maxBytes: limit,
      actualBytes: sizeBytes,
    }
  }
  writeTextFileAtomicallySync(filePath, serialized)
  return {
    ok: true,
    sizeBytes,
    maxBytes: limit,
    nearLimit: isNearLimit(sizeBytes, limit),
  }
}

function normalizeStoredMacros(rawMacros: readonly unknown[]): MacroRecord[] | null {
  const usedIds = new Set<string>()
  const usedSlots = new Set<number>()
  const normalized: MacroRecord[] = []
  const now = new Date().toISOString()

  for (const item of rawMacros) {
    if (!isPlainObject(item)) return null

    const nameRes = validateMacroName(item.name)
    if (!nameRes.ok) return null

    const scriptRes = validateMacroScript(item.script)
    if (!scriptRes.ok) return null

    const descRes = validateMacroDescription(item.description)
    if (!descRes.ok) return null

    const slotRes = validateMacroSlot(item.slot)
    if (!slotRes.ok) return null

    if (item.origin !== undefined && !isValidOrigin(item.origin)) return null
    const origin: MacroOrigin = item.origin ?? 'manual'

    let id =
      typeof item.id === 'string' && sanitizeHeaderLineText(item.id)
        ? sanitizeHeaderLineText(item.id)
        : randomUUID()
    while (usedIds.has(id)) {
      id = randomUUID()
    }
    usedIds.add(id)

    let slot = slotRes.slot
    if (slot !== null) {
      if (usedSlots.has(slot)) {
        slot = null
      } else {
        usedSlots.add(slot)
      }
    }

    const createdAt =
      typeof item.createdAt === 'string' && item.createdAt.trim() ? item.createdAt.trim() : now
    const updatedAt =
      typeof item.updatedAt === 'string' && item.updatedAt.trim()
        ? item.updatedAt.trim()
        : createdAt

    normalized.push({
      id,
      name: nameRes.value,
      ...(descRes.value !== undefined ? { description: descRes.value } : {}),
      script: scriptRes.value,
      slot,
      origin,
      createdAt,
      updatedAt,
    })
  }

  return normalized
}

function clearSlotCollision(
  macros: readonly MacroRecord[],
  slot: number | null,
  excludeId?: string,
): MacroRecord[] {
  if (slot === null) return macros.slice()
  return macros.map((item) => {
    if (item.slot === slot && item.id !== excludeId) {
      return { ...item, slot: null }
    }
    return item
  })
}

function runSyntaxChecker(
  script: string,
  syntaxChecker?: MacroSyntaxChecker,
): MacroSyntaxCheckResult | undefined {
  if (!syntaxChecker) return undefined
  try {
    return syntaxChecker(script)
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Syntax check failed',
      line: 1,
      column: 1,
    }
  }
}

/**
 * Resolve the path to the app-wide macro store (`hwp-macros.json`) inside
 * `userData` (or directly inside a provided directory path).
 */
export function macrosPathOf(appOrDir: SettingsPathProvider | string): string {
  const dir = typeof appOrDir === 'string' ? appOrDir : appOrDir.getPath('userData')
  return join(dir, MACROS_FILE_NAME)
}

/**
 * Inspect and load the app-wide macro store without mutating or deleting
 * `hwp-macros.json` on failure.
 *
 * - Missing file (`ENOENT`) returns `{ ok: true, exists: false, macros: [], ... }`.
 * - Valid file returns normalized records plus byte-size and near-limit telemetry.
 * - Corrupt, oversized, or unreadable files return `{ ok: false, reason, ... }`
 *   while leaving the original file untouched and preserving a `.corrupt-<timestamp>`
 *   backup copy beside it when bytes can be copied.
 */
export function readMacrosState(
  appOrDir: SettingsPathProvider | string,
  options?: { maxBytes?: number },
): MacrosState {
  const maxBytes = resolveStoreMaxBytes(options?.maxBytes)
  const filePath = macrosPathOf(appOrDir)

  let stats
  try {
    stats = statSync(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
      return {
        ok: true,
        exists: false,
        macros: [],
        sizeBytes: 0,
        maxBytes,
        nearLimit: false,
      }
    }
    return {
      ok: false,
      reason: 'library_read_error',
      error: error instanceof Error ? error.message : `Unable to inspect macro file: ${filePath}`,
      maxBytes,
    }
  }

  if (!stats.isFile()) {
    return {
      ok: false,
      reason: 'library_read_error',
      error: `Macro store path is not a file: ${filePath}`,
      maxBytes,
    }
  }

  if (stats.size > maxBytes) {
    const corruptBackupPath = createCorruptBackupFromDisk(filePath, stats.size)
    return {
      ok: false,
      reason: 'library_too_large',
      error: `Macro store exceeds maximum size of ${maxBytes} bytes (got ${stats.size} bytes)`,
      ...(corruptBackupPath ? { corruptBackupPath } : {}),
      sizeBytes: stats.size,
      maxBytes,
    }
  }

  let rawBuffer: Buffer
  try {
    rawBuffer = readFileSync(filePath)
  } catch (error) {
    return {
      ok: false,
      reason: 'library_read_error',
      error: error instanceof Error ? error.message : 'Unable to read macro store file',
      sizeBytes: stats.size,
      maxBytes,
    }
  }

  const sizeBytes = rawBuffer.byteLength
  const rawText = rawBuffer.toString('utf8')
  if (!rawText.trim()) {
    return {
      ok: true,
      exists: true,
      macros: [],
      sizeBytes,
      maxBytes,
      nearLimit: isNearLimit(sizeBytes, maxBytes),
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    const corruptBackupPath = createCorruptBackupFromBytes(filePath, rawBuffer)
    return {
      ok: false,
      reason: 'library_corrupt',
      error: 'Macro store file is not valid JSON',
      ...(corruptBackupPath ? { corruptBackupPath } : {}),
      sizeBytes,
      maxBytes,
    }
  }

  if (
    !isPlainObject(parsed) ||
    !Array.isArray(parsed.macros) ||
    (parsed.version !== undefined && parsed.version !== MACROS_SCHEMA_VERSION)
  ) {
    const corruptBackupPath = createCorruptBackupFromBytes(filePath, rawBuffer)
    return {
      ok: false,
      reason: 'library_corrupt',
      error: 'Macro store JSON must be an object with version 1 and a macros array',
      ...(corruptBackupPath ? { corruptBackupPath } : {}),
      sizeBytes,
      maxBytes,
    }
  }

  const macros = normalizeStoredMacros(parsed.macros)
  if (macros === null) {
    const corruptBackupPath = createCorruptBackupFromBytes(filePath, rawBuffer)
    return {
      ok: false,
      reason: 'library_corrupt',
      error: 'Macro store contains invalid macro records',
      ...(corruptBackupPath ? { corruptBackupPath } : {}),
      sizeBytes,
      maxBytes,
    }
  }

  return {
    ok: true,
    exists: true,
    macros,
    sizeBytes,
    maxBytes,
    nearLimit: isNearLimit(sizeBytes, maxBytes),
  }
}

/** Add a macro to the app-wide macro store synchronously. */
export function addMacro(
  appOrDir: SettingsPathProvider | string,
  rawInput: unknown,
  options?: { maxBytes?: number },
): MacroAddResult {
  if (!isPlainObject(rawInput)) {
    return { ok: false, reason: 'invalid_input', error: 'Macro input must be an object' }
  }

  const nameRes = validateMacroName(rawInput.name)
  if (!nameRes.ok) return { ok: false, reason: 'invalid_input', error: nameRes.error }

  const descRes = validateMacroDescription(rawInput.description)
  if (!descRes.ok) return { ok: false, reason: 'invalid_input', error: descRes.error }

  const scriptRes = validateMacroScript(rawInput.script)
  if (!scriptRes.ok) return { ok: false, reason: 'invalid_input', error: scriptRes.error }

  const slotRes = validateMacroSlot(rawInput.slot)
  if (!slotRes.ok) return { ok: false, reason: 'invalid_input', error: slotRes.error }

  if (rawInput.origin !== undefined && !isValidOrigin(rawInput.origin)) {
    return {
      ok: false,
      reason: 'invalid_input',
      error: `Invalid macro origin: ${String(rawInput.origin)}`,
    }
  }
  const origin: MacroOrigin = rawInput.origin ?? 'manual'

  const state = readMacrosState(appOrDir, { maxBytes: options?.maxBytes })
  if (!state.ok) {
    return storeFailureOf(state)
  }

  const filePath = macrosPathOf(appOrDir)
  const now = new Date().toISOString()
  const macro: MacroRecord = {
    id: randomUUID(),
    name: nameRes.value,
    ...(descRes.value !== undefined ? { description: descRes.value } : {}),
    script: scriptRes.value,
    slot: slotRes.slot,
    origin,
    createdAt: now,
    updatedAt: now,
  }

  const cleared = clearSlotCollision(state.macros, macro.slot)
  const nextMacros = [...cleared, macro]
  const saved = saveMacrosSync(filePath, nextMacros, options?.maxBytes)
  if (!saved.ok) {
    return saved
  }

  return {
    ok: true,
    macro,
    macros: nextMacros,
    sizeBytes: saved.sizeBytes,
    maxBytes: saved.maxBytes,
    nearLimit: saved.nearLimit,
  }
}

/** Update an existing macro in the app-wide macro store synchronously. */
export function updateMacro(
  appOrDir: SettingsPathProvider | string,
  id: unknown,
  rawPatch: unknown,
  options?: { maxBytes?: number },
): MacroUpdateResult {
  if (typeof id !== 'string' || !id.trim()) {
    return { ok: false, reason: 'invalid_input', error: 'Macro id is required' }
  }
  if (!isPlainObject(rawPatch)) {
    return { ok: false, reason: 'invalid_input', error: 'Macro update patch must be an object' }
  }

  let nextName: string | undefined
  if ('name' in rawPatch) {
    const nameRes = validateMacroName(rawPatch.name)
    if (!nameRes.ok) return { ok: false, reason: 'invalid_input', error: nameRes.error }
    nextName = nameRes.value
  }

  let hasDescriptionPatch = false
  let nextDescription: string | undefined
  if ('description' in rawPatch) {
    hasDescriptionPatch = true
    const descRes = validateMacroDescription(rawPatch.description)
    if (!descRes.ok) return { ok: false, reason: 'invalid_input', error: descRes.error }
    nextDescription = descRes.value
  }

  let nextScript: string | undefined
  if ('script' in rawPatch) {
    const scriptRes = validateMacroScript(rawPatch.script)
    if (!scriptRes.ok) return { ok: false, reason: 'invalid_input', error: scriptRes.error }
    nextScript = scriptRes.value
  }

  let hasSlotPatch = false
  let nextSlot: number | null = null
  if ('slot' in rawPatch) {
    hasSlotPatch = true
    const slotRes = validateMacroSlot(rawPatch.slot)
    if (!slotRes.ok) return { ok: false, reason: 'invalid_input', error: slotRes.error }
    nextSlot = slotRes.slot
  }

  const state = readMacrosState(appOrDir, { maxBytes: options?.maxBytes })
  if (!state.ok) {
    return storeFailureOf(state)
  }

  const targetId = id.trim()
  const index = state.macros.findIndex((item) => item.id === targetId)
  if (index < 0) {
    return { ok: false, reason: 'not_found', error: `Macro not found: ${targetId}` }
  }

  const existing = state.macros[index]
  const resolvedSlot = hasSlotPatch ? nextSlot : existing.slot
  const resolvedDescription = hasDescriptionPatch ? nextDescription : existing.description
  const updated: MacroRecord = {
    id: existing.id,
    name: nextName ?? existing.name,
    ...(resolvedDescription !== undefined ? { description: resolvedDescription } : {}),
    script: nextScript ?? existing.script,
    slot: resolvedSlot,
    origin: existing.origin,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  }

  const base = hasSlotPatch
    ? clearSlotCollision(state.macros, resolvedSlot, existing.id)
    : state.macros.slice()
  base[index] = updated

  const filePath = macrosPathOf(appOrDir)
  const saved = saveMacrosSync(filePath, base, options?.maxBytes)
  if (!saved.ok) {
    return saved
  }

  return {
    ok: true,
    macro: updated,
    macros: base,
    sizeBytes: saved.sizeBytes,
    maxBytes: saved.maxBytes,
    nearLimit: saved.nearLimit,
  }
}

/** Delete a macro from the app-wide macro store synchronously. */
export function deleteMacro(
  appOrDir: SettingsPathProvider | string,
  id: unknown,
  options?: { maxBytes?: number },
): MacroDeleteResult {
  if (typeof id !== 'string' || !id.trim()) {
    return { ok: false, reason: 'invalid_input', error: 'Macro id is required' }
  }

  const state = readMacrosState(appOrDir, { maxBytes: options?.maxBytes })
  if (!state.ok) {
    return storeFailureOf(state)
  }

  const targetId = id.trim()
  const index = state.macros.findIndex((item) => item.id === targetId)
  if (index < 0) {
    return { ok: false, reason: 'not_found', error: `Macro not found: ${targetId}` }
  }

  const nextMacros = state.macros.filter((item) => item.id !== targetId)
  const filePath = macrosPathOf(appOrDir)
  const saved = saveMacrosSync(filePath, nextMacros, options?.maxBytes)
  if (!saved.ok) {
    return saved
  }

  return {
    ok: true,
    deletedId: targetId,
    macros: nextMacros,
    sizeBytes: saved.sizeBytes,
    maxBytes: saved.maxBytes,
    nearLimit: saved.nearLimit,
  }
}

/**
 * Assign a shortcut slot (`1..11` or `null`) to an existing macro synchronously,
 * clearing that slot from any previous holder so each slot has at most one macro.
 */
export function assignMacroSlot(
  appOrDir: SettingsPathProvider | string,
  id: unknown,
  slot: unknown,
  options?: { maxBytes?: number },
): MacroAssignSlotResult {
  if (typeof id !== 'string' || !id.trim()) {
    return { ok: false, reason: 'invalid_input', error: 'Macro id is required' }
  }
  const slotRes = validateMacroSlot(slot)
  if (!slotRes.ok) {
    return { ok: false, reason: 'invalid_input', error: slotRes.error }
  }

  const state = readMacrosState(appOrDir, { maxBytes: options?.maxBytes })
  if (!state.ok) {
    return storeFailureOf(state)
  }

  const targetId = id.trim()
  const index = state.macros.findIndex((item) => item.id === targetId)
  if (index < 0) {
    return { ok: false, reason: 'not_found', error: `Macro not found: ${targetId}` }
  }

  const existing = state.macros[index]
  const updated: MacroRecord = {
    ...existing,
    slot: slotRes.slot,
    updatedAt: new Date().toISOString(),
  }

  const nextMacros = clearSlotCollision(state.macros, slotRes.slot, existing.id)
  nextMacros[index] = updated

  const filePath = macrosPathOf(appOrDir)
  const saved = saveMacrosSync(filePath, nextMacros, options?.maxBytes)
  if (!saved.ok) {
    return saved
  }

  return {
    ok: true,
    macro: updated,
    macros: nextMacros,
    sizeBytes: saved.sizeBytes,
    maxBytes: saved.maxBytes,
    nearLimit: saved.nearLimit,
  }
}

/**
 * Serialize a macro into the human-readable plain-text `.ieummacro` format.
 * Header fields are stripped of control characters and line breaks so they
 * cannot spoof the header separator, while the script body is written verbatim
 * without JSON escaping.
 */
export function serializeMacroFile(macro: {
  name: string
  description?: string
  script: string
}): string {
  const nameRes = validateMacroName(macro.name)
  if (!nameRes.ok) {
    throw new Error(nameRes.error)
  }
  const descRes = validateMacroDescription(macro.description)
  if (!descRes.ok) {
    throw new Error(descRes.error)
  }
  const scriptRes = validateMacroScript(macro.script)
  if (!scriptRes.ok) {
    throw new Error(scriptRes.error)
  }

  const lines = [`// @ieum-macro: ${MACRO_FILE_FORMAT_VERSION}`, `// @name: ${nameRes.value}`]
  if (descRes.value !== undefined) {
    lines.push(`// @description: ${descRes.value}`)
  }
  lines.push('// ---')
  return `${lines.join('\n')}\n${scriptRes.value}\n`
}

/**
 * Parse and validate an untrusted plain-text `.ieummacro` payload.
 * Rejects oversized payloads, binary/NUL bytes, invalid UTF-8, missing or
 * unsupported headers, empty names, and empty scripts. Runs an optional
 * `syntaxChecker` and attaches its diagnostic result to the preview.
 */
export function parseMacroFile(
  input: string | Uint8Array,
  options?: { maxBytes?: number; syntaxChecker?: MacroSyntaxChecker },
): MacroParseFileResult {
  const maxBytes = resolveImportMaxBytes(options?.maxBytes)
  let rawText: string

  if (typeof input === 'string') {
    const actualBytes = Buffer.byteLength(input, 'utf8')
    if (actualBytes > maxBytes) {
      return {
        ok: false,
        reason: 'too_large',
        error: `Macro file exceeds maximum size of ${maxBytes} bytes (got ${actualBytes} bytes)`,
        maxBytes,
        actualBytes,
      }
    }
    if (input.includes('\0')) {
      return {
        ok: false,
        reason: 'invalid_format',
        error: 'Macro file contains NUL bytes and cannot be imported as text',
      }
    }
    rawText = input
  } else if (input instanceof Uint8Array) {
    if (input.byteLength > maxBytes) {
      return {
        ok: false,
        reason: 'too_large',
        error: `Macro file exceeds maximum size of ${maxBytes} bytes (got ${input.byteLength} bytes)`,
        maxBytes,
        actualBytes: input.byteLength,
      }
    }
    for (let i = 0; i < input.byteLength; i++) {
      if (input[i] === 0) {
        return {
          ok: false,
          reason: 'invalid_format',
          error: 'Macro file contains binary NUL bytes and cannot be imported as text',
        }
      }
    }
    try {
      rawText = UTF8_STRICT_DECODER.decode(input)
    } catch {
      return {
        ok: false,
        reason: 'invalid_format',
        error: 'Macro file is not valid UTF-8 text',
      }
    }
  } else {
    return {
      ok: false,
      reason: 'invalid_format',
      error: 'Macro file payload must be text or bytes',
    }
  }

  const normalized = normalizeScriptLineEndings(rawText.replace(/^\uFEFF/, ''))
  const lines = normalized.split('\n')
  if (lines.length === 0) {
    return {
      ok: false,
      reason: 'invalid_format',
      error: 'Macro file is empty',
    }
  }

  const versionMatch = HEADER_VERSION_RE.exec(lines[0])
  if (!versionMatch || Number(versionMatch[1]) !== MACRO_FILE_FORMAT_VERSION) {
    return {
      ok: false,
      reason: 'invalid_format',
      error: `Macro file must start with "// @ieum-macro: ${MACRO_FILE_FORMAT_VERSION}"`,
    }
  }

  let rawName: string | undefined
  let rawDescription: string | undefined
  let separatorIndex = -1

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (HEADER_SEPARATOR_RE.test(line)) {
      separatorIndex = i
      break
    }
    if (HEADER_BLANK_COMMENT_RE.test(line)) {
      continue
    }
    const fieldMatch = HEADER_FIELD_RE.exec(line)
    if (!fieldMatch) {
      return {
        ok: false,
        reason: 'invalid_format',
        error: `Unexpected line in macro header at line ${i + 1}`,
      }
    }
    const key = fieldMatch[1]
    const value = fieldMatch[2]
    if (key === 'name') {
      rawName = value
    } else if (key === 'description') {
      rawDescription = value
    } else if (key === 'slot') {
      // Shortcut slots are never imported from untrusted `.ieummacro` files
      // so an imported macro can never steal an existing user shortcut.
      continue
    } else {
      return {
        ok: false,
        reason: 'invalid_format',
        error: `Unknown macro header field: @${key}`,
      }
    }
  }

  if (separatorIndex < 0) {
    return {
      ok: false,
      reason: 'invalid_format',
      error: 'Macro file is missing the "// ---" header separator',
    }
  }

  const nameRes = validateMacroName(rawName)
  if (!nameRes.ok) {
    return { ok: false, reason: 'invalid_format', error: nameRes.error }
  }

  const descRes = validateMacroDescription(rawDescription)
  if (!descRes.ok) {
    return { ok: false, reason: 'invalid_format', error: descRes.error }
  }

  let scriptBody = lines.slice(separatorIndex + 1).join('\n')
  if (scriptBody.endsWith('\n')) {
    scriptBody = scriptBody.slice(0, -1)
  }
  const scriptRes = validateMacroScript(scriptBody)
  if (!scriptRes.ok) {
    return { ok: false, reason: 'invalid_format', error: scriptRes.error }
  }

  const syntax = runSyntaxChecker(scriptRes.value, options?.syntaxChecker)
  return {
    ok: true,
    preview: {
      name: nameRes.value,
      ...(descRes.value !== undefined ? { description: descRes.value } : {}),
      script: scriptRes.value,
      ...(syntax !== undefined ? { syntax } : {}),
    },
  }
}

/**
 * Read-only import preview from disk: checks `statSync(filePath).size` against
 * `MAX_MACRO_IMPORT_BYTES` before loading into memory, parses the `.ieummacro`
 * file, and NEVER writes to `hwp-macros.json`.
 */
export function previewMacroFileImport(
  filePath: string,
  options?: { maxBytes?: number; syntaxChecker?: MacroSyntaxChecker },
): MacroPreviewFileImportResult {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return { ok: false, reason: 'not_found', error: 'Import file path is required' }
  }

  const maxBytes = resolveImportMaxBytes(options?.maxBytes)

  let stats
  try {
    stats = statSync(filePath)
  } catch {
    return { ok: false, reason: 'not_found', error: 'Selected macro file could not be found' }
  }
  if (!stats.isFile()) {
    return { ok: false, reason: 'not_found', error: 'Selected path is not a file' }
  }
  if (stats.size > maxBytes) {
    return {
      ok: false,
      reason: 'too_large',
      error: `Macro file exceeds maximum allowed size of ${maxBytes} bytes (got ${stats.size} bytes)`,
      maxBytes,
      actualBytes: stats.size,
    }
  }

  let bytes: Uint8Array
  try {
    bytes = readFileSync(filePath)
  } catch {
    return { ok: false, reason: 'unreadable', error: 'Selected macro file could not be read' }
  }

  const parsed = parseMacroFile(bytes, {
    maxBytes,
    syntaxChecker: options?.syntaxChecker,
  })
  if (!parsed.ok) {
    return parsed
  }

  return {
    ok: true,
    fileName: basename(filePath),
    preview: parsed.preview,
  }
}

/**
 * Commit a user-confirmed imported macro synchronously into `hwp-macros.json`.
 * Always records `origin: 'imported'` and `slot: null` regardless of
 * caller-supplied fields so an import can never steal an existing shortcut slot.
 */
export function commitMacroImport(
  appOrDir: SettingsPathProvider | string,
  rawInput: unknown,
  options?: { maxBytes?: number },
): MacroCommitImportResult {
  if (!isPlainObject(rawInput)) {
    return { ok: false, reason: 'invalid_input', error: 'Imported macro payload must be an object' }
  }

  return addMacro(
    appOrDir,
    {
      name: rawInput.name,
      description: rawInput.description,
      script: rawInput.script,
      slot: null,
      origin: 'imported',
    },
    options,
  )
}

/**
 * Serialize and atomically write a single macro to disk in plain-text
 * `.ieummacro` format.
 */
export function writeMacroExportFile(filePath: string, macro: MacroRecord): MacroWriteExportResult {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return { ok: false, reason: 'invalid_input', error: 'Export file path is required' }
  }
  if (!isPlainObject(macro) || typeof macro.id !== 'string' || !macro.id.trim()) {
    return { ok: false, reason: 'invalid_input', error: 'Valid macro record is required' }
  }

  let content: string
  try {
    content = serializeMacroFile(macro)
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid_input',
      error: error instanceof Error ? error.message : 'Invalid macro record',
    }
  }

  try {
    writeTextFileAtomicallySync(filePath, content)
    return {
      ok: true,
      path: filePath,
      macroId: macro.id,
      name: macro.name,
    }
  } catch (error) {
    return {
      ok: false,
      reason: 'write_failed',
      error: error instanceof Error ? error.message : 'Failed to write macro export file',
    }
  }
}
