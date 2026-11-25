// Owned by track T6: the app settings' first values (the shape lives in mobile-bridge's transport).
import type { MobileAppPrefs } from '@genoffice/mobile-bridge/transport'

export const DEFAULT_PREFS: MobileAppPrefs = {
  lang: 'ko',
  theme: 'system',
  hwpDefaultFormat: 'hwp',
  // AI starts hidden on mobile; the user turns it on in Settings.
  aiEnabled: false,
}
