// Renderer-side Canvas stamp builder for print overlays (watermarks, headers
// and footers). Renders crisp transparent RGBA PNGs using the OS's full font
// stack across all 22 UI languages so the Rust/JS PDF backend never needs to
// bundle multi-megabyte CJK/RTL TrueType fonts.
import {
  hasActiveHeaderFooter,
  hasActiveWatermark,
  type HeaderFooterOptions,
  type HeaderFooterSlot,
  type PageSize,
  type PrintLayoutOptions,
  type WatermarkOptions,
} from '@genoffice/print-layout/plan'

export interface OverlayPlacement {
  stampIndex: number
  x?: number | undefined
  y?: number | undefined
  width?: number | undefined
  height?: number | undefined
  opacity?: number | undefined
}

export interface OverlayBundle {
  stamps: Uint8Array[]
  perFace: OverlayPlacement[][]
}

const MAX_WATERMARK_LONG_SIDE_PX = 1600
const HF_BAND_HEIGHT_PT = 26
const HF_MARGIN_X_PT = 24
const HF_FONT_PT = 9
const HF_SCALE_PX_PER_PT = 2

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png'),
    )
    if (blob) return new Uint8Array(await blob.arrayBuffer())
  }
  if (typeof canvas.toDataURL === 'function') {
    const url = canvas.toDataURL('image/png')
    const comma = url.indexOf(',')
    if (comma > 0) {
      const bin = atob(url.slice(comma + 1))
      const out = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
      return out
    }
  }
  return null
}

function loadImage(dataUrl: string): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

async function renderWatermarkStamp(
  w: WatermarkOptions,
  faceWidthPt: number,
  faceHeightPt: number,
  loadedImage: HTMLImageElement | null,
): Promise<Uint8Array | null> {
  if (typeof document === 'undefined') return null
  const longSidePt = Math.max(faceWidthPt, faceHeightPt, 1)
  const scale = Math.min(2, MAX_WATERMARK_LONG_SIDE_PX / longSidePt)
  const cw = Math.max(1, Math.round(faceWidthPt * scale))
  const ch = Math.max(1, Math.round(faceHeightPt * scale))
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const rad = (w.angle * Math.PI) / 180

  if (w.kind === 'text') {
    const text = w.text.trim()
    if (!text) return null
    const pxFont = Math.max(10, Math.round(w.fontSize * scale))
    ctx.fillStyle = w.color || '#888888'
    ctx.font = `700 ${pxFont}px system-ui, -apple-system, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const drawOne = (cx: number, cy: number) => {
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(rad)
      ctx.fillText(text, 0, 0)
      ctx.restore()
    }

    if (w.tile) {
      const measured = Math.max(ctx.measureText(text).width, pxFont * 2)
      const stepX = Math.max(measured * 1.35, cw / 3)
      const stepY = Math.max(pxFont * 3.2, ch / 4)
      for (let y = stepY * 0.5; y < ch + stepY * 0.5; y += stepY) {
        for (let x = stepX * 0.5; x < cw + stepX * 0.5; x += stepX) {
          drawOne(x, y)
        }
      }
    } else {
      drawOne(cw / 2, ch / 2)
    }
    return canvasToPngBytes(canvas)
  }

  if (
    w.kind === 'image' &&
    loadedImage &&
    loadedImage.naturalWidth > 0 &&
    loadedImage.naturalHeight > 0
  ) {
    const shortSide = Math.min(cw, ch)
    const targetMax = shortSide * (w.imageScale / 100)
    const aspect = loadedImage.naturalWidth / loadedImage.naturalHeight
    const drawW = aspect >= 1 ? targetMax : targetMax * aspect
    const drawH = aspect >= 1 ? targetMax / aspect : targetMax

    const drawOne = (cx: number, cy: number) => {
      ctx.save()
      ctx.translate(cx, cy)
      ctx.drawImage(loadedImage, -drawW / 2, -drawH / 2, drawW, drawH)
      ctx.restore()
    }

    if (w.tile) {
      const stepX = Math.max(drawW * 1.4, cw / 3)
      const stepY = Math.max(drawH * 1.4, ch / 4)
      for (let y = stepY * 0.5; y < ch + stepY * 0.5; y += stepY) {
        for (let x = stepX * 0.5; x < cw + stepX * 0.5; x += stepX) {
          drawOne(x, y)
        }
      }
    } else {
      drawOne(cw / 2, ch / 2)
    }
    return canvasToPngBytes(canvas)
  }

  return null
}

function slotText(
  slot: HeaderFooterSlot,
  hf: HeaderFooterOptions,
  faceNumber: number,
  totalFaces: number,
  fallbackDate: string,
): string {
  switch (slot.kind) {
    case 'title':
      return (hf.documentTitle ?? '').trim()
    case 'date':
      return (hf.dateText ?? fallbackDate).trim()
    case 'pageNumber':
      return `${faceNumber} / ${totalFaces}`
    case 'custom':
      return slot.text.trim()
    default:
      return ''
  }
}

async function renderBandStamp(
  left: string,
  center: string,
  right: string,
  faceWidthPt: number,
): Promise<Uint8Array | null> {
  if (!left && !center && !right) return null
  if (typeof document === 'undefined') return null
  const cw = Math.max(1, Math.round(faceWidthPt * HF_SCALE_PX_PER_PT))
  const ch = Math.max(1, Math.round(HF_BAND_HEIGHT_PT * HF_SCALE_PX_PER_PT))
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const pxFont = Math.round(HF_FONT_PT * HF_SCALE_PX_PER_PT)
  const padX = Math.round(HF_MARGIN_X_PT * HF_SCALE_PX_PER_PT)
  ctx.fillStyle = '#444444'
  ctx.font = `400 ${pxFont}px system-ui, -apple-system, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`
  ctx.textBaseline = 'middle'
  const midY = ch / 2
  const maxColW = Math.max(40, (cw - padX * 2) / 3)

  if (left) {
    ctx.textAlign = 'left'
    ctx.fillText(left, padX, midY, maxColW)
  }
  if (center) {
    ctx.textAlign = 'center'
    ctx.fillText(center, cw / 2, midY, maxColW)
  }
  if (right) {
    ctx.textAlign = 'right'
    ctx.fillText(right, cw - padX, midY, maxColW)
  }
  return canvasToPngBytes(canvas)
}

/**
 * Builds deduplicated transparent PNG overlay stamps for watermark and
 * header/footer options across the planned output `faceSizes`. Returns
 * `undefined` when no overlay is active or Canvas is unavailable.
 */
export async function buildOverlayBundle(
  options: PrintLayoutOptions,
  faceSizes: readonly PageSize[],
): Promise<OverlayBundle | undefined> {
  const wantWm = hasActiveWatermark(options.watermark)
  const wantHf = hasActiveHeaderFooter(options.headerFooter)
  if ((!wantWm && !wantHf) || faceSizes.length === 0 || typeof document === 'undefined') {
    return undefined
  }

  const stamps: Uint8Array[] = []
  const perFace: OverlayPlacement[][] = faceSizes.map(() => [])

  if (wantWm) {
    const loadedImage =
      options.watermark.kind === 'image' && options.watermark.imageDataUrl
        ? await loadImage(options.watermark.imageDataUrl)
        : null
    const bySize = new Map<string, number>()
    for (let i = 0; i < faceSizes.length; i++) {
      const f = faceSizes[i]!
      const key = `${Math.round(f.widthPt)}x${Math.round(f.heightPt)}`
      let idx = bySize.get(key)
      if (idx === undefined) {
        const png = await renderWatermarkStamp(
          options.watermark,
          f.widthPt,
          f.heightPt,
          loadedImage,
        )
        if (!png) continue
        idx = stamps.length
        stamps.push(png)
        bySize.set(key, idx)
      }
      perFace[i]!.push({
        stampIndex: idx,
        x: 0,
        y: 0,
        width: f.widthPt,
        height: f.heightPt,
        opacity: options.watermark.opacity,
      })
    }
  }

  if (wantHf) {
    const hf = options.headerFooter
    const total = faceSizes.length
    const fallbackDate = new Date().toLocaleDateString()
    const bandCache = new Map<string, number>()

    const placeBand = async (
      faceIndex: number,
      widthPt: number,
      yPt: number,
      left: string,
      center: string,
      right: string,
    ) => {
      if (!left && !center && !right) return
      const key = `${Math.round(widthPt)}|${left}|${center}|${right}`
      let idx = bandCache.get(key)
      if (idx === undefined) {
        const png = await renderBandStamp(left, center, right, widthPt)
        if (!png) return
        idx = stamps.length
        stamps.push(png)
        bandCache.set(key, idx)
      }
      perFace[faceIndex]!.push({
        stampIndex: idx,
        x: 0,
        y: yPt,
        width: widthPt,
        height: HF_BAND_HEIGHT_PT,
        opacity: 1,
      })
    }

    for (let i = 0; i < faceSizes.length; i++) {
      const f = faceSizes[i]!
      const n = i + 1
      await placeBand(
        i,
        f.widthPt,
        4,
        slotText(hf.topLeft, hf, n, total, fallbackDate),
        slotText(hf.topCenter, hf, n, total, fallbackDate),
        slotText(hf.topRight, hf, n, total, fallbackDate),
      )
      await placeBand(
        i,
        f.widthPt,
        Math.max(0, f.heightPt - HF_BAND_HEIGHT_PT - 4),
        slotText(hf.bottomLeft, hf, n, total, fallbackDate),
        slotText(hf.bottomCenter, hf, n, total, fallbackDate),
        slotText(hf.bottomRight, hf, n, total, fallbackDate),
      )
    }
  }

  if (stamps.length === 0) return undefined
  return { stamps, perFace }
}
