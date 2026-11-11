/** Recognize a complete /XFA name token, including across streaming windows. */
export function hasXfaMarker(bytes: Uint8Array, final = true): boolean {
  const marker = [0x2f, 0x58, 0x46, 0x41]
  const endsToken = (b: number): boolean =>
    b === 0 ||
    b === 9 ||
    b === 10 ||
    b === 12 ||
    b === 13 ||
    b === 32 ||
    b === 40 ||
    b === 41 ||
    b === 60 ||
    b === 62 ||
    b === 91 ||
    b === 93 ||
    b === 123 ||
    b === 125 ||
    b === 47 ||
    b === 37
  outer: for (
    let index = bytes.indexOf(marker[0]!);
    index >= 0 && index <= bytes.length - marker.length;
    index = bytes.indexOf(marker[0]!, index + 1)
  ) {
    for (let offset = 0; offset < marker.length; offset++) {
      if (bytes[index + offset] !== marker[offset]) continue outer
    }
    const after = index + marker.length
    if (after === bytes.length ? final : endsToken(bytes[after]!)) return true
  }
  return false
}
