/**
 * Document-level citation marks (`인용:`), bibliography block management (`참고문헌:`),
 * citation style switching (`설정:인용꼴`), multi-scope pattern citation detection,
 * six read-only citation audit checks, and staleness checking for rhwp documents.
 *
 * Node-compatible ES module operating directly on `@rhwp/core` `HwpDocument`
 * instances without DOM, Electron, or editor dependencies.
 */
import {
  MARK_PREFIXES,
  MAX_MARK_NAME_LEN,
  RANGE_END,
  RANGE_START,
  addMark,
  addRangeMark,
  cleanupBrokenMarks,
  deduplicateMarks,
  deleteDocSetting,
  encodeMarkName,
  findRangeMarks,
  readDocSetting,
  removeMark,
  resolveBodyPlace,
  writeDocSetting,
} from './doc-marks.mjs'
import {
  DEFAULT_BIBLIOGRAPHY_TITLE_KO,
  DEFAULT_CITATION_STYLE,
  assignDisambiguationSuffixes,
  assignIeeeNumbers,
  assignMlaShortTitles,
  compareSortOrder,
  detectEntryLanguage,
  findMissingDisambiguation,
  formatAuthorDisplay,
  formatBibliographyList,
  formatInTextCitation,
  getBibliographyHangingIndentPt,
  isCitationStyle,
  normalizeAuthor,
  resolveEntryByKey,
  sanitizeCitationKey,
  sortBibliographyEntries,
} from './citation-styles.mjs'
import { findMatches } from './find.mjs'

export const CIT_STYLE_SETTING_KEY = '인용꼴'
export const CIT_META_SETTING_KEY = '인용'
export const BIB_SETTING_KEY = '참고문헌'
export const DEFAULT_BIBLIOGRAPHY_TITLE = DEFAULT_BIBLIOGRAPHY_TITLE_KO

export const AUDIT_ISSUE_KINDS = Object.freeze([
  'missing_from_bibliography',
  'uncited_in_bibliography',
  'wrong_sort_order',
  'missing_disambiguation',
  'manual_citation_edit',
  'unverified_citation',
])

const BODY_STYLE_NAME = '바탕글'
const PARA_UNITS_PER_PT = 200
const TITLE_FONT_SIZE = 1400 // 14pt in HWPUNIT
const TITLE_SPACING_AFTER = 1600 // 8pt in doubled HWPUNIT
const NOTE_NUMBER_CHARS = 2
const MAX_CIT_TAG_LEN = 54 // Leaves room for dedup suffixes within MAX_MARK_NAME_LEN (64)

const BIB_HEADING_RE = /^(?:참고\s*문헌|References|Bibliography)$/i
const OTHER_SECTION_HEADING_RE =
  /^(?:부록|Appendix|Appendices|찾아보기|색인|Index|차례|목차|Table\s+of\s+Contents|초록|Abstract|감사의\s*글|Acknowledgements?)(?:\s|$)/i
const OUTLINE_STYLE_RE = /^(?:개요\s*\d+|제목\s*\d+|Heading\s*\d+)$/i
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000b-\u001f\u007f]/g

// Pattern citation regexes executed via findMatches across body, tables, text boxes, and notes.
const PAREN_CANDIDATE_QUERY = '\\([^()]{3,200}\\)'
const KO_NARRATIVE_QUERY =
  '[\\uAC00-\\uD7A3]{2,6}(?:\\s*,\\s*[\\uAC00-\\uD7A3]{2,6}|\\s+외)?\\s*\\((?:(?:19|20)\\d{2}[a-z]?|연도\\s*미상)(?:\\s*,\\s*[^()]{1,32})?\\)'
const EN_NARRATIVE_QUERY =
  "[A-Z][A-Za-z'\\u2019\\-]+(?:\\s+(?:&|and)\\s+[A-Z][A-Za-z'\\u2019\\-]+|\\s+et\\s+al\\.)?\\s+\\((?:(?:19|20)\\d{2}[a-z]?|n\\.d\\.)(?:\\s*,\\s*[^()]{1,32})?\\)"
const IEEE_PATTERN_QUERY =
  '\\[\\d+(?:\\s*[-\\u2013\\u2014,]\\s*\\d+)*(?:\\s*,\\s*(?:pp?\\.\\s*\\d+(?:\\s*[-\\u2013\\u2014]\\s*\\d+)?|\\d+(?:\\s*[-\\u2013\\u2014]\\s*\\d+)?쪽))?\\](?:\\s*[-\\u2013\\u2014]\\s*\\[\\d+\\])?'

const FOUR_DIGIT_YEAR_SUFFIX_RE = /\b((?:19|20)\d{2})([a-z])?\b/i
const NO_DATE_TOKEN_RE = /\b(?:n\.?\s*d\.?)\b|연도\s*미상/i
const NON_AUTHOR_LEAD_RE =
  /^(?:표|그림|도표|수식|식|참고|예|주|장|절|항|목|Table|Figure|Fig\.?|Eq\.?|Equation|Chapter|Section|Sec\.?|Vol\.?|No\.?|pp?\.|see|cf\.|e\.g\.|i\.e\.)$/i
const HANGUL_RE = /[\uAC00-\uD7A3]/
const LEADING_IEEE_NUM_RE = /^\[(\d+)\]\s*/
const LEADING_EN_ARTICLE_RE = /^(?:a|an|the)\s+/i
const KO_COLLATOR = new Intl.Collator('ko', { sensitivity: 'base', numeric: true })
const EN_COLLATOR = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

function parseJson(raw, fallback) {
  if (typeof raw !== 'string' || raw.length === 0) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function parseNoteInfo(raw) {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(
      // eslint-disable-next-line no-control-regex
      raw.replace(/[\u0000-\u001f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`),
    )
  } catch {
    return null
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
  if (parsed && parsed.ok === false) {
    throw new Error(parsed.error || `${action} failed`)
  }
  return parsed
}

function cleanText(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return ''
  return raw.replace(CONTROL_CHARS_RE, '').replace(/\s+/g, ' ').trim()
}

function cpLength(text) {
  if (typeof text !== 'string' || text.length === 0) return 0
  return Array.from(text).length
}

function paraUnitsOf(points) {
  return 2 * Math.round((points * PARA_UNITS_PER_PT) / 2)
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

function readAllBookmarkNames(doc) {
  if (!doc || typeof doc.getBookmarks !== 'function') return new Set()
  const raw = tryOr(() => parseJson(doc.getBookmarks(), []), [])
  if (!Array.isArray(raw)) return new Set()
  return new Set(raw.filter((bm) => bm && typeof bm.name === 'string').map((bm) => bm.name))
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

function bodyControlsByPara(doc) {
  const byPara = new Map()
  if (!doc || typeof doc.getControls !== 'function') return byPara
  const raw = tryOr(() => parseJson(doc.getControls(), []), [])
  if (!Array.isArray(raw) || raw.length === 0) return byPara

  const secCount = tryOr(() => doc.getSectionCount(), 0)
  const starts = []
  let run = 0
  for (let s = 0; s < secCount; s++) {
    const count = tryOr(() => doc.getParagraphCount(s), 0)
    starts.push({ sec: s, start: run, end: run + count })
    run += count
  }

  for (const ctrl of raw) {
    if (!ctrl || ctrl.list !== 0 || !Number.isInteger(ctrl.para)) continue
    let sec = -1
    let localPara = -1
    for (const r of starts) {
      if (ctrl.para >= r.start && ctrl.para < r.end) {
        sec = r.sec
        localPara = ctrl.para - r.start
        break
      }
    }
    if (sec < 0) continue
    const key = `${sec}:${localPara}`
    let list = byPara.get(key)
    if (!list) {
      list = []
      byPara.set(key, list)
    }
    list.push(ctrl)
  }
  return byPara
}

function hasNonBookmarkObjectInRange(doc, sec, startPara, endPara) {
  const byPara = bodyControlsByPara(doc)
  for (let p = startPara; p <= endPara; p++) {
    const ctrls = byPara.get(`${sec}:${p}`)
    if (!ctrls) continue
    for (const ctrl of ctrls) {
      if (
        ctrl.ctrlId === 'tbl' ||
        ctrl.ctrlId === 'gso' ||
        ctrl.ctrlId === 'eqed' ||
        ctrl.ctrlId === 'fn' ||
        ctrl.ctrlId === 'en'
      ) {
        return true
      }
    }
  }
  return false
}

function deleteMarkEntriesReverse(doc, marks) {
  const ordered = [...marks].sort((a, b) => {
    if (a.sec !== b.sec) return b.sec - a.sec
    if (a.para !== b.para) return b.para - a.para
    return b.ctrlIdx - a.ctrlIdx
  })
  let removed = 0
  const failed = []
  for (const mark of ordered) {
    const res = removeMark(doc, mark)
    if (res.ok) {
      removed += 1
    } else {
      failed.push({
        name: mark.name ?? '',
        sec: mark.sec,
        para: mark.para,
        ctrlIdx: mark.ctrlIdx,
        reason: res.reason ?? 'engine_error',
        error: res.error ?? res.reason ?? 'removeMark failed',
      })
    }
  }
  return { removed, failed }
}

function checkSettingWriteResult(res) {
  if (!res || !res.ok) {
    return {
      ok: false,
      reason: res?.reason ?? 'setting_write_failed',
      ...(res?.error ? { error: res.error } : {}),
      ...(Array.isArray(res?.failed) && res.failed.length > 0 ? { failed: res.failed } : {}),
    }
  }
  if (Array.isArray(res.failed) && res.failed.length > 0) {
    return {
      ok: false,
      reason: 'setting_write_failed',
      failed: res.failed,
    }
  }
  return { ok: true }
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

function compareCellPaths(pathA, pathB) {
  const a = Array.isArray(pathA) ? pathA : []
  const b = Array.isArray(pathB) ? pathB : []
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const sa = a[i]
    const sb = b[i]
    if ((sa.controlIndex ?? 0) !== (sb.controlIndex ?? 0)) {
      return (sa.controlIndex ?? 0) - (sb.controlIndex ?? 0)
    }
    if ((sa.cellIndex ?? 0) !== (sb.cellIndex ?? 0)) {
      return (sa.cellIndex ?? 0) - (sb.cellIndex ?? 0)
    }
    if ((sa.cellParaIndex ?? 0) !== (sb.cellParaIndex ?? 0)) {
      return (sa.cellParaIndex ?? 0) - (sb.cellParaIndex ?? 0)
    }
  }
  return a.length - b.length
}

function createEventComparator(doc) {
  const posCache = new Map()
  const getControlOffset = (sec, para, controlIndex) => {
    if (!Number.isInteger(controlIndex)) return 0
    const key = `${sec}:${para}`
    let arr = posCache.get(key)
    if (arr === undefined) {
      arr =
        doc && typeof doc.getControlTextPositions === 'function'
          ? tryOr(() => parseJson(doc.getControlTextPositions(sec, para), []), [])
          : []
      posCache.set(key, Array.isArray(arr) ? arr : [])
    }
    return Number.isInteger(arr[controlIndex]) ? arr[controlIndex] : 0
  }

  const hostOffsetOf = (ev) => {
    if (ev.kind === 'body') return ev.offset ?? 0
    if (ev.kind === 'table' || ev.kind === 'textbox') {
      const ctrlIdx = Array.isArray(ev.path) && ev.path.length > 0 ? ev.path[0].controlIndex : null
      return getControlOffset(ev.sec, ev.para, ctrlIdx)
    }
    if (ev.kind === 'footnote' || ev.kind === 'endnote') {
      return getControlOffset(ev.sec, ev.para, ev.noteControl)
    }
    return ev.offset ?? 0
  }

  const outerControlIndexOf = (ev) => {
    if (ev.kind === 'table' || ev.kind === 'textbox') {
      return Array.isArray(ev.path) && ev.path.length > 0 ? (ev.path[0].controlIndex ?? 0) : 0
    }
    if (ev.kind === 'footnote' || ev.kind === 'endnote') {
      return ev.noteControl ?? 0
    }
    return -1
  }

  return (a, b) => {
    if (a.sec !== b.sec) return a.sec - b.sec
    if (a.para !== b.para) return a.para - b.para

    const aHost = hostOffsetOf(a)
    const bHost = hostOffsetOf(b)
    if (aHost !== bHost) return aHost - bHost

    const aRank = a.kind === 'body' ? 0 : 1
    const bRank = b.kind === 'body' ? 0 : 1
    if (aRank !== bRank) return aRank - bRank

    if (
      (a.kind === 'table' || a.kind === 'textbox') &&
      (b.kind === 'table' || b.kind === 'textbox')
    ) {
      const pathCmp = compareCellPaths(a.path, b.path)
      if (pathCmp !== 0) return pathCmp
      return (a.offset ?? 0) - (b.offset ?? 0)
    }

    if (
      (a.kind === 'footnote' || a.kind === 'endnote') &&
      (b.kind === 'footnote' || b.kind === 'endnote')
    ) {
      if ((a.noteControl ?? 0) !== (b.noteControl ?? 0)) {
        return (a.noteControl ?? 0) - (b.noteControl ?? 0)
      }
      if ((a.notePara ?? 0) !== (b.notePara ?? 0)) {
        return (a.notePara ?? 0) - (b.notePara ?? 0)
      }
      return (a.offset ?? 0) - (b.offset ?? 0)
    }

    const aCtrl = outerControlIndexOf(a)
    const bCtrl = outerControlIndexOf(b)
    if (aCtrl !== bCtrl) return aCtrl - bCtrl

    return (a.offset ?? 0) - (b.offset ?? 0)
  }
}

function compareBodyCoord(secA, paraA, offA, secB, paraB, offB) {
  if (secA !== secB) return secA - secB
  if (paraA !== paraB) return paraA - paraB
  return offA - offB
}

function isBodyPositionInsideRange(sec, para, offset, range) {
  if (!range || !range.start || !range.end) return false
  return (
    compareBodyCoord(sec, para, offset, range.start.sec, range.start.para, range.start.offset) >=
      0 && compareBodyCoord(sec, para, offset, range.end.sec, range.end.para, range.end.offset) <= 0
  )
}

function isParaInsideRange(sec, para, range) {
  if (!range) return false
  if (range.start.sec === range.end.sec) {
    return sec === range.start.sec && para >= range.start.para && para <= range.end.para
  }
  if (sec < range.start.sec || sec > range.end.sec) return false
  if (sec === range.start.sec) return para >= range.start.para
  if (sec === range.end.sec) return para <= range.end.para
  return true
}

// ---------------------------------------------------------------------------
// 1. Document citation style setting (`설정:인용꼴`)
// ---------------------------------------------------------------------------

/** Return the active document citation style from `설정:인용꼴` (defaults to `'apa'`). */
export function getDocumentCitationStyle(doc) {
  if (!doc || typeof doc.getBookmarks !== 'function') return DEFAULT_CITATION_STYLE
  const raw = readDocSetting(doc, CIT_STYLE_SETTING_KEY, DEFAULT_CITATION_STYLE)
  return isCitationStyle(raw) ? raw : DEFAULT_CITATION_STYLE
}

/** Persist the active document citation style into `설정:인용꼴`. */
export function setDocumentCitationStyle(doc, style) {
  if (!isCitationStyle(style)) {
    return { ok: false, reason: 'invalid_style' }
  }
  if (!doc || typeof doc.getSectionCount !== 'function') {
    return { ok: false, reason: 'unsupported_place' }
  }
  const check = checkSettingWriteResult(writeDocSetting(doc, CIT_STYLE_SETTING_KEY, style))
  if (!check.ok) return check
  return { ok: true, style }
}

// ---------------------------------------------------------------------------
// 2. Citation metadata storage (`설정:인용`) & mark listing
// ---------------------------------------------------------------------------

function unpackMetaRecord(raw) {
  if (!raw || typeof raw !== 'object') return null
  const rawItems = Array.isArray(raw.i) ? raw.i : Array.isArray(raw.items) ? raw.items : []
  const items = rawItems
    .map((it) => {
      if (!it || typeof it !== 'object') return null
      const key = typeof it.k === 'string' ? it.k : typeof it.key === 'string' ? it.key : ''
      if (!key) return null
      const out = { key }
      const locator =
        typeof it.l === 'string' ? it.l : typeof it.locator === 'string' ? it.locator : ''
      const prefix =
        typeof it.p === 'string' ? it.p : typeof it.prefix === 'string' ? it.prefix : ''
      const suffix =
        typeof it.s === 'string' ? it.s : typeof it.suffix === 'string' ? it.suffix : ''
      if (locator) out.locator = locator
      if (prefix) out.prefix = prefix
      if (suffix) out.suffix = suffix
      return out
    })
    .filter(Boolean)

  const mode = raw.d === 'n' || raw.mode === 'narrative' ? 'narrative' : 'parenthetical'
  const writtenText =
    typeof raw.t === 'string' ? raw.t : typeof raw.writtenText === 'string' ? raw.writtenText : null

  return { items, mode, writtenText }
}

function packMetaRecord(record) {
  const packed = {
    i: record.items.map((it) => {
      const compact = { k: it.key }
      if (it.locator) compact.l = it.locator
      if (it.prefix) compact.p = it.prefix
      if (it.suffix) compact.s = it.suffix
      return compact
    }),
  }
  if (record.mode === 'narrative') packed.d = 'n'
  if (typeof record.writtenText === 'string') packed.t = record.writtenText
  return packed
}

const UNMARKED_KIND_TO_CODE = Object.freeze({
  table: 't',
  textbox: 'b',
  footnote: 'f',
  endnote: 'e',
})

const CODE_TO_UNMARKED_KIND = Object.freeze({
  t: 'table',
  b: 'textbox',
  f: 'footnote',
  e: 'endnote',
  table: 'table',
  textbox: 'textbox',
  footnote: 'footnote',
  endnote: 'endnote',
})

function unpackUnmarkedRef(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : null
  const kind = CODE_TO_UNMARKED_KIND[raw.k ?? raw.kind]
  const sec = Number.isInteger(raw.s) ? raw.s : Number.isInteger(raw.sec) ? raw.sec : -1
  const para = Number.isInteger(raw.p) ? raw.p : Number.isInteger(raw.para) ? raw.para : -1
  if (!id || !kind || sec < 0 || para < 0) return null

  const base = unpackMetaRecord(raw)
  if (!base || base.items.length === 0 || typeof base.writtenText !== 'string') return null

  const out = {
    id,
    kind,
    sec,
    para,
    offset: Number.isInteger(raw.o) ? raw.o : Number.isInteger(raw.offset) ? raw.offset : 0,
    items: base.items,
    mode: base.mode,
    writtenText: base.writtenText,
  }

  if (kind === 'table' || kind === 'textbox') {
    const rawPath = Array.isArray(raw.cp) ? raw.cp : Array.isArray(raw.path) ? raw.path : null
    if (!rawPath || rawPath.length === 0) return null
    out.path = rawPath.map((step) =>
      Array.isArray(step)
        ? {
            controlIndex: step[0] ?? 0,
            cellIndex: step[1] ?? 0,
            cellParaIndex: step[2] ?? 0,
          }
        : {
            controlIndex: step.controlIndex ?? step.c ?? 0,
            cellIndex: step.cellIndex ?? step.i ?? 0,
            cellParaIndex: step.cellParaIndex ?? step.p ?? 0,
          },
    )
  } else {
    const noteControl = Number.isInteger(raw.nc)
      ? raw.nc
      : Number.isInteger(raw.noteControl)
        ? raw.noteControl
        : -1
    const notePara = Number.isInteger(raw.np)
      ? raw.np
      : Number.isInteger(raw.notePara)
        ? raw.notePara
        : 0
    if (noteControl < 0 || notePara < 0) return null
    out.noteControl = noteControl
    out.notePara = notePara
  }

  return out
}

function packUnmarkedRef(ref) {
  const packed = {
    id: ref.id,
    k: UNMARKED_KIND_TO_CODE[ref.kind] ?? ref.kind,
    s: ref.sec,
    p: ref.para,
    ...(Number.isInteger(ref.offset) && ref.offset > 0 ? { o: ref.offset } : {}),
    ...packMetaRecord(ref),
  }
  if (ref.kind === 'table' || ref.kind === 'textbox') {
    packed.cp = (ref.path ?? []).map((st) => [st.controlIndex, st.cellIndex, st.cellParaIndex])
  } else {
    packed.nc = ref.noteControl
    if (ref.notePara > 0) packed.np = ref.notePara
  }
  return packed
}

function readCitationMetaState(doc) {
  const metaMap = new Map()
  const unmarkedRefs = []
  if (!doc || typeof doc.getBookmarks !== 'function') {
    return { metaMap, unmarkedRefs }
  }
  const saved = readDocSetting(doc, CIT_META_SETTING_KEY, null)
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
    return { metaMap, unmarkedRefs }
  }
  const rawTable =
    saved.m && typeof saved.m === 'object' && !Array.isArray(saved.m) ? saved.m : saved
  for (const [id, rawRec] of Object.entries(rawTable)) {
    if (id === 'v' || id === 'm' || id === 'u') continue
    const rec = unpackMetaRecord(rawRec)
    if (rec && rec.items.length > 0) {
      metaMap.set(id, rec)
    }
  }
  if (Array.isArray(saved.u)) {
    for (const rawRef of saved.u) {
      const ref = unpackUnmarkedRef(rawRef)
      if (ref) unmarkedRefs.push(ref)
    }
  }
  return { metaMap, unmarkedRefs }
}

function readCitationMetaMap(doc) {
  return readCitationMetaState(doc).metaMap
}

function writeCitationMetaState(doc, metaMap, unmarkedRefs = [], activeIds = null) {
  const packed = {}
  let markCount = 0
  for (const [id, rec] of metaMap.entries()) {
    if (activeIds && !activeIds.has(id)) continue
    if (!rec || !Array.isArray(rec.items) || rec.items.length === 0) continue
    packed[id] = packMetaRecord(rec)
    markCount += 1
  }
  const packedUnmarked = Array.isArray(unmarkedRefs)
    ? unmarkedRefs
        .filter(
          (r) =>
            r && Array.isArray(r.items) && r.items.length > 0 && typeof r.writtenText === 'string',
        )
        .map(packUnmarkedRef)
    : []

  if (markCount === 0 && packedUnmarked.length === 0) {
    return checkSettingWriteResult(deleteDocSetting(doc, CIT_META_SETTING_KEY))
  }
  const payload = {
    v: 1,
    m: packed,
    ...(packedUnmarked.length > 0 ? { u: packedUnmarked } : {}),
  }
  return checkSettingWriteResult(writeDocSetting(doc, CIT_META_SETTING_KEY, payload))
}

function allocateUnmarkedRefId(unmarkedRefs) {
  const used = new Set(unmarkedRefs.map((r) => r.id))
  for (let seq = 1; ; seq++) {
    const candidate = `u${seq}`
    if (!used.has(candidate)) return candidate
  }
}

function readCellText(doc, sec, para, path) {
  if (!doc || !Array.isArray(path) || path.length === 0) return null
  const pathJson = JSON.stringify(path)
  let len = -1
  if (typeof doc.getCellParagraphLengthByPath === 'function') {
    len = tryOr(() => doc.getCellParagraphLengthByPath(sec, para, pathJson), -1)
  } else if (path.length === 1 && typeof doc.getCellParagraphLength === 'function') {
    const s = path[0]
    len = tryOr(
      () => doc.getCellParagraphLength(sec, para, s.controlIndex, s.cellIndex, s.cellParaIndex),
      -1,
    )
  }
  if (!Number.isInteger(len) || len < 0) return null
  if (len === 0) return ''
  if (typeof doc.getTextInCellByPath === 'function') {
    return tryOr(() => doc.getTextInCellByPath(sec, para, pathJson, 0, len), null)
  }
  if (path.length === 1 && typeof doc.getTextInCell === 'function') {
    const s = path[0]
    return tryOr(
      () => doc.getTextInCell(sec, para, s.controlIndex, s.cellIndex, s.cellParaIndex, 0, len),
      null,
    )
  }
  return null
}

function replaceCellTextRange(doc, sec, para, path, offset, oldLen, nextText) {
  const pathJson = JSON.stringify(path)
  if (
    typeof doc.deleteTextInCellByPath === 'function' &&
    typeof doc.insertTextInCellByPath === 'function'
  ) {
    if (oldLen > 0) {
      expectOk(
        doc.deleteTextInCellByPath(sec, para, pathJson, offset, oldLen),
        'deleteTextInCellByPath',
      )
    }
    if (nextText.length > 0) {
      expectOk(
        doc.insertTextInCellByPath(sec, para, pathJson, offset, nextText),
        'insertTextInCellByPath',
      )
    }
    return { ok: true }
  }
  if (
    path.length === 1 &&
    typeof doc.deleteTextInCell === 'function' &&
    typeof doc.insertTextInCell === 'function'
  ) {
    const s = path[0]
    if (oldLen > 0) {
      expectOk(
        doc.deleteTextInCell(
          sec,
          para,
          s.controlIndex,
          s.cellIndex,
          s.cellParaIndex,
          offset,
          oldLen,
        ),
        'deleteTextInCell',
      )
    }
    if (nextText.length > 0) {
      expectOk(
        doc.insertTextInCell(
          sec,
          para,
          s.controlIndex,
          s.cellIndex,
          s.cellParaIndex,
          offset,
          nextText,
        ),
        'insertTextInCell',
      )
    }
    return { ok: true }
  }
  return { ok: false, reason: 'unsupported_place' }
}

function readNoteLine(doc, sec, para, noteControl, notePara) {
  if (!doc || typeof doc.getFootnoteInfo !== 'function') return null
  const info = tryOr(() => parseNoteInfo(doc.getFootnoteInfo(sec, para, noteControl)), null)
  if (
    !info ||
    !info.ok ||
    !Array.isArray(info.texts) ||
    notePara < 0 ||
    notePara >= info.texts.length
  ) {
    return null
  }
  const edit =
    typeof doc.getNoteEditInfo === 'function'
      ? tryOr(() => parseJson(doc.getNoteEditInfo(sec, para, noteControl), null), null)
      : null
  let prefix = NOTE_NUMBER_CHARS
  if (edit && Number.isInteger(edit.charOffset)) prefix = edit.charOffset
  if (info.numberSlot === -1) prefix = 0
  const text = String(info.texts[notePara] ?? '')
  const minOffset = notePara === 0 ? Math.min(prefix, cpLength(text)) : 0
  return { text, minOffset }
}

function replaceNoteTextRange(doc, sec, para, noteControl, notePara, offset, oldLen, nextText) {
  if (
    typeof doc.deleteTextInFootnote !== 'function' ||
    typeof doc.insertTextInFootnote !== 'function'
  ) {
    return { ok: false, reason: 'unsupported_place' }
  }
  if (oldLen > 0) {
    expectOk(
      doc.deleteTextInFootnote(sec, para, noteControl, notePara, offset, oldLen),
      'deleteTextInFootnote',
    )
  }
  if (nextText.length > 0) {
    expectOk(
      doc.insertTextInFootnote(sec, para, noteControl, notePara, offset, nextText),
      'insertTextInFootnote',
    )
  }
  return { ok: true }
}

function findClosestCodePointOffset(
  fullText,
  needle,
  preferredCpOffset,
  minCpOffset = 0,
  claimedSpans = [],
) {
  if (typeof fullText !== 'string' || typeof needle !== 'string' || needle.length === 0) return -1
  const needleLen = cpLength(needle)
  const matches = []
  let pos = 0
  while (pos <= fullText.length - needle.length) {
    const idx = fullText.indexOf(needle, pos)
    if (idx === -1) break
    const cpOffset = Array.from(fullText.slice(0, idx)).length
    if (cpOffset >= minCpOffset) {
      const overlapsClaimed = claimedSpans.some(
        (sp) => cpOffset < sp.end && sp.start < cpOffset + needleLen,
      )
      if (!overlapsClaimed) {
        matches.push(cpOffset)
      }
    }
    pos = idx + 1
  }
  if (matches.length === 0) return -1
  let best = matches[0]
  let bestDist = Math.abs(best - preferredCpOffset)
  for (let i = 1; i < matches.length; i++) {
    const dist = Math.abs(matches[i] - preferredCpOffset)
    if (dist < bestDist) {
      best = matches[i]
      bestDist = dist
    }
  }
  return best
}

function containerKeyForRef(ref) {
  if (ref.kind === 'body') return `body:${ref.sec}:${ref.para}`
  if (ref.kind === 'table' || ref.kind === 'textbox') {
    return `cell:${ref.sec}:${ref.para}:${JSON.stringify(ref.path ?? [])}`
  }
  return `note:${ref.sec}:${ref.para}:${ref.noteControl}:${ref.notePara}`
}

function resolveUnmarkedRefsInDoc(doc, unmarkedRefs, entries = null) {
  const hasEntries = Array.isArray(entries)
  const located = []
  const modified = []
  const aliveRefs = []
  const claimedByContainer = new Map()

  for (const ref of unmarkedRefs) {
    let containerText = null
    let minOffset = 0
    if (ref.kind === 'table' || ref.kind === 'textbox') {
      containerText = readCellText(doc, ref.sec, ref.para, ref.path)
    } else if (ref.kind === 'footnote' || ref.kind === 'endnote') {
      const noteLine = readNoteLine(doc, ref.sec, ref.para, ref.noteControl, ref.notePara)
      if (noteLine) {
        containerText = noteLine.text
        minOffset = noteLine.minOffset
      }
    }
    // Container was deleted from the document; drop this tracked descriptor.
    if (containerText === null) continue

    const cKey = containerKeyForRef(ref)
    let claimed = claimedByContainer.get(cKey)
    if (!claimed) {
      claimed = []
      claimedByContainer.set(cKey, claimed)
    }

    const items = ref.items.map((it) => {
      const out = { key: it.key }
      if (it.locator) out.locator = it.locator
      if (it.prefix) out.prefix = it.prefix
      if (it.suffix) out.suffix = it.suffix
      if (hasEntries) {
        const resolved = resolveEntryByKey(entries, it.key)
        out.resolvedKey = resolved ? resolved.key : null
        out.verified = resolved ? resolved.verified : null
      }
      return out
    })
    const keys = items.map((it) => (hasEntries && it.resolvedKey ? it.resolvedKey : it.key))

    const foundOffset = findClosestCodePointOffset(
      containerText,
      ref.writtenText,
      ref.offset ?? minOffset,
      minOffset,
      claimed,
    )
    if (foundOffset >= 0) {
      const len = cpLength(ref.writtenText)
      claimed.push({ start: foundOffset, end: foundOffset + len })
      const updatedRef = { ...ref, offset: foundOffset }
      aliveRefs.push(updatedRef)
      located.push({
        ...updatedRef,
        length: len,
        text: ref.writtenText,
        items,
        keys,
        isManuallyEdited: false,
      })
    } else {
      // If the container still holds non-empty text, keep tracking it as manually modified.
      const trimmedContent = Array.from(containerText).slice(minOffset).join('').trim()
      if (trimmedContent.length > 0) {
        aliveRefs.push(ref)
        modified.push({
          ...ref,
          offset: Math.min(Math.max(minOffset, ref.offset ?? minOffset), cpLength(containerText)),
          length: Math.max(0, cpLength(containerText) - minOffset),
          text: trimmedContent,
          items,
          keys,
          isManuallyEdited: true,
        })
      }
    }
  }

  return { located, modified, aliveRefs }
}

function resolveCitationMeta(metaMap, id) {
  if (metaMap.has(id)) return metaMap.get(id)
  // Fallback when deduplicateMarks appended `:2`, `:3`, ... to a copy-pasted range mark.
  let probe = id
  while (/:\d+$/.test(probe)) {
    probe = probe.replace(/:\d+$/, '')
    if (metaMap.has(probe)) return metaMap.get(probe)
  }
  // Fallback for raw range marks without stored setting metadata: first segment as key.
  const firstPart = String(id ?? '').split(':')[0]
  if (firstPart && firstPart !== '묶음' && !/^c\d*$/.test(firstPart)) {
    return {
      items: [{ key: firstPart }],
      mode: 'parenthetical',
      writtenText: null,
    }
  }
  return { items: [], mode: 'parenthetical', writtenText: null }
}

function allocateCitationTag(doc, items, metaMap) {
  const usedNames = readAllBookmarkNames(doc)
  const singleKey = items.length === 1 ? sanitizeCitationKey(items[0].key) : ''
  const useSingleKey =
    singleKey.length > 0 &&
    encodeMarkName(MARK_PREFIXES.citation, [singleKey, '999', RANGE_START]).length <=
      MAX_CIT_TAG_LEN

  for (let seq = 1; ; seq++) {
    const idParts = useSingleKey
      ? [singleKey, String(seq)]
      : items.length > 1
        ? ['묶음', String(seq)]
        : ['c', String(seq)]
    const id = idParts.join(':')
    const startName = encodeMarkName(MARK_PREFIXES.citation, [...idParts, RANGE_START])
    const endName = encodeMarkName(MARK_PREFIXES.citation, [...idParts, RANGE_END])
    if (
      startName.length <= MAX_MARK_NAME_LEN &&
      endName.length <= MAX_MARK_NAME_LEN &&
      !usedNames.has(startName) &&
      !usedNames.has(endName) &&
      !metaMap.has(id)
    ) {
      return { idParts, id, startName, endName }
    }
  }
}

/**
 * List all paired `인용:` range marks in document reading order with their current
 * text, stored citation metadata, manual-edit flag, and optional library resolution.
 */
export function listCitationMarks(doc, entries = null) {
  if (!doc || typeof doc.getBookmarks !== 'function') return []
  const { ranges } = findRangeMarks(doc, [MARK_PREFIXES.citation])
  if (ranges.length === 0) return []

  const metaMap = readCitationMetaMap(doc)
  const hasEntries = Array.isArray(entries)
  const list = []

  for (const range of ranges) {
    const sec = range.start.sec
    const para = range.start.para
    const paraLen = tryOr(() => doc.getParagraphLength(sec, para), 0)
    const startOffset = Math.min(Math.max(0, range.start.offset), paraLen)
    const endOffset =
      range.end.sec === sec && range.end.para === para
        ? Math.min(Math.max(startOffset, range.end.offset), paraLen)
        : paraLen
    const text =
      endOffset > startOffset
        ? tryOr(() => doc.getTextRange(sec, para, startOffset, endOffset - startOffset), '')
        : ''

    const meta = resolveCitationMeta(metaMap, range.id)
    const items = meta.items.map((it) => {
      const out = { key: it.key }
      if (it.locator) out.locator = it.locator
      if (it.prefix) out.prefix = it.prefix
      if (it.suffix) out.suffix = it.suffix
      if (hasEntries) {
        const resolved = resolveEntryByKey(entries, it.key)
        out.resolvedKey = resolved ? resolved.key : null
        out.verified = resolved ? resolved.verified : null
      }
      return out
    })

    const keys = items.map((it) => (hasEntries && it.resolvedKey ? it.resolvedKey : it.key))
    const writtenText = meta.writtenText
    const isManuallyEdited = typeof writtenText === 'string' && text !== writtenText

    list.push({
      id: range.id,
      sec,
      para,
      startOffset,
      endOffset,
      offset: startOffset,
      length: endOffset - startOffset,
      text,
      writtenText,
      mode: meta.mode,
      items,
      keys,
      isManuallyEdited,
      start: range.start,
      end: range.end,
    })
  }

  return list
}

// ---------------------------------------------------------------------------
// 3. Place classification & citation insertion (body + cell/textbox/note)
// ---------------------------------------------------------------------------

function normalizeCellPath(place) {
  if (Array.isArray(place.path) && place.path.length > 0) {
    return place.path.map((step) => ({
      controlIndex: step.controlIndex ?? 0,
      cellIndex: step.cellIndex ?? 0,
      cellParaIndex: step.cellParaIndex ?? 0,
    }))
  }
  if (Array.isArray(place.cellPath) && place.cellPath.length > 0) {
    return place.cellPath.map((step) => ({
      controlIndex: step.controlIndex ?? 0,
      cellIndex: step.cellIndex ?? 0,
      cellParaIndex: step.cellParaIndex ?? 0,
    }))
  }
  if (Number.isInteger(place.controlIndex) && Number.isInteger(place.cellIndex)) {
    return [
      {
        controlIndex: place.controlIndex,
        cellIndex: place.cellIndex,
        cellParaIndex: place.cellParaIndex ?? 0,
      },
    ]
  }
  return null
}

function classifyCitationPlace(doc, place) {
  if (!doc || typeof doc.getSectionCount !== 'function') {
    return { ok: false, reason: 'unsupported_place' }
  }
  if (place === undefined || place === null) {
    const secCount = doc.getSectionCount()
    if (secCount <= 0 || doc.getParagraphCount(0) <= 0) {
      return { ok: false, reason: 'not_found' }
    }
    return { ok: true, kind: 'body', sec: 0, para: 0, offset: 0 }
  }
  if (typeof place !== 'object') {
    return { ok: false, reason: 'unsupported_place' }
  }

  // Header/footer and equation controls do not support citation insertion.
  if (
    place.inHeaderFooter === true ||
    place.isHeader === true ||
    place.isFooter === true ||
    place.headerFooter != null ||
    place.equationControl != null ||
    place.kind === 'header' ||
    place.kind === 'footer'
  ) {
    return { ok: false, reason: 'unsupported_place' }
  }

  // Footnote / endnote insertion (plain text only, no bookmarks).
  const isNote =
    place.kind === 'footnote' ||
    place.kind === 'endnote' ||
    place.inNote === true ||
    place.inFootnote === true ||
    place.inEndnote === true ||
    place.noteControl != null ||
    place.noteIndex != null ||
    place.noteType != null
  if (isNote) {
    const sec = place.sec ?? place.sectionIndex ?? 0
    const para = place.para ?? place.paraIndex ?? 0
    const noteControl = place.noteControl ?? place.controlIndex ?? place.noteIndex
    const notePara = place.notePara ?? place.noteParaIndex ?? 0
    if (
      !Number.isInteger(sec) ||
      !Number.isInteger(para) ||
      !Number.isInteger(noteControl) ||
      !Number.isInteger(notePara) ||
      sec < 0 ||
      sec >= doc.getSectionCount() ||
      para < 0 ||
      para >= doc.getParagraphCount(sec) ||
      notePara < 0
    ) {
      return { ok: false, reason: 'not_found' }
    }
    if (
      typeof doc.getFootnoteInfo !== 'function' ||
      typeof doc.insertTextInFootnote !== 'function'
    ) {
      return { ok: false, reason: 'unsupported_place' }
    }
    const info = tryOr(() => parseNoteInfo(doc.getFootnoteInfo(sec, para, noteControl)), null)
    if (!info || !info.ok || !Array.isArray(info.texts) || notePara >= info.texts.length) {
      return { ok: false, reason: 'not_found' }
    }
    const edit =
      typeof doc.getNoteEditInfo === 'function'
        ? tryOr(() => parseJson(doc.getNoteEditInfo(sec, para, noteControl), null), null)
        : null
    let placeKind =
      place.kind === 'endnote' || place.inEndnote || place.noteType === 'endnote'
        ? 'endnote'
        : 'footnote'
    if (edit && (edit.kind === 'footnote' || edit.kind === 'endnote')) {
      placeKind = edit.kind
    }
    const lineLen = cpLength(String(info.texts[notePara] ?? ''))
    let prefix = NOTE_NUMBER_CHARS
    if (edit && Number.isInteger(edit.charOffset)) prefix = edit.charOffset
    if (info.numberSlot === -1) prefix = 0
    const minOffset = notePara === 0 ? Math.min(prefix, lineLen) : 0

    const hasExplicitOffset =
      place.offset !== undefined || place.charOffset !== undefined || place.charPos !== undefined
    let offset = hasExplicitOffset ? (place.offset ?? place.charOffset ?? place.charPos) : lineLen
    if (!Number.isInteger(offset) || offset < 0) {
      return { ok: false, reason: 'not_found' }
    }
    if (offset < minOffset) offset = minOffset
    if (offset > lineLen) offset = lineLen

    return {
      ok: true,
      kind: placeKind,
      sec,
      para,
      noteControl,
      notePara,
      offset,
    }
  }

  // Table cell / nested table / text box insertion (plain text only, no bookmarks).
  const isTextBox = place.kind === 'textbox' || place.inTextBox === true || place.isTextBox === true
  const isCell =
    isTextBox ||
    place.kind === 'table' ||
    place.inTable === true ||
    place.cellContext != null ||
    place.cellIndex != null ||
    place.cellParaIndex != null ||
    (Array.isArray(place.path) && place.path.length > 0) ||
    (Array.isArray(place.cellPath) && place.cellPath.length > 0)
  if (isCell) {
    const sec = place.sec ?? place.sectionIndex ?? 0
    const para = place.para ?? place.paraIndex ?? place.parentParaIndex ?? 0
    const path = normalizeCellPath(place)
    if (
      !path ||
      !Number.isInteger(sec) ||
      !Number.isInteger(para) ||
      sec < 0 ||
      sec >= doc.getSectionCount() ||
      para < 0 ||
      para >= doc.getParagraphCount(sec)
    ) {
      return { ok: false, reason: 'not_found' }
    }
    const pathJson = JSON.stringify(path)
    let cellLen = -1
    if (typeof doc.getCellParagraphLengthByPath === 'function') {
      cellLen = tryOr(() => doc.getCellParagraphLengthByPath(sec, para, pathJson), -1)
    } else if (path.length === 1 && typeof doc.getCellParagraphLength === 'function') {
      const s = path[0]
      cellLen = tryOr(
        () => doc.getCellParagraphLength(sec, para, s.controlIndex, s.cellIndex, s.cellParaIndex),
        -1,
      )
    }
    if (!Number.isInteger(cellLen) || cellLen < 0) {
      return { ok: false, reason: 'not_found' }
    }
    const hasExplicitOffset =
      place.offset !== undefined || place.charOffset !== undefined || place.charPos !== undefined
    const rawOffset = hasExplicitOffset
      ? (place.offset ?? place.charOffset ?? place.charPos)
      : cellLen
    if (!Number.isInteger(rawOffset) || rawOffset < 0 || rawOffset > cellLen) {
      return { ok: false, reason: 'not_found' }
    }
    return {
      ok: true,
      kind: isTextBox ? 'textbox' : 'table',
      sec,
      para,
      path,
      offset: rawOffset,
    }
  }

  // Body paragraph validation.
  const sec = place.sec ?? place.sectionIndex
  const para = place.para ?? place.paraIndex ?? place.paragraphIndex
  const hasExplicitOffset =
    place.offset !== undefined || place.charOffset !== undefined || place.charPos !== undefined
  const rawOffset = hasExplicitOffset ? (place.offset ?? place.charOffset ?? place.charPos) : 0
  if (!Number.isInteger(sec) || !Number.isInteger(para) || !Number.isInteger(rawOffset)) {
    return { ok: false, reason: 'not_found' }
  }
  if (sec < 0 || sec >= doc.getSectionCount()) return { ok: false, reason: 'not_found' }
  if (para < 0 || para >= doc.getParagraphCount(sec)) return { ok: false, reason: 'not_found' }
  const paraLen = doc.getParagraphLength(sec, para)
  if (rawOffset < 0 || rawOffset > paraLen) return { ok: false, reason: 'not_found' }

  const resolved = resolveBodyPlace(doc, { sec, para, offset: rawOffset })
  if (!resolved) return { ok: false, reason: 'unsupported_place' }
  return { ok: true, kind: 'body', sec: resolved.sec, para: resolved.para, offset: resolved.offset }
}

function normalizeCitationItemsInput(options) {
  const rawList = Array.isArray(options?.items)
    ? options.items
    : typeof options?.key === 'string' && options.key.trim().length > 0
      ? [{ key: options.key }]
      : []
  const out = []
  for (const raw of rawList) {
    if (typeof raw === 'string') {
      const k = raw.trim()
      if (k) out.push({ key: k })
    } else if (raw && typeof raw === 'object' && typeof raw.key === 'string') {
      const k = raw.key.trim()
      if (!k) continue
      const item = { key: k }
      if (typeof raw.locator === 'string' && raw.locator.trim()) item.locator = raw.locator.trim()
      if (typeof raw.prefix === 'string' && raw.prefix.trim()) item.prefix = raw.prefix.trim()
      if (typeof raw.suffix === 'string' && raw.suffix.trim()) item.suffix = raw.suffix.trim()
      out.push(item)
    }
  }
  return out
}

function rewriteSingleCitationMarkInPlace(doc, mark, nextText) {
  const { sec, para, startOffset, endOffset } = mark
  const oldLen = Math.max(0, endOffset - startOffset)
  const idParts = mark.id ? mark.id.split(':') : []

  // Remove old start/end bookmarks first so text replacement never leaves stale anchors.
  const del = deleteMarkEntriesReverse(doc, [mark.start, mark.end])
  if (del.failed.length > 0) {
    return { ok: false, reason: 'mark_delete_failed', failed: del.failed }
  }

  if (oldLen > 0) {
    expectOk(doc.replaceText(sec, para, startOffset, oldLen, nextText), 'replaceText')
  } else if (nextText.length > 0) {
    expectOk(doc.insertText(sec, para, startOffset, nextText), 'insertText')
  }

  const nextEnd = startOffset + cpLength(nextText)
  const rangeRes = addRangeMark(
    doc,
    MARK_PREFIXES.citation,
    idParts,
    { sec, para, offset: startOffset },
    { sec, para, offset: nextEnd },
  )
  if (!rangeRes.ok) {
    return {
      ok: false,
      reason: rangeRes.reason ?? 'engine_error',
      ...(rangeRes.error ? { error: rangeRes.error } : {}),
    }
  }
  return { ok: true, endOffset: nextEnd }
}

/**
 * Single unified document-order citation collector across:
 * 1. Marked body `인용:` range citations
 * 2. App-inserted non-body plain-text citations (`unmarkedRefs` in `설정:인용`)
 * 3. Unmarked pattern citations matched to `entries` (deduplicated against located `unmarkedRefs`)
 * 4. Optional `pendingEvent` (for computing order right before inserting a new citation)
 */
function collectDocumentCitationOrder(doc, entries = null, options = {}) {
  const hasEntries = Array.isArray(entries) && entries.length > 0
  const marks = listCitationMarks(doc, hasEntries ? entries : null)
  const { unmarkedRefs: rawUnmarkedRefs } = readCitationMetaState(doc)
  const {
    located: locatedUnmarkedRefs,
    modified: modifiedUnmarkedRefs,
    aliveRefs: aliveUnmarkedRefs,
  } = resolveUnmarkedRefsInDoc(doc, rawUnmarkedRefs, hasEntries ? entries : null)

  const allPatterns = findPatternCitations(doc, hasEntries ? entries : null)

  // Deduplicate pattern matches against located tracked non-body citations at the same container & span.
  const locatedByContainer = new Map()
  for (const ref of locatedUnmarkedRefs) {
    const key = containerKeyForRef(ref)
    let list = locatedByContainer.get(key)
    if (!list) {
      list = []
      locatedByContainer.set(key, list)
    }
    list.push({ start: ref.offset, end: ref.offset + ref.length })
  }
  const patterns = allPatterns.filter((p) => {
    const spans = locatedByContainer.get(containerKeyForRef(p))
    if (!spans) return true
    return !spans.some((sp) => p.offset < sp.end && sp.start < p.offset + p.length)
  })

  const events = []
  for (const m of marks) {
    events.push({
      sec: m.sec,
      para: m.para,
      kind: 'body',
      offset: m.startOffset,
      keys: m.keys,
      source: 'mark',
      mark: m,
    })
  }
  for (const ref of locatedUnmarkedRefs) {
    events.push({
      sec: ref.sec,
      para: ref.para,
      kind: ref.kind,
      ...(ref.path ? { path: ref.path } : {}),
      ...(ref.noteControl != null ? { noteControl: ref.noteControl, notePara: ref.notePara } : {}),
      offset: ref.offset,
      keys: ref.keys,
      source: 'unmarkedRef',
      unmarkedRef: ref,
    })
  }
  for (const p of patterns) {
    const matchedKeys = p.parsedRefs.map((r) => r.matchedKey).filter(Boolean)
    if (matchedKeys.length > 0) {
      events.push({
        sec: p.sec,
        para: p.para,
        kind: p.kind,
        ...(p.path ? { path: p.path } : {}),
        ...(p.noteControl != null ? { noteControl: p.noteControl, notePara: p.notePara } : {}),
        offset: p.offset,
        keys: matchedKeys,
        source: 'pattern',
        pattern: p,
      })
    }
  }
  if (options.pendingEvent) {
    events.push(options.pendingEvent)
  }

  events.sort(createEventComparator(doc))

  const citedKeysInOrder = []
  const seenKey = new Set()
  const resolvedEntries = []
  const missingKeys = []
  const unverifiedKeys = []

  for (const ev of events) {
    for (const rawKey of ev.keys) {
      const entry = hasEntries ? resolveEntryByKey(entries, rawKey) : null
      if (entry) {
        if (entry.verified === false) {
          if (!unverifiedKeys.includes(entry.key)) unverifiedKeys.push(entry.key)
          continue
        }
        citedKeysInOrder.push(entry.key)
        if (!seenKey.has(entry.key)) {
          seenKey.add(entry.key)
          resolvedEntries.push(entry)
        }
      } else {
        citedKeysInOrder.push(rawKey)
        if (hasEntries && !missingKeys.includes(rawKey)) missingKeys.push(rawKey)
      }
    }
  }

  return {
    citedKeysInOrder,
    resolvedEntries,
    missingKeys,
    unverifiedKeys,
    marks,
    locatedUnmarkedRefs,
    modifiedUnmarkedRefs,
    aliveUnmarkedRefs,
    patterns,
    allPatterns,
    events,
  }
}

function buildFormatItemsForCitation(items, mode, entries, allowKeyOnlyFallback) {
  const hasEntries = Array.isArray(entries) && entries.length > 0
  const formatItems = []
  const missingKeys = []
  const unverifiedKeys = []
  let canFormat = true

  for (const item of items) {
    const resolved = hasEntries ? resolveEntryByKey(entries, item.key) : null
    if (hasEntries) {
      if (!resolved) {
        missingKeys.push(item.key)
        canFormat = false
        continue
      }
      if (resolved.verified === false) {
        unverifiedKeys.push(resolved.key)
        canFormat = false
        continue
      }
    } else if (!allowKeyOnlyFallback || mode === 'narrative') {
      canFormat = false
      break
    }

    const entry = resolved ?? {
      id: item.key,
      key: item.key,
      oldKeys: [],
      type: 'other',
      authors: [],
      title: '',
      language: 'en',
      tags: [],
      verified: true,
    }
    formatItems.push({
      entry,
      ...(item.locator ? { locator: item.locator } : {}),
      ...(item.prefix ? { prefix: item.prefix } : {}),
      ...(item.suffix ? { suffix: item.suffix } : {}),
    })
  }

  if (formatItems.length === 0) canFormat = false
  return { canFormat, formatItems, missingKeys, unverifiedKeys }
}

/**
 * Synchronize formatting of all existing marked `인용:` body citations and tracked
 * non-body citations (`unmarkedRefs`) for disambiguation suffixes (`a`/`b`),
 * MLA short titles, and unified document-order IEEE numbering.
 * Skips manually modified citations and reports them in `skippedManual`.
 */
function syncMarkedCitationsFormatting(doc, entries, style, options = {}) {
  if (!doc || typeof doc.getBookmarks !== 'function') {
    return {
      ok: true,
      updated: 0,
      skippedManual: [],
      missingKeys: [],
      unverifiedKeys: [],
    }
  }

  const entryList = Array.isArray(entries) ? entries : []
  const hasEntries = entryList.length > 0
  const allowKeyOnlyFallback = options.allowKeyOnlyFallback === true && style === 'ieee'
  const updateMetaForAllEligible = options.updateMetaForAllEligible === true
  const collected = collectDocumentCitationOrder(doc, hasEntries ? entryList : null)
  const { marks, locatedUnmarkedRefs, modifiedUnmarkedRefs, aliveUnmarkedRefs, citedKeysInOrder } =
    collected

  if (marks.length === 0 && locatedUnmarkedRefs.length === 0 && modifiedUnmarkedRefs.length === 0) {
    return {
      ok: true,
      updated: 0,
      skippedManual: [],
      missingKeys: [],
      unverifiedKeys: [],
    }
  }

  // Include all cited entries in document order (even from manually edited marks) for stable suffixes & numbering.
  const citedEntryMap = new Map()
  if (hasEntries) {
    for (const key of citedKeysInOrder) {
      const entry = resolveEntryByKey(entryList, key)
      if (entry && !citedEntryMap.has(entry.key)) {
        citedEntryMap.set(entry.key, entry)
      }
    }
  }
  const citedEntries = [...citedEntryMap.values()]
  const disambiguation = assignDisambiguationSuffixes(citedEntries, style)
  const shortTitles = style === 'mla' ? assignMlaShortTitles(citedEntries) : undefined
  const ieeeNumbers =
    style === 'ieee'
      ? assignIeeeNumbers(citedKeysInOrder, hasEntries ? entryList : undefined)
      : new Map()

  const skippedManual = []
  const missingKeysSet = new Set()
  const unverifiedKeysSet = new Set()
  const bodySteps = []
  const unmarkedSteps = []

  for (const mark of marks) {
    if (mark.isManuallyEdited) {
      skippedManual.push({
        id: mark.id,
        kind: 'body',
        sec: mark.sec,
        para: mark.para,
        offset: mark.startOffset,
        length: mark.length,
        currentText: mark.text,
        expectedText: mark.writtenText,
      })
      continue
    }
    const built = buildFormatItemsForCitation(
      mark.items,
      mark.mode,
      entryList,
      allowKeyOnlyFallback,
    )
    for (const k of built.missingKeys) missingKeysSet.add(k)
    for (const k of built.unverifiedKeys) unverifiedKeysSet.add(k)
    if (!built.canFormat) continue

    const nextText = formatInTextCitation(built.formatItems, style, {
      mode: mark.mode,
      disambiguation,
      shortTitles,
      ieeeNumbers,
    })
    if (nextText !== mark.text || updateMetaForAllEligible) {
      bodySteps.push({ mark, formatItems: built.formatItems, nextText })
    }
  }

  for (const modRef of modifiedUnmarkedRefs) {
    skippedManual.push({
      id: modRef.id,
      kind: modRef.kind,
      sec: modRef.sec,
      para: modRef.para,
      ...(modRef.path ? { path: modRef.path } : {}),
      ...(modRef.noteControl != null
        ? { noteControl: modRef.noteControl, notePara: modRef.notePara }
        : {}),
      offset: modRef.offset,
      length: modRef.length,
      currentText: modRef.text,
      expectedText: modRef.writtenText,
    })
  }

  for (const ref of locatedUnmarkedRefs) {
    const built = buildFormatItemsForCitation(ref.items, ref.mode, entryList, allowKeyOnlyFallback)
    for (const k of built.missingKeys) missingKeysSet.add(k)
    for (const k of built.unverifiedKeys) unverifiedKeysSet.add(k)
    if (!built.canFormat) continue

    const nextText = formatInTextCitation(built.formatItems, style, {
      mode: ref.mode,
      disambiguation,
      shortTitles,
      ieeeNumbers,
    })
    if (nextText !== ref.text || updateMetaForAllEligible) {
      unmarkedSteps.push({ ref, formatItems: built.formatItems, nextText })
    }
  }

  // Rewrite body marks in reverse document order so earlier offsets never shift.
  bodySteps.sort((a, b) => {
    if (a.mark.sec !== b.mark.sec) return b.mark.sec - a.mark.sec
    if (a.mark.para !== b.mark.para) return b.mark.para - a.mark.para
    return b.mark.startOffset - a.mark.startOffset
  })

  // Rewrite non-body refs in reverse offset order within each container.
  unmarkedSteps.sort((a, b) => {
    if (a.ref.sec !== b.ref.sec) return b.ref.sec - a.ref.sec
    if (a.ref.para !== b.ref.para) return b.ref.para - a.ref.para
    return b.ref.offset - a.ref.offset
  })

  const { metaMap } = readCitationMetaState(doc)
  const nextUnmarkedById = new Map(aliveUnmarkedRefs.map((r) => [r.id, { ...r }]))
  let updated = 0
  let metaDirty = false

  for (const step of bodySteps) {
    if (step.nextText !== step.mark.text) {
      const rw = rewriteSingleCitationMarkInPlace(doc, step.mark, step.nextText)
      if (!rw.ok) return rw
      updated += 1
      metaDirty = true
    } else if (updateMetaForAllEligible) {
      metaDirty = true
    }
    const existing = resolveCitationMeta(metaMap, step.mark.id)
    metaMap.set(step.mark.id, {
      items: hasEntries
        ? step.formatItems.map((it) => {
            const out = { key: it.entry.key }
            if (it.locator) out.locator = it.locator
            if (it.prefix) out.prefix = it.prefix
            if (it.suffix) out.suffix = it.suffix
            return out
          })
        : existing.items.length > 0
          ? existing.items
          : step.mark.items,
      mode: step.mark.mode,
      writtenText: step.nextText,
    })
  }

  for (const step of unmarkedSteps) {
    if (step.nextText !== step.ref.text) {
      let rw
      if (step.ref.kind === 'table' || step.ref.kind === 'textbox') {
        rw = replaceCellTextRange(
          doc,
          step.ref.sec,
          step.ref.para,
          step.ref.path,
          step.ref.offset,
          step.ref.length,
          step.nextText,
        )
      } else {
        rw = replaceNoteTextRange(
          doc,
          step.ref.sec,
          step.ref.para,
          step.ref.noteControl,
          step.ref.notePara,
          step.ref.offset,
          step.ref.length,
          step.nextText,
        )
      }
      if (!rw.ok) return rw
      updated += 1
      metaDirty = true
    } else if (updateMetaForAllEligible) {
      metaDirty = true
    }

    const prev = nextUnmarkedById.get(step.ref.id)
    if (prev) {
      nextUnmarkedById.set(step.ref.id, {
        ...prev,
        offset: step.ref.offset,
        items: hasEntries
          ? step.formatItems.map((it) => {
              const out = { key: it.entry.key }
              if (it.locator) out.locator = it.locator
              if (it.prefix) out.prefix = it.prefix
              if (it.suffix) out.suffix = it.suffix
              return out
            })
          : prev.items,
        writtenText: step.nextText,
      })
    }
  }

  if (metaDirty) {
    const activeIds = new Set(listCitationMarks(doc).map((m) => m.id))
    const metaWrite = writeCitationMetaState(
      doc,
      metaMap,
      [...nextUnmarkedById.values()],
      activeIds,
    )
    if (!metaWrite.ok) return metaWrite
  }

  return {
    ok: true,
    updated,
    skippedManual,
    missingKeys: [...missingKeysSet],
    unverifiedKeys: [...unverifiedKeysSet],
  }
}

/**
 * Renumber non-manual marked `인용:` body citations and tracked non-body citations
 * in unified document order when the active style is IEEE.
 * Works with or without library entries (falls back to key-only entries for parenthetical marks).
 */
export function renumberIeeeCitations(doc, entries = null) {
  if (!doc || typeof doc.getBookmarks !== 'function') {
    return { ok: true, updated: 0 }
  }
  const sync = syncMarkedCitationsFormatting(doc, entries, 'ieee', { allowKeyOnlyFallback: true })
  if (!sync.ok) return sync
  return {
    ok: true,
    updated: sync.updated,
    ...(sync.skippedManual.length > 0 ? { skippedManual: sync.skippedManual } : {}),
  }
}

/**
 * Insert a formatted in-text citation at `options.place`.
 * - Body paragraphs: inserts text wrapped in paired `인용:<tag>:시작` / `인용:<tag>:끝` marks
 *   and stores structured metadata in `설정:인용`.
 * - Table cells, text boxes, footnotes, and endnotes: inserts plain text ONLY (no bookmarks
 *   on the container) and records a lightweight descriptor in `설정:인용` so IEEE numbering
 *   and style updates stay synchronized.
 * - Unverified references (`verified === false`), missing entries, and placements inside
 *   existing `인용:` or `참고문헌:` ranges are strictly refused.
 */
export function insertCitation(doc, options = {}) {
  if (!doc || typeof doc.getSectionCount !== 'function') {
    return { ok: false, reason: 'unsupported_place' }
  }

  const style = options.style ?? getDocumentCitationStyle(doc)
  if (!isCitationStyle(style)) {
    return { ok: false, reason: 'invalid_style' }
  }

  const mode = options.mode === 'narrative' ? 'narrative' : 'parenthetical'
  const entries = Array.isArray(options.entries) ? options.entries : []
  const rawItems = normalizeCitationItemsInput(options)
  if (rawItems.length === 0) {
    return { ok: false, reason: 'empty_items' }
  }

  // Validate all requested keys exist and are verified BEFORE touching the document.
  const missingKeys = []
  const unverifiedKeys = []
  const resolvedItems = []
  for (const item of rawItems) {
    const entry = resolveEntryByKey(entries, item.key)
    if (!entry) {
      if (!missingKeys.includes(item.key)) missingKeys.push(item.key)
      continue
    }
    if (entry.verified === false) {
      if (!unverifiedKeys.includes(entry.key)) unverifiedKeys.push(entry.key)
      continue
    }
    resolvedItems.push({ ...item, key: entry.key, entry })
  }

  if (missingKeys.length > 0) {
    return { ok: false, reason: 'missing_entry', missingKeys }
  }
  if (unverifiedKeys.length > 0) {
    return { ok: false, reason: 'unverified_entry', unverifiedKeys }
  }

  const target = classifyCitationPlace(doc, options.place)
  if (!target.ok) return target

  // Guard against inserting inside an existing `인용:` or `참고문헌:` range.
  const bibRanges = findRangeMarks(doc, [MARK_PREFIXES.bibliography]).ranges
  if (bibRanges.some((r) => isParaInsideRange(target.sec, target.para, r))) {
    return { ok: false, reason: 'inside_bibliography' }
  }
  if (target.kind === 'body') {
    const citRanges = findRangeMarks(doc, [MARK_PREFIXES.citation]).ranges
    if (
      citRanges.some((r) => isBodyPositionInsideRange(target.sec, target.para, target.offset, r))
    ) {
      return { ok: false, reason: 'inside_citation' }
    }
  }

  // Compute unified document reading order INCLUDING this pending citation.
  const newKeys = resolvedItems.map((it) => it.entry.key)
  const pendingEvent = {
    sec: target.sec,
    para: target.para,
    kind: target.kind,
    ...(target.path ? { path: target.path } : {}),
    ...(target.noteControl != null
      ? { noteControl: target.noteControl, notePara: target.notePara }
      : {}),
    offset: target.offset,
    keys: newKeys,
    source: 'pending',
  }
  const unified = collectDocumentCitationOrder(doc, entries, { pendingEvent })
  const citedEntryMap = new Map()
  for (const e of unified.resolvedEntries) citedEntryMap.set(e.key, e)
  for (const it of resolvedItems) citedEntryMap.set(it.entry.key, it.entry)
  const citedEntries = [...citedEntryMap.values()]

  const disambiguation = assignDisambiguationSuffixes(citedEntries, style)
  const shortTitles = style === 'mla' ? assignMlaShortTitles(citedEntries) : undefined
  const ieeeNumbers =
    style === 'ieee' ? assignIeeeNumbers(unified.citedKeysInOrder, entries) : new Map()

  const text = formatInTextCitation(
    resolvedItems.map((it) => ({
      entry: it.entry,
      ...(it.locator ? { locator: it.locator } : {}),
      ...(it.prefix ? { prefix: it.prefix } : {}),
      ...(it.suffix ? { suffix: it.suffix } : {}),
    })),
    style,
    { mode, disambiguation, shortTitles, ieeeNumbers },
  )
  const textLen = cpLength(text)

  const storedItems = resolvedItems.map((it) => {
    const out = { key: it.entry.key }
    if (it.locator) out.locator = it.locator
    if (it.prefix) out.prefix = it.prefix
    if (it.suffix) out.suffix = it.suffix
    return out
  })

  // Non-body editable containers: insert plain text ONLY (zero citation bookmarks).
  if (target.kind === 'table' || target.kind === 'textbox') {
    const pathJson = JSON.stringify(target.path)
    if (typeof doc.insertTextInCellByPath === 'function') {
      expectOk(
        doc.insertTextInCellByPath(target.sec, target.para, pathJson, target.offset, text),
        'insertTextInCellByPath',
      )
    } else if (target.path.length === 1 && typeof doc.insertTextInCell === 'function') {
      const s = target.path[0]
      expectOk(
        doc.insertTextInCell(
          target.sec,
          target.para,
          s.controlIndex,
          s.cellIndex,
          s.cellParaIndex,
          target.offset,
          text,
        ),
        'insertTextInCell',
      )
    } else {
      return { ok: false, reason: 'unsupported_place' }
    }

    const { metaMap, unmarkedRefs } = readCitationMetaState(doc)
    const refId = allocateUnmarkedRefId(unmarkedRefs)
    unmarkedRefs.push({
      id: refId,
      kind: target.kind,
      sec: target.sec,
      para: target.para,
      path: target.path,
      offset: target.offset,
      items: storedItems,
      mode,
      writtenText: text,
    })
    const activeIds = new Set(listCitationMarks(doc).map((m) => m.id))
    const metaWrite = writeCitationMetaState(doc, metaMap, unmarkedRefs, activeIds)
    if (!metaWrite.ok) return metaWrite

    const syncRes = syncMarkedCitationsFormatting(doc, entries, style)
    if (!syncRes.ok) return syncRes

    return {
      ok: true,
      marked: false,
      placeKind: target.kind,
      text,
      sec: target.sec,
      para: target.para,
      path: target.path,
      offset: target.offset,
      length: textLen,
      keys: newKeys,
      ...(syncRes.updated > 0 ? { renumbered: syncRes.updated } : {}),
      ...(syncRes.skippedManual.length > 0 ? { skippedManual: syncRes.skippedManual } : {}),
    }
  }

  if (target.kind === 'footnote' || target.kind === 'endnote') {
    expectOk(
      doc.insertTextInFootnote(
        target.sec,
        target.para,
        target.noteControl,
        target.notePara,
        target.offset,
        text,
      ),
      'insertTextInFootnote',
    )

    const { metaMap, unmarkedRefs } = readCitationMetaState(doc)
    const refId = allocateUnmarkedRefId(unmarkedRefs)
    unmarkedRefs.push({
      id: refId,
      kind: target.kind,
      sec: target.sec,
      para: target.para,
      noteControl: target.noteControl,
      notePara: target.notePara,
      offset: target.offset,
      items: storedItems,
      mode,
      writtenText: text,
    })
    const activeIds = new Set(listCitationMarks(doc).map((m) => m.id))
    const metaWrite = writeCitationMetaState(doc, metaMap, unmarkedRefs, activeIds)
    if (!metaWrite.ok) return metaWrite

    const syncRes = syncMarkedCitationsFormatting(doc, entries, style)
    if (!syncRes.ok) return syncRes

    return {
      ok: true,
      marked: false,
      placeKind: target.kind,
      text,
      sec: target.sec,
      para: target.para,
      noteControl: target.noteControl,
      notePara: target.notePara,
      offset: target.offset,
      length: textLen,
      keys: newKeys,
      ...(syncRes.updated > 0 ? { renumbered: syncRes.updated } : {}),
      ...(syncRes.skippedManual.length > 0 ? { skippedManual: syncRes.skippedManual } : {}),
    }
  }

  // Body paragraph: insert text, place paired `인용:` range marks, and persist metadata.
  expectOk(doc.insertText(target.sec, target.para, target.offset, text), 'insertText')
  const startOffset = target.offset
  const endOffset = startOffset + textLen

  const { metaMap, unmarkedRefs } = readCitationMetaState(doc)
  const tag = allocateCitationTag(doc, storedItems, metaMap)
  const rangeRes = addRangeMark(
    doc,
    MARK_PREFIXES.citation,
    tag.idParts,
    { sec: target.sec, para: target.para, offset: startOffset },
    { sec: target.sec, para: target.para, offset: endOffset },
  )
  if (!rangeRes.ok) {
    // Roll back inserted text so partial mutation is never left behind.
    tryOr(() => doc.deleteText(target.sec, target.para, startOffset, textLen), null)
    return rangeRes
  }

  metaMap.set(tag.id, { items: storedItems, mode, writtenText: text })
  const activeIds = new Set(listCitationMarks(doc).map((m) => m.id))
  activeIds.add(tag.id)
  const metaWrite = writeCitationMetaState(doc, metaMap, unmarkedRefs, activeIds)
  if (!metaWrite.ok) return metaWrite

  const syncRes = syncMarkedCitationsFormatting(doc, entries, style)
  if (!syncRes.ok) return syncRes

  // Re-read our inserted mark's offsets in case an earlier citation on the same paragraph changed length.
  const finalMark = listCitationMarks(doc, entries).find((m) => m.id === tag.id)
  const finalStart = finalMark ? finalMark.startOffset : startOffset
  const finalEnd = finalMark ? finalMark.endOffset : endOffset
  const finalText = finalMark ? finalMark.text : text

  return {
    ok: true,
    marked: true,
    placeKind: 'body',
    text: finalText,
    sec: target.sec,
    para: target.para,
    startOffset: finalStart,
    endOffset: finalEnd,
    offset: finalStart,
    length: finalEnd - finalStart,
    id: tag.id,
    keys: newKeys,
    ...(syncRes.updated > 0 ? { renumbered: syncRes.updated } : {}),
    ...(syncRes.skippedManual.length > 0 ? { skippedManual: syncRes.skippedManual } : {}),
  }
}

// ---------------------------------------------------------------------------
// 4. Pattern citation finder (`findPatternCitations`)
// ---------------------------------------------------------------------------

function normalizeAuthorLeadForMatch(raw) {
  if (typeof raw !== 'string') return ''
  let s = raw.trim()
  // Strip common citation prefixes ("see ", "cf. ", "참고: ").
  s = s.replace(/^(?:see\s+also|see|cf\.|e\.g\.,?|참고\s*:?)\s+/i, '').trim()
  // Keep only the first author before `&`, `and`, `,`, `외`, `et al.`.
  s = s
    .replace(/\s+et\s+al\.?$/i, '')
    .replace(/\s+외$/, '')
    .trim()
  s = s.split(/\s+(?:&|and)\s+|\s*,\s*/i)[0].trim()
  return s.toLowerCase()
}

function entryLeadAuthorTokens(entry) {
  const tokens = new Set()
  const list =
    Array.isArray(entry.authors) && entry.authors.length > 0
      ? entry.authors
      : Array.isArray(entry.editors) && entry.editors.length > 0
        ? entry.editors
        : []
  if (list.length > 0) {
    const first = normalizeAuthor(list[0])
    if (first) {
      if (first.family) tokens.add(first.family.toLowerCase())
      if (first.literal) tokens.add(first.literal.toLowerCase())
      const disp = formatAuthorDisplay(first, detectEntryLanguage(entry))
      if (disp) tokens.add(disp.toLowerCase())
      if (first.family && first.given) {
        tokens.add(`${first.family}${first.given}`.toLowerCase())
      }
    }
  }
  if (entry.key) tokens.add(entry.key.toLowerCase())
  return tokens
}

function matchEntryByAuthorYear(entries, authorHint, yearToken, disambigMap) {
  if (!Array.isArray(entries) || entries.length === 0 || !authorHint) return undefined
  const lead = normalizeAuthorLeadForMatch(authorHint)
  if (!lead) return undefined

  const yearMatch = yearToken ? FOUR_DIGIT_YEAR_SUFFIX_RE.exec(yearToken) : null
  const baseYear = yearMatch ? yearMatch[1] : null
  const suffix = yearMatch && yearMatch[2] ? yearMatch[2].toLowerCase() : null

  const candidates = []
  for (const entry of entries) {
    if (!entry) continue
    const tokens = entryLeadAuthorTokens(entry)
    let authorHit = tokens.has(lead)
    if (!authorHit && lead.length >= 2) {
      for (const tok of tokens) {
        if (tok === lead || tok.startsWith(`${lead} `) || tok.endsWith(` ${lead}`)) {
          authorHit = true
          break
        }
      }
    }
    if (!authorHit) continue

    if (baseYear) {
      const entryYearMatch = entry.year ? FOUR_DIGIT_YEAR_SUFFIX_RE.exec(String(entry.year)) : null
      if (!entryYearMatch || entryYearMatch[1] !== baseYear) continue
    }
    candidates.push(entry)
  }

  if (candidates.length === 0) return undefined
  if (candidates.length === 1) return candidates[0].key
  if (suffix && disambigMap) {
    const exact = candidates.find((c) => disambigMap.get(c.key) === suffix)
    if (exact) return exact.key
  }
  return candidates[0].key
}

function parseParentheticalClauses(rawText) {
  const inner = rawText.slice(1, -1).trim()
  if (!inner) return []
  const clauses = inner
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean)
  const parsed = []

  for (const clause of clauses) {
    const yearMatch = FOUR_DIGIT_YEAR_SUFFIX_RE.exec(clause)
    const noDateMatch = !yearMatch ? NO_DATE_TOKEN_RE.exec(clause) : null
    const timeMatch = yearMatch ?? noDateMatch
    if (!timeMatch) continue

    const beforeYear = clause.slice(0, timeMatch.index).replace(/,\s*$/, '').trim()
    if (!beforeYear) continue
    const leadWord = beforeYear.split(/[\s,]/)[0]
    if (!leadWord || NON_AUTHOR_LEAD_RE.test(leadWord)) continue
    // Require either Hangul text or a capitalized Latin surname to avoid matching prose.
    const hasHangul = /[\uAC00-\uD7A3]{2,}/.test(beforeYear)
    const hasLatinAuthor = /^[A-Z][A-Za-z'’-]+/.test(
      beforeYear.replace(/^(?:see\s+also|see|cf\.|e\.g\.,?)\s+/i, ''),
    )
    if (!hasHangul && !hasLatinAuthor) continue

    const yearStr = yearMatch
      ? `${yearMatch[1]}${yearMatch[2] ? yearMatch[2].toLowerCase() : ''}`
      : timeMatch[0]
    parsed.push({ authorHint: beforeYear, year: yearStr })
  }

  return parsed
}

function parseNarrativeCitation(rawText) {
  const openIdx = rawText.indexOf('(')
  const closeIdx = rawText.lastIndexOf(')')
  if (openIdx <= 0 || closeIdx <= openIdx) return []
  const authorHint = rawText.slice(0, openIdx).trim()
  const inside = rawText.slice(openIdx + 1, closeIdx).trim()
  const leadWord = authorHint.split(/[\s,]/)[0]
  if (!leadWord || NON_AUTHOR_LEAD_RE.test(leadWord)) return []
  const yearMatch = FOUR_DIGIT_YEAR_SUFFIX_RE.exec(inside)
  const noDateMatch = !yearMatch ? NO_DATE_TOKEN_RE.exec(inside) : null
  const year = yearMatch
    ? `${yearMatch[1]}${yearMatch[2] ? yearMatch[2].toLowerCase() : ''}`
    : noDateMatch
      ? noDateMatch[0]
      : undefined
  if (!year) return []
  return [{ authorHint, year }]
}

function parseIeeeNumbersFromMatch(rawText) {
  const nums = []
  // Handle `[1]-[3]` or `[1]–[3]` range syntax.
  const bracketRange = /^\[(\d+)\]\s*[-–—]\s*\[(\d+)\]$/.exec(rawText.trim())
  if (bracketRange) {
    const start = Number(bracketRange[1])
    const end = Number(bracketRange[2])
    if (start >= 1 && end >= start && end - start <= 50) {
      for (let n = start; n <= end; n++) nums.push(n)
      return nums
    }
  }
  const inner = rawText.replace(/^\[/, '').replace(/\]$/, '')
  // Stop before locator tokens like `, p. 23` or `, 23쪽`.
  const numPart = inner.split(/,\s*(?:pp?\.|\d+쪽)/i)[0]
  for (const part of numPart.split(',')) {
    const trimmed = part.trim()
    const rangeMatch = /^(\d+)\s*[-–—]\s*(\d+)$/.exec(trimmed)
    if (rangeMatch) {
      const a = Number(rangeMatch[1])
      const b = Number(rangeMatch[2])
      if (a >= 1 && b >= a && b - a <= 50) {
        for (let n = a; n <= b; n++) nums.push(n)
      }
    } else if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed)
      if (n >= 1) nums.push(n)
    }
  }
  return nums
}

/**
 * Search across body, tables (including nested tables), text boxes, footnotes, and endnotes
 * for unmarked textual citations matching author-year parenthetical, narrative, and IEEE
 * numeric patterns. Excludes existing `인용:` ranges and marked `참고문헌:` ranges.
 */
export function findPatternCitations(doc, entries = null) {
  if (!doc || typeof doc.getSectionCount !== 'function') return []

  const bibRanges = findRangeMarks(doc, [MARK_PREFIXES.bibliography]).ranges
  const unmarkedBib = bibRanges.length === 0 ? detectUnmarkedBibliography(doc) : { found: false }
  const citRanges = findRangeMarks(doc, [MARK_PREFIXES.citation]).ranges
  const savedBib = readDocSetting(doc, BIB_SETTING_KEY, null)
  const bibKeyByIeeeNum = new Map()
  if (Array.isArray(savedBib?.keys)) {
    savedBib.keys.forEach((k, idx) => {
      if (typeof k === 'string' && k) bibKeyByIeeeNum.set(idx + 1, k)
    })
  }

  const entryList = Array.isArray(entries) ? entries : []
  const disambigMap =
    entryList.length >= 2
      ? assignDisambiguationSuffixes(entryList, getDocumentCitationStyle(doc))
      : null

  const insideBodyCitationMark = (sec, para, start, end) =>
    citRanges.some(
      (r) =>
        r.start.sec === sec &&
        r.start.para === para &&
        r.end.sec === sec &&
        r.end.para === para &&
        start < r.end.offset &&
        r.start.offset < end,
    )

  const queries = [
    { patternKind: 'parenthetical', query: PAREN_CANDIDATE_QUERY, caseSensitive: true },
    { patternKind: 'narrative', query: KO_NARRATIVE_QUERY, caseSensitive: true },
    { patternKind: 'narrative', query: EN_NARRATIVE_QUERY, caseSensitive: true },
    { patternKind: 'ieee', query: IEEE_PATTERN_QUERY, caseSensitive: false },
  ]

  const collected = []
  const seenSpan = new Set()

  for (const spec of queries) {
    const res = findMatches(doc, {
      query: spec.query,
      regex: true,
      caseSensitive: spec.caseSensitive,
    })
    if (!res.ok || !Array.isArray(res.matches)) continue

    for (const m of res.matches) {
      if (m.inCitation) continue
      if (m.kind === 'body') {
        if (bibRanges.some((r) => isParaInsideRange(m.sec, m.para, r))) continue
        if (
          unmarkedBib.found &&
          m.sec === unmarkedBib.range.sec &&
          m.para >= unmarkedBib.range.startPara &&
          m.para <= unmarkedBib.range.endPara
        ) {
          continue
        }
        if (insideBodyCitationMark(m.sec, m.para, m.offset, m.offset + m.length)) continue
      }

      let rawRefs
      if (spec.patternKind === 'parenthetical') {
        rawRefs = parseParentheticalClauses(m.matchText)
      } else if (spec.patternKind === 'narrative') {
        rawRefs = parseNarrativeCitation(m.matchText)
      } else {
        const nums = parseIeeeNumbersFromMatch(m.matchText)
        rawRefs = nums.map((num) => ({ number: num }))
      }
      if (rawRefs.length === 0) continue

      const spanKey = `${m.kind}|${m.sec}|${m.para}|${JSON.stringify(m.path ?? '')}|${m.noteControl ?? ''}:${m.notePara ?? ''}|${m.offset}|${m.length}`
      if (seenSpan.has(spanKey)) continue
      seenSpan.add(spanKey)

      const parsedRefs = rawRefs.map((ref) => {
        const out = {}
        if (ref.authorHint) out.authorHint = ref.authorHint
        if (ref.year) out.year = ref.year
        if (ref.number != null) out.number = ref.number

        if (entryList.length > 0) {
          if (ref.authorHint) {
            const matchedKey = matchEntryByAuthorYear(
              entryList,
              ref.authorHint,
              ref.year,
              disambigMap,
            )
            if (matchedKey) out.matchedKey = matchedKey
          } else if (ref.number != null) {
            const savedKey = bibKeyByIeeeNum.get(ref.number)
            if (savedKey) {
              const resolved = resolveEntryByKey(entryList, savedKey)
              out.matchedKey = resolved ? resolved.key : savedKey
            }
          }
        }
        return out
      })

      const hit = {
        kind: m.kind,
        sec: m.sec,
        para: m.para,
        ...(m.path ? { path: m.path } : {}),
        ...(m.kind === 'footnote' || m.kind === 'endnote'
          ? { noteControl: m.noteControl, notePara: m.notePara }
          : {}),
        offset: m.offset,
        length: m.length,
        text: m.matchText,
        page: m.page,
        patternKind: spec.patternKind,
        parsedRefs,
      }
      collected.push(hit)
    }
  }

  // Drop inner sub-matches strictly contained within a longer match at the same container.
  const cmpEvents = createEventComparator(doc)
  collected.sort((a, b) => {
    const cmp = cmpEvents(a, b)
    if (cmp !== 0) return cmp
    return b.length - a.length
  })

  const filtered = []
  for (const hit of collected) {
    const container = `${hit.kind}|${hit.sec}|${hit.para}|${JSON.stringify(hit.path ?? '')}|${hit.noteControl ?? ''}:${hit.notePara ?? ''}`
    const contained = filtered.some((prev) => {
      const prevContainer = `${prev.kind}|${prev.sec}|${prev.para}|${JSON.stringify(prev.path ?? '')}|${prev.noteControl ?? ''}:${prev.notePara ?? ''}`
      return (
        prevContainer === container &&
        prev.offset <= hit.offset &&
        prev.offset + prev.length >= hit.offset + hit.length
      )
    })
    if (!contained) filtered.push(hit)
  }

  return filtered
}

// ---------------------------------------------------------------------------
// 5. Rewrite old citation keys (`rewriteCitationKeys`)
// ---------------------------------------------------------------------------

/**
 * Update stored citation metadata (and bookmark tags when safe within 64 chars)
 * and saved bibliography keys when library keys are renamed (`oldKey -> newKey`).
 */
export function rewriteCitationKeys(doc, keyMap, _entries = null) {
  if (!doc || typeof doc.getBookmarks !== 'function') {
    return { ok: true, updated: 0 }
  }
  const map =
    keyMap instanceof Map
      ? keyMap
      : keyMap && typeof keyMap === 'object'
        ? new Map(Object.entries(keyMap))
        : new Map()
  if (map.size === 0) return { ok: true, updated: 0 }

  const marks = listCitationMarks(doc)
  const { metaMap, unmarkedRefs } = readCitationMetaState(doc)
  const usedNames = readAllBookmarkNames(doc)
  let updated = 0

  for (const mark of marks) {
    let changed = false
    const nextItems = mark.items.map((it) => {
      const mapped = map.get(it.key)
      if (typeof mapped === 'string' && mapped && mapped !== it.key) {
        changed = true
        return { ...it, key: mapped }
      }
      return it
    })
    if (!changed) continue
    updated += 1

    let nextId = mark.id
    // If this is a single-key bookmark whose tag starts with oldKey:, attempt safe rename.
    if (nextItems.length === 1 && typeof doc.renameBookmark === 'function') {
      const parts = mark.id.split(':')
      if (parts.length >= 2 && map.has(parts[0])) {
        const sanitizedNew = sanitizeCitationKey(nextItems[0].key)
        if (sanitizedNew) {
          const nextParts = [sanitizedNew, ...parts.slice(1)]
          const candidateId = nextParts.join(':')
          const nextStart = encodeMarkName(MARK_PREFIXES.citation, [...nextParts, RANGE_START])
          const nextEnd = encodeMarkName(MARK_PREFIXES.citation, [...nextParts, RANGE_END])
          if (
            nextStart.length <= MAX_MARK_NAME_LEN &&
            nextEnd.length <= MAX_MARK_NAME_LEN &&
            !usedNames.has(nextStart) &&
            !usedNames.has(nextEnd) &&
            !metaMap.has(candidateId)
          ) {
            const r1 = parseJson(
              doc.renameBookmark(mark.start.sec, mark.start.para, mark.start.ctrlIdx, nextStart),
              null,
            )
            if (r1 && r1.ok === true) {
              const r2 = parseJson(
                doc.renameBookmark(mark.end.sec, mark.end.para, mark.end.ctrlIdx, nextEnd),
                null,
              )
              if (r2 && r2.ok === true) {
                usedNames.delete(mark.start.name)
                usedNames.delete(mark.end.name)
                usedNames.add(nextStart)
                usedNames.add(nextEnd)
                metaMap.delete(mark.id)
                nextId = candidateId
              } else {
                // Roll back start bookmark rename if end rename failed.
                tryOr(
                  () =>
                    doc.renameBookmark(
                      mark.start.sec,
                      mark.start.para,
                      mark.start.ctrlIdx,
                      mark.start.name,
                    ),
                  null,
                )
              }
            }
          }
        }
      }
    }

    metaMap.set(nextId, {
      items: nextItems,
      mode: mark.mode,
      writtenText: mark.writtenText ?? mark.text,
    })
  }

  const nextUnmarkedRefs = unmarkedRefs.map((ref) => {
    let refChanged = false
    const nextItems = ref.items.map((it) => {
      const mapped = map.get(it.key)
      if (typeof mapped === 'string' && mapped && mapped !== it.key) {
        refChanged = true
        return { ...it, key: mapped }
      }
      return it
    })
    if (refChanged) {
      updated += 1
      return { ...ref, items: nextItems }
    }
    return ref
  })

  if (updated > 0) {
    const activeIds = new Set(listCitationMarks(doc).map((m) => m.id))
    const metaWrite = writeCitationMetaState(doc, metaMap, nextUnmarkedRefs, activeIds)
    if (!metaWrite.ok) return metaWrite
  }

  // Also update saved bibliography key list if present.
  const savedBib = readDocSetting(doc, BIB_SETTING_KEY, null)
  if (savedBib && typeof savedBib === 'object' && Array.isArray(savedBib.keys)) {
    let bibChanged = false
    const nextBibKeys = savedBib.keys.map((k) => {
      const mapped = map.get(k)
      if (typeof mapped === 'string' && mapped && mapped !== k) {
        bibChanged = true
        return mapped
      }
      return k
    })
    if (bibChanged) {
      const bibWrite = checkSettingWriteResult(
        writeDocSetting(doc, BIB_SETTING_KEY, { ...savedBib, keys: nextBibKeys }),
      )
      if (!bibWrite.ok) return bibWrite
    }
  }

  return { ok: true, updated }
}

// ---------------------------------------------------------------------------
// 6. Bibliography block: unmarked detection, manual-edit detection, insert & refresh
// ---------------------------------------------------------------------------

function isOutlineHeadingPara(doc, sec, para) {
  if (typeof doc.getStyleAt !== 'function') return false
  const info = tryOr(() => parseJson(doc.getStyleAt(sec, para), null), null)
  const name = typeof info?.name === 'string' ? info.name.trim() : ''
  const eng = typeof info?.englishName === 'string' ? info.englishName.trim() : ''
  return OUTLINE_STYLE_RE.test(name) || OUTLINE_STYLE_RE.test(eng)
}

function isProtectedRangePara(sec, para, ranges) {
  return ranges.some((r) => isParaInsideRange(sec, para, r))
}

/**
 * Detect an existing unmarked bibliography block below an explicit heading
 * (`참고문헌`, `References`, `Bibliography`). Never includes table control
 * paragraphs or unrelated document sections.
 */
export function detectUnmarkedBibliography(doc) {
  if (!doc || typeof doc.getSectionCount !== 'function') return { found: false }

  const markedBibRanges = findRangeMarks(doc, [MARK_PREFIXES.bibliography]).ranges
  const otherMarkedRanges = findRangeMarks(doc, [
    MARK_PREFIXES.toc,
    MARK_PREFIXES.indexBlock,
  ]).ranges
  const controlsByPara = bodyControlsByPara(doc)

  const secCount = doc.getSectionCount()
  for (let sec = 0; sec < secCount; sec++) {
    const paraCount = doc.getParagraphCount(sec)
    for (let hPara = 0; hPara < paraCount; hPara++) {
      if (isProtectedRangePara(sec, hPara, markedBibRanges)) continue
      if (isProtectedRangePara(sec, hPara, otherMarkedRanges)) continue
      const hControls = controlsByPara.get(`${sec}:${hPara}`)
      if (hControls && hControls.some((c) => c.ctrlId === 'tbl')) continue

      const hText = cleanText(bodyText(doc, sec, hPara))
      if (!BIB_HEADING_RE.test(hText)) continue

      const lines = []
      let blankRun = 0
      for (let p = hPara + 1; p < paraCount; p++) {
        if (isProtectedRangePara(sec, p, markedBibRanges)) break
        if (isProtectedRangePara(sec, p, otherMarkedRanges)) break

        const ctrls = controlsByPara.get(`${sec}:${p}`)
        // Never mistake a user table or drawing/equation paragraph for a bibliography line.
        if (ctrls && ctrls.some((c) => c.ctrlId === 'tbl')) break

        const lineText = cleanText(bodyText(doc, sec, p))
        if (!lineText) {
          blankRun += 1
          if (lines.length === 0 && blankRun <= 1) continue
          if (blankRun >= 2) break
          continue
        }

        if (isOutlineHeadingPara(doc, sec, p) || OTHER_SECTION_HEADING_RE.test(lineText)) {
          break
        }
        if (BIB_HEADING_RE.test(lineText)) break

        blankRun = 0
        lines.push({ sec, para: p, text: lineText })
      }

      if (lines.length === 0) continue

      const endPara = lines[lines.length - 1].para
      return {
        found: true,
        headingPara: { sec, para: hPara, text: hText },
        range: { sec, startPara: hPara, endPara },
        lines,
      }
    }
  }

  return { found: false }
}

/**
 * Read-only check reporting whether the marked `참고문헌:` block has manual edits
 * compared against its saved snapshot in `설정:참고문헌`.
 */
export function detectBibliographyManualEdits(doc) {
  if (!doc || typeof doc.getSectionCount !== 'function') {
    return { hasManualEdits: false, modifiedLines: [], range: null }
  }
  const { ranges } = findRangeMarks(doc, [MARK_PREFIXES.bibliography])
  if (ranges.length === 0) {
    return { hasManualEdits: false, modifiedLines: [], range: null }
  }
  const range = ranges[0]
  if (range.start.sec !== range.end.sec || range.start.para > range.end.para) {
    return { hasManualEdits: false, modifiedLines: [], range }
  }
  const saved = readDocSetting(doc, BIB_SETTING_KEY, null)
  if (!saved || !Array.isArray(saved.expectedLines)) {
    return { hasManualEdits: false, modifiedLines: [], range }
  }

  const sec = range.start.sec
  const actualLines = []
  for (let p = range.start.para; p <= range.end.para; p++) {
    actualLines.push(bodyText(doc, sec, p))
  }

  const modifiedLines = []
  const maxLen = Math.max(saved.expectedLines.length, actualLines.length)
  for (let i = 0; i < maxLen; i++) {
    const expected = i < saved.expectedLines.length ? saved.expectedLines[i] : ''
    const actual = i < actualLines.length ? actualLines[i] : ''
    if (expected !== actual) {
      modifiedLines.push({
        index: i,
        expected,
        actual,
        sec,
        para: range.start.para + i,
      })
    }
  }

  return {
    hasManualEdits: modifiedLines.length > 0,
    modifiedLines,
    range,
  }
}

function collectDocumentCitedKeys(doc, entries) {
  return collectDocumentCitationOrder(doc, entries)
}

function bibliographyLineCollationMeta(text) {
  const cleaned = cleanText(text).replace(LEADING_IEEE_NUM_RE, '').trim()
  const lead = cleaned.split(/[(.]/)[0]?.trim() || cleaned
  const isKo = HANGUL_RE.test(lead)
  const sortText = isKo ? cleaned : cleaned.replace(LEADING_EN_ARTICLE_RE, '')
  return { group: isKo ? 0 : 1, sortText }
}

function compareBibRowsByCollation(a, b) {
  const ma = bibliographyLineCollationMeta(a.text)
  const mb = bibliographyLineCollationMeta(b.text)
  if (ma.group !== mb.group) return ma.group - mb.group
  const collator = ma.group === 0 ? KO_COLLATOR : EN_COLLATOR
  return collator.compare(ma.sortText, mb.sortText)
}

function parseLeadingIeeeNumber(text) {
  const match = LEADING_IEEE_NUM_RE.exec(cleanText(text))
  if (!match) return null
  const n = Number(match[1])
  return Number.isInteger(n) && n >= 1 ? n : null
}

function buildBibliographyRenderPlan(
  doc,
  entries,
  style,
  options = {},
  savedMeta = null,
  bibRange = null,
) {
  const { citedKeysInOrder, resolvedEntries, missingKeys, unverifiedKeys } =
    collectDocumentCitedKeys(doc, entries)

  if (unverifiedKeys.length > 0) {
    return { ok: false, reason: 'unverified_entry', unverifiedKeys }
  }

  const entryMap = new Map()
  for (const e of resolvedEntries) {
    entryMap.set(e.key, e)
  }
  if (options.includeAllLibrary === true && Array.isArray(entries)) {
    for (const e of entries) {
      if (e && e.verified !== false && !entryMap.has(e.key)) {
        entryMap.set(e.key, e)
      }
    }
  }

  // Preserve lines from an existing bibliography whose keys are absent from `entries`,
  // reading their LIVE document text rather than stale saved `expectedLines`.
  const preservedMissing = []
  if (savedMeta && Array.isArray(savedMeta.keys)) {
    const titleOffset = typeof savedMeta.title === 'string' && savedMeta.title.length > 0 ? 1 : 0
    for (let i = 0; i < savedMeta.keys.length; i++) {
      const savedKey = savedMeta.keys[i]
      if (!savedKey) continue
      const inLibrary = Array.isArray(entries) ? resolveEntryByKey(entries, savedKey) : null
      if (inLibrary) continue

      let liveText = ''
      if (bibRange && bibRange.start.sec === bibRange.end.sec) {
        const livePara = bibRange.start.para + titleOffset + i
        if (livePara >= bibRange.start.para && livePara <= bibRange.end.para) {
          liveText = bodyText(doc, bibRange.start.sec, livePara)
        }
      }
      if (!liveText && Array.isArray(savedMeta.expectedLines)) {
        const fallback = savedMeta.expectedLines[titleOffset + i]
        if (typeof fallback === 'string') liveText = fallback
      }
      if (typeof liveText === 'string' && liveText.length > 0) {
        preservedMissing.push({ key: savedKey, text: liveText, savedIndex: i })
      }
    }
  }

  const entriesToFormat = [...entryMap.values()]
  if (entriesToFormat.length === 0 && preservedMissing.length === 0) {
    return { ok: false, reason: 'no_entries', missingKeys }
  }

  const formatted = formatBibliographyList(entriesToFormat, style, { citedKeysInOrder })
  const formattedRows = formatted.entries.map((fe, idx) => ({
    key: fe.key,
    text: fe.text,
    segments: fe.segments,
    preserved: false,
    _fmtIdx: idx,
    _ieeeNum: fe.number,
  }))
  const preservedRows = preservedMissing.map((pm) => ({
    key: pm.key,
    text: pm.text,
    segments: [{ text: pm.text }],
    preserved: true,
    _savedIndex: pm.savedIndex,
  }))

  let mergedRows
  if (preservedRows.length === 0) {
    mergedRows = formattedRows
  } else if (style === 'ieee') {
    const unifiedIeee = assignIeeeNumbers(citedKeysInOrder, entries)
    const ranked = [
      ...formattedRows.map((row) => ({
        row,
        rank:
          row._ieeeNum ??
          unifiedIeee.get(row.key) ??
          formatted.ieeeNumbers.get(row.key) ??
          Infinity,
        tieGroup: 1,
        tieOrder: row._fmtIdx,
      })),
      ...preservedRows.map((row) => ({
        row,
        rank: unifiedIeee.get(row.key) ?? parseLeadingIeeeNumber(row.text) ?? row._savedIndex + 1,
        tieGroup: 0,
        tieOrder: row._savedIndex,
      })),
    ]
    ranked.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank
      if (a.tieGroup !== b.tieGroup) return a.tieGroup - b.tieGroup
      return a.tieOrder - b.tieOrder
    })
    mergedRows = ranked.map((item) => item.row)
  } else {
    // Merge preserved missing-key rows into formatted rows in Korean-first -> English A-Z collation order.
    const sortedPreserved = [...preservedRows].sort(compareBibRowsByCollation)
    mergedRows = []
    let fIdx = 0
    let pIdx = 0
    while (fIdx < formattedRows.length && pIdx < sortedPreserved.length) {
      if (compareBibRowsByCollation(sortedPreserved[pIdx], formattedRows[fIdx]) < 0) {
        mergedRows.push(sortedPreserved[pIdx])
        pIdx += 1
      } else {
        mergedRows.push(formattedRows[fIdx])
        fIdx += 1
      }
    }
    while (fIdx < formattedRows.length) {
      mergedRows.push(formattedRows[fIdx])
      fIdx += 1
    }
    while (pIdx < sortedPreserved.length) {
      mergedRows.push(sortedPreserved[pIdx])
      pIdx += 1
    }
  }

  const rows = mergedRows.map(({ key, text, segments, preserved }) => ({
    key,
    text,
    segments,
    preserved,
  }))

  return {
    ok: true,
    style,
    rows,
    preservedMissingKeys: preservedMissing.map((p) => p.key),
    citedKeysInOrder,
  }
}

function prepareBibliographyReplaceSlot(doc, sec, startPara, endPara, rangeMarksToRemove) {
  if (Array.isArray(rangeMarksToRemove) && rangeMarksToRemove.length > 0) {
    const del = deleteMarkEntriesReverse(doc, rangeMarksToRemove)
    if (del.failed.length > 0) {
      return { ok: false, reason: 'mark_delete_failed', failed: del.failed }
    }
  }
  for (let p = endPara; p > startPara; p--) {
    expectOk(doc.deleteParagraph(sec, p), 'deleteParagraph')
  }
  const len = tryOr(() => doc.getParagraphLength(sec, startPara), 0)
  if (len > 0) {
    expectOk(doc.deleteText(sec, startPara, 0, len), 'deleteText')
  }
  tryOr(
    () =>
      doc.applyParaFormat(
        sec,
        startPara,
        JSON.stringify({ alignment: 'left', marginLeft: 0, indent: 0, tabStops: [] }),
      ),
    null,
  )
  return { ok: true }
}

function writeBibliographyIntoSlot(doc, config) {
  const { sec, startPara, reuseFirst, appendAtEnd, title, style, rows, includeAllLibrary } = config
  const trimmedTitle = typeof title === 'string' ? cleanText(title) : ''
  const titled = trimmedTitle.length > 0
  const totalParas = (titled ? 1 : 0) + rows.length

  let insertPara = startPara
  const rescuedBodyMarks = []

  if (appendAtEnd) {
    const lastIdx = doc.getParagraphCount(sec) - 1
    const lastLen =
      typeof doc.getLogicalLength === 'function'
        ? doc.getLogicalLength(sec, lastIdx)
        : doc.getParagraphLength(sec, lastIdx)
    expectOk(doc.splitParagraph(sec, lastIdx, lastLen), 'splitParagraph')
    insertPara = lastIdx + 1
    for (let i = 1; i < totalParas; i++) {
      expectOk(doc.splitParagraph(sec, insertPara + i - 1, 0), 'splitParagraph')
    }
  } else if (reuseFirst) {
    for (let i = 1; i < totalParas; i++) {
      expectOk(doc.splitParagraph(sec, insertPara + i - 1, 0), 'splitParagraph')
    }
  } else {
    // Rescue non-setting body bookmarks on the target paragraph before splitting at offset 0.
    const onTarget = listBodyBookmarksAt(doc, sec, insertPara).filter(
      (m) => !m.name.startsWith(MARK_PREFIXES.setting),
    )
    for (const mark of [...onTarget].sort((a, b) => b.ctrlIdx - a.ctrlIdx)) {
      rescuedBodyMarks.push({ name: mark.name, offset: mark.offset })
      const rm = removeMark(doc, mark)
      if (!rm.ok) {
        return {
          ok: false,
          reason: 'mark_delete_failed',
          failed: [
            {
              name: mark.name,
              sec: mark.sec,
              para: mark.para,
              ctrlIdx: mark.ctrlIdx,
              reason: rm.reason ?? 'engine_error',
              error: rm.error ?? rm.reason ?? 'removeMark failed',
            },
          ],
        }
      }
    }
    rescuedBodyMarks.reverse()

    for (let i = 0; i < totalParas; i++) {
      expectOk(doc.splitParagraph(sec, insertPara, 0), 'splitParagraph')
    }
    for (const rescued of rescuedBodyMarks) {
      const added = addMark(
        doc,
        { sec, para: insertPara + totalParas, offset: rescued.offset },
        rescued.name,
      )
      if (!added.ok) {
        return {
          ok: false,
          reason: added.reason ?? 'engine_error',
          ...(added.error ? { error: added.error } : {}),
        }
      }
    }
  }

  const bodyStyleId = styleIdOf(doc, BODY_STYLE_NAME) ?? 0
  const hangPt = getBibliographyHangingIndentPt(style)
  const hangUnits = paraUnitsOf(hangPt)

  let cursorPara = insertPara
  const expectedLines = []

  if (titled) {
    doc.applyStyle(sec, cursorPara, bodyStyleId)
    expectOk(doc.insertText(sec, cursorPara, 0, trimmedTitle), 'insertText')
    const titleLen = cpLength(trimmedTitle)
    if (titleLen > 0) {
      tryOr(
        () =>
          doc.applyCharFormat(
            sec,
            cursorPara,
            0,
            titleLen,
            JSON.stringify({ bold: true, fontSize: TITLE_FONT_SIZE }),
          ),
        null,
      )
    }
    tryOr(
      () =>
        doc.applyParaFormat(
          sec,
          cursorPara,
          JSON.stringify({
            alignment: 'left',
            marginLeft: 0,
            indent: 0,
            spacingBefore: 0,
            spacingAfter: TITLE_SPACING_AFTER,
            keepWithNext: true,
          }),
        ),
      null,
    )
    expectedLines.push(trimmedTitle)
    cursorPara += 1
  }

  for (const row of rows) {
    doc.applyStyle(sec, cursorPara, bodyStyleId)
    if (row.text.length > 0) {
      expectOk(doc.insertText(sec, cursorPara, 0, row.text), 'insertText')
    }
    tryOr(
      () =>
        doc.applyParaFormat(
          sec,
          cursorPara,
          JSON.stringify({
            alignment: 'left',
            marginLeft: 0,
            indent: -hangUnits,
            spacingBefore: 0,
            spacingAfter: 0,
            keepWithNext: false,
          }),
        ),
      null,
    )
    // Apply italic character runs for styled bibliography segments (journal titles, book titles).
    if (Array.isArray(row.segments)) {
      let cpPos = 0
      for (const seg of row.segments) {
        const segLen = cpLength(seg.text)
        if (seg.italic && segLen > 0) {
          tryOr(
            () =>
              doc.applyCharFormat(
                sec,
                cursorPara,
                cpPos,
                cpPos + segLen,
                JSON.stringify({ italic: true }),
              ),
            null,
          )
        }
        cpPos += segLen
      }
    }
    expectedLines.push(row.text)
    cursorPara += 1
  }

  const endPara = cursorPara - 1
  const endOffset = tryOr(() => doc.getParagraphLength(sec, endPara), 0)
  const rangeRes = addRangeMark(
    doc,
    MARK_PREFIXES.bibliography,
    '',
    { sec, para: insertPara, offset: 0 },
    { sec, para: endPara, offset: endOffset },
  )
  if (!rangeRes.ok) {
    return {
      ok: false,
      reason: 'engine_error',
      error: rangeRes.error ?? rangeRes.reason ?? 'addRangeMark failed',
    }
  }

  const keys = rows.map((r) => r.key)
  const bibSettingWrite = checkSettingWriteResult(
    writeDocSetting(doc, BIB_SETTING_KEY, {
      v: 1,
      title: titled ? trimmedTitle : null,
      style,
      keys,
      expectedLines,
      ...(includeAllLibrary ? { includeAllLibrary: true } : {}),
    }),
  )
  if (!bibSettingWrite.ok) return bibSettingWrite

  return {
    ok: true,
    count: rows.length,
    style,
    title: titled ? trimmedTitle : null,
    sec,
    startPara: insertPara,
    endPara,
    keys,
    expectedLines,
    range: {
      startName: rangeRes.startName,
      endName: rangeRes.endName,
      start: rangeRes.start,
      end: rangeRes.end,
    },
  }
}

/**
 * Insert a marked `참고문헌:` bibliography block into `doc` (or refresh in place if one
 * already exists). Refuses unverified cited entries, multi-section ranges, and unmarked
 * existing bibliographies unless `replaceLegacy: true`.
 */
export function insertBibliographyBlock(doc, entries, options = {}) {
  if (!doc || typeof doc.getSectionCount !== 'function') {
    return { ok: false, reason: 'unsupported_place' }
  }

  const style = options.style ?? getDocumentCitationStyle(doc)
  if (!isCitationStyle(style)) {
    return { ok: false, reason: 'invalid_style' }
  }

  const { ranges: existingRanges, broken: brokenBib } = findRangeMarks(doc, [
    MARK_PREFIXES.bibliography,
  ])
  if (existingRanges.length > 0) {
    const existing = existingRanges[0]
    if (existing.start.sec !== existing.end.sec) {
      return { ok: false, reason: 'multi_section_range', range: existing }
    }
    return refreshBibliographyBlock(doc, entries, { ...options, style })
  }

  // Check for an unmarked bibliography block unless caller already confirmed replacement.
  let legacy = null
  if (options.skipLegacyCheck !== true) {
    const detected = detectUnmarkedBibliography(doc)
    if (detected.found) {
      if (options.replaceLegacy !== true) {
        return { ok: false, reason: 'legacy_bibliography_found', legacy: detected }
      }
      legacy = detected
    }
  }

  // Validate insertion place if explicitly provided and not replacing a legacy bibliography.
  let targetSec
  let startPara
  let appendAtEnd = false
  let reuseFirst = false

  if (legacy) {
    targetSec = legacy.range.sec
    startPara = legacy.range.startPara
    reuseFirst = true
  } else if (options.place !== undefined && options.place !== null) {
    const place = options.place
    const resolved = resolveBodyPlace(doc, place)
    if (!resolved) {
      // Distinguish out-of-range body coordinates from non-body places.
      const sec = place.sec ?? place.sectionIndex
      const para = place.para ?? place.paraIndex ?? place.paragraphIndex
      const isNonBody =
        place.inTable ||
        place.inTextBox ||
        place.isTextBox ||
        place.inNote ||
        place.inFootnote ||
        place.inEndnote ||
        place.inHeaderFooter ||
        place.cellIndex != null ||
        (Array.isArray(place.path) && place.path.length > 0)
      if (!isNonBody && Number.isInteger(sec) && Number.isInteger(para)) {
        const secCount = doc.getSectionCount()
        if (sec >= 0 && sec < secCount && para === doc.getParagraphCount(sec)) {
          targetSec = sec
          startPara = para
          appendAtEnd = true
        } else {
          return { ok: false, reason: 'not_found' }
        }
      } else {
        return { ok: false, reason: 'unsupported_place' }
      }
    } else {
      targetSec = resolved.sec
      startPara = resolved.para
    }
  } else {
    targetSec = Math.max(0, doc.getSectionCount() - 1)
    startPara = doc.getParagraphCount(targetSec)
    appendAtEnd = true
  }

  const plan = buildBibliographyRenderPlan(doc, entries, style, options, null, null)
  if (!plan.ok) return plan

  if (legacy) {
    if (
      hasNonBookmarkObjectInRange(
        doc,
        legacy.range.sec,
        legacy.range.startPara,
        legacy.range.endPara,
      )
    ) {
      return { ok: false, reason: 'has_objects', range: legacy.range }
    }
  }

  if (brokenBib.length > 0) {
    const cleaned = cleanupBrokenMarks(doc, [MARK_PREFIXES.bibliography])
    if (Array.isArray(cleaned.failed) && cleaned.failed.length > 0) {
      return { ok: false, reason: 'mark_delete_failed', failed: cleaned.failed }
    }
    const delSet = checkSettingWriteResult(deleteDocSetting(doc, BIB_SETTING_KEY))
    if (!delSet.ok) return delSet
  }

  const syncRes = syncMarkedCitationsFormatting(doc, entries, style, {
    allowKeyOnlyFallback: style === 'ieee',
  })
  if (!syncRes.ok) return syncRes

  if (legacy) {
    const prep = prepareBibliographyReplaceSlot(
      doc,
      legacy.range.sec,
      legacy.range.startPara,
      legacy.range.endPara,
      [],
    )
    if (!prep.ok) return prep
  }

  const rawTitle = options.title === undefined ? DEFAULT_BIBLIOGRAPHY_TITLE : options.title
  const written = writeBibliographyIntoSlot(doc, {
    sec: targetSec,
    startPara,
    reuseFirst,
    appendAtEnd,
    title: rawTitle,
    style,
    rows: plan.rows,
    includeAllLibrary: options.includeAllLibrary === true,
  })
  if (!written.ok) return written

  return {
    ...written,
    preservedMissingKeys: plan.preservedMissingKeys,
    ...(syncRes.updated > 0 ? { updatedCitations: syncRes.updated } : {}),
    ...(syncRes.skippedManual.length > 0 ? { skippedManual: syncRes.skippedManual } : {}),
  }
}

/**
 * Refresh an existing marked `참고문헌:` bibliography block in place.
 * Preserves live text of lines for keys absent from `entries` in proper sort/number
 * position, syncs marked citations for disambiguation/short-titles/IEEE numbers, and
 * refuses unapproved manual edits, multi-section ranges, and ranges containing objects.
 */
export function refreshBibliographyBlock(doc, entries, options = {}) {
  if (!doc || typeof doc.getSectionCount !== 'function') {
    return { ok: false, reason: 'unsupported_place' }
  }

  const { ranges } = findRangeMarks(doc, [MARK_PREFIXES.bibliography])
  if (ranges.length === 0) {
    return { ok: false, reason: 'not_found' }
  }
  const range = ranges[0]
  if (range.start.sec !== range.end.sec || range.start.para > range.end.para) {
    return { ok: false, reason: 'multi_section_range', range }
  }

  const saved = readDocSetting(doc, BIB_SETTING_KEY, null)
  const style = options.style ?? getDocumentCitationStyle(doc)
  if (!isCitationStyle(style)) {
    return { ok: false, reason: 'invalid_style' }
  }

  if (options.allowOverwriteManual !== true) {
    const manual = detectBibliographyManualEdits(doc)
    if (manual.hasManualEdits) {
      return {
        ok: false,
        reason: 'manual_edits',
        modifiedLines: manual.modifiedLines,
        range,
      }
    }
  }

  if (hasNonBookmarkObjectInRange(doc, range.start.sec, range.start.para, range.end.para)) {
    return { ok: false, reason: 'has_objects', range }
  }

  const includeAllLibrary =
    options.includeAllLibrary !== undefined
      ? options.includeAllLibrary === true
      : saved?.includeAllLibrary === true

  const plan = buildBibliographyRenderPlan(
    doc,
    entries,
    style,
    { ...options, includeAllLibrary },
    saved,
    range,
  )
  if (!plan.ok) return plan

  // Clean up duplicate citation/bibliography marks before rewriting.
  const dedup = deduplicateMarks(doc, [MARK_PREFIXES.citation, MARK_PREFIXES.bibliography])
  if (Array.isArray(dedup.failed) && dedup.failed.length > 0) {
    return { ok: false, reason: 'mark_delete_failed', failed: dedup.failed }
  }

  let syncRes = { ok: true, updated: 0, skippedManual: [] }
  if (options.skipCitationSync !== true) {
    syncRes = syncMarkedCitationsFormatting(doc, entries, style, {
      allowKeyOnlyFallback: style === 'ieee',
    })
    if (!syncRes.ok) return syncRes
  }

  const freshRanges = findRangeMarks(doc, [MARK_PREFIXES.bibliography]).ranges
  if (freshRanges.length === 0) return { ok: false, reason: 'not_found' }
  const activeRange = freshRanges[0]

  const prep = prepareBibliographyReplaceSlot(
    doc,
    activeRange.start.sec,
    activeRange.start.para,
    activeRange.end.para,
    [activeRange.start, activeRange.end],
  )
  if (!prep.ok) return prep

  const title =
    options.title !== undefined
      ? options.title
      : saved && Object.prototype.hasOwnProperty.call(saved, 'title')
        ? saved.title
        : DEFAULT_BIBLIOGRAPHY_TITLE

  const written = writeBibliographyIntoSlot(doc, {
    sec: activeRange.start.sec,
    startPara: activeRange.start.para,
    reuseFirst: true,
    appendAtEnd: false,
    title,
    style,
    rows: plan.rows,
    includeAllLibrary,
  })
  if (!written.ok) return written

  return {
    ...written,
    refreshed: true,
    preservedMissingKeys: plan.preservedMissingKeys,
    ...(syncRes.updated > 0 ? { updatedCitations: syncRes.updated } : {}),
    ...(syncRes.skippedManual.length > 0 ? { skippedManual: syncRes.skippedManual } : {}),
  }
}

// ---------------------------------------------------------------------------
// 7. Citation style switching (`switchCitationStyle`)
// ---------------------------------------------------------------------------

/**
 * Switch the document citation style (`apa` | `chicago` | `mla` | `ieee`).
 * Rewrites all resolved, verified, non-manually-edited `인용:` marks and tracked
 * non-body citations in unified document order, skips manually edited citations and
 * reports them, updates `설정:인용꼴`, and refreshes any marked `참고문헌:` block
 * unless `options.refreshBibliography === false`.
 */
export function switchCitationStyle(doc, newStyle, entries, options = {}) {
  if (!isCitationStyle(newStyle)) {
    return { ok: false, reason: 'invalid_style' }
  }
  if (!doc || typeof doc.getSectionCount !== 'function') {
    return { ok: false, reason: 'unsupported_place' }
  }

  const entryList = Array.isArray(entries) ? entries : []
  const syncRes = syncMarkedCitationsFormatting(doc, entryList, newStyle, {
    updateMetaForAllEligible: true,
  })
  if (!syncRes.ok) return syncRes

  const styleRes = setDocumentCitationStyle(doc, newStyle)
  if (!styleRes.ok) return styleRes

  let bibliographyRefreshed = false
  let bibliographyResult = null
  const hasMarkedBib = findRangeMarks(doc, [MARK_PREFIXES.bibliography]).ranges.length > 0
  if (hasMarkedBib && options.refreshBibliography !== false) {
    bibliographyResult = refreshBibliographyBlock(doc, entryList, {
      style: newStyle,
      allowOverwriteManual: options.allowOverwriteManual === true,
      skipCitationSync: true,
    })
    bibliographyRefreshed = Boolean(bibliographyResult?.ok)
  }

  return {
    ok: true,
    style: newStyle,
    updatedCitations: syncRes.updated,
    skippedManual: syncRes.skippedManual,
    missingKeys: syncRes.missingKeys,
    unverifiedKeys: syncRes.unverifiedKeys,
    bibliographyRefreshed,
    bibliographyResult,
  }
}

// ---------------------------------------------------------------------------
// 8. Six read-only audit checks (`auditCitations`)
// ---------------------------------------------------------------------------

function identifyBibliographyLineKey(lineText, entries, savedMeta, lineIndex) {
  const cleanedLine = cleanText(lineText)
  if (!cleanedLine) return null

  // 1. Exact text match against saved expectedLines -> saved key.
  if (savedMeta && Array.isArray(savedMeta.keys) && Array.isArray(savedMeta.expectedLines)) {
    const titleOffset = typeof savedMeta.title === 'string' && savedMeta.title.length > 0 ? 1 : 0
    for (let i = 0; i < savedMeta.keys.length; i++) {
      const exp = cleanText(savedMeta.expectedLines[titleOffset + i] ?? '')
      if (exp && exp === cleanedLine) {
        const resolved = resolveEntryByKey(entries, savedMeta.keys[i])
        return resolved ? resolved.key : savedMeta.keys[i]
      }
    }
  }

  // 2. Match against library entries by title + author/year heuristics.
  const lowerLine = cleanedLine.toLowerCase()
  let bestKey = null
  let bestScore = 0
  for (const entry of entries) {
    if (!entry) continue
    let score = 0
    const title = cleanText(entry.title).toLowerCase()
    if (title && title.length >= 4 && lowerLine.includes(title)) {
      score += 4
    }
    const tokens = entryLeadAuthorTokens(entry)
    for (const tok of tokens) {
      if (tok && tok.length >= 2 && lowerLine.includes(tok)) {
        score += 2
        break
      }
    }
    if (entry.year) {
      const ym = FOUR_DIGIT_YEAR_SUFFIX_RE.exec(String(entry.year))
      if (ym && lowerLine.includes(ym[1])) score += 1
    }
    if (score >= 3 && score > bestScore) {
      bestScore = score
      bestKey = entry.key
    }
  }
  if (bestKey) return bestKey

  // 3. Fallback to saved key at the same index if line was lightly edited.
  if (savedMeta && Array.isArray(savedMeta.keys) && lineIndex < savedMeta.keys.length) {
    const rawKey = savedMeta.keys[lineIndex]
    const resolved = resolveEntryByKey(entries, rawKey)
    return resolved ? resolved.key : rawKey
  }
  return null
}

function readBibliographyLinesForAudit(doc, entries) {
  const markedRanges = findRangeMarks(doc, [MARK_PREFIXES.bibliography]).ranges
  if (markedRanges.length > 0 && markedRanges[0].start.sec === markedRanges[0].end.sec) {
    const range = markedRanges[0]
    const saved = readDocSetting(doc, BIB_SETTING_KEY, null)
    const hasTitle =
      saved && typeof saved.title === 'string' && saved.title.length > 0
        ? true
        : BIB_HEADING_RE.test(cleanText(bodyText(doc, range.start.sec, range.start.para)))
    const firstEntryPara = hasTitle ? range.start.para + 1 : range.start.para
    const lines = []
    for (let p = firstEntryPara; p <= range.end.para; p++) {
      const text = bodyText(doc, range.start.sec, p)
      if (!cleanText(text)) continue
      const idx = lines.length
      const key = identifyBibliographyLineKey(text, entries, saved, idx)
      lines.push({ sec: range.start.sec, para: p, text, key })
    }
    return { hasBibliography: true, marked: true, range, lines }
  }

  const unmarked = detectUnmarkedBibliography(doc)
  if (unmarked.found) {
    const lines = unmarked.lines.map((l, idx) => ({
      sec: l.sec,
      para: l.para,
      text: l.text,
      key: identifyBibliographyLineKey(l.text, entries, null, idx),
    }))
    return { hasBibliography: true, marked: false, range: unmarked.range, lines }
  }

  return { hasBibliography: false, marked: false, range: null, lines: [] }
}

/**
 * Run all six read-only citation & bibliography audit checks against `doc` and `entries`:
 * 1. `missing_from_bibliography`
 * 2. `uncited_in_bibliography`
 * 3. `wrong_sort_order`
 * 4. `missing_disambiguation`
 * 5. `manual_citation_edit`
 * 6. `unverified_citation`
 */
export function auditCitations(doc, entries = [], options = {}) {
  const style =
    options.style && isCitationStyle(options.style) ? options.style : getDocumentCitationStyle(doc)
  const entryList = Array.isArray(entries) ? entries : []

  const counts = {
    missing_from_bibliography: 0,
    uncited_in_bibliography: 0,
    wrong_sort_order: 0,
    missing_disambiguation: 0,
    manual_citation_edit: 0,
    unverified_citation: 0,
  }
  const issues = []
  const pushIssue = (issue) => {
    issues.push(issue)
    counts[issue.type] = (counts[issue.type] ?? 0) + 1
  }

  if (!doc || typeof doc.getSectionCount !== 'function') {
    return { ok: true, style, issues, counts }
  }

  const collected = collectDocumentCitationOrder(doc, entryList)
  const { marks, locatedUnmarkedRefs, modifiedUnmarkedRefs, patterns, citedKeysInOrder } = collected
  const bibInfo = readBibliographyLinesForAudit(doc, entryList)

  const bibKeySet = new Set(bibInfo.lines.map((l) => l.key).filter(Boolean))
  const citedKeySet = new Set(citedKeysInOrder)
  const expectedIeee = style === 'ieee' ? assignIeeeNumbers(citedKeysInOrder, entryList) : new Map()

  const firstCiteLocByKey = new Map()
  const recordFirstLoc = (key, loc) => {
    if (key && !firstCiteLocByKey.has(key)) {
      firstCiteLocByKey.set(key, loc)
    }
  }

  // Check 1 (missing_from_bibliography), Check 5 (manual_citation_edit), Check 6 (unverified_citation) on marks.
  for (const mark of marks) {
    const loc = {
      kind: 'body',
      sec: mark.sec,
      para: mark.para,
      offset: mark.startOffset,
      length: mark.length,
      text: mark.text,
    }
    if (mark.isManuallyEdited) {
      pushIssue({
        type: 'manual_citation_edit',
        ...loc,
        expectedText: mark.writtenText,
        id: mark.id,
        keys: mark.keys,
      })
    }

    for (const item of mark.items) {
      const resolved = resolveEntryByKey(entryList, item.key)
      const canonicalKey = resolved ? resolved.key : item.key
      recordFirstLoc(canonicalKey, loc)

      if (resolved && resolved.verified === false) {
        pushIssue({
          type: 'unverified_citation',
          ...loc,
          key: resolved.key,
          id: mark.id,
        })
      }

      if (!resolved || !bibInfo.hasBibliography || !bibKeySet.has(canonicalKey)) {
        pushIssue({
          type: 'missing_from_bibliography',
          ...loc,
          key: canonicalKey,
          inLibrary: Boolean(resolved),
          hasBibliography: bibInfo.hasBibliography,
        })
      }
    }
  }

  // Check tracked non-body citations (table cells, text boxes, footnotes, endnotes).
  for (const modRef of modifiedUnmarkedRefs) {
    const loc = {
      kind: modRef.kind,
      sec: modRef.sec,
      para: modRef.para,
      ...(modRef.path ? { path: modRef.path } : {}),
      ...(modRef.noteControl != null
        ? { noteControl: modRef.noteControl, notePara: modRef.notePara }
        : {}),
      offset: modRef.offset,
      length: modRef.length,
      text: modRef.text,
    }
    pushIssue({
      type: 'manual_citation_edit',
      reason: 'unmarked_manual_edit',
      ...loc,
      expectedText: modRef.writtenText,
      id: modRef.id,
      keys: modRef.keys,
    })
  }

  for (const ref of locatedUnmarkedRefs) {
    const loc = {
      kind: ref.kind,
      sec: ref.sec,
      para: ref.para,
      ...(ref.path ? { path: ref.path } : {}),
      ...(ref.noteControl != null ? { noteControl: ref.noteControl, notePara: ref.notePara } : {}),
      offset: ref.offset,
      length: ref.length,
      text: ref.text,
    }

    if (style === 'ieee') {
      const built = buildFormatItemsForCitation(ref.items, ref.mode, entryList, true)
      if (built.canFormat) {
        const expectedText = formatInTextCitation(built.formatItems, 'ieee', {
          mode: ref.mode,
          ieeeNumbers: expectedIeee,
        })
        if (expectedText !== ref.text) {
          pushIssue({
            type: 'manual_citation_edit',
            reason: 'ieee_number_mismatch',
            ...loc,
            expectedText,
            id: ref.id,
            key: ref.keys[0],
            keys: ref.keys,
          })
        }
      }
    }

    for (const item of ref.items) {
      const resolved = resolveEntryByKey(entryList, item.key)
      const canonicalKey = resolved ? resolved.key : item.key
      recordFirstLoc(canonicalKey, loc)

      if (resolved && resolved.verified === false) {
        pushIssue({
          type: 'unverified_citation',
          ...loc,
          key: resolved.key,
          id: ref.id,
        })
      }

      if (!resolved || !bibInfo.hasBibliography || !bibKeySet.has(canonicalKey)) {
        pushIssue({
          type: 'missing_from_bibliography',
          ...loc,
          key: canonicalKey,
          inLibrary: Boolean(resolved),
          hasBibliography: bibInfo.hasBibliography,
        })
      }
    }
  }

  // Check 1, Check 5 (IEEE style/number mismatches), & Check 6 on unmarked pattern citations across all scopes.
  for (const p of patterns) {
    const loc = {
      kind: p.kind,
      sec: p.sec,
      para: p.para,
      ...(p.path ? { path: p.path } : {}),
      ...(p.noteControl != null ? { noteControl: p.noteControl, notePara: p.notePara } : {}),
      offset: p.offset,
      length: p.length,
      text: p.text,
    }

    const matchedResolvedEntries = []
    let ieeeMismatchExpected = null

    for (const ref of p.parsedRefs) {
      const resolved = ref.matchedKey ? resolveEntryByKey(entryList, ref.matchedKey) : null
      if (resolved) {
        recordFirstLoc(resolved.key, loc)
        matchedResolvedEntries.push(resolved)
        if (resolved.verified === false) {
          pushIssue({
            type: 'unverified_citation',
            ...loc,
            key: resolved.key,
          })
        }
      }
      if (!resolved || !bibInfo.hasBibliography || !bibKeySet.has(resolved.key)) {
        pushIssue({
          type: 'missing_from_bibliography',
          ...loc,
          ...(resolved ? { key: resolved.key } : {}),
          inLibrary: Boolean(resolved),
          hasBibliography: bibInfo.hasBibliography,
        })
      }
      if (style === 'ieee' && p.patternKind === 'ieee' && resolved && ref.number != null) {
        const expNum = expectedIeee.get(resolved.key)
        if (expNum != null && expNum !== ref.number) {
          ieeeMismatchExpected = `[${expNum}]`
        }
      }
    }

    if (style === 'ieee' && matchedResolvedEntries.length > 0) {
      if (p.patternKind !== 'ieee') {
        const expectedText = formatInTextCitation(
          matchedResolvedEntries.map((entry) => ({ entry })),
          'ieee',
          { mode: 'parenthetical', ieeeNumbers: expectedIeee },
        )
        pushIssue({
          type: 'manual_citation_edit',
          reason: 'unmarked_style_mismatch',
          ...loc,
          expectedText,
          key: matchedResolvedEntries[0].key,
          keys: matchedResolvedEntries.map((e) => e.key),
        })
      } else if (ieeeMismatchExpected) {
        pushIssue({
          type: 'manual_citation_edit',
          reason: 'ieee_number_mismatch',
          ...loc,
          expectedText: ieeeMismatchExpected,
          key: matchedResolvedEntries[0].key,
          keys: matchedResolvedEntries.map((e) => e.key),
        })
      }
    }
  }

  // Flag untitled entries in the library (e.g. preserved by store normalization) with clickable location if cited.
  for (const entry of entryList) {
    if (!entry) continue
    if (typeof entry.title !== 'string' || entry.title.trim() === '') {
      const loc = firstCiteLocByKey.get(entry.key) ?? {
        kind: 'body',
        sec: 0,
        para: 0,
        offset: 0,
        length: 0,
        text: entry.key || '(Untitled)',
      }
      pushIssue({
        type: 'unverified_citation',
        reason: 'missing_title',
        missingTitle: true,
        ...loc,
        key: entry.key,
      })
    }
  }

  // Check 2 (uncited_in_bibliography).
  for (const line of bibInfo.lines) {
    if (!line.key || !citedKeySet.has(line.key)) {
      pushIssue({
        type: 'uncited_in_bibliography',
        kind: 'body',
        sec: line.sec,
        para: line.para,
        offset: 0,
        length: cpLength(line.text),
        text: line.text,
        ...(line.key ? { key: line.key } : {}),
      })
    }
  }

  // Check 3 (wrong_sort_order).
  const bibResolvedEntries = []
  const bibLineByKey = new Map()
  const actualBibKeys = []
  for (const line of bibInfo.lines) {
    if (!line.key) continue
    const resolved = resolveEntryByKey(entryList, line.key)
    if (!resolved) continue
    actualBibKeys.push(resolved.key)
    if (!bibLineByKey.has(resolved.key)) {
      bibLineByKey.set(resolved.key, line)
      bibResolvedEntries.push(resolved)
    }
  }
  if (actualBibKeys.length >= 2) {
    const expectedEntries = sortBibliographyEntries(bibResolvedEntries, style, {
      citedKeysInOrder,
    })
    const expectedKeys = expectedEntries.map((e) => e.key)
    const comparison = compareSortOrder(actualBibKeys, expectedKeys)
    if (!comparison.inOrder) {
      for (const mismatch of comparison.mismatches) {
        const line = bibLineByKey.get(mismatch.key)
        pushIssue({
          type: 'wrong_sort_order',
          kind: 'body',
          sec: line ? line.sec : 0,
          para: line ? line.para : 0,
          offset: 0,
          length: line ? cpLength(line.text) : 0,
          text: line ? line.text : '',
          key: mismatch.key,
          actualIndex: mismatch.actualIndex,
          expectedIndex: mismatch.expectedIndex,
        })
      }
    }
  }

  // Check 4 (missing_disambiguation).
  if (style !== 'ieee') {
    const relevantEntryMap = new Map()
    for (const e of bibResolvedEntries) relevantEntryMap.set(e.key, e)
    for (const k of citedKeySet) {
      const resolved = resolveEntryByKey(entryList, k)
      if (resolved) relevantEntryMap.set(resolved.key, resolved)
    }
    const relevantEntries = [...relevantEntryMap.values()]
    const seenDisambigLoc = new Set()

    // Check bibliography lines.
    if (bibLineByKey.size > 0) {
      const bibTextMap = new Map()
      for (const [k, line] of bibLineByKey.entries()) {
        bibTextMap.set(k, line.text)
      }
      const bibMissing = findMissingDisambiguation(relevantEntries, bibTextMap, style)
      for (const miss of bibMissing) {
        const line = bibLineByKey.get(miss.key)
        if (!line) continue
        const dedupKey = `bib:${miss.key}:${line.sec}:${line.para}`
        if (seenDisambigLoc.has(dedupKey)) continue
        seenDisambigLoc.add(dedupKey)
        pushIssue({
          type: 'missing_disambiguation',
          kind: 'body',
          sec: line.sec,
          para: line.para,
          offset: 0,
          length: cpLength(line.text),
          text: line.text,
          key: miss.key,
          expectedSuffix: miss.expectedSuffix,
          expectedToken: miss.expectedToken,
        })
      }
    }

    // Check marked citations, tracked non-body citations, and matched pattern citations.
    for (const mark of marks) {
      const renderedMap = new Map()
      for (const k of mark.keys) renderedMap.set(k, mark.text)
      const markMissing = findMissingDisambiguation(relevantEntries, renderedMap, style)
      for (const miss of markMissing) {
        const dedupKey = `mark:${miss.key}:${mark.sec}:${mark.para}:${mark.startOffset}`
        if (seenDisambigLoc.has(dedupKey)) continue
        seenDisambigLoc.add(dedupKey)
        pushIssue({
          type: 'missing_disambiguation',
          kind: 'body',
          sec: mark.sec,
          para: mark.para,
          offset: mark.startOffset,
          length: mark.length,
          text: mark.text,
          key: miss.key,
          expectedSuffix: miss.expectedSuffix,
          expectedToken: miss.expectedToken,
        })
      }
    }

    for (const ref of locatedUnmarkedRefs) {
      const renderedMap = new Map()
      for (const k of ref.keys) renderedMap.set(k, ref.text)
      const refMissing = findMissingDisambiguation(relevantEntries, renderedMap, style)
      for (const miss of refMissing) {
        const dedupKey = `uref:${miss.key}:${ref.id}`
        if (seenDisambigLoc.has(dedupKey)) continue
        seenDisambigLoc.add(dedupKey)
        pushIssue({
          type: 'missing_disambiguation',
          kind: ref.kind,
          sec: ref.sec,
          para: ref.para,
          ...(ref.path ? { path: ref.path } : {}),
          ...(ref.noteControl != null
            ? { noteControl: ref.noteControl, notePara: ref.notePara }
            : {}),
          offset: ref.offset,
          length: ref.length,
          text: ref.text,
          key: miss.key,
          expectedSuffix: miss.expectedSuffix,
          expectedToken: miss.expectedToken,
        })
      }
    }

    for (const p of patterns) {
      const renderedMap = new Map()
      for (const ref of p.parsedRefs) {
        if (ref.matchedKey) renderedMap.set(ref.matchedKey, p.text)
      }
      if (renderedMap.size === 0) continue
      const patMissing = findMissingDisambiguation(relevantEntries, renderedMap, style)
      for (const miss of patMissing) {
        const dedupKey = `pat:${miss.key}:${p.kind}:${p.sec}:${p.para}:${p.offset}`
        if (seenDisambigLoc.has(dedupKey)) continue
        seenDisambigLoc.add(dedupKey)
        pushIssue({
          type: 'missing_disambiguation',
          kind: p.kind,
          sec: p.sec,
          para: p.para,
          ...(p.path ? { path: p.path } : {}),
          ...(p.noteControl != null ? { noteControl: p.noteControl, notePara: p.notePara } : {}),
          offset: p.offset,
          length: p.length,
          text: p.text,
          key: miss.key,
          expectedSuffix: miss.expectedSuffix,
          expectedToken: miss.expectedToken,
        })
      }
    }
  }

  return {
    ok: true,
    style,
    issues,
    counts,
  }
}

// ---------------------------------------------------------------------------
// 9. Read-only bibliography & IEEE staleness check (`checkBibliographyStaleness`)
// ---------------------------------------------------------------------------

function areArraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function areSetsEqual(a, b) {
  const sa = new Set(a)
  const sb = new Set(b)
  if (sa.size !== sb.size) return false
  for (const item of sa) {
    if (!sb.has(item)) return false
  }
  return true
}

/**
 * Read-only staleness check for the staleness registry.
 * Detects out-of-order IEEE citation numbers across body marks, tracked non-body citations,
 * and pattern citations even without library entries, and detects stale `참고문헌:` blocks
 * when cited keys, active style, manual edits, or formatted bibliography lines have diverged.
 */
export function checkBibliographyStaleness(doc, options = {}) {
  if (!doc || typeof doc.getSectionCount !== 'function') {
    return { stale: false, hasBibliography: false, ieeeOutOfOrder: false }
  }

  const entries = Array.isArray(options?.bibEntries)
    ? options.bibEntries
    : Array.isArray(options?.entries)
      ? options.entries
      : null
  const hasEntries = Array.isArray(entries) && entries.length > 0
  const style = getDocumentCitationStyle(doc)
  const collected = collectDocumentCitationOrder(doc, hasEntries ? entries : null)
  const { marks, locatedUnmarkedRefs, patterns, citedKeysInOrder } = collected

  // 1. Check unified IEEE numbering order across body marks, tracked non-body citations, and IEEE pattern citations.
  let ieeeOutOfOrder = false
  if (style === 'ieee' && citedKeysInOrder.length > 0) {
    const expectedIeee = assignIeeeNumbers(citedKeysInOrder, hasEntries ? entries : undefined)

    for (const m of marks) {
      if (m.isManuallyEdited || m.items.length === 0) continue
      const built = buildFormatItemsForCitation(m.items, m.mode, hasEntries ? entries : [], true)
      if (!built.canFormat) continue
      const expectedText = formatInTextCitation(built.formatItems, 'ieee', {
        mode: m.mode,
        ieeeNumbers: expectedIeee,
      })
      if (expectedText !== m.text) {
        ieeeOutOfOrder = true
        break
      }
    }

    if (!ieeeOutOfOrder) {
      for (const ref of locatedUnmarkedRefs) {
        if (ref.items.length === 0) continue
        const built = buildFormatItemsForCitation(
          ref.items,
          ref.mode,
          hasEntries ? entries : [],
          true,
        )
        if (!built.canFormat) continue
        const expectedText = formatInTextCitation(built.formatItems, 'ieee', {
          mode: ref.mode,
          ieeeNumbers: expectedIeee,
        })
        if (expectedText !== ref.text) {
          ieeeOutOfOrder = true
          break
        }
      }
    }

    if (!ieeeOutOfOrder) {
      for (const p of patterns) {
        if (p.patternKind !== 'ieee') continue
        for (const ref of p.parsedRefs) {
          if (ref.matchedKey && ref.number != null) {
            const expNum = expectedIeee.get(ref.matchedKey)
            if (expNum != null && expNum !== ref.number) {
              ieeeOutOfOrder = true
              break
            }
          }
        }
        if (ieeeOutOfOrder) break
      }
    }
  }

  // 2. Check marked `참고문헌:` block staleness.
  const { ranges } = findRangeMarks(doc, [MARK_PREFIXES.bibliography])
  const bibRange = ranges.length > 0 && ranges[0].start.sec === ranges[0].end.sec ? ranges[0] : null

  if (!bibRange) {
    if (ieeeOutOfOrder) {
      return {
        stale: true,
        reason: 'ieee_order_changed',
        hasBibliography: false,
        ieeeOutOfOrder: true,
      }
    }
    return { stale: false, hasBibliography: false, ieeeOutOfOrder: false }
  }

  const saved = readDocSetting(doc, BIB_SETTING_KEY, null)
  if (!saved || typeof saved !== 'object' || !Array.isArray(saved.expectedLines)) {
    return {
      stale: true,
      reason: ieeeOutOfOrder ? 'ieee_order_changed' : 'entries_changed',
      hasBibliography: true,
      ieeeOutOfOrder,
    }
  }

  if (saved.style && saved.style !== style) {
    return {
      stale: true,
      reason: 'style_changed',
      hasBibliography: true,
      ieeeOutOfOrder,
    }
  }

  // Read actual lines currently inside the bibliography range.
  const actualLines = []
  for (let p = bibRange.start.para; p <= bibRange.end.para; p++) {
    actualLines.push(bodyText(doc, bibRange.start.sec, p))
  }

  if (hasEntries) {
    const plan = buildBibliographyRenderPlan(
      doc,
      entries,
      style,
      { includeAllLibrary: saved.includeAllLibrary === true },
      saved,
      bibRange,
    )
    if (plan.ok) {
      const expectedLines = []
      if (typeof saved.title === 'string' && saved.title.length > 0) {
        expectedLines.push(saved.title)
      }
      for (const row of plan.rows) expectedLines.push(row.text)

      const linesMatch = areArraysEqual(actualLines, expectedLines)
      if (!linesMatch || ieeeOutOfOrder) {
        const expectedKeys = plan.rows.map((r) => r.key)
        const savedKeys = Array.isArray(saved.keys) ? saved.keys : []
        const isOrderOnly =
          style === 'ieee' &&
          (ieeeOutOfOrder ||
            (areSetsEqual(savedKeys, expectedKeys) && !areArraysEqual(savedKeys, expectedKeys)))
        return {
          stale: true,
          reason: isOrderOnly ? 'ieee_order_changed' : 'entries_changed',
          hasBibliography: true,
          ieeeOutOfOrder,
        }
      }
      return { stale: false, hasBibliography: true, ieeeOutOfOrder: false }
    }
  }

  // Without library entries, compare unified cited keys & order + saved snapshot lines.
  const savedKeys = Array.isArray(saved.keys) ? saved.keys : []
  const uniqueCitedKeys = []
  for (const k of citedKeysInOrder) {
    if (!uniqueCitedKeys.includes(k)) uniqueCitedKeys.push(k)
  }

  if (!areArraysEqual(actualLines, saved.expectedLines)) {
    return {
      stale: true,
      reason: ieeeOutOfOrder ? 'ieee_order_changed' : 'entries_changed',
      hasBibliography: true,
      ieeeOutOfOrder,
    }
  }

  if (saved.includeAllLibrary !== true && uniqueCitedKeys.length > 0) {
    if (style === 'ieee') {
      if (!areArraysEqual(uniqueCitedKeys, savedKeys)) {
        return {
          stale: true,
          reason: areSetsEqual(uniqueCitedKeys, savedKeys)
            ? 'ieee_order_changed'
            : 'entries_changed',
          hasBibliography: true,
          ieeeOutOfOrder,
        }
      }
    } else if (!areSetsEqual(uniqueCitedKeys, savedKeys)) {
      return {
        stale: true,
        reason: 'entries_changed',
        hasBibliography: true,
        ieeeOutOfOrder,
      }
    }
  }

  if (ieeeOutOfOrder) {
    return {
      stale: true,
      reason: 'ieee_order_changed',
      hasBibliography: true,
      ieeeOutOfOrder: true,
    }
  }

  return { stale: false, hasBibliography: true, ieeeOutOfOrder: false }
}
