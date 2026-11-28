/**
 * Theme-invariant SVG serializer and PNG rasterizer for whiteboard pages.
 * Used identically for PNG/SVG/PDF exports, printing, `--headless-export`,
 * `.whiteboard` thumbnails, and AI vision PNG page snapshots.
 *
 * Never reads CSS theme variables — document paper and objects always render in
 * their own light Miro/Allo/Claude-inspired document colors, and UI chrome
 * (selection handles, hover outlines, AI highlights) is never included.
 */
import {
  computePageBounds,
  computeStrokeOutline,
  type BoardDocument,
  type ConnectorProps,
  type ImageProps,
  type LinkProps,
  type RichText,
  type ShapeProps,
  type StickerProps,
  type StickyProps,
  type StrokeProps,
  type TableProps,
  type TextAlign,
  type TextProps,
} from '@genoffice/whiteboard-engine'
import {
  BOARD_FONT_STACK,
  computeConnectorGeometry,
  PAPER_COLORS,
  resolveConnectorEndpoint,
  SHAPE_DEFAULT_FONT_SIZE,
  STICKY_DEFAULT_FONT_SIZE,
  stickyLiftShadowPath,
  strokeLineAttrs,
  TEXT_DEFAULT_FONT_SIZE,
  typographyMetrics,
  type ConnectorHeadShape,
} from '../canvas/paper-style'
import { shapePath, shapeTextBox } from '../canvas/shape-paths'
import { stickerInnerSvg } from '../canvas/stickers'

export interface RenderedPageSvg {
  svg: string
  width: number
  height: number
  viewBoxX: number
  viewBoxY: number
}

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function richTextPlain(rt: RichText | undefined): string {
  if (!rt || !Array.isArray(rt.paragraphs)) return ''
  return rt.paragraphs
    .map((p) => (Array.isArray(p.runs) ? p.runs.map((r) => r.text ?? '').join('') : ''))
    .join('\n')
}

function renderRichTextSvg(
  rt: RichText | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  fontSize: number,
  defaultColor: string,
  defaultAlign: TextAlign = 'left',
  verticalAlign: 'top' | 'center' = 'top',
  defaultWeight: 400 | 500 | 600 = 400,
): string {
  if (!rt || !Array.isArray(rt.paragraphs) || rt.paragraphs.length === 0) return ''
  const plain = richTextPlain(rt)
  if (!plain) return ''

  const { lineHeight, letterSpacing } = typographyMetrics(fontSize)
  const lineH = fontSize * lineHeight
  const totalH = rt.paragraphs.length * lineH
  const startY =
    verticalAlign === 'center'
      ? y + Math.max(fontSize * 0.9, (h - totalH) / 2 + fontSize * 0.85)
      : y + fontSize * 0.95

  const out: string[] = []
  rt.paragraphs.forEach((p, idx) => {
    const align = p.align ?? defaultAlign
    const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start'
    const tx = align === 'center' ? x + w / 2 : align === 'right' ? x + w : x
    const ty = startY + idx * lineH
    const runs = (p.runs ?? []).map((r) => {
      const attrs: string[] = []
      const weight = r.bold ? 700 : defaultWeight
      if (weight !== 400) attrs.push(`font-weight="${weight}"`)
      if (r.italic) attrs.push('font-style="italic"')
      const decos = [r.underline ? 'underline' : '', r.strike ? 'line-through' : '']
        .filter(Boolean)
        .join(' ')
      if (decos) attrs.push(`text-decoration="${decos}"`)
      attrs.push(`fill="${escXml(r.color || defaultColor)}"`)
      return `<tspan ${attrs.join(' ')}>${escXml(r.text || ' ')}</tspan>`
    })
    out.push(
      `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" font-family="${escXml(BOARD_FONT_STACK)}" font-size="${fontSize}" letter-spacing="${letterSpacing}" text-anchor="${anchor}">${runs.join('')}</text>`,
    )
  })
  return out.join('')
}

function renderHeadSvg(head: ConnectorHeadShape | null, ink: string, strokeWidth: number): string {
  if (!head) return ''
  if (head.kind === 'chevron' && head.path) {
    return `<path d="${head.path}" fill="none" stroke="${escXml(ink)}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`
  }
  if (head.kind === 'stealth' && head.path) {
    return `<path d="${head.path}" fill="${escXml(ink)}"/>`
  }
  if (head.kind === 'circle' && head.point) {
    const r = head.radius ?? Math.max(3.6, strokeWidth * 1.65)
    return `<circle cx="${head.point.x}" cy="${head.point.y}" r="${r}" fill="${PAPER_COLORS.paper}" stroke="${escXml(ink)}" stroke-width="${Math.max(1.75, strokeWidth)}"/>`
  }
  return ''
}

function estimatePillWidth(label: string): number {
  let units = 0
  for (const ch of label) {
    const code = ch.codePointAt(0) ?? 0
    const isWide =
      (code >= 0x1100 && code <= 0x11ff) ||
      (code >= 0x3000 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xff00 && code <= 0xffef)
    units += isWide ? 12.5 : 7.5
  }
  return Math.max(44, Math.ceil(units + 20))
}

export function renderPageToSvg(
  doc: BoardDocument,
  pageId: string,
  resourceDataUrls: ReadonlyMap<string, string>,
  freeformMargin = 48,
): RenderedPageSvg | null {
  const page = doc.pages.find((p) => p.id === pageId)
  if (!page) return null

  const bounds = computePageBounds(doc, pageId, freeformMargin) ?? {
    x: 0,
    y: 0,
    width: page.width || 1920,
    height: page.height || 1080,
  }
  const w = Math.max(1, Math.round(bounds.width))
  const h = Math.max(1, Math.round(bounds.height))

  const pageObjs = doc.objects
    .filter((o) => o.pageId === pageId)
    .sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0))
  const byId = new Map(pageObjs.map((o) => [o.id, o]))

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}">`,
  )
  parts.push(
    [
      '<defs>',
      '<filter id="wb-sticky-shadow" x="-16%" y="-14%" width="132%" height="138%">',
      '<feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-color="#1F1D1A" flood-opacity="0.07"/>',
      '<feDropShadow dx="0" dy="5" stdDeviation="6" flood-color="#1F1D1A" flood-opacity="0.09"/>',
      '</filter>',
      '<filter id="wb-sticky-lift" x="-18%" y="-40%" width="136%" height="220%">',
      '<feGaussianBlur stdDeviation="3.4"/>',
      '</filter>',
      '<linearGradient id="wb-sticky-sheen" x1="0" y1="0" x2="0" y2="1">',
      '<stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.24"/>',
      '<stop offset="22%" stop-color="#FFFFFF" stop-opacity="0"/>',
      '</linearGradient>',
      '<filter id="wb-card-shadow" x="-12%" y="-10%" width="124%" height="130%">',
      '<feDropShadow dx="0" dy="1" stdDeviation="1.4" flood-color="#1F1D1A" flood-opacity="0.06"/>',
      '<feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#1F1D1A" flood-opacity="0.06"/>',
      '</filter>',
      '</defs>',
    ].join(''),
  )

  // Background layer (document paper colors, never inverted by dark UI theme).
  const bg = page.background
  if (bg.kind === 'solid') {
    parts.push(
      `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${escXml(bg.color)}"/>`,
    )
  } else if (bg.kind === 'grid') {
    parts.push(
      `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${escXml(bg.color)}"/>`,
    )
    const step = 24
    const patId = `wb-grid-${bg.pattern}`
    if (bg.pattern === 'dot') {
      parts.push(
        `<defs><pattern id="${patId}" width="${step}" height="${step}" patternUnits="userSpaceOnUse"><circle cx="12" cy="12" r="1.05" fill="#1F1D1A" fill-opacity="0.14"/></pattern></defs>`,
      )
    } else {
      parts.push(
        `<defs><pattern id="${patId}" width="${step}" height="${step}" patternUnits="userSpaceOnUse"><path d="M ${step} 0 L 0 0 0 ${step}" fill="none" stroke="#E4DFD5" stroke-width="1"/></pattern></defs>`,
      )
    }
    parts.push(
      `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="url(#${patId})"/>`,
    )
  } else if (bg.kind === 'image') {
    parts.push(
      `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${PAPER_COLORS.paper}"/>`,
    )
    const dataUrl = resourceDataUrls.get(bg.resourceId)
    if (dataUrl) {
      parts.push(
        `<image href="${escXml(dataUrl)}" x="0" y="0" width="${bg.width}" height="${bg.height}" preserveAspectRatio="xMidYMid meet"/>`,
      )
    }
  }

  for (const obj of pageObjs) {
    const cx = obj.x + obj.width / 2
    const cy = obj.y + obj.height / 2
    const rotAttr =
      Math.abs(obj.rotation) > 1e-4 ? ` transform="rotate(${obj.rotation} ${cx} ${cy})"` : ''

    switch (obj.kind) {
      case 'sticky': {
        const p = obj.props as unknown as StickyProps
        const liftPath = stickyLiftShadowPath(obj.x, obj.y, obj.width, obj.height)
        parts.push(`<g${rotAttr}>`)
        parts.push(
          `<path d="${liftPath}" fill="#1F1D1A" fill-opacity="0.11" filter="url(#wb-sticky-lift)"/>`,
        )
        parts.push('<g filter="url(#wb-sticky-shadow)">')
        parts.push(
          `<rect x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" rx="4" fill="${escXml(p.color || '#FFF3A1')}" stroke="rgba(31, 29, 26, 0.09)" stroke-width="1"/>`,
        )
        parts.push(
          `<rect x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" rx="4" fill="url(#wb-sticky-sheen)"/>`,
        )
        parts.push(
          renderRichTextSvg(
            p.text,
            obj.x + 20,
            obj.y + 18,
            Math.max(10, obj.width - 40),
            Math.max(10, obj.height - 36),
            p.fontSize ?? STICKY_DEFAULT_FONT_SIZE,
            PAPER_COLORS.ink,
            p.align ?? 'center',
            'center',
            500,
          ),
        )
        parts.push('</g></g>')
        break
      }
      case 'text': {
        const p = obj.props as unknown as TextProps
        const hasBox = Boolean((p.background && p.background !== 'transparent') || p.borderColor)
        const padX = hasBox ? 14 : 6
        const padY = hasBox ? 10 : 4
        parts.push(`<g${rotAttr}>`)
        if (hasBox) {
          parts.push(
            `<rect x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" rx="8" fill="${escXml(p.background && p.background !== 'transparent' ? p.background : 'none')}" stroke="${escXml(p.borderColor || 'none')}" stroke-width="1"/>`,
          )
        }
        parts.push(
          renderRichTextSvg(
            p.text,
            obj.x + padX,
            obj.y + padY,
            Math.max(10, obj.width - padX * 2),
            Math.max(10, obj.height - padY * 2),
            p.fontSize ?? TEXT_DEFAULT_FONT_SIZE,
            p.color || PAPER_COLORS.ink,
            p.align ?? 'left',
            'top',
            400,
          ),
        )
        parts.push('</g>')
        break
      }
      case 'shape': {
        const p = obj.props as unknown as ShapeProps
        const sw = p.strokeWidth ?? 1.75
        const kind = p.shape || 'rounded_rectangle'
        const d = shapePath(kind, obj.width, obj.height, sw / 2)
        const box = shapeTextBox(kind, obj.width, obj.height)
        const fill = p.fill || PAPER_COLORS.shapeDefaultFill
        const isTransparent = fill === 'transparent' || fill === 'none'
        const lineAttrs = strokeLineAttrs(p.lineStyle, sw)
        const dashXml = lineAttrs.dasharray ? ` stroke-dasharray="${lineAttrs.dasharray}"` : ''
        const shadowAttr = isTransparent ? '' : ' filter="url(#wb-card-shadow)"'
        parts.push(`<g${rotAttr}${shadowAttr}>`)
        parts.push(
          `<g transform="translate(${obj.x} ${obj.y})"><path d="${d}" fill="${escXml(fill)}" stroke="${escXml(p.stroke || PAPER_COLORS.shapeDefaultStroke)}" stroke-width="${sw}" stroke-linecap="${lineAttrs.linecap}" stroke-linejoin="round"${dashXml}/></g>`,
        )
        parts.push(
          renderRichTextSvg(
            p.text,
            obj.x + box.left,
            obj.y + box.top,
            Math.max(10, box.width),
            Math.max(10, box.height),
            p.fontSize ?? SHAPE_DEFAULT_FONT_SIZE,
            PAPER_COLORS.ink,
            p.align ?? 'center',
            'center',
            500,
          ),
        )
        parts.push('</g>')
        break
      }
      case 'connector': {
        const p = obj.props as unknown as ConnectorProps
        const a = resolveConnectorEndpoint(p.start, byId)
        const b = resolveConnectorEndpoint(p.end, byId)
        const sw = p.strokeWidth ?? 2
        const ink = p.color || PAPER_COLORS.connectorDefault
        const geom = computeConnectorGeometry(
          a.point,
          b.point,
          p.waypoints,
          sw,
          p.startHead,
          p.endHead,
          p.routing ?? 'straight',
          a.normal,
          b.normal,
        )
        const lineAttrs = strokeLineAttrs(p.lineStyle, sw)
        const dashXml = lineAttrs.dasharray ? ` stroke-dasharray="${lineAttrs.dasharray}"` : ''
        parts.push('<g>')
        parts.push(
          `<path d="${geom.shaftPath}" fill="none" stroke="${escXml(ink)}" stroke-width="${sw}" stroke-linecap="${lineAttrs.linecap}" stroke-linejoin="round"${dashXml}/>`,
        )
        const startHeadXml = renderHeadSvg(geom.startHead, ink, sw)
        if (startHeadXml) parts.push(startHeadXml)
        const endHeadXml = renderHeadSvg(geom.endHead, ink, sw)
        if (endHeadXml) parts.push(endHeadXml)
        const lbl = richTextPlain(p.label).trim()
        if (lbl) {
          const pillW = estimatePillWidth(lbl)
          parts.push(
            `<rect x="${(geom.midpoint.x - pillW / 2).toFixed(1)}" y="${(geom.midpoint.y - 12).toFixed(1)}" width="${pillW}" height="24" rx="12" fill="${PAPER_COLORS.cardBg}" stroke="${PAPER_COLORS.line}" stroke-width="1" filter="url(#wb-card-shadow)"/>`,
          )
          parts.push(
            `<text x="${geom.midpoint.x.toFixed(1)}" y="${(geom.midpoint.y + 4.5).toFixed(1)}" text-anchor="middle" font-family="${escXml(BOARD_FONT_STACK)}" font-size="12.5" font-weight="500" fill="${PAPER_COLORS.ink}">${escXml(lbl)}</text>`,
          )
        }
        parts.push('</g>')
        break
      }
      case 'stroke': {
        const p = obj.props as unknown as StrokeProps
        const d = computeStrokeOutline(p.points ?? [], p.width ?? 4, p.tool ?? 'pen')
        if (d) {
          const isHi = p.tool === 'highlighter'
          parts.push(
            `<g transform="translate(${obj.x} ${obj.y})" opacity="${p.opacity ?? (isHi ? 0.35 : 1)}"${isHi ? ' style="mix-blend-mode:multiply"' : ''}><path d="${d}" fill="${escXml(p.color || PAPER_COLORS.ink)}"/></g>`,
          )
        }
        break
      }
      case 'image': {
        const p = obj.props as unknown as ImageProps
        const dataUrl = resourceDataUrls.get(p.resourceId)
        if (dataUrl) {
          parts.push(
            `<g${rotAttr}><image href="${escXml(dataUrl)}" x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" preserveAspectRatio="xMidYMid meet"/></g>`,
          )
        }
        break
      }
      case 'table': {
        const p = obj.props as unknown as TableProps
        const rows = p.rowIds?.length || 1
        const cols = p.colIds?.length || 1
        const cellW = obj.width / cols
        const cellH = obj.height / rows
        const clipId = `wb-tbl-clip-${escXml(obj.id)}`
        parts.push(
          `<defs><clipPath id="${clipId}"><rect x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" rx="10"/></clipPath></defs>`,
        )
        parts.push(`<g${rotAttr} filter="url(#wb-card-shadow)">`)
        parts.push(`<g clip-path="url(#${clipId})">`)
        parts.push(
          `<rect x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" fill="${PAPER_COLORS.cardBg}"/>`,
        )
        p.rowIds?.forEach((rid, ri) => {
          p.colIds?.forEach((cid, ci) => {
            const cx0 = obj.x + ci * cellW
            const cy0 = obj.y + ri * cellH
            if (ri === 0 && p.headerRow) {
              parts.push(
                `<rect x="${cx0}" y="${cy0}" width="${cellW}" height="${cellH}" fill="${PAPER_COLORS.zoneFill}"/>`,
              )
            }
            if (ci > 0) {
              parts.push(
                `<line x1="${cx0}" y1="${cy0}" x2="${cx0}" y2="${cy0 + cellH}" stroke="${PAPER_COLORS.line}" stroke-width="1"/>`,
              )
            }
            if (ri > 0) {
              parts.push(
                `<line x1="${cx0}" y1="${cy0}" x2="${cx0 + cellW}" y2="${cy0}" stroke="${PAPER_COLORS.line}" stroke-width="1"/>`,
              )
            }
            const cellRt = p.cells?.[`${rid}:${cid}`]
            if (cellRt && richTextPlain(cellRt)) {
              parts.push(
                renderRichTextSvg(
                  cellRt,
                  cx0 + 12,
                  cy0 + 4,
                  Math.max(10, cellW - 24),
                  Math.max(10, cellH - 8),
                  p.fontSize ?? 14,
                  PAPER_COLORS.ink,
                  'left',
                  'center',
                  ri === 0 && p.headerRow ? 600 : 400,
                ),
              )
            }
          })
        })
        parts.push('</g>')
        parts.push(
          `<rect x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" rx="10" fill="none" stroke="${PAPER_COLORS.lineStrong}" stroke-width="1.2"/>`,
        )
        parts.push('</g>')
        break
      }
      case 'sticker': {
        const p = obj.props as unknown as StickerProps
        parts.push(
          `<g${rotAttr}><svg x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" viewBox="0 0 100 100" overflow="visible">${stickerInnerSvg(p.stickerId, p.tint)}</svg></g>`,
        )
        break
      }
      case 'link': {
        const p = obj.props as unknown as LinkProps
        parts.push(`<g${rotAttr} filter="url(#wb-card-shadow)">`)
        parts.push(
          `<rect x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" rx="12" fill="${PAPER_COLORS.cardBg}" stroke="${PAPER_COLORS.line}" stroke-width="1.2"/>`,
        )
        const hasPreview = p.previewResourceId && resourceDataUrls.has(p.previewResourceId)
        const textX = hasPreview ? obj.x + 112 : obj.x + 18
        const textW = hasPreview ? obj.width - 126 : obj.width - 36
        if (hasPreview) {
          const url = resourceDataUrls.get(p.previewResourceId!)!
          parts.push(
            `<image href="${escXml(url)}" x="${obj.x + 10}" y="${obj.y + 10}" width="92" height="${Math.max(40, obj.height - 20)}" preserveAspectRatio="xMidYMid slice"/>`,
          )
        }
        parts.push(
          `<text x="${textX}" y="${obj.y + 34}" font-family="${escXml(BOARD_FONT_STACK)}" font-size="14.5" font-weight="600" fill="${PAPER_COLORS.ink}">${escXml((p.title || p.url).slice(0, 60))} ↗</text>`,
        )
        if (p.description) {
          parts.push(
            `<text x="${textX}" y="${obj.y + 56}" font-family="${escXml(BOARD_FONT_STACK)}" font-size="12" fill="${PAPER_COLORS.inkMuted}">${escXml(p.description.slice(0, 80))}</text>`,
          )
        }
        parts.push(
          `<text x="${textX}" y="${obj.y + obj.height - 16}" font-family="${escXml(BOARD_FONT_STACK)}" font-size="11.5" fill="${PAPER_COLORS.accent}">${escXml(p.url.slice(0, Math.max(20, Math.floor(textW / 6.5))))}</text>`,
        )
        parts.push('</g>')
        break
      }
    }
  }

  parts.push('</svg>')
  return {
    svg: parts.join('\n'),
    width: w,
    height: h,
    viewBoxX: bounds.x,
    viewBoxY: bounds.y,
  }
}

/** Rasterizes a theme-invariant page SVG into PNG bytes via an offscreen HTMLCanvasElement. */
export async function renderSvgToPngBytes(
  svg: string,
  width: number,
  height: number,
  maxEdge = 2400,
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null
  const scale = Math.min(1, maxEdge / Math.max(width, height, 1))
  const outW = Math.max(1, Math.round(width * scale))
  const outH = Math.max(1, Math.round(height * scale))
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('failed to load SVG into image'))
      el.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = PAPER_COLORS.paper
    ctx.fillRect(0, 0, outW, outH)
    ctx.drawImage(img, 0, 0, outW, outH)
    const pngBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png'),
    )
    if (!pngBlob) return null
    const buf = await pngBlob.arrayBuffer()
    return { bytes: new Uint8Array(buf), width: outW, height: outH }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function uint8ToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
