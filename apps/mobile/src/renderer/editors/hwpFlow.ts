/**
 * HWP flow (reading) view: rebuilds the document as HTML that reflows to the
 * screen width (design system 5.3, decision 0165).
 *
 * The rhwp engine has no reflow layout, but it can export a paragraph range as
 * HTML (the copy format) and each table or picture as HTML. The flow view puts
 * them together paragraph by paragraph.
 *
 * Every text block carries its engine address so edits can go back to the
 * engine at the same place:
 * - a body paragraph: `.flow-p[data-sec][data-para]`
 * - a paragraph inside a table cell (any depth): the same plus `data-path`, the
 *   engine's cell path `[{controlIndex, cellIndex, cellParaIndex}, ...]` from the
 *   body paragraph down to that cell paragraph.
 *
 * Tables keep the engine's own skeleton (borders, widths, fills, merged cells);
 * each cell's contents are rebuilt paragraph by paragraph, because the exported
 * table HTML drops empty paragraphs and so cannot be mapped back.
 */

/** One step of an engine cell path. */
export interface CellStep {
  readonly controlIndex: number
  readonly cellIndex?: number
  readonly cellParaIndex?: number
}

/** The part of the rhwp `HwpDocument` API the flow builder needs. */
export interface FlowSourceDocument {
  getSectionCount(): number
  getParagraphCount(sectionIdx: number): number
  getParagraphLength(sectionIdx: number, paraIdx: number): number
  getControlTextPositions(sectionIdx: number, paraIdx: number): string
  exportSelectionHtml(
    sectionIdx: number,
    startPara: number,
    startOffset: number,
    endPara: number,
    endOffset: number,
  ): string
  exportControlHtml(
    sectionIdx: number,
    paraIdx: number,
    cellPathJson: string,
    controlIdx: number,
  ): string
  getParaPropertiesAt(sectionIdx: number, paraIdx: number): string
  getCellParaPropertiesAtByPath(sectionIdx: number, paraIdx: number, pathJson: string): string
  getBulletList(): string
  getFootnoteInfo(sectionIdx: number, paraIdx: number, controlIdx: number): string
  getHeaderFooter(sectionIdx: number, isHeader: boolean, applyTo: number): string
  /** Number text of a numbered paragraph (patch 0057); '' when it has none. */
  getParagraphHeadText?(sectionIdx: number, paraIdx: number, cellPathJson: string): string
  getCellParagraphCountByPath(sectionIdx: number, paraIdx: number, pathJson: string): number
  getCellParagraphLengthByPath(sectionIdx: number, paraIdx: number, pathJson: string): number
  exportSelectionInCellHtmlByPath(
    sectionIdx: number,
    paraIdx: number,
    pathJson: string,
    startCellPara: number,
    startOffset: number,
    endCellPara: number,
    endOffset: number,
  ): string
  getTableProperties(sectionIdx: number, paraIdx: number, controlIdx: number): string
  /** Cell properties (true border types/widths, fills, dimensions) for a body-level table cell. */
  getCellProperties?(
    sectionIdx: number,
    paraIdx: number,
    controlIdx: number,
    cellIdx: number,
  ): string
  /** Cell properties for a nested table cell. */
  getCellPropertiesByPath?(
    sectionIdx: number,
    paraIdx: number,
    cellPathJson: string,
    cellIdx: number,
  ): string
  /** Shape properties (fill color, border color, size) for a body-level text box/shape. */
  getShapeProperties?(sectionIdx: number, paraIdx: number, controlIdx: number): string
  /** Shape properties for a shape inside a table cell. */
  getCellShapePropertiesByPath?(
    sectionIdx: number,
    paraIdx: number,
    cellPathJson: string,
    controlIdx: number,
  ): string
  getCellParagraphCount(
    sectionIdx: number,
    paraIdx: number,
    controlIdx: number,
    cellIdx: number,
  ): number
  getCellParagraphLength(
    sectionIdx: number,
    paraIdx: number,
    controlIdx: number,
    cellIdx: number,
    cellParaIdx: number,
  ): number
  getTextInCell(
    sectionIdx: number,
    paraIdx: number,
    controlIdx: number,
    cellIdx: number,
    cellParaIdx: number,
    offset: number,
    count: number,
  ): string
  getCellParaPropertiesAt(
    sectionIdx: number,
    paraIdx: number,
    controlIdx: number,
    cellIdx: number,
    cellParaIdx: number,
  ): string
  getCellCharPropertiesAt(
    sectionIdx: number,
    paraIdx: number,
    controlIdx: number,
    cellIdx: number,
    cellParaIdx: number,
    offset: number,
  ): string
}

/** Cell number the engine's flat cell calls use for a table's caption. */
export const TABLE_CAPTION_CELL = 65534

/**
 * A one-step path (a cell of a body-level table, a text box, a caption) as the
 * flat cell call arguments. Those calls are the only ones that reach table
 * captions and that split or join paragraphs in text boxes and captions; the
 * path calls handle only table cells there. Deeper paths return null.
 */
export function flatStep(
  path: readonly CellStep[],
): { ctrl: number; cell: number; cellPara: number } | null {
  if (path.length !== 1) return null
  const [step] = path
  return { ctrl: step.controlIndex, cell: step.cellIndex ?? 0, cellPara: step.cellParaIndex ?? 0 }
}

/** Number of paragraphs in the cell, caption or text box that `list` points to. */
export function listParagraphCount(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  list: readonly CellStep[],
): number {
  const flat = flatStep(list)
  return flat
    ? doc.getCellParagraphCount(sec, para, flat.ctrl, flat.cell)
    : doc.getCellParagraphCountByPath(sec, para, JSON.stringify(cellParaPath(list, 0)))
}

/** Length of the paragraph `path` points to inside a cell, caption or text box. */
export function listParagraphLength(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  path: readonly CellStep[],
): number {
  const flat = flatStep(path)
  return flat
    ? doc.getCellParagraphLength(sec, para, flat.ctrl, flat.cell, flat.cellPara)
    : doc.getCellParagraphLengthByPath(sec, para, JSON.stringify(path))
}

/** Keeps only what sits between the clipboard fragment markers. */
export function stripClipboardFragment(html: string): string {
  const start = html.indexOf('<!--StartFragment-->')
  const end = html.indexOf('<!--EndFragment-->')
  if (start < 0 || end < start) return html
  return html.slice(start + '<!--StartFragment-->'.length, end).trim()
}

function controlCount(positionsJson: string): number {
  try {
    const parsed: unknown = JSON.parse(positionsJson)
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

/** Path to a paragraph inside a cell: the cell path with that paragraph's index. */
export function cellParaPath(cell: readonly CellStep[], cellParaIndex: number): CellStep[] {
  const last = cell[cell.length - 1]
  return [...cell.slice(0, -1), { ...last, cellParaIndex }]
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/'/g, '&#39;')
}

function blockDiv(sec: number, para: number, path: readonly CellStep[] | null, inner: string) {
  const pathAttr = path ? ` data-path='${escapeAttr(JSON.stringify(path))}'` : ''
  return `<div class="flow-p" data-sec="${sec}" data-para="${para}"${pathAttr}>${inner || '<p><br></p>'}</div>`
}

/** Private-use bullet glyphs need the document's symbol font; show a plain bullet instead. */
const FALLBACK_BULLET = '•'

const bulletCache = new WeakMap<FlowSourceDocument, Map<number, string>>()

function bulletChar(doc: FlowSourceDocument, id: number): string {
  let bullets = bulletCache.get(doc)
  if (!bullets) {
    bullets = new Map()
    try {
      const list = JSON.parse(doc.getBulletList()) as { id: number; char: string }[]
      for (const b of list) {
        const code = b.char.codePointAt(0) ?? 0
        const usable = b.char.trim() !== '' && !(code >= 0xe000 && code <= 0xf8ff)
        bullets.set(b.id, usable ? b.char : FALLBACK_BULLET)
      }
    } catch {
      // no bullet table: every bullet paragraph gets the plain bullet
    }
    bulletCache.set(doc, bullets)
  }
  return bullets.get(id) ?? FALLBACK_BULLET
}

/**
 * The bullet or automatic number (1., 가., ①) shown before a paragraph, or ''.
 *
 * The engine works numbers out in document order while laying out pages, so
 * the number text comes from the engine (`getParagraphHeadText`, patch 0057);
 * an engine without that call shows no numbers.
 */
function paragraphMarker(
  doc: FlowSourceDocument,
  propsJson: () => string,
  sec: number,
  para: number,
  path: readonly CellStep[] | null,
): ParagraphMarker {
  try {
    const props = JSON.parse(propsJson()) as { headType?: string; numberingId?: number }
    if (props.headType === 'Bullet') {
      return { text: bulletChar(doc, props.numberingId ?? 0), numbered: false }
    }
    if (props.headType === 'Number' || props.headType === 'Outline') {
      return { text: paragraphNumber(doc, sec, para, path), numbered: true }
    }
  } catch {
    // no properties: no marker
  }
  return NO_MARKER
}

interface ParagraphMarker {
  readonly text: string
  /** An automatic number, which changes when paragraphs before it are added or removed. */
  readonly numbered: boolean
}

const NO_MARKER: ParagraphMarker = { text: '', numbered: false }

/** Current number text of a numbered paragraph, or '' (also on an engine without the call). */
export function paragraphNumber(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  path: readonly CellStep[] | null,
): string {
  try {
    return doc.getParagraphHeadText?.(sec, para, JSON.stringify(path ?? [])) ?? ''
  } catch {
    return ''
  }
}

/**
 * Puts the bullet on the paragraph's first line. It is drawn by CSS
 * (`data-marker`), so it never becomes part of the editable text.
 */
function withMarker(html: string, marker: ParagraphMarker): string {
  if (!marker.text) return html
  // numbers shift when paragraphs are added or removed; the editor refreshes `data-number` ones
  const attr = ` data-marker="${escapeAttr(marker.text).replace(/"/g, '&quot;')}"${marker.numbered ? ' data-number' : ''}`
  if (!html) return `<p${attr}><br></p>`
  if (!/<p[\s>]/.test(html)) return html
  // the marker takes the font of the paragraph's first text run (the text sits in spans)
  const vars = markerFontVars(html)
  if (vars && /<p\s[^>]*style="/.test(html)) {
    return html.replace(/<p(\s[^>]*?)style="/, `<p${attr}$1style="${vars}`)
  }
  return html.replace(/<p(?=[\s>])/, vars ? `<p${attr} style="${vars}"` : `<p${attr}`)
}

/** `--marker-font` / `--marker-size` taken from the first styled span, or ''. */
function markerFontVars(html: string): string {
  const style = /<span[^>]*\sstyle="([^"]*)"/.exec(html)?.[1]
  if (!style) return ''
  const family = /font-family:([^;]+)/.exec(style)?.[1]?.trim()
  const size = /font-size:([^;]+)/.exec(style)?.[1]?.trim()
  return `${family ? `--marker-font:${family};` : ''}${size ? `--marker-size:${size};` : ''}`
}

const MAX_BODY_MARGIN_LEFT_PX = 48
const MAX_BODY_MARGIN_RIGHT_PX = 32
const MAX_BODY_INDENT_PX = 36
const MAX_CELL_MARGIN_LEFT_PX = 20
const MAX_CELL_MARGIN_RIGHT_PX = 12
const MAX_CELL_INDENT_PX = 16

const MIN_BODY_LINE_HEIGHT = 1.35
const MAX_BODY_LINE_HEIGHT = 2.0
const MIN_CELL_LINE_HEIGHT = 1.25
const MAX_CELL_LINE_HEIGHT = 1.8

const MIN_BODY_FONT_PT = 8.5
const MAX_BODY_FONT_PT = 22
const MIN_CELL_FONT_PT = 8
const MAX_CELL_FONT_PT = 20
const DEFAULT_SPAN_FONT_PX = 10 * (96 / 72)

/**
 * HWP `charSpacing` is in percent of 0.5em, while rhwp's clipboard HTML emits
 * `fontSizePx * (spacing / 100)` (2x too large). In a reflowing view, aggressive
 * negative tracking used for A4 line-fitting crushes glyphs; keep subtle intent
 * within safe reflow bounds.
 */
const HWP_LETTER_SPACING_SCALE = 0.5
const MIN_LETTER_SPACING_EM = -0.02
const MAX_LETTER_SPACING_EM = 0.12
const LETTER_SPACING_EPSILON_EM = 0.005

const MIN_FONT_STRETCH_PCT = 85
const MAX_FONT_STRETCH_PCT = 115

function parseCssLengthPx(raw: string): number | null {
  const m = /^\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(px|pt|em|rem|mm|cm|in)?\s*$/i.exec(raw)
  if (!m) return null
  const value = Number(m[1])
  if (!Number.isFinite(value)) return null
  const unit = (m[2] ?? '').toLowerCase()
  if (unit === '' && value === 0) return 0
  if (unit === 'px') return value
  if (unit === 'pt') return value * (96 / 72)
  if (unit === 'em' || unit === 'rem') return value * 16
  if (unit === 'mm') return value * (96 / 25.4)
  if (unit === 'cm') return value * (96 / 2.54)
  if (unit === 'in') return value * 96
  return null
}

function parseCssLengthPt(raw: string): number | null {
  const px = parseCssLengthPx(raw)
  if (px === null) return null
  return px * (72 / 96)
}

function formatNumber(value: number, decimals = 1): string {
  const factor = 10 ** decimals
  const rounded = Math.round(value * factor) / factor
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

function formatPx(value: number): string {
  return `${formatNumber(value, 1)}px`
}

function normalizeLineHeight(raw: string, inCell: boolean): string | null {
  const minLh = inCell ? MIN_CELL_LINE_HEIGHT : MIN_BODY_LINE_HEIGHT
  const maxLh = inCell ? MAX_CELL_LINE_HEIGHT : MAX_BODY_LINE_HEIGHT
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed || trimmed === 'normal') return null

  const pct = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))%$/.exec(trimmed)
  if (pct) {
    const ratio = Number(pct[1]) / 100
    if (!Number.isFinite(ratio) || ratio <= 0) return null
    const clamped = Math.min(Math.max(ratio, minLh), maxLh)
    return `${Math.round(clamped * 100)}%`
  }

  const unitless = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))$/.exec(trimmed)
  if (unitless) {
    const ratio = Number(unitless[1])
    if (!Number.isFinite(ratio) || ratio <= 0) return null
    const clamped = Math.min(Math.max(ratio, minLh), maxLh)
    return formatNumber(clamped, 2)
  }

  // Fixed px/pt line-heights collide on reflowed multi-line text when font size or zoom changes.
  const px = parseCssLengthPx(trimmed)
  if (px !== null) {
    return `${Math.round(minLh * 100)}%`
  }

  return trimmed
}

const GENERIC_FONT_RE = /\b(?:serif|sans-serif|monospace|cursive|fantasy|system-ui)\s*$/i
const MONO_FONT_RE = /고정폭|consolas|courier|mono|menlo|monaco/i

/**
 * Cleans malformed comma-joined HWP font names (e.g. `'T8,한컴바탕'`) and ensures
 * a generic fallback (`monospace` or `sans-serif`) so missing proprietary HWP
 * fonts fall back cleanly with clear bold contrast on mobile and desktop.
 */
export function normalizeFlowFontFamily(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  const cleaned = trimmed.replace(/'([^']*?,[^']*?)'/g, (_full, inner: string) =>
    inner
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => `'${s}'`)
      .join(','),
  )
  if (GENERIC_FONT_RE.test(cleaned)) return cleaned
  const fallback = MONO_FONT_RE.test(cleaned) ? 'monospace' : 'sans-serif'
  return `${cleaned},${fallback}`
}

/**
 * Normalizes inline `<span>` styles emitted by rhwp's HTML export for readable
 * mobile reflow:
 * - Converts `letter-spacing` to font-relative `em` with HWP's 0.5x half-em unit
 *   correction and clamps to `[-0.02em, +0.12em]` so negative A4 tracking never
 *   crushes bold or Latin glyphs.
 * - Clamps `font-size` to readable mobile bounds while keeping document hierarchy.
 * - Strips inline `transform` (`scaleX` width distortion overlaps CSS text) and
 *   clamps `font-stretch` to `[85%, 115%]`.
 * - Appends generic font fallbacks (`serif` / `sans-serif` / `monospace`).
 * - Preserves document colors, weights, and text decorations as authored.
 */
function normalizeFlowSpanStyle(style: string, inCell: boolean): string {
  const minPt = inCell ? MIN_CELL_FONT_PT : MIN_BODY_FONT_PT
  const maxPt = inCell ? MAX_CELL_FONT_PT : MAX_BODY_FONT_PT

  const entries: Array<{ prop: string; val: string; raw: string }> = []
  let rawFontPx = DEFAULT_SPAN_FONT_PX

  for (const part of style.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const colon = trimmed.indexOf(':')
    if (colon < 0) {
      entries.push({ prop: '', val: '', raw: trimmed })
      continue
    }
    const prop = trimmed.slice(0, colon).trim().toLowerCase()
    const val = trimmed.slice(colon + 1).trim()
    if (prop === 'font-size') {
      const px = parseCssLengthPx(val)
      if (px !== null && px > 0) rawFontPx = px
    }
    entries.push({ prop, val, raw: trimmed })
  }

  const out: string[] = []
  for (const entry of entries) {
    if (!entry.prop) {
      out.push(entry.raw)
      continue
    }
    if (entry.prop === 'letter-spacing') {
      const emMatch = /^\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*em\s*$/i.exec(entry.val)
      let emVal: number | null = null
      if (emMatch) {
        emVal = Number(emMatch[1])
      } else {
        const px = parseCssLengthPx(entry.val)
        if (px !== null) {
          emVal = (px / rawFontPx) * HWP_LETTER_SPACING_SCALE
        }
      }
      if (emVal !== null && Number.isFinite(emVal)) {
        const clamped = Math.min(Math.max(emVal, MIN_LETTER_SPACING_EM), MAX_LETTER_SPACING_EM)
        if (Math.abs(clamped) >= LETTER_SPACING_EPSILON_EM) {
          out.push(`letter-spacing:${formatNumber(clamped, 3)}em`)
        }
      }
      continue
    }
    if (entry.prop === 'font-size') {
      const pt = parseCssLengthPt(entry.val)
      if (pt !== null && pt > 0) {
        const clamped = Math.min(Math.max(pt, minPt), maxPt)
        out.push(`font-size:${formatNumber(clamped, 1)}pt`)
        continue
      }
    }
    if (entry.prop === 'font-family') {
      out.push(`font-family:${normalizeFlowFontFamily(entry.val)}`)
      continue
    }
    if (entry.prop === 'transform') {
      // Drop inline scaleX transforms (charRatio hacks) that overlap adjacent runs in CSS flow.
      continue
    }
    if (entry.prop === 'font-stretch') {
      const pct = /^\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))%\s*$/.exec(entry.val)
      if (pct) {
        const clamped = Math.min(
          Math.max(Number(pct[1]), MIN_FONT_STRETCH_PCT),
          MAX_FONT_STRETCH_PCT,
        )
        out.push(`font-stretch:${formatNumber(clamped, 0)}%`)
      }
      continue
    }
    out.push(entry.raw)
  }

  return out.length > 0 ? `${out.join(';')};` : ''
}

/**
 * Normalizes rhwp paragraph and inline span styles for reflowing mobile reading.
 *
 * - Paragraph alignment: converts `justify` / `distribute` / `justify-all` to
 *   `left` (CSS inter-word justification with `word-break: keep-all` creates wide
 *   word rivers on narrow viewports) while preserving `center` and `right`.
 * - Hanging indents & side margins: guarantees `margin-left + text-indent >= 0`
 *   within mobile bounds, and strips leftover indents on centered/right-aligned
 *   paragraphs so headings stay centered.
 * - Line height: clamps tight (`100%`) or excessive values to readable bounds.
 * - Inline runs: converts rhwp's 2x pixel `letter-spacing` to clamped `em`,
 *   clamps extreme `font-size`, strips overlapping `transform`, and appends
 *   generic font fallbacks.
 */
export function normalizeFlowParagraphStyle(html: string, inCell = false): string {
  if (!html) return html
  const maxLeft = inCell ? MAX_CELL_MARGIN_LEFT_PX : MAX_BODY_MARGIN_LEFT_PX
  const maxRight = inCell ? MAX_CELL_MARGIN_RIGHT_PX : MAX_BODY_MARGIN_RIGHT_PX
  const maxIndent = inCell ? MAX_CELL_INDENT_PX : MAX_BODY_INDENT_PX

  let result = html.replace(
    /<p\b([^>]*)\bstyle="([^"]*)"([^>]*)>/gi,
    (_full, before: string, style: string, after: string) => {
      let rawLeft = 0
      let rawRight = 0
      let rawIndent = 0
      let align = ''
      const kept: string[] = []

      for (const part of String(style).split(';')) {
        const trimmed = part.trim()
        if (!trimmed) continue
        const colon = trimmed.indexOf(':')
        if (colon < 0) {
          kept.push(trimmed)
          continue
        }
        const prop = trimmed.slice(0, colon).trim().toLowerCase()
        const val = trimmed.slice(colon + 1).trim()
        if (prop === 'margin-left') {
          const px = parseCssLengthPx(val)
          if (px !== null) {
            rawLeft = px
            continue
          }
        } else if (prop === 'margin-right') {
          const px = parseCssLengthPx(val)
          if (px !== null) {
            rawRight = px
            continue
          }
        } else if (prop === 'text-indent') {
          const px = parseCssLengthPx(val)
          if (px !== null) {
            rawIndent = px
            continue
          }
        } else if (prop === 'text-align') {
          const low = val.toLowerCase()
          if (low === 'justify' || low === 'distribute' || low === 'justify-all') {
            align = 'left'
            kept.push('text-align:left')
          } else {
            align = low
            kept.push(`text-align:${low}`)
          }
          continue
        } else if (prop === 'text-align-last') {
          continue
        } else if (prop === 'line-height') {
          const norm = normalizeLineHeight(val, inCell)
          if (norm) kept.push(`line-height:${norm}`)
          continue
        }
        kept.push(trimmed)
      }

      const centeredOrRight = align === 'center' || align === 'right'
      if (!centeredOrRight) {
        const baseLeft = Math.min(Math.max(0, rawLeft), maxLeft)
        const effectiveRight = Math.min(Math.max(0, rawRight), maxRight)
        let effectiveLeft = baseLeft
        let effectiveIndent = 0
        if (rawIndent < 0) {
          const hang = Math.min(-rawIndent, maxIndent)
          effectiveLeft = Math.max(baseLeft, hang)
          effectiveIndent = -hang
        } else if (rawIndent > 0) {
          effectiveIndent = Math.min(rawIndent, maxIndent)
        }

        if (effectiveLeft > 0) kept.push(`margin-left:${formatPx(effectiveLeft)}`)
        if (effectiveRight > 0) kept.push(`margin-right:${formatPx(effectiveRight)}`)
        if (effectiveIndent !== 0) kept.push(`text-indent:${formatPx(effectiveIndent)}`)
      }

      return kept.length > 0
        ? `<p${before}style="${kept.join(';')};"${after}>`
        : `<p${before}${after}>`
    },
  )

  result = result.replace(
    /<span\b([^>]*)\bstyle="([^"]*)"([^>]*)>/gi,
    (_full, before: string, style: string, after: string) => {
      const next = normalizeFlowSpanStyle(String(style), inCell)
      return next ? `<span${before}style="${next}"${after}>` : `<span${before}${after}>`
    },
  )

  return result
}

const HWP_BORDER_WIDTH_MM = [
  0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0,
] as const

/** HWP border side properties returned by `getCellProperties` / `getCellPropertiesByPath`. */
export interface EngineCellBorder {
  readonly type?: number
  readonly width?: number
  readonly color?: string
}

export interface EngineCellProps {
  readonly width?: number
  readonly height?: number
  readonly verticalAlign?: number
  readonly borderLeft?: EngineCellBorder
  readonly borderRight?: EngineCellBorder
  readonly borderTop?: EngineCellBorder
  readonly borderBottom?: EngineCellBorder
  readonly fillType?: string
  readonly fillColor?: string
}

function hwpBorderCssStyle(type: number): 'solid' | 'dashed' | 'dotted' | 'double' | null {
  if (!Number.isInteger(type) || type <= 0) return null
  if (type === 1) return 'solid'
  if (type === 3) return 'dotted'
  if (type >= 8 && type <= 11) return 'double'
  return 'dashed'
}

function hwpBorderCssWidthPx(
  code: number,
  cssStyle: 'solid' | 'dashed' | 'dotted' | 'double',
): number {
  const mm =
    Number.isInteger(code) && code >= 0 && code < HWP_BORDER_WIDTH_MM.length
      ? HWP_BORDER_WIDTH_MM[code]
      : 0.12
  const px = Math.max(1, Math.round(mm * (96 / 25.4) * 10) / 10)
  // CSS `double` needs at least 3px to draw two distinct strokes.
  return cssStyle === 'double' ? Math.max(3, px) : px
}

/**
 * Builds accurate CSS declarations for a table cell from engine properties.
 * rhwp's clipboard HTML emits solid borders even when `border.type === 0` (NONE);
 * reading the engine's real border types eliminates phantom borders on cover
 * pages, section title banners, and reference callout boxes.
 */
export function cellStyleFromEngineProps(props: EngineCellProps): string {
  const rules: string[] = []
  const sides: ReadonlyArray<readonly [string, EngineCellBorder | undefined]> = [
    ['border-left', props.borderLeft],
    ['border-right', props.borderRight],
    ['border-top', props.borderTop],
    ['border-bottom', props.borderBottom],
  ]
  for (const [cssProp, border] of sides) {
    if (!border) continue
    const style = hwpBorderCssStyle(border.type ?? 0)
    if (!style) continue
    const widthPx = hwpBorderCssWidthPx(border.width ?? 1, style)
    const color =
      typeof border.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(border.color.trim())
        ? border.color.trim()
        : '#000000'
    rules.push(`${cssProp}:${widthPx}px ${style} ${color}`)
  }

  if (
    props.fillType === 'solid' &&
    typeof props.fillColor === 'string' &&
    /^#[0-9a-f]{3,8}$/i.test(props.fillColor.trim())
  ) {
    rules.push(`background-color:${props.fillColor.trim()}`)
  }

  const vAlign = props.verticalAlign === 1 ? 'middle' : props.verticalAlign === 2 ? 'bottom' : 'top'
  rules.push(`vertical-align:${vAlign}`)
  return `${rules.join(';')};`
}

/** True when an engine cell has at least one visible border side (`type > 0`). */
function hasVisibleEngineBorder(props: EngineCellProps | null): boolean {
  if (!props) return false
  return [props.borderLeft, props.borderRight, props.borderTop, props.borderBottom].some(
    (b) => (b?.type ?? 0) > 0,
  )
}

/** Accent color for a thin gradient divider cell (e.g. cover page horizontal bars). */
function gradientBarColor(props: EngineCellProps): string {
  for (const b of [props.borderTop, props.borderBottom, props.borderLeft, props.borderRight]) {
    const c = b?.color?.trim()
    if (c && /^#[0-9a-f]{3,8}$/i.test(c) && !/^#(?:000000|ffffff|000|fff)$/i.test(c)) {
      return c
    }
  }
  return '#2b5ce6'
}

/**
 * Converts rhwp clipboard HTML table border widths (which emit HWP's 0..15
 * line-width code directly as `N.0px`, e.g. 0.4mm code 6 as `6.0px`) into
 * CSS pixels matching the real millimeter stroke width.
 */
export function normalizeClipboardBorderWidths(style: string): string {
  return style.replace(
    /\b(border-(?:left|right|top|bottom)\s*:\s*)(\d+)\.0px\b/gi,
    (full, prefix: string, rawCode: string) => {
      const code = Number(rawCode)
      if (!Number.isInteger(code) || code < 0 || code >= HWP_BORDER_WIDTH_MM.length) return full
      const px = Math.max(1, Math.round(HWP_BORDER_WIDTH_MM[code] * (96 / 25.4) * 10) / 10)
      return `${prefix}${px}px`
    },
  )
}

/**
 * Removes control HTML (`<table>`, `<img>`, rhwp comments) appended after
 * `<p>` by `exportSelectionInCellHtmlByPath`. `renderCellContents` renders
 * each control explicitly right after the paragraph so cells stay addressable.
 */
function stripAppendedControls(html: string): string {
  if (!html || !/<(?:table|img)\b|<!--/i.test(html)) return html
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  for (const child of [...parsed.body.childNodes]) {
    if (child.nodeType === 8) {
      child.remove()
    } else if (child.nodeType === 1) {
      const tag = (child as Element).tagName
      if (tag === 'TABLE' || tag === 'IMG') child.remove()
    }
  }
  return parsed.body.innerHTML.trim()
}

/** HTML of one body paragraph's text. */
export function bodyParagraphHtml(doc: FlowSourceDocument, sec: number, para: number): string {
  const length = doc.getParagraphLength(sec, para)
  const html =
    length > 0
      ? normalizeFlowParagraphStyle(
          stripClipboardFragment(doc.exportSelectionHtml(sec, para, 0, para, length)),
          false,
        )
      : ''
  return withMarker(
    html,
    paragraphMarker(doc, () => doc.getParaPropertiesAt(sec, para), sec, para, null),
  )
}

/** HTML of one cell paragraph's text (`path` ends at that paragraph). */
export function cellParagraphHtml(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  path: readonly CellStep[],
): string {
  const json = JSON.stringify(path)
  const flat = flatStep(path)
  const length = listParagraphLength(doc, sec, para, path)
  const k = path[path.length - 1].cellParaIndex ?? 0
  const props = () =>
    flat
      ? doc.getCellParaPropertiesAt(sec, para, flat.ctrl, flat.cell, flat.cellPara)
      : doc.getCellParaPropertiesAtByPath(sec, para, json)
  let html = ''
  if (flat && flat.cell === TABLE_CAPTION_CELL) {
    // the engine cannot export a table caption as HTML: show its text with its alignment
    html = captionTextHtml(doc, sec, para, flat, length, props)
  } else if (length > 0) {
    html = normalizeFlowParagraphStyle(
      stripAppendedControls(
        stripClipboardFragment(
          doc.exportSelectionInCellHtmlByPath(sec, para, json, k, 0, k, length),
        ),
      ),
      true,
    )
  }
  return withMarker(html, paragraphMarker(doc, props, sec, para, path))
}

function captionTextHtml(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  flat: { ctrl: number; cell: number; cellPara: number },
  length: number,
  props: () => string,
): string {
  if (length === 0) return ''
  const text = doc.getTextInCell(sec, para, flat.ctrl, flat.cell, flat.cellPara, 0, length)
  let align = 'left'
  try {
    const value = (JSON.parse(props()) as { alignment?: string }).alignment
    if (value === 'center' || value === 'right' || value === 'justify') align = value
  } catch {
    // keep left
  }
  let font = ''
  try {
    const chars = JSON.parse(
      doc.getCellCharPropertiesAt(sec, para, flat.ctrl, flat.cell, flat.cellPara, 0),
    ) as { fontFamily?: string; fontSize?: number; bold?: boolean }
    // fontSize is in 1/100 pt
    if (chars.fontSize) font += `font-size:${chars.fontSize / 100}pt;`
    if (chars.fontFamily) font += `font-family:'${chars.fontFamily.replace(/['"\\<>]/g, '')}';`
    if (chars.bold) font += 'font-weight:bold;'
  } catch {
    // the frame's default font
  }
  return `<p style="margin:0;text-align:${align};"><span style="${escapeAttr(font)}">${escapeText(text)}</span></p>`
}

const UNSUPPORTED_CONTROL_KIND_RE = /<!--\s*rhwp:[^->]*\b([A-Za-z]+)\s+컨트롤은/

interface ExportedControl {
  readonly html: string
  /** Control kind named by rhwp's unsupported-control comment, if any. */
  readonly unsupportedKind: string | null
}

interface CellHeaderFallback {
  para: number
  list: readonly CellStep[]
}

/**
 * Exports control `ctrl` of a paragraph; null when there is no such control.
 * Controls the engine cannot export (section settings, shapes, notes, headers)
 * come back as a bare comment; we keep the control kind so only text boxes
 * (`Shape`) open a `.flow-box` and cell-nested headers never leak into tables.
 */
function exportControl(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  hostPath: readonly CellStep[],
  ctrl: number,
): ExportedControl | null {
  try {
    const raw = stripClipboardFragment(
      doc.exportControlHtml(sec, para, JSON.stringify(hostPath), ctrl),
    )
    const unsupportedKind = UNSUPPORTED_CONTROL_KIND_RE.exec(raw)?.[1] ?? null
    const html = raw.replace(/<!--[\s\S]*?-->/g, '').trim()
    return { html, unsupportedKind }
  } catch {
    return null
  }
}

/**
 * Paragraph list held by a control other than a table: a text box's text or a
 * picture's caption. The engine reaches both as cell 0 of that control.
 */
function innerListPath(hostPath: readonly CellStep[], ctrl: number): CellStep[] {
  return [...hostPath, { controlIndex: ctrl, cellIndex: 0 }]
}

function hasInnerList(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  list: readonly CellStep[],
): boolean {
  try {
    return listParagraphCount(doc, sec, para, list) > 0
  } catch {
    return false
  }
}

/** Where a body-level table's caption sits: 'top', 'bottom', or null for none. */
function tableCaptionSide(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  ctrl: number,
): 'top' | 'bottom' | null {
  try {
    const props = JSON.parse(doc.getTableProperties(sec, para, ctrl)) as {
      hasCaption?: boolean
      captionDirection?: number
    }
    if (!props.hasCaption) return null
    // caption direction: 0 left, 1 right, 2 top, 3 bottom; left/right go above in the flow
    return props.captionDirection === 3 ? 'bottom' : 'top'
  } catch {
    return null
  }
}

function listContainer(
  className: string,
  sec: number,
  para: number,
  list: readonly CellStep[],
  inner: string,
  style?: string,
): string {
  const styleAttr = style ? ` style="${escapeAttr(style)}"` : ''
  return `<div class="${className}"${styleAttr} data-sec="${sec}" data-para="${para}" data-cell-path='${escapeAttr(JSON.stringify(list))}'>${inner}</div>`
}

/** Converts an HWP COLORREF integer (`0x00BBGGRR`) to `#rrggbb`, or null when unset. */
function colorrefToHex(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 0xffffff) {
    return null
  }
  const int = Math.trunc(value)
  const r = int & 0xff
  const g = (int >> 8) & 0xff
  const b = (int >> 16) & 0xff
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

function shapeBoxStyle(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  hostPath: readonly CellStep[],
  ctrl: number,
): { style: string; hasSolidFill: boolean } {
  try {
    const raw =
      hostPath.length === 0
        ? doc.getShapeProperties?.(sec, para, ctrl)
        : doc.getCellShapePropertiesByPath?.(sec, para, JSON.stringify(hostPath), ctrl)
    if (!raw) return { style: '', hasSolidFill: false }
    const props = JSON.parse(raw) as {
      fillType?: string
      fillBgColor?: number
      borderColor?: number
      width?: number
    }
    const rules: string[] = []
    let hasSolidFill = false
    if (props.fillType === 'solid') {
      const bg = colorrefToHex(props.fillBgColor)
      if (bg && bg !== '#ffffff') {
        rules.push(`background-color:${bg}`)
        hasSolidFill = true
      }
    }
    const border = colorrefToHex(props.borderColor)
    if (border && hasSolidFill) {
      rules.push(`border-color:${border}`)
    }
    if (
      typeof props.width === 'number' &&
      props.width > 0 &&
      props.width <= 12000 &&
      hasSolidFill
    ) {
      rules.push('display:inline-block')
    }
    return { style: rules.length > 0 ? `${rules.join(';')};` : '', hasSolidFill }
  } catch {
    return { style: '', hasSolidFill: false }
  }
}

/** True when inline spans carry white/near-white text (would vanish on a white box background). */
function hasWhiteText(html: string): boolean {
  return /color\s*:\s*#(?:fff(?:fff)?|f[a-f0-9]f[a-f0-9]f[a-f0-9])\b/i.test(html)
}

/**
 * Renders one control of a paragraph (body or cell), or '' when there is nothing to show.
 * Tables keep the engine's skeleton; pictures come with their caption; text boxes show their text.
 */
function renderControl(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  hostPath: readonly CellStep[],
  ctrl: number,
  exported: ExportedControl,
  cellHeader?: { found: CellHeaderFallback | null },
): string {
  const { html, unsupportedKind } = exported
  if (/<table[\s>]/i.test(html)) {
    const table = renderTable(doc, sec, para, hostPath, ctrl, html, cellHeader)
    // table captions are reachable only through the flat cell calls, so only for body-level tables
    const side = hostPath.length === 0 ? tableCaptionSide(doc, sec, para, ctrl) : null
    if (!side) return table
    const list: CellStep[] = [{ controlIndex: ctrl, cellIndex: TABLE_CAPTION_CELL }]
    const caption = listContainer(
      'flow-caption',
      sec,
      para,
      list,
      renderCellContents(doc, sec, para, list, cellHeader),
    )
    return side === 'top' ? caption + table : table + caption
  }
  const list = innerListPath(hostPath, ctrl)
  if (/<img[\s>]/i.test(html)) {
    const inner = hasInnerList(doc, sec, para, list) ? list : null
    if (!inner) return html
    const caption = listContainer(
      'flow-caption',
      sec,
      para,
      inner,
      renderCellContents(doc, sec, para, inner, cellHeader),
    )
    return captionOnTop(doc, sec, para, hostPath, ctrl) ? caption + html : html + caption
  }
  if (unsupportedKind === 'Header' && hostPath.length > 0) {
    if (cellHeader) cellHeader.found = { para, list }
    return ''
  }
  // Only text boxes (`Shape`) or unannotated controls in mocks may open a `.flow-box`;
  // headers, footers, notes, fields and section controls must never render as boxes.
  if (unsupportedKind === null || unsupportedKind === 'Shape') {
    if (hasInnerList(doc, sec, para, list)) {
      const inner = renderCellContents(doc, sec, para, list, cellHeader)
      const parsed = new DOMParser().parseFromString(`<body>${inner}</body>`, 'text/html')
      const hasVisible =
        Boolean(parsed.body.textContent?.trim()) ||
        Boolean(parsed.body.querySelector('img,table,.flow-box:not(.flow-box-empty)'))
      const shape = shapeBoxStyle(doc, sec, para, hostPath, ctrl)
      const classes = ['flow-box']
      if (!hasVisible) classes.push('flow-box-empty')
      else if (!shape.hasSolidFill && hasWhiteText(inner)) classes.push('flow-box-contrast')
      return listContainer(classes.join(' '), sec, para, list, inner, shape.style)
    }
  }
  return html
}

function captionOnTop(
  doc: FlowSourceDocument & Partial<CaptionSource>,
  sec: number,
  para: number,
  hostPath: readonly CellStep[],
  ctrl: number,
): boolean {
  try {
    const raw =
      hostPath.length === 0
        ? doc.getPictureProperties?.(sec, para, ctrl)
        : doc.getCellPicturePropertiesByPath?.(sec, para, JSON.stringify(hostPath), ctrl)
    return raw
      ? (JSON.parse(raw) as { captionDirection?: string }).captionDirection === 'Top'
      : false
  } catch {
    return false
  }
}

/** Optional: where a picture's caption sits. Without it, captions go below. */
interface CaptionSource {
  getPictureProperties(sectionIdx: number, paraIdx: number, controlIdx: number): string
  getCellPicturePropertiesByPath(
    sectionIdx: number,
    paraIdx: number,
    cellPathJson: string,
    controlIdx: number,
  ): string
}

/** Footnote or endnote text anchored on a body paragraph's control, or null. */
function noteHtml(doc: FlowSourceDocument, sec: number, para: number, ctrl: number): string | null {
  try {
    const info = JSON.parse(doc.getFootnoteInfo(sec, para, ctrl)) as {
      ok?: boolean
      texts?: string[]
    }
    if (!info.ok || !info.texts?.length) return null
    const body = info.texts.map((t) => `<p>${escapeText(t)}</p>`).join('')
    return `<div class="flow-note" data-sec="${sec}" data-para="${para}" contenteditable="false">${body}</div>`
  } catch {
    return null
  }
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Header or footer of a section (both-pages first, then odd, then even), or ''.
 * Its paragraphs, tables and pictures are shown read-only; when they cannot be
 * rendered, its plain text is shown instead.
 */
function headerFooterHtml(doc: FlowSourceDocument, sec: number, isHeader: boolean): string {
  for (const applyTo of [0, 2, 1]) {
    let info: { exists?: boolean; text?: string; paraIndex?: number; controlIndex?: number }
    try {
      info = JSON.parse(doc.getHeaderFooter(sec, isHeader, applyTo)) as typeof info
    } catch {
      // no header/footer API answer for this section: leave it out
      continue
    }
    if (!info.exists) continue
    const kind = isHeader ? 'flow-hf flow-header' : 'flow-hf flow-footer'
    const rich = headerFooterContents(doc, sec, info.paraIndex, info.controlIndex)
    if (rich) return `<div class="${kind}" contenteditable="false">${rich}</div>`
    const text = (info.text ?? '').replace(/\s+/g, ' ').trim()
    if (text) {
      return `<div class="${kind} flow-hf-text" contenteditable="false">${escapeText(text)}</div>`
    }
  }
  return ''
}

/** Attributes the flow editor reads to find what it edits; a header must carry none. */
const EDIT_ADDRESS_ATTRS = [
  'data-sec',
  'data-para',
  'data-path',
  'data-cell-path',
  'data-obj-path',
  'data-ctrl',
]

/**
 * A header's or footer's contents, rendered like a cell's, with every editing
 * address taken off so the flow editor leaves them alone. '' when it holds
 * nothing visible or cannot be rendered.
 */
function headerFooterContents(
  doc: FlowSourceDocument,
  sec: number,
  para: number | undefined,
  ctrl: number | undefined,
): string {
  if (para === undefined || ctrl === undefined) return ''
  return headerFooterContentsAt(doc, sec, para, [{ controlIndex: ctrl, cellIndex: 0 }])
}

function headerFooterContentsAt(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  list: readonly CellStep[],
): string {
  let html: string
  try {
    html = renderCellContents(pathCallsOnly(doc), sec, para, list)
  } catch {
    return ''
  }
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  for (const el of parsed.body.querySelectorAll('*')) {
    for (const attr of EDIT_ADDRESS_ATTRS) el.removeAttribute(attr)
    if (el.classList.contains('flow-p')) {
      el.classList.replace('flow-p', 'flow-hf-p')
      // an empty paragraph's placeholder line would only add space
      if (!el.textContent?.trim() && !el.querySelector('img,table')) el.remove()
    }
  }
  const visible = parsed.body.textContent?.trim() || parsed.body.querySelector('img,table')
  return visible ? parsed.body.innerHTML : ''
}

/**
 * The engine's flat cell calls take only tables and text boxes, so a header's
 * own paragraph list (reached as "cell 0" of the header control) answers only
 * the path calls. This view of the document sends the flat calls there.
 */
function pathCallsOnly(doc: FlowSourceDocument): FlowSourceDocument {
  const at = (ctrl: number, cell: number, cellPara: number) =>
    JSON.stringify([{ controlIndex: ctrl, cellIndex: cell, cellParaIndex: cellPara }])
  const overrides: Partial<FlowSourceDocument> = {
    getCellParagraphCount: (s, p, c, cell) => doc.getCellParagraphCountByPath(s, p, at(c, cell, 0)),
    getCellParagraphLength: (s, p, c, cell, k) =>
      doc.getCellParagraphLengthByPath(s, p, at(c, cell, k)),
    getCellParaPropertiesAt: (s, p, c, cell, k) =>
      doc.getCellParaPropertiesAtByPath(s, p, at(c, cell, k)),
  }
  return new Proxy(doc, {
    get(target, key, receiver) {
      if (typeof key === 'string' && key in overrides) {
        return overrides[key as keyof FlowSourceDocument]
      }
      const value: unknown = Reflect.get(target, key, receiver)
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value
    },
  })
}

/** Classification of an HWP table in mobile flow reading view. */
export type FlowTableKind = 'layout' | 'callout' | 'data'

interface TableCellMeta {
  readonly td: HTMLTableCellElement
  readonly rowIdx: number
  readonly colSpan: number
  readonly rowSpan: number
  readonly textLen: number
  readonly hasMediaOrTable: boolean
  readonly hasSolidFill: boolean
  readonly hasBorder: boolean
  readonly isGradientBar: boolean
  readonly engineProps: EngineCellProps | null
}

/** Max height (HWPUNIT, ~16px) of an empty gradient cell treated as a decorative horizontal bar. */
const GRADIENT_BAR_MAX_HEIGHT_HU = 1200
/** HWPUNIT per CSS pixel (7200 / 96). */
const HU_PER_PX = 75
/** Comfortable minimum width per column (px) for wide multi-column data tables. */
const DATA_TABLE_MIN_COL_PX = 76

function readEngineCellProps(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  hostPath: readonly CellStep[],
  ctrl: number,
  cellIndex: number,
): EngineCellProps | null {
  try {
    let raw: string | undefined
    if (hostPath.length === 0) {
      raw = doc.getCellProperties?.(sec, para, ctrl, cellIndex)
    } else if (doc.getCellPropertiesByPath) {
      const pathJson = JSON.stringify([
        ...hostPath,
        { controlIndex: ctrl, cellIndex, cellParaIndex: 0 },
      ])
      raw = doc.getCellPropertiesByPath(sec, para, pathJson, cellIndex)
    }
    if (!raw) return null
    const parsed = JSON.parse(raw) as EngineCellProps
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function readEngineTableWidthPx(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  hostPath: readonly CellStep[],
  ctrl: number,
): number | null {
  if (hostPath.length > 0) return null
  try {
    const props = JSON.parse(doc.getTableProperties(sec, para, ctrl)) as { tableWidth?: number }
    if (typeof props.tableWidth === 'number' && props.tableWidth > 0) {
      return Math.round(props.tableWidth / HU_PER_PX)
    }
  } catch {
    // ignore missing table properties
  }
  return null
}

/**
 * Classifies a rendered table into:
 * - `layout`: 1-column decorative/cover/section-heading/single-cell callout tables
 *   (reflow cleanly at 100% width; empty spacer rows collapse in reading view).
 * - `callout`: 1-row badge+title banners or framed reference boxes with a
 *   full-width spanning body cell and empty gutter spacer cells (reflow at 100%
 *   width; empty spacer cells/rows collapse in reading view).
 * - `data`: structured multi-row, multi-column data tables and forms (keep grid
 *   layout; 3+ columns scroll horizontally with readable column widths).
 */
export function classifyFlowTable(
  rowCount: number,
  maxCols: number,
  cells: ReadonlyArray<
    Pick<
      TableCellMeta,
      'rowIdx' | 'colSpan' | 'textLen' | 'hasMediaOrTable' | 'hasSolidFill' | 'isGradientBar'
    >
  >,
): FlowTableKind {
  if (maxCols <= 1) return 'layout'

  // Single-row 2-column banner: short badge/accent cell + heading text (e.g. numbered section bars).
  if (rowCount === 1 && maxCols === 2 && cells.length === 2) {
    const [a, b] = cells
    const aIsBadge = !a.hasMediaOrTable && a.textLen <= 4
    const bIsBadge = !b.hasMediaOrTable && b.textLen <= 4
    const aHasText = a.textLen > 0 || a.hasMediaOrTable
    const bHasText = b.textLen > 0 || b.hasMediaOrTable
    if ((aIsBadge && bHasText && b.textLen > 4) || (bIsBadge && aHasText && a.textLen > 4)) {
      return 'callout'
    }
  }

  // Framed callout / reference box: <= 4 rows, at least one full-width spanning cell,
  // and empty spacer cells in the header/decorative rows.
  if (rowCount >= 2 && rowCount <= 4) {
    const fullWidthCells = cells.filter((c) => c.colSpan >= maxCols)
    const nonFullCells = cells.filter((c) => c.colSpan < maxCols)
    if (fullWidthCells.length >= 1 && nonFullCells.length > 0) {
      const emptyNonFull = nonFullCells.filter(
        (c) => c.textLen === 0 && !c.hasMediaOrTable && !c.hasSolidFill && !c.isGradientBar,
      ).length
      const filledNonFull = nonFullCells.filter((c) => c.textLen > 0 || c.hasMediaOrTable).length
      if (emptyNonFull >= 1 && (filledNonFull <= 2 || emptyNonFull / nonFullCells.length >= 0.4)) {
        return 'callout'
      }
    }
  }

  return 'data'
}

/** Renders a table: the engine's skeleton with true borders, classification, and rebuilt cell contents. */
function renderTable(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  hostPath: readonly CellStep[],
  ctrl: number,
  skeletonHtml: string,
  cellHeader?: { found: CellHeaderFallback | null },
): string {
  const parsed = new DOMParser().parseFromString(`<body>${skeletonHtml}</body>`, 'text/html')
  const table = parsed.body.querySelector('table')
  if (!table) return skeletonHtml

  const rows = [...table.querySelectorAll<HTMLTableRowElement>(':scope > tbody > tr, :scope > tr')]
  const rowCount = rows.length
  let maxCols = 0
  let cellIndex = 0
  const metas: TableCellMeta[] = []
  const rowMetas: TableCellMeta[][] = []

  for (let r = 0; r < rows.length; r += 1) {
    const tr = rows[r]
    const tds = [...tr.querySelectorAll<HTMLTableCellElement>(':scope > td, :scope > th')]
    let colsInRow = 0
    const metasInRow: TableCellMeta[] = []
    for (const td of tds) {
      const colSpan = Math.max(1, Number(td.getAttribute('colspan') ?? '1') || 1)
      const rowSpan = Math.max(1, Number(td.getAttribute('rowspan') ?? '1') || 1)
      colsInRow += colSpan

      const engineProps = readEngineCellProps(doc, sec, para, hostPath, ctrl, cellIndex)
      if (engineProps) {
        td.setAttribute('style', cellStyleFromEngineProps(engineProps))
      } else {
        const style = td.getAttribute('style')
        if (style) td.setAttribute('style', normalizeClipboardBorderWidths(style))
      }

      const cellPath: CellStep[] = [...hostPath, { controlIndex: ctrl, cellIndex }]
      td.setAttribute('data-sec', String(sec))
      td.setAttribute('data-para', String(para))
      td.setAttribute('data-cell-path', JSON.stringify(cellPath))
      td.innerHTML = renderCellContents(doc, sec, para, cellPath, cellHeader)

      const visibleText = (td.textContent ?? '').replace(/\u00a0/g, ' ').trim()
      const hasMediaOrTable = Boolean(td.querySelector('img,table,.flow-box:not(.flow-box-empty)'))
      const styleAfter = td.getAttribute('style') ?? ''
      const hasSolidFill = /background-color\s*:/i.test(styleAfter)
      const hasBorder = engineProps
        ? hasVisibleEngineBorder(engineProps)
        : /border-(?:left|right|top|bottom)\s*:/i.test(styleAfter)
      const isGradientBar =
        Boolean(engineProps) &&
        engineProps?.fillType === 'gradient' &&
        visibleText.length === 0 &&
        !hasMediaOrTable &&
        (engineProps.height ?? Infinity) <= GRADIENT_BAR_MAX_HEIGHT_HU

      const meta: TableCellMeta = {
        td,
        rowIdx: r,
        colSpan,
        rowSpan,
        textLen: visibleText.length,
        hasMediaOrTable,
        hasSolidFill,
        hasBorder,
        isGradientBar,
        engineProps,
      }
      metas.push(meta)
      metasInRow.push(meta)
      cellIndex += 1
    }
    if (colsInRow > maxCols) maxCols = colsInRow
    rowMetas.push(metasInRow)
  }

  const kind = classifyFlowTable(rowCount, maxCols, metas)
  table.classList.add(`flow-table-${kind}`)
  table.setAttribute('data-table-kind', kind)

  if (kind === 'layout' || kind === 'callout') {
    // Track rows spanned into by an earlier row's `rowspan` so collapsing a spacer row
    // never causes the spanning cell to bleed side-by-side into the next content row.
    const spannedRows = new Set<number>()
    for (let r = 0; r < rows.length; r += 1) {
      for (const c of rowMetas[r]) {
        for (let offset = 1; offset < c.rowSpan; offset += 1) {
          spannedRows.add(r + offset)
        }
      }
    }

    for (let r = 0; r < rows.length; r += 1) {
      const tr = rows[r]
      const cellsInRow = rowMetas[r]
      if (cellsInRow.length === 0) continue

      // Thin horizontal gradient accent bar (e.g. cover page divider lines).
      if (cellsInRow.length === 1 && cellsInRow[0].isGradientBar && cellsInRow[0].engineProps) {
        tr.classList.add('flow-divider-row')
        const color = gradientBarColor(cellsInRow[0].engineProps)
        cellsInRow[0].td.setAttribute(
          'style',
          `background-color:${color};padding:0;height:3px;border:none;`,
        )
        continue
      }

      // Completely empty row with no visible content, media, or solid fill: collapse in view mode.
      const allEmpty = cellsInRow.every(
        (c) =>
          c.textLen === 0 &&
          !c.hasMediaOrTable &&
          !c.hasSolidFill &&
          !c.isGradientBar &&
          c.rowSpan === 1,
      )
      if (allEmpty) {
        tr.classList.add(spannedRows.has(r) ? 'flow-spacer-row-spanned' : 'flow-spacer-row')
        for (const c of cellsInRow) c.td.classList.add('flow-spacer-cell')
        continue
      }

      // In layout tables, distinguish borderless/unfilled cells (cover text) from bordered/filled boxes.
      if (kind === 'layout') {
        for (const c of cellsInRow) {
          if (!c.hasBorder && !c.hasSolidFill) {
            c.td.classList.add('flow-plain-cell')
          }
        }
      }

      // In callout tables, collapse empty margin/gutter spacer cells and shrink short badge cells.
      if (kind === 'callout') {
        const visibleCells: TableCellMeta[] = []
        for (const c of cellsInRow) {
          if (c.colSpan < maxCols) {
            if (c.textLen === 0 && !c.hasMediaOrTable && !c.hasSolidFill && !c.isGradientBar) {
              c.td.classList.add('flow-spacer-cell')
            } else {
              visibleCells.push(c)
              if (!c.hasMediaOrTable && c.textLen > 0 && c.textLen <= 4) {
                c.td.classList.add('flow-badge-cell')
              }
            }
          } else {
            visibleCells.push(c)
          }
        }
        // When a callout header row reduces to a single visible cell (surrounded by empty gutters),
        // let it span the full table width cleanly above the body row.
        if (visibleCells.length === 1 && visibleCells[0].colSpan < maxCols && !spannedRows.has(r)) {
          visibleCells[0].td.setAttribute('colspan', String(maxCols))
        }
      }
    }
  } else {
    // Data table: 2-column tables fill 100%; 3+ column tables preserve readable width for horizontal scroll.
    if (maxCols <= 2) {
      table.classList.add('flow-table-compact')
    } else {
      const engineWidthPx = readEngineTableWidthPx(doc, sec, para, hostPath, ctrl)
      const minColsPx = maxCols * DATA_TABLE_MIN_COL_PX
      const targetMinPx = engineWidthPx
        ? Math.min(engineWidthPx, Math.max(minColsPx, 360))
        : minColsPx
      const existingStyle = table.getAttribute('style') ?? ''
      table.setAttribute(
        'style',
        `${existingStyle}${existingStyle && !existingStyle.endsWith(';') ? ';' : ''}min-width:${targetMinPx}px;`,
      )
    }
  }

  return table.outerHTML
}

/** Renders every paragraph of a cell, with nested tables and pictures in place. */
export function renderCellContents(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  cellPath: readonly CellStep[],
  cellHeader?: { found: CellHeaderFallback | null },
): string {
  const parts: string[] = []
  const count = listParagraphCount(doc, sec, para, cellPath)
  for (let k = 0; k < count; k += 1) {
    const path = cellParaPath(cellPath, k)
    const text = cellParagraphHtml(doc, sec, para, path)
    const objects: string[] = []
    for (let ctrl = 0; ; ctrl += 1) {
      const exported = exportControl(doc, sec, para, path, ctrl)
      if (exported === null) break
      const inner = renderControl(doc, sec, para, path, ctrl, exported, cellHeader)
      // data-obj-path: the cell paragraph holding the object, for finding it again (doc check)
      if (inner) {
        objects.push(
          `<div class="flow-obj" data-obj-path='${escapeAttr(JSON.stringify(path))}'>${inner}</div>`,
        )
      }
    }
    if (text || objects.length === 0) parts.push(blockDiv(sec, para, path, text))
    parts.push(...objects)
  }
  return parts.join('')
}

/**
 * One body paragraph as flow HTML: its text block (unless it only anchors
 * objects), its tables, pictures and text boxes, then its notes. Every part
 * carries the paragraph's address so the editor can replace them together.
 */
export function renderBodyParagraph(
  doc: FlowSourceDocument,
  sec: number,
  para: number,
  cellHeader?: { found: CellHeaderFallback | null },
): string {
  const parts: string[] = []
  const controls = controlCount(doc.getControlTextPositions(sec, para))
  const text = bodyParagraphHtml(doc, sec, para)
  // A paragraph that only anchors a table or picture shows just that object.
  if (text || controls === 0) parts.push(blockDiv(sec, para, null, text))
  const notes: string[] = []
  for (let ctrl = 0; ctrl < controls; ctrl += 1) {
    const exported = exportControl(doc, sec, para, [], ctrl)
    if (exported === null) continue
    const inner = renderControl(doc, sec, para, [], ctrl, exported, cellHeader)
    if (inner) {
      parts.push(
        `<div class="flow-obj" data-sec="${sec}" data-para="${para}" data-ctrl="${ctrl}">${inner}</div>`,
      )
      continue
    }
    const note = noteHtml(doc, sec, para, ctrl)
    if (note) notes.push(note)
  }
  // notes follow the paragraph that refers to them
  parts.push(...notes)
  return parts.join('\n')
}

/** Builds the flow body HTML. Objects that fail to export are left out, never guessed. */
export function buildFlowHtml(doc: FlowSourceDocument): string {
  const parts: string[] = []
  const sections = doc.getSectionCount()
  for (let sec = 0; sec < sections; sec += 1) {
    const header = headerFooterHtml(doc, sec, true)
    const cellHeader: { found: CellHeaderFallback | null } = { found: null }
    const bodyParts: string[] = []
    const paras = doc.getParagraphCount(sec)
    for (let para = 0; para < paras; para += 1) {
      bodyParts.push(renderBodyParagraph(doc, sec, para, header ? undefined : cellHeader))
    }
    if (header) {
      parts.push(header)
    } else if (cellHeader.found) {
      const rich = headerFooterContentsAt(doc, sec, cellHeader.found.para, cellHeader.found.list)
      if (rich) parts.push(`<div class="flow-hf flow-header" contenteditable="false">${rich}</div>`)
    }
    parts.push(...bodyParts)
    const footer = headerFooterHtml(doc, sec, false)
    if (footer) parts.push(footer)
  }
  return parts.join('\n')
}

/**
 * Reading styles inside the sandboxed flow frame.
 * Document colors stay as authored on bright paper (`color-scheme: light`), matching
 * docs/standards.md and preventing Android WebView algorithmic dark inversion.
 */
export const FLOW_FRAME_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html {
  color-scheme: light;
  -webkit-text-size-adjust: 100%;
  touch-action: pan-x pan-y;
  max-width: 100%;
  overflow-x: clip;
  background: #ffffff;
}
body {
  margin: 0;
  padding: 16px 16px calc(var(--flow-bottom-pad, 100px) / var(--flow-zoom, 1.2));
  max-width: 100%;
  overflow-x: clip;
  background: #ffffff;
  color: #000000;
  font-family: 'GenOffice Sans KR', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', sans-serif;
  word-break: keep-all;
  overflow-wrap: anywhere;
  zoom: var(--flow-zoom, 1.2);
}
@media (min-width: 840px) {
  body {
    max-width: min(100%, calc(40rem / var(--flow-zoom, 1.2)));
    margin-inline: auto;
    padding-inline: 24px;
  }
}
body[contenteditable='true'] { outline: none; caret-color: #1a73e8; }
.flow-p p { margin: 0; }
.flow-p, .flow-obj { margin: 0 0 6px; max-width: 100%; }
td .flow-p, td .flow-obj { margin: 0 0 2px; }
td .flow-p:last-child, td .flow-obj:last-child { margin-bottom: 0; }
.flow-obj { overflow-x: auto; -webkit-overflow-scrolling: touch; }
td > .flow-obj { overflow-x: auto; max-width: 100%; }
.flow-obj table { border-collapse: collapse; max-width: none; }
/* Layout & callout tables reflow to the reading column without horizontal scrolling. */
table.flow-table-layout,
table.flow-table-callout { width: 100%; table-layout: auto; }
table.flow-table-layout > tbody > tr > td,
table.flow-table-layout > tr > td { padding: 8px 10px; min-width: 0; }
table.flow-table-layout > tbody > tr > td.flow-plain-cell,
table.flow-table-layout > tr > td.flow-plain-cell { padding: 6px 2px; }
table.flow-table-callout > tbody > tr > td,
table.flow-table-callout > tr > td { padding: 6px 8px; min-width: 0; }
table.flow-table-callout td.flow-badge-cell { width: 1%; white-space: nowrap; padding: 6px 10px; }
/* Collapse decorative empty spacer rows/cells and empty shapes in reading mode; keep editable in edit mode. */
body:not([contenteditable='true']) tr.flow-spacer-row { display: none; }
body:not([contenteditable='true']) tr.flow-spacer-row-spanned { height: 0; line-height: 0; font-size: 0; }
body:not([contenteditable='true']) td.flow-spacer-cell { display: none; }
body:not([contenteditable='true']) .flow-box-empty { display: none; }
.flow-box-contrast { background: #334155; border-color: #334155; }
tr.flow-divider-row td { height: 3px; line-height: 0; font-size: 0; padding: 0 !important; }
tr.flow-divider-row .flow-p { display: none; }
/* Data tables preserve grid structure and horizontal scroll on narrow screens. */
table.flow-table-data { width: 100%; }
table.flow-table-data > tbody > tr > td,
table.flow-table-data > tr > td,
table.flow-table-data > tbody > tr > th,
table.flow-table-data > tr > th {
  padding: 4px 6px;
  min-width: 3.5em;
  overflow-wrap: break-word;
}
/* keep short labels (two or three syllables) on one line instead of one per line */
.flow-obj td p, .flow-obj th p { word-break: keep-all; overflow-wrap: break-word; }
img { max-width: 100%; height: auto; }
/* memo ranges (CSS Custom Highlight API, set by the flow editor) */
::highlight(ieum-memo) { background-color: #fff2a8; }
/* bullets are drawn here so they never become editable text */
.flow-p p[data-marker]::before {
  content: attr(data-marker);
  margin-right: 0.4em;
  font-family: var(--marker-font, inherit);
  font-size: var(--marker-size, inherit);
}
.flow-caption { margin: 2px 0 4px; }
.flow-box { border: 1px solid #b0b0b0; border-radius: 4px; padding: 6px 8px; margin: 4px 0; }
.flow-note { font-size: 0.85em; color: #444444; padding-left: 1em; margin: 0 0 6px; }
.flow-note p { margin: 0; }
.flow-hf { font-size: 0.8em; color: #666666; opacity: 0.6; }
/* set apart from the body by a thin rule, since its own fonts and colors match the body's */
.flow-header { margin: 0 0 8px; padding-bottom: 6px; border-bottom: 1px solid #d8d8d8; }
.flow-footer { margin: 8px 0 0; padding-top: 6px; border-top: 1px solid #d8d8d8; }
.flow-hf-text { text-align: center; }
.flow-hf-p p { margin: 0; }
.flow-hf .flow-obj { margin: 0 0 4px; }
`

/** Builds the srcdoc for the sandboxed frame. `zoom` scales all text (document sizes are in pt). */
export function buildFlowDocument(
  bodyHtml: string,
  zoom: number,
  lang: string,
  bottomPadPx = 100,
): string {
  const safeBottom = Number.isFinite(bottomPadPx) && bottomPadPx > 0 ? Math.round(bottomPadPx) : 100
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="color-scheme" content="light"><meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no"><style>${FLOW_FRAME_CSS}</style><style>:root{--flow-zoom:${zoom};--flow-bottom-pad:${safeBottom}px}</style></head><body>${bodyHtml}</body></html>`
}
