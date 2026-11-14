// Text and unit primitives shared by every parse-* module: entity decoding,
// plain-text extraction, on/off and measurement attribute readers.
import { attrsOf, findChild, type XNode } from './xml-utils'
import { resolveThemeColor } from './theme'
import type { ThemeColors } from './types'

export interface RelInfo {
  target: string
  type: string
  targetMode?: string
}

/** hex color value tolerance: Word/LO accept a leading '#' (tdf#57589) */
export function stripHash(v: string): string {
  const t = (v ?? '').trim()
  return t.startsWith('#') ? t.slice(1) : t
}

/** Word reads a fractional w:line (Google Docs exports) and truncates it; garbage stays NaN */
export function lineTwipsOf(v: string | undefined): number {
  return v !== undefined && /^-?\d+(?:\.\d*)?$/.test(v) ? parseInt(v, 10) : NaN
}

/** w:color -> display hex; w:themeColor resolves against the live palette (beats stale w:val) */
export function colorFrom(
  container: XNode | undefined,
  theme?: ThemeColors | null,
): string | undefined {
  if (!container) return undefined
  const a = attrsOf(findChild(container, 'w:color') ?? {})
  if (a['w:themeColor'] && theme) {
    const resolved = resolveThemeColor(
      a['w:themeColor'],
      theme,
      a['w:themeTint'],
      a['w:themeShade'],
    )
    if (resolved) return resolved
  }
  const val = a['w:val']
  return val && val !== 'auto' ? stripHash(val) : undefined
}

/** explicit `<w:color w:val="auto"/>` (Word's automatic colour): it overrides an inherited
 *  style colour, so it is modeled as the literal 'auto' and resolved to the default ink on screen */
export function autoColorOf(container: XNode | undefined): 'auto' | undefined {
  if (!container) return undefined
  return attrsOf(findChild(container, 'w:color') ?? {})['w:val'] === 'auto' ? 'auto' : undefined
}

/** OOXML on/off toggle, three-state: absent → undefined, explicit off → false */
export function onOffOf(parent: XNode, name: string): boolean | undefined {
  const child = findChild(parent, name)
  if (!child) return undefined
  const val = attrsOf(child)['w:val']
  if (val === undefined) return true
  return !['0', 'false', 'none', 'off'].includes(val.toLowerCase())
}

/**
 * onOffOf for a caller that only has the raw XML of a run's rPr rather than a
 * parsed tree. Reads the toggle off the element's start tag, so both the
 * self-closing and the paired spelling are seen, and an explicit off value is
 * honoured whichever quote style wrote it. Callers that used to sniff this
 * with their own regex silently read a paired element as "not set" and a
 * single-quoted w:val="0" as set.
 */
export function onOffTagIn(xml: string, name: string): boolean | undefined {
  // case-insensitive, as the per-site regexes it replaces were
  const tag = new RegExp(`<${name}(?=[\\s/>])[^>]*>`, 'i').exec(xml)?.[0]
  if (tag === undefined) return undefined
  const val = /\bw:val=(?:"([^"]*)"|'([^']*)')/i.exec(tag)
  const raw = val?.[1] ?? val?.[2]
  if (raw === undefined) return true
  return !['0', 'false', 'none', 'off'].includes(raw.toLowerCase())
}

const HYPHEN_CHARS = { noBreakHyphen: '\u2011', softHyphen: '\u00ad' } as const

export function plainText(xml: string): string {
  const texts: string[] = []
  // a space at cell boundaries keeps table text from gluing together
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(noBreakHyphen|softHyphen)\s*\/>|<\/w:tc>/g
  let m: RegExpExecArray | null
  let pendingGap = false
  while ((m = re.exec(xml)) !== null) {
    if (m[0] === '</w:tc>') {
      pendingGap = texts.length > 0
      continue
    }
    if (pendingGap) {
      texts.push(' ')
      pendingGap = false
    }
    texts.push(m[1] ?? HYPHEN_CHARS[m[2] as keyof typeof HYPHEN_CHARS])
  }
  return decodeEntities(texts.join(''))
}

/**
 * Like `plainText`, but for display previews only (passthrough block
 * previews, outline listings, block search text): it also keeps the
 * characters Word actually shows for `<w:tab/>`/`<w:ptab/>` (tab),
 * `<w:br/>`/`<w:cr/>` (newline, except a page/column break, which is layout
 * only) and `<w:noBreakHyphen/>` (hyphen), which `plainText` drops.
 *
 * This is a separate function rather than a change to `plainText` itself,
 * because `plainText` also backs structural, non-preview computations whose
 * own correctness depends on it staying exactly as narrow as it has always
 * been: the flattened `headerText`/`footerText` string (deliberately joins
 * header runs across a field's internal tab stops into one line --
 * `tests/hf-fldchar-element-form.test.ts` fixes this), an inline content
 * control's reported inner text, an inline picture's leading-whitespace
 * measurement (`imageMeta`'s `imageLeadingText`, which already substitutes
 * `<w:tab/>` itself and has no notion of a leading newline), and several
 * `.trim() === ''`/`!== ''` visibility checks where a stray tab or
 * no-break hyphen with no real text would flip "empty" to "non-empty".
 * Swapping any of those to this richer text would change their output, not
 * just add characters a display preview was missing.
 */
export function previewText(xml: string): string {
  const texts: string[] = []
  // tab-stop *definitions* (w:tabs) and tracked-deletion content (w:del,
  // which can itself hold a deleted <w:tab/>/<w:br/>/...) must not become
  // characters here, same as plainText already keeps w:delText out by only
  // ever matching w:t
  const source = xml
    .replace(/<w:tabs\b[^>]*>[\s\S]*?<\/w:tabs>/gi, '')
    .replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/gi, '')
  // a space at cell boundaries keeps table text from gluing together;
  // w:tab / w:br / w:cr / w:noBreakHyphen are real characters Word shows
  const re =
    /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<\/w:tc>|<w:ptab\b[^>]*\/?>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>|<w:cr\b[^>]*\/?>|<w:noBreakHyphen\b[^>]*\/?>/g
  let m: RegExpExecArray | null
  let pendingGap = false
  const flushGap = () => {
    if (pendingGap) {
      texts.push(' ')
      pendingGap = false
    }
  }
  while ((m = re.exec(source)) !== null) {
    if (m[0] === '</w:tc>') {
      pendingGap = texts.length > 0
      continue
    }
    if (/^<w:br\b/i.test(m[0]) && /w:type="(?:page|column)"/i.test(m[0])) {
      continue
    }
    if (/^<w:(?:tab|ptab)\b/i.test(m[0])) {
      flushGap()
      texts.push('\t')
      continue
    }
    if (/^<w:(?:br|cr)\b/i.test(m[0])) {
      flushGap()
      texts.push('\n')
      continue
    }
    if (/^<w:noBreakHyphen\b/i.test(m[0])) {
      flushGap()
      texts.push('-')
      continue
    }
    flushGap()
    texts.push(m[1])
  }
  return decodeEntities(texts.join(''))
}

/** Visible OMML leaf tokens; editing these preserves the surrounding formula tree. */
export function mathTokens(xml: string): string[] {
  const tokens: string[] = []
  const re = /<m:t(?:\s[^>]*)?>([\s\S]*?)<\/m:t>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) tokens.push(decodeEntities(m[1]))
  return tokens
}

/**
 * Numeric character references only (`&#65;` / `&#xF0B7;`), which fast-xml-parser
 * leaves alone. Text and attribute values read off the parse tree have already had
 * the five named entities resolved, so they must NOT be run through the named-entity
 * replacements again: a document whose visible text is literally `&lt;` is stored as
 * `&amp;lt;`, and a second decode would turn it into `<`.
 */
export function decodeNumericCharRefs(text: string): string {
  return text.replace(
    /&#(?:x([0-9a-f]+)|([0-9]+));/gi,
    (entity, hex: string | undefined, decimal: string | undefined) => {
      const codePoint = parseInt(hex ?? decimal ?? '', hex ? 16 : 10)
      return Number.isFinite(codePoint) &&
        codePoint >= 0 &&
        codePoint <= 0x10ffff &&
        !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? String.fromCodePoint(codePoint)
        : entity
    },
  )
}

/** Full decode, for raw XML slices that never passed through the parser. */
export function decodeEntities(text: string): string {
  return decodeNumericCharRefs(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

export const EMU_PER_PX = 9525

export const EMU_PER_PT = 12700
