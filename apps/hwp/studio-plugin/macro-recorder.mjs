/**
 * Keystroke and editor command macro recorder.
 *
 * Translates editor text input, keyboard navigation, and supported editor commands
 * into clean, deterministic macro script source lines matching the document API in
 * `macro-host.mjs`. Unsupported commands and mouse clicks emit immediate notices
 * without corrupting the generated script.
 *
 * Also maintains a lightweight module-level active recorder reference so patched
 * editor hooks can notify the recorder with negligible overhead when idle.
 */

/** Shortcut keys mapped to macro slots 1 through 11 (`Alt+1`..`Alt+9`, `Alt+0`, `Alt+-`). */
export const MACRO_SLOT_KEYS = Object.freeze([
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '0',
  '-',
])

const CODE_TO_SLOT = Object.freeze({
  Digit1: 1,
  Digit2: 2,
  Digit3: 3,
  Digit4: 4,
  Digit5: 5,
  Digit6: 6,
  Digit7: 7,
  Digit8: 8,
  Digit9: 9,
  Digit0: 10,
  Minus: 11,
})

const KEY_TO_SLOT = Object.freeze({
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 9,
  0: 10,
  '-': 11,
})

/** Commands owned by app UI / internal probes that are silently ignored while recording. */
const SILENTLY_IGNORED_COMMANDS = new Set([
  'ieum:workpane-find',
  'ext:ieum-easy-words',
  'ext:ieum-reveal',
  'ext:ieum-reveal-find',
  'ext:ieum-caret-position',
  'ext:ieum-caret-state',
  'ext:ieum-highlight-range',
  'ext:ieum-selection',
  'ext:ieum-count-characters',
  'ext:ieum-mark-changes',
  'ext:ieum-select-word',
  'ext:ieum-select-paragraph',
  'ext:ieum-word-drag',
  'ext:ieum-memo-list',
  'ext:ieum-memo-selection',
  'ext:ieum-memo-anchors',
  'ext:ieum-memo-lock',
  'ext:ieum-memo-unlock',
  'ext:ieum-toc-refresh-ctx',
  'ext:ieum-index-refresh-ctx',
])

const VALID_ALIGNMENTS = new Set(['left', 'center', 'right', 'justify'])
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
/** Controls representing user content objects that a macro or keystroke may not silently drop. */
export const PROTECTED_CONTENT_CTRL_IDS = Object.freeze(
  new Set(['fn', 'en', 'tbl', 'gso', 'pic', 'eqed', 'ole', 'container']),
)

const NON_PROTECTED_ADJACENT_CTRL_IDS = new Set([
  '',
  'bokm',
  'bkmk',
  'secd',
  'cold',
  'pgnp',
  'head',
  'foot',
])

function parseJsonSafe(raw, fallback = null) {
  if (typeof raw !== 'string') return raw ?? fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function readParagraphCount(docOrBridge, sec) {
  if (typeof docOrBridge?.getParagraphCount !== 'function') return null
  try {
    const count = docOrBridge.getParagraphCount(sec)
    return Number.isInteger(count) && count >= 0 ? count : null
  } catch {
    return null
  }
}

function readParagraphLength(docOrBridge, sec, para) {
  if (typeof docOrBridge?.getParagraphLength !== 'function') return null
  try {
    const len = docOrBridge.getParagraphLength(sec, para)
    return Number.isInteger(len) && len >= 0 ? len : null
  } catch {
    return null
  }
}

function readMemoEntries(docOrBridge) {
  try {
    if (typeof docOrBridge?.getMemoList === 'function') {
      const list = parseJsonSafe(docOrBridge.getMemoList(), [])
      return Array.isArray(list) ? list : []
    }
    if (typeof docOrBridge?.getMemoAnchors === 'function') {
      const list = parseJsonSafe(docOrBridge.getMemoAnchors(), [])
      return Array.isArray(list) ? list : []
    }
  } catch {
    return []
  }
  return []
}

function readAllControls(docOrBridge) {
  if (typeof docOrBridge?.getControls !== 'function') return null
  try {
    const parsed = parseJsonSafe(docOrBridge.getControls(), null)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function readBodyProtectedControls(docOrBridge, sec, para, cachedControls = undefined) {
  let positions = []
  if (typeof docOrBridge?.getControlTextPositions === 'function') {
    try {
      const parsed = parseJsonSafe(docOrBridge.getControlTextPositions(sec, para), [])
      if (Array.isArray(parsed)) positions = parsed
    } catch {
      positions = []
    }
  }

  // Support mock/bridge object-shaped entries `{ pos | textPos, ctrlId }`.
  if (positions.some((entry) => entry && typeof entry === 'object')) {
    const hits = []
    for (const entry of positions) {
      if (!entry || typeof entry !== 'object') continue
      const ctrlId = typeof entry.ctrlId === 'string' ? entry.ctrlId : ''
      if (ctrlId && NON_PROTECTED_ADJACENT_CTRL_IDS.has(ctrlId)) continue
      const textPos = Number.isInteger(entry.pos)
        ? entry.pos
        : Number.isInteger(entry.textPos)
          ? entry.textPos
          : null
      if (textPos !== null) {
        hits.push({ ctrlId: ctrlId || 'object', textPos })
      }
    }
    return hits
  }

  const controls = cachedControls !== undefined ? cachedControls : readAllControls(docOrBridge)
  if (Array.isArray(controls)) {
    let globalBase = 0
    for (let s = 0; s < sec; s++) {
      const count = readParagraphCount(docOrBridge, s)
      if (count !== null) globalBase += count
    }
    const globalPara = globalBase + para
    const paraControls = controls
      .filter((ctrl) => ctrl && ctrl.list === 0 && ctrl.para === globalPara)
      .sort((a, b) => (a.controlIndex ?? 0) - (b.controlIndex ?? 0))
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

  // Minimal bridge fallback when `getControls` is unavailable and `positions` is numeric.
  const hits = []
  for (const pos of positions) {
    if (Number.isInteger(pos)) {
      hits.push({ ctrlId: 'object', textPos: pos })
    }
  }
  return hits
}

/**
 * Shared protected-content deletion check for a body range `(startSec, startPara, startOffset)`
 * through `(endSec, endPara, endOffset)`. Accepts either a raw `HwpDocument` or a `WasmBridge`.
 * Returns a structured blocker `{ code, message, ctrlId? }` when deletion would drop a protected
 * object or user memo, or `null` when safe.
 */
export function findProtectedDeletionBlocker(docOrBridge, range) {
  if (!docOrBridge || !range || typeof range !== 'object') return null
  const { startSec, startPara, startOffset, endSec, endPara, endOffset } = range
  if (
    !Number.isInteger(startSec) ||
    !Number.isInteger(startPara) ||
    !Number.isInteger(startOffset) ||
    !Number.isInteger(endSec) ||
    !Number.isInteger(endPara) ||
    !Number.isInteger(endOffset)
  ) {
    return null
  }
  const multiPara = startSec !== endSec || startPara !== endPara

  // Guard body user memos covered by the deleted span.
  const memos = readMemoEntries(docOrBridge)
  for (const memo of memos) {
    if (memo?.place !== 'body') continue
    const mSec = memo.sectionIndex
    const mPara = memo.paraIndex
    if (!Number.isInteger(mSec) || !Number.isInteger(mPara)) continue
    if (mSec < startSec || mSec > endSec) continue
    const mStart = Number.isInteger(memo.startCharIdx) ? memo.startCharIdx : 0
    const mEnd = Number.isInteger(memo.endCharIdx) ? memo.endCharIdx : mStart

    const pStart = mSec === startSec ? startPara : 0
    const pEnd =
      mSec === endSec ? endPara : Math.max(0, (readParagraphCount(docOrBridge, mSec) ?? 1) - 1)
    if (mPara < pStart || mPara > pEnd) continue

    const delStart = mSec === startSec && mPara === startPara ? startOffset : 0
    const paraLen = readParagraphLength(docOrBridge, mSec, mPara)
    const delEnd =
      mSec === endSec && mPara === endPara ? endOffset : (paraLen ?? Number.MAX_SAFE_INTEGER)

    const strictlyMiddlePara =
      (mSec > startSec || mPara > startPara) && (mSec < endSec || mPara < endPara)
    const wipesSpanMemo = mStart < mEnd && delStart <= mStart && mEnd <= delEnd
    const wipesPointMemo = mStart === mEnd && delStart < mStart && mStart < delEnd
    const wipesAnchorInFullPara =
      multiPara && delStart <= mStart && mEnd <= delEnd && delEnd > delStart

    if (strictlyMiddlePara || wipesSpanMemo || wipesPointMemo || wipesAnchorInFullPara) {
      return {
        code: 'memo_loss',
        message: 'Cannot delete selection containing a user memo',
      }
    }
  }

  // Guard protected inline/block content objects (footnotes, endnotes, tables, pictures, shapes, equations).
  const cachedControls = readAllControls(docOrBridge)
  for (let sec = startSec; sec <= endSec; sec++) {
    const paraCount = readParagraphCount(docOrBridge, sec)
    const pStart = sec === startSec ? startPara : 0
    const pEnd = sec === endSec ? endPara : Math.max(0, (paraCount ?? 1) - 1)
    for (let para = pStart; para <= pEnd; para++) {
      const objects = readBodyProtectedControls(docOrBridge, sec, para, cachedControls)
      if (objects.length === 0) continue

      const paraLen = readParagraphLength(docOrBridge, sec, para)
      const delStart = sec === startSec && para === startPara ? startOffset : 0
      const delEnd =
        sec === endSec && para === endPara ? endOffset : (paraLen ?? Number.MAX_SAFE_INTEGER)
      const isFirstPara = sec === startSec && para === startPara
      const isLastPara = sec === endSec && para === endPara

      for (const obj of objects) {
        if (!multiPara) {
          const strictlyInside = delStart < obj.textPos && obj.textPos < delEnd
          const wholeParaCovered =
            paraLen !== null &&
            delStart === 0 &&
            delEnd === paraLen &&
            obj.textPos >= 0 &&
            obj.textPos <= paraLen
          if (strictlyInside || wholeParaCovered) {
            return {
              code: 'object_loss',
              ctrlId: obj.ctrlId,
              message: `Cannot delete selection containing a document object (${obj.ctrlId})`,
            }
          }
        } else {
          if (!isFirstPara && !isLastPara) {
            return {
              code: 'object_loss',
              ctrlId: obj.ctrlId,
              message: `Cannot delete selection containing a document object (${obj.ctrlId})`,
            }
          }
          if (
            isFirstPara &&
            obj.textPos >= delStart &&
            (paraLen === null || obj.textPos <= paraLen)
          ) {
            return {
              code: 'object_loss',
              ctrlId: obj.ctrlId,
              message: `Cannot delete selection containing a document object (${obj.ctrlId})`,
            }
          }
          if (isLastPara && obj.textPos >= 0 && obj.textPos <= delEnd) {
            return {
              code: 'object_loss',
              ctrlId: obj.ctrlId,
              message: `Cannot delete selection containing a document object (${obj.ctrlId})`,
            }
          }
        }
      }
    }
  }

  return null
}

/**
 * Shared protected-content deletion check for a backward or forward deletion step from `pos`
 * in a body paragraph (covering both intra-paragraph character deletion and cross-paragraph merges).
 * Accepts either a raw `HwpDocument` or a `WasmBridge`, and either `{ sec, para, offset }` or
 * `{ sectionIndex, paragraphIndex, charOffset }`.
 */
export function findProtectedStepDeletionBlocker(docOrBridge, pos, direction, count = 1) {
  if (!docOrBridge || !pos || typeof pos !== 'object') return null
  if (pos.parentParaIndex !== undefined || pos.isTextBox) return null
  if (direction !== 'backward' && direction !== 'forward') return null

  const sec = Number.isInteger(pos.sec) ? pos.sec : pos.sectionIndex
  const para = Number.isInteger(pos.para) ? pos.para : pos.paragraphIndex
  const offset = Number.isInteger(pos.offset) ? pos.offset : pos.charOffset
  if (!Number.isInteger(sec) || !Number.isInteger(para) || !Number.isInteger(offset)) {
    return null
  }
  const stepCount = Number.isInteger(count) && count >= 1 ? count : 1

  if (typeof docOrBridge.getFootnoteAtCursor === 'function') {
    try {
      const fnHit = parseJsonSafe(
        docOrBridge.getFootnoteAtCursor(sec, para, offset, direction),
        null,
      )
      if (fnHit && fnHit.hit === true) {
        return {
          code: 'object_loss',
          ctrlId: 'fn',
          message: 'Cannot delete adjacent document object (fn)',
        }
      }
    } catch {
      // ignore probe errors and fall through to control-position checks
    }
  }

  if (direction === 'backward') {
    if (offset > 0) {
      const take = Math.min(stepCount, offset)
      const startOffset = offset - take
      const endOffset = offset
      const objects = readBodyProtectedControls(docOrBridge, sec, para)
      for (const obj of objects) {
        if (obj.textPos >= startOffset && obj.textPos < endOffset) {
          return {
            code: 'object_loss',
            ctrlId: obj.ctrlId,
            message: `Cannot delete adjacent document object (${obj.ctrlId})`,
          }
        }
      }
      return findProtectedDeletionBlocker(docOrBridge, {
        startSec: sec,
        startPara: para,
        startOffset,
        endSec: sec,
        endPara: para,
        endOffset,
      })
    }
    if (para > 0) {
      const prevPara = para - 1
      const prevLen = readParagraphLength(docOrBridge, sec, prevPara)
      if (prevLen === null) {
        const objects = readBodyProtectedControls(docOrBridge, sec, para)
        for (const obj of objects) {
          if (obj.textPos === 0) {
            return {
              code: 'object_loss',
              ctrlId: obj.ctrlId,
              message: `Cannot delete adjacent document object (${obj.ctrlId})`,
            }
          }
        }
        return null
      }
      return findProtectedDeletionBlocker(docOrBridge, {
        startSec: sec,
        startPara: prevPara,
        startOffset: prevLen,
        endSec: sec,
        endPara: para,
        endOffset: 0,
      })
    }
    return null
  }

  // direction === 'forward'
  const paraLen = readParagraphLength(docOrBridge, sec, para)
  if (paraLen === null || offset < paraLen) {
    const take = paraLen === null ? stepCount : Math.min(stepCount, paraLen - offset)
    const startOffset = offset
    const endOffset = offset + take
    const objects = readBodyProtectedControls(docOrBridge, sec, para)
    for (const obj of objects) {
      if (obj.textPos >= startOffset && obj.textPos < endOffset) {
        return {
          code: 'object_loss',
          ctrlId: obj.ctrlId,
          message: `Cannot delete adjacent document object (${obj.ctrlId})`,
        }
      }
    }
    return findProtectedDeletionBlocker(docOrBridge, {
      startSec: sec,
      startPara: para,
      startOffset,
      endSec: sec,
      endPara: para,
      endOffset,
    })
  }

  const paraCount = readParagraphCount(docOrBridge, sec)
  if (paraCount !== null && para + 1 < paraCount) {
    return findProtectedDeletionBlocker(docOrBridge, {
      startSec: sec,
      startPara: para,
      startOffset: paraLen,
      endSec: sec,
      endPara: para + 1,
      endOffset: 0,
    })
  }
  return null
}

/**
 * Detect whether a protected document object sits immediately at the deletion
 * boundary for a plain Backspace or Delete keystroke in a body paragraph.
 */
export function hasAdjacentProtectedObject(wasm, pos, key) {
  if (!wasm || !pos || typeof pos !== 'object') return false
  if (pos.parentParaIndex !== undefined || pos.isTextBox) return false
  if (key !== 'Backspace' && key !== 'Delete') return false
  const direction = key === 'Backspace' ? 'backward' : 'forward'
  try {
    return findProtectedStepDeletionBlocker(wasm, pos, direction) !== null
  } catch {
    return false
  }
}

/**
 * Resolve a 1-based macro slot number (1..11) from a keyboard event when plain
 * `Alt` is held (`Alt+1`..`Alt+9`, `Alt+0`, `Alt+-`). Uses physical `event.code`
 * first so active IME composition does not break slot resolution.
 */
export function slotFromAltKey(event) {
  if (!event || event.altKey !== true) return null
  if (event.ctrlKey || event.metaKey || event.shiftKey) return null
  const code = typeof event.code === 'string' ? event.code : ''
  if (code.startsWith('Numpad')) return null
  if (code && Object.prototype.hasOwnProperty.call(CODE_TO_SLOT, code)) {
    return CODE_TO_SLOT[code]
  }
  const key = typeof event.key === 'string' ? event.key : ''
  if (key && Object.prototype.hasOwnProperty.call(KEY_TO_SLOT, key)) {
    return KEY_TO_SLOT[key]
  }
  return null
}

function isInvisibleBidiOrZeroWidth(code) {
  return (
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  )
}

/**
 * Safely serialize any string into a valid double-quoted JavaScript string literal,
 * escaping backslashes, double quotes, line breaks, tabs, NUL, control characters,
 * Unicode line/paragraph separators (`\u2028`, `\u2029`), and invisible bidi/zero-width
 * characters (`\u200B-\u200F`, `\u202A-\u202E`, `\u2066-\u2069`).
 */
export function quoteScriptString(text) {
  const value = String(text)
  let out = '"'
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    const code = value.charCodeAt(i)
    if (ch === '\\') {
      out += '\\\\'
    } else if (ch === '"') {
      out += '\\"'
    } else if (ch === '\n') {
      out += '\\n'
    } else if (ch === '\r') {
      out += '\\r'
    } else if (ch === '\t') {
      out += '\\t'
    } else if (code === 0x2028) {
      out += '\\u2028'
    } else if (code === 0x2029) {
      out += '\\u2029'
    } else if (code < 0x20 || isInvisibleBidiOrZeroWidth(code)) {
      out += `\\u${code.toString(16).padStart(4, '0')}`
    } else {
      out += ch
    }
  }
  out += '"'
  return out
}

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function formatScriptValue(value) {
  if (typeof value === 'string') return quoteScriptString(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return 'null'
}

function formatScriptObject(record) {
  const entries = Object.entries(record)
  if (entries.length === 0) return null
  const parts = entries.map(([key, value]) => `${key}: ${formatScriptValue(value)}`)
  return `{ ${parts.join(', ')} }`
}

function sanitizeCharFormatArgs(args) {
  if (!isPlainRecord(args)) return null
  const out = {}
  for (const key of ['bold', 'italic', 'underline', 'strikethrough']) {
    if (typeof args[key] === 'boolean') out[key] = args[key]
  }
  const rawSize = args.fontSize !== undefined ? args.fontSize : args.size
  if (typeof rawSize === 'number' && Number.isFinite(rawSize) && rawSize > 0) {
    // Convert engine HWPUNIT values (> 500) back to points when emitted from editor dialogs.
    const pt = rawSize > 500 ? Math.round((rawSize / 100) * 100) / 100 : rawSize
    if (pt >= 1 && pt <= 500) out.fontSize = pt
  }
  const rawFont = args.fontName !== undefined ? args.fontName : args.font
  if (typeof rawFont === 'string' && rawFont.trim().length > 0) {
    out.fontName = rawFont.trim()
  }
  const rawColor = args.color !== undefined ? args.color : args.textColor
  if (typeof rawColor === 'string' && HEX_COLOR_RE.test(rawColor.trim())) {
    out.color = rawColor.trim()
  }
  return Object.keys(out).length > 0 ? out : null
}

function sanitizeParaFormatArgs(args) {
  if (!isPlainRecord(args)) return null
  const out = {}
  const rawAlign = args.align !== undefined ? args.align : args.alignment
  if (typeof rawAlign === 'string' && VALID_ALIGNMENTS.has(rawAlign)) {
    out.align = rawAlign
  }
  if (
    typeof args.lineSpacing === 'number' &&
    Number.isFinite(args.lineSpacing) &&
    args.lineSpacing >= 50 &&
    args.lineSpacing <= 500
  ) {
    out.lineSpacing = args.lineSpacing
  }
  const numericPairs = [
    ['leftMargin', 'marginLeft', 0, 300],
    ['rightMargin', 'marginRight', 0, 300],
    ['firstLineIndent', 'indent', -100, 100],
    ['spaceBefore', 'spacingBefore', 0, 200],
    ['spaceAfter', 'spacingAfter', 0, 200],
  ]
  for (const [primary, alias, min, max] of numericPairs) {
    const raw = args[primary] !== undefined ? args[primary] : args[alias]
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= min && raw <= max) {
      out[primary] = raw
    }
  }
  if (typeof args.pageBreakBefore === 'boolean') {
    out.pageBreakBefore = args.pageBreakBefore
  }
  return Object.keys(out).length > 0 ? out : null
}

function sanitizeReplaceAllArgs(args) {
  if (!isPlainRecord(args)) return null
  const find = typeof args.find === 'string' ? args.find : args.query
  const replace = typeof args.replace === 'string' ? args.replace : args.replacement
  if (typeof find !== 'string' || find.length === 0 || typeof replace !== 'string') {
    return null
  }
  const opts = {}
  if (typeof args.caseSensitive === 'boolean') opts.caseSensitive = args.caseSensitive
  if (typeof args.wholeWord === 'boolean') opts.wholeWord = args.wholeWord
  if (typeof args.regex === 'boolean') opts.regex = args.regex
  if (typeof args.style === 'string' && args.style.trim().length > 0) {
    opts.style = args.style.trim()
  }
  return { find, replace, opts }
}

function isSilentlyIgnoredCommand(commandId) {
  return (
    SILENTLY_IGNORED_COMMANDS.has(commandId) ||
    commandId.startsWith('ext:ieum-macro-') ||
    commandId.startsWith('ext:ieum-workpane-')
  )
}

function translateCommandToCode(commandId, args, formatState = undefined) {
  switch (commandId) {
    case 'edit:select-all':
      return 'selectAll();'
    case 'insert:page-break':
    case 'page:break':
      return 'breakPage();'
    case 'format:bold': {
      const value = typeof formatState?.bold === 'boolean' ? formatState.bold : true
      return `setCharFormat({ bold: ${value ? 'true' : 'false'} });`
    }
    case 'format:italic': {
      const value = typeof formatState?.italic === 'boolean' ? formatState.italic : true
      return `setCharFormat({ italic: ${value ? 'true' : 'false'} });`
    }
    case 'format:underline': {
      const value = typeof formatState?.underline === 'boolean' ? formatState.underline : true
      return `setCharFormat({ underline: ${value ? 'true' : 'false'} });`
    }
    case 'format:strikethrough': {
      const value =
        typeof formatState?.strikethrough === 'boolean' ? formatState.strikethrough : true
      return `setCharFormat({ strikethrough: ${value ? 'true' : 'false'} });`
    }
    case 'format:align-left':
      return 'setParaFormat({ align: "left" });'
    case 'format:align-center':
      return 'setParaFormat({ align: "center" });'
    case 'format:align-right':
      return 'setParaFormat({ align: "right" });'
    case 'format:align-justify':
      return 'setParaFormat({ align: "justify" });'
    case 'format:char-props':
    case 'apply-char-format': {
      const sanitized = sanitizeCharFormatArgs(args)
      const serialized = sanitized ? formatScriptObject(sanitized) : null
      return serialized ? `setCharFormat(${serialized});` : null
    }
    case 'format:para-props':
    case 'apply-para-format': {
      const sanitized = sanitizeParaFormatArgs(args)
      const serialized = sanitized ? formatScriptObject(sanitized) : null
      return serialized ? `setParaFormat(${serialized});` : null
    }
    case 'format:style':
    case 'format:apply-style':
    case 'style:apply': {
      if (typeof args === 'string' && args.trim().length > 0) {
        return `applyStyle(${quoteScriptString(args.trim())});`
      }
      if (typeof args === 'number' && Number.isInteger(args) && args >= 0) {
        return `applyStyle(${args});`
      }
      if (isPlainRecord(args)) {
        const name = typeof args.name === 'string' ? args.name : args.styleName
        if (typeof name === 'string' && name.trim().length > 0) {
          return `applyStyle(${quoteScriptString(name.trim())});`
        }
        const id = args.id !== undefined ? args.id : args.styleId
        if (typeof id === 'number' && Number.isInteger(id) && id >= 0) {
          return `applyStyle(${id});`
        }
      }
      return null
    }
    case 'table:create': {
      if (!isPlainRecord(args)) return null
      const rows = args.rows !== undefined ? args.rows : args.rowCount
      const cols = args.cols !== undefined ? args.cols : args.colCount
      if (
        Number.isInteger(rows) &&
        rows >= 1 &&
        rows <= 100 &&
        Number.isInteger(cols) &&
        cols >= 1 &&
        cols <= 50
      ) {
        return `insertTable(${rows}, ${cols});`
      }
      return null
    }
    case 'edit:replace-all': {
      const parsed = sanitizeReplaceAllArgs(args)
      if (!parsed) return null
      const optsLiteral = formatScriptObject(parsed.opts)
      const base = `${quoteScriptString(parsed.find)}, ${quoteScriptString(parsed.replace)}`
      return optsLiteral ? `replaceAll(${base}, ${optsLiteral});` : `replaceAll(${base});`
    }
    case 'ext:ieum-toc-refresh':
      return 'refreshToc();'
    case 'ext:ieum-index-refresh':
      return 'refreshIndex();'
    case 'ext:ieum-bib-refresh-list':
      return 'refreshBibliography();'
    default:
      return null
  }
}

/**
 * Create a new macro recorder instance.
 *
 * @param {{ onNotice?: (notice: { kind: 'unsupported_command'; commandId: string; label: string } | { kind: 'mouse_ignored' } | { kind: 'outside_body_ignored' } | { kind: 'slot_run_ignored'; slot: number }) => void }} [options]
 */
export function createMacroRecorder(options = undefined) {
  const onNotice = typeof options?.onNotice === 'function' ? options.onNotice : null
  let recording = false
  let steps = []
  let skipped = []

  const emitNotice = (notice) => {
    if (!onNotice) return
    try {
      onNotice(notice)
    } catch {
      // listener errors must not disrupt editor input
    }
  }

  const recordOutsideBody = () => {
    if (!skipped.some((entry) => entry.commandId === 'macro:outside-body')) {
      skipped.push({ commandId: 'macro:outside-body', label: 'outside-body' })
    }
    emitNotice({ kind: 'outside_body_ignored' })
    return false
  }

  const pushStep = (kind, code, raw = undefined) => {
    const step = raw === undefined ? { kind, code } : { kind, code, raw }
    steps.push(step)
  }

  const getScript = () => steps.map((step) => step.code).join('\n')

  return {
    start() {
      steps = []
      skipped = []
      recording = true
    },

    stop() {
      recording = false
      return {
        script: getScript(),
        stepCount: steps.length,
        skipped: skipped.map((entry) => ({ ...entry })),
      }
    },

    isRecording() {
      return recording
    },

    getStepCount() {
      return steps.length
    },

    getSkipped() {
      return skipped.map((entry) => ({ ...entry }))
    },

    getSteps() {
      return steps.map((step) => ({ ...step }))
    },

    getScript,

    recordText(text, context = undefined) {
      if (!recording || typeof text !== 'string' || text.length === 0) return false
      if (context?.inBody === false) return recordOutsideBody()
      const parts = text.split(/\r?\n/)
      let added = false
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) {
          pushStep('break', 'breakPara();')
          added = true
        }
        const chunk = parts[i]
        if (chunk.length === 0) continue
        const last = steps.length > 0 ? steps[steps.length - 1] : null
        if (last && last.kind === 'text') {
          last.raw += chunk
          last.code = `insertText(${quoteScriptString(last.raw)});`
        } else {
          pushStep('text', `insertText(${quoteScriptString(chunk)});`, chunk)
        }
        added = true
      }
      return added
    },

    recordKey(keyEvent, context = undefined) {
      if (!recording || !keyEvent) return false
      const key = typeof keyEvent.key === 'string' ? keyEvent.key : ''
      const ctrl = Boolean(keyEvent.ctrlKey || keyEvent.metaKey)
      const shift = Boolean(keyEvent.shiftKey)
      const alt = Boolean(keyEvent.altKey)
      const hadSelection = Boolean(context?.hadSelection)
      const navAction =
        typeof context?.navigationAction === 'string' ? context.navigationAction : null

      if (
        key === 'Shift' ||
        key === 'Control' ||
        key === 'Alt' ||
        key === 'Meta' ||
        key === 'CapsLock'
      ) {
        return false
      }

      if (context?.inBody === false) {
        return recordOutsideBody()
      }

      if (navAction) {
        if (navAction === 'wordBackward') {
          pushStep('nav', shift ? 'selectWordLeft();' : 'moveWordLeft();')
          return true
        }
        if (navAction === 'wordForward') {
          pushStep('nav', shift ? 'selectWordRight();' : 'moveWordRight();')
          return true
        }
        if (navAction === 'lineStart') {
          pushStep('nav', shift ? 'selectLineBegin();' : 'moveLineBegin();')
          return true
        }
        if (navAction === 'lineEnd') {
          pushStep('nav', shift ? 'selectLineEnd();' : 'moveLineEnd();')
          return true
        }
        if (navAction === 'docStart') {
          pushStep('nav', shift ? 'selectDocBegin();' : 'moveDocBegin();')
          return true
        }
        if (navAction === 'docEnd') {
          pushStep('nav', shift ? 'selectDocEnd();' : 'moveDocEnd();')
          return true
        }
        const label = key || navAction
        skipped.push({ commandId: `key:${navAction}`, label })
        emitNotice({ kind: 'unsupported_command', commandId: `key:${navAction}`, label })
        return false
      }

      if (alt) {
        if (!ctrl && (key === 'Backspace' || key === 'Delete')) {
          if (hadSelection) {
            pushStep('edit', 'deleteSelection();')
          } else {
            pushStep(
              'edit',
              key === 'Backspace'
                ? 'selectWordLeft(); deleteSelection();'
                : 'selectWordRight(); deleteSelection();',
            )
          }
          return true
        }
        return false
      }

      if (key === 'Backspace') {
        if (hadSelection) {
          pushStep('edit', 'deleteSelection();')
        } else if (keyEvent.metaKey && !keyEvent.ctrlKey) {
          pushStep('edit', 'selectLineBegin(); deleteSelection();')
        } else if (ctrl) {
          pushStep('edit', 'selectWordLeft(); deleteSelection();')
        } else if (context?.adjacentObject === true) {
          skipped.push({ commandId: 'edit:delete-object', label: key })
          emitNotice({ kind: 'unsupported_command', commandId: 'edit:delete-object', label: key })
          return false
        } else {
          pushStep('edit', 'deleteBackward();')
        }
        return true
      }
      if (key === 'Delete') {
        if (hadSelection) {
          pushStep('edit', 'deleteSelection();')
        } else if (ctrl) {
          pushStep('edit', 'selectWordRight(); deleteSelection();')
        } else if (context?.adjacentObject === true) {
          skipped.push({ commandId: 'edit:delete-object', label: key })
          emitNotice({ kind: 'unsupported_command', commandId: 'edit:delete-object', label: key })
          return false
        } else {
          pushStep('edit', 'deleteForward();')
        }
        return true
      }
      if (key === 'Enter') {
        if (!ctrl && !shift) {
          pushStep('break', 'breakPara();')
          return true
        }
        if (shift && !ctrl) {
          skipped.push({ commandId: 'edit:line-break', label: 'Shift+Enter' })
          emitNotice({
            kind: 'unsupported_command',
            commandId: 'edit:line-break',
            label: 'Shift+Enter',
          })
          return false
        }
      }
      if (key === 'Tab' && !ctrl) {
        const label = shift ? 'Shift+Tab' : 'Tab'
        skipped.push({ commandId: 'edit:tab', label })
        emitNotice({ kind: 'unsupported_command', commandId: 'edit:tab', label })
        return false
      }
      if (key === 'ArrowLeft') {
        pushStep(
          'nav',
          shift
            ? ctrl
              ? 'selectWordLeft();'
              : 'selectLeft();'
            : ctrl
              ? 'moveWordLeft();'
              : 'moveLeft();',
        )
        return true
      }
      if (key === 'ArrowRight') {
        pushStep(
          'nav',
          shift
            ? ctrl
              ? 'selectWordRight();'
              : 'selectRight();'
            : ctrl
              ? 'moveWordRight();'
              : 'moveRight();',
        )
        return true
      }
      if (key === 'ArrowUp' && !ctrl) {
        pushStep('nav', shift ? 'selectUp();' : 'moveUp();')
        return true
      }
      if (key === 'ArrowDown' && !ctrl) {
        pushStep('nav', shift ? 'selectDown();' : 'moveDown();')
        return true
      }
      if (key === 'Home') {
        pushStep(
          'nav',
          ctrl
            ? shift
              ? 'selectDocBegin();'
              : 'moveDocBegin();'
            : shift
              ? 'selectLineBegin();'
              : 'moveLineBegin();',
        )
        return true
      }
      if (key === 'End') {
        pushStep(
          'nav',
          ctrl
            ? shift
              ? 'selectDocEnd();'
              : 'moveDocEnd();'
            : shift
              ? 'selectLineEnd();'
              : 'moveLineEnd();',
        )
        return true
      }
      if (key === 'Escape' && !ctrl && !shift) {
        pushStep('nav', 'cancelSelection();')
        return true
      }
      if (key) {
        const label = [ctrl ? 'Ctrl' : '', shift ? 'Shift' : '', key].filter(Boolean).join('+')
        skipped.push({ commandId: `key:${key}`, label })
        emitNotice({ kind: 'unsupported_command', commandId: `key:${key}`, label })
      }
      return false
    },

    recordCommand(
      commandId,
      args = undefined,
      label = undefined,
      formatState = undefined,
      context = undefined,
    ) {
      if (!recording || typeof commandId !== 'string' || commandId.length === 0) return false
      if (isSilentlyIgnoredCommand(commandId)) return false
      if (context?.inBody === false) return recordOutsideBody()
      const code = translateCommandToCode(commandId, args, formatState)
      if (code !== null) {
        pushStep('command', code)
        return true
      }
      const resolvedLabel = typeof label === 'string' && label.length > 0 ? label : commandId
      skipped.push({ commandId, label: resolvedLabel })
      emitNotice({ kind: 'unsupported_command', commandId, label: resolvedLabel })
      return false
    },

    recordMouseMove() {
      if (!recording) return false
      emitNotice({ kind: 'mouse_ignored' })
      return true
    },

    recordSlotRun(slot) {
      if (!recording) return false
      emitNotice({ kind: 'slot_run_ignored', slot })
      return true
    },
  }
}

/** Singleton recorder reference shared by studio recording hooks when recording is active. */
let activeRecorder = null

/** Slots (1..11) that currently have an assigned macro script in the host app. */
const assignedSlots = new Set()

export function setAssignedMacroSlots(slots) {
  assignedSlots.clear()
  if (slots && typeof slots[Symbol.iterator] === 'function') {
    for (const slot of slots) {
      if (Number.isInteger(slot) && slot >= 1 && slot <= MACRO_SLOT_KEYS.length) {
        assignedSlots.add(slot)
      }
    }
  }
  return Array.from(assignedSlots).sort((a, b) => a - b)
}

export function hasAssignedMacroSlot(slot) {
  return Number.isInteger(slot) && assignedSlots.has(slot)
}

export function getActiveMacroRecorder() {
  return activeRecorder
}

export function setActiveMacroRecorder(recorder) {
  activeRecorder = recorder ?? null
  return activeRecorder
}

export function isMacroRecordingActive() {
  return Boolean(activeRecorder?.isRecording?.())
}

export function recordStudioCommand(
  commandId,
  args = undefined,
  label = undefined,
  formatState = undefined,
  context = undefined,
) {
  if (!activeRecorder?.isRecording?.()) return false
  return activeRecorder.recordCommand(commandId, args, label, formatState, context)
}

export function recordStudioText(text, context = undefined) {
  if (!activeRecorder?.isRecording?.()) return false
  return activeRecorder.recordText(text, context)
}

export function recordStudioKey(keyEvent, context = undefined) {
  if (!activeRecorder?.isRecording?.()) return false
  return activeRecorder.recordKey(keyEvent, context)
}

export function recordStudioMouseClick() {
  if (!activeRecorder?.isRecording?.()) return false
  return activeRecorder.recordMouseMove()
}

export function recordStudioSlotRun(slot) {
  if (!activeRecorder?.isRecording?.()) return false
  return activeRecorder.recordSlotRun(slot)
}
