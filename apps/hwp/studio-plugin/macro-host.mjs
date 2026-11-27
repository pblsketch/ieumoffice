/**
 * Synchronous macro host binding for HWP/HWPX documents.
 *
 * Binds the application document API and the compatibility object (`HAction`,
 * `HParameterSet`) to the restricted script interpreter (`macro-interpreter.mjs`)
 * and executes each macro atomically inside a single transaction (or engine
 * snapshot when run directly on an `HwpDocument`).
 *
 * Safety invariants:
 * - Every document mutation goes directly through `@rhwp/core` `HwpDocument`
 *   methods or pure engine helpers (`find.mjs`, `outline.mjs`, `toc.mjs`,
 *   `index-marks.mjs`, `citations.mjs`, `staleness.mjs`). Never invokes
 *   `automation.execute`.
 * - Every mutating operation and post-run check verifies that no user document
 *   object (table, picture, shape, text box, equation, footnote, endnote, field,
 *   user bookmark) and no user memo is unexpectedly lost.
 * - Any failure (syntax, runtime, unsupported compat action, step/time/depth/memory
 *   limit, invalid numeric argument, or object/memo loss) rolls back the entire
 *   transaction atomically so zero undo steps are recorded and the document
 *   remains byte-identical.
 */

import {
  MAX_INT32,
  parseMacroScript,
  runMacroScript,
  sanitizeHostValue,
  validateMacroLimits,
} from './macro-interpreter.mjs'
import { createCompatGlobals } from './macro-compat.mjs'
import {
  findProtectedDeletionBlocker,
  findProtectedStepDeletionBlocker,
} from './macro-recorder.mjs'
import { compileMacroRegex, expandMacroRegexReplacement } from './macro-regex.mjs'
import { isAppMarkName, isAppTocHyperlinkField } from './doc-marks.mjs'
import { changeOutlineLevel as changeOutlineLevelEngine } from './outline.mjs'
import { listTocRanges, refreshTocBlock } from './toc.mjs'
import { refreshIndexBlock } from './index-marks.mjs'
import { refreshBibliographyBlock } from './citations.mjs'
import { defaultStalenessRegistry } from './staleness.mjs'

export const MAX_MACRO_MESSAGES = 200
export const MAX_MACRO_MESSAGE_LENGTH = 500
export const MAX_MACRO_TOTAL_MESSAGE_CHARS = 4000
export const MAX_TABLE_ROWS = 100
export const MAX_TABLE_COLS = 50

export const DEFAULT_MACRO_HOST_LIMITS = Object.freeze({
  maxInsertCharsPerCall: 50_000,
  maxTotalInsertChars: 200_000,
  maxRegexLength: 256,
})

const HOST_LIMIT_KEYS = Object.freeze(Object.keys(DEFAULT_MACRO_HOST_LIMITS))

const MAX_TABLE_DEPTH = 4
const NESTED_CONTROLS_TRIED = 4
const MAX_NESTED_LOOKUPS = 100_000
const MAX_CELL_REPLACE_CHARS = 8
const NOTE_NUMBER_CHARS = 2
const REGEX_VM_OPS_PER_STEP = 64

const PICTURE_DESC = '그림'
const CITATION_PREFIX = '인용:'

// eslint-disable-next-line no-control-regex
const PARAGRAPH_CONTROL_CHARS = /[\u0000-\u0008\u000a-\u001f\u007f]/
const FIND_WORD_CHAR_RE = /[\p{L}\p{N}]/u
const CITATION_SUFFIX_RE = /^인용:(.+?)(?:[:_-])(start|end|시작|끝)$/i
const CITATION_PREFIX_ROLE_RE = /^인용:(start|end|시작|끝)(?:[:_-])(.+)$/i

function resolveHostLimits(rawLimits) {
  const base = validateMacroLimits(rawLimits)
  const resolved = Object.assign(Object.create(null), base)
  for (const key of HOST_LIMIT_KEYS) {
    const raw = rawLimits && typeof rawLimits === 'object' ? rawLimits[key] : undefined
    if (raw === undefined) {
      resolved[key] = DEFAULT_MACRO_HOST_LIMITS[key]
      continue
    }
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > MAX_INT32) {
      throw new RangeError(
        `Invalid macro limit "${key}": expected an integer between 1 and ${MAX_INT32}`,
      )
    }
    resolved[key] = raw
  }
  return Object.freeze(resolved)
}

const FONT_LANGUAGES = 7
const MAX_FONT_NAME = 64
const MIN_FONT_PT = 1
const MAX_FONT_PT = 500
const MIN_LINE_SPACING = 50
const MAX_LINE_SPACING = 500
const PARA_UNITS_PER_PT = 200

const ALIGNMENTS = new Set(['left', 'center', 'right', 'justify'])
const TOC_KINDS = new Set(['body', 'table', 'figure', 'equation'])
const HEX_6_RE = /^#([0-9a-fA-F]{6})$/
const HEX_3_RE = /^#([0-9a-fA-F]{3})$/
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/
const WORD_CHAR_RE = /[\p{L}\p{N}_]/u

/** Section-level layout controls that multi-column index refreshes may add or remove. */
const SECTION_LAYOUT_CTRL_IDS = new Set(['secd', 'cold', 'pgnp', 'head', 'foot'])

/** Paragraph unit conversion: always even HWPUNITs (200 per point). */
const paraUnitsOf = (points) => 2 * Math.round((points * PARA_UNITS_PER_PT) / 2)

class MacroRollbackError extends Error {
  constructor(result) {
    super(result.error || 'Macro rolled back')
    this.name = 'MacroRollbackError'
    this.result = result
  }
}

function parseJson(raw, fallback = null) {
  if (typeof raw !== 'string') return raw ?? fallback
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

function parseNoteInfo(raw) {
  if (typeof raw !== 'string') return raw
  return JSON.parse(
    // eslint-disable-next-line no-control-regex
    raw.replace(/[\u0000-\u001f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`),
  )
}

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
  if (startCp > 0 && FIND_WORD_CHAR_RE.test(chars[startCp - 1])) return false
  if (endCp < chars.length && FIND_WORD_CHAR_RE.test(chars[endCp])) return false
  return true
}

function resolveStyleFilter(doc, rawStyle) {
  if (typeof rawStyle !== 'string' || rawStyle.trim() === '') return null
  const name = rawStyle.trim()
  const lower = name.toLowerCase()
  const ids = new Set()
  const list = tryOr(() => parseJson(doc.getStyleList(), []), [])
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

function citationRangesOf(doc) {
  const rangesByPara = new Map()
  if (typeof doc.getBookmarks !== 'function') return rangesByPara
  const bookmarks = tryOr(() => parseJson(doc.getBookmarks(), []), [])
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

function cellPathToListKey(sec, para, path) {
  if (!Array.isArray(path) || path.length === 0) return ''
  const parents = path
    .slice(0, -1)
    .map((s) => `${s.controlIndex}:${s.cellIndex}:${s.cellParaIndex ?? 0}`)
    .join('/')
  const last = path[path.length - 1]
  return `${sec}:${para}:${parents}|${last.controlIndex}:${last.cellIndex}`
}

function indexCellListIds(doc) {
  const byPath = new Map()
  if (typeof doc.getCursorModel !== 'function') return byPath
  const model = tryOr(() => parseJson(doc.getCursorModel(), null), null)
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
    byPath.set(cellPathToListKey(chain.sec, chain.parentPara, chain.steps), entry.listId)
  }
  return byPath
}

function indexBodyControls(doc) {
  const byPara = new Map()
  const nonBodyByListPara = new Map()
  let nestedTablesTotal = 0
  const all = tryOr(() => parseJson(doc.getControls(), []), [])
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

function cellInlineObjectOffsets(doc, listId, cellPara, nonBodyByListPara) {
  if (!Number.isInteger(listId) || listId <= 0) return []
  const ctrls = nonBodyByListPara.get(`${listId}:${cellPara}`)
  if (!ctrls || ctrls.length === 0) return []
  const offsets = []
  for (const ctrl of ctrls) {
    if (!ctrl || ctrl.ctrlId === 'bokm') continue
    if (!Number.isInteger(ctrl.pos)) continue
    if (typeof doc.getCharIndexAtStreamPos === 'function') {
      const at = tryOr(
        () => parseJson(doc.getCharIndexAtStreamPos(listId, cellPara, ctrl.pos), null),
        null,
      )
      if (at && Number.isInteger(at.charIndex)) {
        offsets.push(at.charIndex)
        continue
      }
    }
    offsets.push(ctrl.pos)
  }
  return offsets
}

function footnoteHasInlineObject(doc, sec, para, noteControl, notePara) {
  if (typeof doc.getComposeControlInFootnote !== 'function') return false
  for (let ctrlIdx = 0; ctrlIdx < 8; ctrlIdx++) {
    const info = tryOr(
      () =>
        parseJson(doc.getComposeControlInFootnote(sec, para, noteControl, notePara, ctrlIdx), null),
      null,
    )
    if (info && typeof info === 'object' && typeof info.kind === 'string') return true
  }
  return false
}

function cellPathStep(path, cellIndex, cellParaIndex) {
  return [...path.slice(0, -1), { ...path[path.length - 1], cellIndex, cellParaIndex }]
}

function cellReplaceHead(text) {
  return Array.from(text.split('\t')[0]).slice(0, MAX_CELL_REPLACE_CHARS).join('')
}

function compileMacroQueryMatcher(query, caseSensitive, regex, maxRegexLength) {
  if (!query) return { ok: true, mode: 'none' }
  if (regex) {
    try {
      const compiled = compileMacroRegex(query, caseSensitive ? '' : 'i', {
        maxLength: maxRegexLength,
      })
      return { ok: true, mode: 'regex', compiled }
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

function matchMacroTextHits(text, cpMap, matcher, wholeWord, regexRunOpts, checkDeadline) {
  const hits = []
  if (matcher.mode === 'regex') {
    if (regexRunOpts && typeof regexRunOpts.onEnter === 'function') regexRunOpts.onEnter()
    try {
      const rawMatches = matcher.compiled.execAll(text, regexRunOpts)
      for (let i = 0; i < rawMatches.length; i++) {
        if ((i & 255) === 0) checkDeadline()
        const m = rawMatches[i]
        if (!m || m.length <= 0) continue
        const start = cpMap.utf16ToCp(m.index)
        const end = cpMap.utf16ToCp(m.index + m.length)
        if (!wholeWord || isWholeWord(cpMap.chars, start, end)) {
          hits.push({ start, end, matchText: m.matchText, regexMatch: m })
        }
      }
      return hits
    } finally {
      if (regexRunOpts && typeof regexRunOpts.onExit === 'function') regexRunOpts.onExit()
    }
  }

  if (matcher.mode === 'literal') {
    if (matcher.caseSensitive) {
      const needle = matcher.query
      let pos = 0
      let iter = 0
      while (pos <= text.length - needle.length) {
        if ((iter++ & 255) === 0) checkDeadline()
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
      let iter = 0
      while (pos <= lowerText.length - needle.length) {
        if ((iter++ & 255) === 0) checkDeadline()
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

    const needleChars = Array.from(needle)
    const lowerChars = cpMap.chars.map((c) => c.toLowerCase())
    let pos = 0
    let iter = 0
    while (pos <= lowerChars.length - needleChars.length) {
      if ((iter++ & 255) === 0) checkDeadline()
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

function runMacroFind(doc, options, hooks) {
  const query = typeof options?.query === 'string' ? options.query : ''
  const caseSensitive = Boolean(options?.caseSensitive)
  const wholeWord = Boolean(options?.wholeWord)
  const regex = Boolean(options?.regex)
  const styleFilter = resolveStyleFilter(doc, options?.style)
  const includePage = hooks.includePage !== false
  const keepRegexMeta = hooks.keepRegexMeta === true
  const collectBodyText = hooks.collectBodyText === true
  const checkDeadline = hooks.checkDeadline
  const regexRunOpts = hooks.regexRunOpts

  if (!query && !styleFilter) {
    return {
      ok: true,
      total: 0,
      matches: [],
      regexMeta: [],
      bodyTextByPara: new Map(),
      controlsByPara: new Map(),
      citationRanges: new Map(),
    }
  }

  const matcher = compileMacroQueryMatcher(query, caseSensitive, regex, hooks.maxRegexLength)
  if (!matcher.ok) return matcher

  const matches = []
  const regexMeta = []
  const pageCache = new Map()
  const bodyTextByPara = new Map()
  const citationRanges = citationRangesOf(doc)
  const { byPara: controlsByPara, nonBodyByListPara, nestedTablesTotal } = indexBodyControls(doc)
  const cellListIds = indexCellListIds(doc)
  let nestedLookups = MAX_NESTED_LOOKUPS
  let nestedTablesFound = 0

  const pageOf = (sec, para) => {
    if (!includePage) return 1
    const key = `${sec}:${para}`
    if (pageCache.has(key)) return pageCache.get(key)
    const info = tryOr(() => parseJson(doc.getPageOfPosition(sec, para), null), null)
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
    offsetBias = 0,
    text,
  }) => {
    if (!text) return
    const cpMap = buildCodePointMap(text)
    const cpLen = cpMap.chars.length
    if (cpLen === 0) return

    let hits = []
    if (matcher.mode !== 'none') {
      hits = matchMacroTextHits(text, cpMap, matcher, wholeWord, regexRunOpts, checkDeadline)
    } else if (styleFilter) {
      hits = [{ start: 0, end: cpLen, matchText: text }]
    }
    if (hits.length === 0) return

    if (collectBodyText && kind === 'body') {
      bodyTextByPara.set(`${sec}:${para}`, { text, chars: cpMap.chars })
    }

    const page = pageOf(sec, para)
    const paraCitations = citationRanges.get(`${sec}:${para}`) ?? null
    let cellObjOffsets = null
    let fnHasObj = null

    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i]
      const length = hit.end - hit.start
      if (length <= 0) continue
      const offset = hit.start + offsetBias

      const entry = {
        index: matches.length,
        kind,
        sec,
        para,
        offset,
        length,
        matchText: hit.matchText,
        page,
      }

      if (path) entry.path = path
      if (kind === 'footnote' || kind === 'endnote') {
        entry.noteControl = noteControl
        entry.notePara = notePara
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
      if (keepRegexMeta) {
        regexMeta.push(hit.regexMatch ? { regexMatch: hit.regexMatch, fullText: text } : null)
      }
    }
  }

  const searchCellParagraph = (kind, sec, para, cellPath) => {
    checkDeadline()
    if (styleFilter) {
      if (cellPath.length !== 1) return
      const step = cellPath[0]
      const styleInfo = tryOr(
        () =>
          parseJson(
            doc.getCellStyleAt(sec, para, step.controlIndex, step.cellIndex, step.cellParaIndex),
            null,
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
        () =>
          parseJson(doc.getTableDimensionsByPath(sec, para, JSON.stringify(innerTablePath)), null),
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
      checkDeadline()
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

  const searchNote = (sec, para, controlIndex, fallbackKind) => {
    checkDeadline()
    if (styleFilter) return
    const info = tryOr(() => parseNoteInfo(doc.getFootnoteInfo(sec, para, controlIndex)), null)
    if (!info || !info.ok) return

    let kind = fallbackKind
    let prefix = NOTE_NUMBER_CHARS
    const edit = tryOr(() => parseJson(doc.getNoteEditInfo(sec, para, controlIndex), null), null)
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
        offsetBias: bias,
        text: searchable,
      })
    }
  }

  const sectionCount = doc.getSectionCount()
  for (let sec = 0; sec < sectionCount; sec++) {
    const paraCount = doc.getParagraphCount(sec)
    for (let para = 0; para < paraCount; para++) {
      checkDeadline()
      const bodyStyleOk =
        !styleFilter ||
        matchesStyleInfo(
          tryOr(() => parseJson(doc.getStyleAt(sec, para), null), null),
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
          })
        }
      }

      const controls = controlsByPara.get(`${sec}:${para}`)
      if (!controls || controls.length === 0) continue

      for (const ctrl of controls) {
        const controlIndex = ctrl.controlIndex
        if (!Number.isInteger(controlIndex)) continue
        if (ctrl.ctrlId === 'tbl') {
          const tablePath = [{ controlIndex, cellIndex: 0, cellParaIndex: 0 }]
          const dims = tryOr(
            () =>
              parseJson(doc.getTableDimensionsByPath(sec, para, JSON.stringify(tablePath)), null),
            null,
          )
          if (dims && Number.isInteger(dims.cellCount) && dims.cellCount > 0) {
            searchTable(sec, para, tablePath, dims, 1)
          }
        } else if (ctrl.ctrlId === 'gso' && ctrl.userDesc !== PICTURE_DESC) {
          searchTextBox(sec, para, controlIndex)
        } else if (ctrl.ctrlId === 'fn' || ctrl.ctrlId === 'en') {
          const fallbackKind = ctrl.ctrlId === 'en' ? 'endnote' : 'footnote'
          searchNote(sec, para, controlIndex, fallbackKind)
        }
      }
    }
  }

  return {
    ok: true,
    total: matches.length,
    matches,
    regexMeta,
    bodyTextByPara,
    controlsByPara,
    citationRanges,
  }
}

function macroContainerKeyOf(match) {
  if (match.kind === 'body') return `body:${match.sec}:${match.para}`
  if (match.kind === 'table' || match.kind === 'textbox') {
    return `cell:${match.sec}:${match.para}:${JSON.stringify(match.path)}`
  }
  return `note:${match.sec}:${match.para}:${match.noteControl}:${match.notePara}`
}

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function memoEntriesOf(doc) {
  if (typeof doc.getMemoList !== 'function') return []
  const list = parseJson(doc.getMemoList(), [])
  return Array.isArray(list) ? list : []
}

function appMarkBookmarksOf(doc) {
  if (typeof doc.getBookmarks !== 'function') return []
  const list = parseJson(doc.getBookmarks(), [])
  return Array.isArray(list) ? list.filter((mark) => isAppMarkName(mark?.name)) : []
}

function appMarkControlKeys(doc) {
  const marks = appMarkBookmarksOf(doc)
  if (marks.length === 0) return new Set()
  const bases = [0]
  const keys = new Set()
  for (const mark of marks) {
    const sec = mark.sec ?? mark.sectionIndex ?? 0
    const para = mark.para ?? mark.paraIndex ?? 0
    const ctrlIdx = mark.ctrlIdx ?? mark.controlIndex
    if (!Number.isInteger(sec) || !Number.isInteger(para) || !Number.isInteger(ctrlIdx)) continue
    while (bases.length <= sec) {
      bases.push(bases[bases.length - 1] + doc.getParagraphCount(bases.length - 1))
    }
    keys.add(`${bases[sec] + para}:${ctrlIdx}`)
  }
  return keys
}

/**
 * Snapshot all protected user objects, notes, fields, and memos in `doc`,
 * excluding app-owned metadata bookmarks and app-owned TOC hyperlinks.
 */
function captureProtectionSnapshot(doc) {
  const allFields = typeof doc.getFieldList === 'function' ? parseJson(doc.getFieldList(), []) : []
  const safeFields = Array.isArray(allFields) ? allFields : []
  const protectedFields = safeFields.filter(
    (field) => field?.fieldType !== 'memo' && !isAppTocHyperlinkField(field),
  )

  const rawControls = typeof doc.getControls === 'function' ? parseJson(doc.getControls(), []) : []
  const controls = Array.isArray(rawControls) ? rawControls : []

  const unnamed = controls.filter((control) => control.ctrlId === '' && control.ctrlCh === 0)
  const used = new Set()
  let exemptUnnamedControls = 0
  for (const field of safeFields.filter(
    (entry) => entry?.fieldType === 'memo' || isAppTocHyperlinkField(entry),
  )) {
    let index = -1
    if (Number.isInteger(field.startPos)) {
      index = unnamed.findIndex(
        (control, at) =>
          !used.has(at) &&
          Number.isInteger(field.listId) &&
          control.list === field.listId &&
          control.para === field.paraInList &&
          control.pos + 8 === field.startPos,
      )
    }
    if (index < 0) {
      index = unnamed.findIndex(
        (control, at) =>
          !used.has(at) &&
          Number.isInteger(field.listId) &&
          control.list === field.listId &&
          control.para === field.paraInList,
      )
    }
    if (index < 0) continue
    used.add(index)
    exemptUnnamedControls += 1
  }

  const appMarks = appMarkControlKeys(doc)
  let appMarkControls = 0
  let notes = 0
  let sectionLayoutControls = 0
  for (const control of controls) {
    if (control.ctrlId === 'fn' || control.ctrlId === 'en') {
      notes += 1
    }
    if (SECTION_LAYOUT_CTRL_IDS.has(control.ctrlId)) {
      sectionLayoutControls += 1
    }
    if (
      appMarks.size > 0 &&
      control.ctrlId === 'bokm' &&
      control.list === 0 &&
      appMarks.has(`${control.para}:${control.controlIndex}`)
    ) {
      appMarkControls += 1
    }
  }

  const memos = memoEntriesOf(doc)
  const memoIds = new Set()
  for (const memo of memos) {
    if (memo && memo.id !== undefined && memo.id !== null) {
      memoIds.add(memo.id)
    }
  }

  const fieldIds = new Set()
  for (const field of protectedFields) {
    if (field && field.fieldId !== undefined && field.fieldId !== null) {
      fieldIds.add(field.fieldId)
    }
  }

  return {
    controls: controls.length - exemptUnnamedControls - appMarkControls,
    notes,
    fieldCount: protectedFields.length,
    fieldIds,
    memoCount: memos.length,
    memoIds,
    sectionLayoutControls,
  }
}

function clampPosition(doc, sec, para, offset) {
  const secCount = Math.max(1, doc.getSectionCount())
  const safeSec = Math.max(0, Math.min(Number.isInteger(sec) ? sec : 0, secCount - 1))
  const paraCount = Math.max(1, doc.getParagraphCount(safeSec))
  const safePara = Math.max(0, Math.min(Number.isInteger(para) ? para : 0, paraCount - 1))
  const paraLen = Math.max(0, doc.getParagraphLength(safeSec, safePara))
  const safeOffset = Math.max(0, Math.min(Number.isInteger(offset) ? offset : 0, paraLen))
  return { sec: safeSec, para: safePara, offset: safeOffset }
}

function comparePos(a, b) {
  if (a.sec !== b.sec) return a.sec - b.sec
  if (a.para !== b.para) return a.para - b.para
  return a.offset - b.offset
}

function normalizeSelectionRange(doc, sel) {
  if (!sel || typeof sel !== 'object') return null
  const start = clampPosition(doc, sel.startSec, sel.startPara, sel.startOffset)
  const end = clampPosition(doc, sel.endSec, sel.endPara, sel.endOffset)
  if (comparePos(start, end) <= 0) {
    return {
      startSec: start.sec,
      startPara: start.para,
      startOffset: start.offset,
      endSec: end.sec,
      endPara: end.para,
      endOffset: end.offset,
    }
  }
  return {
    startSec: end.sec,
    startPara: end.para,
    startOffset: end.offset,
    endSec: start.sec,
    endPara: start.para,
    endOffset: start.offset,
  }
}

function readParagraphText(doc, sec, para) {
  const len = doc.getParagraphLength(sec, para)
  return len > 0 ? doc.getTextRange(sec, para, 0, len) : ''
}

function readSelectionText(doc, sel, maxStringLength) {
  const parts = []
  let totalLen = 0
  for (let sec = sel.startSec; sec <= sel.endSec; sec++) {
    const paraCount = doc.getParagraphCount(sec)
    const pStart = sec === sel.startSec ? sel.startPara : 0
    const pEnd = sec === sel.endSec ? sel.endPara : paraCount - 1
    for (let para = pStart; para <= pEnd; para++) {
      const len = doc.getParagraphLength(sec, para)
      const from = sec === sel.startSec && para === sel.startPara ? sel.startOffset : 0
      const to = sec === sel.endSec && para === sel.endPara ? sel.endOffset : len
      const count = Math.max(0, to - from)
      const chunk = count > 0 ? doc.getTextRange(sec, para, from, count) : ''
      totalLen += chunk.length + (parts.length > 0 ? 1 : 0)
      if (totalLen > maxStringLength) {
        throw new Error(`String length limit (${maxStringLength}) exceeded`)
      }
      parts.push(chunk)
    }
  }
  return parts.join('\n')
}

function normalizeColorHex(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const m6 = HEX_6_RE.exec(trimmed)
  if (m6) return `#${m6[1].toLowerCase()}`
  const m3 = HEX_3_RE.exec(trimmed)
  if (m3) {
    const [r, g, b] = m3[1].toLowerCase()
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return null
}

function createInitialState(doc, options, limits, nowFn, startTime) {
  const initialCaret = options?.caret
    ? clampPosition(doc, options.caret.sec, options.caret.para, options.caret.offset)
    : clampPosition(doc, 0, 0, 0)
  const initialSelection = options?.selection
    ? normalizeSelectionRange(doc, options.selection)
    : null
  const clock = typeof nowFn === 'function' ? nowFn : (options?.now ?? (() => Date.now()))
  const started = typeof startTime === 'number' && Number.isFinite(startTime) ? startTime : clock()
  const state = {
    caret: initialCaret,
    selection: initialSelection,
    selectionAnchor: initialSelection
      ? {
          sec: initialSelection.startSec,
          para: initialSelection.startPara,
          offset: initialSelection.startOffset,
        }
      : null,
    pendingCharFormat: null,
    atLineEnd: false,
    messages: [],
    messageChars: 0,
    messagesTruncated: false,
    totalInsertedChars: 0,
    allowedTableDelta: 0,
    mutated: false,
    lastError: null,
    lastFind: null,
    limits,
    now: clock,
    startTime: started,
    budget: null,
    regexOpRemainder: 0,
    inRegex: false,
    baseline: captureProtectionSnapshot(doc),
    recordError(code, message, extra = undefined) {
      state.lastError = {
        code,
        message,
        ...(extra && extra.unsupportedAction !== undefined
          ? { unsupportedAction: extra.unsupportedAction }
          : {}),
        ...(extra && extra.detail !== undefined ? { detail: extra.detail } : {}),
      }
    },
  }
  return state
}

function getLineInfoSafe(doc, sec, para, offset) {
  if (typeof doc.getLineInfo !== 'function') return null
  try {
    const parsed = parseJson(doc.getLineInfo(sec, para, offset), null)
    if (
      parsed &&
      Number.isInteger(parsed.lineIndex) &&
      Number.isInteger(parsed.lineCount) &&
      Number.isInteger(parsed.charStart) &&
      Number.isInteger(parsed.charEnd) &&
      parsed.lineCount >= 1
    ) {
      return parsed
    }
  } catch {
    return null
  }
  return null
}

function collectVisualLines(doc, sec, para) {
  const first = getLineInfoSafe(doc, sec, para, 0)
  if (!first) return null
  if (first.lineCount <= 1) {
    return [{ lineIndex: 0, charStart: first.charStart, charEnd: first.charEnd }]
  }
  const paraLen = doc.getParagraphLength(sec, para)
  const lines = [{ lineIndex: first.lineIndex, charStart: first.charStart, charEnd: first.charEnd }]
  let cursor = first.charEnd
  const maxIter = Math.max(first.lineCount + 4, 16)
  for (
    let guard = 0;
    lines.length < first.lineCount && cursor <= paraLen && guard < maxIter;
    guard++
  ) {
    const info = getLineInfoSafe(doc, sec, para, cursor)
    if (!info) break
    if (info.lineIndex <= lines[lines.length - 1].lineIndex) {
      cursor += 1
      continue
    }
    lines.push({ lineIndex: info.lineIndex, charStart: info.charStart, charEnd: info.charEnd })
    if (info.charEnd <= cursor) break
    cursor = info.charEnd
  }
  return lines
}

/**
 * Create the synchronous application document API bound to `doc` and `state`.
 *
 * Host API invariant: every method in this API treats caller-supplied objects
 * and arrays as read-only and must never mutate them (enforced both by
 * read-only implementation and by the interpreter's host-argument isolation).
 */
export function createMacroApi(doc, state, options = undefined) {
  if (!doc || typeof doc.getSectionCount !== 'function') {
    throw new TypeError('createMacroApi requires a valid HwpDocument instance')
  }
  const limits = state?.limits
    ? resolveHostLimits(state.limits)
    : resolveHostLimits(options?.limits)
  const nowFn =
    typeof state?.now === 'function'
      ? state.now
      : typeof options?.now === 'function'
        ? options.now
        : () => Date.now()
  const startTime =
    typeof state?.startTime === 'number' && Number.isFinite(state.startTime)
      ? state.startTime
      : nowFn()
  const execState = state ?? createInitialState(doc, options, limits, nowFn, startTime)
  if (!execState.baseline) {
    execState.baseline = captureProtectionSnapshot(doc)
  }
  if (execState.selectionAnchor === undefined) execState.selectionAnchor = null
  if (execState.pendingCharFormat === undefined) execState.pendingCharFormat = null
  if (execState.atLineEnd === undefined) execState.atLineEnd = false
  if (execState.messageChars === undefined) execState.messageChars = 0
  if (execState.messagesTruncated === undefined) execState.messagesTruncated = false
  if (execState.totalInsertedChars === undefined) execState.totalInsertedChars = 0
  if (execState.inRegex === undefined) execState.inRegex = false
  if (typeof execState.now !== 'function') execState.now = nowFn
  if (typeof execState.startTime !== 'number' || !Number.isFinite(execState.startTime)) {
    execState.startTime = startTime
  }
  if (typeof execState.recordError !== 'function') {
    execState.recordError = (code, message, extra = undefined) => {
      execState.lastError = {
        code,
        message,
        ...(extra && extra.unsupportedAction !== undefined
          ? { unsupportedAction: extra.unsupportedAction }
          : {}),
        ...(extra && extra.detail !== undefined ? { detail: extra.detail } : {}),
      }
    }
  }

  const failHost = (code, message, extra = undefined) => {
    execState.recordError(code, message, extra)
    const err = new Error(message)
    err.code = code
    if (extra && extra.unsupportedAction !== undefined) {
      err.unsupportedAction = extra.unsupportedAction
    }
    if (extra && extra.detail !== undefined) {
      err.detail = extra.detail
    }
    throw err
  }

  const checkDeadline = () => {
    const elapsed = execState.now() - execState.startTime
    if (elapsed > limits.maxTimeMs) {
      if (execState.inRegex) {
        failHost('time_limit', `Regex execution time limit (${limits.maxTimeMs}ms) exceeded`, {
          detail: 'regex',
        })
      }
      failHost('time_limit', `Execution time limit (${limits.maxTimeMs}ms) exceeded`)
    }
  }

  const recordRegexLimitError = (err) => {
    if (err && (err.code === 'time_limit' || err.code === 'step_limit')) {
      const msg =
        err.code === 'time_limit'
          ? `Regex execution time limit (${limits.maxTimeMs}ms) exceeded`
          : `Regex execution step limit (${limits.maxSteps}) exceeded`
      execState.recordError(err.code, msg, { detail: 'regex' })
    }
  }

  const chargeRegexSteps = (ops) => {
    if (!Number.isFinite(ops) || ops <= 0) return
    execState.regexOpRemainder = (execState.regexOpRemainder || 0) + ops
    if (execState.regexOpRemainder >= REGEX_VM_OPS_PER_STEP) {
      const steps = Math.floor(execState.regexOpRemainder / REGEX_VM_OPS_PER_STEP)
      execState.regexOpRemainder -= steps * REGEX_VM_OPS_PER_STEP
      if (execState.budget && typeof execState.budget.addSteps === 'function') {
        try {
          execState.budget.addSteps(steps)
        } catch (err) {
          recordRegexLimitError(err)
          throw err
        }
      }
    }
  }

  const checkRegexLimit = () => {
    const elapsed = execState.now() - execState.startTime
    if (elapsed > limits.maxTimeMs) {
      failHost('time_limit', `Regex execution time limit (${limits.maxTimeMs}ms) exceeded`, {
        detail: 'regex',
      })
    }
    if (execState.budget && typeof execState.budget.checkLimits === 'function') {
      try {
        execState.budget.checkLimits()
      } catch (err) {
        recordRegexLimitError(err)
        throw err
      }
    }
  }

  const regexRunOpts = {
    onEnter: () => {
      execState.inRegex = true
    },
    onExit: () => {
      execState.inRegex = false
    },
    onStep: chargeRegexSteps,
    checkLimit: checkRegexLimit,
  }

  const expectEngineOk = (raw, actionName) => {
    const parsed = parseJson(raw, null)
    if (parsed && parsed.ok === false) {
      failHost('engine_error', parsed.error || `${actionName} failed`)
    }
    return parsed
  }

  const assertPositiveInt = (value, name, max = MAX_INT32) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
      failHost('invalid_argument', `Invalid ${name}: expected an integer between 1 and ${max}`)
    }
    return value
  }

  const assertNonNegativeInt = (value, name, max = MAX_INT32) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) {
      failHost('invalid_argument', `Invalid ${name}: expected an integer between 0 and ${max}`)
    }
    return value
  }

  const assertFiniteRange = (value, name, min, max) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      failHost('invalid_argument', `Invalid ${name}: expected a number between ${min} and ${max}`)
    }
    return value
  }

  const assertValidSection = (sec, name = 'sec') => {
    assertNonNegativeInt(sec, name)
    const count = doc.getSectionCount()
    if (sec >= count) {
      failHost('invalid_argument', `Section index ${sec} out of bounds (0..${count - 1})`)
    }
    return sec
  }

  const assertValidParagraph = (sec, para, name = 'para') => {
    assertValidSection(sec)
    assertNonNegativeInt(para, name)
    const count = doc.getParagraphCount(sec)
    if (para >= count) {
      failHost('invalid_argument', `Paragraph index ${para} out of bounds (0..${count - 1})`)
    }
    return para
  }

  const checkObjectsPreserved = (opts = undefined) => {
    const allowSectionLayoutDelta = opts?.allowSectionLayoutDelta === true
    const resyncAfterRefresh = opts?.resyncAfterRefresh === true
    const after = captureProtectionSnapshot(doc)
    const base = execState.baseline

    if (after.memoCount < base.memoCount) {
      failHost('memo_loss', 'Cannot remove user memo during macro execution')
    }
    for (const id of base.memoIds) {
      if (!after.memoIds.has(id)) {
        failHost('memo_loss', 'Cannot remove user memo during macro execution')
      }
    }

    if (after.notes < base.notes) {
      failHost('object_loss', 'Cannot remove document footnote or endnote during macro execution')
    }

    if (after.fieldCount < base.fieldCount) {
      failHost('object_loss', 'Cannot remove document field during macro execution')
    }
    for (const id of base.fieldIds) {
      if (!after.fieldIds.has(id)) {
        failHost('object_loss', 'Cannot remove document field during macro execution')
      }
    }

    const secLayoutDiff = allowSectionLayoutDelta
      ? Math.max(0, base.sectionLayoutControls - after.sectionLayoutControls)
      : 0
    const expectedMinControls = base.controls + execState.allowedTableDelta - secLayoutDiff
    if (after.controls < expectedMinControls) {
      failHost('object_loss', 'Cannot remove document object during macro execution')
    }

    if (resyncAfterRefresh) {
      base.sectionLayoutControls = after.sectionLayoutControls
      base.controls = after.controls - execState.allowedTableDelta
    }
  }

  const assertSelectionHasNoProtectedContent = (sel) => {
    const blocker = findProtectedDeletionBlocker(doc, sel)
    if (blocker) {
      failHost(blocker.code, blocker.message)
    }
  }

  const deleteSelectionInternal = () => {
    const rawSel = execState.selection
    if (!rawSel) return false
    const sel = normalizeSelectionRange(doc, rawSel)
    if (!sel) {
      execState.selection = null
      return false
    }

    assertSelectionHasNoProtectedContent(sel)

    const isEmpty =
      sel.startSec === sel.endSec &&
      sel.startPara === sel.endPara &&
      sel.startOffset === sel.endOffset

    if (!isEmpty) {
      if (sel.startSec === sel.endSec) {
        if (sel.startPara === sel.endPara) {
          expectEngineOk(
            doc.deleteText(
              sel.startSec,
              sel.startPara,
              sel.startOffset,
              sel.endOffset - sel.startOffset,
            ),
            'deleteSelection',
          )
        } else {
          expectEngineOk(
            doc.deleteRange(
              sel.startSec,
              sel.startPara,
              sel.startOffset,
              sel.endPara,
              sel.endOffset,
            ),
            'deleteSelection',
          )
        }
      } else {
        for (let sec = sel.endSec; sec >= sel.startSec; sec--) {
          const lastPara = doc.getParagraphCount(sec) - 1
          const pStart = sec === sel.startSec ? sel.startPara : 0
          const oStart = sec === sel.startSec ? sel.startOffset : 0
          const pEnd = sec === sel.endSec ? sel.endPara : lastPara
          const oEnd = sec === sel.endSec ? sel.endOffset : doc.getParagraphLength(sec, lastPara)
          if (pStart === pEnd) {
            if (oEnd > oStart) {
              expectEngineOk(doc.deleteText(sec, pStart, oStart, oEnd - oStart), 'deleteSelection')
            }
          } else {
            expectEngineOk(doc.deleteRange(sec, pStart, oStart, pEnd, oEnd), 'deleteSelection')
          }
        }
      }
      execState.mutated = true
    }

    execState.caret = clampPosition(doc, sel.startSec, sel.startPara, sel.startOffset)
    execState.selection = null
    execState.selectionAnchor = null
    execState.atLineEnd = false
    checkObjectsPreserved()
    return !isEmpty
  }

  const splitParagraphAt = (sec, para, textOffset) => {
    const logicalOffset =
      typeof doc.textToLogicalOffset === 'function'
        ? doc.textToLogicalOffset(sec, para, textOffset)
        : textOffset
    expectEngineOk(doc.splitParagraph(sec, para, logicalOffset), 'splitParagraph')
  }

  const targetParagraphsForFormat = () => {
    const sel = execState.selection ? normalizeSelectionRange(doc, execState.selection) : null
    if (!sel) {
      const caret = clampPosition(
        doc,
        execState.caret.sec,
        execState.caret.para,
        execState.caret.offset,
      )
      execState.caret = caret
      return [{ sec: caret.sec, para: caret.para }]
    }
    const list = []
    for (let sec = sel.startSec; sec <= sel.endSec; sec++) {
      const paraCount = doc.getParagraphCount(sec)
      const pStart = sec === sel.startSec ? sel.startPara : 0
      const pEnd = sec === sel.endSec ? sel.endPara : paraCount - 1
      for (let para = pStart; para <= pEnd; para++) {
        list.push({ sec, para })
      }
    }
    return list
  }

  const finishPlainMove = (keepLineEnd = false) => {
    execState.selection = null
    execState.selectionAnchor = null
    execState.pendingCharFormat = null
    if (!keepLineEnd) {
      execState.atLineEnd = false
    }
  }

  const extendSelectionWith = (moveCoreFn) => {
    if (execState.selectionAnchor === null) {
      if (execState.selection) {
        const sel = normalizeSelectionRange(doc, execState.selection)
        execState.selectionAnchor = sel
          ? { sec: sel.startSec, para: sel.startPara, offset: sel.startOffset }
          : clampPosition(doc, execState.caret.sec, execState.caret.para, execState.caret.offset)
      } else {
        execState.selectionAnchor = clampPosition(
          doc,
          execState.caret.sec,
          execState.caret.para,
          execState.caret.offset,
        )
      }
    }
    moveCoreFn()
    const anchor = clampPosition(
      doc,
      execState.selectionAnchor.sec,
      execState.selectionAnchor.para,
      execState.selectionAnchor.offset,
    )
    const focus = clampPosition(
      doc,
      execState.caret.sec,
      execState.caret.para,
      execState.caret.offset,
    )
    execState.caret = focus
    execState.pendingCharFormat = null
    const cmp = comparePos(anchor, focus)
    if (cmp === 0) {
      execState.selection = null
    } else {
      const [start, end] = cmp < 0 ? [anchor, focus] : [focus, anchor]
      execState.selection = {
        startSec: start.sec,
        startPara: start.para,
        startOffset: start.offset,
        endSec: end.sec,
        endPara: end.para,
        endOffset: end.offset,
      }
    }
  }

  const moveDocBeginCore = () => {
    execState.caret = clampPosition(doc, 0, 0, 0)
    execState.atLineEnd = false
  }

  const moveDocEndCore = () => {
    const lastSec = Math.max(0, doc.getSectionCount() - 1)
    const lastPara = Math.max(0, doc.getParagraphCount(lastSec) - 1)
    const lastLen = Math.max(0, doc.getParagraphLength(lastSec, lastPara))
    execState.caret = { sec: lastSec, para: lastPara, offset: lastLen }
    execState.atLineEnd = false
  }

  const moveParaBeginCore = () => {
    execState.caret = clampPosition(doc, execState.caret.sec, execState.caret.para, 0)
    execState.atLineEnd = false
  }

  const moveParaEndCore = () => {
    const caret = clampPosition(doc, execState.caret.sec, execState.caret.para, 0)
    const len = doc.getParagraphLength(caret.sec, caret.para)
    execState.caret = { sec: caret.sec, para: caret.para, offset: len }
    execState.atLineEnd = false
  }

  const moveLineBeginCore = () => {
    const caret = clampPosition(
      doc,
      execState.caret.sec,
      execState.caret.para,
      execState.caret.offset,
    )
    let lineInfo = getLineInfoSafe(doc, caret.sec, caret.para, caret.offset)
    if (!lineInfo) {
      execState.caret = { sec: caret.sec, para: caret.para, offset: 0 }
      execState.atLineEnd = false
      return
    }
    if (execState.atLineEnd && caret.offset === lineInfo.charStart && caret.offset > 0) {
      const prev = getLineInfoSafe(doc, caret.sec, caret.para, caret.offset - 1)
      if (prev && prev.charEnd === caret.offset) {
        lineInfo = prev
      }
    }
    execState.caret = { sec: caret.sec, para: caret.para, offset: lineInfo.charStart }
    execState.atLineEnd = false
  }

  const moveLineEndCore = () => {
    const caret = clampPosition(
      doc,
      execState.caret.sec,
      execState.caret.para,
      execState.caret.offset,
    )
    let lineInfo = getLineInfoSafe(doc, caret.sec, caret.para, caret.offset)
    if (!lineInfo) {
      const len = doc.getParagraphLength(caret.sec, caret.para)
      execState.caret = { sec: caret.sec, para: caret.para, offset: len }
      execState.atLineEnd = false
      return
    }
    if (execState.atLineEnd && caret.offset === lineInfo.charStart && caret.offset > 0) {
      const prev = getLineInfoSafe(doc, caret.sec, caret.para, caret.offset - 1)
      if (prev && prev.charEnd === caret.offset) {
        lineInfo = prev
      }
    }
    execState.caret = { sec: caret.sec, para: caret.para, offset: lineInfo.charEnd }
    execState.atLineEnd = true
  }

  const stepCaretLeftCore = (count) => {
    let remaining = count
    let iter = 0
    let { sec, para, offset } = clampPosition(
      doc,
      execState.caret.sec,
      execState.caret.para,
      execState.caret.offset,
    )
    while (remaining > 0) {
      if ((iter++ & 255) === 0) checkDeadline()
      if (offset >= remaining) {
        offset -= remaining
        remaining = 0
      } else {
        remaining -= offset
        offset = 0
        if (para > 0) {
          para -= 1
          offset = doc.getParagraphLength(sec, para)
          remaining -= 1
        } else if (sec > 0) {
          sec -= 1
          para = doc.getParagraphCount(sec) - 1
          offset = doc.getParagraphLength(sec, para)
          remaining -= 1
        } else {
          remaining = 0
        }
      }
    }
    execState.caret = { sec, para, offset }
    execState.atLineEnd = false
  }

  const stepCaretRightCore = (count) => {
    let remaining = count
    let iter = 0
    const secCount = doc.getSectionCount()
    let { sec, para, offset } = clampPosition(
      doc,
      execState.caret.sec,
      execState.caret.para,
      execState.caret.offset,
    )
    while (remaining > 0) {
      if ((iter++ & 255) === 0) checkDeadline()
      const paraLen = doc.getParagraphLength(sec, para)
      const avail = paraLen - offset
      if (avail >= remaining) {
        offset += remaining
        remaining = 0
      } else {
        remaining -= avail
        offset = paraLen
        const paraCount = doc.getParagraphCount(sec)
        if (para + 1 < paraCount) {
          para += 1
          offset = 0
          remaining -= 1
        } else if (sec + 1 < secCount) {
          sec += 1
          para = 0
          offset = 0
          remaining -= 1
        } else {
          remaining = 0
        }
      }
    }
    execState.caret = { sec, para, offset }
    execState.atLineEnd = false
  }

  const stepCaretVerticalCore = (direction, count, extendToEdge = false) => {
    const secCount = doc.getSectionCount()
    let { sec, para, offset } = clampPosition(
      doc,
      execState.caret.sec,
      execState.caret.para,
      execState.caret.offset,
    )
    let lines = collectVisualLines(doc, sec, para)
    if (lines && lines.length > 0) {
      let curLineIdx = lines.length - 1
      if (execState.atLineEnd && offset > 0) {
        const endMatch = lines.findIndex((l) => l.charEnd === offset)
        if (endMatch >= 0) {
          curLineIdx = endMatch
        } else {
          const hit = lines.findIndex((l) => offset >= l.charStart && offset < l.charEnd)
          if (hit >= 0) curLineIdx = hit
        }
      } else {
        const hit = lines.findIndex((l) => offset >= l.charStart && offset < l.charEnd)
        if (hit >= 0) curLineIdx = hit
      }
      const desiredCol = Math.max(0, offset - lines[curLineIdx].charStart)
      let remaining = count
      let iter = 0
      let hitEdge = false
      while (remaining > 0) {
        if ((iter++ & 63) === 0) checkDeadline()
        if (direction > 0) {
          if (curLineIdx + 1 < lines.length) {
            const step = Math.min(remaining, lines.length - 1 - curLineIdx)
            curLineIdx += step
            remaining -= step
          } else {
            const paraCount = doc.getParagraphCount(sec)
            if (para + 1 < paraCount) {
              para += 1
            } else if (sec + 1 < secCount) {
              sec += 1
              para = 0
            } else {
              hitEdge = true
              break
            }
            remaining -= 1
            lines = collectVisualLines(doc, sec, para) ?? [
              { lineIndex: 0, charStart: 0, charEnd: doc.getParagraphLength(sec, para) },
            ]
            curLineIdx = 0
          }
        } else {
          if (curLineIdx > 0) {
            const step = Math.min(remaining, curLineIdx)
            curLineIdx -= step
            remaining -= step
          } else if (para > 0) {
            para -= 1
            remaining -= 1
            lines = collectVisualLines(doc, sec, para) ?? [
              { lineIndex: 0, charStart: 0, charEnd: doc.getParagraphLength(sec, para) },
            ]
            curLineIdx = lines.length - 1
          } else if (sec > 0) {
            sec -= 1
            para = doc.getParagraphCount(sec) - 1
            remaining -= 1
            lines = collectVisualLines(doc, sec, para) ?? [
              { lineIndex: 0, charStart: 0, charEnd: doc.getParagraphLength(sec, para) },
            ]
            curLineIdx = lines.length - 1
          } else {
            hitEdge = true
            break
          }
        }
      }
      if (hitEdge && extendToEdge) {
        const edgeOffset = direction > 0 ? doc.getParagraphLength(sec, para) : 0
        execState.caret = clampPosition(doc, sec, para, edgeOffset)
        execState.atLineEnd = false
        return
      }
      const targetLine = lines[curLineIdx]
      const isLastLine = curLineIdx === lines.length - 1
      const maxLineOffset = isLastLine
        ? targetLine.charEnd
        : Math.max(targetLine.charStart, targetLine.charEnd - 1)
      const targetOffset = Math.min(targetLine.charStart + desiredCol, maxLineOffset)
      execState.caret = clampPosition(doc, sec, para, targetOffset)
      execState.atLineEnd = false
      return
    }

    let remaining = count
    let iter = 0
    let hitEdge = false
    while (remaining > 0) {
      if ((iter++ & 255) === 0) checkDeadline()
      if (direction < 0) {
        if (para > 0) {
          para -= 1
        } else if (sec > 0) {
          sec -= 1
          para = doc.getParagraphCount(sec) - 1
        } else {
          hitEdge = true
          break
        }
      } else {
        const paraCount = doc.getParagraphCount(sec)
        if (para + 1 < paraCount) {
          para += 1
        } else if (sec + 1 < secCount) {
          sec += 1
          para = 0
        } else {
          hitEdge = true
          break
        }
      }
      remaining -= 1
    }
    const maxOffset = doc.getParagraphLength(sec, para)
    const finalOffset =
      hitEdge && extendToEdge ? (direction > 0 ? maxOffset : 0) : Math.min(offset, maxOffset)
    execState.caret = { sec, para, offset: finalOffset }
    execState.atLineEnd = false
  }

  const stepWordLeftCore = (count) => {
    let { sec, para, offset } = clampPosition(
      doc,
      execState.caret.sec,
      execState.caret.para,
      execState.caret.offset,
    )
    let cachedSec = -1
    let cachedPara = -1
    let cachedText = ''
    for (let step = 0; step < count; step++) {
      if ((step & 255) === 0) checkDeadline()
      if (offset === 0) {
        if (para > 0) {
          para -= 1
          offset = doc.getParagraphLength(sec, para)
          continue
        }
        if (sec > 0) {
          sec -= 1
          para = doc.getParagraphCount(sec) - 1
          offset = doc.getParagraphLength(sec, para)
          continue
        }
        break
      }
      if (sec !== cachedSec || para !== cachedPara) {
        cachedSec = sec
        cachedPara = para
        cachedText = readParagraphText(doc, sec, para)
      }
      let i = offset
      while (i > 0 && !WORD_CHAR_RE.test(cachedText[i - 1])) i -= 1
      while (i > 0 && WORD_CHAR_RE.test(cachedText[i - 1])) i -= 1
      offset = i
    }
    execState.caret = { sec, para, offset }
    execState.atLineEnd = false
  }

  const stepWordRightCore = (count) => {
    const secCount = doc.getSectionCount()
    let { sec, para, offset } = clampPosition(
      doc,
      execState.caret.sec,
      execState.caret.para,
      execState.caret.offset,
    )
    let cachedSec = -1
    let cachedPara = -1
    let cachedText = ''
    for (let step = 0; step < count; step++) {
      if ((step & 255) === 0) checkDeadline()
      if (sec !== cachedSec || para !== cachedPara) {
        cachedSec = sec
        cachedPara = para
        cachedText = readParagraphText(doc, sec, para)
      }
      if (offset >= cachedText.length) {
        const paraCount = doc.getParagraphCount(sec)
        if (para + 1 < paraCount) {
          para += 1
          offset = 0
          continue
        }
        if (sec + 1 < secCount) {
          sec += 1
          para = 0
          offset = 0
          continue
        }
        break
      }
      let i = offset
      while (i < cachedText.length && WORD_CHAR_RE.test(cachedText[i])) i += 1
      while (i < cachedText.length && !WORD_CHAR_RE.test(cachedText[i])) i += 1
      offset = i
    }
    execState.caret = { sec, para, offset }
    execState.atLineEnd = false
  }

  const deleteBackwardInternal = (count) => {
    if (execState.selection) {
      return deleteSelectionInternal()
    }
    let remaining = count
    let deletedAny = false
    let iter = 0
    while (remaining > 0) {
      if ((iter++ & 63) === 0) checkDeadline()
      const caret = clampPosition(
        doc,
        execState.caret.sec,
        execState.caret.para,
        execState.caret.offset,
      )
      execState.caret = caret
      if (caret.offset > 0) {
        const take = Math.min(remaining, caret.offset)
        const blocker = findProtectedStepDeletionBlocker(doc, caret, 'backward', take)
        if (blocker) {
          failHost(blocker.code, blocker.message)
        }
        const startOffset = caret.offset - take
        expectEngineOk(doc.deleteText(caret.sec, caret.para, startOffset, take), 'deleteBackward')
        execState.caret = clampPosition(doc, caret.sec, caret.para, startOffset)
        execState.mutated = true
        deletedAny = true
        remaining -= take
      } else if (caret.para > 0) {
        const blocker = findProtectedStepDeletionBlocker(doc, caret, 'backward', 1)
        if (blocker) {
          failHost(blocker.code, blocker.message)
        }
        const prevPara = caret.para - 1
        const prevLen = doc.getParagraphLength(caret.sec, prevPara)
        expectEngineOk(
          doc.deleteRange(caret.sec, prevPara, prevLen, caret.para, 0),
          'deleteBackward',
        )
        execState.caret = clampPosition(doc, caret.sec, prevPara, prevLen)
        execState.mutated = true
        deletedAny = true
        remaining -= 1
      } else {
        break
      }
    }
    execState.selection = null
    execState.selectionAnchor = null
    execState.atLineEnd = false
    if (deletedAny) {
      checkObjectsPreserved()
    }
    return deletedAny
  }

  const deleteForwardInternal = (count) => {
    if (execState.selection) {
      return deleteSelectionInternal()
    }
    let remaining = count
    let deletedAny = false
    let iter = 0
    while (remaining > 0) {
      if ((iter++ & 63) === 0) checkDeadline()
      const caret = clampPosition(
        doc,
        execState.caret.sec,
        execState.caret.para,
        execState.caret.offset,
      )
      execState.caret = caret
      const paraLen = doc.getParagraphLength(caret.sec, caret.para)
      if (caret.offset < paraLen) {
        const take = Math.min(remaining, paraLen - caret.offset)
        const blocker = findProtectedStepDeletionBlocker(doc, caret, 'forward', take)
        if (blocker) {
          failHost(blocker.code, blocker.message)
        }
        expectEngineOk(doc.deleteText(caret.sec, caret.para, caret.offset, take), 'deleteForward')
        execState.caret = clampPosition(doc, caret.sec, caret.para, caret.offset)
        execState.mutated = true
        deletedAny = true
        remaining -= take
      } else if (caret.para + 1 < doc.getParagraphCount(caret.sec)) {
        const blocker = findProtectedStepDeletionBlocker(doc, caret, 'forward', 1)
        if (blocker) {
          failHost(blocker.code, blocker.message)
        }
        const nextPara = caret.para + 1
        expectEngineOk(
          doc.deleteRange(caret.sec, caret.para, paraLen, nextPara, 0),
          'deleteForward',
        )
        execState.caret = clampPosition(doc, caret.sec, caret.para, paraLen)
        execState.mutated = true
        deletedAny = true
        remaining -= 1
      } else {
        break
      }
    }
    execState.selection = null
    execState.selectionAnchor = null
    execState.atLineEnd = false
    if (deletedAny) {
      checkObjectsPreserved()
    }
    return deletedAny
  }

  const api = {
    // -----------------------------------------------------------------------
    // Text & Breaks
    // -----------------------------------------------------------------------
    insertText(text) {
      if (text === null || text === undefined || typeof text === 'object') {
        failHost('invalid_argument', 'insertText requires a string, number, or boolean')
      }
      const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      if (normalized.length > limits.maxStringLength) {
        failHost('memory_limit', `String length limit (${limits.maxStringLength}) exceeded`)
      }
      if (normalized.length > limits.maxInsertCharsPerCall) {
        failHost(
          'memory_limit',
          `insertText length (${normalized.length}) exceeds per-call limit (${limits.maxInsertCharsPerCall})`,
        )
      }
      if (execState.totalInsertedChars + normalized.length > limits.maxTotalInsertChars) {
        failHost(
          'memory_limit',
          `Cumulative inserted text exceeds limit (${limits.maxTotalInsertChars} characters)`,
        )
      }
      if (execState.selection) {
        deleteSelectionInternal()
      }
      execState.caret = clampPosition(
        doc,
        execState.caret.sec,
        execState.caret.para,
        execState.caret.offset,
      )
      const pendingJson = execState.pendingCharFormat
        ? JSON.stringify(execState.pendingCharFormat)
        : null
      const lines = normalized.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if ((i & 63) === 0) checkDeadline()
        if (i > 0) {
          splitParagraphAt(execState.caret.sec, execState.caret.para, execState.caret.offset)
          execState.caret = {
            sec: execState.caret.sec,
            para: execState.caret.para + 1,
            offset: 0,
          }
          execState.mutated = true
        }
        const segment = lines[i]
        if (segment.length > 0) {
          const insertStart = execState.caret.offset
          expectEngineOk(
            doc.insertText(execState.caret.sec, execState.caret.para, insertStart, segment),
            'insertText',
          )
          if (pendingJson !== null) {
            expectEngineOk(
              doc.applyCharFormat(
                execState.caret.sec,
                execState.caret.para,
                insertStart,
                insertStart + segment.length,
                pendingJson,
              ),
              'insertText',
            )
          }
          execState.caret = {
            sec: execState.caret.sec,
            para: execState.caret.para,
            offset: insertStart + segment.length,
          }
          execState.mutated = true
        }
      }
      execState.totalInsertedChars += normalized.length
      execState.selection = null
      execState.selectionAnchor = null
      execState.atLineEnd = false
      checkObjectsPreserved()
    },

    breakPara() {
      if (execState.selection) {
        deleteSelectionInternal()
      }
      execState.caret = clampPosition(
        doc,
        execState.caret.sec,
        execState.caret.para,
        execState.caret.offset,
      )
      splitParagraphAt(execState.caret.sec, execState.caret.para, execState.caret.offset)
      execState.caret = {
        sec: execState.caret.sec,
        para: execState.caret.para + 1,
        offset: 0,
      }
      execState.selection = null
      execState.selectionAnchor = null
      execState.atLineEnd = false
      execState.mutated = true
      checkObjectsPreserved()
    },

    breakPage() {
      if (execState.selection) {
        deleteSelectionInternal()
      }
      execState.caret = clampPosition(
        doc,
        execState.caret.sec,
        execState.caret.para,
        execState.caret.offset,
      )
      splitParagraphAt(execState.caret.sec, execState.caret.para, execState.caret.offset)
      const nextPara = execState.caret.para + 1
      expectEngineOk(
        doc.applyParaFormat(
          execState.caret.sec,
          nextPara,
          JSON.stringify({ pageBreakBefore: true }),
        ),
        'breakPage',
      )
      execState.caret = {
        sec: execState.caret.sec,
        para: nextPara,
        offset: 0,
      }
      execState.selection = null
      execState.selectionAnchor = null
      execState.atLineEnd = false
      execState.mutated = true
      checkObjectsPreserved()
    },

    deleteSelection() {
      return deleteSelectionInternal()
    },

    deleteBackward(count = 1) {
      const n = count === undefined ? 1 : assertPositiveInt(count, 'count')
      return deleteBackwardInternal(n)
    },

    deleteForward(count = 1) {
      const n = count === undefined ? 1 : assertPositiveInt(count, 'count')
      return deleteForwardInternal(n)
    },

    // -----------------------------------------------------------------------
    // Caret & Selection Movement
    // -----------------------------------------------------------------------
    moveDocBegin() {
      moveDocBeginCore()
      finishPlainMove()
    },

    moveDocEnd() {
      moveDocEndCore()
      finishPlainMove()
    },

    moveParaBegin() {
      moveParaBeginCore()
      finishPlainMove()
    },

    moveParaEnd() {
      moveParaEndCore()
      finishPlainMove()
    },

    moveLineBegin() {
      moveLineBeginCore()
      finishPlainMove()
    },

    moveLineEnd() {
      moveLineEndCore()
      finishPlainMove(true)
    },

    moveLeft(count = 1) {
      const n = count === undefined ? 1 : assertPositiveInt(count, 'count')
      stepCaretLeftCore(n)
      finishPlainMove()
    },

    moveRight(count = 1) {
      const n = count === undefined ? 1 : assertPositiveInt(count, 'count')
      stepCaretRightCore(n)
      finishPlainMove()
    },

    moveUp(count = 1) {
      const n = count === undefined ? 1 : assertPositiveInt(count, 'count')
      stepCaretVerticalCore(-1, n)
      finishPlainMove()
    },

    moveDown(count = 1) {
      const n = count === undefined ? 1 : assertPositiveInt(count, 'count')
      stepCaretVerticalCore(1, n)
      finishPlainMove()
    },

    moveWordLeft(count = 1) {
      const n = count === undefined ? 1 : assertPositiveInt(count, 'count')
      stepWordLeftCore(n)
      finishPlainMove()
    },

    moveWordRight(count = 1) {
      const n = count === undefined ? 1 : assertPositiveInt(count, 'count')
      stepWordRightCore(n)
      finishPlainMove()
    },

    selectLeft(count = 1) {
      const n = count === undefined ? 1 : assertPositiveInt(count, 'count')
      extendSelectionWith(() => stepCaretLeftCore(n))
    },

    selectRight(count = 1) {
      const n = count === undefined ? 1 : assertPositiveInt(count, 'count')
      extendSelectionWith(() => stepCaretRightCore(n))
    },

    selectUp(count = 1) {
      const n = count === undefined ? 1 : assertPositiveInt(count, 'count')
      extendSelectionWith(() => stepCaretVerticalCore(-1, n, true))
    },

    selectDown(count = 1) {
      const n = count === undefined ? 1 : assertPositiveInt(count, 'count')
      extendSelectionWith(() => stepCaretVerticalCore(1, n, true))
    },

    selectWordLeft(count = 1) {
      const n = count === undefined ? 1 : assertPositiveInt(count, 'count')
      extendSelectionWith(() => stepWordLeftCore(n))
    },

    selectWordRight(count = 1) {
      const n = count === undefined ? 1 : assertPositiveInt(count, 'count')
      extendSelectionWith(() => stepWordRightCore(n))
    },

    selectLineBegin() {
      extendSelectionWith(() => moveLineBeginCore())
    },

    selectLineEnd() {
      extendSelectionWith(() => moveLineEndCore())
    },

    selectParaBegin() {
      extendSelectionWith(() => moveParaBeginCore())
    },

    selectParaEnd() {
      extendSelectionWith(() => moveParaEndCore())
    },

    selectDocBegin() {
      extendSelectionWith(() => moveDocBeginCore())
    },

    selectDocEnd() {
      extendSelectionWith(() => moveDocEndCore())
    },

    select(fromSec, fromPara, fromOffset, toSec, toPara, toOffset) {
      assertValidParagraph(fromSec, fromPara, 'fromPara')
      assertValidParagraph(toSec, toPara, 'toPara')
      const fromLen = doc.getParagraphLength(fromSec, fromPara)
      const toLen = doc.getParagraphLength(toSec, toPara)
      assertNonNegativeInt(fromOffset, 'fromOffset', fromLen)
      assertNonNegativeInt(toOffset, 'toOffset', toLen)

      const a = { sec: fromSec, para: fromPara, offset: fromOffset }
      const b = { sec: toSec, para: toPara, offset: toOffset }
      const [start, end] = comparePos(a, b) <= 0 ? [a, b] : [b, a]
      execState.selection = {
        startSec: start.sec,
        startPara: start.para,
        startOffset: start.offset,
        endSec: end.sec,
        endPara: end.para,
        endOffset: end.offset,
      }
      execState.selectionAnchor = { sec: a.sec, para: a.para, offset: a.offset }
      execState.caret = { sec: b.sec, para: b.para, offset: b.offset }
      execState.pendingCharFormat = null
      execState.atLineEnd = false
    },

    selectAll() {
      const lastSec = Math.max(0, doc.getSectionCount() - 1)
      const lastPara = Math.max(0, doc.getParagraphCount(lastSec) - 1)
      const lastLen = Math.max(0, doc.getParagraphLength(lastSec, lastPara))
      execState.selection = {
        startSec: 0,
        startPara: 0,
        startOffset: 0,
        endSec: lastSec,
        endPara: lastPara,
        endOffset: lastLen,
      }
      execState.selectionAnchor = { sec: 0, para: 0, offset: 0 }
      execState.caret = { sec: lastSec, para: lastPara, offset: lastLen }
      execState.pendingCharFormat = null
      execState.atLineEnd = false
    },

    cancelSelection() {
      execState.selection = null
      execState.selectionAnchor = null
      execState.pendingCharFormat = null
    },

    getCaret() {
      const c = clampPosition(
        doc,
        execState.caret.sec,
        execState.caret.para,
        execState.caret.offset,
      )
      execState.caret = c
      return sanitizeHostValue({ sec: c.sec, para: c.para, offset: c.offset }, limits)
    },

    getSelection() {
      if (!execState.selection) return null
      const sel = normalizeSelectionRange(doc, execState.selection)
      if (!sel) return null
      execState.selection = sel
      const text = readSelectionText(doc, sel, limits.maxStringLength)
      return sanitizeHostValue(
        {
          startSec: sel.startSec,
          startPara: sel.startPara,
          startOffset: sel.startOffset,
          endSec: sel.endSec,
          endPara: sel.endPara,
          endOffset: sel.endOffset,
          text,
        },
        limits,
      )
    },

    // -----------------------------------------------------------------------
    // Character & Paragraph Formatting + Styles
    // -----------------------------------------------------------------------
    setCharFormat(props) {
      if (!isPlainRecord(props)) {
        failHost('invalid_argument', 'setCharFormat requires a plain object')
      }
      const engineProps = {}
      let hasAny = false

      for (const toggle of ['bold', 'italic', 'underline', 'strikethrough']) {
        if (props[toggle] !== undefined && props[toggle] !== null) {
          if (typeof props[toggle] !== 'boolean') {
            failHost('invalid_argument', `Invalid ${toggle}: expected boolean`)
          }
          engineProps[toggle] = props[toggle]
          hasAny = true
        }
      }

      const rawSize =
        props.fontSize !== undefined && props.fontSize !== null ? props.fontSize : props.size
      if (rawSize !== undefined && rawSize !== null) {
        const pt = assertFiniteRange(rawSize, 'fontSize', MIN_FONT_PT, MAX_FONT_PT)
        engineProps.fontSize = Math.round(pt * 100)
        hasAny = true
      }

      const rawFont =
        props.fontName !== undefined && props.fontName !== null ? props.fontName : props.font
      if (rawFont !== undefined && rawFont !== null) {
        if (
          typeof rawFont !== 'string' ||
          rawFont.trim().length === 0 ||
          rawFont.trim().length > MAX_FONT_NAME ||
          CONTROL_CHARS_RE.test(rawFont)
        ) {
          failHost(
            'invalid_argument',
            `Invalid fontName: expected non-empty string up to ${MAX_FONT_NAME} characters`,
          )
        }
        const fontName = rawFont.trim()
        if (typeof doc.findOrCreateFontIdForLang === 'function') {
          const ids = []
          for (let lang = 0; lang < FONT_LANGUAGES; lang++) {
            const id = doc.findOrCreateFontIdForLang(lang, fontName)
            if (!Number.isInteger(id) || id < 0) {
              failHost('engine_error', `Failed to register font "${fontName}"`)
            }
            ids.push(id)
          }
          engineProps.fontIds = ids
        } else {
          engineProps.fontFamily = fontName
        }
        hasAny = true
      }

      const rawColor =
        props.textColor !== undefined && props.textColor !== null ? props.textColor : props.color
      if (rawColor !== undefined && rawColor !== null) {
        const hex = normalizeColorHex(rawColor)
        if (!hex) {
          failHost('invalid_argument', 'Invalid color: expected #RRGGBB hex string')
        }
        engineProps.textColor = hex
        hasAny = true
      }

      if (!hasAny) {
        failHost('invalid_argument', 'setCharFormat specifies no character properties')
      }

      const sel = execState.selection ? normalizeSelectionRange(doc, execState.selection) : null
      const hasNonEmptySelection =
        sel !== null &&
        !(
          sel.startSec === sel.endSec &&
          sel.startPara === sel.endPara &&
          sel.startOffset === sel.endOffset
        )
      if (hasNonEmptySelection) {
        const json = JSON.stringify(engineProps)
        for (let sec = sel.startSec; sec <= sel.endSec; sec++) {
          const paraCount = doc.getParagraphCount(sec)
          const pStart = sec === sel.startSec ? sel.startPara : 0
          const pEnd = sec === sel.endSec ? sel.endPara : paraCount - 1
          for (let para = pStart; para <= pEnd; para++) {
            const len = doc.getParagraphLength(sec, para)
            const segStart = sec === sel.startSec && para === sel.startPara ? sel.startOffset : 0
            const segEnd = sec === sel.endSec && para === sel.endPara ? sel.endOffset : len
            if (segEnd > segStart) {
              expectEngineOk(
                doc.applyCharFormat(sec, para, segStart, segEnd, json),
                'setCharFormat',
              )
              execState.mutated = true
            }
          }
        }
        execState.pendingCharFormat = null
        checkObjectsPreserved()
      } else {
        execState.pendingCharFormat = execState.pendingCharFormat
          ? { ...execState.pendingCharFormat, ...engineProps }
          : { ...engineProps }
      }
    },

    setParaFormat(props) {
      if (!isPlainRecord(props)) {
        failHost('invalid_argument', 'setParaFormat requires a plain object')
      }
      const engineProps = {}
      let hasAny = false

      const rawAlign =
        props.align !== undefined && props.align !== null ? props.align : props.alignment
      if (rawAlign !== undefined && rawAlign !== null) {
        if (typeof rawAlign !== 'string' || !ALIGNMENTS.has(rawAlign)) {
          failHost('invalid_argument', 'Invalid align: expected left, center, right, or justify')
        }
        engineProps.alignment = rawAlign
        hasAny = true
      }

      if (props.lineSpacing !== undefined && props.lineSpacing !== null) {
        const pct = assertFiniteRange(
          props.lineSpacing,
          'lineSpacing',
          MIN_LINE_SPACING,
          MAX_LINE_SPACING,
        )
        engineProps.lineSpacing = Math.round(pct)
        engineProps.lineSpacingType = 'Percent'
        hasAny = true
      }

      const rawLeft =
        props.leftMargin !== undefined && props.leftMargin !== null
          ? props.leftMargin
          : props.marginLeft
      if (rawLeft !== undefined && rawLeft !== null) {
        const pt = assertFiniteRange(rawLeft, 'leftMargin', 0, 300)
        engineProps.marginLeft = paraUnitsOf(pt)
        hasAny = true
      }

      const rawRight =
        props.rightMargin !== undefined && props.rightMargin !== null
          ? props.rightMargin
          : props.marginRight
      if (rawRight !== undefined && rawRight !== null) {
        const pt = assertFiniteRange(rawRight, 'rightMargin', 0, 300)
        engineProps.marginRight = paraUnitsOf(pt)
        hasAny = true
      }

      const rawIndent =
        props.firstLineIndent !== undefined && props.firstLineIndent !== null
          ? props.firstLineIndent
          : props.indent
      if (rawIndent !== undefined && rawIndent !== null) {
        const pt = assertFiniteRange(rawIndent, 'firstLineIndent', -100, 100)
        engineProps.indent = paraUnitsOf(pt)
        hasAny = true
      }

      const rawBefore =
        props.spaceBefore !== undefined && props.spaceBefore !== null
          ? props.spaceBefore
          : props.spacingBefore
      if (rawBefore !== undefined && rawBefore !== null) {
        const pt = assertFiniteRange(rawBefore, 'spaceBefore', 0, 200)
        engineProps.spacingBefore = paraUnitsOf(pt)
        hasAny = true
      }

      const rawAfter =
        props.spaceAfter !== undefined && props.spaceAfter !== null
          ? props.spaceAfter
          : props.spacingAfter
      if (rawAfter !== undefined && rawAfter !== null) {
        const pt = assertFiniteRange(rawAfter, 'spaceAfter', 0, 200)
        engineProps.spacingAfter = paraUnitsOf(pt)
        hasAny = true
      }

      if (props.pageBreakBefore !== undefined && props.pageBreakBefore !== null) {
        if (typeof props.pageBreakBefore !== 'boolean') {
          failHost('invalid_argument', 'Invalid pageBreakBefore: expected boolean')
        }
        engineProps.pageBreakBefore = props.pageBreakBefore
        hasAny = true
      }

      if (!hasAny) {
        failHost('invalid_argument', 'setParaFormat specifies no paragraph properties')
      }

      const json = JSON.stringify(engineProps)
      for (const { sec, para } of targetParagraphsForFormat()) {
        expectEngineOk(doc.applyParaFormat(sec, para, json), 'setParaFormat')
        execState.mutated = true
      }
      checkObjectsPreserved()
    },

    applyStyle(nameOrId) {
      const styles = parseJson(doc.getStyleList(), [])
      if (!Array.isArray(styles)) {
        failHost('engine_error', 'Failed to read document style list')
      }
      let matched = null
      if (typeof nameOrId === 'number') {
        assertNonNegativeInt(nameOrId, 'styleId')
        matched = styles.find((s) => s && s.id === nameOrId) ?? null
      } else if (typeof nameOrId === 'string') {
        const trimmed = nameOrId.trim()
        if (!trimmed) {
          failHost('invalid_argument', 'Style name must be a non-empty string')
        }
        matched = styles.find((s) => s && (s.name === trimmed || s.englishName === trimmed)) ?? null
      } else {
        failHost('invalid_argument', 'applyStyle requires a style name or numeric style id')
      }

      if (!matched) {
        failHost('invalid_argument', `Style "${nameOrId}" does not exist in document`)
      }

      for (const { sec, para } of targetParagraphsForFormat()) {
        expectEngineOk(doc.applyStyle(sec, para, matched.id), 'applyStyle')
        execState.mutated = true
      }
      checkObjectsPreserved()
    },

    // -----------------------------------------------------------------------
    // Find & Replace
    // -----------------------------------------------------------------------
    find(query, opts = undefined) {
      if (typeof query !== 'string') {
        failHost('invalid_argument', 'find requires a string query')
      }
      if (opts !== undefined && opts !== null && !isPlainRecord(opts)) {
        failHost('invalid_argument', 'find options must be a plain object')
      }
      const findOpts = {
        query,
        caseSensitive: Boolean(opts?.caseSensitive),
        wholeWord: Boolean(opts?.wholeWord),
        regex: Boolean(opts?.regex),
        style: typeof opts?.style === 'string' && opts.style.trim() ? opts.style.trim() : null,
      }
      execState.lastFind = { ...findOpts }
      const result = runMacroFind(doc, findOpts, {
        checkDeadline,
        regexRunOpts,
        maxRegexLength: limits.maxRegexLength,
        includePage: true,
        keepRegexMeta: false,
      })
      if (!result.ok) {
        failHost('invalid_argument', result.error || 'Invalid find query')
      }
      if (result.matches.length > limits.maxCollectionSize) {
        failHost(
          'memory_limit',
          `Find results exceed collection limit (${limits.maxCollectionSize})`,
        )
      }
      const out = result.matches.map((m) => ({
        kind: m.kind,
        sec: m.sec,
        para: m.para,
        offset: m.offset,
        length: m.length,
        matchText: m.matchText,
        page: m.page,
      }))
      return sanitizeHostValue(out, limits)
    },

    replaceAll(query, replacement, opts = undefined) {
      if (typeof query !== 'string' || query.length === 0) {
        failHost('invalid_argument', 'replaceAll requires a non-empty string query')
      }
      if (typeof replacement !== 'string') {
        failHost('invalid_argument', 'replaceAll requires a string replacement')
      }
      if (PARAGRAPH_CONTROL_CHARS.test(replacement)) {
        failHost(
          'invalid_argument',
          'Replacement text must be a string without line breaks or control characters.',
        )
      }
      if (opts !== undefined && opts !== null && !isPlainRecord(opts)) {
        failHost('invalid_argument', 'replaceAll options must be a plain object')
      }
      const findOpts = {
        query,
        caseSensitive: Boolean(opts?.caseSensitive),
        wholeWord: Boolean(opts?.wholeWord),
        regex: Boolean(opts?.regex),
        style: typeof opts?.style === 'string' && opts.style.trim() ? opts.style.trim() : null,
      }
      execState.lastFind = { ...findOpts, replacement }
      const found = runMacroFind(doc, findOpts, {
        checkDeadline,
        regexRunOpts,
        maxRegexLength: limits.maxRegexLength,
        includePage: false,
        keepRegexMeta: findOpts.regex,
        collectBodyText: true,
      })
      if (!found.ok) {
        failHost('invalid_argument', found.error || 'replaceAll failed')
      }

      let skippedObjects = 0
      let skippedCitations = 0
      const byContainer = new Map()
      for (let idx = 0; idx < found.matches.length; idx++) {
        if ((idx & 255) === 0) checkDeadline()
        const match = found.matches[idx]
        if (match.spansObject) {
          skippedObjects += 1
          continue
        }
        if (match.inCitation) {
          skippedCitations += 1
          continue
        }
        const meta = findOpts.regex ? found.regexMeta[idx] : null
        const text = meta
          ? expandMacroRegexReplacement(replacement, meta.regexMatch, meta.fullText)
          : replacement
        if (PARAGRAPH_CONTROL_CHARS.test(text)) {
          failHost(
            'invalid_argument',
            'Expanded replacement contains disallowed control characters.',
          )
        }
        const key = macroContainerKeyOf(match)
        let bucket = byContainer.get(key)
        if (!bucket) {
          bucket = []
          byContainer.set(key, bucket)
        }
        bucket.push({ match, text })
      }

      const memoRangesByPara = new Map()
      if (byContainer.size > 0) {
        const memos = memoEntriesOf(doc)
        for (const memo of memos) {
          if (memo?.place !== 'body') continue
          if (!Number.isInteger(memo.sectionIndex) || !Number.isInteger(memo.paraIndex)) continue
          const mStart = Number.isInteger(memo.startCharIdx) ? memo.startCharIdx : 0
          const mEnd = Number.isInteger(memo.endCharIdx) ? memo.endCharIdx : mStart
          const pKey = `${memo.sectionIndex}:${memo.paraIndex}`
          let list = memoRangesByPara.get(pKey)
          if (!list) {
            list = []
            memoRangesByPara.set(pKey, list)
          }
          list.push({ start: Math.min(mStart, mEnd), end: Math.max(mStart, mEnd) })
        }
      }

      const replaceSingleBodyMatch = (match, text) => {
        const { sec, para, offset, length } = match
        if (text.length > 0 && followsInlineObject(doc, sec, para, offset, length)) {
          expectEngineOk(doc.replaceText(sec, para, offset + 1, length - 1, text), 'replaceAll')
          expectEngineOk(doc.deleteText(sec, para, offset, 1), 'replaceAll')
          return
        }
        expectEngineOk(doc.replaceText(sec, para, offset, length, text), 'replaceAll')
      }

      const replaceSingleNonBodyMatch = (match, text) => {
        const { kind, sec, para, offset, length } = match
        if (kind === 'table' || kind === 'textbox') {
          const path = match.path
          const pathJson = JSON.stringify(path)
          if (text.length === 0) {
            expectEngineOk(
              doc.deleteTextInCellByPath(sec, para, pathJson, offset, length),
              'delete',
            )
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
              expectEngineOk(
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
                'replaceAll',
              )
              removed = start + 1
            }
            const headLength = Array.from(head).length
            const totalLength = Array.from(text).length
            expectEngineOk(
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
              'replaceAll',
            )
            if (headLength < totalLength) {
              expectEngineOk(
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
          expectEngineOk(doc.deleteTextInCellByPath(sec, para, pathJson, offset, length), 'delete')
          expectEngineOk(doc.insertTextInCellByPath(sec, para, pathJson, offset, text), 'insert')
          return
        }

        if (kind === 'footnote' || kind === 'endnote') {
          const { noteControl, notePara } = match
          if (length > 0) {
            expectEngineOk(
              doc.deleteTextInFootnote(sec, para, noteControl, notePara, offset, length),
              'delete',
            )
          }
          if (text.length > 0) {
            expectEngineOk(
              doc.insertTextInFootnote(sec, para, noteControl, notePara, offset, text),
              'insert',
            )
          }
        }
      }

      let replaced = 0
      const hasBatch = typeof doc.beginBatch === 'function' && typeof doc.endBatch === 'function'
      if (hasBatch && byContainer.size > 0) {
        doc.beginBatch()
      }
      try {
        for (const bucket of byContainer.values()) {
          checkDeadline()
          if (bucket.length === 0) continue
          const firstKind = bucket[0].match.kind

          if (firstKind === 'body') {
            if (bucket.length === 1) {
              replaceSingleBodyMatch(bucket[0].match, bucket[0].text)
              replaced += 1
              continue
            }

            bucket.sort((a, b) => a.match.offset - b.match.offset)
            const { sec, para } = bucket[0].match
            const pKey = `${sec}:${para}`
            const paraInfo = found.bodyTextByPara.get(pKey)
            const paraLen = paraInfo ? paraInfo.chars.length : doc.getParagraphLength(sec, para)
            const charRuns =
              typeof doc.getCharShapeRuns === 'function'
                ? tryOr(() => parseJson(doc.getCharShapeRuns(sec, para, 0, paraLen), []), [])
                : []
            const hasMultipleRuns = Array.isArray(charRuns) && charRuns.length > 1
            const paraMemos = memoRangesByPara.get(pKey) ?? null
            const paraCitations = found.citationRanges.get(pKey) ?? null
            const rawParaControls = found.controlsByPara.get(pKey) ?? null
            let inlineCtrlPositions = null
            if (rawParaControls && rawParaControls.length > 0) {
              const nonLayout = rawParaControls.filter(
                (c) => c && !SECTION_LAYOUT_CTRL_IDS.has(c.ctrlId),
              )
              if (nonLayout.length > 0) {
                const posArr =
                  typeof doc.getControlTextPositions === 'function'
                    ? tryOr(() => parseJson(doc.getControlTextPositions(sec, para), []), [])
                    : []
                inlineCtrlPositions = []
                for (const c of nonLayout) {
                  const p =
                    Array.isArray(posArr) && Number.isInteger(posArr[c.controlIndex])
                      ? posArr[c.controlIndex]
                      : 0
                  inlineCtrlPositions.push(p)
                }
              }
            }

            const findRunContaining = (start, end) => {
              if (!hasMultipleRuns) return true
              for (let r = 0; r < charRuns.length; r++) {
                const run = charRuns[r]
                if (run.startOffset <= start && end <= run.endOffset) return true
              }
              return false
            }

            const spanClearOfBoundaries = (start, end) => {
              if (inlineCtrlPositions !== null) {
                for (let k = 0; k < inlineCtrlPositions.length; k++) {
                  const p = inlineCtrlPositions[k]
                  if (p >= start && p <= end) return false
                }
              }
              if (paraMemos !== null) {
                for (let k = 0; k < paraMemos.length; k++) {
                  if (start <= paraMemos[k].end && paraMemos[k].start <= end) return false
                }
              }
              if (paraCitations !== null) {
                for (let k = 0; k < paraCitations.length; k++) {
                  if (start <= paraCitations[k].end && paraCitations[k].start <= end) return false
                }
              }
              return findRunContaining(start, end)
            }

            // Partition ascending matches into maximal coalescable contiguous spans.
            const groups = []
            for (let i = 0; i < bucket.length; i++) {
              const item = bucket[i]
              const prevGroup = groups.length > 0 ? groups[groups.length - 1] : null
              const itemEnd = item.match.offset + item.match.length
              const itemFollowsObj = followsInlineObject(
                doc,
                sec,
                para,
                item.match.offset,
                item.match.length,
              )
              if (
                prevGroup !== null &&
                paraInfo &&
                !itemFollowsObj &&
                !prevGroup.followsObj &&
                spanClearOfBoundaries(prevGroup.start, itemEnd)
              ) {
                prevGroup.items.push(item)
                prevGroup.end = itemEnd
              } else {
                groups.push({
                  start: item.match.offset,
                  end: itemEnd,
                  followsObj: itemFollowsObj,
                  items: [item],
                })
              }
            }

            const isBmp = paraInfo && paraInfo.chars.length === paraInfo.text.length
            for (let g = groups.length - 1; g >= 0; g--) {
              if ((g & 15) === 0) checkDeadline()
              const group = groups[g]
              if (group.items.length === 1) {
                replaceSingleBodyMatch(group.items[0].match, group.items[0].text)
                replaced += 1
              } else {
                const spanStart = group.start
                const spanLen = group.end - spanStart
                let combined = ''
                let cursor = spanStart
                for (let i = 0; i < group.items.length; i++) {
                  const it = group.items[i]
                  if (it.match.offset > cursor) {
                    combined += isBmp
                      ? paraInfo.text.slice(cursor, it.match.offset)
                      : paraInfo.chars.slice(cursor, it.match.offset).join('')
                  }
                  combined += it.text
                  cursor = it.match.offset + it.match.length
                }
                expectEngineOk(
                  doc.replaceText(sec, para, spanStart, spanLen, combined),
                  'replaceAll',
                )
                replaced += group.items.length
              }
            }
          } else {
            bucket.sort((a, b) => b.match.offset - a.match.offset)
            for (let i = 0; i < bucket.length; i++) {
              if ((i & 15) === 0) checkDeadline()
              replaceSingleNonBodyMatch(bucket[i].match, bucket[i].text)
              replaced += 1
            }
          }
        }
      } finally {
        if (hasBatch && byContainer.size > 0) {
          doc.endBatch()
        }
      }

      if (replaced > 0) {
        execState.mutated = true
      }
      execState.caret = clampPosition(
        doc,
        execState.caret.sec,
        execState.caret.para,
        execState.caret.offset,
      )
      execState.selection = null
      execState.selectionAnchor = null
      execState.atLineEnd = false
      checkObjectsPreserved()
      return sanitizeHostValue(
        {
          replaced,
          skippedObjects,
          skippedCitations,
        },
        limits,
      )
    },

    replaceNext(query, replacement, opts = undefined) {
      if (typeof query !== 'string' || query.length === 0) {
        failHost('invalid_argument', 'replaceNext requires a non-empty string query')
      }
      if (typeof replacement !== 'string') {
        failHost('invalid_argument', 'replaceNext requires a string replacement')
      }
      if (PARAGRAPH_CONTROL_CHARS.test(replacement)) {
        failHost(
          'invalid_argument',
          'Replacement text must be a string without line breaks or control characters.',
        )
      }
      if (opts !== undefined && opts !== null && !isPlainRecord(opts)) {
        failHost('invalid_argument', 'replaceNext options must be a plain object')
      }
      const findOpts = {
        query,
        caseSensitive: Boolean(opts?.caseSensitive),
        wholeWord: Boolean(opts?.wholeWord),
        regex: Boolean(opts?.regex),
        style: typeof opts?.style === 'string' && opts.style.trim() ? opts.style.trim() : null,
      }
      execState.lastFind = { ...findOpts, replacement }
      const found = runMacroFind(doc, findOpts, {
        checkDeadline,
        regexRunOpts,
        maxRegexLength: limits.maxRegexLength,
        includePage: false,
        keepRegexMeta: findOpts.regex,
      })
      if (!found.ok) {
        failHost('invalid_argument', found.error || 'Invalid find query')
      }
      const caret = clampPosition(
        doc,
        execState.caret.sec,
        execState.caret.para,
        execState.caret.offset,
      )
      execState.caret = caret

      let targetIdx = -1
      for (let i = 0; i < found.matches.length; i++) {
        const m = found.matches[i]
        if (m.spansObject || m.inCitation) continue
        if (m.sec !== caret.sec) {
          if (m.sec > caret.sec) {
            targetIdx = i
            break
          }
          continue
        }
        if (m.para !== caret.para) {
          if (m.para > caret.para) {
            targetIdx = i
            break
          }
          continue
        }
        if (m.kind === 'body') {
          if (m.offset >= caret.offset) {
            targetIdx = i
            break
          }
          continue
        }
        targetIdx = i
        break
      }

      if (targetIdx === -1) {
        return sanitizeHostValue({ replaced: 0, found: false }, limits)
      }

      const target = found.matches[targetIdx]
      const meta = findOpts.regex ? found.regexMeta[targetIdx] : null
      const expanded = meta
        ? expandMacroRegexReplacement(replacement, meta.regexMatch, meta.fullText)
        : replacement
      if (PARAGRAPH_CONTROL_CHARS.test(expanded)) {
        failHost('invalid_argument', 'Expanded replacement contains disallowed control characters.')
      }

      const beforeLen = target.kind === 'body' ? doc.getParagraphLength(target.sec, target.para) : 0
      if (target.kind === 'body') {
        if (
          expanded.length > 0 &&
          followsInlineObject(doc, target.sec, target.para, target.offset, target.length)
        ) {
          expectEngineOk(
            doc.replaceText(
              target.sec,
              target.para,
              target.offset + 1,
              target.length - 1,
              expanded,
            ),
            'replaceNext',
          )
          expectEngineOk(doc.deleteText(target.sec, target.para, target.offset, 1), 'replaceNext')
        } else {
          expectEngineOk(
            doc.replaceText(target.sec, target.para, target.offset, target.length, expanded),
            'replaceNext',
          )
        }
      } else if (target.kind === 'table' || target.kind === 'textbox') {
        const pathJson = JSON.stringify(target.path)
        expectEngineOk(
          doc.deleteTextInCellByPath(
            target.sec,
            target.para,
            pathJson,
            target.offset,
            target.length,
          ),
          'delete',
        )
        if (expanded.length > 0) {
          expectEngineOk(
            doc.insertTextInCellByPath(target.sec, target.para, pathJson, target.offset, expanded),
            'insert',
          )
        }
      } else if (target.kind === 'footnote' || target.kind === 'endnote') {
        if (target.length > 0) {
          expectEngineOk(
            doc.deleteTextInFootnote(
              target.sec,
              target.para,
              target.noteControl,
              target.notePara,
              target.offset,
              target.length,
            ),
            'delete',
          )
        }
        if (expanded.length > 0) {
          expectEngineOk(
            doc.insertTextInFootnote(
              target.sec,
              target.para,
              target.noteControl,
              target.notePara,
              target.offset,
              expanded,
            ),
            'insert',
          )
        }
      }

      execState.mutated = true
      if (target.kind === 'body') {
        const afterLen = doc.getParagraphLength(target.sec, target.para)
        const insertedLen = Math.max(0, target.length + (afterLen - beforeLen))
        execState.caret = clampPosition(doc, target.sec, target.para, target.offset + insertedLen)
      }
      execState.selection = null
      checkObjectsPreserved()
      return sanitizeHostValue(
        {
          replaced: 1,
          found: true,
          sec: target.sec,
          para: target.para,
          offset: target.offset,
        },
        limits,
      )
    },

    // -----------------------------------------------------------------------
    // Tables
    // -----------------------------------------------------------------------
    insertTable(rows, cols) {
      assertPositiveInt(rows, 'rows', MAX_TABLE_ROWS)
      assertPositiveInt(cols, 'cols', MAX_TABLE_COLS)
      if (execState.selection) {
        deleteSelectionInternal()
      }
      const caret = clampPosition(
        doc,
        execState.caret.sec,
        execState.caret.para,
        execState.caret.offset,
      )
      execState.caret = caret

      const created = expectEngineOk(
        doc.createTable(caret.sec, caret.para, caret.offset, rows, cols),
        'insertTable',
      )
      execState.allowedTableDelta += 1
      execState.mutated = true
      const nextPara = Number.isInteger(created?.paraIdx) ? created.paraIdx : caret.para
      execState.caret = clampPosition(doc, caret.sec, nextPara, caret.offset)
      execState.selection = null
      checkObjectsPreserved()
      return sanitizeHostValue(
        {
          ok: true,
          rows,
          cols,
          paraIdx: nextPara,
          controlIdx: Number.isInteger(created?.controlIdx) ? created.controlIdx : 0,
        },
        limits,
      )
    },

    // -----------------------------------------------------------------------
    // Outline / TOC / Index / Bibliography Refresh
    // -----------------------------------------------------------------------
    changeOutlineLevel(sec, para, delta, opts = undefined) {
      assertValidParagraph(sec, para)
      if (delta !== 1 && delta !== -1) {
        failHost('invalid_argument', 'Invalid delta: expected 1 or -1')
      }
      if (opts !== undefined && opts !== null && !isPlainRecord(opts)) {
        failHost('invalid_argument', 'changeOutlineLevel options must be a plain object')
      }
      const res = changeOutlineLevelEngine(doc, {
        sec,
        para,
        delta,
        singleOnly: Boolean(opts?.singleOnly),
        appStyleMap: opts?.appStyleMap ?? options?.appStyleMap ?? null,
      })
      if (!res.ok) {
        failHost('engine_error', `changeOutlineLevel failed: ${res.reason}`)
      }
      execState.mutated = true
      checkObjectsPreserved()
      return sanitizeHostValue({ ok: true, changed: res.changed }, limits)
    },

    refreshToc(kind = undefined) {
      if (kind !== undefined && kind !== null) {
        if (typeof kind !== 'string' || !TOC_KINDS.has(kind)) {
          failHost(
            'invalid_argument',
            'Invalid TOC kind: expected body, table, figure, or equation',
          )
        }
        const res = refreshTocBlock(doc, {
          kind,
          appStyleMap: options?.appStyleMap ?? null,
        })
        if (!res.ok) {
          failHost('engine_error', `refreshToc failed: ${res.reason}`)
        }
        execState.mutated = true
        execState.caret = clampPosition(
          doc,
          execState.caret.sec,
          execState.caret.para,
          execState.caret.offset,
        )
        execState.selection = null
        checkObjectsPreserved({ resyncAfterRefresh: true })
        return sanitizeHostValue({ ok: true, refreshed: 1, kinds: [res.kind] }, limits)
      }

      const ranges = listTocRanges(doc)
      const kinds = []
      for (const range of ranges) {
        const res = refreshTocBlock(doc, {
          kind: range.kind,
          appStyleMap: options?.appStyleMap ?? null,
        })
        if (!res.ok) {
          failHost('engine_error', `refreshToc (${range.kind}) failed: ${res.reason}`)
        }
        kinds.push(res.kind)
        execState.mutated = true
      }
      if (kinds.length > 0) {
        execState.caret = clampPosition(
          doc,
          execState.caret.sec,
          execState.caret.para,
          execState.caret.offset,
        )
        execState.selection = null
        checkObjectsPreserved({ resyncAfterRefresh: true })
      }
      return sanitizeHostValue({ ok: true, refreshed: kinds.length, kinds }, limits)
    },

    refreshIndex() {
      const res = refreshIndexBlock(doc, {})
      if (!res.ok) {
        failHost('engine_error', `refreshIndex failed: ${res.reason}`)
      }
      execState.mutated = true
      execState.caret = clampPosition(
        doc,
        execState.caret.sec,
        execState.caret.para,
        execState.caret.offset,
      )
      execState.selection = null
      checkObjectsPreserved({ allowSectionLayoutDelta: true, resyncAfterRefresh: true })
      return sanitizeHostValue(
        { ok: true, entryCount: res.entryCount, groupCount: res.groupCount },
        limits,
      )
    },

    refreshBibliography() {
      const entries = Array.isArray(options?.bibEntries) ? options.bibEntries : []
      const res = refreshBibliographyBlock(doc, entries, {})
      if (!res.ok) {
        failHost('engine_error', `refreshBibliography failed: ${res.reason}`)
      }
      execState.mutated = true
      execState.caret = clampPosition(
        doc,
        execState.caret.sec,
        execState.caret.para,
        execState.caret.offset,
      )
      execState.selection = null
      checkObjectsPreserved()
      return sanitizeHostValue({ ok: true, count: res.count, style: res.style }, limits)
    },

    refreshAll() {
      const entries = Array.isArray(options?.bibEntries) ? options.bibEntries : []
      const res = defaultStalenessRegistry.refreshAll(doc, {
        appStyleMap: options?.appStyleMap ?? null,
        bibEntries: entries,
      })
      if (!res.ok) {
        failHost('engine_error', `refreshAll failed: ${res.reason ?? 'refresh_failed'}`)
      }
      if (res.refreshed > 0) {
        execState.mutated = true
        execState.caret = clampPosition(
          doc,
          execState.caret.sec,
          execState.caret.para,
          execState.caret.offset,
        )
        execState.selection = null
        checkObjectsPreserved({ allowSectionLayoutDelta: true, resyncAfterRefresh: true })
      }
      return sanitizeHostValue({ ok: true, refreshed: res.refreshed }, limits)
    },

    // -----------------------------------------------------------------------
    // Document Read Helpers
    // -----------------------------------------------------------------------
    getText() {
      const secCount = doc.getSectionCount()
      const parts = []
      let totalLen = 0
      for (let sec = 0; sec < secCount; sec++) {
        const paraCount = doc.getParagraphCount(sec)
        for (let para = 0; para < paraCount; para++) {
          const text = readParagraphText(doc, sec, para)
          totalLen += text.length + (parts.length > 0 ? 1 : 0)
          if (totalLen > limits.maxStringLength) {
            failHost('memory_limit', `String length limit (${limits.maxStringLength}) exceeded`)
          }
          parts.push(text)
        }
      }
      return parts.join('\n')
    },

    getSectionCount() {
      return doc.getSectionCount()
    },

    getParagraphCount(sec = undefined) {
      const targetSec = sec === undefined ? execState.caret.sec : assertValidSection(sec)
      return doc.getParagraphCount(targetSec)
    },

    getParagraphText(sec, para) {
      assertValidParagraph(sec, para)
      return readParagraphText(doc, sec, para)
    },

    listStyles() {
      const styles = parseJson(doc.getStyleList(), [])
      if (!Array.isArray(styles)) return []
      const out = styles.map((s) => ({
        id: s.id,
        name: typeof s.name === 'string' ? s.name : '',
      }))
      return sanitizeHostValue(out, limits)
    },

    // -----------------------------------------------------------------------
    // Message
    // -----------------------------------------------------------------------
    message(text) {
      if (execState.messages.length >= MAX_MACRO_MESSAGES || execState.messagesTruncated) return
      let msg = String(text ?? '')
      if (msg.length > MAX_MACRO_MESSAGE_LENGTH) {
        msg = `${msg.slice(0, MAX_MACRO_MESSAGE_LENGTH - 1)}…`
      }
      const remaining = MAX_MACRO_TOTAL_MESSAGE_CHARS - execState.messageChars
      if (msg.length > remaining) {
        if (remaining > 1) {
          execState.messages.push(`${msg.slice(0, remaining - 1)}…`)
          execState.messageChars += remaining
        } else if (remaining === 1) {
          execState.messages.push('…')
          execState.messageChars += 1
        }
        execState.messagesTruncated = true
        return
      }
      execState.messages.push(msg)
      execState.messageChars += msg.length
    },
  }

  const wrappedApi = Object.create(null)
  for (const [key, fn] of Object.entries(api)) {
    wrappedApi[key] = (...args) => {
      checkDeadline()
      const out = fn(...args)
      checkDeadline()
      return out
    }
  }
  return wrappedApi
}

function executeMacroCore(doc, source, options, limits, nowFn, startTime) {
  const state = createInitialState(doc, options, limits, nowFn, startTime)
  const api = createMacroApi(doc, state, { ...options, limits })
  const compat = createCompatGlobals(api, { limits, state })

  const docNamespace = Object.create(null)
  for (const key of Object.keys(api)) {
    docNamespace[key] = api[key]
  }
  const frozenDocNamespace = Object.freeze(docNamespace)

  const globals = Object.create(null)
  for (const key of Object.keys(api)) {
    globals[key] = api[key]
  }
  globals.doc = frozenDocNamespace
  globals.HAction = compat.HAction
  globals.HParameterSet = compat.HParameterSet

  const runResult = runMacroScript(source, globals, {
    limits,
    now: nowFn,
    startTime,
    onRegisterBudget: (budget) => {
      state.budget = budget
    },
  })

  if (runResult.ok) {
    const postRunElapsed = Math.max(runResult.elapsedMs, nowFn() - startTime)
    if (postRunElapsed > limits.maxTimeMs) {
      return {
        ok: false,
        code: 'time_limit',
        error: `Execution time limit (${limits.maxTimeMs}ms) exceeded`,
        line: null,
        column: null,
        phase: 'post_run',
        messages: [...state.messages],
        steps: runResult.steps,
        elapsedMs: postRunElapsed,
      }
    }

    // Final post-run protection verification across the entire macro run.
    try {
      const after = captureProtectionSnapshot(doc)
      const base = state.baseline
      if (after.memoCount < base.memoCount) {
        state.recordError('memo_loss', 'Cannot remove user memo during macro execution')
        throw new Error('Cannot remove user memo during macro execution')
      }
      for (const id of base.memoIds) {
        if (!after.memoIds.has(id)) {
          state.recordError('memo_loss', 'Cannot remove user memo during macro execution')
          throw new Error('Cannot remove user memo during macro execution')
        }
      }
      if (after.notes < base.notes) {
        state.recordError(
          'object_loss',
          'Cannot remove document footnote or endnote during macro execution',
        )
        throw new Error('Cannot remove document footnote or endnote during macro execution')
      }
      if (after.fieldCount < base.fieldCount) {
        state.recordError('object_loss', 'Cannot remove document field during macro execution')
        throw new Error('Cannot remove document field during macro execution')
      }
      for (const id of base.fieldIds) {
        if (!after.fieldIds.has(id)) {
          state.recordError('object_loss', 'Cannot remove document field during macro execution')
          throw new Error('Cannot remove document field during macro execution')
        }
      }
      if (after.controls < base.controls + state.allowedTableDelta) {
        state.recordError('object_loss', 'Cannot remove document object during macro execution')
        throw new Error('Cannot remove document object during macro execution')
      }
    } catch (err) {
      return {
        ok: false,
        code: state.lastError?.code ?? 'object_loss',
        error: err instanceof Error ? err.message : String(err),
        line: null,
        column: null,
        phase: 'post_run',
        messages: [...state.messages],
        steps: runResult.steps,
        elapsedMs: Math.max(runResult.elapsedMs, nowFn() - startTime),
      }
    }

    return {
      ok: true,
      value: runResult.value,
      messages: [...state.messages],
      caret: { ...state.caret },
      steps: runResult.steps,
      elapsedMs: Math.max(runResult.elapsedMs, nowFn() - startTime),
      changed: state.mutated,
    }
  }

  const hostErr = state.lastError
  const code = hostErr && runResult.code === 'runtime_error' ? hostErr.code : runResult.code
  const unsupportedAction =
    hostErr && hostErr.unsupportedAction !== undefined ? hostErr.unsupportedAction : undefined
  const detail =
    (code === 'time_limit' || code === 'step_limit') &&
    (hostErr?.detail === 'regex' || state.inRegex)
      ? 'regex'
      : undefined
  const error = detail === 'regex' && hostErr?.message ? hostErr.message : runResult.error

  return {
    ok: false,
    code,
    error,
    line: runResult.line,
    column: runResult.column,
    ...(detail !== undefined ? { detail } : {}),
    ...(unsupportedAction !== undefined ? { unsupportedAction } : {}),
    messages: [...state.messages],
    steps: runResult.steps,
    elapsedMs: Math.max(runResult.elapsedMs, nowFn() - startTime),
  }
}

function validateHostOptions(options) {
  if (options !== undefined && options !== null && !isPlainRecord(options)) {
    throw new RangeError('Macro host options must be a plain object')
  }
  const limits = resolveHostLimits(options?.limits)
  if (options?.now !== undefined && typeof options.now !== 'function') {
    throw new TypeError('Macro option "now" must be a function')
  }
  return limits
}

/**
 * Execute a macro script against a plugin host (single `host.transaction`) or
 * directly against an `HwpDocument` (engine snapshot save/restore). Any failure
 * rolls back atomically with zero undo steps.
 */
export function executeMacroTransaction(hostOrDoc, source, options = undefined) {
  if (!hostOrDoc || typeof hostOrDoc !== 'object') {
    throw new TypeError('executeMacroTransaction requires a plugin host or HwpDocument')
  }
  if (typeof source !== 'string') {
    throw new TypeError('Macro source must be a string')
  }
  const limits = validateHostOptions(options)
  const nowFn = options?.now ?? (() => Date.now())
  const startTime = nowFn()

  // Fail fast on syntax or script-size errors before opening a transaction.
  const parsed = parseMacroScript(source, limits)
  if (!parsed.ok) {
    return {
      ok: false,
      code: parsed.code,
      error: parsed.error,
      line: parsed.line,
      column: parsed.column,
      messages: [],
      steps: 0,
      elapsedMs: Math.max(0, nowFn() - startTime),
    }
  }

  // Plugin host path: one atomic transaction.
  if (typeof hostOrDoc.transaction === 'function') {
    let failedResult = null
    try {
      return hostOrDoc.transaction('macro', (tx) => {
        if (tx && typeof tx.deferPagination === 'function') {
          tx.deferPagination()
        }
        const doc = tx.doc()
        const result = executeMacroCore(doc, source, options, limits, nowFn, startTime)
        if (!result.ok) {
          failedResult = result
          throw new MacroRollbackError(result)
        }
        if (!result.changed && tx && typeof tx.markNoOp === 'function') {
          tx.markNoOp()
        }
        return result
      })
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        err.report &&
        typeof err.report.then === 'function' &&
        typeof options?.onRecoveryReport === 'function'
      ) {
        options.onRecoveryReport(err.report)
      }
      if (failedResult !== null) {
        return failedResult
      }
      if (err instanceof MacroRollbackError) {
        return err.result
      }
      if (err && typeof err === 'object' && err.cause instanceof MacroRollbackError) {
        return err.cause.result
      }
      return {
        ok: false,
        code: 'runtime_error',
        error: err instanceof Error ? err.message : String(err),
        line: 1,
        column: 1,
        messages: [],
        steps: 0,
        elapsedMs: Math.max(0, nowFn() - startTime),
      }
    }
  }

  // Raw HwpDocument path: engine snapshot save/restore for atomic rollback.
  const doc = hostOrDoc
  const hasSnapshot =
    typeof doc.saveSnapshot === 'function' && typeof doc.restoreSnapshot === 'function'
  const snapshotId = hasSnapshot ? doc.saveSnapshot() : null

  const result = executeMacroCore(doc, source, options, limits, nowFn, startTime)
  if (result.ok) {
    if (snapshotId !== null && typeof doc.discardSnapshot === 'function') {
      doc.discardSnapshot(snapshotId)
    }
    return result
  }

  if (snapshotId !== null) {
    doc.restoreSnapshot(snapshotId)
  }
  return result
}

/**
 * Run a macro script directly against an `HwpDocument` with atomic engine
 * snapshot rollback on any failure.
 */
export function runMacroOnDocument(doc, source, options = undefined) {
  if (!doc || typeof doc.getSectionCount !== 'function') {
    throw new TypeError('runMacroOnDocument requires a valid HwpDocument instance')
  }
  return executeMacroTransaction(doc, source, options)
}
