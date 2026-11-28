/**
 * The picture work the tools need from the web view: telling whether a photo
 * of a kind other than JPEG or PNG can be decoded, turning such a photo into
 * a JPEG for "images to PDF", and the "make smaller" recoder (decode, shrink,
 * JPEG). The worker does it on an OffscreenCanvas; a worker without a 2d
 * OffscreenCanvas (iOS 15 to 16.3) sends each picture to the screen thread,
 * which does the same here on a <canvas>.
 *
 * This module imports no pdf-lib code (types only), so the screen side stays
 * light.
 */
import type { ImageRecoder, RecodedImage, SourceImage } from '@genoffice/pdf-ops'
import { isOutOfMemory, type PictureCall, type PictureResult } from './protocol'

/** JPEG quality for a photo of another kind put into "images to PDF" (spec 5.4) */
export const PHOTO_JPEG_QUALITY = 0.92

/**
 * What the core asks of the picture code. `decodable` and `toJpeg` may take
 * the bytes they are given (their buffer may be detached when they return);
 * `recode` must not (its source is a view into the PDF being made smaller).
 */
export interface PictureOps {
  /** whether this web view can decode `bytes` as a picture */
  decodable(bytes: Uint8Array, mime: string): Promise<boolean>
  /** `bytes` decoded and stored again as a JPEG at PHOTO_JPEG_QUALITY; null when it cannot */
  toJpeg(bytes: Uint8Array, mime: string): Promise<Uint8Array | null>
  /** the "make smaller" recoder */
  recode: ImageRecoder
}

type Context2d = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** A 2d drawing surface of a given size */
export interface Surface {
  readonly context: Context2d
  /** the drawing as JPEG bytes at `quality` (0 to 1); null when the encoder gave something else */
  toJpeg(quality: number): Promise<Uint8Array | null>
  /** give the pixel memory back (Safari keeps a canvas's memory until its size is 0) */
  release(): void
}

export type MakeSurface = (width: number, height: number) => Surface | null

/** What decoding needs: createImageBitmap (the worker's or the window's) */
export type DecodeBitmap = (source: Blob | ImageData) => Promise<ImageBitmap>

const isJpeg = (bytes: Uint8Array) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8

async function blobToJpeg(blob: Blob | null): Promise<Uint8Array | null> {
  if (!blob || blob.type !== 'image/jpeg') return null
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return isJpeg(bytes) ? bytes : null
}

/** A surface on an OffscreenCanvas, or null when this scope has no 2d OffscreenCanvas */
export function offscreenSurface(width: number, height: number): Surface | null {
  if (typeof OffscreenCanvas !== 'function') return null
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context || typeof canvas.convertToBlob !== 'function') return null
  return {
    context,
    toJpeg: async (quality) =>
      blobToJpeg(await canvas.convertToBlob({ type: 'image/jpeg', quality })),
    release() {
      canvas.width = 0
      canvas.height = 0
    },
  }
}

/** Whether this scope can draw and encode on a 2d OffscreenCanvas */
export function hasOffscreen2d(): boolean {
  try {
    const probe = offscreenSurface(1, 1)
    probe?.release()
    return probe !== null
  } catch {
    return false
  }
}

/** A surface on a <canvas> element (the screen thread) */
export function elementSurface(width: number, height: number): Surface | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null
  return {
    context,
    toJpeg: (quality) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality)).then(
        blobToJpeg,
      ),
    release() {
      canvas.width = 0
      canvas.height = 0
    },
  }
}

/** 8-bit grey or RGB samples as the RGBA pixels ImageData holds */
export function samplesToRgba(
  samples: Uint8Array,
  components: 1 | 3,
  pixels: number,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(pixels * 4)
  for (let i = 0; i < pixels; i++) {
    const r = samples[i * components]!
    out[i * 4] = r
    out[i * 4 + 1] = components === 3 ? samples[i * 3 + 1]! : r
    out[i * 4 + 2] = components === 3 ? samples[i * 3 + 2]! : r
    out[i * 4 + 3] = 255
  }
  return out
}

const blobOf = (bytes: Uint8Array, mime: string) =>
  new Blob([bytes as Uint8Array<ArrayBuffer>], mime ? { type: mime } : {})

/** Picture work on the given surfaces and decoder */
export function canvasPictures(
  makeSurface: MakeSurface,
  decode: DecodeBitmap = (source) => createImageBitmap(source),
): PictureOps {
  const tryDecode = async (source: Blob | ImageData): Promise<ImageBitmap | null> => {
    try {
      return await decode(source)
    } catch {
      return null
    }
  }

  const tryDecodeSamples = async (
    source: Extract<SourceImage, { kind: 'raw' }>,
  ): Promise<ImageBitmap | null> => {
    let pixels: ImageData
    try {
      pixels = new ImageData(
        samplesToRgba(source.samples, source.components, source.width * source.height),
        source.width,
        source.height,
      )
    } catch (err) {
      // out of memory is the caller's to report; anything else leaves the picture as it is
      if (err instanceof RangeError) throw err
      return null
    }
    return tryDecode(pixels)
  }

  /** `bitmap` drawn at `width` x `height` (on white: JPEG has no transparency) as a JPEG */
  const drawJpeg = async (
    bitmap: ImageBitmap,
    width: number,
    height: number,
    quality: number,
  ): Promise<Uint8Array | null> => {
    const surface = makeSurface(width, height)
    if (!surface) return null
    try {
      const { context } = surface
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, width, height)
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(bitmap, 0, 0, width, height)
      return await surface.toJpeg(quality)
    } finally {
      surface.release()
    }
  }

  return {
    async decodable(bytes, mime) {
      const bitmap = await tryDecode(blobOf(bytes, mime))
      if (!bitmap) return false
      const ok = bitmap.width > 0 && bitmap.height > 0
      bitmap.close()
      return ok
    },

    async toJpeg(bytes, mime) {
      // the decoder applies the photo's own orientation; the JPEG is written upright
      const bitmap = await tryDecode(blobOf(bytes, mime))
      if (!bitmap) return null
      try {
        if (bitmap.width < 1 || bitmap.height < 1) return null
        return await drawJpeg(bitmap, bitmap.width, bitmap.height, PHOTO_JPEG_QUALITY)
      } finally {
        bitmap.close()
      }
    },

    async recode(source: SourceImage, target): Promise<RecodedImage | null> {
      const bitmap =
        source.kind === 'jpeg'
          ? await tryDecode(blobOf(source.bytes, 'image/jpeg'))
          : await tryDecodeSamples(source)
      if (!bitmap) return null
      try {
        // a decoder that turned or misread the picture: keep the original (the PC's rule)
        if (bitmap.width !== source.width || bitmap.height !== source.height) return null
        const scale = Math.min(1, target.longSide / Math.max(source.width, source.height))
        const width = Math.max(1, Math.round(source.width * scale))
        const height = Math.max(1, Math.round(source.height * scale))
        const jpeg = await drawJpeg(bitmap, width, height, target.quality / 100)
        return jpeg ? { jpeg, width, height } : null
      } finally {
        bitmap.close()
      }
    },
  }
}

/** The screen thread's answer to a picture call, made with `pictures` (a <canvas>) */
export async function answerPicture(
  pictures: PictureOps,
  request: PictureCall,
): Promise<{ result: PictureResult; transfer: ArrayBuffer[] }> {
  try {
    switch (request.op) {
      case 'decodable':
        return {
          result: { ok: true, value: await pictures.decodable(request.bytes, request.mime) },
          transfer: [],
        }
      case 'toJpeg': {
        const jpeg = await pictures.toJpeg(request.bytes, request.mime)
        return {
          result: { ok: true, value: jpeg },
          transfer: jpeg ? [jpeg.buffer as ArrayBuffer] : [],
        }
      }
      case 'recode': {
        const made = await pictures.recode(request.source, request.target)
        return {
          result: { ok: true, value: made },
          transfer: made ? [made.jpeg.buffer as ArrayBuffer] : [],
        }
      }
    }
  } catch (err) {
    return { result: { ok: false, outOfMemory: isOutOfMemory(err) }, transfer: [] }
  }
}
