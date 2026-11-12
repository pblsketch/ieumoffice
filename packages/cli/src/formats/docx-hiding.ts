import JSZip from 'jszip'
import { placeholderSource, sanitizeLabel } from '@genoffice/agent-core/redact-core'
import { REDACT_EL } from '@genoffice/agent-core/redact-range'
import { docxPartHasMarks, redactDocxPartXml } from '@genoffice/file-parse'
import type { Editor } from '@tiptap/core'
import { unreadableHiding } from '../hiding'

/**
 * Hidden runs of a Word document (민감정보 가리기) on the command line.
 *
 * Reading: every XML part is first rewritten by the same reader the app uses
 * for a Word file read as another file's material (`redactDocxPartXml`), so a
 * withheld run holds only its `{{label}}` and whatever the read prints (block
 * text, HTML, comments, notes, fields, headers) cannot carry its words. A mark
 * that reader cannot place fails the read.
 *
 * Editing: the document is opened as it is, and every withheld span of the
 * body is swapped for its marker in the editor (`maskHidden`) before the first
 * op, so an op that looks for text cannot find hidden words and what an op
 * echoes shows the marker. After every op the markers are checked
 * (`hidingViolation`): an op that dropped, split, renamed, copied or moved one
 * is undone and refused. Before saving, every marker gets its own words back
 * (`unmaskHidden`). A document with no mark is never touched.
 */

type PmNode = Editor['state']['doc']
type PmMark = PmNode['marks'][number]

const REDACT_MARK = 'redaction'
/** what a leaf node reads as in a marker's text: never part of a marker */
const LEAF_TEXT = String.fromCharCode(0xfffc)

export interface DocxHidingBytes {
  /** the bytes with every withheld run as its marker (the input itself when nothing is marked) */
  bytes: Uint8Array
  /** parts that carry a mark, by name */
  markedParts: string[]
  /** the labels each marked part hides, as a reader of the markers sees them */
  partLabels: Record<string, string[]>
}

/** The document as a model may read it; throws (closed) when a mark cannot be placed. */
export async function redactedDocxBytes(bytes: Uint8Array): Promise<DocxHidingBytes> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    // not a package: the engine reports what it is when it opens it
    return { bytes, markedParts: [], partLabels: {} }
  }
  const markedParts: string[] = []
  const partLabels: Record<string, string[]> = {}
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !/\.xml$/i.test(entry.name)) continue
    const xml = await entry.async('string')
    if (!docxPartHasMarks(xml)) continue
    let redacted: string
    try {
      redacted = redactDocxPartXml(xml)
    } catch (err) {
      throw unreadableHiding(err)
    }
    if (redacted === xml && !xml.includes(`<${REDACT_EL}`)) continue
    markedParts.push(entry.name)
    partLabels[entry.name] = [
      ...new Set([...xml.matchAll(/w:label="([^"]*)"/g)].map((m) => shownLabel(decodeXml(m[1]!)))),
    ]
    zip.file(entry.name, redacted)
  }
  if (!markedParts.length) return { bytes, markedParts, partLabels }
  return {
    bytes: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }),
    markedParts,
    partLabels,
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** The label a reader of the marker sees (the same cleaning as the marker). */
function shownLabel(raw: unknown): string {
  return sanitizeLabel(typeof raw === 'string' ? raw : '') || 'private'
}

interface Range {
  from: number
  to: number
  label: string
  nodes: PmNode[]
}

/** Every withheld span of the body: consecutive inline nodes with the mark and one label. */
function hiddenRanges(doc: PmNode): Range[] {
  const out: Range[] = []
  if (doc.inlineContent) collectRanges(doc, -1, out)
  else
    doc.descendants((node, pos) => {
      if (!node.inlineContent) return true
      collectRanges(node, pos, out)
      return false
    })
  return out
}

/** the spans among the children of one node with inline content, which sits at `pos` */
function collectRanges(node: PmNode, pos: number, out: Range[]): void {
  let current: Range | null = null
  node.forEach((child, offset) => {
    const from = pos + 1 + offset
    const to = from + child.nodeSize
    const mark = child.marks.find((m) => m.type.name === REDACT_MARK)
    if (!mark) {
      current = null
      return
    }
    const label = shownLabel(mark.attrs.label)
    if (current && current.label === label && current.to === from) {
      current.to = to
      current.nodes.push(child)
    } else {
      current = { from, to, label, nodes: [child] }
      out.push(current)
    }
  })
}

/** the labels named in an atom's stored XML (as JSON) */
function atomLabels(attrs: string): string[] {
  const labels = [...attrs.matchAll(/w:label=\\"([^"\\]*)\\"/g)].map((m) => shownLabel(m[1]))
  return labels.length ? labels : ['private']
}

/** Atoms whose stored XML holds a withheld run: they cannot be masked, only kept as they are. */
function hiddenAtoms(doc: PmNode): Array<{ attrs: string; labels: string[] }> {
  const out: Array<{ attrs: string; labels: string[] }> = []
  doc.descendants((node) => {
    if (node.isText) return false
    const attrs = JSON.stringify(node.attrs)
    if (!attrs.includes(`<${REDACT_EL}`)) return true
    out.push({ attrs, labels: atomLabels(attrs) })
    return false
  })
  return out
}

/** A masked document: the words of each span, to be put back before saving. */
export interface MaskedHiding {
  spans: Array<{ label: string; nodes: PmNode[]; marks: readonly PmMark[] }>
  atoms: Array<{ attrs: string; labels: string[] }>
  labels: string[]
}

const nonHiding = (marks: readonly PmMark[]): PmMark[] =>
  marks.filter((m) => m.type.name !== REDACT_MARK)

/** Swap every withheld span of the body for its marker; null when the body withholds nothing. */
export function maskHidden(editor: Editor): MaskedHiding | null {
  const doc = editor.state.doc
  const ranges = hiddenRanges(doc)
  const atoms = hiddenAtoms(doc)
  if (!ranges.length && !atoms.length) return null
  const schema = editor.schema
  const tr = editor.state.tr
  const spans: MaskedHiding['spans'] = []
  for (const range of [...ranges].reverse()) {
    const marks = range.nodes[0]!.marks
    tr.replaceWith(range.from, range.to, schema.text(placeholderSource(range.label), marks))
    spans.unshift({ label: range.label, nodes: range.nodes, marks })
  }
  tr.setMeta('addToHistory', false)
  editor.view.dispatch(tr)
  return {
    spans,
    atoms,
    labels: [...new Set([...spans.map((s) => s.label), ...atoms.flatMap((a) => a.labels)])],
  }
}

/**
 * The labels of the hidden content an op changed, removed, copied or moved
 * out of place; null when every marker stands as it was masked.
 */
export function hidingViolation(editor: Editor, masked: MaskedHiding): string[] | null {
  const doc = editor.state.doc
  const now = hiddenRanges(doc)
  const atoms = hiddenAtoms(doc)
  const touched = new Set<string>()
  const was = masked.spans
  for (let i = 0; i < Math.max(was.length, now.length); i++) {
    const before = was[i]
    const after = now[i]
    const text = after ? doc.textBetween(after.from, after.to, '', LEAF_TEXT) : ''
    if (
      !before ||
      !after ||
      before.label !== after.label ||
      text !== placeholderSource(after.label)
    ) {
      if (before) touched.add(before.label)
      if (after) touched.add(after.label)
    }
  }
  for (let i = 0; i < Math.max(masked.atoms.length, atoms.length); i++) {
    const before = masked.atoms[i]
    const after = atoms[i]
    if (before?.attrs !== after?.attrs) {
      for (const label of [...(before?.labels ?? []), ...(after?.labels ?? [])]) touched.add(label)
    }
  }
  return touched.size ? [...touched] : null
}

/** The labels of hidden content inside the top-level blocks of these indexes. */
export function hiddenLabelsInBlocks(editor: Editor, indexes: readonly number[]): string[] {
  const wanted = new Set(indexes)
  const labels: string[] = []
  editor.state.doc.forEach((block, _offset, index) => {
    if (!wanted.has(index)) return
    labels.push(...hiddenRanges(block).map((r) => r.label))
    labels.push(...hiddenAtoms(block).flatMap((a) => a.labels))
    const own = JSON.stringify(block.attrs)
    if (own.includes(`<${REDACT_EL}`)) labels.push(...atomLabels(own))
  })
  return [...new Set(labels)]
}

/**
 * Every marker gets its words back, with what an op did to the marker's
 * formatting carried onto them. Call only when `hidingViolation` found nothing.
 */
export function unmaskHidden(editor: Editor, masked: MaskedHiding): void {
  const ranges = hiddenRanges(editor.state.doc)
  if (ranges.length !== masked.spans.length) {
    throw new Error('the hidden spans of the document no longer line up; nothing was saved')
  }
  const tr = editor.state.tr
  for (let i = ranges.length - 1; i >= 0; i--) {
    const range = ranges[i]!
    const span = masked.spans[i]!
    const was = nonHiding(span.marks)
    const now = nonHiding(range.nodes[0]!.marks)
    const added = now.filter((m) => !m.isInSet(was))
    const removed = was.filter((m) => !m.isInSet(now))
    const nodes = span.nodes.map((node) => {
      let marks = node.marks
      for (const m of removed) marks = m.removeFromSet(marks)
      for (const m of added) marks = m.addToSet(marks)
      return marks === node.marks ? node : node.mark(marks)
    })
    tr.replaceWith(range.from, range.to, nodes)
  }
  tr.setMeta('addToHistory', false)
  editor.view.dispatch(tr)
}
