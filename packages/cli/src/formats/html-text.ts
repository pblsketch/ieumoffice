import { decodeHtmlBytes as decodeHtmlBytesCore } from '@genoffice/file-parse'
import { CliError, EXIT } from '../result'

/**
 * An HTML file's bytes as text. Delegates to `@genoffice/file-parse`'s
 * `decodeHtmlBytes`, which `packages/file-parse` also uses for attachments,
 * so the two packages decode a page's charset the same way instead of
 * keeping separate implementations. That shared decoder returns `null`
 * only for a BOM-declared UTF-32 file, which this CLI path rejects.
 */
export function decodeHtmlBytes(bytes: Uint8Array): string {
  const text = decodeHtmlBytesCore(bytes)
  if (text === null) {
    throw new CliError(
      EXIT.usage,
      'Unsupported text encoding: BOM-declared UTF-32 cannot be decoded (UTF-8 and UTF-16 are supported)',
      undefined,
      { reason: 'unsupported' },
    )
  }
  return text
}
