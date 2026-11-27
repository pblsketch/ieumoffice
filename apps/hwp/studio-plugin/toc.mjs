/**
 * Body table-of-contents (TOC) generation, refresh, legacy-TOC detection,
 * manual-edit protection, and staleness checking for rhwp documents.
 *
 * Designed as a shared core so secondary TOC kinds (table, figure, equation)
 * can plug in their own entry collectors without duplicating rendering,
 * printed-page measurement, bookmark linking, range marking, or refresh logic.
 *
 * To avoid a static ESM cycle with `agent-plugin.mjs`, shared formatting and
 * layout helpers from `agent-plugin.mjs` (`contentsOf`, `tocLookOf`, `tocHtml`,
 * `withPortableWidths`, `textWidthPt`, `columnWidthUnits`, `oneLine`, `tablesOf`)
 * can be registered via `registerTocHelpers()` or passed through `options.helpers`,
 * with equivalent standalone defaults built in.
 */
import {
  MARK_PREFIXES,
  MAX_MARK_NAME_LEN,
  addMark,
  addRangeMark,
  encodeMarkName,
  findRangeMarks,
  listMarks,
  readDocSetting,
  removeMark,
  resolveBodyPlace,
  uniqueMarkName,
  writeDocSetting,
} from './doc-marks.mjs'
import { TAB_ALIGNS, TAB_LEADERS } from './document-looks.mjs'
import { MAX_OUTLINE_LEVEL, MIN_OUTLINE_LEVEL, readOutline } from './outline.mjs'

export const TOC_KINDS = Object.freeze({
  body: '본문',
  table: '표',
  figure: '그림',
  equation: '수식',
})

export const TOC_LAYOUTS = Object.freeze(['dotted-tab', 'table'])
export const DEFAULT_TOC_MAX_LEVEL = 3
export const DEFAULT_TOC_TITLE = '차례'
export const DEFAULT_TOC_TITLES = Object.freeze({
  body: '차례',
  table: '표 차례',
  figure: '그림 차례',
  equation: '수식 차례',
})
export const DEFAULT_TOC_INDENT_PT = 14

const TOC_TITLE_STYLE = '차례 제목'
const BODY_STYLE = '바탕글'
const CAPTION_STYLES = new Set(['캡션', 'Caption'])
const OBJECT_CAPTIONS_UNAVAILABLE_WARNING =
  'Object captions unavailable: engine build does not expose listObjectCaptions().'
// Matches table, figure, and equation caption prefixes with Arabic or Roman numerals
// (including optional brackets and parenthesized numbers such as `Eq. (1)`).
// Kept case-explicit (no /i flag) so lowercase words after "Table"/"Figure" do not match Roman numerals.
const CAPTION_PREFIX_RE =
  /^[<[〈《(]?\s*(표|도표|Table|TABLE|table|그림|Figure|FIGURE|figure|Fig\.?|FIG\.?|fig\.?|수식|식|Equation|EQUATION|equation|Eq\.?|EQ\.?|eq\.?)\s*(?:\(\s*)?(?:(\d+(?:[-.]\d+)*)|([IVXLCDM\u2160-\u216F]+(?:[-.]\d+)*)(?=[\s\]>〉》):.-]|$))/
const MAX_TOC_TEXT = 120
const TOC_PAGE_COLUMN_PT = 45
const TOC_CELL_STYLE = 'border:none;padding:1.41pt 5.1pt'
const TOC_CELL_SLACK_PT = 24
const TOC_TITLES = ['차례', '목차']
const TOC_TITLE_CHARS = 12
const PARA_UNITS_PER_PT = 200
const MAX_CONVERGENCE_PASSES = 2

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000b-\u001f\u007f]/g
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i
const PAGE_LABEL_RE = /^(?:\d+|[IVXLCDM]+|[ivxlcdm]+|[①-⑳]|[A-Za-z]|[Ⓐ-Ⓩⓐ-ⓩ])$/
const LEGACY_TAB_LINE_RE = /\t\s*(?:\d+|[IVXLCDM]+|[ivxlcdm]+|[①-⑳]|[A-Za-z]|[Ⓐ-Ⓩⓐ-ⓩ])\s*$/
const LEGACY_DOTTED_LINE_RE =
  /(?:\.{3,}|…{2,}|·{3,})\s*(?:\d+|[IVXLCDM]+|[ivxlcdm]+|[①-⑳]|[A-Za-z]|[Ⓐ-Ⓩⓐ-ⓩ])\s*$/

const ROMAN_TABLE = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
]

const KIND_BY_ID = Object.freeze({
  [TOC_KINDS.body]: 'body',
  '': 'body',
  [TOC_KINDS.table]: 'table',
  [TOC_KINDS.figure]: 'figure',
  [TOC_KINDS.equation]: 'equation',
})

let registeredHelpers = {}

/**
 * Register shared helper functions (e.g. exported from `agent-plugin.mjs`)
 * so `toc.mjs` reuses them without creating a circular module import.
 */
export function registerTocHelpers(helpers) {
  if (!helpers || typeof helpers !== 'object') {
    registeredHelpers = {}
    return
  }
  registeredHelpers = { ...registeredHelpers, ...helpers }
}

function resolveHelpers(options) {
  const override = options?.helpers && typeof options.helpers === 'object' ? options.helpers : null
  const merged = override ? { ...registeredHelpers, ...override } : registeredHelpers
  return {
    contentsOf: merged.contentsOf ?? null,
    tocLookOf: merged.tocLookOf ?? defaultTocLookOf,
    tocHtml: merged.tocHtml ?? defaultTocHtml,
    withPortableWidths: merged.withPortableWidths ?? defaultWithPortableWidths,
    textWidthPt: merged.textWidthPt ?? defaultTextWidthPt,
    columnWidthUnits: merged.columnWidthUnits ?? defaultColumnWidthUnits,
    oneLine: merged.oneLine ?? defaultOneLine,
    tablesOf: merged.tablesOf ?? defaultTablesOf,
  }
}

function parseJson(raw, fallback) {
  if (typeof raw !== 'string' || raw.length === 0) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function tryOr(fn, fallback) {
  try {
    return fn()
  } catch {
    return fallback
  }
}

function cleanText(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return ''
  return raw.replace(CONTROL_CHARS_RE, '').replace(/\s+/g, ' ').trim()
}

function cleanLinePreservingTab(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return ''
  return raw
    .replace(CONTROL_CHARS_RE, '')
    .split('\t')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .join('\t')
    .trim()
}

function clipText(text, max) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function bodyText(doc, sec, para) {
  const len = tryOr(() => doc.getParagraphLength(sec, para), 0)
  return Number.isInteger(len) && len > 0
    ? tryOr(() => doc.getTextRange(sec, para, 0, len), '')
    : ''
}

function flatBodyParaIndex(doc, sec, para) {
  let flat = para
  for (let s = 0; s < sec; s++) {
    flat += doc.getParagraphCount(s)
  }
  return flat
}

function ptOfPx(px) {
  return Math.round((Number(px) || 0) * 7.5) / 10
}

function paraUnitsOf(points) {
  return 2 * Math.round((points * PARA_UNITS_PER_PT) / 2)
}

function defaultWithPortableWidths(doc, fn) {
  const measured = doc?.canvasMetricsActive?.() ?? false
  if (measured) doc.selectCanvasMetrics(false)
  try {
    return fn()
  } finally {
    if (measured) doc.selectCanvasMetrics(true)
  }
}

function defaultTextWidthPt(doc, sec) {
  const page = parseJson(doc.getPageDef(sec), null)
  if (!page) return 425
  const width = (page.landscape ? page.height : page.width) - page.marginLeft - page.marginRight
  return Math.max(100, Math.round((width - (page.marginGutter ?? 0)) / 100))
}

function defaultColumnWidthUnits(doc, sec) {
  const page = parseJson(doc.getPageDef(sec), null)
  if (!page) return 42520
  const text =
    (page.landscape ? page.height : page.width) -
    page.marginLeft -
    page.marginRight -
    (page.marginGutter ?? 0)
  let count = 1
  let gapPt = 0
  if (typeof doc.getColumnDef === 'function') {
    const def = tryOr(() => parseJson(doc.getColumnDef(sec), null), null)
    if (def && Number.isInteger(def.columnCount) && def.columnCount > 1) {
      count = def.columnCount
      gapPt = Number.isFinite(def.spacing) ? Math.max(0, def.spacing) / 100 : 0
    }
  }
  return Math.max(4000, Math.floor((text - gapPt * 100 * (count - 1)) / count))
}

function styleIdOf(doc, name) {
  if (typeof doc.getStyleList !== 'function') return null
  const styles = tryOr(() => parseJson(doc.getStyleList(), []), [])
  if (!Array.isArray(styles)) return null
  const found = styles.find(
    (s) =>
      s && (s.type === undefined || s.type === 0) && (s.name === name || s.englishName === name),
  )
  return found && Number.isInteger(found.id) ? found.id : null
}

function fontOfCharProps(charProps) {
  const family = typeof charProps?.fontFamily === 'string' ? charProps.fontFamily : ''
  const size = Number(charProps?.fontSize)
  const points = Number.isFinite(size) && size > 0 ? Math.round(size / 10) / 10 : 10
  return { family, points }
}

function bodyFontOf(doc) {
  const styleId = styleIdOf(doc, BODY_STYLE) ?? 0
  const detail =
    typeof doc.getStyleDetail === 'function'
      ? tryOr(() => parseJson(doc.getStyleDetail(styleId), null), null)
      : null
  if (detail?.charProps) return fontOfCharProps(detail.charProps)
  const sample =
    typeof doc.getCharPropertiesAt === 'function'
      ? tryOr(() => parseJson(doc.getCharPropertiesAt(0, 0, 0), null), null)
      : null
  return fontOfCharProps(sample)
}

function bodyTitleLookOf(doc, font) {
  const style = styleIdOf(doc, BODY_STYLE) ?? 0
  const detail =
    typeof doc.getStyleDetail === 'function'
      ? tryOr(() => parseJson(doc.getStyleDetail(style), null), null)
      : null
  return {
    style,
    font,
    bold: true,
    color: detail?.charProps?.textColor ?? '#000000',
  }
}

function defaultTocLookOf(doc, entries) {
  const used = [...new Set(entries.map((e) => e.level))]
  const ids = used.map((level) => styleIdOf(doc, `차례 ${level}`))
  const styled = ids.length > 0 && ids.every((id) => id !== null)
  if (styled && typeof doc.getStyleDetail === 'function') {
    const levels = new Map(
      used.map((level, index) => {
        const detail = parseJson(doc.getStyleDetail(ids[index]), {})
        const font = fontOfCharProps(detail?.charProps)
        const indentPt = ptOfPx(detail?.paraProps?.marginLeft ?? 0)
        return [level, { style: ids[index], font, indentPt }]
      }),
    )
    const titleId = styleIdOf(doc, TOC_TITLE_STYLE)
    if (titleId !== null) {
      const detail = parseJson(doc.getStyleDetail(titleId), {})
      const charProps = detail?.charProps ?? {}
      return {
        levels,
        title: {
          style: titleId,
          font: fontOfCharProps(charProps),
          bold: charProps.bold === true,
          color: charProps.textColor,
        },
      }
    }
    return { levels, title: bodyTitleLookOf(doc, bodyFontOf(doc)) }
  }
  const font = bodyFontOf(doc)
  const levels = new Map(
    used.map((level) => [
      level,
      { style: null, font, indentPt: (level - 1) * DEFAULT_TOC_INDENT_PT },
    ]),
  )
  return { levels, title: bodyTitleLookOf(doc, font) }
}

function defaultTocHtml(rows, widthPt) {
  const textOf = ({ font }) =>
    [
      font.family ? `font-family:${font.family};mso-fareast-font-family:${font.family}` : '',
      `font-size:${font.points}pt`,
    ]
      .filter(Boolean)
      .join(';')
  const headingWidth = Math.max(50, widthPt - TOC_PAGE_COLUMN_PT)
  const cellStyle = TOC_CELL_STYLE
  const row = ({ text: heading, look, page }) =>
    '<tr>' +
    `<td style="${cellStyle};width:${headingWidth}pt">` +
    `<p style="margin-left:${look.indentPt}pt"><span style="${textOf(look)}">${escapeHtml(heading)}</span></p></td>` +
    `<td style="${cellStyle};width:${TOC_PAGE_COLUMN_PT}pt">` +
    `<p style="text-align:right"><span style="${textOf(look)}">${escapeHtml(page)}</span></p></td>` +
    '</tr>'
  return `<table>${rows.map(row).join('')}</table>`
}

const emsOf = (ch) => (ch.codePointAt(0) > 0x2e7f ? 1 : 0.55)

function defaultOneLine(text, look, widthPt) {
  const fontPts = look?.font?.points > 0 ? look.font.points : 10
  const indentPt = Number(look?.indentPt) || 0
  const room = (widthPt - TOC_PAGE_COLUMN_PT - indentPt - TOC_CELL_SLACK_PT) / fontPts
  if (!(room > 2)) return text
  let used = 0
  let out = ''
  for (const ch of text) {
    used += emsOf(ch)
    if (used > room - 1) return `${out.trimEnd()}…`
    out += ch
  }
  return out
}

function defaultTablesOf(doc) {
  const tables = []
  const secCount = doc.getSectionCount()
  for (let sec = 0; sec < secCount; sec++) {
    const paraCount = doc.getParagraphCount(sec)
    for (let para = 0; para < paraCount; para++) {
      const positions =
        typeof doc.getControlTextPositions === 'function'
          ? tryOr(() => parseJson(doc.getControlTextPositions(sec, para), []), [])
          : []
      for (let controlIndex = 0; controlIndex < positions.length; controlIndex++) {
        const dims =
          typeof doc.getTableDimensions === 'function'
            ? tryOr(() => parseJson(doc.getTableDimensions(sec, para, controlIndex), null), null)
            : null
        if (!dims || !Number.isInteger(dims.rowCount) || !Number.isInteger(dims.colCount)) continue
        tables.push({
          sec,
          para,
          path: [{ controlIndex, cellIndex: 0, cellParaIndex: 0 }],
          rows: dims.rowCount,
          cols: dims.colCount,
          cells: dims.cellCount ?? dims.rowCount * dims.colCount,
        })
      }
    }
  }
  return { tables }
}

function toRoman(num) {
  if (!Number.isInteger(num) || num < 1 || num > 3999) return null
  let remaining = num
  let out = ''
  for (const [val, sym] of ROMAN_TABLE) {
    while (remaining >= val) {
      out += sym
      remaining -= val
    }
  }
  return out
}

/**
 * Format a 1-based printed page number using HWP page-number format codes (0..7).
 * Returns null for default Arabic digits (format 0) or out-of-range values.
 */
export function formatPageNumberLabel(num, format) {
  if (!Number.isInteger(num) || num < 1 || !Number.isInteger(format) || format === 0) return null
  switch (format) {
    case 1:
      return num <= 20 ? String.fromCharCode(0x2460 + num - 1) : null
    case 2:
      return toRoman(num)
    case 3: {
      const upper = toRoman(num)
      return upper ? upper.toLowerCase() : null
    }
    case 4:
      return num <= 26 ? String.fromCharCode(0x41 + num - 1) : null
    case 5:
      return num <= 26 ? String.fromCharCode(0x61 + num - 1) : null
    case 6:
      return num <= 26 ? String.fromCharCode(0x24b6 + num - 1) : null
    case 7:
      return num <= 26 ? String.fromCharCode(0x24d0 + num - 1) : null
    default:
      return null
  }
}

function readExplicitSectionPageFormat(doc, sec) {
  if (typeof doc.getPageNumberPos === 'function') {
    const res = tryOr(() => parseJson(doc.getPageNumberPos(sec), null), null)
    const fmt = res?.pageNumber?.format
    if (Number.isInteger(fmt)) return fmt
    return null
  }
  if (typeof doc.getPageNumberPosition === 'function') {
    const res = tryOr(() => parseJson(doc.getPageNumberPosition(sec), null), null)
    if (res?.exists && Number.isInteger(res.format)) return res.format
    return null
  }
  return null
}

function readSectionPageFormat(doc, sec, cache) {
  if (cache.has(sec)) return cache.get(sec)
  const explicit = readExplicitSectionPageFormat(doc, sec)
  let format = 0
  if (explicit !== null) {
    format = explicit
  } else if (sec > 0) {
    format = readSectionPageFormat(doc, sec - 1, cache)
  }
  cache.set(sec, format)
  return format
}

/**
 * Resolve the printed page number and formatted page label (respecting
 * new-number starts and section page-number formats such as Roman numerals)
 * for a body paragraph.
 */
export function readPrintedPageLabel(doc, sec, para, caches = null) {
  const pageInfoCache = caches?.pageInfoCache ?? new Map()
  const pageFormatCache = caches?.pageFormatCache ?? new Map()

  let pageIdx = 0
  if (typeof doc.getPageOfPosition === 'function') {
    const pos = tryOr(() => parseJson(doc.getPageOfPosition(sec, para), null), null)
    if (pos && pos.ok !== false && Number.isInteger(pos.page) && pos.page >= 0) {
      pageIdx = pos.page
    }
  }
  const physicalPage = pageIdx + 1

  let info = pageInfoCache.get(pageIdx)
  if (info === undefined) {
    info =
      typeof doc.getPageInfo === 'function'
        ? tryOr(() => parseJson(doc.getPageInfo(pageIdx), null), null)
        : null
    pageInfoCache.set(pageIdx, info)
  }

  const printed =
    info && Number.isInteger(info.pageNumber) && info.pageNumber >= 1
      ? info.pageNumber
      : physicalPage
  const sectionForFormat =
    info && Number.isInteger(info.sectionIndex) && info.sectionIndex >= 0 ? info.sectionIndex : sec
  const format = readSectionPageFormat(doc, sectionForFormat, pageFormatCache)
  const formatted = formatPageNumberLabel(printed, format)

  return {
    page: printed,
    label: formatted ?? String(printed),
    physicalPage,
  }
}

/** Resolve a TOC kind key (`'body' | 'table' | 'figure' | 'equation'`) or Korean ID to `{ kind, kindId }`. */
export function resolveTocKind(kind = 'body') {
  if (typeof kind !== 'string') return null
  if (Object.prototype.hasOwnProperty.call(TOC_KINDS, kind)) {
    return { kind, kindId: TOC_KINDS[kind] }
  }
  if (Object.prototype.hasOwnProperty.call(KIND_BY_ID, kind) && kind.length > 0) {
    const resolvedKind = KIND_BY_ID[kind]
    return { kind: resolvedKind, kindId: TOC_KINDS[resolvedKind] }
  }
  return null
}

/** Per-document `설정:` key storing a TOC block's options and expected lines. */
export function tocSettingKey(kind = 'body') {
  const resolved = resolveTocKind(kind)
  if (!resolved) throw new RangeError(`Unsupported TOC kind: ${String(kind)}`)
  return `차례:${resolved.kindId}`
}

/** List all paired `차례:` TOC range marks in the document. */
export function listTocRanges(doc) {
  if (!doc) return []
  const { ranges } = findRangeMarks(doc, [MARK_PREFIXES.toc])
  return ranges.map((range) => {
    const kind = KIND_BY_ID[range.id] ?? 'body'
    const kindId = range.id || TOC_KINDS.body
    return {
      kind,
      kindId,
      id: range.id,
      key: range.key,
      start: range.start,
      end: range.end,
    }
  })
}

/** Locate the paired `차례:` range mark for `kind` (matching both `차례:본문` and bare `차례:` for body). */
export function findTocRange(doc, kind = 'body') {
  const resolved = resolveTocKind(kind)
  if (!resolved) return null
  const ranges = listTocRanges(doc)
  if (resolved.kind === 'body') {
    return ranges.find((r) => r.id === TOC_KINDS.body) ?? ranges.find((r) => r.id === '') ?? null
  }
  return ranges.find((r) => r.id === resolved.kindId) ?? null
}

/** Read the stored TOC metadata for `kind` from `설정:` bookmarks, or `null` if absent. */
export function readTocMeta(doc, kind = 'body') {
  const resolved = resolveTocKind(kind)
  if (!doc || !resolved) return null
  const primary = readDocSetting(doc, tocSettingKey(resolved.kind), null)
  if (primary && typeof primary === 'object' && !Array.isArray(primary)) {
    return primary
  }
  if (resolved.kind === 'body') {
    const legacy = readDocSetting(doc, '차례', null)
    if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
      return legacy
    }
  }
  return null
}

function classifyPlaceError(doc, place) {
  if (!place || typeof place !== 'object') return 'unsupported_place'
  const isTextBox = place.inTextBox === true || place.isTextBox === true
  if (isTextBox) return 'unsupported_place'
  if (
    place.inTable === true ||
    place.cellContext != null ||
    place.parentParaIndex != null ||
    place.cellIndex != null ||
    place.cellParaIndex != null ||
    (Array.isArray(place.cellPath) && place.cellPath.length > 0) ||
    (Array.isArray(place.path) && place.path.length > 0)
  ) {
    return 'in_table'
  }
  if (
    place.inNote === true ||
    place.inFootnote === true ||
    place.inEndnote === true ||
    place.inHeaderFooter === true ||
    place.isHeader === true ||
    place.isFooter === true ||
    place.equationControl != null ||
    place.noteIndex != null ||
    place.noteType != null ||
    place.headerFooter != null ||
    (typeof place.place === 'string' && place.place !== 'body')
  ) {
    return 'unsupported_place'
  }
  const sec = place.sec ?? place.sectionIndex
  const para = place.para ?? place.paraIndex ?? place.paragraphIndex
  if (!Number.isInteger(sec) || !Number.isInteger(para)) return 'unsupported_place'
  const secCount = doc.getSectionCount()
  if (sec < 0 || sec >= secCount) return 'not_found'
  const paraCount = doc.getParagraphCount(sec)
  if (para < 0 || para >= paraCount) return 'not_found'
  return null
}

function readAllBookmarkNames(doc) {
  if (!doc || typeof doc.getBookmarks !== 'function') return new Set()
  const raw = tryOr(() => parseJson(doc.getBookmarks(), []), [])
  if (!Array.isArray(raw)) return new Set()
  return new Set(raw.filter((bm) => bm && typeof bm.name === 'string').map((bm) => bm.name))
}

function buildBookmarkSlug(label, sec, para) {
  const cleaned = cleanText(label)
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  const fallback = `p${sec}_${para}`
  if (!cleaned) return fallback
  // Keep readable slug short so prefix + slug + numeric dedup suffix always fits <= 64 chars.
  return cleaned.slice(0, 40)
}

/**
 * Ensure a `제목:` (or custom prefix) bookmark exists at body paragraph `(sec, para)`.
 * Reuses an existing bookmark with the same prefix on that paragraph if present.
 */
export function ensureHeadingBookmark(doc, sec, para, label, options = {}) {
  const prefix = options.prefix ?? MARK_PREFIXES.heading
  const existingOnPara = listMarks(doc, [prefix]).find((m) => m.sec === sec && m.para === para)
  if (existingOnPara) {
    return { ok: true, name: existingOnPara.name, created: false, sec, para }
  }
  const usedNames = readAllBookmarkNames(doc)
  const slug = buildBookmarkSlug(label, sec, para)
  const baseName = encodeMarkName(prefix, [slug])
  const name = uniqueMarkName(usedNames, baseName, MAX_MARK_NAME_LEN)
  const res = addMark(doc, { sec, para, offset: 0 }, name)
  if (!res.ok) return res
  return { ok: true, name, created: true, sec, para }
}

/**
 * Collect body headings up to `maxLevel` (default 3) using `readOutline()`,
 * preserving the document's `설정:개요수준` > `appStyleMap` > default hierarchy.
 */
export function collectBodyTocEntries(doc, options = {}) {
  const maxLevel = options.maxLevel ?? DEFAULT_TOC_MAX_LEVEL
  const outline = readOutline(doc, { appStyleMap: options.appStyleMap })
  const entries = []
  for (const item of outline.items) {
    if (item.level > maxLevel) continue
    const title = cleanText(item.title)
    const number = cleanText(item.number)
    const text = cleanText(number ? `${number} ${title}` : title)
    if (!text) continue
    entries.push({
      level: item.level,
      number,
      title,
      text,
      page: item.page,
      pageLabel: item.pageLabel ?? String(item.page),
      physicalPage: item.physicalPage,
      sec: item.sec,
      para: item.para,
      source: item.source,
      styleName: item.styleName,
    })
  }
  return entries
}

function matchCaptionPrefix(text) {
  const cleaned = cleanText(text)
  if (!cleaned) return null
  const m = CAPTION_PREFIX_RE.exec(cleaned)
  if (!m) return null
  const label = m[1].toLowerCase().replace(/\.$/, '')
  if (label === '표' || label === '도표' || label === 'table') return 'table'
  if (label === '그림' || label === 'figure' || label === 'fig') return 'figure'
  if (label === '수식' || label === '식' || label === 'equation' || label === 'eq') {
    return 'equation'
  }
  return null
}

function isCaptionStyleName(name) {
  if (typeof name !== 'string') return false
  const trimmed = name.trim()
  if (!trimmed) return false
  return CAPTION_STYLES.has(trimmed) || trimmed.toLowerCase() === 'caption'
}

function readParaStyleInfo(doc, sec, para) {
  if (!doc || typeof doc.getStyleAt !== 'function') return { name: '', englishName: '' }
  const info = tryOr(() => parseJson(doc.getStyleAt(sec, para), null), null)
  return {
    name: typeof info?.name === 'string' ? info.name : '',
    englishName: typeof info?.englishName === 'string' ? info.englishName : '',
  }
}

function indexBodyControlsByFlatPara(doc) {
  const map = new Map()
  if (!doc || typeof doc.getControls !== 'function') return map
  const controls = tryOr(() => parseJson(doc.getControls(), null), null)
  if (!Array.isArray(controls)) return map
  for (const ctrl of controls) {
    if (!ctrl || ctrl.list !== 0 || !Number.isInteger(ctrl.para)) continue
    let bucket = map.get(ctrl.para)
    if (!bucket) {
      bucket = []
      map.set(ctrl.para, bucket)
    }
    bucket.push(ctrl)
  }
  return map
}

function kindFromBodyControl(ctrl) {
  if (!ctrl || typeof ctrl.ctrlId !== 'string') return null
  if (ctrl.ctrlId === 'tbl') return 'table'
  if (ctrl.ctrlId === 'eqed') return 'equation'
  if (ctrl.ctrlId === 'gso') return 'figure'
  return null
}

function inferCaptionKindFromControls(doc, sec, para, context) {
  if (!doc || typeof doc.getSectionCount !== 'function') return null
  const secCount = tryOr(() => doc.getSectionCount(), 0)
  if (!Number.isInteger(sec) || sec < 0 || sec >= secCount) return null
  const paraCount = tryOr(() => doc.getParagraphCount(sec), 0)
  if (!Number.isInteger(para) || para < 0 || para >= paraCount) return null

  const excludedRanges = context?.excludedRanges ?? null
  const controlsByFlat = context?.controlsByFlat ?? indexBodyControlsByFlatPara(doc)
  const candidates = [para, para - 1, para + 1]

  for (const p of candidates) {
    if (p < 0 || p >= paraCount) continue
    if (excludedRanges && isInsideMarkedToc(sec, p, excludedRanges)) continue
    const flat = flatBodyParaIndex(doc, sec, p)
    const controls = controlsByFlat.get(flat)
    if (Array.isArray(controls)) {
      for (const ctrl of controls) {
        const inferred = kindFromBodyControl(ctrl)
        if (inferred) return inferred
      }
    }
  }
  return null
}

function classifyObjectCaptionKind(objectKind, cleanedText) {
  if (objectKind === 'table') return 'table'
  if (objectKind === 'picture') return 'figure'
  if (objectKind === 'equation') return 'equation'
  if (objectKind === 'shape') {
    const byPrefix = matchCaptionPrefix(cleanedText)
    if (byPrefix === 'table' || byPrefix === 'equation') return byPrefix
    return 'figure'
  }
  return matchCaptionPrefix(cleanedText)
}

/**
 * Classify a body paragraph as a `'table' | 'figure' | 'equation'` caption, or `null`.
 * Matches recognized caption prefixes first; when styled with a caption style
 * without an explicit prefix, inspects controls on `(sec, para)`, `(sec, para - 1)`,
 * and `(sec, para + 1)` to infer the target kind.
 */
export function classifyCaptionParagraph(
  text,
  styleName = undefined,
  doc = null,
  sec = 0,
  para = 0,
  context = null,
) {
  const cleaned = cleanText(text)
  if (!cleaned) return null

  const byPrefix = matchCaptionPrefix(cleaned)
  if (byPrefix) return byPrefix

  let captionStyled
  if (styleName === undefined || styleName === null) {
    const info = readParaStyleInfo(doc, sec, para)
    captionStyled = isCaptionStyleName(info.name) || isCaptionStyleName(info.englishName)
  } else if (typeof styleName === 'object') {
    captionStyled = isCaptionStyleName(styleName.name) || isCaptionStyleName(styleName.englishName)
  } else {
    captionStyled = isCaptionStyleName(styleName)
  }

  if (!captionStyled) return null
  return inferCaptionKindFromControls(doc, sec, para, context)
}

/**
 * Collect table, figure, or equation TOC entries in strict document reading order
 * by combining real object captions (`doc.listObjectCaptions()`) with caption-styled
 * and prefix-matched body paragraphs.
 *
 * When `doc.listObjectCaptions` is unavailable, skips object captions without throwing,
 * still collects body caption paragraphs, and marks `objectCaptionsUnavailable: true`.
 */
export function collectCaptionTocEntries(doc, kind, options = {}) {
  const resolved = resolveTocKind(kind)
  if (!resolved || resolved.kind === 'body') {
    throw new RangeError(`Unsupported caption TOC kind: ${String(kind)}`)
  }
  const targetKind = resolved.kind
  const targetKindId = resolved.kindId

  if (!doc || typeof doc.getSectionCount !== 'function') {
    return { kind: targetKind, kindId: targetKindId, entries: [] }
  }

  const helpers = resolveHelpers(options)
  const excludedRanges = findRangeMarks(doc, [MARK_PREFIXES.toc, MARK_PREFIXES.indexBlock]).ranges
  const controlsByFlat = indexBodyControlsByFlatPara(doc)
  const classifyContext = { controlsByFlat, excludedRanges }

  let objectCaptionsUnavailable = false
  const candidates = []
  const objectCaptionKeys = new Set()

  // Source A: real object captions from `doc.listObjectCaptions()`.
  if (typeof doc.listObjectCaptions === 'function') {
    const rawObjects = tryOr(() => parseJson(doc.listObjectCaptions(), []), [])
    if (Array.isArray(rawObjects)) {
      for (let i = 0; i < rawObjects.length; i++) {
        const item = rawObjects[i]
        if (!item || item.hasCaption === false) continue
        const sec = item.sec
        const para = item.para
        if (!Number.isInteger(sec) || sec < 0 || !Number.isInteger(para) || para < 0) continue
        if (isInsideMarkedToc(sec, para, excludedRanges)) continue

        const cleaned = cleanText(item.text)
        if (!cleaned) continue
        const classified = classifyObjectCaptionKind(item.kind, cleaned)
        if (classified !== targetKind) continue

        objectCaptionKeys.add(`${sec}:${para}:${cleaned}`)
        candidates.push({
          sec,
          para,
          orderInPara: 1 + i,
          title: cleaned,
          text: cleaned,
          source: 'object-caption',
          objectKind: item.kind,
          ...(Number.isInteger(item.controlIndex) ? { controlIndex: item.controlIndex } : {}),
          ...(Array.isArray(item.cellPath) ? { cellPath: item.cellPath } : {}),
        })
      }
    }
  } else {
    objectCaptionsUnavailable = true
  }

  // Source B: caption-styled and prefix-matched body paragraphs.
  const secCount = doc.getSectionCount()
  for (let sec = 0; sec < secCount; sec++) {
    const paraCount = doc.getParagraphCount(sec)
    for (let para = 0; para < paraCount; para++) {
      if (isInsideMarkedToc(sec, para, excludedRanges)) continue
      const cleaned = cleanText(bodyText(doc, sec, para))
      if (!cleaned) continue

      const styleInfo = readParaStyleInfo(doc, sec, para)
      const classified = classifyCaptionParagraph(
        cleaned,
        styleInfo,
        doc,
        sec,
        para,
        classifyContext,
      )
      if (classified !== targetKind) continue

      // Deduplicate against an object caption on the same host paragraph with identical text.
      if (objectCaptionKeys.has(`${sec}:${para}:${cleaned}`)) continue

      candidates.push({
        sec,
        para,
        orderInPara: 0,
        title: cleaned,
        text: cleaned,
        source: 'caption-paragraph',
        ...(styleInfo.name ? { styleName: styleInfo.name } : {}),
      })
    }
  }

  // Sort strictly in document reading order: (sec, para, orderInPara).
  candidates.sort((a, b) => {
    if (a.sec !== b.sec) return a.sec - b.sec
    if (a.para !== b.para) return a.para - b.para
    return a.orderInPara - b.orderInPara
  })

  const entries = helpers.withPortableWidths(doc, () => {
    const caches = { pageInfoCache: new Map(), pageFormatCache: new Map() }
    return candidates.map(({ orderInPara: _orderInPara, ...item }) => {
      const measured = readPrintedPageLabel(doc, item.sec, item.para, caches)
      return {
        level: 1,
        ...item,
        page: measured.page,
        pageLabel: measured.label,
        physicalPage: measured.physicalPage,
      }
    })
  })

  return {
    kind: targetKind,
    kindId: targetKindId,
    entries,
    ...(objectCaptionsUnavailable
      ? { objectCaptionsUnavailable: true, warning: OBJECT_CAPTIONS_UNAVAILABLE_WARNING }
      : {}),
  }
}

function collectEntriesForKind(doc, kind, options, maxLevel) {
  if (typeof options.collectEntries === 'function') {
    const custom = options.collectEntries(doc, { ...options, kind, maxLevel })
    if (Array.isArray(custom)) {
      return { entries: custom, objectCaptionsUnavailable: false, warning: undefined }
    }
    return {
      entries: Array.isArray(custom?.entries) ? custom.entries : [],
      objectCaptionsUnavailable: custom?.objectCaptionsUnavailable === true,
      warning: typeof custom?.warning === 'string' ? custom.warning : undefined,
    }
  }
  if (kind === 'body') {
    return {
      entries: collectBodyTocEntries(doc, { maxLevel, appStyleMap: options.appStyleMap }),
      objectCaptionsUnavailable: false,
      warning: undefined,
    }
  }
  const collected = collectCaptionTocEntries(doc, kind, options)
  return {
    entries: collected.entries,
    objectCaptionsUnavailable: collected.objectCaptionsUnavailable === true,
    warning: collected.warning,
  }
}

function tableGridOf(doc, sec, para, controlIndex, rows, cols, cellCount) {
  const grid = []
  const count = Number.isInteger(cellCount) ? cellCount : rows * cols
  for (let cell = 0; cell < count; cell++) {
    const info =
      typeof doc.getCellInfo === 'function'
        ? tryOr(() => parseJson(doc.getCellInfo(sec, para, controlIndex, cell), null), null)
        : null
    if (info && Number.isInteger(info.row) && Number.isInteger(info.col)) {
      grid.push({ cell, row: info.row, col: info.col })
    } else {
      grid.push({ cell, row: Math.floor(cell / cols), col: cell % cols })
    }
  }
  return grid
}

function cellTextOf(doc, sec, para, controlIndex, cellIndex) {
  const paraCount = tryOr(() => doc.getCellParagraphCount(sec, para, controlIndex, cellIndex), 0)
  const parts = []
  for (let p = 0; p < paraCount; p++) {
    const len = tryOr(() => doc.getCellParagraphLength(sec, para, controlIndex, cellIndex, p), 0)
    if (len > 0) {
      parts.push(tryOr(() => doc.getTextInCell(sec, para, controlIndex, cellIndex, p, 0, len), ''))
    }
  }
  return cleanText(parts.join(' '))
}

function setCellFirstParaText(doc, sec, para, controlIndex, cellIndex, value) {
  const len = tryOr(() => doc.getCellParagraphLength(sec, para, controlIndex, cellIndex, 0), 0)
  if (len > 0) {
    doc.deleteTextInCell(sec, para, controlIndex, cellIndex, 0, 0, len)
  }
  if (value.length > 0) {
    doc.insertTextInCell(sec, para, controlIndex, cellIndex, 0, 0, value)
  }
}

function findTopLevelTableAt(doc, sec, para, helpers) {
  const { tables } = helpers.tablesOf(doc)
  return tables.find((t) => t.sec === sec && t.para === para && t.path.length === 1) ?? null
}

function isPageLabelTable(doc, table) {
  if (!table || table.cols !== 2 || table.rows < 1 || table.path.length !== 1) return false
  const controlIndex = table.path[0].controlIndex
  const grid = tableGridOf(
    doc,
    table.sec,
    table.para,
    controlIndex,
    table.rows,
    table.cols,
    table.cells,
  )
  let checked = 0
  for (let row = 0; row < table.rows; row++) {
    const pageCell = grid.find((c) => c.row === row && c.col === 1)
    if (!pageCell) return false
    const pageText = cellTextOf(doc, table.sec, table.para, controlIndex, pageCell.cell)
    if (!PAGE_LABEL_RE.test(pageText)) return false
    checked += 1
  }
  return checked > 0
}

function isLegacyTocLine(text) {
  const cleaned = cleanLinePreservingTab(text)
  if (!cleaned) return false
  return LEGACY_TAB_LINE_RE.test(cleaned) || LEGACY_DOTTED_LINE_RE.test(cleaned)
}

function isInsideMarkedToc(sec, para, markedRanges) {
  return markedRanges.some(
    (r) =>
      r.start.sec <= sec &&
      sec <= r.end.sec &&
      (sec > r.start.sec || para >= r.start.para) &&
      (sec < r.end.sec || para <= r.end.para),
  )
}

/**
 * Detect an unmarked legacy or externally created TOC (either dotted/tab lines
 * under a `차례`/`목차` heading or a 2-column TOC table). Returns `null` when none exists.
 */
export function detectLegacyToc(doc, options = {}) {
  if (!doc || typeof doc.getSectionCount !== 'function') return null
  const helpers = resolveHelpers(options)
  const markedRanges = listTocRanges(doc)
  const { tables } = helpers.tablesOf(doc)
  const topTables = tables.filter((t) => t.path.length === 1)

  // Check tables made by the legacy `insertToc` call when `made` history is provided.
  if (helpers.contentsOf && Array.isArray(options.made) && options.made.length > 0) {
    const found = tryOr(() => helpers.contentsOf(doc, options.made), null)
    if (found && Number.isInteger(found.table) && found.table >= 1) {
      const table = tables[found.table - 1]
      if (table && !isInsideMarkedToc(table.sec, table.para, markedRanges)) {
        const hasTitleAbove =
          typeof found.title === 'string' && found.title.length > 0 && table.para > 0
        return {
          found: true,
          source: 'table',
          sec: table.sec,
          startPara: hasTitleAbove ? table.para - 1 : table.para,
          endPara: table.para,
          title: found.title ?? null,
          tableIndex: found.table,
          tablePara: table.para,
          tableControlIndex: table.path[0].controlIndex,
        }
      }
    }
  }

  const secCount = doc.getSectionCount()
  for (let sec = 0; sec < secCount; sec++) {
    const paraCount = doc.getParagraphCount(sec)
    for (let para = 0; para < paraCount; para++) {
      if (isInsideMarkedToc(sec, para, markedRanges)) continue
      const len = tryOr(() => doc.getParagraphLength(sec, para), 0)
      if (len === 0 || len > TOC_TITLE_CHARS) continue
      const rawTitle = bodyText(doc, sec, para)
      const compactTitle = cleanText(rawTitle).replace(/\s/g, '')
      if (!TOC_TITLES.includes(compactTitle)) continue

      let next = para + 1
      while (next < paraCount && !cleanText(bodyText(doc, sec, next))) {
        const tableAtBlank = topTables.find((t) => t.sec === sec && t.para === next)
        if (tableAtBlank) break
        next += 1
      }
      if (next >= paraCount || isInsideMarkedToc(sec, next, markedRanges)) continue

      // Check for a legacy 2-column TOC table immediately below the title line.
      const candidateTable = topTables.find((t) => t.sec === sec && t.para === next)
      if (candidateTable && isPageLabelTable(doc, candidateTable)) {
        const tableIndex = tables.indexOf(candidateTable) + 1
        return {
          found: true,
          source: 'table',
          sec,
          startPara: para,
          endPara: next,
          title: cleanText(rawTitle),
          tableIndex,
          tablePara: next,
          tableControlIndex: candidateTable.path[0].controlIndex,
        }
      }

      // Check for legacy dotted or tabbed TOC entry lines.
      if (isLegacyTocLine(bodyText(doc, sec, next))) {
        let endPara = next
        while (
          endPara + 1 < paraCount &&
          !isInsideMarkedToc(sec, endPara + 1, markedRanges) &&
          isLegacyTocLine(bodyText(doc, sec, endPara + 1))
        ) {
          endPara += 1
        }
        return {
          found: true,
          source: 'lines',
          sec,
          startPara: para,
          endPara,
          title: cleanText(rawTitle),
        }
      }
    }
  }

  return null
}

/**
 * Read the normalized plain-text lines inside a marked TOC range
 * so manual edits and staleness can be checked consistently for both layouts.
 */
function readTocRangeLines(doc, range, layout, helpers) {
  if (!range || range.start.sec !== range.end.sec) return []
  const sec = range.start.sec
  const paraCount = doc.getParagraphCount(sec)
  const startPara = Math.max(0, range.start.para)
  const endPara = Math.min(paraCount - 1, range.end.para)
  const lines = []

  for (let para = startPara; para <= endPara; para++) {
    const table = layout === 'table' ? findTopLevelTableAt(doc, sec, para, helpers) : null
    if (table && table.cols === 2) {
      const controlIndex = table.path[0].controlIndex
      const grid = tableGridOf(doc, sec, para, controlIndex, table.rows, table.cols, table.cells)
      for (let row = 0; row < table.rows; row++) {
        const headingCell = grid.find((c) => c.row === row && c.col === 0)
        const pageCell = grid.find((c) => c.row === row && c.col === 1)
        const headingText = headingCell
          ? cellTextOf(doc, sec, para, controlIndex, headingCell.cell)
          : ''
        const pageText = pageCell ? cellTextOf(doc, sec, para, controlIndex, pageCell.cell) : ''
        lines.push(`${headingText}\t${pageText}`)
      }
      continue
    }
    lines.push(cleanLinePreservingTab(bodyText(doc, sec, para)))
  }

  return lines
}

function clearHyperlinksInBodyPara(doc, sec, para) {
  if (
    typeof doc.getHyperlinkContext !== 'function' ||
    typeof doc.removeHyperlinkEx !== 'function'
  ) {
    return
  }
  const target = { section: sec, para, cellPath: [] }
  const ctx = tryOr(() => parseJson(doc.getHyperlinkContext(JSON.stringify(target)), null), null)
  if (!ctx || !Array.isArray(ctx.links) || ctx.links.length === 0) return

  // Engine rejects `removeHyperlinkEx` on paragraphs that currently contain bookmark controls
  // (e.g. `설정:` bookmarks on para 0). Temporarily lift them, remove links, then restore them.
  const lifted = []
  const onPara = listBodyBookmarksAt(doc, sec, para)
  for (const mark of [...onPara].sort((a, b) => b.ctrlIdx - a.ctrlIdx)) {
    lifted.push({ name: mark.name, offset: mark.offset })
    removeMark(doc, mark)
  }
  lifted.reverse()

  for (const link of [...ctx.links].reverse()) {
    tryOr(
      () =>
        doc.removeHyperlinkEx(
          JSON.stringify({ target, fieldId: link.fieldId, restoreFormatting: false }),
        ),
      null,
    )
  }

  for (const mark of lifted) {
    addMark(doc, { sec, para, offset: mark.offset }, mark.name)
  }
}

function listBodyBookmarksAt(doc, sec, para) {
  if (!doc || typeof doc.getBookmarks !== 'function') return []
  const raw = tryOr(() => parseJson(doc.getBookmarks(), []), [])
  if (!Array.isArray(raw)) return []
  const flatPara = flatBodyParaIndex(doc, sec, para)
  let bodyCtrlIndices = null
  if (typeof doc.getControls === 'function') {
    const controls = tryOr(() => parseJson(doc.getControls(), null), null)
    if (Array.isArray(controls)) {
      bodyCtrlIndices = new Set(
        controls
          .filter((c) => c && c.list === 0 && c.ctrlId === 'bokm' && c.para === flatPara)
          .map((c) => c.controlIndex),
      )
    }
  }
  const byCtrl = new Map()
  for (const bm of raw) {
    if (!bm || typeof bm.name !== 'string') continue
    const bmSec = bm.sec ?? bm.sectionIndex ?? 0
    const bmPara = bm.para ?? bm.paraIndex ?? 0
    const ctrlIdx = bm.ctrlIdx ?? bm.controlIndex ?? 0
    const offset = bm.charPos ?? bm.charOffset ?? bm.offset ?? 0
    if (bmSec !== sec || bmPara !== para) continue
    if (bodyCtrlIndices && !bodyCtrlIndices.has(ctrlIdx)) continue
    if (!byCtrl.has(ctrlIdx)) {
      byCtrl.set(ctrlIdx, { name: bm.name, sec: bmSec, para: bmPara, offset, ctrlIdx })
    }
  }
  return [...byCtrl.values()].sort((a, b) => a.ctrlIdx - b.ctrlIdx)
}

/**
 * Remove the contents of `[startPara .. endPara]` while keeping `startPara` as an
 * empty reusable paragraph so paragraph-0 layout controls (`secd`, `cold`, `pgnp`, ...)
 * and `설정:` bookmarks stay intact and all following paragraphs keep their exact styles.
 */
function prepareReplaceSlot(doc, sec, startPara, endPara, rangeMarksToRemove, helpers) {
  // 1. Delete old TOC range marks first in reverse control order via doc-marks safe removal.
  if (Array.isArray(rangeMarksToRemove) && rangeMarksToRemove.length > 0) {
    const ordered = [...rangeMarksToRemove].sort((a, b) => {
      if (a.sec !== b.sec) return b.sec - a.sec
      if (a.para !== b.para) return b.para - a.para
      return b.ctrlIdx - a.ctrlIdx
    })
    for (const mark of ordered) {
      removeMark(doc, mark)
    }
  }

  // 2. Delete any top-level tables inside the old TOC range in reverse order.
  const { tables } = helpers.tablesOf(doc)
  const inRangeTables = tables
    .filter((t) => t.sec === sec && t.para >= startPara && t.para <= endPara && t.path.length === 1)
    .sort((a, b) =>
      a.para !== b.para ? b.para - a.para : b.path[0].controlIndex - a.path[0].controlIndex,
    )
  for (const table of inRangeTables) {
    if (typeof doc.deleteTableControl === 'function') {
      tryOr(() => doc.deleteTableControl(sec, table.para, table.path[0].controlIndex), null)
    }
  }

  // 3. Delete trailing paragraphs `endPara` down to `startPara + 1`.
  for (let p = endPara; p > startPara; p--) {
    doc.deleteParagraph(sec, p)
  }

  // 4. Clear hyperlinks, text, and direct paragraph formatting on the kept `startPara`.
  clearHyperlinksInBodyPara(doc, sec, startPara)
  const len = tryOr(() => doc.getParagraphLength(sec, startPara), 0)
  if (len > 0) {
    doc.deleteRange(sec, startPara, 0, startPara, len)
  }
  clearHyperlinksInBodyPara(doc, sec, startPara)
  tryOr(
    () =>
      doc.applyParaFormat(
        sec,
        startPara,
        JSON.stringify({ tabStops: [], marginLeft: 0, alignment: 'left' }),
      ),
    null,
  )
}

function applyTitleParagraph(doc, sec, para, titleText, look) {
  doc.insertText(sec, para, 0, titleText)
  const titleStyleId = styleIdOf(doc, TOC_TITLE_STYLE)
  if (titleStyleId !== null) {
    doc.applyStyle(sec, para, titleStyleId)
    return
  }
  const bodyStyleId = styleIdOf(doc, BODY_STYLE) ?? 0
  doc.applyStyle(sec, para, bodyStyleId)
  const charProps = {
    ...(look.title.font.family ? { fontFamily: look.title.font.family } : {}),
    fontSize: Math.round((look.title.font.points || 10) * 100),
    bold: true,
    ...(HEX_COLOR_RE.test(look.title.color ?? '') ? { textColor: look.title.color } : {}),
  }
  doc.applyCharFormat(sec, para, 0, titleText.length, JSON.stringify(charProps))
  doc.applyParaFormat(
    sec,
    para,
    JSON.stringify({ alignment: 'center', tabStops: [], marginLeft: 0 }),
  )
}

function replaceDottedTabPageLabel(doc, sec, para, newLabel) {
  const text = bodyText(doc, sec, para)
  const tabIdx = text.lastIndexOf('\t')
  if (tabIdx < 0) return false
  const currentLabel = text.slice(tabIdx + 1)
  if (currentLabel === newLabel) return false
  if (currentLabel.length > 0) {
    doc.deleteText(sec, para, tabIdx + 1, currentLabel.length)
  }
  if (newLabel.length > 0) {
    doc.insertText(sec, para, tabIdx + 1, newLabel)
  }
  return true
}

function insertHyperlinkSafe(doc, target, start, end, bookmarkName) {
  if (typeof doc.insertHyperlinkEx !== 'function' || end <= start) {
    return { ok: false, error: 'insertHyperlinkEx unavailable' }
  }
  try {
    const res = doc.insertHyperlinkEx(
      JSON.stringify({
        target,
        start,
        end,
        uri: `#${bookmarkName}`,
      }),
    )
    if (res && typeof res === 'object' && res.ok === false) {
      return { ok: false, error: res.error ?? 'insertHyperlinkEx failed' }
    }
    return { ok: true, fieldId: res }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function executeTocWrite(doc, config) {
  const {
    kind,
    kindId,
    layout,
    maxLevel,
    links,
    titled,
    trimmedTitle,
    sec,
    insertPara,
    reuseFirst,
    entries,
    anchorPrefix,
    helpers,
    objectCaptionsUnavailable,
    warning,
  } = config

  const totalParas = (titled ? 1 : 0) + (layout === 'table' ? 1 : entries.length)
  const splits = reuseFirst ? Math.max(0, totalParas - 1) : totalParas

  // Rescue all non-setting body bookmarks (`제목:`, `색인:`, user bookmarks, etc.) on
  // `(sec, insertPara)` before fresh split so they move with the original paragraph and
  // never remain on the TOC's first entry (where bookmarks would block `insertHyperlinkEx`).
  const rescuedBodyMarks = []
  if (!reuseFirst) {
    const onInsertPara = listBodyBookmarksAt(doc, sec, insertPara).filter(
      (m) => !m.name.startsWith(MARK_PREFIXES.setting),
    )
    for (const mark of [...onInsertPara].sort((a, b) => b.ctrlIdx - a.ctrlIdx)) {
      rescuedBodyMarks.push({ name: mark.name, offset: mark.offset })
      removeMark(doc, mark)
    }
    rescuedBodyMarks.reverse()
  }

  // If para 0 will hold a linked dotted-tab entry (no title), temporarily lift `설정:` bookmarks
  // off para 0 because the engine rejects `insertHyperlinkEx` on paragraphs that already have bookmarks.
  const rescuedSettingNames = []
  const needsSettingLift =
    sec === 0 && insertPara === 0 && !titled && layout === 'dotted-tab' && links
  if (needsSettingLift) {
    const settingOnZero = listMarks(doc, [MARK_PREFIXES.setting]).filter(
      (m) => m.sec === 0 && m.para === 0,
    )
    for (const mark of [...settingOnZero].sort((a, b) => b.ctrlIdx - a.ctrlIdx)) {
      rescuedSettingNames.push(mark.name)
      removeMark(doc, mark)
    }
    rescuedSettingNames.reverse()
  }

  // Allocate `totalParas` paragraphs starting at `(sec, insertPara)`.
  for (let i = 0; i < splits; i++) {
    doc.splitParagraph(sec, insertPara, 0)
  }

  // Re-attach rescued bookmarks onto the shifted original paragraph.
  for (const rescued of rescuedBodyMarks) {
    addMark(doc, { sec, para: insertPara + splits, offset: rescued.offset }, rescued.name)
  }

  // Shift target entry coordinates for the newly inserted paragraphs.
  const shiftedEntries = entries.map((entry) => ({
    ...entry,
    sec: entry.sec,
    para:
      entry.sec === sec && entry.para >= (reuseFirst ? insertPara + 1 : insertPara)
        ? entry.para + splits
        : entry.para,
  }))

  const look = helpers.tocLookOf(doc, shiftedEntries)
  const widthPt = helpers.textWidthPt(doc, sec)
  const colWidthUnits = helpers.columnWidthUnits(doc, sec)
  const bodyStyleId = styleIdOf(doc, BODY_STYLE) ?? 0
  const tabPosition = 2 * colWidthUnits
  const rightDotTabStops = [
    { position: tabPosition, type: TAB_ALIGNS.right, fill: TAB_LEADERS.dots },
  ]

  let cursorPara = insertPara
  if (titled) {
    applyTitleParagraph(doc, sec, cursorPara, trimmedTitle, look)
    cursorPara += 1
  }

  let lastTocPara = cursorPara
  let linksApplied = false
  let linksUnsupportedInTable = false
  let finalEntries
  const expectedLines = []
  if (titled) expectedLines.push(trimmedTitle)

  if (layout === 'dotted-tab') {
    const entryStartPara = cursorPara
    // Step 1: Write entries with initial page labels + style + right dot-leader tab stop.
    for (let i = 0; i < shiftedEntries.length; i++) {
      const entry = shiftedEntries[i]
      const p = entryStartPara + i
      const displayText = clipText(entry.text, MAX_TOC_TEXT)
      const initialLabel = entry.pageLabel ?? String(entry.page ?? 1)
      doc.insertText(sec, p, 0, `${displayText}\t${initialLabel}`)

      const levelLook = look.levels.get(entry.level) ?? {
        style: null,
        font: bodyFontOf(doc),
        indentPt: (entry.level - 1) * DEFAULT_TOC_INDENT_PT,
      }
      if (levelLook.style !== null) {
        doc.applyStyle(sec, p, levelLook.style)
        doc.applyParaFormat(sec, p, JSON.stringify({ tabStops: rightDotTabStops }))
      } else {
        doc.applyStyle(sec, p, bodyStyleId)
        const paraProps = {
          tabStops: rightDotTabStops,
          marginLeft: levelLook.indentPt > 0 ? paraUnitsOf(levelLook.indentPt) : 0,
        }
        doc.applyParaFormat(sec, p, JSON.stringify(paraProps))
        if (levelLook.font?.family || levelLook.font?.points) {
          const lineLen = doc.getParagraphLength(sec, p)
          if (lineLen > 0) {
            doc.applyCharFormat(
              sec,
              p,
              0,
              lineLen,
              JSON.stringify({
                ...(levelLook.font.family ? { fontFamily: levelLook.font.family } : {}),
                ...(levelLook.font.points
                  ? { fontSize: Math.round(levelLook.font.points * 100) }
                  : {}),
              }),
            )
          }
        }
      }
      entry.displayText = displayText
    }
    lastTocPara = entryStartPara + shiftedEntries.length - 1

    // Step 2: Measure printed pages AFTER insertion under portable widths (with convergence pass).
    finalEntries = helpers.withPortableWidths(doc, () => {
      let current = shiftedEntries.map((e) => ({ ...e }))
      for (let pass = 0; pass < MAX_CONVERGENCE_PASSES; pass++) {
        const caches = { pageInfoCache: new Map(), pageFormatCache: new Map() }
        let anyChanged = false
        for (let i = 0; i < current.length; i++) {
          const measured = readPrintedPageLabel(doc, current[i].sec, current[i].para, caches)
          current[i].page = measured.page
          current[i].pageLabel = measured.label
          current[i].physicalPage = measured.physicalPage
          const changed = replaceDottedTabPageLabel(doc, sec, entryStartPara + i, measured.label)
          if (changed) anyChanged = true
        }
        if (!anyChanged) break
      }
      return current
    })

    // Step 3: Ensure heading bookmarks and attach internal hyperlinks BEFORE range marks.
    if (links) {
      let linkedCount = 0
      for (let i = 0; i < finalEntries.length; i++) {
        const entry = finalEntries[i]
        const bm = ensureHeadingBookmark(doc, entry.sec, entry.para, entry.text, {
          prefix: anchorPrefix,
        })
        if (!bm.ok) continue
        entry.bookmark = bm.name
        const linkRes = insertHyperlinkSafe(
          doc,
          { section: sec, para: entryStartPara + i, cellPath: [] },
          0,
          entry.displayText.length,
          bm.name,
        )
        if (linkRes.ok) linkedCount += 1
      }
      linksApplied = linkedCount === finalEntries.length
    }

    for (const entry of finalEntries) {
      expectedLines.push(`${entry.displayText}\t${entry.pageLabel}`)
    }
  } else {
    // Table layout: 2-column borderless table reusing `tocHtml` and `tocLookOf`.
    const holder = cursorPara
    lastTocPara = holder
    doc.applyStyle(sec, holder, bodyStyleId)
    const rows = shiftedEntries.map((entry) => {
      const levelLook = look.levels.get(entry.level) ?? {
        style: null,
        font: bodyFontOf(doc),
        indentPt: (entry.level - 1) * DEFAULT_TOC_INDENT_PT,
      }
      const displayText = helpers.oneLine(clipText(entry.text, MAX_TOC_TEXT), levelLook, widthPt)
      entry.displayText = displayText
      return {
        text: displayText,
        look: levelLook,
        page: entry.pageLabel ?? String(entry.page ?? 0),
      }
    })
    doc.pasteHtml(sec, holder, 0, helpers.tocHtml(rows, widthPt))

    const table = findTopLevelTableAt(doc, sec, holder, helpers)
    if (!table) {
      throw new Error('Failed to create table of contents table')
    }
    const controlIndex = table.path[0].controlIndex
    const grid = tableGridOf(doc, sec, holder, controlIndex, table.rows, table.cols, table.cells)

    // Measure printed pages AFTER the table is inserted under portable widths (with convergence pass).
    finalEntries = helpers.withPortableWidths(doc, () => {
      let current = shiftedEntries.map((e) => ({ ...e }))
      for (let pass = 0; pass < MAX_CONVERGENCE_PASSES; pass++) {
        const caches = { pageInfoCache: new Map(), pageFormatCache: new Map() }
        let anyChanged = false
        for (let i = 0; i < current.length; i++) {
          const measured = readPrintedPageLabel(doc, current[i].sec, current[i].para, caches)
          const pageCell = grid.find((c) => c.row === i && c.col === 1)
          const prevText = pageCell ? cellTextOf(doc, sec, holder, controlIndex, pageCell.cell) : ''
          current[i].page = measured.page
          current[i].pageLabel = measured.label
          current[i].physicalPage = measured.physicalPage
          if (pageCell && prevText !== measured.label) {
            setCellFirstParaText(doc, sec, holder, controlIndex, pageCell.cell, measured.label)
            anyChanged = true
          }
        }
        if (!anyChanged) break
      }
      return current
    })

    // Apply `차례 N` cell styles when available.
    for (let i = 0; i < finalEntries.length; i++) {
      const levelLook = look.levels.get(finalEntries[i].level)
      if (levelLook && levelLook.style !== null && typeof doc.applyCellStyle === 'function') {
        for (const col of [0, 1]) {
          const cell = grid.find((c) => c.row === i && c.col === col)
          if (cell) {
            tryOr(
              () => doc.applyCellStyle(sec, holder, controlIndex, cell.cell, 0, levelLook.style),
              null,
            )
          }
        }
      }
    }

    // Attempt internal bookmark links inside heading column cells; degrade gracefully if refused.
    if (links) {
      let linkedCount = 0
      for (let i = 0; i < finalEntries.length; i++) {
        const entry = finalEntries[i]
        const headingCell = grid.find((c) => c.row === i && c.col === 0)
        if (!headingCell) {
          linksUnsupportedInTable = true
          continue
        }
        const bm = ensureHeadingBookmark(doc, entry.sec, entry.para, entry.text, {
          prefix: anchorPrefix,
        })
        if (!bm.ok) {
          linksUnsupportedInTable = true
          continue
        }
        entry.bookmark = bm.name
        const cellLen = tryOr(
          () => doc.getCellParagraphLength(sec, holder, controlIndex, headingCell.cell, 0),
          0,
        )
        const linkRes = insertHyperlinkSafe(
          doc,
          { section: sec, para: holder, cellPath: [[controlIndex, headingCell.cell, 0]] },
          0,
          cellLen,
          bm.name,
        )
        if (linkRes.ok) {
          linkedCount += 1
        } else {
          linksUnsupportedInTable = true
        }
      }
      linksApplied = linkedCount === finalEntries.length && !linksUnsupportedInTable
    }

    for (let i = 0; i < finalEntries.length; i++) {
      const headingCell = grid.find((c) => c.row === i && c.col === 0)
      const pageCell = grid.find((c) => c.row === i && c.col === 1)
      const headingText = headingCell
        ? cellTextOf(doc, sec, holder, controlIndex, headingCell.cell)
        : finalEntries[i].displayText
      const pageText = pageCell
        ? cellTextOf(doc, sec, holder, controlIndex, pageCell.cell)
        : finalEntries[i].pageLabel
      expectedLines.push(`${headingText}\t${pageText}`)
    }
  }

  // Restore any temporarily lifted `설정:` bookmarks at `(0, 0, 0)`.
  for (const name of rescuedSettingNames) {
    addMark(doc, { sec: 0, para: 0, offset: 0 }, name)
  }

  // Wrap the TOC block with paired `차례:<kindId>:시작` / `차례:<kindId>:끝` range marks.
  const endOffset = tryOr(() => doc.getParagraphLength(sec, lastTocPara), 0)
  const rangeRes = addRangeMark(
    doc,
    MARK_PREFIXES.toc,
    kindId,
    { sec, para: insertPara, offset: 0 },
    { sec, para: lastTocPara, offset: endOffset },
  )
  if (!rangeRes.ok) {
    return {
      ok: false,
      reason: 'engine_error',
      error: rangeRes.error ?? rangeRes.reason ?? 'addRangeMark failed',
    }
  }

  // Persist TOC options and expected plain-text lines in `설정:차례:<kindId>`.
  writeDocSetting(doc, tocSettingKey(kind), {
    v: 1,
    kind,
    layout,
    maxLevel,
    links: links && !linksUnsupportedInTable,
    title: titled ? trimmedTitle : null,
    lines: expectedLines,
  })

  return {
    ok: true,
    kind,
    kindId,
    layout,
    count: finalEntries.length,
    pages: finalEntries.map((e) => e.page),
    pageLabels: finalEntries.map((e) => e.pageLabel),
    entries: finalEntries.map(({ displayText: _displayText, ...rest }) => rest),
    range: { sec, startPara: insertPara, endPara: lastTocPara },
    linksApplied,
    ...(linksUnsupportedInTable ? { linksUnsupportedInTable: true } : {}),
    ...(objectCaptionsUnavailable ? { objectCaptionsUnavailable: true, warning } : {}),
    place: { sec, para: insertPara, offset: 0, length: titled ? trimmedTitle.length : 0 },
  }
}

/**
 * Insert a marked TOC block before the given body paragraph `place`.
 * Refuses when `place` is inside a table cell or non-body area, when a TOC of the same
 * kind already exists, when an unmarked legacy TOC is detected (unless `replaceLegacy: true`),
 * or when no entries match.
 */
export function insertTocBlock(doc, place, options = {}) {
  if (!doc || typeof doc.getSectionCount !== 'function') {
    return { ok: false, reason: 'unsupported_place' }
  }
  const resolvedKind = resolveTocKind(options.kind ?? 'body')
  if (!resolvedKind) {
    return { ok: false, reason: 'invalid_options', error: 'unsupported TOC kind' }
  }
  const { kind, kindId } = resolvedKind

  const layout = options.layout ?? 'dotted-tab'
  if (!TOC_LAYOUTS.includes(layout)) {
    return { ok: false, reason: 'invalid_options', error: 'unsupported TOC layout' }
  }

  const maxLevel = options.maxLevel ?? DEFAULT_TOC_MAX_LEVEL
  if (!Number.isInteger(maxLevel) || maxLevel < MIN_OUTLINE_LEVEL || maxLevel > MAX_OUTLINE_LEVEL) {
    return { ok: false, reason: 'invalid_options', error: 'maxLevel must be 1..10' }
  }

  const links = options.links !== false
  const defaultTitle = DEFAULT_TOC_TITLES[kind] ?? DEFAULT_TOC_TITLE
  const rawTitle = options.title === undefined ? defaultTitle : options.title
  const trimmedTitle = typeof rawTitle === 'string' ? cleanText(rawTitle) : ''
  const titled = trimmedTitle.length > 0
  const helpers = resolveHelpers(options)
  const anchorPrefix = options.anchorPrefix ?? MARK_PREFIXES.heading

  const placeErr = classifyPlaceError(doc, place)
  if (placeErr) return { ok: false, reason: placeErr }
  const resolvedPlace = resolveBodyPlace(doc, place)
  if (!resolvedPlace) return { ok: false, reason: 'unsupported_place' }

  // Check for an already-marked TOC of the same kind.
  const existingMarked = findTocRange(doc, kind)
  if (existingMarked && options.replaceExisting !== true) {
    return { ok: false, reason: 'toc_exists', kind, kindId, range: existingMarked }
  }

  // Check for an unmarked legacy TOC when inserting a body TOC.
  let legacyToReplace = null
  if (!existingMarked && kind === 'body' && options.skipLegacyCheck !== true) {
    const legacy = detectLegacyToc(doc, options)
    if (legacy) {
      if (options.replaceLegacy !== true) {
        return { ok: false, reason: 'legacy_toc_found', legacy }
      }
      legacyToReplace = legacy
    }
  }

  // Collect entries BEFORE mutating so empty documents refuse with zero changes.
  const collected = collectEntriesForKind(doc, kind, options, maxLevel)
  const rawEntries = collected.entries
  const objectCaptionsUnavailable = collected.objectCaptionsUnavailable
  const warning = collected.warning

  const excludeRange = existingMarked
    ? {
        sec: existingMarked.start.sec,
        startPara: existingMarked.start.para,
        endPara: existingMarked.end.para,
      }
    : legacyToReplace
      ? {
          sec: legacyToReplace.sec,
          startPara: legacyToReplace.startPara,
          endPara: legacyToReplace.endPara,
        }
      : null

  const entries = excludeRange
    ? rawEntries.filter(
        (e) =>
          !(
            e.sec === excludeRange.sec &&
            e.para >= excludeRange.startPara &&
            e.para <= excludeRange.endPara
          ),
      )
    : rawEntries

  if (entries.length === 0) {
    return {
      ok: false,
      reason: 'no_entries',
      kind,
      kindId,
      ...(objectCaptionsUnavailable ? { objectCaptionsUnavailable: true, warning } : {}),
    }
  }

  // If replacing an existing marked or legacy TOC, collapse it to a clean reusable slot first.
  let targetSec = resolvedPlace.sec
  let insertPara = resolvedPlace.para
  let reuseFirst = false
  let adjustedEntries = entries

  if (existingMarked || legacyToReplace) {
    const replaceSec = existingMarked ? existingMarked.start.sec : legacyToReplace.sec
    const startPara = existingMarked ? existingMarked.start.para : legacyToReplace.startPara
    const endPara = existingMarked ? existingMarked.end.para : legacyToReplace.endPara
    const marksToRemove = existingMarked ? [existingMarked.start, existingMarked.end] : []
    prepareReplaceSlot(doc, replaceSec, startPara, endPara, marksToRemove, helpers)

    const removedCount = endPara - startPara
    adjustedEntries = entries.map((e) => ({
      ...e,
      para: e.sec === replaceSec && e.para > endPara ? e.para - removedCount : e.para,
    }))
    targetSec = replaceSec
    insertPara = startPara
    reuseFirst = true
  }

  return executeTocWrite(doc, {
    kind,
    kindId,
    layout,
    maxLevel,
    links,
    titled,
    trimmedTitle,
    sec: targetSec,
    insertPara,
    reuseFirst,
    entries: adjustedEntries,
    anchorPrefix,
    helpers,
    objectCaptionsUnavailable,
    warning,
  })
}

function inferTocLayout(doc, range, helpers) {
  if (!range || range.start.sec !== range.end.sec) return 'dotted-tab'
  const sec = range.start.sec
  const { tables } = helpers.tablesOf(doc)
  const hasTwoColTable = tables.some(
    (t) =>
      t.sec === sec &&
      t.path.length === 1 &&
      t.cols === 2 &&
      t.para >= range.start.para &&
      t.para <= range.end.para,
  )
  return hasTwoColTable ? 'table' : 'dotted-tab'
}

function inferTocHasTitle(doc, range, layout, helpers) {
  if (!range || range.start.sec !== range.end.sec) return false
  const sec = range.start.sec
  const startPara = range.start.para
  const endPara = range.end.para
  if (endPara <= startPara) return false
  if (layout === 'table') {
    const startTable = findTopLevelTableAt(doc, sec, startPara, helpers)
    return !(startTable && startTable.cols === 2)
  }
  const styleName =
    typeof doc.getStyleAt === 'function'
      ? tryOr(() => parseJson(doc.getStyleAt(sec, startPara), null)?.name ?? '', '')
      : ''
  if (styleName === TOC_TITLE_STYLE) return true
  const firstLine = cleanLinePreservingTab(bodyText(doc, sec, startPara))
  if (!firstLine) return false
  if (firstLine.includes('\t')) return false
  return true
}

function diffTocLines(expectedLines, actualLines) {
  const modifiedLines = []
  const maxLen = Math.max(expectedLines.length, actualLines.length)
  for (let i = 0; i < maxLen; i++) {
    const expected = expectedLines[i] ?? ''
    const actual = actualLines[i] ?? ''
    if (expected !== actual) {
      modifiedLines.push({ index: i, expected, actual })
    }
  }
  return modifiedLines
}

/**
 * Refresh an existing marked TOC block in place (or replace a detected unmarked legacy TOC
 * when `replaceLegacy: true`). Refuses without mutating when manual edits are detected
 * inside the TOC range unless `allowOverwriteManual: true`.
 */
export function refreshTocBlock(doc, options = {}) {
  if (!doc || typeof doc.getSectionCount !== 'function') {
    return { ok: false, reason: 'unsupported_place' }
  }
  const resolvedKind = resolveTocKind(options.kind ?? 'body')
  if (!resolvedKind) {
    return { ok: false, reason: 'invalid_options', error: 'unsupported TOC kind' }
  }
  const { kind, kindId } = resolvedKind
  const helpers = resolveHelpers(options)
  const anchorPrefix = options.anchorPrefix ?? MARK_PREFIXES.heading

  const range = findTocRange(doc, kind)
  if (!range) {
    if (kind === 'body') {
      const legacy = detectLegacyToc(doc, options)
      if (legacy) {
        if (options.replaceLegacy !== true) {
          return { ok: false, reason: 'legacy_toc_found', legacy }
        }
        return insertTocBlock(
          doc,
          { sec: legacy.sec, para: legacy.startPara },
          { ...options, kind, replaceLegacy: true },
        )
      }
    }
    return { ok: false, reason: 'not_found', kind, kindId }
  }

  if (range.start.sec !== range.end.sec) {
    return { ok: false, reason: 'unsupported_place', kind, kindId }
  }

  const meta = readTocMeta(doc, kind)
  const savedLayout =
    meta?.layout && TOC_LAYOUTS.includes(meta.layout)
      ? meta.layout
      : inferTocLayout(doc, range, helpers)
  const layout = options.layout ?? savedLayout
  if (!TOC_LAYOUTS.includes(layout)) {
    return { ok: false, reason: 'invalid_options', error: 'unsupported TOC layout' }
  }

  const maxLevel = options.maxLevel ?? meta?.maxLevel ?? DEFAULT_TOC_MAX_LEVEL
  if (!Number.isInteger(maxLevel) || maxLevel < MIN_OUTLINE_LEVEL || maxLevel > MAX_OUTLINE_LEVEL) {
    return { ok: false, reason: 'invalid_options', error: 'maxLevel must be 1..10' }
  }

  const links = options.links !== undefined ? options.links !== false : meta?.links !== false
  let rawTitle
  if (options.title !== undefined) {
    rawTitle = options.title
  } else if (meta) {
    rawTitle = meta.title
  } else if (inferTocHasTitle(doc, range, savedLayout, helpers)) {
    rawTitle = cleanText(bodyText(doc, range.start.sec, range.start.para))
  } else {
    rawTitle = null
  }
  const trimmedTitle = typeof rawTitle === 'string' ? cleanText(rawTitle) : ''
  const titled = trimmedTitle.length > 0

  // Check for manual edits inside the marked TOC range before mutating.
  if (Array.isArray(meta?.lines) && options.allowOverwriteManual !== true) {
    const actualLines = readTocRangeLines(doc, range, savedLayout, helpers)
    const modifiedLines = diffTocLines(meta.lines, actualLines)
    if (modifiedLines.length > 0) {
      return {
        ok: false,
        reason: 'manual_edits',
        kind,
        kindId,
        modifiedLines,
        range,
      }
    }
  }

  // Collect fresh entries outside the existing TOC range BEFORE mutating.
  const collected = collectEntriesForKind(doc, kind, options, maxLevel)
  const rawEntries = collected.entries
  const objectCaptionsUnavailable = collected.objectCaptionsUnavailable
  const warning = collected.warning

  const sec = range.start.sec
  const startPara = range.start.para
  const endPara = range.end.para
  const entries = rawEntries.filter(
    (e) => !(e.sec === sec && e.para >= startPara && e.para <= endPara),
  )
  if (entries.length === 0) {
    return {
      ok: false,
      reason: 'no_entries',
      kind,
      kindId,
      ...(objectCaptionsUnavailable ? { objectCaptionsUnavailable: true, warning } : {}),
    }
  }

  prepareReplaceSlot(doc, sec, startPara, endPara, [range.start, range.end], helpers)
  const removedCount = endPara - startPara
  const adjustedEntries = entries.map((e) => ({
    ...e,
    para: e.sec === sec && e.para > endPara ? e.para - removedCount : e.para,
  }))

  return executeTocWrite(doc, {
    kind,
    kindId,
    layout,
    maxLevel,
    links,
    titled,
    trimmedTitle,
    sec,
    insertPara: startPara,
    reuseFirst: true,
    entries: adjustedEntries,
    anchorPrefix,
    helpers,
    objectCaptionsUnavailable,
    warning,
  })
}

function splitEntryLine(line) {
  const tabIdx = line.lastIndexOf('\t')
  if (tabIdx < 0) return { text: cleanText(line), pageLabel: '' }
  return {
    text: cleanText(line.slice(0, tabIdx)),
    pageLabel: cleanText(line.slice(tabIdx + 1)),
  }
}

/**
 * Read-only check reporting whether any marked TOC block in `doc` is out of date
 * (heading entries added/removed/renamed or printed page numbers shifted under portable widths).
 * Accepts optional `options.collectors` (`{ table, figure, equation }`) so secondary TOCs
 * can participate in the same staleness check.
 */
export function checkTocStaleness(doc, options = {}) {
  if (!doc || typeof doc.getSectionCount !== 'function') {
    return { stale: false, items: [] }
  }
  const helpers = resolveHelpers(options)
  const filterKind = options.kind ? (resolveTocKind(options.kind)?.kind ?? null) : null
  const ranges = listTocRanges(doc).filter((r) => !filterKind || r.kind === filterKind)
  if (ranges.length === 0) return { stale: false, items: [] }

  return helpers.withPortableWidths(doc, () => {
    const items = []
    const caches = { pageInfoCache: new Map(), pageFormatCache: new Map() }
    let objectCaptionsUnavailable = false

    for (const range of ranges) {
      if (range.start.sec !== range.end.sec) continue
      const meta = readTocMeta(doc, range.kind)
      const layout =
        meta?.layout && TOC_LAYOUTS.includes(meta.layout)
          ? meta.layout
          : inferTocLayout(doc, range, helpers)
      const maxLevel = meta?.maxLevel ?? DEFAULT_TOC_MAX_LEVEL
      const hasTitle = meta
        ? Boolean(typeof meta.title === 'string' && meta.title.length > 0)
        : inferTocHasTitle(doc, range, layout, helpers)

      let rawFresh
      if (typeof options.collectors?.[range.kind] === 'function') {
        const custom = options.collectors[range.kind](doc, { ...options, maxLevel })
        rawFresh = Array.isArray(custom)
          ? custom
          : Array.isArray(custom?.entries)
            ? custom.entries
            : []
      } else if (range.kind === 'body') {
        rawFresh = collectBodyTocEntries(doc, { maxLevel, appStyleMap: options.appStyleMap })
      } else if (range.kind === 'table' || range.kind === 'figure' || range.kind === 'equation') {
        const collected = collectCaptionTocEntries(doc, range.kind, options)
        rawFresh = collected.entries
        if (collected.objectCaptionsUnavailable) {
          objectCaptionsUnavailable = true
        }
      } else {
        continue
      }

      const freshEntries = rawFresh
        .filter(
          (e) =>
            !(e.sec === range.start.sec && e.para >= range.start.para && e.para <= range.end.para),
        )
        .map((e) => {
          const measured = readPrintedPageLabel(doc, e.sec, e.para, caches)
          return { ...e, page: measured.page, pageLabel: measured.label }
        })

      const look = layout === 'table' ? helpers.tocLookOf(doc, freshEntries) : null
      const widthPt = layout === 'table' ? helpers.textWidthPt(doc, range.start.sec) : 0
      const expectedEntries = freshEntries.map((e) => {
        let displayText = clipText(e.text, MAX_TOC_TEXT)
        if (layout === 'table' && look) {
          const levelLook = look.levels.get(e.level) ?? {
            style: null,
            font: bodyFontOf(doc),
            indentPt: (e.level - 1) * DEFAULT_TOC_INDENT_PT,
          }
          displayText = helpers.oneLine(displayText, levelLook, widthPt)
        }
        return { text: cleanText(displayText), pageLabel: cleanText(e.pageLabel) }
      })

      const currentAllLines = readTocRangeLines(doc, range, layout, helpers)
      const currentEntryLines =
        hasTitle && currentAllLines.length > 0 ? currentAllLines.slice(1) : currentAllLines
      const currentEntries = currentEntryLines.map(splitEntryLine)

      let entriesChanged = currentEntries.length !== expectedEntries.length
      let pagesChanged = false
      const changedEntries = []

      const len = Math.max(currentEntries.length, expectedEntries.length)
      for (let i = 0; i < len; i++) {
        const cur = currentEntries[i] ?? null
        const exp = expectedEntries[i] ?? null
        if (!cur || !exp || cur.text !== exp.text) {
          entriesChanged = true
          changedEntries.push({
            index: i,
            currentText: cur?.text ?? null,
            expectedText: exp?.text ?? null,
            currentPage: cur?.pageLabel ?? null,
            expectedPage: exp?.pageLabel ?? null,
          })
        } else if (cur.pageLabel !== exp.pageLabel) {
          pagesChanged = true
          changedEntries.push({
            index: i,
            currentText: cur.text,
            expectedText: exp.text,
            currentPage: cur.pageLabel,
            expectedPage: exp.pageLabel,
          })
        }
      }

      if (entriesChanged || pagesChanged) {
        items.push({
          kind: range.kind,
          kindId: range.kindId,
          reason: entriesChanged ? 'entries_changed' : 'pages_changed',
          range,
          details: {
            currentCount: currentEntries.length,
            expectedCount: expectedEntries.length,
            changedEntries,
          },
        })
      }
    }

    return {
      stale: items.length > 0,
      items,
      ...(objectCaptionsUnavailable
        ? { objectCaptionsUnavailable: true, warning: OBJECT_CAPTIONS_UNAVAILABLE_WARNING }
        : {}),
    }
  })
}
