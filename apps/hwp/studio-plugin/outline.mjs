/**
 * Outline reading, style-to-level mapping, per-document setting persistence,
 * printed page number resolution, and active heading lookup for rhwp documents.
 *
 * Headings come from two body-only sources merged in document order:
 * 1. Native Hangul outline paragraphs (`doc.getOutlineNavigation()`), which are
 *    always included and take priority over style mappings on the same paragraph.
 * 2. Body paragraphs whose style name appears in the effective style-to-level map
 *    (document setting > app-wide setting > default mapping).
 */
import { deleteDocSetting, readDocSetting, writeDocSetting } from './doc-marks.mjs'

export const DOC_OUTLINE_MAP_KEY = '개요수준'
export const MIN_OUTLINE_LEVEL = 1
export const MAX_OUTLINE_LEVEL = 10

function buildDefaultOutlineStyleMap() {
  const map = {}
  for (let level = MIN_OUTLINE_LEVEL; level <= MAX_OUTLINE_LEVEL; level++) {
    map[`제목 ${level}`] = level
    map[`Heading ${level}`] = level
  }
  return Object.freeze(map)
}

export const DEFAULT_OUTLINE_STYLE_MAP = buildDefaultOutlineStyleMap()

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000b-\u001f\u007f]/g

// Leading heading marker followed by whitespace and non-empty title text.
const STYLE_HEADING_PREFIX_RE =
  /^(제\s*\d+\s*[편부장절항관조호]|(?:Chapter|Section|Part|Appendix)\s+(?:\d+(?:\.\d+)*|[A-Za-z]|[IVXLCDM]+)[.:]?|\d+(?:\.\d+)+\.?|\d+[.)]|\(\d+\)|\[\d+\]|[①-⑳]|[Ⅰ-Ⅻⅰ-ⅻ]+[.)]?|(?:IX|IV|V?I{1,3}|X{1,3}(?:IX|IV|V?I{0,3}))[.)]|(?:ix|iv|v?i{1,3}|x{1,3}(?:ix|iv|v?i{0,3}))[.)]|\((?:[Ⅰ-Ⅻⅰ-ⅻ]+|IX|IV|V?I{1,3}|X{1,3}|ix|iv|v?i{1,3}|x{1,3})\)|[가나다라마바사아자차카타파하][.)]|\([가나다라마바사아자차카타파하]\)|[ㄱ-ㅎ][.)]|\([ㄱ-ㅎ]\)|[㈀-㈍㉠-㉭]|[A-Za-z][.)]|\([A-Za-z]\))\s+([\s\S]+)$/

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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cleanHeadingText(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return ''
  return raw.replace(CONTROL_CHARS_RE, '').replace(/\s+/g, ' ').trim()
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
 * Returns null for default Arabic digits (format 0) or unsupported values.
 */
function formatPageLabel(num, format) {
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

/**
 * Normalize a style-to-level mapping: keep only non-empty trimmed style names
 * paired with integer levels 1..10.
 */
export function normalizeOutlineStyleMap(raw) {
  const out = {}
  if (!isPlainObject(raw)) return out
  for (const [key, value] of Object.entries(raw)) {
    const name = typeof key === 'string' ? key.trim() : ''
    if (!name) continue
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < MIN_OUTLINE_LEVEL ||
      value > MAX_OUTLINE_LEVEL
    ) {
      continue
    }
    out[name] = value
  }
  return out
}

/**
 * Resolve the effective style-to-level map with precedence:
 * document map (when non-null object) > app map (when non-null object) > defaults.
 * An explicit empty object `{}` is preserved verbatim so removed defaults stay removed.
 */
export function resolveOutlineStyleMap(appMap, docMap) {
  if (isPlainObject(docMap)) return normalizeOutlineStyleMap(docMap)
  if (isPlainObject(appMap)) return normalizeOutlineStyleMap(appMap)
  return { ...DEFAULT_OUTLINE_STYLE_MAP }
}

/**
 * Split a style-mapped heading paragraph into `{ number, title }` when it begins
 * with a recognized heading prefix token followed by whitespace and remaining text.
 */
export function splitStyleHeadingText(rawText) {
  const trimmed = cleanHeadingText(rawText)
  if (!trimmed) return { number: '', title: '' }
  const match = STYLE_HEADING_PREFIX_RE.exec(trimmed)
  if (!match) return { number: '', title: trimmed }
  const number = match[1].trim()
  const title = match[2].trim()
  if (!title) return { number: '', title: trimmed }
  return { number, title }
}

/**
 * Read the per-document outline style mapping stored in the document's setting bookmarks,
 * returning `null` when absent.
 */
export function readDocOutlineMap(doc) {
  if (!doc) return null
  const raw = readDocSetting(doc, DOC_OUTLINE_MAP_KEY)
  if (!isPlainObject(raw)) return null
  return normalizeOutlineStyleMap(raw)
}

/**
 * Write or clear (`map === null`) the per-document outline style mapping.
 */
export function writeDocOutlineMap(doc, map) {
  if (map === null || map === undefined) {
    const res = deleteDocSetting(doc, DOC_OUTLINE_MAP_KEY)
    return { ...res, map: null }
  }
  const normalized = normalizeOutlineStyleMap(map)
  const res = writeDocSetting(doc, DOC_OUTLINE_MAP_KEY, normalized)
  return res.ok ? { ...res, map: normalized } : res
}

function isBodyOutlineEntry(entry, secCount, paraCounts) {
  if (!entry || typeof entry !== 'object') return false
  if (
    entry.parentParaIndex != null ||
    entry.controlIndex != null ||
    entry.cellIndex != null ||
    entry.cellParaIndex != null ||
    entry.inTable === true ||
    entry.inTextBox === true ||
    entry.isTextBox === true ||
    entry.inNote === true ||
    entry.inFootnote === true ||
    entry.inEndnote === true ||
    entry.inHeaderFooter === true ||
    entry.isHeader === true ||
    entry.isFooter === true ||
    entry.noteIndex != null ||
    entry.noteType != null ||
    entry.cellContext != null ||
    entry.headerFooter != null
  ) {
    return false
  }
  if (Array.isArray(entry.cellPath) && entry.cellPath.length > 0) return false
  if (Array.isArray(entry.path) && entry.path.length > 0) return false
  if (typeof entry.place === 'string' && entry.place !== 'body') return false

  const sec = entry.section ?? entry.sec ?? entry.sectionIndex
  const para = entry.paragraph ?? entry.para ?? entry.paraIndex
  const level = entry.level
  if (!Number.isInteger(sec) || !Number.isInteger(para) || !Number.isInteger(level)) return false
  if (level < MIN_OUTLINE_LEVEL || level > MAX_OUTLINE_LEVEL) return false
  if (sec < 0 || sec >= secCount) return false
  if (para < 0 || para >= paraCounts[sec]) return false
  return true
}

function indexStyleList(doc) {
  const byId = new Map()
  if (typeof doc.getStyleList !== 'function') return byId
  const list = tryOr(() => parseJson(doc.getStyleList(), []), [])
  if (!Array.isArray(list)) return byId
  for (const style of list) {
    if (!style || typeof style !== 'object' || !Number.isInteger(style.id)) continue
    byId.set(style.id, {
      name: typeof style.name === 'string' ? style.name.trim() : '',
      englishName: typeof style.englishName === 'string' ? style.englishName.trim() : '',
    })
  }
  return byId
}

function readParaStyleName(doc, sec, para, styleById) {
  if (typeof doc.getStyleAt !== 'function') return ''
  const info = tryOr(() => parseJson(doc.getStyleAt(sec, para), null), null)
  if (!info || typeof info !== 'object') return ''
  if (typeof info.name === 'string' && info.name.trim().length > 0) {
    return info.name.trim()
  }
  if (Number.isInteger(info.id)) {
    const listed = styleById.get(info.id)
    if (listed) return listed.name || listed.englishName || ''
  }
  return ''
}

function readSectionPageFormat(doc, sec, cache) {
  if (cache.has(sec)) return cache.get(sec)
  let format = 0
  if (typeof doc.getPageNumberPos === 'function') {
    const res = tryOr(() => parseJson(doc.getPageNumberPos(sec), null), null)
    const fmt = res?.pageNumber?.format
    if (Number.isInteger(fmt)) format = fmt
  } else if (typeof doc.getPageNumberPosition === 'function') {
    const res = tryOr(() => parseJson(doc.getPageNumberPosition(sec), null), null)
    if (res?.exists && Number.isInteger(res.format)) format = res.format
  }
  cache.set(sec, format)
  return format
}

function readPrintedPage(doc, sec, para, fallbackPhysicalPage, pageInfoCache, pageFormatCache) {
  let pageIdx = -1
  if (typeof doc.getPageOfPosition === 'function') {
    const pos = tryOr(() => parseJson(doc.getPageOfPosition(sec, para), null), null)
    if (pos && pos.ok !== false && Number.isInteger(pos.page) && pos.page >= 0) {
      pageIdx = pos.page
    }
  }
  if (pageIdx < 0) {
    pageIdx =
      Number.isInteger(fallbackPhysicalPage) && fallbackPhysicalPage >= 1
        ? fallbackPhysicalPage - 1
        : 0
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
  const label = formatPageLabel(printed, format)

  return {
    page: printed,
    ...(label ? { pageLabel: label } : {}),
    physicalPage,
  }
}

/**
 * Read the document outline by merging body outline paragraphs (`getOutlineNavigation`)
 * and body paragraphs matching the effective style-to-level map in strict document order.
 */
export function readOutline(doc, options = {}) {
  const docStyleMap = readDocOutlineMap(doc)
  const hasDocStyleMap = docStyleMap !== null
  const effectiveStyleMap = resolveOutlineStyleMap(options?.appStyleMap, docStyleMap)

  if (!doc || typeof doc.getSectionCount !== 'function') {
    return { items: [], effectiveStyleMap, hasDocStyleMap, docStyleMap }
  }

  const secCount = doc.getSectionCount()
  const paraCounts = []
  for (let sec = 0; sec < secCount; sec++) {
    paraCounts.push(doc.getParagraphCount(sec))
  }

  const outlineByPara = new Map()
  if (typeof doc.getOutlineNavigation === 'function') {
    const parsed = tryOr(() => parseJson(doc.getOutlineNavigation(), null), null)
    const rawEntries = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.outline)
        ? parsed.outline
        : []
    for (const entry of rawEntries) {
      if (!isBodyOutlineEntry(entry, secCount, paraCounts)) continue
      const sec = entry.section ?? entry.sec ?? entry.sectionIndex
      const para = entry.paragraph ?? entry.para ?? entry.paraIndex
      const key = `${sec}:${para}`
      if (!outlineByPara.has(key)) {
        outlineByPara.set(key, entry)
      }
    }
  }

  const hasMappedStyles = Object.keys(effectiveStyleMap).length > 0
  const styleById = indexStyleList(doc)
  const pageInfoCache = new Map()
  const pageFormatCache = new Map()
  const items = []

  for (let sec = 0; sec < secCount; sec++) {
    const paraCount = paraCounts[sec]
    for (let para = 0; para < paraCount; para++) {
      const key = `${sec}:${para}`
      const nav = outlineByPara.get(key)

      if (nav) {
        const styleName = readParaStyleName(doc, sec, para, styleById)
        const pageInfo = readPrintedPage(doc, sec, para, nav.page, pageInfoCache, pageFormatCache)
        items.push({
          level: nav.level,
          number: typeof nav.number === 'string' ? nav.number.trim() : '',
          title: cleanHeadingText(typeof nav.title === 'string' ? nav.title : ''),
          ...pageInfo,
          sec,
          para,
          source: 'outline',
          styleName,
        })
        continue
      }

      if (!hasMappedStyles) continue

      const styleName = readParaStyleName(doc, sec, para, styleById)
      if (!styleName || !Object.prototype.hasOwnProperty.call(effectiveStyleMap, styleName)) {
        continue
      }
      const level = effectiveStyleMap[styleName]
      const len = tryOr(() => doc.getParagraphLength(sec, para), 0)
      if (!Number.isInteger(len) || len <= 0) continue

      const rawText = tryOr(() => doc.getTextRange(sec, para, 0, len), '')
      const cleaned = cleanHeadingText(rawText)
      if (!cleaned) continue

      const { number, title } = splitStyleHeadingText(cleaned)
      const pageInfo = readPrintedPage(doc, sec, para, null, pageInfoCache, pageFormatCache)
      items.push({
        level,
        number,
        title,
        ...pageInfo,
        sec,
        para,
        source: 'style',
        styleName,
      })
    }
  }

  return {
    items,
    effectiveStyleMap,
    hasDocStyleMap,
    docStyleMap,
  }
}

/**
 * Return the index of the last heading at or before `caret` (`sec`, `para`), or `-1` if none.
 */
export function findActiveOutlineIndex(items, caret) {
  if (!Array.isArray(items) || items.length === 0 || !caret || typeof caret !== 'object') {
    return -1
  }
  const { sec, para } = caret
  if (!Number.isInteger(sec) || !Number.isInteger(para)) return -1

  let active = -1
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item) continue
    if (item.sec < sec || (item.sec === sec && item.para <= para)) {
      active = i
    }
  }
  return active
}
