import type { Editor } from '@tiptap/core'
import { REDACT_EL } from '@genoffice/docx-engine'
import { REDACT_MARK, sanitizeLabel } from './redact'

/**
 * The withheld content of a document (민감정보 가리기) as a list that can be
 * compared before and after an edit: each withheld span (consecutive inline
 * nodes under the mark with one label) with its words, and each node whose
 * stored XML carries a withheld run. An edit that changed, removed, split,
 * copied or reordered any of it shows up as a difference, which is how an edit
 * from a caller that never saw the words is checked (the MCP bridge).
 *
 * The rule is the command line's (`packages/cli/src/formats/docx-hiding.ts`),
 * read off the live document instead of a masked copy.
 */

type PmNode = Editor['state']['doc']

interface HiddenSpan {
  label: string
  /** the span's nodes as text: the words, or a picture's type and attributes */
  content: string
}

interface HiddenAtom {
  attrs: string
  labels: string[]
}

export interface HiddenContent {
  spans: HiddenSpan[]
  atoms: HiddenAtom[]
}

/** The label a reader of the marker sees (the same cleaning as the marker). */
function shownLabel(raw: unknown): string {
  return sanitizeLabel(typeof raw === 'string' ? raw : '') || 'private'
}

function contentOf(node: PmNode): string {
  return node.isText
    ? (node.text ?? '')
    : `\u{fffc}${JSON.stringify({ type: node.type.name, attrs: node.attrs })}`
}

/** the spans among the children of one node with inline content */
function collectSpans(node: PmNode, out: HiddenSpan[]): void {
  let current: HiddenSpan | null = null
  node.forEach((child) => {
    const mark = child.marks.find((m) => m.type.name === REDACT_MARK)
    if (!mark) {
      current = null
      return
    }
    const label = shownLabel(mark.attrs.label)
    if (current && current.label === label) {
      current.content += contentOf(child)
    } else {
      current = { label, content: contentOf(child) }
      out.push(current)
    }
  })
}

/** the labels named in a node's stored XML (as JSON) */
function atomLabels(attrs: string): string[] {
  const labels = [...attrs.matchAll(/w:label=\\"([^"\\]*)\\"/g)].map((m) => shownLabel(m[1]))
  return labels.length ? labels : ['private']
}

function collectAtoms(node: PmNode, out: HiddenAtom[]): void {
  node.descendants((child) => {
    if (child.isText) return false
    const attrs = JSON.stringify(child.attrs)
    if (!attrs.includes(`<${REDACT_EL}`)) return true
    out.push({ attrs, labels: atomLabels(attrs) })
    return false
  })
}

/** Every withheld span and withheld-run atom of a document (or of one block), in order. */
export function hiddenContentOf(node: PmNode): HiddenContent {
  const spans: HiddenSpan[] = []
  if (node.inlineContent) collectSpans(node, spans)
  else
    node.descendants((child) => {
      if (!child.inlineContent) return true
      collectSpans(child, spans)
      return false
    })
  const atoms: HiddenAtom[] = []
  collectAtoms(node, atoms)
  return { spans, atoms }
}

export function holdsHiddenContent(content: HiddenContent): boolean {
  return content.spans.length > 0 || content.atoms.length > 0
}

/** distinct labels of the withheld content, in document order */
export function hiddenLabelsOf(content: HiddenContent): string[] {
  return [
    ...new Set([...content.spans.map((s) => s.label), ...content.atoms.flatMap((a) => a.labels)]),
  ]
}

/**
 * The labels of the withheld content that differs between two states of a
 * document; null when every span and atom stands as it was.
 */
export function hiddenContentChange(before: HiddenContent, after: HiddenContent): string[] | null {
  const touched = new Set<string>()
  for (let i = 0; i < Math.max(before.spans.length, after.spans.length); i++) {
    const was = before.spans[i]
    const now = after.spans[i]
    if (was && now && was.label === now.label && was.content === now.content) continue
    if (was) touched.add(was.label)
    if (now) touched.add(now.label)
  }
  for (let i = 0; i < Math.max(before.atoms.length, after.atoms.length); i++) {
    const was = before.atoms[i]
    const now = after.atoms[i]
    if (was?.attrs === now?.attrs) continue
    for (const label of [...(was?.labels ?? []), ...(now?.labels ?? [])]) touched.add(label)
  }
  return touched.size ? [...touched] : null
}

/** The labels of withheld content inside the top-level blocks of these indexes. */
export function hiddenLabelsInBlocks(doc: PmNode, indexes: readonly number[]): string[] {
  const wanted = new Set(indexes)
  const labels: string[] = []
  doc.forEach((block, _offset, index) => {
    if (!wanted.has(index)) return
    labels.push(...hiddenLabelsOf(hiddenContentOf(block)))
    const own = JSON.stringify(block.attrs)
    if (own.includes(`<${REDACT_EL}`)) labels.push(...atomLabels(own))
  })
  return [...new Set(labels)]
}
