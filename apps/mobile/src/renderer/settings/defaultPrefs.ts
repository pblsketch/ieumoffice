// Owned by track T6: the app settings' first values (the shape lives in mobile-bridge's transport).
import type { MobileAppPrefs } from '@genoffice/mobile-bridge/transport'

/** A fresh install's values. A field missing from stored settings reads differently: see home/prefsStore.ts. */
export const DEFAULT_PREFS: MobileAppPrefs = {
  lang: 'ko',
  theme: 'system',
  hwpDefaultFormat: 'hwpx',
  // AI starts hidden on mobile; the user turns it on in Settings.
  aiEnabled: false,
  editorsOff: [],
  homeKindsHidden: [],
  homeKindsOrder: [],
  keepScreenOnWhileReading: true,
  firstRunDone: false,
  tipsSeen: [],
  lastSeenVersion: '',
}
