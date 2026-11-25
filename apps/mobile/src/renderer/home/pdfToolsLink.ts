// Where track T3 plugs its PDF tools screen into the home (spec 3.18). T6 owns this file; T3 calls
// providePdfToolsLink once at the top of home/ToolsTab.tsx, so neither track imports the other's code.
import { useSyncExternalStore, type ComponentType } from 'react'
import type { HomeHost } from './homeHost'

export interface PdfToolInput {
  /** File name, extension included. */
  readonly name: string
  /** 'application/pdf' | 'image/jpeg' | … */
  readonly mime: string
  readonly sizeBytes?: number
  /** Reads on every call, so a tool can read its inputs one at a time. */
  readBytes(): Promise<Uint8Array>
}

export type PdfToolStart =
  /** The tools list. */
  | { readonly kind: 'menu' }
  /** Merge, in the order the files were picked. */
  | { readonly kind: 'merge'; readonly inputs: readonly PdfToolInput[] }
  | { readonly kind: 'imagesToPdf'; readonly inputs: readonly PdfToolInput[] }

export interface PdfToolFlowProps {
  readonly host: HomeHost
  readonly start: PdfToolStart
  /** T3 calls this when the tools screen closes (back included). */
  readonly onClose: () => void
}

export interface PdfToolsLink {
  readonly Flow: ComponentType<PdfToolFlowProps>
}

let current: PdfToolsLink | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function snapshot(): PdfToolsLink | null {
  return current
}

/** T3 calls this once, at the top of the ToolsTab.tsx module. */
export function providePdfToolsLink(link: PdfToolsLink): void {
  current = link
  for (const listener of [...listeners]) listener()
}

/** The T3 link for T6 screens; null until T3 provides it (the buttons that need it stay hidden). */
export function usePdfToolsLink(): PdfToolsLink | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
