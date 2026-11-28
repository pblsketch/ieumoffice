// The slice of fontkit 3 the sheet PDF uses (the package ships no types).
declare module 'fontkit/core' {
  export interface FontkitGlyph {
    readonly id: number
    readonly advanceWidth: number
    readonly codePoints: readonly number[]
  }
  export interface FontkitSubset {
    includeGlyph(glyph: FontkitGlyph | number): number
    encode(): Uint8Array
    encodeStream?: () => unknown
  }
  export interface FontkitFont {
    readonly postscriptName: string | null
    readonly unitsPerEm: number
    readonly ascent: number
    readonly descent: number
    readonly underlinePosition: number
    readonly underlineThickness: number
    readonly characterSet: readonly number[]
    readonly 'OS/2'?: { readonly yStrikeoutPosition?: number; readonly yStrikeoutSize?: number }
    hasGlyphForCodePoint(codePoint: number): boolean
    glyphForCodePoint(codePoint: number): FontkitGlyph
    layout(text: string, features?: unknown): { glyphs: FontkitGlyph[] }
    createSubset(): FontkitSubset
  }
  export function create(buffer: Uint8Array, postscriptName?: string): FontkitFont
  export function registerFormat(format: unknown): void
}

declare module 'fontkit/formats/TTFFont' {
  export const TTFFont: unknown
}

declare module 'fontkit/formats/WOFF2Font' {
  export const WOFF2Font: unknown
}

declare module '*.ttf?url' {
  const url: string
  export default url
}

declare module '*.woff2?url' {
  const url: string
  export default url
}
