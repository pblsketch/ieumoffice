// Main-process / worker side: stamps pre-rendered PNG overlays (watermarks,
// headers and footers) onto PDF faces. Uses Rust WASM (`lopdf`) with an
// automatic JS (`pdf-lib`) fallback ONLY on infrastructure failures or
// `GENOFFICE_PRINT_LAYOUT_RUST=0|off`.
import { degrees, PDFDocument, type PDFImage } from 'pdf-lib'
import { wasmStampPdfOverlays } from './wasm'

/** Placement of one stamp PNG on a face (top-left coordinates in points). */
export interface PdfOverlayPlacement {
  /** 0-based index into `PdfOverlayBundle.stamps` */
  stampIndex: number
  /** defaults to 0 */
  x?: number | undefined
  /** defaults to 0 */
  y?: number | undefined
  /** defaults to the face's displayed width */
  width?: number | undefined
  /** defaults to the face's displayed height */
  height?: number | undefined
  /** 0..1 opacity multiplier, defaults to 1 */
  opacity?: number | undefined
}

/**
 * Deduplicated PNG stamps and per-face placements. `perFace[i]` applies to
 * 0-based face `i` of the arranged PDF.
 */
export interface PdfOverlayBundle {
  stamps: Uint8Array[]
  perFace: PdfOverlayPlacement[][]
}

function normalizeRotation(angle: number): number {
  const quarter = Math.round(angle / 90)
  return (((quarter % 4) + 4) % 4) * 90
}

async function applyPdfOverlaysJs(
  pdfBytes: Uint8Array,
  bundle: PdfOverlayBundle,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false })
  const pages = doc.getPages()
  const embedded = new Map<number, PDFImage>()

  for (let i = 0; i < pages.length; i++) {
    const placements = bundle.perFace[i]
    if (!placements || placements.length === 0) continue
    const page = pages[i]!
    const media = page.getMediaBox()
    const crop = page.getCropBox()
    const left = Math.max(media.x, crop.x)
    const bottom = Math.max(media.y, crop.y)
    const right = Math.min(media.x + media.width, crop.x + crop.width)
    const top = Math.min(media.y + media.height, crop.y + crop.height)
    const box =
      right > left && top > bottom
        ? { left, bottom, right, top }
        : {
            left: media.x,
            bottom: media.y,
            right: media.x + media.width,
            top: media.y + media.height,
          }
    const rotate = normalizeRotation(page.getRotation().angle)
    const bw = box.right - box.left
    const bh = box.top - box.bottom
    const faceW = rotate % 180 === 0 ? bw : bh
    const faceH = rotate % 180 === 0 ? bh : bw

    for (const p of placements) {
      const stampBytes = bundle.stamps[p.stampIndex]
      if (!stampBytes) {
        throw new Error(`overlay stamp index ${p.stampIndex} out of range`)
      }
      let img = embedded.get(p.stampIndex)
      if (!img) {
        img = await doc.embedPng(stampBytes)
        embedded.set(p.stampIndex, img)
      }
      const tx = p.x ?? 0
      const ty = p.y ?? 0
      const tw = p.width ?? faceW
      const th = p.height ?? faceH
      const dx = tx
      const dy = faceH - ty - th
      const opacity = Math.min(1, Math.max(0, p.opacity ?? 1))

      // pdf-lib drawImage rotates counter-clockwise around (x, y).
      let x = box.left + dx
      let y = box.bottom + dy
      if (rotate === 90) {
        x = box.right - dy
        y = box.bottom + dx
      } else if (rotate === 180) {
        x = box.right - dx
        y = box.top - dy
      } else if (rotate === 270) {
        x = box.left + dy
        y = box.top - dx
      }
      page.drawImage(img, {
        x,
        y,
        width: tw,
        height: th,
        opacity,
        rotate: degrees(rotate),
      })
    }
  }
  return doc.save()
}

/**
 * Stamps `bundle` overlays onto `pdfBytes`. Returns `pdfBytes` unchanged when
 * no face has any overlay placements.
 */
export async function applyPdfOverlays(
  pdfBytes: Uint8Array,
  bundle: PdfOverlayBundle | undefined,
  hintPdfiumWasmPath?: string | undefined,
): Promise<Uint8Array> {
  if (!bundle || bundle.stamps.length === 0 || bundle.perFace.every((list) => list.length === 0)) {
    return pdfBytes
  }
  const wasm = wasmStampPdfOverlays(pdfBytes, bundle.perFace, bundle.stamps, hintPdfiumWasmPath)
  if (wasm.ok) return wasm.value
  return applyPdfOverlaysJs(pdfBytes, bundle)
}
