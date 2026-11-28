/// Excel stores post-2007 function names in file formulas behind an
/// `_xlfn.` marker (worksheet-scope dynamic-array functions behind
/// `_xlfn._xlws.`) and shows the plain name in the UI. The sidecar strips
/// the markers on read; this restores them when a formula is serialized
/// back into sheet XML — without the marker Excel repairs the call to
/// #NAME?.

/// Functions Excel 2007 does not know, keyed by the marker they need.
const XLWS_FUNCTIONS = new Set(['FILTER', 'SORT'])

const XLFN_FUNCTIONS = new Set([
  // Excel 2010
  'AGGREGATE',
  'BETA.DIST',
  'BETA.INV',
  'BINOM.DIST',
  'BINOM.INV',
  'CEILING.PRECISE',
  'CHISQ.DIST',
  'CHISQ.DIST.RT',
  'CHISQ.INV',
  'CHISQ.INV.RT',
  'CHISQ.TEST',
  'CONFIDENCE.NORM',
  'CONFIDENCE.T',
  'COVARIANCE.P',
  'COVARIANCE.S',
  'ERF.PRECISE',
  'ERFC.PRECISE',
  'EXPON.DIST',
  'F.DIST',
  'F.DIST.RT',
  'F.INV',
  'F.INV.RT',
  'F.TEST',
  'FLOOR.PRECISE',
  'GAMMA.DIST',
  'GAMMA.INV',
  'GAMMALN.PRECISE',
  'HYPGEOM.DIST',
  'LOGNORM.DIST',
  'LOGNORM.INV',
  'MODE.MULT',
  'MODE.SNGL',
  'NEGBINOM.DIST',
  'NETWORKDAYS.INTL',
  'NORM.DIST',
  'NORM.INV',
  'NORM.S.DIST',
  'NORM.S.INV',
  'PERCENTILE.EXC',
  'PERCENTILE.INC',
  'PERCENTRANK.EXC',
  'PERCENTRANK.INC',
  'POISSON.DIST',
  'QUARTILE.EXC',
  'QUARTILE.INC',
  'RANK.AVG',
  'RANK.EQ',
  'STDEV.P',
  'STDEV.S',
  'T.DIST',
  'T.DIST.2T',
  'T.DIST.RT',
  'T.INV',
  'T.INV.2T',
  'T.TEST',
  'VAR.P',
  'VAR.S',
  'WEIBULL.DIST',
  'WORKDAY.INTL',
  'Z.TEST',
  // Excel 2013
  'ACOT',
  'ACOTH',
  'ARABIC',
  'BASE',
  'BINOM.DIST.RANGE',
  'BITAND',
  'BITLSHIFT',
  'BITOR',
  'BITRSHIFT',
  'BITXOR',
  'CEILING.MATH',
  'COMBINA',
  'COT',
  'COTH',
  'CSC',
  'CSCH',
  'DAYS',
  'DECIMAL',
  'ENCODEURL',
  'FILTERXML',
  'FLOOR.MATH',
  'FORMULATEXT',
  'GAMMA',
  'GAUSS',
  'IFNA',
  'IMCOSH',
  'IMCOT',
  'IMCSC',
  'IMCSCH',
  'IMSEC',
  'IMSECH',
  'IMSINH',
  'IMTAN',
  'ISFORMULA',
  'ISO.CEILING',
  'ISOWEEKNUM',
  'MUNIT',
  'NUMBERVALUE',
  'PDURATION',
  'PERMUTATIONA',
  'PHI',
  'RRI',
  'SEC',
  'SECH',
  'SHEET',
  'SHEETS',
  'SKEW.P',
  'UNICHAR',
  'UNICODE',
  'WEBSERVICE',
  'XOR',
  // Excel 2016
  'CONCAT',
  'FORECAST.ETS',
  'FORECAST.ETS.CONFINT',
  'FORECAST.ETS.SEASONALITY',
  'FORECAST.ETS.STAT',
  'FORECAST.LINEAR',
  'IFS',
  'MAXIFS',
  'MINIFS',
  'SWITCH',
  'TEXTJOIN',
  // Microsoft 365
  'BYCOL',
  'BYROW',
  'CHOOSECOLS',
  'CHOOSEROWS',
  'DROP',
  'EXPAND',
  'GROUPBY',
  'HSTACK',
  'IMAGE',
  'ISOMITTED',
  'LAMBDA',
  'LET',
  'MAKEARRAY',
  'MAP',
  'PERCENTOF',
  'PIVOTBY',
  'RANDARRAY',
  'REDUCE',
  'REGEXEXTRACT',
  'REGEXREPLACE',
  'REGEXTEST',
  'SCAN',
  'SEQUENCE',
  'SORTBY',
  'STOCKHISTORY',
  'TAKE',
  'TEXTAFTER',
  'TEXTBEFORE',
  'TEXTSPLIT',
  'TOCOL',
  'TOROW',
  'TRIMRANGE',
  'UNIQUE',
  'VSTACK',
  'WRAPCOLS',
  'WRAPROWS',
  'XLOOKUP',
  'XMATCH',
  'ARRAYTOTEXT',
  'VALUETOTEXT',
  // Storage forms of the @ implicit-intersection and # spill operators.
  'SINGLE',
  'ANCHORARRAY',
])

/// Functions whose result spills into neighbouring cells. Excel 365 only
/// spills a stored formula that is marked as a dynamic array (`t="array"` on
/// the <f> plus `cm="1"` on the cell); an unmarked call is read as `@FILTER`
/// and returns one value.
const SPILL_FUNCTIONS = new Set([
  'BYCOL',
  'BYROW',
  'CHOOSECOLS',
  'CHOOSEROWS',
  'DROP',
  'EXPAND',
  'FILTER',
  'GROUPBY',
  'HSTACK',
  'MAKEARRAY',
  'MAP',
  'PIVOTBY',
  'RANDARRAY',
  'REGEXEXTRACT',
  'SCAN',
  'SEQUENCE',
  'SORT',
  'SORTBY',
  'TAKE',
  'TEXTSPLIT',
  'TOCOL',
  'TOROW',
  'TRIMRANGE',
  'UNIQUE',
  'VSTACK',
  'WRAPCOLS',
  'WRAPROWS',
])

interface FormulaCall {
  start: number
  end: number
  name: string
  marked: boolean
}

function isNameCharacter(character: string): boolean {
  return (
    character === '_' ||
    character === '.' ||
    character === '\\' ||
    character === '$' ||
    /[\p{L}\p{N}]/u.test(character)
  )
}

function quotedEnd(formula: string, start: number): number {
  const quote = formula[start]
  let index = start + 1
  while (index < formula.length) {
    if (formula[index] === quote) {
      if (formula[index + 1] === quote) {
        index += 2
        continue
      }
      return index + 1
    }
    index += 1
  }
  return formula.length
}

function functionCalls(formula: string): FormulaCall[] {
  const calls: FormulaCall[] = []
  let cursor = 0
  while (cursor < formula.length) {
    const character = formula[cursor]!
    if (character === '"' || character === "'") {
      cursor = quotedEnd(formula, cursor)
      continue
    }
    const codePoint = formula.codePointAt(cursor)!
    const symbol = String.fromCodePoint(codePoint)
    if (!isNameCharacter(symbol)) {
      cursor += symbol.length
      continue
    }
    const start = cursor
    let end = cursor
    while (end < formula.length) {
      const current = String.fromCodePoint(formula.codePointAt(end)!)
      if (!isNameCharacter(current)) break
      end += current.length
    }
    let after = end
    while (after < formula.length && /\s/.test(formula[after]!)) after += 1
    if (formula[after] === '(') {
      const token = formula.slice(start, end)
      const marked = /^_xlfn\.(?:_xlws\.)?/i.test(token) || /^_xlws\./i.test(token)
      const name = token.replace(/^_xlfn\.(?:_xlws\.)?/i, '').replace(/^_xlws\./i, '')
      calls.push({ start, end, name, marked })
    }
    cursor = end
  }
  return calls
}

export function spillsDynamicArray(formula: string): boolean {
  return functionCalls(formula).some((call) => SPILL_FUNCTIONS.has(call.name.toUpperCase()))
}

function bracketedEnd(formula: string, start: number): number {
  let depth = 0
  let index = start
  while (index < formula.length) {
    const ch = formula[index]
    if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth === 0) return index + 1
    }
    index += 1
  }
  return formula.length
}

interface ParamScope {
  readonly start: number
  readonly end: number
  readonly names: ReadonlySet<string>
}

function splitTopLevelArgs(
  formula: string,
  openParen: number,
): { closeParen: number; args: string[] } | null {
  const args: string[] = []
  let depth = 1
  let argStart = openParen + 1
  let cursor = openParen + 1
  while (cursor < formula.length) {
    const ch = formula[cursor]!
    if (ch === '"' || ch === "'") {
      cursor = quotedEnd(formula, cursor)
      continue
    }
    if (ch === '[') {
      cursor = bracketedEnd(formula, cursor)
      continue
    }
    if (ch === '(' || ch === '{') {
      depth += 1
    } else if (ch === ')' || ch === '}') {
      depth -= 1
      if (depth === 0) {
        args.push(formula.slice(argStart, cursor))
        return { closeParen: cursor, args }
      }
    } else if (ch === ',' && depth === 1) {
      args.push(formula.slice(argStart, cursor))
      argStart = cursor + 1
    }
    cursor += 1
  }
  return null
}

const SIMPLE_PARAM_RE = /^(?:_xlpm\.)?([\p{L}_][\p{L}\p{N}_.]*)$/iu

/// Collect scopes for LET/LAMBDA bound parameters so OOXML serialization can
/// restore Excel's required `_xlpm.` prefix on parameter declarations and uses.
function collectParamScopes(formula: string): ParamScope[] {
  if (!/(?:^|[^\p{L}\p{N}_.])(?:_xlfn\.)?(?:LET|LAMBDA)\s*\(/iu.test(formula)) return []
  const scopes: ParamScope[] = []
  let cursor = 0
  while (cursor < formula.length) {
    const ch = formula[cursor]!
    if (ch === '"' || ch === "'") {
      cursor = quotedEnd(formula, cursor)
      continue
    }
    if (ch === '[') {
      cursor = bracketedEnd(formula, cursor)
      continue
    }
    const symbol = String.fromCodePoint(formula.codePointAt(cursor)!)
    if (!isNameCharacter(symbol)) {
      cursor += symbol.length
      continue
    }
    const start = cursor
    let end = cursor
    while (end < formula.length) {
      const current = String.fromCodePoint(formula.codePointAt(end)!)
      if (!isNameCharacter(current)) break
      end += current.length
    }
    const token = formula
      .slice(start, end)
      .toUpperCase()
      .replace(/^_XLFN\./, '')
    if (token === 'LET' || token === 'LAMBDA') {
      let after = end
      while (after < formula.length && /\s/.test(formula[after]!)) after += 1
      if (formula[after] === '(') {
        const parsed = splitTopLevelArgs(formula, after)
        if (parsed && parsed.args.length >= 2) {
          const names = new Set<string>()
          const step = token === 'LET' ? 2 : 1
          for (let idx = 0; idx < parsed.args.length - 1; idx += step) {
            const m = SIMPLE_PARAM_RE.exec(parsed.args[idx]!.trim())
            if (m?.[1]) names.add(m[1].toLowerCase())
          }
          if (names.size > 0) scopes.push({ start: after, end: parsed.closeParen, names })
        }
        cursor = after + 1
        continue
      }
    }
    cursor = end
  }
  return scopes
}

function withXlpmParamMarkers(formula: string): string {
  const scopes = collectParamScopes(formula)
  if (scopes.length === 0) return formula
  let out = ''
  let cursor = 0
  let copiedFrom = 0
  while (cursor < formula.length) {
    const ch = formula[cursor]!
    if (ch === '"' || ch === "'") {
      cursor = quotedEnd(formula, cursor)
      continue
    }
    if (ch === '[') {
      cursor = bracketedEnd(formula, cursor)
      continue
    }
    const symbol = String.fromCodePoint(formula.codePointAt(cursor)!)
    if (!isNameCharacter(symbol)) {
      cursor += symbol.length
      continue
    }
    const start = cursor
    let end = cursor
    while (end < formula.length) {
      const current = String.fromCodePoint(formula.codePointAt(end)!)
      if (!isNameCharacter(current)) break
      end += current.length
    }
    const token = formula.slice(start, end)
    const prev = start === 0 ? '' : (formula[start - 1] ?? '')
    const nextChar = formula[end] ?? ''
    if (
      !/^_xl(?:fn|ws|pm)\./i.test(token) &&
      !/[\p{L}\p{N}_.$'!]/u.test(prev) &&
      nextChar !== '!'
    ) {
      const lower = token.toLowerCase()
      const inScope = scopes.some(
        (scope) => start >= scope.start && end <= scope.end && scope.names.has(lower),
      )
      if (inScope) {
        out += formula.slice(copiedFrom, start) + `_xlpm.${token}`
        copiedFrom = end
      }
    }
    cursor = end
  }
  return out + formula.slice(copiedFrom)
}

/// Prefixes future-function calls with their storage markers (and LET/LAMBDA
/// parameters with `_xlpm.`), outside string literals. Marked calls store the
/// canonical uppercase name.
export function withFutureFunctionMarkers(formula: string): string {
  let out = ''
  let cursor = 0
  for (const call of functionCalls(formula)) {
    out += formula.slice(cursor, call.start)
    const token = formula.slice(call.start, call.end)
    const canonical = call.name.toUpperCase()
    if (call.marked) {
      out += token
    } else if (XLWS_FUNCTIONS.has(canonical)) {
      out += `_xlfn._xlws.${canonical}`
    } else if (XLFN_FUNCTIONS.has(canonical)) {
      out += `_xlfn.${canonical}`
    } else {
      out += token
    }
    cursor = call.end
  }
  return withXlpmParamMarkers(out + formula.slice(cursor))
}
