import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { parseFileToText, xlsxToText } from '../src/index'
import { writeFixture } from './helpers/fixtures'

/**
 * A workbook read as another file's material: every cell inside a
 * `IeumHide[<n>]_<label>` defined name reads as `{{label-NN}}` (one number per
 * value, an empty cell counted as a value, numbers given afresh on each read),
 * a cell that leans on hidden cells reads as `{{label+label}}`, and a mark that
 * cannot be resolved fails the read.
 */

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const SML = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'

interface Sheet {
  name: string
  rows: string
  rels?: string
}

const s = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`
const n = (ref: string, value: number | string) => `<c r="${ref}"><v>${value}</v></c>`
const f = (ref: string, formula: string, cached: string | number = '') =>
  `<c r="${ref}"${typeof cached === 'string' && cached !== '' ? ' t="str"' : ''}><f>${formula}</f>${cached === '' ? '' : `<v>${cached}</v>`}</c>`
const row = (r: number, ...cells: string[]) => `<row r="${r}">${cells.join('')}</row>`

async function workbook(
  sheets: Sheet[],
  names: Array<[string, string]> = [],
  extra: Record<string, string> = {},
  workbookExtra = '',
): Promise<Uint8Array> {
  const zip = new JSZip()
  const defined = names.length
    ? `<definedNames>${names.map(([name, ref]) => `<definedName name="${name}">${ref}</definedName>`).join('')}</definedNames>`
    : ''
  zip.file(
    'xl/workbook.xml',
    `${XML}<workbook xmlns="${SML}" xmlns:r="${REL}"><sheets>` +
      sheets
        .map((sheet, i) => `<sheet name="${sheet.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('') +
      `</sheets>${defined}${workbookExtra}</workbook>`,
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `${XML}<Relationships xmlns="${PKG}">` +
      sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join('') +
      '</Relationships>',
  )
  sheets.forEach((sheet, i) => {
    zip.file(
      `xl/worksheets/sheet${i + 1}.xml`,
      `${XML}<worksheet xmlns="${SML}" xmlns:r="${REL}"><sheetData>${sheet.rows}</sheetData></worksheet>`,
    )
    if (sheet.rels) zip.file(`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, sheet.rels)
  })
  for (const [path, xml] of Object.entries(extra)) zip.file(path, xml)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

const ROSTER: Sheet = {
  name: '명단',
  rows:
    row(1, s('A1', '번호'), s('B1', '이름'), s('C1', '점수')) +
    row(2, n('A2', 1), s('B2', '김철수'), n('C2', 90)) +
    row(3, n('A3', 2), s('B3', '이영희'), n('C3', 85)) +
    row(4, n('A4', 3), s('B4', '김철수'), n('C4', 70)) +
    row(5, n('A5', 4), n('C5', 60)),
}
const NAME_COLUMN: [string, string] = ['IeumHide_이름', "'명단'!$B$2:$B$1048576"]
const SECRETS = ['김철수', '이영희']

function expectNoSecrets(text: string) {
  for (const secret of SECRETS) expect(text).not.toContain(secret)
}

describe('xlsx: hidden cells read as numbered labels', () => {
  it('numbers each value, the same value the same number, an empty cell as a value', async () => {
    const path = writeFixture('roster.xlsx', await workbook([ROSTER], [NAME_COLUMN]))
    const result = await parseFileToText(path)
    expect(result).toMatchObject({ ok: true, kind: 'text' })
    expect(result.text!.split('\n')).toEqual([
      '# 명단',
      '번호 | 이름 | 점수',
      '1 | {{이름-01}} | 90',
      '2 | {{이름-02}} | 85',
      '3 | {{이름-01}} | 70',
      '4 | {{이름-03}} | 60',
    ])
  })

  it('numbers afresh on every read', async () => {
    const bytes = await workbook([ROSTER], [NAME_COLUMN])
    expect(await xlsxToText(bytes)).toBe(await xlsxToText(bytes))
  })

  it('reads a cell range, several areas, a whole column and a duplicate-numbered name', async () => {
    const bytes = await workbook(
      [ROSTER],
      [
        ['ieumhide2_점수', "'명단'!$C$2:$C$3,'명단'!$C$5"],
        ['IeumHide_번호', '명단!$A:$A'],
      ],
    )
    const lines = (await xlsxToText(bytes)).split('\n')
    expect(lines[1]).toBe('{{번호-01}} | 이름 | 점수')
    expect(lines[2]).toBe('{{번호-02}} | 김철수 | {{점수-01}}')
    expect(lines[4]).toBe('{{번호-04}} | 김철수 | 70')
    expect(lines[5]).toBe('{{번호-05}} |  | {{점수-03}}')
  })

  it('hides a formula’s text along with its value', async () => {
    const sheet: Sheet = {
      name: '명단',
      rows: row(1, s('A1', '이름')) + row(2, f('A2', '"김"&amp;"철수"')),
    }
    const text = await xlsxToText(await workbook([sheet], [['IeumHide_이름', "'명단'!$A$2"]]))
    expect(text).not.toContain('철수')
    expect(text.split('\n')).toEqual(['# 명단', '이름', '{{이름-01}}'])
  })
})

describe('xlsx: a cell that leans on hidden cells reads as their labels', () => {
  const sheet = (formulas: string): Sheet => ({
    name: '명단',
    rows:
      row(1, s('A1', '이름'), s('B1', '점수'), s('C1', '계산')) +
      row(2, s('A2', '김철수'), n('B2', 90), formulas),
  })
  const marks: Array<[string, string]> = [
    ['IeumHide_이름', "'명단'!$A$2:$A$9"],
    ['IeumHide_성적', "'명단'!$B$2:$B$9"],
  ]
  const third = async (formulas: string, names = marks, more: Sheet[] = []) =>
    (await xlsxToText(await workbook([sheet(formulas), ...more], names))).split('\n')[2]

  it('directly, through other cells, and on several marks', async () => {
    expect(await third(f('C2', 'LEN(A2)', 3))).toBe('{{이름-01}} | {{성적-01}} | {{이름}}')
    expect(
      await third(f('C2', 'LEN(A2)', 3) + f('D2', 'C2+1', 4) + f('E2', 'A2&amp;B2', '김철수90')),
    ).toBe('{{이름-01}} | {{성적-01}} | {{이름}} | {{이름}} | {{성적+이름}}')
  })

  it('counts a formula it cannot analyse as leaning on every mark', async () => {
    for (const formula of ['INDIRECT("A2")', 'OFFSET(C1,1,0)', 'Total*2', 'Table1[이름]']) {
      expect(await third(f('C2', formula, 'x'))).toBe('{{이름-01}} | {{성적-01}} | {{성적+이름}}')
    }
  })

  it('leaves a formula that reads no hidden cell alone', async () => {
    expect(await third(f('C2', 'C1&amp;"!"', '계산!') + f('D2', 'SUM(1,2)', 3))).toBe(
      '{{이름-01}} | {{성적-01}} | 계산! | 3',
    )
  })

  it('follows a reference into another sheet', async () => {
    const other: Sheet = { name: 'Sum', rows: row(1, f('A1', "COUNTA('명단'!A:A)", 2)) }
    const text = await xlsxToText(await workbook([sheet(''), other], marks))
    expect(text.split('\n').slice(-2)).toEqual(['# Sum', '{{이름}}'])
  })

  it('follows shared and array formulas to the cells they fill', async () => {
    const rows =
      row(1, s('A1', '이름')) +
      row(
        2,
        s('A2', '김철수'),
        '<c r="B2" t="str"><f t="shared" ref="B2:B3" si="0">A2&amp;"님"</f><v>김철수님</v></c>',
        '<c r="C2" t="str"><f t="array" ref="C2:C3">A2:A3</f><v>김철수</v></c>',
      ) +
      row(
        3,
        s('A3', '이영희'),
        '<c r="B3" t="str"><f t="shared" si="0"/><v>이영희님</v></c>',
        '<c r="C3" t="str"><v>이영희</v></c>',
      )
    const text = await xlsxToText(
      await workbook([{ name: '명단', rows }], [['IeumHide_이름', "'명단'!$A$2:$A$3"]]),
    )
    expectNoSecrets(text)
    expect(text.split('\n').slice(2)).toEqual([
      '{{이름-01}} | {{이름}} | {{이름}}',
      '{{이름-02}} | {{이름}} | {{이름}}',
    ])
  })

  it('hides a pivot table built from hidden cells', async () => {
    const pivotSheet: Sheet = {
      name: 'Pivot',
      rows: row(1, s('A1', '행 레이블'), s('B1', '개수')) + row(2, s('A2', '김철수'), n('B2', 2)),
      rels:
        `${XML}<Relationships xmlns="${PKG}">` +
        `<Relationship Id="rId1" Type="${REL}/pivotTable" Target="../pivotTables/pivotTable1.xml"/>` +
        '</Relationships>',
    }
    const extra = {
      'xl/pivotTables/pivotTable1.xml': `${XML}<pivotTableDefinition xmlns="${SML}" name="P" cacheId="1"><location ref="A1:B2" firstHeaderRow="1" firstDataRow="1" firstDataCol="1"/></pivotTableDefinition>`,
      'xl/pivotTables/_rels/pivotTable1.xml.rels': `${XML}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/pivotCacheDefinition" Target="../pivotCache/pivotCacheDefinition1.xml"/></Relationships>`,
      'xl/pivotCache/pivotCacheDefinition1.xml': `${XML}<pivotCacheDefinition xmlns="${SML}"><cacheSource type="worksheet"><worksheetSource ref="A1:B5" sheet="명단"/></cacheSource></pivotCacheDefinition>`,
    }
    const text = await xlsxToText(await workbook([ROSTER, pivotSheet], [NAME_COLUMN], extra))
    expectNoSecrets(text)
    expect(text.split('\n').slice(-3)).toEqual([
      '# Pivot',
      '{{이름}} | {{이름}}',
      '{{이름}} | {{이름}}',
    ])
  })
})

describe('xlsx: an unmarked workbook reads as before', () => {
  it('ignores defined names that are not hiding marks', async () => {
    const plain = await xlsxToText(await workbook([ROSTER]))
    const named = await xlsxToText(
      await workbook(
        [ROSTER],
        [
          ['Scores', "'명단'!$C$2:$C$5"],
          ['IeumHidden', "'명단'!$B:$B"],
        ],
      ),
    )
    expect(named).toBe(plain)
    expect(plain.split('\n')[2]).toBe('1 | 김철수 | 90')
  })
})

describe('xlsx: a mark that cannot be resolved fails the read', () => {
  const broken: Array<[string, string]> = [
    ['a deleted reference', '#REF!'],
    ['a sheet the workbook does not have', "'없음'!$B:$B"],
    ['a formula instead of a range', "OFFSET('명단'!$B$1,1,0,10,1)"],
    ['a range with no sheet', '$B$2:$B$9'],
    ['a constant', '"김철수"'],
  ]
  for (const [index, [name, ref]] of broken.entries()) {
    it(name, async () => {
      const path = writeFixture(
        `broken-mark-${index}.xlsx`,
        await workbook([ROSTER], [['IeumHide_이름', ref]]),
      )
      const result = await parseFileToText(path)
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/Redaction marks/)
      expectNoSecrets(JSON.stringify(result))
    })
  }

  it('throws from xlsxToText itself', async () => {
    await expect(
      xlsxToText(await workbook([ROSTER], [['IeumHide_이름', '#REF!']])),
    ).rejects.toThrow(/Redaction marks/)
  })
})
