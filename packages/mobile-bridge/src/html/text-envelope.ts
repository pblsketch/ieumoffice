/**
 * The file-level facts of a text file (HTML, Markdown, plain text) that must survive
 * open → edit → save untouched: a leading UTF-8 BOM and the line ending. Editors only see the
 * body without a BOM and with LF line ends; the trailing newline stays in the body.
 * Same rule as the desktop HTML editor's `document/envelope.ts`, minus the trailing newline.
 */
export interface TextEnvelope {
  readonly bom: boolean
  readonly eol: '\n' | '\r\n'
}

/** The envelope of a new document or a session whose bytes were never read: body bytes as is. */
export const IDENTITY_TEXT_ENVELOPE: TextEnvelope = Object.freeze({ bom: false, eol: '\n' })

export interface ParsedTextEnvelope {
  /** No BOM, LF line ends. When `utf8` is false: a lossy decode, for viewing only. */
  readonly body: string
  readonly envelope: TextEnvelope
  /** false: the bytes are not valid UTF-8; writing an edited body would change the encoding. */
  readonly utf8: boolean
}

const BOM = '﻿'

function decode(bytes: Uint8Array): { text: string; utf8: boolean } {
  // ignoreBOM keeps a leading U+FEFF in the text so the envelope can remember it
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
      utf8: true,
    }
  } catch {
    return { text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes), utf8: false }
  }
}

export function parseTextEnvelope(bytes: Uint8Array): ParsedTextEnvelope {
  const { text, utf8 } = decode(bytes)
  const bom = text.startsWith(BOM)
  const raw = bom ? text.slice(1) : text
  const crlf = raw.match(/\r\n/g)?.length ?? 0
  const lf = raw.match(/(?<!\r)\n/g)?.length ?? 0
  return {
    body: raw.replace(/\r\n?/g, '\n'),
    envelope: { bom, eol: crlf > lf ? '\r\n' : '\n' },
    utf8,
  }
}

/** The bytes of `body` (LF line ends) in `envelope`: line ends re-applied, BOM put back. */
export function serializeTextEnvelope(body: string, envelope: TextEnvelope): Uint8Array {
  const lf = body.replace(/\r\n?/g, '\n')
  const withEol = envelope.eol === '\n' ? lf : lf.replace(/\n/g, envelope.eol)
  return new TextEncoder().encode(envelope.bom ? BOM + withEol : withEol)
}
