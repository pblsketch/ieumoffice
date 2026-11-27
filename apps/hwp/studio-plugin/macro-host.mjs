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
import { isAppMarkName, isAppTocHyperlinkField } from './doc-marks.mjs'
import { findMatches, replaceFindMatches } from './find.mjs'
import { changeOutlineLevel as changeOutlineLevelEngine } from './outline.mjs'
import { listTocRanges, refreshTocBlock } from './toc.mjs'
import { refreshIndexBlock } from './index-marks.mjs'
import { refreshBibliographyBlock } from './citations.mjs'
import { defaultStalenessRegistry } from './staleness.mjs'

export const MAX_MACRO_MESSAGES = 200
export const MAX_TABLE_ROWS = 100
export const MAX_TABLE_COLS = 50

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

/** Controls representing user content objects that a macro may not silently drop. */
const PROTECTED_CONTENT_CTRL_IDS = new Set([
  'fn',
  'en',
  'tbl',
  'gso',
  'pic',
  'eqed',
  'ole',
  'container',
])

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

function globalParaBaseOf(doc, sec) {
  let base = 0
  for (let s = 0; s < sec; s++) {
    base += doc.getParagraphCount(s)
  }
  return base
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

function bodyProtectedControlPositions(doc, sec, para) {
  if (typeof doc.getControls !== 'function') return []
  const controls = parseJson(doc.getControls(), [])
  if (!Array.isArray(controls)) return []
  const globalPara = globalParaBaseOf(doc, sec) + para
  const paraControls = controls
    .filter((c) => c && c.list === 0 && c.para === globalPara)
    .sort((a, b) => (a.controlIndex ?? 0) - (b.controlIndex ?? 0))

  if (paraControls.length === 0) return []
  const positions =
    typeof doc.getControlTextPositions === 'function'
      ? parseJson(doc.getControlTextPositions(sec, para), [])
      : []

  const hits = []
  for (let i = 0; i < paraControls.length; i++) {
    const ctrl = paraControls[i]
    if (!PROTECTED_CONTENT_CTRL_IDS.has(ctrl.ctrlId)) continue
    const idx = Number.isInteger(ctrl.controlIndex) ? ctrl.controlIndex : i
    const textPos =
      Array.isArray(positions) && Number.isInteger(positions[idx]) ? positions[idx] : 0
    hits.push({ ctrlId: ctrl.ctrlId, textPos })
  }
  return hits
}

function createInitialState(doc, options, limits) {
  const initialCaret = options?.caret
    ? clampPosition(doc, options.caret.sec, options.caret.para, options.caret.offset)
    : clampPosition(doc, 0, 0, 0)
  const initialSelection = options?.selection
    ? normalizeSelectionRange(doc, options.selection)
    : null
  const state = {
    caret: initialCaret,
    selection: initialSelection,
    messages: [],
    allowedTableDelta: 0,
    mutated: false,
    lastError: null,
    lastFind: null,
    limits,
    baseline: captureProtectionSnapshot(doc),
    recordError(code, message, extra = undefined) {
      state.lastError = {
        code,
        message,
        ...(extra && extra.unsupportedAction !== undefined
          ? { unsupportedAction: extra.unsupportedAction }
          : {}),
      }
    },
  }
  return state
}

/**
 * Create the synchronous application document API bound to `doc` and `state`.
 */
export function createMacroApi(doc, state, options = undefined) {
  if (!doc || typeof doc.getSectionCount !== 'function') {
    throw new TypeError('createMacroApi requires a valid HwpDocument instance')
  }
  const limits = state?.limits ?? validateMacroLimits(options?.limits)
  const execState = state ?? createInitialState(doc, options, limits)
  if (!execState.baseline) {
    execState.baseline = captureProtectionSnapshot(doc)
  }
  if (typeof execState.recordError !== 'function') {
    execState.recordError = (code, message, extra = undefined) => {
      execState.lastError = {
        code,
        message,
        ...(extra && extra.unsupportedAction !== undefined
          ? { unsupportedAction: extra.unsupportedAction }
          : {}),
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
    throw err
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
    const multiPara = sel.startSec !== sel.endSec || sel.startPara !== sel.endPara

    // Guard body user memos covered by the deleted span.
    const memos = memoEntriesOf(doc)
    for (const memo of memos) {
      if (memo?.place !== 'body') continue
      const mSec = memo.sectionIndex
      const mPara = memo.paraIndex
      if (!Number.isInteger(mSec) || !Number.isInteger(mPara)) continue
      if (mSec < sel.startSec || mSec > sel.endSec) continue
      const mStart = Number.isInteger(memo.startCharIdx) ? memo.startCharIdx : 0
      const mEnd = Number.isInteger(memo.endCharIdx) ? memo.endCharIdx : mStart

      const pStart = mSec === sel.startSec ? sel.startPara : 0
      const pEnd = mSec === sel.endSec ? sel.endPara : doc.getParagraphCount(mSec) - 1
      if (mPara < pStart || mPara > pEnd) continue

      const delStart = mSec === sel.startSec && mPara === sel.startPara ? sel.startOffset : 0
      const paraLen = doc.getParagraphLength(mSec, mPara)
      const delEnd = mSec === sel.endSec && mPara === sel.endPara ? sel.endOffset : paraLen

      const strictlyMiddlePara =
        (mSec > sel.startSec || mPara > sel.startPara) && (mSec < sel.endSec || mPara < sel.endPara)
      const wipesSpanMemo = mStart < mEnd && delStart <= mStart && mEnd <= delEnd
      const wipesPointMemo = mStart === mEnd && delStart < mStart && mStart < delEnd
      const wipesAnchorInFullPara =
        multiPara && delStart <= mStart && mEnd <= delEnd && delEnd > delStart

      if (strictlyMiddlePara || wipesSpanMemo || wipesPointMemo || wipesAnchorInFullPara) {
        failHost('memo_loss', 'Cannot delete selection containing a user memo')
      }
    }

    // Guard protected inline/block content objects (footnotes, endnotes, tables, pictures, shapes, equations).
    for (let sec = sel.startSec; sec <= sel.endSec; sec++) {
      const paraCount = doc.getParagraphCount(sec)
      const pStart = sec === sel.startSec ? sel.startPara : 0
      const pEnd = sec === sel.endSec ? sel.endPara : paraCount - 1
      for (let para = pStart; para <= pEnd; para++) {
        const objects = bodyProtectedControlPositions(doc, sec, para)
        if (objects.length === 0) continue

        const paraLen = doc.getParagraphLength(sec, para)
        const delStart = sec === sel.startSec && para === sel.startPara ? sel.startOffset : 0
        const delEnd = sec === sel.endSec && para === sel.endPara ? sel.endOffset : paraLen
        const isFirstPara = sec === sel.startSec && para === sel.startPara
        const isLastPara = sec === sel.endSec && para === sel.endPara

        for (const obj of objects) {
          if (!multiPara) {
            const strictlyInside = delStart < obj.textPos && obj.textPos < delEnd
            const wholeParaCovered =
              delStart === 0 && delEnd === paraLen && obj.textPos >= 0 && obj.textPos <= paraLen
            if (strictlyInside || wholeParaCovered) {
              failHost(
                'object_loss',
                `Cannot delete selection containing a document object (${obj.ctrlId})`,
              )
            }
          } else {
            if (!isFirstPara && !isLastPara) {
              failHost(
                'object_loss',
                `Cannot delete selection containing a document object (${obj.ctrlId})`,
              )
            }
            if (isFirstPara && obj.textPos >= delStart && obj.textPos <= paraLen) {
              failHost(
                'object_loss',
                `Cannot delete selection containing a document object (${obj.ctrlId})`,
              )
            }
            if (isLastPara && obj.textPos >= 0 && obj.textPos <= delEnd) {
              failHost(
                'object_loss',
                `Cannot delete selection containing a document object (${obj.ctrlId})`,
              )
            }
          }
        }
      }
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

  const stepCaretLeft = (count) => {
    let remaining = count
    let { sec, para, offset } = clampPosition(
      doc,
      execState.caret.sec,
      execState.caret.para,
      execState.caret.offset,
    )
    while (remaining > 0) {
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
    execState.selection = null
  }

  const stepCaretRight = (count) => {
    let remaining = count
    const secCount = doc.getSectionCount()
    let { sec, para, offset } = clampPosition(
      doc,
      execState.caret.sec,
      execState.caret.para,
      execState.caret.offset,
    )
    while (remaining > 0) {
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
    execState.selection = null
  }

  const stepCaretVertical = (direction, count) => {
    const secCount = doc.getSectionCount()
    let { sec, para, offset } = clampPosition(
      doc,
      execState.caret.sec,
      execState.caret.para,
      execState.caret.offset,
    )
    let remaining = count
    while (remaining > 0) {
      if (direction < 0) {
        if (para > 0) {
          para -= 1
        } else if (sec > 0) {
          sec -= 1
          para = doc.getParagraphCount(sec) - 1
        } else {
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
          break
        }
      }
      remaining -= 1
    }
    const maxOffset = doc.getParagraphLength(sec, para)
    execState.caret = { sec, para, offset: Math.min(offset, maxOffset) }
    execState.selection = null
  }

  const stepWordLeft = (count) => {
    let { sec, para, offset } = clampPosition(
      doc,
      execState.caret.sec,
      execState.caret.para,
      execState.caret.offset,
    )
    for (let step = 0; step < count; step++) {
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
      const text = readParagraphText(doc, sec, para)
      let i = offset
      while (i > 0 && !WORD_CHAR_RE.test(text[i - 1])) i -= 1
      while (i > 0 && WORD_CHAR_RE.test(text[i - 1])) i -= 1
      offset = i
    }
    execState.caret = { sec, para, offset }
    execState.selection = null
  }

  const stepWordRight = (count) => {
    const secCount = doc.getSectionCount()
    let { sec, para, offset } = clampPosition(
      doc,
      execState.caret.sec,
      execState.caret.para,
      execState.caret.offset,
    )
    for (let step = 0; step < count; step++) {
      const text = readParagraphText(doc, sec, para)
      if (offset >= text.length) {
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
      while (i < text.length && WORD_CHAR_RE.test(text[i])) i += 1
      while (i < text.length && !WORD_CHAR_RE.test(text[i])) i += 1
      offset = i
    }
    execState.caret = { sec, para, offset }
    execState.selection = null
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
      if (execState.selection) {
        deleteSelectionInternal()
      }
      execState.caret = clampPosition(
        doc,
        execState.caret.sec,
        execState.caret.para,
        execState.caret.offset,
      )
      const lines = normalized.split('\n')
      for (let i = 0; i < lines.length; i++) {
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
          expectEngineOk(
            doc.insertText(
              execState.caret.sec,
              execState.caret.para,
              execState.caret.offset,
              segment,
            ),
            'insertText',
          )
          execState.caret = {
            sec: execState.caret.sec,
            para: execState.caret.para,
            offset: execState.caret.offset + segment.length,
          }
          execState.mutated = true
        }
      }
      execState.selection = null
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
      execState.mutated = true
      checkObjectsPreserved()
    },

    deleteSelection() {
      return deleteSelectionInternal()
    },

    // -----------------------------------------------------------------------
    // Caret & Selection Movement
    // -----------------------------------------------------------------------
    moveDocBegin() {
      execState.caret = clampPosition(doc, 0, 0, 0)
      execState.selection = null
    },

    moveDocEnd() {
      const lastSec = Math.max(0, doc.getSectionCount() - 1)
      const lastPara = Math.max(0, doc.getParagraphCount(lastSec) - 1)
      const lastLen = Math.max(0, doc.getParagraphLength(lastSec, lastPara))
      execState.caret = { sec: lastSec, para: lastPara, offset: lastLen }
      execState.selection = null
    },

    moveParaBegin() {
      execState.caret = clampPosition(doc, execState.caret.sec, execState.caret.para, 0)
      execState.selection = null
    },

    moveParaEnd() {
      const caret = clampPosition(doc, execState.caret.sec, execState.caret.para, 0)
      const len = doc.getParagraphLength(caret.sec, caret.para)
      execState.caret = { sec: caret.sec, para: caret.para, offset: len }
      execState.selection = null
    },

    moveLineBegin() {
      api.moveParaBegin()
    },

    moveLineEnd() {
      api.moveParaEnd()
    },

    moveLeft(count = 1) {
      const n = count === undefined ? 1 : assertPositiveInt(count, 'count')
      stepCaretLeft(n)
    },

    moveRight(count = 1) {
      const n = count === undefined ? 1 : assertPositiveInt(count, 'count')
      stepCaretRight(n)
    },

    moveUp(count = 1) {
      const n = count === undefined ? 1 : assertPositiveInt(count, 'count')
      stepCaretVertical(-1, n)
    },

    moveDown(count = 1) {
      const n = count === undefined ? 1 : assertPositiveInt(count, 'count')
      stepCaretVertical(1, n)
    },

    moveWordLeft(count = 1) {
      const n = count === undefined ? 1 : assertPositiveInt(count, 'count')
      stepWordLeft(n)
    },

    moveWordRight(count = 1) {
      const n = count === undefined ? 1 : assertPositiveInt(count, 'count')
      stepWordRight(n)
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
      execState.caret = { sec: b.sec, para: b.para, offset: b.offset }
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
      execState.caret = { sec: lastSec, para: lastPara, offset: lastLen }
    },

    cancelSelection() {
      execState.selection = null
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

      const json = JSON.stringify(engineProps)
      const sel = execState.selection ? normalizeSelectionRange(doc, execState.selection) : null
      if (sel) {
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
      } else {
        const caret = clampPosition(
          doc,
          execState.caret.sec,
          execState.caret.para,
          execState.caret.offset,
        )
        execState.caret = caret
        const len = doc.getParagraphLength(caret.sec, caret.para)
        if (len > 0) {
          expectEngineOk(doc.applyCharFormat(caret.sec, caret.para, 0, len, json), 'setCharFormat')
          execState.mutated = true
        }
      }
      checkObjectsPreserved()
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
      const result = findMatches(doc, findOpts)
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
      const result = replaceFindMatches(doc, findOpts, replacement, 'all')
      if (!result.ok) {
        failHost('invalid_argument', result.error || 'replaceAll failed')
      }
      if (result.replaced > 0) {
        execState.mutated = true
      }
      execState.caret = clampPosition(
        doc,
        execState.caret.sec,
        execState.caret.para,
        execState.caret.offset,
      )
      execState.selection = null
      checkObjectsPreserved()
      return sanitizeHostValue(
        {
          replaced: result.replaced,
          skippedObjects: result.skippedObjects,
          skippedCitations: result.skippedCitations,
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
      const found = findMatches(doc, findOpts)
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

      const target = found.matches.find((m) => {
        if (m.spansObject || m.inCitation) return false
        if (m.sec !== caret.sec) return m.sec > caret.sec
        if (m.para !== caret.para) return m.para > caret.para
        if (m.kind === 'body') return m.offset >= caret.offset
        return true
      })

      if (!target) {
        return sanitizeHostValue({ replaced: 0, found: false }, limits)
      }

      const beforeLen = target.kind === 'body' ? doc.getParagraphLength(target.sec, target.para) : 0
      const rep = replaceFindMatches(doc, findOpts, replacement, {
        targets: [
          {
            kind: target.kind,
            sec: target.sec,
            para: target.para,
            offset: target.offset,
            length: target.length,
            matchText: target.matchText,
            ...(target.path ? { path: target.path } : {}),
            ...(target.noteControl !== undefined ? { noteControl: target.noteControl } : {}),
            ...(target.notePara !== undefined ? { notePara: target.notePara } : {}),
          },
        ],
      })
      if (!rep.ok) {
        failHost('invalid_argument', rep.error || 'replaceNext failed')
      }
      if (rep.replaced > 0) {
        execState.mutated = true
        if (target.kind === 'body') {
          const afterLen = doc.getParagraphLength(target.sec, target.para)
          const insertedLen = Math.max(0, target.length + (afterLen - beforeLen))
          execState.caret = clampPosition(doc, target.sec, target.para, target.offset + insertedLen)
        }
        execState.selection = null
        checkObjectsPreserved()
      }
      return sanitizeHostValue(
        {
          replaced: rep.replaced,
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
      if (execState.messages.length >= MAX_MACRO_MESSAGES) return
      const msg = String(text ?? '')
      execState.messages.push(
        msg.length > limits.maxStringLength ? msg.slice(0, limits.maxStringLength) : msg,
      )
    },
  }

  return Object.assign(Object.create(null), api)
}

function executeMacroCore(doc, source, options, limits) {
  const state = createInitialState(doc, options, limits)
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
    ...(options?.now !== undefined ? { now: options.now } : {}),
  })

  if (runResult.ok) {
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
        line: 1,
        column: 1,
        messages: [...state.messages],
        steps: runResult.steps,
        elapsedMs: runResult.elapsedMs,
      }
    }

    return {
      ok: true,
      value: runResult.value,
      messages: [...state.messages],
      caret: { ...state.caret },
      steps: runResult.steps,
      elapsedMs: runResult.elapsedMs,
      changed: state.mutated,
    }
  }

  const hostErr = state.lastError
  const code = hostErr && runResult.code === 'runtime_error' ? hostErr.code : runResult.code
  const unsupportedAction =
    hostErr && hostErr.unsupportedAction !== undefined ? hostErr.unsupportedAction : undefined

  return {
    ok: false,
    code,
    error: runResult.error,
    line: runResult.line,
    column: runResult.column,
    ...(unsupportedAction !== undefined ? { unsupportedAction } : {}),
    messages: [...state.messages],
    steps: runResult.steps,
    elapsedMs: runResult.elapsedMs,
  }
}

function validateHostOptions(options) {
  if (options !== undefined && options !== null && !isPlainRecord(options)) {
    throw new RangeError('Macro host options must be a plain object')
  }
  const limits = validateMacroLimits(options?.limits)
  if (options?.now !== undefined && typeof options.now !== 'function') {
    throw new TypeError('Macro option "now" must be a function')
  }
  return limits
}

/**
 * Execute a macro script against a plugin host (single `host.transaction` with
 * `foreign: true`) or directly against an `HwpDocument` (engine snapshot
 * save/restore). Any failure rolls back atomically with zero undo steps.
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

  // Plugin host path: one atomic transaction with `foreign: true`.
  if (typeof hostOrDoc.transaction === 'function') {
    try {
      return hostOrDoc.transaction(
        'macro',
        (tx) => {
          if (tx && typeof tx.deferPagination === 'function') {
            tx.deferPagination()
          }
          const doc = tx.doc()
          const result = executeMacroCore(doc, source, options, limits)
          if (!result.ok) {
            throw new MacroRollbackError(result)
          }
          return result
        },
        { foreign: true },
      )
    } catch (err) {
      if (err instanceof MacroRollbackError) {
        return err.result
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

  const result = executeMacroCore(doc, source, options, limits)
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
