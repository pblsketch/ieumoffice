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

  it('is laid out the same after the file is saved and opened again', () => {
    const doc = blank(2)
    insertOneParagraphThenSplitLines(doc)
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
    insertOneParagraphThenSplitLines(doc)
    expect(doc.pageCount()).toBe(7)
    expect(linesBelowTheBody(doc)).toBe(0)
    doc.free()
  })
})
