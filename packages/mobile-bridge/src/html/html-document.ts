import { MobileCommandError, type MobileClient, type MobileDocSession } from '../transport'
import { createTextSessionStore, type OpenedText } from './text-sessions'

/** The text of an opened HTML document; `utf8: false` when the file is not valid UTF-8 (view only). */
export type MobileHtmlOpenedText = OpenedText

/**
 * The HTML editor's file side: the same flow as the Markdown bridge, and the bytes follow the
 * text envelope rule (spec 3.1). Only the document's own source goes through here; the preview
 * copy (element ids, CSP) never does.
 */
export interface MobileHtmlApi {
  /** Reads the file and remembers its envelope (BOM, line ends) and bytes for this session. */
  readDocument(session: MobileDocSession): Promise<MobileHtmlOpenedText>
  /** Same as readDocument for bytes the caller already has (a recovery copy reopened in `session`). */
  openFromBytes(session: MobileDocSession, bytes: Uint8Array): MobileHtmlOpenedText
  saveDocument(session: MobileDocSession, html: string): Promise<{ readonly ok: true }>
  saveAsDocument(
    session: MobileDocSession | null,
    suggestedName: string,
    html: string,
  ): Promise<MobileDocSession>
  shareDocument(session: MobileDocSession, html: string): Promise<{ readonly ok: boolean }>
  writeRecovery(session: MobileDocSession, html: string): Promise<{ readonly ok: boolean }>
  discardRecovery(docKey: string): Promise<{ readonly ok: boolean }>
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Bytes of a base64 string (a recovery copy as App hands it over). */
export function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'))
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function createMobileHtmlApi(client: MobileClient): MobileHtmlApi {
  const texts = createTextSessionStore()

  return {
    async readDocument(session) {
      const result = await client.readFileBytes(session.sessionId)
      return texts.remember(session.sessionId, base64ToBytes(result.bytesBase64))
    },

    openFromBytes(session, bytes) {
      return texts.remember(session.sessionId, bytes)
    },

    async saveDocument(session, html) {
      if (!session.writable || session.ephemeral) {
        throw new MobileCommandError({
          code: 'READ_ONLY_URI',
          messageKey: 'readonlyShareNotice',
          detail: 'Read-only or ephemeral URI requires Save As.',
        })
      }
      const bytes = texts.bytesFor(session, html)
      await client.saveFileBytes(session.sessionId, bytesToBase64(bytes))
      texts.written(session.sessionId, html, bytes)
      await client.recoveryDiscard(session.docKey).catch(() => {})
      return { ok: true }
    },

    async saveAsDocument(session, suggestedName, html) {
      const bytes = texts.bytesFor(session, html)
      const nextSession = await client.saveAsFileBytes({
        sessionId: session?.sessionId,
        suggestedName,
        format: 'html',
        bytesBase64: bytesToBase64(bytes),
      })
      texts.written(nextSession.sessionId, html, bytes, session)
      if (session && session.sessionId !== nextSession.sessionId) texts.forget(session.sessionId)
      if (session) await client.recoveryDiscard(session.docKey).catch(() => {})
      return nextSession
    },

    async shareDocument(session, html) {
      return client.shareFile({
        sessionId: session.sessionId,
        suggestedName: session.name,
        mode: 'edited',
        bytesBase64: bytesToBase64(texts.bytesFor(session, html)),
      })
    },

    async writeRecovery(session, html) {
      return client.recoveryWrite({
        docKey: session.docKey,
        format: 'html',
        title: session.name,
        bytesBase64: bytesToBase64(texts.bytesFor(session, html)),
      })
    },

    async discardRecovery(docKey) {
      return client.recoveryDiscard(docKey)
    },
  }
}
