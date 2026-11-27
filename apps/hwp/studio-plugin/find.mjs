/**
 * Multi-scope find and replace engine for rhwp documents.
 *
 * Searches across body paragraphs, tables (including nested tables via ByPath),
 * body text boxes, and body footnotes/endnotes in strict document reading order,
 * while excluding headers and footers. Supports literal/regex queries, case
 * sensitivity, Unicode whole-word boundaries, paragraph style filtering, and
 * character formatting filtering.
 *
 * All replacements mutate the passed HwpDocument directly (intended to run inside
 * a single editor transaction so multiple replacements undo as one step), in
 * reverse offset order per container, skipping body matches that span inline
 * objects or overlap app citation bookmarks.
 */

const CONTEXT_CHARS = 28
const MAX_TABLE_DEPTH = 4
const NESTED_CONTROLS_TRIED = 4
const MAX_NESTED_LOOKUPS = 100000
const MAX_CELL_REPLACE_CHARS = 8
const NOTE_NUMBER_CHARS = 2
const FONT_SIZE_TOLERANCE_PT = 0.2

const PICTURE_DESC = '그림'
const CITATION_PREFIX = '인용:'

// eslint-disable-next-line no-control-regex
const PARAGRAPH_CONTROL_CHARS = /[\u0000-\u0008\u000a-\u001f\u007f]/
const WORD_CHAR_RE = /[\p{L}\p{N}]/u
const UNICODE_ESCAPE_RE = /\\[pPu]\{/
const CITATION_SUFFIX_RE = /^인용:(.+?)(?:[:_-])(start|end|시작|끝)$/i
const CITATION_PREFIX_ROLE_RE = /^인용:(start|end|시작|끝)(?:[:_-])(.+)$/i

function parse(raw) {
  if (typeof raw === 'string') return JSON.parse(raw)
  return raw
}

/**
 * Parse getFootnoteInfo output, escaping unescaped control characters (such as
 * literal tabs) that the engine can emit inside JSON strings.
 */
function parseNoteInfo(raw) {
  if (typeof raw !== 'string') return raw
  return JSON.parse(
    // eslint-disable-next-line no-control-regex
    raw.replace(/[\u0000-\u001f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`),
  )
}

function tryOr(fn, fallback) {
  try {
    return fn()
  } catch {
    return fallback
  }
}

function expectOk(raw, action) {
  const result = parse(raw)
  if (result && result.ok === false) {
    throw new Error(result.error || `${action} failed`)
  }
  return result
}

function normalizeColor(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return ''
  if (/^[0-9a-f]{6}$/.test(trimmed)) return `#${trimmed}`
  return trimmed
}

/**
 * Normalize character format filter options; returns null if no filter field is active.
 */
function normalizeCharFormat(raw) {
  if (!raw || typeof raw !== 'object') return null
  const filter = {}
  let active = false
  if (typeof raw.bold === 'boolean') {
    filter.bold = raw.bold
    active = true
  }
  if (typeof raw.italic === 'boolean') {
    filter.italic = raw.italic
    active = true
  }
  if (typeof raw.underline === 'boolean') {
    filter.underline = raw.underline
    active = true
  }
  if (typeof raw.font === 'string' && raw.font.trim() !== '') {
    filter.font = raw.font.trim().toLowerCase()
    active = true
  }
  if (typeof raw.size === 'number' && Number.isFinite(raw.size) && raw.size > 0) {
    filter.size = raw.size
    active = true
  }
  if (typeof raw.color === 'string' && raw.color.trim() !== '') {
    const color = normalizeColor(raw.color)
    if (color) {
      filter.color = color
      active = true
    }
  }
  return active ? filter : null
}

function propsMatchCharFormat(props, filter) {
  if (!props || typeof props !== 'object') return false
  if (filter.bold !== undefined && Boolean(props.bold) !== filter.bold) return false
  if (filter.italic !== undefined && Boolean(props.italic) !== filter.italic) return false
  if (filter.underline !== undefined && Boolean(props.underline) !== filter.underline) return false
  if (filter.font !== undefined) {
    const family = typeof props.fontFamily === 'string' ? props.fontFamily.trim().toLowerCase() : ''
    if (family !== filter.font) return false
  }
  if (filter.size !== undefined) {
    const rawSize = Number(props.fontSize)
    if (!Number.isFinite(rawSize)) return false
    const pt = rawSize / 100
    if (Math.abs(pt - filter.size) > FONT_SIZE_TOLERANCE_PT) return false
  }
  if (filter.color !== undefined) {
    const color = normalizeColor(props.textColor)
    if (color !== filter.color) return false
  }
  return true
}

/**
 * Map UTF-16 string indices to Unicode code-point indices (the engine's offset unit).
 */
function buildCodePointMap(text) {
  const chars = Array.from(text)
  if (chars.length === text.length) {
    return {
      chars,
      utf16ToCp: (index) => index,
    }
  }
  const map = new Uint32Array(text.length + 1)
  let u16 = 0
  for (let cp = 0; cp < chars.length; cp++) {
    const len = chars[cp].length
    map[u16] = cp
    if (len === 2) map[u16 + 1] = cp
    u16 += len
  }
  map[text.length] = chars.length
  return {
    chars,
    utf16ToCp: (index) => map[Math.min(Math.max(0, index), text.length)],
  }
}

function isWholeWord(chars, startCp, endCp) {
  if (startCp > 0 && WORD_CHAR_RE.test(chars[startCp - 1])) return false
  if (endCp < chars.length && WORD_CHAR_RE.test(chars[endCp])) return false
  return true
}

function compileQueryMatcher(query, caseSensitive, regex) {
  if (!query) return { ok: true, mode: 'none' }
  if (regex) {
    const flags = `${caseSensitive ? 'g' : 'gi'}${UNICODE_ESCAPE_RE.test(query) ? 'u' : ''}`
    try {
      const re = new RegExp(query, flags)
      return { ok: true, mode: 'regex', re }
    } catch (err) {
      return {
        ok: false,
        reason: 'invalid_regex',
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
  return {
    ok: true,
    mode: 'literal',
    query,
    lowerQuery: query.toLowerCase(),
    caseSensitive,
  }
}

/**
 * Find all text hits inside a single string, returning code-point ranges and
 * optional RegExpExecArray metadata for backreference replacement.
 */
function matchTextHits(text, cpMap, matcher, wholeWord) {
  const hits = []
  if (matcher.mode === 'regex') {
    const { re } = matcher
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        if (re.lastIndex >= text.length) break
        const code = text.codePointAt(re.lastIndex)
        re.lastIndex += code !== undefined && code > 0xffff ? 2 : 1
        continue
      }
      const start = cpMap.utf16ToCp(m.index)
      const end = cpMap.utf16ToCp(m.index + m[0].length)
      if (!wholeWord || isWholeWord(cpMap.chars, start, end)) {
        hits.push({ start, end, matchText: m[0], execMatch: m })
      }
    }
    return hits
  }

  if (matcher.mode === 'literal') {
    if (matcher.caseSensitive) {
      const needle = matcher.query
      let pos = 0
      while (pos <= text.length - needle.length) {
        const idx = text.indexOf(needle, pos)
        if (idx === -1) break
        const start = cpMap.utf16ToCp(idx)
        const end = cpMap.utf16ToCp(idx + needle.length)
        if (!wholeWord || isWholeWord(cpMap.chars, start, end)) {
          hits.push({ start, end, matchText: text.slice(idx, idx + needle.length) })
        }
        pos = idx + Math.max(1, needle.length)
      }
      return hits
    }

    const lowerText = text.toLowerCase()
    const needle = matcher.lowerQuery
    if (lowerText.length === text.length) {
      let pos = 0
      while (pos <= lowerText.length - needle.length) {
        const idx = lowerText.indexOf(needle, pos)
        if (idx === -1) break
        const start = cpMap.utf16ToCp(idx)
        const end = cpMap.utf16ToCp(idx + needle.length)
        if (!wholeWord || isWholeWord(cpMap.chars, start, end)) {
          hits.push({ start, end, matchText: text.slice(idx, idx + needle.length) })
        }
        pos = idx + Math.max(1, needle.length)
      }
      return hits
    }

    // Fallback when toLowerCase changes UTF-16 length: compare per code point.
    const needleChars = Array.from(needle)
    const lowerChars = cpMap.chars.map((c) => c.toLowerCase())
    let pos = 0
    while (pos <= lowerChars.length - needleChars.length) {
      let ok = true
      for (let j = 0; j < needleChars.length; j++) {
        if (lowerChars[pos + j] !== needleChars[j]) {
          ok = false
          break
        }
      }
      if (ok) {
        const start = pos
        const end = pos + needleChars.length
        if (!wholeWord || isWholeWord(cpMap.chars, start, end)) {
          hits.push({ start, end, matchText: cpMap.chars.slice(start, end).join('') })
        }
        pos = end
      } else {
        pos += 1
      }
    }
    return hits
  }

  return hits
}

/**
 * Expand JavaScript regex replacement patterns ($$, $&, $`, $', $1..$99, $<name>)
 * using the original RegExpExecArray so lookarounds and anchors are respected.
 */
function expandRegexReplacement(template, execMatch, fullText) {
  if (!execMatch || !template.includes('$')) return template
  const matched = execMatch[0]
  const position = execMatch.index
  const captureCount = execMatch.length - 1
  const namedGroups = execMatch.groups ?? null

  let out = ''
  for (let i = 0; i < template.length; i++) {
    if (template[i] !== '$' || i + 1 >= template.length) {
      out += template[i]
      continue
    }
    const next = template[i + 1]
    if (next === '$') {
      out += '$'
      i += 1
    } else if (next === '&') {
      out += matched
      i += 1
    } else if (next === '`') {
      out += fullText.slice(0, position)
      i += 1
    } else if (next === "'") {
      out += fullText.slice(position + matched.length)
      i += 1
    } else if (next === '<' && namedGroups) {
      const close = template.indexOf('>', i + 2)
      if (close !== -1) {
        const groupName = template.slice(i + 2, close)
        out += namedGroups[groupName] ?? ''
        i = close
      } else {
        out += '$'
      }
    } else if (next >= '0' && next <= '9') {
      const twoDigit =
        i + 2 < template.length && template[i + 2] >= '0' && template[i + 2] <= '9'
          ? Number(template.slice(i + 1, i + 3))
          : -1
      if (twoDigit >= 1 && twoDigit <= captureCount) {
        out += execMatch[twoDigit] ?? ''
        i += 2
      } else {
        const oneDigit = Number(next)
        if (oneDigit >= 1 && oneDigit <= captureCount) {
          out += execMatch[oneDigit] ?? ''
          i += 1
        } else {
          out += '$'
        }
      }
    } else {
      out += '$'
    }
  }
  return out
}

/** Resolve matching style IDs from the document style table. */
function resolveStyleFilter(doc, rawStyle) {
  if (typeof rawStyle !== 'string' || rawStyle.trim() === '') return null
  const name = rawStyle.trim()
  const lower = name.toLowerCase()
  const ids = new Set()
  const list = tryOr(() => parse(doc.getStyleList()), [])
  if (Array.isArray(list)) {
    for (const style of list) {
      if (!style || typeof style !== 'object') continue
      const ko = typeof style.name === 'string' ? style.name.trim() : ''
      const en = typeof style.englishName === 'string' ? style.englishName.trim().toLowerCase() : ''
      if (ko === name || (en && en === lower)) {
        if (Number.isInteger(style.id)) ids.add(style.id)
      }
    }
  }
  return { name, lower, ids }
}

function matchesStyleInfo(info, styleFilter) {
  if (!info || typeof info !== 'object') return false
  if (Number.isInteger(info.id) && styleFilter.ids.has(info.id)) return true
  const ko = typeof info.name === 'string' ? info.name.trim() : ''
  return ko === styleFilter.name || ko.toLowerCase() === styleFilter.lower
}

/**
 * Inspect doc.getBookmarks() for app citation bookmark pairs (prefix '인용:').
 * Supports start/end suffixed/prefixed pairs as well as identical-name pairs
 * within the same body paragraph.
 */
function citationRangesOf(doc) {
  const rangesByPara = new Map()
  if (typeof doc.getBookmarks !== 'function') return rangesByPara
  const bookmarks = tryOr(() => parse(doc.getBookmarks()), [])
  if (!Array.isArray(bookmarks) || bookmarks.length === 0) return rangesByPara

  const groups = new Map()
  for (const bm of bookmarks) {
    if (!bm || typeof bm.name !== 'string' || !bm.name.startsWith(CITATION_PREFIX)) continue
    const sec = Number.isInteger(bm.sec) ? bm.sec : bm.sectionIndex
    const para = Number.isInteger(bm.para) ? bm.para : bm.paraIndex
    const pos = Number.isInteger(bm.charPos) ? bm.charPos : bm.charOffset
    if (!Number.isInteger(sec) || !Number.isInteger(para) || !Number.isInteger(pos)) continue

    let key = bm.name
    let role = 'pair'
    const suffixMatch = bm.name.match(CITATION_SUFFIX_RE)
    if (suffixMatch) {
      key = `${CITATION_PREFIX}${suffixMatch[1]}`
      const tag = suffixMatch[2].toLowerCase()
      role = tag === 'start' || tag === '시작' ? 'start' : 'end'
    } else {
      const prefixMatch = bm.name.match(CITATION_PREFIX_ROLE_RE)
      if (prefixMatch) {
        key = `${CITATION_PREFIX}${prefixMatch[2]}`
        const tag = prefixMatch[1].toLowerCase()
        role = tag === 'start' || tag === '시작' ? 'start' : 'end'
      }
    }

    const groupKey = `${sec}:${para}:${key}`
    let group = groups.get(groupKey)
    if (!group) {
      group = { sec, para, starts: [], ends: [], pairs: [] }
      groups.set(groupKey, group)
    }
    if (role === 'start') group.starts.push(pos)
    else if (role === 'end') group.ends.push(pos)
    else group.pairs.push(pos)
  }

  const addRange = (sec, para, a, b) => {
    const start = Math.min(a, b)
    const end = Math.max(a, b)
    const paraKey = `${sec}:${para}`
    let list = rangesByPara.get(paraKey)
    if (!list) {
      list = []
      rangesByPara.set(paraKey, list)
    }
    list.push({ start, end })
  }

  for (const group of groups.values()) {
    if (group.starts.length > 0 && group.ends.length > 0) {
      group.starts.sort((a, b) => a - b)
      group.ends.sort((a, b) => a - b)
      const count = Math.min(group.starts.length, group.ends.length)
      for (let i = 0; i < count; i++) {
        addRange(group.sec, group.para, group.starts[i], group.ends[i])
      }
    }
    if (group.pairs.length >= 2) {
      group.pairs.sort((a, b) => a - b)
      for (let i = 0; i + 1 < group.pairs.length; i += 2) {
        addRange(group.sec, group.para, group.pairs[i], group.pairs[i + 1])
      }
    }
  }

  return rangesByPara
}

function overlapsCitation(ranges, start, end) {
  if (!ranges || ranges.length === 0) return false
  return ranges.some((range) => {
    if (range.start < range.end) {
      return start < range.end && range.start < end
    }
    return start < range.start && range.start < end
  })
}

function spansInlineObject(doc, sec, para, offset, length) {
  if (length < 2 || typeof doc.textToLogicalOffset !== 'function') return false
  return tryOr(
    () =>
      doc.textToLogicalOffset(sec, para, offset + length) -
        doc.textToLogicalOffset(sec, para, offset + 1) >
      length - 1,
    false,
  )
}

function followsInlineObject(doc, sec, para, offset, length) {
  if (length <= 0 || typeof doc.textToLogicalOffset !== 'function') return false
  return tryOr(
    () =>
      doc.textToLogicalOffset(sec, para, offset + 1) - doc.textToLogicalOffset(sec, para, offset) >
      1,
    false,
  )
}

/**
 * Build a map from `${sec}:${parentPara}:${cellPathCoordsKey}` to rhwp `listId`
 * using `doc.getCursorModel().lists`, covering depth-1 tables, nested tables,
 * and text boxes.
 */
function indexCellListIds(doc) {
  const byPath = new Map()
  if (typeof doc.getCursorModel !== 'function') return byPath
  const model = tryOr(() => parse(doc.getCursorModel()), null)
  const lists = Array.isArray(model?.lists) ? model.lists : []
  if (lists.length === 0) return byPath

  const byId = new Map()
  for (const entry of lists) {
    if (entry && Number.isInteger(entry.listId)) byId.set(entry.listId, entry)
  }

  const resolveChain = (entry, seen = new Set()) => {
    if (!entry || seen.has(entry.listId)) return null
    seen.add(entry.listId)
    if (entry.hostListId === 0) {
      return {
        sec: entry.sectionIndex ?? 0,
        parentPara: entry.hostPara ?? 0,
        steps: [{ controlIndex: entry.controlIndex ?? 0, cellIndex: entry.cellIndex ?? 0 }],
      }
    }
    const parent = byId.get(entry.hostListId)
    const resolvedParent = resolveChain(parent, seen)
    if (!resolvedParent) return null
    const parentSteps = resolvedParent.steps.map((s) => ({ ...s }))
    parentSteps[parentSteps.length - 1].cellParaIndex = entry.hostPara ?? 0
    parentSteps.push({
      controlIndex: entry.controlIndex ?? 0,
      cellIndex: entry.cellIndex ?? 0,
    })
    return {
      sec: resolvedParent.sec,
      parentPara: resolvedParent.parentPara,
      steps: parentSteps,
    }
  }

  for (const entry of lists) {
    const chain = resolveChain(entry)
    if (!chain) continue
    const key = cellPathToListKey(chain.sec, chain.parentPara, chain.steps)
    byPath.set(key, entry.listId)
  }
  return byPath
}

function cellPathToListKey(sec, para, path) {
  if (!Array.isArray(path) || path.length === 0) return ''
  const parents = path
    .slice(0, -1)
    .map((s) => `${s.controlIndex}:${s.cellIndex}:${s.cellParaIndex ?? 0}`)
    .join('/')
  const last = path[path.length - 1]
  return `${sec}:${para}:${parents}|${last.controlIndex}:${last.cellIndex}`
}

/**
 * Group body controls (`list === 0`) by `${sec}:${para}` (sorted by `controlIndex`),
 * index non-body controls (`list !== 0`) by `${list}:${para}`, and count nested tables.
 */
function indexBodyControls(doc) {
  const byPara = new Map()
  const nonBodyByListPara = new Map()
  let nestedTablesTotal = 0
  const all = tryOr(() => parse(doc.getControls()), [])
  if (!Array.isArray(all) || all.length === 0) {
    return { byPara, nonBodyByListPara, nestedTablesTotal }
  }

  const sections = doc.getSectionCount()
  const sectionStarts = []
  let run = 0
  for (let sec = 0; sec < sections; sec++) {
    const count = doc.getParagraphCount(sec)
    sectionStarts.push({ sec, start: run, end: run + count })
    run += count
  }

  for (const ctrl of all) {
    if (!ctrl) continue
    if (ctrl.list !== 0) {
      if (ctrl.ctrlId === 'tbl') nestedTablesTotal += 1
      if (Number.isInteger(ctrl.list) && Number.isInteger(ctrl.para)) {
        const key = `${ctrl.list}:${ctrl.para}`
        let list = nonBodyByListPara.get(key)
        if (!list) {
          list = []
          nonBodyByListPara.set(key, list)
        }
        list.push(ctrl)
      }
      continue
    }
    if (!Number.isInteger(ctrl.para)) continue
    let sec = -1
    let localPara = -1
    for (const range of sectionStarts) {
      if (ctrl.para >= range.start && ctrl.para < range.end) {
        sec = range.sec
        localPara = ctrl.para - range.start
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

  for (const list of byPara.values()) {
    list.sort((a, b) => (a.controlIndex ?? 0) - (b.controlIndex ?? 0))
  }
  return { byPara, nonBodyByListPara, nestedTablesTotal }
}

/**
 * Character offsets of inline content objects inside a table cell or text box paragraph.
 * Uses `doc.getControls()` (`list === listId && para === cellPara`) and
 * `doc.getCharIndexAtStreamPos(listId, cellPara, ctrl.pos)`.
 */
function cellInlineObjectOffsets(doc, listId, cellPara, nonBodyByListPara) {
  if (!Number.isInteger(listId) || listId <= 0) return []
  const ctrls = nonBodyByListPara.get(`${listId}:${cellPara}`)
  if (!ctrls || ctrls.length === 0) return []
  const offsets = []
  for (const ctrl of ctrls) {
    if (!ctrl || ctrl.ctrlId === 'bokm') continue
    if (!Number.isInteger(ctrl.pos)) continue
    if (typeof doc.getCharIndexAtStreamPos === 'function') {
      const at = tryOr(() => parse(doc.getCharIndexAtStreamPos(listId, cellPara, ctrl.pos)), null)
      if (at && Number.isInteger(at.charIndex)) {
        offsets.push(at.charIndex)
        continue
      }
    }
    offsets.push(ctrl.pos)
  }
  return offsets
}

/** Whether a footnote/endnote paragraph contains an inline compose/overlap/ruby control. */
function footnoteHasInlineObject(doc, sec, para, noteControl, notePara) {
  if (typeof doc.getComposeControlInFootnote !== 'function') return false
  for (let ctrlIdx = 0; ctrlIdx < 8; ctrlIdx++) {
    const info = tryOr(
      () => parse(doc.getComposeControlInFootnote(sec, para, noteControl, notePara, ctrlIdx)),
      null,
    )
    if (info && typeof info === 'object' && typeof info.kind === 'string') return true
  }
  return false
}

function cellPathStep(path, cellIndex, cellParaIndex) {
  return [...path.slice(0, -1), { ...path[path.length - 1], cellIndex, cellParaIndex }]
}

/**
 * Evaluate character-format runs for a paragraph and return matching contiguous spans.
 */
function matchingCharFormatSpans(runs, readProps, charFilter, shapeCache, textLength) {
  if (!Array.isArray(runs) || runs.length === 0) return []
  const spans = []
  for (const run of runs) {
    const start = Math.max(0, Number.isInteger(run.startOffset) ? run.startOffset : 0)
    const end = Math.min(textLength, Number.isInteger(run.endOffset) ? run.endOffset : 0)
    if (end <= start) continue

    let matched
    if (Number.isInteger(run.charShapeId) && shapeCache.has(run.charShapeId)) {
      matched = shapeCache.get(run.charShapeId)
    } else {
      const props = tryOr(() => parse(readProps(start)), null)
      matched = propsMatchCharFormat(props, charFilter)
      if (Number.isInteger(run.charShapeId)) shapeCache.set(run.charShapeId, matched)
    }

    if (!matched) continue
    const prev = spans[spans.length - 1]
    if (prev && prev.end === start) {
      prev.end = end
    } else {
      spans.push({ start, end })
    }
  }
  return spans
}

function rangeCoveredBySpans(spans, start, end) {
  return spans.some((span) => span.start <= start && span.end >= end)
}

/**
 * Internal search runner that can also keep regex match metadata for backreference replacement.
 */
function runFind(doc, options = {}, keepExecMeta = false) {
  const query = typeof options?.query === 'string' ? options.query : ''
  const caseSensitive = Boolean(options?.caseSensitive)
  const wholeWord = Boolean(options?.wholeWord)
  const regex = Boolean(options?.regex)
  const styleFilter = resolveStyleFilter(doc, options?.style)
  const charFilter = normalizeCharFormat(options?.charFormat)

  if (!query && !styleFilter && !charFilter) {
    return { ok: true, total: 0, matches: [], execMeta: [], unsupportedScopes: [] }
  }

  const matcher = compileQueryMatcher(query, caseSensitive, regex)
  if (!matcher.ok) return matcher

  const matches = []
  const execMeta = []
  const pageCache = new Map()
  const charShapeCache = new Map()
  const citationRanges = citationRangesOf(doc)
  const { byPara: controlsByPara, nonBodyByListPara, nestedTablesTotal } = indexBodyControls(doc)
  const cellListIds = indexCellListIds(doc)
  const unsupportedScopeSet = new Set()
  let nestedLookups = MAX_NESTED_LOOKUPS
  let nestedTablesFound = 0

  const pageOf = (sec, para) => {
    const key = `${sec}:${para}`
    if (pageCache.has(key)) return pageCache.get(key)
    const info = tryOr(() => parse(doc.getPageOfPosition(sec, para)), null)
    const page =
      info && info.ok !== false && Number.isInteger(info.page) && info.page >= 0 ? info.page + 1 : 1
    pageCache.set(key, page)
    return page
  }

  const emitMatchesForText = ({
    kind,
    sec,
    para,
    path,
    noteControl,
    notePara,
    noteNumber,
    anchorOffset,
    offsetBias = 0,
    text,
    readRuns,
    readProps,
  }) => {
    if (!text) return
    const cpMap = buildCodePointMap(text)
    const cpLen = cpMap.chars.length
    if (cpLen === 0) return

    let hits = []
    if (matcher.mode !== 'none') {
      hits = matchTextHits(text, cpMap, matcher, wholeWord)
      if (hits.length === 0) return
      if (charFilter) {
        if (!readRuns || !readProps) return
        const runs = tryOr(() => parse(readRuns(cpLen)), [])
        const spans = matchingCharFormatSpans(runs, readProps, charFilter, charShapeCache, cpLen)
        if (spans.length === 0) return
        hits = hits.filter((hit) => rangeCoveredBySpans(spans, hit.start, hit.end))
      }
    } else if (charFilter) {
      if (!readRuns || !readProps) return
      const runs = tryOr(() => parse(readRuns(cpLen)), [])
      const spans = matchingCharFormatSpans(runs, readProps, charFilter, charShapeCache, cpLen)
      hits = spans.map((span) => ({
        start: span.start,
        end: span.end,
        matchText: cpMap.chars.slice(span.start, span.end).join(''),
      }))
    } else if (styleFilter) {
      hits = [{ start: 0, end: cpLen, matchText: text }]
    }

    if (hits.length === 0) return

    const page = pageOf(sec, para)
    const paraCitations = citationRanges.get(`${sec}:${para}`) ?? null
    let cellObjOffsets = null
    let fnHasObj = null

    for (const hit of hits) {
      const length = hit.end - hit.start
      if (length <= 0) continue
      const offset = hit.start + offsetBias
      const beforeText = cpMap.chars
        .slice(Math.max(0, hit.start - CONTEXT_CHARS), hit.start)
        .join('')
      const afterText = cpMap.chars
        .slice(hit.end, Math.min(cpLen, hit.end + CONTEXT_CHARS))
        .join('')

      const entry = {
        index: matches.length,
        kind,
        sec,
        para,
        offset,
        length,
        matchText: hit.matchText,
        beforeText,
        afterText,
        page,
      }

      if (path) entry.path = path
      if (kind === 'footnote' || kind === 'endnote') {
        entry.noteControl = noteControl
        entry.notePara = notePara
        if (Number.isInteger(noteNumber)) entry.noteNumber = noteNumber
        if (Number.isInteger(anchorOffset)) entry.anchorOffset = anchorOffset
      }
      if (kind === 'body') {
        if (spansInlineObject(doc, sec, para, offset, length)) {
          entry.spansObject = true
        }
        if (overlapsCitation(paraCitations, offset, offset + length)) {
          entry.inCitation = true
        }
      } else if (kind === 'table' || kind === 'textbox') {
        if (length >= 2) {
          if (cellObjOffsets === null) {
            const listId = cellListIds.get(cellPathToListKey(sec, para, path))
            const cellPara = path[path.length - 1]?.cellParaIndex ?? 0
            cellObjOffsets = cellInlineObjectOffsets(doc, listId, cellPara, nonBodyByListPara)
          }
          if (cellObjOffsets.some((objAt) => offset < objAt && objAt < offset + length)) {
            entry.spansObject = true
          }
        }
        if (paraCitations && overlapsCitation(paraCitations, offset, offset + length)) {
          // Only mark cell/textbox matches as in-citation when this cell actually carries
          // a `bokm` control in its own list (avoiding false positives from body bookmarks
          // in the same outer paragraph).
          const listId = cellListIds.get(cellPathToListKey(sec, para, path))
          const cellPara = path[path.length - 1]?.cellParaIndex ?? 0
          const cellCtrls = Number.isInteger(listId)
            ? nonBodyByListPara.get(`${listId}:${cellPara}`)
            : null
          if (cellCtrls && cellCtrls.some((c) => c.ctrlId === 'bokm')) {
            entry.inCitation = true
          }
        }
      } else if (kind === 'footnote' || kind === 'endnote') {
        if (length >= 2) {
          if (fnHasObj === null) {
            fnHasObj = footnoteHasInlineObject(doc, sec, para, noteControl, notePara)
          }
          if (fnHasObj) {
            entry.spansObject = true
          }
        }
      }

      matches.push(entry)
      if (keepExecMeta) {
        execMeta.push(hit.execMatch ? { execMatch: hit.execMatch, fullText: text } : null)
      }
    }
  }

  const searchCellParagraph = (kind, sec, para, cellPath) => {
    if (styleFilter) {
      if (cellPath.length !== 1) {
        // @rhwp/core has no paragraph-style query API for nested table cells (depth > 1).
        unsupportedScopeSet.add('nested_table')
        return
      }
      const step = cellPath[0]
      const styleInfo = tryOr(
        () =>
          parse(
            doc.getCellStyleAt(sec, para, step.controlIndex, step.cellIndex, step.cellParaIndex),
          ),
        null,
      )
      if (!matchesStyleInfo(styleInfo, styleFilter)) return
    }

    const pathJson = JSON.stringify(cellPath)
    const len = tryOr(() => doc.getCellParagraphLengthByPath(sec, para, pathJson), 0)
    if (len <= 0) return
    const text = tryOr(() => doc.getTextInCellByPath(sec, para, pathJson, 0, len), '')
    emitMatchesForText({
      kind,
      sec,
      para,
      path: cellPath,
      text,
      readRuns: (cpLen) => doc.getCharShapeRunsInCellByPath(sec, para, pathJson, 0, cpLen),
      readProps: (offset) => doc.getCellCharPropertiesAtByPath(sec, para, pathJson, offset),
    })
  }

  const searchNestedTables = (sec, para, parentCellPath, depth) => {
    if (
      nestedTablesTotal === 0 ||
      nestedTablesFound >= nestedTablesTotal ||
      depth >= MAX_TABLE_DEPTH ||
      nestedLookups <= 0
    ) {
      return
    }
    for (
      let inner = 0;
      inner < NESTED_CONTROLS_TRIED && nestedLookups > 0 && nestedTablesFound < nestedTablesTotal;
      inner++
    ) {
      nestedLookups -= 1
      const innerTablePath = [
        ...parentCellPath,
        { controlIndex: inner, cellIndex: 0, cellParaIndex: 0 },
      ]
      const dims = tryOr(
        () => parse(doc.getTableDimensionsByPath(sec, para, JSON.stringify(innerTablePath))),
        null,
      )
      if (dims && Number.isInteger(dims.cellCount) && dims.cellCount > 0) {
        nestedTablesFound += 1
        searchTable(sec, para, innerTablePath, dims, depth + 1)
      }
    }
  }

  const searchTable = (sec, para, tablePath, dims, depth) => {
    for (let cell = 0; cell < dims.cellCount; cell++) {
      const firstParaPath = cellPathStep(tablePath, cell, 0)
      const paraCount = tryOr(
        () => doc.getCellParagraphCountByPath(sec, para, JSON.stringify(firstParaPath)),
        0,
      )
      for (let k = 0; k < paraCount; k++) {
        const cellPath = cellPathStep(tablePath, cell, k)
        searchCellParagraph('table', sec, para, cellPath)
        searchNestedTables(sec, para, cellPath, depth)
      }
    }
  }

  const searchTextBox = (sec, para, controlIndex) => {
    const basePath = [{ controlIndex, cellIndex: 0, cellParaIndex: 0 }]
    const paraCount = tryOr(
      () => doc.getCellParagraphCountByPath(sec, para, JSON.stringify(basePath)),
      0,
    )
    if (paraCount <= 0) return
    for (let k = 0; k < paraCount; k++) {
      const tbPath = [{ controlIndex, cellIndex: 0, cellParaIndex: k }]
      searchCellParagraph('textbox', sec, para, tbPath)
      searchNestedTables(sec, para, tbPath, 1)
    }
  }

  const searchNote = (sec, para, controlIndex, fallbackKind, anchorOffset) => {
    // Footnotes/endnotes have no style or charFormat query API in @rhwp/core.
    if (styleFilter || charFilter) {
      const edit = tryOr(() => parse(doc.getNoteEditInfo(sec, para, controlIndex)), null)
      const noteKind =
        edit && (edit.kind === 'endnote' || edit.kind === 'footnote') ? edit.kind : fallbackKind
      unsupportedScopeSet.add(noteKind)
      return
    }
    const info = tryOr(() => parseNoteInfo(doc.getFootnoteInfo(sec, para, controlIndex)), null)
    if (!info || !info.ok) return

    let kind = fallbackKind
    let prefix = NOTE_NUMBER_CHARS
    const edit = tryOr(() => parse(doc.getNoteEditInfo(sec, para, controlIndex)), null)
    if (edit && edit.ok !== false) {
      if (edit.kind === 'endnote' || edit.kind === 'footnote') kind = edit.kind
      if (Number.isInteger(edit.charOffset)) prefix = edit.charOffset
    }
    if (info.numberSlot === -1) prefix = 0

    const texts = Array.isArray(info.texts) ? info.texts : []
    for (let notePara = 0; notePara < texts.length; notePara++) {
      const rawLine = String(texts[notePara] ?? '')
      const rawChars = Array.from(rawLine)
      const bias = notePara === 0 ? Math.min(prefix, rawChars.length) : 0
      const searchable = bias > 0 ? rawChars.slice(bias).join('') : rawLine
      emitMatchesForText({
        kind,
        sec,
        para,
        noteControl: controlIndex,
        notePara,
        noteNumber: info.number,
        anchorOffset,
        offsetBias: bias,
        text: searchable,
      })
    }
  }

  const sectionCount = doc.getSectionCount()
  for (let sec = 0; sec < sectionCount; sec++) {
    const paraCount = doc.getParagraphCount(sec)
    for (let para = 0; para < paraCount; para++) {
      // 1. Body paragraph
      const bodyStyleOk =
        !styleFilter ||
        matchesStyleInfo(
          tryOr(() => parse(doc.getStyleAt(sec, para)), null),
          styleFilter,
        )
      if (bodyStyleOk) {
        const len = tryOr(() => doc.getParagraphLength(sec, para), 0)
        if (len > 0) {
          const text = tryOr(() => doc.getTextRange(sec, para, 0, len), '')
          emitMatchesForText({
            kind: 'body',
            sec,
            para,
            text,
            readRuns: (cpLen) => doc.getCharShapeRuns(sec, para, 0, cpLen),
            readProps: (offset) => doc.getCharPropertiesAt(sec, para, offset),
          })
        }
      }

      // 2. Controls anchored in this body paragraph (tables, text boxes, footnotes, endnotes).
      // Headers ('head') and footers ('foot') are intentionally excluded.
      const controls = controlsByPara.get(`${sec}:${para}`)
      if (!controls || controls.length === 0) continue

      let controlPositions = null
      const getControlOffset = (controlIndex) => {
        if (controlPositions === null) {
          controlPositions = tryOr(() => parse(doc.getControlTextPositions(sec, para)), [])
        }
        return Array.isArray(controlPositions) && Number.isInteger(controlPositions[controlIndex])
          ? controlPositions[controlIndex]
          : 0
      }

      for (const ctrl of controls) {
        const controlIndex = ctrl.controlIndex
        if (!Number.isInteger(controlIndex)) continue
        if (ctrl.ctrlId === 'tbl') {
          const tablePath = [{ controlIndex, cellIndex: 0, cellParaIndex: 0 }]
          const dims = tryOr(
            () => parse(doc.getTableDimensionsByPath(sec, para, JSON.stringify(tablePath))),
            null,
          )
          if (dims && Number.isInteger(dims.cellCount) && dims.cellCount > 0) {
            searchTable(sec, para, tablePath, dims, 1)
          }
        } else if (ctrl.ctrlId === 'gso' && ctrl.userDesc !== PICTURE_DESC) {
          searchTextBox(sec, para, controlIndex)
        } else if (ctrl.ctrlId === 'fn' || ctrl.ctrlId === 'en') {
          const fallbackKind = ctrl.ctrlId === 'en' ? 'endnote' : 'footnote'
          searchNote(sec, para, controlIndex, fallbackKind, getControlOffset(controlIndex))
        }
      }
    }
  }

  const unsupportedScopes = ['nested_table', 'footnote', 'endnote'].filter((scope) =>
    unsupportedScopeSet.has(scope),
  )
  return { ok: true, total: matches.length, matches, execMeta, unsupportedScopes }
}

/**
 * Find all matches in the document across body, tables (including nested tables),
 * text boxes, footnotes, and endnotes in strict document reading order.
 */
export function findMatches(doc, options = {}) {
  const result = runFind(doc, options, false)
  if (!result.ok) return result
  return {
    ok: true,
    total: result.total,
    matches: result.matches,
    ...(result.unsupportedScopes.length > 0 ? { unsupportedScopes: result.unsupportedScopes } : {}),
  }
}

function cellReplaceHead(text) {
  return Array.from(text.split('\t')[0]).slice(0, MAX_CELL_REPLACE_CHARS).join('')
}

function replaceSingleMatch(doc, match, text) {
  const { kind, sec, para, offset, length } = match

  if (kind === 'body') {
    if (text.length > 0 && followsInlineObject(doc, sec, para, offset, length)) {
      expectOk(doc.replaceText(sec, para, offset + 1, length - 1, text), 'replace')
      expectOk(doc.deleteText(sec, para, offset, 1), 'replace')
      return
    }
    expectOk(doc.replaceText(sec, para, offset, length, text), 'replace')
    return
  }

  if (kind === 'table' || kind === 'textbox') {
    const path = match.path
    const pathJson = JSON.stringify(path)
    if (text.length === 0) {
      expectOk(doc.deleteTextInCellByPath(sec, para, pathJson, offset, length), 'delete')
      return
    }
    const last = path[path.length - 1]
    const head = cellReplaceHead(text)
    if (
      kind === 'table' &&
      path.length === 1 &&
      typeof doc.replaceTextInCellDeferredPagination === 'function' &&
      head !== ''
    ) {
      let removed = length
      while (removed > MAX_CELL_REPLACE_CHARS) {
        const start = removed - MAX_CELL_REPLACE_CHARS
        expectOk(
          doc.replaceTextInCellDeferredPagination(
            sec,
            para,
            last.controlIndex,
            last.cellIndex,
            last.cellParaIndex,
            offset + start,
            MAX_CELL_REPLACE_CHARS,
            ' ',
          ),
          'replace',
        )
        removed = start + 1
      }
      const headLength = Array.from(head).length
      const totalLength = Array.from(text).length
      expectOk(
        doc.replaceTextInCellDeferredPagination(
          sec,
          para,
          last.controlIndex,
          last.cellIndex,
          last.cellParaIndex,
          offset,
          removed,
          head,
        ),
        'replace',
      )
      if (headLength < totalLength) {
        expectOk(
          doc.insertTextInCellByPath(
            sec,
            para,
            pathJson,
            offset + headLength,
            text.slice(head.length),
          ),
          'insert',
        )
      }
      return
    }
    expectOk(doc.deleteTextInCellByPath(sec, para, pathJson, offset, length), 'delete')
    expectOk(doc.insertTextInCellByPath(sec, para, pathJson, offset, text), 'insert')
    return
  }

  if (kind === 'footnote' || kind === 'endnote') {
    const { noteControl, notePara } = match
    if (length > 0) {
      expectOk(doc.deleteTextInFootnote(sec, para, noteControl, notePara, offset, length), 'delete')
    }
    if (text.length > 0) {
      expectOk(doc.insertTextInFootnote(sec, para, noteControl, notePara, offset, text), 'insert')
    }
  }
}

function containerKeyOf(match) {
  if (match.kind === 'body') return `body:${match.sec}:${match.para}`
  if (match.kind === 'table' || match.kind === 'textbox') {
    return `cell:${match.sec}:${match.para}:${JSON.stringify(match.path)}`
  }
  return `note:${match.sec}:${match.para}:${match.noteControl}:${match.notePara}`
}

function matchTargetKey(m) {
  const pathKey = Array.isArray(m.path) ? JSON.stringify(m.path) : ''
  const noteKey =
    m.kind === 'footnote' || m.kind === 'endnote'
      ? `${m.noteControl ?? ''}:${m.notePara ?? ''}`
      : ''
  return `${m.kind}|${m.sec}|${m.para}|${pathKey}|${noteKey}|${m.offset}|${m.length}|${m.matchText}`
}

/**
 * Replace selected or all matches directly on `doc` in reverse offset order per container.
 * Callers should wrap this in a single editor transaction for single-step undo.
 */
export function replaceFindMatches(doc, options, replacement, selection = 'all') {
  if (typeof replacement !== 'string' || PARAGRAPH_CONTROL_CHARS.test(replacement)) {
    return {
      ok: false,
      reason: 'bad_replacement',
      error: 'Replacement text must be a string without line breaks or control characters.',
    }
  }

  const useRegex = Boolean(options?.regex && typeof options?.query === 'string' && options.query)
  const found = runFind(doc, options, useRegex)
  if (!found.ok) return found

  let selectedIndices
  let skippedStale = 0
  if (selection === 'all') {
    selectedIndices = found.matches.map((_, idx) => idx)
  } else if (selection && Array.isArray(selection.targets)) {
    // Re-match each requested target by exact scope, location, and matched text
    // so stale result indices never replace an unintended occurrence.
    const indexByKey = new Map()
    for (let idx = 0; idx < found.matches.length; idx++) {
      const key = matchTargetKey(found.matches[idx])
      if (!indexByKey.has(key)) indexByKey.set(key, idx)
    }
    const valid = new Set()
    for (const target of selection.targets) {
      if (!target || typeof target !== 'object') {
        skippedStale += 1
        continue
      }
      const matchedIdx = indexByKey.get(matchTargetKey(target))
      if (matchedIdx === undefined) {
        skippedStale += 1
        continue
      }
      valid.add(matchedIdx)
    }
    selectedIndices = [...valid].sort((a, b) => a - b)
  } else if (selection && Array.isArray(selection.indices)) {
    const valid = new Set()
    for (const idx of selection.indices) {
      if (Number.isInteger(idx) && idx >= 0 && idx < found.matches.length) {
        valid.add(idx)
      }
    }
    selectedIndices = [...valid].sort((a, b) => a - b)
  } else {
    selectedIndices = []
  }

  let skippedObjects = 0
  let skippedCitations = 0
  const byContainer = new Map()
  let firstReplaced = null

  for (const idx of selectedIndices) {
    const match = found.matches[idx]
    if (match.spansObject) {
      skippedObjects += 1
      continue
    }
    if (match.inCitation) {
      skippedCitations += 1
      continue
    }
    const meta = useRegex ? found.execMeta[idx] : null
    const text = meta
      ? expandRegexReplacement(replacement, meta.execMatch, meta.fullText)
      : replacement
    if (PARAGRAPH_CONTROL_CHARS.test(text)) {
      return {
        ok: false,
        reason: 'bad_replacement',
        error: 'Expanded replacement contains disallowed control characters.',
      }
    }
    if (!firstReplaced) {
      firstReplaced = { match, text }
    }
    const key = containerKeyOf(match)
    let bucket = byContainer.get(key)
    if (!bucket) {
      bucket = []
      byContainer.set(key, bucket)
    }
    bucket.push({ match, text })
  }

  let replaced = 0
  for (const bucket of byContainer.values()) {
    // Mutate highest offset first so earlier offsets in the same container never shift.
    bucket.sort((a, b) => b.match.offset - a.match.offset)
    for (const item of bucket) {
      replaceSingleMatch(doc, item.match, item.text)
      replaced += 1
    }
  }

  const out = {
    ok: true,
    replaced,
    skippedObjects,
    skippedCitations,
    ...(skippedStale > 0 ? { skippedStale } : {}),
  }
  if (firstReplaced) {
    const m = firstReplaced.match
    out.firstPlace = {
      sec: m.sec,
      para: m.para,
      ...(m.path ? { path: m.path } : {}),
      ...(m.kind === 'footnote' || m.kind === 'endnote'
        ? { kind: m.kind, noteControl: m.noteControl, notePara: m.notePara }
        : {}),
      offset: m.offset,
      length: Array.from(firstReplaced.text).length,
    }
  }
  return out
}

/**
 * Move the studio caret to a match and select its character range.
 * For footnotes/endnotes, enters footnote editing mode when supported by the cursor;
 * otherwise moves the body caret to the note anchor and reports `enteredNote: false`.
 */
export function revealFindMatch(services, match) {
  const input =
    services && typeof services.getInputHandler === 'function' ? services.getInputHandler() : null
  const cursor = input ? input.cursor : null
  if (!cursor || !match || !Number.isInteger(match.sec) || !Number.isInteger(match.para)) {
    return { ok: false }
  }

  const offset = Number.isInteger(match.offset) ? match.offset : 0
  const length = Number.isInteger(match.length) && match.length > 0 ? match.length : 0

  if (match.kind === 'footnote' || match.kind === 'endnote') {
    const noteControl = match.noteControl
    const notePara = Number.isInteger(match.notePara) ? match.notePara : 0
    const alreadyInThisNote =
      typeof cursor.isInFootnote === 'function' &&
      cursor.isInFootnote() === true &&
      cursor.fnSectionIdx === match.sec &&
      cursor.fnParaIdx === match.para &&
      cursor.fnControlIdx === noteControl

    let enteredNote = alreadyInThisNote
    if (!enteredNote && Number.isInteger(noteControl)) {
      const wasm = services.wasm ?? input.wasm ?? null
      const editInfo = tryOr(
        () => parse(wasm?.getNoteEditInfo?.(match.sec, match.para, noteControl)),
        null,
      )
      const footnoteIndex = Number.isInteger(editInfo?.footnoteIndex) ? editInfo.footnoteIndex : 0
      const pageNum = Number.isInteger(editInfo?.pageNum)
        ? editInfo.pageNum
        : Math.max(0, (match.page ?? 1) - 1)

      if (typeof cursor.enterFootnote === 'function') {
        enteredNote = tryOr(() => {
          cursor.enterFootnote(match.sec, match.para, noteControl, footnoteIndex, pageNum)
          return true
        }, false)
      } else if (typeof input.enterFootnote === 'function') {
        enteredNote = tryOr(() => {
          input.enterFootnote(match.sec, match.para, noteControl, notePara, offset)
          return true
        }, false)
      }
    }

    if (enteredNote && typeof cursor.setFnCursorPosition === 'function') {
      cursor.clearSelection?.()
      cursor.setFnCursorPosition(notePara, offset)
      if (length > 0 && typeof cursor.setFnAnchor === 'function') {
        cursor.setFnAnchor()
        cursor.setFnCursorPosition(notePara, offset + length)
      }
      input.updateCaret?.()
      return { ok: true, enteredNote: true }
    }

    // Fallback: position the body caret at the note's anchor in the body paragraph.
    if (typeof cursor.isInFootnote === 'function' && cursor.isInFootnote()) {
      cursor.exitFootnote?.()
    }
    const anchorOffset = Number.isInteger(match.anchorOffset) ? match.anchorOffset : 0
    cursor.clearSelection?.()
    cursor.moveTo({
      sectionIndex: match.sec,
      paragraphIndex: match.para,
      charOffset: anchorOffset,
    })
    input.updateCaret?.()
    return { ok: true, enteredNote: false }
  }

  if (typeof cursor.isInFootnote === 'function' && cursor.isInFootnote()) {
    cursor.exitFootnote?.()
  }
  if (typeof cursor.isInHeaderFooter === 'function' && cursor.isInHeaderFooter()) {
    cursor.exitHeaderFooter?.()
  }

  const path = Array.isArray(match.path) ? match.path : []
  const start =
    path.length > 0
      ? {
          sectionIndex: match.sec,
          paragraphIndex: match.para,
          charOffset: offset,
          parentParaIndex: match.para,
          controlIndex: path[0].controlIndex,
          cellIndex: path[0].cellIndex,
          cellParaIndex: path[0].cellParaIndex,
          ...(match.kind === 'textbox' ? { isTextBox: true } : {}),
          ...(path.length > 1 ? { cellPath: path } : {}),
        }
      : { sectionIndex: match.sec, paragraphIndex: match.para, charOffset: offset }

  cursor.clearSelection?.()
  cursor.moveTo(start)
  if (length > 0) {
    cursor.setAnchor?.()
    cursor.moveTo({ ...start, charOffset: offset + length })
  }
  input.updateCaret?.()
  return { ok: true }
}
