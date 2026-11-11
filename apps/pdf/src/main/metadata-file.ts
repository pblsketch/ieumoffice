import { readFile } from 'node:fs/promises'
import { releaseOwnedBuffer } from './owned-buffer'

/** For parsers returning detached metadata only; results must not contain input-byte views. */
export async function readPdfMetadataFile<T>(
  path: string,
  parse: (bytes: Uint8Array) => Promise<T>,
  restored?: Uint8Array | null,
): Promise<T> {
  if (restored) return parse(restored)
  const bytes = await readFile(path)
  try {
    return await parse(bytes)
  } finally {
    // fs.readFile owns a standalone backing store for large files. Tiny pooled
    // buffers belong to other users too and remain under Node's normal ownership.
    if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength)
      releaseOwnedBuffer(bytes.buffer as ArrayBuffer)
  }
}
