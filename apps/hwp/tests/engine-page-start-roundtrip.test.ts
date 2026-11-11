/** Page origins must use the visible row of a continued paragraph after save. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import init, { HwpDocument } from '@rhwp/core'
import { beforeAll, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  await init({
    module_or_path: readFileSync(join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')),
  })
})

function syntheticParagraphs(repetitions: number) {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  doc.beginBatch()
  for (let i = 0; i < 100; i++) {
    const text =
      `문서 배치와 입력 지연 측정용 합성 문단 ${i + 1}. 표와 그림이 없는 본문에서 페이지를 넘기며 글자와 줄의 위치를 확인합니다.`.repeat(
        repetitions,
      )
    doc.insertText(0, i, 0, text)
    if (i < 99) doc.splitParagraph(0, i, text.length)
  }
  doc.endBatch()
  return doc
}

interface CaretStart {
  list: number
  para: number
  pos: number
}

describe('continued body paragraph page origins', () => {
  for (const format of ['hwp', 'hwpx'] as const) {
    it.each([1, 2, 3])(
      `keeps every page boundary through ${format} with %i-length paragraphs`,
      (repetitions) => {
        const doc = syntheticParagraphs(repetitions)
        let reopened: HwpDocument | undefined
        try {
          const starts: CaretStart[] = JSON.parse(doc.getPageCaretStarts())
          // Exercise a real continuation: the paragraph's first row is on the
          // previous page while its later row opens the second page.
          expect(starts[1]!.pos).toBeGreaterThan(0)
          expect(JSON.parse(doc.getCursorRect(0, starts[1]!.para, 0)).pageIndex).toBe(0)
          const bytes = format === 'hwp' ? doc.exportHwp() : doc.exportHwpx()
          reopened = new HwpDocument(bytes)
          expect(reopened.pageCount()).toBe(doc.pageCount())
          expect(JSON.parse(reopened.getPageCaretStarts())).toEqual(starts)
          // Equal page counts can conceal a paragraph shifted across a boundary.
          for (const start of starts) {
            expect(JSON.parse(reopened.getCursorRect(0, start.para, start.pos))).toEqual(
              JSON.parse(doc.getCursorRect(0, start.para, start.pos)),
            )
          }
        } finally {
          reopened?.free()
          doc.free()
        }
      },
    )
  }
})
