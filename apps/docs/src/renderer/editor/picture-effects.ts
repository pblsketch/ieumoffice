import type { ImageEffects } from '@genoffice/docx-engine'

/**
 * CSS filter pair for the affine map y = slope * (x + offset - 0.5) + 0.5.
 * contrast() pivots at 0.5 and brightness() at 0, so the two compose to any
 * such line; the order is chosen so the intermediate value never clips.
 */
function affineFilterCss(slope: number, offset: number): string[] {
  if (offset >= 0) {
    const m = 1 + 2 * slope * offset
    return [`contrast(${(slope / m).toFixed(4)})`, `brightness(${m.toFixed(4)})`]
  }
  const k = slope * (1 - 2 * offset)
  return [`brightness(${(1 / (1 - 2 * offset)).toFixed(4)})`, `contrast(${k.toFixed(4)})`]
}

/** a:lum / a:grayscl / a:biLevel → CSS filter value chain ('' when none) */
export function pictureFilterValue(fx: ImageEffects | null | undefined): string {
  if (!fx) return ''
  const fns: string[] = []
  if (fx.grayscale || fx.biLevelThresh !== undefined) fns.push('grayscale(1)')
  if (fx.bright || fx.contrast) {
    // Word: contrast scales about mid-grey by (1 + c), brightness then adds b
    // (measured against Word's rendering of bright/contrast +40%)
    const slope = Math.max(0.01, 1 + Math.max(-1, Math.min(1, fx.contrast ?? 0)))
    const bright = Math.max(-1, Math.min(1, fx.bright ?? 0))
    fns.push(...affineFilterCss(slope, bright / slope))
  }
  if (fx.biLevelThresh !== undefined) {
    fns.push(...affineFilterCss(1000, 0.5 - Math.max(0, Math.min(1, fx.biLevelThresh))))
  }
  return fns.join(' ')
}

/** a:lum / a:grayscl / a:biLevel / a:alphaModFix → inline CSS declarations ('' when none) */
export function pictureFilterCss(fx: ImageEffects | null | undefined): string {
  if (!fx) return ''
  const decls: string[] = []
  const filter = pictureFilterValue(fx)
  if (filter) decls.push(`filter:${filter}`)
  if (fx.alpha !== undefined && fx.alpha >= 0 && fx.alpha < 1) {
    decls.push(`opacity:${Math.round(fx.alpha * 1000) / 1000}`)
  }
  return decls.join(';')
}
