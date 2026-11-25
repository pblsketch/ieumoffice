// A signature from a picture (spec 3.6): the system picture picker (a hidden file
// input, no permission prompt), then the PC SignatureDialog steps — decode and
// downscale to at most 1600 px, optional black & white — into a PNG stamp.
import type { ImageSignature } from './place'

/** PC SignatureDialog `MAX_IMG`: picked pictures are downscaled to this side. */
export const MAX_PICTURE_SIDE = 1600

/** PC `fileToCanvas`: decode and downscale a picture onto a canvas (null if it can't be decoded). */
export async function fileToCanvas(
  file: Blob,
  maxSide: number = MAX_PICTURE_SIDE,
): Promise<HTMLCanvasElement | null> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('decode'))
      img.src = url
    })
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight, 1))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * k))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * k))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * PC `toBlackAndWhite`: dark pixels → solid black, light pixels → transparent, with a
 * soft ramp in between. Turns a photographed signature into a clean stamp.
 */
export function toBlackAndWhite(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = src.width
  out.height = src.height
  const ctx = out.getContext('2d', { willReadFrequently: true })
  const srcCtx = src.getContext('2d', { willReadFrequently: true })
  if (!ctx || !srcCtx) return src
  const img = srcCtx.getImageData(0, 0, src.width, src.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!
    const a = lum > 200 ? 0 : lum < 120 ? 255 : Math.round(((200 - lum) / 80) * 255)
    d[i] = 0
    d[i + 1] = 0
    d[i + 2] = 0
    d[i + 3] = Math.round((a * d[i + 3]!) / 255)
  }
  ctx.putImageData(img, 0, 0)
  return out
}

/** A canvas → the image signature the PC stores (base64 PNG without the prefix). */
export function canvasToSignature(canvas: HTMLCanvasElement): ImageSignature | null {
  const base64 = canvas.toDataURL('image/png').split(',')[1]
  return base64
    ? { kind: 'image', image: base64, width: canvas.width, height: canvas.height }
    : null
}
