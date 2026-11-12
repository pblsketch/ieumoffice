import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { beforeAll, describe, expect, it } from 'vitest'
import { run, tempDir } from './helpers'

/**
 * A deck with a withheld run (민감정보 가리기) on the command line: `slides read`
 * shows `{{label}}`, a text op never reaches the hidden words, and an op that
 * would rewrite, remove or copy the withheld run is refused with
 * `hidden_content` in each batch mode, leaving the file as it was.
 */

const INCH = 914400
const SECRET = 'SECRETNAME'
const LABEL = '학생 이름'
const MARKER = `{{${LABEL}}}`

let dir: string
let deckBytes: Buffer
let ids: { hidden: string; other: string }

function opsFile(ops: unknown[]): string {
  const path = join(dir, `ops-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(path, JSON.stringify(ops))
  return path
}

function copy(name: string): string {
  const path = join(dir, name)
  writeFileSync(path, deckBytes)
  return path
}

async function slideXml(path: string): Promise<string> {
  const zip = await JSZip.loadAsync(readFileSync(path))
  return zip.file('ppt/slides/slide1.xml')!.async('string')
}

beforeAll(async () => {
  dir = tempDir()
  const out = join(dir, 'deck.pptx')
  const box = (y: number, runs: unknown[]) => ({
    op: 'addElement',
    target: { slide: 0 },
    kind: 'textbox',
    offset: { x: INCH, y: y * INCH, cx: 8 * INCH, cy: INCH },
    paragraphs: [{ runs }],
  })
  const created = await run([
    'create',
    '--type',
    'pptx',
    '--ops',
    opsFile([
      box(1, [{ text: 'Call ' }, { text: SECRET, redact: LABEL }, { text: ' today.' }]),
      box(3, [{ text: 'Other box' }]),
    ]),
    '--out',
    out,
    '--json',
  ])
  expect(created.code).toBe(0)
  deckBytes = readFileSync(out)
  expect(await slideXml(out)).toContain(SECRET)
  const read = await run(['slides', 'read', out, '--json'])
  const elements = read.json().detail.pages[0].elements as Array<{ id: string; text?: string }>
  ids = {
    hidden: elements.find((e) => e.text?.includes('Call'))!.id,
    other: elements.find((e) => e.text === 'Other box')!.id,
  }
}, 120_000)

describe('slides read shows a withheld run as its label', () => {
  it('in the element text, full or not', async () => {
    for (const full of [[], ['--full']]) {
      const r = await run(['slides', 'read', copy('read.pptx'), ...full, '--json'])
      expect(r.code).toBe(0)
      expect(r.stdout).not.toContain(SECRET)
      expect(r.stdout).toContain(`Call ${MARKER} today.`)
    }
  })
})

describe('slides apply', () => {
  it('an edit of another box applies and keeps the withheld run with its mark', async () => {
    const path = copy('other.pptx')
    const r = await run([
      'slides',
      'apply',
      path,
      '--ops',
      opsFile([
        {
          op: 'setText',
          target: { slide: 0, el: ids.other },
          paragraphs: [{ runs: [{ text: 'Changed box' }] }],
        },
      ]),
      '--json',
    ])
    expect(r.code).toBe(0)
    expect(r.stdout).not.toContain(SECRET)
    const xml = await slideXml(path)
    expect(xml).toContain('Changed box')
    expect(xml).toContain(SECRET)
    const reread = await run(['slides', 'read', path, '--json'])
    expect(reread.stdout).toContain(MARKER)
  })

  const REWRITE = {
    op: 'setText',
    target: { slide: 0, el: '' },
    paragraphs: [{ runs: [{ text: 'Call someone today.' }] }],
  }

  it('atomic: rewriting the withheld run is refused with hidden_content, nothing written', async () => {
    const path = copy('atomic.pptx')
    const r = await run([
      'slides',
      'apply',
      path,
      '--ops',
      opsFile([{ ...REWRITE, target: { slide: 0, el: ids.hidden } }]),
      '--json',
    ])
    expect(r.code).toBe(1)
    expect(r.json()).toMatchObject({
      status: 'error',
      code: 1,
      error: 'hidden_content',
      detail: { reason: 'edit', labels: [LABEL] },
    })
    expect(r.json().detail.failures[0]).toMatchObject({
      index: 0,
      reason: 'hidden_content',
      hidden: { reason: 'edit', labels: [LABEL] },
    })
    expect(r.json().detail.batch).toEqual({ total: 1, applied: 0, failed: 1, skipped: 0 })
    expect(readFileSync(path).equals(deckBytes)).toBe(true)
  })

  it('best effort and stop on error keep the other ops', async () => {
    const other = {
      op: 'setText',
      target: { slide: 0, el: ids.other },
      paragraphs: [{ runs: [{ text: 'Changed box' }] }],
    }
    const hidden = { ...REWRITE, target: { slide: 0, el: ids.hidden } }
    const best = copy('best.pptx')
    const b = await run([
      'slides',
      'apply',
      best,
      '--ops',
      opsFile([hidden, other]),
      '--best-effort',
      '--json',
    ])
    expect(b.code).toBe(0)
    expect(b.json().status).toBe('partial')
    expect(b.json().detail.failures).toEqual([
      expect.objectContaining({ index: 0, reason: 'hidden_content' }),
    ])
    const xml = await slideXml(best)
    expect(xml).toContain('Changed box')
    expect(xml).toContain(SECRET)

    const stop = copy('stop.pptx')
    const s = await run([
      'slides',
      'apply',
      stop,
      '--ops',
      opsFile([other, hidden, other]),
      '--stop-on-error',
      '--json',
    ])
    expect(s.code).toBe(0)
    expect(s.json().status).toBe('partial')
    expect(s.json().detail.batch).toEqual({ total: 3, applied: 1, failed: 1, skipped: 1 })
    expect(s.json().detail.failures[0]).toMatchObject({ index: 1, reason: 'hidden_content' })
    expect(await slideXml(stop)).toContain(SECRET)
  })

  it('rebuilding the slide that hides something is refused', async () => {
    const path = copy('replace.pptx')
    const spec = join(dir, 'page.json')
    writeFileSync(spec, JSON.stringify({ title: 'x' }))
    const r = await run(['slides', 'replace', path, '--slide', '0', '--spec', spec, '--json'])
    expect(r.code).toBe(1)
    expect(r.json()).toMatchObject({
      error: 'hidden_content',
      detail: { reason: 'edit', labels: [LABEL] },
    })
    expect(readFileSync(path).equals(deckBytes)).toBe(true)
  })
})
