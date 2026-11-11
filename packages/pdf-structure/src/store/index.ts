/**
 * @genoffice/pdf-structure/store — the result store (spec §6). Node-only
 * (node:fs, node:crypto), so it is its own package entry and is not exported
 * from the package root. `keys.ts` is pure and may be imported directly by
 * environment-free code.
 */
import { createHash } from 'node:crypto'
import { open, stat } from 'node:fs/promises'

export {
  ResultStore,
  STORE_DIR_NAME,
  JOB_FILE,
  JOB_KINDS,
  JOB_RUNNING_WINDOW_MS,
  MODE_JOB_KINDS,
  TRANSLATION_MODES,
  isTranslationMode,
  jobKeyField,
  jobKeyOf,
  jobModeAllowed,
  type AiReadPayload,
  type AiReadPageEntry,
  type JobKind,
  type JobLastError,
  type JobProgress,
  type JobRecordInput,
  type JobState,
  type JobStatus,
  type MigrateInput,
  type MigrateResult,
  type ResultStoreOptions,
  type StoredTranslation,
  type TranslationBlockEntry,
  type TranslationBlockInput,
  type TranslationBlockStatus,
  type TranslationMetaInput,
  type TranslationMode,
} from './store'
export { StoreWriteError } from './files'
export { sentenceEndsPair, validSentenceEnds, type SentenceEnds } from './sentence-ends'
export {
  HIGHLIGHT_MAX_LABELS,
  HIGHLIGHT_PRESET_IDS,
  type HighlightBlockEntry,
  type HighlightBlockInput,
  type HighlightLabel,
  type HighlightPresetId,
  type HighlightRun,
  type HighlightSuggestion,
  type HighlightSuggestionState,
  type InsightsEntry,
  type PassageCard,
  type PassageCardInput,
} from './reading'
export {
  NOTE_LINKS_FILE,
  noteLinkKey,
  type FoundNoteLink,
  type NoteLink,
  type NoteLinks,
} from './note-links'
export {
  blockKeyString,
  normalizeSourceText,
  translationBlockKeys,
  type TranslationBlockKey,
} from './keys'

/** document key: SHA-256 hex of the file bytes */
export function documentHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

const pendingHashes = new Map<string, { identity: string; promise: Promise<string> }>()

async function hashFile(path: string): Promise<string> {
  const file = await open(path, 'r')
  try {
    // A reusable buffer avoids thousands of external ArrayBuffer allocations.
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    const hash = createHash('sha256')
    for (;;) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null)
      if (!bytesRead) return hash.digest('hex')
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    await file.close()
  }
}

/** Share simultaneous reads of the same file version; never retain a completed hash. */
export async function documentHashOfFile(path: string): Promise<string> {
  const info = await stat(path)
  const identity = [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(':')
  const pending = pendingHashes.get(path)
  if (pending?.identity === identity) return pending.promise
  const entry = { identity, promise: hashFile(path) }
  pendingHashes.set(path, entry)
  try {
    return await entry.promise
  } finally {
    if (pendingHashes.get(path) === entry) pendingHashes.delete(path)
  }
}
