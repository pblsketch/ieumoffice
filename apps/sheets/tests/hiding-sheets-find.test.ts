import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import {
  createSensitiveExclusionStore,
  EXCLUSION_DIR,
  EXCLUSION_KEY_FILE,
} from '../src/main/sensitive-exclusions'
import { findSheetCandidates, type FindInput } from '../src/renderer/hiding/find'
import { countAttachmentCandidates } from '../src/renderer/hiding/use-sheet-hiding'

const roster: FindInput = {
  sheets: [
    {
      id: 's1',
      name: '명단',
      cells: [
        { row: 0, column: 0, text: '번호' },
        { row: 0, column: 1, text: '이름' },
        { row: 0, column: 2, text: '연락처' },
        { row: 0, column: 3, text: '비고' },
        { row: 1, column: 0, text: '1' },
        { row: 1, column: 1, text: '김민지' },
        { row: 1, column: 2, text: '010-1234-5678' },
        { row: 1, column: 3, text: '메일 minji@example.com 확인' },
        { row: 2, column: 0, text: '2' },
        { row: 2, column: 1, text: '이준' },
        { row: 2, column: 2, text: '010-9876-5432' },
      ],
    },
    { id: 's2', name: '010-2222-3333', cells: [] },
  ],
  notes: [{ sheetId: 's1', row: 2, column: 3, text: '보호자 010-5555-6666' }],
  chartTitles: [{ sheetId: 's1', title: 'kim@example.org 성적' }],
  hidden: () => false,
}

describe('find sensitive info in a workbook', () => {
  it('offers a name column as one column mark labelled with the kind name only', () => {
    const found = findSheetCandidates(roster, 'ko')
    const column = found.find((candidate) => candidate.column)
    expect(column?.row).toMatchObject({
      kind: 'name',
      label: '이름',
      location: '명단!B2:B',
      hideable: true,
    })
    expect(column?.areas).toEqual([
      { sheetId: 's1', startRow: 1, endRow: 1_048_575, startColumn: 1, endColumn: 1 },
    ])
    // the name values themselves are not offered again cell by cell
    expect(found.filter((candidate) => !candidate.column && candidate.kind === 'name')).toEqual([])
  })

  it('offers scattered finds cell by cell with their context', () => {
    const found = findSheetCandidates(roster, 'ko').filter((c) => !c.column && c.row.hideable)
    expect(found.map((c) => [c.kind, c.row.location, c.value])).toEqual([
      ['phone', '명단!C2', '010-1234-5678'],
      ['email', '명단!D2', 'minji@example.com'],
      ['phone', '명단!C3', '010-9876-5432'],
    ])
    expect(found[1]?.row.before).toBe('메일 ')
    expect(found.every((c) => c.row.label === (c.kind === 'phone' ? '전화' : c.row.label))).toBe(
      true,
    )
  })

  it('lists sheet names, chart titles and notes as spots that cannot be hidden', () => {
    const unhideable = findSheetCandidates(roster, 'ko').filter((c) => !c.row.hideable)
    expect(unhideable.map((c) => [c.row.reason, c.value])).toEqual([
      ['sheet-name', '010-2222-3333'],
      ['chart-title', 'kim@example.org'],
      ['cell-note', '010-5555-6666'],
    ])
    expect(unhideable.every((c) => c.areas.length === 0)).toBe(true)
  })

  it('never offers what is already hidden', () => {
    const found = findSheetCandidates(
      { ...roster, hidden: (_sheet, _row, column) => column === 1 || column === 2 },
      'ko',
    )
    expect(found.some((c) => c.column)).toBe(false)
    expect(found.filter((c) => c.kind === 'phone' && c.row.hideable)).toEqual([])
  })

  it('counts candidates in attachments through the attachment reader', async () => {
    const texts: Record<string, string> = {
      '/a.txt': '연락처 010-1111-2222\nnothing',
      '/b.png': '',
    }
    const count = await countAttachmentCandidates(
      [
        { path: '/a.txt', name: 'a.txt', ext: 'txt', sizeBytes: 1 },
        { path: '/b.png', name: 'b.png', ext: 'png', sizeBytes: 1 },
      ],
      async (path) => ({ ok: true, text: texts[path], totalChars: texts[path]?.length ?? 0 }),
    )
    expect(count).toBe(1)
  })
})

describe('the exclusion memory', () => {
  const dir = mkdtempSync(join(process.env.TEMP ?? tmpdir(), 'pii-T5-exclusions-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('remembers a dismissed value per workbook path by hash and kind only, the key apart', async () => {
    const store = createSensitiveExclusionStore(() => dir)
    const item = { kind: 'phone' as const, value: '010-1234-5678' }
    expect(await store.excluded('C:/a.xlsx', [item])).toEqual([false])
    await store.add('C:/a.xlsx', item)
    expect(
      await store.excluded('C:/a.xlsx', [item, { kind: 'phone', value: '010-0000-0000' }]),
    ).toEqual([true, false])
    // the same value with other spacing is the same value; another workbook does not share it
    expect(await store.excluded('C:/a.xlsx', [{ kind: 'phone', value: '010 1234 5678' }])).toEqual([
      true,
    ])
    expect(await store.excluded('C:/b.xlsx', [item])).toEqual([false])
    const records = readdirSync(join(dir, EXCLUSION_DIR))
    expect(records).toHaveLength(1)
    const record = readFileSync(join(dir, EXCLUSION_DIR, records[0]!), 'utf8')
    expect(record).not.toContain('1234')
    expect(JSON.parse(record).entries).toEqual([
      { hash: expect.stringMatching(/^[0-9a-f]{64}$/), kind: 'phone' },
    ])
    expect(readFileSync(join(dir, EXCLUSION_KEY_FILE)).length).toBeGreaterThanOrEqual(32)
  })
})
