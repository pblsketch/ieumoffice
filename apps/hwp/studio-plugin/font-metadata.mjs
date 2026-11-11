export const FONT_METADATA_MODULE = '@ieum/font-metadata'

/** Read collection names in place; enumerating fonts does not need glyph programs. */
export async function collectionFaceOffset(blob, postscriptName, parseNames, normalize) {
  const read = async (offset, length) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || length < 0 || offset > blob.size - length)
      return null
    return new DataView(await blob.slice(offset, offset + length).arrayBuffer())
  }
  const header = await read(0, 12)
  if (
    !header ||
    header.getUint32(0) !== 0x74746366 ||
    ![0x00010000, 0x00020000].includes(header.getUint32(4))
  )
    return null
  const count = header.getUint32(8)
  if (!count || count > 4096) return null
  const offsets = await read(12, count * 4)
  if (!offsets) return null
  const target = normalize(postscriptName)
  for (let face = 0; face < count; face++) {
    const start = offsets.getUint32(face * 4)
    const faceHeader = await read(start, 12)
    if (
      !faceHeader ||
      ![0x00010000, 0x4f54544f, 0x74727565, 0x74797031].includes(faceHeader.getUint32(0))
    )
      continue
    const tables = faceHeader.getUint16(4)
    if (!tables || tables > 4096) continue
    const directory = await read(start + 12, tables * 16)
    if (!directory) continue
    for (let index = 0; index < tables; index++) {
      if (directory.getUint32(index * 16) !== 0x6e616d65) continue
      const names = await read(
        directory.getUint32(index * 16 + 8),
        directory.getUint32(index * 16 + 12),
      )
      if (
        names &&
        parseNames(names.buffer).postscriptNames.some((name) => normalize(name) === target)
      )
        return start
    }
  }
  return null
}
