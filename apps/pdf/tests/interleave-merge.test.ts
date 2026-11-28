import { describe, expect, it } from 'vitest'
import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  StandardFonts,
} from 'pdf-lib'
import { interleavePdfBytes } from '../src/main/interleave'
import { mergePdfV2Bytes } from '../src/main/merge-v2'
import { readPdfText } from '../src/main/read-text'

async function makeLabeledPdf(
  labels: string[],
  pageSize: [number, number] = [595, 842],
  withBookmarks?: { title: string; pageIndex: number }[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const label of labels) {
    const page = doc.addPage(pageSize)
    page.drawText(label, { x: 50, y: pageSize[1] - 60, size: 14, font })
  }
  if (withBookmarks && withBookmarks.length > 0) {
    const { context } = doc
    const pages = doc.getPages()
    const outlinesRef = context.nextRef()
    const refs = withBookmarks.map(() => context.nextRef())
    for (let i = 0; i < withBookmarks.length; i++) {
      const bm = withBookmarks[i]!
      const dict = context.obj({
        Title: PDFHexString.fromText(bm.title),
        Parent: outlinesRef,
        Dest: context.obj([pages[bm.pageIndex]!.ref, PDFName.of('Fit')]),
      })
      if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1]!)
      if (i + 1 < refs.length) dict.set(PDFName.of('Next'), refs[i + 1]!)
      context.assign(refs[i]!, dict)
    }
    context.assign(
      outlinesRef,
      context.obj({
        Type: 'Outlines',
        First: refs[0]!,
        Last: refs[refs.length - 1]!,
        Count: PDFNumber.of(refs.length),
      }),
    )
    doc.catalog.set(PDFName.of('Outlines'), outlinesRef)
  }
  return doc.save({ useObjectStreams: false })
}

function readOutlineTree(doc: PDFDocument): { title: string; children: string[] }[] {
  const outlines = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict)
  if (!outlines) return []
  const out: { title: string; children: string[] }[] = []
  let cur: unknown = outlines.get(PDFName.of('First'))
  while (cur instanceof PDFRef) {
    const d = doc.context.lookup(cur)
    if (!(d instanceof PDFDict)) break
    const titleObj = d.lookup(PDFName.of('Title'))
    const title = titleObj instanceof PDFHexString ? titleObj.decodeText() : String(titleObj)
    const children: string[] = []
    let childCur: unknown = d.get(PDFName.of('First'))
    while (childCur instanceof PDFRef) {
      const cd = doc.context.lookup(childCur)
      if (!(cd instanceof PDFDict)) break
      const ct = cd.lookup(PDFName.of('Title'))
      children.push(ct instanceof PDFHexString ? ct.decodeText() : String(ct))
      childCur = cd.get(PDFName.of('Next'))
    }
    out.push({ title, children })
    cur = d.get(PDFName.of('Next'))
  }
  return out
}

describe('interleavePdfBytes', () => {
  it('interleaves odd and reversed even pages by default and preserves inputs', async () => {
    const odd = await makeLabeledPdf(['P1', 'P3', 'P5'])
    const even = await makeLabeledPdf(['P6', 'P4', 'P2'])
    const oddSnap = new Uint8Array(odd)
    const evenSnap = new Uint8Array(even)

    const res = await interleavePdfBytes(odd, even)
    expect(odd).toEqual(oddSnap)
    expect(even).toEqual(evenSnap)
    expect(res.totalPages).toBe(6)
    const text = await readPdfText(res.bytes)
    expect(text.pages.map((p) => p.text.trim())).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6'])
  })

  it('supports reverseEven=false and appends remaining pages on mismatched counts', async () => {
    const odd = await makeLabeledPdf(['O1', 'O2', 'O3', 'O4'])
    const even = await makeLabeledPdf(['E1', 'E2'])
    const res = await interleavePdfBytes(odd, even, { reverseEven: false })
    expect(res.totalPages).toBe(6)
    const text = await readPdfText(res.bytes)
    expect(text.pages.map((p) => p.text.trim())).toEqual(['O1', 'E1', 'O2', 'E2', 'O3', 'O4'])
  })
})

describe('mergePdfV2Bytes', () => {
  it('merges per-file page ranges, builds filename bookmarks with nested source outlines, and unifies paper size', async () => {
    const docA = await makeLabeledPdf(
      ['A1', 'A2', 'A3'],
      [612, 792], // Letter
      [
        { title: 'Intro', pageIndex: 0 },
        { title: 'SkippedPage', pageIndex: 1 },
        { title: 'Summary', pageIndex: 2 },
      ],
    )
    const docB = await makeLabeledPdf(['B1', 'B2'], [420, 595]) // A5

    const res = await mergePdfV2Bytes(
      [
        { bytes: docA, name: 'Report A.pdf', pages: [0, 2] },
        { bytes: docB, name: 'Appendix B.pdf' },
      ],
      { addBookmarks: true, unifyPaper: { w: 595, h: 842 } },
    )

    expect(res.totalPages).toBe(4)
    const text = await readPdfText(res.bytes)
    expect(text.pages.map((p) => p.text.trim())).toEqual(['A1', 'A3', 'B1', 'B2'])

    const mergedDoc = await PDFDocument.load(res.bytes, { updateMetadata: false })
    // All pages unified to A4
    for (const page of mergedDoc.getPages()) {
      const box = page.getMediaBox()
      expect(Math.round(box.width)).toBe(595)
      expect(Math.round(box.height)).toBe(842)
    }

    // Bookmarks: top-level filenames + preserved child outlines for included pages only
    const tree = readOutlineTree(mergedDoc)
    expect(tree).toEqual([
      { title: 'Report A', children: ['Intro', 'Summary'] },
      { title: 'Appendix B', children: [] },
    ])
  })
})
