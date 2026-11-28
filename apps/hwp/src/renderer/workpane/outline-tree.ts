/**
 * Pure tree-filtering, branch collapse, and display helpers for OutlineTab.
 */
import {
  MAX_OUTLINE_LEVEL,
  MIN_OUTLINE_LEVEL,
  type OutlineItem,
  type OutlineStyleMap,
} from '../../../studio-plugin/outline.mjs'

/** Minimum number of numeric level filter buttons shown beside "All". */
export const MIN_FILTER_LEVELS = 3
/** Maximum number of numeric level filter buttons shown beside "All". */
export const MAX_FILTER_LEVELS = 6

export interface VisibleOutlineRow {
  item: OutlineItem
  /** Index in the full, unfiltered outline `items` array. */
  index: number
  /** Stable key (`sec:para`) identifying the heading paragraph. */
  key: string
  /** True when at least one visible heading right below this row has a deeper level. */
  hasChildren: boolean
  /** True when this row has children and its subtree is currently collapsed. */
  isCollapsed: boolean
  /** 0-based indentation depth (`item.level - 1`, clamped to >= 0). */
  depth: number
}

/** Stable identifier for a body heading paragraph. */
export function outlineItemKey(item: Pick<OutlineItem, 'sec' | 'para'>): string {
  return `${item.sec}:${item.para}`
}

/** Parse a `sec:para` key back into coordinates, or null if malformed. */
export function parseOutlineItemKey(raw: string): { sec: number; para: number } | null {
  const match = /^(\d+):(\d+)$/.exec(raw.trim())
  if (!match) return null
  return { sec: Number(match[1]), para: Number(match[2]) }
}

/**
 * Compute the numeric level filter buttons to show beside "All":
 * always at least `1..3`, expanding up to the deepest level in `items` capped at `6`.
 */
export function computeFilterLevels(items: readonly OutlineItem[]): number[] {
  let maxPresent = 0
  for (const item of items) {
    if (item.level > maxPresent) maxPresent = item.level
  }
  const maxShown = Math.max(MIN_FILTER_LEVELS, Math.min(MAX_FILTER_LEVELS, maxPresent))
  const levels: number[] = []
  for (let level = MIN_OUTLINE_LEVEL; level <= maxShown; level++) {
    levels.push(level)
  }
  return levels
}

/**
 * Apply level filtering and per-branch collapse state to a flat document-order
 * list of outline items.
 */
export function computeVisibleOutlineRows(
  items: readonly OutlineItem[],
  maxLevel: number | null,
  collapsedKeys: ReadonlySet<string>,
): VisibleOutlineRow[] {
  const filtered: Array<{ item: OutlineItem; index: number }> = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (maxLevel !== null && item.level > maxLevel) continue
    filtered.push({ item, index: i })
  }

  const rows: VisibleOutlineRow[] = []
  let collapsedAboveLevel: number | null = null

  for (let i = 0; i < filtered.length; i++) {
    const { item, index } = filtered[i]
    if (collapsedAboveLevel !== null) {
      if (item.level > collapsedAboveLevel) {
        continue
      }
      collapsedAboveLevel = null
    }

    const key = outlineItemKey(item)
    const next = filtered[i + 1]?.item
    const hasChildren = next !== undefined && next.level > item.level
    const isCollapsed = hasChildren && collapsedKeys.has(key)

    if (isCollapsed) {
      collapsedAboveLevel = item.level
    }

    rows.push({
      item,
      index,
      key,
      hasChildren,
      isCollapsed,
      depth: Math.max(0, item.level - MIN_OUTLINE_LEVEL),
    })
  }

  return rows
}

/** Return the printed page badge string for an outline item. */
export function formatPrintedPage(item: Pick<OutlineItem, 'page' | 'pageLabel'>): string {
  if (typeof item.pageLabel === 'string' && item.pageLabel.length > 0) {
    return item.pageLabel
  }
  return String(item.page)
}

/** Sort style-to-level entries by level ascending, then style name. */
export function sortOutlineStyleEntries(map: OutlineStyleMap): Array<[string, number]> {
  return Object.entries(map).sort((a, b) => {
    if (a[1] !== b[1]) return a[1] - b[1]
    return a[0].localeCompare(b[0])
  })
}

/** All supported outline levels `1..10`. */
export const ALL_OUTLINE_LEVELS: readonly number[] = Array.from(
  { length: MAX_OUTLINE_LEVEL - MIN_OUTLINE_LEVEL + 1 },
  (_, idx) => MIN_OUTLINE_LEVEL + idx,
)
