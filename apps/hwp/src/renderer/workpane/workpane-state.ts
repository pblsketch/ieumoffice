/**
 * Pure state, persistence, tab registry, and narrow-width auto-collapse logic
 * for the HWP left workpane shell.
 *
 * Kept free of React and DOM globals where possible so all sizing, clamping,
 * persistence, and keyboard matching rules can be unit-tested directly.
 */
import type { WorkpaneStringKey } from '../i18n/workpane'

/** Built-in workpane tabs shipped in Wave 1; additional tabs (e.g. bibliography) extend WorkpaneTabId. */
export type BuiltinWorkpaneTabId = 'outline' | 'find'

/** Extensible tab identifier so future bundles can register new tabs without changing the shell. */
export type WorkpaneTabId = BuiltinWorkpaneTabId | (string & {})

/** Descriptor for one tab in the workpane tab bar and narrow icon rail. */
export interface WorkpaneTabDef {
  readonly id: WorkpaneTabId
  /** Localized key from the workpane i18n shard; optional when `label` is supplied directly. */
  readonly labelKey?: WorkpaneStringKey
  /** Optional explicit label (used by dynamically registered tabs outside the built-in shard). */
  readonly label?: string
}

/** Default tab registry in display order: [Outline | Find]. */
export const DEFAULT_WORKPANE_TABS: readonly WorkpaneTabDef[] = Object.freeze([
  { id: 'outline', labelKey: 'workpaneTabOutline' },
  { id: 'find', labelKey: 'workpaneTabFind' },
])

export const DEFAULT_WORKPANE_TAB: BuiltinWorkpaneTabId = 'outline'

/** Persistence keys in localStorage, independent of the shell's file panel (decision 0168). */
export const WORKPANE_OPEN_KEY = 'hwpapp.workpaneOpen'
export const WORKPANE_TAB_KEY = 'hwpapp.workpaneTab'
export const WORKPANE_WIDTH_KEY = 'hwpapp.workpaneWidth'

/** Default, minimum, and maximum expanded widths (px). */
export const WORKPANE_WIDTH_DEFAULT = 280
export const WORKPANE_WIDTH_MIN = 220
export const WORKPANE_WIDTH_MAX = 460

/** Width of the vertical icon strip when auto-collapsed on narrow windows (px). */
export const WORKPANE_RAIL_WIDTH = 40

/** Minimum document stage width (px) below which the workpane auto-collapses to an icon rail. */
export const MIN_DOC_WIDTH = 360

export type WorkpaneDisplayMode = 'expanded' | 'rail'

export interface WorkpaneLayout {
  mode: WorkpaneDisplayMode
  /** Effective column width in CSS pixels (clamped expanded width or rail width). */
  width: number
  /** Remaining width left for the document stage in CSS pixels. */
  docWidth: number
}

export interface WorkpaneCommand {
  action: 'open' | 'close' | 'toggle'
  tab?: WorkpaneTabId
  focus?: boolean
}

export type FlagStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Clamp a workpane width to [WORKPANE_WIDTH_MIN, upperBound] (upperBound capped at WORKPANE_WIDTH_MAX). */
export function clampWorkpaneWidth(width: number, maxWidth = WORKPANE_WIDTH_MAX): number {
  const effectiveMax = Math.max(
    WORKPANE_WIDTH_MIN,
    Math.min(
      WORKPANE_WIDTH_MAX,
      Number.isFinite(maxWidth) ? Math.floor(maxWidth) : WORKPANE_WIDTH_MAX,
    ),
  )
  const numeric = Number.isFinite(width) ? Math.round(width) : WORKPANE_WIDTH_DEFAULT
  return Math.min(Math.max(numeric, WORKPANE_WIDTH_MIN), effectiveMax)
}

/** Whether the workpane was left open last time; defaults to closed. */
export function loadWorkpaneOpen(storage: FlagStorage = localStorage): boolean {
  try {
    return storage.getItem(WORKPANE_OPEN_KEY) === '1'
  } catch {
    return false
  }
}

/** Persist the open/closed state of the workpane. */
export function saveWorkpaneOpen(open: boolean, storage: FlagStorage = localStorage): void {
  try {
    storage.setItem(WORKPANE_OPEN_KEY, open ? '1' : '0')
  } catch {
    // storage refused: state holds for this session
  }
}

/** Load the last selected tab id if it is still registered; otherwise fall back to the first tab. */
export function loadWorkpaneTab(
  validTabs: readonly WorkpaneTabId[] = DEFAULT_WORKPANE_TABS.map((tab) => tab.id),
  storage: FlagStorage = localStorage,
): WorkpaneTabId {
  const fallback = validTabs[0] ?? DEFAULT_WORKPANE_TAB
  try {
    const saved = storage.getItem(WORKPANE_TAB_KEY)
    if (saved && validTabs.includes(saved)) return saved
    return fallback
  } catch {
    return fallback
  }
}

/** Persist the selected tab id. */
export function saveWorkpaneTab(tab: WorkpaneTabId, storage: FlagStorage = localStorage): void {
  try {
    storage.setItem(WORKPANE_TAB_KEY, tab)
  } catch {
    // storage refused: tab holds for this session
  }
}

/** Load the remembered expanded width, clamped to [WORKPANE_WIDTH_MIN, WORKPANE_WIDTH_MAX]. */
export function loadWorkpaneWidth(storage: FlagStorage = localStorage): number {
  try {
    const raw = storage.getItem(WORKPANE_WIDTH_KEY)
    if (raw === null || raw.trim() === '') return WORKPANE_WIDTH_DEFAULT
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0
      ? clampWorkpaneWidth(parsed)
      : WORKPANE_WIDTH_DEFAULT
  } catch {
    return WORKPANE_WIDTH_DEFAULT
  }
}

/** Persist the user-chosen expanded width. */
export function saveWorkpaneWidth(width: number, storage: FlagStorage = localStorage): void {
  try {
    storage.setItem(WORKPANE_WIDTH_KEY, String(clampWorkpaneWidth(width)))
  } catch {
    // storage refused: width holds for this session
  }
}

/**
 * Decide whether the open workpane stays expanded or auto-collapses into an icon rail
 * so the document stage keeps at least `minDocWidth` pixels of horizontal space.
 *
 * When `containerWidth <= 0` (before layout or in jsdom without layout metrics), stay
 * expanded at the clamped `desiredWidth`.
 */
export function resolveWorkpaneMode(
  containerWidth: number,
  desiredWidth: number,
  otherSideWidths = 0,
  minDocWidth = MIN_DOC_WIDTH,
): WorkpaneLayout {
  const clampedDesired = clampWorkpaneWidth(desiredWidth)
  const floorDoc = Number.isFinite(minDocWidth) && minDocWidth >= 0 ? minDocWidth : MIN_DOC_WIDTH
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return { mode: 'expanded', width: clampedDesired, docWidth: floorDoc }
  }
  const others = Number.isFinite(otherSideWidths) && otherSideWidths > 0 ? otherSideWidths : 0
  const availableForWorkpane = Math.floor(containerWidth - others - floorDoc)
  if (availableForWorkpane < WORKPANE_WIDTH_MIN) {
    return {
      mode: 'rail',
      width: WORKPANE_RAIL_WIDTH,
      docWidth: Math.max(0, Math.floor(containerWidth - others - WORKPANE_RAIL_WIDTH)),
    }
  }
  const effectiveWidth = Math.max(
    WORKPANE_WIDTH_MIN,
    Math.min(clampedDesired, availableForWorkpane),
  )
  return {
    mode: 'expanded',
    width: effectiveWidth,
    docWidth: Math.max(0, Math.floor(containerWidth - others - effectiveWidth)),
  }
}

/** Validate and normalize a WORKPANE_COMMAND_EVENT payload from the editor frame. */
export function parseWorkpaneCommand(
  detail: unknown,
  validTabs: readonly WorkpaneTabId[] = DEFAULT_WORKPANE_TABS.map((tab) => tab.id),
): WorkpaneCommand | null {
  if (!detail || typeof detail !== 'object') return null
  const raw = detail as { action?: unknown; tab?: unknown; focus?: unknown }
  if (raw.action !== 'open' && raw.action !== 'close' && raw.action !== 'toggle') return null
  const tab = typeof raw.tab === 'string' && validTabs.includes(raw.tab) ? raw.tab : undefined
  return {
    action: raw.action,
    ...(tab ? { tab } : {}),
    ...(raw.focus === true ? { focus: true } : {}),
  }
}

/** Match Ctrl+F (Windows/Linux) or Cmd+F (macOS), independent of IME layout via `code`. */
export function isWorkpaneFindShortcut(
  event: Pick<
    KeyboardEvent,
    'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat'
  >,
): boolean {
  if (event.repeat || event.altKey || event.shiftKey) return false
  if (!(event.ctrlKey || event.metaKey)) return false
  if (event.code === 'KeyF') return true
  return event.key.toLowerCase() === 'f'
}
