/**
 * Pure reference data model, citation key utilities, sorting/disambiguation,
 * and citation/bibliography formatting for APA 7th, Chicago Author-Date,
 * MLA 9th, and IEEE styles.
 *
 * Node-compatible ES module with zero DOM, Electron, or editor dependencies.
 * Korean entries (`language === 'ko'`) always use Korean academic bibliographic
 * formatting across all four styles, without corner brackets or bold journal
 * titles.
 */

export const ENTRY_TYPES = Object.freeze([
  'article',
  'book',
  'chapter',
  'thesis',
  'report',
  'conference',
  'webpage',
  'other',
])

export const CITATION_STYLES = Object.freeze(['apa', 'chicago', 'mla', 'ieee'])

export const DEFAULT_CITATION_STYLE = 'apa'

export const ENTRY_LANGUAGES = Object.freeze(['ko', 'en'])

export const ENTRY_SOURCES = Object.freeze(['manual', 'import', 'document', 'ai'])

export const BIBLIOGRAPHY_HANGING_INDENT_PT = 24
export const IEEE_HANGING_INDENT_PT = 20
export const DEFAULT_BIBLIOGRAPHY_TITLE_KO = '참고문헌'
export const DEFAULT_BIBLIOGRAPHY_TITLE_EN = 'References'

const HANGUL_RE = /[\uAC00-\uD7A3]/
const HANGUL_ONLY_RE = /^[\uAC00-\uD7A3\u3131-\u318E\s]+$/
const BARE_PAGES_RE = /^\d+(?:\s*[-–—]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–—]\s*\d+)?)*$/
const PLURAL_PAGES_RE = /[-–—,]/
const FOUR_DIGIT_YEAR_RE = /\b(\d{4})\b/
const IN_PRESS_RE = /^(?:in\s+press|forthcoming|인쇄\s*중|출간\s*예정)$/i
const NO_DATE_RE = /^(?:n\.?\s*d\.?|no\s+date|연도\s*미상|미상)$/i
const LEADING_EN_ARTICLE_RE = /^(?:a|an|the)\s+/i
// eslint-disable-next-line no-control-regex
const UNSAFE_KEY_CHARS_RE = /[\u0000-\u001f\u007f\s:%;,/\\|[\](){}<>"'`]+/g

const NAME_PARTICLES = new Set([
  'al',
  'bin',
  'da',
  'de',
  'del',
  'della',
  'den',
  'der',
  'des',
  'di',
  'du',
  'ibn',
  'la',
  'le',
  'ten',
  'ter',
  'van',
  'von',
])

const EN_MONTHS = Object.freeze([
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
])

const MLA_MINOR_WORDS = new Set([
  'a',
  'about',
  'after',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'or',
  'over',
  'the',
  'to',
  'with',
])

const MLA_QUOTED_TITLE_TYPES = new Set(['article', 'chapter', 'conference', 'webpage'])

const KO_COLLATOR = new Intl.Collator('ko', { sensitivity: 'base', numeric: true })
const EN_COLLATOR = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

function cleanStr(value) {
  if (value == null) return ''
  return String(value).replace(/\s+/g, ' ').trim()
}

function cleanOptionalStr(value) {
  const s = cleanStr(value)
  return s.length > 0 ? s : undefined
}

function endsWithTerminalPunct(text) {
  return /[.?!]$/.test(text) || /[.?!]["'”’]$/.test(text)
}

function ensurePeriod(text) {
  const trimmed = cleanStr(text)
  if (!trimmed) return ''
  return endsWithTerminalPunct(trimmed) ? trimmed : `${trimmed}.`
}

function stripTrailingPeriod(text) {
  return cleanStr(text).replace(/\.+$/, '')
}

function quoteWithPeriod(text) {
  const trimmed = cleanStr(text)
  if (!trimmed) return ''
  return endsWithTerminalPunct(trimmed) ? `"${trimmed}"` : `"${trimmed}."`
}

function quoteWithComma(text) {
  const trimmed = cleanStr(text)
  if (!trimmed) return ''
  if (/[?!]$/.test(trimmed)) return `"${trimmed}"`
  return `"${trimmed.replace(/\.+$/, '')},"`
}

function normalizeDoi(doi) {
  const trimmed = cleanStr(doi).normalize('NFC')
  if (!trimmed) return ''
  const bare = trimmed.replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '')
  return bare
}

function formatDoiUrl(doi) {
  const bare = normalizeDoi(doi)
  return bare ? `https://doi.org/${bare}` : ''
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

function mapLookup(mapOrRecord, key) {
  if (!mapOrRecord || !key) return undefined
  if (mapOrRecord instanceof Map) return mapOrRecord.get(key)
  if (Object.prototype.hasOwnProperty.call(mapOrRecord, key)) return mapOrRecord[key]
  return undefined
}

function mergeSegments(rawSegments) {
  const out = []
  for (const seg of rawSegments) {
    if (!seg || !seg.text) continue
    const italic = Boolean(seg.italic)
    const prev = out[out.length - 1]
    if (prev && Boolean(prev.italic) === italic) {
      prev.text += seg.text
    } else if (italic) {
      out.push({ text: seg.text, italic: true })
    } else {
      out.push({ text: seg.text })
    }
  }
  return out
}

function segPlain(text) {
  return text ? { text } : null
}

function segItalic(text) {
  return text ? { text, italic: true } : null
}

/** Return true when `value` is one of the supported citation style identifiers. */
export function isCitationStyle(value) {
  return typeof value === 'string' && CITATION_STYLES.includes(value)
}

/** Return true when `value` is one of the supported bibliography entry types. */
export function isEntryType(value) {
  return typeof value === 'string' && ENTRY_TYPES.includes(value)
}

/** Return the hanging indent in points recommended for `style`. */
export function getBibliographyHangingIndentPt(style = DEFAULT_CITATION_STYLE) {
  return style === 'ieee' ? IEEE_HANGING_INDENT_PT : BIBLIOGRAPHY_HANGING_INDENT_PT
}

/**
 * Normalize an author string or structured object into a `BibAuthor` record.
 * Returns `null` when the input carries no usable name.
 */
export function normalizeAuthor(input) {
  if (input == null) return null

  if (typeof input === 'string') {
    const trimmed = cleanStr(input)
    if (!trimmed) return null

    if (trimmed.includes(',')) {
      const commaIdx = trimmed.indexOf(',')
      const family = cleanStr(trimmed.slice(0, commaIdx))
      const given = cleanStr(trimmed.slice(commaIdx + 1))
      if (family && given) return { family, given }
      const single = family || given
      return single ? { literal: single } : null
    }

    if (HANGUL_RE.test(trimmed)) {
      return { literal: trimmed }
    }

    const parts = trimmed.split(' ')
    if (parts.length === 1) {
      return { literal: trimmed }
    }

    let familyStart = parts.length - 1
    while (familyStart > 1 && NAME_PARTICLES.has(parts[familyStart - 1].toLowerCase())) {
      familyStart -= 1
    }
    const given = parts.slice(0, familyStart).join(' ')
    const family = parts.slice(familyStart).join(' ')
    return { family, given }
  }

  if (typeof input === 'object') {
    const family = cleanOptionalStr(input.family)
    const given = cleanOptionalStr(input.given)
    const literal = cleanOptionalStr(input.literal)
    const isOrganization = Boolean(input.isOrganization)

    if (isOrganization) {
      const orgName = literal ?? [given, family].filter(Boolean).join(' ')
      if (!orgName) return null
      return { literal: orgName, isOrganization: true }
    }

    if (family || given) {
      const out = {}
      if (family) out.family = family
      if (given) out.given = given
      if (literal && !family && !given) out.literal = literal
      return out
    }

    if (literal) {
      return { literal }
    }
  }

  return null
}

function isHangulAuthor(author) {
  if (!author) return false
  return (
    (author.literal && HANGUL_RE.test(author.literal)) ||
    (author.family && HANGUL_RE.test(author.family)) ||
    (author.given && HANGUL_RE.test(author.given))
  )
}

function koreanAuthorName(author) {
  if (!author) return ''
  if (author.isOrganization && author.literal) return author.literal
  if (author.literal && !author.family && !author.given) return author.literal
  if (author.family && author.given) {
    if (HANGUL_ONLY_RE.test(author.family) && HANGUL_ONLY_RE.test(author.given)) {
      return `${author.family}${author.given}`
    }
    if (isHangulAuthor(author)) {
      return `${author.family}${author.given}`
    }
    return `${author.given} ${author.family}`
  }
  return author.literal ?? author.family ?? author.given ?? ''
}

/**
 * Format a single author for readable UI display (e.g., full Korean name,
 * `John Smith`, or `World Health Organization`).
 */
export function formatAuthorDisplay(input, lang) {
  const author = normalizeAuthor(input)
  if (!author) return ''
  if (author.isOrganization || (author.literal && !author.family && !author.given)) {
    return author.literal ?? ''
  }
  if (lang === 'ko' || isHangulAuthor(author)) {
    return koreanAuthorName(author)
  }
  if (author.family && author.given) {
    return `${author.given} ${author.family}`
  }
  return author.family ?? author.given ?? author.literal ?? ''
}

function extractInitials(given) {
  const cleaned = cleanStr(given)
  if (!cleaned) return ''
  // Separate concatenated dotted initials like "J.A." into "J. A."
  const spaced = cleaned.replace(/\.([A-Za-z])/g, '. $1')
  const words = spaced.split(/\s+/).filter(Boolean)
  const parts = words.map((word) => {
    if (word.includes('-')) {
      return word
        .split('-')
        .filter(Boolean)
        .map((sub) => {
          const ch = sub.replace(/\.+$/, '')[0]
          return ch ? `${ch.toUpperCase()}.` : ''
        })
        .filter(Boolean)
        .join('-')
    }
    const ch = word.replace(/\.+$/, '')[0]
    return ch ? `${ch.toUpperCase()}.` : ''
  })
  return parts.filter(Boolean).join(' ')
}

function formatAuthorApa(author) {
  if (author.isOrganization || (author.literal && !author.family && !author.given)) {
    return author.literal ?? ''
  }
  if (isHangulAuthor(author)) return koreanAuthorName(author)
  if (author.family && author.given) {
    const initials = extractInitials(author.given)
    return initials ? `${author.family}, ${initials}` : author.family
  }
  return author.family ?? author.given ?? author.literal ?? ''
}

function formatAuthorNaturalInitials(author) {
  if (author.isOrganization || (author.literal && !author.family && !author.given)) {
    return author.literal ?? ''
  }
  if (isHangulAuthor(author)) return koreanAuthorName(author)
  if (author.family && author.given) {
    const initials = extractInitials(author.given)
    return initials ? `${initials} ${author.family}` : author.family
  }
  return author.family ?? author.given ?? author.literal ?? ''
}

function formatAuthorInvertedFull(author) {
  if (author.isOrganization || (author.literal && !author.family && !author.given)) {
    return author.literal ?? ''
  }
  if (isHangulAuthor(author)) return koreanAuthorName(author)
  if (author.family && author.given) {
    return `${author.family}, ${author.given}`
  }
  return author.family ?? author.given ?? author.literal ?? ''
}

function formatAuthorNaturalFull(author) {
  if (author.isOrganization || (author.literal && !author.family && !author.given)) {
    return author.literal ?? ''
  }
  if (isHangulAuthor(author)) return koreanAuthorName(author)
  if (author.family && author.given) {
    return `${author.given} ${author.family}`
  }
  return author.family ?? author.given ?? author.literal ?? ''
}

function formatAuthorInTextName(author, lang) {
  if (!author) return ''
  if (author.isOrganization || (author.literal && !author.family && !author.given)) {
    return author.literal ?? ''
  }
  if (isHangulAuthor(author)) return koreanAuthorName(author)
  if (author.family) return author.family
  if (lang === 'ko') return koreanAuthorName(author)
  return author.literal ?? author.given ?? ''
}

function formatAuthorListKo(authors) {
  const names = authors.map(koreanAuthorName).filter(Boolean)
  if (names.length === 0) return ''
  if (names.length <= 20) return names.join(', ')
  return `${names.slice(0, 19).join(', ')}, ... ${names[names.length - 1]}`
}

function formatAuthorListApaEn(authors) {
  const names = authors.map(formatAuthorApa).filter(Boolean)
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]}, & ${names[1]}`
  if (names.length <= 20) {
    return `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`
  }
  return `${names.slice(0, 19).join(', ')}, ... ${names[names.length - 1]}`
}

function formatEditorsApaInEn(editors) {
  const names = editors.map(formatAuthorNaturalInitials).filter(Boolean)
  if (names.length === 0) return ''
  if (names.length === 1) return `${names[0]} (Ed.)`
  if (names.length === 2) return `${names[0]} & ${names[1]} (Eds.)`
  return `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]} (Eds.)`
}

function formatAuthorListChicagoEn(authors) {
  if (authors.length === 0) return ''
  const first = formatAuthorInvertedFull(authors[0])
  if (authors.length === 1) return first
  const rest = authors.slice(1).map(formatAuthorNaturalFull).filter(Boolean)
  if (authors.length === 2) return `${first}, and ${rest[0]}`
  if (authors.length <= 10) {
    return `${first}, ${rest.slice(0, -1).join(', ')}, and ${rest[rest.length - 1]}`
  }
  return `${first}, ${rest.slice(0, 6).join(', ')}, et al.`
}

function formatNaturalFullListEn(authors) {
  const names = authors.map(formatAuthorNaturalFull).filter(Boolean)
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

function formatAuthorListMlaEn(authors) {
  if (authors.length === 0) return ''
  const first = formatAuthorInvertedFull(authors[0])
  if (authors.length === 1) return first
  if (authors.length === 2) return `${first}, and ${formatAuthorNaturalFull(authors[1])}`
  return `${first}, et al.`
}

function formatEditorsMlaInEn(editors) {
  if (editors.length === 0) return ''
  const names = editors.map(formatAuthorNaturalFull).filter(Boolean)
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names[0]}, et al.`
}

function formatAuthorListIeeeEn(authors) {
  const names = authors.map(formatAuthorNaturalInitials).filter(Boolean)
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  if (names.length <= 6) {
    return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
  }
  return `${names[0]} et al.`
}

/**
 * Auto-detect entry language (`'ko'` or `'en'`). Respects an explicit
 * `entry.language` value when set to `'ko'` or `'en'`.
 */
export function detectEntryLanguage(entry) {
  if (!entry || typeof entry !== 'object') return 'en'
  if (entry.language === 'ko' || entry.language === 'en') return entry.language

  const texts = [
    entry.title,
    entry.containerTitle,
    entry.publisher,
    entry.institution,
    entry.degree,
    entry.place,
  ]
  if (Array.isArray(entry.authors)) {
    for (const raw of entry.authors) {
      if (typeof raw === 'string') {
        texts.push(raw)
      } else if (raw && typeof raw === 'object') {
        texts.push(raw.literal, raw.family, raw.given)
      }
    }
  }
  if (Array.isArray(entry.editors)) {
    for (const raw of entry.editors) {
      if (typeof raw === 'string') {
        texts.push(raw)
      } else if (raw && typeof raw === 'object') {
        texts.push(raw.literal, raw.family, raw.given)
      }
    }
  }

  for (const t of texts) {
    if (typeof t === 'string' && HANGUL_RE.test(t)) return 'ko'
  }
  return 'en'
}

/** Strip characters unsafe for bookmark names from a citation key candidate. */
export function sanitizeCitationKey(raw) {
  if (raw == null) return ''
  return String(raw).trim().replace(UNSAFE_KEY_CHARS_RE, '')
}

function yearPartForKey(year) {
  const cleaned = cleanStr(year)
  if (!cleaned) return ''
  const match = FOUR_DIGIT_YEAR_RE.exec(cleaned)
  if (match) return match[1]
  return sanitizeCitationKey(cleaned).toLowerCase().slice(0, 8)
}

function authorPartForKey(entry, lang) {
  const list =
    Array.isArray(entry?.authors) && entry.authors.length > 0
      ? entry.authors
      : Array.isArray(entry?.editors) && entry.editors.length > 0
        ? entry.editors
        : []
  if (list.length > 0) {
    const first = normalizeAuthor(list[0])
    if (first) {
      if (isHangulAuthor(first)) {
        const ko = sanitizeCitationKey(koreanAuthorName(first)).slice(0, 24)
        if (ko) return ko
      }
      const base = first.isOrganization
        ? first.literal
        : (first.family ?? first.literal ?? first.given ?? '')
      const safe = sanitizeCitationKey(base).toLowerCase().slice(0, 24)
      if (safe) return safe
    }
  }
  return lang === 'ko' ? '무명' : 'anon'
}

/**
 * Generate a default bookmark-safe citation key (`firstAuthor + year`), appending
 * `a`, `b`, `c`, ... when colliding with `existingKeys`.
 */
export function generateCitationKey(entry, existingKeys) {
  const lang = detectEntryLanguage(entry)
  const authorPart = authorPartForKey(entry, lang)
  const yearPart = yearPartForKey(entry?.year)
  const base = `${authorPart}${yearPart}` || (lang === 'ko' ? '문헌' : 'ref')

  const used =
    existingKeys instanceof Set ? existingKeys : existingKeys ? new Set(existingKeys) : null
  if (!used || !used.has(base)) return base

  for (let i = 0; ; i++) {
    const candidate = `${base}${indexToAlphaSuffix(i)}`
    if (!used.has(candidate)) return candidate
  }
}

/**
 * Validate and normalize a raw bibliography entry into a canonical `BibEntry`.
 */
export function normalizeBibEntry(raw, options = {}) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const type = isEntryType(src.type) ? src.type : 'other'

  const authors = Array.isArray(src.authors) ? src.authors.map(normalizeAuthor).filter(Boolean) : []
  const editors = Array.isArray(src.editors) ? src.editors.map(normalizeAuthor).filter(Boolean) : []

  const title = cleanStr(src.title)
  const year = cleanOptionalStr(src.year)
  const containerTitle = cleanOptionalStr(src.containerTitle)
  const volume = cleanOptionalStr(src.volume)
  const issue = cleanOptionalStr(src.issue)
  const pages = cleanOptionalStr(src.pages)
  const publisher = cleanOptionalStr(src.publisher)
  const place = cleanOptionalStr(src.place)
  const edition = cleanOptionalStr(src.edition)
  const degree = cleanOptionalStr(src.degree)
  const institution = cleanOptionalStr(src.institution)
  const doi = cleanOptionalStr(src.doi)
  const url = cleanOptionalStr(src.url)
  const accessed = cleanOptionalStr(src.accessed)
  const memo = cleanOptionalStr(src.memo)
  const createdAt = cleanOptionalStr(src.createdAt)
  const updatedAt = cleanOptionalStr(src.updatedAt)
  const source =
    typeof src.source === 'string' && ENTRY_SOURCES.includes(src.source) ? src.source : undefined

  const draft = {
    type,
    authors,
    editors,
    year,
    title,
    containerTitle,
    publisher,
    place,
    degree,
    institution,
    language: src.language === 'ko' || src.language === 'en' ? src.language : undefined,
  }
  const language = detectEntryLanguage(draft)

  const sanitizedKey = sanitizeCitationKey(src.key)
  const key = sanitizedKey || generateCitationKey({ ...draft, language }, options.existingKeys)

  const oldKeySet = new Set()
  if (Array.isArray(src.oldKeys)) {
    for (const k of src.oldKeys) {
      const cleaned = sanitizeCitationKey(k)
      if (cleaned && cleaned !== key) oldKeySet.add(cleaned)
    }
  }

  const tagSet = new Set()
  if (Array.isArray(src.tags)) {
    for (const tag of src.tags) {
      const cleaned = cleanStr(tag)
      if (cleaned) tagSet.add(cleaned)
    }
  }

  let id = cleanOptionalStr(options.id ?? src.id)
  if (!id) {
    const baseId = `bib_${key}`
    const usedIds =
      options.existingIds instanceof Set
        ? options.existingIds
        : options.existingIds
          ? new Set(options.existingIds)
          : null
    if (!usedIds || !usedIds.has(baseId)) {
      id = baseId
    } else {
      let n = 2
      while (usedIds.has(`${baseId}_${n}`)) n += 1
      id = `${baseId}_${n}`
    }
  }

  const normalized = {
    id,
    key,
    oldKeys: [...oldKeySet],
    type,
    authors,
    title,
    language,
    tags: [...tagSet],
    verified: src.verified === false ? false : true,
  }

  if (editors.length > 0) normalized.editors = editors
  if (year !== undefined) normalized.year = year
  if (containerTitle !== undefined) normalized.containerTitle = containerTitle
  if (volume !== undefined) normalized.volume = volume
  if (issue !== undefined) normalized.issue = issue
  if (pages !== undefined) normalized.pages = pages
  if (publisher !== undefined) normalized.publisher = publisher
  if (place !== undefined) normalized.place = place
  if (edition !== undefined) normalized.edition = edition
  if (degree !== undefined) normalized.degree = degree
  if (institution !== undefined) normalized.institution = institution
  if (doi !== undefined) normalized.doi = doi
  if (url !== undefined) normalized.url = url
  if (accessed !== undefined) normalized.accessed = accessed
  if (memo !== undefined) normalized.memo = memo
  if (source !== undefined) normalized.source = source
  if (createdAt !== undefined) normalized.createdAt = createdAt
  if (updatedAt !== undefined) normalized.updatedAt = updatedAt

  return normalized
}

/**
 * Rename an entry's citation key while preserving the previous key in `oldKeys`
 * so existing document marks still resolve.
 */
export function renameBibEntryKey(entry, nextKey, existingKeys) {
  const sanitized = sanitizeCitationKey(nextKey)
  if (!sanitized) {
    return { ok: false, reason: 'invalid_key' }
  }
  if (sanitized === entry.key) {
    return { ok: true, entry }
  }

  if (existingKeys) {
    const used = existingKeys instanceof Set ? existingKeys : new Set(existingKeys)
    if (used.has(sanitized)) {
      return { ok: false, reason: 'duplicate_key' }
    }
  }

  const oldKeys = new Set(Array.isArray(entry.oldKeys) ? entry.oldKeys : [])
  if (entry.key) oldKeys.add(entry.key)
  oldKeys.delete(sanitized)

  return {
    ok: true,
    entry: {
      ...entry,
      key: sanitized,
      oldKeys: [...oldKeys],
    },
  }
}

/**
 * Resolve a bibliography entry by its current `key` first, then by `oldKeys`.
 * Returns `null` when no entry matches.
 */
export function resolveEntryByKey(entries, key) {
  if (!Array.isArray(entries) || typeof key !== 'string' || key.length === 0) return null
  for (const entry of entries) {
    if (entry && entry.key === key) return entry
  }
  for (const entry of entries) {
    if (entry && Array.isArray(entry.oldKeys) && entry.oldKeys.includes(key)) {
      return entry
    }
  }
  return null
}

/**
 * Format a citation locator (e.g. page number or range) according to style and language.
 * Preserves locators that already carry a unit or label (`p.`, `pp.`, `ch.`, Korean page suffix, etc.).
 */
export function formatLocator(locator, style = DEFAULT_CITATION_STYLE, lang = 'en') {
  const trimmed = cleanStr(locator)
  if (!trimmed) return ''

  if (!BARE_PAGES_RE.test(trimmed)) {
    return trimmed
  }

  const normalized = trimmed.replace(/\s*[-–—]\s*/g, '-').replace(/\s*,\s*/g, ', ')
  if (lang === 'ko') {
    return `${normalized}쪽`
  }
  if (style === 'apa' || style === 'ieee') {
    const prefix = PLURAL_PAGES_RE.test(normalized) ? 'pp.' : 'p.'
    return `${prefix} ${normalized}`
  }
  return normalized
}

function englishOrdinal(n) {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  const mod10 = n % 10
  if (mod10 === 1) return `${n}st`
  if (mod10 === 2) return `${n}nd`
  if (mod10 === 3) return `${n}rd`
  return `${n}th`
}

/**
 * Format an edition value for the given citation style and language.
 * Purely numeric values are converted to Korean edition notation in Korean or
 * ordinal + ` ed.` in English (wrapped in parentheses for APA English).
 * Non-numeric edition text is preserved verbatim without duplicating `ed.` or
 * parentheses.
 */
export function formatEdition(edition, style = DEFAULT_CITATION_STYLE, language = 'en') {
  const trimmed = cleanStr(edition)
  if (!trimmed) return ''

  let formatted = trimmed
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed)
    if (Number.isSafeInteger(num) && num > 0) {
      formatted = language === 'ko' ? `제${num}판` : `${englishOrdinal(num)} ed.`
    }
  }

  if (language === 'en' && style === 'apa') {
    return /^\(.*\)$/.test(formatted) ? formatted : `(${formatted})`
  }
  return formatted
}

function formatApaEnAccessedDate(accessed) {
  const cleaned = cleanStr(accessed)
  if (!cleaned) return ''
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(cleaned)
  if (iso) {
    const year = iso[1]
    const monthNum = Number(iso[2])
    const dayNum = Number(iso[3])
    if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
      return `${EN_MONTHS[monthNum - 1]} ${dayNum}, ${year}`
    }
  }
  return cleaned
}

function isSameAsSoleAuthorOrg(authors, candidate) {
  const normCandidate = cleanStr(candidate).normalize('NFC').toLowerCase()
  if (!normCandidate || !Array.isArray(authors) || authors.length !== 1) return false
  const only = authors[0]
  if (!only) return false
  const authorName =
    only.isOrganization || (only.literal && !only.family && !only.given)
      ? cleanStr(only.literal)
      : ''
  if (!authorName) return false
  return authorName.normalize('NFC').toLowerCase() === normCandidate
}

function formatKoPages(pages) {
  const trimmed = cleanStr(pages)
  if (!trimmed) return ''
  return BARE_PAGES_RE.test(trimmed) ? `${trimmed.replace(/\s*[-–—]\s*/g, '-')}쪽` : trimmed
}

function formatEnPages(pages) {
  const trimmed = cleanStr(pages)
  if (!trimmed) return ''
  if (!BARE_PAGES_RE.test(trimmed)) return trimmed
  const normalized = trimmed.replace(/\s*[-–—]\s*/g, '-')
  return `${PLURAL_PAGES_RE.test(normalized) ? 'pp.' : 'p.'} ${normalized}`
}

function normalizeYearRank(year) {
  const cleaned = cleanStr(year)
  if (!cleaned || NO_DATE_RE.test(cleaned)) return -Infinity
  if (IN_PRESS_RE.test(cleaned)) return Infinity
  const match = FOUR_DIGIT_YEAR_RE.exec(cleaned)
  if (match) return Number(match[1])
  return Infinity - 1
}

function titleSortKey(title, lang) {
  const cleaned = cleanStr(title)
  if (lang === 'en') return cleaned.replace(LEADING_EN_ARTICLE_RE, '')
  return cleaned
}

function authorSortKey(entry, lang) {
  const list =
    Array.isArray(entry.authors) && entry.authors.length > 0
      ? entry.authors
      : Array.isArray(entry.editors) && entry.editors.length > 0
        ? entry.editors
        : []
  if (list.length === 0) return titleSortKey(entry.title, lang)

  return list
    .map((raw) => {
      const a = normalizeAuthor(raw)
      if (!a) return ''
      if (lang === 'ko' || isHangulAuthor(a)) return koreanAuthorName(a)
      if (a.isOrganization || (a.literal && !a.family && !a.given)) return a.literal ?? ''
      return [a.family, a.given].filter(Boolean).join(', ')
    })
    .filter(Boolean)
    .join(' | ')
}

function normalizedAuthorIdentity(entry, lang) {
  return authorSortKey(entry, lang).toLowerCase()
}

function normalizedYearIdentity(entry, lang) {
  const cleaned = cleanStr(entry.year)
  if (!cleaned || NO_DATE_RE.test(cleaned)) return lang === 'ko' ? '연도미상' : 'n.d.'
  return cleaned.toLowerCase()
}

function compareAuthorDateEntries(a, b) {
  const langA = detectEntryLanguage(a)
  const langB = detectEntryLanguage(b)
  const groupA = langA === 'ko' ? 0 : 1
  const groupB = langB === 'ko' ? 0 : 1
  if (groupA !== groupB) return groupA - groupB

  const collator = langA === 'ko' ? KO_COLLATOR : EN_COLLATOR
  const authorCmp = collator.compare(authorSortKey(a, langA), authorSortKey(b, langB))
  if (authorCmp !== 0) return authorCmp

  const yearA = normalizeYearRank(a.year)
  const yearB = normalizeYearRank(b.year)
  if (yearA !== yearB) return yearA - yearB

  const titleCmp = collator.compare(titleSortKey(a.title, langA), titleSortKey(b.title, langB))
  if (titleCmp !== 0) return titleCmp

  return collator.compare(a.key ?? '', b.key ?? '')
}

/**
 * Assign 1-based IEEE reference numbers in order of first appearance.
 * When `entries` is supplied, keys matching an entry's `oldKeys` are mapped to
 * the entry's current canonical `key`.
 */
export function assignIeeeNumbers(citedKeysInOrder, entries) {
  const map = new Map()
  if (!Array.isArray(citedKeysInOrder)) return map
  let next = 1
  for (const rawKey of citedKeysInOrder) {
    if (typeof rawKey !== 'string' || rawKey.length === 0) continue
    const resolved = Array.isArray(entries) ? resolveEntryByKey(entries, rawKey) : null
    const canonicalKey = resolved ? resolved.key : rawKey
    if (!map.has(canonicalKey)) {
      map.set(canonicalKey, next)
      next += 1
    }
  }
  return map
}

/**
 * Sort bibliography entries according to `style`.
 * - APA / Chicago / MLA: Korean entries first (Hangul order), then English/other
 *   entries (Latin A-Z), ordered by author, year ascending, then title.
 * - IEEE: strictly ordered by `options.citedKeysInOrder` (first appearance).
 */
export function sortBibliographyEntries(entries, style = DEFAULT_CITATION_STYLE, options = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return []
  const copy = [...entries]

  if (style === 'ieee') {
    const orderMap = assignIeeeNumbers(options.citedKeysInOrder ?? [], copy)
    return copy
      .map((entry, idx) => ({ entry, idx, rank: orderMap.get(entry.key) ?? Infinity }))
      .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.idx - b.idx))
      .map((item) => item.entry)
  }

  return copy.sort(compareAuthorDateEntries)
}

/**
 * Assign disambiguation suffixes (`'a'`, `'b'`, ...) for entries sharing the
 * same author list and publication year under author-date styles (`apa`, `chicago`).
 * Returns an empty Map for IEEE and MLA (MLA disambiguates multiple works by
 * the same author with short titles rather than year suffixes).
 */
export function assignDisambiguationSuffixes(entries, style = DEFAULT_CITATION_STYLE) {
  const map = new Map()
  if (!Array.isArray(entries) || entries.length < 2 || style === 'ieee' || style === 'mla') {
    return map
  }

  const sorted = sortBibliographyEntries(entries, style)
  const groups = new Map()

  for (const entry of sorted) {
    const lang = detectEntryLanguage(entry)
    const authorId = normalizedAuthorIdentity(entry, lang)
    const yearId = normalizedYearIdentity(entry, lang)
    const groupKey = `${lang}\0${authorId}\0${yearId}`
    let list = groups.get(groupKey)
    if (!list) {
      list = []
      groups.set(groupKey, list)
    }
    list.push(entry)
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue
    group.forEach((entry, idx) => {
      if (entry.key) map.set(entry.key, indexToAlphaSuffix(idx))
    })
  }

  return map
}

function buildMlaShortTitleBase(rawTitle, wordLimit, allowFullAfterColon) {
  const cleaned = cleanStr(rawTitle).replace(/[.?!:;,\s]+$/, '')
  if (!cleaned) return 'Untitled'

  let source = cleaned
  if (!allowFullAfterColon) {
    const colonIdx = cleaned.indexOf(':')
    if (colonIdx > 0) {
      const beforeColon = cleaned.slice(0, colonIdx).trim()
      if (beforeColon.length > 0) source = beforeColon
    }
  }

  const strippedArticle = source.replace(LEADING_EN_ARTICLE_RE, '').trim()
  const usable = strippedArticle.length > 0 ? strippedArticle : source
  const words = usable.split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'Untitled'

  let picked
  if (words.length <= wordLimit) {
    picked = words.slice()
  } else {
    picked = words.slice(0, wordLimit)
    while (
      picked.length > 2 &&
      MLA_MINOR_WORDS.has(picked[picked.length - 1].replace(/[,;:]+$/, '').toLowerCase())
    ) {
      picked.pop()
    }
    if (
      picked.length === 2 &&
      words.length > 2 &&
      MLA_MINOR_WORDS.has(picked[1].replace(/[,;:]+$/, '').toLowerCase())
    ) {
      picked = words.slice(0, Math.min(words.length, Math.max(3, wordLimit)))
    }
  }

  return picked.join(' ').replace(/[,;:\s]+$/, '')
}

function wrapMlaShortTitle(entry, shortText) {
  const type = isEntryType(entry?.type) ? entry.type : 'other'
  return MLA_QUOTED_TITLE_TYPES.has(type) ? `"${shortText}"` : shortText
}

/**
 * Assign MLA 9th short-title disambiguators for English entries that share the
 * same author group. Articles, chapters, conference papers, and webpages are
 * returned in double quotes (`"Short Title"`); standalone works (books, reports,
 * theses, other) are returned plain (`Short Title`).
 */
export function assignMlaShortTitles(entries) {
  const map = new Map()
  if (!Array.isArray(entries) || entries.length < 2) return map

  const groups = new Map()
  const seenKeys = new Set()

  for (const entry of entries) {
    if (!entry || !entry.key) continue
    if (seenKeys.has(entry.key)) continue
    seenKeys.add(entry.key)

    const lang = detectEntryLanguage(entry)
    if (lang !== 'en') continue

    const hasLeadAuthor =
      (Array.isArray(entry.authors) && entry.authors.length > 0) ||
      (Array.isArray(entry.editors) && entry.editors.length > 0)
    if (!hasLeadAuthor) continue

    const authorId = normalizedAuthorIdentity(entry, 'en')
    let list = groups.get(authorId)
    if (!list) {
      list = []
      groups.set(authorId, list)
    }
    list.push(entry)
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue

    // Start with compact 2-4 word short titles and expand only colliding entries.
    const candidates = new Map()
    for (const entry of group) {
      candidates.set(entry.key, buildMlaShortTitleBase(entry.title, 3, false))
    }

    for (let limit = 4; limit <= 12; limit++) {
      const counts = new Map()
      for (const val of candidates.values()) {
        const norm = val.toLowerCase()
        counts.set(norm, (counts.get(norm) ?? 0) + 1)
      }
      let hasCollision = false
      for (const entry of group) {
        const cur = candidates.get(entry.key)
        if ((counts.get(cur.toLowerCase()) ?? 0) > 1) {
          hasCollision = true
          candidates.set(entry.key, buildMlaShortTitleBase(entry.title, limit, limit >= 6))
        }
      }
      if (!hasCollision) break
    }

    for (const entry of group) {
      const shortText = candidates.get(entry.key)
      if (shortText) {
        map.set(entry.key, wrapMlaShortTitle(entry, shortText))
      }
    }
  }

  return map
}

function formatYearWithSuffix(year, suffix, lang, style) {
  const cleaned = cleanStr(year)
  const suf = suffix ?? ''
  if (!cleaned || NO_DATE_RE.test(cleaned)) {
    if (lang === 'ko') return suf ? `연도미상${suf}` : '연도미상'
    if (style === 'mla') return ''
    return suf ? `n.d.-${suf}` : 'n.d.'
  }
  return `${cleaned}${suf}`
}

function formatKoBibliography(entry, suffix, ieeeNum) {
  const authors = Array.isArray(entry.authors)
    ? entry.authors.map(normalizeAuthor).filter(Boolean)
    : []
  const editors = Array.isArray(entry.editors)
    ? entry.editors.map(normalizeAuthor).filter(Boolean)
    : []
  const yearText = formatYearWithSuffix(entry.year, suffix, 'ko', 'apa')
  const title = cleanStr(entry.title)
  const container = cleanStr(entry.containerTitle)
  const volume = cleanStr(entry.volume)
  const issue = cleanStr(entry.issue)
  const pages = cleanStr(entry.pages)
  const publisher = cleanStr(entry.publisher)
  const place = cleanStr(entry.place)
  const edition = formatEdition(entry.edition, 'apa', 'ko')
  const degree = cleanStr(entry.degree)
  const institution = cleanStr(entry.institution)
  const doiUrl = formatDoiUrl(entry.doi)
  const url = cleanStr(entry.url)
  const accessed = cleanStr(entry.accessed)

  const prefix = ieeeNum != null ? `[${ieeeNum}] ` : ''
  const parts = []

  let usedTitleAsLead = false
  if (authors.length > 0) {
    parts.push(`${formatAuthorListKo(authors)}(${yearText}).`)
  } else if (editors.length > 0) {
    parts.push(`${formatAuthorListKo(editors)}(편)(${yearText}).`)
  } else if (title) {
    usedTitleAsLead = true
    parts.push(`${title}(${yearText}).`)
  } else {
    parts.push(`(${yearText}).`)
  }

  const redundantPublisher = Boolean(publisher) && isSameAsSoleAuthorOrg(authors, publisher)
  const effectivePublisher = redundantPublisher ? '' : publisher
  const effectiveInstitution =
    Boolean(institution) && isSameAsSoleAuthorOrg(authors, institution) ? '' : institution
  const pubWithPlace = redundantPublisher
    ? ''
    : place && effectivePublisher
      ? `${place}: ${effectivePublisher}`
      : effectivePublisher || place

  const type = isEntryType(entry.type) ? entry.type : 'other'

  if (type === 'article') {
    if (!usedTitleAsLead && title) parts.push(ensurePeriod(title))
    const journalParts = []
    if (container) journalParts.push(container)
    if (volume && issue) journalParts.push(`${volume}(${issue})`)
    else if (volume) journalParts.push(volume)
    else if (issue) journalParts.push(`(${issue})`)
    if (pages) journalParts.push(pages)
    if (journalParts.length > 0) parts.push(ensurePeriod(journalParts.join(', ')))
    if (doiUrl) parts.push(doiUrl)
    else if (url) parts.push(url)
  } else if (type === 'book') {
    if (!usedTitleAsLead && title) {
      parts.push(edition ? `${stripTrailingPeriod(title)} (${edition}).` : ensurePeriod(title))
    } else if (edition) {
      parts.push(ensurePeriod(edition))
    }
    if (pubWithPlace) parts.push(ensurePeriod(pubWithPlace))
    if (doiUrl) parts.push(doiUrl)
    else if (url) parts.push(url)
  } else if (type === 'chapter') {
    if (!usedTitleAsLead && title) parts.push(ensurePeriod(title))
    const bookHead = []
    if (editors.length > 0) bookHead.push(`${formatAuthorListKo(editors)}(편)`)
    if (container) bookHead.push(container)
    const parenBits = []
    if (edition) parenBits.push(edition)
    if (pages) parenBits.push(formatKoPages(pages))
    if (bookHead.length > 0) {
      const joined = bookHead.join(', ')
      parts.push(
        parenBits.length > 0 ? `${joined} (${parenBits.join(', ')}).` : ensurePeriod(joined),
      )
    } else if (parenBits.length > 0) {
      parts.push(ensurePeriod(parenBits.join(', ')))
    }
    if (pubWithPlace) parts.push(ensurePeriod(pubWithPlace))
    if (doiUrl) parts.push(doiUrl)
    else if (url) parts.push(url)
  } else if (type === 'thesis') {
    if (!usedTitleAsLead && title) parts.push(ensurePeriod(title))
    const thesisInfo = [institution, degree || '학위논문'].filter(Boolean).join(' ')
    if (thesisInfo) parts.push(ensurePeriod(thesisInfo))
    if (doiUrl) parts.push(doiUrl)
    else if (url) parts.push(url)
  } else if (type === 'report') {
    if (!usedTitleAsLead && title) parts.push(ensurePeriod(title))
    const org =
      effectiveInstitution && effectivePublisher && effectiveInstitution !== effectivePublisher
        ? `${effectiveInstitution}, ${effectivePublisher}`
        : effectiveInstitution || pubWithPlace
    if (org) parts.push(ensurePeriod(org))
    if (doiUrl) parts.push(doiUrl)
    else if (url) parts.push(url)
  } else if (type === 'conference') {
    if (!usedTitleAsLead && title) parts.push(ensurePeriod(title))
    const confParts = [container, place, pages].filter(Boolean)
    if (confParts.length > 0) parts.push(ensurePeriod(confParts.join(', ')))
    if (doiUrl) parts.push(doiUrl)
    else if (url) parts.push(url)
  } else if (type === 'webpage') {
    if (!usedTitleAsLead && title) parts.push(ensurePeriod(title))
    if (container) parts.push(ensurePeriod(container))
    if (accessed && url) parts.push(`${accessed} 검색, ${url}`)
    else if (url) parts.push(url)
    else if (accessed) parts.push(`${accessed} 검색.`)
  } else {
    if (!usedTitleAsLead && title) parts.push(ensurePeriod(title))
    if (container) parts.push(ensurePeriod(container))
    const org = effectiveInstitution || pubWithPlace
    if (org) parts.push(ensurePeriod(org))
    if (doiUrl) parts.push(doiUrl)
    else if (url) parts.push(url)
  }

  const text = `${prefix}${parts.filter(Boolean).join(' ')}`
  return [{ text }]
}

function formatApaEnBibliography(entry, suffix) {
  const authors = Array.isArray(entry.authors)
    ? entry.authors.map(normalizeAuthor).filter(Boolean)
    : []
  const editors = Array.isArray(entry.editors)
    ? entry.editors.map(normalizeAuthor).filter(Boolean)
    : []
  const yearText = formatYearWithSuffix(entry.year, suffix, 'en', 'apa')
  const title = cleanStr(entry.title)
  const container = cleanStr(entry.containerTitle)
  const volume = cleanStr(entry.volume)
  const issue = cleanStr(entry.issue)
  const pages = cleanStr(entry.pages)
  const publisher = cleanStr(entry.publisher)
  const edition = formatEdition(entry.edition, 'apa', 'en')
  const chapterEdition = edition ? edition.replace(/^\((.*)\)$/, '$1') : ''
  const degree = cleanStr(entry.degree)
  const institution = cleanStr(entry.institution)
  const doiUrl = formatDoiUrl(entry.doi)
  const url = cleanStr(entry.url)
  const accessed = formatApaEnAccessedDate(entry.accessed)

  const effectivePublisher = isSameAsSoleAuthorOrg(authors, publisher) ? '' : publisher
  const effectiveInstitution = isSameAsSoleAuthorOrg(authors, institution) ? '' : institution

  const segs = []
  const pushSpace = () => {
    if (segs.length > 0) segs.push(segPlain(' '))
  }

  const type = isEntryType(entry.type) ? entry.type : 'other'
  const italicTitle =
    type === 'book' || type === 'thesis' || type === 'report' || type === 'webpage'

  let usedTitleAsLead = false
  if (authors.length > 0) {
    segs.push(segPlain(`${ensurePeriod(formatAuthorListApaEn(authors))} (${yearText}).`))
  } else if (editors.length > 0) {
    const edLabel = editors.length === 1 ? '(Ed.)' : '(Eds.)'
    segs.push(segPlain(`${formatAuthorListApaEn(editors)} ${edLabel}. (${yearText}).`))
  } else if (title) {
    usedTitleAsLead = true
    const cleanTitle = stripTrailingPeriod(title)
    segs.push(italicTitle ? segItalic(cleanTitle) : segPlain(cleanTitle))
    segs.push(segPlain(`. (${yearText}).`))
  } else {
    segs.push(segPlain(`(${yearText}).`))
  }

  if (type === 'article') {
    if (!usedTitleAsLead && title) {
      pushSpace()
      segs.push(segPlain(ensurePeriod(title)))
    }
    if (container || volume || issue || pages) {
      pushSpace()
      let hasPrior = false
      if (container) {
        segs.push(segItalic(container))
        hasPrior = true
      }
      if (volume) {
        if (hasPrior) segs.push(segPlain(', '))
        segs.push(segItalic(volume))
        if (issue) segs.push(segPlain(`(${issue})`))
        hasPrior = true
      } else if (issue) {
        if (hasPrior) segs.push(segPlain(', '))
        segs.push(segPlain(`(${issue})`))
        hasPrior = true
      }
      if (pages) {
        if (hasPrior) segs.push(segPlain(', '))
        segs.push(segPlain(pages))
      }
      segs.push(segPlain('.'))
    }
    if (doiUrl || url) {
      pushSpace()
      segs.push(segPlain(doiUrl || url))
    }
  } else if (type === 'book') {
    if (!usedTitleAsLead && title) {
      pushSpace()
      segs.push(segItalic(stripTrailingPeriod(title)))
      if (edition) segs.push(segPlain(` ${edition}`))
      segs.push(segPlain('.'))
    } else if (edition) {
      pushSpace()
      segs.push(segPlain(`${edition}.`))
    }
    if (effectivePublisher) {
      pushSpace()
      segs.push(segPlain(ensurePeriod(effectivePublisher)))
    }
    if (doiUrl || url) {
      pushSpace()
      segs.push(segPlain(doiUrl || url))
    }
  } else if (type === 'chapter') {
    if (!usedTitleAsLead && title) {
      pushSpace()
      segs.push(segPlain(ensurePeriod(title)))
    }
    if (container || editors.length > 0) {
      pushSpace()
      segs.push(segPlain('In '))
      if (editors.length > 0) {
        segs.push(segPlain(`${formatEditorsApaInEn(editors)}, `))
      }
      if (container) segs.push(segItalic(stripTrailingPeriod(container)))
      const parens = [chapterEdition, formatEnPages(pages)].filter(Boolean)
      if (parens.length > 0) segs.push(segPlain(` (${parens.join(', ')})`))
      segs.push(segPlain('.'))
    }
    if (effectivePublisher) {
      pushSpace()
      segs.push(segPlain(ensurePeriod(effectivePublisher)))
    }
    if (doiUrl || url) {
      pushSpace()
      segs.push(segPlain(doiUrl || url))
    }
  } else if (type === 'thesis') {
    if (!usedTitleAsLead && title) {
      pushSpace()
      segs.push(segItalic(stripTrailingPeriod(title)))
    }
    const bracket = [degree || 'Unpublished thesis', institution].filter(Boolean).join(', ')
    if (bracket) {
      pushSpace()
      segs.push(segPlain(`[${bracket}].`))
    } else if (!usedTitleAsLead && title) {
      segs.push(segPlain('.'))
    }
    if (doiUrl || url) {
      pushSpace()
      segs.push(segPlain(doiUrl || url))
    }
  } else if (type === 'report') {
    if (!usedTitleAsLead && title) {
      pushSpace()
      segs.push(segItalic(stripTrailingPeriod(title)))
      segs.push(segPlain('.'))
    }
    const org = effectiveInstitution || effectivePublisher
    if (org) {
      pushSpace()
      segs.push(segPlain(ensurePeriod(org)))
    }
    if (doiUrl || url) {
      pushSpace()
      segs.push(segPlain(doiUrl || url))
    }
  } else if (type === 'conference') {
    if (!usedTitleAsLead && title) {
      pushSpace()
      segs.push(segPlain(ensurePeriod(title)))
    }
    if (container || pages) {
      pushSpace()
      const enPages = formatEnPages(pages)
      if (container) {
        segs.push(segPlain('In '))
        segs.push(segItalic(stripTrailingPeriod(container)))
        if (enPages) segs.push(segPlain(` (${enPages}).`))
        else segs.push(segPlain('.'))
      } else if (enPages) {
        segs.push(segPlain(`${enPages}.`))
      }
    }
    if (effectivePublisher) {
      pushSpace()
      segs.push(segPlain(ensurePeriod(effectivePublisher)))
    }
    if (doiUrl || url) {
      pushSpace()
      segs.push(segPlain(doiUrl || url))
    }
  } else if (type === 'webpage') {
    if (!usedTitleAsLead && title) {
      pushSpace()
      segs.push(segItalic(stripTrailingPeriod(title)))
      segs.push(segPlain('.'))
    }
    if (container) {
      pushSpace()
      segs.push(segPlain(ensurePeriod(container)))
    }
    if (accessed && url) {
      pushSpace()
      segs.push(segPlain(`Retrieved ${accessed}, from ${url}`))
    } else if (url) {
      pushSpace()
      segs.push(segPlain(url))
    }
  } else {
    if (!usedTitleAsLead && title) {
      pushSpace()
      segs.push(segPlain(ensurePeriod(title)))
    }
    if (container) {
      pushSpace()
      segs.push(segItalic(stripTrailingPeriod(container)))
      segs.push(segPlain('.'))
    }
    const org = effectiveInstitution || effectivePublisher
    if (org) {
      pushSpace()
      segs.push(segPlain(ensurePeriod(org)))
    }
    if (doiUrl || url) {
      pushSpace()
      segs.push(segPlain(doiUrl || url))
    }
  }

  return mergeSegments(segs)
}

function formatChicagoEnBibliography(entry, suffix) {
  const authors = Array.isArray(entry.authors)
    ? entry.authors.map(normalizeAuthor).filter(Boolean)
    : []
  const editors = Array.isArray(entry.editors)
    ? entry.editors.map(normalizeAuthor).filter(Boolean)
    : []
  const yearText = formatYearWithSuffix(entry.year, suffix, 'en', 'chicago')
  const title = cleanStr(entry.title)
  const container = cleanStr(entry.containerTitle)
  const volume = cleanStr(entry.volume)
  const issue = cleanStr(entry.issue)
  const pages = cleanStr(entry.pages)
  const publisher = cleanStr(entry.publisher)
  const place = cleanStr(entry.place)
  const edition = formatEdition(entry.edition, 'chicago', 'en')
  const degree = cleanStr(entry.degree)
  const institution = cleanStr(entry.institution)
  const doiUrl = formatDoiUrl(entry.doi)
  const url = cleanStr(entry.url)
  const accessed = cleanStr(entry.accessed)

  const pubPlace = place && publisher ? `${place}: ${publisher}` : publisher || place
  const segs = []
  const pushSpace = () => {
    if (segs.length > 0) segs.push(segPlain(' '))
  }

  let usedTitleAsLead = false
  if (authors.length > 0) {
    segs.push(
      segPlain(`${ensurePeriod(formatAuthorListChicagoEn(authors))} ${ensurePeriod(yearText)}`),
    )
  } else if (editors.length > 0) {
    const edLabel = editors.length === 1 ? 'ed.' : 'eds.'
    segs.push(
      segPlain(`${formatAuthorListChicagoEn(editors)}, ${edLabel} ${ensurePeriod(yearText)}`),
    )
  } else if (title) {
    usedTitleAsLead = true
    segs.push(segPlain(`${ensurePeriod(title)} ${ensurePeriod(yearText)}`))
  } else {
    segs.push(segPlain(ensurePeriod(yearText)))
  }

  const type = isEntryType(entry.type) ? entry.type : 'other'

  if (type === 'article') {
    if (!usedTitleAsLead && title) {
      pushSpace()
      segs.push(segPlain(quoteWithPeriod(title)))
    }
    if (container || volume || issue || pages) {
      pushSpace()
      if (container) segs.push(segItalic(container))
      const volIssue = [volume, issue ? `(${issue})` : ''].filter(Boolean).join(' ')
      if (volIssue) {
        if (container) segs.push(segPlain(' '))
        segs.push(segPlain(volIssue))
      }
      if (pages) {
        segs.push(segPlain(container || volIssue ? `: ${pages}` : pages))
      }
      segs.push(segPlain('.'))
    }
    if (doiUrl || url) {
      pushSpace()
      segs.push(segPlain(doiUrl || url))
    }
  } else if (type === 'book') {
    if (!usedTitleAsLead && title) {
      pushSpace()
      segs.push(segItalic(stripTrailingPeriod(title)))
      segs.push(segPlain('.'))
    }
    if (edition) {
      pushSpace()
      segs.push(segPlain(ensurePeriod(edition)))
    }
    if (pubPlace) {
      pushSpace()
      segs.push(segPlain(ensurePeriod(pubPlace)))
    }
    if (doiUrl || url) {
      pushSpace()
      segs.push(segPlain(doiUrl || url))
    }
  } else if (type === 'chapter') {
    if (!usedTitleAsLead && title) {
      pushSpace()
      segs.push(segPlain(quoteWithPeriod(title)))
    }
    if (container || editors.length > 0 || pages) {
      pushSpace()
      segs.push(segPlain('In '))
      if (container) segs.push(segItalic(stripTrailingPeriod(container)))
      if (editors.length > 0) {
        segs.push(segPlain(`${container ? ', ' : ''}edited by ${formatNaturalFullListEn(editors)}`))
      }
      if (pages) {
        segs.push(segPlain(container || editors.length > 0 ? `, ${pages}` : pages))
      }
      segs.push(segPlain('.'))
    }
    if (pubPlace) {
      pushSpace()
      segs.push(segPlain(ensurePeriod(pubPlace)))
    }
    if (doiUrl || url) {
      pushSpace()
      segs.push(segPlain(doiUrl || url))
    }
  } else if (type === 'thesis') {
    if (!usedTitleAsLead && title) {
      pushSpace()
      segs.push(segPlain(quoteWithPeriod(title)))
    }
    const thesisLine = [degree || 'Thesis', institution].filter(Boolean).join(', ')
    if (thesisLine) {
      pushSpace()
      segs.push(segPlain(ensurePeriod(thesisLine)))
    }
    if (doiUrl || url) {
      pushSpace()
      segs.push(segPlain(doiUrl || url))
    }
  } else if (type === 'report') {
    if (!usedTitleAsLead && title) {
      pushSpace()
      segs.push(segItalic(stripTrailingPeriod(title)))
      segs.push(segPlain('.'))
    }
    const org = pubPlace || institution
    if (org) {
      pushSpace()
      segs.push(segPlain(ensurePeriod(org)))
    }
    if (doiUrl || url) {
      pushSpace()
      segs.push(segPlain(doiUrl || url))
    }
  } else if (type === 'conference') {
    if (!usedTitleAsLead && title) {
      pushSpace()
      segs.push(segPlain(quoteWithPeriod(title)))
    }
    if (container || pages) {
      pushSpace()
      if (container) {
        segs.push(segPlain('In '))
        segs.push(segItalic(stripTrailingPeriod(container)))
      }
      if (pages) segs.push(segPlain(container ? `, ${pages}` : pages))
      segs.push(segPlain('.'))
    }
    if (pubPlace) {
      pushSpace()
      segs.push(segPlain(ensurePeriod(pubPlace)))
    }
    if (doiUrl || url) {
      pushSpace()
      segs.push(segPlain(doiUrl || url))
    }
  } else if (type === 'webpage') {
    if (!usedTitleAsLead && title) {
      pushSpace()
      segs.push(segPlain(quoteWithPeriod(title)))
    }
    if (container) {
      pushSpace()
      segs.push(segItalic(stripTrailingPeriod(container)))
      segs.push(segPlain('.'))
    }
    if (accessed) {
      pushSpace()
      segs.push(segPlain(`Accessed ${accessed}.`))
    }
    if (url) {
      pushSpace()
      segs.push(segPlain(url))
    }
  } else {
    if (!usedTitleAsLead && title) {
      pushSpace()
      segs.push(segPlain(ensurePeriod(title)))
    }
    if (container) {
      pushSpace()
      segs.push(segItalic(stripTrailingPeriod(container)))
      segs.push(segPlain('.'))
    }
    const org = pubPlace || institution
    if (org) {
      pushSpace()
      segs.push(segPlain(ensurePeriod(org)))
    }
    if (doiUrl || url) {
      pushSpace()
      segs.push(segPlain(doiUrl || url))
    }
  }

  return mergeSegments(segs)
}

function formatMlaEnBibliography(entry, suffix) {
  const authors = Array.isArray(entry.authors)
    ? entry.authors.map(normalizeAuthor).filter(Boolean)
    : []
  const editors = Array.isArray(entry.editors)
    ? entry.editors.map(normalizeAuthor).filter(Boolean)
    : []
  const yearText = formatYearWithSuffix(entry.year, suffix, 'en', 'mla')
  const title = cleanStr(entry.title)
  const container = cleanStr(entry.containerTitle)
  const volume = cleanStr(entry.volume)
  const issue = cleanStr(entry.issue)
  const pages = cleanStr(entry.pages)
  const publisher = cleanStr(entry.publisher)
  const edition = formatEdition(entry.edition, 'mla', 'en')
  const degree = cleanStr(entry.degree)
  const institution = cleanStr(entry.institution)
  const doiUrl = formatDoiUrl(entry.doi)
  const url = cleanStr(entry.url)
  const accessed = cleanStr(entry.accessed)

  const segs = []
  const pushSpace = () => {
    if (segs.length > 0) segs.push(segPlain(' '))
  }

  if (authors.length > 0) {
    segs.push(segPlain(ensurePeriod(formatAuthorListMlaEn(authors))))
  } else if (editors.length > 0) {
    const edLabel = editors.length === 1 ? 'editor' : 'editors'
    segs.push(segPlain(`${formatAuthorListMlaEn(editors)}, ${edLabel}.`))
  }

  const type = isEntryType(entry.type) ? entry.type : 'other'

  if (type === 'article') {
    if (title) {
      pushSpace()
      segs.push(segPlain(quoteWithPeriod(title)))
    }
    const tail = [
      volume ? `vol. ${volume}` : '',
      issue ? `no. ${issue}` : '',
      yearText,
      formatEnPages(pages),
      doiUrl || url,
    ].filter(Boolean)
    if (container || tail.length > 0) {
      pushSpace()
      if (container) segs.push(segItalic(container))
      if (tail.length > 0) {
        segs.push(segPlain(`${container ? ', ' : ''}${tail.join(', ')}`))
      }
      segs.push(segPlain('.'))
    }
  } else if (type === 'book') {
    if (title) {
      pushSpace()
      segs.push(segItalic(stripTrailingPeriod(title)))
      segs.push(segPlain('.'))
    }
    const tail = [edition, publisher, yearText].filter(Boolean)
    if (tail.length > 0) {
      pushSpace()
      segs.push(segPlain(ensurePeriod(tail.join(', '))))
    }
    if (doiUrl || url) {
      pushSpace()
      segs.push(segPlain(`${doiUrl || url}.`))
    }
  } else if (type === 'chapter') {
    if (title) {
      pushSpace()
      segs.push(segPlain(quoteWithPeriod(title)))
    }
    const tail = [
      editors.length > 0 ? `edited by ${formatEditorsMlaInEn(editors)}` : '',
      edition,
      publisher,
      yearText,
      formatEnPages(pages),
    ].filter(Boolean)
    if (container || tail.length > 0) {
      pushSpace()
      if (container) segs.push(segItalic(container))
      if (tail.length > 0) {
        segs.push(segPlain(`${container ? ', ' : ''}${tail.join(', ')}`))
      }
      segs.push(segPlain('.'))
    }
    if (doiUrl || url) {
      pushSpace()
      segs.push(segPlain(`${doiUrl || url}.`))
    }
  } else if (type === 'thesis') {
    if (title) {
      pushSpace()
      segs.push(segItalic(stripTrailingPeriod(title)))
      segs.push(segPlain('.'))
    }
    const tail = [yearText, institution, degree || 'Thesis'].filter(Boolean)
    if (tail.length > 0) {
      pushSpace()
      segs.push(segPlain(`${tail.join(', ')}.`))
    }
    if (doiUrl || url) {
      pushSpace()
      segs.push(segPlain(`${doiUrl || url}.`))
    }
  } else if (type === 'report') {
    if (title) {
      pushSpace()
      segs.push(segItalic(stripTrailingPeriod(title)))
      segs.push(segPlain('.'))
    }
    const tail = [institution || publisher, yearText].filter(Boolean)
    if (tail.length > 0) {
      pushSpace()
      segs.push(segPlain(`${tail.join(', ')}.`))
    }
    if (doiUrl || url) {
      pushSpace()
      segs.push(segPlain(`${doiUrl || url}.`))
    }
  } else if (type === 'conference') {
    if (title) {
      pushSpace()
      segs.push(segPlain(quoteWithPeriod(title)))
    }
    const tail = [publisher, yearText, formatEnPages(pages)].filter(Boolean)
    if (container || tail.length > 0) {
      pushSpace()
      if (container) segs.push(segItalic(container))
      if (tail.length > 0) {
        segs.push(segPlain(`${container ? ', ' : ''}${tail.join(', ')}`))
      }
      segs.push(segPlain('.'))
    }
    if (doiUrl || url) {
      pushSpace()
      segs.push(segPlain(`${doiUrl || url}.`))
    }
  } else if (type === 'webpage') {
    if (title) {
      pushSpace()
      segs.push(segPlain(quoteWithPeriod(title)))
    }
    const tail = [yearText, url].filter(Boolean)
    if (container || tail.length > 0) {
      pushSpace()
      if (container) segs.push(segItalic(container))
      if (tail.length > 0) {
        segs.push(segPlain(`${container ? ', ' : ''}${tail.join(', ')}`))
      }
      segs.push(segPlain('.'))
    }
    if (accessed) {
      pushSpace()
      segs.push(segPlain(`Accessed ${accessed}.`))
    }
  } else {
    if (title) {
      pushSpace()
      segs.push(segPlain(ensurePeriod(title)))
    }
    const tail = [container, publisher || institution, yearText, doiUrl || url].filter(Boolean)
    if (tail.length > 0) {
      pushSpace()
      segs.push(segPlain(`${tail.join(', ')}.`))
    }
  }

  return mergeSegments(segs)
}

function formatIeeeEnBibliography(entry, ieeeNum) {
  const authors = Array.isArray(entry.authors)
    ? entry.authors.map(normalizeAuthor).filter(Boolean)
    : []
  const editors = Array.isArray(entry.editors)
    ? entry.editors.map(normalizeAuthor).filter(Boolean)
    : []
  const yearText = cleanStr(entry.year)
  const title = cleanStr(entry.title)
  const container = cleanStr(entry.containerTitle)
  const volume = cleanStr(entry.volume)
  const issue = cleanStr(entry.issue)
  const pages = cleanStr(entry.pages)
  const publisher = cleanStr(entry.publisher)
  const place = cleanStr(entry.place)
  const edition = formatEdition(entry.edition, 'ieee', 'en')
  const degree = cleanStr(entry.degree)
  const institution = cleanStr(entry.institution)
  const bareDoi = normalizeDoi(entry.doi)
  const url = cleanStr(entry.url)
  const accessed = cleanStr(entry.accessed)

  const pubPlace = place && publisher ? `${place}: ${publisher}` : publisher || place
  const segs = []
  if (ieeeNum != null) segs.push(segPlain(`[${ieeeNum}] `))

  const hasLeadAuthor = authors.length > 0 || editors.length > 0
  if (authors.length > 0) {
    segs.push(segPlain(`${formatAuthorListIeeeEn(authors)}, `))
  } else if (editors.length > 0) {
    const edLabel = editors.length === 1 ? 'Ed.' : 'Eds.'
    segs.push(segPlain(`${formatAuthorListIeeeEn(editors)}, ${edLabel}, `))
  }

  const type = isEntryType(entry.type) ? entry.type : 'other'

  if (type === 'article') {
    if (title) segs.push(segPlain(quoteWithComma(title)))
    const tail = [
      volume ? `vol. ${volume}` : '',
      issue ? `no. ${issue}` : '',
      formatEnPages(pages),
      yearText,
    ].filter(Boolean)
    if (container) {
      if (title) segs.push(segPlain(' '))
      segs.push(segItalic(container))
      if (tail.length > 0) segs.push(segPlain(`, ${tail.join(', ')}.`))
      else segs.push(segPlain('.'))
    } else if (tail.length > 0) {
      if (title) segs.push(segPlain(' '))
      segs.push(segPlain(`${tail.join(', ')}.`))
    } else if (hasLeadAuthor || title) {
      segs.push(segPlain('.'))
    }
    if (bareDoi) segs.push(segPlain(` doi: ${bareDoi}.`))
    else if (url) segs.push(segPlain(` [Online]. Available: ${url}`))
  } else if (type === 'book') {
    if (title) {
      segs.push(segItalic(stripTrailingPeriod(title)))
      if (edition) segs.push(segPlain(`, ${stripTrailingPeriod(edition)}`))
      segs.push(segPlain('.'))
    }
    const tail = [pubPlace, yearText].filter(Boolean)
    if (tail.length > 0) {
      if (title) segs.push(segPlain(' '))
      segs.push(segPlain(ensurePeriod(tail.join(', '))))
    }
    if (bareDoi) segs.push(segPlain(` doi: ${bareDoi}.`))
    else if (url) segs.push(segPlain(` [Online]. Available: ${url}`))
  } else if (type === 'chapter') {
    if (title) segs.push(segPlain(`${quoteWithComma(title)} `))
    if (container) {
      segs.push(segPlain('in '))
      segs.push(segItalic(stripTrailingPeriod(container)))
    }
    if (editors.length > 0) {
      const edLabel = editors.length === 1 ? 'Ed.' : 'Eds.'
      segs.push(segPlain(`${container ? ', ' : ''}${formatAuthorListIeeeEn(editors)}, ${edLabel}`))
    } else if (container) {
      segs.push(segPlain('.'))
    }
    const tail = [pubPlace, yearText, formatEnPages(pages)].filter(Boolean)
    if (tail.length > 0) {
      segs.push(segPlain(` ${tail.join(', ')}.`))
    }
    if (bareDoi) segs.push(segPlain(` doi: ${bareDoi}.`))
    else if (url) segs.push(segPlain(` [Online]. Available: ${url}`))
  } else if (type === 'thesis') {
    if (title) segs.push(segPlain(`${quoteWithComma(title)} `))
    const tail = [degree || 'Thesis', institution, place, yearText].filter(Boolean)
    if (tail.length > 0) segs.push(segPlain(`${tail.join(', ')}.`))
    if (bareDoi) segs.push(segPlain(` doi: ${bareDoi}.`))
    else if (url) segs.push(segPlain(` [Online]. Available: ${url}`))
  } else if (type === 'report') {
    if (title) segs.push(segPlain(`${quoteWithComma(title)} `))
    const tail = [institution || publisher, place, yearText].filter(Boolean)
    if (tail.length > 0) segs.push(segPlain(`${tail.join(', ')}.`))
    if (bareDoi) segs.push(segPlain(` doi: ${bareDoi}.`))
    else if (url) segs.push(segPlain(` [Online]. Available: ${url}`))
  } else if (type === 'conference') {
    if (title) segs.push(segPlain(`${quoteWithComma(title)} `))
    if (container) {
      segs.push(segPlain('in '))
      segs.push(segItalic(stripTrailingPeriod(container)))
    }
    const tail = [place, yearText, formatEnPages(pages)].filter(Boolean)
    if (tail.length > 0) {
      segs.push(segPlain(`${container ? ', ' : ''}${tail.join(', ')}.`))
    } else if (container) {
      segs.push(segPlain('.'))
    }
    if (bareDoi) segs.push(segPlain(` doi: ${bareDoi}.`))
    else if (url) segs.push(segPlain(` [Online]. Available: ${url}`))
  } else if (type === 'webpage') {
    if (title) segs.push(segPlain(`${quoteWithComma(title)} `))
    if (container) segs.push(segItalic(stripTrailingPeriod(container)))
    if (yearText) segs.push(segPlain(`${container ? ', ' : ''}${yearText}`))
    if (container || yearText) segs.push(segPlain('.'))
    if (url) {
      segs.push(segPlain(` [Online]. Available: ${url}`))
      if (accessed) segs.push(segPlain(` (accessed ${accessed}).`))
    }
  } else {
    if (title) segs.push(segPlain(`${quoteWithComma(title)} `))
    const tail = [container, publisher || institution, yearText].filter(Boolean)
    if (tail.length > 0) segs.push(segPlain(`${tail.join(', ')}.`))
    if (bareDoi) segs.push(segPlain(` doi: ${bareDoi}.`))
    else if (url) segs.push(segPlain(` [Online]. Available: ${url}`))
  }

  return mergeSegments(segs)
}

/**
 * Format a single bibliography entry into plain text and styled segments.
 * Korean entries always use Korean academic style across all four styles.
 */
export function formatBibliographyEntry(entry, style = DEFAULT_CITATION_STYLE, context = {}) {
  const resolvedStyle = isCitationStyle(style) ? style : DEFAULT_CITATION_STYLE
  const lang = detectEntryLanguage(entry)
  const suffix =
    resolvedStyle === 'ieee' || resolvedStyle === 'mla'
      ? ''
      : (context.disambiguationSuffix ?? mapLookup(context.disambiguation, entry.key) ?? '')
  const ieeeNum =
    resolvedStyle === 'ieee'
      ? (context.ieeeNumber ?? mapLookup(context.ieeeNumbers, entry.key))
      : undefined

  let segments
  if (lang === 'ko') {
    segments = formatKoBibliography(entry, suffix, ieeeNum)
  } else if (resolvedStyle === 'apa') {
    segments = formatApaEnBibliography(entry, suffix)
  } else if (resolvedStyle === 'chicago') {
    segments = formatChicagoEnBibliography(entry, suffix)
  } else if (resolvedStyle === 'mla') {
    segments = formatMlaEnBibliography(entry, suffix)
  } else {
    segments = formatIeeeEnBibliography(entry, ieeeNum)
  }

  const text = segments.map((s) => s.text).join('')
  const result = {
    key: entry.key ?? '',
    text,
    segments,
    language: lang,
    style: resolvedStyle,
  }
  if (suffix) result.disambiguation = suffix
  if (ieeeNum != null) result.number = ieeeNum
  return result
}

/** Convenience wrapper returning only the plain formatted bibliography string. */
export function formatBibliographyText(entry, style = DEFAULT_CITATION_STYLE, context = {}) {
  return formatBibliographyEntry(entry, style, context).text
}

/**
 * Sort, assign disambiguation/IEEE numbers, and format an entire bibliography list.
 */
export function formatBibliographyList(entries, style = DEFAULT_CITATION_STYLE, options = {}) {
  const resolvedStyle = isCitationStyle(style) ? style : DEFAULT_CITATION_STYLE
  const sorted = sortBibliographyEntries(entries, resolvedStyle, options)
  const disambiguation = assignDisambiguationSuffixes(sorted, resolvedStyle)
  const ieeeNumbers =
    resolvedStyle === 'ieee'
      ? assignIeeeNumbers(options.citedKeysInOrder ?? sorted.map((e) => e.key), sorted)
      : new Map()

  // For IEEE, ensure any uncited entries appended at the end also receive sequential numbers.
  if (resolvedStyle === 'ieee') {
    let nextNum = ieeeNumbers.size + 1
    for (const entry of sorted) {
      if (!ieeeNumbers.has(entry.key)) {
        ieeeNumbers.set(entry.key, nextNum)
        nextNum += 1
      }
    }
  }

  const formatted = sorted.map((entry) =>
    formatBibliographyEntry(entry, resolvedStyle, { disambiguation, ieeeNumbers }),
  )

  return {
    style: resolvedStyle,
    entries: formatted,
    disambiguation,
    ieeeNumbers,
  }
}

function shortTitleFallback(entry, lang) {
  const title = cleanStr(entry.title)
  if (!title) return lang === 'ko' ? '무제' : 'Untitled'
  if (title.length <= 24) return title
  return `${title.slice(0, 24).trim()}...`
}

function formatInTextAuthors(entry, style, lang, mode) {
  const list =
    Array.isArray(entry.authors) && entry.authors.length > 0
      ? entry.authors.map(normalizeAuthor).filter(Boolean)
      : Array.isArray(entry.editors) && entry.editors.length > 0
        ? entry.editors.map(normalizeAuthor).filter(Boolean)
        : []

  if (list.length === 0) return shortTitleFallback(entry, lang)

  const names = list.map((a) => formatAuthorInTextName(a, lang)).filter(Boolean)
  if (names.length === 0) return shortTitleFallback(entry, lang)

  if (lang === 'ko') {
    if (names.length === 1) return names[0]
    if (names.length === 2) return `${names[0]}, ${names[1]}`
    return `${names[0]} 외`
  }

  if (names.length === 1) return names[0]
  if (names.length === 2) {
    const conj = style === 'apa' && mode === 'parenthetical' ? ' & ' : ' and '
    return `${names[0]}${conj}${names[1]}`
  }
  return `${names[0]} et al.`
}

function normalizeCitationItem(raw) {
  if (raw && typeof raw === 'object' && 'entry' in raw && raw.entry) {
    return {
      entry: raw.entry,
      locator: cleanOptionalStr(raw.locator),
      prefix: cleanOptionalStr(raw.prefix),
      suffix: cleanOptionalStr(raw.suffix),
    }
  }
  return { entry: raw }
}

function applyPrefixSuffix(core, prefix, suffix) {
  let out = core
  if (prefix) out = `${prefix} ${out}`
  if (suffix) {
    const sep = /^[,;:.]/.test(suffix) ? '' : ', '
    out = `${out}${sep}${suffix}`
  }
  return out
}

function formatSingleParentheticalCore(item, style, disambiguation, shortTitles) {
  const { entry, locator, prefix, suffix } = item
  const lang = detectEntryLanguage(entry)
  const authorText = formatInTextAuthors(entry, style, lang, 'parenthetical')
  const disambig = style === 'mla' ? '' : (mapLookup(disambiguation, entry.key) ?? '')
  const yearText = formatYearWithSuffix(entry.year, disambig, lang, style)
  const locText = locator ? formatLocator(locator, style, lang) : ''

  let core
  if (style === 'mla' && lang === 'en') {
    const shortTitle = mapLookup(shortTitles, entry.key) ?? ''
    if (shortTitle) {
      core = locText ? `${authorText}, ${shortTitle} ${locText}` : `${authorText}, ${shortTitle}`
    } else {
      core = locText ? `${authorText} ${locText}` : authorText
    }
  } else if (style === 'chicago' && lang === 'en') {
    core = locText ? `${authorText} ${yearText}, ${locText}` : `${authorText} ${yearText}`
  } else {
    // APA (en & ko), Chicago (ko), and MLA (ko)
    core = locText ? `${authorText}, ${yearText}, ${locText}` : `${authorText}, ${yearText}`
  }

  return applyPrefixSuffix(core, prefix, suffix)
}

function formatSingleNarrative(item, style, disambiguation, shortTitles) {
  const { entry, locator, prefix, suffix } = item
  const lang = detectEntryLanguage(entry)
  const authorText = formatInTextAuthors(entry, style, lang, 'narrative')
  const disambig = style === 'mla' ? '' : (mapLookup(disambiguation, entry.key) ?? '')
  const yearText = formatYearWithSuffix(entry.year, disambig, lang, style)
  const locText = locator ? formatLocator(locator, style, lang) : ''

  if (style === 'mla' && lang === 'en') {
    const shortTitle = mapLookup(shortTitles, entry.key) ?? ''
    const titleAndLoc = shortTitle ? (locText ? `${shortTitle} ${locText}` : shortTitle) : locText
    const inside = [titleAndLoc, suffix].filter(Boolean).join(', ')
    const paren = inside ? ` (${inside})` : ''
    return prefix ? `${prefix} ${authorText}${paren}` : `${authorText}${paren}`
  }

  const innerBits = [yearText]
  if (locText) innerBits.push(locText)
  if (suffix) innerBits.push(suffix)
  const paren = lang === 'ko' ? `(${innerBits.join(', ')})` : ` (${innerBits.join(', ')})`
  return prefix ? `${prefix} ${authorText}${paren}` : `${authorText}${paren}`
}

function formatIeeeInText(items, mode, ieeeNumbers) {
  const resolved = items.map((item, idx) => {
    const num = mapLookup(ieeeNumbers, item.entry.key)
    return {
      ...item,
      num: typeof num === 'number' ? num : idx + 1,
      lang: detectEntryLanguage(item.entry),
    }
  })

  resolved.sort((a, b) => a.num - b.num)

  if (mode === 'narrative') {
    const parts = resolved.map((it) => {
      const hasAuthors =
        (Array.isArray(it.entry.authors) && it.entry.authors.length > 0) ||
        (Array.isArray(it.entry.editors) && it.entry.editors.length > 0)
      const loc = it.locator ? formatLocator(it.locator, 'ieee', it.lang) : ''
      const bracketInner = applyPrefixSuffix(
        loc ? `${it.num}, ${loc}` : String(it.num),
        it.prefix,
        it.suffix,
      )
      const bracket = `[${bracketInner}]`
      if (!hasAuthors) return bracket
      const authorText = formatInTextAuthors(it.entry, 'ieee', it.lang, 'narrative')
      return it.lang === 'ko' ? `${authorText}${bracket}` : `${authorText} ${bracket}`
    })
    return parts.join(', ')
  }

  const allBare = resolved.every((it) => !it.locator && !it.prefix && !it.suffix)
  if (allBare) {
    // Deduplicate ascending numbers and compress runs of 3+ into [a]-[b].
    const uniqueNums = [...new Set(resolved.map((it) => it.num))]
    const groups = []
    let i = 0
    while (i < uniqueNums.length) {
      let j = i
      while (j + 1 < uniqueNums.length && uniqueNums[j + 1] === uniqueNums[j] + 1) {
        j += 1
      }
      const runLen = j - i + 1
      if (runLen >= 3) {
        groups.push(`[${uniqueNums[i]}]-[${uniqueNums[j]}]`)
      } else {
        for (let k = i; k <= j; k++) {
          groups.push(`[${uniqueNums[k]}]`)
        }
      }
      i = j + 1
    }
    return groups.join(', ')
  }

  return resolved
    .map((it) => {
      const loc = it.locator ? formatLocator(it.locator, 'ieee', it.lang) : ''
      const inner = applyPrefixSuffix(
        loc ? `${it.num}, ${loc}` : String(it.num),
        it.prefix,
        it.suffix,
      )
      return `[${inner}]`
    })
    .join(', ')
}

/**
 * Format one or more citation items as an in-text citation string.
 * Supports parenthetical and narrative modes, locators, prefixes/suffixes,
 * same-author year merging (APA & Chicago), MLA short-title disambiguation,
 * alphabetical grouping, and IEEE ranges.
 */
export function formatInTextCitation(input, style = DEFAULT_CITATION_STYLE, options = {}) {
  const resolvedStyle = isCitationStyle(style) ? style : DEFAULT_CITATION_STYLE
  const rawList = Array.isArray(input) ? input : input ? [input] : []
  const items = rawList.map(normalizeCitationItem).filter((it) => it.entry != null)
  if (items.length === 0) return ''

  const mode = options.mode === 'narrative' ? 'narrative' : 'parenthetical'
  const disambiguation = options.disambiguation
  const ieeeNumbers = options.ieeeNumbers
  const shortTitles =
    resolvedStyle === 'mla'
      ? (options.shortTitles ??
        assignMlaShortTitles(
          Array.isArray(options.allEntries) ? options.allEntries : items.map((it) => it.entry),
        ))
      : undefined

  if (resolvedStyle === 'ieee') {
    return formatIeeeInText(items, mode, ieeeNumbers)
  }

  if (mode === 'narrative') {
    const formatted = items.map((it) =>
      formatSingleNarrative(it, resolvedStyle, disambiguation, shortTitles),
    )
    if (formatted.length === 1) return formatted[0]
    const allEn = items.every((it) => detectEntryLanguage(it.entry) === 'en')
    if (allEn) {
      if (formatted.length === 2) return `${formatted[0]} and ${formatted[1]}`
      return `${formatted.slice(0, -1).join(', ')}, and ${formatted[formatted.length - 1]}`
    }
    return formatted.join(', ')
  }

  const sorted = [...items].sort((a, b) => compareAuthorDateEntries(a.entry, b.entry))

  if (resolvedStyle === 'apa' || resolvedStyle === 'chicago') {
    const fragments = []
    let i = 0
    while (i < sorted.length) {
      const cur = sorted[i]
      const curLang = detectEntryLanguage(cur.entry)
      const curAuthorId = normalizedAuthorIdentity(cur.entry, curLang)
      const canMergeCur = !cur.locator && !cur.prefix && !cur.suffix

      if (canMergeCur) {
        const mergedYears = [
          formatYearWithSuffix(
            cur.entry.year,
            mapLookup(disambiguation, cur.entry.key) ?? '',
            curLang,
            resolvedStyle,
          ),
        ]
        let j = i + 1
        while (j < sorted.length) {
          const next = sorted[j]
          const nextLang = detectEntryLanguage(next.entry)
          const canMergeNext = !next.locator && !next.prefix && !next.suffix
          if (
            canMergeNext &&
            nextLang === curLang &&
            normalizedAuthorIdentity(next.entry, nextLang) === curAuthorId
          ) {
            mergedYears.push(
              formatYearWithSuffix(
                next.entry.year,
                mapLookup(disambiguation, next.entry.key) ?? '',
                nextLang,
                resolvedStyle,
              ),
            )
            j += 1
          } else {
            break
          }
        }
        if (mergedYears.length > 1) {
          const authorText = formatInTextAuthors(cur.entry, resolvedStyle, curLang, 'parenthetical')
          const authorYearSep = resolvedStyle === 'chicago' && curLang === 'en' ? ' ' : ', '
          fragments.push(`${authorText}${authorYearSep}${mergedYears.join(', ')}`)
          i = j
          continue
        }
      }

      fragments.push(formatSingleParentheticalCore(cur, resolvedStyle, disambiguation, shortTitles))
      i += 1
    }
    return `(${fragments.join('; ')})`
  }

  const fragments = sorted.map((it) =>
    formatSingleParentheticalCore(it, resolvedStyle, disambiguation, shortTitles),
  )
  return `(${fragments.join('; ')})`
}

/**
 * Compare an actual bibliography key order against the expected sorted order.
 * Used by bibliography auditing to detect sort-order mismatches.
 */
export function compareSortOrder(actualKeys, expectedKeys) {
  const actual = Array.isArray(actualKeys) ? [...actualKeys] : []
  const expected = Array.isArray(expectedKeys) ? [...expectedKeys] : []
  const expectedIndexMap = new Map()
  expected.forEach((key, idx) => {
    if (!expectedIndexMap.has(key)) expectedIndexMap.set(key, idx)
  })
  const actualIndexMap = new Map()
  actual.forEach((key, idx) => {
    if (!actualIndexMap.has(key)) actualIndexMap.set(key, idx)
  })

  const commonActual = actual.filter((key) => expectedIndexMap.has(key))
  const commonExpected = expected.filter((key) => actualIndexMap.has(key))

  const mismatches = []
  const len = Math.min(commonActual.length, commonExpected.length)
  for (let i = 0; i < len; i++) {
    if (commonActual[i] !== commonExpected[i]) {
      mismatches.push({
        key: commonActual[i],
        actualIndex: actualIndexMap.get(commonActual[i]),
        expectedIndex: expectedIndexMap.get(commonActual[i]),
      })
    }
  }

  return {
    inOrder: mismatches.length === 0,
    actualOrder: commonActual,
    expectedOrder: commonExpected,
    mismatches,
  }
}

/**
 * Detect entries that require a disambiguation suffix (`a`, `b`, ...) whose
 * rendered text is missing that suffix.
 */
export function findMissingDisambiguation(
  entries,
  renderedTextsByKey,
  style = DEFAULT_CITATION_STYLE,
) {
  const expected = assignDisambiguationSuffixes(entries, style)
  const missing = []
  if (expected.size === 0) return missing

  const byKey = new Map()
  for (const entry of entries) {
    if (entry && entry.key) byKey.set(entry.key, entry)
  }

  for (const [key, suffix] of expected.entries()) {
    const entry = byKey.get(key)
    if (!entry) continue
    const lang = detectEntryLanguage(entry)
    const rendered = mapLookup(renderedTextsByKey, key)
    if (typeof rendered !== 'string') continue
    const token = formatYearWithSuffix(entry.year, suffix, lang, style)
    if (token && !rendered.includes(token)) {
      missing.push({
        key,
        expectedSuffix: suffix,
        expectedToken: token,
        year: entry.year ?? '',
      })
    }
  }

  return missing
}
