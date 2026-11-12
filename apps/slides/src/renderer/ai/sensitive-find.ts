import { detectSensitive, type TextPiece } from '@genoffice/agent-core/sensitive-detect'
import { exclusionHash } from '@genoffice/agent-core/sensitive-exclusion'
import { createCandidateLabeler, type ExistingMark } from '@genoffice/agent-core/sensitive-labels'
import { normalizeSensitiveValue, type SensitiveKind } from '@genoffice/agent-core/sensitive-kinds'
import {
  sensitiveContextOf,
  type SensitiveCandidateRow,
  type SensitiveUnhideableReason,
} from '@genoffice/ui'

/**
 * The editor half of "find sensitive info": the document's text goes in as
 * pieces in reading order, the shared rules-only finder runs over them, and
 * what comes out is the candidate list's rows plus the spots behind them.
 *
 * Nothing here hides anything or leaves this PC. Spots already hidden are not
 * offered again, a spot the reader excluded for this document is not offered
 * again, and the labels count on from the ones the document already has.
 */

export interface SensitivePiece<L> extends TextPiece<L> {
  /** stretches of this piece already hidden, `[start, end)`; a candidate touching one is dropped */
  hidden?: ReadonlyArray<readonly [number, number]>
  /** set when this piece's candidates cannot be hidden: shown, counted, confirm off */
  unhideable?: {
    reason?: SensitiveUnhideableReason
    reasonText?: string
  }
}

/** One candidate the list shows, with where it sits. */
export interface SensitiveSpot<L> {
  id: string
  kind: SensitiveKind
  value: string
  /** offsets into the piece's text */
  start: number
  end: number
  location: L
  label: string
  hideable: boolean
}

export interface SensitiveFound<L> {
  rows: SensitiveCandidateRow[]
  spots: Map<string, SensitiveSpot<L>>
}

export interface FindSensitiveOptions<L> {
  pieces: readonly SensitivePiece<L>[]
  /** the screen language the labels are written in */
  lang: string
  /** marks the document already has, with the words they hide */
  existingMarks?: Iterable<ExistingMark>
  /** where a spot is, as the list shows it */
  locationText: (location: L) => string
  /** a single candidate that cannot be hidden although its piece can (it would split something whole) */
  blocked?: (location: L, start: number, end: number) => SensitivePiece<L>['unhideable'] | undefined
  /** the reader excluded this value in this document before */
  isExcluded?: (kind: SensitiveKind, value: string) => boolean | Promise<boolean>
}

const overlaps = (ranges: SensitivePiece<unknown>['hidden'], start: number, end: number) =>
  (ranges ?? []).some(([from, to]) => start < to && from < end)

export async function findSensitive<L>(
  options: FindSensitiveOptions<L>,
): Promise<SensitiveFound<L>> {
  const { pieces } = options
  // the finder hands back the piece's location; the index finds the piece again
  const found = detectSensitive(
    pieces.map((p, i) => ({
      text: p.text,
      location: i,
      ...(p.header !== undefined ? { header: p.header } : {}),
    })),
  )
  const kept: Array<{ piece: SensitivePiece<L>; index: number; hit: (typeof found)[number] }> = []
  for (const hit of found) {
    const piece = pieces[hit.location]!
    if (overlaps(piece.hidden, hit.start, hit.end)) continue
    if (options.isExcluded && (await options.isExcluded(hit.kind, hit.value))) continue
    kept.push({ piece, index: hit.location, hit })
  }
  const labeler = createCandidateLabeler({
    lang: options.lang,
    ...(options.existingMarks ? { existingMarks: options.existingMarks } : {}),
  })
  const rows: SensitiveCandidateRow[] = []
  const spots = new Map<string, SensitiveSpot<L>>()
  for (const { piece, index, hit } of kept) {
    const id = `${index}:${hit.start}:${hit.end}`
    const unhideable =
      piece.unhideable ?? options.blocked?.(piece.location, hit.start, hit.end) ?? undefined
    const hideable = !unhideable
    const label = labeler.labelFor(hit.kind, hit.value)
    const context = sensitiveContextOf(piece.text, hit.start, hit.end)
    spots.set(id, {
      id,
      kind: hit.kind,
      value: hit.value,
      start: hit.start,
      end: hit.end,
      location: piece.location,
      label,
      hideable,
    })
    rows.push({
      id,
      kind: hit.kind,
      value: hit.value,
      before: context.before,
      after: context.after,
      location: options.locationText(piece.location),
      label,
      hideable,
      ...(unhideable?.reason ? { reason: unhideable.reason } : {}),
      ...(unhideable?.reasonText ? { reasonText: unhideable.reasonText } : {}),
    })
  }
  return { rows, spots }
}

/** How many candidates a text holds, for the first-send alert's attachment count. */
export function countSensitiveText(text: string): number {
  if (!text) return 0
  return detectSensitive(text.split('\n').map((line, i) => ({ text: line, location: i }))).length
}

// ── remembering "exclude" ─────────────────────────────────────────────────────

export interface SensitiveExclusionEntry {
  kind: SensitiveKind
  hash: string
}

/** The editor's back end: per document path, the hash key and what was excluded. */
export interface SensitiveExclusionBridge {
  get(docPath: string): Promise<{ key: string; entries: SensitiveExclusionEntry[] } | null>
  add(docPath: string, entry: SensitiveExclusionEntry): Promise<boolean>
}

export interface SensitiveExclusionMemory {
  isExcluded(kind: SensitiveKind, value: string): Promise<boolean>
  exclude(kind: SensitiveKind, value: string): Promise<void>
}

function keyBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/**
 * "Exclude" remembered for the document at `docPath()`: in the app's data
 * folder through the bridge when the document has a path, only for this tab
 * when it has none. Read once per path.
 */
export function createSensitiveExclusionMemory(
  bridge: SensitiveExclusionBridge | null | undefined,
  docPath: () => string | null | undefined,
): SensitiveExclusionMemory {
  const session = new Set<string>()
  let loaded: { path: string; key: Uint8Array; hashes: Set<string> } | null = null

  const sessionKey = (kind: SensitiveKind, value: string) =>
    `${kind}\u0000${normalizeSensitiveValue(kind, value)}`

  const load = async () => {
    const path = docPath()
    if (!path || !bridge) return null
    if (loaded?.path === path) return loaded
    const got = await bridge.get(path)
    if (!got || !/^[0-9a-f]{64}$/.test(got.key)) return null
    loaded = {
      path,
      key: keyBytes(got.key),
      hashes: new Set(got.entries.map((e) => `${e.kind}\u0000${e.hash}`)),
    }
    return loaded
  }

  return {
    async isExcluded(kind, value) {
      if (session.has(sessionKey(kind, value))) return true
      const memory = await load().catch(() => null)
      if (!memory || memory.hashes.size === 0) return false
      return memory.hashes.has(`${kind}\u0000${await exclusionHash(memory.key, kind, value)}`)
    },
    async exclude(kind, value) {
      session.add(sessionKey(kind, value))
      const memory = await load().catch(() => null)
      if (!memory || !bridge) return
      const hash = await exclusionHash(memory.key, kind, value)
      memory.hashes.add(`${kind}\u0000${hash}`)
      await bridge.add(memory.path, { kind, hash }).catch(() => false)
    },
  }
}
