import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { atomicWriteFile, writeJsonAtomic } from '@genoffice/electron-utils/atomic-write'
import { createExclusionKey, exclusionHash } from '@genoffice/agent-core/sensitive-exclusion'
import { SENSITIVE_KINDS, type SensitiveKind } from '@genoffice/agent-core/sensitive-kinds'

/**
 * The "never suggest this again" memory of the sensitive-info finder, for
 * Word documents.
 *
 * One record per document path, in the app data folder, never in the
 * document. A record holds the kind and a keyed hash of the value, never the
 * value: the value is the very thing the reader chose not to hide, and a copy
 * of it here would be a second place it lives. The key sits in its own file,
 * apart from the records, so the records alone cannot be reversed by trying
 * every phone number. A document that moves or is renamed is simply
 * forgotten.
 *
 * Plain Node, no Electron: the main process hands in the folder.
 */

const KEY_FILE = 'docs-sensitive-exclusion.key'
const RECORDS_FILE = 'docs-sensitive-exclusions.json'
const KINDS: ReadonlySet<string> = new Set(SENSITIVE_KINDS)

export interface ExclusionItem {
  kind: SensitiveKind
  value: string
}

interface ExclusionEntry {
  kind: SensitiveKind
  hash: string
}

interface ExclusionRecords {
  version: 1
  /** sha-256 of the document path → its dismissed candidates */
  docs: Record<string, ExclusionEntry[]>
}

export interface SensitiveExclusionStore {
  /** remember a dismissed candidate of the document at `docPath` */
  add(docPath: string, item: ExclusionItem): Promise<void>
  /** for each item, whether it was dismissed in the document at `docPath` */
  check(docPath: string, items: readonly ExclusionItem[]): Promise<boolean[]>
}

/** the record key of a document: its resolved path, case-folded where the file system is */
export function exclusionDocId(
  docPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const full = resolve(docPath)
  const folded = platform === 'win32' || platform === 'darwin' ? full.toLowerCase() : full
  return createHash('sha256').update(folded, 'utf8').digest('hex')
}

export function isExclusionItem(value: unknown): value is ExclusionItem {
  if (!value || typeof value !== 'object') return false
  const item = value as { kind?: unknown; value?: unknown }
  return typeof item.kind === 'string' && KINDS.has(item.kind) && typeof item.value === 'string'
}

function readRecords(path: string): ExclusionRecords {
  try {
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ExclusionRecords>
      if (parsed && parsed.version === 1 && parsed.docs && typeof parsed.docs === 'object') {
        return { version: 1, docs: parsed.docs }
      }
    }
  } catch {
    // a damaged record file forgets its dismissals: the finder offers them again
  }
  return { version: 1, docs: {} }
}

export function createSensitiveExclusionStore(dir: string): SensitiveExclusionStore {
  const keyPath = join(dir, KEY_FILE)
  const recordsPath = join(dir, RECORDS_FILE)
  let keyPromise: Promise<Uint8Array> | null = null
  /** writes one after another, so two quick dismissals do not drop each other */
  let queue: Promise<unknown> = Promise.resolve()

  const loadKey = async (): Promise<Uint8Array> => {
    try {
      const hex = readFileSync(keyPath, 'utf8').trim()
      if (/^[0-9a-f]{64}$/.test(hex)) return Uint8Array.from(Buffer.from(hex, 'hex'))
    } catch {
      // no key yet
    }
    const key = createExclusionKey()
    mkdirSync(dir, { recursive: true })
    // a new key makes earlier records unreadable: they are forgotten, never misread
    await atomicWriteFile(keyPath, Buffer.from(Buffer.from(key).toString('hex'), 'utf8'))
    return key
  }
  const key = () =>
    (keyPromise ??= loadKey().catch((err) => {
      keyPromise = null
      throw err
    }))

  return {
    add(docPath, item) {
      const run = queue.then(async () => {
        const hash = await exclusionHash(await key(), item.kind, item.value)
        const records = readRecords(recordsPath)
        const id = exclusionDocId(docPath)
        const entries = records.docs[id] ?? []
        if (entries.some((e) => e.kind === item.kind && e.hash === hash)) return
        records.docs[id] = [...entries, { kind: item.kind, hash }]
        mkdirSync(dir, { recursive: true })
        writeJsonAtomic(recordsPath, records)
      })
      queue = run.catch(() => {})
      return run
    },
    async check(docPath, items) {
      await queue
      const entries = readRecords(recordsPath).docs[exclusionDocId(docPath)] ?? []
      if (entries.length === 0 || items.length === 0) return items.map(() => false)
      const known = new Set(entries.map((e) => `${e.kind}:${e.hash}`))
      const k = await key()
      return Promise.all(
        items.map(async (item) =>
          known.has(`${item.kind}:${await exclusionHash(k, item.kind, item.value)}`),
        ),
      )
    },
  }
}
