import {
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { run, tempDir } from './helpers'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    chmodSync: vi.fn(actual.chmodSync),
    copyFileSync: vi.fn(actual.copyFileSync),
  }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, copyFile: vi.fn(actual.copyFile) }
})

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
const actualPromises = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')

afterEach(() => {
  vi.mocked(chmodSync).mockImplementation(actualFs.chmodSync)
  vi.mocked(copyFileSync).mockImplementation(actualFs.copyFileSync)
  vi.mocked(copyFile).mockImplementation(actualPromises.copyFile)
  Object.defineProperty(process, 'platform', hostPlatform)
})

const errnoError = (code: string) => Object.assign(new Error(`${code}: injected`), { code })

/**
 * The mount these tests describe (gvfs SMB, WebDAV) is a POSIX one: on Windows
 * the copy helpers keep to CopyFileW and never reach the fallback under test.
 * `node:path` and the rest settled at import, so only the platform checks made
 * at call time see the change.
 */
const hostPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
const usePosixMount = () =>
  Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'linux' })

/**
 * A mount that refuses chmod (gvfs SMB, WebDAV). The platform copy fails as
 * libuv fails there: an exclusive copy refuses a file that is already there;
 * otherwise the destination has been created or truncated by then and is
 * removed on the way out.
 */
function refuseChmodLikeGvfs(): void {
  const failCopy = (target: unknown, mode?: number): never => {
    const path = String(target)
    if (((mode ?? 0) & constants.COPYFILE_EXCL) !== 0 && existsSync(path))
      throw errnoError('EEXIST')
    writeFileSync(path, '')
    rmSync(path)
    throw errnoError('ENOTSUP')
  }
  vi.mocked(copyFileSync).mockImplementation((_source, target, mode) => failCopy(target, mode))
  vi.mocked(copyFile).mockImplementation(async (_source, target, mode) => failCopy(target, mode))
  vi.mocked(chmodSync).mockImplementation(() => {
    throw errnoError('ENOTSUP')
  })
}

/** The documents are built with the engine the editor runs; there is no other writer here. */
beforeAll(async () => {
  const wasm = createRequire(import.meta.url).resolve('@rhwp/core/rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

/** 제목 / 본문 / a 2×2 table with an empty cell / 끝 */
function report(): HwpDocument {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  const lines = ['등록제 시행 안내', '7월 1일부터 시행합니다.', '', '끝.']
  lines.forEach((line, index) => {
    if (index > 0) doc.splitParagraph(0, index - 1, doc.getParagraphLength(0, index - 1))
    if (line) doc.insertText(0, index, 0, line)
  })
  doc.pasteHtml(
    0,
    2,
    0,
    '<table><tr><td>구분</td><td>연락처</td></tr><tr><td>특송</td><td></td></tr></table>',
  )
  return doc
}

function write(dir: string, name: string, bytes: Uint8Array): string {
  const path = join(dir, name)
  writeFileSync(path, bytes)
  return path
}

function ops(dir: string, list: unknown): string {
  const path = join(dir, 'ops.json')
  writeFileSync(path, JSON.stringify(list))
  return path
}

/** The text of a written file, as the engine reads it back. */
function textOf(path: string): string[] {
  const doc = new HwpDocument(readFileSync(path))
  try {
    return (JSON.parse(doc.getTextFileText()) as string).split(/\r?\n/).filter(Boolean)
  } finally {
    doc.free()
  }
}

function isOle(path: string): boolean {
  return readFileSync(path)
    .subarray(0, 4)
    .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))
}

function isZip(path: string): boolean {
  return readFileSync(path)
    .subarray(0, 4)
    .equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
}

const EDITS = [
  { op: 'replace_text', find: '7월 1일', replace: '8월 1일' },
  { op: 'insert_paragraphs', where: 'after', anchor: '시행합니다', paragraphs: ['문의는 아래로.'] },
  { op: 'fill_cells', table: 1, cells: [{ row: 2, col: 2, text: '032-722-4315' }] },
]

describe('ieumoffice hwp apply', () => {
  it('edits a .hwp in place, keeps it .hwp and the old bytes beside it', async () => {
    const dir = tempDir()
    const original = report().exportHwp()
    const path = write(dir, 'report.hwp', original)
    const r = await run(['hwp', 'apply', path, '--ops', ops(dir, EDITS), '--json'])
    expect(r.code, r.stdout).toBe(0)
    const { detail, output_path } = r.json()
    expect(output_path).toBe(path)
    expect(detail.format).toBe('hwp')
    expect(detail.batch).toMatchObject({ total: 3, applied: 3, failed: 0 })
    expect(detail.results.every((step: { changed: boolean }) => step.changed)).toBe(true)
    expect(isOle(path)).toBe(true)
    const text = textOf(path).join('\n')
    expect(text).toContain('8월 1일부터 시행합니다.')
    expect(text).toContain('문의는 아래로.')
    expect(text).toContain('032-722-4315')
    expect(detail.backup_path).toBe(`${path}.bak`)
    expect(readFileSync(`${path}.bak`).equals(Buffer.from(original))).toBe(true)
  })

  it('edits a .hwpx and writes it back as .hwpx', async () => {
    const dir = tempDir()
    const path = write(dir, 'report.hwpx', report().exportHwpx())
    const r = await run(['hwp', 'apply', path, '--ops', ops(dir, EDITS), '--json'])
    expect(r.code, r.stdout).toBe(0)
    expect(r.json().detail.format).toBe('hwpx')
    expect(isZip(path)).toBe(true)
    expect(textOf(path).join('\n')).toContain('8월 1일부터')
  })

  it('writes to --out in the format its extension names and leaves the input alone', async () => {
    const dir = tempDir()
    const original = report().exportHwp()
    const path = write(dir, 'report.hwp', original)
    const out = join(dir, 'copy.hwpx')
    const r = await run(['hwp', 'apply', path, '--ops', ops(dir, EDITS), '--out', out, '--json'])
    expect(r.code, r.stdout).toBe(0)
    expect(isZip(out)).toBe(true)
    expect(readFileSync(path).equals(Buffer.from(original))).toBe(true)
    expect(existsSync(`${path}.bak`)).toBe(false)
    expect(r.json().detail.backup_path).toBeUndefined()
  })

  it('refuses an ambiguous edit and leaves the file untouched (atomic)', async () => {
    const dir = tempDir()
    const original = report().exportHwp()
    const path = write(dir, 'report.hwp', original)
    const r = await run([
      'hwp',
      'apply',
      path,
      '--ops',
      ops(dir, [
        { op: 'replace_text', find: '7월 1일', replace: '8월 1일' },
        // "시행" occurs twice: the in-app AI is told the places instead of a guess
        { op: 'replace_text', find: '시행', replace: '실시' },
      ]),
      '--json',
    ])
    expect(r.code).toBe(1)
    const failure = r.json().detail.failures[0]
    expect(failure).toMatchObject({ index: 1, op: 'replace_text', reason: 'op_rejected' })
    expect(readFileSync(path).equals(Buffer.from(original))).toBe(true)
  })

  it('writes what applied with --best-effort and reports the rest', async () => {
    const dir = tempDir()
    const path = write(dir, 'report.hwp', report().exportHwp())
    const r = await run([
      'hwp',
      'apply',
      path,
      '--ops',
      ops(dir, [
        { op: 'replace_text', find: '없는 말', replace: 'x' },
        { op: 'replace_text', find: '끝.', replace: '이상.' },
      ]),
      '--best-effort',
      '--json',
    ])
    expect(r.code, r.stdout).toBe(0)
    const result = r.json()
    expect(result.status).toBe('partial')
    expect(result.detail.batch).toMatchObject({ applied: 1, failed: 1 })
    expect(textOf(path)).toContain('이상.')
  })

  it('names unknown ops and the ones that need the app', async () => {
    const dir = tempDir()
    const path = write(dir, 'report.hwp', report().exportHwp())
    const unknown = await run([
      'hwp',
      'apply',
      path,
      '--ops',
      ops(dir, [{ op: 'replace_txt', find: 'a', replace: 'b' }]),
      '--json',
    ])
    expect(unknown.code).toBe(1)
    expect(unknown.json().detail.failures[0]).toMatchObject({
      reason: 'unknown_op',
      did_you_mean: 'replace_text',
    })
    const web = await run([
      'hwp',
      'apply',
      path,
      '--ops',
      ops(dir, [{ op: 'image_search', query: 'x' }]),
      '--json',
    ])
    expect(web.json().detail.failures[0]).toMatchObject({ reason: 'unsupported' })
  })

  it('runs a batch in memory with --dry-run', async () => {
    const dir = tempDir()
    const original = report().exportHwp()
    const path = write(dir, 'report.hwp', original)
    const r = await run(['hwp', 'apply', path, '--ops', ops(dir, EDITS), '--dry-run', '--json'])
    expect(r.code, r.stdout).toBe(0)
    expect(r.json().summary).toContain('dry run')
    expect(readFileSync(path).equals(Buffer.from(original))).toBe(true)
  })

  it('answers the read ops in the results and leaves the file as it was', async () => {
    const dir = tempDir()
    const original = report().exportHwp()
    const path = write(dir, 'report.hwp', original)
    const r = await run([
      'hwp',
      'apply',
      path,
      '--ops',
      ops(dir, [{ op: 'list_tables' }, { op: 'read_table', table: 1 }]),
      '--json',
    ])
    expect(r.code, r.stdout).toBe(0)
    const [tables, table] = r.json().detail.results
    expect(tables.changed).toBe(false)
    expect(table.output).toContain('특송')
    expect(r.json().output_path).toBeUndefined()
    expect(readFileSync(path).equals(Buffer.from(original))).toBe(true)
    expect(existsSync(`${path}.bak`)).toBe(false)
  })
})

describe('ieumoffice create --type hwp', () => {
  it('builds a new .hwp from ops on a blank document', async () => {
    const dir = tempDir()
    const out = join(dir, 'new.hwp')
    const r = await run([
      'create',
      '--type',
      'hwp',
      '--ops',
      ops(dir, [
        { op: 'insert_paragraphs', where: 'end', paragraphs: ['회의 결과 보고', '참석자: 5명'] },
        {
          op: 'insert_table',
          where: 'end',
          rows: [
            ['안건', '결과'],
            ['예산', '승인'],
          ],
          header: true,
        },
      ]),
      '--out',
      out,
      '--json',
    ])
    expect(r.code, r.stdout).toBe(0)
    expect(isOle(out)).toBe(true)
    const text = textOf(out).join('\n')
    expect(text).toContain('회의 결과 보고')
    expect(text).toContain('예산')
  })

  it('builds a .hwpx and refuses an existing output without --force', async () => {
    const dir = tempDir()
    const out = join(dir, 'new.hwpx')
    const list = ops(dir, [{ op: 'insert_paragraphs', where: 'end', paragraphs: ['안녕하세요'] }])
    const first = await run(['create', '--type', 'hwpx', '--ops', list, '--out', out, '--json'])
    expect(first.code, first.stdout).toBe(0)
    expect(isZip(out)).toBe(true)
    expect(textOf(out)).toContain('안녕하세요')
    const again = await run(['create', '--type', 'hwpx', '--ops', list, '--out', out, '--json'])
    expect(again.code).toBe(2)
    expect(again.json().error).toBe('output_exists')
  })

  it('gives a new document its look with the ops the app has for it', async () => {
    const dir = tempDir()
    const out = join(dir, 'plan.hwpx')
    const title = '현장체험학습 운영 계획'
    const r = await run([
      'create',
      '--type',
      'hwpx',
      '--ops',
      ops(dir, [
        {
          op: 'insert_paragraphs',
          where: 'end',
          paragraphs: [title, '□ 추진 배경', '○ 교실 밖 배움을 지원함', '□ 세부 일정'],
        },
        {
          op: 'insert_table',
          where: 'after',
          anchor: '□ 세부 일정',
          rows: [
            ['구분', '일시'],
            ['1학년', '9. 12.(금)'],
          ],
          header: true,
          look: 'open',
          column_widths: [1, 3],
          size: 11,
        },
        {
          op: 'style_paragraphs',
          styles: [
            { name: '문서제목', size: 20, bold: true, align: 'center' },
            { name: '중제목', size: 15, bold: true, indent: -21, space_before: 10 },
            { name: '본문항목', size: 13, margin_left: 7, indent: -19 },
          ],
          apply: [
            { style: '문서제목', find: title },
            { style: '중제목', starts_with: '□' },
            { style: '본문항목', starts_with: '○' },
          ],
        },
        { op: 'insert_title_box', find: title, look: 'bands', color: '#1F3864' },
        { op: 'set_page_number', position: 'bottom_center' },
        { op: 'set_header_footer', kind: 'footer', text: '운영 계획 | {page}', size: 9 },
        { op: 'format_cells', table: 2, borders: [{ sides: 'bottom', line: 'double' }] },
      ]),
      '--out',
      out,
      '--json',
    ])
    expect(r.code, r.stdout).toBe(0)
    const doc = new HwpDocument(readFileSync(out))
    try {
      const styles = (JSON.parse(doc.getStyleList()) as { name: string }[]).map((s) => s.name)
      expect(styles).toEqual(expect.arrayContaining(['문서제목', '중제목', '본문항목']))
      // the title sits in a box of three rows now, and the schedule is the second table
      const controls = JSON.parse(doc.getControls()) as { ctrlId: string }[]
      expect(controls.filter((control) => control.ctrlId === 'tbl')).toHaveLength(2)
      expect(JSON.parse(doc.getPageNumberPos(0))).toMatchObject({
        pageNumber: { position: 5, format: 0, dash: true },
      })
      expect(JSON.parse(doc.getHeaderFooter(0, false, 0))).toMatchObject({ exists: true })
    } finally {
      doc.free()
    }
    expect(textOf(out).join('\n')).toContain(title)
  })

  it('writes the preview of the edited document, not the opened one (decision 0146)', async () => {
    // a file Hangul 2024 saved: its preview text is "a" and "b", with a drawn first page
    const hancom = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        'apps',
        'hwp',
        'tests',
        'fixtures',
        'hancom-page-number-no-dash.hwpx',
      ),
    )
    const dir = tempDir()
    const path = write(dir, 'hancom.hwpx', hancom)
    const r = await run([
      'hwp',
      'apply',
      path,
      '--ops',
      ops(dir, [{ op: 'replace_text', find: 'a', replace: '새 글' }]),
      '--json',
    ])
    expect(r.code, r.stdout).toBe(0)
    const zip = await JSZip.loadAsync(readFileSync(path))
    expect(await zip.file('Preview/PrvText.txt')!.async('string')).toBe('새 글\r\nb\r\n')
    // no screen to draw the page on: a blank picture, not the old page
    const image = Buffer.from(await zip.file('Preview/PrvImage.png')!.async('uint8array'))
    expect(image.readUInt32BE(16)).toBe(1)
  })
})

describe('a number that counts from 1, and a number with a range', () => {
  const REFUSED: [op: Record<string, unknown>, says: RegExp][] = [
    [{ op: 'replace_text', find: '시행', replace: '실시', occurrence: 0 }, /occurrence must be/],
    [
      { op: 'insert_paragraphs', where: 'after', anchor: '시행', occurrence: 0, paragraphs: ['x'] },
      /occurrence must be/,
    ],
    [{ op: 'delete_paragraph', find: '시행', occurrence: 0 }, /occurrence must be/],
    [
      { op: 'insert_table', where: 'after', anchor: '시행', occurrence: 0, rows: [['a']] },
      /occurrence must be/,
    ],
    [{ op: 'insert_title_box', find: '시행', occurrence: 0 }, /occurrence must be/],
    [{ op: 'format_text', find: '시행', occurrence: 0, bold: true }, /occurrence must be/],
    [{ op: 'format_paragraph', find: '시행', occurrence: 0, bold: true }, /occurrence must be/],
    [
      { op: 'insert_note', kind: 'footnote', after: '시행', occurrence: 0, text: '주' },
      /occurrence must be/,
    ],
    [{ op: 'insert_break', find: '시행', occurrence: 0, kind: 'page' }, /occurrence must be/],
    [{ op: 'insert_toc', where: 'after', anchor: '시행', occurrence: 0 }, /occurrence must be/],
    [{ op: 'insert_toc', section: 1, paragraph: 1, occurrence: 0 }, /occurrence must be/],
    [{ op: 'insert_toc', section: 1, paragraph: 1, occurrence: 2147483648 }, /occurrence must be/],
    [{ op: 'insert_toc', max_level: 0 }, /max_level must be/],
    [{ op: 'insert_toc', max_level: 999 }, /max_level must be/],
    [{ op: 'insert_toc', max_level: 2147483648 }, /max_level must be/],
    [{ op: 'insert_toc', section: 0, paragraph: 1 }, /section must be/],
    [{ op: 'insert_toc', section: 999, paragraph: 1 }, /out of range/],
    [{ op: 'insert_toc', section: 2147483648, paragraph: 1 }, /section must be/],
    [{ op: 'insert_toc', section: 1, paragraph: 0 }, /paragraph must be/],
    [{ op: 'insert_toc', section: 1, paragraph: 999 }, /out of range/],
    [{ op: 'insert_toc', section: 1, paragraph: 2147483648 }, /paragraph must be/],
    [{ op: 'refresh_toc', max_level: 0 }, /max_level must be/],
    [{ op: 'refresh_toc', max_level: 999 }, /max_level must be/],
    [{ op: 'refresh_toc', max_level: 2147483648 }, /max_level must be/],
    [{ op: 'mark_index', section: 0, paragraph: 1, term: '특송' }, /section must be/],
    [{ op: 'mark_index', section: 999, paragraph: 1, term: '특송' }, /out of range/],
    [{ op: 'mark_index', section: 2147483648, paragraph: 1, term: '특송' }, /section must be/],
    [{ op: 'mark_index', section: 1, paragraph: 0, term: '특송' }, /paragraph must be/],
    [{ op: 'mark_index', section: 1, paragraph: 999, term: '특송' }, /out of range/],
    [{ op: 'mark_index', section: 1, paragraph: 2147483648, term: '특송' }, /paragraph must be/],
    [{ op: 'mark_index', section: 1, paragraph: 1, offset: -1, term: '특송' }, /offset must be/],
    [{ op: 'mark_index', section: 1, paragraph: 1, offset: 999, term: '특송' }, /out of range/],
    [
      { op: 'mark_index', section: 1, paragraph: 1, offset: 2147483648, term: '특송' },
      /offset must be/,
    ],
    [{ op: 'mark_index', find: '특송', occurrence: 0, term: '특송' }, /occurrence must be/],
    [
      { op: 'mark_index', find: '특송', occurrence: 2147483648, term: '특송' },
      /occurrence must be/,
    ],
    [{ op: 'insert_index', section: 0, paragraph: 1 }, /section must be/],
    [{ op: 'insert_index', section: 999, paragraph: 1 }, /out of range/],
    [{ op: 'insert_index', section: 2147483648, paragraph: 1 }, /section must be/],
    [{ op: 'insert_index', section: 1, paragraph: 0 }, /paragraph must be/],
    [{ op: 'insert_index', section: 1, paragraph: 999 }, /out of range/],
    [{ op: 'insert_index', section: 1, paragraph: 2147483648 }, /paragraph must be/],
    [{ op: 'insert_index', section: 1, paragraph: 1, occurrence: 0 }, /occurrence must be/],
    [{ op: 'insert_index', where: 'after', anchor: '시행', occurrence: 0 }, /occurrence must be/],
    [{ op: 'insert_index', columns: 0 }, /columns must be/],
    [{ op: 'insert_index', columns: 999 }, /columns must be/],
    [{ op: 'insert_index', columns: 2147483648 }, /columns must be/],
    [{ op: 'refresh_index', columns: 0 }, /columns must be/],
    [{ op: 'refresh_index', columns: 999 }, /columns must be/],
    [{ op: 'refresh_index', columns: 2147483648 }, /columns must be/],
    [
      { op: 'insert_equations', equations: [{ find: '시행', occurrence: 0, script: 'x' }] },
      /occurrence must be/,
    ],
    [
      { op: 'insert_equations', equations: [{ find: '끝.', occurrence: 1.5, script: 'x' }] },
      /occurrence must be/,
    ],
    [
      { op: 'style_paragraphs', apply: [{ style: '바탕글', find: '시행', occurrence: 0 }] },
      /occurrence .* must be/,
    ],
    [
      { op: 'style_paragraphs', apply: [{ style: '바탕글', find: '끝.', occurrence: 1.5 }] },
      /occurrence .* must be/,
    ],
    [{ op: 'read_table', table: 0 }, /no table 0/],
    [{ op: 'read_table', table: 1, from_row: 0 }, /from_row must be a whole number from 1/],
    [{ op: 'fill_cells', table: 0, cells: [{ row: 1, col: 1, text: 'x' }] }, /no table 0/],
    [{ op: 'fill_cells', table: 1, cells: [{ row: 0, col: 1, text: 'x' }] }, /count from 1/],
    [{ op: 'fill_cells', table: 1, cells: [{ row: 1, col: 0, text: 'x' }] }, /count from 1/],
    [{ op: 'check_boxes', table: 0, cells: [{ row: 1, col: 1 }] }, /no table 0/],
    [{ op: 'check_boxes', table: 1, cells: [{ row: 0, col: 1 }] }, /count from 1/],
    [{ op: 'check_boxes', table: 1, cells: [{ row: 1, col: 0 }] }, /count from 1/],
    [{ op: 'add_to_table', table: 0, what: 'rows', at: 1 }, /no table 0/],
    [{ op: 'add_to_table', table: 1, what: 'rows', at: 0 }, /at counts from 1/],
    [{ op: 'add_to_table', table: 1, what: 'rows', at: 1, count: 0 }, /count must be between 1/],
    [{ op: 'remove_from_table', table: 0, what: 'rows', at: 1 }, /no table 0/],
    [{ op: 'remove_from_table', table: 1, what: 'rows', at: 0 }, /at counts from 1/],
    [
      { op: 'remove_from_table', table: 1, what: 'rows', at: 1, count: 0 },
      /count must be between 1/,
    ],
    [{ op: 'delete_table', table: 0 }, /no table 0/],
    ...['table', 'from_row', 'from_col', 'to_row', 'to_col'].map(
      (name): [Record<string, unknown>, RegExp] => [
        { op: 'merge_cells', table: 1, from_row: 1, from_col: 1, to_row: 1, to_col: 2, [name]: 0 },
        new RegExp(`^${name} must be a whole number from 1, not 0\\.$`),
      ],
    ),
    ...['table', 'row', 'col'].map((name): [Record<string, unknown>, RegExp] => [
      { op: 'split_cell', table: 1, row: 1, col: 1, rows: 2, cols: 1, [name]: 0 },
      /must be whole numbers from 1/,
    ]),
    [
      { op: 'split_cell', table: 1, row: 1, col: 1, rows: 0, cols: 1 },
      /rows and cols must be 1 to 10/,
    ],
    [
      { op: 'split_cell', table: 1, row: 1, col: 1, rows: 2, cols: 0 },
      /rows and cols must be 1 to 10/,
    ],
    [
      { op: 'split_cell', table: 1, row: 1, col: 1, rows: 99, cols: 1 },
      /rows and cols must be 1 to 10/,
    ],
    [
      { op: 'split_cell', table: 1, row: 1, col: 1, rows: 2, cols: 11 },
      /rows and cols must be 1 to 10/,
    ],
    [{ op: 'format_cells', table: 0, background: '#EEEEEE' }, /table must be a table number/],
    [
      { op: 'format_cells', table: 1, cells: [{ row: 0, col: 1 }], background: '#EEEEEE' },
      /not in it: 0\.1/,
    ],
    ...['from_row', 'from_col', 'to_row', 'to_col'].map(
      (name): [Record<string, unknown>, RegExp] => [
        {
          op: 'format_cells',
          table: 1,
          range: { from_row: 1, from_col: 1, to_row: 2, to_col: 2, [name]: 0 },
          background: '#EEEEEE',
        },
        /from_row, from_col, to_row and to_col, counted from 1/,
      ],
    ),
    [{ op: 'check_layout', from_table: 0 }, /must be whole numbers from 1/],
    [{ op: 'check_layout', from_table: 1, from_row: 0 }, /must be whole numbers from 1/],
    [{ op: 'fill_field', field: 0, value: 'x' }, /no form fields|no field 0/],
    [{ op: 'edit_note', note: 0, text: 'x' }, /no such note/],
    [{ op: 'delete_note', note: 0 }, /no such note/],
    [{ op: 'set_page_setup', section: 0, paper: 'A4' }, /no such section/],
    [{ op: 'set_columns', count: 0 }, /count must be a whole number from 1 to 4/],
    [{ op: 'set_columns', count: 5 }, /count must be a whole number from 1 to 4/],
    [
      { op: 'set_note_settings', kind: 'footnote', start_number: 0 },
      /start_number must be a whole number from 1 to 9999/,
    ],
    [
      { op: 'set_note_settings', kind: 'footnote', start_number: 10000 },
      /start_number must be a whole number from 1 to 9999/,
    ],
    [
      { op: 'format_paragraph', find: '끝.', list: 'number', list_level: 0 },
      /list_level must be a whole number from 1 to 7/,
    ],
    [
      { op: 'format_paragraph', find: '끝.', list: 'number', list_level: 8 },
      /list_level must be a whole number from 1 to 7/,
    ],
    [{ op: 'list_paragraph_looks', from: 0 }, /from must be a whole number from 1/],
    [{ op: 'resize_picture', picture: 0, width_mm: 50 }, /picture must be a number/],
    [{ op: 'analyze_picture', picture: 0 }, /picture must be a number/],
  ]

  it('is refused by the tool when it is 0 or out of its range, and nothing is written', async () => {
    const dir = tempDir()
    const path = write(dir, 'report.hwp', report().exportHwp())
    const noted = await run([
      'hwp',
      'apply',
      path,
      '--ops',
      ops(dir, [{ op: 'insert_note', kind: 'footnote', after: '끝.', text: '주석' }]),
      '--json',
    ])
    expect(noted.code, noted.stdout).toBe(0)
    const before = readFileSync(path)
    const r = await run([
      'hwp',
      'apply',
      path,
      '--ops',
      ops(dir, [{ op: 'list_tables' }, ...REFUSED.map(([op]) => op)]),
      '--best-effort',
      '--json',
    ])
    expect(r.code, r.stdout).toBe(0)
    const { detail } = r.json()
    expect(detail.results.map((result: { op: string }) => result.op)).toEqual(['list_tables'])
    const failures = new Map<number, { op: string; error: string; reason: string }>(
      detail.failures.map((failure: { index: number }) => [failure.index, failure]),
    )
    REFUSED.forEach(([op, says], index) => {
      const failure = failures.get(index + 1)
      expect(failure, JSON.stringify(op)).toMatchObject({ op: op.op, reason: 'op_rejected' })
      expect(failure!.error, JSON.stringify(op)).toMatch(says)
    })
    expect(readFileSync(path).equals(before)).toBe(true)
  })
})

describe('what the read ops answer', () => {
  const json = (output: string) => JSON.parse(output.slice(output.search(/[{[]/)).split('\n')[0]!)
  const READS = [
    { op: 'read_style', name: '본문 시험' },
    { op: 'read_page_setup' },
    { op: 'read_note_settings' },
    { op: 'read_page_layout' },
    { op: 'read_formatting' },
  ]
  const outputs = (r: Awaited<ReturnType<typeof run>>, count: number): string[] =>
    (r.json().detail.results as { output: string }[]).slice(-count).map((result) => result.output)

  it('can be handed back to the write ops as it came', async () => {
    const dir = tempDir()
    const path = write(dir, 'report.hwpx', report().exportHwpx())
    const first = await run([
      'hwp',
      'apply',
      path,
      '--ops',
      ops(dir, [
        { op: 'create_style', name: '본문 시험', size: 12, line_spacing: 180, margin_left: 10 },
        { op: 'format_paragraph', find: '끝.', line_spacing: 200, margin_left: 20, size: 13 },
        { op: 'set_page_setup', paper: 'B5', margin_left: 25, margin_top: 15 },
        {
          op: 'set_note_settings',
          kind: 'footnote',
          number_format: 'circledDigit',
          start_number: 3,
        },
        { op: 'set_columns', count: 2, gap_mm: 12 },
        ...READS,
      ]),
      '--json',
    ])
    expect(first.code, first.stdout).toBe(0)
    const [style, setup, notes, layout, formatting] = outputs(first, READS.length).map(json)
    expect(JSON.stringify([style, setup, notes, layout, formatting])).not.toMatch(
      /lineSpacing"|marginLeft|marginRight|spacingBefore|spacingAfter|listLevel|englishName|nextStyle|numberFormat|startNumber|gapMm|"margins"|"id"/,
    )
    const look = formatting.looks.find((entry: { size: number }) => entry.size === 13)
    expect(look).toMatchObject({ line_spacing: 200, margin_left: 20 })

    const second = await run([
      'hwp',
      'apply',
      path,
      '--ops',
      ops(dir, [
        { op: 'edit_style', name: '본문 시험', size: 9, line_spacing: 120, margin_left: 0 },
        { op: 'format_paragraph', find: '끝.', line_spacing: 160, margin_left: 0, size: 10 },
        { op: 'set_page_setup', paper: 'A4', margin_left: 30, margin_top: 20 },
        { op: 'set_note_settings', kind: 'footnote', number_format: 'digit', start_number: 1 },
        { op: 'set_columns', count: 1 },
        { op: 'edit_style', name: '본문 시험', ...style },
        { op: 'format_paragraph', find: '끝.', ...look },
        { op: 'set_page_setup', ...setup },
        { op: 'set_note_settings', kind: 'footnote', ...notes.footnote },
        { op: 'set_columns', ...layout.columns },
        ...READS,
      ]),
      '--json',
    ])
    expect(second.code, second.stdout).toBe(0)
    expect(second.json().detail.failures ?? []).toEqual([])
    const again = outputs(second, READS.length).map(json)
    expect(again[0]).toEqual(style)
    expect(again[1]).toEqual(setup)
    expect(again[2]).toEqual(notes)
    expect(again[3].columns).toEqual(layout.columns)
    expect(again[4].looks.find((entry: { size: number }) => entry.size === 13)).toMatchObject({
      line_spacing: 200,
      margin_left: 20,
    })
  })

  it('names the editor argument a refusal is about by the name the op declares', async () => {
    const dir = tempDir()
    const path = write(dir, 'report.hwp', report().exportHwp())
    const r = await run([
      'hwp',
      'apply',
      path,
      '--ops',
      ops(dir, [
        { op: 'list_tables' },
        { op: 'format_paragraph', find: '끝.', line_spacing: 5000 },
        { op: 'format_paragraph', find: '끝.', margin_left: 9999 },
        { op: 'format_text', find: '끝.', char_width: 1 },
        { op: 'insert_table', where: 'end', rows: [['a']], width_percent: 1 },
        { op: 'format_cells', table: 1, row_height_mm: 1 },
        { op: 'set_columns', count: 2, gap_mm: 999 },
        { op: 'format_paragraph', find: '끝.', size: 13, font_size: 14 },
      ]),
      '--best-effort',
      '--json',
    ])
    expect(r.code, r.stdout).toBe(0)
    const errors = (r.json().detail.failures as { error: string; usage?: string }[]).map(
      (failure) => failure.error,
    )
    expect(errors).toHaveLength(7)
    expect(errors[0]).toMatch(/^line_spacing must be/)
    expect(errors[1]).toMatch(/^margin_left must be/)
    expect(errors[2]).toMatch(/^char_width must be/)
    expect(errors[3]).toMatch(/^width_percent must be/)
    expect(errors[4]).toMatch(/^row_height_mm must be/)
    expect(errors[5]).toMatch(/^gap_mm must be/)
    expect(errors[6]).toContain('unknown argument "font_size"; did you mean "size"?')
    expect(r.json().detail.failures[6].usage).toMatch(/^Usage: format_paragraph takes find, /)
  })

  it('refuses a value that is not of the kind its argument declares, where the op once answered as done', async () => {
    const dir = tempDir()
    const path = write(dir, 'report.hwp', report().exportHwp())
    const r = await run([
      'hwp',
      'apply',
      path,
      '--ops',
      ops(dir, [
        { op: 'list_tables' },
        { op: 'set_page_number', position: 'bottom_center', dashes: 'no' },
        { op: 'insert_table', where: 'end', rows: [['a']], style: 'open' },
        { op: 'insert_equations', equations: [{ find: '끝.', script: 'x^2', keep_text: 'yes' }] },
        { op: 'insert_title_box', find: '끝.', look: 'filled' },
        { op: 'set_page_setup', orientation: 'sideways', margin_left: 20 },
        { op: 'read_document' },
        { op: 'read_page_setup' },
      ]),
      '--best-effort',
      '--json',
    ])
    expect(r.code, r.stdout).toBe(0)
    const errors = (r.json().detail.failures as { error: string }[]).map((failure) => failure.error)
    expect(errors).toEqual([
      'Nothing was changed: dashes must be true or false, not "no".',
      expect.stringContaining('unknown argument "style"; did you mean "look"?'),
      'Nothing was changed: equations[0].keep_text must be true or false, not "yes".',
      'Nothing was changed: look must be one of bands, lines, box, shaded, not "filled".',
      'Nothing was changed: orientation must be one of portrait, landscape, not "sideways".',
    ])
    const [text, setup] = (r.json().detail.results as { output: string }[])
      .slice(-2)
      .map((result) => result.output)
    expect(text).toContain('끝.')
    expect(setup).toContain('"margin_left":30')
  })

  it('saves a converted markdown table after filling cells past one page per row', async () => {
    const dir = tempDir()
    const mdPath = join(dir, 'sample.md')
    const lines = ['# 표 저장 검증 재현 문서', '']
    for (let i = 1; i <= 12; i++) {
      lines.push(`가상 문단 ${i}입니다. 표가 첫 쪽 하단에 걸리도록 본문 길이를 맞춥니다.`, '')
    }
    lines.push(
      '| 항목 | 설명 | 비고 |',
      '| --- | --- | --- |',
      '| 항목 1 | 초안 | 초안 |',
      '| 항목 2 | 초안 | 초안 |',
      '| 항목 3 | 초안 | 초안 |',
      '| 항목 4 | 초안 | 초안 |',
      '| 항목 5 | 초안 | 초안 |',
      '',
      '표 뒤 마무리 문단입니다.',
    )
    writeFileSync(mdPath, lines.join('\n'), 'utf8')
    const baseline = join(dir, 'baseline.hwp')
    const conv = await run(['convert', mdPath, '--to', 'hwp', '--out', baseline, '--json'])
    expect(conv.code, conv.stdout).toBe(0)

    const longText =
      '가상 표 셀에 들어가는 반복 문장입니다. 표 행 높이가 한 쪽을 넘겨 불가피하게 나뉘더라도 저장 후 다시 열었을 때 쪽 수와 행 분할이 그대로 유지되어야 합니다. '.repeat(
        8,
      )
    const cells = []
    for (let row = 2; row <= 6; row++) {
      for (const col of [2, 3]) {
        cells.push({ row, col, text: longText })
      }
    }
    const edited = join(dir, 'edited.hwp')
    const apply = await run([
      'hwp',
      'apply',
      baseline,
      '--ops',
      ops(dir, [{ op: 'fill_cells', table: 1, overwrite: true, cells }]),
      '--out',
      edited,
      '--json',
    ])
    expect(apply.code, apply.stdout).toBe(0)
    expect(existsSync(edited)).toBe(true)
    expect(isOle(edited)).toBe(true)
    const reopened = new HwpDocument(readFileSync(edited))
    try {
      expect(reopened.pageCount()).toBeGreaterThanOrEqual(10)
      expect(JSON.parse(reopened.exportHwpVerify())).toMatchObject({ recovered: true })
    } finally {
      reopened.free()
    }
  })
})

describe('hwp apply in a folder that refuses chmod', () => {
  beforeEach(usePosixMount)

  it('still edits the file and keeps the old bytes in the .bak', async () => {
    const dir = tempDir()
    const original = report().exportHwp()
    const path = write(dir, 'report.hwp', original)
    const opsPath = ops(dir, EDITS)
    refuseChmodLikeGvfs()
    const r = await run(['hwp', 'apply', path, '--ops', opsPath, '--json'])
    expect(r.code, r.stdout).toBe(0)
    expect(textOf(path).join('\n')).toContain('8월 1일부터 시행합니다.')
    expect(r.json().detail.backup_path).toBe(`${path}.bak`)
    expect(readFileSync(`${path}.bak`).equals(Buffer.from(original))).toBe(true)
  })

  it('replaces an older .bak with the bytes from before this edit', async () => {
    const dir = tempDir()
    const original = report().exportHwp()
    const path = write(dir, 'report.hwp', original)
    writeFileSync(`${path}.bak`, 'an older backup')
    const opsPath = ops(dir, EDITS)
    refuseChmodLikeGvfs()
    const r = await run(['hwp', 'apply', path, '--ops', opsPath, '--json'])
    expect(r.code, r.stdout).toBe(0)
    expect(textOf(path).join('\n')).toContain('8월 1일부터 시행합니다.')
    expect(readFileSync(`${path}.bak`).equals(Buffer.from(original))).toBe(true)
  })
})

describe('hwp outline and multi-scope find ops', () => {
  function outlineDoc(): HwpDocument {
    const doc = HwpDocument.createEmpty()
    doc.createBlankDocument()
    const styles = JSON.parse(doc.getStyleList()) as Array<{ id: number; name: string }>
    const idOf = (name: string) => styles.find((s) => s.name === name)?.id
    const h1 = idOf('개요 1')!
    const h2 = idOf('개요 2')!
    const lines: Array<[string, number | undefined]> = [
      ['문서 머리말 문단', undefined],
      ['첫째 장', h1],
      ['첫째 장 본문', undefined],
      ['둘째 장', h1],
      ['둘째 장 절', h2],
      ['둘째 장 본문', undefined],
    ]
    lines.forEach(([line, styleId], idx) => {
      if (idx > 0) doc.splitParagraph(0, idx - 1, doc.getParagraphLength(0, idx - 1))
      doc.insertText(0, idx, 0, line)
      doc.applyStyle(0, idx, styleId ?? 0)
    })
    return doc
  }

  it('lists outline and find_in_document ops in guide hwp and runs them end-to-end', async () => {
    const guide = await run(['guide', 'hwp', '--json'])
    expect(guide.code, guide.stdout).toBe(0)
    const opNames = (guide.json().detail.ops as Array<{ op: string }>).map((e) => e.op)
    expect(opNames).toContain('read_outline')
    expect(opNames).toContain('change_outline_level')
    expect(opNames).toContain('move_outline_section')
    expect(opNames).toContain('find_in_document')

    const dir = tempDir()
    const path = write(dir, 'thesis.hwpx', outlineDoc().exportHwpx())
    const out = join(dir, 'thesis-out.hwpx')
    const res = await run([
      'hwp',
      'apply',
      path,
      '--ops',
      ops(dir, [
        { op: 'read_outline' },
        { op: 'find_in_document', query: '본문' },
        { op: 'change_outline_level', section: 1, paragraph: 4, direction: 'demote' },
        {
          op: 'move_outline_section',
          section: 1,
          paragraph: 4,
          target_paragraph: 2,
          position: 'before',
        },
        { op: 'read_outline' },
      ]),
      '--out',
      out,
      '--json',
    ])
    expect(res.code, res.stdout).toBe(0)
    const results = res.json().detail.results as Array<{ op: string; output: string }>
    expect(results[0]!.output).toContain('첫째 장')
    expect(results[1]!.output).toContain('2 match(es)')
    expect(results[2]!.output).toContain('Changed outline level of 2 heading(s)')
    expect(results[3]!.output).toContain('Moved 3 paragraph(s)')
    const afterHeadings = JSON.parse(results[4]!.output.split('\n')[1]!) as Array<{
      title: string
      level: number
    }>
    expect(afterHeadings.map((h) => [h.title, h.level])).toEqual([
      ['둘째 장', 2],
      ['둘째 장 절', 3],
      ['첫째 장', 1],
    ])
  })

  it('reads app-wide hwpOutlineStyleMap from app-settings.json in GENOFFICE_USER_DATA', async () => {
    const dir = tempDir()
    const doc = HwpDocument.createEmpty()
    doc.createBlankDocument()
    doc.insertText(0, 0, 0, '커스텀 장 제목')
    const styleId = doc.createStyle(
      JSON.stringify({ name: '논문장', englishName: 'ThesisChapter', type: 0, nextStyleId: 0 }),
    )
    doc.applyStyle(0, 0, styleId)
    const path = write(dir, 'custom.hwpx', doc.exportHwpx())

    writeFileSync(
      join(dir, 'app-settings.json'),
      JSON.stringify({ hwpOutlineStyleMap: { 논문장: 1 } }),
      'utf8',
    )
    const r = await run(
      ['hwp', 'apply', path, '--ops', ops(dir, [{ op: 'read_outline' }]), '--json'],
      { env: { GENOFFICE_USER_DATA: dir } },
    )
    expect(r.code, r.stdout).toBe(0)
    expect(r.json().detail.results[0].output).toContain('커스텀 장 제목')
    expect(r.json().detail.results[0].output).toContain('"style":"논문장"')
  })

  it('forwards ctx.env to blankHwpForEdit so create --type hwpx respects hwpOutlineStyleMap', async () => {
    const dir = tempDir()
    const out = join(dir, 'created-outline.hwpx')
    writeFileSync(
      join(dir, 'app-settings.json'),
      JSON.stringify({ hwpOutlineStyleMap: { 논문장: 1 } }),
      'utf8',
    )
    const r = await run(
      [
        'create',
        '--type',
        'hwpx',
        '--ops',
        ops(dir, [
          { op: 'insert_paragraphs', where: 'end', paragraphs: ['새 커스텀 장'] },
          {
            op: 'style_paragraphs',
            styles: [{ name: '논문장', size: 16, bold: true }],
            apply: [{ style: '논문장', find: '새 커스텀 장' }],
          },
          { op: 'read_outline' },
        ]),
        '--out',
        out,
        '--json',
      ],
      { env: { GENOFFICE_USER_DATA: dir } },
    )
    expect(r.code, r.stdout).toBe(0)
    const results = r.json().detail.results as Array<{ op: string; output: string }>
    const readRes = results.find((entry) => entry.op === 'read_outline')
    expect(readRes?.output).toContain('새 커스텀 장')
    expect(readRes?.output).toContain('"style":"논문장"')
  })

  it('rejects 0 and out-of-range numeric arguments on outline and find_in_document ops', async () => {
    const dir = tempDir()
    const path = write(dir, 'thesis.hwpx', outlineDoc().exportHwpx())
    for (const badOp of [
      { op: 'change_outline_level', section: 0, paragraph: 2, direction: 'demote' },
      { op: 'change_outline_level', section: 1, paragraph: 0, direction: 'demote' },
      { op: 'change_outline_level', section: 999, paragraph: 2, direction: 'demote' },
      { op: 'change_outline_level', section: 1, paragraph: 999, direction: 'demote' },
      {
        op: 'move_outline_section',
        section: 0,
        paragraph: 2,
        target_paragraph: 4,
        position: 'after',
      },
      { op: 'move_outline_section', paragraph: 2, target_paragraph: 0, position: 'after' },
      { op: 'move_outline_section', paragraph: 999, target_paragraph: 4, position: 'after' },
      { op: 'move_outline_section', paragraph: 2, target_paragraph: 999, position: 'after' },
      { op: 'find_in_document', size: 0 },
      { op: 'find_in_document', size: -1 },
    ]) {
      const r = await run(['hwp', 'apply', path, '--ops', ops(dir, [badOp]), '--dry-run', '--json'])
      expect(r.code, JSON.stringify(badOp)).not.toBe(0)
      if (
        (badOp.op === 'change_outline_level' || badOp.op === 'move_outline_section') &&
        (badOp.section === 999 || badOp.paragraph === 999 || badOp.target_paragraph === 999)
      ) {
        expect(r.stdout).toContain('read_outline')
      }
    }
  })
})

describe('hwp migrated TOC and index ops (T15)', () => {
  function thesisDoc(): HwpDocument {
    const doc = HwpDocument.createEmpty()
    doc.createBlankDocument()
    const styles = JSON.parse(doc.getStyleList()) as Array<{ id: number; name: string }>
    const idOf = (name: string) => styles.find((s) => s.name === name)?.id
    const h1 = idOf('개요 1')!
    const h2 = idOf('개요 2')!
    const lines: Array<[string, number | undefined]> = [
      ['학위 논문 제목', undefined],
      ['서론', h1],
      ['연구 배경과 알고리즘 개념을 설명합니다.', undefined],
      ['세부 목표', h2],
      ['<표 1> 실험 데이터 요약', undefined],
      ['결론', h1],
      ['알고리즘 성능 평가 결과를 정리합니다.', undefined],
    ]
    lines.forEach(([line, styleId], idx) => {
      if (idx > 0) doc.splitParagraph(0, idx - 1, doc.getParagraphLength(0, idx - 1))
      doc.insertText(0, idx, 0, line)
      doc.applyStyle(0, idx, styleId ?? 0)
    })
    return doc
  }

  it('exposes TOC and all 5 index ops in guide hwp and runs them end-to-end on a real document', async () => {
    const guide = await run(['guide', 'hwp', '--json'])
    expect(guide.code, guide.stdout).toBe(0)
    const opNames = (guide.json().detail.ops as Array<{ op: string }>).map((e) => e.op)
    for (const expected of [
      'insert_toc',
      'refresh_toc',
      'mark_index',
      'list_index_marks',
      'remove_index_mark',
      'insert_index',
      'refresh_index',
    ]) {
      expect(opNames, expected).toContain(expected)
    }

    const dir = tempDir()
    const path = write(dir, 'thesis.hwpx', thesisDoc().exportHwpx())
    const out = join(dir, 'thesis-done.hwpx')
    const res = await run([
      'hwp',
      'apply',
      path,
      '--ops',
      ops(dir, [
        {
          op: 'insert_toc',
          section: 1,
          paragraph: 2,
          kind: 'body',
          layout: 'dotted-tab',
          max_level: 2,
          links: true,
          title: '차례',
        },
        {
          op: 'insert_toc',
          anchor: '학위 논문 제목',
          where: 'after',
          kind: 'table',
          title: '표 차례',
        },
        { op: 'refresh_toc', kind: 'body' },
        { op: 'mark_index', term: '알고리즘', mark_all: true },
        { op: 'mark_index', find: '연구 배경', term: '배경', sub_term: '개요' },
        { op: 'list_index_marks' },
        { op: 'remove_index_mark', term: '배경' },
        { op: 'insert_index', where: 'end', title: '찾아보기', columns: 2, layout: 'dotted-tab' },
        { op: 'refresh_index', columns: 1, layout: 'table' },
      ]),
      '--out',
      out,
      '--json',
    ])
    expect(res.code, res.stdout).toBe(0)
    const results = res.json().detail.results as Array<{ op: string; output: string }>
    expect(results[0]!.output).toContain(
      'Inserted body table of contents (dotted-tab) with 3 item(s)',
    )
    expect(results[1]!.output).toContain('Inserted table table of contents')
    expect(results[2]!.output).toContain('Refreshed body table of contents')
    expect(results[3]!.output).toContain('Marked 2 body occurrence(s) for "알고리즘"')
    expect(results[3]!.output).toContain('Korean particle-attached forms included')
    expect(results[5]!.output).toContain('3 index mark(s)')
    expect(results[5]!.output).toContain('"sub_term":"개요"')
    expect(results[6]!.output).toContain('Removed 1 index mark(s)')
    expect(results[7]!.output).toContain('Inserted index (dotted-tab, 2 column(s))')
    expect(results[8]!.output).toContain('Refreshed index (table, 1 column(s))')

    const text = textOf(out).join('\n')
    expect(text).toContain('차례')
    expect(text).toContain('표 차례')
    expect(text).toContain('찾아보기')
    expect(text).toContain('알고리즘')
  })

  it('refuses multi-column insert_index before trailing text until allow_page_split is true', async () => {
    const dir = tempDir()
    const path = write(dir, 'thesis-split.hwpx', thesisDoc().exportHwpx())

    const refused = await run([
      'hwp',
      'apply',
      path,
      '--ops',
      ops(dir, [
        { op: 'mark_index', term: '알고리즘', mark_all: true },
        { op: 'insert_index', section: 1, paragraph: 2, columns: 2 },
      ]),
      '--dry-run',
      '--json',
    ])
    expect(refused.code).toBe(1)
    expect(refused.stdout).toContain('allow_page_split: true')
    expect(refused.stdout).toContain('색인 앞뒤가 새 쪽으로 나뉩니다')

    const allowed = await run([
      'hwp',
      'apply',
      path,
      '--ops',
      ops(dir, [
        { op: 'mark_index', term: '알고리즘', mark_all: true },
        { op: 'insert_index', section: 1, paragraph: 2, columns: 2, allow_page_split: true },
      ]),
      '--dry-run',
      '--json',
    ])
    expect(allowed.code, allowed.stdout).toBe(0)
    expect(allowed.json().detail.results[1].output).toContain(
      'Inserted index (dotted-tab, 2 column(s))',
    )

    const endOk = await run([
      'hwp',
      'apply',
      path,
      '--ops',
      ops(dir, [
        { op: 'mark_index', term: '알고리즘', mark_all: true },
        { op: 'insert_index', where: 'end', columns: 2 },
      ]),
      '--dry-run',
      '--json',
    ])
    expect(endOk.code, endOk.stdout).toBe(0)
  })

  it('includes Korean particle-attached forms in mark_index mark_all while excluding compounds', async () => {
    const dir = tempDir()
    const doc = HwpDocument.createEmpty()
    doc.createBlankDocument()
    doc.insertText(0, 0, 0, '연구는 중요하고 연구를 계속하며 연구자는 제외한다.')
    const path = write(dir, 'particles.hwpx', doc.exportHwpx())

    const withParticles = await run([
      'hwp',
      'apply',
      path,
      '--ops',
      ops(dir, [{ op: 'mark_index', term: '연구', mark_all: true }]),
      '--dry-run',
      '--json',
    ])
    expect(withParticles.code, withParticles.stdout).toBe(0)
    expect(withParticles.json().detail.results[0].output).toContain(
      'Marked 2 body occurrence(s) for "연구"',
    )
    expect(withParticles.json().detail.results[0].output).toContain(
      'Korean particle-attached forms included (2 with particle)',
    )

    const withoutParticles = await run([
      'hwp',
      'apply',
      path,
      '--ops',
      ops(dir, [{ op: 'mark_index', term: '연구', mark_all: true, include_particles: false }]),
      '--dry-run',
      '--json',
    ])
    expect(withoutParticles.code, withoutParticles.stdout).toBe(0)
    expect(withoutParticles.json().detail.results[0].output).toContain(
      'Added 0 index marks for "연구"',
    )
    expect(withoutParticles.json().detail.results[0].output).toContain(
      'Exact whole-word match without Korean particles.',
    )
  })

  it('passes app-wide hwpOutlineStyleMap from app-settings.json to insert_toc and refresh_toc in CLI', async () => {
    const dir = tempDir()
    const doc = HwpDocument.createEmpty()
    doc.createBlankDocument()
    doc.insertText(0, 0, 0, '커스텀 표지')
    doc.splitParagraph(0, 0, doc.getParagraphLength(0, 0))
    doc.insertText(0, 1, 0, '커스텀 1장')
    const styleId = doc.createStyle(
      JSON.stringify({ name: '논문장', englishName: 'ThesisChapter', type: 0, nextStyleId: 0 }),
    )
    doc.applyStyle(0, 1, styleId)
    const path = write(dir, 'custom-toc.hwpx', doc.exportHwpx())

    writeFileSync(
      join(dir, 'app-settings.json'),
      JSON.stringify({ hwpOutlineStyleMap: { 논문장: 1 } }),
      'utf8',
    )
    const r = await run(
      [
        'hwp',
        'apply',
        path,
        '--ops',
        ops(dir, [
          { op: 'insert_toc', section: 1, paragraph: 2, kind: 'body', max_level: 1 },
          { op: 'refresh_toc', kind: 'body' },
        ]),
        '--dry-run',
        '--json',
      ],
      { env: { GENOFFICE_USER_DATA: dir } },
    )
    expect(r.code, r.stdout).toBe(0)
    expect(r.json().detail.results[0].output).toContain('with 1 item(s)')
    expect(r.json().detail.results[1].output).toContain('Refreshed body table of contents')
  })

  it('supports --bibliography, citation/bibliography ops, unsupported interactive ops, and strict numeric bounds', async () => {
    const dir = tempDir()
    const doc = HwpDocument.createEmpty()
    doc.createBlankDocument()
    doc.insertText(0, 0, 0, '선행 연구에 따르면 문서 표준화가 중요하다.')
    const path = write(dir, 'thesis.hwpx', doc.exportHwpx())

    const bibPath = join(dir, 'refs.json')
    writeFileSync(
      bibPath,
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: 'bib_Kim2024',
            key: 'Kim2024',
            oldKeys: [],
            type: 'article',
            authors: [{ family: '김철수' }],
            year: '2024',
            title: '공공문서 표준화 연구',
            containerTitle: '행정정보연구',
            volume: '12',
            issue: '2',
            pages: '15-32',
            language: 'ko',
            tags: ['행정'],
            verified: true,
            source: 'manual',
          },
          {
            id: 'bib_Unverified2025',
            key: 'Unverified2025',
            oldKeys: [],
            type: 'webpage',
            authors: [{ family: '박영수' }],
            year: '2025',
            title: '미확인 웹 자료',
            url: 'https://example.org/unverified',
            language: 'ko',
            tags: [],
            memo: 'https://example.org/unverified',
            verified: false,
            source: 'ai',
          },
          {
            id: 'bib_Lee2023',
            key: 'Lee2023',
            oldKeys: [],
            type: 'book',
            authors: [{ family: '이민호' }],
            year: '2023',
            title: '전자문서 체계론',
            publisher: '한국출판사',
            language: 'ko',
            tags: ['문서'],
            verified: true,
            source: 'manual',
          },
        ],
      }),
      'utf8',
    )

    // guide hwp lists the bibliography group and excludes interactive-only ops
    const guide = await run(['guide', 'hwp', '--json'])
    expect(guide.code, guide.stdout).toBe(0)
    const groups = guide.json().detail.groups as Array<{ name: string; ops: string[] }>
    const bibGroup = groups.find((g) => g.name === 'bibliography')
    expect(bibGroup?.ops).toEqual([
      'list_references',
      'audit_citations',
      'insert_citation',
      'switch_citation_style',
      'insert_bibliography',
      'refresh_bibliography',
    ])
    const allOps = (guide.json().detail.ops as Array<{ op: string }>).map((o) => o.op)
    expect(allOps).not.toContain('search_references')
    expect(allOps).not.toContain('parse_reference_lines')

    // End-to-end citation + bibliography + style switch + audit
    const applied = await run([
      'hwp',
      'apply',
      path,
      '--bibliography',
      bibPath,
      '--ops',
      ops(dir, [
        { op: 'list_references', verified_only: true },
        { op: 'insert_citation', key: 'Kim2024', find: '중요하다' },
        { op: 'insert_bibliography', title: '참고문헌' },
        { op: 'switch_citation_style', citation_style: 'ieee' },
        { op: 'refresh_bibliography' },
        { op: 'audit_citations' },
      ]),
      '--json',
    ])
    expect(applied.code, applied.stdout).toBe(0)
    const results = applied.json().detail.results as Array<{ op: string; output: string }>
    expect(JSON.parse(results[0]!.output)).toMatchObject({
      total: 2,
      offset: 0,
      limit: 50,
      returned: 2,
      has_more: false,
      next_offset: null,
    })
    expect(results[1]!.output).toContain('(김철수, 2024)')
    expect(results[2]!.output).toContain('Inserted bibliography (APA)')
    expect(results[3]!.output).toContain('Switched citation style to IEEE (1 citation(s) updated).')
    expect(results[3]!.output).toContain('Bibliography refreshed.')
    expect(results[4]!.output).toContain('Refreshed bibliography (IEEE)')
    expect(JSON.parse(results[5]!.output).total_issues).toBe(0)
    const finalText = textOf(path).join('\n')
    expect(finalText).toContain('[1]')
    expect(finalText).toContain('참고문헌')
    expect(finalText).toContain('공공문서 표준화 연구')

    // Paginated list_references across multiple pages
    const paged = await run([
      'hwp',
      'apply',
      path,
      '--bibliography',
      bibPath,
      '--ops',
      ops(dir, [
        { op: 'list_references', offset: 0, limit: 2 },
        { op: 'list_references', offset: 2, limit: 2 },
      ]),
      '--dry-run',
      '--json',
    ])
    expect(paged.code, paged.stdout).toBe(0)
    const pagedResults = paged.json().detail.results as Array<{ op: string; output: string }>
    const firstPage = JSON.parse(pagedResults[0]!.output)
    expect(firstPage).toMatchObject({
      total: 3,
      offset: 0,
      limit: 2,
      returned: 2,
      has_more: true,
      next_offset: 2,
    })
    const secondPage = JSON.parse(pagedResults[1]!.output)
    expect(secondPage).toMatchObject({
      total: 3,
      offset: 2,
      limit: 2,
      returned: 1,
      has_more: false,
      next_offset: null,
    })

    // Refuses unverified entry
    const unv = await run([
      'hwp',
      'apply',
      path,
      '--bibliography',
      bibPath,
      '--ops',
      ops(dir, [{ op: 'insert_citation', key: 'Unverified2025', section: 1, paragraph: 1 }]),
      '--dry-run',
      '--json',
    ])
    expect(unv.code).toBe(1)
    expect(unv.json().detail.failures[0].error).toContain('Unverified2025')

    // Interactive-only tools return unsupported in CLI
    for (const opName of ['search_references', 'parse_reference_lines']) {
      const unsup = await run([
        'hwp',
        'apply',
        path,
        '--ops',
        ops(dir, [{ op: opName, query: 'x', raw_lines: ['x'] }]),
        '--dry-run',
        '--json',
      ])
      expect(unsup.code).toBe(1)
      expect(unsup.json().detail.failures[0]).toMatchObject({ op: opName, reason: 'unsupported' })
    }

    // Strict numeric bounds rejections (0, 999, 2147483648, occurrence: 0 with coords)
    for (const badOp of [
      { op: 'insert_citation', key: 'Kim2024', section: 0, paragraph: 1 },
      { op: 'insert_citation', key: 'Kim2024', section: 999, paragraph: 999 },
      { op: 'insert_citation', key: 'Kim2024', section: 2147483648, paragraph: 1 },
      { op: 'insert_citation', key: 'Kim2024', section: 1, paragraph: 1, occurrence: 0 },
      { op: 'insert_bibliography', section: 0, paragraph: 1 },
      { op: 'insert_bibliography', section: 999, paragraph: 999 },
      { op: 'insert_bibliography', section: 2147483648, paragraph: 1 },
      { op: 'insert_bibliography', section: 1, paragraph: 1, occurrence: 0 },
      { op: 'list_references', offset: -1 },
      { op: 'list_references', offset: 2147483648 },
      { op: 'list_references', limit: 0 },
      { op: 'list_references', limit: -1 },
      { op: 'list_references', limit: 2147483648 },
    ]) {
      const rejected = await run([
        'hwp',
        'apply',
        path,
        '--bibliography',
        bibPath,
        '--ops',
        ops(dir, [badOp]),
        '--dry-run',
        '--json',
      ])
      expect(rejected.code, JSON.stringify(badOp)).toBe(1)
    }

    // create --type hwpx --bibliography works end-to-end
    const createdPath = join(dir, 'created-bib.hwpx')
    const created = await run([
      'create',
      '--type',
      'hwpx',
      '--bibliography',
      bibPath,
      '--ops',
      ops(dir, [
        { op: 'insert_paragraphs', where: 'end', paragraphs: ['서론 본문'] },
        { op: 'insert_citation', key: 'Kim2024', find: '서론 본문' },
        { op: 'insert_bibliography', title: '참고문헌' },
      ]),
      '--out',
      createdPath,
      '--json',
    ])
    expect(created.code, created.stdout).toBe(0)
    expect(textOf(createdPath).join('\n')).toContain('(김철수, 2024)')
    expect(textOf(createdPath).join('\n')).toContain('공공문서 표준화 연구')
  })
})
