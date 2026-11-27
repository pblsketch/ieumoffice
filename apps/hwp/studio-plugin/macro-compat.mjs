/**
 * Compatibility script object (`HAction` and `HParameterSet`) for the restricted
 * synchronous macro host.
 *
 * Maps classic action-based macro calls strictly onto the safe, engine-backed
 * application document API (`macro-host.mjs`). Every parameter container is a
 * prototype-free safe bag created via `createSafeBag`, and both `HAction` and
 * `HParameterSet` are frozen prototype-free namespaces so scripts cannot reach
 * host prototypes or constructors.
 *
 * Refused actions (`Undo`, `Redo`) and any unrecognized action name immediately
 * raise an error so the enclosing macro transaction rolls back atomically.
 */

import { MAX_INT32, createSafeBag, validateMacroLimits } from './macro-interpreter.mjs'

export const REFUSED_COMPAT_ACTIONS = Object.freeze(new Set(['Undo', 'Redo']))

export const SUPPORTED_COMPAT_ACTIONS = Object.freeze(
  new Set([
    'InsertText',
    'BreakPara',
    'BreakPage',
    'CharShape',
    'ParagraphShape',
    'ParaShape',
    'Style',
    'MoveDocBegin',
    'MoveDocEnd',
    'MoveParaBegin',
    'MoveParaEnd',
    'MoveLineBegin',
    'MoveLineEnd',
    'MoveLeft',
    'MoveRight',
    'MoveUp',
    'MoveDown',
    'Select',
    'SelectAll',
    'Cancel',
    'AllReplace',
    'FindReplace',
    'RepeatFind',
    'TableCreate',
  ]),
)

const ALIGN_MAP = Object.freeze({
  0: 'justify',
  1: 'left',
  2: 'right',
  3: 'center',
})

const ALIGN_NAMES = Object.freeze(new Set(['left', 'center', 'right', 'justify']))

const PARA_UNITS_PER_PT = 200
const MIN_FONT_PT = 1
const MAX_FONT_PT = 500
const MIN_HEIGHT = MIN_FONT_PT * 100
const MAX_HEIGHT = MAX_FONT_PT * 100
const MAX_FONT_NAME = 64
const MIN_LINE_SPACING = 50
const MAX_LINE_SPACING = 500
const MAX_TABLE_ROWS = 100
const MAX_TABLE_COLS = 50

const HEX_6_RE = /^#?([0-9a-fA-F]{6})$/
const HEX_3_RE = /^#?([0-9a-fA-F]{3})$/
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/
// eslint-disable-next-line no-control-regex
const PARAGRAPH_CONTROL_CHARS = /[\u0000-\u0008\u000a-\u001f\u007f]/

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function makeBagWithSelfHSet(initial, limits) {
  const bag = createSafeBag(initial, limits)
  bag.HSet = bag
  return bag
}

function resetBag(bag, defaults) {
  if (!isRecord(bag)) return
  for (const key of Object.keys(bag)) {
    if (key === 'HSet') continue
    delete bag[key]
  }
  for (const [key, value] of Object.entries(defaults)) {
    bag[key] = value
  }
  if (!('HSet' in bag)) {
    bag.HSet = bag
  }
}

function defaultFieldsFor(actionName) {
  switch (actionName) {
    case 'InsertText':
      return { Text: '' }
    case 'CharShape':
      return {
        Bold: undefined,
        Italic: undefined,
        UnderlineType: undefined,
        StrikeOutType: undefined,
        StrikeoutType: undefined,
        Height: undefined,
        FontSize: undefined,
        FaceNameHangul: undefined,
        FaceNameLatin: undefined,
        TextColor: undefined,
      }
    case 'ParagraphShape':
    case 'ParaShape':
      return {
        AlignType: undefined,
        LineSpacing: undefined,
        LineSpacingType: undefined,
        LeftMargin: undefined,
        RightMargin: undefined,
        Indentation: undefined,
        PrevSpacing: undefined,
        NextSpacing: undefined,
        PagebreakBefore: undefined,
      }
    case 'Style':
      return {
        StyleName: undefined,
        Style: undefined,
      }
    case 'AllReplace':
    case 'FindReplace':
    case 'RepeatFind':
      return {
        FindString: '',
        ReplaceString: '',
        MatchCase: false,
        WholeWordOnly: false,
        FindRegExp: false,
        UseWildCards: false,
      }
    case 'TableCreate':
      return {
        Rows: 2,
        Cols: 2,
      }
    default:
      return {}
  }
}

function parseBoolToggle(value, fieldName, fail) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isInteger(value) && (value === 0 || value === 1)) {
    return value === 1
  }
  fail('invalid_argument', `Invalid ${fieldName}: expected boolean or 0/1`)
}

function parseTypeToggle(value, fieldName, fail) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_INT32) {
    return value > 0
  }
  fail('invalid_argument', `Invalid ${fieldName}: expected boolean or non-negative integer`)
}

function parseCompatColor(value, fail) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const m6 = HEX_6_RE.exec(trimmed)
    if (m6) return `#${m6[1].toLowerCase()}`
    const m3 = HEX_3_RE.exec(trimmed)
    if (m3) {
      const [r, g, b] = m3[1].toLowerCase()
      return `#${r}${r}${g}${g}${b}${b}`
    }
    fail(
      'invalid_argument',
      'Invalid TextColor: expected #RRGGBB hex string or integer 0..0xffffff',
    )
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffff) {
      fail('invalid_argument', 'Invalid TextColor: numeric color must be an integer 0..0xffffff')
    }
    // ParameterSet numeric TextColor is packed in BGR (0xBBGGRR) order.
    const r = value & 0xff
    const g = (value >> 8) & 0xff
    const b = (value >> 16) & 0xff
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
  }
  fail('invalid_argument', 'Invalid TextColor: expected #RRGGBB hex string or integer 0..0xffffff')
}

function parseCompatParaUnit(value, fieldName, minUnits, maxUnits, fail) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail(
      'invalid_argument',
      `Invalid ${fieldName}: expected an even integer between ${minUnits} and ${maxUnits} (200 units = 1 pt)`,
    )
  }
  if ((value & 1) !== 0) {
    fail(
      'invalid_argument',
      `Invalid ${fieldName}: odd URC values (relative character units) are not supported; pass an even HWPUNIT*2 integer (200 units = 1 pt)`,
    )
  }
  if (value < minUnits || value > maxUnits) {
    fail(
      'invalid_argument',
      `Invalid ${fieldName}: expected an even integer between ${minUnits} and ${maxUnits} (200 units = 1 pt)`,
    )
  }
  return value / PARA_UNITS_PER_PT
}

function isTruthyCompatFlag(value) {
  return value !== undefined && value !== null && value !== false && value !== 0
}

function parseCompatAlign(value, fail) {
  if (typeof value === 'number') {
    if (Number.isInteger(value) && Object.prototype.hasOwnProperty.call(ALIGN_MAP, value)) {
      return ALIGN_MAP[value]
    }
    fail('invalid_argument', 'Invalid AlignType: expected 0..3 or left/center/right/justify')
  }
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase()
    if (ALIGN_NAMES.has(lower)) return lower
  }
  fail('invalid_argument', 'Invalid AlignType: expected 0..3 or left/center/right/justify')
}

function mapCharShapeProps(pset, fail) {
  if (!isRecord(pset)) {
    fail('invalid_argument', 'CharShape requires a parameter set object')
  }
  const props = Object.create(null)
  let count = 0
  if (pset.Bold !== undefined && pset.Bold !== null) {
    props.bold = parseBoolToggle(pset.Bold, 'Bold', fail)
    count += 1
  }
  if (pset.Italic !== undefined && pset.Italic !== null) {
    props.italic = parseBoolToggle(pset.Italic, 'Italic', fail)
    count += 1
  }
  if (pset.UnderlineType !== undefined && pset.UnderlineType !== null) {
    props.underline = parseTypeToggle(pset.UnderlineType, 'UnderlineType', fail)
    count += 1
  }
  const rawStrike =
    pset.StrikeOutType !== undefined && pset.StrikeOutType !== null
      ? pset.StrikeOutType
      : pset.StrikeoutType
  if (rawStrike !== undefined && rawStrike !== null) {
    props.strikethrough = parseTypeToggle(
      rawStrike,
      pset.StrikeOutType !== undefined && pset.StrikeOutType !== null
        ? 'StrikeOutType'
        : 'StrikeoutType',
      fail,
    )
    count += 1
  }
  if (pset.Height !== undefined && pset.Height !== null) {
    const raw = pset.Height
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < MIN_HEIGHT || raw > MAX_HEIGHT) {
      fail(
        'invalid_argument',
        `Invalid Height: expected a number between ${MIN_HEIGHT} and ${MAX_HEIGHT} (100 units = 1 pt)`,
      )
    }
    props.fontSize = raw / 100
    count += 1
  } else if (pset.FontSize !== undefined && pset.FontSize !== null) {
    const raw = pset.FontSize
    if (
      typeof raw !== 'number' ||
      !Number.isFinite(raw) ||
      raw < MIN_FONT_PT ||
      raw > MAX_FONT_PT
    ) {
      fail(
        'invalid_argument',
        `Invalid FontSize: expected a number between ${MIN_FONT_PT} and ${MAX_FONT_PT}`,
      )
    }
    props.fontSize = raw
    count += 1
  }
  const hasHangulFace = pset.FaceNameHangul !== undefined && pset.FaceNameHangul !== null
  const hasLatinFace = pset.FaceNameLatin !== undefined && pset.FaceNameLatin !== null
  const validateFaceName = (raw, fieldName, allowEmpty) => {
    if (typeof raw !== 'string') {
      fail(
        'invalid_argument',
        `Invalid ${fieldName}: expected a non-empty string up to ${MAX_FONT_NAME} characters`,
      )
    }
    const trimmed = raw.trim()
    if (
      (!allowEmpty && trimmed.length === 0) ||
      trimmed.length > MAX_FONT_NAME ||
      CONTROL_CHARS_RE.test(raw)
    ) {
      fail(
        'invalid_argument',
        `Invalid ${fieldName}: expected a non-empty string up to ${MAX_FONT_NAME} characters`,
      )
    }
    return trimmed
  }
  const latinNonEmpty =
    hasLatinFace && typeof pset.FaceNameLatin === 'string' && pset.FaceNameLatin.trim().length > 0
  const hangulNonEmpty =
    hasHangulFace &&
    typeof pset.FaceNameHangul === 'string' &&
    pset.FaceNameHangul.trim().length > 0
  const hangulFace = hasHangulFace
    ? validateFaceName(pset.FaceNameHangul, 'FaceNameHangul', latinNonEmpty)
    : ''
  const latinFace = hasLatinFace
    ? validateFaceName(pset.FaceNameLatin, 'FaceNameLatin', hangulNonEmpty)
    : ''
  const face = hangulFace || latinFace || null
  if (face !== null) {
    props.fontName = face
    count += 1
  }
  if (pset.TextColor !== undefined && pset.TextColor !== null) {
    props.textColor = parseCompatColor(pset.TextColor, fail)
    count += 1
  }
  if (count === 0) {
    fail('invalid_argument', 'CharShape parameter set specifies no character properties')
  }
  return props
}

function mapParaShapeProps(pset, fail) {
  if (!isRecord(pset)) {
    fail('invalid_argument', 'ParagraphShape requires a parameter set object')
  }
  const props = Object.create(null)
  let count = 0
  if (pset.AlignType !== undefined && pset.AlignType !== null) {
    props.align = parseCompatAlign(pset.AlignType, fail)
    count += 1
  }
  if (pset.LineSpacingType !== undefined && pset.LineSpacingType !== null) {
    if (pset.LineSpacingType !== 0) {
      fail(
        'unsupported_action',
        'HParaShape.LineSpacingType other than 0 (Percent) is not supported',
        { unsupportedAction: 'LineSpacingType' },
      )
    }
  }
  if (pset.LineSpacing !== undefined && pset.LineSpacing !== null) {
    const raw = pset.LineSpacing
    if (
      typeof raw !== 'number' ||
      !Number.isFinite(raw) ||
      raw < MIN_LINE_SPACING ||
      raw > MAX_LINE_SPACING
    ) {
      fail(
        'invalid_argument',
        `Invalid LineSpacing: expected a number between ${MIN_LINE_SPACING} and ${MAX_LINE_SPACING}`,
      )
    }
    props.lineSpacing = raw
    count += 1
  }
  if (pset.LeftMargin !== undefined && pset.LeftMargin !== null) {
    props.leftMargin = parseCompatParaUnit(pset.LeftMargin, 'LeftMargin', 0, 60000, fail)
    count += 1
  }
  if (pset.RightMargin !== undefined && pset.RightMargin !== null) {
    props.rightMargin = parseCompatParaUnit(pset.RightMargin, 'RightMargin', 0, 60000, fail)
    count += 1
  }
  if (pset.Indentation !== undefined && pset.Indentation !== null) {
    props.firstLineIndent = parseCompatParaUnit(
      pset.Indentation,
      'Indentation',
      -20000,
      20000,
      fail,
    )
    count += 1
  }
  if (pset.PrevSpacing !== undefined && pset.PrevSpacing !== null) {
    props.spaceBefore = parseCompatParaUnit(pset.PrevSpacing, 'PrevSpacing', 0, 40000, fail)
    count += 1
  }
  if (pset.NextSpacing !== undefined && pset.NextSpacing !== null) {
    props.spaceAfter = parseCompatParaUnit(pset.NextSpacing, 'NextSpacing', 0, 40000, fail)
    count += 1
  }
  const hasLowerPageBreak = pset.PagebreakBefore !== undefined && pset.PagebreakBefore !== null
  const rawPageBreak = hasLowerPageBreak ? pset.PagebreakBefore : pset.PageBreakBefore
  if (rawPageBreak !== undefined && rawPageBreak !== null) {
    props.pageBreakBefore = parseBoolToggle(
      rawPageBreak,
      hasLowerPageBreak ? 'PagebreakBefore' : 'PageBreakBefore',
      fail,
    )
    count += 1
  }
  if (count === 0) {
    fail('invalid_argument', 'ParagraphShape parameter set specifies no paragraph properties')
  }
  return props
}

function validateFindFlags(src, fail) {
  if (isTruthyCompatFlag(src.UseWildCards)) {
    fail(
      'unsupported_action',
      'HFindReplace.UseWildCards is not supported; wildcard syntax differs from regular expressions (use FindRegExp instead)',
      { unsupportedAction: 'UseWildCards' },
    )
  }
  if (isTruthyCompatFlag(src.RegExp)) {
    fail(
      'invalid_argument',
      'HFindReplace.RegExp is not a valid parameter name; use HFindReplace.FindRegExp instead',
    )
  }
}

function extractFindOptions(pset, fallbackBag, fail, requireNonEmptyQuery = true) {
  const src = isRecord(pset) ? pset : fallbackBag
  validateFindFlags(src, fail)
  if (
    src.FindString !== undefined &&
    src.FindString !== null &&
    typeof src.FindString !== 'string'
  ) {
    fail('invalid_argument', 'Invalid FindString: expected a string')
  }
  const query = typeof src.FindString === 'string' ? src.FindString : ''
  if (requireNonEmptyQuery && query.length === 0) {
    fail('invalid_argument', 'Invalid FindString: expected a non-empty string')
  }
  if (
    src.ReplaceString !== undefined &&
    src.ReplaceString !== null &&
    typeof src.ReplaceString !== 'string'
  ) {
    fail('invalid_argument', 'Invalid ReplaceString: expected a string')
  }
  const replacement = typeof src.ReplaceString === 'string' ? src.ReplaceString : ''
  if (PARAGRAPH_CONTROL_CHARS.test(replacement)) {
    fail(
      'invalid_argument',
      'Invalid ReplaceString: must be a string without line breaks or control characters',
    )
  }
  const caseSensitive = Boolean(src.MatchCase)
  const wholeWord = Boolean(src.WholeWordOnly)
  const regex =
    src.FindRegExp !== undefined && src.FindRegExp !== null
      ? parseBoolToggle(src.FindRegExp, 'FindRegExp', fail)
      : false
  return { query, replacement, opts: { caseSensitive, wholeWord, regex } }
}

function parseCompatCount(pset, fail) {
  if (!isRecord(pset) || pset.Count === undefined) return undefined
  const raw = pset.Count
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > MAX_INT32) {
    fail('invalid_argument', `Invalid Count: expected an integer between 1 and ${MAX_INT32}`)
  }
  return raw
}

/**
 * Create frozen, prototype-free compatibility globals (`HAction` and
 * `HParameterSet`) backed by the application macro API.
 */
export function createCompatGlobals(api, options = undefined) {
  if (!api || typeof api !== 'object') {
    throw new TypeError('createCompatGlobals requires a macro API object')
  }
  const limits = validateMacroLimits(options?.limits)
  const state = options?.state ?? null

  const fail = (code, message, extra = undefined) => {
    if (state && typeof state.recordError === 'function') {
      state.recordError(code, message, extra)
    }
    const err = new Error(message)
    err.code = code
    if (extra && extra.unsupportedAction !== undefined) {
      err.unsupportedAction = extra.unsupportedAction
    }
    throw err
  }

  const assertSupportedAction = (actionName) => {
    if (typeof actionName !== 'string' || actionName.length === 0) {
      fail('invalid_argument', 'Macro action name must be a non-empty string')
    }
    if (REFUSED_COMPAT_ACTIONS.has(actionName)) {
      fail(
        'unsupported_action',
        `Unsupported macro action "${actionName}": Undo/Redo are not permitted inside a macro`,
        { unsupportedAction: actionName },
      )
    }
    if (!SUPPORTED_COMPAT_ACTIONS.has(actionName)) {
      fail('unsupported_action', `Unsupported macro action "${actionName}"`, {
        unsupportedAction: actionName,
      })
    }
  }

  const HInsertText = makeBagWithSelfHSet(defaultFieldsFor('InsertText'), limits)
  const HCharShape = makeBagWithSelfHSet(defaultFieldsFor('CharShape'), limits)
  const HParaShape = makeBagWithSelfHSet(defaultFieldsFor('ParagraphShape'), limits)
  const HStyle = makeBagWithSelfHSet(defaultFieldsFor('Style'), limits)
  const HFindReplace = makeBagWithSelfHSet(defaultFieldsFor('FindReplace'), limits)
  const HTableCreation = makeBagWithSelfHSet(defaultFieldsFor('TableCreate'), limits)
  const HSelectionOpt = makeBagWithSelfHSet({}, limits)

  const psetNamespace = Object.create(null)
  psetNamespace.HInsertText = HInsertText
  psetNamespace.HCharShape = HCharShape
  psetNamespace.HParaShape = HParaShape
  psetNamespace.HStyle = HStyle
  psetNamespace.HFindReplace = HFindReplace
  psetNamespace.HTableCreation = HTableCreation
  psetNamespace.HSelectionOpt = HSelectionOpt
  const HParameterSet = Object.freeze(psetNamespace)

  let selectAnchor = null

  const applyMoveWithAnchor = (moveFn) => {
    moveFn()
    if (selectAnchor !== null) {
      const cur = api.getCaret()
      api.select(
        selectAnchor.sec,
        selectAnchor.para,
        selectAnchor.offset,
        cur.sec,
        cur.para,
        cur.offset,
      )
    }
  }

  const runRepeatFind = (pset) => {
    const src = isRecord(pset) ? pset : HFindReplace
    validateFindFlags(src, fail)
    if (
      src.FindString !== undefined &&
      src.FindString !== null &&
      typeof src.FindString !== 'string'
    ) {
      fail('invalid_argument', 'Invalid FindString: expected a string')
    }
    const query =
      typeof src.FindString === 'string' && src.FindString.length > 0
        ? src.FindString
        : typeof state?.lastFind?.query === 'string'
          ? state.lastFind.query
          : ''
    if (query.length === 0) {
      fail('invalid_argument', 'RepeatFind requires a non-empty FindString or prior search')
    }
    const opts = {
      caseSensitive:
        src.MatchCase !== undefined
          ? Boolean(src.MatchCase)
          : Boolean(state?.lastFind?.caseSensitive),
      wholeWord:
        src.WholeWordOnly !== undefined
          ? Boolean(src.WholeWordOnly)
          : Boolean(state?.lastFind?.wholeWord),
      regex:
        src.FindRegExp !== undefined && src.FindRegExp !== null
          ? parseBoolToggle(src.FindRegExp, 'FindRegExp', fail)
          : Boolean(state?.lastFind?.regex),
    }
    const matches = api.find(query, opts)
    const sel = api.getSelection()
    const origin = sel
      ? { sec: sel.endSec, para: sel.endPara, offset: sel.endOffset }
      : api.getCaret()

    const next = matches.find((m) => {
      if (m.sec !== origin.sec) return m.sec > origin.sec
      if (m.para !== origin.para) return m.para > origin.para
      if (m.kind === 'body') return m.offset >= origin.offset
      return true
    })

    if (!next) {
      return false
    }
    selectAnchor = null
    if (next.kind === 'body') {
      api.select(next.sec, next.para, next.offset, next.sec, next.para, next.offset + next.length)
    }
    return true
  }

  const executeAction = (actionName, pset = undefined) => {
    assertSupportedAction(actionName)
    switch (actionName) {
      case 'InsertText': {
        selectAnchor = null
        const src = isRecord(pset) ? pset : HInsertText
        if (
          src.Text !== undefined &&
          typeof src.Text !== 'string' &&
          typeof src.Text !== 'number' &&
          typeof src.Text !== 'boolean'
        ) {
          fail('invalid_argument', 'Invalid Text: expected a string, number, or boolean')
        }
        api.insertText(src.Text !== undefined ? src.Text : '')
        return true
      }
      case 'BreakPara': {
        selectAnchor = null
        api.breakPara()
        return true
      }
      case 'BreakPage': {
        selectAnchor = null
        api.breakPage()
        return true
      }
      case 'CharShape': {
        const src = isRecord(pset) ? pset : HCharShape
        api.setCharFormat(mapCharShapeProps(src, fail))
        return true
      }
      case 'ParagraphShape':
      case 'ParaShape': {
        const src = isRecord(pset) ? pset : HParaShape
        api.setParaFormat(mapParaShapeProps(src, fail))
        return true
      }
      case 'Style': {
        const src = isRecord(pset) ? pset : HStyle
        const hasStyleName = src.StyleName !== undefined && src.StyleName !== null
        const fieldName = hasStyleName ? 'StyleName' : 'Style'
        const target = hasStyleName ? src.StyleName : src.Style
        if (target === undefined || target === null) {
          fail('invalid_argument', 'Style action requires StyleName or Style')
        }
        if (typeof target === 'number') {
          if (!Number.isInteger(target) || target < 0 || target > MAX_INT32) {
            fail(
              'invalid_argument',
              `Invalid ${fieldName}: expected a non-negative integer style id or non-empty style name`,
            )
          }
        } else if (typeof target === 'string') {
          if (target.trim().length === 0) {
            fail('invalid_argument', `Invalid ${fieldName}: expected a non-empty style name`)
          }
        } else {
          fail(
            'invalid_argument',
            `Invalid ${fieldName}: expected a style name string or non-negative integer style id`,
          )
        }
        api.applyStyle(target)
        return true
      }
      case 'MoveDocBegin':
        applyMoveWithAnchor(() => api.moveDocBegin())
        return true
      case 'MoveDocEnd':
        applyMoveWithAnchor(() => api.moveDocEnd())
        return true
      case 'MoveParaBegin':
        applyMoveWithAnchor(() => api.moveParaBegin())
        return true
      case 'MoveParaEnd':
        applyMoveWithAnchor(() => api.moveParaEnd())
        return true
      case 'MoveLineBegin':
        applyMoveWithAnchor(() => api.moveLineBegin())
        return true
      case 'MoveLineEnd':
        applyMoveWithAnchor(() => api.moveLineEnd())
        return true
      case 'MoveLeft':
        applyMoveWithAnchor(() => api.moveLeft(parseCompatCount(pset, fail)))
        return true
      case 'MoveRight':
        applyMoveWithAnchor(() => api.moveRight(parseCompatCount(pset, fail)))
        return true
      case 'MoveUp':
        applyMoveWithAnchor(() => api.moveUp(parseCompatCount(pset, fail)))
        return true
      case 'MoveDown':
        applyMoveWithAnchor(() => api.moveDown(parseCompatCount(pset, fail)))
        return true
      case 'Select': {
        if (
          isRecord(pset) &&
          (pset.StartSec !== undefined ||
            pset.FromSec !== undefined ||
            pset.StartPara !== undefined ||
            pset.FromPara !== undefined)
        ) {
          selectAnchor = null
          const fromSec = pset.StartSec ?? pset.FromSec ?? 0
          const fromPara = pset.StartPara ?? pset.FromPara ?? 0
          const fromOffset = pset.StartOffset ?? pset.FromOffset ?? 0
          const toSec = pset.EndSec ?? pset.ToSec ?? fromSec
          const toPara = pset.EndPara ?? pset.ToPara ?? fromPara
          const toOffset = pset.EndOffset ?? pset.ToOffset ?? fromOffset
          api.select(fromSec, fromPara, fromOffset, toSec, toPara, toOffset)
          return true
        }
        if (selectAnchor === null) {
          selectAnchor = api.getCaret()
        } else {
          selectAnchor = null
          api.cancelSelection()
        }
        return true
      }
      case 'SelectAll': {
        selectAnchor = null
        api.selectAll()
        return true
      }
      case 'Cancel': {
        selectAnchor = null
        api.cancelSelection()
        return true
      }
      case 'AllReplace': {
        selectAnchor = null
        const { query, replacement, opts } = extractFindOptions(pset, HFindReplace, fail)
        return api.replaceAll(query, replacement, opts)
      }
      case 'FindReplace': {
        selectAnchor = null
        const { query, replacement, opts } = extractFindOptions(pset, HFindReplace, fail)
        return api.replaceNext(query, replacement, opts)
      }
      case 'RepeatFind': {
        return runRepeatFind(pset)
      }
      case 'TableCreate': {
        selectAnchor = null
        const src = isRecord(pset) ? pset : HTableCreation
        if (
          typeof src.Rows !== 'number' ||
          !Number.isInteger(src.Rows) ||
          src.Rows < 1 ||
          src.Rows > MAX_TABLE_ROWS
        ) {
          fail(
            'invalid_argument',
            `Invalid Rows: expected an integer between 1 and ${MAX_TABLE_ROWS}`,
          )
        }
        if (
          typeof src.Cols !== 'number' ||
          !Number.isInteger(src.Cols) ||
          src.Cols < 1 ||
          src.Cols > MAX_TABLE_COLS
        ) {
          fail(
            'invalid_argument',
            `Invalid Cols: expected an integer between 1 and ${MAX_TABLE_COLS}`,
          )
        }
        return api.insertTable(src.Rows, src.Cols)
      }
      default:
        fail('unsupported_action', `Unsupported macro action "${actionName}"`, {
          unsupportedAction: actionName,
        })
    }
  }

  const actionNamespace = Object.create(null)
  actionNamespace.GetDefault = (actionName, pset = undefined) => {
    assertSupportedAction(actionName)
    if (isRecord(pset)) {
      resetBag(pset, defaultFieldsFor(actionName))
    }
    return true
  }
  actionNamespace.Execute = (actionName, pset = undefined) => executeAction(actionName, pset)
  actionNamespace.Run = (actionName) => executeAction(actionName, undefined)
  const HAction = Object.freeze(actionNamespace)

  return Object.freeze({ HAction, HParameterSet })
}
