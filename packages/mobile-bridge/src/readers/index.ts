/**
 * Owned by mobile v1 track T5 (readers: epub and pptx).
 *
 * Holds the EPUB and PPTX reader Tauri command wrappers, built on
 * `invokeMobileCommand` from `../transport` with `client.transport`, so the track does not
 * widen `MobileClient`. The root `src/index.ts` does not re-export this module.
 *
 * Reading positions are kept per document (`MobileDocSession.docKey`) and the reader
 * settings once for the whole device, both on the Rust side in the app data file
 * `readers/positions.json` (commands in `apps/mobile/src-tauri/src/commands/readers.rs`).
 * The Rust side keeps the 1,000 most recently written positions and rejects a wrong
 * shape with `INVALID_ARGUMENT`.
 */
import { invokeMobileCommand, type MobileClient } from '../transport'

export type ReaderPosition =
  | {
      readonly kind: 'epub'
      /** Zero-based spine item index. */
      readonly spineIndex: number
      readonly href: string
      readonly blockId: string | null
    }
  | {
      readonly kind: 'pptx'
      /** Zero-based slide index. */
      readonly slideIndex: number
      readonly partPath: string
    }

export type ReaderTheme = 'app' | 'light' | 'sepia' | 'dark'
export type ReaderLayout = 'paged' | 'scroll'

export interface ReaderSettings {
  /** Text size multiplier, finite and above 0. */
  readonly fontScale: number
  /** Line height multiplier, or `null` to use the book's own. */
  readonly lineHeight: number | null
  readonly theme: ReaderTheme
  readonly layout: ReaderLayout
  readonly notesOpen: boolean
}

export interface ReaderState {
  readonly position: ReaderPosition | null
  readonly settings: ReaderSettings | null
}

export const READER_COMMANDS = {
  getState: 'mobile_readers_get_state',
  setPosition: 'mobile_readers_set_position',
  setSettings: 'mobile_readers_set_settings',
} as const

/** Reads the saved position of one document and the device-wide reader settings. */
export function getReaderState(client: MobileClient, docKey: string): Promise<ReaderState> {
  return invokeMobileCommand<ReaderState>(client.transport, READER_COMMANDS.getState, { docKey })
}

/** Saves where the reader is in one document. */
export async function setReaderPosition(
  client: MobileClient,
  docKey: string,
  position: ReaderPosition,
): Promise<void> {
  await invokeMobileCommand<{ ok: boolean }>(client.transport, READER_COMMANDS.setPosition, {
    docKey,
    position,
  })
}

/** Saves the reader settings shared by every EPUB and PPTX document on the device. */
export async function setReaderSettings(
  client: MobileClient,
  settings: ReaderSettings,
): Promise<void> {
  await invokeMobileCommand<{ ok: boolean }>(client.transport, READER_COMMANDS.setSettings, {
    settings,
  })
}
