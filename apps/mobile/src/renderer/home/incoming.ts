// Files other apps hand to this app (open with, share in). Owned by track T6, which grows this module
// (several files at once, view mode on arrival) without editing App.tsx.
import type { MobileClient, MobileDocSession } from '@genoffice/mobile-bridge/transport'

/** The next incoming document, or null. Errors (e.g. the open gate's refusal) are thrown to App. */
export function takeIncomingDocument(client: MobileClient): Promise<MobileDocSession | null> {
  return client.consumePendingOpenIntent()
}
