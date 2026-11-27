/**
 * Zero-dependency, backtracking-free linear-time regular expression engine
 * (Thompson NFA + Pike VM) with JS RegExp leftmost-first semantics.
 *
 * Guarantees O(N * M) worst-case matching time on all compiled patterns,
 * preventing catastrophic backtracking while preserving JS RegExp capture,
 * greedy/lazy priority, anchor, flag, and replacement template semantics.
 */

export const MAX_MACRO_REGEX_LENGTH = 256
export const MAX_QUANTIFIER_BOUND = 1000

const MAX_PROGRAM_OPS = 12_000
const MAX_NESTING_DEPTH = 64
const STEP_CHECK_INTERVAL = 64

// VM instruction opcodes
const OP_MATCH = 0
const OP_CHAR = 1
const OP_DOT = 2
const OP_CLASS = 3
const OP_SHORTHAND = 4
const OP_PROP = 5
const OP_ASSERT = 6
const OP_JMP = 7
const OP_SPLIT = 8
const OP_SAVE = 9
const OP_CLEAR = 10
const OP_OPT_ENTER = 11
const OP_OPT_EXIT = 12

// Assertion kinds
const ASSERT_START = 0
const ASSERT_END = 1
const ASSERT_WORD = 2
const ASSERT_NONWORD = 3

// Shorthand kinds
const SHORTHAND_D = 0 // \d
const SHORTHAND_NOT_D = 1 // \D
const SHORTHAND_W = 2 // \w
const SHORTHAND_NOT_W = 3 // \W
const SHORTHAND_S = 4 // \s
const SHORTHAND_NOT_S = 5 // \S

const VALID_UNICODE_PROP_RE = /^[A-Za-z0-9_=-]+$/

// Punctuation characters allowed as identity escapes (\., \*, \-, etc.)
const PUNCTUATION_IDENTITY_ESCAPES = new Set([
  '.',
  '\\',
  '*',
  '+',
  '?',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '|',
  '^',
  '$',
  '/',
  '-',
  '!',
  '"',
  '#',
  '%',
  '&',
  "'",
  ',',
  ':',
  ';',
  '<',
  '=',
  '>',
  '@',
  '`',
  '~',
  '_',
])

function isAsciiDigit(code) {
  return code >= 0x30 && code <= 0x39
}

function isAsciiLetter(code) {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)
}

function isHexDigit(code) {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x46) ||
    (code >= 0x61 && code <= 0x66)
  )
}

function isLineTerminator(cp) {
  return cp === 0x0a || cp === 0x0d || cp === 0x2028 || cp === 0x2029
}

function isWordChar(cp, unicodeIgnoreCase) {
  if (
    (cp >= 0x30 && cp <= 0x39) ||
    (cp >= 0x41 && cp <= 0x5a) ||
    (cp >= 0x61 && cp <= 0x7a) ||
    cp === 0x5f
  ) {
    return true
  }
  if (unicodeIgnoreCase && (cp === 0x017f || cp === 0x212a)) {
    return true
  }
  return false
}

function isWhitespace(cp) {
  if (cp === 0x20 || (cp >= 0x09 && cp <= 0x0d)) return true
  if (cp < 0x80) return false
  if (
    cp === 0x00a0 ||
    cp === 0x1680 ||
    (cp >= 0x2000 && cp <= 0x200a) ||
    cp === 0x2028 ||
    cp === 0x2029 ||
    cp === 0x202f ||
    cp === 0x205f ||
    cp === 0x3000 ||
    cp === 0xfeff
  ) {
    return true
  }
  return false
}

function matchShorthand(kind, cp, unicodeIgnoreCase) {
  switch (kind) {
    case SHORTHAND_D:
      return cp >= 0x30 && cp <= 0x39
    case SHORTHAND_NOT_D:
      return !(cp >= 0x30 && cp <= 0x39)
    case SHORTHAND_W:
      return isWordChar(cp, unicodeIgnoreCase)
    case SHORTHAND_NOT_W:
      return !isWordChar(cp, unicodeIgnoreCase)
    case SHORTHAND_S:
      return isWhitespace(cp)
    case SHORTHAND_NOT_S:
      return !isWhitespace(cp)
    default:
      return false
  }
}

/**
 * Canonicalize a code unit / code point for case-insensitive (`i`) matching.
 * Matches ECMAScript Canonicalize rules for both non-`u` and `u` modes.
 */
function canonicalize(cp, unicode) {
  if (cp < 0x80) {
    return cp >= 0x61 && cp <= 0x7a ? cp - 32 : cp
  }
  if (unicode) {
    if (cp === 0x017f) return 0x53 // Latin small long s -> 'S'
    if (cp === 0x212a) return 0x4b // Kelvin sign -> 'K'
    if (cp === 0x03c2) return 0x03a3 // Greek final sigma -> 'Σ'
    const str = String.fromCodePoint(cp)
    const upper = str.toUpperCase()
    if (upper.length === 1) {
      return upper.charCodeAt(0)
    }
    const upCp = upper.codePointAt(0)
    if (upCp !== undefined && upCp > 0xffff && upper.length === 2) {
      return upCp
    }
    const lower = str.toLowerCase()
    if (lower.length === 1) {
      return lower.charCodeAt(0)
    }
    const loCp = lower.codePointAt(0)
    if (loCp !== undefined && loCp > 0xffff && lower.length === 2) {
      return loCp
    }
    return cp
  }
  const str = String.fromCharCode(cp)
  const upper = str.toUpperCase()
  if (upper.length === 1) {
    const upCode = upper.charCodeAt(0)
    // In non-unicode JS RegExp, non-ASCII characters never fold into ASCII.
    if (upCode >= 0x80) {
      return upCode
    }
  }
  return cp
}

function compileUnicodeProperty(prop, negate, ignoreCase) {
  if (!prop || !VALID_UNICODE_PROP_RE.test(prop)) {
    throw new SyntaxError(`Invalid Unicode property escape: \\${negate ? 'P' : 'p'}{${prop}}`)
  }
  let re
  try {
    re = new RegExp(`^\\${negate ? 'P' : 'p'}{${prop}}$`, ignoreCase ? 'iu' : 'u')
  } catch {
    throw new SyntaxError(`Invalid Unicode property escape: \\${negate ? 'P' : 'p'}{${prop}}`)
  }
  const ascii = new Uint8Array(128)
  for (let c = 0; c < 128; c++) {
    if (re.test(String.fromCharCode(c))) {
      ascii[c] = 1
    }
  }
  return { re, ascii }
}

function matchUnicodeProperty(propMatcher, cp) {
  if (cp < 128) {
    return propMatcher.ascii[cp] === 1
  }
  return propMatcher.re.test(String.fromCodePoint(cp))
}

function compileCharClass(negate, items, ignoreCase, unicode) {
  const ascii = new Uint8Array(128)
  const nonAsciiRanges = []
  const shorthands = []
  const props = []
  const unicodeIgnoreCase = ignoreCase && unicode

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind === 'char') {
      const code = item.code
      if (code < 128) {
        ascii[code] = 1
        if (ignoreCase) {
          if (code >= 0x41 && code <= 0x5a) ascii[code + 32] = 1
          else if (code >= 0x61 && code <= 0x7a) ascii[code - 32] = 1
          if (unicode) {
            if (code === 0x53 || code === 0x73) nonAsciiRanges.push(0x017f, 0x017f)
            if (code === 0x4b || code === 0x6b) nonAsciiRanges.push(0x212a, 0x212a)
          }
        }
      } else {
        nonAsciiRanges.push(code, code)
        if (unicodeIgnoreCase) {
          if (code === 0x017f) {
            ascii[0x53] = 1
            ascii[0x73] = 1
          } else if (code === 0x212a) {
            ascii[0x4b] = 1
            ascii[0x6b] = 1
          }
        }
      }
    } else if (item.kind === 'range') {
      const from = item.from
      const to = item.to
      if (from < 128) {
        const asciiEnd = to < 127 ? to : 127
        for (let c = from; c <= asciiEnd; c++) {
          ascii[c] = 1
          if (ignoreCase) {
            if (c >= 0x41 && c <= 0x5a) ascii[c + 32] = 1
            else if (c >= 0x61 && c <= 0x7a) ascii[c - 32] = 1
          }
        }
        if (unicodeIgnoreCase) {
          if ((from <= 0x53 && asciiEnd >= 0x53) || (from <= 0x73 && asciiEnd >= 0x73)) {
            nonAsciiRanges.push(0x017f, 0x017f)
          }
          if ((from <= 0x4b && asciiEnd >= 0x4b) || (from <= 0x6b && asciiEnd >= 0x6b)) {
            nonAsciiRanges.push(0x212a, 0x212a)
          }
        }
      }
      if (to >= 128) {
        const nonAsciiStart = from < 128 ? 128 : from
        nonAsciiRanges.push(nonAsciiStart, to)
        if (unicodeIgnoreCase) {
          if (nonAsciiStart <= 0x017f && to >= 0x017f) {
            ascii[0x53] = 1
            ascii[0x73] = 1
          }
          if (nonAsciiStart <= 0x212a && to >= 0x212a) {
            ascii[0x4b] = 1
            ascii[0x6b] = 1
          }
        }
      }
    } else if (item.kind === 'shorthand') {
      shorthands.push(item.shorthand)
      for (let c = 0; c < 128; c++) {
        if (matchShorthand(item.shorthand, c, unicodeIgnoreCase)) {
          ascii[c] = 1
        }
      }
    } else if (item.kind === 'prop') {
      props.push(item.matcher)
      for (let c = 0; c < 128; c++) {
        if (item.matcher.ascii[c] === 1) {
          ascii[c] = 1
        }
      }
    }
  }

  return {
    negate,
    ascii,
    nonAsciiRanges,
    shorthands,
    props,
    ignoreCase,
    unicode,
    unicodeIgnoreCase,
  }
}

function matchCharClass(cls, cp) {
  let matched = false
  if (cp < 128) {
    matched = cls.ascii[cp] === 1
  } else {
    const ranges = cls.nonAsciiRanges
    for (let i = 0; i < ranges.length; i += 2) {
      if (cp >= ranges[i] && cp <= ranges[i + 1]) {
        matched = true
        break
      }
    }
    if (!matched && cls.ignoreCase && ranges.length > 0) {
      const str = cls.unicode ? String.fromCodePoint(cp) : String.fromCharCode(cp)
      const upper = str.toUpperCase()
      const lower = str.toLowerCase()
      const upCp =
        upper.length === 1
          ? upper.charCodeAt(0)
          : cls.unicode && upper.length === 2
            ? upper.codePointAt(0)
            : -1
      const loCp =
        lower.length === 1
          ? lower.charCodeAt(0)
          : cls.unicode && lower.length === 2
            ? lower.codePointAt(0)
            : -1
      const allowUp = upCp >= 0 && (cls.unicode || upCp >= 0x80)
      const allowLo = loCp >= 0 && (cls.unicode || loCp >= 0x80)
      // Also check canonicalized endpoints for Greek final sigma etc.
      const canonCp = canonicalize(cp, cls.unicode)
      for (let i = 0; i < ranges.length; i += 2) {
        const lo = ranges[i]
        const hi = ranges[i + 1]
        if (
          (allowUp && upCp >= lo && upCp <= hi) ||
          (allowLo && loCp >= lo && loCp <= hi) ||
          (canonCp >= lo && canonCp <= hi)
        ) {
          matched = true
          break
        }
        if (lo === hi && canonicalize(lo, cls.unicode) === canonCp) {
          matched = true
          break
        }
      }
    }
    if (!matched && cls.shorthands.length > 0) {
      for (let i = 0; i < cls.shorthands.length; i++) {
        if (matchShorthand(cls.shorthands[i], cp, cls.unicodeIgnoreCase)) {
          matched = true
          break
        }
      }
    }
    if (!matched && cls.props.length > 0) {
      for (let i = 0; i < cls.props.length; i++) {
        if (matchUnicodeProperty(cls.props[i], cp)) {
          matched = true
          break
        }
      }
    }
  }
  return cls.negate ? !matched : matched
}

function parseFlags(flags) {
  if (typeof flags !== 'string') {
    throw new TypeError('Regex flags must be a string')
  }
  let ignoreCase = false
  let multiline = false
  let dotAll = false
  let unicode = false

  for (let i = 0; i < flags.length; i++) {
    const ch = flags[i]
    if (ch === 'i') {
      if (ignoreCase) throw new SyntaxError(`Duplicate regex flag: "${ch}"`)
      ignoreCase = true
    } else if (ch === 'm') {
      if (multiline) throw new SyntaxError(`Duplicate regex flag: "${ch}"`)
      multiline = true
    } else if (ch === 's') {
      if (dotAll) throw new SyntaxError(`Duplicate regex flag: "${ch}"`)
      dotAll = true
    } else if (ch === 'u') {
      if (unicode) throw new SyntaxError(`Duplicate regex flag: "${ch}"`)
      unicode = true
    } else {
      throw new SyntaxError(`Unsupported regex flag: "${ch}"`)
    }
  }

  const normalized =
    (ignoreCase ? 'i' : '') + (multiline ? 'm' : '') + (dotAll ? 's' : '') + (unicode ? 'u' : '')

  return { ignoreCase, multiline, dotAll, unicode, normalized }
}

/**
 * Recursive-descent parser for the supported regex grammar.
 */
function parsePattern(pattern, flagInfo, maxQuantifier) {
  const len = pattern.length
  let pos = 0
  let captureCount = 0
  let depth = 0
  let detectedUnicodeProp = false
  const explicitUnicode = flagInfo.unicode

  function readPatternCode() {
    if (explicitUnicode) {
      const cp = pattern.codePointAt(pos)
      pos += cp > 0xffff ? 2 : 1
      return cp
    }
    return pattern.charCodeAt(pos++)
  }

  function parseHexDigits(count) {
    if (pos + count > len) {
      throw new SyntaxError('Invalid regular expression: incomplete hex escape')
    }
    let val = 0
    for (let i = 0; i < count; i++) {
      const c = pattern.charCodeAt(pos + i)
      if (!isHexDigit(c)) {
        throw new SyntaxError('Invalid regular expression: invalid hex escape')
      }
      val = (val << 4) | (c <= 0x39 ? c - 0x30 : (c & 0xdf) - 0x37)
    }
    pos += count
    return val
  }

  function parseUnicodeBraceEscape() {
    // Called right after `\u{`
    const start = pos
    let val = 0
    let digits = 0
    while (pos < len && pattern[pos] !== '}') {
      const c = pattern.charCodeAt(pos)
      if (!isHexDigit(c)) {
        throw new SyntaxError('Invalid regular expression: invalid Unicode code point escape')
      }
      val = val * 16 + (c <= 0x39 ? c - 0x30 : (c & 0xdf) - 0x37)
      if (val > 0x10ffff) {
        throw new SyntaxError('Invalid regular expression: Unicode code point out of range')
      }
      digits++
      pos++
    }
    if (pos >= len || pattern[pos] !== '}' || digits === 0) {
      throw new SyntaxError(
        `Invalid regular expression: malformed Unicode escape near "\\u{${pattern.slice(start, pos)}"`,
      )
    }
    pos++ // consume '}'
    return val
  }

  function parseUnicodePropertyEscape(negate) {
    // Called right after `\p` or `\P`
    if (pos >= len || pattern[pos] !== '{') {
      throw new SyntaxError(
        `Invalid regular expression: expected "{" after \\${negate ? 'P' : 'p'}`,
      )
    }
    pos++ // consume '{'
    const start = pos
    while (pos < len && pattern[pos] !== '}') {
      pos++
    }
    if (pos >= len || pattern[pos] !== '}') {
      throw new SyntaxError('Invalid regular expression: unclosed Unicode property escape')
    }
    const prop = pattern.slice(start, pos)
    pos++ // consume '}'
    detectedUnicodeProp = true
    const matcher = compileUnicodeProperty(prop, negate, flagInfo.ignoreCase)
    return { kind: 'prop', prop, negate, matcher }
  }

  function parseEscape(inClass) {
    // Leading '\' already consumed
    if (pos >= len) {
      throw new SyntaxError('Invalid regular expression: trailing backslash')
    }
    const ch = pattern[pos]
    const code = pattern.charCodeAt(pos)

    // Backreferences \1..\9 and \k<...>
    if (code >= 0x31 && code <= 0x39) {
      throw new SyntaxError(`Unsupported regex feature: backreference "\\${ch}" is not supported`)
    }
    if (ch === 'k') {
      throw new SyntaxError('Unsupported regex feature: named backreference "\\k" is not supported')
    }

    // \0 (only valid if NOT followed by an ASCII digit)
    if (ch === '0') {
      pos++
      if (pos < len && isAsciiDigit(pattern.charCodeAt(pos))) {
        throw new SyntaxError(
          'Unsupported regex feature: octal/backreference escape "\\0..." is not supported',
        )
      }
      return { kind: 'char', code: 0x00 }
    }

    pos++
    switch (ch) {
      case 'n':
        return { kind: 'char', code: 0x0a }
      case 'r':
        return { kind: 'char', code: 0x0d }
      case 't':
        return { kind: 'char', code: 0x09 }
      case 'f':
        return { kind: 'char', code: 0x0c }
      case 'v':
        return { kind: 'char', code: 0x0b }
      case 'b':
        if (inClass) {
          return { kind: 'char', code: 0x08 }
        }
        return { kind: 'assert', assertKind: ASSERT_WORD }
      case 'B':
        if (inClass) {
          throw new SyntaxError(
            'Invalid regular expression: "\\B" is not valid inside character class',
          )
        }
        return { kind: 'assert', assertKind: ASSERT_NONWORD }
      case 'd':
        return { kind: 'shorthand', shorthand: SHORTHAND_D }
      case 'D':
        return { kind: 'shorthand', shorthand: SHORTHAND_NOT_D }
      case 'w':
        return { kind: 'shorthand', shorthand: SHORTHAND_W }
      case 'W':
        return { kind: 'shorthand', shorthand: SHORTHAND_NOT_W }
      case 's':
        return { kind: 'shorthand', shorthand: SHORTHAND_S }
      case 'S':
        return { kind: 'shorthand', shorthand: SHORTHAND_NOT_S }
      case 'p':
        return parseUnicodePropertyEscape(false)
      case 'P':
        return parseUnicodePropertyEscape(true)
      case 'c': {
        if (pos >= len || !isAsciiLetter(pattern.charCodeAt(pos))) {
          throw new SyntaxError('Invalid regular expression: invalid control escape "\\c"')
        }
        const ctrl = pattern.charCodeAt(pos++) & 31
        return { kind: 'char', code: ctrl }
      }
      case 'x': {
        const val = parseHexDigits(2)
        return { kind: 'char', code: val }
      }
      case 'u': {
        if (pos < len && pattern[pos] === '{') {
          if (!explicitUnicode) {
            throw new SyntaxError(
              'Invalid regular expression: "\\u{...}" escape requires the "u" flag',
            )
          }
          pos++ // consume '{'
          const cp = parseUnicodeBraceEscape()
          return { kind: 'char', code: cp }
        }
        const hi = parseHexDigits(4)
        // Combine surrogate pair escapes \uD800..\uDBFF followed by \uDC00..\uDFFF in u mode
        if (
          explicitUnicode &&
          hi >= 0xd800 &&
          hi <= 0xdbff &&
          pos + 6 <= len &&
          pattern[pos] === '\\' &&
          pattern[pos + 1] === 'u' &&
          pattern[pos + 2] !== '{'
        ) {
          const savedPos = pos
          pos += 2
          let lo
          try {
            lo = parseHexDigits(4)
          } catch {
            pos = savedPos
            lo = -1
          }
          if (lo >= 0xdc00 && lo <= 0xdfff) {
            const combined = 0x10000 + ((hi - 0xd800) << 10) + (lo - 0xdc00)
            return { kind: 'char', code: combined }
          }
          pos = savedPos
        }
        return { kind: 'char', code: hi }
      }
      default: {
        if (PUNCTUATION_IDENTITY_ESCAPES.has(ch)) {
          return { kind: 'char', code }
        }
        throw new SyntaxError(`Invalid regular expression: unsupported escape "\\${ch}"`)
      }
    }
  }

  function parseCharClass() {
    // Leading '[' already consumed
    let negate = false
    if (pos < len && pattern[pos] === '^') {
      negate = true
      pos++
    }
    const items = []
    while (pos < len && pattern[pos] !== ']') {
      let lhs
      if (pattern[pos] === '\\') {
        pos++
        lhs = parseEscape(true)
      } else {
        lhs = { kind: 'char', code: readPatternCode() }
      }

      // Check for character range `lhs-rhs`
      if (pos < len && pattern[pos] === '-' && pos + 1 < len && pattern[pos + 1] !== ']') {
        if (lhs.kind !== 'char') {
          throw new SyntaxError(
            'Invalid regular expression: character class range cannot start with a shorthand class',
          )
        }
        pos++ // consume '-'
        let rhs
        if (pattern[pos] === '\\') {
          pos++
          rhs = parseEscape(true)
        } else {
          rhs = { kind: 'char', code: readPatternCode() }
        }
        if (rhs.kind !== 'char') {
          throw new SyntaxError(
            'Invalid regular expression: character class range cannot end with a shorthand class',
          )
        }
        if (lhs.code > rhs.code) {
          throw new SyntaxError(
            `Invalid regular expression: character class range out of order (${lhs.code}-${rhs.code})`,
          )
        }
        items.push({ kind: 'range', from: lhs.code, to: rhs.code })
      } else {
        items.push(lhs)
      }
    }

    if (pos >= len || pattern[pos] !== ']') {
      throw new SyntaxError('Invalid regular expression: unclosed character class "["')
    }
    pos++ // consume ']'
    return { type: 'Class', negate, items }
  }

  function parseGroup() {
    // Leading '(' already consumed
    if (depth >= MAX_NESTING_DEPTH) {
      throw new RangeError(`Regex nesting depth exceeds maximum allowed (${MAX_NESTING_DEPTH})`)
    }
    depth++

    let capturing = true
    let groupIndex = 0
    if (pos < len && pattern[pos] === '?') {
      if (pos + 1 >= len) {
        throw new SyntaxError('Invalid regular expression: incomplete group "(?"')
      }
      const next = pattern[pos + 1]
      if (next === ':') {
        capturing = false
        pos += 2
      } else if (next === '=' || next === '!') {
        throw new SyntaxError(
          `Unsupported regex feature: ${next === '=' ? 'positive' : 'negative'} lookahead "(?${next}...)" is not supported`,
        )
      } else if (next === '<') {
        const after = pos + 2 < len ? pattern[pos + 2] : ''
        if (after === '=' || after === '!') {
          throw new SyntaxError(
            `Unsupported regex feature: ${after === '=' ? 'positive' : 'negative'} lookbehind "(?<${after}...)" is not supported`,
          )
        }
        throw new SyntaxError(
          'Unsupported regex group syntax: named capturing group "(?<name>...)" is not supported',
        )
      } else {
        throw new SyntaxError(`Unsupported regex group syntax: "(?${next}..." is not supported`)
      }
    } else {
      groupIndex = ++captureCount
    }

    const body = parseAlternation()
    if (pos >= len || pattern[pos] !== ')') {
      throw new SyntaxError('Invalid regular expression: unclosed group "("')
    }
    pos++ // consume ')'
    depth--

    return {
      type: 'Group',
      capturing,
      index: groupIndex,
      body,
    }
  }

  function parseBraceQuantifier() {
    // Leading '{' is at pattern[pos]
    const start = pos
    pos++ // consume '{'
    if (pos >= len || !isAsciiDigit(pattern.charCodeAt(pos))) {
      throw new SyntaxError(
        `Invalid regular expression: malformed quantifier near "${pattern.slice(start, start + 8)}"`,
      )
    }
    let min = 0
    while (pos < len && isAsciiDigit(pattern.charCodeAt(pos))) {
      min = min * 10 + (pattern.charCodeAt(pos++) - 0x30)
      if (min > maxQuantifier) {
        throw new RangeError(`Regex quantifier bound exceeds maximum allowed (${maxQuantifier})`)
      }
    }

    let max = min
    if (pos < len && pattern[pos] === ',') {
      pos++ // consume ','
      if (pos < len && pattern[pos] === '}') {
        max = null // unbounded {n,}
      } else if (pos < len && isAsciiDigit(pattern.charCodeAt(pos))) {
        max = 0
        while (pos < len && isAsciiDigit(pattern.charCodeAt(pos))) {
          max = max * 10 + (pattern.charCodeAt(pos++) - 0x30)
          if (max > maxQuantifier) {
            throw new RangeError(
              `Regex quantifier bound exceeds maximum allowed (${maxQuantifier})`,
            )
          }
        }
      } else {
        throw new SyntaxError(
          `Invalid regular expression: malformed quantifier near "${pattern.slice(start, pos + 1)}"`,
        )
      }
    }

    if (pos >= len || pattern[pos] !== '}') {
      throw new SyntaxError('Invalid regular expression: unclosed quantifier "{"')
    }
    pos++ // consume '}'

    if (max !== null && max < min) {
      throw new SyntaxError(`Invalid regular expression: quantifier out of order {${min},${max}}`)
    }
    return { min, max }
  }

  function parseAtom() {
    const ch = pattern[pos]
    if (ch === '^') {
      pos++
      return { type: 'Assert', assertKind: ASSERT_START }
    }
    if (ch === '$') {
      pos++
      return { type: 'Assert', assertKind: ASSERT_END }
    }
    if (ch === '.') {
      pos++
      return { type: 'Dot' }
    }
    if (ch === '[') {
      pos++
      return parseCharClass()
    }
    if (ch === '(') {
      pos++
      return parseGroup()
    }
    if (ch === '\\') {
      pos++
      const esc = parseEscape(false)
      if (esc.kind === 'char') {
        return { type: 'Char', code: esc.code }
      }
      if (esc.kind === 'assert') {
        return { type: 'Assert', assertKind: esc.assertKind }
      }
      if (esc.kind === 'shorthand') {
        return { type: 'Shorthand', shorthand: esc.shorthand }
      }
      if (esc.kind === 'prop') {
        return { type: 'Prop', matcher: esc.matcher }
      }
    }
    if (ch === '*' || ch === '+' || ch === '?' || ch === '{') {
      throw new SyntaxError(`Invalid regular expression: nothing to repeat ("${ch}")`)
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      throw new SyntaxError(`Invalid regular expression: unexpected "${ch}"`)
    }
    return { type: 'Char', code: readPatternCode() }
  }

  function parseQuantified() {
    const beforeCapture = captureCount
    const atom = parseAtom()
    const afterCapture = captureCount

    if (pos >= len) {
      return atom
    }

    const ch = pattern[pos]
    let min = 0
    let max = null
    let hasQuant = false

    if (ch === '*') {
      pos++
      min = 0
      max = null
      hasQuant = true
    } else if (ch === '+') {
      pos++
      min = 1
      max = null
      hasQuant = true
    } else if (ch === '?') {
      pos++
      min = 0
      max = 1
      hasQuant = true
    } else if (ch === '{') {
      const q = parseBraceQuantifier()
      min = q.min
      max = q.max
      hasQuant = true
    }

    if (!hasQuant) {
      return atom
    }

    if (atom.type === 'Assert') {
      throw new SyntaxError('Invalid regular expression: cannot quantify zero-width assertion')
    }

    let greedy = true
    if (pos < len && pattern[pos] === '?') {
      greedy = false
      pos++
    }

    // Reject stacked quantifiers like a**, a+*, a{2}*, a??+
    if (pos < len) {
      const next = pattern[pos]
      if (next === '*' || next === '+' || next === '?' || next === '{') {
        throw new SyntaxError(`Invalid regular expression: nothing to repeat ("${next}")`)
      }
    }

    return {
      type: 'Quant',
      body: atom,
      min,
      max,
      greedy,
      firstCapture: afterCapture > beforeCapture ? beforeCapture + 1 : 0,
      lastCapture: afterCapture > beforeCapture ? afterCapture : 0,
    }
  }

  function parseSequence() {
    const items = []
    while (pos < len) {
      const ch = pattern[pos]
      if (ch === '|' || ch === ')') {
        break
      }
      items.push(parseQuantified())
    }
    if (items.length === 0) {
      return { type: 'Empty' }
    }
    if (items.length === 1) {
      return items[0]
    }
    return { type: 'Seq', items }
  }

  function parseAlternation() {
    const branches = [parseSequence()]
    while (pos < len && pattern[pos] === '|') {
      pos++ // consume '|'
      branches.push(parseSequence())
    }
    if (branches.length === 1) {
      return branches[0]
    }
    return { type: 'Alt', branches }
  }

  const ast = parseAlternation()
  if (pos < len) {
    throw new SyntaxError(`Invalid regular expression: unexpected "${pattern[pos]}"`)
  }

  return {
    ast,
    captureCount,
    unicodeMode: explicitUnicode || detectedUnicodeProp,
  }
}

function canMatchEmpty(node) {
  switch (node.type) {
    case 'Empty':
    case 'Assert':
      return true
    case 'Char':
    case 'Dot':
    case 'Class':
    case 'Shorthand':
    case 'Prop':
      return false
    case 'Seq':
      for (let i = 0; i < node.items.length; i++) {
        if (!canMatchEmpty(node.items[i])) return false
      }
      return true
    case 'Alt':
      for (let i = 0; i < node.branches.length; i++) {
        if (canMatchEmpty(node.branches[i])) return true
      }
      return false
    case 'Group':
      return canMatchEmpty(node.body)
    case 'Quant':
      return node.min === 0 || canMatchEmpty(node.body)
    default:
      return true
  }
}

/**
 * Compile AST into a flat Thompson NFA bytecode array with bounded size.
 */
function compileProgram(ast, flagInfo, unicodeMode) {
  const ops = []
  let optCounter = 0
  const ignoreCase = flagInfo.ignoreCase

  function emit(op, a = 0, b = 0, x = 0, y = 0, matcher = null) {
    if (ops.length >= MAX_PROGRAM_OPS) {
      throw new RangeError(
        `Compiled regex program exceeds maximum instruction limit (${MAX_PROGRAM_OPS})`,
      )
    }
    const idx = ops.length
    ops.push({ op, a, b, x, y, matcher })
    return idx
  }

  function emitOptionalIteration(node, bodyNullable) {
    const splitIdx = emit(OP_SPLIT, 0, 0, 0, 0)
    const bodyStart = ops.length

    if (node.firstCapture > 0) {
      emit(OP_CLEAR, node.firstCapture * 2, node.lastCapture * 2 + 1)
    }

    let optId = -1
    if (bodyNullable) {
      optId = optCounter++
      emit(OP_OPT_ENTER, optId)
    }
    compileNode(node.body)
    if (bodyNullable) {
      emit(OP_OPT_EXIT, optId)
    }

    const afterIdx = ops.length
    if (node.greedy) {
      ops[splitIdx].x = bodyStart
      ops[splitIdx].y = afterIdx
    } else {
      ops[splitIdx].x = afterIdx
      ops[splitIdx].y = bodyStart
    }
  }

  function emitUnboundedLoop(node, bodyNullable) {
    const loopStart = ops.length
    const splitIdx = emit(OP_SPLIT, 0, 0, 0, 0)
    const bodyStart = ops.length

    if (node.firstCapture > 0) {
      emit(OP_CLEAR, node.firstCapture * 2, node.lastCapture * 2 + 1)
    }

    let optId = -1
    if (bodyNullable) {
      optId = optCounter++
      emit(OP_OPT_ENTER, optId)
    }
    compileNode(node.body)
    if (bodyNullable) {
      emit(OP_OPT_EXIT, optId)
    }

    emit(OP_JMP, 0, 0, loopStart)
    const afterIdx = ops.length
    if (node.greedy) {
      ops[splitIdx].x = bodyStart
      ops[splitIdx].y = afterIdx
    } else {
      ops[splitIdx].x = afterIdx
      ops[splitIdx].y = bodyStart
    }
  }

  function compileNode(node) {
    switch (node.type) {
      case 'Empty':
        return
      case 'Char': {
        const expected = ignoreCase ? canonicalize(node.code, unicodeMode) : node.code
        emit(OP_CHAR, expected)
        return
      }
      case 'Dot':
        emit(OP_DOT)
        return
      case 'Class': {
        const matcher = compileCharClass(node.negate, node.items, ignoreCase, unicodeMode)
        emit(OP_CLASS, 0, 0, 0, 0, matcher)
        return
      }
      case 'Shorthand':
        emit(OP_SHORTHAND, node.shorthand)
        return
      case 'Prop':
        emit(OP_PROP, 0, 0, 0, 0, node.matcher)
        return
      case 'Assert':
        emit(OP_ASSERT, node.assertKind)
        return
      case 'Seq':
        for (let i = 0; i < node.items.length; i++) {
          compileNode(node.items[i])
        }
        return
      case 'Alt': {
        const branches = node.branches
        const endJumps = []
        for (let i = 0; i < branches.length; i++) {
          if (i < branches.length - 1) {
            const splitIdx = emit(OP_SPLIT, 0, 0, 0, 0)
            const branchStart = ops.length
            compileNode(branches[i])
            const jmpIdx = emit(OP_JMP, 0, 0, 0)
            endJumps.push(jmpIdx)
            const nextBranch = ops.length
            ops[splitIdx].x = branchStart
            ops[splitIdx].y = nextBranch
          } else {
            compileNode(branches[i])
          }
        }
        const afterAlt = ops.length
        for (let i = 0; i < endJumps.length; i++) {
          ops[endJumps[i]].x = afterAlt
        }
        return
      }
      case 'Group':
        if (node.capturing) {
          emit(OP_SAVE, node.index * 2)
          compileNode(node.body)
          emit(OP_SAVE, node.index * 2 + 1)
        } else {
          compileNode(node.body)
        }
        return
      case 'Quant': {
        const bodyNullable = canMatchEmpty(node.body)
        // Mandatory minimum repetitions
        for (let i = 0; i < node.min; i++) {
          if (node.firstCapture > 0) {
            emit(OP_CLEAR, node.firstCapture * 2, node.lastCapture * 2 + 1)
          }
          compileNode(node.body)
        }
        if (node.max === null) {
          emitUnboundedLoop(node, bodyNullable)
        } else {
          const optionalCount = node.max - node.min
          for (let i = 0; i < optionalCount; i++) {
            emitOptionalIteration(node, bodyNullable)
          }
        }
        return
      }
    }
  }

  emit(OP_SAVE, 0)
  compileNode(ast)
  emit(OP_SAVE, 1)
  emit(OP_MATCH)

  return { ops, optCount: optCounter }
}

function stepCharWidth(text, pos, unicodeMode) {
  if (!unicodeMode) return 1
  const cp = text.codePointAt(pos)
  return cp !== undefined && cp > 0xffff ? 2 : 1
}

/**
 * Compile a macro regular expression into a frozen, backtracking-free Thompson NFA / Pike VM.
 *
 * @param {string} pattern
 * @param {string} [flags='']
 * @param {{ maxLength?: number, maxQuantifier?: number }} [options]
 */
export function compileMacroRegex(pattern, flags = '', options = undefined) {
  if (typeof pattern !== 'string') {
    throw new TypeError('Regex pattern must be a string')
  }

  const maxLength =
    options && typeof options.maxLength === 'number' ? options.maxLength : MAX_MACRO_REGEX_LENGTH
  const maxQuantifier =
    options && typeof options.maxQuantifier === 'number'
      ? options.maxQuantifier
      : MAX_QUANTIFIER_BOUND

  if (!Number.isInteger(maxLength) || maxLength < 0) {
    throw new RangeError('Invalid maxLength option')
  }
  if (!Number.isInteger(maxQuantifier) || maxQuantifier < 0) {
    throw new RangeError('Invalid maxQuantifier option')
  }
  if (pattern.length > maxLength) {
    throw new RangeError(
      `Regex pattern length (${pattern.length}) exceeds maximum allowed (${maxLength})`,
    )
  }

  const flagInfo = parseFlags(flags)
  const { ast, captureCount, unicodeMode } = parsePattern(pattern, flagInfo, maxQuantifier)
  const { ops, optCount } = compileProgram(ast, flagInfo, unicodeMode)

  const ignoreCase = flagInfo.ignoreCase
  const multiline = flagInfo.multiline
  const dotAll = flagInfo.dotAll
  const unicodeIgnoreCase = ignoreCase && unicodeMode
  const slotCount = (captureCount + 1) * 2
  const progLen = ops.length

  // Reusable prototype empty slots array (never mutated directly; always copy-on-write)
  const emptySlots = new Array(slotCount).fill(-1)

  function checkAssertion(kind, text, pos) {
    switch (kind) {
      case ASSERT_START:
        if (pos === 0) return true
        return multiline && isLineTerminator(text.charCodeAt(pos - 1))
      case ASSERT_END:
        if (pos === text.length) return true
        return multiline && isLineTerminator(text.charCodeAt(pos))
      case ASSERT_WORD: {
        const prevWord = pos > 0 && isWordChar(text.charCodeAt(pos - 1), unicodeIgnoreCase)
        const currWord = pos < text.length && isWordChar(text.charCodeAt(pos), unicodeIgnoreCase)
        return prevWord !== currWord
      }
      case ASSERT_NONWORD: {
        const prevWord = pos > 0 && isWordChar(text.charCodeAt(pos - 1), unicodeIgnoreCase)
        const currWord = pos < text.length && isWordChar(text.charCodeAt(pos), unicodeIgnoreCase)
        return prevWord === currWord
      }
      default:
        return false
    }
  }

  function matchInstruction(inst, cp) {
    switch (inst.op) {
      case OP_CHAR:
        return (ignoreCase ? canonicalize(cp, unicodeMode) : cp) === inst.a
      case OP_DOT:
        return dotAll || !isLineTerminator(cp)
      case OP_CLASS:
        return matchCharClass(inst.matcher, cp)
      case OP_SHORTHAND:
        return matchShorthand(inst.a, cp, unicodeIgnoreCase)
      case OP_PROP:
        return matchUnicodeProperty(inst.matcher, cp)
      default:
        return false
    }
  }

  function execAll(text, runOpts = undefined) {
    if (typeof text !== 'string') {
      throw new TypeError('Expected text to be a string')
    }

    const onStep = runOpts && typeof runOpts.onStep === 'function' ? runOpts.onStep : null
    const checkLimit =
      runOpts && typeof runOpts.checkLimit === 'function' ? runOpts.checkLimit : null
    const hasMeter = onStep !== null || checkLimit !== null

    let pendingSteps = 0
    function tickStep() {
      pendingSteps++
      if (pendingSteps >= STEP_CHECK_INTERVAL) {
        const delta = pendingSteps
        pendingSteps = 0
        if (onStep) onStep(delta)
        if (checkLimit) checkLimit()
      }
    }
    function flushSteps() {
      if (pendingSteps > 0) {
        const delta = pendingSteps
        pendingSteps = 0
        if (onStep) onStep(delta)
        if (checkLimit) checkLimit()
      }
    }

    // Per-execAll scratch state (keeps compiled regex stateless & re-entrant)
    const visited = new Int32Array(progLen)
    let stepGen = 0
    const activeOptCount = optCount > 0 ? new Uint16Array(optCount) : null
    const stackPc = []
    const stackSlots = []

    function nextGen() {
      stepGen++
      if (stepGen >= 0x7ffffff0) {
        visited.fill(0)
        stepGen = 1
      }
      return stepGen
    }

    /**
     * Iterative DFS epsilon-closure into `listPc` / `listSlots`.
     * Returns true if OP_MATCH was added to the list.
     */
    function addThread(listPc, listSlots, startPc, startSlots, pos, gen) {
      let sp = 0
      stackPc[sp] = startPc
      stackSlots[sp] = startSlots
      sp++

      while (sp > 0) {
        sp--
        const pc = stackPc[sp]
        if (pc < 0) {
          activeOptCount[-1 - pc]--
          continue
        }

        const inst = ops[pc]
        if (inst.op === OP_OPT_EXIT && activeOptCount !== null && activeOptCount[inst.a] > 0) {
          // Zero-length optional iteration: prune without marking visited
          continue
        }

        if (visited[pc] === gen) {
          continue
        }
        visited[pc] = gen

        if (hasMeter) tickStep()

        const slots = stackSlots[sp]
        switch (inst.op) {
          case OP_JMP:
            stackPc[sp] = inst.x
            stackSlots[sp] = slots
            sp++
            break
          case OP_SPLIT:
            // Push lower-priority y first, higher-priority x second (LIFO pops x first)
            stackPc[sp] = inst.y
            stackSlots[sp] = slots
            sp++
            stackPc[sp] = inst.x
            stackSlots[sp] = slots
            sp++
            break
          case OP_SAVE: {
            let nextSlots = slots
            if (slots[inst.a] !== pos) {
              nextSlots = slots.slice()
              nextSlots[inst.a] = pos
            }
            stackPc[sp] = pc + 1
            stackSlots[sp] = nextSlots
            sp++
            break
          }
          case OP_CLEAR: {
            let needsCopy = false
            for (let s = inst.a; s <= inst.b; s++) {
              if (slots[s] !== -1) {
                needsCopy = true
                break
              }
            }
            let nextSlots = slots
            if (needsCopy) {
              nextSlots = slots.slice()
              for (let s = inst.a; s <= inst.b; s++) {
                nextSlots[s] = -1
              }
            }
            stackPc[sp] = pc + 1
            stackSlots[sp] = nextSlots
            sp++
            break
          }
          case OP_ASSERT:
            if (checkAssertion(inst.a, text, pos)) {
              stackPc[sp] = pc + 1
              stackSlots[sp] = slots
              sp++
            }
            break
          case OP_OPT_ENTER:
            // Push sentinel to decrement activeOptCount when this DFS subtree finishes
            stackPc[sp] = -1 - inst.a
            stackSlots[sp] = null
            sp++
            activeOptCount[inst.a]++
            stackPc[sp] = pc + 1
            stackSlots[sp] = slots
            sp++
            break
          case OP_OPT_EXIT:
            stackPc[sp] = pc + 1
            stackSlots[sp] = slots
            sp++
            break
          case OP_MATCH:
            listPc.push(pc)
            listSlots.push(slots)
            // No lower-priority thread in this epsilon-closure can beat this MATCH.
            // Clean up any active OP_OPT_ENTER sentinels on the stack before returning.
            while (sp > 0) {
              const remPc = stackPc[--sp]
              if (remPc < 0) {
                activeOptCount[-1 - remPc]--
              }
            }
            return true
          default:
            // Consuming instruction: park thread until current character is tested
            listPc.push(pc)
            listSlots.push(slots)
            break
        }
      }
      return false
    }

    let clistPc = []
    let clistSlots = []
    let nlistPc = []
    let nlistSlots = []

    function execOne(startPos) {
      clistPc.length = 0
      clistSlots.length = 0
      let bestMatch = null

      let pos = startPos
      const initGen = nextGen()
      let currHasMatch = addThread(clistPc, clistSlots, 0, emptySlots, pos, initGen)

      const textLen = text.length
      while (true) {
        if (hasMeter) tickStep()
        const atEnd = pos >= textLen
        const cp = atEnd ? -1 : unicodeMode ? text.codePointAt(pos) : text.charCodeAt(pos)
        const nextPos = atEnd ? pos : pos + (unicodeMode && cp > 0xffff ? 2 : 1)

        nlistPc.length = 0
        nlistSlots.length = 0
        const genNext = atEnd ? 0 : nextGen()
        let nextHasMatch = false

        for (let i = 0; i < clistPc.length; i++) {
          if (hasMeter) tickStep()
          const pc = clistPc[i]
          const inst = ops[pc]
          if (inst.op === OP_MATCH) {
            bestMatch = clistSlots[i]
            break
          }
          if (!atEnd && matchInstruction(inst, cp)) {
            if (addThread(nlistPc, nlistSlots, pc + 1, clistSlots[i], nextPos, genNext)) {
              nextHasMatch = true
              // A higher-priority thread already guaranteed a match at nextPos;
              // no remaining lower-priority thread in clist can beat it.
              break
            }
          }
        }

        if (atEnd) {
          break
        }

        // Unanchored search: spawn a new start thread at nextPos ONLY if no match
        // has been found or queued yet.
        if (bestMatch === null && !nextHasMatch && !currHasMatch) {
          if (addThread(nlistPc, nlistSlots, 0, emptySlots, nextPos, genNext)) {
            nextHasMatch = true
          }
        }

        // Swap clist and nlist
        const tmpPc = clistPc
        clistPc = nlistPc
        nlistPc = tmpPc
        const tmpSlots = clistSlots
        clistSlots = nlistSlots
        nlistSlots = tmpSlots
        currHasMatch = nextHasMatch
        pos = nextPos

        // Once a match has been found, stop as soon as all higher-priority threads finish
        if (bestMatch !== null && clistPc.length === 0) {
          break
        }
      }

      return bestMatch
    }

    const results = []
    let searchPos = 0
    const textLen = text.length

    while (searchPos <= textLen) {
      const slots = execOne(searchPos)
      if (slots === null) {
        break
      }
      const matchStart = slots[0]
      const matchEnd = slots[1]
      const matchLen = matchEnd - matchStart
      const matchText = text.slice(matchStart, matchEnd)
      const groups = new Array(captureCount + 1)
      groups[0] = matchText
      for (let g = 1; g <= captureCount; g++) {
        const gs = slots[g * 2]
        const ge = slots[g * 2 + 1]
        groups[g] = gs >= 0 && ge >= 0 ? text.slice(gs, ge) : undefined
      }
      results.push({
        index: matchStart,
        length: matchLen,
        matchText,
        groups,
      })

      if (matchLen === 0) {
        if (matchStart >= textLen) {
          break
        }
        searchPos = matchStart + stepCharWidth(text, matchStart, unicodeMode)
      } else {
        searchPos = matchEnd
      }
    }

    if (hasMeter) flushSteps()
    return results
  }

  return Object.freeze({
    pattern,
    flags: flagInfo.normalized,
    captureCount,
    execAll,
  })
}

/**
 * Expand a JS `String.prototype.replace` replacement template against a match.
 * Supports exact JS semantics: `$$`, `$&`, `` $` ``, `$'`, `$1`..`$99` (and `$01`..`$09`).
 *
 * @param {string} template
 * @param {{ index: number, length: number, matchText: string, groups: Array<string | undefined> }} match
 * @param {string} fullText
 * @returns {string}
 */
export function expandMacroRegexReplacement(template, match, fullText) {
  if (typeof template !== 'string') {
    throw new TypeError('Replacement template must be a string')
  }
  if (typeof fullText !== 'string') {
    throw new TypeError('fullText must be a string')
  }
  if (!match || !Array.isArray(match.groups)) {
    throw new TypeError('Invalid match object')
  }

  const len = template.length
  const nCaptures = match.groups.length - 1
  let out = ''
  let i = 0

  while (i < len) {
    const ch = template[i]
    if (ch !== '$' || i + 1 >= len) {
      out += ch
      i++
      continue
    }

    const next = template[i + 1]
    if (next === '$') {
      out += '$'
      i += 2
      continue
    }
    if (next === '&') {
      out += match.matchText
      i += 2
      continue
    }
    if (next === '`') {
      out += fullText.slice(0, match.index)
      i += 2
      continue
    }
    if (next === "'") {
      out += fullText.slice(match.index + match.length)
      i += 2
      continue
    }

    const c1 = template.charCodeAt(i + 1)
    if (c1 >= 0x30 && c1 <= 0x39) {
      const d1 = c1 - 0x30
      if (i + 2 < len) {
        const c2 = template.charCodeAt(i + 2)
        if (c2 >= 0x30 && c2 <= 0x39) {
          const nn = d1 * 10 + (c2 - 0x30)
          if (nn >= 1 && nn <= nCaptures) {
            const val = match.groups[nn]
            if (val !== undefined) out += val
            i += 3
            continue
          }
        }
      }
      if (d1 >= 1 && d1 <= nCaptures) {
        const val = match.groups[d1]
        if (val !== undefined) out += val
        i += 2
        continue
      }
    }

    out += '$'
    i++
  }

  return out
}
