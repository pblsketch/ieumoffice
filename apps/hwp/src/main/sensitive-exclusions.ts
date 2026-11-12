import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createExclusionKey, exclusionHash } from '@genoffice/agent-core/sensitive-exclusion'
import { SENSITIVE_KINDS, type SensitiveKind } from '@genoffice/agent-core/sensitive-kinds'
import { atomicWriteFile } from './atomic-write'

/**
 * What the person dismissed in 민감정보 찾기, remembered per document in the app's data
 * folder (spec 4 "제외 기억"), so a dismissed candidate is not offered again.
 *
 * A record holds the kind and a keyed hash of the value, never the value: the value kept
 * here would be the very thing the person chose not to hide, sitting in a second place. The
 * key is a file of its own beside the records (`key.bin`), so the records alone cannot be
 * reversed by trying every phone number. Nothing is written into the document. A document
 * is known by its path: moved or renamed, its record is simply not found.
 */

/** One candidate as the renderer asks about it. */
export interface ExclusionItem {
  kind: string
  value: string
}

export interface ExclusionStore {
  /** for each item, whether it was dismissed for this document */
  excluded(docPath: string, items: readonly ExclusionItem[]): Promise<boolean[]>
  /** remember that this one was dismissed for this document */
  exclude(docPath: string, item: ExclusionItem): Promise<void>
}

interface RecordFile {
  version: 1
  entries: { kind: SensitiveKind; hash: string }[]
}

/** Most dismissals one document keeps; the oldest go first past it. */
const MAX_ENTRIES = 5000
/** Longest value hashed; a longer one is no candidate the finder makes. */
const MAX_VALUE = 1000

const isKind = (kind: unknown): kind is SensitiveKind =>
  typeof kind === 'string' && (SENSITIVE_KINDS as readonly string[]).includes(kind)

/** The record file of a document: named by a hash of its path, not by the path. */
function recordName(docPath: string): string {
  const key = process.platform === 'win32' ? docPath.toLowerCase() : docPath
  return `${createHash('sha256').update(key, 'utf8').digest('hex')}.json`
}

export function createExclusionStore(dir: string): ExclusionStore {
  let key: Promise<Uint8Array> | null = null

  const keyOf = (): Promise<Uint8Array> => {
    key ??= (async () => {
      const file = join(dir, 'key.bin')
      try {
        const bytes = new Uint8Array(await readFile(file))
        if (bytes.length >= 32) return bytes
      } catch {
        // no key yet: one is made below
      }
      await mkdir(dir, { recursive: true })
      const made = createExclusionKey()
      await atomicWriteFile(file, Buffer.from(made))
      return made
    })().catch((error: unknown) => {
      key = null
      throw error
    })
    return key
  }

  const recordPath = (docPath: string) => join(dir, 'records', recordName(docPath))

  const readRecord = async (docPath: string): Promise<RecordFile> => {
    try {
      const parsed = JSON.parse(await readFile(recordPath(docPath), 'utf8')) as Partial<RecordFile>
      const entries = Array.isArray(parsed.entries)
        ? parsed.entries.filter((entry) => isKind(entry?.kind) && typeof entry?.hash === 'string')
        : []
      return { version: 1, entries }
    } catch {
      return { version: 1, entries: [] }
    }
  }

  const hashOf = async (item: ExclusionItem): Promise<string | null> => {
    if (!isKind(item.kind) || typeof item.value !== 'string') return null
    if (!item.value || item.value.length > MAX_VALUE) return null
    return exclusionHash(await keyOf(), item.kind, item.value)
  }

  return {
    async excluded(docPath, items) {
      const record = await readRecord(docPath)
      if (record.entries.length === 0) return items.map(() => false)
      const known = new Set(record.entries.map((entry) => `${entry.kind}:${entry.hash}`))
      return Promise.all(
        items.map(async (item) => {
          const hash = await hashOf(item)
          return hash !== null && known.has(`${item.kind}:${hash}`)
        }),
      )
    },
    async exclude(docPath, item) {
      const hash = await hashOf(item)
      if (hash === null || !isKind(item.kind)) return
      const record = await readRecord(docPath)
      if (record.entries.some((entry) => entry.kind === item.kind && entry.hash === hash)) return
      record.entries.push({ kind: item.kind, hash })
      if (record.entries.length > MAX_ENTRIES) {
        record.entries = record.entries.slice(record.entries.length - MAX_ENTRIES)
      }
      await mkdir(join(dir, 'records'), { recursive: true })
      await atomicWriteFile(recordPath(docPath), Buffer.from(JSON.stringify(record), 'utf8'))
    },
  }
}
