import init, { HwpDocument } from '@rhwp/core'
import type { FlowSourceDocument } from './hwpFlow'

/** Path of the studio's rhwp WASM, filled in at build time (see vite.config.ts). */
declare const __IEUM_RHWP_WASM__: string

let engineReady: Promise<void> | null = null

/** Starts the rhwp engine once, reusing the WASM file the studio already ships. */
export function loadRhwpEngine(): Promise<void> {
  if (!engineReady) {
    engineReady = init({ module_or_path: __IEUM_RHWP_WASM__ }).then(() => undefined)
    engineReady.catch(() => {
      engineReady = null
    })
  }
  return engineReady
}

export interface FlowEngineDocument extends FlowSourceDocument {
  free(): void
}

/** Opens document bytes for the flow view. Throws for files the engine cannot open (e.g. password). */
export async function openFlowDocument(bytes: Uint8Array): Promise<FlowEngineDocument> {
  await loadRhwpEngine()
  return new HwpDocument(bytes) as unknown as FlowEngineDocument
}
