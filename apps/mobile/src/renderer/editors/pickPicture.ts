/**
 * Picking a picture for an HWP document on the phone: the system picker, then
 * the bytes, size and stored format. HWP stores PNG, JPEG, GIF and BMP; other
 * formats a phone may hand over (WebP, HEIC turned into something else) are
 * redrawn as PNG.
 */
import type { FlowPicture } from './flowEditing'

const STORED_FORMATS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
}

/** Opens the system picture picker; null when nothing was picked. */
export function pickImageFile(doc: Document = document): Promise<File | null> {
  return new Promise((resolve) => {
    const input = doc.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}

/** Reads a picked file into a picture the engine can store. */
export async function readPicture(file: File): Promise<FlowPicture> {
  const bitmap = await createImageBitmap(file)
  try {
    const { width, height } = bitmap
    if (width <= 0 || height <= 0) throw new Error('empty picture')
    const stored = STORED_FORMATS[file.type]
    const bytes = stored ? new Uint8Array(await file.arrayBuffer()) : await redrawAsPng(bitmap)
    return {
      bytes,
      widthPx: width,
      heightPx: height,
      extension: stored ?? 'png',
      description: file.name,
    }
  } finally {
    bitmap.close()
  }
}

async function redrawAsPng(bitmap: ImageBitmap): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no canvas')
  context.drawImage(bitmap, 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('could not encode the picture')
  return new Uint8Array(await blob.arrayBuffer())
}
