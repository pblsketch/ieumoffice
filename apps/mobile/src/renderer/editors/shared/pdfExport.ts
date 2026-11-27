/**
 * Shared mobile PDF export utilities (lazy-loaded only when the user prints or shares as PDF).
 *
 * Keeps `pdf-lib`, `fontkit`, bundled fonts, and canvas rasterization completely out of the
 * initial mobile bundle. Reuses the bundled OFL fonts from `editors/sheets/pdf/fonts.ts` so
 * text stays selectable and searchable in vector PDFs across Android and iOS, with per-character
 * font fallback across Latin, Hangul, CJK, and monospace runs.
 */
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import {
  defaultFaceSpecs,
  FaceResolver,
  fontFaceCss,
  loadFace,
  parseFontFamilyList,
  pdfLibFontkit,
  type LoadedFace,
} from '../sheets/pdf/fonts'

/** A4 dimensions in PDF points (72 pt / inch). */
export const A4_WIDTH_PT = 595.28
export const A4_HEIGHT_PT = 841.89
export const DEFAULT_MARGIN_PT = 40
const PX_TO_PT = 0.75
const MAX_RASTER_PIXELS = 2_400_000

export interface RasterPdfPageInput {
  readonly bytes: Uint8Array
  readonly mime: 'image/jpeg' | 'image/png'
  readonly widthPt: number
  readonly heightPt: number
}

export interface HtmlPdfResult {
  readonly bytes: Uint8Array
  readonly pageCount: number
  readonly missingGlyphs: number
}

export interface HtmlPdfOptions {
  readonly title?: string
  readonly faces?: readonly LoadedFace[]
}

export interface SvgRasterOptions {
  /** Total page count of the document, used to adapt scale/quality so long docs stay under 32 MiB. */
  readonly pageCount?: number
  /** Caller-owned cache of base64 font CSS scoped to a single export (GC'd after export ends). */
  readonly fontCssCache?: Map<string, string>
}

let cachedFacesPromise: Promise<LoadedFace[]> | null = null

async function getBundledFaces(): Promise<LoadedFace[]> {
  if (!cachedFacesPromise) {
    cachedFacesPromise = defaultFaceSpecs()
      .then((specs) =>
        Promise.all(
          specs.map(async (spec) => {
            const response = await fetch(spec.url)
            if (!response.ok) {
              throw new Error(`Font ${spec.id} unavailable (${response.status}).`)
            }
            return loadFace(spec, new Uint8Array(await response.arrayBuffer()))
          }),
        ),
      )
      .catch((err) => {
        cachedFacesPromise = null
        throw err
      })
  }
  return cachedFacesPromise
}

/** Strips AI-redaction HTML span wrappers while preserving the underlying visible text. */
export function stripMarkdownRedactionMarkup(markdown: string): string {
  return markdown.replace(
    /<span\b[^>]*\b(?:class="[^"]*\bredact-span\b[^"]*"|data-redaction\b)[^>]*>([\s\S]*?)<\/span>/gi,
    '$1',
  )
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatInlineMarkdown(line: string): string {
  let out = escapeHtml(line)
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>')
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
  return out
}

/** Converts Markdown or plain text into clean, script-less print HTML. */
export function markdownToPrintHtml(markdown: string, title?: string): string {
  const clean = stripMarkdownRedactionMarkup(markdown).replace(/\r\n?/g, '\n')
  const lines = clean.split('\n')
  const blocks: string[] = []
  let inCode = false
  let codeLines: string[] = []
  let listTag: 'ul' | 'ol' | null = null

  const closeList = () => {
    if (listTag) {
      blocks.push(`</${listTag}>`)
      listTag = null
    }
  }

  for (const rawLine of lines) {
    const line = rawLine
    if (/^```/.test(line.trim())) {
      closeList()
      if (inCode) {
        blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
        codeLines = []
        inCode = false
      } else {
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeLines.push(line)
      continue
    }
    const trimmed = line.trim()
    if (!trimmed) {
      closeList()
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading) {
      closeList()
      const level = heading[1].length
      blocks.push(`<h${level}>${formatInlineMarkdown(heading[2])}</h${level}>`)
      continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      closeList()
      blocks.push('<hr />')
      continue
    }
    const quote = /^>\s?(.*)$/.exec(trimmed)
    if (quote) {
      closeList()
      blocks.push(`<blockquote>${formatInlineMarkdown(quote[1])}</blockquote>`)
      continue
    }
    const ul = /^[-*+]\s+(.*)$/.exec(trimmed)
    if (ul) {
      if (listTag !== 'ul') {
        closeList()
        listTag = 'ul'
        blocks.push('<ul>')
      }
      blocks.push(`<li>${formatInlineMarkdown(ul[1])}</li>`)
      continue
    }
    const ol = /^\d+\.\s+(.*)$/.exec(trimmed)
    if (ol) {
      if (listTag !== 'ol') {
        closeList()
        listTag = 'ol'
        blocks.push('<ol>')
      }
      blocks.push(`<li>${formatInlineMarkdown(ol[1])}</li>`)
      continue
    }
    closeList()
    blocks.push(`<p>${formatInlineMarkdown(trimmed)}</p>`)
  }
  if (inCode && codeLines.length > 0) {
    blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
  }
  closeList()

  const safeTitle = escapeHtml(title ?? 'Document')
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src blob: data:;" />
<title>${safeTitle}</title>
<style>
  html, body { margin: 0; padding: 0; background: #ffffff; color: #111111; font-family: "GenOffice Sans KR", "Liberation Sans", sans-serif; font-size: 13.5px; line-height: 1.6; }
  body { width: 688px; padding: 16px 0; box-sizing: border-box; }
  h1 { font-size: 22px; margin: 0 0 12px; font-weight: 700; }
  h2 { font-size: 18px; margin: 16px 0 8px; font-weight: 700; }
  h3, h4, h5, h6 { font-size: 15px; margin: 14px 0 6px; font-weight: 700; }
  p { margin: 0 0 8px; }
  ul, ol { margin: 0 0 10px; padding-left: 22px; }
  li { margin: 0 0 4px; }
  blockquote { margin: 8px 0; padding: 4px 12px; border-left: 3px solid #9ca3af; color: #374151; }
  pre { margin: 8px 0; padding: 10px 12px; background: #f3f4f6; font-family: "Liberation Mono", monospace; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
  code { font-family: "Liberation Mono", monospace; font-size: 12px; }
  hr { border: 0; border-top: 1px solid #d1d5db; margin: 12px 0; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; }
  th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; }
</style>
</head>
<body>${blocks.join('\n')}</body>
</html>`
}

/** Strips `<script>` blocks and meta refresh tags before placing HTML in a script-less print iframe. */
function stripScriptsForPrint(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '')
}

interface InlineRun {
  readonly text: string
  readonly bold: boolean
  readonly mono: boolean
}

type FlowItem =
  | {
      readonly kind: 'block'
      readonly runs: readonly InlineRun[]
      readonly fontSizePt: number
      readonly indentPt: number
      readonly isHeading: boolean
      readonly isCodeBlock: boolean
    }
  | {
      readonly kind: 'image'
      readonly src: string
      readonly widthPx: number
      readonly heightPx: number
    }
  | { readonly kind: 'hr' }

const BLOCK_TAGS = new Set([
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'P',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'TR',
  'DT',
  'DD',
  'FIGCAPTION',
])

const CONTAINER_TAGS = new Set([
  'BODY',
  'MAIN',
  'ARTICLE',
  'SECTION',
  'HEADER',
  'FOOTER',
  'NAV',
  'ASIDE',
  'DIV',
  'UL',
  'OL',
  'DL',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'FIGURE',
])

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE'])

function hasBlockChildren(el: Element): boolean {
  for (const child of Array.from(el.children)) {
    const tag = child.tagName.toUpperCase()
    if (BLOCK_TAGS.has(tag) || CONTAINER_TAGS.has(tag) || tag === 'HR' || tag === 'IMG') {
      return true
    }
  }
  return false
}

function defaultFontSizeForTag(tag: string): number {
  switch (tag) {
    case 'H1':
      return 18
    case 'H2':
      return 15
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6':
      return 13
    case 'PRE':
      return 9.5
    default:
      return 10.5
  }
}

function isHiddenElement(el: Element, win: Window | null): boolean {
  if ((el as HTMLElement).hidden) return true
  if (!win) return false
  try {
    const style = win.getComputedStyle(el)
    return style.display === 'none' || style.visibility === 'hidden'
  } catch {
    return false
  }
}

/**
 * Walks the parsed DOM in document order, merging inline formatting inside each block element
 * so inline `<strong>`, `<em>`, `<code>`, links, and table cells stay on the same line, while
 * keeping `<img>` and `<hr>` elements in their original document order.
 */
function extractFlowItems(root: Element, win: Window | null, hasRealLayout: boolean): FlowItem[] {
  const items: FlowItem[] = []

  const pushBlock = (rawRuns: InlineRun[], tag: string, el: Element, indentPt: number) => {
    const isCodeBlock = tag === 'PRE'
    const isHeading = /^H[1-6]$/.test(tag)
    const merged: InlineRun[] = []
    for (const run of rawRuns) {
      const normalized = isCodeBlock
        ? run.text.replace(/\r\n?/g, '\n')
        : run.text.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ')
      if (!normalized) continue
      const prev = merged[merged.length - 1]
      if (prev && prev.bold === run.bold && prev.mono === run.mono) {
        merged[merged.length - 1] = {
          text: prev.text + normalized,
          bold: prev.bold,
          mono: prev.mono,
        }
      } else {
        merged.push({ text: normalized, bold: run.bold, mono: run.mono })
      }
    }
    // Trim leading/trailing spaces on non-preformatted blocks.
    if (!isCodeBlock && merged.length > 0) {
      merged[0] = { ...merged[0], text: merged[0].text.replace(/^ +/, '') }
      const last = merged.length - 1
      merged[last] = { ...merged[last], text: merged[last].text.replace(/ +$/, '') }
    }
    const nonEmpty = merged.filter((r) => r.text.length > 0)
    if (nonEmpty.length === 0) return

    let fontSizePt = defaultFontSizeForTag(tag)
    if (hasRealLayout && win) {
      try {
        const px = parseFloat(win.getComputedStyle(el).fontSize ?? '')
        if (Number.isFinite(px) && px > 0) {
          fontSizePt = Math.max(8, Math.min(24, px * PX_TO_PT))
        }
      } catch {
        // Keep tag default.
      }
    }
    items.push({
      kind: 'block',
      runs: nonEmpty,
      fontSizePt,
      indentPt,
      isHeading,
      isCodeBlock,
    })
  }

  const collectInline = (
    node: Node,
    bold: boolean,
    mono: boolean,
    runs: InlineRun[],
    flushBeforeMedia: () => void,
  ) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      if (text) runs.push({ text, bold, mono })
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element
    const tag = el.tagName.toUpperCase()
    if (SKIP_TAGS.has(tag) || isHiddenElement(el, win)) return

    if (tag === 'BR') {
      runs.push({ text: '\n', bold, mono })
      return
    }
    if (tag === 'IMG') {
      const img = el as HTMLImageElement
      const src = img.getAttribute('src') ?? img.src ?? ''
      if (src) {
        flushBeforeMedia()
        const rect = hasRealLayout ? img.getBoundingClientRect() : null
        const w =
          (rect && rect.width > 2 ? rect.width : 0) ||
          Number(img.getAttribute('width')) ||
          img.naturalWidth ||
          320
        const h =
          (rect && rect.height > 2 ? rect.height : 0) ||
          Number(img.getAttribute('height')) ||
          img.naturalHeight ||
          200
        items.push({ kind: 'image', src, widthPx: w, heightPx: h })
      }
      return
    }

    let nextBold = bold || tag === 'STRONG' || tag === 'B' || tag === 'TH' || /^H[1-6]$/.test(tag)
    let nextMono = mono || tag === 'CODE' || tag === 'PRE' || tag === 'KBD' || tag === 'SAMP'
    if (hasRealLayout && win) {
      try {
        const style = win.getComputedStyle(el)
        const weight = parseInt(style.fontWeight ?? '400', 10)
        if (Number.isFinite(weight) && weight >= 600) nextBold = true
        const fam = parseFontFamilyList(style.fontFamily ?? '')
        if (fam.some((f) => /mono|courier|code/i.test(f))) nextMono = true
      } catch {
        // Ignore computed style error.
      }
    }

    if (tag === 'TR') {
      const cells = Array.from(el.children).filter((c) => {
        const ct = c.tagName.toUpperCase()
        return ct === 'TD' || ct === 'TH'
      })
      cells.forEach((cell, idx) => {
        if (idx > 0) runs.push({ text: '  |  ', bold: false, mono: false })
        collectInline(cell, nextBold, nextMono, runs, flushBeforeMedia)
      })
      return
    }

    for (const child of Array.from(el.childNodes)) {
      collectInline(child, nextBold, nextMono, runs, flushBeforeMedia)
    }
  }

  const walk = (el: Element, listDepth: number, quoteDepth: number) => {
    const tag = el.tagName.toUpperCase()
    if (SKIP_TAGS.has(tag) || isHiddenElement(el, win)) return

    if (tag === 'HR') {
      items.push({ kind: 'hr' })
      return
    }
    if (tag === 'IMG') {
      const img = el as HTMLImageElement
      const src = img.getAttribute('src') ?? img.src ?? ''
      if (src) {
        const rect = hasRealLayout ? img.getBoundingClientRect() : null
        const w =
          (rect && rect.width > 2 ? rect.width : 0) ||
          Number(img.getAttribute('width')) ||
          img.naturalWidth ||
          320
        const h =
          (rect && rect.height > 2 ? rect.height : 0) ||
          Number(img.getAttribute('height')) ||
          img.naturalHeight ||
          200
        items.push({ kind: 'image', src, widthPx: w, heightPx: h })
      }
      return
    }

    const nextListDepth = tag === 'UL' || tag === 'OL' ? listDepth + 1 : listDepth
    const nextQuoteDepth = tag === 'BLOCKQUOTE' ? quoteDepth + 1 : quoteDepth

    const isLeafBlock = BLOCK_TAGS.has(tag) || (CONTAINER_TAGS.has(tag) && !hasBlockChildren(el))
    if (isLeafBlock && tag !== 'BODY') {
      const indentPt = Math.min(84, listDepth * 14 + quoteDepth * 14)
      let runs: InlineRun[] = []
      if (tag === 'LI') {
        const parentTag = el.parentElement?.tagName.toUpperCase()
        const idx = parentTag === 'OL' ? Array.from(el.parentElement!.children).indexOf(el) + 1 : 0
        runs.push({ text: idx > 0 ? `${idx}. ` : '• ', bold: false, mono: false })
      }
      const flush = () => {
        if (runs.length > 0) {
          pushBlock(runs, tag, el, indentPt)
          runs = []
        }
      }
      if (tag === 'TR') {
        collectInline(el, false, false, runs, flush)
      } else {
        const baseBold = /^H[1-6]$/.test(tag)
        const baseMono = tag === 'PRE'
        for (const child of Array.from(el.childNodes)) {
          collectInline(child, baseBold, baseMono, runs, flush)
        }
      }
      flush()
      return
    }

    // Container element: flush any direct inline text nodes between block children.
    let orphanRuns: InlineRun[] = []
    const flushOrphans = () => {
      if (orphanRuns.length > 0) {
        pushBlock(orphanRuns, 'P', el, Math.min(84, listDepth * 14 + quoteDepth * 14))
        orphanRuns = []
      }
    }
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        if ((child.textContent ?? '').trim()) {
          orphanRuns.push({ text: child.textContent ?? '', bold: false, mono: false })
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const childEl = child as Element
        const childTag = childEl.tagName.toUpperCase()
        if (
          BLOCK_TAGS.has(childTag) ||
          CONTAINER_TAGS.has(childTag) ||
          childTag === 'HR' ||
          childTag === 'IMG'
        ) {
          flushOrphans()
          walk(childEl, nextListDepth, nextQuoteDepth)
        } else {
          collectInline(childEl, false, false, orphanRuns, flushOrphans)
        }
      }
    }
    flushOrphans()
  }

  walk(root, 0, 0)
  return items
}

interface GlyphRun {
  readonly face: LoadedFace
  readonly text: string
}

/**
 * Splits a styled inline run into per-face glyph runs so mixed Latin, Hangul, CJK, and
 * monospace code blocks never replace valid characters with `?` when the first character's
 * face lacks coverage for later characters.
 */
function splitIntoFontRuns(
  text: string,
  families: readonly string[],
  bold: boolean,
  resolver: FaceResolver,
  fallbackFace: LoadedFace,
): { runs: GlyphRun[]; missing: number } {
  const runs: GlyphRun[] = []
  let missing = 0
  let currentFace: LoadedFace | null = null
  let buffer = ''

  const flush = () => {
    if (buffer && currentFace) {
      runs.push({ face: currentFace, text: buffer })
      buffer = ''
    }
  }

  for (const ch of text) {
    if (ch === '\n') {
      flush()
      runs.push({ face: currentFace ?? fallbackFace, text: '\n' })
      continue
    }
    const cp = ch.codePointAt(0) ?? 0x20
    if (cp === 0x09 || cp === 0x20 || cp === 0xa0) {
      if (!currentFace) {
        currentFace = resolver.choose(families, bold, 0x20)?.face ?? fallbackFace
      }
      buffer += ' '
      continue
    }
    if (cp < 0x20) continue

    const chosen = resolver.choose(families, bold, cp)
    const face = chosen?.face ?? fallbackFace
    const outChar = chosen ? ch : '?'
    if (!chosen) missing += 1

    if (currentFace && currentFace.spec.id !== face.spec.id) {
      flush()
    }
    currentFace = face
    buffer += outChar
  }
  flush()
  return { runs, missing }
}

interface MeasuredAtom {
  readonly face: LoadedFace
  readonly font: PDFFont
  readonly text: string
  readonly width: number
  readonly isBreak: boolean
  readonly isSpace: boolean
}

function isCjkCodePoint(cp: number): boolean {
  return (
    (cp >= 0xac00 && cp <= 0xd7af) || // Hangul syllables
    (cp >= 0x3130 && cp <= 0x318f) || // Hangul compatibility jamo
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0x3040 && cp <= 0x30ff) // Hiragana & Katakana
  )
}

/** Splits a font run into word/CJK tokens so English words wrap on spaces without O(n^2) measurement. */
function tokenizeForWrap(text: string): string[] {
  const tokens: string[] = []
  let buf = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0x20
    if (ch === ' ') {
      if (buf) {
        tokens.push(buf)
        buf = ''
      }
      tokens.push(' ')
    } else if (isCjkCodePoint(cp)) {
      if (buf) {
        tokens.push(buf)
        buf = ''
      }
      tokens.push(ch)
    } else {
      buf += ch
    }
  }
  if (buf) tokens.push(buf)
  return tokens
}

function measureSafeWidth(font: PDFFont, text: string, sizePt: number): number {
  try {
    return font.widthOfTextAtSize(text, sizePt)
  } catch {
    return text.length * sizePt * 0.55
  }
}

interface PlacedLinePiece {
  readonly font: PDFFont
  readonly text: string
  readonly width: number
}

function wrapAtomsIntoLines(
  atoms: readonly MeasuredAtom[],
  maxWidthPt: number,
  sizePt: number,
): PlacedLinePiece[][] {
  const lines: PlacedLinePiece[][] = []
  let current: PlacedLinePiece[] = []
  let lineWidth = 0

  const pushPiece = (font: PDFFont, text: string, width: number) => {
    const prev = current[current.length - 1]
    if (prev && prev.font === font) {
      current[current.length - 1] = { font, text: prev.text + text, width: prev.width + width }
    } else {
      current.push({ font, text, width })
    }
    lineWidth += width
  }

  const finishLine = () => {
    lines.push(current)
    current = []
    lineWidth = 0
  }

  for (const atom of atoms) {
    if (atom.isBreak) {
      finishLine()
      continue
    }
    if (atom.isSpace && current.length === 0) {
      continue
    }
    if (
      lineWidth + atom.width <= maxWidthPt ||
      (current.length === 0 && atom.width <= maxWidthPt)
    ) {
      pushPiece(atom.font, atom.text, atom.width)
      continue
    }
    if (current.length > 0) {
      finishLine()
      if (atom.isSpace) continue
    }
    if (atom.width <= maxWidthPt) {
      pushPiece(atom.font, atom.text, atom.width)
      continue
    }
    // Single token wider than the whole line (e.g. a long URL): split by character.
    for (const ch of atom.text) {
      const w = measureSafeWidth(atom.font, ch, sizePt)
      if (lineWidth + w > maxWidthPt && current.length > 0) {
        finishLine()
      }
      pushPiece(atom.font, ch, w)
    }
  }
  if (current.length > 0) lines.push(current)
  return lines
}

/**
 * Renders an HTML document into a multi-page A4 vector PDF using bundled fonts inside a
 * script-less `sandbox="allow-same-origin"` hidden iframe.
 */
export async function renderHtmlToPdfBytes(
  html: string,
  options: HtmlPdfOptions = {},
): Promise<HtmlPdfResult> {
  const faces = options.faces ? [...options.faces] : await getBundledFaces()
  const resolver = new FaceResolver(faces)
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(pdfLibFontkit as unknown as Parameters<PDFDocument['registerFontkit']>[0])
  if (options.title) pdf.setTitle(options.title)

  const embedded = new Map<string, PDFFont>()
  const getPdfFont = async (face: LoadedFace): Promise<PDFFont> => {
    let font = embedded.get(face.spec.id)
    if (!font) {
      font = await pdf.embedFont(face.bytes, { subset: true })
      embedded.set(face.spec.id, font)
    }
    return font
  }

  const contentWidthPt = A4_WIDTH_PT - DEFAULT_MARGIN_PT * 2
  const contentHeightPt = A4_HEIGHT_PT - DEFAULT_MARGIN_PT * 2
  const defaultFamilies = ['GenOffice Sans KR', 'Liberation Sans', 'sans-serif']
  const monoFamilies = ['Liberation Mono', 'GenOffice Sans KR', 'monospace']

  const safeHtml = stripScriptsForPrint(html)
  let missingGlyphs = 0
  let flowItems: FlowItem[] = []

  const fontUrls: string[] = []
  let iframe: HTMLIFrameElement | null = null
  try {
    if (typeof document !== 'undefined' && document.body) {
      iframe = document.createElement('iframe')
      iframe.setAttribute('sandbox', 'allow-same-origin')
      iframe.setAttribute('aria-hidden', 'true')
      iframe.tabIndex = -1
      iframe.style.cssText =
        'position:fixed;left:-30000px;top:0;width:720px;height:1024px;border:0;visibility:hidden;pointer-events:none'
      document.body.appendChild(iframe)

      const doc = iframe.contentDocument
      if (doc) {
        const css = fontFaceCss(faces, (face) => {
          const url = URL.createObjectURL(new Blob([face.bytes as BlobPart]))
          fontUrls.push(url)
          return url
        })
        const injected = /<head\b[^>]*>/i.test(safeHtml)
          ? safeHtml.replace(/<head\b[^>]*>/i, (match) => `${match}<style>${css}</style>`)
          : `<!DOCTYPE html><html><head><style>${css}</style></head><body>${safeHtml}</body></html>`
        doc.open()
        doc.write(injected)
        doc.close()
        if (doc.fonts?.ready) {
          await doc.fonts.ready.catch(() => {})
        }

        if (doc.body) {
          const bodyRect = doc.body.getBoundingClientRect()
          const hasRealLayout = Boolean(bodyRect && bodyRect.height > 0 && bodyRect.width > 0)
          flowItems = extractFlowItems(doc.body, doc.defaultView, hasRealLayout)
        }
      }
    }
  } finally {
    iframe?.remove()
    for (const url of fontUrls) URL.revokeObjectURL(url)
  }

  // Flow collected blocks, images, and rules onto paginated A4 PDF pages in document order.
  let page: PDFPage = pdf.addPage([A4_WIDTH_PT, A4_HEIGHT_PT])
  let cursorY = A4_HEIGHT_PT - DEFAULT_MARGIN_PT

  const ensureSpace = (neededPt: number) => {
    if (cursorY - neededPt < DEFAULT_MARGIN_PT) {
      page = pdf.addPage([A4_WIDTH_PT, A4_HEIGHT_PT])
      cursorY = A4_HEIGHT_PT - DEFAULT_MARGIN_PT
    }
  }

  for (const item of flowItems) {
    if (item.kind === 'hr') {
      ensureSpace(14)
      cursorY -= 7
      page.drawLine({
        start: { x: DEFAULT_MARGIN_PT, y: cursorY },
        end: { x: A4_WIDTH_PT - DEFAULT_MARGIN_PT, y: cursorY },
        thickness: 0.6,
        color: rgb(0.75, 0.77, 0.8),
      })
      cursorY -= 7
      continue
    }

    if (item.kind === 'image') {
      if (!item.src.startsWith('data:image/') && !item.src.startsWith('blob:')) continue
      try {
        const resp = await fetch(item.src)
        const buf = new Uint8Array(await resp.arrayBuffer())
        let embeddedImg: PDFImage
        if (buf[0] === 0x89 && buf[1] === 0x50) {
          embeddedImg = await pdf.embedPng(buf)
        } else if (buf[0] === 0xff && buf[1] === 0xd8) {
          embeddedImg = await pdf.embedJpg(buf)
        } else {
          continue
        }
        const scale = Math.min(
          contentWidthPt / Math.max(1, item.widthPx * PX_TO_PT),
          (contentHeightPt * 0.6) / Math.max(1, item.heightPx * PX_TO_PT),
          1,
        )
        const drawW = Math.max(24, item.widthPx * PX_TO_PT * scale)
        const drawH = Math.max(24, item.heightPx * PX_TO_PT * scale)
        ensureSpace(drawH + 10)
        cursorY -= drawH + 4
        page.drawImage(embeddedImg, {
          x: DEFAULT_MARGIN_PT,
          y: cursorY,
          width: drawW,
          height: drawH,
        })
        cursorY -= 6
      } catch {
        // Skip unreadable images rather than failing the whole export.
      }
      continue
    }

    // Block of inline runs: resolve per-character faces, tokenize for word wrap, and draw inline.
    const atoms: MeasuredAtom[] = []
    for (const run of item.runs) {
      const families = run.mono ? monoFamilies : defaultFamilies
      const { runs: glyphRuns, missing } = splitIntoFontRuns(
        run.text,
        families,
        run.bold,
        resolver,
        faces[0],
      )
      missingGlyphs += missing
      for (const gr of glyphRuns) {
        const font = await getPdfFont(gr.face)
        if (gr.text === '\n') {
          atoms.push({ face: gr.face, font, text: '\n', width: 0, isBreak: true, isSpace: false })
          continue
        }
        const tokens = item.isCodeBlock ? [...gr.text] : tokenizeForWrap(gr.text)
        for (const token of tokens) {
          atoms.push({
            face: gr.face,
            font,
            text: token,
            width: measureSafeWidth(font, token, item.fontSizePt),
            isBreak: false,
            isSpace: !item.isCodeBlock && token === ' ',
          })
        }
      }
    }

    const lineHeight = item.fontSizePt * 1.45
    const maxLineWidth = Math.max(80, contentWidthPt - item.indentPt)
    const wrappedLines = wrapAtomsIntoLines(atoms, maxLineWidth, item.fontSizePt)

    if (item.isHeading) cursorY -= 4
    for (const line of wrappedLines) {
      ensureSpace(lineHeight)
      cursorY -= lineHeight
      let drawX = DEFAULT_MARGIN_PT + item.indentPt
      for (const piece of line) {
        page.drawText(piece.text, {
          x: drawX,
          y: cursorY,
          size: item.fontSizePt,
          font: piece.font,
          color: rgb(0.08, 0.08, 0.08),
        })
        drawX += piece.width
      }
    }
    cursorY -= item.isHeading ? 6 : 4
  }

  const bytes = await pdf.save()
  return { bytes, pageCount: pdf.getPageCount(), missingGlyphs }
}

/** Assembles pre-rendered raster page images (HWP, PPTX) into a multi-page PDF. */
export async function assembleImagesToPdf(
  pages: readonly RasterPdfPageInput[],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  for (const item of pages) {
    const width = Math.max(72, item.widthPt || A4_WIDTH_PT)
    const height = Math.max(72, item.heightPt || A4_HEIGHT_PT)
    const page = pdf.addPage([width, height])
    const image =
      item.mime === 'image/png' ? await pdf.embedPng(item.bytes) : await pdf.embedJpg(item.bytes)
    page.drawImage(image, { x: 0, y: 0, width, height })
  }
  if (pdf.getPageCount() === 0) {
    pdf.addPage([A4_WIDTH_PT, A4_HEIGHT_PT])
  }
  return pdf.save()
}

function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = []
  const step = 0x6000 * 3
  for (let i = 0; i < bytes.length; i += step) {
    const chunk = bytes.subarray(i, i + step)
    let bin = ''
    for (let j = 0; j < chunk.length; j += 0x2000) {
      bin += String.fromCharCode(...chunk.subarray(j, j + 0x2000))
    }
    parts.push(btoa(bin))
  }
  return parts.join('')
}

/**
 * Builds inline `@font-face` CSS containing only the bundled faces referenced by `svg`
 * (or the core sans/serif faces as fallback). Uses a caller-scoped cache so multi-MB
 * base64 strings are garbage-collected as soon as the export completes.
 */
async function getInlineFontFaceCssForSvg(
  svg: string,
  cache?: Map<string, string>,
): Promise<string> {
  try {
    const faces = await getBundledFaces()
    const lowerSvg = svg.toLowerCase()
    const matched = faces.filter((face) =>
      face.spec.families.some((fam) => lowerSvg.includes(fam.toLowerCase())),
    )
    const chosen =
      matched.length > 0
        ? matched
        : faces.filter(
            (f) =>
              !f.spec.bold && f.spec.families.some((fam) => /sans|serif|gothic|malgun/i.test(fam)),
          )
    const finalFaces = chosen.length > 0 ? chosen : faces.slice(0, 2)
    const key = finalFaces.map((f) => f.spec.id).join('|')
    const hit = cache?.get(key)
    if (hit !== undefined) return hit
    const css = fontFaceCss(
      finalFaces,
      (face) => `data:font/ttf;base64,${bytesToBase64(face.bytes)}`,
    )
    cache?.set(key, css)
    return css
  } catch {
    return ''
  }
}

/** Restores deduplicated `ieum-image:N` references inside an HWP print page SVG. */
export function expandSharedSvgImages(svg: string, images: readonly string[]): string {
  return svg.replace(/\bhref="ieum-image:(\d+)"/g, (whole, idxText: string) => {
    const dataUrl = images[Number(idxText)]
    return dataUrl ? `href="${dataUrl}"` : whole
  })
}

/** Injects inline bundled `@font-face` CSS into an SVG so WebView `<img>` rasterization keeps fonts. */
export function injectSvgFonts(svg: string, css: string): string {
  if (!css) return svg
  const styleBlock = `<defs><style type="text/css"><![CDATA[${css}]]></style></defs>`
  const openTagEnd = svg.indexOf('>')
  if (openTagEnd < 0) return svg
  return `${svg.slice(0, openTagEnd + 1)}${styleBlock}${svg.slice(openTagEnd + 1)}`
}

/**
 * Rasterizes an HWP print-page SVG onto an offscreen canvas (capped to `MAX_RASTER_PIXELS`)
 * with adaptive scale/quality for long documents so 50+ page HWP files stay under the 32 MiB
 * mobile print cap, and releases canvas memory immediately after encoding JPEG bytes.
 */
export async function renderSvgPageToJpeg(
  svg: string,
  widthPx: number,
  heightPx: number,
  images: readonly string[] = [],
  options: SvgRasterOptions = {},
): Promise<RasterPdfPageInput> {
  const safeW = Math.max(100, widthPx || 794)
  const safeH = Math.max(100, heightPx || 1123)
  const widthPt = safeW * PX_TO_PT
  const heightPt = safeH * PX_TO_PT

  const pageCount = options.pageCount ?? 1
  const desiredScale = pageCount > 50 ? 1.2 : pageCount > 20 ? 1.5 : 2
  const quality = pageCount > 50 ? 0.72 : pageCount > 20 ? 0.8 : 0.88
  const maxScale = Math.sqrt(MAX_RASTER_PIXELS / (safeW * safeH))
  const scale = Math.max(1, Math.min(desiredScale, maxScale))
  const pixelW = Math.max(1, Math.round(safeW * scale))
  const pixelH = Math.max(1, Math.round(safeH * scale))

  const expandedSvg = expandSharedSvgImages(svg, images)
  const inlineCss = await getInlineFontFaceCssForSvg(expandedSvg, options.fontCssCache)
  const fullSvg = injectSvgFonts(expandedSvg, inlineCss)
  const blob = new Blob([fullSvg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const canvas = document.createElement('canvas')
  canvas.width = pixelW
  canvas.height = pixelH
  try {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, pixelW, pixelH)

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Failed to decode SVG page image'))
      el.src = url
    })
    ctx.drawImage(img, 0, 0, pixelW, pixelH)

    const jpegBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    )
    if (!jpegBlob) throw new Error('Failed to encode SVG page JPEG')
    const bytes = new Uint8Array(await jpegBlob.arrayBuffer())
    return { bytes, mime: 'image/jpeg', widthPt, heightPt }
  } finally {
    canvas.width = 0
    canvas.height = 0
    URL.revokeObjectURL(url)
  }
}
