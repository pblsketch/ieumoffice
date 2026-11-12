import { placeholderSource } from '@genoffice/agent-core/redact-core'
import { REDACT_EL, REDACT_NS, REDACT_PREFIX } from '@genoffice/agent-core/redact-range'
import { RedactionMarkError } from './redaction-error'
import { countOf, escapeText, scanElements, type XmlElement } from './xml-elements'

/**
 * Withheld runs of a Word document, read as another file's material.
 *
 * The word processor stores the mark as `<go:redact w:label="…"/>` inside the
 * run's `<w:rPr>`, next to the `w:bdr` Word draws (apps/docs
 * `editor/redaction.ts`), and takes a run as withheld when its raw rPr holds
 * that element anywhere, the previous formatting of a tracked change
 * (`w:rPrChange`) included. Its model sees `{{label}}` for the run. This
 * package cannot import the editor, so the shape is restated here.
 *
 * As for decks, the work is done on the part's XML before the text walker in
 * docx.ts reads it: a withheld run is rewritten to a run holding only its
 * marker, so nothing it carried (its words, a picture's alternative text, a
 * text box inside it) can reach the output. Neighbouring withheld runs of the
 * same label, as Word splits one span into several, keep one marker between
 * them, which is what the editor shows once it has merged them.
 *
 * Every mark in a part has to sit in a run's properties, or in a paragraph
 * mark's (which holds no words). One anywhere else, one that does not close,
 * or the namespace bound to a prefix the editor does not write, throws, and
 * the document is not read.
 */

const ESCAPED_NS = REDACT_NS.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/** a prefix the namespace is bound to */
const PREFIX_BINDING = new RegExp(`xmlns:([\\w.-]+)\\s*=\\s*["']${ESCAPED_NS}["']`, 'g')

/** the namespace bound as the default one, which would make a bare `redact` a mark */
const DEFAULT_BINDING = new RegExp(`xmlns\\s*=\\s*["']${ESCAPED_NS}["']`)

/** Whether a part carries any trace of the mark. */
export function docxPartHasMarks(xml: string): boolean {
  return xml.includes(`<${REDACT_EL}`) || xml.includes(REDACT_NS)
}

/** the run a mark withholds, the paragraph mark it sits on (null), or undefined when neither */
function ownerOf(mark: XmlElement): XmlElement | null | undefined {
  const props = mark.parent
  if (props?.name !== 'w:rPr') return undefined
  const owner = props.parent
  if (owner?.name === 'w:r') return owner
  if (owner?.name === 'w:pPr') return null
  // the run's formatting before a tracked change: the editor reads the whole rPr
  if (owner?.name === 'w:rPrChange' && owner.parent?.name === 'w:rPr') {
    const run = owner.parent.parent
    if (run?.name === 'w:r') return run
    if (run?.name === 'w:pPr') return null
  }
  return undefined
}

/** the run's content starts after its properties: a mark must come before any of it */
function precedesContent(run: XmlElement, props: XmlElement): boolean {
  return run.children[0] === props
}

/**
 * One part (document, notes, header, footer, comments) with every withheld run
 * rewritten to its `{{label}}` marker. A part with no trace of the mark is
 * returned as it came, unparsed.
 */
export function redactDocxPartXml(xml: string): string {
  if (!docxPartHasMarks(xml)) return xml
  for (const binding of xml.matchAll(PREFIX_BINDING)) {
    if (binding[1] !== REDACT_PREFIX && xml.includes(`<${binding[1]}:redact`)) {
      throw new RedactionMarkError('a mark is written under a prefix the editor does not use')
    }
  }
  if (DEFAULT_BINDING.test(xml)) {
    throw new RedactionMarkError('a mark is written in a form that cannot be read')
  }
  const runs = new Map<XmlElement, string>()
  let understood = 0
  for (const el of scanElements(xml)) {
    if (el.name !== REDACT_EL) continue
    const owner = ownerOf(el)
    if (owner === undefined) throw new RedactionMarkError('a mark sits where no run carries one')
    const runProps = owner?.children.find((c) => c.name === 'w:rPr')
    if (owner && (!runProps || !precedesContent(owner, runProps))) {
      throw new RedactionMarkError('a mark sits where no run carries one')
    }
    // the first mark of a run names it, as it does for the editor
    if (owner && !runs.has(owner)) runs.set(owner, el.attrs.get('w:label') ?? 'private')
    understood++
  }
  // a trace left over is a mark the scan did not see as an element (inside a
  // comment, or split in a way no writer produces)
  if (countOf(xml, `<${REDACT_EL}`) !== understood) {
    throw new RedactionMarkError('a mark is written in a form that cannot be read')
  }
  const out: string[] = []
  let cursor = 0
  let previous: { run: XmlElement; label: string } | null = null
  for (const [run, label] of [...runs].sort((a, b) => a[0].start - b[0].start)) {
    // a run inside a withheld one (in a text box of a withheld picture) went with it
    if (run.start < cursor) continue
    if (run.selfClosing) continue
    const adjacent =
      previous !== null &&
      previous.label === label &&
      previous.run.parent === run.parent &&
      xml
        .slice(cursor, run.start)
        .replace(/<\/w:r>/, '')
        .trim() === ''
    out.push(
      xml.slice(cursor, run.openEnd),
      adjacent ? '' : `<w:t>${escapeText(placeholderSource(label))}</w:t>`,
    )
    cursor = run.closeStart
    previous = { run, label }
  }
  if (runs.size === 0) return xml
  out.push(xml.slice(cursor))
  return out.join('')
}
