import { decodeHtmlBytes as decodeHtmlBytesCore } from '@genoffice/file-parse'

/**
 * An HTML file's bytes as text. Delegates to `@genoffice/file-parse`'s
 * `decodeHtmlBytes`, which `packages/file-parse` also uses for attachments,
 * so the two packages decode a page's charset the same way instead of
 * keeping separate implementations. That shared decoder returns `null` only
 * for a BOM-declared UTF-32 file; this CLI path has never rejected a file
 * for its encoding, so that case falls back to a plain UTF-8 decode here
 * (broken bytes become replacement characters) rather than failing.
 */
export function decodeHtmlBytes(bytes: Uint8Array): string {
  return decodeHtmlBytesCore(bytes) ?? new TextDecoder('utf-8').decode(bytes)
}
