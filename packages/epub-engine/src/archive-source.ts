/** A small metadata-only ZIP lets JSZip keep its filename decoding semantics. */
import JSZip from 'jszip'
import {
  readZipSourcePart,
  streamZipSourcePart,
  type ZipByteSource,
  type ZipSourcePart,
} from '@genoffice/zip-gate'
import { sourceCompressedData } from './source-compressed-data'

const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

/**
 * This index is never saved. Its zero-length entries carry ordinal comments so
 * Unicode names, path normalization and duplicate-name handling stay JSZip's.
 * Saving builds a separate metadata archive with lazy original compressed data.
 */
async function metadataArchive(parts: readonly ZipSourcePart[], ordinal: boolean) {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  let centralSize = 0
  for (const [index, part] of parts.entries()) {
    const local = new Uint8Array(part.localHeader)
    const lv = viewOf(local)
    lv.setUint16(6, lv.getUint16(6, true) & ~8, true)
    lv.setUint16(8, 0, true)
    lv.setUint32(14, 0, true)
    lv.setUint32(18, 0, true)
    lv.setUint32(22, 0, true)
    const original = viewOf(part.centralHeader)
    const nameLength = original.getUint16(28, true)
    const extraLength = original.getUint16(30, true)
    const comment = ordinal
      ? new TextEncoder().encode(`ieum-source:${index}`)
      : part.centralHeader.subarray(46 + nameLength + extraLength)
    const central = new Uint8Array(46 + nameLength + extraLength + comment.length)
    central.set(part.centralHeader.subarray(0, 46 + nameLength + extraLength))
    central.set(comment, 46 + nameLength + extraLength)
    const cv = viewOf(central)
    cv.setUint16(8, cv.getUint16(8, true) & ~8, true)
    cv.setUint16(10, 0, true)
    cv.setUint32(16, 0, true)
    cv.setUint32(20, 0, true)
    cv.setUint32(24, 0, true)
    cv.setUint16(32, comment.length, true)
    cv.setUint32(42, offset, true)
    // An original Unicode-comment extra field must not hide the ordinal.
    const extraEnd = 46 + nameLength + extraLength
    for (let at = 46 + nameLength; at + 4 <= extraEnd;) {
      const length = cv.getUint16(at + 2, true)
      if (at + 4 + length > extraEnd) throw new Error('zip: corrupt extra field')
      if (ordinal && cv.getUint16(at, true) === 0x6375) cv.setUint16(at, 0xffff, true)
      at += 4 + length
    }
    locals.push(local)
    centrals.push(central)
    offset += local.length
    centralSize += central.length
  }
  const end = new Uint8Array(22)
  const ev = viewOf(end)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, parts.length, true)
  ev.setUint16(10, parts.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  const bytes = new Uint8Array(offset + centralSize + end.length)
  let at = 0
  for (const chunk of [...locals, ...centrals, end]) {
    bytes.set(chunk, at)
    at += chunk.length
  }
  return JSZip.loadAsync(bytes)
}

export async function sourceArchive(source: ZipByteSource, parts: readonly ZipSourcePart[]) {
  const zip = await metadataArchive(parts, true)
  const byName = new Map<string, ZipSourcePart>()
  for (const file of Object.values(zip.files)) {
    const match = /^ieum-source:(\d+)$/.exec(file.comment ?? '')
    const part = match ? parts[Number(match[1])] : undefined
    if (!part) throw new Error('zip: source index lost an entry')
    byName.set(file.name, part)
  }
  return {
    zip,
    async read(name: string) {
      const part = byName.get(name)
      return part ? readZipSourcePart(source, part) : null
    },
    stream(name: string) {
      const part = byName.get(name)
      return part ? streamZipSourcePart(source, part) : null
    },
    async loadOriginal() {
      const original = await metadataArchive(parts, false)
      // Restore real entry sizes and compressed-data protocols without reading
      // the whole original. Each worker opens its bounded source only on resume.
      for (const file of Object.values(original.files)) {
        const part = byName.get(file.name)
        if (!part || file.dir) continue
        Object.assign(file, { _data: await sourceCompressedData(source, part) })
      }
      return original
    },
  }
}
