/**
 * Desktop print HTML → vector PDF pages, inside the phone's web view.
 *
 * The desktop hands its print HTML to Chromium's `printToPDF`. A phone web view
 * has no such call, so the page is laid out by the web view itself (a hidden,
 * script-less iframe) and its painted boxes are copied into PDF drawing
 * operators: cell fills, the inset-shadow borders and gridlines the desktop
 * markup uses, the heading strip, header/footer text and pictures, and each
 * text run at the position the browser placed it, in an embedded font, so the
 * text stays selectable and searchable.
 *
 * Scale: the desktop shrinks or grows a page's content with CSS `zoom`. Engines
 * report boxes under `zoom` differently, so the iframe lays the content out at
 * zoom 1 inside a box enlarged by the same factor (the same layout), and the
 * PDF applies the scale.
 */
import {
  beginText,
  clip,
  concatTransformationMatrix,
  drawObject,
  endPath,
  endText,
  fill,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setFillingRgbColor,
  setFontAndSize,
  setLineWidth,
  setStrokingRgbColor,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  TextRenderingMode,
  type PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFName,
  type PDFOperator,
  type PDFPage,
} from 'pdf-lib'
import { FaceResolver, fontFaceCss, parseFontFamilyList, type LoadedFace } from './fonts'

const PX_TO_PT = 0.75
const CSS_PX_PER_IN = 96

export interface RenderStats {
  pages: number
  cells: number
  textRuns: number
  missingGlyphs: number
  pictures: number
  skippedVisuals: number
}

export interface Rgba {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

/** `rgb(…)` / `rgba(…)` / `#rgb[a]` / `#rrggbb[aa]` as 0..1 channels; null for transparent or unknown. */
export function parseCssColor(value: string): Rgba | null {
  const text = value.trim()
  if (text === '' || text === 'transparent') return null
  const hex = /^#([0-9a-f]{3,8})$/i.exec(text)
  if (hex) {
    let digits = hex[1] as string
    if (digits.length === 3 || digits.length === 4) {
      digits = [...digits].map((digit) => digit + digit).join('')
    }
    if (digits.length !== 6 && digits.length !== 8) return null
    const channel = (index: number) => parseInt(digits.slice(index, index + 2), 16) / 255
    const color = {
      r: channel(0),
      g: channel(2),
      b: channel(4),
      a: digits.length === 8 ? channel(6) : 1,
    }
    return color.a === 0 ? null : color
  }
  const fn = /^rgba?\(([^)]*)\)$/i.exec(text)
  if (!fn) return null
  const parts = (fn[1] as string).split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3) return null
  const channel = (part: string) =>
    part.endsWith('%') ? parseFloat(part) / 100 : parseFloat(part) / 255
  const alphaPart = parts[3]
  const alpha =
    alphaPart === undefined
      ? 1
      : alphaPart.endsWith('%')
        ? parseFloat(alphaPart) / 100
        : parseFloat(alphaPart)
  const color = {
    r: channel(parts[0] as string),
    g: channel(parts[1] as string),
    b: channel(parts[2] as string),
    a: alpha,
  }
  if ([color.r, color.g, color.b, color.a].some((n) => !Number.isFinite(n))) return null
  return color.a === 0 ? null : color
}

export interface InsetShadow {
  readonly color: Rgba
  readonly x: number
  readonly y: number
}

/** The inset, unblurred shadows of a computed `box-shadow` (the desktop's border marks). */
export function parseInsetShadows(value: string): InsetShadow[] {
  if (!value || value === 'none') return []
  const shadows: InsetShadow[] = []
  let depth = 0
  let start = 0
  const parts: string[] = []
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    else if (char === ',' && depth === 0) {
      parts.push(value.slice(start, index))
      start = index + 1
    }
  }
  parts.push(value.slice(start))
  for (const part of parts) {
    if (!/\binset\b/.test(part)) continue
    const colorText = /(rgba?\([^)]*\)|#[0-9a-f]{3,8}\b)/i.exec(part)?.[1]
    const color = colorText ? parseCssColor(colorText) : null
    const lengths = [...part.replace(/rgba?\([^)]*\)/gi, '').matchAll(/(-?[\d.]+)(px)?/g)].map(
      (match) => parseFloat(match[1] as string),
    )
    const [x = 0, y = 0, blur = 0] = lengths
    if (!color || blur !== 0) continue
    shadows.push({ color, x, y })
  }
  return shadows
}

/** The band an inset shadow paints inside a box (one-axis offsets, as the desktop writes them). */
export function shadowBands(
  box: { left: number; top: number; width: number; height: number },
  shadow: InsetShadow,
): { left: number; top: number; width: number; height: number }[] {
  const bands: { left: number; top: number; width: number; height: number }[] = []
  const x = Math.min(Math.abs(shadow.x), box.width)
  const y = Math.min(Math.abs(shadow.y), box.height)
  if (shadow.x > 0) bands.push({ left: box.left, top: box.top, width: x, height: box.height })
  if (shadow.x < 0)
    bands.push({ left: box.left + box.width - x, top: box.top, width: x, height: box.height })
  if (shadow.y > 0) bands.push({ left: box.left, top: box.top, width: box.width, height: y })
  if (shadow.y < 0)
    bands.push({ left: box.left, top: box.top + box.height - y, width: box.width, height: y })
  return bands
}

/** A text slice of one line drawn with one face. */
export interface FaceRun {
  readonly start: number
  readonly end: number
  readonly face: LoadedFace | null
  readonly syntheticBold: boolean
}

/**
 * Splits `text[start, end)` into runs of one face. Spaces and other
 * characters every face lacks keep the current run's face (the browser keeps
 * them in the surrounding font too).
 */
export function faceRuns(
  text: string,
  start: number,
  end: number,
  resolver: FaceResolver,
  families: readonly string[],
  bold: boolean,
): FaceRun[] {
  const runs: FaceRun[] = []
  let runStart = start
  let current: { face: LoadedFace | null; syntheticBold: boolean } | undefined
  let index = start
  while (index < end) {
    const codePoint = text.codePointAt(index) as number
    const width = codePoint > 0xffff ? 2 : 1
    const neutral = codePoint === 0x20 || codePoint === 0xa0 || codePoint === 0x09
    if (!neutral || current === undefined) {
      const choice = resolver.choose(families, bold, codePoint)
      const next = choice
        ? { face: choice.face, syntheticBold: choice.syntheticBold }
        : { face: null, syntheticBold: false }
      if (current === undefined) current = next
      else if (next.face !== current.face || next.syntheticBold !== current.syntheticBold) {
        runs.push({ start: runStart, end: index, ...current })
        runStart = index
        current = next
      }
    }
    index += width
  }
  if (current !== undefined && runStart < end) runs.push({ start: runStart, end, ...current })
  return runs
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** Maps a layout box (iframe px) to page px: content boxes scale about the content origin. */
interface Mapping {
  readonly originX: number
  readonly originY: number
  readonly scale: number
  readonly pageLeft: number
  readonly pageTop: number
}

function mapBox(box: Box, mapping: Mapping): Box {
  return {
    left: mapping.originX + (box.left - mapping.originX) * mapping.scale - mapping.pageLeft,
    top: mapping.originY + (box.top - mapping.originY) * mapping.scale - mapping.pageTop,
    width: box.width * mapping.scale,
    height: box.height * mapping.scale,
  }
}

/**
 * The hidden iframe the print pages lay out in. One per export; batches of
 * pages replace its body.
 */
export class PrintFrame {
  private readonly iframe: HTMLIFrameElement
  private readonly fontUrls: string[] = []
  private started = false
  private readonly baselineCache = new Map<string, number>()

  constructor(
    private readonly faces: readonly LoadedFace[],
    host: HTMLElement = document.body,
  ) {
    this.iframe = document.createElement('iframe')
    // No scripts run in the print page; same origin lets the app read its layout.
    this.iframe.setAttribute('sandbox', 'allow-same-origin')
    this.iframe.setAttribute('aria-hidden', 'true')
    this.iframe.tabIndex = -1
    this.iframe.style.cssText =
      'position:fixed;left:-30000px;top:0;width:1600px;height:1200px;border:0;visibility:hidden;pointer-events:none'
    host.appendChild(this.iframe)
  }

  private get doc(): Document {
    const doc = this.iframe.contentDocument
    if (!doc) throw new Error('Print frame has no document.')
    return doc
  }

  /** Lays out one batch of desktop print HTML; resolves when its fonts are in. */
  async load(html: string): Promise<HTMLElement[]> {
    const doc = this.doc
    if (!this.started) {
      this.started = true
      const css = fontFaceCss(this.faces, (face) => {
        const url = URL.createObjectURL(new Blob([face.bytes as BlobPart]))
        this.fontUrls.push(url)
        return url
      })
      const withFonts = html.replace('<head>', `<head><style>${css}</style>`)
      doc.open()
      doc.write(withFonts)
      doc.close()
      await Promise.all(
        this.faces.map((face) =>
          doc.fonts.load(`${face.spec.bold ? 700 : 400} 16px "${face.probeFamily}"`, 'A가'),
        ),
      )
    } else {
      const bodyStart = html.indexOf('<body>')
      const bodyEnd = html.lastIndexOf('</body>')
      doc.body.innerHTML = html.slice(bodyStart + '<body>'.length, bodyEnd)
    }
    const pages = [...doc.querySelectorAll<HTMLElement>('body > .page')]
    for (const page of pages) unzoomContent(page)
    // Layout, then wait for the faces that layout asked for, until none is pending.
    for (let round = 0; round < 10; round += 1) {
      void doc.body.offsetHeight
      await doc.fonts.ready
      if (doc.fonts.status === 'loaded') break
    }
    return pages
  }

  /** Distance from a text run's box top to its baseline for one face and size (layout px). */
  baselineOffset(face: LoadedFace, fontSizePx: number, bold: boolean): number {
    const key = `${face.spec.id}|${fontSizePx}|${bold ? 1 : 0}`
    const cached = this.baselineCache.get(key)
    if (cached !== undefined) return cached
    const doc = this.doc
    const probe = doc.createElement('div')
    probe.style.cssText = `position:absolute;left:0;top:0;white-space:pre;line-height:normal;font-family:"${face.probeFamily}";font-size:${fontSizePx}px;font-weight:${bold ? 700 : 400}`
    const text = doc.createTextNode('Hg')
    const marker = doc.createElement('span')
    marker.style.cssText = 'display:inline-block;width:0;height:0'
    probe.append(text, marker)
    doc.body.appendChild(probe)
    const range = doc.createRange()
    range.selectNodeContents(text)
    const offset = marker.getBoundingClientRect().bottom - range.getBoundingClientRect().top
    probe.remove()
    this.baselineCache.set(key, offset)
    return offset
  }

  clear(): void {
    if (this.started) this.doc.body.innerHTML = ''
  }

  dispose(): void {
    this.iframe.remove()
    for (const url of this.fontUrls) URL.revokeObjectURL(url)
    this.fontUrls.length = 0
  }
}

/** Content scale and clip of a page, read from the desktop's inline styles before un-zooming. */
interface ContentGeometry {
  readonly scale: number
  readonly clip: Box
}

const contentGeometry = new WeakMap<HTMLElement, ContentGeometry>()

function inches(value: string): number {
  return value.endsWith('in') ? parseFloat(value) * CSS_PX_PER_IN : parseFloat(value)
}

/** Replaces the content's `zoom: s` by zoom 1 in a box `1/s` as large (the same layout). */
function unzoomContent(page: HTMLElement): void {
  const content = page.querySelector<HTMLElement>(':scope > .content')
  const zoomBox = content?.firstElementChild as HTMLElement | null
  if (!content || !zoomBox) return
  const scale = parseFloat(zoomBox.style.getPropertyValue('zoom')) || 1
  const clipBox = {
    left: inches(content.style.left),
    top: inches(content.style.top),
    width: inches(content.style.width),
    height: inches(content.style.height),
  }
  contentGeometry.set(page, { scale, clip: clipBox })
  if (scale === 1) return
  zoomBox.style.setProperty('zoom', '1')
  content.style.width = `${clipBox.width / scale}px`
  content.style.height = `${clipBox.height / scale}px`
}

/** pdf-lib objects and counters shared by every page of one export. */
export interface PdfSink {
  readonly pdf: PDFDocument
  readonly resolver: FaceResolver
  font(face: LoadedFace): Promise<PDFFont>
  image(src: string): Promise<PDFImage | null>
  readonly stats: RenderStats
}

/** Draws one laid-out desktop print page as a new PDF page. */
export async function drawPrintPage(
  frame: PrintFrame,
  pageElement: HTMLElement,
  paper: { widthIn: number; heightIn: number },
  sink: PdfSink,
): Promise<PDFPage> {
  const page = sink.pdf.addPage([paper.widthIn * 72, paper.heightIn * 72])
  const heightPt = paper.heightIn * 72
  const pageRect = pageElement.getBoundingClientRect()
  const ops: PDFOperator[] = []
  const fontKeys = new Map<PDFFont, PDFName>()
  const fontKey = (font: PDFFont): PDFName => {
    let key = fontKeys.get(font)
    if (key === undefined) {
      key = page.node.newFontDictionary(font.name, font.ref)
      fontKeys.set(font, key)
    }
    return key
  }
  const x = (px: number) => px * PX_TO_PT
  const y = (px: number) => heightPt - px * PX_TO_PT
  const rectOps = (box: Box) =>
    rectangle(x(box.left), y(box.top + box.height), box.width * PX_TO_PT, box.height * PX_TO_PT)

  const flat: Mapping = {
    originX: 0,
    originY: 0,
    scale: 1,
    pageLeft: pageRect.left,
    pageTop: pageRect.top,
  }

  // Header and footer (outside the zoomed content).
  for (const hf of pageElement.querySelectorAll<HTMLElement>(':scope > .hf')) {
    await drawTextIn(hf, flat, null)
  }

  const content = pageElement.querySelector<HTMLElement>(':scope > .content')
  const geometry = contentGeometry.get(pageElement)
  if (content && geometry) {
    const contentRect = content.getBoundingClientRect()
    const mapping: Mapping = {
      originX: contentRect.left,
      originY: contentRect.top,
      scale: geometry.scale,
      pageLeft: pageRect.left,
      pageTop: pageRect.top,
    }
    const clipBox = geometry.clip
    ops.push(pushGraphicsState(), rectOps(clipBox), clip(), endPath())
    for (const cell of content.querySelectorAll<HTMLElement>('td, th')) {
      sink.stats.cells += 1
      const style = cell.ownerDocument.defaultView?.getComputedStyle(cell)
      if (!style) continue
      const box = mapBox(rectOf(cell), mapping)
      const background = parseCssColor(style.backgroundColor)
      if (background) {
        ops.push(fillColor(background), rectOps(box), fill())
      }
      const shadows = parseInsetShadows(style.boxShadow)
      // The first listed shadow paints on top: draw the list backwards.
      for (let index = shadows.length - 1; index >= 0; index -= 1) {
        const shadow = shadows[index] as InsetShadow
        const scaled = { ...shadow, x: shadow.x * mapping.scale, y: shadow.y * mapping.scale }
        for (const band of shadowBands(box, scaled)) {
          ops.push(fillColor(shadow.color), rectOps(band), fill())
        }
      }
      if (cell.textContent) {
        const clipElement = cell.querySelector<HTMLElement>(':scope > .c') ?? cell
        await drawTextIn(cell, mapping, mapBox(rectOf(clipElement), mapping), style)
      }
    }
    // Charts and pictures over the cells: the phone grid does not install them yet.
    sink.stats.skippedVisuals += content.querySelectorAll('.pv').length
    ops.push(popGraphicsState())
  }

  // Encoded and compressed now: pdf-lib keeps pushed operators as objects
  // until save(), which for thousands of pages is gigabytes of heap.
  const contents = sink.pdf.context.flateStream(ops.map((op) => op.toString()).join('\n'))
  page.node.addContentStream(sink.pdf.context.register(contents))
  sink.stats.pages += 1
  return page

  async function drawTextIn(
    container: HTMLElement,
    mapping: Mapping,
    clipBox: Box | null,
    containerStyle?: CSSStyleDeclaration,
  ): Promise<void> {
    const view = container.ownerDocument.defaultView
    if (!view) return
    const decoration = (containerStyle ?? view.getComputedStyle(container)).textDecorationLine
    const underline = decoration.includes('underline')
    const strike = decoration.includes('line-through')
    if (clipBox) ops.push(pushGraphicsState(), rectOps(clipBox), clip(), endPath())
    const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_ALL)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'IMG') {
        await drawPicture(node as HTMLImageElement, mapping)
        continue
      }
      if (node.nodeType !== Node.TEXT_NODE) continue
      const text = node.nodeValue ?? ''
      if (text.trim() === '') continue
      const parent = node.parentElement
      if (!parent) continue
      const style = view.getComputedStyle(parent)
      await drawTextNode(node as Text, text, style, mapping, underline, strike)
    }
    if (clipBox) ops.push(popGraphicsState())
  }

  async function drawTextNode(
    node: Text,
    text: string,
    style: CSSStyleDeclaration,
    mapping: Mapping,
    underline: boolean,
    strike: boolean,
  ): Promise<void> {
    const families = parseFontFamilyList(style.fontFamily)
    const weight = parseInt(style.fontWeight, 10) || 400
    const bold = weight >= 600
    const italic = style.fontStyle === 'italic' || style.fontStyle.startsWith('oblique')
    const fontSizePx = parseFloat(style.fontSize) || 16
    const color = parseCssColor(style.color) ?? { r: 0, g: 0, b: 0, a: 1 }
    const primary = sink.resolver.primary(families, bold)
    const range = node.ownerDocument.createRange()
    for (const line of textLines(node, text, style.whiteSpace, range)) {
      const runs = faceRuns(text, line.start, line.end, sink.resolver, families, bold)
      for (const run of runs) {
        const slice = text.slice(run.start, run.end)
        if (slice.trim() === '') continue
        range.setStart(node, run.start)
        range.setEnd(node, run.end)
        const rect = range.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) continue
        let face = run.face
        if (!face) {
          sink.stats.missingGlyphs += [...slice].filter((char) => char.trim() !== '').length
          face = sink.resolver.missingFace
        }
        const pdfFont = await sink.font(face)
        const baselinePx =
          rect.top + frame.baselineOffset(primary, fontSizePx, bold && primary.spec.bold)
        const mapped = mapBox(
          { left: rect.left, top: baselinePx, width: rect.width, height: 0 },
          mapping,
        )
        const sizePt = fontSizePx * mapping.scale * PX_TO_PT
        const skew = italic ? 0.21 : 0
        ops.push(beginText(), fillColor(color))
        if (run.syntheticBold) {
          ops.push(
            strokeColor(color),
            setLineWidth(sizePt / 30),
            setTextRenderingMode(TextRenderingMode.FillAndOutline),
          )
        } else {
          ops.push(setTextRenderingMode(TextRenderingMode.Fill))
        }
        ops.push(
          setFontAndSize(fontKey(pdfFont), sizePt),
          setTextMatrix(1, 0, skew, 1, x(mapped.left), y(mapped.top)),
          showText(pdfFont.encodeText(slice)),
          endText(),
        )
        sink.stats.textRuns += 1
        if (underline || strike) {
          const upem = face.font.unitsPerEm
          const lines: { offset: number; thickness: number }[] = []
          const thickness = Math.max((face.font.underlineThickness / upem) * sizePt, 0.5)
          if (underline)
            lines.push({ offset: (face.font.underlinePosition / upem) * sizePt, thickness })
          if (strike) {
            const position = face.font['OS/2']?.yStrikeoutPosition
            lines.push({
              offset: position ? (position / upem) * sizePt : sizePt * 0.3,
              thickness,
            })
          }
          for (const line of lines) {
            const baseY = y(mapped.top)
            ops.push(
              fillColor(color),
              rectangle(
                x(mapped.left),
                baseY + line.offset - line.thickness / 2,
                mapped.width * PX_TO_PT,
                line.thickness,
              ),
              fill(),
            )
          }
        }
      }
    }
  }

  async function drawPicture(image: HTMLImageElement, mapping: Mapping): Promise<void> {
    const embedded = await sink.image(image.getAttribute('src') ?? '')
    if (!embedded) return
    const box = mapBox(rectOf(image), mapping)
    const name = page.node.newXObject('Image', embedded.ref)
    ops.push(
      pushGraphicsState(),
      concatTransformationMatrix(
        box.width * PX_TO_PT,
        0,
        0,
        box.height * PX_TO_PT,
        x(box.left),
        y(box.top + box.height),
      ),
      drawObject(name),
      popGraphicsState(),
    )
    sink.stats.pictures += 1
  }
}

function rectOf(element: Element): Box {
  const rect = element.getBoundingClientRect()
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

function fillColor(color: Rgba): PDFOperator {
  return setFillingRgbColor(color.r, color.g, color.b)
}

function strokeColor(color: Rgba): PDFOperator {
  return setStrokingRgbColor(color.r, color.g, color.b)
}

/** Lines of a text node: `pre` breaks only at newlines; wrapping modes are measured per character. */
function textLines(
  node: Text,
  text: string,
  whiteSpace: string,
  range: Range,
): { start: number; end: number }[] {
  const lines: { start: number; end: number }[] = []
  if (whiteSpace === 'pre' || whiteSpace === 'nowrap') {
    let start = 0
    for (let index = 0; index <= text.length; index += 1) {
      if (index === text.length || text[index] === '\n') {
        if (index > start) lines.push({ start, end: index })
        start = index + 1
      }
    }
    return lines
  }
  let start = 0
  let top: number | null = null
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      if (index > start) lines.push({ start, end: index })
      start = index + 1
      top = null
      continue
    }
    range.setStart(node, index)
    range.setEnd(node, index + 1)
    const rects = range.getClientRects()
    const rect = rects[rects.length - 1]
    if (!rect) continue
    if (top === null) top = rect.top
    else if (rect.top > top + rect.height / 2) {
      if (index > start) lines.push({ start, end: index })
      start = index
      top = rect.top
    }
  }
  if (start < text.length) lines.push({ start, end: text.length })
  return lines
}
