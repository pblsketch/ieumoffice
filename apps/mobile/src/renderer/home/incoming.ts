// Files other apps hand to this app (open with, share in). Owned by track T6: a single document goes
// the old way (App opens it in view mode); several files or a picture come as a batch that the app
// layer shows on its receive screen (spec 3.8).
import { takeIncoming, type IncomingBatch } from '@genoffice/mobile-bridge/home'
import type { MobileClient, MobileDocSession } from '@genoffice/mobile-bridge/transport'
import { markSessionOrigin } from './homeRuntime'

const batches: IncomingBatch[] = []
const listeners = new Set<() => void>()

/** Calls `listener` whenever a received batch waits for the receive screen. */
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
  const session = await client.consumePendingOpenIntent()
  if (session && typeof session.sessionId === 'string') {
    markSessionOrigin(session.sessionId, 'received')
  }
  return session
}

/** Tests only: drops queued batches. */
export function resetIncomingForTest(): void {
  batches.length = 0
}
