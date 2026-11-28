/**
 * Live Univer formula-engine parity test against MS Excel (2013-365) and
 * Google Sheets formulas, plus reference-shifting checks for copy/fill.
 */
import { LocaleType, LogLevel, Univer, UniverInstanceType } from '@univerjs/core'
import { FUniver } from '@univerjs/core/facade'
import { LexerTreeBuilder, UniverFormulaEnginePlugin } from '@univerjs/engine-formula'
import { UniverSheetsPlugin } from '@univerjs/sheets'
import '@univerjs/sheets/facade'
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula'
import '@univerjs/sheets-formula/facade'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { installCompatFunctions } from '../src/renderer/compat-functions'
import { installFormulaLexerFix } from '../src/renderer/formula-lexer-fix'
import { installIfsEmptySetFix } from '../src/renderer/ifs-empty-set'
import { installRateFallback } from '../src/renderer/rate-function'

const cases: readonly [label: string, formula: string, expected: unknown][] = [
  ['Basic SUM', '=SUM(B1:B4)', 750],
  ['Korean bare sheet ref', '=SUM(매출!A1:B2)', 100],
  ['Korean quoted sheet ref', "='2026 요약'!A1*2", 1000],
  ['XLOOKUP exact', '=XLOOKUP("배",A1:A4,B1:B4,"없음")', 200],
  ['XLOOKUP fallback', '=XLOOKUP("망고",A1:A4,B1:B4,"없음")', '없음'],
  ['XMATCH', '=XMATCH("포도",A1:A4)', 4],
  ['IFS', '=IFS(B1>150,"높음",B1>=100,"보통",TRUE,"낮음")', '보통'],
  ['SWITCH', '=SWITCH(A2,"사과",1,"배",2,0)', 2],
  ['TEXTJOIN ignore empty', '=TEXTJOIN(", ",TRUE,A1:A5)', '사과, 배, 사과, 포도'],
  ['CONCAT', '=CONCAT(A1:A2)', '사과배'],
  ['TEXTBEFORE', '=TEXTBEFORE("hello-world-2026","-")', 'hello'],
  ['TEXTAFTER', '=TEXTAFTER("hello-world-2026","-")', 'world-2026'],
  ['FILTER + SUM', '=SUM(FILTER(B1:B4,A1:A4="사과"))', 250],
  ['UNIQUE count', '=COUNTA(UNIQUE(A1:A4))', 3],
  ['SORT + INDEX', '=INDEX(SORT(B1:B4,1,-1),1)', 300],
  ['SORTBY + INDEX', '=INDEX(SORTBY(A1:A4,B1:B4,-1),1)', '포도'],
  ['SEQUENCE + SUM', '=SUM(SEQUENCE(5))', 15],
  ['LET', '=LET(x,B1+B2,y,x*2,y+1)', 601],
  ['LAMBDA inline', '=LAMBDA(x,x*10)(5)', 50],
  ['MAP + LAMBDA', '=SUM(MAP(B1:B4,LAMBDA(v,v*2)))', 1500],
  ['REDUCE + LAMBDA', '=REDUCE(0,B1:B4,LAMBDA(a,b,a+b))', 750],
  ['BYROW + LAMBDA', '=SUM(BYROW(B1:C4,LAMBDA(r,SUM(r))))', 760],
  ['VSTACK', '=COUNTA(VSTACK(A1:A2,A3:A4))', 4],
  ['HSTACK', '=COLUMNS(HSTACK(A1:A2,B1:B2))', 2],
  ['TOCOL', '=COUNTA(TOCOL(A1:B2))', 4],
  ['TAKE', '=SUM(TAKE(B1:B4,2))', 300],
  ['DROP', '=SUM(DROP(B1:B4,2))', 450],
  ['CHOOSEROWS', '=SUM(CHOOSEROWS(B1:B4,1,4))', 400],
  ['SUMIFS Korean', '=SUMIFS(B1:B4,A1:A4,"사과")', 250],
  ['COUNTIF wildcard', '=COUNTIF(A1:A4,"사*")', 2],
  ['SUMPRODUCT', '=SUMPRODUCT(B1:B4,C1:C4)', 2150],
  ['MINIFS empty set = 0', '=MINIFS(B1:B4,A1:A4,"망고")', 0],
  ['INDIRECT Korean', '=INDIRECT("매출!A1")', 10],
  ['OFFSET', '=SUM(OFFSET(B1,0,0,3,1))', 450],
  ['DATEDIF', '=DATEDIF("2025-01-01","2026-01-01","Y")', 1],
  ['TEXT date', '=TEXT(DATE(2026,11,25),"yyyy-mm-dd")', '2026-11-25'],
  ['IFERROR + VLOOKUP', '=IFERROR(VLOOKUP("없는값",A1:B4,2,FALSE),0)', 0],
  // Newly installed Excel 2013-365 & Google Sheets compatibility functions
  ['ISO.CEILING', '=ISO.CEILING(4.3,2)', 6],
  ['REGEXTEST match', '=REGEXTEST("Order-2026","\\d{4}")', 1],
  ['REGEXTEST case-insensitive', '=REGEXTEST("Hello","hello",1)', 1],
  ['JIS', '=JIS("AB 12")', 'ＡＢ　１２'],
  ['PERCENTOF', '=PERCENTOF(B1:B2,B1:B4)', 0.4],
  ['TRIMRANGE + ROWS', '=ROWS(TRIMRANGE(E1:E5))', 2],
  ['ISOMITTED omitted', '=LAMBDA(x,y,IF(ISOMITTED(y),x*10,x+y))(5,)', 50],
  ['ISOMITTED supplied', '=LAMBDA(x,y,IF(ISOMITTED(y),x*10,x+y))(5,3)', 8],
  ['ARRAYFORMULA + SUM', '=SUM(ARRAYFORMULA(B1:B4*C1:C4))', 2150],
  ['SPLIT + SUM', '=SUM(SPLIT("10,20;30",",;"))', 60],
  ['JOIN', '=JOIN("-",A1:A3)', '사과-배-사과'],
  ['COUNTUNIQUE', '=COUNTUNIQUE(A1:A5)', 3],
  ['COUNTUNIQUEIFS', '=COUNTUNIQUEIFS(A1:A4,B1:B4,">=150")', 3],
  ['SORTN top 2 unique desc', '=INDEX(SORTN(A1:B4,2,2,2,FALSE),2,1)', '배'],
  ['TO_TEXT', '=TO_TEXT(1234)', '1234'],
  ['TO_PURE_NUMBER', '=TO_PURE_NUMBER("$1,200")', 1200],
  ['ADD + DIVIDE + POW', '=ADD(DIVIDE(10,2),POW(2,3))', 13],
  ['EQ + GT + UNARY_PERCENT', '=IF(AND(EQ("a","A"),GT(5,2)),UNARY_PERCENT(50),0)', 0.5],
]

describe('MS Excel & Google Sheets live formula parity', () => {
  let univer: Univer
  let api: FUniver
  const disposables: { dispose(): void }[] = []

  beforeAll(async () => {
    univer = new Univer({
      locale: LocaleType.EN_US,
      locales: {},
      logLevel: LogLevel.ERROR,
    })
    univer.registerPlugin(UniverFormulaEnginePlugin)
    univer.registerPlugin(UniverSheetsPlugin)
    univer.registerPlugin(UniverSheetsFormulaPlugin)

    api = FUniver.newAPI(univer)
    const runtime = { univer, univerAPI: api } as never
    disposables.push(
      installFormulaLexerFix(runtime),
      installIfsEmptySetFix(runtime),
      installRateFallback(runtime),
      installCompatFunctions(runtime),
    )

    univer.createUnit(UniverInstanceType.UNIVER_SHEET, {
      id: 'parity-wb',
      sheetOrder: ['s1', 's2', 's3'],
      sheets: {
        s1: {
          id: 's1',
          name: 'Sheet1',
          rowCount: 120,
          columnCount: 20,
          cellData: {
            0: { 0: { v: '사과' }, 1: { v: 100 }, 2: { v: 2 } },
            1: { 0: { v: '배' }, 1: { v: 200 }, 2: { v: 3 }, 4: { v: 'x' } },
            2: { 0: { v: '사과' }, 1: { v: 150 }, 2: { v: 1 }, 4: { v: 'y' } },
            3: { 0: { v: '포도' }, 1: { v: 300 }, 2: { v: 4 } },
            4: { 0: { v: '' }, 1: { v: 0 }, 2: { v: 5 } },
          },
        },
        s2: {
          id: 's2',
          name: '매출',
          rowCount: 20,
          columnCount: 10,
          cellData: {
            0: { 0: { v: 10 }, 1: { v: 20 } },
            1: { 0: { v: 30 }, 1: { v: 40 } },
          },
        },
        s3: {
          id: 's3',
          name: '2026 요약',
          rowCount: 20,
          columnCount: 10,
          cellData: {
            0: { 0: { v: 500 } },
          },
        },
      },
    })

    const wb = api.getActiveWorkbook()!
    const sheet = wb.getSheetBySheetId('s1')!
    cases.forEach(([, formula], idx) => {
      sheet.getRange(10 + idx, 0).setFormula(formula)
    })
    await api.getFormula().executeCalculation()
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }, 30_000)

  afterAll(() => {
    for (const d of disposables) d.dispose()
    univer.dispose()
  })

  it.each(cases.map((entry, idx) => [...entry, idx] as const))(
    '%s (%s)',
    (_label, _formula, expected, idx) => {
      const value = api
        .getActiveWorkbook()!
        .getSheetBySheetId('s1')!
        .getRange(10 + idx, 0)
        .getCellData()?.v
      if (typeof expected === 'number') {
        expect(value).toBeCloseTo(expected, 10)
      } else {
        expect(value).toBe(expected)
      }
    },
  )

  it('shifts references cleanly with LexerTreeBuilder.moveFormulaRefOffset', () => {
    const lexer = univer.__getInjector().get(LexerTreeBuilder)
    expect(lexer.moveFormulaRefOffset('=SUM(A1:A5)', 0, 1)).toBe('=SUM(A2:A6)')
    expect(lexer.moveFormulaRefOffset('=SUM($A$1:$A$5)', 1, 1)).toBe('=SUM($A$1:$A$5)')
    expect(lexer.moveFormulaRefOffset('=SUM(매출!A1:A5)', 0, 1)).toBe('=SUM(매출!A2:A6)')
    expect(lexer.moveFormulaRefOffset("=SUM('2026 요약'!A1:A5)", 0, 1)).toBe(
      "=SUM('2026 요약'!A2:A6)",
    )
    expect(lexer.moveFormulaRefOffset('=LET(x,A1*2,x+B1)', 0, 1)).toBe('=LET(x,A2*2,x+B2)')
  })
})
