/**
 * Exclusion memory of "find sensitive info" in the spreadsheet editor: the
 * candidates a person dismissed are not suggested again for that workbook.
 *
 * Kept in the app data folder, one small file per workbook path, holding only
 * a keyed hash and the kind of each dismissed value; never the value. The key
 * lives in a file of its own, apart from the records, and never leaves the
 * main process: the renderer hands values over and gets answers back. Moving
 * or renaming the workbook forgets its exclusions; that is accepted.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createExclusionKey, exclusionHash } from '@genoffice/agent-core/sensitive-exclusion'
import { SENSITIVE_KINDS, type SensitiveKind } from '@genoffice/agent-core/sensitive-kinds'
import { z } from 'zod'

export const EXCLUSION_KEY_FILE = 'sheets-sensitive-exclusion.key'
export const EXCLUSION_DIR = 'sheets-sensitive-exclusions'

const recordSchema = z
  .object({
    v: z.literal(1),
    entries: z.array(
      z.object({ hash: z.string().regex(/^[0-9a-f]{64}$/), kind: z.enum(SENSITIVE_KINDS) }),
    ),
  })
  .strict()

export const exclusionItemSchema = z
  .object({ kind: z.enum(SENSITIVE_KINDS), value: z.string().max(4096) })
  .strict()

export interface SensitiveExclusionStore {
  /** for each item, whether it was dismissed before in the workbook at `docPath` */
  excluded(
    docPath: string,
    items: readonly { kind: SensitiveKind; value: string }[],
  ): Promise<boolean[]>
  /** remember a dismissed item for the workbook at `docPath` */
  add(docPath: string, item: { kind: SensitiveKind; value: string }): Promise<void>
}

async function writeAtomically(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, data)
  await rename(temp, path)
}

/** The store under `dataDir` (the app data folder). */
export function createSensitiveExclusionStore(dataDir: () => string): SensitiveExclusionStore {
  let key: Promise<Uint8Array> | null = null
  const loadKey = (): Promise<Uint8Array> => {
    key ??= (async () => {
      const path = join(dataDir(), EXCLUSION_KEY_FILE)
      try {
        const bytes = new Uint8Array(await readFile(path))
        if (bytes.length >= 32) return bytes
      } catch {
        // no key yet
      }
      const fresh = createExclusionKey()
      await writeAtomically(path, fresh)
      return fresh
    })()
    return key
  }
  const recordPath = (docPath: string): string =>
    join(
      dataDir(),
      EXCLUSION_DIR,
      `${createHash('sha256').update(docPath).digest('hex').slice(0, 32)}.json`,
    )
  const readRecord = async (docPath: string): Promise<z.infer<typeof recordSchema>> => {
    try {
      return recordSchema.parse(JSON.parse(await readFile(recordPath(docPath), 'utf8')))
    } catch {
      return { v: 1, entries: [] }
    }
  }
  return {
    async excluded(docPath, items) {
      const record = await readRecord(docPath)
      if (record.entries.length === 0) return items.map(() => false)
      const secret = await loadKey()
      const known = new Set(record.entries.map((entry) => `${entry.kind}:${entry.hash}`))
      return Promise.all(
        items.map(async (item) =>
          known.has(`${item.kind}:${await exclusionHash(secret, item.kind, item.value)}`),
        ),
      )
    },
    async add(docPath, item) {
      const secret = await loadKey()
      const hash = await exclusionHash(secret, item.kind, item.value)
      const record = await readRecord(docPath)
      if (record.entries.some((entry) => entry.hash === hash && entry.kind === item.kind)) return
      record.entries.push({ hash, kind: item.kind })
      await writeAtomically(recordPath(docPath), JSON.stringify(record))
    },
  }
}
