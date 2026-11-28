// What the home screen and its tabs may ask the app to do (T6 owns this file; T3's tools tab uses it).
// App.tsx is not edited after S0, so new home features reach the app only through this object.
import type {
  MobileClient,
  MobileDocFormat,
  MobileDocSession,
} from '@genoffice/mobile-bridge/transport'
import type { ToastRequest } from '../components/Toast'

export interface HomeHost {
  readonly client: MobileClient
  /** Opens a session the way a picked or recent file opens (unsaved-change prompt included). */
  openSession(session: MobileDocSession): Promise<void>
  /** Creates and opens an untitled document; the [+] sheet reads `createFormats` of EDITOR_KINDS. */
  createNew(format: MobileDocFormat): Promise<void>
  showToast(input: ToastRequest | string): void
  refreshHome(): Promise<void>
  openSettings(): void
  /**
   * Opens `bytesBase64` as an untitled document named `name` in edit mode, marked changed (the
   * same path as restoring a recovery copy). Saving it asks where ("save as"); the source stays.
   * Optional so hosts written before it (test doubles) still type-check; App always provides it.
   */
  openUntitledCopy?(params: {
    format: MobileDocFormat
    name: string
    bytesBase64: string
  }): Promise<boolean | void>
}
