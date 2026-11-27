// The build settings one track adds to the mobile app (Vite bundle, Vitest, type check).
// Each track fills only its own file in this folder; index.ts already merges every track.
import type { Plugin } from 'vite'

export interface TrackBuild {
  /** Vite plugins for the bundle and the tests (scope each one to the track's own modules). */
  readonly plugins?: readonly Plugin[]
  /** Vite worker plugins factory merged across all tracks for `worker.plugins`. */
  readonly workerPlugins?: () => readonly Plugin[]
  /** Import aliases for the bundle and the tests (e.g. a mobile stand-in for a desktop-only module). */
  readonly alias?: Readonly<Record<string, string>>
  /** Compile-time constants (`define`), values already JSON-encoded. */
  readonly define?: Readonly<Record<string, string>>
  /** Extra Vitest setup files, relative to apps/mobile. */
  readonly testSetupFiles?: readonly string[]
}
