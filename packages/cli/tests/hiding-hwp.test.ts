import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import {
  buildHidingMemoText,
  isHidingMemoText,
  readHidingMemoLabel,
} from '@genoffice/agent-core/hiding-memo'
import { hwpMemoListOf } from '@genoffice/file-parse'
import { run, tempDir } from './helpers'

/**
 * A Hangul document with a hiding memo (민감정보 가리기) on the command line:
 * `hwp read` and the reads inside `hwp apply` show the anchor as `{{label}}`, a
 * text search does not find the hidden words, and an edit that would remove the
 * hidden span is refused with `hidden_content`. The document is built with the
 * engine the way the editor builds it.
 */

const NAME = '홍길동'
const LABEL = '이름'

beforeAll(async () => {
  const wasm = createRequire(import.meta.url).resolve('@rhwp/core/rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

function marked(dir: string): string {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  const lines = ['머리 줄', `담당 교사 ${NAME} 연락처`, '끝 줄']
  lines.forEach((line, index) => {
    if (index > 0) doc.splitParagraph(0, index - 1, doc.getParagraphLength(0, index - 1))
    doc.insertText(0, index, 0, line)
  })
  const made = JSON.parse(
    doc.insertMemo(
      0,
      1,
      6,
      9,
      JSON.stringify({ author: 'IeumOffice', text: buildHidingMemoText(LABEL, 'ko') }),
    ),
  ) as { ok: boolean }
  expect(made.ok).toBe(true)
  const path = join(dir, `hidden-${Math.random().toString(36).slice(2)}.hwpx`)
  writeFileSync(path, doc.exportHwpx())
  return path
}

function ops(dir: string, list: unknown[]): string {
  const path = join(dir, `ops-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(path, JSON.stringify(list))
  return path
}

describe('hwp read and the reads of hwp apply show the label', () => {
  it('hwp read', async () => {
    const dir = tempDir()
    const r = await run(['hwp', 'read', marked(dir), '--json'])
    expect(r.code).toBe(0)
    expect(r.stdout).not.toContain(NAME)
    expect(r.json().detail.text).toContain(`담당 교사 {{${LABEL}}} 연락처`)
  })

  it('read ops inside a batch', async () => {
    const dir = tempDir()
    const file = marked(dir)
    const r = await run([
      'hwp',
      'apply',
      file,
      '--ops',
      ops(dir, [{ op: 'read_document' }, { op: 'find_text', text: '연락처' }]),
      '--json',
    ])
    expect(r.code, r.stdout).toBe(0)
    expect(r.stdout).not.toContain(NAME)
    expect(r.stdout).toContain(`{{${LABEL}}}`)
  })
})

describe('hwp apply edits', () => {
  it('a search for the hidden words fails as for words that are not there', async () => {
    const dir = tempDir()
    const hidden = await run([
      'hwp',
      'apply',
      marked(dir),
      '--ops',
      ops(dir, [{ op: 'replace_text', find: NAME, replace: '김철수' }]),
      '--json',
    ])
    const absent = await run([
      'hwp',
      'apply',
      marked(dir),
      '--ops',
      ops(dir, [{ op: 'replace_text', find: '없는 말', replace: '김철수' }]),
      '--json',
    ])
    expect(hidden.code).toBe(absent.code)
    expect(hidden.json().error).toBe(absent.json().error)
    expect(hidden.stdout).not.toContain(NAME)
  })

  it('removing the paragraph with the hidden span is refused (atomic and best effort)', async () => {
    const dir = tempDir()
    const file = marked(dir)
    const before = readFileSync(file)
    const atomic = await run([
      'hwp',
      'apply',
      file,
      '--ops',
      ops(dir, [{ op: 'delete_paragraph', find: '연락처' }]),
      '--json',
    ])
    expect(atomic.code).toBe(1)
    expect(atomic.json()).toMatchObject({
      status: 'error',
      error: 'hidden_content',
      detail: { reason: 'edit', labels: [LABEL] },
    })
    expect(atomic.json().detail.failures[0]).toMatchObject({
      reason: 'hidden_content',
      hidden: { reason: 'edit', labels: [LABEL] },
    })
    expect(readFileSync(file).equals(before)).toBe(true)

    const best = await run([
      'hwp',
      'apply',
      file,
      '--ops',
      ops(dir, [
        { op: 'delete_paragraph', find: '연락처' },
        { op: 'replace_text', find: '끝 줄', replace: '마지막 줄' },
      ]),
      '--best-effort',
      '--json',
    ])
    expect(best.code).toBe(0)
    expect(best.json().status).toBe('partial')
    expect(best.json().detail.failures[0]).toMatchObject({
      index: 0,
      reason: 'hidden_content',
      hidden: { reason: 'edit', labels: [LABEL] },
    })
    const read = await run(['hwp', 'read', file, '--json'])
    expect(read.json().detail.text).toContain('마지막 줄')
    expect(read.json().detail.text).toContain(`{{${LABEL}}}`)
  }, 60_000)

  it('writing an .hwpx out as .hwp keeps the hiding memo', async () => {
    const dir = tempDir()
    const out = join(dir, 'out.hwp')
    const r = await run([
      'hwp',
      'apply',
      marked(dir),
      '--ops',
      ops(dir, [{ op: 'replace_text', find: '끝 줄', replace: '마지막 줄' }]),
      '--out',
      out,
      '--json',
    ])
    expect(r.code, r.stdout).toBe(0)
    expect(r.stdout).not.toContain(NAME)
    const doc = new HwpDocument(readFileSync(out))
    try {
      const hiding = hwpMemoListOf(doc).filter((memo) => isHidingMemoText(memo.text ?? ''))
      expect(hiding.map((memo) => readHidingMemoLabel(memo.text ?? ''))).toEqual([LABEL])
    } finally {
      doc.free()
    }
    const read = await run(['hwp', 'read', out, '--json'])
    expect(read.code, read.stdout).toBe(0)
    expect(read.stdout).not.toContain(NAME)
    expect(read.json().detail.text).toContain(`{{${LABEL}}}`)
  }, 60_000)
})
