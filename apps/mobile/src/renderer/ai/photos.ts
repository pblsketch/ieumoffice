/**
 * Photos attached in the AI sheet: picked with the system picture picker (no
 * OS permission prompt, no camera), shrunk to a JPEG whose long side is at
 * most PHOTO_LONG_SIDE_PX and held as base64 until the next message sends it
 * as the user turn's pictures (AgentMessage `images`).
 */
import { pickImageFile } from '../editors/pickPicture'

/** Long side of an attached photo after shrinking (tunable). */
export const PHOTO_LONG_SIDE_PX = 2048
/** JPEG quality of an attached photo (tunable). */
export const PHOTO_JPEG_QUALITY = 0.86

export interface PendingPhoto {
  readonly id: string
  readonly name: string
  readonly mime: 'image/jpeg'
  /** raw base64, no data: prefix (AgentImage) */
  readonly base64: string
  readonly bytes: Uint8Array
  readonly width: number
  readonly height: number
}

/** Why a picked file was not attached. */
export class PhotoUnreadableError extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'PhotoUnreadableError'
  }
}

let photoSeq = 0

/** The size a picture of `width` x `height` is drawn at (never larger than it was). */
export function shrunkSize(width: number, height: number): { width: number; height: number } {
  const longSide = Math.max(width, height)
  if (longSide <= PHOTO_LONG_SIDE_PX) return { width, height }
  const scale = PHOTO_LONG_SIDE_PX / longSide
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let at = 0; at < bytes.length; at += step) {
    binary += String.fromCharCode(...bytes.subarray(at, at + step))
  }
  return btoa(binary)
}

/** Reads a picked file into a shrunk JPEG; throws PhotoUnreadableError for anything else. */
export async function preparePhoto(file: File): Promise<PendingPhoto> {
  if (!file.type.startsWith('image/')) throw new PhotoUnreadableError('not a picture')
  if (typeof createImageBitmap !== 'function') {
    throw new PhotoUnreadableError('this web view cannot decode pictures')
  }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new PhotoUnreadableError('the picture could not be decoded')
  }
  try {
    if (!(bitmap.width > 0 && bitmap.height > 0)) throw new PhotoUnreadableError('empty picture')
    const size = shrunkSize(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) throw new PhotoUnreadableError('no canvas')
    context.drawImage(bitmap, 0, 0, size.width, size.height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', PHOTO_JPEG_QUALITY),
    )
    if (!blob) throw new PhotoUnreadableError('the picture could not be encoded')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    photoSeq += 1
    return {
      id: `pending-photo-${photoSeq}`,
      name: file.name || `photo-${photoSeq}.jpg`,
      mime: 'image/jpeg',
      base64: toBase64(bytes),
      bytes,
      width: size.width,
      height: size.height,
    }
  } finally {
    bitmap.close?.()
  }
}

/** Opens the system picture picker; null when nothing was picked. */
export function pickPhotoFile(): Promise<File | null> {
  return pickImageFile()
}
