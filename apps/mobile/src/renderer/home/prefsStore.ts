// The home's view of the app settings (track T6): one store for the whole renderer, read by the
// home, the settings sections, the app layer and other tracks (T3 reads isEditorOn('pdfTools')).
// App keeps its own copy of the four older fields; this store owns reading and writing the home fields.
import { useMemo, useSyncExternalStore } from 'react'
import type {
  MobileAppPrefs,
  MobileAppPrefsPatch,
  MobileClient,
  MobileTheme,
} from '@genoffice/mobile-bridge/transport'
import { EDITOR_KINDS } from '../editors/registry'
import { DEFAULT_PREFS } from '../settings/defaultPrefs'
import { getHomeRuntime } from './homeRuntime'

/** The editors-off id of the PDF tools (not an editor kind, so the all-off rule leaves it alone). */
export const PDF_TOOLS_ID = 'pdfTools'

export type HomeTipId = 'editButton' | 'flowView' | 'firstEdit' | 'firstKeyboard'

/** Every first-use tip, in the order of spec 3.14. */
export const HOME_TIP_IDS: readonly HomeTipId[] = [
  'editButton',
  'flowView',
  'firstEdit',
  'firstKeyboard',
]

/** The settings with every home field filled in. */
export interface HomePrefs {
  readonly lang: string
  readonly theme: MobileTheme
  readonly hwpDefaultFormat: 'hwp' | 'hwpx'
  readonly aiEnabled: boolean
  readonly editorsOff: readonly string[]
  readonly homeKindsHidden: readonly string[]
  readonly homeKindsOrder: readonly string[]
  readonly keepScreenOnWhileReading: boolean
  readonly firstRunDone: boolean
  readonly tipsSeen: readonly string[]
  /**
   * '' — none recorded (fresh install: write the current version, show nothing).
   * null — the stored settings have no such field (older backend, test double): read it as the
   * current version, so "what's new" does not show.
   */
  readonly lastSeenVersion: string | null
}

export interface HomePrefsView {
  readonly prefs: HomePrefs
  /** True once the stored settings were read; before that `prefs` holds the missing-field values. */
  readonly loaded: boolean
  isEditorOn(id: string): boolean
}

function stringList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null
  return value.filter((item): item is string => typeof item === 'string')
}

/**
 * Fills in what the stored settings leave out (spec 3.19 "missing" column): editors and cards as
 * they are, screen kept on, first run done, every tip seen, nothing new to show. The four older
 * fields fall back to DEFAULT_PREFS. Anything that is not a settings object reads as empty.
 */
export function normalizeHomePrefs(raw: unknown): HomePrefs {
  const record: Record<string, unknown> =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const theme = record.theme
  const hwpDefaultFormat = record.hwpDefaultFormat
  return {
    lang: typeof record.lang === 'string' ? record.lang : DEFAULT_PREFS.lang,
    theme:
      theme === 'light' || theme === 'dark' || theme === 'system' ? theme : DEFAULT_PREFS.theme,
    hwpDefaultFormat:
      hwpDefaultFormat === 'hwp' || hwpDefaultFormat === 'hwpx'
        ? hwpDefaultFormat
        : DEFAULT_PREFS.hwpDefaultFormat,
    aiEnabled: typeof record.aiEnabled === 'boolean' ? record.aiEnabled : DEFAULT_PREFS.aiEnabled,
    editorsOff: stringList(record.editorsOff) ?? [],
    homeKindsHidden: stringList(record.homeKindsHidden) ?? [],
    homeKindsOrder: stringList(record.homeKindsOrder) ?? [],
    keepScreenOnWhileReading:
      typeof record.keepScreenOnWhileReading === 'boolean' ? record.keepScreenOnWhileReading : true,
    firstRunDone: typeof record.firstRunDone === 'boolean' ? record.firstRunDone : true,
    tipsSeen: stringList(record.tipsSeen) ?? [...HOME_TIP_IDS],
    lastSeenVersion: typeof record.lastSeenVersion === 'string' ? record.lastSeenVersion : null,
  }
}

/** Back to the stored shape; a null version stays missing. */
function toStored(prefs: HomePrefs): MobileAppPrefs {
  const { lastSeenVersion, ...rest } = prefs
  return lastSeenVersion === null ? rest : { ...rest, lastSeenVersion }
}

/**
 * Whether editor `id` is on in `prefs`. When every registered editor kind is off, all of them read
 * as on (as on the PC); the PDF tools and ids outside the registry follow their own value.
 */
export function isEditorOnIn(prefs: HomePrefs, id: string): boolean {
  const off = new Set(prefs.editorsOff)
  if (!off.has(id)) return true
  const kindIds = EDITOR_KINDS.map((kind) => kind.id)
  if (!kindIds.includes(id)) return false
  return kindIds.every((kindId) => off.has(kindId))
}

interface Snapshot {
  readonly prefs: HomePrefs
  readonly loaded: boolean
}

let snapshot: Snapshot = { prefs: normalizeHomePrefs(undefined), loaded: false }
let knownClient: MobileClient | null = null
let loading: Promise<void> | null = null
// Reads and writes run one after another, so a late reply never overwrites a newer value.
let queue: Promise<unknown> = Promise.resolve()
// Bumped by the test reset so work started before it does not touch the fresh store.
let generation = 0
const listeners = new Set<() => void>()

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

function publish(next: Snapshot): void {
  snapshot = next
  for (const listener of [...listeners]) listener()
}

function clientFor(client?: MobileClient | null): MobileClient | null {
  return client ?? knownClient ?? getHomeRuntime()?.client ?? null
}

export function subscribeHomePrefs(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The current settings outside React. */
export function getHomePrefs(): HomePrefs {
  return snapshot.prefs
}

export function homePrefsLoaded(): boolean {
  return snapshot.loaded
}

/** Whether editor `id` (an EDITOR_KINDS id or 'pdfTools') is on now. */
export function isEditorOn(id: string): boolean {
  return isEditorOnIn(snapshot.prefs, id)
}

/**
 * Reads the stored settings once. Calls during a read wait for it. Without a client (none passed,
 * none seen before, no runtime host) it resolves at once and the missing-field values stay. A
 * failed read also leaves them and resolves; a later call tries again.
 */
export function ensureLoaded(client?: MobileClient | null): Promise<void> {
  if (client) knownClient = client
  if (snapshot.loaded) return Promise.resolve()
  if (loading) return loading
  const source = clientFor(client)
  if (!source) return Promise.resolve()
  const started = generation
  const run = enqueue(async () => {
    try {
      const raw = await source.getAppPrefs()
      if (started !== generation) return
      publish({ prefs: normalizeHomePrefs(raw), loaded: true })
    } catch {
      // keep the missing-field values (all editors on); the next call reads again
    }
  }).finally(() => {
    if (loading === run) loading = null
  })
  loading = run
  return run
}

/**
 * Saves `patch` through the client (passed, seen by ensureLoaded, or the runtime host's) and keeps
 * what the backend returns; fields the reply lacks keep the saved values. Without any client the
 * patch is kept in memory only. A failed save rejects and leaves the values as they were.
 */
export function updateHomePrefs(
  patch: MobileAppPrefsPatch,
  client?: MobileClient | null,
): Promise<HomePrefs> {
  if (client) knownClient = client
  const started = generation
  return enqueue(async () => {
    const target = clientFor(client)
    const reply: unknown = target ? await target.setAppPrefs(patch) : null
    if (started !== generation) return snapshot.prefs
    const replied = reply && typeof reply === 'object' ? (reply as Record<string, unknown>) : {}
    const prefs = normalizeHomePrefs({ ...toStored(snapshot.prefs), ...patch, ...replied })
    publish({ prefs, loaded: snapshot.loaded })
    return prefs
  })
}

/** Turns one editor (or 'pdfTools') on or off and saves the list. */
export function setEditorOn(
  id: string,
  on: boolean,
  client?: MobileClient | null,
): Promise<HomePrefs> {
  const off = snapshot.prefs.editorsOff
  const next = on ? off.filter((item) => item !== id) : off.includes(id) ? off : [...off, id]
  return updateHomePrefs({ editorsOff: next }, client)
}

function readSnapshot(): Snapshot {
  return snapshot
}

/** The settings for a component, re-rendered when they change. */
export function useHomePrefs(): HomePrefsView {
  const current = useSyncExternalStore(subscribeHomePrefs, readSnapshot, readSnapshot)
  return useMemo(
    () => ({
      prefs: current.prefs,
      loaded: current.loaded,
      isEditorOn: (id: string) => isEditorOnIn(current.prefs, id),
    }),
    [current],
  )
}

/** Tests only: back to the state before any read. */
export function resetHomePrefsForTest(): void {
  generation += 1
  knownClient = null
  loading = null
  queue = Promise.resolve()
  publish({ prefs: normalizeHomePrefs(undefined), loaded: false })
}
