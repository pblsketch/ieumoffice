// "What's new in this version" (track T6, spec 3.12): the notes per version, which of them to
// show after an update, and remembering the version the user has seen.
import type { MobileClient } from '@genoffice/mobile-bridge/transport'
import type { MobileStringKey } from '../../i18n'
import { updateHomePrefs, type HomePrefs } from '../prefsStore'

export interface WhatsNewEntry {
  /** The app version the notes belong to (the version in tauri.conf.json). */
  readonly version: string
  /** One string key per line of the list, in display order. */
  readonly itemKeys: readonly MobileStringKey[]
}

/** The first mobile release; its notes never show as an update, only from Help. */
export const MOBILE_FIRST_VERSION = '0.1.0'

/**
 * Notes per version, oldest first. Add an entry (and its strings in all languages) for each
 * release that changes something people should know about.
 *
 * The first-release list follows the first-release row of the release split table in
 * docs/plans/mobile-scope.md. Before the release, check it against the tracks actually merged
 * into the mobile branch and drop any line whose feature did not make it.
 */
export const WHATS_NEW_ENTRIES: readonly WhatsNewEntry[] = [
  {
    version: MOBILE_FIRST_VERSION,
    itemKeys: [
      'homeHelpNew010First',
      'homeHelpNew010Edit',
      'homeHelpNew010Read',
      'homeHelpNew010PdfTools',
      'homeHelpNew010Ai',
      'homeHelpNew010Mobile',
    ],
  },
]

interface ParsedVersion {
  readonly core: readonly number[]
  /** The part after '-' (pre-release), '' for a release. */
  readonly pre: string
}

const VERSION_PATTERN = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

function parseVersion(version: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(version.trim())
  if (!match) return null
  return { core: match[1]!.split('.').map((part) => Number(part)), pre: match[2] ?? '' }
}

function compareParsed(a: ParsedVersion, b: ParsedVersion): number {
  const length = Math.max(a.core.length, b.core.length)
  for (let i = 0; i < length; i++) {
    const diff = (a.core[i] ?? 0) - (b.core[i] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  // A pre-release comes before its release (1.0.0-beta < 1.0.0).
  if (a.pre === b.pre) return 0
  if (a.pre === '') return 1
  if (b.pre === '') return -1
  const order = a.pre.localeCompare(b.pre, 'en', { numeric: true })
  return order < 0 ? -1 : order > 0 ? 1 : 0
}

/**
 * Compares two versions by their numbers (1.10.0 > 1.9.0; missing parts count as 0). Returns
 * -1, 0 or 1, or null when either one is not a version.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return null
  return compareParsed(left, right) as -1 | 0 | 1
}

/**
 * The notes to show once on the home after an update: entries newer than `lastSeen` and not newer
 * than `current`, newest first. Nothing for a fresh install (''), for a missing field (null — read
 * as the current version), for the same or an older version, or when a version does not parse.
 */
export function whatsNewToShow(
  lastSeen: string | null,
  current: string,
  entries: readonly WhatsNewEntry[],
): WhatsNewEntry[] {
  if (lastSeen === null || lastSeen.trim() === '') return []
  const seen = parseVersion(lastSeen)
  const now = parseVersion(current)
  if (!seen || !now || compareParsed(seen, now) >= 0) return []
  const picked: { entry: WhatsNewEntry; version: ParsedVersion }[] = []
  for (const entry of entries) {
    const version = parseVersion(entry.version)
    if (!version) continue
    if (compareParsed(version, seen) > 0 && compareParsed(version, now) <= 0) {
      picked.push({ entry, version })
    }
  }
  picked.sort((a, b) => compareParsed(b.version, a.version))
  return picked.map((item) => item.entry)
}

/**
 * The newest entry not newer than `current`, for Help. When the app version is unknown (null or
 * not a version) the newest entry is shown: the list ships inside the app it describes.
 */
export function latestWhatsNewEntry(
  current: string | null,
  entries: readonly WhatsNewEntry[],
): WhatsNewEntry | null {
  const now = current === null ? null : parseVersion(current)
  let best: { entry: WhatsNewEntry; version: ParsedVersion } | null = null
  for (const entry of entries) {
    const version = parseVersion(entry.version)
    if (!version) continue
    if (now && compareParsed(version, now) > 0) continue
    if (!best || compareParsed(version, best.version) > 0) best = { entry, version }
  }
  return best?.entry ?? null
}

/** Remembers that the notes up to `currentVersion` were seen (or that this install starts there). */
export function markWhatsNewSeen(
  currentVersion: string,
  client?: MobileClient | null,
): Promise<HomePrefs> {
  return updateHomePrefs({ lastSeenVersion: currentVersion }, client)
}
