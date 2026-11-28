/**
 * Chromium nativeImage helpers for PDF tools (apps/pdf/src/main/compress.ts,
 * images-to-pdf.ts, and pdf-to-images.ts): decode, resize, grayscale, thumbnail
 * generation, and PNG/JPEG encoding in the main process where nativeImage lives.
 * One picture at a time with a turn of the event loop before each.
 */
import { nativeImage } from 'electron'
import {
  bgraToGrayscaleInPlace,
  samplesToBgra,
  type ImageRecoder,
} from '../../../../pdf/src/main/compress'
import { isSupportedWebImageBytes } from '../../../../pdf/src/main/images-to-pdf'

export type ImageOptimizeMode = 'original' | 'balanced' | 'compact'

const OPTIMIZE_TARGETS: Record<
  Exclude<ImageOptimizeMode, 'original'>,
  { longSide: number; quality: number }
> = {
  balanced: { longSide: 2400, quality: 85 },
  compact: { longSide: 1600, quality: 75 },
}

/** Default JPEG quality when normalizing non-transparent WebP/BMP/GIF without compression (tunable) */
const NORMALIZE_JPEG_QUALITY = 92

export const recodeWithChromium: ImageRecoder = async (source, target) => {
  await new Promise((resolve) => setImmediate(resolve))
  const image =
    source.kind === 'jpeg'
      ? nativeImage.createFromBuffer(Buffer.from(source.bytes))
      : nativeImage.createFromBitmap(
          Buffer.from(
            samplesToBgra(
              source.samples,
              source.components,
              source.width * source.height,
              target.grayscale === true,
            ),
          ),
          { width: source.width, height: source.height },
        )
  if (image.isEmpty()) return null
  const size = image.getSize()
  // a decoder that turned or misread the picture: keep the original
  if (size.width !== source.width || size.height !== source.height) return null
  const scale = Math.min(1, target.longSide / Math.max(size.width, size.height))
  const fitted =
    scale < 1
      ? image.resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
          quality: 'good',
        })
      : image
  const out = fitted.getSize()
  if (target.grayscale === true && source.kind === 'jpeg') {
    const bgra = new Uint8Array(fitted.toBitmap())
    bgraToGrayscaleInPlace(bgra)
    const grayImg = nativeImage.createFromBitmap(Buffer.from(bgra), {
      width: out.width,
      height: out.height,
    })
    return {
      jpeg: new Uint8Array(grayImg.toJPEG(target.quality)),
      width: out.width,
      height: out.height,
    }
  }
  return {
    jpeg: new Uint8Array(fitted.toJPEG(target.quality)),
    width: out.width,
    height: out.height,
  }
}

function hasAlphaChannel(bgra: Uint8Array): boolean {
  for (let i = 3; i < bgra.length; i += 4) {
    if (bgra[i]! < 255) return true
  }
  return false
}

/**
 * Normalize an image file (JPG, PNG, WebP, BMP, GIF) to JPEG or PNG bytes for
 * imagesToPdfBytes. Preserves original JPG/PNG bytes untouched in 'original'
 * mode so photos keep their exact bytes and EXIF orientation.
 */
export function normalizeImageForPdf(
  bytes: Uint8Array,
  optimize: ImageOptimizeMode = 'original',
): Uint8Array | null {
  const kind = isSupportedWebImageBytes(bytes)
  if (!kind) return null
  if ((kind === 'jpg' || kind === 'png') && optimize === 'original') return bytes
  const img = nativeImage.createFromBuffer(Buffer.from(bytes))
  if (img.isEmpty()) return null
  const size = img.getSize()
  if (size.width < 1 || size.height < 1) return null

  let working = img
  let quality = NORMALIZE_JPEG_QUALITY
  if (optimize !== 'original') {
    const cfg = OPTIMIZE_TARGETS[optimize]
    quality = cfg.quality
    const scale = Math.min(1, cfg.longSide / Math.max(size.width, size.height))
    if (scale < 1) {
      working = img.resize({
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
        quality: 'good',
      })
    }
  }
  const bgra = new Uint8Array(working.toBitmap())
  if (hasAlphaChannel(bgra)) {
    return new Uint8Array(working.toPNG())
  }
  return new Uint8Array(working.toJPEG(quality))
}

/** Generate a small PNG data URL thumbnail for an image file */
export function imageThumbDataUrl(bytes: Uint8Array, longSide = 120): string | null {
  const img = nativeImage.createFromBuffer(Buffer.from(bytes))
  if (img.isEmpty()) return null
  const size = img.getSize()
  if (size.width < 1 || size.height < 1) return null
  const scale = Math.min(1, longSide / Math.max(size.width, size.height))
  const resized =
    scale < 1
      ? img.resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
          quality: 'good',
        })
      : img
  return resized.toDataURL()
}

/** Encode a tightly-packed BGRA bitmap (from PDFium) to PNG or JPEG bytes */
export function encodeBgraPage(
  bgra: Uint8Array,
  width: number,
  height: number,
  format: 'png' | 'jpg',
  quality: number,
): Uint8Array {
  const img = nativeImage.createFromBitmap(
    Buffer.from(bgra.buffer, bgra.byteOffset, bgra.byteLength),
    { width, height },
  )
  return format === 'png' ? new Uint8Array(img.toPNG()) : new Uint8Array(img.toJPEG(quality))
}
