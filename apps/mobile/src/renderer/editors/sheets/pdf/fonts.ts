/**
 * Fonts of the phone's sheet PDF. The desktop prints with the PC's own fonts
 * (Calibri, Arial, Malgun Gothic, …); a phone has none of them and a web view
 * cannot hand its system fonts' bytes to a PDF writer. So the print page lays
 * out with bundled open faces under the desktop's family names, metric-
 * compatible where one exists (Carlito for Calibri, Liberation Sans for Arial,
 * GenOffice Sans KR, normalized to Malgun Gothic's metrics, for Korean), and
 * the PDF embeds the same faces, subset to the glyphs it uses.
 */
import { create, registerFormat, type FontkitFont } from 'fontkit/core'
import { TTFFont } from 'fontkit/formats/TTFFont'
import { WOFF2Font } from 'fontkit/formats/WOFF2Font'

registerFormat(TTFFont)
registerFormat(WOFF2Font)

/** One bundled face and the desktop family names it stands in for. */
export interface FaceSpec {
  readonly id: string
  /** Desktop family names (case-insensitive) this face answers for. */
  readonly families: readonly string[]
  readonly bold: boolean
  readonly url: string
}

export interface LoadedFace {
  readonly spec: FaceSpec
  readonly bytes: Uint8Array
  readonly font: FontkitFont
  /** Family name the print page's @font-face rules give this face alone (baseline probes). */
  readonly probeFamily: string
}

const CALIBRI = ['calibri', 'carlito']
const ARIAL = ['arial', 'helvetica', 'liberation sans']
/**
 * The desktop's CJK stacks (print-html.ts `printCjkFonts`) and common Korean
 * sheet fonts. The bundled subset covers the 2,350 KS X 1001 syllables and
 * ASCII; other Hangul syllables, Hanja and kana print as missing glyphs.
 */
const KOREAN = [
  'malgun gothic',
  '맑은 고딕',
  'apple sd gothic neo',
  'hiragino sans',
  'hiragino kaku gothic pron',
  'yu gothic ui',
  'yu gothic',
  'meiryo',
  'pingfang sc',
  'pingfang tc',
  'microsoft jhenghei',
  'gulim',
  '굴림',
  'dotum',
  '돋움',
  'batang',
  '바탕',
  'genoffice sans kr',
]

export function bundledFaceSpecs(urls: {
  readonly calibri: string
  readonly calibriBold: string
  readonly arial: string
  readonly arialBold: string
  readonly korean: string
}): readonly FaceSpec[] {
  return [
    { id: 'calibri', families: CALIBRI, bold: false, url: urls.calibri },
    { id: 'calibri-bold', families: CALIBRI, bold: true, url: urls.calibriBold },
    { id: 'arial', families: ARIAL, bold: false, url: urls.arial },
    { id: 'arial-bold', families: ARIAL, bold: true, url: urls.arialBold },
    { id: 'korean', families: KOREAN, bold: false, url: urls.korean },
  ]
}

/** The bundled faces' asset URLs (each file loads only when a PDF is made). */
export async function defaultFaceSpecs(): Promise<readonly FaceSpec[]> {
  const [calibri, calibriBold, arial, arialBold, korean] = await Promise.all([
    import('../../../../../../../packages/ui/src/fonts/Carlito-Regular.ttf?url'),
    import('../../../../../../../packages/ui/src/fonts/Carlito-Bold.ttf?url'),
    import('../../../../../../docs/src/renderer/fonts/LiberationSans-Regular.ttf?url'),
    import('../../../../../../docs/src/renderer/fonts/LiberationSans-Bold.ttf?url'),
    import('../../../assets/fonts/GenOfficeSansKR-Regular-subset.woff2?url'),
  ])
  return bundledFaceSpecs({
    calibri: calibri.default,
    calibriBold: calibriBold.default,
    arial: arial.default,
    arialBold: arialBold.default,
    korean: korean.default,
  })
}

export function loadFace(spec: FaceSpec, bytes: Uint8Array): LoadedFace {
  return { spec, bytes, font: create(bytes), probeFamily: `ieum-pdf-${spec.id}` }
}

export interface FaceChoice {
  readonly face: LoadedFace
  /** The face is regular and the text asks for bold: the PDF thickens it, as the browser does. */
  readonly syntheticBold: boolean
}

/**
 * Resolves the face for one character the way the browser falls back through
 * a font-family list: the first listed family that has a bundled face holding
 * the glyph. Unlisted characters fall to the Korean face, then Calibri's;
 * `null` when no bundled face has the glyph (the caller counts it and prints
 * the Korean face's missing-glyph box).
 */
export class FaceResolver {
  private readonly byFamily = new Map<string, LoadedFace[]>()
  private readonly fallbacks: LoadedFace[]
  private readonly cache = new Map<string, FaceChoice | null>()

  constructor(private readonly faces: readonly LoadedFace[]) {
    for (const face of faces) {
      for (const family of face.spec.families) {
        const list = this.byFamily.get(family) ?? []
        list.push(face)
        this.byFamily.set(family, list)
      }
    }
    this.fallbacks = ['korean', 'calibri']
      .map((id) => faces.find((face) => face.spec.id === id))
      .filter((face): face is LoadedFace => face !== undefined)
  }

  /** The face used for missing glyphs. */
  get missingFace(): LoadedFace {
    const face = this.fallbacks[0] ?? this.faces[0]
    if (!face) throw new Error('No PDF font loaded.')
    return face
  }

  /**
   * The element's primary font: the first listed family with a bundled face,
   * glyphs aside. Browsers size every text box of the element by its metrics
   * (fallback glyphs included), so baselines are measured with it.
   */
  primary(families: readonly string[], bold: boolean): LoadedFace {
    for (const family of families) {
      const candidates = this.byFamily.get(family.toLowerCase())
      if (!candidates) continue
      const face = candidates.find((candidate) => candidate.spec.bold === bold) ?? candidates[0]
      if (face) return face
    }
    return this.missingFace
  }

  choose(families: readonly string[], bold: boolean, codePoint: number): FaceChoice | null {
    const key = `${families.join(',')}|${bold ? 1 : 0}|${codePoint}`
    const cached = this.cache.get(key)
    if (cached !== undefined) return cached
    let choice: FaceChoice | null = null
    for (const family of families) {
      const candidates = this.byFamily.get(family.toLowerCase())
      if (!candidates) continue
      const face =
        candidates.find((candidate) => candidate.spec.bold === bold) ?? candidates[0] ?? null
      if (face && face.font.hasGlyphForCodePoint(codePoint)) {
        choice = { face, syntheticBold: bold && !face.spec.bold }
        break
      }
    }
    if (!choice) {
      for (const face of this.fallbacks) {
        if (face.font.hasGlyphForCodePoint(codePoint)) {
          choice = { face, syntheticBold: bold && !face.spec.bold }
          break
        }
      }
    }
    this.cache.set(key, choice)
    return choice
  }
}

/** A CSS `font-family` value as a list of names (quotes dropped, generics kept). */
export function parseFontFamilyList(value: string): string[] {
  const names: string[] = []
  for (const part of value.split(',')) {
    const name = part.trim().replace(/^['"]|['"]$/g, '')
    if (name) names.push(name)
  }
  return names
}

/** The print page's @font-face rules: every desktop family name over its bundled face. */
export function fontFaceCss(
  faces: readonly LoadedFace[],
  urlOf: (face: LoadedFace) => string,
): string {
  const rules: string[] = []
  for (const face of faces) {
    const weight = face.spec.bold ? 700 : 400
    const src = `url("${urlOf(face)}")`
    rules.push(
      `@font-face{font-family:"${face.probeFamily}";src:${src};font-weight:${weight};font-style:normal}`,
    )
    for (const family of face.spec.families) {
      rules.push(
        `@font-face{font-family:"${family}";src:${src};font-weight:${weight};font-style:normal}`,
      )
    }
  }
  return rules.join('\n')
}

/**
 * fontkit 3 for pdf-lib, whose subset embedder still calls fontkit 1's
 * `subset.encodeStream()` (data, end, error events); fontkit 3 encodes in one
 * call, so the adapter replays that as one data event.
 */
export const pdfLibFontkit = {
  create(bytes: Uint8Array): FontkitFont {
    const font = create(bytes)
    const createSubset = font.createSubset.bind(font)
    Object.defineProperty(font, 'createSubset', {
      configurable: true,
      value: () => {
        const subset = createSubset()
        subset.encodeStream = () => singleChunkStream(() => subset.encode())
        return subset
      },
    })
    return font
  },
}

type StreamEvent = 'data' | 'end' | 'error'

function singleChunkStream(produce: () => Uint8Array) {
  const handlers: Record<StreamEvent, ((value?: unknown) => void)[]> = {
    data: [],
    end: [],
    error: [],
  }
  queueMicrotask(() => {
    try {
      const bytes = produce()
      for (const handler of handlers.data) handler(bytes)
      for (const handler of handlers.end) handler()
    } catch (error: unknown) {
      for (const handler of handlers.error) handler(error)
    }
  })
  const stream = {
    on(event: StreamEvent, handler: (value?: unknown) => void) {
      handlers[event].push(handler)
      return stream
    },
  }
  return stream
}
