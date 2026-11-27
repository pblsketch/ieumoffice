/**
 * App-wide Hangul bibliography library store persisted in `userData/hwp-bibliography.json`.
 *
 * Pure Node module with zero Electron imports so both the HWP main process and
 * `@genoffice/cli` can read and mutate the library directly. Every disk mutation
 * performs a synchronous read-modify-write via a unique temporary file (`wx` +
 * `flush: true`) and atomic `renameSync`, matching `outline-settings.ts`.
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
import {
  BIBLIOGRAPHY_FORMATS,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ENTRIES,
  exportBibliography,
  parseBibliographyFile,
  planImportPreview,
  sanitizeImportedField,
} from '../../studio-plugin/citation-io.mjs'
import type {
  BibliographyFormat,
  DuplicateMatch,
  DuplicateMatchOptions,
  ImportFailureReason,
  ImportPreviewPlan,
} from '../../studio-plugin/citation-io.mjs'
import {
  ENTRY_SOURCES,
  generateCitationKey,
  normalizeBibEntry,
  renameBibEntryKey,
  sanitizeCitationKey,
} from '../../studio-plugin/citation-styles.mjs'
import type {
  BibAuthorInput,
  BibEntry,
  BibEntryInput,
  BibEntrySource,
} from '../../studio-plugin/citation-styles.mjs'

export const BIBLIOGRAPHY_FILE_NAME = 'hwp-bibliography.json'
export const BIBLIOGRAPHY_SCHEMA_VERSION = 1
export const MAX_BIBLIOGRAPHY_FILE_BYTES = 20 * 1024 * 1024
export const BIBLIOGRAPHY_NEAR_LIMIT_RATIO = 0.85

export { BIBLIOGRAPHY_FORMATS, MAX_IMPORT_BYTES, MAX_IMPORT_ENTRIES }
export type {
  BibAuthorInput,
  BibEntry,
  BibEntryInput,
  BibEntrySource,
  BibliographyFormat,
  DuplicateMatch,
  DuplicateMatchOptions,
  ImportFailureReason,
  ImportPreviewPlan,
}

export type BibActor = 'user' | 'ai'

export type BibLibraryFailureReason = 'library_corrupt' | 'library_too_large' | 'library_read_error'

export type BibLibraryState =
  | {
      ok: true
      exists: boolean
      entries: BibEntry[]
      tags: string[]
      sizeBytes: number
      maxBytes: number
      nearLimit: boolean
    }
  | {
      ok: false
      reason: BibLibraryFailureReason
      error: string
      corruptBackupPath?: string
      sizeBytes?: number
      maxBytes: number
    }

export interface BibKeyRenameInfo {
  id: string
  oldKey: string
  newKey: string
  title: string
}

export interface BibAiCandidateInput extends BibEntryInput {
  sourceUrl?: string
}

export interface BibCommitImportOptions {
  source?: 'import' | 'document'
  skipDuplicates?: boolean
  maxBytes?: number
}

export interface BibExportOptions {
  tag?: string
  ids?: readonly string[]
}

export type LoadBibliographyFileResult =
  | {
      ok: true
      entries: BibEntry[]
      sizeBytes: number
      maxBytes: number
      nearLimit: boolean
    }
  | {
      ok: false
      reason: 'not_found' | 'too_large' | 'invalid_format' | 'read_error'
      error: string
      maxBytes?: number
      actualBytes?: number
    }

export type BibAddResult =
  | {
      ok: true
      entry: BibEntry
      entries: BibEntry[]
      sizeBytes: number
      maxBytes: number
      nearLimit: boolean
    }
  | {
      ok: false
      reason: 'invalid_input' | 'too_large' | BibLibraryFailureReason | 'unauthorized'
      error: string
      corruptBackupPath?: string
      sizeBytes?: number
      maxBytes?: number
      actualBytes?: number
    }

export type BibAddAiCandidatesResult =
  | {
      ok: true
      added: BibEntry[]
      duplicates: DuplicateMatch[]
      entries: BibEntry[]
      sizeBytes: number
      maxBytes: number
      nearLimit: boolean
    }
  | {
      ok: false
      reason:
        | 'invalid_input'
        | 'missing_source_url'
        | 'too_large'
        | BibLibraryFailureReason
        | 'unauthorized'
      error: string
      corruptBackupPath?: string
      sizeBytes?: number
      maxBytes?: number
      actualBytes?: number
    }

export type BibUpdateResult =
  | {
      ok: true
      entry: BibEntry
      entries: BibEntry[]
      renamedKey?: BibKeyRenameInfo
      sizeBytes: number
      maxBytes: number
      nearLimit: boolean
    }
  | {
      ok: false
      reason:
        | 'invalid_input'
        | 'invalid_key'
        | 'duplicate_key'
        | 'not_found'
        | 'ai_cannot_verify'
        | 'too_large'
        | BibLibraryFailureReason
        | 'unauthorized'
      error: string
      corruptBackupPath?: string
      sizeBytes?: number
      maxBytes?: number
      actualBytes?: number
    }

export type BibVerifyResult =
  | {
      ok: true
      entry: BibEntry
      entries: BibEntry[]
      sizeBytes: number
      maxBytes: number
      nearLimit: boolean
    }
  | {
      ok: false
      reason: 'invalid_input' | 'not_found' | 'too_large' | BibLibraryFailureReason | 'unauthorized'
      error: string
      corruptBackupPath?: string
      sizeBytes?: number
      maxBytes?: number
      actualBytes?: number
    }

export type BibDeleteResult =
  | {
      ok: true
      deletedId: string
      entries: BibEntry[]
      sizeBytes: number
      maxBytes: number
      nearLimit: boolean
    }
  | {
      ok: false
      reason: 'invalid_input' | 'not_found' | 'too_large' | BibLibraryFailureReason | 'unauthorized'
      error: string
      corruptBackupPath?: string
      sizeBytes?: number
      maxBytes?: number
      actualBytes?: number
    }

export type BibPreviewImportResult =
  | { ok: true; preview: ImportPreviewPlan }
  | {
      ok: false
      reason: 'empty' | 'invalid_input' | BibLibraryFailureReason | 'unauthorized'
      error: string
      corruptBackupPath?: string
      sizeBytes?: number
      maxBytes?: number
    }

export type BibPreviewFileImportResult =
  | {
      ok: true
      fileName: string
      format: BibliographyFormat
      preview: ImportPreviewPlan
      warnings: string[]
    }
  | {
      ok: false
      reason:
        ImportFailureReason | 'not_found' | 'unreadable' | BibLibraryFailureReason | 'unauthorized'
      error: string
      format?: BibliographyFormat | null
      warnings?: string[]
      corruptBackupPath?: string
      sizeBytes?: number
      maxBytes?: number
      actualBytes?: number
    }

export type BibCommitImportResult =
  | {
      ok: true
      added: BibEntry[]
      skippedDuplicates: DuplicateMatch[]
      entries: BibEntry[]
      sizeBytes: number
      maxBytes: number
      nearLimit: boolean
    }
  | {
      ok: false
      reason: 'empty' | 'invalid_input' | 'too_large' | BibLibraryFailureReason | 'unauthorized'
      error: string
      corruptBackupPath?: string
      sizeBytes?: number
      maxBytes?: number
      actualBytes?: number
    }

export type BibWriteExportResult =
  | { ok: true; path: string; count: number; format: BibliographyFormat }
  | { ok: false; reason: 'invalid_input' | 'invalid_format' | 'write_failed'; error: string }

const TAG_COLLATOR = new Intl.Collator('ko', { sensitivity: 'base', numeric: true })
const HTTP_URL_IN_TEXT_RE = /https?:\/\/[^\s<>)"'`]+/i

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isBibliographyFormat(value: unknown): value is BibliographyFormat {
  return typeof value === 'string' && BIBLIOGRAPHY_FORMATS.includes(value as BibliographyFormat)
}

function isValidSource(value: unknown): value is BibEntrySource {
  return typeof value === 'string' && ENTRY_SOURCES.includes(value as BibEntrySource)
}

function indexToAlphaSuffix(index: number): string {
  let n = index
  let out = ''
  while (n >= 0) {
    out = String.fromCharCode(97 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  }
  return out
}

function collectUsedKeysAndIds(entries: readonly BibEntry[]): {
  usedKeys: Set<string>
  usedIds: Set<string>
} {
  const usedKeys = new Set<string>()
  const usedIds = new Set<string>()
  for (const entry of entries) {
    if (entry.key) usedKeys.add(entry.key)
    for (const oldKey of entry.oldKeys) {
      if (oldKey) usedKeys.add(oldKey)
    }
    if (entry.id) usedIds.add(entry.id)
  }
  return { usedKeys, usedIds }
}

function allocateUniqueKey(
  rawKey: string | undefined,
  draft: Partial<BibEntryInput>,
  usedKeys: Set<string>,
): string {
  if (rawKey !== undefined) {
    const sanitized = sanitizeCitationKey(rawKey)
    if (sanitized) {
      if (!usedKeys.has(sanitized)) {
        usedKeys.add(sanitized)
        return sanitized
      }
      for (let i = 0; ; i++) {
        const candidate = `${sanitized}${indexToAlphaSuffix(i)}`
        if (!usedKeys.has(candidate)) {
          usedKeys.add(candidate)
          return candidate
        }
      }
    }
  }
  const generated = generateCitationKey(draft, usedKeys)
  usedKeys.add(generated)
  return generated
}

function allocateUniqueId(
  preferredId: string | undefined,
  key: string,
  usedIds: Set<string>,
): string {
  const cleaned = preferredId ? sanitizeImportedField(preferredId) : ''
  const base = cleaned || `bib_${key}`
  if (!usedIds.has(base)) {
    usedIds.add(base)
    return base
  }
  let n = 2
  while (usedIds.has(`${base}_${n}`)) n += 1
  const allocated = `${base}_${n}`
  usedIds.add(allocated)
  return allocated
}

function sanitizeAuthorList(raw: unknown): BibAuthorInput[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: BibAuthorInput[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      const cleaned = sanitizeImportedField(item)
      if (cleaned) out.push(cleaned)
    } else if (isPlainObject(item)) {
      const family =
        typeof item.family === 'string' ? sanitizeImportedField(item.family) : undefined
      const given = typeof item.given === 'string' ? sanitizeImportedField(item.given) : undefined
      const literal =
        typeof item.literal === 'string' ? sanitizeImportedField(item.literal) : undefined
      const isOrganization = item.isOrganization === true ? true : undefined
      if (family || given || literal) {
        out.push({
          ...(family ? { family } : {}),
          ...(given ? { given } : {}),
          ...(literal ? { literal } : {}),
          ...(isOrganization ? { isOrganization } : {}),
        })
      }
    }
  }
  return out
}

function sanitizeStringList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: string[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      const cleaned = sanitizeImportedField(item)
      if (cleaned) out.push(cleaned)
    }
  }
  return out
}

function sanitizeStringField(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  return sanitizeImportedField(String(value))
}

function sanitizeEntryInput(raw: Record<string, unknown>): BibEntryInput {
  const out: BibEntryInput = {}
  if ('id' in raw) out.id = sanitizeStringField(raw.id)
  if ('key' in raw) out.key = sanitizeStringField(raw.key)
  if ('oldKeys' in raw) out.oldKeys = sanitizeStringList(raw.oldKeys)
  if ('type' in raw && typeof raw.type === 'string') out.type = sanitizeImportedField(raw.type)
  if ('authors' in raw) out.authors = sanitizeAuthorList(raw.authors)
  if ('editors' in raw) out.editors = sanitizeAuthorList(raw.editors)
  if ('year' in raw) out.year = sanitizeStringField(raw.year)
  if ('title' in raw) out.title = sanitizeStringField(raw.title)
  if ('containerTitle' in raw) out.containerTitle = sanitizeStringField(raw.containerTitle)
  if ('volume' in raw) out.volume = sanitizeStringField(raw.volume)
  if ('issue' in raw) out.issue = sanitizeStringField(raw.issue)
  if ('pages' in raw) out.pages = sanitizeStringField(raw.pages)
  if ('publisher' in raw) out.publisher = sanitizeStringField(raw.publisher)
  if ('place' in raw) out.place = sanitizeStringField(raw.place)
  if ('edition' in raw) out.edition = sanitizeStringField(raw.edition)
  if ('degree' in raw) out.degree = sanitizeStringField(raw.degree)
  if ('institution' in raw) out.institution = sanitizeStringField(raw.institution)
  if ('doi' in raw) out.doi = sanitizeStringField(raw.doi)
  if ('url' in raw) out.url = sanitizeStringField(raw.url)
  if ('accessed' in raw) out.accessed = sanitizeStringField(raw.accessed)
  if ('language' in raw && (raw.language === 'ko' || raw.language === 'en')) {
    out.language = raw.language
  }
  if ('tags' in raw) out.tags = sanitizeStringList(raw.tags)
  if ('memo' in raw) out.memo = sanitizeStringField(raw.memo)
  if ('verified' in raw && typeof raw.verified === 'boolean') out.verified = raw.verified
  if ('source' in raw && isValidSource(raw.source)) out.source = raw.source
  if ('createdAt' in raw) out.createdAt = sanitizeStringField(raw.createdAt)
  if ('updatedAt' in raw) out.updatedAt = sanitizeStringField(raw.updatedAt)
  return out
}

function normalizeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = sanitizeImportedField(raw).replace(/[.,;]+$/, '')
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (!parsed.hostname) return null
    return parsed.href
  } catch {
    return null
  }
}

function extractAiSourceUrl(candidate: Record<string, unknown>): string | null {
  const explicit = normalizeHttpUrl(candidate.sourceUrl)
  if (explicit) return explicit
  const fromUrl = normalizeHttpUrl(candidate.url)
  if (fromUrl) return fromUrl
  if (typeof candidate.memo === 'string') {
    const match = HTTP_URL_IN_TEXT_RE.exec(candidate.memo)
    if (match) {
      const fromMemo = normalizeHttpUrl(match[0])
      if (fromMemo) return fromMemo
    }
  }
  return null
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

type SaveBibliographyResult =
  | { ok: true; sizeBytes: number; maxBytes: number; nearLimit: boolean }
  | { ok: false; reason: 'too_large'; error: string; maxBytes: number; actualBytes: number }

const BACKUP_SAMPLE_BYTES = 4096

function resolveMaxBytes(maxBytes?: number): number {
  return typeof maxBytes === 'number' && Number.isFinite(maxBytes) && maxBytes > 0
    ? Math.floor(maxBytes)
    : MAX_BIBLIOGRAPHY_FILE_BYTES
}

function isNearLimit(sizeBytes: number, maxBytes: number): boolean {
  return sizeBytes >= Math.floor(maxBytes * BIBLIOGRAPHY_NEAR_LIMIT_RATIO)
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

function libraryFailureOf(state: Extract<BibLibraryState, { ok: false }>): {
  ok: false
  reason: BibLibraryFailureReason
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

function saveBibliographySync(
  filePath: string,
  entries: readonly BibEntry[],
  maxBytes = MAX_BIBLIOGRAPHY_FILE_BYTES,
): SaveBibliographyResult {
  const limit = resolveMaxBytes(maxBytes)
  const payload = {
    version: BIBLIOGRAPHY_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    entries,
  }
  const serialized = `${JSON.stringify(payload, null, 2)}\n`
  const sizeBytes = Buffer.byteLength(serialized, 'utf8')
  if (sizeBytes > limit) {
    return {
      ok: false,
      reason: 'too_large',
      error: `Bibliography library exceeds maximum size of ${limit} bytes (got ${sizeBytes} bytes)`,
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

function normalizeStoredEntries(rawEntries: readonly unknown[]): BibEntry[] {
  const usedKeys = new Set<string>()
  const usedIds = new Set<string>()
  const entries: BibEntry[] = []

  for (const item of rawEntries) {
    if (!isPlainObject(item)) continue
    const sanitized = sanitizeEntryInput(item)
    const title = sanitized.title ?? ''
    const key = allocateUniqueKey(sanitized.key, { ...sanitized, title }, usedKeys)
    const id = allocateUniqueId(sanitized.id, key, usedIds)
    const verified =
      typeof sanitized.verified === 'boolean'
        ? sanitized.verified
        : sanitized.source === 'ai'
          ? false
          : true
    const normalized = normalizeBibEntry(
      {
        ...sanitized,
        title,
        id,
        key,
        verified,
      },
      { id, existingKeys: usedKeys, existingIds: usedIds },
    )
    for (const oldKey of normalized.oldKeys) {
      if (oldKey) usedKeys.add(oldKey)
    }
    entries.push(normalized)
  }

  return entries
}

/**
 * Resolve the path to the app-wide bibliography file (`hwp-bibliography.json`)
 * inside `userData` (or directly inside a provided directory path).
 */
export function bibliographyPathOf(appOrDir: SettingsPathProvider | string): string {
  const dir = typeof appOrDir === 'string' ? appOrDir : appOrDir.getPath('userData')
  return join(dir, BIBLIOGRAPHY_FILE_NAME)
}

/**
 * Inspect and load the app-wide bibliography store without mutating or deleting
 * `hwp-bibliography.json` on failure.
 *
 * - Missing file (`ENOENT`) returns `{ ok: true, exists: false, entries: [], ... }`.
 * - Valid file returns normalized entries plus byte-size and near-limit telemetry.
 * - Corrupt, oversized, or unreadable files return `{ ok: false, reason, ... }`
 *   while leaving the original file untouched and preserving a `.corrupt-<timestamp>`
 *   backup copy beside it when bytes can be copied.
 */
export function readBibliographyState(
  appOrDir: SettingsPathProvider | string,
  options?: { maxBytes?: number },
): BibLibraryState {
  const maxBytes = resolveMaxBytes(options?.maxBytes)
  const filePath = bibliographyPathOf(appOrDir)

  let stats
  try {
    stats = statSync(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
      return {
        ok: true,
        exists: false,
        entries: [],
        tags: [],
        sizeBytes: 0,
        maxBytes,
        nearLimit: false,
      }
    }
    return {
      ok: false,
      reason: 'library_read_error',
      error:
        error instanceof Error ? error.message : `Unable to inspect bibliography file: ${filePath}`,
      maxBytes,
    }
  }

  if (!stats.isFile()) {
    return {
      ok: false,
      reason: 'library_read_error',
      error: `Bibliography path is not a file: ${filePath}`,
      maxBytes,
    }
  }

  if (stats.size > maxBytes) {
    const corruptBackupPath = createCorruptBackupFromDisk(filePath, stats.size)
    return {
      ok: false,
      reason: 'library_too_large',
      error: `Bibliography file exceeds maximum size of ${maxBytes} bytes (got ${stats.size} bytes)`,
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
      error: error instanceof Error ? error.message : 'Unable to read bibliography file',
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
      entries: [],
      tags: [],
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
      error: 'Bibliography file is not valid JSON',
      ...(corruptBackupPath ? { corruptBackupPath } : {}),
      sizeBytes,
      maxBytes,
    }
  }

  let rawEntries: unknown[] | null = null
  if (Array.isArray(parsed)) {
    rawEntries = parsed
  } else if (isPlainObject(parsed) && Array.isArray(parsed.entries)) {
    rawEntries = parsed.entries
  }

  if (rawEntries === null) {
    const corruptBackupPath = createCorruptBackupFromBytes(filePath, rawBuffer)
    return {
      ok: false,
      reason: 'library_corrupt',
      error: 'Bibliography JSON must be an array or an object with an entries array',
      ...(corruptBackupPath ? { corruptBackupPath } : {}),
      sizeBytes,
      maxBytes,
    }
  }

  const entries = normalizeStoredEntries(rawEntries)
  return {
    ok: true,
    exists: true,
    entries,
    tags: listBibliographyTags(entries),
    sizeBytes,
    maxBytes,
    nearLimit: isNearLimit(sizeBytes, maxBytes),
  }
}

/** Alias of `readBibliographyState` for callers inspecting store health. */
export const inspectBibliographyStore = readBibliographyState

/**
 * Load and validate a bibliography JSON file from an explicit disk path.
 * Accepts both the versioned `{ version, entries }` envelope and a bare JSON array.
 */
export function loadBibliographyFile(
  filePath: string,
  options?: { maxBytes?: number },
): LoadBibliographyFileResult {
  const maxBytes = resolveMaxBytes(options?.maxBytes)

  let stats
  try {
    stats = statSync(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
      return { ok: false, reason: 'not_found', error: `Bibliography file not found: ${filePath}` }
    }
    return {
      ok: false,
      reason: 'read_error',
      error:
        error instanceof Error ? error.message : `Unable to inspect bibliography file: ${filePath}`,
    }
  }
  if (!stats.isFile()) {
    return {
      ok: false,
      reason: 'read_error',
      error: `Bibliography path is not a file: ${filePath}`,
    }
  }
  if (stats.size > maxBytes) {
    return {
      ok: false,
      reason: 'too_large',
      error: `Bibliography file exceeds maximum size of ${maxBytes} bytes (got ${stats.size} bytes)`,
      maxBytes,
      actualBytes: stats.size,
    }
  }

  let rawBuffer: Buffer
  try {
    rawBuffer = readFileSync(filePath)
  } catch (error) {
    return {
      ok: false,
      reason: 'read_error',
      error: error instanceof Error ? error.message : 'Unable to read bibliography file',
    }
  }

  const sizeBytes = rawBuffer.byteLength
  const rawText = rawBuffer.toString('utf8')
  if (!rawText.trim()) {
    return {
      ok: true,
      entries: [],
      sizeBytes,
      maxBytes,
      nearLimit: isNearLimit(sizeBytes, maxBytes),
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    return { ok: false, reason: 'invalid_format', error: 'Bibliography file is not valid JSON' }
  }

  if (Array.isArray(parsed)) {
    return {
      ok: true,
      entries: normalizeStoredEntries(parsed),
      sizeBytes,
      maxBytes,
      nearLimit: isNearLimit(sizeBytes, maxBytes),
    }
  }
  if (isPlainObject(parsed) && Array.isArray(parsed.entries)) {
    return {
      ok: true,
      entries: normalizeStoredEntries(parsed.entries),
      sizeBytes,
      maxBytes,
      nearLimit: isNearLimit(sizeBytes, maxBytes),
    }
  }

  return {
    ok: false,
    reason: 'invalid_format',
    error: 'Bibliography JSON must be an array or an object with an entries array',
  }
}

/**
 * Read normalized entries from a bibliography JSON file, returning `[]` when the
 * file does not exist yet or is empty/unreadable.
 */
export function readBibliographyFromFile(filePath: string): BibEntry[] {
  const result = loadBibliographyFile(filePath)
  return result.ok ? result.entries : []
}

/**
 * Read normalized entries from the app-wide `hwp-bibliography.json` store.
 */
export function readBibliography(appOrDir: SettingsPathProvider | string): BibEntry[] {
  return readBibliographyFromFile(bibliographyPathOf(appOrDir))
}

/** Return sorted unique tags across all bibliography entries. */
export function listBibliographyTags(entries: readonly BibEntry[]): string[] {
  const set = new Set<string>()
  for (const entry of entries) {
    if (!entry || !Array.isArray(entry.tags)) continue
    for (const tag of entry.tags) {
      const cleaned = sanitizeImportedField(tag)
      if (cleaned) set.add(cleaned)
    }
  }
  return [...set].sort((a, b) => TAG_COLLATOR.compare(a, b))
}

/**
 * Add a single reference entry to the app-wide bibliography store synchronously.
 * AI-authored additions are always stored as unverified (`verified: false, source: 'ai'`).
 */
export function addBibliographyEntry(
  appOrDir: SettingsPathProvider | string,
  rawInput: unknown,
  options?: { actor?: BibActor; maxBytes?: number },
): BibAddResult {
  if (!isPlainObject(rawInput)) {
    return { ok: false, reason: 'invalid_input', error: 'Reference entry must be an object' }
  }

  const sanitized = sanitizeEntryInput(rawInput)
  if (!sanitized.title) {
    return { ok: false, reason: 'invalid_input', error: 'Title is required' }
  }

  if ('key' in rawInput && rawInput.key !== undefined) {
    if (typeof rawInput.key !== 'string' || !sanitizeCitationKey(rawInput.key)) {
      return { ok: false, reason: 'invalid_input', error: 'Citation key cannot be empty' }
    }
  }

  const state = readBibliographyState(appOrDir, { maxBytes: options?.maxBytes })
  if (!state.ok) {
    return libraryFailureOf(state)
  }

  const filePath = bibliographyPathOf(appOrDir)
  const existing = state.entries
  const { usedKeys, usedIds } = collectUsedKeysAndIds(existing)

  const key = allocateUniqueKey(
    'key' in rawInput && rawInput.key !== undefined ? sanitized.key : undefined,
    sanitized,
    usedKeys,
  )
  const id = allocateUniqueId(sanitized.id, key, usedIds)
  const now = new Date().toISOString()

  const isAi = options?.actor === 'ai' || sanitized.source === 'ai'
  const verified = isAi ? false : sanitized.verified === false ? false : true
  const source: BibEntrySource = isAi ? 'ai' : (sanitized.source ?? 'manual')

  const entry = normalizeBibEntry(
    {
      ...sanitized,
      id,
      key,
      verified,
      source,
      createdAt: sanitized.createdAt ?? now,
      updatedAt: now,
    },
    { id, existingKeys: usedKeys, existingIds: usedIds },
  )

  const entries = [...existing, entry]
  const saved = saveBibliographySync(filePath, entries, options?.maxBytes)
  if (!saved.ok) {
    return saved
  }
  return {
    ok: true,
    entry,
    entries,
    sizeBytes: saved.sizeBytes,
    maxBytes: saved.maxBytes,
    nearLimit: saved.nearLimit,
  }
}

/**
 * Add AI-discovered reference candidates to the app-wide bibliography store.
 * Every candidate MUST have a non-empty title and a valid `http(s)` source URL,
 * and is ALWAYS stored with `verified: false` and `source: 'ai'` regardless of
 * caller-supplied flags. Duplicates are reported without modifying existing entries.
 */
export function addAiBibliographyCandidates(
  appOrDir: SettingsPathProvider | string,
  rawCandidates: unknown,
  options?: { maxBytes?: number },
): BibAddAiCandidatesResult {
  if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
    return {
      ok: false,
      reason: 'invalid_input',
      error: 'At least one AI reference candidate is required',
    }
  }
  if (rawCandidates.length > MAX_IMPORT_ENTRIES) {
    return {
      ok: false,
      reason: 'invalid_input',
      error: `Too many candidates (maximum ${MAX_IMPORT_ENTRIES})`,
    }
  }

  const prepared: BibEntryInput[] = []
  for (let i = 0; i < rawCandidates.length; i++) {
    const raw = rawCandidates[i]
    if (!isPlainObject(raw)) {
      return {
        ok: false,
        reason: 'invalid_input',
        error: `Candidate at index ${i} must be an object`,
      }
    }
    const sanitized = sanitizeEntryInput(raw)
    if (!sanitized.title) {
      return {
        ok: false,
        reason: 'invalid_input',
        error: `Candidate at index ${i} is missing a title`,
      }
    }
    if ('key' in raw && raw.key !== undefined) {
      if (typeof raw.key !== 'string' || !sanitizeCitationKey(raw.key)) {
        return {
          ok: false,
          reason: 'invalid_input',
          error: `Candidate at index ${i} has an empty citation key`,
        }
      }
    }

    const sourceUrl = extractAiSourceUrl(raw)
    if (!sourceUrl) {
      return {
        ok: false,
        reason: 'missing_source_url',
        error: `Candidate at index ${i} must include a valid http(s) source URL`,
      }
    }

    const existingMemo = sanitized.memo ?? ''
    const memo = existingMemo.includes(sourceUrl)
      ? existingMemo
      : existingMemo
        ? `${existingMemo} | ${sourceUrl}`
        : sourceUrl

    prepared.push({
      ...sanitized,
      memo,
      verified: false,
      source: 'ai',
    })
  }

  const state = readBibliographyState(appOrDir, { maxBytes: options?.maxBytes })
  if (!state.ok) {
    return libraryFailureOf(state)
  }

  const filePath = bibliographyPathOf(appOrDir)
  const existing = state.entries
  const preview = planImportPreview(prepared, existing)
  const now = new Date().toISOString()

  // Enforce the AI verification invariant unconditionally on every persisted entry.
  const added: BibEntry[] = preview.toAdd.map((item) => ({
    ...item,
    verified: false,
    source: 'ai',
    createdAt: item.createdAt ?? now,
    updatedAt: now,
  }))

  const entries = added.length > 0 ? [...existing, ...added] : existing
  if (added.length > 0) {
    const saved = saveBibliographySync(filePath, entries, options?.maxBytes)
    if (!saved.ok) {
      return saved
    }
    return {
      ok: true,
      added,
      duplicates: preview.duplicates,
      entries,
      sizeBytes: saved.sizeBytes,
      maxBytes: saved.maxBytes,
      nearLimit: saved.nearLimit,
    }
  }

  return {
    ok: true,
    added,
    duplicates: preview.duplicates,
    entries,
    sizeBytes: state.sizeBytes,
    maxBytes: state.maxBytes,
    nearLimit: state.nearLimit,
  }
}

/**
 * Update an existing reference entry synchronously.
 * Strictly refuses any attempt by `actor: 'ai'` to set `verified: true`.
 * Key renames preserve the previous key in `oldKeys` and return `renamedKey`.
 */
export function updateBibliographyEntry(
  appOrDir: SettingsPathProvider | string,
  id: unknown,
  rawPatch: unknown,
  options?: { actor?: BibActor; maxBytes?: number },
): BibUpdateResult {
  if (typeof id !== 'string' || !id.trim()) {
    return { ok: false, reason: 'invalid_input', error: 'Entry id is required' }
  }
  if (!isPlainObject(rawPatch)) {
    return { ok: false, reason: 'invalid_input', error: 'Update patch must be an object' }
  }

  if (options?.actor === 'ai' && rawPatch.verified === true) {
    return {
      ok: false,
      reason: 'ai_cannot_verify',
      error: 'AI cannot mark a reference as verified',
    }
  }

  const state = readBibliographyState(appOrDir, { maxBytes: options?.maxBytes })
  if (!state.ok) {
    return libraryFailureOf(state)
  }

  const targetId = id.trim()
  const filePath = bibliographyPathOf(appOrDir)
  const existingEntries = state.entries
  const index = existingEntries.findIndex((item) => item.id === targetId)
  if (index < 0) {
    return { ok: false, reason: 'not_found', error: `Reference entry not found: ${targetId}` }
  }

  const existing = existingEntries[index]
  const sanitizedPatch = sanitizeEntryInput(rawPatch)

  if ('title' in rawPatch && !sanitizedPatch.title) {
    return { ok: false, reason: 'invalid_input', error: 'Title cannot be empty' }
  }

  let nextKey = existing.key
  let nextOldKeys = existing.oldKeys
  let renamedKey: BibKeyRenameInfo | undefined

  if ('key' in rawPatch && rawPatch.key !== undefined) {
    if (typeof rawPatch.key !== 'string') {
      return { ok: false, reason: 'invalid_key', error: 'Citation key must be a string' }
    }
    const sanitizedNextKey = sanitizeCitationKey(rawPatch.key)
    if (!sanitizedNextKey) {
      return { ok: false, reason: 'invalid_key', error: 'Citation key cannot be empty' }
    }
    if (sanitizedNextKey !== existing.key) {
      const otherCurrentKeys = new Set(
        existingEntries.filter((item) => item.id !== existing.id).map((item) => item.key),
      )
      const renamed = renameBibEntryKey(existing, sanitizedNextKey, otherCurrentKeys)
      if (!renamed.ok) {
        return {
          ok: false,
          reason: renamed.reason,
          error:
            renamed.reason === 'duplicate_key'
              ? `Citation key already exists: ${sanitizedNextKey}`
              : 'Citation key is invalid',
        }
      }
      nextKey = renamed.entry.key
      nextOldKeys = renamed.entry.oldKeys
      renamedKey = {
        id: existing.id,
        oldKey: existing.key,
        newKey: nextKey,
        title: sanitizedPatch.title ?? existing.title,
      }
    }
  }

  const verified =
    options?.actor === 'ai'
      ? rawPatch.verified === false
        ? false
        : existing.verified
      : typeof rawPatch.verified === 'boolean'
        ? rawPatch.verified
        : existing.verified

  const merged: BibEntryInput = {
    ...existing,
    ...sanitizedPatch,
    id: existing.id,
    key: nextKey,
    oldKeys: renamedKey ? nextOldKeys : (sanitizedPatch.oldKeys ?? existing.oldKeys),
    verified,
    source: sanitizedPatch.source ?? existing.source,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  }

  const updated = normalizeBibEntry(merged, { id: existing.id })
  if (!updated.title) {
    return { ok: false, reason: 'invalid_input', error: 'Title cannot be empty' }
  }
  if (renamedKey) {
    renamedKey = { ...renamedKey, title: updated.title }
  }

  const nextEntries = existingEntries.slice()
  nextEntries[index] = updated
  const saved = saveBibliographySync(filePath, nextEntries, options?.maxBytes)
  if (!saved.ok) {
    return saved
  }

  return {
    ok: true,
    entry: updated,
    entries: nextEntries,
    ...(renamedKey ? { renamedKey } : {}),
    sizeBytes: saved.sizeBytes,
    maxBytes: saved.maxBytes,
    nearLimit: saved.nearLimit,
  }
}

/**
 * Mark an existing reference entry as human-verified (`verified: true`).
 * Strictly intended for explicit human UI confirmation.
 */
export function verifyBibliographyEntry(
  appOrDir: SettingsPathProvider | string,
  id: unknown,
  options?: { maxBytes?: number },
): BibVerifyResult {
  if (typeof id !== 'string' || !id.trim()) {
    return { ok: false, reason: 'invalid_input', error: 'Entry id is required' }
  }

  const state = readBibliographyState(appOrDir, { maxBytes: options?.maxBytes })
  if (!state.ok) {
    return libraryFailureOf(state)
  }

  const targetId = id.trim()
  const filePath = bibliographyPathOf(appOrDir)
  const existingEntries = state.entries
  const index = existingEntries.findIndex((item) => item.id === targetId)
  if (index < 0) {
    return { ok: false, reason: 'not_found', error: `Reference entry not found: ${targetId}` }
  }

  const updated: BibEntry = {
    ...existingEntries[index],
    verified: true,
    updatedAt: new Date().toISOString(),
  }
  const nextEntries = existingEntries.slice()
  nextEntries[index] = updated
  const saved = saveBibliographySync(filePath, nextEntries, options?.maxBytes)
  if (!saved.ok) {
    return saved
  }

  return {
    ok: true,
    entry: updated,
    entries: nextEntries,
    sizeBytes: saved.sizeBytes,
    maxBytes: saved.maxBytes,
    nearLimit: saved.nearLimit,
  }
}

/** Remove an entry from the app-wide bibliography store synchronously. */
export function deleteBibliographyEntry(
  appOrDir: SettingsPathProvider | string,
  id: unknown,
  options?: { maxBytes?: number },
): BibDeleteResult {
  if (typeof id !== 'string' || !id.trim()) {
    return { ok: false, reason: 'invalid_input', error: 'Entry id is required' }
  }

  const state = readBibliographyState(appOrDir, { maxBytes: options?.maxBytes })
  if (!state.ok) {
    return libraryFailureOf(state)
  }

  const targetId = id.trim()
  const filePath = bibliographyPathOf(appOrDir)
  const existingEntries = state.entries
  const index = existingEntries.findIndex((item) => item.id === targetId)
  if (index < 0) {
    return { ok: false, reason: 'not_found', error: `Reference entry not found: ${targetId}` }
  }

  const nextEntries = existingEntries.filter((item) => item.id !== targetId)
  const saved = saveBibliographySync(filePath, nextEntries, options?.maxBytes)
  if (!saved.ok) {
    return saved
  }

  return {
    ok: true,
    deletedId: targetId,
    entries: nextEntries,
    sizeBytes: saved.sizeBytes,
    maxBytes: saved.maxBytes,
    nearLimit: saved.nearLimit,
  }
}

/**
 * Read-only import preview: classifies candidate entries against the live library
 * without mutating `hwp-bibliography.json`.
 */
export function previewBibliographyImport(
  appOrDir: SettingsPathProvider | string,
  rawCandidates: unknown,
  options?: DuplicateMatchOptions,
): BibPreviewImportResult {
  if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
    return { ok: false, reason: 'empty', error: 'No reference candidates provided' }
  }
  if (rawCandidates.length > MAX_IMPORT_ENTRIES) {
    return {
      ok: false,
      reason: 'invalid_input',
      error: `Too many candidates (maximum ${MAX_IMPORT_ENTRIES})`,
    }
  }

  const validCandidates: BibEntryInput[] = []
  for (const raw of rawCandidates) {
    if (!isPlainObject(raw)) continue
    const sanitized = sanitizeEntryInput(raw)
    if (!sanitized.title) continue
    validCandidates.push(sanitized)
  }

  if (validCandidates.length === 0) {
    return { ok: false, reason: 'invalid_input', error: 'No valid reference entries found' }
  }

  const state = readBibliographyState(appOrDir)
  if (!state.ok) {
    return libraryFailureOf(state)
  }

  const preview = planImportPreview(validCandidates, state.entries, options)
  return { ok: true, preview }
}

/**
 * Read-only file import preview: validates file size against `MAX_IMPORT_BYTES`
 * before loading into memory, parses BibTeX/RIS/CSL JSON, and previews against
 * the live library without saving to disk.
 */
export function previewBibliographyFileImport(
  appOrDir: SettingsPathProvider | string,
  filePath: string,
): BibPreviewFileImportResult {
  const state = readBibliographyState(appOrDir)
  if (!state.ok) {
    return libraryFailureOf(state)
  }

  let stats
  try {
    stats = statSync(filePath)
  } catch {
    return { ok: false, reason: 'not_found', error: 'Selected file could not be found' }
  }
  if (!stats.isFile()) {
    return { ok: false, reason: 'not_found', error: 'Selected path is not a file' }
  }
  if (stats.size > MAX_IMPORT_BYTES) {
    return {
      ok: false,
      reason: 'too_large',
      error: `File exceeds maximum allowed size of ${MAX_IMPORT_BYTES} bytes (got ${stats.size} bytes).`,
      maxBytes: MAX_IMPORT_BYTES,
      actualBytes: stats.size,
    }
  }

  let bytes: Uint8Array
  try {
    bytes = readFileSync(filePath)
  } catch {
    return { ok: false, reason: 'unreadable', error: 'Selected file could not be read' }
  }

  const fileName = basename(filePath)
  const parsed = parseBibliographyFile(bytes, {
    filename: fileName,
    maxBytes: MAX_IMPORT_BYTES,
    source: 'import',
  })
  if (!parsed.ok) {
    return {
      ok: false,
      reason: parsed.reason,
      error: parsed.error,
      format: parsed.format,
      warnings: parsed.warnings,
      ...(parsed.maxBytes !== undefined ? { maxBytes: parsed.maxBytes } : {}),
      ...(parsed.actualBytes !== undefined ? { actualBytes: parsed.actualBytes } : {}),
    }
  }

  const preview = planImportPreview(parsed.entries, state.entries)
  return {
    ok: true,
    fileName,
    format: parsed.format,
    preview,
    warnings: parsed.warnings,
  }
}

/**
 * Commit user-confirmed file or document import candidates synchronously into
 * `hwp-bibliography.json`. Every committed entry is marked `verified: true` with
 * `source: 'import' | 'document'`.
 */
export function commitBibliographyImport(
  appOrDir: SettingsPathProvider | string,
  rawCandidates: unknown,
  options?: BibCommitImportOptions,
): BibCommitImportResult {
  if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
    return { ok: false, reason: 'empty', error: 'No reference candidates to import' }
  }
  if (rawCandidates.length > MAX_IMPORT_ENTRIES) {
    return {
      ok: false,
      reason: 'invalid_input',
      error: `Too many candidates (maximum ${MAX_IMPORT_ENTRIES})`,
    }
  }

  const validCandidates: BibEntryInput[] = []
  for (const raw of rawCandidates) {
    if (!isPlainObject(raw)) continue
    const sanitized = sanitizeEntryInput(raw)
    if (!sanitized.title) continue
    validCandidates.push(sanitized)
  }

  if (validCandidates.length === 0) {
    return { ok: false, reason: 'invalid_input', error: 'No valid reference entries to import' }
  }

  const state = readBibliographyState(appOrDir, { maxBytes: options?.maxBytes })
  if (!state.ok) {
    return libraryFailureOf(state)
  }

  const source: 'import' | 'document' = options?.source === 'document' ? 'document' : 'import'
  const skipDuplicates = options?.skipDuplicates !== false
  const filePath = bibliographyPathOf(appOrDir)
  const existing = state.entries
  const now = new Date().toISOString()

  let added: BibEntry[]
  let skippedDuplicates: DuplicateMatch[]

  if (skipDuplicates) {
    const preview = planImportPreview(validCandidates, existing)
    added = preview.toAdd.map((entry) => ({
      ...entry,
      verified: true,
      source,
      createdAt: entry.createdAt ?? now,
      updatedAt: now,
    }))
    skippedDuplicates = preview.duplicates
  } else {
    const { usedKeys, usedIds } = collectUsedKeysAndIds(existing)
    added = validCandidates.map((candidate) => {
      const key = allocateUniqueKey(candidate.key, candidate, usedKeys)
      const id = allocateUniqueId(candidate.id, key, usedIds)
      return normalizeBibEntry(
        {
          ...candidate,
          id,
          key,
          verified: true,
          source,
          createdAt: candidate.createdAt ?? now,
          updatedAt: now,
        },
        { id, existingKeys: usedKeys, existingIds: usedIds },
      )
    })
    skippedDuplicates = []
  }

  const entries = added.length > 0 ? [...existing, ...added] : existing
  if (added.length > 0) {
    const saved = saveBibliographySync(filePath, entries, options?.maxBytes)
    if (!saved.ok) {
      return saved
    }
    return {
      ok: true,
      added,
      skippedDuplicates,
      entries,
      sizeBytes: saved.sizeBytes,
      maxBytes: saved.maxBytes,
      nearLimit: saved.nearLimit,
    }
  }

  return {
    ok: true,
    added,
    skippedDuplicates,
    entries,
    sizeBytes: state.sizeBytes,
    maxBytes: state.maxBytes,
    nearLimit: state.nearLimit,
  }
}

/**
 * Filter, serialize, and atomically write bibliography entries to a file on disk
 * in BibTeX, RIS, or CSL JSON format.
 */
export function writeBibliographyExportFile(
  filePath: string,
  entries: readonly BibEntry[],
  format: BibliographyFormat,
  options?: BibExportOptions,
): BibWriteExportResult {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return { ok: false, reason: 'invalid_input', error: 'Export file path is required' }
  }
  if (!isBibliographyFormat(format)) {
    return {
      ok: false,
      reason: 'invalid_format',
      error: `Unsupported bibliography export format: ${String(format)}`,
    }
  }

  let filtered = Array.isArray(entries) ? entries.slice() : []
  if (Array.isArray(options?.ids) && options.ids.length > 0) {
    const idSet = new Set(
      options.ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
    )
    filtered = filtered.filter((entry) => idSet.has(entry.id))
  }
  const tag = typeof options?.tag === 'string' ? sanitizeImportedField(options.tag) : ''
  if (tag) {
    filtered = filtered.filter((entry) => Array.isArray(entry.tags) && entry.tags.includes(tag))
  }

  try {
    const content = exportBibliography(filtered, format)
    writeTextFileAtomicallySync(filePath, content)
    return { ok: true, path: filePath, count: filtered.length, format }
  } catch (error) {
    return {
      ok: false,
      reason: 'write_failed',
      error: error instanceof Error ? error.message : 'Failed to write bibliography export file',
    }
  }
}
