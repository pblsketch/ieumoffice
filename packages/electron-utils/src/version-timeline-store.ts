/**
 * Persistent local Version Timeline store under `<baseDir>/version-timeline/<docKey>/`.
 * Never writes inside user document files or user folders.
 * Enforces SHA-256 deduplication on manual saves, retention limits, and strict
 * refusal of plaintext disk persistence for encrypted documents.
 */
import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, normalize } from 'node:path'
import type {
  RecordVersionInput,
  RecordVersionResult,
  VersionEntry,
  VersionSource,
  VersionTimelineStats,
} from './version-timeline-channels'

export const MAX_VERSIONS_PER_DOC = 30
export const MAX_TIMELINE_TOTAL_BYTES = 250 * 1024 * 1024
export const MAX_SINGLE_SNAPSHOT_BYTES = 20 * 1024 * 1024
export const MAX_PROMPT_SUMMARY_CHARS = 300

const SAFE_DOC_KEY = /^[a-zA-Z0-9_-]{4,64}$/
const SAFE_EXT = /^[a-zA-Z0-9]{1,12}$/
const VALID_SOURCES = new Set<VersionSource>(['ai', 'save', 'checkpoint', 'restore'])

/** Derives a safe 16-hex-char document key from a normalized absolute path. */
export function docKeyFromPath(filePath: string): string {
  const norm =
    process.platform === 'win32' ? normalize(filePath).toLowerCase() : normalize(filePath)
  return createHash('sha256').update(norm, 'utf8').digest('hex').slice(0, 16)
}

export function isValidDocKey(docKey: string): boolean {
  return SAFE_DOC_KEY.test(docKey)
}

export interface VersionTimelineStoreOptions {
  /** Typically `app.getPath('userData')` */
  readonly baseDir: string
  readonly maxVersionsPerDoc?: number | undefined
  readonly maxTotalBytes?: number | undefined
  readonly maxSingleSnapshotBytes?: number | undefined
}

export class VersionTimelineStore {
  readonly rootDir: string
  private readonly maxPerDoc: number
  private readonly maxTotalBytes: number
  private readonly maxSingleBytes: number

  constructor(options: VersionTimelineStoreOptions) {
    this.rootDir = join(options.baseDir, 'version-timeline')
    this.maxPerDoc = options.maxVersionsPerDoc ?? MAX_VERSIONS_PER_DOC
    this.maxTotalBytes = options.maxTotalBytes ?? MAX_TIMELINE_TOTAL_BYTES
    this.maxSingleBytes = options.maxSingleSnapshotBytes ?? MAX_SINGLE_SNAPSHOT_BYTES
  }

  private docDir(docKey: string): string {
    if (!isValidDocKey(docKey)) throw new Error('Invalid docKey')
    return join(this.rootDir, docKey)
  }

  private indexPath(docKey: string): string {
    return join(this.docDir(docKey), 'index.json')
  }

  private readIndex(docKey: string): VersionEntry[] {
    if (!isValidDocKey(docKey)) return []
    const path = this.indexPath(docKey)
    if (!existsSync(path)) return []
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      return Array.isArray(parsed) ? (parsed as VersionEntry[]) : []
    } catch {
      return []
    }
  }

  private writeIndex(docKey: string, entries: readonly VersionEntry[]): void {
    const dir = this.docDir(docKey)
    mkdirSync(dir, { recursive: true })
    const target = this.indexPath(docKey)
    const tmp = `${target}.tmp-${process.pid}`
    writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf8')
    renameSync(tmp, target)
  }

  list(docKey: string): VersionEntry[] {
    return this.readIndex(docKey)
  }

  record(input: RecordVersionInput): RecordVersionResult {
    // Hard security invariant: never persist plaintext snapshots of encrypted documents
    if (input.encrypted === true) {
      return { ok: false, skipped: true, reason: 'encrypted' }
    }
    if (!isValidDocKey(input.docKey) || !VALID_SOURCES.has(input.source)) {
      return { ok: false, skipped: true, reason: 'invalid' }
    }
    const cleanExt = input.ext.replace(/^\./, '')
    if (!SAFE_EXT.test(cleanExt)) {
      return { ok: false, skipped: true, reason: 'invalid' }
    }

    const buf =
      typeof input.content === 'string'
        ? Buffer.from(input.content, 'utf8')
        : Buffer.from(input.content)
    if (buf.byteLength > this.maxSingleBytes) {
      return { ok: false, skipped: true, reason: 'too-large' }
    }

    const contentHash = createHash('sha256').update(buf).digest('hex')
    const existing = this.readIndex(input.docKey)

    // Deduplicate consecutive identical manual Ctrl+S saves
    if (
      input.source === 'save' &&
      existing.length > 0 &&
      existing[0]!.contentHash === contentHash
    ) {
      return { ok: false, skipped: true, reason: 'unchanged', entry: existing[0] }
    }

    const id = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const snapshotFile = `${id}.${cleanExt}`
    const dir = this.docDir(input.docKey)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, snapshotFile), buf)

    const promptSummary = input.promptSummary?.trim()
      ? input.promptSummary.trim().slice(0, MAX_PROMPT_SUMMARY_CHARS)
      : undefined
    const label = input.label?.trim() ? input.label.trim().slice(0, 120) : undefined
    const changeSummary = input.changeSummary?.trim()
      ? input.changeSummary.trim().slice(0, 200)
      : undefined

    const entry: VersionEntry = {
      id,
      docKey: input.docKey,
      source: input.source,
      createdAt: new Date().toISOString(),
      contentHash,
      byteSize: buf.byteLength,
      ...(promptSummary ? { promptSummary } : {}),
      ...(label ? { label } : {}),
      ...(changeSummary ? { changeSummary } : {}),
      snapshotFile,
    }

    const updated = [entry, ...existing]
    const trimmed = updated.slice(0, this.maxPerDoc)
    const dropped = updated.slice(this.maxPerDoc)
    for (const old of dropped) {
      if (old.snapshotFile) {
        rmSync(join(dir, old.snapshotFile), { force: true })
      }
    }
    this.writeIndex(input.docKey, trimmed)
    this.enforceGlobalCap()
    return { ok: true, entry }
  }

  readSnapshot(docKey: string, id: string, asUtf8: boolean = false): Uint8Array | string | null {
    const entries = this.readIndex(docKey)
    const entry = entries.find((e) => e.id === id)
    if (!entry?.snapshotFile) return null
    const file = join(this.docDir(docKey), entry.snapshotFile)
    if (!existsSync(file)) return null
    return asUtf8 ? readFileSync(file, 'utf8') : new Uint8Array(readFileSync(file))
  }

  deleteEntry(docKey: string, id: string): boolean {
    if (!isValidDocKey(docKey)) return false
    const entries = this.readIndex(docKey)
    const idx = entries.findIndex((e) => e.id === id)
    if (idx === -1) return false
    const [removed] = entries.splice(idx, 1)
    if (removed?.snapshotFile) {
      rmSync(join(this.docDir(docKey), removed.snapshotFile), { force: true })
    }
    if (entries.length === 0) {
      rmSync(this.docDir(docKey), { recursive: true, force: true })
    } else {
      this.writeIndex(docKey, entries)
    }
    return true
  }

  moveDocKey(oldDocKey: string, newDocKey: string): boolean {
    if (!isValidDocKey(oldDocKey) || !isValidDocKey(newDocKey) || oldDocKey === newDocKey) {
      return false
    }
    const oldDir = this.docDir(oldDocKey)
    const newDir = this.docDir(newDocKey)
    if (!existsSync(oldDir) || existsSync(newDir)) return false
    mkdirSync(this.rootDir, { recursive: true })
    renameSync(oldDir, newDir)
    const migrated = this.readIndex(newDocKey).map((e) => ({ ...e, docKey: newDocKey }))
    this.writeIndex(newDocKey, migrated)
    return true
  }

  clearAll(): boolean {
    if (existsSync(this.rootDir)) {
      rmSync(this.rootDir, { recursive: true, force: true })
    }
    return true
  }

  getStats(): VersionTimelineStats {
    if (!existsSync(this.rootDir)) return { totalBytes: 0, docCount: 0, entryCount: 0 }
    let totalBytes = 0
    let docCount = 0
    let entryCount = 0
    for (const d of readdirSync(this.rootDir, { withFileTypes: true })) {
      if (!d.isDirectory() || !isValidDocKey(d.name)) continue
      const entries = this.readIndex(d.name)
      if (entries.length === 0) continue
      docCount++
      entryCount += entries.length
      const dir = join(this.rootDir, d.name)
      for (const file of readdirSync(dir)) {
        try {
          totalBytes += statSync(join(dir, file)).size
        } catch {
          // ignore race
        }
      }
    }
    return { totalBytes, docCount, entryCount }
  }

  private enforceGlobalCap(): void {
    if (!existsSync(this.rootDir)) return
    const all: Array<{ docKey: string; entry: VersionEntry }> = []
    let totalBytes = 0
    for (const d of readdirSync(this.rootDir, { withFileTypes: true })) {
      if (!d.isDirectory() || !isValidDocKey(d.name)) continue
      for (const entry of this.readIndex(d.name)) {
        all.push({ docKey: d.name, entry })
        totalBytes += entry.byteSize
      }
    }
    if (totalBytes <= this.maxTotalBytes) return
    // Evict oldest entries first across all documents
    all.sort((a, b) => a.entry.createdAt.localeCompare(b.entry.createdAt))
    for (const item of all) {
      if (totalBytes <= this.maxTotalBytes) break
      if (this.deleteEntry(item.docKey, item.entry.id)) {
        totalBytes -= item.entry.byteSize
      }
    }
  }
}
