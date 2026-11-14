import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

const LINES = 260
const DEFAULT_COLUMN_GAP_HWPUNIT = Math.round((8 * 7200) / 25.4)
const HANCOM_2024_PAGES: Array<[columns: number, pages: number]> = [
  [2, 4],
  [3, 3],
]

interface Run {
  text?: string
  y: number
  h: number
}

function blank(columns: number): HwpDocument {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  if (columns > 1) doc.setColumnDef(0, columns, 0, 1, DEFAULT_COLUMN_GAP_HWPUNIT)
  return doc
}

function insertOneParagraphThenSplitLines(doc: HwpDocument): void {
  doc.insertText(0, 0, 0, '줄 1')
  doc.insertParagraph(0, 1)
  doc.insertText(0, 1, 0, '줄 2')
  for (let k = 2; k < LINES; k++) {
    doc.splitParagraph(0, k - 1, doc.getParagraphLength(0, k - 1))
    doc.insertText(0, k, 0, `줄 ${k + 1}`)
  }
}

function openFixture(name: string): HwpDocument {
  return new HwpDocument(new Uint8Array(readFileSync(join(__dirname, 'fixtures', name))))
}

function paragraphStartingWith(doc: HwpDocument, start: string): number {
  for (let k = 0; k < doc.getParagraphCount(0); k++) {
    if (doc.getTextRange(0, k, 0, doc.getParagraphLength(0, k)).startsWith(start)) return k
  }
  throw new Error(`no paragraph starts with ${start}`)
}

function splitLinesAfter(doc: HwpDocument, at: number, count: number): void {
  for (let k = 0; k < count; k++) {
    doc.splitParagraph(0, at + k, doc.getParagraphLength(0, at + k))
    doc.insertText(0, at + k + 1, 0, `새 줄 ${k + 1}`)
  }
}

function linesBelowTheBody(doc: HwpDocument): number {
  let below = 0
  for (let page = 0; page < doc.pageCount(); page++) {
    const info = JSON.parse(doc.getPageInfo(page)) as {
      height: number
      marginBottom: number
      marginFooter: number
    }
    const bodyBottom = info.height - info.marginBottom - info.marginFooter
    const layout = JSON.parse(doc.getPageTextLayout(page)) as { runs?: Run[] } | Run[]
    const runs = Array.isArray(layout) ? layout : (layout.runs ?? [])
    const lines = new Set(
      runs
        .filter((run) => /\S/.test(run.text ?? '') && run.y + run.h > bodyBottom + 1)
        .map((run) => Math.round(run.y)),
    )
    below += lines.size
  }
  return below
}

// The .hwp save reads its own output back and refuses it when the page count differs.
// Both saved formats must open on the pages the session drew, with no more text below the foot.
function expectReopenedAsLaidOut(doc: HwpDocument): void {
  const verify = JSON.parse(doc.exportHwpVerify()) as {
    pageCountBefore: number
    pageCountAfter: number
  }
  expect(verify.pageCountAfter).toBe(verify.pageCountBefore)
  for (const bytes of [doc.exportHwp(), doc.exportHwpx()]) {
    const reopened = new HwpDocument(bytes)
    expect(reopened.pageCount()).toBe(doc.pageCount())
    expect(linesBelowTheBody(reopened)).toBe(linesBelowTheBody(doc))
    reopened.free()
  }
}

describe('text added to a section of columns', () => {
  it.each(HANCOM_2024_PAGES)(
    'fills %i columns and goes on to the next page (%i pages)',
    (columns, pages) => {
      const doc = blank(columns)
      insertOneParagraphThenSplitLines(doc)
      expect(doc.pageCount()).toBe(pages)
      expect(linesBelowTheBody(doc)).toBe(0)
      doc.free()
    },
  )

  it.each(HANCOM_2024_PAGES)(
    'with %i columns is laid out the same after the file is saved and opened again',
    (columns) => {
      const doc = blank(columns)
      insertOneParagraphThenSplitLines(doc)
      expect(linesBelowTheBody(doc)).toBe(0)
      expectReopenedAsLaidOut(doc)
      doc.free()
    },
  )

  it('leaves a document of one column as it was', () => {
    const doc = blank(1)
    insertOneParagraphThenSplitLines(doc)
    expect(doc.pageCount()).toBe(7)
    expect(linesBelowTheBody(doc)).toBe(0)
    doc.free()
  })
})

// Generated filler text that Hancom Hangul 2024 laid out and saved, metadata stripped.
// Hancom's columns can hold more than the engine measures, so their stored lines run past
// the engine's column foot in the same shape as lines an edit chained on.
describe('a two-column file Hancom laid out', () => {
  it('keeps the pages Hancom gives it when nobody edits it', () => {
    const doc = openFixture('two-column-zone-hancom.hwp')
    expect(doc.pageCount()).toBe(3)
    doc.free()
  })

  it('gets no page Hancom does not give it when an edit adds lines to its prose', () => {
    const doc = openFixture('two-column-prose-hancom.hwp')
    splitLinesAfter(doc, paragraphStartingWith(doc, '6. '), 10)
    expect(doc.pageCount()).toBe(3)
    doc.free()
  })

  it('flows a hundred lines added at the end of its body into columns that hold after saving', () => {
    const doc = openFixture('two-column-zone-hancom.hwp')
    // the engine places the two-column zone lower than Hancom does, so three of Hancom's lines
    // on page 1 already run past the engine's foot before any edit
    const unedited = linesBelowTheBody(doc)
    splitLinesAfter(doc, doc.getParagraphCount(0) - 1, 100)
    expect(linesBelowTheBody(doc)).toBe(unedited)
    expectReopenedAsLaidOut(doc)
    doc.free()
  })
})
