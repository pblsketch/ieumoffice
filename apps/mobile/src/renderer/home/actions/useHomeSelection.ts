import { useCallback, useMemo, useState } from 'react'
import { useBackLayer } from '../../shell/backStack'
import type { HomeFileItem } from './types'

export interface HomeSelection {
  readonly selecting: boolean
  /** Picked row keys in pick order (merge order). */
  readonly selectedKeys: readonly string[]
  /** Picked rows in pick order; rows that left the list are dropped. */
  readonly selectedItems: readonly HomeFileItem[]
  isSelected(key: string): boolean
  /** Enters selection with `key` picked (long press, [⋯] "Select", a picture in a folder). */
  start(key: string): void
  /** Picks or unpicks; unpicking the last row leaves selection. */
  toggle(key: string): void
  /** Leaves selection ([close], Back, or after a bar action). */
  clear(): void
}

/**
 * Selection mode over a list's rows (spec 3.7). While it is on, Back closes it as one layer of the
 * app's back stack.
 */
export function useHomeSelection(items: readonly HomeFileItem[]): HomeSelection {
  const [keys, setKeys] = useState<readonly string[]>([])

  const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items])
  const selectedKeys = useMemo(() => keys.filter((key) => byKey.has(key)), [keys, byKey])
  const selectedItems = useMemo(
    () => selectedKeys.map((key) => byKey.get(key)).filter((item) => item !== undefined),
    [selectedKeys, byKey],
  )
  const selecting = selectedKeys.length > 0

  const clear = useCallback(() => setKeys([]), [])
  const start = useCallback(
    (key: string) => setKeys((prev) => (prev.includes(key) ? prev : [...prev, key])),
    [],
  )
  const toggle = useCallback(
    (key: string) =>
      setKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key])),
    [],
  )

  useBackLayer(selecting, clear)

  return useMemo(
    () => ({
      selecting,
      selectedKeys,
      selectedItems,
      isSelected: (key: string) => selectedKeys.includes(key),
      start,
      toggle,
      clear,
    }),
    [selecting, selectedKeys, selectedItems, start, toggle, clear],
  )
}
