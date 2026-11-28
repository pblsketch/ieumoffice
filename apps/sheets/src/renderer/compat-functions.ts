/**
 * MS Excel 2013-365 and Google Sheets compatibility functions that Univer's
 * built-in formula engine declares or omits.
 *
 * Excel 2013-365:
 *   ISO.CEILING, REGEXTEST, ISOMITTED, JIS, PERCENTOF, TRIMRANGE
 * Google Sheets:
 *   ARRAYFORMULA, SPLIT, JOIN, COUNTUNIQUE, COUNTUNIQUEIFS, SORTN,
 *   TO_TEXT, TO_PERCENT, TO_DOLLARS, TO_PURE_NUMBER,
 *   ADD, DIVIDE, POW, EQ, NE, GT, GTE, LT, LTE, UMINUS, UPLUS, UNARY_PERCENT
 *
 * Built-in executors are never overwritten: every executor is registered only
 * when the engine does not already provide one, and descriptions are registered
 * only when IDescriptionService lacks an entry so localized Univer docs stay
 * intact.
 */
import {
  ArrayValueObject,
  BaseFunction,
  BooleanValueObject,
  ErrorType,
  ErrorValueObject,
  FUNCTION_NAMES_LOOKUP,
  FunctionType,
  IFunctionService,
  NullValueObject,
  NumberValueObject,
  StringValueObject,
  functionLookup,
  type BaseValueObject,
  type IFunctionInfo,
} from '@univerjs/engine-formula'
import { IDescriptionService } from '@univerjs/sheets-formula'

import type { UniverRuntime } from './univer-state'

type CalcResult = ReturnType<BaseFunction['calculate']>

function unwrapScalar(value: BaseValueObject): BaseValueObject {
  if (value.isArray()) {
    const arr = value as ArrayValueObject
    if (arr.getRowCount() === 1 && arr.getColumnCount() === 1) {
      return arr.getFirstCell()
    }
  }
  return value
}

function toGrid(value: BaseValueObject): BaseValueObject[][] {
  if (value.isArray()) {
    const arr = value as ArrayValueObject
    const rows = arr.getRowCount()
    const cols = arr.getColumnCount()
    const out: BaseValueObject[][] = []
    for (let r = 0; r < rows; r += 1) {
      const line: BaseValueObject[] = []
      for (let c = 0; c < cols; c += 1) {
        line.push(arr.get(r, c) ?? NullValueObject.create())
      }
      out.push(line)
    }
    return out
  }
  return [[value]]
}

function makeArray(grid: BaseValueObject[][]): BaseValueObject {
  const rowCount = grid.length
  const columnCount = grid[0]?.length ?? 0
  if (rowCount === 1 && columnCount === 1) {
    return grid[0]![0]!
  }
  return ArrayValueObject.create({
    calculateValueList: grid,
    rowCount,
    columnCount,
    unitId: '',
    sheetId: '',
    row: 0,
    column: 0,
  })
}

function toNumberValue(value: BaseValueObject): number | ErrorValueObject {
  const cell = unwrapScalar(value)
  if (cell.isError()) return cell as ErrorValueObject
  if (cell.isNull()) return 0
  if (cell.isNumber()) return Number(cell.getValue())
  if (cell.isBoolean()) return cell.getValue() ? 1 : 0
  if (cell.isString()) {
    const raw = String(cell.getValue()).trim()
    if (raw === '') return ErrorValueObject.create(ErrorType.VALUE)
    const parsed = Number(raw)
    if (Number.isFinite(parsed)) return parsed
  }
  return ErrorValueObject.create(ErrorType.VALUE)
}

function toBooleanValue(value: BaseValueObject): boolean | ErrorValueObject {
  const cell = unwrapScalar(value)
  if (cell.isError()) return cell as ErrorValueObject
  if (cell.isNull()) return false
  if (cell.isBoolean()) return Boolean(cell.getValue())
  if (cell.isNumber()) return Number(cell.getValue()) !== 0
  if (cell.isString()) {
    const upper = String(cell.getValue()).trim().toUpperCase()
    if (upper === 'TRUE') return true
    if (upper === 'FALSE') return false
  }
  return ErrorValueObject.create(ErrorType.VALUE)
}

function toStringValue(value: BaseValueObject): string | ErrorValueObject {
  const cell = unwrapScalar(value)
  if (cell.isError()) return cell as ErrorValueObject
  if (cell.isNull()) return ''
  if (cell.isBoolean()) return cell.getValue() ? 'TRUE' : 'FALSE'
  return String(cell.getValue())
}

/// Excel/Sheets comparison order: number < string (case-insensitive) < boolean.
function compareValues(a: BaseValueObject, b: BaseValueObject): number {
  const rank = (v: BaseValueObject): number => {
    if (v.isNull()) return 0
    if (v.isNumber()) return 1
    if (v.isString()) return 2
    if (v.isBoolean()) return 3
    return 4
  }
  // Empty cell equals 0 or "" depending on the other operand in Excel, so map
  // Null to 0 against number, "" against string, false against boolean.
  if (a.isNull() && b.isNull()) return 0
  if (a.isNull()) {
    if (b.isNumber()) return 0 - Number(b.getValue())
    if (b.isString()) return ''.localeCompare(String(b.getValue()).toLowerCase())
    if (b.isBoolean()) return b.getValue() ? -1 : 0
  }
  if (b.isNull()) {
    if (a.isNumber()) return Number(a.getValue()) - 0
    if (a.isString()) return String(a.getValue()).toLowerCase().localeCompare('')
    if (a.isBoolean()) return a.getValue() ? 1 : 0
  }
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra - rb
  if (a.isNumber()) return Number(a.getValue()) - Number(b.getValue())
  if (a.isBoolean()) return Number(Boolean(a.getValue())) - Number(Boolean(b.getValue()))
  const sa = String(a.getValue()).toLowerCase()
  const sb = String(b.getValue()).toLowerCase()
  return sa < sb ? -1 : sa > sb ? 1 : 0
}

function wildcardToRegex(pattern: string): RegExp {
  let out = '^'
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]!
    if (ch === '~' && i + 1 < pattern.length) {
      out += pattern[i + 1]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      i += 1
    } else if (ch === '*') {
      out += '[\\s\\S]*'
    } else if (ch === '?') {
      out += '[\\s\\S]'
    } else {
      out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  out += '$'
  return new RegExp(out, 'i')
}

function matchesCriteria(cell: BaseValueObject, criteria: BaseValueObject): boolean {
  if (criteria.isError()) {
    return cell.isError() && cell.getValue() === criteria.getValue()
  }
  if (criteria.isNull()) {
    return cell.isNull() || (cell.isString() && cell.getValue() === '')
  }
  if (criteria.isNumber()) {
    if (cell.isError()) return false
    if (cell.isNumber()) return Number(cell.getValue()) === Number(criteria.getValue())
    if (cell.isString()) {
      const s = String(cell.getValue()).trim()
      return s !== '' && Number(s) === Number(criteria.getValue())
    }
    return false
  }
  if (criteria.isBoolean()) {
    return cell.isBoolean() && Boolean(cell.getValue()) === Boolean(criteria.getValue())
  }
  const raw = String(criteria.getValue())
  const opMatch = /^(<=|>=|<>|<|>|=)([\s\S]*)$/.exec(raw)
  const op = opMatch ? opMatch[1]! : '='
  const rhs = opMatch ? opMatch[2]! : raw

  if (op === '=' || op === '<>') {
    let equal = false
    if (rhs === '') {
      equal = cell.isNull() || (cell.isString() && cell.getValue() === '')
    } else if (!cell.isError()) {
      const rhsUpper = rhs.toUpperCase()
      const rhsNum = Number(rhs)
      if (cell.isBoolean() && (rhsUpper === 'TRUE' || rhsUpper === 'FALSE')) {
        equal = Boolean(cell.getValue()) === (rhsUpper === 'TRUE')
      } else if (cell.isNumber() && rhs.trim() !== '' && Number.isFinite(rhsNum)) {
        equal = Number(cell.getValue()) === rhsNum
      } else if (cell.isString()) {
        const cellStr = String(cell.getValue())
        if (/[*?~]/.test(rhs)) {
          equal = wildcardToRegex(rhs).test(cellStr)
        } else {
          equal = cellStr.toLowerCase() === rhs.toLowerCase()
        }
      } else if (cell.isNumber()) {
        equal = wildcardToRegex(rhs).test(String(cell.getValue()))
      }
    }
    return op === '=' ? equal : !equal
  }

  // Ordering operators (<, <=, >, >=) only match numbers or strings of the same kind.
  if (cell.isError() || cell.isNull() || cell.isBoolean()) return false
  const rhsNum = Number(rhs)
  if (rhs.trim() !== '' && Number.isFinite(rhsNum)) {
    if (!cell.isNumber()) return false
    const lhs = Number(cell.getValue())
    if (op === '<') return lhs < rhsNum
    if (op === '<=') return lhs <= rhsNum
    if (op === '>') return lhs > rhsNum
    return lhs >= rhsNum
  }
  if (!cell.isString()) return false
  const lhsStr = String(cell.getValue()).toLowerCase()
  const rhsStr = rhs.toLowerCase()
  if (op === '<') return lhsStr < rhsStr
  if (op === '<=') return lhsStr <= rhsStr
  if (op === '>') return lhsStr > rhsStr
  return lhsStr >= rhsStr
}

function uniqueKey(cell: BaseValueObject): string | null {
  if (cell.isNull()) return null
  if (cell.isString()) {
    const s = String(cell.getValue())
    return s === '' ? null : `s:${s}`
  }
  if (cell.isNumber()) return `n:${Number(cell.getValue())}`
  if (cell.isBoolean()) return `b:${cell.getValue() ? 1 : 0}`
  if (cell.isError()) return `e:${String(cell.getValue())}`
  return `o:${String(cell.getValue())}`
}

// --- Excel 2013-365 functions ---

export class IsoCeilingFunction extends BaseFunction {
  override minParams = 1
  override maxParams = 2

  override calculate(numberArg: BaseValueObject, significanceArg?: BaseValueObject): CalcResult {
    const num = toNumberValue(numberArg)
    if (num instanceof ErrorValueObject) return num
    let sig = 1
    if (significanceArg !== undefined && !significanceArg.isNull()) {
      const parsed = toNumberValue(significanceArg)
      if (parsed instanceof ErrorValueObject) return parsed
      sig = Math.abs(parsed)
    }
    if (num === 0 || sig === 0) return NumberValueObject.create(0)
    const ratio = num / sig
    const nearest = Math.round(ratio)
    const ceiled = Math.abs(ratio - nearest) < 1e-12 ? nearest : Math.ceil(ratio)
    const result = ceiled * sig
    return NumberValueObject.create(Object.is(result, -0) ? 0 : result)
  }
}

export class RegextestFunction extends BaseFunction {
  override minParams = 2
  override maxParams = 3

  override calculate(
    textArg: BaseValueObject,
    patternArg: BaseValueObject,
    caseSensitivityArg?: BaseValueObject,
  ): CalcResult {
    const patternStr = toStringValue(patternArg)
    if (patternStr instanceof ErrorValueObject) return patternStr
    let caseInsensitive = false
    if (caseSensitivityArg !== undefined && !caseSensitivityArg.isNull()) {
      const flag = toNumberValue(caseSensitivityArg)
      if (flag instanceof ErrorValueObject) return flag
      if (flag !== 0 && flag !== 1) return ErrorValueObject.create(ErrorType.VALUE)
      caseInsensitive = flag === 1
    }
    let pattern = patternStr
    if (pattern.startsWith('(?i)')) {
      pattern = pattern.slice(4)
      caseInsensitive = true
    }
    let regex: RegExp
    try {
      regex = new RegExp(pattern, caseInsensitive ? 'iu' : 'u')
    } catch {
      try {
        regex = new RegExp(pattern, caseInsensitive ? 'i' : '')
      } catch {
        return ErrorValueObject.create(ErrorType.VALUE)
      }
    }
    if (textArg.isArray()) {
      const grid = toGrid(textArg).map((row) =>
        row.map((cell) => {
          const s = toStringValue(cell)
          if (s instanceof ErrorValueObject) return s
          return BooleanValueObject.create(regex.test(s))
        }),
      )
      return makeArray(grid)
    }
    const text = toStringValue(textArg)
    if (text instanceof ErrorValueObject) return text
    return BooleanValueObject.create(regex.test(text))
  }
}

export class IsomittedFunction extends BaseFunction {
  override minParams = 1
  override maxParams = 1

  override calculate(argument?: BaseValueObject): CalcResult {
    if (argument === undefined || argument.isNull()) {
      return BooleanValueObject.create(true)
    }
    return BooleanValueObject.create(false)
  }
}

function halfwidthToFullwidth(text: string): string {
  const KANA_MAP: Record<string, string> = {
    '｡': '。',
    '｢': '「',
    '｣': '」',
    '､': '、',
    '･': '・',
    ｦ: 'ヲ',
    ｧ: 'ァ',
    ｨ: 'ィ',
    ｩ: 'ゥ',
    ｪ: 'ェ',
    ｫ: 'ォ',
    ｬ: 'ャ',
    ｭ: 'ュ',
    ｮ: 'ョ',
    ｯ: 'ッ',
    ｰ: 'ー',
    ｱ: 'ア',
    ｲ: 'イ',
    ｳ: 'ウ',
    ｴ: 'エ',
    ｵ: 'オ',
    ｶ: 'カ',
    ｷ: 'キ',
    ｸ: 'ク',
    ｹ: 'ケ',
    ｺ: 'コ',
    ｻ: 'サ',
    ｼ: 'シ',
    ｽ: 'ス',
    ｾ: 'セ',
    ｿ: 'ソ',
    ﾀ: 'タ',
    ﾁ: 'チ',
    ﾂ: 'ツ',
    ﾃ: 'テ',
    ﾄ: 'ト',
    ﾅ: 'ナ',
    ﾆ: 'ニ',
    ﾇ: 'ヌ',
    ﾈ: 'ネ',
    ﾉ: 'ノ',
    ﾊ: 'ハ',
    ﾋ: 'ヒ',
    ﾌ: 'フ',
    ﾍ: 'ヘ',
    ﾎ: 'ホ',
    ﾏ: 'マ',
    ﾐ: 'ミ',
    ﾑ: 'ム',
    ﾒ: 'メ',
    ﾓ: 'モ',
    ﾔ: 'ヤ',
    ﾕ: 'ユ',
    ﾖ: 'ヨ',
    ﾗ: 'ラ',
    ﾘ: 'リ',
    ﾙ: 'ル',
    ﾚ: 'レ',
    ﾛ: 'ロ',
    ﾜ: 'ワ',
    ﾝ: 'ン',
    ﾞ: '゛',
    ﾟ: '゜',
  }
  const DAKUTEN: Record<string, string> = {
    ｳ: 'ヴ',
    ｶ: 'ガ',
    ｷ: 'ギ',
    ｸ: 'グ',
    ｹ: 'ゲ',
    ｺ: 'ゴ',
    ｻ: 'ザ',
    ｼ: 'ジ',
    ｽ: 'ズ',
    ｾ: 'ゼ',
    ｿ: 'ゾ',
    ﾀ: 'ダ',
    ﾁ: 'ヂ',
    ﾂ: 'ヅ',
    ﾃ: 'デ',
    ﾄ: 'ド',
    ﾊ: 'バ',
    ﾋ: 'ビ',
    ﾌ: 'ブ',
    ﾍ: 'ベ',
    ﾎ: 'ボ',
  }
  const HANDAKUTEN: Record<string, string> = {
    ﾊ: 'パ',
    ﾋ: 'ピ',
    ﾌ: 'プ',
    ﾍ: 'ペ',
    ﾎ: 'ポ',
  }
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!
    const next = text[i + 1]
    if (next === 'ﾞ' && DAKUTEN[ch]) {
      out += DAKUTEN[ch]
      i += 1
      continue
    }
    if (next === 'ﾟ' && HANDAKUTEN[ch]) {
      out += HANDAKUTEN[ch]
      i += 1
      continue
    }
    if (KANA_MAP[ch]) {
      out += KANA_MAP[ch]
      continue
    }
    const code = ch.charCodeAt(0)
    if (code === 0x20) out += '\u3000'
    else if (code >= 0x21 && code <= 0x7e) out += String.fromCharCode(code + 0xfee0)
    else out += ch
  }
  return out
}

export class JisFunction extends BaseFunction {
  override minParams = 1
  override maxParams = 1

  constructor(
    name: string,
    private readonly _dbcsDelegate?: () => BaseFunction | undefined,
  ) {
    super(name)
  }

  override calculate(textArg: BaseValueObject): CalcResult {
    const delegate = this._dbcsDelegate?.()
    if (delegate) return delegate.calculate(textArg)
    const str = toStringValue(textArg)
    if (str instanceof ErrorValueObject) return str
    return StringValueObject.create(halfwidthToFullwidth(str))
  }
}

function sumValues(arg: BaseValueObject): number | ErrorValueObject {
  if (arg.isError()) return arg as ErrorValueObject
  if (arg.isArray()) {
    let total = 0
    for (const row of toGrid(arg)) {
      for (const cell of row) {
        if (cell.isError()) return cell as ErrorValueObject
        if (cell.isNumber()) total += Number(cell.getValue())
      }
    }
    return total
  }
  if (arg.isNull()) return 0
  if (arg.isNumber()) return Number(arg.getValue())
  if (arg.isBoolean()) return arg.getValue() ? 1 : 0
  if (arg.isString()) {
    const parsed = Number(String(arg.getValue()).trim())
    return Number.isFinite(parsed) ? parsed : ErrorValueObject.create(ErrorType.VALUE)
  }
  return 0
}

export class PercentofFunction extends BaseFunction {
  override minParams = 2
  override maxParams = 2

  override calculate(subsetArg: BaseValueObject, totalArg: BaseValueObject): CalcResult {
    const subset = sumValues(subsetArg)
    if (subset instanceof ErrorValueObject) return subset
    const total = sumValues(totalArg)
    if (total instanceof ErrorValueObject) return total
    if (total === 0) return ErrorValueObject.create(ErrorType.DIV_BY_ZERO)
    return NumberValueObject.create(subset / total)
  }
}

export class TrimrangeFunction extends BaseFunction {
  override minParams = 1
  override maxParams = 3

  override calculate(
    rangeArg: BaseValueObject,
    trimRowsArg?: BaseValueObject,
    trimColsArg?: BaseValueObject,
  ): CalcResult {
    if (rangeArg.isError()) return rangeArg
    let trimRows = 3
    if (trimRowsArg !== undefined && !trimRowsArg.isNull()) {
      const parsed = toNumberValue(trimRowsArg)
      if (parsed instanceof ErrorValueObject) return parsed
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3) {
        return ErrorValueObject.create(ErrorType.VALUE)
      }
      trimRows = parsed
    }
    let trimCols = 3
    if (trimColsArg !== undefined && !trimColsArg.isNull()) {
      const parsed = toNumberValue(trimColsArg)
      if (parsed instanceof ErrorValueObject) return parsed
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3) {
        return ErrorValueObject.create(ErrorType.VALUE)
      }
      trimCols = parsed
    }
    const grid = toGrid(rangeArg)
    const rowCount = grid.length
    const colCount = grid[0]?.length ?? 0
    if (rowCount === 0 || colCount === 0) return ErrorValueObject.create(ErrorType.CALC)

    const isBlank = (cell: BaseValueObject): boolean => cell.isNull()
    const rowIsBlank = (r: number): boolean => grid[r]!.every(isBlank)
    const colIsBlank = (c: number, r0: number, r1: number): boolean => {
      for (let r = r0; r <= r1; r += 1) {
        if (!isBlank(grid[r]![c]!)) return false
      }
      return true
    }

    let r0 = 0
    let r1 = rowCount - 1
    if (trimRows === 1 || trimRows === 3) {
      while (r0 <= r1 && rowIsBlank(r0)) r0 += 1
    }
    if (trimRows === 2 || trimRows === 3) {
      while (r1 >= r0 && rowIsBlank(r1)) r1 -= 1
    }
    if (r0 > r1) return ErrorValueObject.create(ErrorType.CALC)

    let c0 = 0
    let c1 = colCount - 1
    if (trimCols === 1 || trimCols === 3) {
      while (c0 <= c1 && colIsBlank(c0, r0, r1)) c0 += 1
    }
    if (trimCols === 2 || trimCols === 3) {
      while (c1 >= c0 && colIsBlank(c1, r0, r1)) c1 -= 1
    }
    if (c0 > c1) return ErrorValueObject.create(ErrorType.CALC)

    const trimmed: BaseValueObject[][] = []
    for (let r = r0; r <= r1; r += 1) {
      trimmed.push(grid[r]!.slice(c0, c1 + 1))
    }
    return makeArray(trimmed)
  }
}

// --- Google Sheets compatibility functions ---

export class ArrayformulaFunction extends BaseFunction {
  override minParams = 1
  override maxParams = 1

  override calculate(arg: BaseValueObject): CalcResult {
    return arg
  }
}

const NUMERIC_TOKEN_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

function parseSplitToken(token: string): BaseValueObject {
  const trimmed = token.trim()
  if (trimmed !== '' && NUMERIC_TOKEN_RE.test(trimmed)) {
    const n = Number(trimmed)
    if (Number.isFinite(n)) return NumberValueObject.create(n)
  }
  return StringValueObject.create(token)
}

export class SplitFunction extends BaseFunction {
  override minParams = 2
  override maxParams = 4

  override calculate(
    textArg: BaseValueObject,
    delimiterArg: BaseValueObject,
    splitByEachArg?: BaseValueObject,
    removeEmptyArg?: BaseValueObject,
  ): CalcResult {
    const text = toStringValue(textArg)
    if (text instanceof ErrorValueObject) return text
    const delimiter = toStringValue(delimiterArg)
    if (delimiter instanceof ErrorValueObject) return delimiter
    if (delimiter.length === 0) return ErrorValueObject.create(ErrorType.VALUE)

    let splitByEach = true
    if (splitByEachArg !== undefined && !splitByEachArg.isNull()) {
      const parsed = toBooleanValue(splitByEachArg)
      if (parsed instanceof ErrorValueObject) return parsed
      splitByEach = parsed
    }
    let removeEmpty = true
    if (removeEmptyArg !== undefined && !removeEmptyArg.isNull()) {
      const parsed = toBooleanValue(removeEmptyArg)
      if (parsed instanceof ErrorValueObject) return parsed
      removeEmpty = parsed
    }

    let parts: string[]
    if (splitByEach) {
      const chars = new Set([...delimiter])
      parts = []
      let current = ''
      for (const ch of text) {
        if (chars.has(ch)) {
          parts.push(current)
          current = ''
        } else {
          current += ch
        }
      }
      parts.push(current)
    } else {
      parts = text.split(delimiter)
    }
    if (removeEmpty) {
      parts = parts.filter((part) => part !== '')
    }
    if (parts.length === 0) return ErrorValueObject.create(ErrorType.VALUE)
    return makeArray([parts.map(parseSplitToken)])
  }
}

export class JoinFunction extends BaseFunction {
  override minParams = 2
  override maxParams = 255

  override calculate(delimiterArg: BaseValueObject, ...rest: BaseValueObject[]): CalcResult {
    const delimiter = toStringValue(delimiterArg)
    if (delimiter instanceof ErrorValueObject) return delimiter
    const parts: string[] = []
    for (const arg of rest) {
      if (arg.isArray()) {
        for (const row of toGrid(arg)) {
          for (const cell of row) {
            const s = toStringValue(cell)
            if (s instanceof ErrorValueObject) return s
            parts.push(s)
          }
        }
      } else {
        const s = toStringValue(arg)
        if (s instanceof ErrorValueObject) return s
        parts.push(s)
      }
    }
    return StringValueObject.create(parts.join(delimiter))
  }
}

export class CountuniqueFunction extends BaseFunction {
  override minParams = 1
  override maxParams = 255

  override calculate(...args: BaseValueObject[]): CalcResult {
    const seen = new Set<string>()
    for (const arg of args) {
      if (arg.isArray()) {
        for (const row of toGrid(arg)) {
          for (const cell of row) {
            const key = uniqueKey(cell)
            if (key !== null) seen.add(key)
          }
        }
      } else {
        const key = uniqueKey(arg)
        if (key !== null) seen.add(key)
      }
    }
    return NumberValueObject.create(seen.size)
  }
}

export class CountuniqueifsFunction extends BaseFunction {
  override minParams = 3
  override maxParams = 255

  override calculate(rangeArg: BaseValueObject, ...pairs: BaseValueObject[]): CalcResult {
    if (pairs.length < 2 || pairs.length % 2 !== 0) {
      return ErrorValueObject.create(ErrorType.NA)
    }
    const targetGrid = toGrid(rangeArg)
    const rows = targetGrid.length
    const cols = targetGrid[0]?.length ?? 0
    const criteriaSpecs: { grid: BaseValueObject[][]; criteria: BaseValueObject }[] = []
    for (let i = 0; i < pairs.length; i += 2) {
      const cGrid = toGrid(pairs[i]!)
      if (cGrid.length !== rows || (cGrid[0]?.length ?? 0) !== cols) {
        return ErrorValueObject.create(ErrorType.VALUE)
      }
      criteriaSpecs.push({ grid: cGrid, criteria: unwrapScalar(pairs[i + 1]!) })
    }
    const seen = new Set<string>()
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if (criteriaSpecs.every((spec) => matchesCriteria(spec.grid[r]![c]!, spec.criteria))) {
          const key = uniqueKey(targetGrid[r]![c]!)
          if (key !== null) seen.add(key)
        }
      }
    }
    return NumberValueObject.create(seen.size)
  }
}

export class SortnFunction extends BaseFunction {
  override minParams = 1
  override maxParams = 30

  override calculate(
    rangeArg: BaseValueObject,
    nArg?: BaseValueObject,
    tiesModeArg?: BaseValueObject,
    ...sortPairs: BaseValueObject[]
  ): CalcResult {
    if (rangeArg.isError()) return rangeArg
    const grid = toGrid(rangeArg)
    const rowCount = grid.length
    const colCount = grid[0]?.length ?? 0
    if (rowCount === 0 || colCount === 0) return ErrorValueObject.create(ErrorType.VALUE)

    let n = 1
    if (nArg !== undefined && !nArg.isNull()) {
      const parsed = toNumberValue(nArg)
      if (parsed instanceof ErrorValueObject) return parsed
      n = Math.trunc(parsed)
      if (n <= 0) return ErrorValueObject.create(ErrorType.NUM)
    }
    let tiesMode = 0
    if (tiesModeArg !== undefined && !tiesModeArg.isNull()) {
      const parsed = toNumberValue(tiesModeArg)
      if (parsed instanceof ErrorValueObject) return parsed
      tiesMode = Math.trunc(parsed)
      if (tiesMode < 0 || tiesMode > 3) return ErrorValueObject.create(ErrorType.NUM)
    }

    const keys: { values: BaseValueObject[]; asc: boolean }[] = []
    if (sortPairs.length === 0) {
      keys.push({ values: grid.map((row) => row[0]!), asc: true })
    } else {
      if (sortPairs.length % 2 !== 0) return ErrorValueObject.create(ErrorType.NA)
      for (let i = 0; i < sortPairs.length; i += 2) {
        const colSpec = sortPairs[i]!
        const ascParsed = toBooleanValue(sortPairs[i + 1]!)
        if (ascParsed instanceof ErrorValueObject) return ascParsed
        if (colSpec.isArray()) {
          const colGrid = toGrid(colSpec)
          if (colGrid.length !== rowCount || (colGrid[0]?.length ?? 0) !== 1) {
            return ErrorValueObject.create(ErrorType.VALUE)
          }
          keys.push({ values: colGrid.map((r) => r[0]!), asc: ascParsed })
        } else {
          const colIdx = toNumberValue(colSpec)
          if (colIdx instanceof ErrorValueObject) return colIdx
          const oneBased = Math.trunc(colIdx)
          if (oneBased < 1 || oneBased > colCount) return ErrorValueObject.create(ErrorType.VALUE)
          keys.push({ values: grid.map((r) => r[oneBased - 1]!), asc: ascParsed })
        }
      }
    }

    const rowOrder = Array.from({ length: rowCount }, (_, idx) => idx)
    const compareRows = (a: number, b: number): number => {
      for (const key of keys) {
        const va = key.values[a]!
        const vb = key.values[b]!
        // Google Sheets always sorts blanks after non-blanks.
        if (va.isNull() && !vb.isNull()) return 1
        if (!va.isNull() && vb.isNull()) return -1
        const cmp = compareValues(va, vb)
        if (cmp !== 0) return key.asc ? cmp : -cmp
      }
      return a - b
    }
    rowOrder.sort(compareRows)

    const rowSignature = (r: number): string =>
      grid[r]!.map((cell) => uniqueKey(cell) ?? 'null').join('\u0000')
    const keySignature = (r: number): string =>
      keys.map((k) => uniqueKey(k.values[r]!) ?? 'null').join('\u0000')

    let selected: number[] = []
    if (tiesMode === 0) {
      selected = rowOrder.slice(0, n)
    } else if (tiesMode === 1) {
      selected = rowOrder.slice(0, n)
      if (selected.length === n && rowOrder.length > n) {
        const nthKey = keySignature(selected[n - 1]!)
        for (let i = n; i < rowOrder.length; i += 1) {
          if (keySignature(rowOrder[i]!) === nthKey) selected.push(rowOrder[i]!)
          else break
        }
      }
    } else if (tiesMode === 2) {
      const seen = new Set<string>()
      for (const r of rowOrder) {
        const sig = rowSignature(r)
        if (seen.has(sig)) continue
        seen.add(sig)
        selected.push(r)
        if (selected.length >= n) break
      }
    } else {
      // tiesMode === 3: up to n unique rows plus every duplicate of those rows.
      const chosen = new Set<string>()
      for (const r of rowOrder) {
        const sig = rowSignature(r)
        if (chosen.has(sig)) {
          selected.push(r)
        } else if (chosen.size < n) {
          chosen.add(sig)
          selected.push(r)
        }
      }
    }

    return makeArray(selected.map((r) => grid[r]!))
  }
}

export class ToTextFunction extends BaseFunction {
  override minParams = 1
  override maxParams = 1

  override calculate(arg: BaseValueObject): CalcResult {
    const s = toStringValue(arg)
    if (s instanceof ErrorValueObject) return s
    return StringValueObject.create(s)
  }
}

function coerceSheetsNumber(arg: BaseValueObject): number | null | ErrorValueObject {
  const cell = unwrapScalar(arg)
  if (cell.isError()) return cell as ErrorValueObject
  if (cell.isNull()) return 0
  if (cell.isNumber()) return Number(cell.getValue())
  if (cell.isBoolean()) return cell.getValue() ? 1 : 0
  if (cell.isString()) {
    const raw = String(cell.getValue()).trim()
    if (raw === '') return null
    const isPct = raw.endsWith('%')
    const stripped = raw
      .replace(/^[$₩€£¥]/, '')
      .replace(/%$/, '')
      .replace(/,/g, '')
      .trim()
    if (stripped !== '' && NUMERIC_TOKEN_RE.test(stripped)) {
      const n = Number(stripped)
      if (Number.isFinite(n)) return isPct ? n / 100 : n
    }
  }
  return null
}

export class ToPureNumberFunction extends BaseFunction {
  override minParams = 1
  override maxParams = 1

  override calculate(arg: BaseValueObject): CalcResult {
    const parsed = coerceSheetsNumber(arg)
    if (parsed instanceof ErrorValueObject) return parsed
    if (parsed === null) return unwrapScalar(arg)
    return NumberValueObject.create(parsed)
  }
}

export class ToFormattedNumberFunction extends BaseFunction {
  override minParams = 1
  override maxParams = 1

  constructor(
    name: string,
    private readonly _pattern: string,
  ) {
    super(name)
  }

  override calculate(arg: BaseValueObject): CalcResult {
    const parsed = coerceSheetsNumber(arg)
    if (parsed instanceof ErrorValueObject) return parsed
    if (parsed === null) return unwrapScalar(arg)
    return NumberValueObject.create(parsed, this._pattern)
  }
}

export class BinaryArithmeticFunction extends BaseFunction {
  override minParams = 2
  override maxParams = 2

  constructor(
    name: string,
    private readonly _op: 'add' | 'divide' | 'pow',
  ) {
    super(name)
  }

  override calculate(left: BaseValueObject, right: BaseValueObject): CalcResult {
    const a = toNumberValue(left)
    if (a instanceof ErrorValueObject) return a
    const b = toNumberValue(right)
    if (b instanceof ErrorValueObject) return b
    if (this._op === 'add') return NumberValueObject.create(a + b)
    if (this._op === 'divide') {
      if (b === 0) return ErrorValueObject.create(ErrorType.DIV_BY_ZERO)
      return NumberValueObject.create(a / b)
    }
    if (a === 0 && b < 0) return ErrorValueObject.create(ErrorType.DIV_BY_ZERO)
    const res = Math.pow(a, b)
    if (!Number.isFinite(res)) return ErrorValueObject.create(ErrorType.NUM)
    return NumberValueObject.create(res)
  }
}

export class BinaryCompareFunction extends BaseFunction {
  override minParams = 2
  override maxParams = 2

  constructor(
    name: string,
    private readonly _op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte',
  ) {
    super(name)
  }

  override calculate(left: BaseValueObject, right: BaseValueObject): CalcResult {
    const a = unwrapScalar(left)
    const b = unwrapScalar(right)
    if (a.isError()) return a
    if (b.isError()) return b
    const cmp = compareValues(a, b)
    switch (this._op) {
      case 'eq':
        return BooleanValueObject.create(cmp === 0)
      case 'ne':
        return BooleanValueObject.create(cmp !== 0)
      case 'gt':
        return BooleanValueObject.create(cmp > 0)
      case 'gte':
        return BooleanValueObject.create(cmp >= 0)
      case 'lt':
        return BooleanValueObject.create(cmp < 0)
      case 'lte':
        return BooleanValueObject.create(cmp <= 0)
    }
  }
}

export class UnaryArithmeticFunction extends BaseFunction {
  override minParams = 1
  override maxParams = 1

  constructor(
    name: string,
    private readonly _op: 'uminus' | 'uplus' | 'percent',
  ) {
    super(name)
  }

  override calculate(arg: BaseValueObject): CalcResult {
    const a = toNumberValue(arg)
    if (a instanceof ErrorValueObject) return a
    if (this._op === 'uminus') return NumberValueObject.create(a === 0 ? 0 : -a)
    if (this._op === 'uplus') return NumberValueObject.create(a)
    return NumberValueObject.create(a / 100)
  }
}

function param(name: string, detail: string, require = 1, repeat = 0) {
  return { name, detail, example: '', require, repeat }
}

export const COMPAT_FUNCTION_DESCRIPTIONS: readonly IFunctionInfo[] = [
  {
    functionName: 'ISO.CEILING',
    functionType: FunctionType.Math,
    abstract: 'Rounds a number up to the nearest integer or multiple of significance.',
    description:
      'Rounds a number up toward positive infinity to the nearest multiple of significance.',
    functionParameter: [
      param('number', 'The value to round.', 1),
      param('significance', 'The multiple to round up to (default 1).', 0),
    ],
  },
  {
    functionName: 'REGEXTEST',
    functionType: FunctionType.Text,
    abstract: 'Determines whether any part of text matches a regular expression.',
    description: 'Returns TRUE if text matches the regular expression pattern, FALSE otherwise.',
    functionParameter: [
      param('text', 'The text to test.', 1),
      param('pattern', 'The regular expression pattern.', 1),
      param('case_sensitivity', '0 for case-sensitive (default), 1 for case-insensitive.', 0),
    ],
  },
  {
    functionName: 'ISOMITTED',
    functionType: FunctionType.Information,
    abstract: 'Checks whether a LAMBDA parameter value is missing.',
    description: 'Returns TRUE if the argument was omitted in a LAMBDA call, FALSE otherwise.',
    functionParameter: [param('argument', 'The LAMBDA parameter to check.', 1)],
  },
  {
    functionName: 'JIS',
    functionType: FunctionType.Text,
    abstract: 'Converts half-width characters to full-width characters.',
    description: 'Converts half-width ASCII and katakana characters to full-width equivalents.',
    functionParameter: [param('text', 'The text to convert.', 1)],
  },
  {
    functionName: 'PERCENTOF',
    functionType: FunctionType.Math,
    abstract: 'Calculates the percentage that a subset makes up of a total dataset.',
    description: 'Sums data_subset and divides it by the sum of data_all.',
    functionParameter: [
      param('data_subset', 'The subset of values.', 1),
      param('data_all', 'The full set of values.', 1),
    ],
  },
  {
    functionName: 'TRIMRANGE',
    functionType: FunctionType.Lookup,
    abstract: 'Trims empty rows and columns from the edges of a range.',
    description: 'Excludes leading and/or trailing blank rows and columns from a range.',
    functionParameter: [
      param('range', 'The range or array to trim.', 1),
      param('trim_rows', '0 none, 1 leading, 2 trailing, 3 both (default).', 0),
      param('trim_cols', '0 none, 1 leading, 2 trailing, 3 both (default).', 0),
    ],
  },
  {
    functionName: 'ARRAYFORMULA',
    functionType: FunctionType.Array,
    abstract: 'Enables array evaluation of a formula expression.',
    description: 'Evaluates an array formula expression and returns its resulting array or value.',
    functionParameter: [param('array_formula', 'The formula or range expression.', 1)],
  },
  {
    functionName: 'SPLIT',
    functionType: FunctionType.Text,
    abstract: 'Divides text around a specified character or string.',
    description:
      'Splits text by delimiter characters or substring into separate cells across a row.',
    functionParameter: [
      param('text', 'The text to split.', 1),
      param('delimiter', 'The character(s) or substring to split by.', 1),
      param('split_by_each', 'TRUE to split by each character in delimiter (default TRUE).', 0),
      param('remove_empty_text', 'TRUE to omit empty segments (default TRUE).', 0),
    ],
  },
  {
    functionName: 'JOIN',
    functionType: FunctionType.Text,
    abstract: 'Concatenates elements of arrays using a delimiter.',
    description: 'Joins all values from one or more ranges or scalars with a delimiter string.',
    functionParameter: [
      param('delimiter', 'The string placed between each joined value.', 1),
      param('value_or_array1', 'The first value or range to join.', 1, 1),
    ],
  },
  {
    functionName: 'COUNTUNIQUE',
    functionType: FunctionType.Statistical,
    abstract: 'Counts the number of unique values in a list of values and ranges.',
    description: 'Returns the count of distinct non-empty values across the supplied arguments.',
    functionParameter: [param('value1', 'The first value or range to consider.', 1, 1)],
  },
  {
    functionName: 'COUNTUNIQUEIFS',
    functionType: FunctionType.Statistical,
    abstract: 'Counts unique values in a range that meet one or more criteria.',
    description: 'Counts distinct non-empty values in range where every criteria range matches.',
    functionParameter: [
      param('range', 'The range of values to count uniquely.', 1),
      param('criteria_range1', 'The first range to evaluate against criteria1.', 1),
      param('criteria1', 'The condition applied to criteria_range1.', 1, 1),
    ],
  },
  {
    functionName: 'SORTN',
    functionType: FunctionType.Lookup,
    abstract: 'Returns the first n items in a dataset after sorting.',
    description:
      'Sorts a range and returns up to n rows according to the specified tie-handling mode.',
    functionParameter: [
      param('range', 'The data range to sort.', 1),
      param('n', 'Number of rows to return (default 1).', 0),
      param('display_ties_mode', '0 none, 1 include ties, 2 unique only, 3 unique + ties.', 0),
      param('sort_column1', '1-based column index or single-column range to sort by.', 0),
      param('is_ascending1', 'TRUE for ascending, FALSE for descending.', 0, 1),
    ],
  },
  {
    functionName: 'TO_TEXT',
    functionType: FunctionType.Text,
    abstract: 'Converts a provided value to a text string.',
    description: 'Returns the text representation of a number, boolean, or string.',
    functionParameter: [param('value', 'The value to convert to text.', 1)],
  },
  {
    functionName: 'TO_PURE_NUMBER',
    functionType: FunctionType.Math,
    abstract: 'Converts a formatted number or numeric string to a plain number.',
    description: 'Strips currency/percentage formatting and returns the underlying number.',
    functionParameter: [param('value', 'The value to convert.', 1)],
  },
  {
    functionName: 'TO_PERCENT',
    functionType: FunctionType.Math,
    abstract: 'Converts a number to a percentage format.',
    description: 'Interprets a value as a percentage with 0.00% display formatting.',
    functionParameter: [param('value', 'The value to format as a percentage.', 1)],
  },
  {
    functionName: 'TO_DOLLARS',
    functionType: FunctionType.Financial,
    abstract: 'Converts a number to a dollar currency value.',
    description: 'Interprets a value as a number formatted with $#,##0.00.',
    functionParameter: [param('value', 'The value to format as dollars.', 1)],
  },
  {
    functionName: 'ADD',
    functionType: FunctionType.Math,
    abstract: 'Returns the sum of two numbers.',
    description: 'Equivalent to the + operator.',
    functionParameter: [
      param('value1', 'The first addend.', 1),
      param('value2', 'The second addend.', 1),
    ],
  },
  {
    functionName: 'DIVIDE',
    functionType: FunctionType.Math,
    abstract: 'Returns one number divided by another.',
    description: 'Equivalent to the / operator.',
    functionParameter: [
      param('dividend', 'The number to be divided.', 1),
      param('divisor', 'The number to divide by.', 1),
    ],
  },
  {
    functionName: 'POW',
    functionType: FunctionType.Math,
    abstract: 'Returns a number raised to a power.',
    description: 'Equivalent to the ^ operator and POWER.',
    functionParameter: [
      param('base', 'The base number.', 1),
      param('exponent', 'The exponent to raise base to.', 1),
    ],
  },
  {
    functionName: 'EQ',
    functionType: FunctionType.Logical,
    abstract: 'Returns TRUE if two values are equal.',
    description: 'Equivalent to the = comparison operator.',
    functionParameter: [
      param('value1', 'The first value.', 1),
      param('value2', 'The second value.', 1),
    ],
  },
  {
    functionName: 'NE',
    functionType: FunctionType.Logical,
    abstract: 'Returns TRUE if two values are not equal.',
    description: 'Equivalent to the <> comparison operator.',
    functionParameter: [
      param('value1', 'The first value.', 1),
      param('value2', 'The second value.', 1),
    ],
  },
  {
    functionName: 'GT',
    functionType: FunctionType.Logical,
    abstract: 'Returns TRUE if the first value is strictly greater than the second.',
    description: 'Equivalent to the > comparison operator.',
    functionParameter: [
      param('value1', 'The first value.', 1),
      param('value2', 'The second value.', 1),
    ],
  },
  {
    functionName: 'GTE',
    functionType: FunctionType.Logical,
    abstract: 'Returns TRUE if the first value is greater than or equal to the second.',
    description: 'Equivalent to the >= comparison operator.',
    functionParameter: [
      param('value1', 'The first value.', 1),
      param('value2', 'The second value.', 1),
    ],
  },
  {
    functionName: 'LT',
    functionType: FunctionType.Logical,
    abstract: 'Returns TRUE if the first value is strictly less than the second.',
    description: 'Equivalent to the < comparison operator.',
    functionParameter: [
      param('value1', 'The first value.', 1),
      param('value2', 'The second value.', 1),
    ],
  },
  {
    functionName: 'LTE',
    functionType: FunctionType.Logical,
    abstract: 'Returns TRUE if the first value is less than or equal to the second.',
    description: 'Equivalent to the <= comparison operator.',
    functionParameter: [
      param('value1', 'The first value.', 1),
      param('value2', 'The second value.', 1),
    ],
  },
  {
    functionName: 'UMINUS',
    functionType: FunctionType.Math,
    abstract: 'Returns a number with the sign reversed.',
    description: 'Equivalent to the unary minus operator.',
    functionParameter: [param('value', 'The number to negate.', 1)],
  },
  {
    functionName: 'UPLUS',
    functionType: FunctionType.Math,
    abstract: 'Returns a specified number unchanged.',
    description: 'Equivalent to the unary plus operator.',
    functionParameter: [param('value', 'The number to return.', 1)],
  },
  {
    functionName: 'UNARY_PERCENT',
    functionType: FunctionType.Math,
    abstract: 'Returns a value interpreted as a percentage (value / 100).',
    description: 'Equivalent to the % postfix operator.',
    functionParameter: [param('percentage', 'The percentage value.', 1)],
  },
]

/// Google Sheets-only compatibility functions. Registered in IFunctionService so
/// typed, pasted, and uncached formulas evaluate live, while excluded from
/// `installSupportedFunctionProbe` so Excel `.xlsm` workbooks with same-named
/// VBA UDFs (e.g. `JOIN`, `SPLIT`) preserve their cached `<v>` on open.
export const GOOGLE_ONLY_COMPAT_FUNCTIONS: ReadonlySet<string> = new Set([
  'ARRAYFORMULA',
  'SPLIT',
  'JOIN',
  'COUNTUNIQUE',
  'COUNTUNIQUEIFS',
  'SORTN',
  'TO_TEXT',
  'TO_PURE_NUMBER',
  'TO_PERCENT',
  'TO_DOLLARS',
  'ADD',
  'DIVIDE',
  'POW',
  'EQ',
  'NE',
  'GT',
  'GTE',
  'LT',
  'LTE',
  'UMINUS',
  'UPLUS',
  'UNARY_PERCENT',
])

export function createCompatExecutors(functionService?: IFunctionService): BaseFunction[] {
  const dbcsDelegate = functionService
    ? () => functionService.getExecutor('DBCS') ?? undefined
    : undefined
  return [
    new IsoCeilingFunction('ISO.CEILING'),
    new RegextestFunction('REGEXTEST'),
    new IsomittedFunction('ISOMITTED'),
    new JisFunction('JIS', dbcsDelegate),
    new PercentofFunction('PERCENTOF'),
    new TrimrangeFunction('TRIMRANGE'),
    new ArrayformulaFunction('ARRAYFORMULA'),
    new SplitFunction('SPLIT'),
    new JoinFunction('JOIN'),
    new CountuniqueFunction('COUNTUNIQUE'),
    new CountuniqueifsFunction('COUNTUNIQUEIFS'),
    new SortnFunction('SORTN'),
    new ToTextFunction('TO_TEXT'),
    new ToPureNumberFunction('TO_PURE_NUMBER'),
    new ToFormattedNumberFunction('TO_PERCENT', '0.00%'),
    new ToFormattedNumberFunction('TO_DOLLARS', '$#,##0.00'),
    new BinaryArithmeticFunction('ADD', 'add'),
    new BinaryArithmeticFunction('DIVIDE', 'divide'),
    new BinaryArithmeticFunction('POW', 'pow'),
    new BinaryCompareFunction('EQ', 'eq'),
    new BinaryCompareFunction('NE', 'ne'),
    new BinaryCompareFunction('GT', 'gt'),
    new BinaryCompareFunction('GTE', 'gte'),
    new BinaryCompareFunction('LT', 'lt'),
    new BinaryCompareFunction('LTE', 'lte'),
    new UnaryArithmeticFunction('UMINUS', 'uminus'),
    new UnaryArithmeticFunction('UPLUS', 'uplus'),
    new UnaryArithmeticFunction('UNARY_PERCENT', 'percent'),
  ]
}

/// Univer's builtin SORT calls `array.getArrayValue().sort(...)` in place when
/// `by_col` is falsy, mutating the engine's cached ArrayValueObject for the
/// source range so every later formula reading that same range (SUMIFS,
/// SUMPRODUCT, TAKE, DROP, SORTBY, ...) sees the sorted order instead of the
/// sheet's real values. Cloning the 2D array before delegating eliminates the
/// shared-cache corruption while preserving every other SORT behavior.
export function createSafeSortExecutor(): BaseFunction | null {
  const SortBuiltin = functionLookup.find(
    ([, name]) => name === FUNCTION_NAMES_LOOKUP.SORT,
  )?.[0] as (new (name: string) => BaseFunction) | undefined
  if (!SortBuiltin) return null
  class NonMutatingSort extends SortBuiltin {
    override calculate(array: BaseValueObject, ...rest: BaseValueObject[]): CalcResult {
      if (array?.isArray?.()) {
        const arr = array as ArrayValueObject
        const cloned = ArrayValueObject.create({
          calculateValueList: arr.getArrayValue().map((row) => row.slice()),
          rowCount: arr.getRowCount(),
          columnCount: arr.getColumnCount(),
          unitId: '',
          sheetId: '',
          row: 0,
          column: 0,
        })
        return super.calculate(cloned, ...rest)
      }
      return super.calculate(array, ...rest)
    }
  }
  return new NonMutatingSort(FUNCTION_NAMES_LOOKUP.SORT)
}

export function installCompatFunctions(runtime: UniverRuntime): { dispose(): void } {
  const injector = runtime.univer.__getInjector()
  const functionService = injector.get(IFunctionService)
  const executors = createCompatExecutors(functionService)
  const safeSort = createSafeSortExecutor()
  const originalSort = safeSort
    ? (functionService.getExecutor(FUNCTION_NAMES_LOOKUP.SORT) ?? undefined)
    : undefined
  const registeredExecutors = new Map<BaseFunction['name'], BaseFunction>()

  const registerAll = () => {
    const missing = executors.filter((executor) => !functionService.hasExecutor(executor.name))
    if (missing.length > 0) {
      functionService.registerExecutors(...missing)
      for (const executor of missing) {
        registeredExecutors.set(executor.name, executor)
      }
    }
    if (safeSort && functionService.getExecutor(FUNCTION_NAMES_LOOKUP.SORT) !== safeSort) {
      functionService.registerExecutors(safeSort)
    }
  }
  registerAll()

  let descDisposable: { dispose(): void } | null = null
  try {
    const descriptionService = injector.get(IDescriptionService)
    const missingDescriptions = COMPAT_FUNCTION_DESCRIPTIONS.filter(
      (info) => !descriptionService.hasDescription(String(info.functionName)),
    )
    if (missingDescriptions.length > 0) {
      descDisposable = descriptionService.registerDescriptions(missingDescriptions)
    }
  } catch {
    // IDescriptionService may be absent in minimal headless tests.
  }

  // Re-assert once after plugin onReady in case builtins registered lazily.
  const timer = setTimeout(registerAll, 0)

  return {
    dispose() {
      clearTimeout(timer)
      descDisposable?.dispose()
      const stillOurs: BaseFunction['name'][] = []
      for (const [name, executor] of registeredExecutors) {
        if (functionService.getExecutor(name) === executor) stillOurs.push(name)
      }
      if (stillOurs.length > 0) {
        functionService.unregisterExecutors(...stillOurs)
      }
      if (
        safeSort &&
        originalSort &&
        functionService.getExecutor(FUNCTION_NAMES_LOOKUP.SORT) === safeSort
      ) {
        functionService.registerExecutors(originalSort)
      }
    },
  }
}
