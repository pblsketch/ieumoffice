/**
 * Index marks (`색인:`) and index block builder (`색인블록:`) for rhwp documents.
 *
 * Manages body-only index entry bookmarks (including chunked payloads for long terms),
 * whole-word bulk marking with non-body skip reporting, Hangul-first sorting with
 * double-consonant folding, scoped multi-column index generation (1-3 columns),
 * dotted-tab and borderless-table layouts, manual-edit-aware refresh, and read-only
 * staleness checks.
 */
import {
  MARK_PREFIXES,
  MAX_MARK_NAME_LEN,
  RANGE_END,
  RANGE_START,
  addMark,
  addRangeMark,
  cleanupBrokenMarks,
  decodeMarkChunks,
  deduplicateMarks,
  deleteDocSetting,
  encodeMarkChunks,
  encodeMarkName,
  findRangeMarks,
  listMarks,
  readDocSetting,
  removeMark,
  writeDocSetting,
} from './doc-marks.mjs'
import { DEFAULT_COLUMN_GAP_MM } from './document-looks.mjs'
import { findMatches } from './find.mjs'

export const INDEX_BLOCK_ID = '기본'
export const INDEX_BLOCK_SETTING_KEY = '색인블록'
export const DEFAULT_INDEX_TITLE = '찾아보기'
export const DEFAULT_INDEX_COLUMNS = 2
export const DEFAULT_INDEX_LAYOUT = 'dotted-tab'

const MIN_COLUMNS = 1
const MAX_COLUMNS = 3
const SUB_ENTRY_MARGIN_LEFT = 2400 // 12pt in doubled HWPUNIT
const GROUP_HEADING_SPACING_BEFORE = 1200 // 6pt in doubled HWPUNIT
const TITLE_SPACING_AFTER = 1600 // 8pt in doubled HWPUNIT
const TITLE_FONT_SIZE = 1400 // 14pt in HWPUNIT
const TABLE_LEFT_COL_RATIO = 0.72
const MAX_PAGE_STABILIZE_PASSES = 2
const HWPUNIT_PER_MM = 7200 / 25.4
const TAB_ALIGN_RIGHT = 1
const TAB_LEADER_DOTS = 3

const WORD_CHAR_RE = /[\p{L}\p{N}]/u
// eslint-disable-next-line no-control-regex
const DISALLOWED_TERM_CHARS_RE = /[\u0000-\u001f\u007f]/

// 19 modern Hangul initial consonants (choseong) in Unicode syllable order.
const HANGUL_CHOSEONG = [
  'ㄱ',
  'ㄲ',
  'ㄴ',
  'ㄷ',
  'ㄸ',
  'ㄹ',
  'ㅁ',
  'ㅂ',
  'ㅃ',
  'ㅅ',
  'ㅆ',
  'ㅇ',
  'ㅈ',
  'ㅉ',
  'ㅊ',
  'ㅋ',
  'ㅌ',
  'ㅍ',
  'ㅎ',
]

// Double consonants fold into their base consonant for index group headings.
const DOUBLE_CONSONANT_FOLD = Object.freeze({
  ㄲ: 'ㄱ',
  ㄸ: 'ㄷ',
  ㅃ: 'ㅂ',
  ㅆ: 'ㅅ',
  ㅉ: 'ㅈ',
})

// Compatibility Jamo consonants (U+3131..U+314E) mapped to 14 base Korean headings.
const COMPAT_JAMO_TO_HEADING = Object.freeze({
  ㄱ: 'ㄱ',
  ㄲ: 'ㄱ',
  ㄳ: 'ㄱ',
  ㄴ: 'ㄴ',
  ㄵ: 'ㄴ',
  ㄶ: 'ㄴ',
  ㄷ: 'ㄷ',
  ㄸ: 'ㄷ',
  ㄹ: 'ㄹ',
  ㄺ: 'ㄹ',
  ㄻ: 'ㄹ',
  ㄼ: 'ㄹ',
  ㄽ: 'ㄹ',
  ㄾ: 'ㄹ',
  ㄿ: 'ㄹ',
  ㅀ: 'ㄹ',
  ㅁ: 'ㅁ',
  ㅂ: 'ㅂ',
  ㅃ: 'ㅂ',
  ㅄ: 'ㅂ',
  ㅅ: 'ㅅ',
  ㅆ: 'ㅅ',
  ㅇ: 'ㅇ',
  ㅈ: 'ㅈ',
  ㅉ: 'ㅈ',
  ㅊ: 'ㅊ',
  ㅋ: 'ㅋ',
  ㅌ: 'ㅌ',
  ㅍ: 'ㅍ',
  ㅎ: 'ㅎ',
})

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

const NONE_BORDER = Object.freeze({ type: 0, width: 0, color: '#000000' })
const BORDERLESS_CELL_JSON = JSON.stringify({
  borderLeft: NONE_BORDER,
  borderRight: NONE_BORDER,
  borderTop: NONE_BORDER,
  borderBottom: NONE_BORDER,
})

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

function expectOk(raw, action) {
  const parsed = typeof raw === 'string' ? parseJson(raw, null) : raw
  if (!parsed || parsed.ok === false) {
    throw new Error(parsed?.error || `${action} failed`)
  }
  return parsed
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

function formatPageLabel(num, format) {
  if (!Number.isInteger(num) || num < 1) return ''
  if (!Number.isInteger(format) || format === 0) return String(num)
  switch (format) {
    case 1:
      return num <= 20 ? String.fromCharCode(0x2460 + num - 1) : String(num)
    case 2:
      return toRoman(num) ?? String(num)
    case 3: {
      const upper = toRoman(num)
      return upper ? upper.toLowerCase() : String(num)
    }
    case 4:
      return num <= 26 ? String.fromCharCode(0x41 + num - 1) : String(num)
    case 5:
      return num <= 26 ? String.fromCharCode(0x61 + num - 1) : String(num)
    case 6:
      return num <= 26 ? String.fromCharCode(0x24b6 + num - 1) : String(num)
    case 7:
      return num <= 26 ? String.fromCharCode(0x24d0 + num - 1) : String(num)
    default:
      return String(num)
  }
}

/**
 * Execute `fn` under portable print layout metrics (`selectCanvasMetrics(false)`),
 * restoring canvas metrics afterward if they were previously active.
 */
function withPortableMetrics(doc, fn) {
  const canToggle =
    doc &&
    typeof doc.canvasMetricsActive === 'function' &&
    typeof doc.selectCanvasMetrics === 'function'
  const wasCanvas = canToggle ? Boolean(tryOr(() => doc.canvasMetricsActive(), false)) : false
  if (wasCanvas) {
    tryOr(() => doc.selectCanvasMetrics(false), false)
  }
  try {
    return fn()
  } finally {
    if (wasCanvas) {
      tryOr(() => doc.selectCanvasMetrics(true), false)
    }
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
 * Build a table mapping each 0-based physical page index to its printed page number,
 * formatted label, and monotonic numbering run index (incremented whenever page
 * numbering restarts or changes format across the document).
 */
function buildPageLookup(doc) {
  const totalPages = typeof doc.pageCount === 'function' ? tryOr(() => doc.pageCount(), 0) : 0
  const pageFormatCache = new Map()
  const pageInfoCache = new Map()
  const runByPhysicalIdx = new Map()

  let currentRun = 0
  let prevPrinted = -1
  let prevFormat = -1

  for (let p = 0; p < totalPages; p++) {
    const info =
      typeof doc.getPageInfo === 'function'
        ? tryOr(() => parseJson(doc.getPageInfo(p), null), null)
        : null
    pageInfoCache.set(p, info)
    const printed =
      info && Number.isInteger(info.pageNumber) && info.pageNumber >= 1 ? info.pageNumber : p + 1
    const secIdx =
      info && Number.isInteger(info.sectionIndex) && info.sectionIndex >= 0 ? info.sectionIndex : 0
    const format = readSectionPageFormat(doc, secIdx, pageFormatCache)
    if (p > 0 && (printed <= prevPrinted || format !== prevFormat)) {
      currentRun += 1
    }
    runByPhysicalIdx.set(p, {
      page: printed,
      pageLabel: formatPageLabel(printed, format),
      physicalPage: p + 1,
      numberingRun: currentRun,
    })
    prevPrinted = printed
    prevFormat = format
  }

  return function resolvePage(sec, para) {
    let pageIdx = -1
    if (typeof doc.getPageOfPosition === 'function') {
      const pos = tryOr(() => parseJson(doc.getPageOfPosition(sec, para), null), null)
      if (pos && pos.ok !== false && Number.isInteger(pos.page) && pos.page >= 0) {
        pageIdx = pos.page
      }
    }
    if (pageIdx < 0) pageIdx = 0

    const cached = runByPhysicalIdx.get(pageIdx)
    if (cached) return cached

    let info = pageInfoCache.get(pageIdx)
    if (info === undefined) {
      info =
        typeof doc.getPageInfo === 'function'
          ? tryOr(() => parseJson(doc.getPageInfo(pageIdx), null), null)
          : null
      pageInfoCache.set(pageIdx, info)
    }
    const physicalPage = pageIdx + 1
    const printed =
      info && Number.isInteger(info.pageNumber) && info.pageNumber >= 1
        ? info.pageNumber
        : physicalPage
    const sectionForFormat =
      info && Number.isInteger(info.sectionIndex) && info.sectionIndex >= 0
        ? info.sectionIndex
        : sec
    const format = readSectionPageFormat(doc, sectionForFormat, pageFormatCache)
    return {
      page: printed,
      pageLabel: formatPageLabel(printed, format),
      physicalPage,
      numberingRun: 0,
    }
  }
}

function classifyNonBodyPlace(place) {
  if (!place || typeof place !== 'object') return 'unsupported_place'
  const isTextBox = place.inTextBox === true || place.isTextBox === true
  const isNote =
    place.inNote === true ||
    place.inFootnote === true ||
    place.inEndnote === true ||
    place.noteIndex != null ||
    place.noteType != null
  const isHeaderFooter =
    place.inHeaderFooter === true ||
    place.isHeader === true ||
    place.isFooter === true ||
    place.headerFooter != null
  if (isTextBox || isNote || isHeaderFooter || place.equationControl != null) {
    return 'unsupported_place'
  }
  if (typeof place.place === 'string' && place.place !== 'body') {
    return place.place === 'table' ? 'in_table' : 'unsupported_place'
  }
  const hasCellPath = Array.isArray(place.cellPath) && place.cellPath.length > 0
  const hasPath = Array.isArray(place.path) && place.path.length > 0
  const isTable =
    place.inTable === true ||
    place.cellContext != null ||
    place.parentParaIndex != null ||
    place.cellIndex != null ||
    place.cellParaIndex != null ||
    hasCellPath ||
    hasPath
  if (isTable) return 'in_table'
  if (place.path != null && !Array.isArray(place.path)) return 'unsupported_place'
  if (place.cellPath != null && !Array.isArray(place.cellPath)) return 'unsupported_place'
  return null
}

/**
 * Validate a body target `{ sec, para, offset }`, distinguishing non-body places
 * from out-of-range coordinates.
 */
function validateBodyTarget(doc, place, options = {}) {
  const { allowInTableReason = false, allowEndPara = false, checkOffsetBounds = true } = options
  if (
    !doc ||
    typeof doc.getSectionCount !== 'function' ||
    typeof doc.getParagraphCount !== 'function'
  ) {
    return { ok: false, reason: 'unsupported_place' }
  }
  const nonBodyReason = classifyNonBodyPlace(place)
  if (nonBodyReason) {
    return {
      ok: false,
      reason: allowInTableReason && nonBodyReason === 'in_table' ? 'in_table' : 'unsupported_place',
    }
  }

  const sec = place.sec ?? place.sectionIndex
  const para = place.para ?? place.paraIndex ?? place.paragraphIndex
  const hasOffset =
    place.offset !== undefined || place.charOffset !== undefined || place.charPos !== undefined
  const offset = hasOffset ? (place.offset ?? place.charOffset ?? place.charPos) : 0

  if (!Number.isInteger(sec) || !Number.isInteger(para) || !Number.isInteger(offset)) {
    return { ok: false, reason: 'not_found' }
  }
  const secCount = doc.getSectionCount()
  if (sec < 0 || sec >= secCount) {
    return { ok: false, reason: 'not_found' }
  }
  const paraCount = doc.getParagraphCount(sec)
  const maxPara = allowEndPara ? paraCount : paraCount - 1
  if (para < 0 || para > maxPara) {
    return { ok: false, reason: 'not_found' }
  }
  if (offset < 0) {
    return { ok: false, reason: 'not_found' }
  }
  if (checkOffsetBounds && para < paraCount && typeof doc.getParagraphLength === 'function') {
    const paraLen = doc.getParagraphLength(sec, para)
    if (offset > paraLen) {
      return { ok: false, reason: 'not_found' }
    }
  }
  return { ok: true, sec, para, offset }
}

/**
 * Extract the Unicode word surrounding `place` in a body paragraph when nothing is selected.
 * Returns `{ word, sec, para, start, end, offset, length }` or `null`.
 */
export function resolveIndexWordAt(doc, place) {
  const target = validateBodyTarget(doc, place, { checkOffsetBounds: true })
  if (!target.ok) return null
  if (typeof doc.getParagraphLength !== 'function' || typeof doc.getTextRange !== 'function') {
    return null
  }
  const { sec, para, offset } = target
  const len = tryOr(() => doc.getParagraphLength(sec, para), 0)
  if (!Number.isInteger(len) || len <= 0) return null
  const text = tryOr(() => doc.getTextRange(sec, para, 0, len), '')
  if (!text) return null
  const chars = Array.from(text)
  if (chars.length === 0) return null

  let anchor = -1
  if (offset < chars.length && WORD_CHAR_RE.test(chars[offset])) {
    anchor = offset
  } else if (offset > 0 && offset <= chars.length && WORD_CHAR_RE.test(chars[offset - 1])) {
    anchor = offset - 1
  }
  if (anchor < 0) return null

  let start = anchor
  while (start > 0 && WORD_CHAR_RE.test(chars[start - 1])) {
    start -= 1
  }
  let end = anchor + 1
  while (end < chars.length && WORD_CHAR_RE.test(chars[end])) {
    end += 1
  }
  const word = chars.slice(start, end).join('')
  if (!word) return null
  return {
    word,
    sec,
    para,
    start,
    end,
    offset: start,
    length: end - start,
  }
}

function scriptGroupOf(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return 2
  const first = Array.from(trimmed)[0]
  const code = first.charCodeAt(0)
  if (
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0x3131 && code <= 0x3163) ||
    (code >= 0x1100 && code <= 0x11ff)
  ) {
    return 0
  }
  const base = first.normalize('NFD')[0]
  if (/[A-Za-z]/.test(base)) return 1
  return 2
}

/**
 * Deterministic comparator for index terms:
 * Korean (Hangul 가나다 order) -> English (A-Z, case-insensitive) -> Other (digits/symbols).
 */
export function compareIndexTerms(a, b) {
  const sa = String(a ?? '').trim()
  const sb = String(b ?? '').trim()
  if (sa === sb) return 0

  const ga = scriptGroupOf(sa)
  const gb = scriptGroupOf(sb)
  if (ga !== gb) return ga - gb

  if (ga === 0) {
    const cmp = sa.localeCompare(sb, 'ko-KR', { sensitivity: 'variant' })
    if (cmp !== 0) return cmp
  } else if (ga === 1) {
    const primary = sa.localeCompare(sb, 'en-US', { sensitivity: 'base' })
    if (primary !== 0) return primary
    const secondary = sa.localeCompare(sb, 'en-US', { sensitivity: 'variant' })
    if (secondary !== 0) return secondary
  } else {
    const cmp = sa.localeCompare(sb, 'ko-KR', { numeric: true, sensitivity: 'variant' })
    if (cmp !== 0) return cmp
  }

  return sa < sb ? -1 : 1
}

/**
 * Compute the consonant/alphabet group heading for an index term:
 * - Hangul: 14 base consonants (ㄱ..ㅎ) with double consonants folded (ㄲ->ㄱ, ㄸ->ㄷ, ㅃ->ㅂ, ㅆ->ㅅ, ㅉ->ㅈ)
 * - Latin: uppercase base letter A..Z
 * - Other (digits, symbols, other scripts): '기타'
 */
export function indexGroupHeadingOf(term) {
  const trimmed = String(term ?? '').trim()
  if (!trimmed) return '기타'
  const first = Array.from(trimmed)[0]
  const code = first.charCodeAt(0)

  if (code >= 0xac00 && code <= 0xd7a3) {
    const choseongIdx = Math.floor((code - 0xac00) / 588)
    const raw = HANGUL_CHOSEONG[choseongIdx]
    return DOUBLE_CONSONANT_FOLD[raw] ?? raw ?? '기타'
  }
  if (code >= 0x1100 && code <= 0x1112) {
    const raw = HANGUL_CHOSEONG[code - 0x1100]
    return DOUBLE_CONSONANT_FOLD[raw] ?? raw ?? '기타'
  }
  if (Object.prototype.hasOwnProperty.call(COMPAT_JAMO_TO_HEADING, first)) {
    return COMPAT_JAMO_TO_HEADING[first]
  }
  const base = first.normalize('NFD')[0]
  if (/[A-Za-z]/.test(base)) {
    return base.toUpperCase()
  }
  return '기타'
}

function readAllBookmarkNames(doc) {
  if (!doc || typeof doc.getBookmarks !== 'function') return new Set()
  const raw = tryOr(() => parseJson(doc.getBookmarks(), []), [])
  if (!Array.isArray(raw)) return new Set()
  return new Set(raw.filter((bm) => bm && typeof bm.name === 'string').map((bm) => bm.name))
}

function parseIndexPayload(entry, fallbackIndex) {
  const parts = Array.isArray(entry.parts) ? entry.parts : []
  if (parts.length >= 3) {
    return {
      term: parts[0],
      subTerm: parts[1],
      id: parts.slice(2).join(':') || String(fallbackIndex),
    }
  }
  if (parts.length === 2) {
    if (/^\d+$/.test(parts[1])) {
      return { term: parts[0], subTerm: '', id: parts[1] }
    }
    return { term: parts[0], subTerm: parts[1], id: String(fallbackIndex) }
  }
  if (parts.length === 1) {
    return { term: parts[0], subTerm: '', id: String(fallbackIndex) }
  }
  return null
}

function readDecodedIndexEntries(doc) {
  const rawMarks = listMarks(doc, [MARK_PREFIXES.index])
  const { entries } = decodeMarkChunks(rawMarks)
  const decoded = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const payload = parseIndexPayload(entry, i + 1)
    if (!payload || !payload.term) continue
    const firstMark = entry.marks[0]
    if (!firstMark) continue
    decoded.push({
      id: payload.id,
      term: payload.term,
      subTerm: payload.subTerm,
      sec: firstMark.sec,
      para: firstMark.para,
      offset: firstMark.offset,
      ctrlIdx: firstMark.ctrlIdx,
      names: entry.names,
      marks: entry.marks,
    })
  }
  decoded.sort((a, b) => {
    if (a.sec !== b.sec) return a.sec - b.sec
    if (a.para !== b.para) return a.para - b.para
    if (a.offset !== b.offset) return a.offset - b.offset
    return a.ctrlIdx - b.ctrlIdx
  })
  return decoded
}

function nextIndexId(decodedEntries) {
  let maxNum = 0
  const used = new Set()
  for (const item of decodedEntries) {
    used.add(item.id)
    if (/^\d+$/.test(item.id)) {
      const n = Number(item.id)
      if (n > maxNum) maxNum = n
    }
  }
  let candidate = maxNum + 1
  while (used.has(String(candidate))) {
    candidate += 1
  }
  return String(candidate)
}

function normalizeTermText(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed || DISALLOWED_TERM_CHARS_RE.test(trimmed)) return ''
  return trimmed
}

function normalizeSubTermText(value) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (DISALLOWED_TERM_CHARS_RE.test(trimmed)) return ''
  return trimmed
}

function writeIndexBookmark(doc, place, term, subTerm, id, existingNames) {
  const names = encodeMarkChunks(MARK_PREFIXES.index, [term, subTerm, id], {
    maxLen: MAX_MARK_NAME_LEN,
    existingNames,
  })
  const written = []
  for (const name of names) {
    const res = addMark(doc, place, name)
    if (!res.ok) {
      for (const prev of [...written].reverse()) {
        removeMark(doc, prev)
      }
      return res
    }
    written.push(name)
    existingNames.add(name)
  }
  return { ok: true, names: written }
}

/**
 * Add a single index mark (`색인:`) at a validated body paragraph position.
 * Refuses non-body positions (`unsupported_place`) and out-of-range coordinates (`not_found`).
 */
export function addIndexMark(doc, place, termOrOptions = {}) {
  const target = validateBodyTarget(doc, place, {
    allowInTableReason: false,
    checkOffsetBounds: true,
  })
  if (!target.ok) return target

  const opts = typeof termOrOptions === 'string' ? { term: termOrOptions } : (termOrOptions ?? {})
  let rawTerm = typeof opts.term === 'string' ? opts.term : ''
  if (!rawTerm.trim() && typeof opts.selectedText === 'string') {
    rawTerm = opts.selectedText
  }
  if (!rawTerm.trim()) {
    const resolvedWord = resolveIndexWordAt(doc, target)
    if (resolvedWord) rawTerm = resolvedWord.word
  }

  const term = normalizeTermText(rawTerm)
  if (!term) {
    return { ok: false, reason: 'invalid_term' }
  }
  if (
    opts.subTerm !== undefined &&
    opts.subTerm !== null &&
    (typeof opts.subTerm !== 'string' || DISALLOWED_TERM_CHARS_RE.test(opts.subTerm.trim()))
  ) {
    return { ok: false, reason: 'invalid_term' }
  }
  const subTerm = normalizeSubTermText(opts.subTerm)

  const existingEntries = readDecodedIndexEntries(doc)
  const existingNames = readAllBookmarkNames(doc)
  const id = nextIndexId(existingEntries)

  const written = writeIndexBookmark(doc, target, term, subTerm, id, existingNames)
  if (!written.ok) return written

  return {
    ok: true,
    id,
    term,
    subTerm,
    sec: target.sec,
    para: target.para,
    offset: target.offset,
    names: written.names,
  }
}

function isInsideRanges(ranges, sec, para, offset) {
  for (const r of ranges) {
    const s = r.start
    const e = r.end
    const afterStart =
      sec > s.sec || (sec === s.sec && (para > s.para || (para === s.para && offset >= s.offset)))
    const beforeEnd =
      sec < e.sec || (sec === e.sec && (para < e.para || (para === e.para && offset <= e.offset)))
    if (afterStart && beforeEnd) return true
  }
  return false
}

function isParaInsideRanges(ranges, sec, para) {
  for (const r of ranges) {
    const s = r.start
    const e = r.end
    const afterStart = sec > s.sec || (sec === s.sec && para >= s.para)
    const beforeEnd = sec < e.sec || (sec === e.sec && para <= e.para)
    if (afterStart && beforeEnd) return true
  }
  return false
}

/**
 * Mark all whole-word body occurrences of `query` (defaults to `term`) with `색인:` bookmarks.
 * Skips matches inside existing index blocks and duplicate `(term, subTerm)` marks at the same
 * offset. Counts matches inside table cells, text boxes, footnotes, and endnotes without marking them.
 */
export function addIndexMarksAll(doc, termOrOptions) {
  if (!doc || typeof doc.getSectionCount !== 'function') {
    return { ok: false, reason: 'unsupported_place' }
  }
  const opts = typeof termOrOptions === 'string' ? { term: termOrOptions } : (termOrOptions ?? {})
  const query = typeof opts.query === 'string' && opts.query.trim() ? opts.query.trim() : ''
  const rawTerm = typeof opts.term === 'string' && opts.term.trim() ? opts.term : query
  const term = normalizeTermText(rawTerm)
  const searchQuery = query || term
  if (!term || !searchQuery) {
    return { ok: false, reason: 'invalid_term' }
  }
  if (
    opts.subTerm !== undefined &&
    opts.subTerm !== null &&
    (typeof opts.subTerm !== 'string' || DISALLOWED_TERM_CHARS_RE.test(opts.subTerm.trim()))
  ) {
    return { ok: false, reason: 'invalid_term' }
  }
  const subTerm = normalizeSubTermText(opts.subTerm)
  const caseSensitive = Boolean(opts.caseSensitive)
  const wholeWord = opts.wholeWord !== undefined ? Boolean(opts.wholeWord) : true

  const found = findMatches(doc, {
    query: searchQuery,
    caseSensitive,
    wholeWord,
    regex: false,
  })
  if (!found.ok) return found

  const { ranges: indexBlockRanges } = findRangeMarks(doc, [MARK_PREFIXES.indexBlock])
  const existingEntries = readDecodedIndexEntries(doc)
  const existingNames = readAllBookmarkNames(doc)
  const existingKeys = new Set(
    existingEntries.map((m) => `${m.sec}:${m.para}:${m.offset}\0${m.term}\0${m.subTerm}`),
  )

  let nextNum = Number(nextIndexId(existingEntries))
  const usedIds = new Set(existingEntries.map((m) => m.id))
  const allocateId = () => {
    while (usedIds.has(String(nextNum))) nextNum += 1
    const id = String(nextNum)
    usedIds.add(id)
    nextNum += 1
    return id
  }

  const skippedCounts = {
    tableCell: 0,
    textBox: 0,
    footnote: 0,
    endnote: 0,
  }
  let skippedNonBody = 0
  const addedMarks = []

  for (const match of found.matches) {
    if (match.kind === 'body') {
      if (isInsideRanges(indexBlockRanges, match.sec, match.para, match.offset)) {
        continue
      }
      const dedupKey = `${match.sec}:${match.para}:${match.offset}\0${term}\0${subTerm}`
      if (existingKeys.has(dedupKey)) {
        continue
      }
      const id = allocateId()
      const written = writeIndexBookmark(
        doc,
        { sec: match.sec, para: match.para, offset: match.offset },
        term,
        subTerm,
        id,
        existingNames,
      )
      if (!written.ok) return written
      existingKeys.add(dedupKey)
      addedMarks.push({
        id,
        term,
        subTerm,
        sec: match.sec,
        para: match.para,
        offset: match.offset,
        names: written.names,
      })
    } else if (isParaInsideRanges(indexBlockRanges, match.sec, match.para)) {
      continue
    } else if (match.kind === 'table') {
      skippedCounts.tableCell += 1
      skippedNonBody += 1
    } else if (match.kind === 'textbox') {
      skippedCounts.textBox += 1
      skippedNonBody += 1
    } else if (match.kind === 'footnote') {
      skippedCounts.footnote += 1
      skippedNonBody += 1
    } else if (match.kind === 'endnote') {
      skippedCounts.endnote += 1
      skippedNonBody += 1
    }
  }

  return {
    ok: true,
    added: addedMarks.length,
    skippedNonBody,
    skippedCounts,
    marks: addedMarks,
  }
}

/**
 * List all `색인:` marks in document order with decoded `{ term, subTerm, id }` and printed page info.
 */
export function listIndexMarks(doc) {
  if (!doc || typeof doc.getSectionCount !== 'function') return []
  return withPortableMetrics(doc, () => {
    const decoded = readDecodedIndexEntries(doc)
    if (decoded.length === 0) return []
    const resolvePage = buildPageLookup(doc)
    return decoded.map((item) => {
      const pageInfo = resolvePage(item.sec, item.para)
      return {
        id: item.id,
        term: item.term,
        subTerm: item.subTerm,
        sec: item.sec,
        para: item.para,
        offset: item.offset,
        page: pageInfo.page,
        pageLabel: pageInfo.pageLabel,
        physicalPage: pageInfo.physicalPage,
        numberingRun: pageInfo.numberingRun,
        names: item.names,
      }
    })
  })
}

function deleteMarkEntriesReverse(doc, markEntries) {
  const unique = new Map()
  for (const m of markEntries) {
    unique.set(`${m.sec}:${m.para}:${m.ctrlIdx}`, m)
  }
  const ordered = [...unique.values()].sort((a, b) => {
    if (a.sec !== b.sec) return b.sec - a.sec
    if (a.para !== b.para) return b.para - a.para
    return b.ctrlIdx - a.ctrlIdx
  })
  const removedNames = []
  for (const m of ordered) {
    const res = removeMark(doc, m)
    if (res.ok) removedNames.push(m.name)
  }
  return removedNames
}

/**
 * Delete all bookmark(s) belonging to a single index mark identified by its `id`,
 * bookmark name, array of bookmark names, or mark object.
 */
export function removeIndexMark(doc, markIdOrNames) {
  if (!doc || markIdOrNames == null) return { ok: false, reason: 'not_found' }
  const decoded = readDecodedIndexEntries(doc)

  const targetMarks = []
  if (typeof markIdOrNames === 'string') {
    for (const item of decoded) {
      if (item.id === markIdOrNames || item.names.includes(markIdOrNames)) {
        targetMarks.push(...item.marks)
        break
      }
    }
  } else if (Array.isArray(markIdOrNames)) {
    const wanted = new Set(markIdOrNames.filter((n) => typeof n === 'string'))
    for (const item of decoded) {
      if (item.names.some((n) => wanted.has(n))) {
        targetMarks.push(...item.marks)
      }
    }
  } else if (typeof markIdOrNames === 'object') {
    const wantedId = typeof markIdOrNames.id === 'string' ? markIdOrNames.id : null
    const wantedNames = Array.isArray(markIdOrNames.names) ? new Set(markIdOrNames.names) : null
    for (const item of decoded) {
      if (
        (wantedId && item.id === wantedId) ||
        (wantedNames && item.names.some((n) => wantedNames.has(n)))
      ) {
        targetMarks.push(...item.marks)
        break
      }
    }
  }

  if (targetMarks.length === 0) {
    return { ok: false, reason: 'not_found' }
  }
  const removedNames = deleteMarkEntriesReverse(doc, targetMarks)
  return {
    ok: true,
    removed: removedNames.length,
    names: removedNames,
  }
}

/**
 * Delete all index marks matching `term` (and optionally `subTerm` when provided).
 */
export function removeIndexMarksByTerm(doc, term, subTerm = undefined) {
  const cleanTerm = normalizeTermText(term)
  if (!doc || !cleanTerm) return { ok: false, reason: 'invalid_term' }
  const filterSub = subTerm !== undefined
  const cleanSub = filterSub ? normalizeSubTermText(subTerm) : ''

  const decoded = readDecodedIndexEntries(doc)
  const matchedEntries = decoded.filter(
    (item) => item.term === cleanTerm && (!filterSub || item.subTerm === cleanSub),
  )
  if (matchedEntries.length === 0) {
    return { ok: true, removedMarks: 0, removedBookmarks: 0, names: [] }
  }
  const allBookmarks = matchedEntries.flatMap((e) => e.marks)
  const removedNames = deleteMarkEntriesReverse(doc, allBookmarks)
  return {
    ok: true,
    removedMarks: matchedEntries.length,
    removedBookmarks: removedNames.length,
    names: removedNames,
  }
}

function dedupeAndSortPages(pageItems) {
  const byKey = new Map()
  for (const item of pageItems) {
    const run = Number.isInteger(item.numberingRun) ? item.numberingRun : 0
    const page = Number.isInteger(item.page) ? item.page : 1
    const pageLabel =
      typeof item.pageLabel === 'string' && item.pageLabel.length > 0
        ? item.pageLabel
        : String(page)
    const key = `${run}:${pageLabel}`
    if (!byKey.has(key)) {
      byKey.set(key, {
        page,
        pageLabel,
        physicalPage: item.physicalPage ?? page,
        numberingRun: run,
      })
    }
  }
  const sorted = [...byKey.values()].sort((a, b) => {
    if (a.numberingRun !== b.numberingRun) return a.numberingRun - b.numberingRun
    if (a.page !== b.page) return a.page - b.page
    return a.physicalPage - b.physicalPage
  })
  return sorted
}

/**
 * Group, sort, and deduplicate index marks into consonant/alphabet sections with sub-entries.
 */
export function groupIndexEntries(marks, options = {}) {
  const groupHeadings = options.groupHeadings !== undefined ? Boolean(options.groupHeadings) : true
  const byTerm = new Map()

  for (const mark of marks) {
    if (!mark || typeof mark.term !== 'string' || !mark.term.trim()) continue
    const term = mark.term.trim()
    const subTerm = typeof mark.subTerm === 'string' ? mark.subTerm.trim() : ''
    let bucket = byTerm.get(term)
    if (!bucket) {
      bucket = { term, directPages: [], subMap: new Map() }
      byTerm.set(term, bucket)
    }
    if (subTerm) {
      let subList = bucket.subMap.get(subTerm)
      if (!subList) {
        subList = []
        bucket.subMap.set(subTerm, subList)
      }
      subList.push(mark)
    } else {
      bucket.directPages.push(mark)
    }
  }

  const sortedTerms = [...byTerm.keys()].sort(compareIndexTerms)
  const entries = sortedTerms.map((term) => {
    const bucket = byTerm.get(term)
    const pages = dedupeAndSortPages(bucket.directPages)
    const pagesText = pages.map((p) => p.pageLabel).join(', ')
    const sortedSubs = [...bucket.subMap.keys()].sort(compareIndexTerms)
    const subEntries = sortedSubs.map((subTerm) => {
      const subPages = dedupeAndSortPages(bucket.subMap.get(subTerm))
      return {
        subTerm,
        pages: subPages,
        pagesText: subPages.map((p) => p.pageLabel).join(', '),
      }
    })
    return {
      term,
      heading: indexGroupHeadingOf(term),
      pages,
      pagesText,
      subEntries,
    }
  })

  if (!groupHeadings) {
    return {
      groups: entries.length > 0 ? [{ heading: null, entries }] : [],
      entries,
    }
  }

  const groups = []
  let current = null
  for (const entry of entries) {
    if (!current || current.heading !== entry.heading) {
      current = { heading: entry.heading, entries: [] }
      groups.push(current)
    }
    current.entries.push(entry)
  }
  return { groups, entries }
}

/**
 * Flatten grouped index entries into canonical render rows used by both
 * `'dotted-tab'` and `'table'` layouts, plus expected plain-text lines.
 */
function buildRenderRows(groups, title) {
  const rows = []
  if (title) {
    rows.push({ kind: 'title', left: title, right: '', line: title })
  }
  for (const group of groups) {
    if (group.heading) {
      rows.push({
        kind: 'heading',
        left: group.heading,
        right: '',
        line: group.heading,
      })
    }
    for (const entry of group.entries) {
      const hasPages = entry.pagesText.length > 0
      rows.push({
        kind: 'entry',
        term: entry.term,
        subTerm: '',
        left: entry.term,
        right: entry.pagesText,
        line: hasPages ? `${entry.term}\t${entry.pagesText}` : entry.term,
      })
      for (const sub of entry.subEntries) {
        rows.push({
          kind: 'subentry',
          term: entry.term,
          subTerm: sub.subTerm,
          left: sub.subTerm,
          right: sub.pagesText,
          line: sub.pagesText ? `${sub.subTerm}\t${sub.pagesText}` : sub.subTerm,
        })
      }
    }
  }
  return rows
}

function readColumnDefSafe(doc, sec) {
  const raw =
    typeof doc.getColumnDef === 'function'
      ? tryOr(() => parseJson(doc.getColumnDef(sec), null), null)
      : null
  return {
    columnCount: Number.isInteger(raw?.columnCount) && raw.columnCount >= 1 ? raw.columnCount : 1,
    columnType: Number.isInteger(raw?.columnType) ? raw.columnType : 0,
    sameWidth: raw?.sameWidth !== false,
    spacing: Number.isFinite(raw?.spacing) ? Math.round(raw.spacing) : 0,
  }
}

function computeColumnWidthHu(doc, sec, fallbackCols, fallbackGapHu) {
  const pd =
    typeof doc.getPageDef === 'function'
      ? tryOr(() => parseJson(doc.getPageDef(sec), null), null)
      : null
  const cd = readColumnDefSafe(doc, sec)
  const pageWidth = pd ? (pd.landscape ? pd.height : pd.width) : 59528
  const marginLeft = pd?.marginLeft ?? 8504
  const marginRight = pd?.marginRight ?? 8504
  const marginGutter = pd?.marginGutter ?? 0
  const bodyWidthHu = Math.max(4000, pageWidth - marginLeft - marginRight - marginGutter)
  const cols = Math.max(1, cd.columnCount || fallbackCols || 1)
  const spacing = cols > 1 ? (cd.spacing > 0 ? cd.spacing : fallbackGapHu) : 0
  return Math.max(2000, Math.floor((bodyWidthHu - spacing * (cols - 1)) / cols))
}

function normalizeBuildOptions(options = {}, fallback = {}) {
  const rawTitle =
    options.title !== undefined
      ? options.title
      : fallback.title !== undefined
        ? fallback.title
        : DEFAULT_INDEX_TITLE
  const title =
    rawTitle === null || rawTitle === ''
      ? ''
      : typeof rawTitle === 'string'
        ? rawTitle.trim()
        : null
  if (title === null || (title && DISALLOWED_TERM_CHARS_RE.test(title))) {
    return { ok: false, reason: 'invalid_options', error: 'Invalid title option' }
  }

  const columns =
    options.columns !== undefined
      ? options.columns
      : fallback.columns !== undefined
        ? fallback.columns
        : DEFAULT_INDEX_COLUMNS
  if (!Number.isInteger(columns) || columns < MIN_COLUMNS || columns > MAX_COLUMNS) {
    return { ok: false, reason: 'invalid_options', error: 'columns must be 1, 2, or 3' }
  }

  const columnGapMm =
    options.columnGapMm !== undefined
      ? options.columnGapMm
      : fallback.columnGapMm !== undefined
        ? fallback.columnGapMm
        : DEFAULT_COLUMN_GAP_MM
  if (
    typeof columnGapMm !== 'number' ||
    !Number.isFinite(columnGapMm) ||
    columnGapMm < 0 ||
    columnGapMm > 30
  ) {
    return { ok: false, reason: 'invalid_options', error: 'columnGapMm must be between 0 and 30' }
  }

  const groupHeadings =
    options.groupHeadings !== undefined
      ? Boolean(options.groupHeadings)
      : fallback.groupHeadings !== undefined
        ? Boolean(fallback.groupHeadings)
        : true

  const layout =
    options.layout !== undefined
      ? options.layout
      : fallback.layout !== undefined
        ? fallback.layout
        : DEFAULT_INDEX_LAYOUT
  if (layout !== 'dotted-tab' && layout !== 'table') {
    return { ok: false, reason: 'invalid_options', error: "layout must be 'dotted-tab' or 'table'" }
  }

  const where = options.where === 'after' ? 'after' : 'before'

  return {
    ok: true,
    title,
    columns,
    columnGapMm,
    gapHu: Math.round(columnGapMm * HWPUNIT_PER_MM),
    groupHeadings,
    layout,
    where,
  }
}

function flatBodyParaIndex(doc, sec, para) {
  let flat = para
  for (let s = 0; s < sec; s++) {
    flat += doc.getParagraphCount(s)
  }
  return flat
}

function resolveBodyStyleId(doc) {
  if (typeof doc.getStyleList !== 'function') return 0
  const list = tryOr(() => parseJson(doc.getStyleList(), []), [])
  if (!Array.isArray(list)) return 0
  const normal = list.find(
    (s) =>
      s &&
      (s.type === undefined || s.type === 0) &&
      (s.name === '바탕글' || s.englishName === 'Normal' || s.name === 'Normal'),
  )
  return Number.isInteger(normal?.id) ? normal.id : 0
}

/**
 * Reset an index paragraph to body style and clear inherited outline/break flags
 * (`pageBreakBefore`, `columnBreakBefore`, `headType`) copied by `insertParagraph`/`splitParagraph`.
 */
function resetIndexParagraph(doc, sec, para, bodyStyleId) {
  if (typeof doc.applyStyle === 'function') {
    expectOk(doc.applyStyle(sec, para, bodyStyleId), 'applyStyle')
  }
  if (typeof doc.applyParaFormat === 'function') {
    expectOk(
      doc.applyParaFormat(
        sec,
        para,
        JSON.stringify({
          pageBreakBefore: false,
          columnBreakBefore: false,
          headType: 'None',
          marginLeft: 0,
          marginRight: 0,
          indent: 0,
        }),
      ),
      'applyParaFormat',
    )
  }
}

/**
 * Snapshot and temporarily remove verified body-level (`list === 0 && ctrlId === 'bokm'`)
 * non-setting bookmarks on `(sec, para)` before splitting paragraph 0, then restore them
 * onto the displaced original paragraph so they never get trapped inside the index block.
 */
function captureNonSettingBookmarksOnPara(doc, sec, para) {
  if (typeof doc.getBookmarks !== 'function') return []
  const raw = tryOr(() => parseJson(doc.getBookmarks(), []), [])
  if (!Array.isArray(raw)) return []

  let bodySlots = null
  if (typeof doc.getControls === 'function') {
    const controls = tryOr(() => parseJson(doc.getControls(), null), null)
    if (Array.isArray(controls)) {
      bodySlots = new Map()
      const flatTarget = flatBodyParaIndex(doc, sec, para)
      for (const ctrl of controls) {
        if (!ctrl || ctrl.list !== 0 || ctrl.ctrlId !== 'bokm' || ctrl.para !== flatTarget) {
          continue
        }
        if (Number.isInteger(ctrl.controlIndex)) {
          bodySlots.set(ctrl.controlIndex, ctrl)
        }
      }
    }
  }

  const bySlot = new Map()
  for (const bm of raw) {
    if (!bm || typeof bm.name !== 'string') continue
    if (bm.name.startsWith(MARK_PREFIXES.setting)) continue
    const bmSec = bm.sec ?? bm.sectionIndex ?? 0
    const bmPara = bm.para ?? bm.paraIndex ?? 0
    if (bmSec !== sec || bmPara !== para) continue
    const ctrlIdx = bm.ctrlIdx ?? bm.controlIndex ?? 0
    if (bodySlots && !bodySlots.has(ctrlIdx)) continue
    const entry = {
      name: bm.name,
      sec: bmSec,
      para: bmPara,
      offset: bm.charPos ?? bm.charOffset ?? bm.offset ?? 0,
      ctrlIdx,
    }
    let list = bySlot.get(ctrlIdx)
    if (!list) {
      list = []
      bySlot.set(ctrlIdx, list)
    }
    list.push(entry)
  }

  const flatTarget = bodySlots ? flatBodyParaIndex(doc, sec, para) : -1
  const found = []
  for (const [ctrlIdx, candidates] of bySlot.entries()) {
    if (candidates.length === 1 || !bodySlots) {
      found.push(...candidates)
      continue
    }
    const ctrl = bodySlots.get(ctrlIdx)
    let expectedOffset = null
    if (ctrl && Number.isInteger(ctrl.pos) && typeof doc.getCharIndexAtStreamPos === 'function') {
      const at = tryOr(
        () => parseJson(doc.getCharIndexAtStreamPos(0, flatTarget, ctrl.pos), null),
        null,
      )
      if (at && Number.isInteger(at.charIndex)) expectedOffset = at.charIndex
    }
    const exact =
      expectedOffset !== null ? candidates.find((c) => c.offset === expectedOffset) : null
    found.push(exact ?? candidates[0])
  }

  if (found.length > 0) {
    deleteMarkEntriesReverse(doc, found)
  }
  return found
}

function restoreBookmarksOnPara(doc, sec, para, savedBookmarks) {
  for (const bm of savedBookmarks) {
    addMark(doc, { sec, para, offset: bm.offset }, bm.name)
  }
}

/**
 * Prepare a clean empty anchor paragraph for inserting the index block, optionally
 * isolating it in its own section when `columns` differs from the host section's column count.
 */
function prepareIndexSlot(doc, sec, para, columns, gapHu) {
  const origColDef = readColumnDefSafe(doc, sec)
  const paraCount = doc.getParagraphCount(sec)
  const needsScopedSection = columns !== origColDef.columnCount

  if (!needsScopedSection) {
    if (para === 0) {
      const displaced = captureNonSettingBookmarksOnPara(doc, sec, 0)
      expectOk(doc.splitParagraph(sec, 0, 0), 'splitParagraph')
      restoreBookmarksOnPara(doc, sec, 1, displaced)
      return {
        indexSec: sec,
        startPara: 0,
        scope: { scopedSection: false, origColDef },
      }
    }
    if (para >= paraCount) {
      const last = paraCount - 1
      expectOk(doc.splitParagraph(sec, last, doc.getParagraphLength(sec, last)), 'splitParagraph')
      return {
        indexSec: sec,
        startPara: paraCount,
        scope: { scopedSection: false, origColDef },
      }
    }
    expectOk(doc.insertParagraph(sec, para), 'insertParagraph')
    return {
      indexSec: sec,
      startPara: para,
      scope: { scopedSection: false, origColDef },
    }
  }

  // Scoped multi-column section: isolate the index block so preceding and trailing body
  // paragraphs keep `origColDef` untouched, surviving HWP/HWPX roundtrip.
  if (para === 0) {
    const displaced = captureNonSettingBookmarksOnPara(doc, sec, 0)
    expectOk(doc.splitSection(sec, 0, 0), 'splitSection')
    restoreBookmarksOnPara(doc, sec + 1, 0, displaced)
    expectOk(doc.setColumnDef(sec, columns, 0, 1, gapHu), 'setColumnDef')
    return {
      indexSec: sec,
      startPara: 0,
      scope: {
        scopedSection: true,
        splitBefore: false,
        splitAfter: true,
        origColDef,
      },
    }
  }

  if (para >= paraCount) {
    const last = paraCount - 1
    expectOk(doc.splitParagraph(sec, last, doc.getParagraphLength(sec, last)), 'splitParagraph')
    expectOk(doc.splitSection(sec, paraCount, 0), 'splitSection')
    const indexSec = sec + 1
    expectOk(doc.setColumnDef(indexSec, columns, 0, 1, gapHu), 'setColumnDef')
    return {
      indexSec,
      startPara: 0,
      scope: {
        scopedSection: true,
        splitBefore: true,
        splitAfter: false,
        origColDef,
      },
    }
  }

  // Middle of section: insert empty anchor paragraph first so bookmarks on `para` stay intact.
  expectOk(doc.insertParagraph(sec, para), 'insertParagraph')
  expectOk(doc.splitSection(sec, para, 0), 'splitSection')
  const indexSec = sec + 1
  expectOk(doc.splitSection(indexSec, 1, 0), 'splitSection')
  expectOk(doc.setColumnDef(indexSec, columns, 0, 1, gapHu), 'setColumnDef')
  return {
    indexSec,
    startPara: 0,
    scope: {
      scopedSection: true,
      splitBefore: true,
      splitAfter: true,
      origColDef,
    },
  }
}

/**
 * Render index rows into `(indexSec, startPara)` using either `'dotted-tab'` paragraphs
 * or a borderless 2-column `'table'`. Returns layout handles for Pass-2 page updates.
 */
function renderIndexRowsIntoSlot(doc, indexSec, startPara, rows, opts) {
  const bodyStyleId = resolveBodyStyleId(doc)
  const colWidthHu = computeColumnWidthHu(doc, indexSec, opts.columns, opts.gapHu)
  const rightTabStop = {
    position: colWidthHu * 2,
    type: TAB_ALIGN_RIGHT,
    fill: TAB_LEADER_DOTS,
  }

  if (opts.layout === 'table') {
    const hasTitle = rows.length > 0 && rows[0].kind === 'title'
    const bodyRows = hasTitle ? rows.slice(1) : rows
    let tablePara = startPara

    if (hasTitle) {
      resetIndexParagraph(doc, indexSec, startPara, bodyStyleId)
      const titleText = rows[0].left
      expectOk(doc.insertText(indexSec, startPara, 0, titleText), 'insertText')
      const titleLen = Array.from(titleText).length
      expectOk(
        doc.applyCharFormat(
          indexSec,
          startPara,
          0,
          titleLen,
          JSON.stringify({ bold: true, fontSize: TITLE_FONT_SIZE }),
        ),
        'applyCharFormat',
      )
      expectOk(
        doc.applyParaFormat(
          indexSec,
          startPara,
          JSON.stringify({
            alignment: 'left',
            marginLeft: 0,
            spacingBefore: 0,
            spacingAfter: TITLE_SPACING_AFTER,
            keepWithNext: true,
            pageBreakBefore: false,
            columnBreakBefore: false,
          }),
        ),
        'applyParaFormat',
      )
      expectOk(
        doc.splitParagraph(indexSec, startPara, doc.getParagraphLength(indexSec, startPara)),
        'splitParagraph',
      )
      tablePara = startPara + 1
    }

    resetIndexParagraph(doc, indexSec, tablePara, bodyStyleId)
    const rowCount = Math.max(1, bodyRows.length)
    const leftW = Math.round(colWidthHu * TABLE_LEFT_COL_RATIO)
    const rightW = Math.max(1000, colWidthHu - leftW)
    const created = expectOk(
      doc.createTableEx(
        JSON.stringify({
          sectionIdx: indexSec,
          paraIdx: tablePara,
          charOffset: 0,
          rowCount,
          colCount: 2,
          treatAsChar: true,
          colWidths: [leftW, rightW],
        }),
      ),
      'createTableEx',
    )
    const controlIdx = created.controlIdx ?? 0
    const rowBindings = []

    for (let r = 0; r < bodyRows.length; r++) {
      const row = bodyRows[r]
      const leftCell = r * 2
      const rightCell = r * 2 + 1
      expectOk(
        doc.setCellProperties(indexSec, tablePara, controlIdx, leftCell, BORDERLESS_CELL_JSON),
        'setCellProperties',
      )
      expectOk(
        doc.setCellProperties(indexSec, tablePara, controlIdx, rightCell, BORDERLESS_CELL_JSON),
        'setCellProperties',
      )

      if (row.left) {
        expectOk(
          doc.insertTextInCell(indexSec, tablePara, controlIdx, leftCell, 0, 0, row.left),
          'insertTextInCell',
        )
      }
      if (row.right) {
        expectOk(
          doc.insertTextInCell(indexSec, tablePara, controlIdx, rightCell, 0, 0, row.right),
          'insertTextInCell',
        )
      }

      if (row.kind === 'heading' && row.left) {
        expectOk(
          doc.applyCharFormatInCell(
            indexSec,
            tablePara,
            controlIdx,
            leftCell,
            0,
            0,
            Array.from(row.left).length,
            JSON.stringify({ bold: true }),
          ),
          'applyCharFormatInCell',
        )
      } else if (row.kind === 'subentry') {
        expectOk(
          doc.applyParaFormatInCell(
            indexSec,
            tablePara,
            controlIdx,
            leftCell,
            0,
            JSON.stringify({ marginLeft: SUB_ENTRY_MARGIN_LEFT }),
          ),
          'applyParaFormatInCell',
        )
      }

      expectOk(
        doc.applyParaFormatInCell(
          indexSec,
          tablePara,
          controlIdx,
          rightCell,
          0,
          JSON.stringify({ alignment: 'right' }),
        ),
        'applyParaFormatInCell',
      )

      rowBindings.push({
        rowIndex: r,
        kind: row.kind,
        term: row.term ?? '',
        subTerm: row.subTerm ?? '',
        left: row.left,
        right: row.right,
        rightCell,
      })
    }

    return {
      layout: 'table',
      startPara,
      endPara: tablePara,
      endOffset: 0,
      tablePara,
      controlIdx,
      rowBindings,
    }
  }

  // 'dotted-tab' layout: one paragraph per row with a right dot-leader tab stop.
  const paraBindings = []
  for (let i = 0; i < rows.length; i++) {
    const p = startPara + i
    if (i > 0) {
      const prevLen = doc.getParagraphLength(indexSec, p - 1)
      expectOk(doc.splitParagraph(indexSec, p - 1, prevLen), 'splitParagraph')
    }
    resetIndexParagraph(doc, indexSec, p, bodyStyleId)
    const row = rows[i]
    if (row.line) {
      expectOk(doc.insertText(indexSec, p, 0, row.line), 'insertText')
    }
    const lineLen = Array.from(row.line).length

    if (row.kind === 'title') {
      if (lineLen > 0) {
        expectOk(
          doc.applyCharFormat(
            indexSec,
            p,
            0,
            lineLen,
            JSON.stringify({ bold: true, fontSize: TITLE_FONT_SIZE }),
          ),
          'applyCharFormat',
        )
      }
      expectOk(
        doc.applyParaFormat(
          indexSec,
          p,
          JSON.stringify({
            alignment: 'left',
            marginLeft: 0,
            spacingBefore: 0,
            spacingAfter: TITLE_SPACING_AFTER,
            keepWithNext: true,
            pageBreakBefore: false,
            columnBreakBefore: false,
          }),
        ),
        'applyParaFormat',
      )
    } else if (row.kind === 'heading') {
      if (lineLen > 0) {
        expectOk(
          doc.applyCharFormat(indexSec, p, 0, lineLen, JSON.stringify({ bold: true })),
          'applyCharFormat',
        )
      }
      expectOk(
        doc.applyParaFormat(
          indexSec,
          p,
          JSON.stringify({
            alignment: 'left',
            marginLeft: 0,
            spacingBefore: GROUP_HEADING_SPACING_BEFORE,
            spacingAfter: 0,
            keepWithNext: true,
            pageBreakBefore: false,
            columnBreakBefore: false,
          }),
        ),
        'applyParaFormat',
      )
    } else if (row.kind === 'entry') {
      if (lineLen > 0) {
        expectOk(
          doc.applyCharFormat(indexSec, p, 0, lineLen, JSON.stringify({ bold: false })),
          'applyCharFormat',
        )
      }
      const paraProps =
        row.right.length > 0
          ? {
              alignment: 'left',
              marginLeft: 0,
              spacingBefore: 0,
              spacingAfter: 0,
              keepWithNext: false,
              pageBreakBefore: false,
              columnBreakBefore: false,
              tabStops: [rightTabStop],
            }
          : {
              alignment: 'left',
              marginLeft: 0,
              spacingBefore: 0,
              spacingAfter: 0,
              keepWithNext: true,
              pageBreakBefore: false,
              columnBreakBefore: false,
            }
      expectOk(doc.applyParaFormat(indexSec, p, JSON.stringify(paraProps)), 'applyParaFormat')
    } else if (row.kind === 'subentry') {
      if (lineLen > 0) {
        expectOk(
          doc.applyCharFormat(indexSec, p, 0, lineLen, JSON.stringify({ bold: false })),
          'applyCharFormat',
        )
      }
      expectOk(
        doc.applyParaFormat(
          indexSec,
          p,
          JSON.stringify({
            alignment: 'left',
            marginLeft: SUB_ENTRY_MARGIN_LEFT,
            spacingBefore: 0,
            spacingAfter: 0,
            keepWithNext: false,
            pageBreakBefore: false,
            columnBreakBefore: false,
            tabStops: [rightTabStop],
          }),
        ),
        'applyParaFormat',
      )
    }

    paraBindings.push({
      para: p,
      kind: row.kind,
      term: row.term ?? '',
      subTerm: row.subTerm ?? '',
      left: row.left,
      right: row.right,
    })
  }

  const endPara = startPara + Math.max(0, rows.length - 1)
  const endOffset = doc.getParagraphLength(indexSec, endPara)
  return {
    layout: 'dotted-tab',
    startPara,
    endPara,
    endOffset,
    paraBindings,
  }
}

/**
 * Update rendered page-number strings in place after insertion (up to 2 passes)
 * so marks shifted by the index block itself reflect accurate printed pages.
 */
function stabilizeIndexPages(doc, indexSec, renderHandle, opts) {
  let latestGrouped = null
  let latestRows = null

  for (let pass = 0; pass < MAX_PAGE_STABILIZE_PASSES; pass++) {
    const currentMarks = listIndexMarks(doc)
    latestGrouped = groupIndexEntries(currentMarks, { groupHeadings: opts.groupHeadings })
    latestRows = buildRenderRows(latestGrouped.groups, opts.title)

    const pageByKey = new Map()
    for (const row of latestRows) {
      if (row.kind === 'entry' || row.kind === 'subentry') {
        pageByKey.set(`${row.kind}\0${row.term}\0${row.subTerm}`, row.right)
      }
    }

    let changed = false
    if (renderHandle.layout === 'table') {
      const { tablePara, controlIdx, rowBindings } = renderHandle
      for (const binding of rowBindings) {
        if (binding.kind !== 'entry' && binding.kind !== 'subentry') continue
        const nextRight =
          pageByKey.get(`${binding.kind}\0${binding.term}\0${binding.subTerm}`) ?? ''
        if (nextRight === binding.right) continue
        const oldLen = doc.getCellParagraphLength(
          indexSec,
          tablePara,
          controlIdx,
          binding.rightCell,
          0,
        )
        if (oldLen > 0) {
          expectOk(
            doc.deleteTextInCell(indexSec, tablePara, controlIdx, binding.rightCell, 0, 0, oldLen),
            'deleteTextInCell',
          )
        }
        if (nextRight) {
          expectOk(
            doc.insertTextInCell(
              indexSec,
              tablePara,
              controlIdx,
              binding.rightCell,
              0,
              0,
              nextRight,
            ),
            'insertTextInCell',
          )
        }
        binding.right = nextRight
        changed = true
      }
    } else {
      for (const binding of renderHandle.paraBindings) {
        if (binding.kind !== 'entry' && binding.kind !== 'subentry') continue
        const nextRight =
          pageByKey.get(`${binding.kind}\0${binding.term}\0${binding.subTerm}`) ?? ''
        if (nextRight === binding.right) continue
        const curLen = doc.getParagraphLength(indexSec, binding.para)
        const curText = curLen > 0 ? doc.getTextRange(indexSec, binding.para, 0, curLen) : ''
        const tabUtf16 = curText.indexOf('\t')
        if (tabUtf16 >= 0) {
          const prefixCpLen = Array.from(curText.slice(0, tabUtf16 + 1)).length
          const oldRightCpLen = Array.from(curText.slice(tabUtf16 + 1)).length
          expectOk(
            doc.replaceText(indexSec, binding.para, prefixCpLen, oldRightCpLen, nextRight),
            'replaceText',
          )
        } else if (nextRight) {
          expectOk(doc.insertText(indexSec, binding.para, curLen, `\t${nextRight}`), 'insertText')
        }
        binding.right = nextRight
        changed = true
      }
      renderHandle.endOffset = doc.getParagraphLength(indexSec, renderHandle.endPara)
    }

    if (!changed) break
  }

  return { grouped: latestGrouped, rows: latestRows }
}

function findBodyTableControlInPara(doc, sec, para) {
  if (typeof doc.getControls !== 'function') return null
  const controls = tryOr(() => parseJson(doc.getControls(), []), [])
  if (!Array.isArray(controls)) return null
  let flat = para
  for (let s = 0; s < sec; s++) flat += doc.getParagraphCount(s)
  const tbl = controls.find((c) => c && c.list === 0 && c.para === flat && c.ctrlId === 'tbl')
  return tbl && Number.isInteger(tbl.controlIndex) ? tbl.controlIndex : null
}

/**
 * Read plain-text lines inside an existing index block range for manual-edit detection.
 */
function readRangePlainLines(doc, range, layoutHint) {
  const sec = range.start.sec
  const startPara = range.start.para
  const endPara = range.end.para
  const lines = []

  for (let p = startPara; p <= endPara; p++) {
    const tblCtrl = layoutHint === 'table' ? findBodyTableControlInPara(doc, sec, p) : null
    if (tblCtrl !== null) {
      const dims = tryOr(() => parseJson(doc.getTableDimensions(sec, p, tblCtrl), null), null)
      const rowCount = dims?.rowCount ?? 0
      const colCount = dims?.colCount ?? 0
      for (let r = 0; r < rowCount; r++) {
        const leftCell = r * colCount
        const rightCell = colCount > 1 ? leftCell + 1 : -1
        const leftLen = tryOr(() => doc.getCellParagraphLength(sec, p, tblCtrl, leftCell, 0), 0)
        const leftText =
          leftLen > 0
            ? tryOr(() => doc.getTextInCell(sec, p, tblCtrl, leftCell, 0, 0, leftLen), '')
            : ''
        let rightText = ''
        if (rightCell >= 0) {
          const rightLen = tryOr(() => doc.getCellParagraphLength(sec, p, tblCtrl, rightCell, 0), 0)
          rightText =
            rightLen > 0
              ? tryOr(() => doc.getTextInCell(sec, p, tblCtrl, rightCell, 0, 0, rightLen), '')
              : ''
        }
        lines.push(rightText ? `${leftText}\t${rightText}` : leftText)
      }
      continue
    }

    const len = tryOr(() => doc.getParagraphLength(sec, p), 0)
    const text = len > 0 ? tryOr(() => doc.getTextRange(sec, p, 0, len), '') : ''
    lines.push(text)
  }

  return lines
}

function diffLines(expected, actual) {
  const modified = []
  const maxLen = Math.max(expected.length, actual.length)
  for (let i = 0; i < maxLen; i++) {
    const exp = i < expected.length ? expected[i] : null
    const act = i < actual.length ? actual[i] : null
    if (exp !== act) {
      modified.push({ lineIndex: i, expected: exp, actual: act })
    }
  }
  return modified
}

/**
 * Insert the paired `색인블록:기본:시작` / `색인블록:기본:끝` range mark.
 * When start and end share the exact same `(sec, para, offset)` (e.g. a title-less
 * table-layout index block on a 0-char paragraph), `@rhwp/core` prepends bookmarks at
 * identical offsets, so insert `끝` before `시작` and verify paired order via `findRangeMarks`.
 */
function addIndexRangeMark(doc, indexSec, startPara, startOffset, endPara, endOffset) {
  const startPlace = { sec: indexSec, para: startPara, offset: startOffset }
  const endPlace = { sec: indexSec, para: endPara, offset: endOffset }
  if (startPara !== endPara || startOffset !== endOffset) {
    return addRangeMark(doc, MARK_PREFIXES.indexBlock, INDEX_BLOCK_ID, startPlace, endPlace)
  }

  const startName = encodeMarkName(MARK_PREFIXES.indexBlock, [INDEX_BLOCK_ID, RANGE_START])
  const endName = encodeMarkName(MARK_PREFIXES.indexBlock, [INDEX_BLOCK_ID, RANGE_END])
  const existing = readAllBookmarkNames(doc)
  if (existing.has(startName) || existing.has(endName)) {
    return { ok: false, reason: 'duplicate_name' }
  }

  const endRes = addMark(doc, endPlace, endName)
  if (!endRes.ok) return endRes
  const startRes = addMark(doc, startPlace, startName)
  if (!startRes.ok) {
    removeMark(doc, endName)
    return startRes
  }

  const verified = findRangeMarks(doc, [MARK_PREFIXES.indexBlock])
  const paired = verified.ranges.some((r) => r.start.name === startName && r.end.name === endName)
  if (!paired) {
    removeMark(doc, startName)
    removeMark(doc, endName)
    return addRangeMark(doc, MARK_PREFIXES.indexBlock, INDEX_BLOCK_ID, startPlace, endPlace)
  }

  return {
    ok: true,
    prefix: MARK_PREFIXES.indexBlock,
    id: INDEX_BLOCK_ID,
    startName,
    endName,
    start: startPlace,
    end: endPlace,
  }
}

function finalizeIndexBlock(doc, indexSec, renderHandle, opts, scopeInfo) {
  const { grouped, rows } = stabilizeIndexPages(doc, indexSec, renderHandle, opts)
  const expectedLines = rows.map((r) => r.line)

  const rangeRes = addIndexRangeMark(
    doc,
    indexSec,
    renderHandle.startPara,
    0,
    renderHandle.endPara,
    renderHandle.endOffset,
  )
  if (!rangeRes.ok) return rangeRes

  const settingPayload = {
    title: opts.title,
    columns: opts.columns,
    columnGapMm: opts.columnGapMm,
    groupHeadings: opts.groupHeadings,
    layout: opts.layout,
    lines: expectedLines,
    scope: scopeInfo,
  }
  const settingRes = writeDocSetting(doc, INDEX_BLOCK_SETTING_KEY, settingPayload)
  if (!settingRes.ok) return settingRes

  return {
    ok: true,
    sec: indexSec,
    startPara: renderHandle.startPara,
    endPara: renderHandle.endPara,
    columns: opts.columns,
    layout: opts.layout,
    groupHeadings: opts.groupHeadings,
    title: opts.title,
    entryCount: grouped.entries.length,
    groupCount: grouped.groups.length,
    lines: expectedLines,
    range: {
      startName: rangeRes.startName,
      endName: rangeRes.endName,
      start: rangeRes.start,
      end: rangeRes.end,
    },
  }
}

/**
 * Build and insert an index block (`색인블록:`) before `place` (or after when `where: 'after'`).
 * Refuses table cells (`in_table`), other non-body locations (`unsupported_place`),
 * out-of-range coordinates (`not_found`), missing index marks (`no_index_marks`),
 * or an already-existing index block (`index_block_exists`).
 */
export function buildIndexBlock(doc, place, options = {}) {
  const opts = normalizeBuildOptions(options)
  if (!opts.ok) return opts

  const target = validateBodyTarget(doc, place, {
    allowInTableReason: true,
    allowEndPara: true,
    checkOffsetBounds: false,
  })
  if (!target.ok) return target

  const { ranges: existingRanges, broken: brokenIndexBlocks } = findRangeMarks(doc, [
    MARK_PREFIXES.indexBlock,
  ])
  if (existingRanges.length > 0) {
    return { ok: false, reason: 'index_block_exists', range: existingRanges[0] }
  }

  return withPortableMetrics(doc, () => {
    const initialMarks = listIndexMarks(doc)
    if (initialMarks.length === 0) {
      return { ok: false, reason: 'no_index_marks' }
    }

    // Clear orphan `색인블록:` start/end marks before building so a broken range never locks out builds.
    let cleanedBroken = []
    if (brokenIndexBlocks.length > 0) {
      cleanedBroken = cleanupBrokenMarks(doc, [MARK_PREFIXES.indexBlock]).removed
      deleteDocSetting(doc, INDEX_BLOCK_SETTING_KEY)
    }

    const insertPara = opts.where === 'after' ? target.para + 1 : target.para
    const initialGrouped = groupIndexEntries(initialMarks, { groupHeadings: opts.groupHeadings })
    const initialRows = buildRenderRows(initialGrouped.groups, opts.title)

    const slot = prepareIndexSlot(doc, target.sec, insertPara, opts.columns, opts.gapHu)
    const renderHandle = renderIndexRowsIntoSlot(
      doc,
      slot.indexSec,
      slot.startPara,
      initialRows,
      opts,
    )
    const finalized = finalizeIndexBlock(doc, slot.indexSec, renderHandle, opts, slot.scope)
    if (finalized.ok && cleanedBroken.length > 0) {
      return {
        ...finalized,
        cleanedMarks: {
          deduplicated: 0,
          brokenRemoved: cleanedBroken.length,
          renamed: [],
          removedBroken: cleanedBroken,
        },
      }
    }
    return finalized
  })
}

function clearParagraphContent(doc, sec, para) {
  const tblCtrl = findBodyTableControlInPara(doc, sec, para)
  if (tblCtrl !== null && typeof doc.deleteTableControl === 'function') {
    expectOk(doc.deleteTableControl(sec, para, tblCtrl), 'deleteTableControl')
  }
  const len = doc.getParagraphLength(sec, para)
  if (len > 0) {
    expectOk(doc.deleteText(sec, para, 0, len), 'deleteText')
  }
}

/**
 * Refresh an existing `색인블록:` index block in place.
 * Detects manual edits against saved lines in `설정:색인블록` and refuses unless
 * `options.allowOverwriteManual === true`. Cleans up or adjusts scoped multi-column sections.
 */
export function refreshIndexBlock(doc, options = {}) {
  if (!doc || typeof doc.getSectionCount !== 'function') {
    return { ok: false, reason: 'unsupported_place' }
  }

  const { ranges, broken: brokenBefore } = findRangeMarks(doc, [MARK_PREFIXES.indexBlock])
  if (ranges.length === 0) {
    if (brokenBefore.length > 0) {
      const cleaned = cleanupBrokenMarks(doc, [MARK_PREFIXES.indexBlock])
      deleteDocSetting(doc, INDEX_BLOCK_SETTING_KEY)
      return {
        ok: false,
        reason: 'not_found',
        cleanedMarks: {
          deduplicated: 0,
          brokenRemoved: cleaned.removed.length,
          renamed: [],
          removedBroken: cleaned.removed,
        },
      }
    }
    return { ok: false, reason: 'not_found' }
  }
  const initialRange = ranges[0]
  if (
    initialRange.start.sec !== initialRange.end.sec ||
    initialRange.start.para > initialRange.end.para
  ) {
    return { ok: false, reason: 'broken_range', range: initialRange }
  }

  const saved = readDocSetting(doc, INDEX_BLOCK_SETTING_KEY)
  const opts = normalizeBuildOptions(options, saved && typeof saved === 'object' ? saved : {})
  if (!opts.ok) return opts

  if (saved && Array.isArray(saved.lines)) {
    const actualLines = readRangePlainLines(doc, initialRange, saved.layout)
    const modifiedLines = diffLines(saved.lines, actualLines)
    if (modifiedLines.length > 0 && !options.allowOverwriteManual) {
      return {
        ok: false,
        reason: 'manual_edits',
        modifiedLines,
        range: initialRange,
      }
    }
  }

  return withPortableMetrics(doc, () => {
    // Repair copy/paste duplicates and remove orphan/incomplete index & index-block marks.
    const dedup = deduplicateMarks(doc, [MARK_PREFIXES.index, MARK_PREFIXES.indexBlock])
    const brokenRes = cleanupBrokenMarks(doc, [MARK_PREFIXES.index, MARK_PREFIXES.indexBlock])
    const cleanedMarks = {
      deduplicated: dedup.renamed.length + dedup.removed.length,
      brokenRemoved: brokenRes.removed.length,
      renamed: dedup.renamed,
      removedBroken: brokenRes.removed,
    }

    const activeRanges = findRangeMarks(doc, [MARK_PREFIXES.indexBlock]).ranges
    if (activeRanges.length === 0) {
      deleteDocSetting(doc, INDEX_BLOCK_SETTING_KEY)
      return { ok: false, reason: 'not_found', cleanedMarks }
    }
    const range = activeRanges[0]

    const initialMarks = listIndexMarks(doc)
    if (initialMarks.length === 0) {
      return { ok: false, reason: 'no_index_marks', cleanedMarks }
    }

    const oldSec = range.start.sec
    const oldStartPara = range.start.para
    const oldEndPara = range.end.para

    // 1. Remove old range bookmarks safely.
    deleteMarkEntriesReverse(doc, [range.start, range.end])

    // 2. Delete extra index paragraphs from bottom up, keeping `oldStartPara` as anchor.
    for (let p = oldEndPara; p > oldStartPara; p--) {
      expectOk(doc.deleteParagraph(oldSec, p), 'deleteParagraph')
    }
    clearParagraphContent(doc, oldSec, oldStartPara)

    // 3. Reconcile scoped multi-column section state cleanly.
    const savedScope = saved?.scope && typeof saved.scope === 'object' ? saved.scope : null
    const wasDedicatedSection =
      savedScope?.scopedSection === true &&
      oldStartPara === 0 &&
      doc.getParagraphCount(oldSec) === 1

    let indexSec = oldSec
    let startPara = oldStartPara
    let nextScope

    if (wasDedicatedSection) {
      const origColDef = savedScope.origColDef ?? {
        columnCount: 1,
        columnType: 0,
        sameWidth: true,
        spacing: 0,
      }
      if (opts.columns !== origColDef.columnCount) {
        // Stay in the dedicated section and update its column count/gap.
        expectOk(doc.setColumnDef(indexSec, opts.columns, 0, 1, opts.gapHu), 'setColumnDef')
        nextScope = { ...savedScope, origColDef }
      } else {
        // Restore original column definition and merge dedicated section back into host section.
        expectOk(
          doc.setColumnDef(
            indexSec,
            origColDef.columnCount,
            origColDef.columnType ?? 0,
            origColDef.sameWidth === false ? 0 : 1,
            origColDef.spacing ?? 0,
          ),
          'setColumnDef',
        )
        if (savedScope.splitAfter && indexSec + 1 < doc.getSectionCount()) {
          expectOk(doc.mergeSection(indexSec + 1), 'mergeSection')
        }
        if (savedScope.splitBefore && indexSec > 0) {
          const prevCount = doc.getParagraphCount(indexSec - 1)
          expectOk(doc.mergeSection(indexSec), 'mergeSection')
          indexSec = indexSec - 1
          startPara = prevCount
        }
        nextScope = { scopedSection: false, origColDef }
      }
    } else {
      const currentColDef = readColumnDefSafe(doc, indexSec)
      if (opts.columns !== currentColDef.columnCount) {
        // Isolate the anchor paragraph into its own scoped multi-column section.
        const paraCount = doc.getParagraphCount(indexSec)
        const splitBefore = startPara > 0
        const splitAfter = startPara + 1 < paraCount
        if (splitBefore) {
          expectOk(doc.splitSection(indexSec, startPara, 0), 'splitSection')
          indexSec += 1
          startPara = 0
        }
        if (splitAfter) {
          expectOk(doc.splitSection(indexSec, 1, 0), 'splitSection')
        }
        expectOk(doc.setColumnDef(indexSec, opts.columns, 0, 1, opts.gapHu), 'setColumnDef')
        nextScope = {
          scopedSection: true,
          splitBefore,
          splitAfter,
          origColDef: currentColDef,
        }
      } else {
        nextScope = { scopedSection: false, origColDef: currentColDef }
      }
    }

    const initialGrouped = groupIndexEntries(initialMarks, { groupHeadings: opts.groupHeadings })
    const initialRows = buildRenderRows(initialGrouped.groups, opts.title)
    const renderHandle = renderIndexRowsIntoSlot(doc, indexSec, startPara, initialRows, opts)
    const finalized = finalizeIndexBlock(doc, indexSec, renderHandle, opts, nextScope)
    return finalized.ok ? { ...finalized, refreshed: true, cleanedMarks } : finalized
  })
}

function stripPageTail(line) {
  const tab = line.indexOf('\t')
  return tab >= 0 ? line.slice(0, tab) : line
}

/**
 * Read-only staleness check for the staleness registry.
 * Compares the saved index block snapshot against the current `색인:` marks and printed pages.
 */
export function checkIndexStaleness(doc) {
  if (!doc || typeof doc.getSectionCount !== 'function') {
    return { stale: false }
  }
  const { ranges } = findRangeMarks(doc, [MARK_PREFIXES.indexBlock])
  if (ranges.length === 0) {
    return { stale: false }
  }

  const saved = readDocSetting(doc, INDEX_BLOCK_SETTING_KEY)
  if (!saved || typeof saved !== 'object' || !Array.isArray(saved.lines)) {
    return { stale: true, reason: 'entries_changed' }
  }

  const opts = normalizeBuildOptions({}, saved)
  if (!opts.ok) {
    return { stale: true, reason: 'entries_changed' }
  }

  return withPortableMetrics(doc, () => {
    const currentMarks = listIndexMarks(doc)
    if (currentMarks.length === 0) {
      return saved.lines.length === 0
        ? { stale: false }
        : { stale: true, reason: 'entries_changed' }
    }

    const grouped = groupIndexEntries(currentMarks, { groupHeadings: opts.groupHeadings })
    const freshLines = buildRenderRows(grouped.groups, opts.title).map((r) => r.line)

    if (
      freshLines.length === saved.lines.length &&
      freshLines.every((line, idx) => line === saved.lines[idx])
    ) {
      return { stale: false }
    }

    const sameStructure =
      freshLines.length === saved.lines.length &&
      freshLines.every((line, idx) => stripPageTail(line) === stripPageTail(saved.lines[idx]))

    return {
      stale: true,
      reason: sameStructure ? 'pages_changed' : 'entries_changed',
    }
  })
}
