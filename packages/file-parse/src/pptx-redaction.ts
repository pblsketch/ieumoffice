import { placeholderSource } from '@genoffice/agent-core/redact-core'
import { REDACT_EL, REDACT_NS } from '@genoffice/agent-core/redact-range'
import { RedactionMarkError } from './redaction-error'
import { countOf, escapeText, scanElements, type XmlElement } from './xml-elements'

/**
 * Withheld runs of a deck, read as another file's material.
 *
 * The deck engine stores the mark as
 * `<a:extLst><a:ext uri="…"><go:redact label="…"/></a:ext></a:extLst>` inside a
 * run's `<a:rPr>` (a field's too: it is parsed as a run), or inside a picture's
 * `<p:spPr>` (packages/pptx-engine `redaction-xml.ts`). The slide editor hands
 * its own model `{{label}}` for such a run and no reference at all for such a
 * picture. This package cannot import the engine, so the shape is restated here;
 * a test holds the extension id against the engine's own constant.
 *
 * The work is done on the part's XML before the text walker in pptx.ts parses
 * it: a withheld run is rewritten to a run holding only its marker, so nothing
 * the run carried can reach the output whatever the walker collects. A picture
 * has no words to rewrite; its mark only has to be one this reader understands.
 *
 * Every trace of the mark in a part has to be accounted for by a run or a
 * picture read that way. One that is not (no label, the wrong parent, markup
 * that does not close) throws, and the deck is not read.
 */

/** the engine's REDACT_EXT_URI: the `uri` of the `<a:ext>` that carries the mark */
export const PPTX_REDACT_EXT_URI = '{9F1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D}'

/**
 * The label a mark carries, read the way the engine reads it: the one label
 * element directly inside our extension, with a label that is not empty.
 */
function labelOf(ext: XmlElement): string {
  const marks = ext.children.filter((c) => c.name === REDACT_EL)
  const label = marks.length === 1 ? marks[0]!.attrs.get('label') : undefined
  if (ext.children.length !== 1 || !label) {
    throw new RedactionMarkError('a mark carries no label')
  }
  return label
}

/** the element whose properties hold this extension list entry, or null */
function propsOf(ext: XmlElement): XmlElement | null {
  return ext.parent?.name === 'a:extLst' ? ext.parent.parent : null
}

/**
 * One slide or notes part with every withheld run rewritten to its `{{label}}`
 * marker. A part with no trace of the mark is returned as it came, unparsed.
 */
export function redactPptxPartXml(xml: string): string {
  if (!xml.includes(PPTX_REDACT_EXT_URI) && !xml.includes(REDACT_EL) && !xml.includes(REDACT_NS)) {
    return xml
  }
  const runs = new Map<XmlElement, string>()
  let understood = 0
  for (const el of scanElements(xml)) {
    if (el.name !== 'a:ext' || el.attrs.get('uri') !== PPTX_REDACT_EXT_URI) continue
    const label = labelOf(el)
    const props = propsOf(el)
    const owner = props?.parent
    if (props?.name === 'a:rPr' && (owner?.name === 'a:r' || owner?.name === 'a:fld')) {
      // the first mark on a run names it, as it does for the engine
      if (!runs.has(owner)) runs.set(owner, label)
    } else if (
      // a picture has no words, and neither has the paragraph mark the engine
      // reads as an empty run: both are understood, with nothing to rewrite
      !(props?.name === 'p:spPr' && owner?.name === 'p:pic') &&
      !(props?.name === 'a:endParaRPr' && owner?.name === 'a:p')
    ) {
      throw new RedactionMarkError('a mark sits where no run or picture carries one')
    }
    understood++
  }
  // one extension, one label element, one namespace at most per mark: a trace
  // left over is a mark that was not read above (a label under someone else's
  // extension, the namespace under another prefix, a mark inside a comment)
  if (
    countOf(xml, PPTX_REDACT_EXT_URI) !== understood ||
    countOf(xml, `<${REDACT_EL}`) !== understood ||
    countOf(xml, REDACT_NS) > understood
  ) {
    throw new RedactionMarkError('a mark is written in a form that cannot be read')
  }
  const out: string[] = []
  let cursor = 0
  for (const [run, label] of [...runs].sort((a, b) => a[0].start - b[0].start)) {
    // a marked run inside another marked run (not valid DrawingML): rewriting
    // both would move backwards and leave the inner words in the part
    if (run.start < cursor) throw new RedactionMarkError('a marked run sits inside another')
    // the whole inside of the run goes: its properties are of no use to a text
    // reader, and anything else it holds is not this reader's to pass on
    out.push(xml.slice(cursor, run.openEnd), `<a:t>${escapeText(placeholderSource(label))}</a:t>`)
    cursor = run.closeStart
  }
  out.push(xml.slice(cursor))
  return out.join('')
}
