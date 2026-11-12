/**
 * Markdown to Hangul (decision 0135) keeps the hiding marks: the Markdown
 * editor's Word bytes carry each hidden span as the Word mark, and the Word to
 * Hangul converter writes it as a hiding memo. This walks the same steps the
 * export takes (the editor's document, `exportDocxBytes`, `docxToHwp` with the
 * Hangul look) and reads the Hangul copy's memo list back.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { HwpDocument } from '@rhwp/core'
import { HwpEngine, docxToHwp } from '@genoffice/docx2hwp'
import { hwpMemoListOf } from '@genoffice/file-parse'
import { isHidingMemoText, readHidingMemoLabel } from '@genoffice/agent-core/hiding-memo'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { exportDocxBytes } from '../src/renderer/export/docxExport'

let engine: HwpEngine
beforeAll(async () => {
  engine = await HwpEngine.start(
    readFileSync(createRequire(import.meta.url).resolve('@rhwp/core/rhwp_bg.wasm')),
  )
})

const editors: Editor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
})

function createEditor(md: string): Editor {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: {
        onOpen: () => {},
        onUpdate: () => {},
        onKeyDown: () => false,
        onClose: () => {},
      },
      slashItems: () => [],
    }),
    content: '',
  })
  editor.commands.setContent(md, { contentType: 'markdown' })
  editors.push(editor)
  return editor
}

const noImages = () => Promise.resolve(null)

function memoTexts(bytes: Uint8Array): string[] {
  const doc = new HwpDocument(bytes)
  try {
    return hwpMemoListOf(doc).map((m) => String((m as { text?: unknown }).text ?? ''))
  } finally {
    doc.free()
  }
}

/** a saved Markdown document with two hidden spans, one of them in a table cell */
const MARKED = [
  '담임 <span class="redact-span" data-redaction="" data-label="학생 이름">홍길동</span> 선생님',
  '',
  '| 항목 | 내용 |',
  '| --- | --- |',
  '| 연락처 | <span class="redact-span" data-redaction="" data-label="전화-01">010-1234-5678</span> |',
].join('\n')

describe.each(['hwpx', 'hwp'] as const)('Markdown to %s', (format) => {
  it('writes each hidden span as a hiding memo with its label', async () => {
    const editor = createEditor(MARKED)
    const docx = await exportDocxBytes(editor.getJSON(), noImages)
    const { bytes, losses } = await docxToHwp(docx, format, engine, {
      look: 'hangul',
      hidingLang: 'ko',
    })
    expect(losses.filter((l) => l.feature === 'hiding_mark')).toEqual([])
    const memos = memoTexts(bytes).filter(isHidingMemoText)
    expect(memos.map(readHidingMemoLabel).sort()).toEqual(['전화-01', '학생 이름'])
    expect(memos).toContain('[민감정보 가리기] 학생 이름')
  })

  it('a document without hidden spans gets no memo', async () => {
    const editor = createEditor('담임 홍길동 선생님')
    const docx = await exportDocxBytes(editor.getJSON(), noImages)
    const { bytes } = await docxToHwp(docx, format, engine, { look: 'hangul', hidingLang: 'ko' })
    expect(memoTexts(bytes)).toEqual([])
  })
})
