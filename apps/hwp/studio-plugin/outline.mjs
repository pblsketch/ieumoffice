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
import {
  deleteDocSetting,
  isAppTocHyperlinkField,
  readDocSetting,
  writeDocSetting,
} from './doc-marks.mjs'

export const DOC_OUTLINE_MAP_KEY = '개요수준'
export const MIN_OUTLINE_LEVEL = 1
export const MAX_OUTLINE_LEVEL = 10

// Layout-defining controls attached to paragraph 0 of a section that must not be moved or displaced.
const FIRST_PARA_LAYOUT_CONTROLS = new Set(['secd', 'cold', 'pgnp', 'head', 'foot', 'pghd', 'nwno'])

// Engine `getOutlineNavigation()` caps native outline reporting at level 8 (paraLevel 0..7);
// match levels 9 and 10 via style name + `getParaPropertiesAt` so 1..10 round-trip cleanly.
const HIGH_OUTLINE_STYLE_RE = /^(?:개요|Outline)\s+(9|10)$/

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

      const styleName = readParaStyleName(doc, sec, para, styleById)
      if (styleName && HIGH_OUTLINE_STYLE_RE.test(styleName)) {
        const props =
          typeof doc.getParaPropertiesAt === 'function'
            ? tryOr(() => parseJson(doc.getParaPropertiesAt(sec, para), null), null)
            : null
        const paraLevel = props?.paraLevel
        if (
          props?.headType === 'Outline' &&
          Number.isInteger(paraLevel) &&
          paraLevel + 1 >= MIN_OUTLINE_LEVEL &&
          paraLevel + 1 <= MAX_OUTLINE_LEVEL
        ) {
          const len = tryOr(() => doc.getParagraphLength(sec, para), 0)
          const rawText =
            Number.isInteger(len) && len > 0
              ? tryOr(() => doc.getTextRange(sec, para, 0, len), '')
              : ''
          const cleaned = cleanHeadingText(rawText)
          const pageInfo = readPrintedPage(doc, sec, para, null, pageInfoCache, pageFormatCache)
          items.push({
            level: paraLevel + 1,
            number: '',
            title: cleaned,
            ...pageInfo,
            sec,
            para,
            source: 'outline',
            styleName,
          })
          continue
        }
      }

      if (!hasMappedStyles) continue

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

function listParagraphStyles(doc) {
  if (!doc || typeof doc.getStyleList !== 'function') return []
  const list = tryOr(() => parseJson(doc.getStyleList(), []), [])
  if (!Array.isArray(list)) return []
  const out = []
  for (const style of list) {
    if (!style || typeof style !== 'object' || !Number.isInteger(style.id)) continue
    // type 0 = paragraph style, type 1 = character style
    if (style.type !== undefined && style.type !== 0) continue
    out.push({
      id: style.id,
      name: typeof style.name === 'string' ? style.name.trim() : '',
      englishName: typeof style.englishName === 'string' ? style.englishName.trim() : '',
    })
  }
  return out
}

function findParagraphStyleByName(paraStyles, name) {
  return paraStyles.find((s) => (s.name || s.englishName) === name) ?? null
}

function findNativeOutlineStyle(paraStyles, level) {
  const koName = `개요 ${level}`
  const enName = `Outline ${level}`
  return (
    paraStyles.find((s) => s.name === koName) ??
    paraStyles.find((s) => s.englishName === enName || s.name === enName) ??
    null
  )
}

function resolveTargetStyleForItem(item, targetLevel, effectiveStyleMap, appWideMap, paraStyles) {
  if (item.source === 'outline') {
    const found = findNativeOutlineStyle(paraStyles, targetLevel)
    if (!found) {
      return { ok: false, reason: 'missing_style_in_doc', styleName: `개요 ${targetLevel}` }
    }
    return {
      ok: true,
      id: found.id,
      name: found.name || found.englishName || `개요 ${targetLevel}`,
    }
  }

  const mappedAtTarget = Object.entries(effectiveStyleMap)
    .filter(([, lv]) => lv === targetLevel)
    .map(([name]) => name)
  if (mappedAtTarget.length === 0) {
    return { ok: false, reason: 'no_mapped_style' }
  }

  // Tie-breaker: among styles mapped to `targetLevel` in `effectiveStyleMap`,
  // prefer the earliest one mapped to `targetLevel` in the app-wide map.
  const mappedSet = new Set(mappedAtTarget)
  const orderedCandidates = []
  const seen = new Set()
  for (const [name, lv] of Object.entries(appWideMap)) {
    if (lv === targetLevel && mappedSet.has(name) && !seen.has(name)) {
      orderedCandidates.push(name)
      seen.add(name)
    }
  }
  for (const name of mappedAtTarget) {
    if (!seen.has(name)) {
      orderedCandidates.push(name)
      seen.add(name)
    }
  }

  for (const candidate of orderedCandidates) {
    const found = findParagraphStyleByName(paraStyles, candidate)
    if (found) {
      return { ok: true, id: found.id, name: found.name || candidate }
    }
  }
  return { ok: false, reason: 'missing_style_in_doc', styleName: orderedCandidates[0] }
}

/**
 * Promote (`delta: -1`) or demote (`delta: 1`) an outline heading (and its entire subtree by
 * default, or only the target heading when `singleOnly: true`).
 *
 * Pre-validates every affected heading before applying any style change so out-of-range
 * levels or unmapped/missing styles refuse atomically with zero mutations.
 */
export function changeOutlineLevel(doc, params) {
  if (
    !doc ||
    typeof doc.getSectionCount !== 'function' ||
    typeof doc.getParagraphCount !== 'function' ||
    typeof doc.applyStyle !== 'function'
  ) {
    return { ok: false, reason: 'unsupported_place' }
  }
  if (!params || typeof params !== 'object') {
    return { ok: false, reason: 'not_found' }
  }
  const { sec, para, delta, singleOnly = false, appStyleMap } = params
  if (delta !== 1 && delta !== -1) {
    return { ok: false, reason: 'unsupported_place' }
  }
  if (!Number.isInteger(sec) || !Number.isInteger(para)) {
    return { ok: false, reason: 'unsupported_place' }
  }
  const secCount = doc.getSectionCount()
  if (sec < 0 || sec >= secCount) {
    return { ok: false, reason: 'not_found', sec, para }
  }
  const paraCount = doc.getParagraphCount(sec)
  if (para < 0 || para >= paraCount) {
    return { ok: false, reason: 'not_found', sec, para }
  }

  const outline = readOutline(doc, { appStyleMap })
  const targetIdx = outline.items.findIndex((item) => item.sec === sec && item.para === para)
  if (targetIdx < 0) {
    return { ok: false, reason: 'not_found', sec, para }
  }

  const target = outline.items[targetIdx]
  const affected = [target]
  if (singleOnly !== true) {
    for (let i = targetIdx + 1; i < outline.items.length; i++) {
      const next = outline.items[i]
      if (next.level <= target.level) break
      affected.push(next)
    }
  }

  const paraStyles = listParagraphStyles(doc)
  const appWideMap =
    appStyleMap != null ? normalizeOutlineStyleMap(appStyleMap) : DEFAULT_OUTLINE_STYLE_MAP

  // Pre-validate every affected heading before mutating the document.
  const plan = []
  for (const item of affected) {
    const targetLevel = item.level + delta
    if (targetLevel < MIN_OUTLINE_LEVEL || targetLevel > MAX_OUTLINE_LEVEL) {
      return {
        ok: false,
        reason: 'level_out_of_range',
        title: item.title,
        sec: item.sec,
        para: item.para,
        fromLevel: item.level,
        targetLevel,
      }
    }
    const resolved = resolveTargetStyleForItem(
      item,
      targetLevel,
      outline.effectiveStyleMap,
      appWideMap,
      paraStyles,
    )
    if (!resolved.ok) {
      return {
        ok: false,
        reason: resolved.reason,
        title: item.title,
        sec: item.sec,
        para: item.para,
        fromLevel: item.level,
        targetLevel,
        ...(resolved.styleName ? { styleName: resolved.styleName } : {}),
      }
    }
    plan.push({
      sec: item.sec,
      para: item.para,
      fromLevel: item.level,
      toLevel: targetLevel,
      styleId: resolved.id,
      styleName: resolved.name,
    })
  }

  const changed = []
  for (const step of plan) {
    const raw = doc.applyStyle(step.sec, step.para, step.styleId)
    const parsed = parseJson(raw, null)
    if (parsed && parsed.ok === false) {
      throw new Error(parsed.error || `Failed to apply style ${step.styleName}`)
    }
    changed.push({
      sec: step.sec,
      para: step.para,
      fromLevel: step.fromLevel,
      toLevel: step.toLevel,
      styleName: step.styleName,
    })
  }

  const targetLen = tryOr(() => doc.getParagraphLength(target.sec, target.para), 0)
  return {
    ok: true,
    changed,
    place: { sec: target.sec, para: target.para, offset: 0, length: targetLen },
  }
}

function resolveHeadingRange(items, idx, paraCount, secCount = 1) {
  const head = items[idx]
  let crossesSection = false
  let endPara = paraCount - 1
  let closed = false
  for (let j = idx + 1; j < items.length; j++) {
    const next = items[j]
    if (next.sec === head.sec) {
      if (next.level <= head.level) {
        endPara = next.para - 1
        closed = true
        break
      }
      continue
    }
    // Heading range reaches a subsequent section. Only when the very first paragraph
    // of the immediately following section begins a new heading of equal or higher level
    // does the range end cleanly at the section boundary without crossing it.
    if (next.level <= head.level && next.sec === head.sec + 1 && next.para === 0) {
      closed = true
      break
    }
    crossesSection = true
    closed = true
    break
  }
  // If no equal/higher heading closed the range and another section follows, the range
  // spills across the section boundary into the trailing section's body paragraphs.
  if (!closed && head.sec + 1 < secCount) {
    crossesSection = true
  }
  return { start: head.para, end: Math.max(head.para, endPara), crossesSection }
}

function flatBodyParaIndex(doc, sec, para) {
  let flat = para
  for (let s = 0; s < sec; s++) {
    flat += doc.getParagraphCount(s)
  }
  return flat
}

function paragraphHasLayoutControls(doc, sec, para) {
  if (typeof doc.getControls !== 'function') return false
  const controls = tryOr(() => parseJson(doc.getControls(), []), [])
  if (!Array.isArray(controls)) return false
  const flatPara = flatBodyParaIndex(doc, sec, para)
  return controls.some(
    (ctrl) =>
      ctrl &&
      ctrl.list === 0 &&
      ctrl.para === flatPara &&
      FIRST_PARA_LAYOUT_CONTROLS.has(ctrl.ctrlId),
  )
}

function readAllBookmarks(doc) {
  if (typeof doc.getBookmarks !== 'function') return []
  const raw = tryOr(() => parseJson(doc.getBookmarks(), []), [])
  if (!Array.isArray(raw)) return []
  return raw
    .filter((bm) => bm && typeof bm.name === 'string')
    .map((bm) => ({
      name: bm.name,
      sec: bm.sec ?? bm.sectionIndex ?? 0,
      para: bm.para ?? bm.paraIndex ?? 0,
      offset: bm.charPos ?? bm.charOffset ?? bm.offset ?? 0,
      ctrlIdx: bm.ctrlIdx ?? bm.controlIndex ?? 0,
    }))
}

function bookmarkMultiset(bookmarks) {
  const counts = new Map()
  for (const bm of bookmarks) {
    counts.set(bm.name, (counts.get(bm.name) ?? 0) + 1)
  }
  return counts
}

function sameCountMap(a, b) {
  if (a.size !== b.size) return false
  for (const [key, count] of a.entries()) {
    if (b.get(key) !== count) return false
  }
  return true
}

function snapshotObjects(doc) {
  const allFields =
    typeof doc.getFieldList === 'function' ? tryOr(() => parseJson(doc.getFieldList(), []), []) : []
  const fieldsList = Array.isArray(allFields) ? allFields : []
  const watchedFields = fieldsList
    .filter((f) => f && f.fieldType !== 'memo' && !isAppTocHyperlinkField(f))
    .map((f) => `${f.fieldType ?? ''}\0${f.name ?? ''}\0${f.value ?? ''}`)
    .sort()

  const controls =
    typeof doc.getControls === 'function' ? tryOr(() => parseJson(doc.getControls(), []), []) : []
  const controlList = Array.isArray(controls) ? controls : []

  const unnamed = controlList.filter((c) => c && c.ctrlId === '' && c.ctrlCh === 0)
  const usedUnnamed = new Set()
  const exemptUnnamedControls = new Set()
  for (const field of fieldsList.filter(
    (entry) => entry && (entry.fieldType === 'memo' || isAppTocHyperlinkField(entry)),
  )) {
    let index = -1
    if (Number.isInteger(field.startPos)) {
      index = unnamed.findIndex(
        (ctrl, at) =>
          !usedUnnamed.has(at) &&
          Number.isInteger(field.listId) &&
          ctrl.list === field.listId &&
          ctrl.para === field.paraInList &&
          ctrl.pos + 8 === field.startPos,
      )
    }
    if (index < 0) {
      index = unnamed.findIndex(
        (ctrl, at) =>
          !usedUnnamed.has(at) &&
          Number.isInteger(field.listId) &&
          ctrl.list === field.listId &&
          ctrl.para === field.paraInList,
      )
    }
    if (index < 0) continue
    usedUnnamed.add(index)
    const matched = unnamed[index]
    exemptUnnamedControls.add(`${matched.list}:${matched.para}:${matched.controlIndex}`)
  }

  // Bookmarks (`bokm`) are verified strictly by name multiset in `moveOutlineSection`
  // so bookmark loss is reported as `bookmarks_lost` rather than `objects_changed`.
  const controlsById = new Map()
  for (const ctrl of controlList) {
    if (!ctrl) continue
    if (ctrl.ctrlId === 'bokm') continue
    if (
      ctrl.ctrlId === '' &&
      ctrl.ctrlCh === 0 &&
      exemptUnnamedControls.has(`${ctrl.list}:${ctrl.para}:${ctrl.controlIndex}`)
    ) {
      continue
    }
    const id = typeof ctrl.ctrlId === 'string' ? ctrl.ctrlId : ''
    controlsById.set(id, (controlsById.get(id) ?? 0) + 1)
  }

  const memos =
    typeof doc.getMemoList === 'function' ? tryOr(() => parseJson(doc.getMemoList(), []), []) : []
  const memoCount = Array.isArray(memos) ? memos.length : 0

  return {
    controlsById,
    watchedFields: JSON.stringify(watchedFields),
    memoCount,
  }
}

function sameObjectSnapshot(a, b) {
  return (
    a.memoCount === b.memoCount &&
    a.watchedFields === b.watchedFields &&
    sameCountMap(a.controlsById, b.controlsById)
  )
}

/**
 * Move an outline heading together with its body paragraphs and descendant headings before or
 * after another heading in the same section, preserving objects, styles, and bookmarks.
 *
 * Refuses cross-section moves, moves involving layout-bearing paragraph 0 (`secd`/`cold`),
 * drops into the source's own subtree, and no-op drops without mutating the document.
 * If a post-move integrity check detects lost objects or bookmarks, returns `ok: false`
 * with `mutated: true` so the caller's transaction wrapper can roll back.
 */
export function moveOutlineSection(doc, params) {
  if (
    !doc ||
    typeof doc.getSectionCount !== 'function' ||
    typeof doc.getParagraphCount !== 'function' ||
    typeof doc.getParagraphLength !== 'function' ||
    typeof doc.insertParagraph !== 'function' ||
    typeof doc.deleteParagraph !== 'function' ||
    typeof doc.pasteInternal !== 'function' ||
    (typeof doc.copySelectionLogical !== 'function' && typeof doc.copySelection !== 'function')
  ) {
    return { ok: false, reason: 'unsupported_place' }
  }
  if (!params || typeof params !== 'object') {
    return { ok: false, reason: 'not_found' }
  }
  const { source, target, position, appStyleMap } = params
  if (position !== 'before' && position !== 'after') {
    return { ok: false, reason: 'unsupported_place' }
  }
  if (
    !source ||
    !target ||
    !Number.isInteger(source.sec) ||
    !Number.isInteger(source.para) ||
    !Number.isInteger(target.sec) ||
    !Number.isInteger(target.para)
  ) {
    return { ok: false, reason: 'unsupported_place' }
  }

  const secCount = doc.getSectionCount()
  if (source.sec < 0 || source.sec >= secCount || target.sec < 0 || target.sec >= secCount) {
    return { ok: false, reason: 'not_found' }
  }
  if (
    source.para < 0 ||
    source.para >= doc.getParagraphCount(source.sec) ||
    target.para < 0 ||
    target.para >= doc.getParagraphCount(target.sec)
  ) {
    return { ok: false, reason: 'not_found' }
  }

  const outline = readOutline(doc, { appStyleMap })
  const sourceIdx = outline.items.findIndex(
    (item) => item.sec === source.sec && item.para === source.para,
  )
  const targetIdx = outline.items.findIndex(
    (item) => item.sec === target.sec && item.para === target.para,
  )
  if (sourceIdx < 0 || targetIdx < 0) {
    return { ok: false, reason: 'not_found' }
  }

  const sourceItem = outline.items[sourceIdx]
  const targetItem = outline.items[targetIdx]
  if (sourceItem.sec !== targetItem.sec) {
    return { ok: false, reason: 'cross_section' }
  }

  const sec = sourceItem.sec
  const beforeParaCount = doc.getParagraphCount(sec)
  const sourceRange = resolveHeadingRange(outline.items, sourceIdx, beforeParaCount, secCount)
  const targetRange = resolveHeadingRange(outline.items, targetIdx, beforeParaCount, secCount)
  if (sourceRange.crossesSection || (position === 'after' && targetRange.crossesSection)) {
    return { ok: false, reason: 'cross_section' }
  }

  if (targetRange.start >= sourceRange.start && targetRange.start <= sourceRange.end) {
    return { ok: false, reason: 'target_inside_source' }
  }

  const insertPara = position === 'before' ? targetRange.start : targetRange.end + 1
  if (insertPara === sourceRange.start || insertPara === sourceRange.end + 1) {
    return { ok: false, reason: 'no_change' }
  }

  // Paragraph 0 carries section/column definitions (secd/cold); neither moving it out nor
  // inserting before it (which shifts secd/cold down to paragraph 1) is safe.
  if ((sourceRange.start === 0 || insertPara === 0) && paragraphHasLayoutControls(doc, sec, 0)) {
    return { ok: false, reason: 'first_para_layout' }
  }

  const beforeBookmarks = readAllBookmarks(doc)
  const beforeBookmarkCounts = bookmarkMultiset(beforeBookmarks)
  const beforeObjects = snapshotObjects(doc)
  const movedBookmarks = beforeBookmarks
    .filter((bm) => bm.sec === sec && bm.para >= sourceRange.start && bm.para <= sourceRange.end)
    .map((bm) => ({
      name: bm.name,
      relPara: bm.para - sourceRange.start,
      offset: bm.offset,
    }))

  const firstStyleInfo =
    typeof doc.getStyleAt === 'function'
      ? tryOr(() => parseJson(doc.getStyleAt(sec, sourceRange.start), null), null)
      : null
  const firstStyleId = Number.isInteger(firstStyleInfo?.id) ? firstStyleInfo.id : null
  const firstParaProps =
    typeof doc.getParaPropertiesAt === 'function'
      ? tryOr(() => parseJson(doc.getParaPropertiesAt(sec, sourceRange.start), null), null)
      : null
  const firstParaShapeId = Number.isInteger(firstParaProps?.paraShapeId)
    ? firstParaProps.paraShapeId
    : null

  const count = sourceRange.end - sourceRange.start + 1
  const useLogicalCopy =
    typeof doc.copySelectionLogical === 'function' && typeof doc.getLogicalLength === 'function'
  const endOffset = useLogicalCopy
    ? doc.getLogicalLength(sec, sourceRange.end)
    : doc.getParagraphLength(sec, sourceRange.end)

  try {
    const copyRaw = useLogicalCopy
      ? doc.copySelectionLogical(sec, sourceRange.start, 0, sourceRange.end, endOffset)
      : doc.copySelection(sec, sourceRange.start, 0, sourceRange.end, endOffset)
    const copyRes = parseJson(copyRaw, null)
    if (!copyRes || copyRes.ok === false) {
      return {
        ok: false,
        reason: 'engine_error',
        error: copyRes?.error ?? 'copySelection failed',
      }
    }

    const insRes = parseJson(doc.insertParagraph(sec, insertPara), null)
    if (!insRes || insRes.ok === false) {
      return {
        ok: false,
        reason: 'engine_error',
        error: insRes?.error ?? 'insertParagraph failed',
      }
    }

    // Apply the source heading's style and paragraph shape to the blank target paragraph
    // before pasting so the first pasted paragraph keeps its exact heading style and layout.
    if (firstStyleId !== null && typeof doc.applyStyle === 'function') {
      doc.applyStyle(sec, insertPara, firstStyleId)
    }
    if (firstParaShapeId !== null && typeof doc.setParaShapeId === 'function') {
      doc.setParaShapeId(sec, insertPara, firstParaShapeId)
    }

    const pasteRes = parseJson(doc.pasteInternal(sec, insertPara, 0), null)
    if (!pasteRes || pasteRes.ok === false) {
      return {
        ok: false,
        reason: 'engine_error',
        error: pasteRes?.error ?? 'pasteInternal failed',
        mutated: true,
      }
    }
  } finally {
    if (typeof doc.clearClipboard === 'function') {
      tryOr(() => doc.clearClipboard(), undefined)
    }
  }

  const afterPasteCount = doc.getParagraphCount(sec)
  const addedCount = afterPasteCount - beforeParaCount
  if (addedCount !== count) {
    return {
      ok: false,
      reason: 'engine_error',
      error: `Expected ${count} inserted paragraphs, got ${addedCount}`,
      mutated: true,
    }
  }

  const movingUp = insertPara < sourceRange.start
  const delStart = movingUp ? sourceRange.start + addedCount : sourceRange.start
  const delEnd = movingUp ? sourceRange.end + addedCount : sourceRange.end
  const newStartPara = movingUp ? insertPara : insertPara - count

  for (let p = delEnd; p >= delStart; p--) {
    const delRes = parseJson(doc.deleteParagraph(sec, p), null)
    if (!delRes || delRes.ok === false) {
      return {
        ok: false,
        reason: 'engine_error',
        error: delRes?.error ?? `deleteParagraph(${sec}, ${p}) failed`,
        mutated: true,
      }
    }
  }

  // Restore any bookmarks from the moved range that pasteInternal did not carry over.
  if (movedBookmarks.length > 0 && typeof doc.addBookmark === 'function') {
    const currentCounts = bookmarkMultiset(readAllBookmarks(doc))
    for (const bm of movedBookmarks) {
      const expected = beforeBookmarkCounts.get(bm.name) ?? 0
      const current = currentCounts.get(bm.name) ?? 0
      if (current < expected) {
        const destPara = newStartPara + bm.relPara
        const destLen = tryOr(() => doc.getParagraphLength(sec, destPara), bm.offset)
        const addRes = parseJson(
          doc.addBookmark(sec, destPara, Math.min(bm.offset, destLen), bm.name),
          null,
        )
        if (addRes && addRes.ok === true) {
          currentCounts.set(bm.name, current + 1)
        }
      }
    }
  }

  const afterBookmarks = readAllBookmarks(doc)
  const afterObjects = snapshotObjects(doc)
  if (!sameObjectSnapshot(beforeObjects, afterObjects)) {
    return { ok: false, reason: 'objects_changed', mutated: true }
  }
  const afterBookmarkCounts = bookmarkMultiset(afterBookmarks)
  if (!sameCountMap(beforeBookmarkCounts, afterBookmarkCounts)) {
    return { ok: false, reason: 'bookmarks_lost', mutated: true }
  }

  const newHeadingLen = tryOr(() => doc.getParagraphLength(sec, newStartPara), 0)
  return {
    ok: true,
    movedParagraphs: count,
    newStart: { sec, para: newStartPara },
    place: { sec, para: newStartPara, offset: 0, length: newHeadingLen },
  }
}
