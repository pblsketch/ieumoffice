/**
 * Pure bibliography import/export, document reference list rule parser,
 * and duplicate detection utilities for BibTeX, RIS, and CSL JSON.
 *
 * Node-compatible ES module with zero DOM, Electron, or editor dependencies.
 * All external input is treated as untrusted: bounded by size and entry count,
 * stripped of NUL/control bytes, and preserved strictly as inert plain strings.
 */

import {
  detectEntryLanguage,
  generateCitationKey,
  normalizeAuthor,
  normalizeBibEntry,
  sanitizeCitationKey,
} from './citation-styles.mjs'

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024
export const MAX_IMPORT_ENTRIES = 5000
export const BIBLIOGRAPHY_FORMATS = Object.freeze(['bibtex', 'ris', 'csl-json'])

// eslint-disable-next-line no-control-regex
const UNSAFE_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
// eslint-disable-next-line no-control-regex
const FIELD_CONTROL_RE = /[\u0000-\u001F\u007F]+/g
const FORMULA_PREFIX_RE = /^[=+\-@]/
const HANGUL_RE = /[\uAC00-\uD7A3]/
const FOUR_DIGIT_YEAR_RE = /\b(\d{4})\b/
const NON_ALNUM_UNICODE_RE = /[^\p{L}\p{N}]+/gu

const BIBTEX_MONTH_MACROS = Object.freeze({
  jan: 'January',
  feb: 'February',
  mar: 'March',
  apr: 'April',
  may: 'May',
  jun: 'June',
  jul: 'July',
  aug: 'August',
  sep: 'September',
  oct: 'October',
  nov: 'November',
  dec: 'December',
})

const BIBTEX_TYPE_MAP = Object.freeze({
  article: 'article',
  book: 'book',
  booklet: 'book',
  manual: 'book',
  incollection: 'chapter',
  inbook: 'chapter',
  phdthesis: 'thesis',
  mastersthesis: 'thesis',
  thesis: 'thesis',
  techreport: 'report',
  report: 'report',
  inproceedings: 'conference',
  conference: 'conference',
  proceedings: 'conference',
  online: 'webpage',
  electronic: 'webpage',
  www: 'webpage',
  webpage: 'webpage',
  misc: 'other',
  unpublished: 'other',
})

const VALID_BIBTEX_DIRECTIVES = new Set([
  'comment',
  'preamble',
  'string',
  ...Object.keys(BIBTEX_TYPE_MAP),
  'collection',
  'reference',
  'inreference',
  'patent',
  'periodical',
  'dataset',
  'software',
  'standard',
  'mvbook',
  'mvcollection',
  'mvproceedings',
  'mvreference',
  'suppbook',
  'suppcollection',
  'suppperiodical',
  'bookinbook',
  'review',
  'letter',
  'legislation',
  'jurisdiction',
  'legal',
  'video',
  'audio',
  'image',
  'artwork',
  'movie',
  'music',
  'performance',
  'xdata',
  'set',
])

const BIBTEX_VERBATIM_FIELDS = new Set(['url', 'doi', 'file', 'eprint', 'issn', 'isbn'])

const RIS_TYPE_MAP = Object.freeze({
  JOUR: 'article',
  EJOUR: 'article',
  JFULL: 'article',
  MGZN: 'article',
  NEWS: 'article',
  BOOK: 'book',
  EBOOK: 'book',
  EDBOOK: 'book',
  SER: 'book',
  CHAP: 'chapter',
  ECHAP: 'chapter',
  SECT: 'chapter',
  THES: 'thesis',
  RPRT: 'report',
  STAND: 'report',
  STAT: 'report',
  CONF: 'conference',
  CPAPER: 'conference',
  ELEC: 'webpage',
  ICOMM: 'webpage',
  BLOG: 'webpage',
  MULTI: 'webpage',
  GEN: 'other',
})

const ENTRY_TYPE_TO_RIS = Object.freeze({
  article: 'JOUR',
  book: 'BOOK',
  chapter: 'CHAP',
  thesis: 'THES',
  report: 'RPRT',
  conference: 'CONF',
  webpage: 'ELEC',
  other: 'GEN',
})

const CSL_TYPE_MAP = Object.freeze({
  'article-journal': 'article',
  article: 'article',
  'article-magazine': 'article',
  'article-newspaper': 'article',
  periodical: 'article',
  book: 'book',
  classic: 'book',
  chapter: 'chapter',
  entry: 'chapter',
  'entry-dictionary': 'chapter',
  'entry-encyclopedia': 'chapter',
  thesis: 'thesis',
  report: 'report',
  standard: 'report',
  legislation: 'report',
  regulation: 'report',
  'paper-conference': 'conference',
  speech: 'conference',
  webpage: 'webpage',
  'post-weblog': 'webpage',
  post: 'webpage',
  software: 'webpage',
  dataset: 'webpage',
  document: 'other',
})

const ENTRY_TYPE_TO_CSL = Object.freeze({
  article: 'article-journal',
  book: 'book',
  chapter: 'chapter',
  thesis: 'thesis',
  report: 'report',
  conference: 'paper-conference',
  webpage: 'webpage',
  other: 'document',
})

const LATEX_DIACRITICS = Object.freeze({
  '"': {
    a: '\u00E4',
    e: '\u00EB',
    i: '\u00EF',
    o: '\u00F6',
    u: '\u00FC',
    y: '\u00FF',
    A: '\u00C4',
    E: '\u00CB',
    I: '\u00CF',
    O: '\u00D6',
    U: '\u00DC',
  },
  "'": {
    a: '\u00E1',
    c: '\u0107',
    e: '\u00E9',
    i: '\u00ED',
    n: '\u0144',
    o: '\u00F3',
    s: '\u015B',
    u: '\u00FA',
    y: '\u00FD',
    z: '\u017A',
    A: '\u00C1',
    C: '\u0106',
    E: '\u00C9',
    I: '\u00CD',
    N: '\u0143',
    O: '\u00D3',
    S: '\u015A',
    U: '\u00DA',
    Y: '\u00DD',
    Z: '\u0179',
  },
  '`': {
    a: '\u00E0',
    e: '\u00E8',
    i: '\u00EC',
    o: '\u00F2',
    u: '\u00F9',
    A: '\u00C0',
    E: '\u00C8',
    I: '\u00CC',
    O: '\u00D2',
    U: '\u00D9',
  },
  '^': {
    a: '\u00E2',
    e: '\u00EA',
    i: '\u00EE',
    o: '\u00F4',
    u: '\u00FB',
    A: '\u00C2',
    E: '\u00CA',
    I: '\u00CE',
    O: '\u00D4',
    U: '\u00DB',
  },
  '~': {
    a: '\u00E3',
    n: '\u00F1',
    o: '\u00F5',
    A: '\u00C3',
    N: '\u00D1',
    O: '\u00D5',
  },
})

const ORG_KEYWORD_RE =
  /\b(?:organization|organisation|institute|ministry|university|association|committee|department|commission|council|foundation|agency|bureau|center|centre|society|academy|federation|board|office|authority|bank|fund|union|group|consortium)\b/i

function utf8ByteLength(str) {
  let bytes = 0
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // Surrogate pair encodes a 4-byte UTF-8 sequence.
      bytes += 4
      i += 1
    } else {
      bytes += 3
    }
  }
  return bytes
}

function resolveLimit(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback
}

function stripBomAndControlChars(text) {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  return withoutBom.replace(UNSAFE_CONTROL_RE, '').replace(/\r\n?/g, '\n')
}

function decodeImportInput(input, options = {}) {
  const maxBytes = resolveLimit(options.maxBytes, MAX_IMPORT_BYTES)
  const maxEntries = resolveLimit(options.maxEntries, MAX_IMPORT_ENTRIES)

  let rawText
  let actualBytes
  if (input instanceof Uint8Array) {
    actualBytes = input.byteLength
    if (actualBytes > maxBytes) {
      return {
        ok: false,
        reason: 'too_large',
        error: `Input exceeds maximum allowed size of ${maxBytes} bytes (got ${actualBytes} bytes).`,
        maxBytes,
        actualBytes,
      }
    }
    rawText = new TextDecoder('utf-8', { fatal: false }).decode(input)
  } else if (typeof input === 'string') {
    actualBytes = utf8ByteLength(input)
    if (actualBytes > maxBytes) {
      return {
        ok: false,
        reason: 'too_large',
        error: `Input exceeds maximum allowed size of ${maxBytes} bytes (got ${actualBytes} bytes).`,
        maxBytes,
        actualBytes,
      }
    }
    rawText = input
  } else {
    return {
      ok: false,
      reason: 'invalid_format',
      error: 'Input must be a UTF-8 string or Uint8Array.',
    }
  }

  const text = stripBomAndControlChars(rawText)
  if (!text.trim()) {
    return {
      ok: false,
      reason: 'empty',
      error: 'Input is empty.',
    }
  }

  return { ok: true, text, maxBytes, maxEntries, actualBytes }
}

/**
 * Sanitize an imported bibliographic field value by removing NUL bytes and
 * unsafe control characters while collapsing whitespace. Leading characters
 * such as `=`, `+`, `-`, and `@` are preserved verbatim as inert plain text
 * (never evaluated or executed).
 */
export function sanitizeImportedField(value) {
  if (value == null) return ''
  let str = String(value)
  if (str.charCodeAt(0) === 0xfeff) str = str.slice(1)
  return str
    .replace(UNSAFE_CONTROL_RE, '')
    .replace(FIELD_CONTROL_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Return true when `text` begins with a spreadsheet/formula-style prefix
 * (`=`, `+`, `-`, or `@`) after stripping control bytes and leading whitespace.
 */
export function hasFormulaPrefix(text) {
  if (typeof text !== 'string') return false
  const cleaned = sanitizeImportedField(text)
  return cleaned.length > 0 && FORMULA_PREFIX_RE.test(cleaned)
}

function sanitizeOptionalField(value) {
  const cleaned = sanitizeImportedField(value)
  return cleaned.length > 0 ? cleaned : undefined
}

function parseLanguageTag(raw) {
  const cleaned = sanitizeImportedField(raw).toLowerCase()
  if (!cleaned) return undefined
  if (
    cleaned === 'ko' ||
    cleaned === 'kor' ||
    cleaned === 'korean' ||
    cleaned.startsWith('ko-') ||
    cleaned.startsWith('ko_')
  ) {
    return 'ko'
  }
  if (
    cleaned === 'en' ||
    cleaned === 'eng' ||
    cleaned === 'english' ||
    cleaned.startsWith('en-') ||
    cleaned.startsWith('en_')
  ) {
    return 'en'
  }
  return undefined
}

function extractYearValue(raw) {
  const cleaned = sanitizeImportedField(raw)
  if (!cleaned) return undefined
  const match = FOUR_DIGIT_YEAR_RE.exec(cleaned)
  if (match) return match[1]
  const stripped = cleaned.replace(/\/+$/, '').trim()
  return stripped || undefined
}

function parseTagList(raw) {
  if (Array.isArray(raw)) {
    const out = []
    for (const item of raw) {
      const cleaned = sanitizeImportedField(item)
      if (cleaned) out.push(cleaned)
    }
    return out
  }
  const cleaned = sanitizeImportedField(raw)
  if (!cleaned) return []
  const delimiter = cleaned.includes(';') ? ';' : ','
  return cleaned
    .split(delimiter)
    .map((part) => sanitizeImportedField(part))
    .filter(Boolean)
}

function indexToAlphaSuffix(index) {
  let n = index
  let out = ''
  while (n >= 0) {
    out = String.fromCharCode(97 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  }
  return out
}

function allocateUniqueKey(rawKey, draft, usedKeys) {
  const sanitized = sanitizeCitationKey(rawKey)
  if (sanitized) {
    if (!usedKeys.has(sanitized)) {
      usedKeys.add(sanitized)
      return sanitized
    }
    for (let i = 0; ; i++) {
      const candidate = `${sanitized}${indexToAlphaSuffix(i)}`
      if (!usedKeys.has(candidate)) {
        usedKeys.add(candidate)
        return candidate
      }
    }
  }
  const generated = generateCitationKey(draft, usedKeys)
  usedKeys.add(generated)
  return generated
}

function allocateUniqueId(preferredId, key, usedIds) {
  const base = sanitizeOptionalField(preferredId) ?? `bib_${key}`
  if (!usedIds.has(base)) {
    usedIds.add(base)
    return base
  }
  let n = 2
  while (usedIds.has(`${base}_${n}`)) n += 1
  const allocated = `${base}_${n}`
  usedIds.add(allocated)
  return allocated
}

function buildNormalizedImportEntry(draft, rawKey, usedKeys, usedIds, source) {
  const key = allocateUniqueKey(rawKey, draft, usedKeys)
  const id = allocateUniqueId(undefined, key, usedIds)
  return normalizeBibEntry(
    {
      ...draft,
      id,
      key,
      verified: true,
      source,
    },
    { id, existingKeys: usedKeys, existingIds: usedIds },
  )
}

function filterEntriesByTag(entries, tag) {
  if (!Array.isArray(entries)) return []
  const normalizedTag = sanitizeOptionalField(tag)
  if (!normalizedTag) return entries
  return entries.filter((entry) => Array.isArray(entry?.tags) && entry.tags.includes(normalizedTag))
}

function isWrappedInSingleBracePair(str) {
  if (str.length < 2 || str[0] !== '{' || str[str.length - 1] !== '}') return false
  let depth = 0
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (ch === '\\' && i + 1 < str.length) {
      i += 1
      continue
    }
    if (ch === '{') {
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0 && i < str.length - 1) return false
    }
  }
  return depth === 0
}

function decodeBibTeXValue(raw) {
  if (typeof raw !== 'string') return ''
  let text = raw

  // Protect escaped literal braces before stripping grouping braces.
  text = text.replace(/\\\{/g, '\uE001').replace(/\\\}/g, '\uE002')

  // Decode accented letters: {\"o}, \"{o}, \"o, {\'e}, \'{e}, \'e, etc.
  text = text.replace(
    /\{\\(["'`^~])\{?([A-Za-z])\}?\}|\\(["'`^~])\{([A-Za-z])\}|\\(["'`^~])([A-Za-z])/g,
    (match, a1, c1, a2, c2, a3, c3) => {
      const accent = a1 ?? a2 ?? a3
      const ch = c1 ?? c2 ?? c3
      return LATEX_DIACRITICS[accent]?.[ch] ?? match
    },
  )

  // Decode cedilla and common Latin ligatures / symbols.
  text = text
    .replace(/\{\\c\{?([cC])\}?\}|\\c\{([cC])\}|\\c\s+([cC])/g, (_, a, b, c) =>
      (a ?? b ?? c) === 'C' ? '\u00C7' : '\u00E7',
    )
    .replace(/\{\\ss\}|\\ss\b/g, '\u00DF')
    .replace(/\{\\ae\}|\\ae\b/g, '\u00E6')
    .replace(/\{\\AE\}|\\AE\b/g, '\u00C6')
    .replace(/\{\\oe\}|\\oe\b/g, '\u0153')
    .replace(/\{\\OE\}|\\OE\b/g, '\u0152')
    .replace(/\{\\aa\}|\\aa\b/g, '\u00E5')
    .replace(/\{\\AA\}|\\AA\b/g, '\u00C5')
    .replace(/\{\\o\}|\\o\b/g, '\u00F8')
    .replace(/\{\\O\}|\\O\b/g, '\u00D8')
    .replace(/\{\\l\}|\\l\b/g, '\u0142')
    .replace(/\{\\L\}|\\L\b/g, '\u0141')

  // Decode common LaTeX punctuation escapes.
  text = text
    .replace(/\\&/g, '&')
    .replace(/\\%/g, '%')
    .replace(/\\\$/g, '$')
    .replace(/\\_/g, '_')
    .replace(/\\#/g, '#')
    .replace(/\\~\{\}/g, '~')
    .replace(/~/g, ' ')

  // Convert en-dash and em-dash sequences; normalize numeric page ranges and dashes.
  text = text.replace(/---/g, '\u2014').replace(/--/g, '-')

  // Strip remaining grouping braces, then restore escaped literal braces.
  text = text
    .replace(/[{}]/g, '')
    .replace(/\uE001/g, '{')
    .replace(/\uE002/g, '}')

  return sanitizeImportedField(text)
}

function decodeBibTeXVerbatimValue(raw) {
  if (typeof raw !== 'string') return ''
  // Preserve `~`, `--`, `---`, accents, and identifier/URL punctuation verbatim.
  // Only unescape literal braces escaped during BibTeX serialization.
  const text = raw.replace(/\\\{/g, '{').replace(/\\\}/g, '}')
  return sanitizeImportedField(text)
}

function decodeBibTeXField(fieldName, raw) {
  if (raw == null) return ''
  if (BIBTEX_VERBATIM_FIELDS.has(fieldName)) {
    return decodeBibTeXVerbatimValue(raw)
  }
  return decodeBibTeXValue(raw)
}

function splitBibTeXAuthorsTopLevel(raw) {
  const parts = []
  let depth = 0
  let start = 0
  let i = 0
  while (i < raw.length) {
    const ch = raw[i]
    if (ch === '\\' && i + 1 < raw.length) {
      i += 2
      continue
    }
    if (ch === '{') {
      depth += 1
      i += 1
      continue
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1)
      i += 1
      continue
    }
    if (depth === 0) {
      const slice = raw.slice(i)
      const match = /^\s+and\s+/i.exec(slice)
      if (match) {
        parts.push(raw.slice(start, i))
        i += match[0].length
        start = i
        continue
      }
    }
    i += 1
  }
  parts.push(raw.slice(start))
  return parts.map((p) => p.trim()).filter(Boolean)
}

function parseBibTeXAuthors(raw) {
  if (!raw || typeof raw !== 'string') return []
  const tokens = splitBibTeXAuthorsTopLevel(raw)
  const out = []
  for (const token of tokens) {
    if (isWrappedInSingleBracePair(token)) {
      const inner = decodeBibTeXValue(token.slice(1, -1))
      if (inner) out.push({ literal: inner, isOrganization: true })
      continue
    }
    const decoded = decodeBibTeXValue(token)
    if (!decoded) continue
    // Handle 3-part BibTeX form "Family, Jr., Given" cleanly.
    const commaParts = decoded.split(',').map((s) => s.trim())
    if (commaParts.length === 3 && commaParts[0] && commaParts[2]) {
      out.push({
        family: `${commaParts[0]}, ${commaParts[1]}`,
        given: commaParts[2],
      })
      continue
    }
    const normalized = normalizeAuthor(decoded)
    if (normalized) out.push(normalized)
  }
  return out
}

function skipWs(text, pos) {
  let i = pos
  while (i < text.length && /\s/.test(text[i])) i += 1
  return i
}

function readBalancedGroup(text, pos, openChar, closeChar) {
  if (text[pos] !== openChar) return null
  let depth = 1
  let i = pos + 1
  while (i < text.length && depth > 0) {
    const ch = text[i]
    if (ch === '\\' && i + 1 < text.length) {
      i += 2
      continue
    }
    if (ch === openChar) depth += 1
    else if (ch === closeChar) depth -= 1
    i += 1
  }
  if (depth !== 0) return { error: 'Unclosed brace in BibTeX input.' }
  return { content: text.slice(pos + 1, i - 1), next: i }
}

function readBibTeXValuePart(text, pos, macros) {
  const i = skipWs(text, pos)
  if (i >= text.length) return { error: 'Unexpected end of BibTeX field value.' }

  const ch = text[i]
  if (ch === '{') {
    const group = readBalancedGroup(text, i, '{', '}')
    if (!group || group.error) return { error: group?.error ?? 'Unclosed brace in BibTeX value.' }
    return { value: group.content, next: group.next }
  }

  if (ch === '"') {
    let depth = 0
    let j = i + 1
    while (j < text.length) {
      const cur = text[j]
      if (cur === '\\' && j + 1 < text.length) {
        j += 2
        continue
      }
      if (cur === '{') depth += 1
      else if (cur === '}') depth = Math.max(0, depth - 1)
      else if (cur === '"' && depth === 0) {
        return { value: text.slice(i + 1, j), next: j + 1 }
      }
      j += 1
    }
    return { error: 'Unclosed quoted string in BibTeX input.' }
  }

  // Bare number or @string macro token.
  let j = i
  while (j < text.length && /[A-Za-z0-9_.:/-]/.test(text[j])) j += 1
  if (j === i) return { error: `Unexpected character "${ch}" in BibTeX value.` }
  const token = text.slice(i, j)
  if (/^\d+$/.test(token)) {
    return { value: token, next: j }
  }
  const resolved = macros.get(token.toLowerCase())
  return { value: resolved ?? token, next: j }
}

function readBibTeXFieldValue(text, pos, macros) {
  const first = readBibTeXValuePart(text, pos, macros)
  if (first.error) return first
  let value = first.value
  let cur = skipWs(text, first.next)

  while (cur < text.length && text[cur] === '#') {
    const nextPart = readBibTeXValuePart(text, cur + 1, macros)
    if (nextPart.error) return nextPart
    value += nextPart.value
    cur = skipWs(text, nextPart.next)
  }

  return { value, next: cur }
}

/**
 * Parse a BibTeX (`.bib`) document into normalized `BibEntry` records.
 */
export function parseBibTeX(input, options = {}) {
  const decoded = decodeImportInput(input, options)
  if (!decoded.ok) {
    return {
      ok: false,
      reason: decoded.reason,
      error: decoded.error,
      ...(decoded.maxBytes != null ? { maxBytes: decoded.maxBytes } : {}),
      ...(decoded.actualBytes != null ? { actualBytes: decoded.actualBytes } : {}),
      entries: [],
      warnings: [],
    }
  }

  const { text, maxEntries } = decoded
  const warnings = []
  const entries = []
  const macros = new Map(Object.entries(BIBTEX_MONTH_MACROS))
  const usedKeys = new Set(options.existingKeys ?? [])
  const usedIds = new Set(options.existingIds ?? [])
  const source = options.source ?? 'import'

  let i = 0
  let sawAnyDirective = false
  let fatalError = null

  while (i < text.length) {
    const atIndex = text.indexOf('@', i)
    if (atIndex === -1) break
    i = atIndex + 1

    // Ignore `@` preceded by email/word characters (e.g. `contact@example.org`).
    if (atIndex > 0 && /[A-Za-z0-9._+-]/.test(text[atIndex - 1])) {
      continue
    }

    const typeStart = i
    while (i < text.length && /[A-Za-z0-9_-]/.test(text[i])) i += 1
    const rawType = text.slice(typeStart, i).toLowerCase()
    if (!rawType || !/^[a-z]/.test(rawType)) continue

    const afterWs = skipWs(text, i)
    const openChar = text[afterWs]
    if (openChar !== '{' && openChar !== '(') {
      if (rawType === 'comment') {
        const nl = text.indexOf('\n', afterWs)
        i = nl === -1 ? text.length : nl + 1
      }
      // Text outside `@type{...}` entries is treated as a comment per BibTeX rules.
      continue
    }

    if (!VALID_BIBTEX_DIRECTIVES.has(rawType)) {
      // Unrecognized `@word{...}` outside an entry is skipped as free-text commentary.
      continue
    }

    i = afterWs
    const closeChar = openChar === '{' ? '}' : ')'
    sawAnyDirective = true

    if (rawType === 'comment' || rawType === 'preamble') {
      const skipped = readBalancedGroup(text, i, openChar, closeChar)
      if (!skipped || skipped.error) {
        fatalError = skipped?.error ?? `Unclosed @${rawType} block.`
        break
      }
      i = skipped.next
      continue
    }

    if (rawType === 'string') {
      const group = readBalancedGroup(text, i, openChar, closeChar)
      if (!group || group.error) {
        fatalError = group?.error ?? 'Unclosed @string block.'
        break
      }
      const eqIdx = group.content.indexOf('=')
      if (eqIdx > 0) {
        const macroKey = group.content.slice(0, eqIdx).trim().toLowerCase()
        const parsedVal = readBibTeXFieldValue(group.content, eqIdx + 1, macros)
        if (parsedVal.error) {
          fatalError = parsedVal.error
          break
        }
        if (macroKey) macros.set(macroKey, parsedVal.value)
      }
      i = group.next
      continue
    }

    // Regular entry: @type{key, field = value, ...}
    i += 1
    i = skipWs(text, i)

    const keyStart = i
    while (i < text.length && text[i] !== ',' && text[i] !== closeChar && !/\s/.test(text[i])) {
      i += 1
    }
    const rawKey = text.slice(keyStart, i).trim()
    i = skipWs(text, i)

    if (i >= text.length) {
      fatalError = 'Unclosed BibTeX entry.'
      break
    }

    const fields = Object.create(null)
    if (text[i] === ',') {
      i += 1
      while (i < text.length) {
        i = skipWs(text, i)
        if (i >= text.length) {
          fatalError = 'Unclosed BibTeX entry.'
          break
        }
        if (text[i] === closeChar) {
          i += 1
          break
        }
        const nameStart = i
        while (i < text.length && /[A-Za-z0-9_:-]/.test(text[i])) i += 1
        const fieldName = text.slice(nameStart, i).toLowerCase()
        i = skipWs(text, i)
        if (!fieldName || text[i] !== '=') {
          fatalError = `Malformed field syntax in BibTeX entry "${rawKey || rawType}".`
          break
        }
        i += 1
        const parsedField = readBibTeXFieldValue(text, i, macros)
        if (parsedField.error) {
          fatalError = parsedField.error
          break
        }
        fields[fieldName] = parsedField.value
        i = skipWs(text, parsedField.next)
        if (text[i] === ',') {
          i += 1
        } else if (text[i] === closeChar) {
          i += 1
          break
        } else {
          fatalError = `Expected "," or "${closeChar}" in BibTeX entry "${rawKey || rawType}".`
          break
        }
      }
    } else if (text[i] === closeChar) {
      i += 1
    } else {
      fatalError = `Malformed header in BibTeX entry "${rawKey || rawType}".`
      break
    }

    if (fatalError) break

    if (entries.length >= maxEntries) {
      warnings.push(`Entry limit reached (${maxEntries}); remaining entries were skipped.`)
      break
    }

    const mappedType = BIBTEX_TYPE_MAP[rawType] ?? 'other'
    const authors = parseBibTeXAuthors(fields.author)
    const editors = parseBibTeXAuthors(fields.editor)
    const title = decodeBibTeXValue(fields.title ?? '')
    const containerRaw =
      mappedType === 'chapter' || mappedType === 'conference'
        ? (fields.booktitle ?? fields.journaltitle ?? fields.journal)
        : (fields.journaltitle ?? fields.journal ?? fields.booktitle)
    const containerTitle = containerRaw ? decodeBibTeXValue(containerRaw) : undefined
    const year = extractYearValue(
      fields.year ? decodeBibTeXValue(fields.year) : decodeBibTeXValue(fields.date ?? ''),
    )
    const volume = fields.volume ? decodeBibTeXValue(fields.volume) : undefined
    const issueRaw = fields.number ?? fields.issue
    const issue = issueRaw ? decodeBibTeXValue(issueRaw) : undefined
    const pages = fields.pages ? decodeBibTeXValue(fields.pages) : undefined
    const publisher = fields.publisher ? decodeBibTeXValue(fields.publisher) : undefined
    const placeRaw = fields.address ?? fields.location
    const place = placeRaw ? decodeBibTeXValue(placeRaw) : undefined
    const edition = fields.edition ? decodeBibTeXValue(fields.edition) : undefined
    const institutionRaw = fields.school ?? fields.institution
    const institution = institutionRaw ? decodeBibTeXValue(institutionRaw) : undefined
    let degree = fields.type ? decodeBibTeXValue(fields.type) : undefined
    const doi = fields.doi ? sanitizeOptionalField(decodeBibTeXField('doi', fields.doi)) : undefined
    const url = fields.url ? sanitizeOptionalField(decodeBibTeXField('url', fields.url)) : undefined
    const accessed = fields.urldate ? decodeBibTeXValue(fields.urldate) : undefined
    const language = parseLanguageTag(decodeBibTeXValue(fields.language ?? fields.langid ?? ''))
    const tags = fields.keywords ? parseTagList(decodeBibTeXValue(fields.keywords)) : []
    const memoRaw = fields.note ?? fields.annote
    const memo = memoRaw ? decodeBibTeXValue(memoRaw) : undefined

    const preliminaryLang = detectEntryLanguage({
      language,
      title,
      authors,
      editors,
      containerTitle,
      publisher,
      institution,
      place,
      degree,
    })

    if (!degree && rawType === 'phdthesis') {
      degree = preliminaryLang === 'ko' ? '박사학위논문' : 'Doctoral dissertation'
    } else if (!degree && rawType === 'mastersthesis') {
      degree = preliminaryLang === 'ko' ? '석사학위논문' : "Master's thesis"
    }

    const draft = {
      type: mappedType,
      authors,
      editors,
      year,
      title,
      containerTitle,
      volume,
      issue,
      pages,
      publisher,
      place,
      edition,
      degree,
      institution,
      doi,
      url,
      accessed,
      language,
      tags,
      memo,
    }

    entries.push(buildNormalizedImportEntry(draft, rawKey, usedKeys, usedIds, source))
  }

  if (fatalError) {
    return {
      ok: false,
      reason: 'invalid_format',
      error: fatalError,
      entries: [],
      warnings,
    }
  }

  if (entries.length === 0) {
    return {
      ok: false,
      reason: 'invalid_format',
      error: sawAnyDirective
        ? 'No bibliography entries found in BibTeX input.'
        : 'Input does not contain valid BibTeX entries.',
      entries: [],
      warnings,
    }
  }

  return { ok: true, entries, warnings }
}

function escapeBibTeXValue(value, preserveUrlChars = false) {
  const cleaned = sanitizeImportedField(value)
  let escaped = cleaned.replace(/\{/g, '\\{').replace(/\}/g, '\\}')
  if (!preserveUrlChars) {
    escaped = escaped.replace(/&/g, '\\&').replace(/%/g, '\\%')
  }
  return escaped
}

function formatBibTeXAuthor(author) {
  const norm = normalizeAuthor(author)
  if (!norm) return ''
  if (norm.isOrganization) {
    return `{${escapeBibTeXValue(norm.literal ?? '')}}`
  }
  if (norm.family && norm.given) {
    return `${escapeBibTeXValue(norm.family)}, ${escapeBibTeXValue(norm.given)}`
  }
  return escapeBibTeXValue(norm.literal ?? norm.family ?? norm.given ?? '')
}

function entryTypeToBibTeX(entry) {
  switch (entry.type) {
    case 'article':
      return 'article'
    case 'book':
      return 'book'
    case 'chapter':
      return 'incollection'
    case 'thesis':
      return entry.degree && /master|석사/i.test(entry.degree) ? 'mastersthesis' : 'phdthesis'
    case 'report':
      return 'techreport'
    case 'conference':
      return 'inproceedings'
    case 'webpage':
      return 'online'
    default:
      return 'misc'
  }
}

/**
 * Serialize `BibEntry` records to standard BibTeX (`.bib`) text.
 */
export function exportBibTeX(entries, options = {}) {
  const list = filterEntriesByTag(entries, options.tag)
  const blocks = []

  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const entry = normalizeBibEntry(raw)
    const bibType = entryTypeToBibTeX(entry)
    const lines = [`@${bibType}{${entry.key},`]

    const addField = (name, value, rawLiteral = false, preserveUrlChars = false) => {
      if (value == null) return
      const text = rawLiteral ? String(value) : escapeBibTeXValue(value, preserveUrlChars)
      if (!text) return
      lines.push(`  ${name} = {${text}},`)
    }

    if (entry.authors.length > 0) {
      const formatted = entry.authors.map(formatBibTeXAuthor).filter(Boolean).join(' and ')
      addField('author', formatted, true)
    }
    if (Array.isArray(entry.editors) && entry.editors.length > 0) {
      const formatted = entry.editors.map(formatBibTeXAuthor).filter(Boolean).join(' and ')
      addField('editor', formatted, true)
    }

    addField('title', entry.title)

    if (entry.containerTitle) {
      const containerKey =
        entry.type === 'chapter' || entry.type === 'conference' ? 'booktitle' : 'journal'
      addField(containerKey, entry.containerTitle)
    }

    addField('year', entry.year)
    addField('volume', entry.volume)
    addField('number', entry.issue)
    if (entry.pages) {
      const bibPages = escapeBibTeXValue(entry.pages).replace(/(\d)-(\d)/g, '$1--$2')
      addField('pages', bibPages, true)
    }
    addField('edition', entry.edition)
    addField('publisher', entry.publisher)
    addField('address', entry.place)
    if (entry.institution) {
      addField(entry.type === 'thesis' ? 'school' : 'institution', entry.institution)
    }
    addField('type', entry.degree)
    addField('doi', entry.doi, false, true)
    addField('url', entry.url, false, true)
    addField('urldate', entry.accessed)
    addField('language', entry.language)
    if (entry.tags.length > 0) {
      addField('keywords', entry.tags.join(', '))
    }
    addField('note', entry.memo)

    if (lines.length > 1) {
      lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, '')
    }
    lines.push('}')
    blocks.push(lines.join('\n'))
  }

  return blocks.join('\n\n')
}

const RIS_LINE_RE = /^([A-Z][A-Z0-9])\s{1,2}-(?:\s(.*))?$/
const RIS_KO_SINGLE_NAME_RE = /^[\uAC00-\uD7A3]{2,4}$/

/**
 * Parse a single RIS author/editor value (`AU`, `A1`, `ED`, `A2`):
 * - Strings containing a comma (`Smith, John`) are parsed as personal `{ family, given }`.
 * - Comma-less single Korean Hangul names (2-4 syllables) or single tokens keep personal `literal`.
 * - Comma-less multi-word strings (e.g. `World Health Organization`) are treated as
 *   organization authors (`{ literal, isOrganization: true }`) rather than split into family/given.
 */
function parseRisAuthor(raw) {
  const trimmed = sanitizeImportedField(raw)
  if (!trimmed) return null
  if (trimmed.includes(',')) {
    return normalizeAuthor(trimmed)
  }
  if (RIS_KO_SINGLE_NAME_RE.test(trimmed) || !/\s/.test(trimmed)) {
    return { literal: trimmed }
  }
  return { literal: trimmed, isOrganization: true }
}

function finalizeRisRecord(record, usedKeys, usedIds, source) {
  const rawType = sanitizeImportedField(record.TY?.[0] ?? '').toUpperCase()
  const type = RIS_TYPE_MAP[rawType] ?? 'other'

  const authorsRaw = record._authors ?? [...(record.AU ?? []), ...(record.A1 ?? [])]
  const editorsRaw = record._editors ?? [...(record.ED ?? []), ...(record.A2 ?? [])]
  const authors = authorsRaw.map(parseRisAuthor).filter(Boolean)
  const editors = editorsRaw.map(parseRisAuthor).filter(Boolean)

  const title = sanitizeImportedField(record.TI?.[0] ?? record.T1?.[0] ?? '')
  const containerTitle = sanitizeOptionalField(
    record.JF?.[0] ?? record.JO?.[0] ?? record.T2?.[0] ?? record.JA?.[0],
  )
  const year = extractYearValue(record.PY?.[0] ?? record.Y1?.[0])
  const volume = sanitizeOptionalField(record.VL?.[0])
  const issue = sanitizeOptionalField(record.IS?.[0])

  const sp = sanitizeOptionalField(record.SP?.[0])
  const ep = sanitizeOptionalField(record.EP?.[0])
  const pages = sp && ep ? `${sp}-${ep}` : sp || ep

  const pb = sanitizeOptionalField(record.PB?.[0])
  const publisher = type === 'thesis' ? undefined : pb
  const institution = type === 'thesis' ? pb : undefined
  const place = sanitizeOptionalField(record.CY?.[0])
  const edition = sanitizeOptionalField(record.ET?.[0])
  const degree = sanitizeOptionalField(record.M3?.[0])
  const doi = sanitizeOptionalField(record.DO?.[0])
  const url = sanitizeOptionalField(record.UR?.[0] ?? record.L2?.[0])
  const accessed = sanitizeOptionalField(record.Y2?.[0])
  const language = parseLanguageTag(record.LA?.[0])
  const tags = []
  for (const kw of record.KW ?? []) {
    for (const item of parseTagList(kw)) tags.push(item)
  }
  const memo =
    Array.isArray(record.N1) && record.N1.length > 0
      ? sanitizeOptionalField(record.N1.join(' '))
      : undefined
  const rawKey = sanitizeOptionalField(record.ID?.[0])

  const draft = {
    type,
    authors,
    editors,
    year,
    title,
    containerTitle,
    volume,
    issue,
    pages,
    publisher,
    place,
    edition,
    degree,
    institution,
    doi,
    url,
    accessed,
    language,
    tags,
    memo,
  }

  return buildNormalizedImportEntry(draft, rawKey, usedKeys, usedIds, source)
}

/**
 * Parse a RIS (`.ris`) document into normalized `BibEntry` records.
 */
export function parseRis(input, options = {}) {
  const decoded = decodeImportInput(input, options)
  if (!decoded.ok) {
    return {
      ok: false,
      reason: decoded.reason,
      error: decoded.error,
      ...(decoded.maxBytes != null ? { maxBytes: decoded.maxBytes } : {}),
      ...(decoded.actualBytes != null ? { actualBytes: decoded.actualBytes } : {}),
      entries: [],
      warnings: [],
    }
  }

  const { text, maxEntries } = decoded
  const lines = text.split('\n')
  const warnings = []
  const entries = []
  const usedKeys = new Set(options.existingKeys ?? [])
  const usedIds = new Set(options.existingIds ?? [])
  const source = options.source ?? 'import'

  let current = null
  let lastList = null
  let reachedLimit = false

  const pushCurrent = () => {
    if (!current) return
    if (entries.length >= maxEntries) {
      if (!reachedLimit) {
        warnings.push(`Entry limit reached (${maxEntries}); remaining entries were skipped.`)
        reachedLimit = true
      }
      current = null
      lastList = null
      return
    }
    entries.push(finalizeRisRecord(current, usedKeys, usedIds, source))
    current = null
    lastList = null
  }

  for (const rawLine of lines) {
    const trimmedRight = rawLine.trimEnd()
    const match = RIS_LINE_RE.exec(trimmedRight)
    if (match) {
      const tag = match[1]
      const value = sanitizeImportedField(match[2] ?? '')

      if (tag === 'TY') {
        if (current) {
          warnings.push('Encountered new RIS TY record before closing ER tag.')
          pushCurrent()
        }
        if (reachedLimit) break
        current = Object.create(null)
        current.TY = [value]
        current._authors = []
        current._editors = []
        lastList = current.TY
        continue
      }

      if (tag === 'ER') {
        pushCurrent()
        if (reachedLimit) break
        continue
      }

      if (!current) continue

      let targetList
      if (tag === 'AU' || tag === 'A1') {
        targetList = current._authors
      } else if (tag === 'ED' || tag === 'A2') {
        targetList = current._editors
      } else {
        if (!current[tag]) current[tag] = []
        targetList = current[tag]
      }
      if (value) {
        targetList.push(value)
      }
      lastList = targetList
      continue
    }

    // Continuation line inside an open record.
    const continuation = sanitizeImportedField(rawLine)
    if (current && lastList && continuation) {
      if (lastList.length > 0) {
        lastList[lastList.length - 1] = `${lastList[lastList.length - 1]} ${continuation}`
      } else {
        lastList.push(continuation)
      }
    }
  }

  if (current && !reachedLimit) {
    warnings.push('RIS record reached end of file without a closing ER tag.')
    pushCurrent()
  }

  if (entries.length === 0) {
    return {
      ok: false,
      reason: 'invalid_format',
      error: 'Input does not contain valid RIS records.',
      entries: [],
      warnings,
    }
  }

  return { ok: true, entries, warnings }
}

/**
 * Format an author for RIS `AU`/`ED` tags.
 * Organization authors are exported without a comma (`World Health Organization`)
 * so `parseRis` roundtrips `isOrganization: true`, whereas personal `{ family, given }`
 * authors are exported with a comma (`Smith, John`) so they roundtrip as personal.
 */
function formatRisAuthor(author) {
  const norm = normalizeAuthor(author)
  if (!norm) return ''
  if (norm.isOrganization || (norm.literal && !norm.family && !norm.given)) {
    return sanitizeImportedField(norm.literal ?? '')
  }
  if (norm.family && norm.given) {
    return `${sanitizeImportedField(norm.family)}, ${sanitizeImportedField(norm.given)}`
  }
  return sanitizeImportedField(norm.family ?? norm.given ?? norm.literal ?? '')
}

/**
 * Serialize `BibEntry` records to standard RIS (`.ris`) text.
 */
export function exportRis(entries, options = {}) {
  const list = filterEntriesByTag(entries, options.tag)
  const eol = options.lineEnding === '\r\n' ? '\r\n' : '\n'
  const blocks = []

  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const entry = normalizeBibEntry(raw)
    const lines = []
    const pushTag = (tag, value) => {
      const cleaned = sanitizeImportedField(value)
      if (cleaned) lines.push(`${tag}  - ${cleaned}`)
    }

    pushTag('TY', ENTRY_TYPE_TO_RIS[entry.type] ?? 'GEN')
    pushTag('ID', entry.key)

    for (const author of entry.authors) {
      pushTag('AU', formatRisAuthor(author))
    }
    for (const editor of entry.editors ?? []) {
      pushTag('ED', formatRisAuthor(editor))
    }

    pushTag('TI', entry.title)
    if (entry.containerTitle) {
      pushTag(entry.type === 'article' ? 'JF' : 'T2', entry.containerTitle)
    }
    pushTag('PY', entry.year)
    pushTag('VL', entry.volume)
    pushTag('IS', entry.issue)

    if (entry.pages) {
      const rangeMatch = /^([^\s-–—]+)\s*[-–—]\s*([^\s-–—]+)$/.exec(entry.pages)
      if (rangeMatch) {
        pushTag('SP', rangeMatch[1])
        pushTag('EP', rangeMatch[2])
      } else {
        pushTag('SP', entry.pages)
      }
    }

    pushTag(
      'PB',
      entry.type === 'thesis'
        ? (entry.institution ?? entry.publisher)
        : (entry.publisher ?? entry.institution),
    )
    pushTag('CY', entry.place)
    pushTag('ET', entry.edition)
    pushTag('M3', entry.degree)
    pushTag('DO', entry.doi)
    pushTag('UR', entry.url)
    pushTag('Y2', entry.accessed)
    pushTag('LA', entry.language)

    for (const tag of entry.tags) {
      pushTag('KW', tag)
    }
    pushTag('N1', entry.memo)
    lines.push('ER  - ')

    blocks.push(lines.join(eol))
  }

  return blocks.join(`${eol}${eol}`)
}

function parseCslPerson(item) {
  if (typeof item === 'string') {
    return normalizeAuthor(sanitizeImportedField(item))
  }
  if (!item || typeof item !== 'object') return null

  const literal = sanitizeOptionalField(item.literal)
  const familyBase = sanitizeOptionalField(item.family)
  const given = sanitizeOptionalField(item.given)
  const particle = sanitizeOptionalField(item['non-dropping-particle'] ?? item['dropping-particle'])
  const family = particle && familyBase ? `${particle} ${familyBase}` : familyBase

  if (literal && !family && !given) {
    if (
      item.isOrganization === true ||
      (!HANGUL_RE.test(literal) && ORG_KEYWORD_RE.test(literal))
    ) {
      return { literal, isOrganization: true }
    }
    return { literal }
  }

  if (family || given) {
    const out = {}
    if (family) out.family = family
    if (given) out.given = given
    return out
  }

  return null
}

function parseCslYear(issued) {
  if (!issued) return undefined
  if (typeof issued === 'string' || typeof issued === 'number') {
    return extractYearValue(issued)
  }
  if (typeof issued !== 'object') return undefined
  const dateParts = issued['date-parts']
  if (Array.isArray(dateParts) && Array.isArray(dateParts[0]) && dateParts[0].length > 0) {
    const y = sanitizeImportedField(dateParts[0][0])
    if (y) return y
  }
  return extractYearValue(issued.raw ?? issued.literal)
}

function parseCslDate(dateObj) {
  if (!dateObj) return undefined
  if (typeof dateObj === 'string') return sanitizeOptionalField(dateObj)
  if (typeof dateObj !== 'object') return undefined
  const dateParts = dateObj['date-parts']
  if (Array.isArray(dateParts) && Array.isArray(dateParts[0]) && dateParts[0].length > 0) {
    const parts = dateParts[0].map((n, idx) => {
      const s = sanitizeImportedField(n)
      return idx > 0 && /^\d$/.test(s) ? `0${s}` : s
    })
    return parts.filter(Boolean).join('-') || undefined
  }
  return sanitizeOptionalField(dateObj.raw ?? dateObj.literal)
}

function extractCslTextValue(raw, preferredLang) {
  if (raw == null) return ''
  if (typeof raw === 'string' || typeof raw === 'number') {
    return sanitizeImportedField(raw)
  }
  if (Array.isArray(raw)) {
    for (const element of raw) {
      const extracted = extractCslTextValue(element, preferredLang)
      if (extracted) return extracted
    }
    return ''
  }
  if (typeof raw === 'object') {
    for (const key of ['value', '#text', 'text', 'literal', 'raw']) {
      if (Object.prototype.hasOwnProperty.call(raw, key) && raw[key] != null) {
        const extracted = extractCslTextValue(raw[key], preferredLang)
        if (extracted) return extracted
      }
    }
    const langPriority =
      preferredLang === 'ko'
        ? ['ko', 'ko-KR', 'en', 'en-US', 'en-GB']
        : ['en', 'en-US', 'en-GB', 'ko', 'ko-KR']
    for (const langKey of langPriority) {
      if (Object.prototype.hasOwnProperty.call(raw, langKey) && raw[langKey] != null) {
        const extracted = extractCslTextValue(raw[langKey], preferredLang)
        if (extracted) return extracted
      }
    }
    for (const val of Object.values(raw)) {
      const extracted = extractCslTextValue(val, preferredLang)
      if (extracted) return extracted
    }
    return ''
  }
  return ''
}

function looksLikeCslItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false
  return (
    'title' in item ||
    'author' in item ||
    'editor' in item ||
    'type' in item ||
    'DOI' in item ||
    'doi' in item ||
    'URL' in item ||
    'url' in item ||
    'container-title' in item ||
    'issued' in item
  )
}

/**
 * Parse a CSL JSON (`.json`) array or `{ items / references: [...] }` container
 * into normalized `BibEntry` records.
 */
export function parseCslJson(input, options = {}) {
  const decoded = decodeImportInput(input, options)
  if (!decoded.ok) {
    return {
      ok: false,
      reason: decoded.reason,
      error: decoded.error,
      ...(decoded.maxBytes != null ? { maxBytes: decoded.maxBytes } : {}),
      ...(decoded.actualBytes != null ? { actualBytes: decoded.actualBytes } : {}),
      entries: [],
      warnings: [],
    }
  }

  let parsed
  try {
    parsed = JSON.parse(decoded.text)
  } catch {
    return {
      ok: false,
      reason: 'invalid_format',
      error: 'Input is not valid JSON.',
      entries: [],
      warnings: [],
    }
  }

  let items = null
  if (Array.isArray(parsed)) {
    items = parsed
  } else if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.items)) items = parsed.items
    else if (Array.isArray(parsed.references)) items = parsed.references
  }

  if (!items) {
    return {
      ok: false,
      reason: 'invalid_format',
      error: 'Expected a CSL JSON array or object with an "items" or "references" array.',
      entries: [],
      warnings: [],
    }
  }

  const warnings = []
  const entries = []
  const usedKeys = new Set(options.existingKeys ?? [])
  const usedIds = new Set(options.existingIds ?? [])
  const source = options.source ?? 'import'
  const { maxEntries } = decoded

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx]
    if (!looksLikeCslItem(item)) {
      warnings.push(`Skipped invalid CSL JSON item at index ${idx}.`)
      continue
    }

    if (entries.length >= maxEntries) {
      warnings.push(`Entry limit reached (${maxEntries}); remaining entries were skipped.`)
      break
    }

    const rawType = sanitizeImportedField(item.type).toLowerCase()
    const type = CSL_TYPE_MAP[rawType] ?? 'other'
    const language = parseLanguageTag(item.language)
    const authors = Array.isArray(item.author)
      ? item.author.map(parseCslPerson).filter(Boolean)
      : []
    const editors = Array.isArray(item.editor)
      ? item.editor.map(parseCslPerson).filter(Boolean)
      : []
    const title = extractCslTextValue(item.title, language)
    const containerTitle = extractCslTextValue(item['container-title'], language) || undefined
    const year = parseCslYear(item.issued)
    const volume = sanitizeOptionalField(item.volume)
    const issue = sanitizeOptionalField(item.issue)
    const pages = sanitizeOptionalField(item.page)
    const rawPublisher = sanitizeOptionalField(item.publisher)
    const rawAuthority = sanitizeOptionalField(item.authority)
    const publisher = type === 'thesis' ? undefined : rawPublisher
    const institution = type === 'thesis' ? (rawAuthority ?? rawPublisher) : rawAuthority
    const place = sanitizeOptionalField(item['publisher-place'])
    const edition = sanitizeOptionalField(item.edition)
    const degree = sanitizeOptionalField(item.genre)
    const doi = sanitizeOptionalField(item.DOI ?? item.doi)
    const url = sanitizeOptionalField(item.URL ?? item.url)
    const accessed = parseCslDate(item.accessed)
    const memo = sanitizeOptionalField(item.note)
    const tags = parseTagList(item.tags ?? item.keyword)
    const rawKey = sanitizeOptionalField(item['citation-key'] ?? item.id)

    const draft = {
      type,
      authors,
      editors,
      year,
      title,
      containerTitle,
      volume,
      issue,
      pages,
      publisher,
      place,
      edition,
      degree,
      institution,
      doi,
      url,
      accessed,
      language,
      tags,
      memo,
    }

    entries.push(buildNormalizedImportEntry(draft, rawKey, usedKeys, usedIds, source))
  }

  if (entries.length === 0) {
    return {
      ok: false,
      reason: 'invalid_format',
      error: 'No valid CSL JSON bibliography items found.',
      entries: [],
      warnings,
    }
  }

  return { ok: true, entries, warnings }
}

function formatCslPerson(author) {
  const norm = normalizeAuthor(author)
  if (!norm) return null
  if (norm.isOrganization || (norm.literal && !norm.family && !norm.given)) {
    return { literal: norm.literal ?? '' }
  }
  const out = {}
  if (norm.family) out.family = norm.family
  if (norm.given) out.given = norm.given
  return out
}

function formatCslDateObject(value) {
  const cleaned = sanitizeOptionalField(value)
  if (!cleaned) return undefined
  const isoMatch = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(cleaned)
  if (isoMatch) {
    const parts = [Number(isoMatch[1])]
    if (isoMatch[2]) parts.push(Number(isoMatch[2]))
    if (isoMatch[3]) parts.push(Number(isoMatch[3]))
    return { 'date-parts': [parts] }
  }
  return { literal: cleaned }
}

/**
 * Serialize `BibEntry` records to a standard CSL JSON array string.
 */
export function exportCslJson(entries, options = {}) {
  const list = filterEntriesByTag(entries, options.tag)
  const items = []

  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const entry = normalizeBibEntry(raw)
    const item = {
      id: entry.key,
      'citation-key': entry.key,
      type: ENTRY_TYPE_TO_CSL[entry.type] ?? 'document',
    }

    if (entry.title) item.title = entry.title
    if (entry.authors.length > 0) {
      item.author = entry.authors.map(formatCslPerson).filter(Boolean)
    }
    if (Array.isArray(entry.editors) && entry.editors.length > 0) {
      item.editor = entry.editors.map(formatCslPerson).filter(Boolean)
    }
    if (entry.year) item.issued = formatCslDateObject(entry.year)
    if (entry.containerTitle) item['container-title'] = entry.containerTitle
    if (entry.volume) item.volume = entry.volume
    if (entry.issue) item.issue = entry.issue
    if (entry.pages) item.page = entry.pages

    if (entry.type === 'thesis') {
      if (entry.institution ?? entry.publisher) {
        item.publisher = entry.institution ?? entry.publisher
      }
    } else {
      if (entry.publisher) item.publisher = entry.publisher
      if (entry.institution) item.authority = entry.institution
    }

    if (entry.place) item['publisher-place'] = entry.place
    if (entry.edition) item.edition = entry.edition
    if (entry.degree) item.genre = entry.degree
    if (entry.doi) item.DOI = entry.doi
    if (entry.url) item.URL = entry.url
    if (entry.accessed) item.accessed = formatCslDateObject(entry.accessed)
    if (entry.language) item.language = entry.language
    if (entry.tags.length > 0) item.keyword = entry.tags.join(', ')
    if (entry.memo) item.note = entry.memo

    items.push(item)
  }

  return JSON.stringify(items, null, 2)
}

/**
 * Auto-detect bibliography format (`'bibtex'`, `'ris'`, `'csl-json'`, or `null`)
 * from an optional filename extension and content sniffing.
 */
export function detectBibliographyFormat(input, filename) {
  if (typeof filename === 'string' && filename.trim()) {
    const lower = filename.trim().toLowerCase()
    if (lower.endsWith('.bib') || lower.endsWith('.bibtex')) return 'bibtex'
    if (lower.endsWith('.ris')) return 'ris'
    if (lower.endsWith('.csl.json') || lower.endsWith('.csl') || lower.endsWith('.json')) {
      return 'csl-json'
    }
  }

  let sample
  if (input instanceof Uint8Array) {
    sample = new TextDecoder('utf-8', { fatal: false }).decode(input.subarray(0, 8192))
  } else if (typeof input === 'string') {
    sample = input.slice(0, 8192)
  } else {
    return null
  }

  const trimmed = stripBomAndControlChars(sample).trim()
  if (!trimmed) return null

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return 'csl-json'
  }
  if (/^\s*TY\s{1,2}-/m.test(trimmed)) {
    return 'ris'
  }
  if (/(?:^|[^A-Za-z0-9._+-])@[A-Za-z][A-Za-z0-9_-]*\s*[{(]/.test(trimmed)) {
    return 'bibtex'
  }

  return null
}

/**
 * Detect format (or use `options.format`) and parse a bibliography file.
 */
export function parseBibliographyFile(input, options = {}) {
  const decoded = decodeImportInput(input, options)
  if (!decoded.ok) {
    return {
      ok: false,
      format: null,
      reason: decoded.reason,
      error: decoded.error,
      ...(decoded.maxBytes != null ? { maxBytes: decoded.maxBytes } : {}),
      ...(decoded.actualBytes != null ? { actualBytes: decoded.actualBytes } : {}),
      entries: [],
      warnings: [],
    }
  }

  const format = options.format ?? detectBibliographyFormat(decoded.text, options.filename)
  if (format === 'bibtex') {
    return { ...parseBibTeX(decoded.text, options), format }
  }
  if (format === 'ris') {
    return { ...parseRis(decoded.text, options), format }
  }
  if (format === 'csl-json') {
    return { ...parseCslJson(decoded.text, options), format }
  }

  return {
    ok: false,
    format: null,
    reason: 'invalid_format',
    error: 'Unable to detect a supported bibliography format (BibTeX, RIS, or CSL JSON).',
    entries: [],
    warnings: [],
  }
}

/**
 * Export `BibEntry` records in the requested format (`'bibtex'`, `'ris'`, or `'csl-json'`).
 */
export function exportBibliography(entries, format, options = {}) {
  if (format === 'bibtex') return exportBibTeX(entries, options)
  if (format === 'ris') return exportRis(entries, options)
  if (format === 'csl-json') return exportCslJson(entries, options)
  throw new RangeError(`Unsupported bibliography export format: ${String(format)}`)
}

// ---------------------------------------------------------------------------
// Document Reference List Rule Parser
// ---------------------------------------------------------------------------

const LEADING_NUMBER_RE = /^(?:\[\d+\]|\(\d+\)|\d+[.)])\s+/
const INLINE_DOI_URL_RE = /https?:\/\/(?:dx\.)?doi\.org\/([^\s,;)\]]+)/i
const INLINE_DOI_PREFIX_RE = /\bdoi:\s*([^\s,;)\]]+)/i
const INLINE_URL_RE = /https?:\/\/[^\s<>)\]]+/i
const KO_THESIS_RE = /(박사\s*학위\s*논문|석사\s*학위\s*논문|학위\s*논문)/
const EN_THESIS_RE =
  /(?:unpublished\s+)?(?:doctoral\s+dissertation|ph\.?\s*d\.?\s*(?:dissertation|thesis)|master'?s\s+thesis)/i
const AUTHOR_DATE_PAREN_RE = /^(.+?)\s*\((\d{4})[a-z]?(?:,\s*[^)]+)?\)\.?\s+(.+)$/
const CHICAGO_AUTHOR_YEAR_RE = /^(.+?)\.\s+(\d{4})[a-z]?\.\s+(.+)$/
const IEEE_QUOTED_RE = /^(.+?),\s*["\u201C](.+?)["\u201D]\s*(.+)$/
const MLA_QUOTED_RE = /^(.+?)\.\s+["\u201C](.+?)["\u201D]\s+(.+)$/
const JOURNAL_VOL_ISSUE_PAGES_RE =
  /^(.+?)(?:,\s*|\s+)(\d+)\s*\(([^)]+)\)\s*(?:,\s*|:\s*)([\dA-Za-z]+(?:\s*[-–—]\s*[\dA-Za-z]+)?)\.?$/
const JOURNAL_VOL_PAGES_RE =
  /^(.+?),\s*(\d+)\s*(?:,\s*|:\s*)([\dA-Za-z]+(?:\s*[-–—]\s*[\dA-Za-z]+)?)\.?$/
const JOURNAL_VOL_ISSUE_ONLY_RE = /^(.+?)(?:,\s*|\s+)(\d+)\s*\(([^)]+)\)\.?$/
const EXPLICIT_VOL_NO_PP_RE =
  /^(.+?),\s*vol\.\s*(\d+)(?:,\s*no\.\s*([^,]+))?(?:,\s*(?:(\d{4}),\s*)?(?:pp?\.\s*([\dA-Za-z]+(?:\s*[-–—]\s*[\dA-Za-z]+)?)))?(?:,\s*(\d{4}))?\.?$/i

function stripTrailingPunct(str) {
  return str.replace(/[.,;:\s]+$/, '').trim()
}

function extractTrailingIdentifiers(line) {
  let working = line
  let doi
  let url

  const doiUrlMatch = INLINE_DOI_URL_RE.exec(working)
  if (doiUrlMatch) {
    doi = doiUrlMatch[1].replace(/[.,;]+$/, '')
    working = `${working.slice(0, doiUrlMatch.index)} ${working.slice(doiUrlMatch.index + doiUrlMatch[0].length)}`
  } else {
    const doiPrefixMatch = INLINE_DOI_PREFIX_RE.exec(working)
    if (doiPrefixMatch) {
      doi = doiPrefixMatch[1].replace(/[.,;]+$/, '')
      working = `${working.slice(0, doiPrefixMatch.index)} ${working.slice(doiPrefixMatch.index + doiPrefixMatch[0].length)}`
    }
  }

  const urlMatch = INLINE_URL_RE.exec(working)
  if (urlMatch) {
    url = urlMatch[0].replace(/[.,;]+$/, '')
    working = `${working.slice(0, urlMatch.index)} ${working.slice(urlMatch.index + urlMatch[0].length)}`
  }

  return {
    text: working.replace(/\s+/g, ' ').trim(),
    doi: sanitizeOptionalField(doi),
    url: sanitizeOptionalField(url),
  }
}

function parseDocumentAuthors(raw, styleHint) {
  const cleaned = sanitizeImportedField(raw)
  if (!cleaned) return { authors: [], isEditor: false }

  let isEditor = false
  let working = cleaned
  if (/\((?:편|엮음|eds?\.?)\)$/i.test(working)) {
    isEditor = true
    working = working.replace(/\s*\((?:편|엮음|eds?\.?)\)$/i, '').trim()
  }

  if (HANGUL_RE.test(working)) {
    const tokens = working
      .split(/\s*[,·ㆍ&]\s*|\s+(?:및|and)\s+/i)
      .map((s) => s.replace(/\.+$/, '').trim())
      .filter(Boolean)
    return {
      authors: tokens.map((t) => normalizeAuthor(t)).filter(Boolean),
      isEditor,
    }
  }

  // IEEE style uses natural order ("J. A. Smith, B. Doe, and C. Lee").
  if (styleHint === 'ieee') {
    const normalized = working.replace(/,\s+and\s+/gi, ', ').replace(/\s+and\s+/gi, ', ')
    const tokens = normalized
      .split(/\s*,\s*/)
      .map((s) => s.trim())
      .filter(Boolean)
    return {
      authors: tokens.map((t) => normalizeAuthor(t)).filter(Boolean),
      isEditor,
    }
  }

  // APA / Chicago / MLA style: split inverted lists like "Smith, J. A., & Doe, B."
  // or "Smith, John, and Jane Doe".
  if (working.includes(',')) {
    const chunks = []
    // First split on ", & " or ", and " or " & "
    const primaryParts = working.split(/,\s*(?:&|and)\s+|\s+&\s+/i)
    for (const part of primaryParts) {
      // Within a part, multiple APA inverted authors appear as "Smith, J. A., Doe, B."
      // Split after a dotted initial followed by a comma and a new surname.
      const subParts = part.split(/(?<=\.)\s*,\s*(?=[A-Z])/)
      for (const sub of subParts) {
        const trimmed = sub.trim()
        if (trimmed) chunks.push(trimmed)
      }
    }
    return {
      authors: chunks.map((t) => normalizeAuthor(t)).filter(Boolean),
      isEditor,
    }
  }

  if (ORG_KEYWORD_RE.test(working)) {
    const orgName = working.replace(/\.+$/, '').trim()
    return {
      authors: orgName ? [{ literal: orgName, isOrganization: true }] : [],
      isEditor,
    }
  }

  // Strip trailing sentence period from non-initial author tokens (e.g. "UNESCO." or "United Nations.").
  const cleanedSingle = /(?:^|\s)[A-Za-z]\.$/.test(working)
    ? working
    : working.replace(/\.+$/, '').trim()
  const single = normalizeAuthor(cleanedSingle)
  return { authors: single ? [single] : [], isEditor }
}

function splitFirstSentence(text) {
  const cleaned = text.trim()
  if (!cleaned) return { first: '', rest: '' }

  // Quoted title at start: "Title." Rest or "Title," Rest
  const quotedMatch = /^["\u201C](.+?)["\u201D]\s*(.*)$/.exec(cleaned)
  if (quotedMatch) {
    return {
      first: stripTrailingPunct(quotedMatch[1]),
      rest: quotedMatch[2].trim(),
      quoted: true,
    }
  }

  // Find first sentence terminator (. ? !) followed by whitespace or end, skipping
  // single-letter initials and common abbreviations.
  const abbrRe = /(?:^|\s)(?:dr|mr|mrs|ms|prof|vol|no|pp?|ed|eds|st|u\.s|et al)$/i
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]
    if (ch !== '.' && ch !== '?' && ch !== '!') continue
    const next = cleaned[i + 1]
    if (next !== undefined && !/\s/.test(next)) continue
    const before = cleaned.slice(0, i)
    if (ch === '.' && (abbrRe.test(before) || /(?:^|\s)[A-Za-z]$/.test(before))) {
      continue
    }
    return {
      first: cleaned.slice(0, i).trim(),
      rest: cleaned.slice(i + 1).trim(),
      quoted: false,
    }
  }

  return { first: stripTrailingPunct(cleaned), rest: '', quoted: false }
}

function looksLikeBookChapterTail(sourcePart) {
  if (!sourcePart) return false
  // APA / Chicago / IEEE / MLA chapter-in-edited-book patterns that the rule parser
  // cannot cleanly split into chapter + container + editors + publisher.
  if (/^In\s+.+\((?:Eds?\.?)\)/i.test(sourcePart)) return true
  if (/^In\s+.+\(\s*pp?\.\s*\d+/i.test(sourcePart)) return true
  if (/^in\s+.+,\s*(?:Eds?\.?)\b/i.test(sourcePart)) return true
  if (/\bedited\s+by\b/i.test(sourcePart)) return true
  if (/(?:\(편\)|\(엮음\)|\s편)\s*,/.test(sourcePart)) return true
  if (/\(\s*\d+(?:\s*[-–—]\s*\d+)?\s*쪽\s*\)/.test(sourcePart)) return true
  return false
}

function parseSourceTail(sourcePart, titleWasQuoted, hasUrl, hasDoi) {
  const cleaned = stripTrailingPunct(sourcePart)
  if (!cleaned) {
    return { type: hasUrl && !hasDoi ? 'webpage' : 'other' }
  }

  if (looksLikeBookChapterTail(cleaned)) {
    return { unparsedReason: 'chapter_format_requires_review' }
  }

  // Korean thesis: "박사학위논문, 한국대학교" or "한국대학교 박사학위논문"
  const koThesis = KO_THESIS_RE.exec(cleaned)
  if (koThesis) {
    const degree = koThesis[1].replace(/\s+/g, '')
    const withoutDegree = cleaned
      .replace(KO_THESIS_RE, '')
      .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '')
      .trim()
    return {
      type: 'thesis',
      degree,
      institution: withoutDegree || undefined,
    }
  }

  // English thesis: "[Doctoral dissertation, Stanford University]" or "Doctoral dissertation, Stanford University"
  const enThesis = EN_THESIS_RE.exec(cleaned)
  if (enThesis) {
    const degree = enThesis[0].trim()
    const unwrapped = cleaned.replace(/^\[|\]$/g, '')
    const withoutDegree = unwrapped
      .replace(EN_THESIS_RE, '')
      .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '')
      .trim()
    return {
      type: 'thesis',
      degree,
      institution: withoutDegree || undefined,
    }
  }

  // Explicit "Journal, vol. 12, no. 3, pp. 45-67" (IEEE/MLA)
  const explicitMatch = EXPLICIT_VOL_NO_PP_RE.exec(cleaned)
  if (explicitMatch) {
    const containerRaw = explicitMatch[1].trim()
    const isConf = /^(?:in\s+)?(?:proc\.|proceedings)/i.test(containerRaw)
    return {
      type: isConf ? 'conference' : 'article',
      containerTitle: containerRaw.replace(/^in\s+/i, '').trim(),
      volume: explicitMatch[2],
      issue: explicitMatch[3]?.trim() || undefined,
      pages: explicitMatch[5]?.replace(/[–—]/g, '-').replace(/\s+/g, '') || undefined,
      year: explicitMatch[4] ?? explicitMatch[6],
    }
  }

  // "Journal Name, 12(3), 45-67" or "Journal Name 12 (3): 45-67"
  const vipMatch = JOURNAL_VOL_ISSUE_PAGES_RE.exec(cleaned)
  if (vipMatch) {
    return {
      type: 'article',
      containerTitle: stripTrailingPunct(vipMatch[1]),
      volume: vipMatch[2],
      issue: vipMatch[3].trim(),
      pages: vipMatch[4].replace(/[–—]/g, '-').replace(/\s+/g, ''),
    }
  }

  // "Journal Name, 12, 45-67"
  const vpMatch = JOURNAL_VOL_PAGES_RE.exec(cleaned)
  if (vpMatch) {
    return {
      type: 'article',
      containerTitle: stripTrailingPunct(vpMatch[1]),
      volume: vpMatch[2],
      pages: vpMatch[3].replace(/[–—]/g, '-').replace(/\s+/g, ''),
    }
  }

  // "Journal Name, 12(3)"
  const viMatch = JOURNAL_VOL_ISSUE_ONLY_RE.exec(cleaned)
  if (viMatch) {
    return {
      type: 'article',
      containerTitle: stripTrailingPunct(viMatch[1]),
      volume: viMatch[2],
      issue: viMatch[3].trim(),
    }
  }

  // Book / publisher: optional "Place: Publisher"
  if (titleWasQuoted) {
    return {
      type: 'article',
      containerTitle: cleaned,
    }
  }

  if (hasUrl && !hasDoi && /검색|retrieved|accessed/i.test(cleaned)) {
    return { type: 'webpage' }
  }

  const colonIdx = cleaned.indexOf(':')
  if (colonIdx > 0 && colonIdx < cleaned.length - 1) {
    const place = cleaned.slice(0, colonIdx).trim()
    const publisher = cleaned.slice(colonIdx + 1).trim()
    if (place && publisher) {
      return { type: 'book', place, publisher }
    }
  }

  return { type: 'book', publisher: cleaned }
}

function parseSingleDocumentLine(rawLine) {
  const withoutNumber = rawLine.replace(LEADING_NUMBER_RE, '').trim()
  if (withoutNumber.length < 8) {
    return { ok: false, reason: 'too_short' }
  }

  const { text, doi, url } = extractTrailingIdentifiers(withoutNumber)

  // Pattern 1: Author(Year). Rest  (Korean academic & APA 7)
  const parenMatch = AUTHOR_DATE_PAREN_RE.exec(text)
  if (parenMatch) {
    const { authors, isEditor } = parseDocumentAuthors(parenMatch[1], 'apa')
    const year = parenMatch[2]
    const { first: title, rest, quoted } = splitFirstSentence(parenMatch[3])
    if (authors.length > 0 && title.length >= 2) {
      const tail = parseSourceTail(rest, quoted, Boolean(url), Boolean(doi))
      if (tail.unparsedReason) {
        return { ok: false, reason: tail.unparsedReason }
      }
      return {
        ok: true,
        draft: {
          type: tail.type,
          authors: isEditor ? [] : authors,
          editors: isEditor ? authors : [],
          year,
          title,
          containerTitle: tail.containerTitle,
          volume: tail.volume,
          issue: tail.issue,
          pages: tail.pages,
          publisher: tail.publisher,
          place: tail.place,
          degree: tail.degree,
          institution: tail.institution,
          doi,
          url,
        },
      }
    }
  }

  // Pattern 2: Author. Year. Rest  (Chicago Author-Date)
  const chicagoMatch = CHICAGO_AUTHOR_YEAR_RE.exec(text)
  if (chicagoMatch) {
    const { authors, isEditor } = parseDocumentAuthors(chicagoMatch[1], 'chicago')
    const year = chicagoMatch[2]
    const { first: title, rest, quoted } = splitFirstSentence(chicagoMatch[3])
    if (authors.length > 0 && title.length >= 2) {
      const tail = parseSourceTail(rest, quoted, Boolean(url), Boolean(doi))
      if (tail.unparsedReason) {
        return { ok: false, reason: tail.unparsedReason }
      }
      return {
        ok: true,
        draft: {
          type: tail.type,
          authors: isEditor ? [] : authors,
          editors: isEditor ? authors : [],
          year,
          title,
          containerTitle: tail.containerTitle,
          volume: tail.volume,
          issue: tail.issue,
          pages: tail.pages,
          publisher: tail.publisher,
          place: tail.place,
          degree: tail.degree,
          institution: tail.institution,
          doi,
          url,
        },
      }
    }
  }

  // Pattern 3: IEEE quoted article/conference: Authors, "Title," Source, vol. X, no. Y, pp. A-B, Year.
  const ieeeMatch = IEEE_QUOTED_RE.exec(text)
  if (ieeeMatch) {
    const { authors } = parseDocumentAuthors(ieeeMatch[1], 'ieee')
    const title = stripTrailingPunct(ieeeMatch[2])
    const rest = ieeeMatch[3].trim()
    const tail = parseSourceTail(rest, true, Boolean(url), Boolean(doi))
    if (tail.unparsedReason) {
      return { ok: false, reason: tail.unparsedReason }
    }
    const year = tail.year ?? extractYearValue(rest)
    if (authors.length > 0 && title.length >= 2 && (year || doi || url)) {
      return {
        ok: true,
        draft: {
          type: tail.type === 'other' ? 'article' : tail.type,
          authors,
          year,
          title,
          containerTitle: tail.containerTitle,
          volume: tail.volume,
          issue: tail.issue,
          pages: tail.pages,
          publisher: tail.publisher,
          place: tail.place,
          doi,
          url,
        },
      }
    }
  }

  // Pattern 4: MLA quoted article: Author. "Title." Container, vol. X, no. Y, Year, pp. A-B.
  const mlaMatch = MLA_QUOTED_RE.exec(text)
  if (mlaMatch) {
    const { authors } = parseDocumentAuthors(mlaMatch[1], 'mla')
    const title = stripTrailingPunct(mlaMatch[2])
    const rest = mlaMatch[3].trim()
    const tail = parseSourceTail(rest, true, Boolean(url), Boolean(doi))
    if (tail.unparsedReason) {
      return { ok: false, reason: tail.unparsedReason }
    }
    const year = tail.year ?? extractYearValue(rest)
    if (authors.length > 0 && title.length >= 2 && (year || doi || url)) {
      return {
        ok: true,
        draft: {
          type: tail.type === 'other' ? 'article' : tail.type,
          authors,
          year,
          title,
          containerTitle: tail.containerTitle,
          volume: tail.volume,
          issue: tail.issue,
          pages: tail.pages,
          publisher: tail.publisher,
          place: tail.place,
          doi,
          url,
        },
      }
    }
  }

  // Pattern 5: MLA book: "Author. Title. Publisher, Year."
  const mlaBookMatch = /^([^.]+)\.\s+([^.]+)\.\s+(.+?),\s*(\d{4})\.?$/.exec(text)
  if (mlaBookMatch) {
    const { authors } = parseDocumentAuthors(mlaBookMatch[1], 'mla')
    const title = stripTrailingPunct(mlaBookMatch[2])
    const publisher = stripTrailingPunct(mlaBookMatch[3])
    const year = mlaBookMatch[4]
    if (authors.length > 0 && title.length >= 2 && publisher) {
      return {
        ok: true,
        draft: {
          type: 'book',
          authors,
          year,
          title,
          publisher,
          doi,
          url,
        },
      }
    }
  }

  return { ok: false, reason: 'unrecognized_format' }
}

/**
 * Parse raw lines extracted under a document's bibliography / references heading
 * using deterministic rule-based parsers. Unrecognized lines are returned in
 * `unparsed` without fabricating missing metadata.
 */
export function parseDocumentReferenceLines(input, options = {}) {
  const maxBytes = resolveLimit(options.maxBytes, MAX_IMPORT_BYTES)
  const maxEntries = resolveLimit(options.maxEntries, MAX_IMPORT_ENTRIES)

  let rawLines
  if (Array.isArray(input)) {
    let totalBytes = 0
    for (const line of input) {
      totalBytes += utf8ByteLength(String(line ?? '')) + 1
      if (totalBytes > maxBytes) {
        return {
          ok: false,
          reason: 'too_large',
          error: `Input exceeds maximum allowed size of ${maxBytes} bytes (got ${totalBytes} bytes).`,
          maxBytes,
          actualBytes: totalBytes,
          parsed: [],
          unparsed: [],
          entries: [],
          warnings: [],
        }
      }
    }
    rawLines = input.map((line) => stripBomAndControlChars(String(line ?? '')))
  } else {
    const decoded = decodeImportInput(input, { maxBytes, maxEntries })
    if (!decoded.ok) {
      return {
        ok: false,
        reason: decoded.reason,
        error: decoded.error,
        ...(decoded.maxBytes != null ? { maxBytes: decoded.maxBytes } : {}),
        ...(decoded.actualBytes != null ? { actualBytes: decoded.actualBytes } : {}),
        parsed: [],
        unparsed: [],
        entries: [],
        warnings: [],
      }
    }
    rawLines = decoded.text.split('\n')
  }

  const nonEmptyExists = rawLines.some((line) => sanitizeImportedField(line).length > 0)
  if (!nonEmptyExists) {
    return {
      ok: false,
      reason: 'empty',
      error: 'Input is empty.',
      parsed: [],
      unparsed: [],
      entries: [],
      warnings: [],
    }
  }

  const parsed = []
  const unparsed = []
  const entries = []
  const warnings = []
  const usedKeys = new Set(options.existingKeys ?? [])
  const usedIds = new Set(options.existingIds ?? [])
  const source = options.source ?? 'document'

  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex++) {
    const cleanedLine = sanitizeImportedField(rawLines[lineIndex])
    if (!cleanedLine) continue

    if (entries.length >= maxEntries) {
      warnings.push(`Entry limit reached (${maxEntries}); remaining lines were skipped.`)
      break
    }

    const attempt = parseSingleDocumentLine(cleanedLine)
    if (!attempt.ok) {
      unparsed.push({
        lineIndex,
        rawLine: cleanedLine,
        reason: attempt.reason,
      })
      continue
    }

    const entry = buildNormalizedImportEntry(attempt.draft, undefined, usedKeys, usedIds, source)
    parsed.push({ lineIndex, rawLine: cleanedLine, entry })
    entries.push(entry)
  }

  return { ok: true, parsed, unparsed, entries, warnings }
}

// ---------------------------------------------------------------------------
// Duplicate Detection & Import Preview Planning
// ---------------------------------------------------------------------------

/**
 * Normalize a DOI string by stripping URL or host prefixes (`https://doi.org/`,
 * `http://dx.doi.org/`, `doi.org/`, `dx.doi.org/`, `doi:`), applying Unicode
 * NFC normalization, trimming whitespace, and lowercasing.
 */
export function normalizeDoi(doi) {
  if (typeof doi !== 'string') return ''
  const cleaned = sanitizeImportedField(doi).normalize('NFC')
  if (!cleaned) return ''
  return cleaned
    .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/\.+$/, '')
    .trim()
    .toLowerCase()
}

/**
 * Normalize a title for duplicate comparison: apply Unicode NFC normalization,
 * lowercase, strip punctuation, preserve Hangul, Latin/Unicode letters, and
 * digits, and collapse whitespace.
 */
export function normalizeTitleForMatch(title) {
  if (typeof title !== 'string') return ''
  const cleaned = sanitizeImportedField(title).normalize('NFC')
  if (!cleaned) return ''
  return cleaned.toLowerCase().replace(NON_ALNUM_UNICODE_RE, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeYearForMatch(year) {
  if (year == null) return ''
  const cleaned = sanitizeImportedField(year).normalize('NFC').toLowerCase()
  if (!cleaned) return ''
  const match = FOUR_DIGIT_YEAR_RE.exec(cleaned)
  return match ? match[1] : cleaned
}

/**
 * Check whether `candidate` duplicates `existing` by normalized DOI or
 * normalized title + year.
 */
export function isDuplicateEntry(candidate, existing, options = {}) {
  if (!candidate || !existing) {
    return { isDuplicate: false, matchReason: null }
  }

  const matchByDoi = options.matchByDoi !== false
  const matchByTitleYear = options.matchByTitleYear !== false

  if (matchByDoi) {
    const doiA = normalizeDoi(candidate.doi)
    const doiB = normalizeDoi(existing.doi)
    if (doiA && doiB && doiA === doiB) {
      return { isDuplicate: true, matchReason: 'doi' }
    }
  }

  if (matchByTitleYear) {
    const titleA = normalizeTitleForMatch(candidate.title)
    const titleB = normalizeTitleForMatch(existing.title)
    const yearA = normalizeYearForMatch(candidate.year)
    const yearB = normalizeYearForMatch(existing.year)
    if (titleA && titleB && yearA && yearB && titleA === titleB && yearA === yearB) {
      return { isDuplicate: true, matchReason: 'title_year' }
    }
  }

  return { isDuplicate: false, matchReason: null }
}

/**
 * Classify `candidates` against `existingEntries` (and within `candidates`
 * itself) into `toAdd` (unique entries with non-colliding keys and IDs) and
 * `duplicates`.
 */
export function planImportPreview(candidates, existingEntries = [], options = {}) {
  const existingList = Array.isArray(existingEntries) ? existingEntries : []
  const candidateList = Array.isArray(candidates) ? candidates : []

  const usedKeys = new Set()
  const usedIds = new Set()
  for (const item of existingList) {
    if (!item || typeof item !== 'object') continue
    if (item.key) usedKeys.add(item.key)
    if (Array.isArray(item.oldKeys)) {
      for (const oldKey of item.oldKeys) {
        if (oldKey) usedKeys.add(oldKey)
      }
    }
    if (item.id) usedIds.add(item.id)
  }

  const toAdd = []
  const duplicates = []

  for (let candidateIndex = 0; candidateIndex < candidateList.length; candidateIndex++) {
    const rawCandidate = candidateList[candidateIndex]
    if (!rawCandidate || typeof rawCandidate !== 'object') continue

    let matched = null
    for (const existing of existingList) {
      const check = isDuplicateEntry(rawCandidate, existing, options)
      if (check.isDuplicate) {
        matched = {
          candidate: rawCandidate,
          candidateIndex,
          existingKey: existing.key,
          existingId: existing.id,
          matchReason: check.matchReason,
          source: 'existing',
        }
        break
      }
    }

    if (!matched) {
      for (const prev of toAdd) {
        const check = isDuplicateEntry(rawCandidate, prev, options)
        if (check.isDuplicate) {
          matched = {
            candidate: rawCandidate,
            candidateIndex,
            existingKey: prev.key,
            existingId: prev.id,
            matchReason: check.matchReason,
            source: 'batch',
          }
          break
        }
      }
    }

    if (matched) {
      duplicates.push(matched)
      continue
    }

    const key = allocateUniqueKey(rawCandidate.key, rawCandidate, usedKeys)
    const id = allocateUniqueId(rawCandidate.id, key, usedIds)
    const normalized = normalizeBibEntry(
      {
        ...rawCandidate,
        id,
        key,
        verified: rawCandidate.verified === false ? false : true,
        source: rawCandidate.source ?? 'import',
      },
      { id, existingKeys: usedKeys, existingIds: usedIds },
    )
    toAdd.push(normalized)
  }

  return {
    toAdd,
    duplicates,
    totalCandidates: candidateList.length,
  }
}

/**
 * Find all duplicate entries among `candidates` compared against
 * `existingEntries` and earlier entries in `candidates`.
 */
export function findDuplicateEntries(candidates, existingEntries = [], options = {}) {
  return planImportPreview(candidates, existingEntries, options).duplicates
}
