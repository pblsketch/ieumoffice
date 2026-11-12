/**
 * Hidden spans of the open document (민감정보 가리기), as the plugin sees them.
 *
 * A hidden span is a memo whose plain text is `[<prefix>] <label>` (recognised by
 * @genoffice/agent-core/hiding-memo in every screen language); the memo's anchor is the
 * span. The file keeps the real words; only what goes to a model is changed: each span
 * reads as `{{label}}` there.
 *
 * Everything here is pure and reads the document only. The plugin decides where it applies:
 * what the AI panel reads (concealed), what the AI's find calls can match (never a hidden
 * span), and which AI edits are refused (one that changes or removes a span).
 *
 * Every hiding memo has to be placed exactly. A memo the engine lists without a place this
 * plugin addresses (a header, a footer, a note), a range outside its paragraph, or an empty
 * one fails the read (`HIDDEN_UNPLACED`): nothing of that document goes to a model rather
 * than a span that might be missed.
 */

import { readHidingMemoLabel } from '@genoffice/agent-core/hiding-memo'
import { placeholderSource } from '@genoffice/agent-core/redact-core'
import { engineChars } from './document-info.mjs'

/** Where a hidden span can sit: the places a memo anchor has an address here. */
const PLACES = new Set(['body', 'tableCell', 'textBox'])

/** The error a hidden span that cannot be placed fails a read with. */
export const HIDDEN_UNPLACED = 'HIDDEN_UNPLACED'

function unplaced() {
  const error = new Error('a hiding memo cannot be placed in the text')
  error.code = HIDDEN_UNPLACED
  return error
}

const isIndex = (value) => Number.isInteger(value) && value >= 0

/** The engine's memo path as the by-path calls take it; null when a step is not addressable. */
function stepsOf(path) {
  if (!Array.isArray(path) || path.length === 0) return null
  const steps = []
  for (const step of path) {
    if (!step || typeof step !== 'object') return null
    const cellIndex =
      step.type === 'textbox'
        ? 0
        : Number.isInteger(step.cellIndex)
          ? step.cellIndex
          : step.type === undefined
            ? 0
            : -1
    const cellParaIndex = Number.isInteger(step.cellParaIndex) ? step.cellParaIndex : step.paraIndex
    if (!isIndex(step.controlIndex) || !isIndex(cellIndex) || !isIndex(cellParaIndex)) return null
    steps.push({ controlIndex: step.controlIndex, cellIndex, cellParaIndex })
  }
  return steps
}

/** The paragraph a span, a match or a run sits in, as one string. */
export function boxKey(sec, para, path) {
  return Array.isArray(path) && path.length > 0
    ? `${sec}:${para}:${path.map((s) => `${s.controlIndex}.${s.cellIndex ?? 0}.${s.cellParaIndex ?? 0}`).join('/')}`
    : `${sec}:${para}`
}

/** The label of a hiding memo, or null for an ordinary one. */
export const hidingLabelOf = (entry) => readHidingMemoLabel(String(entry?.text ?? ''))

/** The memos of a list that are hiding marks. */
export const hidingEntriesOf = (entries) => entries.filter((entry) => hidingLabelOf(entry) !== null)

/** One hiding memo placed in the text, read through the engine; throws when it cannot be. */
function placeOf(doc, entry, label) {
  const sec = entry.sectionIndex
  const para = entry.paraIndex
  const start = entry.startCharIdx
  const end = entry.endCharIdx
  if (!PLACES.has(entry.place)) throw unplaced()
  if (!isIndex(sec) || !isIndex(para) || !isIndex(start) || !isIndex(end) || start >= end) {
    throw unplaced()
  }
  try {
    if (sec >= doc.getSectionCount() || para >= doc.getParagraphCount(sec)) throw unplaced()
    if (entry.place === 'body') {
      if (Array.isArray(entry.path) && entry.path.length > 0) throw unplaced()
      if (end > doc.getParagraphLength(sec, para)) throw unplaced()
      const text = doc.getTextRange(sec, para, start, end - start)
      return { id: entry.id, label, sec, para, path: null, start, end, text }
    }
    const path = stepsOf(entry.path)
    if (!path) throw unplaced()
    const json = JSON.stringify(path)
    if (end > doc.getCellParagraphLengthByPath(sec, para, json)) throw unplaced()
    const text = doc.getTextInCellByPath(sec, para, json, start, end - start)
    return { id: entry.id, label, sec, para, path, start, end, text }
  } catch (thrown) {
    if (thrown && thrown.code === HIDDEN_UNPLACED) throw thrown
    throw unplaced()
  }
}

/**
 * Every hidden span of the document, placed: `{ id, label, sec, para, path, start, end,
 * text }`, offsets in the engine's characters. `entries` is the engine's memo list. Throws
 * HIDDEN_UNPLACED when one cannot be placed.
 */
export function hiddenRangesOf(doc, entries) {
  const out = []
  for (const entry of entries) {
    const label = hidingLabelOf(entry)
    if (label !== null) out.push(placeOf(doc, entry, label))
  }
  return out
}

/** The spans by the paragraph they sit in. */
export function rangesByBox(ranges) {
  const out = new Map()
  for (const range of ranges) {
    const key = boxKey(range.sec, range.para, range.path)
    const list = out.get(key)
    if (list) list.push(range)
    else out.set(key, [range])
  }
  return out
}

/** Whether characters from..to (engine offsets) of a paragraph touch a hidden span of it. */
export function touchesHidden(byBox, key, from, to) {
  const list = byBox.get(key)
  if (!list) return false
  return list.some((range) =>
    from === to ? range.start < from && from < range.end : range.start < to && from < range.end,
  )
}

/**
 * Characters from..to (engine offsets) of a paragraph's text with each hidden span that
 * touches them as its `{{label}}`, whole: a span cut by the window still reads as its label,
 * never as part of its words. Overlapping spans read as one, under the first label.
 */
export function concealRun(text, from, to, ranges) {
  const chars = engineChars(text)
  const end = Math.min(to, chars.length)
  const touching = (ranges ?? [])
    .filter((range) => range.start < end && from < range.end)
    .sort((a, b) => a.start - b.start)
  if (touching.length === 0) return chars.slice(from, end).join('')
  const merged = []
  for (const range of touching) {
    const last = merged[merged.length - 1]
    if (last && range.start < last.end) last.end = Math.max(last.end, range.end)
    else merged.push({ start: range.start, end: range.end, label: range.label })
  }
  let out = ''
  let cursor = from
  for (const range of merged) {
    if (range.start > cursor) out += chars.slice(cursor, range.start).join('')
    out += placeholderSource(range.label)
    cursor = Math.max(cursor, range.end)
  }
  if (cursor < end) out += chars.slice(cursor, end).join('')
  return out
}

const squash = (text) => text.replace(/\s+/g, ' ').trim()
// eslint-disable-next-line no-control-regex
const BREAKS = /[\u0000-\u001f\u007f]+/
const MARKER = /\{\{[^{}]*\}\}/g
/** The shortest piece of a hidden span a cut edge of a text is checked for. */
const MIN_EDGE = 2
/** Keys of a result whose strings are not document text. */
const NOT_TEXT = new Set(['base64', 'mime', 'type', 'reason', 'code', 'why', 'svg'])

/**
 * What hides the hidden words in text a walk by place did not produce: every occurrence of a
 * span's words is replaced by its label (more than the editor hides, never less), and a text
 * that starts or ends with part of a span's words (a context or a line cut short) loses that
 * part too. A span's words that still show (spaced or broken differently) fail the read.
 */
export function concealerOf(ranges) {
  const pieces = new Map()
  for (const range of ranges) {
    const marker = placeholderSource(range.label)
    for (const part of String(range.text ?? '').split(BREAKS)) {
      for (const piece of [part.trim(), squash(part)]) {
        if (piece && !pieces.has(piece)) pieces.set(piece, marker)
      }
    }
  }
  const ordered = [...pieces.keys()].sort((a, b) => b.length - a.length)
  if (ordered.length === 0) return (text) => text
  const pattern = new RegExp(
    ordered.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'g',
  )
  const edges = ordered.filter((piece) => piece.length > MIN_EDGE)
  const cutEdges = (text) => {
    let out = text
    // the end, before an ellipsis a cut text carries
    const tail = /…$/.test(out) ? '…' : ''
    let body = tail ? out.slice(0, -1) : out
    for (const piece of edges) {
      let done = false
      for (let n = piece.length - 1; n >= MIN_EDGE && !done; n--) {
        if (body.endsWith(piece.slice(0, n))) {
          body = body.slice(0, body.length - n) + pieces.get(piece)
          done = true
        }
      }
      if (done) break
    }
    out = body + tail
    const head = /^…/.test(out) ? '…' : ''
    body = head ? out.slice(1) : out
    for (const piece of edges) {
      let done = false
      for (let n = piece.length - 1; n >= MIN_EDGE && !done; n--) {
        if (body.startsWith(piece.slice(piece.length - n))) {
          body = pieces.get(piece) + body.slice(n)
          done = true
        }
      }
      if (done) break
    }
    return head + body
  }
  return (text) => {
    if (typeof text !== 'string' || text === '') return text
    const out = cutEdges(text.replace(pattern, (found) => pieces.get(found)))
    const left = squash(out.replace(MARKER, ' '))
    if (ordered.some((piece) => left.includes(squash(piece)))) {
      const error = new Error('hidden words show in a form that cannot be hidden')
      error.code = HIDDEN_UNPLACED
      throw error
    }
    return out
  }
}

/**
 * A result with every string of document text passed through `conceal`, at any depth. The
 * keys that hold no document text (a picture's bytes, a reason code) are left as they are.
 */
export function concealDeep(value, conceal, key = '') {
  if (typeof value === 'string') return NOT_TEXT.has(key) ? value : conceal(value)
  if (Array.isArray(value)) return value.map((item) => concealDeep(item, conceal, key))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [name, item] of Object.entries(value)) out[name] = concealDeep(item, conceal, name)
    return out
  }
  return value
}

/**
 * What an AI edit must leave alone: each hidden span by its memo, with the words it covers.
 * Compared after the edit (sameHiding), a span that went, moved into other words, or was cut
 * refuses the edit.
 */
export function hidingSnapshot(doc, entries) {
  const out = new Map()
  for (const entry of entries) {
    const label = hidingLabelOf(entry)
    if (label === null) continue
    let text = null
    try {
      text = placeOf(doc, entry, label).text
    } catch {
      // a span without a place here is still watched: it must not go
    }
    out.set(entry.id, { label, text, memo: String(entry.text ?? '') })
  }
  return out
}

/** The labels of the spans an edit took away or changed; empty when every one is as it was. */
export function brokenHiding(before, after) {
  const broken = []
  for (const [id, was] of before) {
    const now = after.get(id)
    if (!now || now.text !== was.text || now.memo !== was.memo) broken.push(was.label)
  }
  return [...new Set(broken)]
}
