// Files other apps hand to this app (open with, share in). Owned by track T6: a single document goes
// the old way (App opens it in view mode); several files or a picture come as a batch that the app
// layer shows on its receive screen (spec 3.8).
import { takeIncoming, type IncomingBatch } from '@genoffice/mobile-bridge/home'
import type { MobileClient, MobileDocSession } from '@genoffice/mobile-bridge/transport'
import { markSessionOrigin } from './homeRuntime'

const batches: IncomingBatch[] = []
const listeners = new Set<() => void>()

/**
 * What the first take (App's start-up check) found: still running, nothing, or a document that App
 * is opening. The app layer waits for it before showing the first-run guide, so the guide neither
 * covers a receive screen nor flashes before a received document opens.
 */
export type IncomingStartup = 'pending' | 'none' | 'document'
let startup: IncomingStartup = 'pending'

/** What the start-up take found (see `IncomingStartup`); listeners hear when it settles. */
export function incomingStartup(): IncomingStartup {
  return startup
}

function settleStartup(found: IncomingStartup): void {
  if (startup !== 'pending') return
  startup = found
  for (const listener of [...listeners]) listener()
}

/** Calls `listener` whenever a received batch waits for the receive screen or the start-up take settles. */
export function subscribeIncomingBatches(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The oldest received batch the receive screen has not shown yet (removed from the queue). */
export function takeQueuedIncomingBatch(): IncomingBatch | null {
  return batches.shift() ?? null
}

function queueBatch(batch: IncomingBatch): void {
  batches.push(batch)
  for (const listener of [...listeners]) listener()
}

/**
 * The next incoming document, or null. A waiting batch is taken first and queued for the receive
 * screen (it is not returned). A client without a transport (or a backend without the batch
 * command) skips that step. The document returned is recorded as received. Errors of the single
 * document path (e.g. the open gate's refusal) are thrown to App.
 */
export async function takeIncomingDocument(client: MobileClient): Promise<MobileDocSession | null> {
  if ((client as Partial<MobileClient>).transport) {
    try {
      const batch = await takeIncoming(client)
      if (batch && batch.entries.length > 0) queueBatch(batch)
    } catch {
      // no batch path here; the single document path below still runs
    }
  }
  let session: MobileDocSession | null
  try {
    session = await client.consumePendingOpenIntent()
  } catch (err) {
    settleStartup('none')
    throw err
  }
  if (session && typeof session.sessionId === 'string') {
    markSessionOrigin(session.sessionId, 'received')
  }
  settleStartup(session ? 'document' : 'none')
  return session
}

/** Tests only: drops queued batches and forgets the start-up take. */
export function resetIncomingForTest(): void {
  batches.length = 0
  startup = 'pending'
}
