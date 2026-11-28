/**
 * CRC-32 (IEEE 802.3, the zip / gzip polynomial), fed one chunk at a time.
 *
 * Free of Node builtins for the same reason as the rest of this package: the
 * renderer bundles reach it.
 */

const TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** A running CRC-32: `update` each chunk in order, then read `value`. */
export class Crc32 {
  private crc = 0xffffffff

  update(bytes: Uint8Array): void {
    let crc = this.crc
    for (let i = 0; i < bytes.length; i++) crc = TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8)
    this.crc = crc
  }

  get value(): number {
    return (this.crc ^ 0xffffffff) >>> 0
  }
}
