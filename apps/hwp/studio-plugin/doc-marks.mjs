/**
 * Document-internal marks stored as HWP/HWPX bookmarks for app features
 * (table of contents, heading anchors, index marks, citations, bibliography,
 * and per-document settings).
 *
 * Every bookmark name written by this module uses one of the seven reserved
 * Korean prefixes and stays within `MAX_MARK_NAME_LEN` (64 UTF-16 code units),
 * splitting longer payloads across deterministic sequential chunk bookmarks.
 */

export const MARK_PREFIXES = Object.freeze({
  toc: '차례:',
  heading: '제목:',
  index: '색인:',
  indexBlock: '색인블록:',
  citation: '인용:',
  bibliography: '참고문헌:',
  setting: '설정:',
})

export const APP_MARK_PREFIXES = Object.freeze(Object.values(MARK_PREFIXES))

/** Prefixes removed when creating a clean submission copy (preserves TOC and headings). */
export const SUBMISSION_STRIP_PREFIXES = Object.freeze([
  MARK_PREFIXES.index,
  MARK_PREFIXES.indexBlock,
  MARK_PREFIXES.citation,
  MARK_PREFIXES.bibliography,
  MARK_PREFIXES.setting,
])

export const MAX_MARK_NAME_LEN = 64
export const RANGE_START = '시작'
export const RANGE_END = '끝'

const CHUNK_TAG = '%c'
const CHUNK_PATTERN = /^%c:([0-9a-zA-Z_-]+):(\d+)\/(\d+):([\s\S]*)$/

function parseJson(raw, fallback) {
  if (typeof raw !== 'string' || raw.length === 0) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

/** Return the reserved app-mark prefix matching `name`, or `null` if none matches. */
export function markPrefixOf(name) {
  if (typeof name !== 'string' || name.length === 0) return null
  for (const prefix of APP_MARK_PREFIXES) {
    if (name.startsWith(prefix)) return prefix
  }
  return null
}

/** Whether `name` begins with any of the seven app-owned mark prefixes. */
export function isAppMarkName(name) {
  return markPrefixOf(name) !== null
}

/** Extract the unescaped destination before the first unescaped `;` of a HWP hyperlink command. */
function unescapeHyperlinkTarget(command) {
  if (typeof command !== 'string' || command.length === 0) return ''
  let out = ''
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (ch === '\\' && i + 1 < command.length) {
      out += command[i + 1]
      i += 1
      continue
    }
    if (ch === ';') break
    out += ch
  }
  return out
}

/**
 * Whether a field entry from `doc.getFieldList()` is an app-owned TOC hyperlink
 * targeting a `제목:` heading bookmark (inserted via `bookmark: '제목:...'` or `uri: '#제목:...'`).
 */
export function isAppTocHyperlinkField(field) {
  if (!field || field.fieldType !== 'hyperlink') return false
  const target = unescapeHyperlinkTarget(field.command)
  if (target.startsWith('?') || target.startsWith('#')) {
    return target.slice(1).startsWith(MARK_PREFIXES.heading)
  }
  return false
}

/** Escape characters reserved by mark syntax (`%`, `:`, CR, LF) while keeping text readable. */
export function encodeMarkField(value) {
  return String(value)
    .replace(/%/g, '%25')
    .replace(/:/g, '%3A')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
}

const FIELD_DECODE_MAP = Object.freeze({
  25: '%',
  '3a': ':',
  '0d': '\r',
  '0a': '\n',
})

/** Reverse `encodeMarkField` in a single pass so double-escaping never corrupts data. */
export function decodeMarkField(value) {
  return String(value).replace(/%(25|3A|0D|0A)/gi, (_, hex) => FIELD_DECODE_MAP[hex.toLowerCase()])
}

function encodeSettingKey(key) {
  return String(key).replace(/%/g, '%25').replace(/=/g, '%3D')
}

function decodeSettingKey(encoded) {
  return String(encoded).replace(/%(25|3D)/gi, (_, hex) => (hex.toLowerCase() === '25' ? '%' : '='))
}

function isHighSurrogate(code) {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code) {
  return code >= 0xdc00 && code <= 0xdfff
}

/** Truncate `str` to at most `limit` UTF-16 code units without splitting surrogates or escapes. */
function safeTruncate(str, limit) {
  if (limit <= 0) return ''
  if (str.length <= limit) return str
  let end = limit
  if (end > 0 && isHighSurrogate(str.charCodeAt(end - 1)) && isLowSurrogate(str.charCodeAt(end))) {
    end -= 1
  }
  // avoid leaving a broken `%` or `%X` percent-escape at the cut boundary
  if (end > 0 && str[end - 1] === '%') {
    end -= 1
  } else if (end > 1 && str[end - 2] === '%' && /[0-9a-fA-F]/.test(str[end - 1])) {
    end -= 2
  }
  return str.slice(0, Math.max(0, end))
}

/** Compute a short deterministic base36 hash (6 chars) for chunk grouping. */
function shortHash(text) {
  let h1 = 0x811c9dc5
  let h2 = 0x9e3779b1
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0
  }
  const combined = ((BigInt(h1) << 32n) | BigInt(h2)).toString(36)
  return combined.slice(0, 6).padStart(6, '0')
}

function assertValidPrefix(prefix) {
  if (!APP_MARK_PREFIXES.includes(prefix)) {
    throw new RangeError(`Unsupported app mark prefix: ${String(prefix)}`)
  }
}

/**
 * Encode a prefix and one or more structured fields into a single human-readable bookmark name.
 * Callers writing payloads that may exceed `MAX_MARK_NAME_LEN` should use `encodeMarkChunks`.
 */
export function encodeMarkName(prefix, fields) {
  assertValidPrefix(prefix)
  const parts = Array.isArray(fields) ? fields : [fields]
  return `${prefix}${parts.map(encodeMarkField).join(':')}`
}

/**
 * Decode a single app-mark bookmark name into its prefix and decoded fields,
 * or chunk metadata when the bookmark is part of a multi-bookmark chunk set.
 */
export function decodeMarkName(name) {
  const prefix = markPrefixOf(name)
  if (!prefix) return null
  const rest = name.slice(prefix.length)
  if (rest.startsWith(`${CHUNK_TAG}:`)) {
    const match = CHUNK_PATTERN.exec(rest)
    if (match) {
      const index = Number(match[2])
      const total = Number(match[3])
      if (Number.isInteger(index) && Number.isInteger(total) && index >= 1 && index <= total) {
        return {
          prefix,
          isChunk: true,
          chunkId: match[1],
          index,
          total,
          slice: match[4],
          parts: [],
        }
      }
    }
  }
  const parts = rest.length === 0 ? [] : rest.split(':').map(decodeMarkField)
  return {
    prefix,
    parts,
    isChunk: false,
  }
}

function splitUtf16Safe(body, maxSliceLen) {
  const slices = []
  let pos = 0
  while (pos < body.length) {
    let end = Math.min(body.length, pos + maxSliceLen)
    if (
      end < body.length &&
      end > pos &&
      isHighSurrogate(body.charCodeAt(end - 1)) &&
      isLowSurrogate(body.charCodeAt(end))
    ) {
      end -= 1
    }
    if (end <= pos) {
      throw new RangeError('maxLen is too small to fit a single character in a chunk')
    }
    slices.push(body.slice(pos, end))
    pos = end
  }
  return slices
}

/**
 * Encode a prefix and payload into one bookmark name when it fits within `maxLen`,
 * or multiple sequential chunk bookmark names (each strictly `<= maxLen`).
 */
export function encodeMarkChunks(prefix, payload, options = {}) {
  assertValidPrefix(prefix)
  const maxLen = options.maxLen ?? MAX_MARK_NAME_LEN
  const single = encodeMarkName(prefix, payload)
  if (single.length <= maxLen) return [single]

  const body = single.slice(prefix.length)
  const existing =
    options.existingNames instanceof Set
      ? options.existingNames
      : options.existingNames
        ? new Set(options.existingNames)
        : null

  let baseId =
    typeof options.chunkId === 'string' && options.chunkId.length > 0
      ? options.chunkId.replace(/[^0-9a-zA-Z_-]/g, '').slice(0, 8)
      : shortHash(`${prefix}\0${body}`)
  if (!baseId) baseId = shortHash(`${prefix}\0${body}`)

  let chunkId = baseId
  if (existing) {
    let salt = 1
    while ([...existing].some((n) => n.startsWith(`${prefix}${CHUNK_TAG}:${chunkId}:`))) {
      salt += 1
      chunkId = shortHash(`${prefix}\0${body}\0${salt}`)
    }
  }

  let totalDigits = 1
  for (let pass = 0; pass < 6; pass++) {
    // Worst-case header: `${prefix}%c:${chunkId}:${index}/${total}:` where index and total have `totalDigits`
    const worstHeaderLen =
      prefix.length + CHUNK_TAG.length + 1 + chunkId.length + 1 + totalDigits + 1 + totalDigits + 1
    const sliceCap = maxLen - worstHeaderLen
    if (sliceCap < 2) {
      throw new RangeError(`maxLen (${maxLen}) is too small for chunked mark encoding`)
    }
    const slices = splitUtf16Safe(body, sliceCap)
    const neededDigits = String(slices.length).length
    if (neededDigits <= totalDigits) {
      const total = slices.length
      return slices.map(
        (slice, idx) => `${prefix}${CHUNK_TAG}:${chunkId}:${idx + 1}/${total}:${slice}`,
      )
    }
    totalDigits = neededDigits
  }
  throw new RangeError('Failed to fit payload into bounded mark chunks')
}

/**
 * Decode a sequence of bookmark names or normalized mark objects, reassembling
 * multi-bookmark chunk sets transparently and reporting any incomplete chunk sets.
 */
export function decodeMarkChunks(items) {
  const entries = []
  const incomplete = []
  const openGroups = new Map()
  const slots = []

  const closeGroup = (groupKey) => {
    const group = openGroups.get(groupKey)
    if (!group) return
    openGroups.delete(groupKey)
    if (group.chunks.size === group.total) {
      let body = ''
      for (let i = 1; i <= group.total; i++) {
        body += group.chunks.get(i)
      }
      const parts = body.length === 0 ? [] : body.split(':').map(decodeMarkField)
      group.slot.resolved = {
        prefix: group.prefix,
        parts,
        raw: body,
        isChunked: true,
        chunkId: group.chunkId,
        chunkCount: group.total,
        names: group.names,
        marks: group.marks,
      }
    } else {
      group.slot.incomplete = {
        prefix: group.prefix,
        chunkId: group.chunkId,
        total: group.total,
        received: [...group.chunks.keys()].sort((a, b) => a - b),
        names: group.names,
        marks: group.marks,
      }
    }
  }

  for (const item of items) {
    const isString = typeof item === 'string'
    const name = isString ? item : item?.name
    const mark = isString ? null : item
    const decoded = decodeMarkName(name)
    if (!decoded) continue

    if (!decoded.isChunk) {
      slots.push({
        resolved: {
          prefix: decoded.prefix,
          parts: decoded.parts,
          raw: name.slice(decoded.prefix.length),
          isChunked: false,
          names: [name],
          marks: mark ? [mark] : [],
        },
      })
      continue
    }

    const groupKey = `${decoded.prefix}\0${decoded.chunkId}\0${decoded.total}`
    let group = openGroups.get(groupKey)
    if (group && group.chunks.has(decoded.index)) {
      closeGroup(groupKey)
      group = null
    }
    if (!group) {
      const slot = {}
      slots.push(slot)
      group = {
        prefix: decoded.prefix,
        chunkId: decoded.chunkId,
        total: decoded.total,
        chunks: new Map(),
        names: [],
        marks: [],
        slot,
      }
      openGroups.set(groupKey, group)
    }
    group.chunks.set(decoded.index, decoded.slice)
    group.names.push(name)
    if (mark) group.marks.push(mark)
    if (group.chunks.size === group.total) {
      closeGroup(groupKey)
    }
  }

  for (const key of [...openGroups.keys()]) {
    closeGroup(key)
  }

  for (const slot of slots) {
    if (slot.resolved) entries.push(slot.resolved)
    else if (slot.incomplete) incomplete.push(slot.incomplete)
  }

  return { entries, incomplete }
}

/**
 * Return `baseName` when unused and within `maxLen`; otherwise append `:2`, `:3`, ...
 * truncating the variable middle while preserving the app prefix so length stays `<= maxLen`.
 */
export function uniqueMarkName(existingNames, baseName, maxLen = MAX_MARK_NAME_LEN) {
  const used = existingNames instanceof Set ? existingNames : new Set(existingNames)
  if (baseName.length <= maxLen && !used.has(baseName)) return baseName

  const prefix = markPrefixOf(baseName) ?? ''
  const rest = baseName.slice(prefix.length)

  if (baseName.length > maxLen) {
    const trimmed = prefix + safeTruncate(rest, Math.max(0, maxLen - prefix.length))
    if (trimmed.length > 0 && trimmed.length <= maxLen && !used.has(trimmed)) {
      return trimmed
    }
  }

  for (let n = 2; ; n++) {
    const suffix = `:${n}`
    const avail = maxLen - prefix.length - suffix.length
    if (avail < 0) {
      if (suffix.length > maxLen) {
        throw new RangeError(`maxLen (${maxLen}) cannot fit numeric suffix ${suffix}`)
      }
      const fallback = safeTruncate(baseName, maxLen - suffix.length) + suffix
      if (!used.has(fallback)) return fallback
      continue
    }
    const candidate = `${prefix}${safeTruncate(rest, avail)}${suffix}`
    if (!used.has(candidate)) return candidate
  }
}

function normalizePrefixes(prefixes) {
  if (prefixes == null) return APP_MARK_PREFIXES
  if (typeof prefixes === 'string') return [prefixes]
  return [...prefixes]
}

function compareMarks(a, b) {
  if (a.sec !== b.sec) return a.sec - b.sec
  if (a.para !== b.para) return a.para - b.para
  if (a.offset !== b.offset) return a.offset - b.offset
  return a.ctrlIdx - b.ctrlIdx
}

function compareReverseControlOrder(a, b) {
  if (a.sec !== b.sec) return b.sec - a.sec
  if (a.para !== b.para) return b.para - a.para
  return b.ctrlIdx - a.ctrlIdx
}

function flatBodyParaIndex(doc, sec, para) {
  let flat = para
  for (let s = 0; s < sec; s++) {
    flat += doc.getParagraphCount(s)
  }
  return flat
}

/**
 * Index body-level bookmark controls (`list === 0 && ctrlId === 'bokm'`) by `${flatPara}:${ctrlIdx}`.
 * Returns `null` when the engine/mock does not expose `getControls()`.
 */
function bodyBookmarkControlMap(doc) {
  if (!doc || typeof doc.getControls !== 'function') return null
  let raw
  try {
    raw = parseJson(doc.getControls(), null)
  } catch {
    return null
  }
  if (!Array.isArray(raw)) return null
  const map = new Map()
  for (const ctrl of raw) {
    if (!ctrl || ctrl.list !== 0 || ctrl.ctrlId !== 'bokm') continue
    if (!Number.isInteger(ctrl.para) || !Number.isInteger(ctrl.controlIndex)) continue
    map.set(`${ctrl.para}:${ctrl.controlIndex}`, ctrl)
  }
  return map
}

function charIndexOfBodyControl(doc, flatPara, pos) {
  if (!Number.isInteger(pos) || typeof doc.getCharIndexAtStreamPos !== 'function') return null
  try {
    const parsed = parseJson(doc.getCharIndexAtStreamPos(0, flatPara, pos), null)
    return parsed && Number.isInteger(parsed.charIndex) ? parsed.charIndex : null
  } catch {
    return null
  }
}

function isVerifiedBodyBookmark(doc, flatPara, ctrlIdx) {
  const map = bodyBookmarkControlMap(doc)
  if (!map) return true
  return map.has(`${flatPara}:${ctrlIdx}`)
}

/**
 * Delete a single body bookmark safely: tries `doc.deleteBookmark`, and if the engine
 * rejects it (e.g. when a hyperlink, click-here field, auto-number, or TOC link precedes
 * the bookmark in the same paragraph), falls back to `doc.deleteControlAt(0, flatPara, ctrlIdx)`
 * after verifying the target slot is indeed a body `bokm` control. Never throws.
 */
function deleteBookmarkEntry(doc, bm) {
  const secCount = typeof doc.getSectionCount === 'function' ? doc.getSectionCount() : 0
  if (
    !Number.isInteger(bm.sec) ||
    !Number.isInteger(bm.para) ||
    !Number.isInteger(bm.ctrlIdx) ||
    bm.sec < 0 ||
    bm.sec >= secCount ||
    bm.para < 0 ||
    bm.para >= doc.getParagraphCount(bm.sec)
  ) {
    return { ok: false, error: 'bookmark coordinates out of range' }
  }

  const flatPara = flatBodyParaIndex(doc, bm.sec, bm.para)
  if (!isVerifiedBodyBookmark(doc, flatPara, bm.ctrlIdx)) {
    return { ok: false, error: 'not a body bookmark control' }
  }

  let primaryError = 'deleteBookmark failed'
  if (typeof doc.deleteBookmark === 'function') {
    try {
      const res = parseJson(doc.deleteBookmark(bm.sec, bm.para, bm.ctrlIdx), null)
      if (res && res.ok === true) return { ok: true }
      if (res && typeof res.error === 'string' && res.error) primaryError = res.error
    } catch (err) {
      primaryError = err instanceof Error ? err.message : String(err)
    }
  }

  if (typeof doc.deleteControlAt === 'function') {
    try {
      const res = parseJson(doc.deleteControlAt(0, flatPara, bm.ctrlIdx), null)
      if (res && res.ok === true) return { ok: true }
      return { ok: false, error: res?.error ?? primaryError }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  return { ok: false, error: primaryError }
}

function renameBookmarkEntry(doc, bm, newName) {
  if (typeof doc.renameBookmark !== 'function') {
    return { ok: false, error: 'renameBookmark unavailable' }
  }
  const flatPara = flatBodyParaIndex(doc, bm.sec, bm.para)
  if (!isVerifiedBodyBookmark(doc, flatPara, bm.ctrlIdx)) {
    return { ok: false, error: 'not a body bookmark control' }
  }
  try {
    const res = parseJson(doc.renameBookmark(bm.sec, bm.para, bm.ctrlIdx, newName), null)
    if (res && res.ok === true) return { ok: true }
    return { ok: false, error: res?.error ?? 'renameBookmark failed' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Read bookmarks belonging strictly to body paragraphs (`list === 0`).
 * Bookmarks inside table cells or headers/footers are reported by `doc.getBookmarks()`
 * with outer paragraph coordinates and inner control indices; filtering against
 * `doc.getControls()` (`list === 0 && ctrlId === 'bokm'`) ensures they are never
 * mistaken for outer body controls.
 */
function readRawBookmarks(doc) {
  if (!doc || typeof doc.getBookmarks !== 'function') return []
  let raw
  try {
    raw = parseJson(doc.getBookmarks(), [])
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []

  const parsed = raw
    .filter((bm) => bm && typeof bm.name === 'string')
    .map((bm) => ({
      name: bm.name,
      prefix: markPrefixOf(bm.name),
      sec: bm.sec ?? bm.sectionIndex ?? 0,
      para: bm.para ?? bm.paraIndex ?? 0,
      offset: bm.charPos ?? bm.charOffset ?? bm.offset ?? 0,
      ctrlIdx: bm.ctrlIdx ?? bm.controlIndex ?? 0,
    }))

  const bodyControls = bodyBookmarkControlMap(doc)
  if (!bodyControls) {
    return parsed.sort(compareMarks)
  }

  const secCount = typeof doc.getSectionCount === 'function' ? doc.getSectionCount() : 0
  const bySlot = new Map()
  for (const bm of parsed) {
    if (
      !Number.isInteger(bm.sec) ||
      !Number.isInteger(bm.para) ||
      !Number.isInteger(bm.ctrlIdx) ||
      bm.sec < 0 ||
      bm.sec >= secCount ||
      bm.para < 0 ||
      bm.para >= doc.getParagraphCount(bm.sec)
    ) {
      continue
    }
    const flatPara = flatBodyParaIndex(doc, bm.sec, bm.para)
    const slotKey = `${flatPara}:${bm.ctrlIdx}`
    const ctrl = bodyControls.get(slotKey)
    if (!ctrl) continue
    let bucket = bySlot.get(slotKey)
    if (!bucket) {
      bucket = { flatPara, ctrl, candidates: [] }
      bySlot.set(slotKey, bucket)
    }
    bucket.candidates.push(bm)
  }

  const verified = []
  for (const { flatPara, ctrl, candidates } of bySlot.values()) {
    if (candidates.length === 1) {
      verified.push(candidates[0])
      continue
    }
    // Multiple bookmarks reported at the same (sec, para, ctrlIdx) means a body bookmark
    // and an inner cell/header bookmark collided on ctrlIdx: keep the body bookmark.
    const expectedOffset = charIndexOfBodyControl(doc, flatPara, ctrl.pos)
    const exact =
      expectedOffset !== null ? candidates.find((c) => c.offset === expectedOffset) : null
    verified.push(exact ?? candidates[0])
  }

  return verified.sort(compareMarks)
}

/** Return all app marks in `doc` matching `prefixes` (defaults to all 7 app prefixes) in document order. */
export function listMarks(doc, prefixes = APP_MARK_PREFIXES) {
  const allowed = normalizePrefixes(prefixes)
  return readRawBookmarks(doc).filter(
    (bm) => bm.prefix !== null && allowed.some((p) => bm.name.startsWith(p)),
  )
}

/** Validate that `place` refers to a valid body paragraph position and return normalized coordinates or `null`. */
export function resolveBodyPlace(doc, place) {
  if (!doc || !place || typeof place !== 'object') return null
  if (
    place.inTable === true ||
    place.inTextBox === true ||
    place.isTextBox === true ||
    place.inNote === true ||
    place.inFootnote === true ||
    place.inEndnote === true ||
    place.inHeaderFooter === true ||
    place.isHeader === true ||
    place.isFooter === true ||
    place.cellContext != null ||
    place.equationControl != null ||
    place.parentParaIndex != null ||
    place.cellIndex != null ||
    place.cellParaIndex != null ||
    place.noteIndex != null ||
    place.noteType != null ||
    place.headerFooter != null
  ) {
    return null
  }
  if (place.path != null && (!Array.isArray(place.path) || place.path.length > 0)) return null
  if (place.cellPath != null && (!Array.isArray(place.cellPath) || place.cellPath.length > 0)) {
    return null
  }
  if (typeof place.place === 'string' && place.place !== 'body') return null

  const sec = place.sec ?? place.sectionIndex
  const para = place.para ?? place.paraIndex ?? place.paragraphIndex
  const offset = place.offset ?? place.charOffset ?? place.charPos ?? 0

  if (!Number.isInteger(sec) || !Number.isInteger(para) || !Number.isInteger(offset)) return null
  if (sec < 0 || para < 0 || offset < 0) return null

  const secCount = doc.getSectionCount()
  if (sec >= secCount) return null
  const paraCount = doc.getParagraphCount(sec)
  if (para >= paraCount) return null

  const paraLen =
    typeof doc.getParagraphLength === 'function' ? doc.getParagraphLength(sec, para) : offset
  return {
    sec,
    para,
    offset: Math.min(offset, paraLen),
  }
}

/** Insert a single bookmark mark at a validated body paragraph place. */
export function addMark(doc, place, name) {
  const resolved = resolveBodyPlace(doc, place)
  if (!resolved) return { ok: false, reason: 'unsupported_place' }
  if (typeof name !== 'string' || name.length === 0) {
    return { ok: false, reason: 'invalid_name' }
  }
  if (name.length > MAX_MARK_NAME_LEN) {
    return { ok: false, reason: 'name_too_long', maxLen: MAX_MARK_NAME_LEN }
  }
  const res = parseJson(doc.addBookmark(resolved.sec, resolved.para, resolved.offset, name), null)
  if (!res || res.ok !== true) {
    return { ok: false, reason: 'engine_error', error: res?.error ?? 'addBookmark failed' }
  }
  return { ok: true, name, sec: resolved.sec, para: resolved.para, offset: resolved.offset }
}

/** Delete a single bookmark by mark object (`{ sec, para, ctrlIdx }`) or bookmark name string. */
export function removeMark(doc, mark) {
  let target = null
  if (typeof mark === 'string') {
    target = readRawBookmarks(doc).find((bm) => bm.name === mark) ?? null
    if (!target) return { ok: false, reason: 'not_found' }
  } else if (mark && typeof mark === 'object') {
    const sec = mark.sec ?? mark.sectionIndex
    const para = mark.para ?? mark.paraIndex
    const ctrlIdx = mark.ctrlIdx ?? mark.controlIndex
    if (Number.isInteger(sec) && Number.isInteger(para) && Number.isInteger(ctrlIdx)) {
      target = { name: mark.name ?? '', sec, para, ctrlIdx }
    } else if (typeof mark.name === 'string') {
      target =
        readRawBookmarks(doc).find(
          (bm) =>
            bm.name === mark.name &&
            (sec == null || bm.sec === sec) &&
            (para == null || bm.para === para),
        ) ?? null
      if (!target) return { ok: false, reason: 'not_found' }
    }
  }
  if (!target) return { ok: false, reason: 'invalid_mark' }

  const res = deleteBookmarkEntry(doc, target)
  if (!res.ok) {
    return { ok: false, reason: 'engine_error', error: res.error ?? 'deleteBookmark failed' }
  }
  return {
    ok: true,
    name: target.name,
    sec: target.sec,
    para: target.para,
    ctrlIdx: target.ctrlIdx,
  }
}

function uniqueRangePairNames(usedNames, prefix, idParts, maxLen = MAX_MARK_NAME_LEN) {
  const startTail = `:${RANGE_START}`
  const endTail = `:${RANGE_END}`
  const longestTail = Math.max(startTail.length, endTail.length)
  const encodedMiddle = idParts.map(encodeMarkField).join(':')

  for (let n = 2; ; n++) {
    const numPart = String(n)
    let startName
    let endName
    if (encodedMiddle.length === 0) {
      startName = `${prefix}${numPart}${startTail}`
      endName = `${prefix}${numPart}${endTail}`
    } else {
      const numSuffix = `:${numPart}`
      const maxMiddle = maxLen - prefix.length - numSuffix.length - longestTail
      const trimmed = safeTruncate(encodedMiddle, Math.max(0, maxMiddle))
      startName = `${prefix}${trimmed}${numSuffix}${startTail}`
      endName = `${prefix}${trimmed}${numSuffix}${endTail}`
    }
    if (
      startName.length <= maxLen &&
      endName.length <= maxLen &&
      !usedNames.has(startName) &&
      !usedNames.has(endName)
    ) {
      return { startName, endName }
    }
  }
}

function allocateFreshChunkId(usedNames, prefix, oldChunkId, chunks, maxLen = MAX_MARK_NAME_LEN) {
  const maxGrowth = chunks.reduce(
    (minRoom, ch) => Math.min(minRoom, maxLen - ch.name.length),
    maxLen,
  )
  const maxIdLen = Math.max(1, oldChunkId.length + maxGrowth)
  const targetLen = Math.min(6, maxIdLen)
  for (let salt = 1; salt <= 10000; salt++) {
    const raw =
      targetLen <= 4
        ? salt.toString(36).padStart(targetLen, '0').slice(-targetLen)
        : shortHash(`${prefix}\0${oldChunkId}\0${salt}`).slice(0, targetLen)
    const candidateId = raw || String(salt)
    if (candidateId === oldChunkId) continue
    const candidateNames = chunks.map(
      (ch) => `${prefix}${CHUNK_TAG}:${candidateId}:${ch.index}/${ch.total}:${ch.slice}`,
    )
    if (
      candidateNames.every((name) => name.length <= maxLen && !usedNames.has(name)) &&
      ![...usedNames].some((name) => name.startsWith(`${prefix}${CHUNK_TAG}:${candidateId}:`))
    ) {
      return { chunkId: candidateId, names: candidateNames }
    }
  }
  throw new RangeError('Failed to allocate unique chunkId within maxLen')
}

/**
 * Repair copy/paste duplicates among app marks without corrupting structured mark formats:
 * - Range marks (`:시작`/`:끝`): renumber the ID *before* `:시작`/`:끝`, keeping duplicated pairs matched.
 * - Chunked marks (`%c:<id>:i/n:<slice>`): assign a fresh `chunkId` while preserving every `<slice>` intact.
 * - Setting marks (`설정:`): remove earlier exact duplicates so valid JSON and last-in-document-order survive.
 * - Regular point marks: append `:2`, `:3`, ... within `MAX_MARK_NAME_LEN`.
 *
 * Returns `{ renamed, removed }`.
 */
export function deduplicateMarks(doc, prefixes = APP_MARK_PREFIXES) {
  const allowed = normalizePrefixes(prefixes)
  const all = readRawBookmarks(doc)
  const usedNames = new Set(all.map((bm) => bm.name))
  const allowedMarks = all.filter(
    (bm) => bm.prefix !== null && allowed.some((p) => bm.name.startsWith(p)),
  )

  const renamed = []
  const toDelete = []

  // 1. Identify exact duplicate setting marks (both single and chunked):
  //    keep the LAST occurrence in document order so valid JSON and last-wins semantics hold.
  const lastSettingByName = new Map()
  for (const bm of allowedMarks) {
    if (bm.prefix === MARK_PREFIXES.setting) {
      lastSettingByName.set(bm.name, `${bm.sec}:${bm.para}:${bm.ctrlIdx}`)
    }
  }
  const settingDeleteLocs = new Set()
  for (const bm of allowedMarks) {
    if (bm.prefix !== MARK_PREFIXES.setting) continue
    const loc = `${bm.sec}:${bm.para}:${bm.ctrlIdx}`
    if (lastSettingByName.get(bm.name) !== loc) {
      settingDeleteLocs.add(loc)
      toDelete.push(bm)
    }
  }

  // 2. Group non-setting chunked marks in document order so duplicated chunk groups get a fresh chunkId.
  const openChunkGroups = new Map()
  const completedChunkGroups = []
  const chunkLocs = new Set()
  for (const bm of allowedMarks) {
    if (bm.prefix === MARK_PREFIXES.setting) continue
    const decoded = decodeMarkName(bm.name)
    if (!decoded || !decoded.isChunk) continue
    chunkLocs.add(`${bm.sec}:${bm.para}:${bm.ctrlIdx}`)
    const groupKey = `${decoded.prefix}\0${decoded.chunkId}\0${decoded.total}`
    let group = openChunkGroups.get(groupKey)
    if (group && group.indices.has(decoded.index)) {
      completedChunkGroups.push(group)
      openChunkGroups.delete(groupKey)
      group = null
    }
    if (!group) {
      group = {
        prefix: decoded.prefix,
        chunkId: decoded.chunkId,
        total: decoded.total,
        indices: new Set(),
        items: [],
      }
      openChunkGroups.set(groupKey, group)
    }
    group.indices.add(decoded.index)
    group.items.push({
      bm,
      index: decoded.index,
      total: decoded.total,
      slice: decoded.slice,
      name: bm.name,
    })
    if (group.indices.size === group.total) {
      completedChunkGroups.push(group)
      openChunkGroups.delete(groupKey)
    }
  }
  for (const group of openChunkGroups.values()) {
    completedChunkGroups.push(group)
  }

  const seenChunkKeys = new Set()
  for (const group of completedChunkGroups) {
    const key = `${group.prefix}\0${group.chunkId}\0${group.total}`
    if (!seenChunkKeys.has(key)) {
      seenChunkKeys.add(key)
      continue
    }
    const allocated = allocateFreshChunkId(
      usedNames,
      group.prefix,
      group.chunkId,
      group.items,
      MAX_MARK_NAME_LEN,
    )
    for (let i = 0; i < group.items.length; i++) {
      const { bm } = group.items[i]
      const newName = allocated.names[i]
      const res = renameBookmarkEntry(doc, bm, newName)
      if (res.ok) {
        usedNames.add(newName)
        renamed.push({
          from: bm.name,
          to: newName,
          sec: bm.sec,
          para: bm.para,
          offset: bm.offset,
          ctrlIdx: bm.ctrlIdx,
        })
      }
    }
  }

  // 3. Handle remaining non-setting, non-chunked marks (range marks and regular point marks).
  //    Range marks use a per-key LIFO stack so a duplicated range pasted *inside* the
  //    original range pairs inner-with-inner and outer-with-outer without crossing.
  const seen = new Set()
  const usedRangeKeys = new Set()
  const openRangeStacks = new Map()
  for (const bm of allowedMarks) {
    if (bm.prefix === MARK_PREFIXES.setting) continue
    const loc = `${bm.sec}:${bm.para}:${bm.ctrlIdx}`
    if (chunkLocs.has(loc)) continue

    const decoded = decodeMarkName(bm.name)
    const lastPart =
      decoded && !decoded.isChunk && decoded.parts.length > 0
        ? decoded.parts[decoded.parts.length - 1]
        : null

    if (lastPart === RANGE_START || lastPart === RANGE_END) {
      const idParts = decoded.parts.slice(0, -1)
      const rangeKey = `${bm.prefix}${idParts.map(encodeMarkField).join(':')}`
      if (lastPart === RANGE_START) {
        let stack = openRangeStacks.get(rangeKey)
        if (!stack) {
          stack = []
          openRangeStacks.set(rangeKey, stack)
        }
        if (!usedRangeKeys.has(rangeKey)) {
          usedRangeKeys.add(rangeKey)
          seen.add(bm.name)
          stack.push({ renameTo: null })
          continue
        }
        const pair = uniqueRangePairNames(usedNames, bm.prefix, idParts, MAX_MARK_NAME_LEN)
        usedNames.add(pair.startName)
        usedNames.add(pair.endName)
        const res = renameBookmarkEntry(doc, bm, pair.startName)
        if (res.ok) {
          seen.add(pair.startName)
          renamed.push({
            from: bm.name,
            to: pair.startName,
            sec: bm.sec,
            para: bm.para,
            offset: bm.offset,
            ctrlIdx: bm.ctrlIdx,
          })
        }
        stack.push({ renameTo: pair.endName })
        continue
      }

      // RANGE_END: pop the most recently opened matching range start.
      const stack = openRangeStacks.get(rangeKey)
      if (stack && stack.length > 0) {
        const frame = stack.pop()
        if (frame.renameTo === null) {
          seen.add(bm.name)
          continue
        }
        const res = renameBookmarkEntry(doc, bm, frame.renameTo)
        if (res.ok) {
          seen.add(frame.renameTo)
          renamed.push({
            from: bm.name,
            to: frame.renameTo,
            sec: bm.sec,
            para: bm.para,
            offset: bm.offset,
            ctrlIdx: bm.ctrlIdx,
          })
        }
        continue
      }

      // Orphan end mark without an open start.
      if (!seen.has(bm.name)) {
        seen.add(bm.name)
        continue
      }
      const pair = uniqueRangePairNames(usedNames, bm.prefix, idParts, MAX_MARK_NAME_LEN)
      usedNames.add(pair.endName)
      const res = renameBookmarkEntry(doc, bm, pair.endName)
      if (res.ok) {
        seen.add(pair.endName)
        renamed.push({
          from: bm.name,
          to: pair.endName,
          sec: bm.sec,
          para: bm.para,
          offset: bm.offset,
          ctrlIdx: bm.ctrlIdx,
        })
      }
      continue
    }

    if (!seen.has(bm.name)) {
      seen.add(bm.name)
      continue
    }

    const newName = uniqueMarkName(usedNames, bm.name, MAX_MARK_NAME_LEN)
    usedNames.add(newName)
    const res = renameBookmarkEntry(doc, bm, newName)
    if (res.ok) {
      seen.add(newName)
      renamed.push({
        from: bm.name,
        to: newName,
        sec: bm.sec,
        para: bm.para,
        offset: bm.offset,
        ctrlIdx: bm.ctrlIdx,
      })
    }
  }

  // 4. Delete earlier duplicate setting marks LAST in reverse control order so no ctrlIdx shifts earlier renames.
  const removed = []
  const failed = []
  if (toDelete.length > 0) {
    const { deletedLocs, failed: deleteFailures } = deleteMarksSafely(doc, toDelete)
    for (const bm of toDelete) {
      if (deletedLocs.has(`${bm.sec}:${bm.para}:${bm.ctrlIdx}`)) {
        removed.push({
          name: bm.name,
          prefix: bm.prefix,
          sec: bm.sec,
          para: bm.para,
          offset: bm.offset,
          ctrlIdx: bm.ctrlIdx,
        })
      }
    }
    failed.push(...deleteFailures)
  }

  renamed.sort(compareMarks)
  removed.sort(compareMarks)
  failed.sort(compareMarks)
  return failed.length > 0 ? { renamed, removed, failed } : { renamed, removed }
}

function comparePlaces(a, b) {
  if (a.sec !== b.sec) return a.sec - b.sec
  if (a.para !== b.para) return a.para - b.para
  return a.offset - b.offset
}

/**
 * Add a paired start/end range mark (e.g. `차례:시작`/`차례:끝` or `인용:<id>:시작`/`인용:<id>:끝`).
 * Validates both places and both names before mutating so partial ranges are never left behind.
 */
export function addRangeMark(doc, prefix, id, startPlace, endPlace) {
  assertValidPrefix(prefix)
  const start = resolveBodyPlace(doc, startPlace)
  const end = resolveBodyPlace(doc, endPlace)
  if (!start || !end) return { ok: false, reason: 'unsupported_place' }
  if (comparePlaces(start, end) > 0) return { ok: false, reason: 'invalid_range' }

  const idParts = Array.isArray(id)
    ? id.map(String).filter((p) => p.length > 0)
    : id != null && String(id).length > 0
      ? [String(id)]
      : []

  const startName = encodeMarkName(prefix, [...idParts, RANGE_START])
  const endName = encodeMarkName(prefix, [...idParts, RANGE_END])
  if (startName.length > MAX_MARK_NAME_LEN || endName.length > MAX_MARK_NAME_LEN) {
    return { ok: false, reason: 'name_too_long', maxLen: MAX_MARK_NAME_LEN }
  }

  const existingNames = new Set(readRawBookmarks(doc).map((bm) => bm.name))
  if (existingNames.has(startName) || existingNames.has(endName)) {
    return { ok: false, reason: 'duplicate_name' }
  }

  const startRes = addMark(doc, start, startName)
  if (!startRes.ok) return startRes

  const endRes = addMark(doc, end, endName)
  if (!endRes.ok) {
    // Roll back the start mark so no orphan is left behind
    removeMark(doc, startName)
    return endRes
  }

  return {
    ok: true,
    prefix,
    id: idParts.join(':'),
    startName,
    endName,
    start,
    end,
  }
}

/**
 * Pair start (`:시작`) and end (`:끝`) range marks in document order and return
 * `{ ranges, broken }` where `broken` lists any unpaired start or end marks.
 */
export function findRangeMarks(doc, prefixes = APP_MARK_PREFIXES) {
  const marks = listMarks(doc, prefixes)
  const openByKey = new Map()
  const ranges = []
  const broken = []

  for (const mark of marks) {
    const decoded = decodeMarkName(mark.name)
    if (!decoded || decoded.isChunk || decoded.parts.length === 0) continue

    const lastPart = decoded.parts[decoded.parts.length - 1]
    if (lastPart !== RANGE_START && lastPart !== RANGE_END) continue

    const idParts = decoded.parts.slice(0, -1)
    const id = idParts.join(':')
    const key = `${mark.prefix}${idParts.map(encodeMarkField).join(':')}`

    if (lastPart === RANGE_START) {
      let queue = openByKey.get(key)
      if (!queue) {
        queue = []
        openByKey.set(key, queue)
      }
      queue.push({ mark, id, key })
    } else {
      const queue = openByKey.get(key)
      if (queue && queue.length > 0) {
        const opened = queue.shift()
        ranges.push({
          prefix: mark.prefix,
          id: opened.id,
          key,
          start: opened.mark,
          end: mark,
        })
      } else {
        broken.push({ ...mark, kind: 'end', id, reason: 'unpaired_end' })
      }
    }
  }

  for (const queue of openByKey.values()) {
    for (const opened of queue) {
      broken.push({ ...opened.mark, kind: 'start', id: opened.id, reason: 'unpaired_start' })
    }
  }

  ranges.sort((a, b) => compareMarks(a.start, b.start))
  broken.sort(compareMarks)
  return { ranges, broken }
}

/**
 * Delete all unpaired start/end range marks and any incomplete multi-bookmark chunk sets.
 * Deletes in reverse control order so removing one bookmark never shifts another's index.
 */
export function cleanupBrokenMarks(doc, prefixes = APP_MARK_PREFIXES) {
  const { broken } = findRangeMarks(doc, prefixes)
  const marks = listMarks(doc, prefixes)
  const { incomplete } = decodeMarkChunks(marks)

  const byLoc = new Map()
  for (const mark of broken) {
    const loc = `${mark.sec}:${mark.para}:${mark.ctrlIdx}`
    byLoc.set(loc, {
      name: mark.name,
      prefix: mark.prefix,
      sec: mark.sec,
      para: mark.para,
      offset: mark.offset,
      ctrlIdx: mark.ctrlIdx,
      reason: mark.reason,
    })
  }
  for (const group of incomplete) {
    for (const mark of group.marks) {
      const loc = `${mark.sec}:${mark.para}:${mark.ctrlIdx}`
      if (!byLoc.has(loc)) {
        byLoc.set(loc, {
          name: mark.name,
          prefix: mark.prefix,
          sec: mark.sec,
          para: mark.para,
          offset: mark.offset,
          ctrlIdx: mark.ctrlIdx,
          reason: 'incomplete_chunks',
        })
      }
    }
  }

  const targets = [...byLoc.values()]
  const { deletedLocs, failed } = deleteMarksSafely(doc, targets)

  const removed = targets
    .filter((t) => deletedLocs.has(`${t.sec}:${t.para}:${t.ctrlIdx}`))
    .sort(compareMarks)
  failed.sort(compareMarks)
  return failed.length > 0 ? { removed, failed } : { removed }
}

function parseSettingEntry(entry) {
  if (!entry || entry.prefix !== MARK_PREFIXES.setting || entry.parts.length === 0) return null
  const combined = entry.parts.length === 1 ? entry.parts[0] : entry.parts.join(':')
  const eq = combined.indexOf('=')
  if (eq <= 0) return null
  const key = decodeSettingKey(combined.slice(0, eq))
  const rawVal = combined.slice(eq + 1)
  let value
  try {
    value = JSON.parse(rawVal)
  } catch {
    value = rawVal
  }
  return { key, value }
}

function deleteMarksSafely(doc, marks) {
  const unique = new Map()
  for (const m of marks) {
    unique.set(`${m.sec}:${m.para}:${m.ctrlIdx}`, m)
  }
  const ordered = [...unique.values()].sort(compareReverseControlOrder)
  const deletedLocs = new Set()
  const failed = []
  for (const m of ordered) {
    const res = deleteBookmarkEntry(doc, m)
    if (res.ok) {
      deletedLocs.add(`${m.sec}:${m.para}:${m.ctrlIdx}`)
    } else {
      failed.push({
        name: m.name,
        prefix: m.prefix ?? markPrefixOf(m.name),
        sec: m.sec,
        para: m.para,
        offset: m.offset ?? 0,
        ctrlIdx: m.ctrlIdx,
        error: res.error,
      })
    }
  }
  return { removed: deletedLocs.size, deletedLocs, failed }
}

/**
 * Write a per-document setting under the `설정:` prefix.
 * Removes any previous entries for `key` anywhere in the document first, then writes
 * the new bookmark(s) (chunked if >64 chars) at `(0, 0, 0)`.
 */
export function writeDocSetting(doc, key, value) {
  if (typeof key !== 'string' || key.length === 0) {
    return { ok: false, reason: 'invalid_key' }
  }
  if (value === undefined) {
    return { ok: false, reason: 'invalid_value' }
  }
  const startPlace = resolveBodyPlace(doc, { sec: 0, para: 0, offset: 0 })
  if (!startPlace) return { ok: false, reason: 'unsupported_place' }

  const existingSettingMarks = listMarks(doc, [MARK_PREFIXES.setting])
  const { entries } = decodeMarkChunks(existingSettingMarks)
  const toDelete = []
  for (const entry of entries) {
    const parsed = parseSettingEntry(entry)
    if (parsed && parsed.key === key) {
      toDelete.push(...entry.marks)
    }
  }
  const failedDeletes = toDelete.length > 0 ? deleteMarksSafely(doc, toDelete).failed : []

  const remainingNames = new Set(readRawBookmarks(doc).map((bm) => bm.name))
  const payload = `${encodeSettingKey(key)}=${JSON.stringify(value)}`
  const names = encodeMarkChunks(MARK_PREFIXES.setting, [payload], {
    maxLen: MAX_MARK_NAME_LEN,
    existingNames: remainingNames,
  })

  const written = []
  for (const name of names) {
    const res = addMark(doc, startPlace, name)
    if (!res.ok) {
      // Roll back partial chunks written in this call
      for (const prev of [...written].reverse()) {
        removeMark(doc, prev)
      }
      return res
    }
    written.push(name)
  }

  return failedDeletes.length > 0
    ? { ok: true, key, names: written, failed: failedDeletes }
    : { ok: true, key, names: written }
}

/**
 * Scan all `설정:` bookmarks across the entire document and return a key-value map.
 * When duplicate entries exist for the same key, the last one in document order wins.
 */
export function readAllDocSettings(doc) {
  const settingMarks = listMarks(doc, [MARK_PREFIXES.setting])
  const { entries } = decodeMarkChunks(settingMarks)
  const result = {}
  for (const entry of entries) {
    const parsed = parseSettingEntry(entry)
    if (!parsed) continue
    result[parsed.key] = parsed.value
  }
  return result
}

/** Read a single per-document setting by `key` across the entire document (last in document order wins). */
export function readDocSetting(doc, key, defaultValue = undefined) {
  const all = readAllDocSettings(doc)
  return Object.prototype.hasOwnProperty.call(all, key) ? all[key] : defaultValue
}

/** Delete all `설정:` bookmarks for `key` anywhere in the document. */
export function deleteDocSetting(doc, key) {
  if (typeof key !== 'string' || key.length === 0) return { ok: false, reason: 'invalid_key' }
  const settingMarks = listMarks(doc, [MARK_PREFIXES.setting])
  const { entries } = decodeMarkChunks(settingMarks)
  const toDelete = []
  for (const entry of entries) {
    const parsed = parseSettingEntry(entry)
    if (parsed && parsed.key === key) {
      toDelete.push(...entry.marks)
    }
  }
  const { removed, failed } = deleteMarksSafely(doc, toDelete)
  return failed.length > 0 ? { ok: true, removed, failed } : { ok: true, removed }
}

/**
 * Remove all bookmarks whose name starts with any prefix in `prefixes`.
 * Deletes in reverse control order so removing one bookmark never invalidates another's index.
 */
export function stripMarks(doc, prefixes = APP_MARK_PREFIXES) {
  const marks = listMarks(doc, prefixes)
  if (marks.length === 0) return { removed: 0, names: [] }

  const { deletedLocs, failed } = deleteMarksSafely(doc, marks)
  const removedMarks = marks.filter((m) => deletedLocs.has(`${m.sec}:${m.para}:${m.ctrlIdx}`))
  failed.sort(compareMarks)
  return {
    removed: removedMarks.length,
    names: removedMarks.map((m) => m.name),
    ...(failed.length > 0 ? { failed } : {}),
  }
}
