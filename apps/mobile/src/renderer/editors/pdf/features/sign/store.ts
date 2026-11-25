// Signatures remembered on the device (spec 3.6, 5): the rules of the PC
// apps/pdf/src/main/signature-store.ts (validation, newest first, identical payloads
// refreshed instead of duplicated, at most ten with the oldest evicted) over the web
// view's localStorage instead of a userData file. Nothing goes into the document folder.
//
// The PC module is not imported: it pulls node:crypto (randomUUID) and node:fs into
// the page bundle, and the mobile stand-ins exist only for the save engine. The rules
// below are the same rules, kept in step with that file.
import type { SavedSignature, SignatureData } from '../../../../../../../pdf/src/shared/ipc'
import { parseSignColor, type Rgb } from '../../../../../../../pdf/src/renderer/signature-colors'

export type { SavedSignature, SignatureData }

/** PC `MAX_SAVED_SIGNATURES`: oldest entries are evicted beyond this. */
export const MAX_SAVED_SIGNATURES = 10

/** Device storage keys (the mobile PDF prefix; never a file next to the document). */
export const SIGNATURES_KEY = 'ieum-mobile-pdf-signatures'
export const SIGN_COLOR_KEY = 'ieum-mobile-pdf-sign-color'

/** The storage calls used here (window.localStorage in the app, a stand-in in tests). */
export type SignatureStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const isFiniteDim = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0

/** PC `isSignatureData`: runtime validation for entries read back from storage. */
export function isSignatureData(value: unknown): value is SignatureData {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (!isFiniteDim(v.width) || !isFiniteDim(v.height)) return false
  if (v.kind === 'image') return typeof v.image === 'string' && v.image.length > 0
  if (v.kind === 'strokes') {
    return (
      Array.isArray(v.paths) &&
      v.paths.length > 0 &&
      v.paths.every(
        (p) =>
          Array.isArray(p) &&
          p.length >= 4 &&
          // an odd-length path pairs a coordinate with undefined
          p.length % 2 === 0 &&
          p.every((n) => typeof n === 'number' && Number.isFinite(n)),
      )
    )
  }
  return false
}

/** PC `sanitizeSignatures`: drop malformed entries instead of failing the whole list. */
export function sanitizeSignatures(raw: unknown): SavedSignature[] {
  if (!Array.isArray(raw)) return []
  const out: SavedSignature[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    if (typeof e.id !== 'string' || e.id.length === 0) continue
    if (!isSignatureData(e.data)) continue
    if (out.some((s) => s.id === e.id)) continue
    const createdAt =
      typeof e.createdAt === 'number' && Number.isFinite(e.createdAt) ? e.createdAt : 0
    out.push({ id: e.id, createdAt, data: e.data })
  }
  return out
}

/** Same payload = same signature: re-saving refreshes its position instead of duplicating. */
function sameData(a: SignatureData, b: SignatureData): boolean {
  if (a.kind !== b.kind || a.width !== b.width || a.height !== b.height) return false
  if (a.kind === 'image' && b.kind === 'image') return a.image === b.image
  if (a.kind === 'strokes' && b.kind === 'strokes') {
    return (
      a.paths.length === b.paths.length &&
      a.paths.every((p, i) => {
        const q = b.paths[i]!
        return p.length === q.length && p.every((n, j) => n === q[j])
      })
    )
  }
  return false
}

function newSignatureId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return uuid
  return `sig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** PC `addSignature`: prepend (newest first), dedupe identical payloads, cap the list. */
export function addSignature(
  list: readonly SavedSignature[],
  data: SignatureData,
  now: number = Date.now(),
  newId: () => string = newSignatureId,
): SavedSignature[] {
  const rest = list.filter((s) => !sameData(s.data, data))
  return [{ id: newId(), createdAt: now, data }, ...rest].slice(0, MAX_SAVED_SIGNATURES)
}

/** PC `removeSignature`. */
export function removeSignature(list: readonly SavedSignature[], id: string): SavedSignature[] {
  return list.filter((s) => s.id !== id)
}

/** The web view's storage, or null where there is none (storage turned off). */
export function deviceStorage(): SignatureStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

/** Missing or unreadable storage is just an empty list; broken JSON must not break signing. */
export function loadSavedSignatures(
  storage: SignatureStorage | null = deviceStorage(),
): SavedSignature[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(SIGNATURES_KEY)
    return raw ? sanitizeSignatures(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

/**
 * Writes the list and returns what was stored. When the web view's storage is full
 * (pictures are base64 PNGs), the oldest entries go first, as with the count rule;
 * the newest one is never dropped for an older one.
 */
export function writeSavedSignatures(
  list: readonly SavedSignature[],
  storage: SignatureStorage | null = deviceStorage(),
): SavedSignature[] {
  if (!storage) return [...list]
  let kept = [...list]
  for (;;) {
    try {
      if (kept.length === 0) storage.removeItem(SIGNATURES_KEY)
      else storage.setItem(SIGNATURES_KEY, JSON.stringify(kept))
      return kept
    } catch {
      if (kept.length <= 1) return kept
      kept = kept.slice(0, -1)
    }
  }
}

/** Remembers a newly made signature; returns the stored list. */
export function rememberSignature(
  data: SignatureData,
  storage: SignatureStorage | null = deviceStorage(),
  now: number = Date.now(),
): SavedSignature[] {
  return writeSavedSignatures(addSignature(loadSavedSignatures(storage), data, now), storage)
}

/** Forgets one remembered signature; returns the stored list. */
export function forgetSignature(
  id: string,
  storage: SignatureStorage | null = deviceStorage(),
): SavedSignature[] {
  return writeSavedSignatures(removeSignature(loadSavedSignatures(storage), id), storage)
}

/** The remembered signature color (PC `parseSignColor`: missing or malformed gives black). */
export function loadSignColor(storage: SignatureStorage | null = deviceStorage()): Rgb {
  try {
    return parseSignColor(storage?.getItem(SIGN_COLOR_KEY) ?? null)
  } catch {
    return parseSignColor(null)
  }
}

export function saveSignColor(color: Rgb, storage: SignatureStorage | null = deviceStorage()) {
  try {
    storage?.setItem(SIGN_COLOR_KEY, JSON.stringify(color))
  } catch {
    // a full storage only loses the remembered color
  }
}
