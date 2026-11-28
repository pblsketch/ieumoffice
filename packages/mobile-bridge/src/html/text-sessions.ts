import { MobileCommandError, type MobileDocSession } from '../transport'
import {
  IDENTITY_TEXT_ENVELOPE,
  parseTextEnvelope,
  serializeTextEnvelope,
  type TextEnvelope,
} from './text-envelope'

/** The text of an opened document; `utf8: false` when the file is not valid UTF-8 (view only). */
export interface OpenedText {
  readonly text: string
  readonly utf8?: false
}

interface TextRecord {
  readonly envelope: TextEnvelope
  /** The body as the editor got it (no BOM, LF). */
  readonly body: string
  /** The bytes the body came from; written back unchanged while the body is unchanged. */
  readonly bytes: Uint8Array
  readonly utf8: boolean
}

/**
 * Per session: the envelope, the body as read and the bytes it was read from (spec 3.1).
 * One store lives inside each editor's bridge API object; the HTML and Markdown bridges share it.
 */
export interface TextSessionStore {
  /** Reads `bytes` as the session's original and returns the body the editor works on. */
  remember(sessionId: string, bytes: Uint8Array): OpenedText
  /**
   * The bytes to write for `text`: the original bytes when unchanged, else the text in its
   * envelope. A session never read writes the text as is (no BOM, LF). Throws for edited text of
   * a file that was not UTF-8.
   */
  bytesFor(session: MobileDocSession | null, text: string): Uint8Array
  /** After writing `bytes` for `text` to `sessionId`: that is the session's original now. */
  written(sessionId: string, text: string, bytes: Uint8Array, from?: MobileDocSession | null): void
  forget(sessionId: string): void
}

export function createTextSessionStore(): TextSessionStore {
  const records = new Map<string, TextRecord>()
  return {
    remember(sessionId, bytes) {
      const { body, envelope, utf8 } = parseTextEnvelope(bytes)
      records.set(sessionId, { envelope, body, bytes, utf8 })
      return utf8 ? { text: body } : { text: body, utf8: false }
    },

    bytesFor(session, text) {
      const record = session ? records.get(session.sessionId) : undefined
      if (!record) return serializeTextEnvelope(text, IDENTITY_TEXT_ENVELOPE)
      if (text === record.body) return record.bytes
      if (!record.utf8) {
        throw new MobileCommandError({
          code: 'INVALID_ARGUMENT',
          messageKey: 'webNotUtf8Notice',
          detail: 'Edited text of a non-UTF-8 file cannot be written in its encoding.',
        })
      }
      return serializeTextEnvelope(text, record.envelope)
    },

    written(sessionId, text, bytes, from) {
      // a save as carries the envelope of the session it came from
      const source = from ? records.get(from.sessionId) : records.get(sessionId)
      records.set(sessionId, {
        envelope: source?.envelope ?? IDENTITY_TEXT_ENVELOPE,
        body: text,
        bytes,
        utf8: source?.utf8 ?? true,
      })
    },

    forget(sessionId) {
      records.delete(sessionId)
    },
  }
}
