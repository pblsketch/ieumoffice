import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { beforeAll, describe, expect, it } from 'vitest'
import { REDACT_EL, REDACT_NS, REDACT_PREFIX } from '@genoffice/agent-core/redact-range'
import { run, tempDir } from './helpers'

/**
 * A Word document that hides a run (민감정보 가리기) on the command line: every
 * read shows `{{label}}`, a text search never finds the hidden words, and an op
 * that would remove, change or move the hidden run is refused with
 * `hidden_content` in each batch mode, leaving the file as it was.
 */

const SECRET = 'SECRETNAME'
const LABEL = '학생 이름'
const MARKER = `{{${LABEL}}}`
const PLAIN_RUN = `<w:r><w:t xml:space="preserve">Call ${SECRET} today.</w:t></w:r>`
const HIDDEN_RUNS =
  '<w:r><w:t xml:space="preserve">Call </w:t></w:r>' +
  `<w:r><w:rPr><w:bdr w:val="single" w:sz="6" w:color="6B4FC0"/><${REDACT_EL} w:label="${LABEL}"/></w:rPr><w:t xml:space="preserve">${SECRET}</w:t></w:r>` +
  '<w:r><w:t xml:space="preserve"> today.</w:t></w:r>'

let dir: string
let marked: string
let markedBytes: Buffer

async function documentXml(path: string): Promise<string> {
  const zip = await JSZip.loadAsync(readFileSync(path))
  return zip.file('word/document.xml')!.async('string')
}

beforeAll(async () => {
  dir = tempDir()
  const md = join(dir, 'source.md')
  writeFileSync(md, '# Title\n\nCall SECRETNAME today.\n\nSecond para.\n')
  const plain = join(dir, 'plain.docx')
  const made = await run(['create', '--type', 'docx', '--from', md, '--out', plain, '--json'])
  expect(made.code).toBe(0)
  const zip = await JSZip.loadAsync(readFileSync(plain))
  const xml = await zip.file('word/document.xml')!.async('string')
  expect(xml).toContain(PLAIN_RUN)
  zip.file(
    'word/document.xml',
    xml
      .replace(PLAIN_RUN, HIDDEN_RUNS)
      .replace('<w:document ', `<w:document xmlns:${REDACT_PREFIX}="${REDACT_NS}" `),
  )
  markedBytes = Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
  marked = join(dir, 'marked.docx')
  writeFileSync(marked, markedBytes)
}, 120_000)

function copy(name: string): string {
  const path = join(dir, name)
  writeFileSync(path, markedBytes)
  return path
}

async function apply(path: string, ops: unknown[], ...flags: string[]) {
  const file = join(dir, `ops-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(file, JSON.stringify(ops))
  return run(['docs', 'apply', path, '--ops', file, ...flags, '--json'])
}

describe('docs read and info show a hidden run as its label', () => {
  it('reads block text, HTML and headings with the marker only', async () => {
    const r = await run(['docs', 'read', marked, '--full', '--html', '--json'])
    expect(r.code).toBe(0)
    expect(r.stdout).not.toContain(SECRET)
    const items = r.json().detail.items as Array<{ text?: string }>
    expect(items.some((b) => b.text === `Call ${MARKER} today.`)).toBe(true)
    expect(r.json().detail.html).toContain(MARKER)
    const info = await run(['info', marked, '--json'])
    expect(info.code).toBe(0)
    expect(info.stdout).not.toContain(SECRET)
  })

  it('docs check does not show the words either', async () => {
    const r = await run(['docs', 'check', marked, '--json'])
    expect(r.stdout).not.toContain(SECRET)
  })
})

describe('docs apply never sees hidden words', () => {
  it('a search for the hidden words finds nothing, as for words that are not there', async () => {
    const path = copy('find.docx')
    const hidden = await apply(path, [{ op: 'findReplace', find: SECRET, replace: 'X' }])
    const absent = await apply(copy('absent.docx'), [
      { op: 'findReplace', find: 'NOT-IN-THE-DOCUMENT', replace: 'X' },
    ])
    expect(hidden.code).toBe(absent.code)
    expect(hidden.json().status).toBe(absent.json().status)
    expect(hidden.json().error).toBe(absent.json().error)
    expect(hidden.stdout).not.toContain(SECRET)
    expect(await documentXml(path)).toContain(SECRET)
  })

  it('an edit beside the hidden run applies and keeps the run and its mark', async () => {
    const path = copy('beside.docx')
    const r = await apply(path, [{ op: 'findReplace', find: 'today', replace: 'tomorrow' }])
    expect(r.code).toBe(0)
    expect(r.stdout).not.toContain(SECRET)
    const xml = await documentXml(path)
    expect(xml).toContain('tomorrow')
    expect(xml).toContain(SECRET)
    expect(xml).toContain(`<${REDACT_EL} w:label="${LABEL}"/>`)
  })

  it('an edit elsewhere leaves the hidden paragraph byte for byte', async () => {
    const path = copy('elsewhere.docx')
    const r = await apply(path, [{ op: 'findReplace', find: 'Second', replace: 'Next' }])
    expect(r.code).toBe(0)
    expect(await documentXml(path)).toContain(HIDDEN_RUNS)
  })
})

describe('an op that would remove, change or move hidden content is refused', () => {
  const DELETE = { op: 'deleteBlocks', target: { blockIndexes: [1] } }

  it('atomic: exit 1, error hidden_content with the labels, nothing written', async () => {
    const path = copy('atomic.docx')
    const r = await apply(path, [DELETE])
    expect(r.code).toBe(1)
    const out = r.json()
    expect(out).toMatchObject({
      status: 'error',
      code: 1,
      error: 'hidden_content',
      detail: { reason: 'edit', labels: [LABEL] },
    })
    expect(out.message).toBeTruthy()
    expect(out.suggestion).toBeTruthy()
    expect(out.detail.failures[0]).toMatchObject({
      index: 0,
      op: 'deleteBlocks',
      reason: 'hidden_content',
      hidden: { reason: 'edit', labels: [LABEL] },
    })
    expect(out.detail.batch).toEqual({ total: 1, applied: 0, failed: 1, skipped: 0 })
    expect(readFileSync(path).equals(markedBytes)).toBe(true)
  })

  it('atomic: the first failure decides the error of a longer batch', async () => {
    const path = copy('atomic-many.docx')
    const r = await apply(path, [{ op: 'findReplace', find: 'Second', replace: 'Next' }, DELETE])
    expect(r.code).toBe(1)
    expect(r.json().error).toBe('hidden_content')
    expect(r.json().detail.failures[0]).toMatchObject({ index: 1, reason: 'hidden_content' })
    expect(readFileSync(path).equals(markedBytes)).toBe(true)
  })

  it('best effort: the rest applies, the refused op is in detail.failures', async () => {
    const path = copy('best.docx')
    const r = await apply(
      path,
      [DELETE, { op: 'findReplace', find: 'Second', replace: 'Next' }],
      '--best-effort',
    )
    expect(r.code).toBe(0)
    const out = r.json()
    expect(out.status).toBe('partial')
    expect(out.detail.failures).toEqual([
      expect.objectContaining({
        index: 0,
        op: 'deleteBlocks',
        reason: 'hidden_content',
        hidden: { reason: 'edit', labels: [LABEL] },
      }),
    ])
    const xml = await documentXml(path)
    expect(xml).toContain('Next para.')
    expect(xml).toContain(HIDDEN_RUNS)
  })

  it('stop on error: applies up to the refused op', async () => {
    const path = copy('stop.docx')
    const r = await apply(
      path,
      [
        { op: 'findReplace', find: 'Second', replace: 'Next' },
        DELETE,
        { op: 'findReplace', find: 'Title', replace: 'Heading' },
      ],
      '--stop-on-error',
    )
    expect(r.code).toBe(0)
    const out = r.json()
    expect(out.status).toBe('partial')
    expect(out.detail.batch).toEqual({ total: 3, applied: 1, failed: 1, skipped: 1 })
    expect(out.detail.failures[0]).toMatchObject({ index: 1, reason: 'hidden_content' })
    const xml = await documentXml(path)
    expect(xml).toContain('Next para.')
    expect(xml).toContain('Title')
    expect(xml).toContain(SECRET)
  })

  it('replacing the marker itself, or moving the hidden block, is refused', async () => {
    const path = copy('marker.docx')
    const replace = await apply(path, [{ op: 'findReplace', find: MARKER, replace: 'someone' }])
    expect(replace.code).toBe(1)
    expect(replace.json()).toMatchObject({ error: 'hidden_content', detail: { labels: [LABEL] } })
    const move = await apply(path, [{ op: 'moveBlocks', blockIndexes: [1], afterBlockIndex: 2 }])
    expect(move.code).toBe(1)
    expect(move.json()).toMatchObject({ error: 'hidden_content', detail: { reason: 'edit' } })
    const html = await apply(path, [
      {
        op: 'replace_blocks',
        startBlockIndex: 1,
        endBlockIndex: 1,
        html: `<p>Call ${MARKER} today.</p>`,
      },
    ])
    expect(html.code).toBe(1)
    expect(html.json().error).toBe('hidden_content')
    expect(readFileSync(path).equals(markedBytes)).toBe(true)
  })
})
