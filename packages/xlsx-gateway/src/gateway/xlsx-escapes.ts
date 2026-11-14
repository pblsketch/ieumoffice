/// ECMA-376 Part 1 §22.4.2.4: characters illegal in XML (and CR, which XML
/// parsers would fold into LF) are stored in cell text as `_xHHHH_`; a
/// literal `_x` that would read as an escape is itself written `_x005F_x…`.
/// Formula text never carries these escapes.

export function decodeXlsxEscapes(text: string): string {
  if (!text.includes('_x')) return text
  return text.replace(/_x([0-9A-Fa-f]{4})_/g, (match, hex: string) => {
    const code = Number.parseInt(hex, 16)
    return code >= 0xd800 && code <= 0xdfff ? match : String.fromCharCode(code)
  })
}

// eslint-disable-next-line no-control-regex -- illegal XML chars (and CR) are the subject
const ILLEGAL_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF\r]/g

// Lone surrogates matched with lookaround — a raw D800–DFFF class would split valid emoji.
// Dropped rather than escaped: decodeXlsxEscapes refuses to rehydrate a
// _xD8xx_-shaped escape (it could collide with a legitimate literal _x
// marker for a BMP character someone typed), so writing a lone surrogate
// as _xD840_ would come back as that literal seven-character string
// instead of being restored or removed — worse than just dropping it here.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

export function encodeXlsxEscapes(text: string): string {
  return text
    .replace(/_(?=x[0-9A-Fa-f]{4}_)/g, '_x005F_')
    .replace(
      ILLEGAL_XML_CHARS,
      (character) => `_x${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`,
    )
    .replace(LONE_SURROGATE, '')
}

const XML_NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  amp: '&',
}

/// Single-pass decode of the XML named entities plus numeric character
/// references (&#dd; / &#xhh;), which some producers use for non-ASCII text.
export function decodeXmlText(input: string): string {
  return input.replace(
    /&(?:#x([0-9A-Fa-f]+)|#([0-9]+)|(quot|apos|lt|gt|amp));/g,
    (match, hex: string | undefined, dec: string | undefined, named: string | undefined) => {
      if (named !== undefined) return XML_NAMED_ENTITIES[named] ?? match
      const code = hex !== undefined ? Number.parseInt(hex, 16) : Number(dec)
      return code <= 0x10ffff ? String.fromCodePoint(code) : match
    },
  )
}
