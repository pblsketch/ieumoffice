/**
 * The AI run state as a small module store, so screens outside the AI sheet
 * (the settings' "stop and turn off?" sheet, AI-T6) can read it and stop
 * everything without App or SettingsScreen passing anything down.
 * useMobileAi publishes into it and registers how to stop. Importing this
 * module sends nothing.
 */

export interface MobileAiRunState {
  /** an AI run is in flight (preparing the document's tools, streaming or running tools) */
  readonly running: boolean
  /** messages waiting in the queue strip */
  readonly queued: number
}

const IDLE: MobileAiRunState = { running: false, queued: 0 }

let state: MobileAiRunState = IDLE
let stopper: (() => void) | null = null
const listeners = new Set<() => void>()

/** The current state (the same object until it changes, for useSyncExternalStore). */
export function mobileAiRunState(): MobileAiRunState {
  return state
}

export function isMobileAiRunning(): boolean {
  return state.running
}

export function mobileAiQueuedCount(): number {
  return state.queued
}

export function subscribeMobileAiRunState(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Stops the running AI request and empties the queue (nothing when no AI sheet is bound). */
export function stopAllMobileAi(): void {
  stopper?.()
}

/** useMobileAi: the latest state. */
export function publishMobileAiRunState(next: MobileAiRunState): void {
  if (next.running === state.running && next.queued === state.queued) return
  state = next.running || next.queued > 0 ? { running: next.running, queued: next.queued } : IDLE
  for (const listener of [...listeners]) listener()
}

/** useMobileAi: how to stop everything; returns the unregister for this stopper. */
export function registerMobileAiStopAll(stop: () => void): () => void {
  stopper = stop
  return () => {
    if (stopper !== stop) return
    stopper = null
    publishMobileAiRunState(IDLE)
  }
}
