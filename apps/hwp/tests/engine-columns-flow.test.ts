/**
 * vendor/rhwp-core patch 0048: text added to a section of two or more columns flows into
 * the next column and page.
 *
 * In columns the engine counts a paragraph that has stored line positions short (it leaves
 * the spacing behind its last line out) and expects the stored positions to say where a
 * column ends, by starting again from the top. A paragraph added by an edit gets its line
 * positions chained onto the paragraph in front, so they run on past the column height and
 * never start again. Before the patch such paragraphs kept "fitting": with the default line
 * spacing of 160% a column took 65 lines where 41 fit, and the rest was drawn below the page.
 * 260 lines written after the columns were set came out on 2 pages with 84 lines below the
 * body. Hangul 2024 lays the saved file out on 4 pages (two columns) and 3 pages (three).
 *
 * The calls are the ones the AI tools make: `set_columns` sets the column definition, and
 * `insert_paragraphs` adds a paragraph behind the page setup of a new document with
 * `insertParagraph` and splits every further one off it.
 */
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
/** The gap the tool sets for 8 mm between columns, in HWPUNIT. */
const GAP = 2268

interface Run {
  text?: string
  y: number
  h: number
}

function blank(columns: number): HwpDocument {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  if (columns > 1) doc.setColumnDef(0, columns, 0, 1, GAP)
  return doc
}

/** Writes the lines the way `insert_paragraphs` does on a new document. */
function writeLines(doc: HwpDocument): void {
  doc.insertText(0, 0, 0, '줄 1')
  doc.insertParagraph(0, 1)
  doc.insertText(0, 1, 0, '줄 2')
  for (let k = 2; k < LINES; k++) {
    doc.splitParagraph(0, k - 1, doc.getParagraphLength(0, k - 1))
    doc.insertText(0, k, 0, `줄 ${k + 1}`)
  }
}

/** Lines of text drawn below the body of their page. */
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

describe('text added to a section of columns', () => {
  it.each([
    [2, 4],
    [3, 3],
  ])('fills %i columns and goes on to the next page (%i pages)', (columns, pages) => {
    const doc = blank(columns)
    writeLines(doc)
    expect(doc.pageCount()).toBe(pages)
    expect(linesBelowTheBody(doc)).toBe(0)
    doc.free()
  })

  it('is laid out the same after the file is saved and opened again', () => {
    const doc = blank(2)
    writeLines(doc)
    for (const bytes of [doc.exportHwp(), doc.exportHwpx()]) {
      const reopened = new HwpDocument(bytes)
      expect(reopened.pageCount()).toBe(4)
      expect(linesBelowTheBody(reopened)).toBe(0)
      reopened.free()
    }
    doc.free()
  })

  it('leaves a document of one column as it was', () => {
    const doc = blank(1)
    writeLines(doc)
    expect(doc.pageCount()).toBe(7)
    expect(linesBelowTheBody(doc)).toBe(0)
    doc.free()
  })
})
