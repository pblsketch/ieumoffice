import { RedactionMarkError } from './redaction-error'

/**
 * A bare XML element scanner for the redaction readers: every element of a
 * part with its source offsets, so a reader can rewrite a withheld element in
 * place and leave every other byte as it came. Markup that does not balance
 * throws a RedactionMarkError: a part whose marks cannot be told apart from
 * the rest is not read.
 */

export interface XmlElement {
  name: string
  attrs: Map<string, string>
  parent: XmlElement | null
  children: XmlElement[]
  /** offset of `<` */
  start: number
  /** offset just past the start tag's `>` */
  openEnd: number
  /** offset of the end tag's `<`; equals `openEnd` for a self-closing element */
  closeStart: number
  selfClosing: boolean
}

export const malformed = () => new RedactionMarkError('the XML around a mark is not well-formed')

export function decodeEntities(value: string): string {
  if (!value.includes('&')) return value
  return value.replace(
    /&(?:#x([0-9a-fA-F]+)|#(\d+)|(lt|gt|amp|quot|apos));/g,
    (all, hex, dec, named) => {
      if (named) return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[named as string] ?? all
      const code = hex === undefined ? Number(dec) : Number.parseInt(hex, 16)
      return code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : all
    },
  )
}

export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const NAME_END = /[\s/>=]/

/** one start tag: its name, its attributes and where it ends */
function readStartTag(
  xml: string,
  at: number,
): { name: string; attrs: Map<string, string>; end: number; selfClosing: boolean } {
  let i = at + 1
  while (i < xml.length && !NAME_END.test(xml[i]!)) i++
  const name = xml.slice(at + 1, i)
  if (!name) throw malformed()
  const attrs = new Map<string, string>()
  for (;;) {
    while (i < xml.length && /\s/.test(xml[i]!)) i++
    if (i >= xml.length) throw malformed()
    if (xml[i] === '>') return { name, attrs, end: i + 1, selfClosing: false }
    if (xml[i] === '/') {
      if (xml[i + 1] !== '>') throw malformed()
      return { name, attrs, end: i + 2, selfClosing: true }
    }
    const nameStart = i
    while (i < xml.length && !NAME_END.test(xml[i]!)) i++
    const attr = xml.slice(nameStart, i)
    while (i < xml.length && /\s/.test(xml[i]!)) i++
    if (!attr || xml[i] !== '=') throw malformed()
    i++
    while (i < xml.length && /\s/.test(xml[i]!)) i++
    const quote = xml[i]
    if (quote !== '"' && quote !== "'") throw malformed()
    const close = xml.indexOf(quote, i + 1)
    if (close < 0) throw malformed()
    // a repeated attribute is not well-formed; the first one stands
    if (!attrs.has(attr)) attrs.set(attr, decodeEntities(xml.slice(i + 1, close)))
    i = close + 1
  }
}

function skipPast(xml: string, from: number, terminator: string): number {
  const end = xml.indexOf(terminator, from)
  if (end < 0) throw malformed()
  return end + terminator.length
}

/** every element of the part with its source offsets; throws on markup that does not balance */
export function scanElements(xml: string): XmlElement[] {
  const all: XmlElement[] = []
  const open: XmlElement[] = []
  let i = xml.indexOf('<')
  while (i >= 0) {
    if (xml.startsWith('<!--', i)) i = skipPast(xml, i + 4, '-->')
    else if (xml.startsWith('<![CDATA[', i)) i = skipPast(xml, i + 9, ']]>')
    else if (xml.startsWith('<?', i)) i = skipPast(xml, i + 2, '?>')
    else if (xml.startsWith('<!', i)) i = skipPast(xml, i + 2, '>')
    else if (xml[i + 1] === '/') {
      const end = xml.indexOf('>', i)
      const el = open.pop()
      if (end < 0 || !el || xml.slice(i + 2, end).trim() !== el.name) throw malformed()
      el.closeStart = i
      i = end + 1
    } else {
      const tag = readStartTag(xml, i)
      const parent = open[open.length - 1] ?? null
      const el: XmlElement = {
        name: tag.name,
        attrs: tag.attrs,
        parent,
        children: [],
        start: i,
        openEnd: tag.end,
        closeStart: tag.end,
        selfClosing: tag.selfClosing,
      }
      parent?.children.push(el)
      all.push(el)
      if (!tag.selfClosing) open.push(el)
      i = tag.end
    }
    i = xml.indexOf('<', i)
  }
  if (open.length > 0) throw malformed()
  return all
}

export function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}
