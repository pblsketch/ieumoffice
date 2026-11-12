import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/**
 * Where "exclude" in the sensitive-info candidate list is remembered: per
 * document path, in the app's data folder, never in the document.
 *
 * A record holds a candidate's kind and its keyed hash
 * (`@genoffice/agent-core/sensitive-exclusion`), never the value. The key the
 * hashes are made with lives in a file of its own, so the records alone cannot
 * be reversed by trying every phone number. A document that moves or is
 * renamed is simply forgotten.
 */

export interface SensitiveExclusion {
  /** a candidate kind id (`@genoffice/agent-core/sensitive-kinds`) */
  kind: string
  /** lower-case hex HMAC-SHA-256, 64 characters */
  hash: string
}

export interface SensitiveExclusionsOf {
  /** the hash key, hex */
  key: string
  entries: SensitiveExclusion[]
}

interface RecordsFile {
  version: 1
  documents: Record<string, SensitiveExclusion[]>
}

/**
 * The shape of a kind id. The main process does not load the finder's kind
 * list; a record only ever holds what the editor hashed, and an id that
 * matches no kind simply never matches a candidate.
 */
const KIND_RE = /^[a-z][a-z-]{0,31}$/
const HASH_RE = /^[0-9a-f]{64}$/
const KEY_RE = /^[0-9a-f]{64}$/

export function isSensitiveExclusion(value: unknown): value is SensitiveExclusion {
  if (!value || typeof value !== 'object') return false
  const { kind, hash } = value as { kind?: unknown; hash?: unknown }
  return (
    typeof kind === 'string' && KIND_RE.test(kind) && typeof hash === 'string' && HASH_RE.test(hash)
  )
}

/** The same document under the same name: resolved, and case-folded where the file system is. */
function documentKey(path: string, platform: NodeJS.Platform): string {
  const full = resolve(path)
  return platform === 'win32' || platform === 'darwin' ? full.toLowerCase() : full
}

export interface SensitiveExclusionStore {
  get(docPath: string): Promise<SensitiveExclusionsOf>
  add(docPath: string, entry: SensitiveExclusion): Promise<boolean>
}

/**
 * One store per editor: `<dir>/<name>-exclusions.json` for the records and
 * `<dir>/<name>-exclusion-key` for the key. Writes are serialized, and each
 * one replaces the file whole.
 */
export function createSensitiveExclusionStore(
  dir: string,
  name: string,
  platform: NodeJS.Platform = process.platform,
): SensitiveExclusionStore {
  const keyFile = join(dir, `${name}-exclusion-key`)
  const recordsFile = join(dir, `${name}-exclusions.json`)
  let keyPromise: Promise<string> | null = null
  let queue: Promise<unknown> = Promise.resolve()

  const writeWhole = async (file: string, text: string): Promise<void> => {
    await mkdir(dir, { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, file)
  }

  const loadKey = async (): Promise<string> => {
    try {
      const text = (await readFile(keyFile, 'utf8')).trim()
      if (KEY_RE.test(text)) return text
    } catch {
      // no key yet: made below
    }
    const made = randomBytes(32).toString('hex')
    await writeWhole(keyFile, made)
    return made
  }

  const key = (): Promise<string> => {
    keyPromise ??= loadKey().catch((err: unknown) => {
      keyPromise = null
      throw err
    })
    return keyPromise
  }

  const readRecords = async (): Promise<RecordsFile> => {
    try {
      const parsed = JSON.parse(await readFile(recordsFile, 'utf8')) as Partial<RecordsFile>
      const documents: Record<string, SensitiveExclusion[]> = {}
      if (parsed && typeof parsed.documents === 'object' && parsed.documents) {
        for (const [doc, list] of Object.entries(parsed.documents)) {
          if (Array.isArray(list)) documents[doc] = list.filter(isSensitiveExclusion)
        }
      }
      return { version: 1, documents }
    } catch {
      return { version: 1, documents: {} }
    }
  }

  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work)
    queue = next.catch(() => undefined)
    return next
  }

  return {
    async get(docPath) {
      const k = await key()
      const records = await serial(readRecords)
      return { key: k, entries: records.documents[documentKey(docPath, platform)] ?? [] }
    },
    async add(docPath, entry) {
      if (!docPath || !isSensitiveExclusion(entry)) return false
      // the key exists before any hash made with it is written down
      await key()
      return serial(async () => {
        const records = await readRecords()
        const doc = documentKey(docPath, platform)
        const list = records.documents[doc] ?? []
        if (!list.some((e) => e.kind === entry.kind && e.hash === entry.hash)) {
          list.push({ kind: entry.kind, hash: entry.hash })
        }
        records.documents[doc] = list
        await writeWhole(recordsFile, JSON.stringify(records))
        return true
      })
    },
  }
}
