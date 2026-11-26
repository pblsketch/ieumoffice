/**
 * Pure helpers of the files panel: path pieces, ordering and the name filter.
 * No React or DOM so the unit tests drive them directly.
 */
import type { FolderListing, FolderRoot, RecentEntry } from '../../../shared/home-api'

/** Windows paths compare case-insensitively; POSIX paths do not. */
function pathKey(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return /^[A-Za-z]:|\\/.test(path) ? trimmed.replace(/\//g, '\\').toLowerCase() : trimmed
}

export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b)
}

/** `child` is `parent` itself or sits somewhere below it. */
export function isAtOrUnder(parent: string, child: string): boolean {
  const p = pathKey(parent)
  const c = pathKey(child)
  if (p === c) return true
  const sep = p.includes('\\') ? '\\' : '/'
  return c.startsWith(p.endsWith(sep) ? p : p + sep)
}

/** The folder holding `path`; null for a path with no folder part. */
export function parentDir(path: string): string | null {
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  if (cut < 0) return null
  // keep the root's own separator: "C:\a.docx" -> "C:\", "/a.md" -> "/"
  if (cut === 0) return path.slice(0, 1)
  if (cut === 2 && path[1] === ':') return path.slice(0, 3)
  return path.slice(0, cut)
}

export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  return cut < 0 ? trimmed : trimmed.slice(cut + 1)
}

/** The tree root a path belongs to, if any. */
export function rootFor(path: string, roots: readonly FolderRoot[]): FolderRoot | undefined {
  return roots.find((root) => isAtOrUnder(root.path, path))
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * A listing in tree order: folders, then files, each by name. The home
 * listing hands files over newest first, which reads well in a table but
 * makes a tree hard to scan.
 */
export function treeOrder(listing: FolderListing): FolderListing {
  return {
    ...listing,
    folders: [...listing.folders].sort((a, b) => collator.compare(a.name, b.name)),
    files: [...listing.files].sort((a, b) => collator.compare(a.name, b.name)),
  }
}

/** Case- and accent-insensitive "name contains every word of the query". */
export function nameMatches(name: string, query: string): boolean {
  const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  const haystack = fold(name)
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}

/**
 * The search results: files from the sources the panel already holds (loaded
 * folders, recents) whose name matches, then the file index's hits, which
 * matched on name, folder or content already. Each path appears once, in that
 * order, so a sibling of the open document comes first.
 */
export function mergeFileMatches(
  query: string,
  local: ReadonlyArray<readonly RecentEntry[]>,
  indexed: readonly RecentEntry[],
): RecentEntry[] {
  const seen = new Set<string>()
  const out: RecentEntry[] = []
  const take = (entry: RecentEntry) => {
    if (entry.missing) return
    const key = pathKey(entry.path)
    if (seen.has(key)) return
    seen.add(key)
    out.push(entry)
  }
  for (const source of local) {
    for (const entry of source) if (nameMatches(entry.name, query)) take(entry)
  }
  for (const entry of indexed) take(entry)
  return out
}
