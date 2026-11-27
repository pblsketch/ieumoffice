/**
 * Restricted synchronous script macro interpreter.
 *
 * Implements a self-contained recursive-descent lexer, parser, and AST evaluator
 * for a strict subset of JavaScript with zero dynamic host code execution.
 *
 * Security invariants:
 * - No host global access; root scope contains only explicitly supplied API
 *   bindings and a small set of frozen, prototype-free built-in helpers.
 * - All script-created objects and sanitized records are prototype-free
 *   (`Object.create(null)`).
 * - Dot and computed access to forbidden prototype/introspection properties
 *   throws `MacroRuntimeError` (`code: 'forbidden_property'`) with exact 1-based
 *   `(line, column)`.
 * - String and array methods are dispatched strictly through explicit allowlists
 *   with bounded output length and collection size checks.
 * - Execution is synchronously bounded by configurable `maxSteps`, `maxTimeMs`,
 *   `maxCallDepth`, `maxStringLength`, `maxCollectionSize`, and `maxScriptBytes`.
 */

export const MAX_INT32 = 2147483647

export const DEFAULT_MACRO_LIMITS = Object.freeze({
  maxTimeMs: 30_000,
  maxSteps: 100_000,
  maxCallDepth: 64,
  maxStringLength: 1_000_000,
  maxCollectionSize: 50_000,
  maxScriptBytes: 256 * 1024,
  maxMemoryBytes: 64 * 1024 * 1024,
})

const LIMIT_KEYS = Object.freeze(Object.keys(DEFAULT_MACRO_LIMITS))

export const BIDI_AND_INVISIBLE_RE = /[\u202A-\u202E\u2066-\u2069\u200B-\u200F]/

/**
 * Scan raw macro source text for disallowed invisible or bidirectional control
 * characters (Trojan Source / hidden character defense). ASCII escape sequences
 * such as `\u202e` inside string literals are unaffected.
 */
export function findDisallowedInvisibleChar(source) {
  if (typeof source !== 'string' || !BIDI_AND_INVISIBLE_RE.test(source)) {
    return null
  }
  let line = 1
  let column = 1
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (BIDI_AND_INVISIBLE_RE.test(ch)) {
      const codePoint = ch.charCodeAt(0)
      return {
        line,
        column,
        codePoint,
        hex: codePoint.toString(16).toUpperCase().padStart(4, '0'),
      }
    }
    if (ch === '\r') {
      if (i + 1 < source.length && source[i + 1] === '\n') {
        i += 1
      }
      line += 1
      column = 1
    } else if (ch === '\n') {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }
  return null
}

export const FORBIDDEN_PROP_NAMES = Object.freeze(
  new Set([
    'constructor',
    '__proto__',
    'prototype',
    '__defineGetter__',
    '__defineSetter__',
    '__lookupGetter__',
    '__lookupSetter__',
    'caller',
    'callee',
    'arguments',
  ]),
)

const MAX_PARSE_DEPTH = 128

const SUPPORTED_KEYWORDS = new Set([
  'var',
  'let',
  'const',
  'if',
  'else',
  'for',
  'while',
  'do',
  'break',
  'continue',
  'return',
  'function',
  'true',
  'false',
  'null',
  'undefined',
  'typeof',
  'switch',
  'case',
  'default',
])

const REJECTED_KEYWORDS = new Set([
  'new',
  'class',
  'import',
  'export',
  'with',
  'this',
  'super',
  'async',
  'await',
  'yield',
  'debugger',
  'delete',
  'void',
  'in',
  'instanceof',
  'try',
  'catch',
  'finally',
  'throw',
  'extends',
  'static',
  'enum',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
])

const REJECTED_IDENTIFIERS = new Set(['eval', 'Function'])

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%='])

const ID_START_RE = /^[\p{ID_Start}$_]$/u
const ID_CONT_RE = /^[\p{ID_Continue}$]$/u

const SAFE_BAGS = new WeakSet()
const CALLABLES = new WeakMap()

export class MacroSyntaxError extends Error {
  constructor(message, line = 1, column = 1, code = 'syntax_error') {
    super(message)
    this.name = 'MacroSyntaxError'
    this.code = code
    this.line = line
    this.column = column
  }
}

export class MacroRuntimeError extends Error {
  constructor(message, code = 'runtime_error', line = 1, column = 1) {
    super(message)
    this.name = 'MacroRuntimeError'
    this.code = code
    this.line = line
    this.column = column
  }
}

/**
 * Validate and resolve numeric macro execution limits.
 * Rejects 0, negative numbers, non-integers, NaN, Infinity, and values above MAX_INT32.
 */
export function validateMacroLimits(limits) {
  if (limits === undefined || limits === null) {
    return DEFAULT_MACRO_LIMITS
  }
  if (typeof limits !== 'object' || Array.isArray(limits)) {
    throw new RangeError('Macro limits must be a plain object')
  }
  const resolved = Object.create(null)
  for (const key of LIMIT_KEYS) {
    const raw = limits[key]
    if (raw === undefined) {
      resolved[key] = DEFAULT_MACRO_LIMITS[key]
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

function extractLimitsOption(options) {
  if (options === undefined || options === null) {
    return DEFAULT_MACRO_LIMITS
  }
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw new RangeError('Macro options must be a plain object')
  }
  const merged = Object.create(null)
  let hasAny = false
  if (options.limits !== undefined && options.limits !== null) {
    if (typeof options.limits !== 'object' || Array.isArray(options.limits)) {
      throw new RangeError('Macro limits must be a plain object')
    }
    for (const key of LIMIT_KEYS) {
      if (options.limits[key] !== undefined) {
        merged[key] = options.limits[key]
        hasAny = true
      }
    }
  }
  for (const key of LIMIT_KEYS) {
    if (options[key] !== undefined) {
      merged[key] = options[key]
      hasAny = true
    }
  }
  return hasAny ? validateMacroLimits(merged) : DEFAULT_MACRO_LIMITS
}

function utf8ByteLength(text) {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 < text.length) {
        const next = text.charCodeAt(i + 1)
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes += 4
          i += 1
          continue
        }
      }
      bytes += 3
    } else {
      bytes += 3
    }
  }
  return bytes
}

function assertSafePropertyKey(key, line = 1, column = 1) {
  const prop = typeof key === 'string' ? key : safeToString(key)
  if (FORBIDDEN_PROP_NAMES.has(prop)) {
    throw new MacroRuntimeError(
      `Access to forbidden property "${prop}" is not allowed`,
      'forbidden_property',
      line,
      column,
    )
  }
  return prop
}

function isArrayIndexKey(prop) {
  if (prop.length === 0) return false
  if (prop.length > 1 && prop.charCodeAt(0) === 48) return false
  for (let i = 0; i < prop.length; i++) {
    const c = prop.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  const n = Number(prop)
  return Number.isInteger(n) && n >= 0 && n <= MAX_INT32
}

/**
 * Create a mutable, prototype-free record (`Object.create(null)`) suitable for
 * script parameter bags and host API state containers.
 */
export function createSafeBag(initial, limits) {
  const resolvedLimits = validateMacroLimits(limits)
  const bag = Object.create(null)
  SAFE_BAGS.add(bag)
  if (initial === undefined || initial === null) {
    return bag
  }
  if (typeof initial !== 'object' || Array.isArray(initial)) {
    throw new TypeError('createSafeBag initial value must be a plain object')
  }
  const keys = Object.keys(initial)
  if (keys.length > resolvedLimits.maxCollectionSize) {
    throw new MacroRuntimeError(
      `Object property limit (${resolvedLimits.maxCollectionSize}) exceeded`,
      'memory_limit',
      1,
      1,
    )
  }
  for (const key of keys) {
    assertSafePropertyKey(key, 1, 1)
    const value = initial[key]
    if (SAFE_BAGS.has(value)) {
      bag[key] = value
    } else {
      bag[key] = sanitizeHostValueInternal(value, resolvedLimits, 0, new Set(), false)
    }
  }
  return bag
}

function createHostCallable(fn, name, receiver) {
  const handle = Object.create(null)
  const bound = receiver !== undefined ? fn.bind(receiver) : fn
  CALLABLES.set(handle, {
    kind: 'host',
    name: name || fn.name || 'anonymous',
    fn: bound,
  })
  return Object.freeze(handle)
}

function createBuiltinCallable(fn, name, staticProps) {
  const handle = Object.create(null)
  if (staticProps) {
    for (const [k, v] of Object.entries(staticProps)) {
      handle[k] = v
    }
  }
  CALLABLES.set(handle, {
    kind: 'builtin',
    name,
    fn,
  })
  return Object.freeze(handle)
}

function sanitizeHostValueInternal(value, limits, depth, seen, freezeObjects, charge = null) {
  if (value === undefined || value === null) return value
  const t = typeof value
  if (t === 'boolean' || t === 'number') return value
  if (t === 'string') {
    if (value.length > limits.maxStringLength) {
      throw new MacroRuntimeError(
        `String length limit (${limits.maxStringLength}) exceeded`,
        'memory_limit',
        1,
        1,
      )
    }
    if (charge) charge(value.length * 2 + 16)
    return value
  }
  if (t === 'function') {
    return createHostCallable(value, value.name)
  }
  if (t !== 'object') {
    return undefined
  }
  if (CALLABLES.has(value)) {
    return value
  }
  if (depth > limits.maxCallDepth) {
    throw new MacroRuntimeError('Maximum nesting depth exceeded', 'memory_limit', 1, 1)
  }
  if (seen.has(value)) {
    throw new MacroRuntimeError('Circular reference in host value', 'runtime_error', 1, 1)
  }
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      if (value.length > limits.maxCollectionSize) {
        throw new MacroRuntimeError(
          `Array length limit (${limits.maxCollectionSize}) exceeded`,
          'memory_limit',
          1,
          1,
        )
      }
      if (charge) charge(64 + value.length * 16)
      const out = new Array(value.length)
      for (let i = 0; i < value.length; i++) {
        out[i] = sanitizeHostValueInternal(value[i], limits, depth + 1, seen, freezeObjects, charge)
      }
      return freezeObjects ? Object.freeze(out) : out
    }
    const keys = Object.keys(value)
    if (keys.length > limits.maxCollectionSize) {
      throw new MacroRuntimeError(
        `Object property limit (${limits.maxCollectionSize}) exceeded`,
        'memory_limit',
        1,
        1,
      )
    }
    if (charge) charge(64 + keys.length * 16)
    const out = Object.create(null)
    for (const key of keys) {
      assertSafePropertyKey(key, 1, 1)
      const entry = value[key]
      if (typeof entry === 'function') {
        out[key] = createHostCallable(entry, entry.name || key, value)
      } else {
        out[key] = sanitizeHostValueInternal(entry, limits, depth + 1, seen, freezeObjects, charge)
      }
    }
    return freezeObjects ? Object.freeze(out) : out
  } finally {
    seen.delete(value)
  }
}

/**
 * Deeply clone a host-supplied value into a prototype-free structure safe for
 * script execution, checking forbidden property names and size limits.
 */
export function sanitizeHostValue(value, limits) {
  const resolvedLimits = validateMacroLimits(limits)
  return sanitizeHostValueInternal(value, resolvedLimits, 0, new Set(), false)
}

function wrapGlobalValue(value, limits, depth, seen) {
  if (value === undefined || value === null) return value
  const t = typeof value
  if (t === 'boolean' || t === 'number') return value
  if (t === 'string') {
    if (value.length > limits.maxStringLength) {
      throw new MacroRuntimeError(
        `String length limit (${limits.maxStringLength}) exceeded`,
        'memory_limit',
        1,
        1,
      )
    }
    return value
  }
  if (t === 'function') {
    return createHostCallable(value, value.name)
  }
  if (t !== 'object') {
    return undefined
  }
  if (CALLABLES.has(value)) {
    return value
  }
  if (depth > limits.maxCallDepth) {
    throw new MacroRuntimeError('Maximum nesting depth exceeded', 'memory_limit', 1, 1)
  }
  if (SAFE_BAGS.has(value)) {
    // Preserve mutable safe bags by reference while validating their own entries.
    if (seen.has(value)) return value
    seen.add(value)
    try {
      const keys = Object.keys(value)
      if (keys.length > limits.maxCollectionSize) {
        throw new MacroRuntimeError(
          `Object property limit (${limits.maxCollectionSize}) exceeded`,
          'memory_limit',
          1,
          1,
        )
      }
      for (const key of keys) {
        assertSafePropertyKey(key, 1, 1)
        const entry = value[key]
        if (typeof entry === 'function') {
          value[key] = createHostCallable(entry, entry.name || key, value)
        } else if (entry !== null && typeof entry === 'object' && !CALLABLES.has(entry)) {
          value[key] = wrapGlobalValue(entry, limits, depth + 1, seen)
        }
      }
      return value
    } finally {
      seen.delete(value)
    }
  }
  if (seen.has(value)) {
    throw new MacroRuntimeError('Circular reference in global binding', 'runtime_error', 1, 1)
  }
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      if (value.length > limits.maxCollectionSize) {
        throw new MacroRuntimeError(
          `Array length limit (${limits.maxCollectionSize}) exceeded`,
          'memory_limit',
          1,
          1,
        )
      }
      const out = new Array(value.length)
      for (let i = 0; i < value.length; i++) {
        out[i] = wrapGlobalValue(value[i], limits, depth + 1, seen)
      }
      return Object.freeze(out)
    }
    const keys = Object.keys(value)
    if (keys.length > limits.maxCollectionSize) {
      throw new MacroRuntimeError(
        `Object property limit (${limits.maxCollectionSize}) exceeded`,
        'memory_limit',
        1,
        1,
      )
    }
    const ns = Object.create(null)
    for (const key of keys) {
      assertSafePropertyKey(key, 1, 1)
      const entry = value[key]
      if (typeof entry === 'function') {
        ns[key] = createHostCallable(entry, entry.name || key, value)
      } else {
        ns[key] = wrapGlobalValue(entry, limits, depth + 1, seen)
      }
    }
    return Object.freeze(ns)
  } finally {
    seen.delete(value)
  }
}

// ============================================================================
// Lexer
// ============================================================================

function isHexDigit(ch) {
  if (!ch) return false
  const c = ch.charCodeAt(0)
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)
}

function isDigit(ch) {
  if (!ch) return false
  const c = ch.charCodeAt(0)
  return c >= 48 && c <= 57
}

function isWhitespace(ch) {
  return (
    ch === ' ' ||
    ch === '\t' ||
    ch === '\r' ||
    ch === '\n' ||
    ch === '\v' ||
    ch === '\f' ||
    ch === '\u00a0' ||
    ch === '\ufeff'
  )
}

function tokenize(source) {
  const tokens = []
  const len = source.length
  let pos = 0
  let line = 1
  let column = 1

  const peek = (offset = 0) => (pos + offset < len ? source[pos + offset] : '')

  const advance = () => {
    const ch = source[pos++]
    if (ch === '\r') {
      if (pos < len && source[pos] === '\n') {
        pos += 1
      }
      line += 1
      column = 1
      return '\n'
    }
    if (ch === '\n') {
      line += 1
      column = 1
      return '\n'
    }
    column += 1
    return ch
  }

  while (pos < len) {
    const ch = peek()

    // Whitespace
    if (isWhitespace(ch)) {
      advance()
      continue
    }

    // Comments
    if (ch === '/' && peek(1) === '/') {
      advance()
      advance()
      while (pos < len && peek() !== '\n' && peek() !== '\r') {
        advance()
      }
      continue
    }
    if (ch === '/' && peek(1) === '*') {
      const startLine = line
      const startCol = column
      advance()
      advance()
      let closed = false
      while (pos < len) {
        if (peek() === '*' && peek(1) === '/') {
          advance()
          advance()
          closed = true
          break
        }
        advance()
      }
      if (!closed) {
        throw new MacroSyntaxError('Unterminated block comment', startLine, startCol)
      }
      continue
    }

    const startLine = line
    const startCol = column

    // Strings
    if (ch === '"' || ch === "'") {
      const quote = advance()
      let str = ''
      let closed = false
      while (pos < len) {
        const cur = peek()
        if (cur === quote) {
          advance()
          closed = true
          break
        }
        if (cur === '\n' || cur === '\r') {
          throw new MacroSyntaxError('Unterminated string literal', startLine, startCol)
        }
        if (cur === '\\') {
          const escLine = line
          const escCol = column
          advance()
          if (pos >= len) {
            throw new MacroSyntaxError('Unterminated string escape', escLine, escCol)
          }
          const esc = advance()
          switch (esc) {
            case 'n':
              str += '\n'
              break
            case 'r':
              str += '\r'
              break
            case 't':
              str += '\t'
              break
            case 'b':
              str += '\b'
              break
            case 'f':
              str += '\f'
              break
            case 'v':
              str += '\v'
              break
            case '0':
              str += '\0'
              break
            case '\\':
              str += '\\'
              break
            case "'":
              str += "'"
              break
            case '"':
              str += '"'
              break
            case '\n':
              // Line continuation
              break
            case 'x': {
              const h1 = peek()
              const h2 = peek(1)
              if (!isHexDigit(h1) || !isHexDigit(h2)) {
                throw new MacroSyntaxError('Invalid hexadecimal escape sequence', escLine, escCol)
              }
              advance()
              advance()
              str += String.fromCharCode(Number.parseInt(h1 + h2, 16))
              break
            }
            case 'u': {
              if (peek() === '{') {
                advance()
                let hex = ''
                while (pos < len && peek() !== '}') {
                  const d = peek()
                  if (!isHexDigit(d)) {
                    throw new MacroSyntaxError('Invalid Unicode escape sequence', escLine, escCol)
                  }
                  hex += advance()
                }
                if (peek() !== '}' || hex.length === 0) {
                  throw new MacroSyntaxError('Invalid Unicode escape sequence', escLine, escCol)
                }
                advance()
                const cp = Number.parseInt(hex, 16)
                if (cp > 0x10ffff) {
                  throw new MacroSyntaxError('Unicode code point out of range', escLine, escCol)
                }
                str += String.fromCodePoint(cp)
              } else {
                let hex = ''
                for (let i = 0; i < 4; i++) {
                  const d = peek()
                  if (!isHexDigit(d)) {
                    throw new MacroSyntaxError('Invalid Unicode escape sequence', escLine, escCol)
                  }
                  hex += advance()
                }
                str += String.fromCharCode(Number.parseInt(hex, 16))
              }
              break
            }
            default:
              str += esc
              break
          }
        } else {
          str += advance()
        }
      }
      if (!closed) {
        throw new MacroSyntaxError('Unterminated string literal', startLine, startCol)
      }
      tokens.push({ type: 'STRING', value: str, line: startLine, column: startCol })
      continue
    }

    // Numbers
    if (isDigit(ch) || (ch === '.' && isDigit(peek(1)))) {
      let raw = ''
      if (ch === '0' && (peek(1) === 'x' || peek(1) === 'X')) {
        raw += advance()
        raw += advance()
        let digits = 0
        while (pos < len && isHexDigit(peek())) {
          raw += advance()
          digits += 1
        }
        if (digits === 0) {
          throw new MacroSyntaxError('Invalid hexadecimal number literal', startLine, startCol)
        }
        if (pos < len && ID_CONT_RE.test(peek())) {
          throw new MacroSyntaxError('Unexpected identifier after number', line, column)
        }
        tokens.push({
          type: 'NUMBER',
          value: Number.parseInt(raw.slice(2), 16),
          line: startLine,
          column: startCol,
        })
        continue
      }
      if (ch === '0' && (peek(1) === 'b' || peek(1) === 'B')) {
        raw += advance()
        raw += advance()
        let digits = 0
        while (pos < len && (peek() === '0' || peek() === '1')) {
          raw += advance()
          digits += 1
        }
        if (digits === 0 || (pos < len && (isDigit(peek()) || ID_CONT_RE.test(peek())))) {
          throw new MacroSyntaxError('Invalid binary number literal', startLine, startCol)
        }
        tokens.push({
          type: 'NUMBER',
          value: Number.parseInt(raw.slice(2), 2),
          line: startLine,
          column: startCol,
        })
        continue
      }
      if (ch === '0' && (peek(1) === 'o' || peek(1) === 'O')) {
        raw += advance()
        raw += advance()
        let digits = 0
        while (pos < len && peek() >= '0' && peek() <= '7') {
          raw += advance()
          digits += 1
        }
        if (digits === 0 || (pos < len && (isDigit(peek()) || ID_CONT_RE.test(peek())))) {
          throw new MacroSyntaxError('Invalid octal number literal', startLine, startCol)
        }
        tokens.push({
          type: 'NUMBER',
          value: Number.parseInt(raw.slice(2), 8),
          line: startLine,
          column: startCol,
        })
        continue
      }
      while (pos < len && isDigit(peek())) {
        raw += advance()
      }
      if (peek() === '.') {
        raw += advance()
        while (pos < len && isDigit(peek())) {
          raw += advance()
        }
      }
      if (peek() === 'e' || peek() === 'E') {
        raw += advance()
        if (peek() === '+' || peek() === '-') {
          raw += advance()
        }
        let expDigits = 0
        while (pos < len && isDigit(peek())) {
          raw += advance()
          expDigits += 1
        }
        if (expDigits === 0) {
          throw new MacroSyntaxError('Invalid exponent in number literal', startLine, startCol)
        }
      }
      if (pos < len && ID_START_RE.test(peek())) {
        throw new MacroSyntaxError('Unexpected identifier immediately after number', line, column)
      }
      const numVal = Number(raw)
      if (!Number.isFinite(numVal)) {
        throw new MacroSyntaxError('Number literal overflows finite range', startLine, startCol)
      }
      tokens.push({ type: 'NUMBER', value: numVal, line: startLine, column: startCol })
      continue
    }

    // Identifiers and keywords
    if (ID_START_RE.test(ch)) {
      let ident = ''
      while (pos < len && ID_CONT_RE.test(peek())) {
        ident += advance()
      }
      if (SUPPORTED_KEYWORDS.has(ident)) {
        tokens.push({ type: ident, value: ident, line: startLine, column: startCol })
      } else if (REJECTED_KEYWORDS.has(ident)) {
        tokens.push({ type: 'REJECTED_KW', value: ident, line: startLine, column: startCol })
      } else {
        tokens.push({ type: 'IDENT', value: ident, line: startLine, column: startCol })
      }
      continue
    }

    // 3-character operators
    const three = source.slice(pos, pos + 3)
    if (three === '===' || three === '!==') {
      advance()
      advance()
      advance()
      tokens.push({ type: three, value: three, line: startLine, column: startCol })
      continue
    }

    // 2-character operators
    const two = source.slice(pos, pos + 2)
    if (
      two === '==' ||
      two === '!=' ||
      two === '<=' ||
      two === '>=' ||
      two === '&&' ||
      two === '||' ||
      two === '??' ||
      two === '++' ||
      two === '--' ||
      two === '**' ||
      two === '+=' ||
      two === '-=' ||
      two === '*=' ||
      two === '/=' ||
      two === '%=' ||
      two === '=>'
    ) {
      advance()
      advance()
      tokens.push({ type: two, value: two, line: startLine, column: startCol })
      continue
    }

    // 1-character operators and punctuators
    if ('+-*/%!<>?:;,=.(){}[]'.includes(ch)) {
      advance()
      tokens.push({ type: ch, value: ch, line: startLine, column: startCol })
      continue
    }

    if (ch === '`') {
      throw new MacroSyntaxError('Template literals are not supported', startLine, startCol)
    }

    throw new MacroSyntaxError(`Unexpected character "${ch}"`, startLine, startCol)
  }

  tokens.push({ type: 'EOF', value: '', line, column })
  return tokens
}

// ============================================================================
// Recursive-Descent Parser
// ============================================================================

class Parser {
  constructor(tokens) {
    this.tokens = tokens
    this.pos = 0
    this.prev = null
    this.depth = 0
    this.loopDepth = 0
    this.switchDepth = 0
  }

  peek(offset = 0) {
    const idx = this.pos + offset
    return idx < this.tokens.length ? this.tokens[idx] : this.tokens[this.tokens.length - 1]
  }

  next() {
    const tok = this.peek()
    if (tok.type !== 'EOF') {
      this.pos += 1
      this.prev = tok
    }
    return tok
  }

  check(type) {
    return this.peek().type === type
  }

  match(type) {
    if (this.check(type)) {
      return this.next()
    }
    return null
  }

  expect(type, message) {
    const tok = this.peek()
    if (tok.type === type) {
      return this.next()
    }
    if (tok.type === 'REJECTED_KW') {
      throw new MacroSyntaxError(
        `Unsupported keyword "${tok.value}" is not allowed in macro scripts`,
        tok.line,
        tok.column,
      )
    }
    throw new MacroSyntaxError(
      message || `Expected "${type}", got "${tok.value || tok.type}"`,
      tok.line,
      tok.column,
    )
  }

  enterDepth(tok) {
    this.depth += 1
    if (this.depth > MAX_PARSE_DEPTH) {
      throw new MacroSyntaxError('Maximum syntax nesting depth exceeded', tok.line, tok.column)
    }
  }

  exitDepth() {
    this.depth -= 1
  }

  consumeSemicolon() {
    if (this.match(';')) return
    const tok = this.peek()
    if (tok.type === 'EOF' || tok.type === '}') return
    if (this.prev && tok.line > this.prev.line) return
    if (tok.type === 'REJECTED_KW') {
      throw new MacroSyntaxError(
        `Unsupported keyword "${tok.value}" is not allowed in macro scripts`,
        tok.line,
        tok.column,
      )
    }
    throw new MacroSyntaxError(
      `Expected ";" before "${tok.value || tok.type}"`,
      tok.line,
      tok.column,
    )
  }

  assertAllowedIdentifier(tok) {
    if (tok.type === 'REJECTED_KW') {
      throw new MacroSyntaxError(
        `Unsupported keyword "${tok.value}" is not allowed in macro scripts`,
        tok.line,
        tok.column,
      )
    }
    if (tok.type !== 'IDENT') {
      throw new MacroSyntaxError(
        `Expected identifier, got "${tok.value || tok.type}"`,
        tok.line,
        tok.column,
      )
    }
    if (REJECTED_IDENTIFIERS.has(tok.value)) {
      throw new MacroSyntaxError(
        `Use of "${tok.value}" is not allowed in macro scripts`,
        tok.line,
        tok.column,
      )
    }
    return tok
  }

  parseProgram() {
    const body = []
    const first = this.peek()
    while (!this.check('EOF')) {
      body.push(this.parseStatement())
    }
    return {
      type: 'Program',
      body,
      line: first.line,
      column: first.column,
    }
  }

  parseStatement() {
    const tok = this.peek()
    this.enterDepth(tok)
    try {
      if (tok.type === 'REJECTED_KW') {
        throw new MacroSyntaxError(
          `Unsupported keyword "${tok.value}" is not allowed in macro scripts`,
          tok.line,
          tok.column,
        )
      }
      switch (tok.type) {
        case ';':
          this.next()
          return { type: 'EmptyStatement', line: tok.line, column: tok.column }
        case '{':
          return this.parseBlockStatement()
        case 'var':
        case 'let':
        case 'const':
          return this.parseVariableDeclaration(true)
        case 'if':
          return this.parseIfStatement()
        case 'while':
          return this.parseWhileStatement()
        case 'do':
          return this.parseDoWhileStatement()
        case 'for':
          return this.parseForStatement()
        case 'switch':
          return this.parseSwitchStatement()
        case 'break':
          return this.parseBreakStatement()
        case 'continue':
          return this.parseContinueStatement()
        case 'return':
          return this.parseReturnStatement()
        case 'function':
          return this.parseFunctionDeclaration()
        default: {
          const expr = this.parseExpression()
          this.consumeSemicolon()
          return {
            type: 'ExpressionStatement',
            expression: expr,
            line: expr.line,
            column: expr.column,
          }
        }
      }
    } finally {
      this.exitDepth()
    }
  }

  parseBlockStatement() {
    const open = this.expect('{')
    const body = []
    while (!this.check('}') && !this.check('EOF')) {
      body.push(this.parseStatement())
    }
    this.expect('}', 'Unterminated block statement, expected "}"')
    return {
      type: 'BlockStatement',
      body,
      line: open.line,
      column: open.column,
    }
  }

  parseVariableDeclaration(requireSemi) {
    const kw = this.next()
    const kind = kw.type
    const declarations = []
    while (true) {
      const idTok = this.assertAllowedIdentifier(this.peek())
      this.next()
      let init = null
      if (this.match('=')) {
        init = this.parseAssignmentExpression()
      } else if (kind === 'const') {
        throw new MacroSyntaxError(
          `Missing initializer in const declaration "${idTok.value}"`,
          idTok.line,
          idTok.column,
        )
      }
      declarations.push({
        type: 'VariableDeclarator',
        id: { type: 'Identifier', name: idTok.value, line: idTok.line, column: idTok.column },
        init,
        line: idTok.line,
        column: idTok.column,
      })
      if (!this.match(',')) break
    }
    if (requireSemi) {
      this.consumeSemicolon()
    }
    return {
      type: 'VariableDeclaration',
      kind,
      declarations,
      line: kw.line,
      column: kw.column,
    }
  }

  parseSingleStatement() {
    const tok = this.peek()
    if (tok.type === 'let' || tok.type === 'const' || tok.type === 'function') {
      throw new MacroSyntaxError(
        `Lexical declaration "${tok.type}" cannot appear in a single-statement context`,
        tok.line,
        tok.column,
      )
    }
    return this.parseStatement()
  }

  parseIfStatement() {
    const kw = this.expect('if')
    this.expect('(', 'Expected "(" after "if"')
    const test = this.parseExpression()
    this.expect(')', 'Expected ")" after if condition')
    const consequent = this.parseSingleStatement()
    let alternate = null
    if (this.match('else')) {
      alternate = this.parseSingleStatement()
    }
    return {
      type: 'IfStatement',
      test,
      consequent,
      alternate,
      line: kw.line,
      column: kw.column,
    }
  }

  parseWhileStatement() {
    const kw = this.expect('while')
    this.expect('(', 'Expected "(" after "while"')
    const test = this.parseExpression()
    this.expect(')', 'Expected ")" after while condition')
    this.loopDepth += 1
    let body
    try {
      body = this.parseSingleStatement()
    } finally {
      this.loopDepth -= 1
    }
    return {
      type: 'WhileStatement',
      test,
      body,
      line: kw.line,
      column: kw.column,
    }
  }

  parseDoWhileStatement() {
    const kw = this.expect('do')
    this.loopDepth += 1
    let body
    try {
      body = this.parseSingleStatement()
    } finally {
      this.loopDepth -= 1
    }
    this.expect('while', 'Expected "while" after do-statement body')
    this.expect('(', 'Expected "(" after "while"')
    const test = this.parseExpression()
    this.expect(')', 'Expected ")" after do-while condition')
    this.consumeSemicolon()
    return {
      type: 'DoWhileStatement',
      body,
      test,
      line: kw.line,
      column: kw.column,
    }
  }

  parseForStatement() {
    const kw = this.expect('for')
    this.expect('(', 'Expected "(" after "for"')

    // Detect `for (var|let|const id of expr)`
    const nextTok = this.peek()
    if (
      (nextTok.type === 'var' || nextTok.type === 'let' || nextTok.type === 'const') &&
      this.peek(1).type === 'IDENT' &&
      this.peek(2).type === 'IDENT' &&
      this.peek(2).value === 'of'
    ) {
      const kindTok = this.next()
      const idTok = this.assertAllowedIdentifier(this.next())
      this.next() // consume 'of'
      const right = this.parseExpression()
      this.expect(')', 'Expected ")" after for-of iterable')
      this.loopDepth += 1
      let body
      try {
        body = this.parseSingleStatement()
      } finally {
        this.loopDepth -= 1
      }
      return {
        type: 'ForOfStatement',
        kind: kindTok.type,
        id: { type: 'Identifier', name: idTok.value, line: idTok.line, column: idTok.column },
        right,
        body,
        line: kw.line,
        column: kw.column,
      }
    }

    // Detect `for (id of expr)`
    if (nextTok.type === 'IDENT' && this.peek(1).type === 'IDENT' && this.peek(1).value === 'of') {
      const idTok = this.assertAllowedIdentifier(this.next())
      this.next() // consume 'of'
      const right = this.parseExpression()
      this.expect(')', 'Expected ")" after for-of iterable')
      this.loopDepth += 1
      let body
      try {
        body = this.parseSingleStatement()
      } finally {
        this.loopDepth -= 1
      }
      return {
        type: 'ForOfStatement',
        kind: null,
        id: { type: 'Identifier', name: idTok.value, line: idTok.line, column: idTok.column },
        right,
        body,
        line: kw.line,
        column: kw.column,
      }
    }

    // Classic `for (init; test; update)`
    let init = null
    if (!this.check(';')) {
      if (this.check('var') || this.check('let') || this.check('const')) {
        init = this.parseVariableDeclaration(false)
      } else {
        init = this.parseExpression()
      }
    }
    this.expect(';', 'Expected ";" after for-loop initializer')

    let test = null
    if (!this.check(';')) {
      test = this.parseExpression()
    }
    this.expect(';', 'Expected ";" after for-loop condition')

    let update = null
    if (!this.check(')')) {
      update = this.parseExpression()
    }
    this.expect(')', 'Expected ")" after for-loop header')

    this.loopDepth += 1
    let body
    try {
      body = this.parseSingleStatement()
    } finally {
      this.loopDepth -= 1
    }

    return {
      type: 'ForStatement',
      init,
      test,
      update,
      body,
      line: kw.line,
      column: kw.column,
    }
  }

  parseSwitchStatement() {
    const kw = this.expect('switch')
    this.expect('(', 'Expected "(" after "switch"')
    const discriminant = this.parseExpression()
    this.expect(')', 'Expected ")" after switch expression')
    this.expect('{', 'Expected "{" to open switch body')
    const cases = []
    let hasDefault = false
    this.switchDepth += 1
    try {
      while (!this.check('}') && !this.check('EOF')) {
        if (this.check('case')) {
          const caseTok = this.next()
          const test = this.parseExpression()
          this.expect(':', 'Expected ":" after case value')
          const consequent = []
          while (
            !this.check('case') &&
            !this.check('default') &&
            !this.check('}') &&
            !this.check('EOF')
          ) {
            consequent.push(this.parseStatement())
          }
          cases.push({ test, consequent, line: caseTok.line, column: caseTok.column })
        } else if (this.check('default')) {
          const defTok = this.next()
          if (hasDefault) {
            throw new MacroSyntaxError(
              'More than one default clause in switch statement',
              defTok.line,
              defTok.column,
            )
          }
          hasDefault = true
          this.expect(':', 'Expected ":" after "default"')
          const consequent = []
          while (
            !this.check('case') &&
            !this.check('default') &&
            !this.check('}') &&
            !this.check('EOF')
          ) {
            consequent.push(this.parseStatement())
          }
          cases.push({ test: null, consequent, line: defTok.line, column: defTok.column })
        } else {
          const bad = this.peek()
          throw new MacroSyntaxError(
            `Expected "case" or "default" inside switch, got "${bad.value || bad.type}"`,
            bad.line,
            bad.column,
          )
        }
      }
    } finally {
      this.switchDepth -= 1
    }
    this.expect('}', 'Unterminated switch statement, expected "}"')
    return {
      type: 'SwitchStatement',
      discriminant,
      cases,
      line: kw.line,
      column: kw.column,
    }
  }

  parseBreakStatement() {
    const kw = this.expect('break')
    if (this.loopDepth === 0 && this.switchDepth === 0) {
      throw new MacroSyntaxError(
        'Illegal "break" statement outside of loop or switch',
        kw.line,
        kw.column,
      )
    }
    this.consumeSemicolon()
    return { type: 'BreakStatement', line: kw.line, column: kw.column }
  }

  parseContinueStatement() {
    const kw = this.expect('continue')
    if (this.loopDepth === 0) {
      throw new MacroSyntaxError('Illegal "continue" statement outside of loop', kw.line, kw.column)
    }
    this.consumeSemicolon()
    return { type: 'ContinueStatement', line: kw.line, column: kw.column }
  }

  parseReturnStatement() {
    const kw = this.expect('return')
    let argument = null
    const nextTok = this.peek()
    if (
      nextTok.type !== ';' &&
      nextTok.type !== '}' &&
      nextTok.type !== 'EOF' &&
      nextTok.line === kw.line
    ) {
      argument = this.parseExpression()
    }
    this.consumeSemicolon()
    return {
      type: 'ReturnStatement',
      argument,
      line: kw.line,
      column: kw.column,
    }
  }

  parseParameterList() {
    this.expect('(', 'Expected "(" for parameter list')
    const params = []
    const seen = new Set()
    if (!this.check(')')) {
      while (true) {
        const paramTok = this.assertAllowedIdentifier(this.peek())
        if (FORBIDDEN_PROP_NAMES.has(paramTok.value)) {
          throw new MacroSyntaxError(
            `Parameter name "${paramTok.value}" is not allowed`,
            paramTok.line,
            paramTok.column,
          )
        }
        if (seen.has(paramTok.value)) {
          throw new MacroSyntaxError(
            `Duplicate parameter name "${paramTok.value}"`,
            paramTok.line,
            paramTok.column,
          )
        }
        seen.add(paramTok.value)
        this.next()
        params.push({
          type: 'Identifier',
          name: paramTok.value,
          line: paramTok.line,
          column: paramTok.column,
        })
        if (!this.match(',')) break
        if (this.check(')')) break
      }
    }
    this.expect(')', 'Expected ")" after parameter list')
    return params
  }

  parseFunctionDeclaration() {
    const kw = this.expect('function')
    const idTok = this.assertAllowedIdentifier(this.peek())
    this.next()
    const params = this.parseParameterList()
    const savedLoop = this.loopDepth
    const savedSwitch = this.switchDepth
    this.loopDepth = 0
    this.switchDepth = 0
    let body
    try {
      body = this.parseBlockStatement()
    } finally {
      this.loopDepth = savedLoop
      this.switchDepth = savedSwitch
    }
    return {
      type: 'FunctionDeclaration',
      id: { type: 'Identifier', name: idTok.value, line: idTok.line, column: idTok.column },
      params,
      body,
      line: kw.line,
      column: kw.column,
    }
  }

  parseFunctionExpression() {
    const kw = this.expect('function')
    let id = null
    if (this.check('IDENT')) {
      const idTok = this.assertAllowedIdentifier(this.next())
      id = { type: 'Identifier', name: idTok.value, line: idTok.line, column: idTok.column }
    }
    const params = this.parseParameterList()
    const savedLoop = this.loopDepth
    const savedSwitch = this.switchDepth
    this.loopDepth = 0
    this.switchDepth = 0
    let body
    try {
      body = this.parseBlockStatement()
    } finally {
      this.loopDepth = savedLoop
      this.switchDepth = savedSwitch
    }
    return {
      type: 'FunctionExpression',
      id,
      params,
      body,
      line: kw.line,
      column: kw.column,
    }
  }

  parseExpression() {
    return this.parseAssignmentExpression()
  }

  isArrowParamList() {
    if (!this.check('(')) return false
    let i = this.pos + 1
    if (this.tokens[i]?.type === ')') {
      const closeTok = this.tokens[i]
      const arrowTok = this.tokens[i + 1]
      return arrowTok?.type === '=>' && arrowTok.line === closeTok.line
    }
    while (i < this.tokens.length) {
      if (this.tokens[i]?.type !== 'IDENT') return false
      i += 1
      if (this.tokens[i]?.type === ',') {
        i += 1
        if (this.tokens[i]?.type === ')') {
          const closeTok = this.tokens[i]
          const arrowTok = this.tokens[i + 1]
          return arrowTok?.type === '=>' && arrowTok.line === closeTok.line
        }
        continue
      }
      if (this.tokens[i]?.type === ')') {
        const closeTok = this.tokens[i]
        const arrowTok = this.tokens[i + 1]
        return arrowTok?.type === '=>' && arrowTok.line === closeTok.line
      }
      return false
    }
    return false
  }

  parseArrowFunction(params, startLine, startCol) {
    this.expect('=>')
    const savedLoop = this.loopDepth
    const savedSwitch = this.switchDepth
    this.loopDepth = 0
    this.switchDepth = 0
    let body
    let expressionBody = false
    try {
      if (this.check('{')) {
        body = this.parseBlockStatement()
      } else {
        expressionBody = true
        body = this.parseAssignmentExpression()
      }
    } finally {
      this.loopDepth = savedLoop
      this.switchDepth = savedSwitch
    }
    return {
      type: 'ArrowFunctionExpression',
      params,
      body,
      expressionBody,
      line: startLine,
      column: startCol,
    }
  }

  parseAssignmentExpression() {
    const tok = this.peek()
    this.enterDepth(tok)
    try {
      // Single-parameter arrow function: `x => ...`
      if (tok.type === 'IDENT' && this.peek(1).type === '=>' && this.peek(1).line === tok.line) {
        const idTok = this.assertAllowedIdentifier(this.next())
        if (FORBIDDEN_PROP_NAMES.has(idTok.value)) {
          throw new MacroSyntaxError(
            `Parameter name "${idTok.value}" is not allowed`,
            idTok.line,
            idTok.column,
          )
        }
        return this.parseArrowFunction(
          [{ type: 'Identifier', name: idTok.value, line: idTok.line, column: idTok.column }],
          idTok.line,
          idTok.column,
        )
      }

      // Multi-parameter / zero-parameter arrow function: `(a, b) => ...`
      if (this.isArrowParamList()) {
        const params = this.parseParameterList()
        return this.parseArrowFunction(params, tok.line, tok.column)
      }

      const left = this.parseConditionalExpression()
      const opTok = this.peek()
      if (ASSIGN_OPS.has(opTok.type)) {
        if (left.type !== 'Identifier' && left.type !== 'MemberExpression') {
          throw new MacroSyntaxError('Invalid left-hand side in assignment', left.line, left.column)
        }
        this.next()
        const right = this.parseAssignmentExpression()
        return {
          type: 'AssignmentExpression',
          operator: opTok.type,
          left,
          right,
          line: opTok.line,
          column: opTok.column,
        }
      }
      return left
    } finally {
      this.exitDepth()
    }
  }

  parseConditionalExpression() {
    const test = this.parseNullishExpression()
    if (this.match('?')) {
      const consequent = this.parseAssignmentExpression()
      this.expect(':', 'Expected ":" in conditional expression')
      const alternate = this.parseAssignmentExpression()
      return {
        type: 'ConditionalExpression',
        test,
        consequent,
        alternate,
        line: test.line,
        column: test.column,
      }
    }
    return test
  }

  parseNullishExpression() {
    let left = this.parseLogicalOrExpression()
    let chainCount = 0
    try {
      while (this.check('??')) {
        const op = this.next()
        this.enterDepth(op)
        chainCount += 1
        const right = this.parseLogicalOrExpression()
        left = {
          type: 'LogicalExpression',
          operator: op.type,
          left,
          right,
          line: op.line,
          column: op.column,
        }
      }
      return left
    } finally {
      this.depth -= chainCount
    }
  }

  parseLogicalOrExpression() {
    let left = this.parseLogicalAndExpression()
    let chainCount = 0
    try {
      while (this.check('||')) {
        const op = this.next()
        this.enterDepth(op)
        chainCount += 1
        const right = this.parseLogicalAndExpression()
        left = {
          type: 'LogicalExpression',
          operator: op.type,
          left,
          right,
          line: op.line,
          column: op.column,
        }
      }
      return left
    } finally {
      this.depth -= chainCount
    }
  }

  parseLogicalAndExpression() {
    let left = this.parseEqualityExpression()
    let chainCount = 0
    try {
      while (this.check('&&')) {
        const op = this.next()
        this.enterDepth(op)
        chainCount += 1
        const right = this.parseEqualityExpression()
        left = {
          type: 'LogicalExpression',
          operator: op.type,
          left,
          right,
          line: op.line,
          column: op.column,
        }
      }
      return left
    } finally {
      this.depth -= chainCount
    }
  }

  parseEqualityExpression() {
    let left = this.parseRelationalExpression()
    let chainCount = 0
    try {
      while (this.check('==') || this.check('!=') || this.check('===') || this.check('!==')) {
        const op = this.next()
        this.enterDepth(op)
        chainCount += 1
        const right = this.parseRelationalExpression()
        left = {
          type: 'BinaryExpression',
          operator: op.type,
          left,
          right,
          line: op.line,
          column: op.column,
        }
      }
      return left
    } finally {
      this.depth -= chainCount
    }
  }

  parseRelationalExpression() {
    let left = this.parseAdditiveExpression()
    let chainCount = 0
    try {
      while (this.check('<') || this.check('<=') || this.check('>') || this.check('>=')) {
        const op = this.next()
        this.enterDepth(op)
        chainCount += 1
        const right = this.parseAdditiveExpression()
        left = {
          type: 'BinaryExpression',
          operator: op.type,
          left,
          right,
          line: op.line,
          column: op.column,
        }
      }
      return left
    } finally {
      this.depth -= chainCount
    }
  }

  parseAdditiveExpression() {
    let left = this.parseMultiplicativeExpression()
    let chainCount = 0
    try {
      while (this.check('+') || this.check('-')) {
        const op = this.next()
        this.enterDepth(op)
        chainCount += 1
        const right = this.parseMultiplicativeExpression()
        left = {
          type: 'BinaryExpression',
          operator: op.type,
          left,
          right,
          line: op.line,
          column: op.column,
        }
      }
      return left
    } finally {
      this.depth -= chainCount
    }
  }

  parseMultiplicativeExpression() {
    let left = this.parseExponentiationExpression()
    let chainCount = 0
    try {
      while (this.check('*') || this.check('/') || this.check('%')) {
        const op = this.next()
        this.enterDepth(op)
        chainCount += 1
        const right = this.parseExponentiationExpression()
        left = {
          type: 'BinaryExpression',
          operator: op.type,
          left,
          right,
          line: op.line,
          column: op.column,
        }
      }
      return left
    } finally {
      this.depth -= chainCount
    }
  }

  parseExponentiationExpression() {
    const left = this.parseUnaryExpression()
    if (this.check('**')) {
      if (left.type === 'UnaryExpression') {
        throw new MacroSyntaxError(
          'Unary operator used immediately before exponentiation expression; add parentheses',
          left.line,
          left.column,
        )
      }
      const op = this.next()
      this.enterDepth(op)
      try {
        const right = this.parseExponentiationExpression()
        return {
          type: 'BinaryExpression',
          operator: '**',
          left,
          right,
          line: op.line,
          column: op.column,
        }
      } finally {
        this.exitDepth()
      }
    }
    return left
  }

  parseUnaryExpression() {
    const tok = this.peek()
    if (tok.type === '!' || tok.type === '-' || tok.type === '+' || tok.type === 'typeof') {
      this.next()
      this.enterDepth(tok)
      try {
        const argument = this.parseUnaryExpression()
        return {
          type: 'UnaryExpression',
          operator: tok.type,
          argument,
          line: tok.line,
          column: tok.column,
        }
      } finally {
        this.exitDepth()
      }
    }
    if (tok.type === '++' || tok.type === '--') {
      this.next()
      this.enterDepth(tok)
      try {
        const argument = this.parseUnaryExpression()
        if (argument.type !== 'Identifier' && argument.type !== 'MemberExpression') {
          throw new MacroSyntaxError(
            'Invalid left-hand side expression in prefix operation',
            argument.line,
            argument.column,
          )
        }
        return {
          type: 'UpdateExpression',
          operator: tok.type,
          prefix: true,
          argument,
          line: tok.line,
          column: tok.column,
        }
      } finally {
        this.exitDepth()
      }
    }
    return this.parsePostfixExpression()
  }

  parsePostfixExpression() {
    const expr = this.parseCallAndMemberExpression()
    const nextTok = this.peek()
    if (
      (nextTok.type === '++' || nextTok.type === '--') &&
      this.prev &&
      nextTok.line === this.prev.line
    ) {
      if (expr.type !== 'Identifier' && expr.type !== 'MemberExpression') {
        throw new MacroSyntaxError(
          'Invalid left-hand side expression in postfix operation',
          expr.line,
          expr.column,
        )
      }
      this.next()
      return {
        type: 'UpdateExpression',
        operator: nextTok.type,
        prefix: false,
        argument: expr,
        line: nextTok.line,
        column: nextTok.column,
      }
    }
    return expr
  }

  parseCallAndMemberExpression() {
    let expr = this.parsePrimaryExpression()
    let chainCount = 0
    try {
      while (true) {
        if (this.match('.')) {
          const propTok = this.peek()
          this.enterDepth(propTok)
          chainCount += 1
          if (
            propTok.type !== 'IDENT' &&
            !SUPPORTED_KEYWORDS.has(propTok.type) &&
            propTok.type !== 'REJECTED_KW'
          ) {
            throw new MacroSyntaxError(
              `Expected property name after ".", got "${propTok.value || propTok.type}"`,
              propTok.line,
              propTok.column,
            )
          }
          this.next()
          expr = {
            type: 'MemberExpression',
            object: expr,
            property: {
              type: 'Identifier',
              name: propTok.value,
              line: propTok.line,
              column: propTok.column,
            },
            computed: false,
            line: propTok.line,
            column: propTok.column,
          }
        } else if (this.match('[')) {
          const openTok = this.prev
          this.enterDepth(openTok)
          chainCount += 1
          const propExpr = this.parseExpression()
          this.expect(']', 'Expected "]" after computed property')
          expr = {
            type: 'MemberExpression',
            object: expr,
            property: propExpr,
            computed: true,
            line: openTok.line,
            column: openTok.column,
          }
        } else if (this.match('(')) {
          const openTok = this.prev
          this.enterDepth(openTok)
          chainCount += 1
          const args = []
          if (!this.check(')')) {
            while (true) {
              args.push(this.parseAssignmentExpression())
              if (!this.match(',')) break
              if (this.check(')')) break
            }
          }
          this.expect(')', 'Expected ")" after argument list')
          expr = {
            type: 'CallExpression',
            callee: expr,
            arguments: args,
            line: openTok.line,
            column: openTok.column,
          }
        } else {
          break
        }
      }
      return expr
    } finally {
      this.depth -= chainCount
    }
  }

  parsePrimaryExpression() {
    const tok = this.peek()
    if (tok.type === 'REJECTED_KW') {
      throw new MacroSyntaxError(
        `Unsupported keyword "${tok.value}" is not allowed in macro scripts`,
        tok.line,
        tok.column,
      )
    }
    switch (tok.type) {
      case 'NUMBER':
        this.next()
        return { type: 'Literal', value: tok.value, line: tok.line, column: tok.column }
      case 'STRING':
        this.next()
        return { type: 'Literal', value: tok.value, line: tok.line, column: tok.column }
      case 'true':
        this.next()
        return { type: 'Literal', value: true, line: tok.line, column: tok.column }
      case 'false':
        this.next()
        return { type: 'Literal', value: false, line: tok.line, column: tok.column }
      case 'null':
        this.next()
        return { type: 'Literal', value: null, line: tok.line, column: tok.column }
      case 'undefined':
        this.next()
        return { type: 'Literal', value: undefined, line: tok.line, column: tok.column }
      case 'IDENT': {
        const idTok = this.assertAllowedIdentifier(this.next())
        return { type: 'Identifier', name: idTok.value, line: idTok.line, column: idTok.column }
      }
      case '(': {
        this.next()
        const inner = this.parseExpression()
        this.expect(')', 'Expected ")" after expression')
        return inner
      }
      case '[':
        return this.parseArrayExpression()
      case '{':
        return this.parseObjectExpression()
      case 'function':
        return this.parseFunctionExpression()
      default:
        throw new MacroSyntaxError(
          `Unexpected token "${tok.value || tok.type}"`,
          tok.line,
          tok.column,
        )
    }
  }

  parseArrayExpression() {
    const open = this.expect('[')
    const elements = []
    if (!this.check(']')) {
      while (true) {
        if (this.check(',')) {
          const commaTok = this.peek()
          throw new MacroSyntaxError(
            'Sparse array holes are not supported',
            commaTok.line,
            commaTok.column,
          )
        }
        elements.push(this.parseAssignmentExpression())
        if (!this.match(',')) break
        if (this.check(']')) break
      }
    }
    this.expect(']', 'Unterminated array literal, expected "]"')
    return {
      type: 'ArrayExpression',
      elements,
      line: open.line,
      column: open.column,
    }
  }

  parseObjectExpression() {
    const open = this.expect('{')
    const properties = []
    if (!this.check('}')) {
      while (true) {
        const propTok = this.peek()
        let key
        let computed = false
        let value
        if (this.match('[')) {
          computed = true
          key = this.parseAssignmentExpression()
          this.expect(']', 'Expected "]" after computed property name')
          this.expect(':', 'Expected ":" after computed property name')
          value = this.parseAssignmentExpression()
        } else if (propTok.type === 'STRING' || propTok.type === 'NUMBER') {
          this.next()
          key = {
            type: 'Literal',
            value: String(propTok.value),
            line: propTok.line,
            column: propTok.column,
          }
          this.expect(':', 'Expected ":" after property key')
          value = this.parseAssignmentExpression()
        } else if (
          propTok.type === 'IDENT' ||
          SUPPORTED_KEYWORDS.has(propTok.type) ||
          propTok.type === 'REJECTED_KW'
        ) {
          this.next()
          key = {
            type: 'Literal',
            value: propTok.value,
            line: propTok.line,
            column: propTok.column,
          }
          if (this.match(':')) {
            value = this.parseAssignmentExpression()
          } else {
            // Shorthand property: `{ x }`
            this.assertAllowedIdentifier(propTok)
            value = {
              type: 'Identifier',
              name: propTok.value,
              line: propTok.line,
              column: propTok.column,
            }
          }
        } else {
          throw new MacroSyntaxError(
            `Expected property name in object literal, got "${propTok.value || propTok.type}"`,
            propTok.line,
            propTok.column,
          )
        }
        properties.push({
          key,
          value,
          computed,
          line: propTok.line,
          column: propTok.column,
        })
        if (!this.match(',')) break
        if (this.check('}')) break
      }
    }
    this.expect('}', 'Unterminated object literal, expected "}"')
    return {
      type: 'ObjectExpression',
      properties,
      line: open.line,
      column: open.column,
    }
  }
}

/**
 * Parse a macro script into an AST without executing it.
 */
export function parseMacroScript(source, options) {
  const limits = extractLimitsOption(options)
  if (typeof source !== 'string') {
    return {
      ok: false,
      code: 'syntax_error',
      error: 'Macro script source must be a string',
      line: 1,
      column: 1,
    }
  }
  const byteLength = utf8ByteLength(source)
  if (byteLength > limits.maxScriptBytes) {
    return {
      ok: false,
      code: 'script_too_large',
      error: `Script size (${byteLength} bytes) exceeds limit (${limits.maxScriptBytes} bytes)`,
      line: 1,
      column: 1,
    }
  }
  const badInvisible = findDisallowedInvisibleChar(source)
  if (badInvisible) {
    return {
      ok: false,
      code: 'syntax_error',
      error: `Disallowed invisible or bidirectional control character (U+${badInvisible.hex}) in macro script`,
      line: badInvisible.line,
      column: badInvisible.column,
    }
  }
  try {
    const tokens = tokenize(source)
    const parser = new Parser(tokens)
    const ast = parser.parseProgram()
    return { ok: true, ast }
  } catch (err) {
    if (err instanceof MacroSyntaxError) {
      return {
        ok: false,
        code: err.code,
        error: err.message,
        line: err.line,
        column: err.column,
      }
    }
    return {
      ok: false,
      code: 'syntax_error',
      error: err instanceof Error ? err.message : String(err),
      line: 1,
      column: 1,
    }
  }
}

/**
 * Validate macro script syntax and size limits without executing it.
 */
export function validateMacroSyntax(source, options) {
  const parsed = parseMacroScript(source, options)
  if (parsed.ok) {
    return { ok: true }
  }
  return {
    ok: false,
    code: parsed.code,
    error: parsed.error,
    line: parsed.line,
    column: parsed.column,
  }
}

// ============================================================================
// Runtime Coercion, Equality, and Safe Built-ins
// ============================================================================

function safeToString(value, limits, node, seen) {
  if (typeof value === 'string') return value
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (CALLABLES.has(value)) return '[Function]'
  if (Array.isArray(value)) {
    const visited = seen || new Set()
    if (visited.has(value)) return ''
    visited.add(value)
    try {
      let out = ''
      for (let i = 0; i < value.length; i++) {
        if (i > 0) out += ','
        const item = value[i]
        const piece =
          item === null || item === undefined ? '' : safeToString(item, limits, node, visited)
        if (limits && out.length + piece.length > limits.maxStringLength) {
          throw new MacroRuntimeError(
            `String length limit (${limits.maxStringLength}) exceeded`,
            'memory_limit',
            node ? node.line : 1,
            node ? node.column : 1,
          )
        }
        out += piece
      }
      return out
    } finally {
      visited.delete(value)
    }
  }
  return '[object Object]'
}

function safeToNumber(value) {
  if (typeof value === 'number') return value
  if (value === undefined) return Number.NaN
  if (value === null) return 0
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string') return Number(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return 0
    if (value.length === 1) return safeToNumber(value[0])
    return Number.NaN
  }
  return Number.NaN
}

function safeTypeof(value) {
  if (value === null) return 'object'
  if (CALLABLES.has(value)) return 'function'
  return typeof value
}

function abstractEquals(a, b) {
  if (typeof a === typeof b) return a === b
  if ((a === null && b === undefined) || (a === undefined && b === null)) return true
  if (typeof a === 'number' && typeof b === 'string') return a === safeToNumber(b)
  if (typeof a === 'string' && typeof b === 'number') return safeToNumber(a) === b
  if (typeof a === 'boolean') return abstractEquals(a ? 1 : 0, b)
  if (typeof b === 'boolean') return abstractEquals(a, b ? 1 : 0)
  return false
}

function checkStringLength(length, ctx, node) {
  if (length > ctx.limits.maxStringLength) {
    throw new MacroRuntimeError(
      `String length limit (${ctx.limits.maxStringLength}) exceeded`,
      'memory_limit',
      node.line,
      node.column,
    )
  }
}

function checkCollectionSize(size, ctx, node, label = 'Collection') {
  if (size > ctx.limits.maxCollectionSize) {
    throw new MacroRuntimeError(
      `${label} size limit (${ctx.limits.maxCollectionSize}) exceeded`,
      'memory_limit',
      node.line,
      node.column,
    )
  }
}

function safeJsonStringify(value, ctx, node, depth, seen) {
  if (depth > ctx.limits.maxCallDepth) {
    throw new MacroRuntimeError(
      'Maximum JSON serialization depth exceeded',
      'memory_limit',
      node.line,
      node.column,
    )
  }
  if (value === null) return 'null'
  const t = typeof value
  if (t === 'boolean') return value ? 'true' : 'false'
  if (t === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (t === 'string') {
    const encoded = JSON.stringify(value)
    checkStringLength(encoded.length, ctx, node)
    return encoded
  }
  if (t === 'undefined' || CALLABLES.has(value)) {
    return undefined
  }
  if (t === 'object') {
    if (seen.has(value)) {
      throw new MacroRuntimeError(
        'Converting circular structure to JSON',
        'type_error',
        node.line,
        node.column,
      )
    }
    seen.add(value)
    try {
      if (Array.isArray(value)) {
        let out = '['
        for (let i = 0; i < value.length; i++) {
          ctx.tick(node)
          if (i > 0) out += ','
          const piece = safeJsonStringify(value[i], ctx, node, depth + 1, seen)
          const itemStr = piece === undefined ? 'null' : piece
          checkStringLength(out.length + itemStr.length + 1, ctx, node)
          out += itemStr
        }
        return out + ']'
      }
      const keys = Object.keys(value)
      let out = '{'
      let written = 0
      for (let i = 0; i < keys.length; i++) {
        ctx.tick(node)
        const k = keys[i]
        if (FORBIDDEN_PROP_NAMES.has(k)) continue
        const piece = safeJsonStringify(value[k], ctx, node, depth + 1, seen)
        if (piece === undefined) continue
        const entry = `${written > 0 ? ',' : ''}${JSON.stringify(k)}:${piece}`
        checkStringLength(out.length + entry.length + 1, ctx, node)
        out += entry
        written += 1
      }
      return out + '}'
    } finally {
      seen.delete(value)
    }
  }
  return undefined
}

function buildBuiltinGlobals() {
  const builtins = Object.create(null)

  const mathNs = Object.create(null)
  mathNs.PI = Math.PI
  mathNs.E = Math.E
  mathNs.abs = createBuiltinCallable((args) => Math.abs(safeToNumber(args[0])), 'Math.abs')
  mathNs.ceil = createBuiltinCallable((args) => Math.ceil(safeToNumber(args[0])), 'Math.ceil')
  mathNs.floor = createBuiltinCallable((args) => Math.floor(safeToNumber(args[0])), 'Math.floor')
  mathNs.round = createBuiltinCallable((args) => Math.round(safeToNumber(args[0])), 'Math.round')
  mathNs.trunc = createBuiltinCallable((args) => Math.trunc(safeToNumber(args[0])), 'Math.trunc')
  mathNs.sqrt = createBuiltinCallable((args) => Math.sqrt(safeToNumber(args[0])), 'Math.sqrt')
  mathNs.sign = createBuiltinCallable((args) => Math.sign(safeToNumber(args[0])), 'Math.sign')
  mathNs.pow = createBuiltinCallable(
    (args) => Math.pow(safeToNumber(args[0]), safeToNumber(args[1])),
    'Math.pow',
  )
  mathNs.max = createBuiltinCallable((args) => {
    if (args.length === 0) return -Infinity
    let best = -Infinity
    for (let i = 0; i < args.length; i++) {
      const n = safeToNumber(args[i])
      if (Number.isNaN(n)) return Number.NaN
      if (n > best) best = n
    }
    return best
  }, 'Math.max')
  mathNs.min = createBuiltinCallable((args) => {
    if (args.length === 0) return Infinity
    let best = Infinity
    for (let i = 0; i < args.length; i++) {
      const n = safeToNumber(args[i])
      if (Number.isNaN(n)) return Number.NaN
      if (n < best) best = n
    }
    return best
  }, 'Math.min')
  builtins.Math = Object.freeze(mathNs)

  builtins.Number = createBuiltinCallable(
    (args) => (args.length === 0 ? 0 : safeToNumber(args[0])),
    'Number',
    {
      isFinite: createBuiltinCallable((args) => Number.isFinite(args[0]), 'Number.isFinite'),
      isInteger: createBuiltinCallable((args) => Number.isInteger(args[0]), 'Number.isInteger'),
      parseInt: createBuiltinCallable((args, ctx, node) => {
        const s = safeToString(args[0], ctx.limits, node)
        const radix = args.length > 1 && args[1] !== undefined ? safeToNumber(args[1]) : undefined
        return Number.parseInt(s, radix)
      }, 'Number.parseInt'),
      parseFloat: createBuiltinCallable(
        (args, ctx, node) => Number.parseFloat(safeToString(args[0], ctx.limits, node)),
        'Number.parseFloat',
      ),
    },
  )

  builtins.String = createBuiltinCallable((args, ctx, node) => {
    if (args.length === 0) return ''
    const out = safeToString(args[0], ctx.limits, node)
    checkStringLength(out.length, ctx, node)
    ctx.chargeString(out, node)
    return out
  }, 'String')

  builtins.Boolean = createBuiltinCallable((args) => Boolean(args[0]), 'Boolean')

  const arrayNs = Object.create(null)
  arrayNs.isArray = createBuiltinCallable((args) => Array.isArray(args[0]), 'Array.isArray')
  builtins.Array = Object.freeze(arrayNs)

  const objectNs = Object.create(null)
  objectNs.keys = createBuiltinCallable((args, ctx, node) => {
    const target = args[0]
    if (target === null || target === undefined) {
      throw new MacroRuntimeError(
        'Cannot convert undefined or null to object',
        'type_error',
        node.line,
        node.column,
      )
    }
    if (typeof target !== 'object' || CALLABLES.has(target)) {
      ctx.chargeContainer(0, node)
      return []
    }
    const keys = Object.keys(target).filter((k) => !FORBIDDEN_PROP_NAMES.has(k))
    checkCollectionSize(keys.length, ctx, node, 'Array')
    ctx.chargeContainer(keys.length, node)
    return keys
  }, 'Object.keys')
  objectNs.values = createBuiltinCallable((args, ctx, node) => {
    const target = args[0]
    if (target === null || target === undefined) {
      throw new MacroRuntimeError(
        'Cannot convert undefined or null to object',
        'type_error',
        node.line,
        node.column,
      )
    }
    if (typeof target !== 'object' || CALLABLES.has(target)) {
      ctx.chargeContainer(0, node)
      return []
    }
    const keys = Object.keys(target).filter((k) => !FORBIDDEN_PROP_NAMES.has(k))
    checkCollectionSize(keys.length, ctx, node, 'Array')
    ctx.chargeContainer(keys.length, node)
    return keys.map((k) => target[k])
  }, 'Object.values')
  objectNs.entries = createBuiltinCallable((args, ctx, node) => {
    const target = args[0]
    if (target === null || target === undefined) {
      throw new MacroRuntimeError(
        'Cannot convert undefined or null to object',
        'type_error',
        node.line,
        node.column,
      )
    }
    if (typeof target !== 'object' || CALLABLES.has(target)) {
      ctx.chargeContainer(0, node)
      return []
    }
    const keys = Object.keys(target).filter((k) => !FORBIDDEN_PROP_NAMES.has(k))
    checkCollectionSize(keys.length, ctx, node, 'Array')
    ctx.chargeContainer(keys.length, node)
    ctx.chargeBytes(keys.length * (64 + 32), node)
    return keys.map((k) => [k, target[k]])
  }, 'Object.entries')
  builtins.Object = Object.freeze(objectNs)

  const jsonNs = Object.create(null)
  jsonNs.stringify = createBuiltinCallable((args, ctx, node) => {
    const out = safeJsonStringify(args[0], ctx, node, 0, new Set())
    if (typeof out === 'string') {
      ctx.chargeString(out, node)
    }
    return out
  }, 'JSON.stringify')
  jsonNs.parse = createBuiltinCallable((args, ctx, node) => {
    const text = safeToString(args[0], ctx.limits, node)
    checkStringLength(text.length, ctx, node)
    let raw
    try {
      raw = JSON.parse(text)
    } catch (err) {
      throw new MacroRuntimeError(
        `JSON.parse failed: ${err instanceof Error ? err.message : String(err)}`,
        'runtime_error',
        node.line,
        node.column,
      )
    }
    try {
      return sanitizeHostValueInternal(raw, ctx.limits, 0, new Set(), false, (bytes) =>
        ctx.chargeBytes(bytes, node),
      )
    } catch (err) {
      if (err instanceof MacroRuntimeError) {
        throw new MacroRuntimeError(err.message, err.code, node.line, node.column)
      }
      throw err
    }
  }, 'JSON.parse')
  builtins.JSON = Object.freeze(jsonNs)

  return builtins
}

const STRING_METHODS = Object.assign(Object.create(null), {
  slice: (recv, args, ctx, node) => {
    const start = args.length > 0 && args[0] !== undefined ? safeToNumber(args[0]) : 0
    const end = args.length > 1 && args[1] !== undefined ? safeToNumber(args[1]) : undefined
    const out = end === undefined ? recv.slice(start) : recv.slice(start, end)
    ctx.chargeString(out, node)
    return out
  },
  substring: (recv, args, ctx, node) => {
    const start = args.length > 0 && args[0] !== undefined ? safeToNumber(args[0]) : 0
    const end = args.length > 1 && args[1] !== undefined ? safeToNumber(args[1]) : undefined
    const out = end === undefined ? recv.substring(start) : recv.substring(start, end)
    ctx.chargeString(out, node)
    return out
  },
  indexOf: (recv, args, ctx, node) => {
    const search = safeToString(args[0], ctx.limits, node)
    const from = args.length > 1 && args[1] !== undefined ? safeToNumber(args[1]) : 0
    return recv.indexOf(search, from)
  },
  lastIndexOf: (recv, args, ctx, node) => {
    const search = safeToString(args[0], ctx.limits, node)
    if (args.length > 1 && args[1] !== undefined) {
      return recv.lastIndexOf(search, safeToNumber(args[1]))
    }
    return recv.lastIndexOf(search)
  },
  includes: (recv, args, ctx, node) => {
    const search = safeToString(args[0], ctx.limits, node)
    const pos = args.length > 1 && args[1] !== undefined ? safeToNumber(args[1]) : 0
    return recv.includes(search, pos)
  },
  startsWith: (recv, args, ctx, node) => {
    const search = safeToString(args[0], ctx.limits, node)
    const pos = args.length > 1 && args[1] !== undefined ? safeToNumber(args[1]) : 0
    return recv.startsWith(search, pos)
  },
  endsWith: (recv, args, ctx, node) => {
    const search = safeToString(args[0], ctx.limits, node)
    if (args.length > 1 && args[1] !== undefined) {
      return recv.endsWith(search, safeToNumber(args[1]))
    }
    return recv.endsWith(search)
  },
  trim: (recv, _args, ctx, node) => {
    const out = recv.trim()
    ctx.chargeString(out, node)
    return out
  },
  trimStart: (recv, _args, ctx, node) => {
    const out = recv.trimStart()
    ctx.chargeString(out, node)
    return out
  },
  trimEnd: (recv, _args, ctx, node) => {
    const out = recv.trimEnd()
    ctx.chargeString(out, node)
    return out
  },
  toLowerCase: (recv, _args, ctx, node) => {
    ctx.chargeBytes(recv.length * 2 + 16, node)
    const out = recv.toLowerCase()
    checkStringLength(out.length, ctx, node)
    return out
  },
  toUpperCase: (recv, _args, ctx, node) => {
    ctx.chargeBytes(recv.length * 2 + 16, node)
    const out = recv.toUpperCase()
    checkStringLength(out.length, ctx, node)
    return out
  },
  charAt: (recv, args, ctx, node) => {
    const idx = args.length > 0 && args[0] !== undefined ? safeToNumber(args[0]) : 0
    const out = recv.charAt(idx)
    ctx.chargeString(out, node)
    return out
  },
  repeat: (recv, args, ctx, node) => {
    const rawCount = args.length > 0 ? safeToNumber(args[0]) : 0
    if (!Number.isFinite(rawCount) || rawCount < 0) {
      throw new MacroRuntimeError(
        'Invalid count value for String.repeat',
        'runtime_error',
        node.line,
        node.column,
      )
    }
    const count = Math.trunc(rawCount)
    if (recv.length === 0 || count === 0) {
      ctx.chargeBytes(16, node)
      return ''
    }
    if (count > ctx.limits.maxStringLength || recv.length * count > ctx.limits.maxStringLength) {
      throw new MacroRuntimeError(
        `String length limit (${ctx.limits.maxStringLength}) exceeded`,
        'memory_limit',
        node.line,
        node.column,
      )
    }
    ctx.chargeBytes(recv.length * count * 2 + 16, node)
    return recv.repeat(count)
  },
  replace: (recv, args, ctx, node) => {
    const search = safeToString(args[0], ctx.limits, node)
    const replacement = safeToString(args[1], ctx.limits, node)
    if (search.length === 0) {
      const targetLen = replacement.length + recv.length
      checkStringLength(targetLen, ctx, node)
      ctx.chargeBytes(targetLen * 2 + 16, node)
      return replacement + recv
    }
    const idx = recv.indexOf(search)
    if (idx === -1) return recv
    const targetLen = recv.length - search.length + replacement.length
    checkStringLength(targetLen, ctx, node)
    ctx.chargeBytes(targetLen * 2 + 16, node)
    return recv.slice(0, idx) + replacement + recv.slice(idx + search.length)
  },
  replaceAll: (recv, args, ctx, node) => {
    const search = safeToString(args[0], ctx.limits, node)
    const replacement = safeToString(args[1], ctx.limits, node)
    if (search.length === 0) {
      const targetLen = recv.length + (recv.length + 1) * replacement.length
      checkStringLength(targetLen, ctx, node)
      ctx.chargeBytes(targetLen * 2 + 16, node)
      let out = replacement
      for (let i = 0; i < recv.length; i++) {
        ctx.tick(node)
        out += recv[i] + replacement
      }
      return out
    }
    let out = ''
    let cursor = 0
    while (cursor <= recv.length) {
      ctx.tick(node)
      const idx = recv.indexOf(search, cursor)
      if (idx === -1) {
        const tail = recv.slice(cursor)
        checkStringLength(out.length + tail.length, ctx, node)
        out += tail
        break
      }
      const chunk = recv.slice(cursor, idx)
      checkStringLength(out.length + chunk.length + replacement.length, ctx, node)
      out += chunk + replacement
      cursor = idx + search.length
    }
    ctx.chargeString(out, node)
    return out
  },
  split: (recv, args, ctx, node) => {
    const limitArg = args.length > 1 && args[1] !== undefined ? safeToNumber(args[1]) : undefined
    const maxParts =
      limitArg === undefined
        ? ctx.limits.maxCollectionSize
        : Number.isNaN(limitArg) || limitArg <= 0
          ? 0
          : Math.min(Math.trunc(limitArg), ctx.limits.maxCollectionSize)
    if (maxParts === 0) {
      ctx.chargeContainer(0, node)
      return []
    }
    if (args.length === 0 || args[0] === undefined) {
      ctx.chargeContainer(1, node)
      ctx.chargeString(recv, node)
      return [recv]
    }
    const sep = safeToString(args[0], ctx.limits, node)
    const result = []
    ctx.chargeContainer(0, node)
    if (sep.length === 0) {
      if (limitArg === undefined && recv.length > ctx.limits.maxCollectionSize) {
        throw new MacroRuntimeError(
          `Array size limit (${ctx.limits.maxCollectionSize}) exceeded`,
          'memory_limit',
          node.line,
          node.column,
        )
      }
      const count = Math.min(recv.length, maxParts)
      for (let i = 0; i < count; i++) {
        ctx.tick(node)
        const ch = recv[i]
        ctx.chargeBytes(16 + ch.length * 2 + 16, node)
        result.push(ch)
      }
      return result
    }
    let cursor = 0
    while (true) {
      ctx.tick(node)
      const idx = recv.indexOf(sep, cursor)
      if (idx === -1) {
        if (result.length >= ctx.limits.maxCollectionSize) {
          if (limitArg !== undefined && result.length >= maxParts) break
          throw new MacroRuntimeError(
            `Array size limit (${ctx.limits.maxCollectionSize}) exceeded`,
            'memory_limit',
            node.line,
            node.column,
          )
        }
        const piece = recv.slice(cursor)
        ctx.chargeBytes(16 + piece.length * 2 + 16, node)
        result.push(piece)
        break
      }
      if (result.length >= ctx.limits.maxCollectionSize) {
        if (limitArg !== undefined && result.length >= maxParts) break
        throw new MacroRuntimeError(
          `Array size limit (${ctx.limits.maxCollectionSize}) exceeded`,
          'memory_limit',
          node.line,
          node.column,
        )
      }
      const piece = recv.slice(cursor, idx)
      ctx.chargeBytes(16 + piece.length * 2 + 16, node)
      result.push(piece)
      if (limitArg !== undefined && result.length >= maxParts) break
      cursor = idx + sep.length
    }
    return result
  },
})

function assertMutableArray(arr, node) {
  if (Object.isFrozen(arr)) {
    throw new MacroRuntimeError('Cannot mutate frozen array', 'type_error', node.line, node.column)
  }
}

function assertCallback(cb, methodName, node) {
  if (!CALLABLES.has(cb)) {
    throw new MacroRuntimeError(
      `Array.${methodName} callback must be a function`,
      'type_error',
      node.line,
      node.column,
    )
  }
}

const ARRAY_METHODS = Object.assign(Object.create(null), {
  push: (recv, args, ctx, node) => {
    assertMutableArray(recv, node)
    checkCollectionSize(recv.length + args.length, ctx, node, 'Array')
    ctx.chargeBytes(args.length * 16, node)
    for (let i = 0; i < args.length; i++) {
      recv.push(args[i])
    }
    return recv.length
  },
  pop: (recv, _args, _ctx, node) => {
    assertMutableArray(recv, node)
    return recv.pop()
  },
  shift: (recv, _args, _ctx, node) => {
    assertMutableArray(recv, node)
    return recv.shift()
  },
  unshift: (recv, args, ctx, node) => {
    assertMutableArray(recv, node)
    checkCollectionSize(recv.length + args.length, ctx, node, 'Array')
    ctx.chargeBytes(args.length * 16, node)
    return recv.unshift(...args)
  },
  slice: (recv, args, ctx, node) => {
    const start = args.length > 0 && args[0] !== undefined ? safeToNumber(args[0]) : 0
    const end = args.length > 1 && args[1] !== undefined ? safeToNumber(args[1]) : undefined
    const out = end === undefined ? recv.slice(start) : recv.slice(start, end)
    ctx.chargeContainer(out.length, node)
    return out
  },
  concat: (recv, args, ctx, node) => {
    let total = recv.length
    for (let i = 0; i < args.length; i++) {
      total += Array.isArray(args[i]) ? args[i].length : 1
      checkCollectionSize(total, ctx, node, 'Array')
    }
    ctx.chargeContainer(total, node)
    const out = recv.slice()
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (Array.isArray(arg)) {
        for (let j = 0; j < arg.length; j++) {
          ctx.tick(node)
          out.push(arg[j])
        }
      } else {
        out.push(arg)
      }
    }
    return out
  },
  indexOf: (recv, args) => {
    const from = args.length > 1 && args[1] !== undefined ? safeToNumber(args[1]) : 0
    return recv.indexOf(args[0], from)
  },
  includes: (recv, args) => {
    const from = args.length > 1 && args[1] !== undefined ? safeToNumber(args[1]) : 0
    return recv.includes(args[0], from)
  },
  join: (recv, args, ctx, node) => {
    const sep =
      args.length > 0 && args[0] !== undefined ? safeToString(args[0], ctx.limits, node) : ','
    let out = ''
    for (let i = 0; i < recv.length; i++) {
      ctx.tick(node)
      if (i > 0) {
        checkStringLength(out.length + sep.length, ctx, node)
        out += sep
      }
      const item = recv[i]
      const piece = item === null || item === undefined ? '' : safeToString(item, ctx.limits, node)
      checkStringLength(out.length + piece.length, ctx, node)
      out += piece
    }
    ctx.chargeString(out, node)
    return out
  },
  reverse: (recv, _args, _ctx, node) => {
    assertMutableArray(recv, node)
    return recv.reverse()
  },
  map: (recv, args, ctx, node) => {
    const cb = args[0]
    assertCallback(cb, 'map', node)
    const len = recv.length
    checkCollectionSize(len, ctx, node, 'Array')
    ctx.chargeContainer(len, node)
    const out = new Array(len)
    for (let i = 0; i < len; i++) {
      ctx.tick(node)
      out[i] = ctx.invoke(cb, [recv[i], i, recv], node)
    }
    return out
  },
  filter: (recv, args, ctx, node) => {
    const cb = args[0]
    assertCallback(cb, 'filter', node)
    const len = recv.length
    const out = []
    ctx.chargeContainer(0, node)
    for (let i = 0; i < len; i++) {
      ctx.tick(node)
      if (ctx.invoke(cb, [recv[i], i, recv], node)) {
        checkCollectionSize(out.length + 1, ctx, node, 'Array')
        ctx.chargeBytes(16, node)
        out.push(recv[i])
      }
    }
    return out
  },
  forEach: (recv, args, ctx, node) => {
    const cb = args[0]
    assertCallback(cb, 'forEach', node)
    const len = recv.length
    for (let i = 0; i < len; i++) {
      ctx.tick(node)
      ctx.invoke(cb, [recv[i], i, recv], node)
    }
    return undefined
  },
  find: (recv, args, ctx, node) => {
    const cb = args[0]
    assertCallback(cb, 'find', node)
    const len = recv.length
    for (let i = 0; i < len; i++) {
      ctx.tick(node)
      if (ctx.invoke(cb, [recv[i], i, recv], node)) {
        return recv[i]
      }
    }
    return undefined
  },
  findIndex: (recv, args, ctx, node) => {
    const cb = args[0]
    assertCallback(cb, 'findIndex', node)
    const len = recv.length
    for (let i = 0; i < len; i++) {
      ctx.tick(node)
      if (ctx.invoke(cb, [recv[i], i, recv], node)) {
        return i
      }
    }
    return -1
  },
  some: (recv, args, ctx, node) => {
    const cb = args[0]
    assertCallback(cb, 'some', node)
    const len = recv.length
    for (let i = 0; i < len; i++) {
      ctx.tick(node)
      if (ctx.invoke(cb, [recv[i], i, recv], node)) {
        return true
      }
    }
    return false
  },
  every: (recv, args, ctx, node) => {
    const cb = args[0]
    assertCallback(cb, 'every', node)
    const len = recv.length
    for (let i = 0; i < len; i++) {
      ctx.tick(node)
      if (!ctx.invoke(cb, [recv[i], i, recv], node)) {
        return false
      }
    }
    return true
  },
  reduce: (recv, args, ctx, node) => {
    const cb = args[0]
    assertCallback(cb, 'reduce', node)
    const len = recv.length
    let acc
    let start = 0
    if (args.length >= 2) {
      acc = args[1]
    } else {
      if (len === 0) {
        throw new MacroRuntimeError(
          'Reduce of empty array with no initial value',
          'type_error',
          node.line,
          node.column,
        )
      }
      acc = recv[0]
      start = 1
    }
    for (let i = start; i < len; i++) {
      ctx.tick(node)
      acc = ctx.invoke(cb, [acc, recv[i], i, recv], node)
    }
    return acc
  },
})

const SAMPLE_BUILTINS = buildBuiltinGlobals()

/**
 * Frozen summary of the interpreter's exact supported keywords, built-in
 * globals, and method allowlists, derived directly from the runtime dispatch
 * tables so prompt builders and tooling cannot drift out of sync.
 */
export const INTERPRETER_CAPABILITIES = Object.freeze({
  keywords: Object.freeze(Array.from(SUPPORTED_KEYWORDS)),
  globals: Object.freeze(Object.keys(SAMPLE_BUILTINS)),
  stringMethods: Object.freeze(Object.keys(STRING_METHODS)),
  arrayMethods: Object.freeze(Object.keys(ARRAY_METHODS)),
  objectMethods: Object.freeze(Object.keys(SAMPLE_BUILTINS.Object)),
  mathMethods: Object.freeze(
    Object.keys(SAMPLE_BUILTINS.Math).filter((k) => CALLABLES.has(SAMPLE_BUILTINS.Math[k])),
  ),
  mathConstants: Object.freeze(
    Object.keys(SAMPLE_BUILTINS.Math).filter((k) => !CALLABLES.has(SAMPLE_BUILTINS.Math[k])),
  ),
  jsonMethods: Object.freeze(Object.keys(SAMPLE_BUILTINS.JSON)),
  numberMethods: Object.freeze(Object.keys(SAMPLE_BUILTINS.Number)),
  arrayStaticMethods: Object.freeze(Object.keys(SAMPLE_BUILTINS.Array)),
})

// ============================================================================
// Lexical Environment & Control-Flow Signals
// ============================================================================

function findFunctionScope(startEnv) {
  let cur = startEnv
  while (cur && !cur.isFunctionScope) {
    cur = cur.parent
  }
  return cur || startEnv
}

function lookupBinding(startEnv, name) {
  let cur = startEnv
  while (cur) {
    if (Object.prototype.hasOwnProperty.call(cur.bindings, name)) {
      return cur.bindings[name]
    }
    cur = cur.parent
  }
  return null
}

class Environment {
  constructor(parent, isFunctionScope = false) {
    this.parent = parent
    this.isFunctionScope = isFunctionScope
    this.bindings = Object.create(null)
  }

  getFunctionScope() {
    return findFunctionScope(this)
  }

  declare(name, kind, value, initialized, node) {
    if (Object.prototype.hasOwnProperty.call(this.bindings, name)) {
      const existing = this.bindings[name]
      if (kind === 'var' && existing.kind === 'var') {
        if (initialized) {
          existing.value = value
          existing.initialized = true
        }
        return
      }
      throw new MacroRuntimeError(
        `Identifier "${name}" has already been declared`,
        'runtime_error',
        node.line,
        node.column,
      )
    }
    this.bindings[name] = { kind, value, initialized }
  }

  initialize(name, value, node) {
    const rec = this.bindings[name]
    if (!rec) {
      throw new MacroRuntimeError(
        `Unknown identifier "${name}"`,
        'unknown_identifier',
        node.line,
        node.column,
      )
    }
    rec.value = value
    rec.initialized = true
  }

  lookup(name) {
    return lookupBinding(this, name)
  }

  get(name, node) {
    const rec = this.lookup(name)
    if (!rec) {
      throw new MacroRuntimeError(
        `Unknown identifier "${name}"`,
        'unknown_identifier',
        node.line,
        node.column,
      )
    }
    if (!rec.initialized) {
      throw new MacroRuntimeError(
        `Cannot access "${name}" before initialization`,
        'runtime_error',
        node.line,
        node.column,
      )
    }
    return rec.value
  }

  set(name, value, node) {
    const rec = this.lookup(name)
    if (!rec) {
      throw new MacroRuntimeError(
        `Unknown identifier "${name}"`,
        'unknown_identifier',
        node.line,
        node.column,
      )
    }
    if (!rec.initialized) {
      throw new MacroRuntimeError(
        `Cannot access "${name}" before initialization`,
        'runtime_error',
        node.line,
        node.column,
      )
    }
    if (rec.kind === 'const' || rec.kind === 'global') {
      throw new MacroRuntimeError(
        `Assignment to constant variable "${name}"`,
        'type_error',
        node.line,
        node.column,
      )
    }
    rec.value = value
    return value
  }
}

const SIGNAL_BREAK = Object.freeze({ type: 'break' })
const SIGNAL_CONTINUE = Object.freeze({ type: 'continue' })

function makeReturnSignal(value) {
  return { type: 'return', value }
}

function isSignal(val) {
  return (
    val === SIGNAL_BREAK ||
    val === SIGNAL_CONTINUE ||
    (val !== null &&
      typeof val === 'object' &&
      Object.getPrototypeOf(val) === Object.prototype &&
      val.type === 'return')
  )
}

// ============================================================================
// AST Evaluator
// ============================================================================

class Interpreter {
  constructor(limits, nowFn) {
    this.limits = limits
    this.now = nowFn
    this.startTime = nowFn()
    this.steps = 0
    this.callDepth = 0
    this.allocatedBytes = 0
  }

  elapsedMs() {
    return Math.max(0, this.now() - this.startTime)
  }

  checkLimits(node) {
    if (this.steps > this.limits.maxSteps) {
      throw new MacroRuntimeError(
        `Execution step limit (${this.limits.maxSteps}) exceeded`,
        'step_limit',
        node ? node.line : 1,
        node ? node.column : 1,
      )
    }
    const elapsed = this.now() - this.startTime
    if (elapsed > this.limits.maxTimeMs) {
      throw new MacroRuntimeError(
        `Execution time limit (${this.limits.maxTimeMs}ms) exceeded`,
        'time_limit',
        node ? node.line : 1,
        node ? node.column : 1,
      )
    }
    if (this.allocatedBytes > this.limits.maxMemoryBytes) {
      throw new MacroRuntimeError(
        `Memory limit (${this.limits.maxMemoryBytes} bytes) exceeded`,
        'memory_limit',
        node ? node.line : 1,
        node ? node.column : 1,
      )
    }
  }

  chargeBytes(bytes, node) {
    if (!Number.isFinite(bytes) || bytes <= 0) return
    this.allocatedBytes += bytes
    if (this.allocatedBytes > this.limits.maxMemoryBytes) {
      throw new MacroRuntimeError(
        `Memory limit (${this.limits.maxMemoryBytes} bytes) exceeded`,
        'memory_limit',
        node ? node.line : 1,
        node ? node.column : 1,
      )
    }
  }

  chargeString(str, node) {
    if (typeof str === 'string') {
      this.chargeBytes(str.length * 2 + 16, node)
    }
    return str
  }

  chargeContainer(slots, node) {
    this.chargeBytes(64 + slots * 16, node)
  }

  tick(node) {
    this.steps += 1
    this.checkLimits(node)
  }

  createUserCallable(name, params, body, closure, isArrow, expressionBody, node) {
    const handle = Object.create(null)
    CALLABLES.set(handle, {
      kind: 'user',
      name: name || 'anonymous',
      params,
      body,
      closure,
      isArrow,
      expressionBody,
      line: node.line,
      column: node.column,
    })
    return Object.freeze(handle)
  }

  hoistStatements(statements, env, isFunctionBody) {
    const fnScope = env.getFunctionScope()
    const collectVars = (stmt) => {
      if (!stmt) return
      switch (stmt.type) {
        case 'VariableDeclaration':
          if (stmt.kind === 'var') {
            for (const decl of stmt.declarations) {
              if (!Object.prototype.hasOwnProperty.call(fnScope.bindings, decl.id.name)) {
                fnScope.declare(decl.id.name, 'var', undefined, true, decl.id)
              } else if (fnScope.bindings[decl.id.name].kind !== 'var') {
                throw new MacroRuntimeError(
                  `Identifier "${decl.id.name}" has already been declared`,
                  'runtime_error',
                  decl.id.line,
                  decl.id.column,
                )
              }
            }
          }
          break
        case 'BlockStatement':
          for (const s of stmt.body) collectVars(s)
          break
        case 'IfStatement':
          collectVars(stmt.consequent)
          collectVars(stmt.alternate)
          break
        case 'WhileStatement':
        case 'DoWhileStatement':
          collectVars(stmt.body)
          break
        case 'ForStatement':
          if (stmt.init && stmt.init.type === 'VariableDeclaration') collectVars(stmt.init)
          collectVars(stmt.body)
          break
        case 'ForOfStatement':
          if (stmt.kind === 'var') {
            if (!Object.prototype.hasOwnProperty.call(fnScope.bindings, stmt.id.name)) {
              fnScope.declare(stmt.id.name, 'var', undefined, true, stmt.id)
            }
          }
          collectVars(stmt.body)
          break
        case 'SwitchStatement':
          for (const c of stmt.cases) {
            for (const s of c.consequent) collectVars(s)
          }
          break
        default:
          break
      }
    }

    if (isFunctionBody) {
      for (const stmt of statements) {
        collectVars(stmt)
      }
    }

    // Hoist block-level lexical declarations (let/const) and function declarations.
    for (const stmt of statements) {
      if (stmt.type === 'FunctionDeclaration') {
        const fnVal = this.createUserCallable(
          stmt.id.name,
          stmt.params,
          stmt.body,
          env,
          false,
          false,
          stmt,
        )
        env.declare(stmt.id.name, 'function', fnVal, true, stmt.id)
      } else if (
        stmt.type === 'VariableDeclaration' &&
        (stmt.kind === 'let' || stmt.kind === 'const')
      ) {
        for (const decl of stmt.declarations) {
          env.declare(decl.id.name, stmt.kind, undefined, false, decl.id)
        }
      }
    }
  }

  evalProgram(program, env) {
    this.hoistStatements(program.body, env, true)
    let lastValue = undefined
    for (const stmt of program.body) {
      const res = this.evalStatement(stmt, env)
      if (isSignal(res)) {
        if (res.type === 'return') {
          return res.value
        }
        return lastValue
      }
      if (res !== undefined || stmt.type === 'ExpressionStatement') {
        lastValue = res
      }
    }
    return lastValue
  }

  evalBlock(block, parentEnv, isFunctionBody = false) {
    const blockEnv = isFunctionBody ? parentEnv : new Environment(parentEnv, false)
    this.hoistStatements(block.body, blockEnv, isFunctionBody)
    let lastValue = undefined
    for (const stmt of block.body) {
      const res = this.evalStatement(stmt, blockEnv)
      if (isSignal(res)) {
        return res
      }
      if (stmt.type === 'ExpressionStatement') {
        lastValue = res
      }
    }
    return lastValue
  }

  evalStatement(stmt, env) {
    this.tick(stmt)
    switch (stmt.type) {
      case 'EmptyStatement':
        return undefined
      case 'BlockStatement':
        return this.evalBlock(stmt, env, false)
      case 'ExpressionStatement':
        return this.evalExpression(stmt.expression, env)
      case 'FunctionDeclaration':
        // Already hoisted when entering block/program.
        return undefined
      case 'VariableDeclaration': {
        for (const decl of stmt.declarations) {
          if (stmt.kind === 'var') {
            if (decl.init) {
              const val = this.evalExpression(decl.init, env)
              env.getFunctionScope().set(decl.id.name, val, decl.id)
            }
          } else {
            const val = decl.init ? this.evalExpression(decl.init, env) : undefined
            env.initialize(decl.id.name, val, decl.id)
          }
        }
        return undefined
      }
      case 'IfStatement': {
        const cond = this.evalExpression(stmt.test, env)
        if (cond) {
          return this.evalStatement(stmt.consequent, env)
        }
        if (stmt.alternate) {
          return this.evalStatement(stmt.alternate, env)
        }
        return undefined
      }
      case 'WhileStatement': {
        let lastVal = undefined
        while (true) {
          this.tick(stmt)
          if (!this.evalExpression(stmt.test, env)) break
          const res = this.evalStatement(stmt.body, env)
          if (res === SIGNAL_BREAK) break
          if (res === SIGNAL_CONTINUE) continue
          if (isSignal(res)) return res
          lastVal = res
        }
        return lastVal
      }
      case 'DoWhileStatement': {
        let lastVal = undefined
        while (true) {
          this.tick(stmt)
          const res = this.evalStatement(stmt.body, env)
          if (res === SIGNAL_BREAK) break
          if (res !== SIGNAL_CONTINUE && isSignal(res)) return res
          if (res !== SIGNAL_CONTINUE) lastVal = res
          if (!this.evalExpression(stmt.test, env)) break
        }
        return lastVal
      }
      case 'ForStatement': {
        const outerLoopEnv = new Environment(env, false)
        const lexicalLoopVars = []
        if (stmt.init) {
          if (stmt.init.type === 'VariableDeclaration') {
            if (stmt.init.kind === 'var') {
              for (const decl of stmt.init.declarations) {
                if (decl.init) {
                  const val = this.evalExpression(decl.init, env)
                  env.getFunctionScope().set(decl.id.name, val, decl.id)
                }
              }
            } else {
              for (const decl of stmt.init.declarations) {
                outerLoopEnv.declare(decl.id.name, stmt.init.kind, undefined, false, decl.id)
                const val = decl.init ? this.evalExpression(decl.init, outerLoopEnv) : undefined
                outerLoopEnv.initialize(decl.id.name, val, decl.id)
                lexicalLoopVars.push({ name: decl.id.name, kind: stmt.init.kind, id: decl.id })
              }
            }
          } else {
            this.evalExpression(stmt.init, outerLoopEnv)
          }
        }

        let iterEnv = outerLoopEnv
        let lastVal = undefined
        while (true) {
          this.tick(stmt)
          if (stmt.test && !this.evalExpression(stmt.test, iterEnv)) break

          // Create a fresh per-iteration lexical environment for closures in `for (let ...)`.
          let bodyEnv = iterEnv
          if (lexicalLoopVars.length > 0) {
            bodyEnv = new Environment(env, false)
            for (const v of lexicalLoopVars) {
              bodyEnv.declare(v.name, v.kind, iterEnv.get(v.name, v.id), true, v.id)
            }
          }

          const res = this.evalStatement(stmt.body, bodyEnv)
          if (res === SIGNAL_BREAK) break
          if (res !== SIGNAL_CONTINUE && isSignal(res)) return res
          if (res !== SIGNAL_CONTINUE) lastVal = res

          // Copy updated lexical values into a fresh environment before running
          // `update` so closures captured inside the loop body keep their iteration value.
          if (lexicalLoopVars.length > 0) {
            const nextEnv = new Environment(env, false)
            for (const v of lexicalLoopVars) {
              nextEnv.declare(v.name, v.kind, bodyEnv.get(v.name, v.id), true, v.id)
            }
            iterEnv = nextEnv
          } else {
            iterEnv = bodyEnv
          }
          if (stmt.update) {
            this.evalExpression(stmt.update, iterEnv)
          }
        }
        return lastVal
      }
      case 'ForOfStatement': {
        const iterable = this.evalExpression(stmt.right, env)
        let items
        if (Array.isArray(iterable)) {
          items = iterable
        } else if (typeof iterable === 'string') {
          items = iterable
        } else {
          throw new MacroRuntimeError(
            'Right-hand side of for-of must be an array or string',
            'type_error',
            stmt.right.line,
            stmt.right.column,
          )
        }
        let lastVal = undefined
        for (let i = 0; i < items.length; i++) {
          this.tick(stmt)
          const item = items[i]
          let iterEnv = env
          if (stmt.kind === 'let' || stmt.kind === 'const') {
            iterEnv = new Environment(env, false)
            iterEnv.declare(stmt.id.name, stmt.kind, item, true, stmt.id)
          } else if (stmt.kind === 'var') {
            env.getFunctionScope().set(stmt.id.name, item, stmt.id)
          } else {
            env.set(stmt.id.name, item, stmt.id)
          }
          const res = this.evalStatement(stmt.body, iterEnv)
          if (res === SIGNAL_BREAK) break
          if (res === SIGNAL_CONTINUE) continue
          if (isSignal(res)) return res
          lastVal = res
        }
        return lastVal
      }
      case 'SwitchStatement': {
        const disc = this.evalExpression(stmt.discriminant, env)
        const switchEnv = new Environment(env, false)
        let matchedIndex = -1
        let defaultIndex = -1
        for (let i = 0; i < stmt.cases.length; i++) {
          const c = stmt.cases[i]
          if (c.test === null) {
            defaultIndex = i
          } else {
            const testVal = this.evalExpression(c.test, switchEnv)
            if (testVal === disc) {
              matchedIndex = i
              break
            }
          }
        }
        const start = matchedIndex !== -1 ? matchedIndex : defaultIndex
        if (start === -1) return undefined
        let lastVal = undefined
        for (let i = start; i < stmt.cases.length; i++) {
          for (const s of stmt.cases[i].consequent) {
            const res = this.evalStatement(s, switchEnv)
            if (res === SIGNAL_BREAK) return lastVal
            if (isSignal(res)) return res
            lastVal = res
          }
        }
        return lastVal
      }
      case 'BreakStatement':
        return SIGNAL_BREAK
      case 'ContinueStatement':
        return SIGNAL_CONTINUE
      case 'ReturnStatement': {
        const val = stmt.argument ? this.evalExpression(stmt.argument, env) : undefined
        return makeReturnSignal(val)
      }
      default:
        throw new MacroRuntimeError(
          `Unsupported statement type "${stmt.type}"`,
          'runtime_error',
          stmt.line,
          stmt.column,
        )
    }
  }

  readProperty(receiver, propKey, node) {
    const prop = assertSafePropertyKey(propKey, node.line, node.column)
    if (receiver === null || receiver === undefined) {
      throw new MacroRuntimeError(
        `Cannot read property "${prop}" of ${receiver}`,
        'type_error',
        node.line,
        node.column,
      )
    }
    if (typeof receiver === 'string') {
      if (prop === 'length') return receiver.length
      if (isArrayIndexKey(prop)) {
        const idx = Number(prop)
        return idx < receiver.length ? receiver[idx] : undefined
      }
      const method = STRING_METHODS[prop]
      if (method) {
        return createBuiltinCallable(
          (args, ctx, callNode) => method(receiver, args, ctx, callNode),
          `String.prototype.${prop}`,
        )
      }
      return undefined
    }
    if (Array.isArray(receiver)) {
      if (prop === 'length') return receiver.length
      if (isArrayIndexKey(prop)) {
        const idx = Number(prop)
        return Object.prototype.hasOwnProperty.call(receiver, idx) ? receiver[idx] : undefined
      }
      const method = ARRAY_METHODS[prop]
      if (method) {
        return createBuiltinCallable(
          (args, ctx, callNode) => method(receiver, args, ctx, callNode),
          `Array.prototype.${prop}`,
        )
      }
      return undefined
    }
    if (typeof receiver === 'number' || typeof receiver === 'boolean') {
      return undefined
    }
    if (typeof receiver === 'object') {
      return Object.prototype.hasOwnProperty.call(receiver, prop) ? receiver[prop] : undefined
    }
    return undefined
  }

  writeProperty(receiver, propKey, value, node) {
    const prop = assertSafePropertyKey(propKey, node.line, node.column)
    if (receiver === null || receiver === undefined || typeof receiver !== 'object') {
      throw new MacroRuntimeError(
        `Cannot set property "${prop}" on non-object value`,
        'type_error',
        node.line,
        node.column,
      )
    }
    if (Object.isFrozen(receiver)) {
      throw new MacroRuntimeError(
        `Cannot assign to property "${prop}" of frozen object`,
        'type_error',
        node.line,
        node.column,
      )
    }
    if (Array.isArray(receiver)) {
      if (prop === 'length') {
        const nextLen = safeToNumber(value)
        if (!Number.isInteger(nextLen) || nextLen < 0) {
          throw new MacroRuntimeError('Invalid array length', 'type_error', node.line, node.column)
        }
        checkCollectionSize(nextLen, this, node, 'Array')
        if (nextLen > receiver.length) {
          this.chargeBytes((nextLen - receiver.length) * 16, node)
        }
        receiver.length = nextLen
        return value
      }
      if (!isArrayIndexKey(prop)) {
        throw new MacroRuntimeError(
          `Cannot set non-index property "${prop}" on array`,
          'type_error',
          node.line,
          node.column,
        )
      }
      const idx = Number(prop)
      checkCollectionSize(idx + 1, this, node, 'Array')
      if (idx >= receiver.length) {
        this.chargeBytes((idx + 1 - receiver.length) * 16, node)
      }
      receiver[idx] = value
      return value
    }
    if (!Object.prototype.hasOwnProperty.call(receiver, prop)) {
      checkCollectionSize(Object.keys(receiver).length + 1, this, node, 'Object')
      this.chargeBytes(16, node)
    }
    receiver[prop] = value
    return value
  }

  evalMemberKey(memberNode, env) {
    return memberNode.computed
      ? this.evalExpression(memberNode.property, env)
      : memberNode.property.name
  }

  applyCompoundOp(op, cur, rhs, node) {
    switch (op) {
      case '+=':
        return this.evalAdd(cur, rhs, node)
      case '-=':
        return safeToNumber(cur) - safeToNumber(rhs)
      case '*=':
        return safeToNumber(cur) * safeToNumber(rhs)
      case '/=':
        return safeToNumber(cur) / safeToNumber(rhs)
      case '%=':
        return safeToNumber(cur) % safeToNumber(rhs)
      default:
        return rhs
    }
  }

  evalAdd(left, right, node) {
    if (typeof left === 'string' || typeof right === 'string') {
      const a = safeToString(left, this.limits, node)
      const b = safeToString(right, this.limits, node)
      const totalLen = a.length + b.length
      checkStringLength(totalLen, this, node)
      this.chargeBytes(totalLen * 2 + 16, node)
      return a + b
    }
    return safeToNumber(left) + safeToNumber(right)
  }

  invoke(callee, args, callNode) {
    this.tick(callNode)
    const meta = CALLABLES.get(callee)
    if (!meta) {
      throw new MacroRuntimeError(
        'Attempted to call a non-function value',
        'type_error',
        callNode.line,
        callNode.column,
      )
    }

    if (meta.kind === 'builtin') {
      this.callDepth += 1
      if (this.callDepth > this.limits.maxCallDepth) {
        this.callDepth -= 1
        throw new MacroRuntimeError(
          `Maximum call depth (${this.limits.maxCallDepth}) exceeded`,
          'call_depth_limit',
          callNode.line,
          callNode.column,
        )
      }
      try {
        return meta.fn(args, this, callNode)
      } finally {
        this.callDepth -= 1
      }
    }

    if (meta.kind === 'host') {
      this.callDepth += 1
      if (this.callDepth > this.limits.maxCallDepth) {
        this.callDepth -= 1
        throw new MacroRuntimeError(
          `Maximum call depth (${this.limits.maxCallDepth}) exceeded`,
          'call_depth_limit',
          callNode.line,
          callNode.column,
        )
      }
      try {
        let rawResult
        try {
          rawResult = meta.fn(...args)
        } catch (err) {
          if (err instanceof MacroRuntimeError) {
            throw err
          }
          throw new MacroRuntimeError(
            err instanceof Error ? err.message : String(err),
            'runtime_error',
            callNode.line,
            callNode.column,
          )
        }
        this.checkLimits(callNode)
        if (SAFE_BAGS.has(rawResult) || CALLABLES.has(rawResult)) {
          return rawResult
        }
        try {
          return sanitizeHostValueInternal(rawResult, this.limits, 0, new Set(), false, (bytes) =>
            this.chargeBytes(bytes, callNode),
          )
        } catch (err) {
          if (err instanceof MacroRuntimeError) {
            throw new MacroRuntimeError(err.message, err.code, callNode.line, callNode.column)
          }
          throw err
        }
      } finally {
        this.callDepth -= 1
      }
    }

    // User-defined function or arrow function
    this.callDepth += 1
    if (this.callDepth > this.limits.maxCallDepth) {
      this.callDepth -= 1
      throw new MacroRuntimeError(
        `Maximum call depth (${this.limits.maxCallDepth}) exceeded`,
        'call_depth_limit',
        callNode.line,
        callNode.column,
      )
    }
    try {
      const fnEnv = new Environment(meta.closure, true)
      for (let i = 0; i < meta.params.length; i++) {
        const p = meta.params[i]
        fnEnv.declare(p.name, 'var', i < args.length ? args[i] : undefined, true, p)
      }
      if (meta.isArrow && meta.expressionBody) {
        return this.evalExpression(meta.body, fnEnv)
      }
      const res = this.evalBlock(meta.body, fnEnv, true)
      if (isSignal(res) && res.type === 'return') {
        return res.value
      }
      return undefined
    } finally {
      this.callDepth -= 1
    }
  }

  evalExpression(node, env) {
    switch (node.type) {
      case 'Literal':
        if (typeof node.value === 'string') {
          this.chargeString(node.value, node)
        }
        return node.value
      case 'Identifier':
        return env.get(node.name, node)
      case 'ArrayExpression': {
        checkCollectionSize(node.elements.length, this, node, 'Array')
        this.chargeContainer(node.elements.length, node)
        const arr = new Array(node.elements.length)
        for (let i = 0; i < node.elements.length; i++) {
          arr[i] = this.evalExpression(node.elements[i], env)
        }
        return arr
      }
      case 'ObjectExpression': {
        this.chargeContainer(0, node)
        const obj = Object.create(null)
        let propCount = 0
        for (const prop of node.properties) {
          const rawKey = prop.computed ? this.evalExpression(prop.key, env) : prop.key.value
          const key = assertSafePropertyKey(rawKey, prop.line, prop.column)
          const val = this.evalExpression(prop.value, env)
          if (!Object.prototype.hasOwnProperty.call(obj, key)) {
            propCount += 1
            checkCollectionSize(propCount, this, prop, 'Object')
            this.chargeBytes(16, prop)
          }
          obj[key] = val
        }
        return obj
      }
      case 'FunctionExpression': {
        const fnScope = node.id ? new Environment(env, false) : env
        const fnVal = this.createUserCallable(
          node.id ? node.id.name : 'anonymous',
          node.params,
          node.body,
          fnScope,
          false,
          false,
          node,
        )
        if (node.id) {
          fnScope.declare(node.id.name, 'const', fnVal, true, node.id)
        }
        return fnVal
      }
      case 'ArrowFunctionExpression':
        return this.createUserCallable(
          'arrow',
          node.params,
          node.body,
          env,
          true,
          node.expressionBody,
          node,
        )
      case 'UnaryExpression': {
        if (node.operator === 'typeof') {
          if (node.argument.type === 'Identifier') {
            const rec = env.lookup(node.argument.name)
            if (!rec) return 'undefined'
            if (!rec.initialized) {
              throw new MacroRuntimeError(
                `Cannot access "${node.argument.name}" before initialization`,
                'runtime_error',
                node.argument.line,
                node.argument.column,
              )
            }
            return safeTypeof(rec.value)
          }
          return safeTypeof(this.evalExpression(node.argument, env))
        }
        const val = this.evalExpression(node.argument, env)
        switch (node.operator) {
          case '!':
            return !val
          case '-':
            return -safeToNumber(val)
          case '+':
            return +safeToNumber(val)
          default:
            throw new MacroRuntimeError(
              `Unsupported unary operator "${node.operator}"`,
              'runtime_error',
              node.line,
              node.column,
            )
        }
      }
      case 'UpdateExpression': {
        const delta = node.operator === '++' ? 1 : -1
        if (node.argument.type === 'Identifier') {
          const oldVal = safeToNumber(env.get(node.argument.name, node.argument))
          const nextVal = oldVal + delta
          env.set(node.argument.name, nextVal, node.argument)
          return node.prefix ? nextVal : oldVal
        }
        const obj = this.evalExpression(node.argument.object, env)
        const key = this.evalMemberKey(node.argument, env)
        const oldVal = safeToNumber(this.readProperty(obj, key, node.argument))
        const nextVal = oldVal + delta
        this.writeProperty(obj, key, nextVal, node.argument)
        return node.prefix ? nextVal : oldVal
      }
      case 'BinaryExpression': {
        const left = this.evalExpression(node.left, env)
        const right = this.evalExpression(node.right, env)
        switch (node.operator) {
          case '+':
            return this.evalAdd(left, right, node)
          case '-':
            return safeToNumber(left) - safeToNumber(right)
          case '*':
            return safeToNumber(left) * safeToNumber(right)
          case '/':
            return safeToNumber(left) / safeToNumber(right)
          case '%':
            return safeToNumber(left) % safeToNumber(right)
          case '**':
            return Math.pow(safeToNumber(left), safeToNumber(right))
          case '===':
            return left === right
          case '!==':
            return left !== right
          case '==':
            return abstractEquals(left, right)
          case '!=':
            return !abstractEquals(left, right)
          case '<':
            return typeof left === 'string' && typeof right === 'string'
              ? left < right
              : safeToNumber(left) < safeToNumber(right)
          case '<=':
            return typeof left === 'string' && typeof right === 'string'
              ? left <= right
              : safeToNumber(left) <= safeToNumber(right)
          case '>':
            return typeof left === 'string' && typeof right === 'string'
              ? left > right
              : safeToNumber(left) > safeToNumber(right)
          case '>=':
            return typeof left === 'string' && typeof right === 'string'
              ? left >= right
              : safeToNumber(left) >= safeToNumber(right)
          default:
            throw new MacroRuntimeError(
              `Unsupported binary operator "${node.operator}"`,
              'runtime_error',
              node.line,
              node.column,
            )
        }
      }
      case 'LogicalExpression': {
        const left = this.evalExpression(node.left, env)
        if (node.operator === '&&') {
          return left ? this.evalExpression(node.right, env) : left
        }
        if (node.operator === '||') {
          return left ? left : this.evalExpression(node.right, env)
        }
        if (node.operator === '??') {
          return left !== null && left !== undefined ? left : this.evalExpression(node.right, env)
        }
        throw new MacroRuntimeError(
          `Unsupported logical operator "${node.operator}"`,
          'runtime_error',
          node.line,
          node.column,
        )
      }
      case 'ConditionalExpression': {
        const cond = this.evalExpression(node.test, env)
        return cond
          ? this.evalExpression(node.consequent, env)
          : this.evalExpression(node.alternate, env)
      }
      case 'AssignmentExpression': {
        if (node.left.type === 'Identifier') {
          if (node.operator === '=') {
            const val = this.evalExpression(node.right, env)
            return env.set(node.left.name, val, node.left)
          }
          const cur = env.get(node.left.name, node.left)
          const rhs = this.evalExpression(node.right, env)
          const next = this.applyCompoundOp(node.operator, cur, rhs, node)
          return env.set(node.left.name, next, node.left)
        }
        const obj = this.evalExpression(node.left.object, env)
        const key = this.evalMemberKey(node.left, env)
        if (node.operator === '=') {
          const val = this.evalExpression(node.right, env)
          return this.writeProperty(obj, key, val, node.left)
        }
        const cur = this.readProperty(obj, key, node.left)
        const rhs = this.evalExpression(node.right, env)
        const next = this.applyCompoundOp(node.operator, cur, rhs, node)
        return this.writeProperty(obj, key, next, node.left)
      }
      case 'MemberExpression': {
        const obj = this.evalExpression(node.object, env)
        const key = this.evalMemberKey(node, env)
        return this.readProperty(obj, key, node)
      }
      case 'CallExpression': {
        const callee = this.evalExpression(node.callee, env)
        const args = new Array(node.arguments.length)
        for (let i = 0; i < node.arguments.length; i++) {
          args[i] = this.evalExpression(node.arguments[i], env)
        }
        return this.invoke(callee, args, node)
      }
      default:
        throw new MacroRuntimeError(
          `Unsupported expression type "${node.type}"`,
          'runtime_error',
          node.line,
          node.column,
        )
    }
  }
}

/**
 * Parse and synchronously execute a restricted macro script against explicitly
 * supplied host globals and bounded execution limits.
 */
export function runMacroScript(source, globals = undefined, options = undefined) {
  const limits = extractLimitsOption(options)
  const nowFn = options && options.now !== undefined ? options.now : () => Date.now()
  if (typeof nowFn !== 'function') {
    throw new TypeError('Macro option "now" must be a function')
  }

  const startTime =
    options && typeof options.startTime === 'number' && Number.isFinite(options.startTime)
      ? options.startTime
      : nowFn()
  const parsed = parseMacroScript(source, limits)
  if (!parsed.ok) {
    return {
      ok: false,
      code: parsed.code,
      error: parsed.error,
      line: parsed.line,
      column: parsed.column,
      steps: 0,
      elapsedMs: Math.max(0, nowFn() - startTime),
    }
  }

  const interpreter = new Interpreter(limits, nowFn)
  interpreter.startTime = startTime

  try {
    const rootEnv = new Environment(null, true)
    const builtins = buildBuiltinGlobals()
    for (const [name, value] of Object.entries(builtins)) {
      rootEnv.bindings[name] = { kind: 'global', value, initialized: true }
    }

    if (globals !== undefined && globals !== null) {
      if (typeof globals !== 'object' || Array.isArray(globals)) {
        throw new MacroRuntimeError('Macro globals must be a plain object', 'type_error', 1, 1)
      }
      const seen = new Set()
      for (const key of Object.keys(globals)) {
        if (FORBIDDEN_PROP_NAMES.has(key) || REJECTED_IDENTIFIERS.has(key)) {
          throw new MacroRuntimeError(
            `Forbidden global binding name "${key}"`,
            'forbidden_property',
            1,
            1,
          )
        }
        const wrapped = wrapGlobalValue(globals[key], limits, 0, seen)
        rootEnv.bindings[key] = { kind: 'global', value: wrapped, initialized: true }
      }
    }

    // Program runs inside a child scope of rootEnv so user top-level declarations
    // never mutate root bindings while still resolving globals cleanly.
    const programEnv = new Environment(rootEnv, true)
    const value = interpreter.evalProgram(parsed.ast, programEnv)
    return {
      ok: true,
      value,
      steps: interpreter.steps,
      elapsedMs: interpreter.elapsedMs(),
    }
  } catch (err) {
    if (err instanceof MacroRuntimeError || err instanceof MacroSyntaxError) {
      return {
        ok: false,
        code: err.code,
        error: err.message,
        line: err.line,
        column: err.column,
        steps: interpreter.steps,
        elapsedMs: interpreter.elapsedMs(),
      }
    }
    return {
      ok: false,
      code: 'runtime_error',
      error: err instanceof Error ? err.message : String(err),
      line: 1,
      column: 1,
      steps: interpreter.steps,
      elapsedMs: interpreter.elapsedMs(),
    }
  }
}
