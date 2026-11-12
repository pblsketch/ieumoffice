import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { beforeAll, describe, expect, it } from 'vitest'
import { run, tempDir } from './helpers'

/**
 * A workbook that hides a range (민감정보 가리기, defined name `IeumHide_<label>`)
 * on the command line: `sheet read` shows each hidden cell as `{{label-NN}}`
 * and a cell leaning on one as `{{label}}`, and an op that would write, clear,
 * copy, sort or delete hidden cells is refused with `hidden_content`.
 */

const LABEL = '이름'
let dir: string
let bookBytes: Buffer
let sheetName: string

function file(name: string, data: unknown): string {
  const path = join(dir, name)
  writeFileSync(path, JSON.stringify(data))
  return path
}

function copy(name: string): string {
  const path = join(dir, name)
  writeFileSync(path, bookBytes)
  return path
}

beforeAll(async () => {
  dir = tempDir()
  const plain = join(dir, 'plain.xlsx')
  const made = await run([
    'create',
    '--type',
    'xlsx',
    '--from',
    file('table.json', [
      ['id', 'name', 'greet'],
      [1, 'Hong', '=B2&"!"'],
      [2, 'Kim', '=A3*2'],
    ]),
    '--out',
    plain,
    '--json',
  ])
  expect(made.code).toBe(0)
  const zip = await JSZip.loadAsync(readFileSync(plain))
  let workbook = await zip.file('xl/workbook.xml')!.async('string')
  sheetName = /<sheet\b[^>]*\bname="([^"]+)"/.exec(workbook)![1]!
  const name = `<definedName name="IeumHide_${LABEL}">'${sheetName}'!$B$2:$B$3</definedName>`
  workbook = workbook.includes('<definedNames>')
    ? workbook.replace('<definedNames>', `<definedNames>${name}`)
    : workbook.replace('</sheets>', `</sheets><definedNames>${name}</definedNames>`)
  zip.file('xl/workbook.xml', workbook)
  bookBytes = Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
}, 120_000)

async function apply(path: string, ops: unknown[], ...flags: string[]) {
  return run([
    'sheet',
    'apply',
    path,
    '--ops',
    file(`ops-${Math.random()}.json`, ops),
    ...flags,
    '--json',
  ])
}

describe('sheet read hides the marked cells completely', () => {
  it('values, a leaning formula result, and --where', async () => {
    const path = copy('read.xlsx')
    const r = await run(['sheet', 'read', path, '--json'])
    expect(r.code, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).not.toContain('Hong')
    expect(r.stdout).not.toContain('Kim')
    const rows = r.json().detail.rows as unknown[][]
    expect(rows[1]![1]).toMatch(new RegExp(`^\\{\\{${LABEL}-\\d+\\}\\}$`))
    expect(rows[2]![1]).toMatch(new RegExp(`^\\{\\{${LABEL}-\\d+\\}\\}$`))
    expect(rows[1]![1]).not.toBe(rows[2]![1])
    // C2 leans on B2: its value is hidden, its formula text is not
    expect(rows[1]![2]).toBe(`{{${LABEL}}}`)
    expect(r.json().detail.formulas.C2).toBe('=B2&"!"')
    // C3 does not lean on hidden cells
    expect(rows[2]![2]).toBe(4)
    const where = await run(['sheet', 'read', path, '--where', 'text', '--json'])
    expect(where.stdout).not.toContain('Hong')
    const stats = await run(['sheet', 'read', path, '--stats', '--json'])
    expect(stats.stdout).not.toContain('Hong')
  })
})

describe('sheet apply refuses ops that reach hidden cells', () => {
  it('atomic: writing a hidden cell is hidden_content, nothing written', async () => {
    const path = copy('atomic.xlsx')
    const r = await apply(path, [{ op: 'set_cell', sheetId: sheetName, address: 'B2', value: 'X' }])
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
    expect(readFileSync(path).equals(bookBytes)).toBe(true)
  })

  it('best effort: the other ops apply; a formula reading hidden cells is allowed', async () => {
    const path = copy('best.xlsx')
    const r = await apply(
      path,
      [
        { op: 'delete_rows', sheetId: sheetName, row: 2, count: 1 },
        { op: 'set_formula', sheetId: sheetName, address: 'D2', formula: '=LEN(B2)' },
        { op: 'set_cell', sheetId: sheetName, address: 'A5', value: 'note' },
      ],
      '--best-effort',
    )
    expect(r.code).toBe(0)
    expect(r.json().status).toBe('partial')
    expect(r.json().detail.failures).toEqual([
      expect.objectContaining({
        index: 0,
        op: 'delete_rows',
        reason: 'hidden_content',
        hidden: { reason: 'edit', labels: [LABEL] },
      }),
    ])
    expect(r.json().detail.batch).toMatchObject({ total: 3, applied: 2, failed: 1 })
    const read = await run(['sheet', 'read', path, '--json'])
    expect(read.stdout).not.toContain('Hong')
    expect(read.json().detail.rows[4][0]).toBe('note')
  })

  it('stop on error: the ops before the refused one apply', async () => {
    const path = copy('stop.xlsx')
    const r = await apply(
      path,
      [
        { op: 'set_cell', sheetId: sheetName, address: 'A5', value: 'first' },
        { op: 'copy_range', sheetId: sheetName, source: 'B2:B3', target: 'E2' },
        { op: 'set_cell', sheetId: sheetName, address: 'A6', value: 'never' },
      ],
      '--stop-on-error',
    )
    expect(r.code).toBe(0)
    expect(r.json().status).toBe('partial')
    expect(r.json().detail.batch).toEqual({ total: 3, applied: 1, failed: 1, skipped: 1 })
    expect(r.json().detail.failures[0]).toMatchObject({ index: 1, reason: 'hidden_content' })
  })

  it('sorting over hidden cells or removing the hiding name is refused', async () => {
    const path = copy('sort.xlsx')
    for (const op of [
      { op: 'sort_range', sheetId: sheetName, range: 'A1:C3', keys: [{ column: 'B' }] },
      { op: 'delete_defined_name', name: `IeumHide_${LABEL}` },
      { op: 'find_replace', sheetId: sheetName, find: 'x', replace: 'y' },
    ]) {
      const r = await apply(path, [op])
      expect(r.json().error, op.op).toBe('hidden_content')
    }
    expect(readFileSync(path).equals(bookBytes)).toBe(true)
  })

  it('--cells onto a hidden cell is refused', async () => {
    const path = copy('cells.xlsx')
    const r = await run([
      'sheet',
      'apply',
      path,
      '--cells',
      file('cells.json', [{ cell: 'B3', value: 'X' }]),
      '--json',
    ])
    expect(r.code).toBe(1)
    expect(r.json()).toMatchObject({
      error: 'hidden_content',
      detail: { reason: 'edit', labels: [LABEL] },
    })
  })
})
