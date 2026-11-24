// Main-process / worker side: minimal UTF-8 ZIP archive writer using STORE
// (compression method 0). Intended for already-compressed image payloads (PNG,
// JPEG) where deflate adds CPU cost without reducing size.

export interface ZipStoreEntry {
  /** Archive entry name (forward-slash separated, UTF-8 encoded). */
  name: string
  data: Uint8Array
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function dosTimestamp(date: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()))
  const dosTime =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >>> 1) & 0x1f)
  const dosDate =
    (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f)
  return { time: dosTime, date: dosDate }
}

/** Builds a standard UTF-8 ZIP (method 0 / STORE) containing `entries`. */
export function buildStoreZip(entries: readonly ZipStoreEntry[], now = new Date()): Uint8Array {
  const encoder = new TextEncoder()
  const { time, date } = dosTimestamp(now)
  const prepared = entries.map((e) => {
    const cleanName = e.name.replace(/\\/g, '/').replace(/^\/+/, '')
    const nameBytes = encoder.encode(cleanName)
    return {
      nameBytes,
      data: e.data,
      crc: crc32(e.data),
      offset: 0,
    }
  })

  let localSize = 0
  let centralSize = 0
  for (const p of prepared) {
    p.offset = localSize
    localSize += 30 + p.nameBytes.length + p.data.length
    centralSize += 46 + p.nameBytes.length
  }
  const totalSize = localSize + centralSize + 22
  const out = new Uint8Array(totalSize)
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)

  let pos = 0
  for (const p of prepared) {
    view.setUint32(pos, 0x04034b50, true) // Local file header signature
    view.setUint16(pos + 4, 20, true) // Version needed to extract (2.0)
    view.setUint16(pos + 6, 0x0800, true) // UTF-8 filename flag (bit 11)
    view.setUint16(pos + 8, 0, true) // Compression method: STORE
    view.setUint16(pos + 10, time, true)
    view.setUint16(pos + 12, date, true)
    view.setUint32(pos + 14, p.crc, true)
    view.setUint32(pos + 18, p.data.length, true)
    view.setUint32(pos + 22, p.data.length, true)
    view.setUint16(pos + 26, p.nameBytes.length, true)
    view.setUint16(pos + 28, 0, true) // Extra field length
    out.set(p.nameBytes, pos + 30)
    out.set(p.data, pos + 30 + p.nameBytes.length)
    pos += 30 + p.nameBytes.length + p.data.length
  }

  const centralStart = pos
  for (const p of prepared) {
    view.setUint32(pos, 0x02014b50, true) // Central directory signature
    view.setUint16(pos + 4, 20, true) // Version made by
    view.setUint16(pos + 6, 20, true) // Version needed
    view.setUint16(pos + 8, 0x0800, true) // UTF-8 flag
    view.setUint16(pos + 10, 0, true) // STORE
    view.setUint16(pos + 12, time, true)
    view.setUint16(pos + 14, date, true)
    view.setUint32(pos + 16, p.crc, true)
    view.setUint32(pos + 20, p.data.length, true)
    view.setUint32(pos + 24, p.data.length, true)
    view.setUint16(pos + 28, p.nameBytes.length, true)
    view.setUint16(pos + 30, 0, true) // Extra
    view.setUint16(pos + 32, 0, true) // Comment
    view.setUint16(pos + 34, 0, true) // Disk start
    view.setUint16(pos + 36, 0, true) // Internal attrs
    view.setUint32(pos + 38, 0, true) // External attrs
    view.setUint32(pos + 42, p.offset, true)
    out.set(p.nameBytes, pos + 46)
    pos += 46 + p.nameBytes.length
  }

  view.setUint32(pos, 0x06054b50, true) // End of central directory signature
  view.setUint16(pos + 4, 0, true) // Disk number
  view.setUint16(pos + 6, 0, true) // Disk with central dir
  view.setUint16(pos + 8, prepared.length, true)
  view.setUint16(pos + 10, prepared.length, true)
  view.setUint32(pos + 12, centralSize, true)
  view.setUint32(pos + 16, centralStart, true)
  view.setUint16(pos + 20, 0, true) // Comment length

  return out
}
