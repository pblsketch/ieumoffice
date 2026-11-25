// The home's runtime (track T6): the HomeHost the app layer puts in, for screens that App does not
// hand a client to (e.g. settings sections), and where each open session came from (spec 3.9).
import { useSyncExternalStore } from 'react'
import type { HomeHost } from './homeHost'

let runtime: HomeHost | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The app layer sets the host once it is drawn (and null when it goes away). */
export function setHomeRuntime(host: HomeHost | null): void {
  if (runtime === host) return
  runtime = host
  for (const listener of [...listeners]) listener()
}

/** The host outside React; null before the app layer set it (and in tests). */
export function getHomeRuntime(): HomeHost | null {
  return runtime
}

/** The host for a component; re-renders when the app layer sets it. Null when there is none. */
export function useHomeRuntime(): HomeHost | null {
  return useSyncExternalStore(subscribe, getHomeRuntime, getHomeRuntime)
}

/** Where a session came from: the sample document, or a file another app handed over. */
export type SessionOrigin = 'sample' | 'received'

const origins = new Map<string, SessionOrigin>()

export function markSessionOrigin(sessionId: string, origin: SessionOrigin): void {
  origins.set(sessionId, origin)
}

/** The recorded origin, or null for a session opened any other way. */
export function sessionOrigin(sessionId: string): SessionOrigin | null {
  return origins.get(sessionId) ?? null
}

/** Tests only: forgets the host and the origins. */
export function resetHomeRuntimeForTest(): void {
  origins.clear()
  setHomeRuntime(null)
}
