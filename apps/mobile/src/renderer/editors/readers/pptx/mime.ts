/**
 * Display MIME of a deck media part, decided the way the PC slides app decides it
 * (apps/slides/src/main/media-mime.ts `displayMime`): magic bytes win over the file
 * extension, then the extension, then PNG. Legacy converters mislabel media (a PNG
 * stored as .emf), so the real container is sniffed first.
 *
 * Re-implemented here because the PC helper lives in the slides main-process folder;
 * tests/readers-pptx-adapter.test.ts checks both give the same answer.
 */

const EXT_MIME: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  emf: 'image/x-emf',
  wmf: 'image/x-wmf',
}

function startsWith(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false
  return true
}

/** MIME from magic bytes, or null when the header is not one we know. */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'
  if (startsWith(bytes, [0x42, 0x4d])) return 'image/bmp'
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return 'image/webp'
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a]))
    return 'image/tiff'
  // EMF: record type 1 (EMR_HEADER) and the " EMF" signature at offset 40
  if (
    startsWith(bytes, [0x01, 0x00, 0x00, 0x00]) &&
    startsWith(bytes, [0x20, 0x45, 0x4d, 0x46], 40)
  )
    return 'image/x-emf'
  // Placeable WMF
  if (startsWith(bytes, [0xd7, 0xcd, 0xc6, 0x9a])) return 'image/x-wmf'
  return null
}

/** Effective display MIME: sniffed container first, then the extension, then PNG. */
export function displayMime(mediaRef: string, bytes: Uint8Array): string {
  const sniffed = sniffImageMime(bytes)
  if (sniffed) return sniffed
  const ext = mediaRef.split('.').pop()?.toLowerCase() ?? ''
  return EXT_MIME[ext] ?? 'image/png'
}

/** EMF and WMF: the WebView cannot decode them, and the mobile reader does not convert them. */
export function isMetafileMime(mime: string): boolean {
  return mime === 'image/x-emf' || mime === 'image/x-wmf'
}
