// Turning a signature into the drawing that lands on the page (spec 3.6, 3.8): an
// image stamp (PC `DrawingInput` kind 'image', base64 PNG without the data: prefix).
// Pad strokes are rasterized in the chosen color the way the PC turns a typed
// signature into a stamp (canvas → PNG), so what the pad shows is what lands.
import type { DrawingInput } from '../../../../../../../pdf/src/shared/ipc'
import {
  geomDispSize,
  viewToPdf,
  type PageGeom,
} from '../../../../../../../pdf/src/renderer/annotations'
import { cssRgb } from '../../../../../../../pdf/src/renderer/DrawLayer'
import type { PdfSignatureTarget } from '../../edit/types'
import type { SignatureData } from './store'

// PC `signPlaceK` (SignDropOverlay.tsx) and `signatureDrawingForField` (signature-field.ts)
// are restated below rather than imported: their modules type-import SignatureDialog.tsx,
// which needs the PC preload's `window.pdfApi` and does not typecheck in the mobile app.

export type Rgb = [number, number, number]
export type ImageSignature = Extract<SignatureData, { kind: 'image' }>
export type StrokeSignature = Extract<SignatureData, { kind: 'strokes' }>

/** The PC pad size: drawn strokes are stored in these coordinates (PC SignatureDialog). */
export const PAD_W = 420
export const PAD_H = 150
/** Pad stroke width in pad coordinates (PC SignatureDialog). */
export const PAD_STROKE = 2.4
/** Rasterizing scale of pad strokes, so the stamp stays crisp when printed. */
const RASTER_SCALE = 3

/** Pad strokes → a transparent PNG stamp in `color`; null when the web view cannot draw. */
export function rasterizeStrokes(
  sig: StrokeSignature,
  color: Rgb,
  doc: Document = document,
): ImageSignature | null {
  const canvas = doc.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sig.width * RASTER_SCALE))
  canvas.height = Math.max(1, Math.round(sig.height * RASTER_SCALE))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(canvas.width / sig.width, canvas.height / sig.height)
  ctx.strokeStyle = cssRgb(color)
  ctx.lineWidth = PAD_STROKE
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const path of sig.paths) {
    ctx.beginPath()
    let started = false
    // walk whole pairs only: a trailing odd or non-finite value is skipped
    for (let i = 0; i + 1 < path.length; i += 2) {
      const x = path[i]!
      const y = path[i + 1]!
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      if (started) ctx.lineTo(x, y)
      else ctx.moveTo(x, y)
      started = true
    }
    ctx.stroke()
  }
  const base64 = canvas.toDataURL('image/png').split(',')[1]
  return base64
    ? { kind: 'image', image: base64, width: canvas.width, height: canvas.height }
    : null
}

/** Any signature as an image stamp (strokes are drawn in `color`). */
export function signatureAsImage(
  sig: SignatureData,
  color: Rgb,
  doc: Document = document,
): ImageSignature | null {
  return sig.kind === 'image' ? sig : rasterizeStrokes(sig, color, doc)
}

/**
 * PC App `placeSignature` (image branch): centered on the tapped point (view coords,
 * scale 1), sized by `signPlaceK`, kept on the page; corners map view → PDF one by one
 * so the stamp stays upright on rotated pages.
 */
export function placedSignatureDrawing(
  sig: ImageSignature,
  pageIndex: number,
  geom: PageGeom,
  vx: number,
  vy: number,
): DrawingInput {
  const disp = geomDispSize(geom)
  const k = signPlaceK(sig, disp.width, disp.height)
  const targetW = sig.width * k
  const targetH = sig.height * k
  const left = Math.min(Math.max(vx - targetW / 2, 0), Math.max(disp.width - targetW, 0))
  const top = Math.min(Math.max(vy - targetH / 2, 0), Math.max(disp.height - targetH, 0))
  const [ax, ay] = viewToPdf(geom, left, top)
  const [bx, by] = viewToPdf(geom, left + targetW, top + targetH)
  return {
    kind: 'image',
    pageIndex,
    image: sig.image,
    rect: [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)],
  }
}

/** PC `signPlaceK`: a third of the page width, at most a sixth of its height. */
export function signPlaceK(sig: ImageSignature, dispW: number, dispH: number): number {
  return Math.min(dispW / 3 / sig.width, dispH / 6 / sig.height)
}

/**
 * PC `signatureDrawingForField` (image branch): fitted into the signature field with
 * the PC inset, centered, and named after the field. Strokes reach it as a stamp.
 */
export function fieldSignatureDrawing(
  sig: ImageSignature,
  target: PdfSignatureTarget,
): DrawingInput {
  const [x1, y1, x2, y2] = target.rect
  const fieldW = Math.abs(x2 - x1)
  const fieldH = Math.abs(y2 - y1)
  const inset = Math.min(fieldW, fieldH) * 0.08
  const availW = Math.max(1, fieldW - inset * 2)
  const availH = Math.max(1, fieldH - inset * 2)
  const k = Math.min(availW / Math.max(sig.width, 1), availH / Math.max(sig.height, 1))
  const width = sig.width * k
  const height = sig.height * k
  const left = Math.min(x1, x2) + (fieldW - width) / 2
  const bottom = Math.min(y1, y2) + (fieldH - height) / 2
  return {
    kind: 'image',
    pageIndex: target.pageIndex,
    image: sig.image,
    rect: [left, bottom, left + width, bottom + height],
    formFieldName: target.fieldName,
  }
}

/** A view-space box (page CSS px at scale 1) → a PDF rectangle. */
export function viewBoxToPdfRect(
  geom: PageGeom,
  box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
): [number, number, number, number] {
  const [ax, ay] = viewToPdf(geom, box.x, box.y)
  const [bx, by] = viewToPdf(geom, box.x + box.w, box.y + box.h)
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]
}

/** A view-space shift (scale 1) → the PDF-space delta of PC `moveDrawing`. */
export function viewShiftToPdf(
  geom: PageGeom,
  from: readonly [number, number],
  to: readonly [number, number],
): [number, number] {
  const [ax, ay] = viewToPdf(geom, from[0], from[1])
  const [bx, by] = viewToPdf(geom, to[0], to[1])
  return [bx - ax, by - ay]
}
