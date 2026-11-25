import {
  ArrayValueObject,
  BooleanValueObject,
  ErrorType,
  ErrorValueObject,
  NullValueObject,
  NumberValueObject,
  StringValueObject,
  type BaseValueObject,
} from '@univerjs/engine-formula'
import { describe, expect, it } from 'vitest'

import {
  ArrayformulaFunction,
  BinaryArithmeticFunction,
  BinaryCompareFunction,
  CountuniqueFunction,
  CountuniqueifsFunction,
  IsoCeilingFunction,
  IsomittedFunction,
  JisFunction,
  JoinFunction,
  PercentofFunction,
  RegextestFunction,
  SortnFunction,
  SplitFunction,
  ToFormattedNumberFunction,
  ToPureNumberFunction,
  ToTextFunction,
  TrimrangeFunction,
  UnaryArithmeticFunction,
} from '../src/renderer/compat-functions'

const num = (v: number) => NumberValueObject.create(v)
const str = (v: string) => StringValueObject.create(v)
const bool = (v: boolean) => BooleanValueObject.create(v)
const blank = () => NullValueObject.create()
const arr = (rows: BaseValueObject[][]) =>
  ArrayValueObject.create({
    calculateValueList: rows,
    rowCount: rows.length,
    columnCount: rows[0]?.length ?? 0,
    unitId: '',
    sheetId: '',
    row: 0,
    column: 0,
  })

function asGridValues(result: unknown): unknown[][] {
  const val = result as BaseValueObject
  if (val.isArray()) {
    const a = val as ArrayValueObject
    return a
      .getArrayValue()
      .map((row) => row.map((cell) => (!cell || cell.isNull() ? null : cell.getValue())))
  }
  return [[val.isNull() ? null : val.getValue()]]
}

describe('Excel 2013-365 compatibility functions', () => {
  it('ISO.CEILING rounds toward +infinity regardless of significance sign', () => {
    const fn = new IsoCeilingFunction('ISO.CEILING')
    expect((fn.calculate(num(4.3)) as BaseValueObject).getValue()).toBe(5)
    expect((fn.calculate(num(4.3), num(2)) as BaseValueObject).getValue()).toBe(6)
    expect((fn.calculate(num(4.3), num(-2)) as BaseValueObject).getValue()).toBe(6)
    expect((fn.calculate(num(-4.3), num(1)) as BaseValueObject).getValue()).toBe(-4)
    expect((fn.calculate(num(-4.3), num(-2)) as BaseValueObject).getValue()).toBe(-4)
    expect((fn.calculate(num(0.3), num(0.1)) as BaseValueObject).getValue()).toBeCloseTo(0.3, 12)
    expect((fn.calculate(num(5), num(0)) as BaseValueObject).getValue()).toBe(0)
  })

  it('REGEXTEST supports case sensitivity, (?i), array inputs, and invalid patterns', () => {
    const fn = new RegextestFunction('REGEXTEST')
    expect((fn.calculate(str('Order-2026'), str('\\d{4}')) as BaseValueObject).getValue()).toBe(
      true,
    )
    expect((fn.calculate(str('Hello'), str('hello')) as BaseValueObject).getValue()).toBe(false)
    expect((fn.calculate(str('Hello'), str('hello'), num(1)) as BaseValueObject).getValue()).toBe(
      true,
    )
    expect((fn.calculate(str('Hello'), str('(?i)hello')) as BaseValueObject).getValue()).toBe(true)
    expect((fn.calculate(str('abc'), str('[unclosed')) as BaseValueObject).getValue()).toBe(
      ErrorType.VALUE,
    )
    expect((fn.calculate(str('abc'), str('a'), num(2)) as BaseValueObject).getValue()).toBe(
      ErrorType.VALUE,
    )
    expect(asGridValues(fn.calculate(arr([[str('a1')], [str('bb')]]), str('\\d')))).toEqual([
      [true],
      [false],
    ])
  })

  it('ISOMITTED detects omitted/null arguments without propagating errors', () => {
    const fn = new IsomittedFunction('ISOMITTED')
    expect((fn.calculate(blank()) as BaseValueObject).getValue()).toBe(true)
    expect((fn.calculate(undefined) as BaseValueObject).getValue()).toBe(true)
    expect((fn.calculate(num(0)) as BaseValueObject).getValue()).toBe(false)
    expect((fn.calculate(str('')) as BaseValueObject).getValue()).toBe(false)
    expect(
      (fn.calculate(ErrorValueObject.create(ErrorType.DIV_BY_ZERO)) as BaseValueObject).getValue(),
    ).toBe(false)
  })

  it('JIS converts half-width ASCII and katakana to full-width', () => {
    const fn = new JisFunction('JIS')
    expect((fn.calculate(str('ABC 123')) as BaseValueObject).getValue()).toBe('ＡＢＣ　１２３')
    expect((fn.calculate(str('ｶﾞｷﾞ')) as BaseValueObject).getValue()).toBe('ガギ')
  })

  it('PERCENTOF divides subset sum by total sum and handles divide-by-zero', () => {
    const fn = new PercentofFunction('PERCENTOF')
    expect(
      (
        fn.calculate(
          arr([[num(10)], [num(20)]]),
          arr([[num(10)], [num(20)], [num(70)]]),
        ) as BaseValueObject
      ).getValue(),
    ).toBeCloseTo(0.3, 12)
    expect((fn.calculate(num(10), num(0)) as BaseValueObject).getValue()).toBe(
      ErrorType.DIV_BY_ZERO,
    )
  })

  it('TRIMRANGE trims leading/trailing empty rows and columns', () => {
    const fn = new TrimrangeFunction('TRIMRANGE')
    const grid = arr([
      [blank(), blank(), blank()],
      [blank(), num(1), num(2)],
      [blank(), num(3), blank()],
      [blank(), blank(), blank()],
    ])
    expect(asGridValues(fn.calculate(grid))).toEqual([
      [1, 2],
      [3, null],
    ])
    // Leading only rows, no col trim
    expect(asGridValues(fn.calculate(grid, num(1), num(0)))).toEqual([
      [null, 1, 2],
      [null, 3, null],
      [null, null, null],
    ])
    // All blank -> #CALC!
    expect((fn.calculate(arr([[blank(), blank()]])) as BaseValueObject).getValue()).toBe(
      ErrorType.CALC,
    )
  })
})

describe('Google Sheets compatibility functions', () => {
  it('ARRAYFORMULA passes array values straight through', () => {
    const fn = new ArrayformulaFunction('ARRAYFORMULA')
    const input = arr([[num(2)], [num(4)]])
    expect(fn.calculate(input)).toBe(input)
  })

  it('SPLIT supports split_by_each, remove_empty_text, and numeric coercion', () => {
    const fn = new SplitFunction('SPLIT')
    expect(asGridValues(fn.calculate(str('10,20;30'), str(',;')))).toEqual([[10, 20, 30]])
    expect(asGridValues(fn.calculate(str('a,,b'), str(','), bool(true), bool(false)))).toEqual([
      ['a', '', 'b'],
    ])
    expect(asGridValues(fn.calculate(str('a--b-c'), str('--'), bool(false)))).toEqual([
      ['a', 'b-c'],
    ])
    expect((fn.calculate(str('abc'), str('')) as BaseValueObject).getValue()).toBe(ErrorType.VALUE)
  })

  it('JOIN concatenates scalars and arrays including empty cells', () => {
    const fn = new JoinFunction('JOIN')
    expect(
      (
        fn.calculate(
          str('-'),
          arr([[str('사과')], [blank()], [str('배')]]),
          num(3),
        ) as BaseValueObject
      ).getValue(),
    ).toBe('사과--배-3')
  })

  it('COUNTUNIQUE and COUNTUNIQUEIFS count distinct non-empty values', () => {
    const cu = new CountuniqueFunction('COUNTUNIQUE')
    expect(
      (
        cu.calculate(
          arr([[str('사과')], [str('배')], [str('사과')], [blank()], [str('')]]),
          num(1),
          str('1'),
        ) as BaseValueObject
      ).getValue(),
    ).toBe(4)

    const cuifs = new CountuniqueifsFunction('COUNTUNIQUEIFS')
    const items = arr([[str('사과')], [str('배')], [str('사과')], [str('포도')]])
    const prices = arr([[num(100)], [num(200)], [num(300)], [num(250)]])
    expect((cuifs.calculate(items, prices, str('>=200')) as BaseValueObject).getValue()).toBe(3)
    expect((cuifs.calculate(items, prices, str('>200')) as BaseValueObject).getValue()).toBe(2)
  })

  it('SORTN supports tie modes 0, 1, 2, 3 and descending sort', () => {
    const fn = new SortnFunction('SORTN')
    const data = arr([
      [str('A'), num(10)],
      [str('B'), num(30)],
      [str('C'), num(20)],
      [str('D'), num(20)],
      [str('B'), num(30)],
    ])
    // Mode 0: top 2 descending by col 2 -> B(30), B(30)
    expect(asGridValues(fn.calculate(data, num(2), num(0), num(2), bool(false)))).toEqual([
      ['B', 30],
      ['B', 30],
    ])
    // Mode 1: top 3 descending by col 2 -> B(30), B(30), C(20), D(20) (includes tie on 20)
    expect(asGridValues(fn.calculate(data, num(3), num(1), num(2), bool(false)))).toEqual([
      ['B', 30],
      ['B', 30],
      ['C', 20],
      ['D', 20],
    ])
    // Mode 2: top 2 unique rows descending -> B(30), C(20)
    expect(asGridValues(fn.calculate(data, num(2), num(2), num(2), bool(false)))).toEqual([
      ['B', 30],
      ['C', 20],
    ])
    // Mode 3: top 1 unique row plus all its duplicates -> B(30), B(30)
    expect(asGridValues(fn.calculate(data, num(1), num(3), num(2), bool(false)))).toEqual([
      ['B', 30],
      ['B', 30],
    ])
  })

  it('handles coercion helpers and operator functions', () => {
    expect(
      (new ToTextFunction('TO_TEXT').calculate(bool(true)) as BaseValueObject).getValue(),
    ).toBe('TRUE')
    expect(
      (
        new ToPureNumberFunction('TO_PURE_NUMBER').calculate(str('$1,234.50')) as BaseValueObject
      ).getValue(),
    ).toBe(1234.5)
    expect(
      (
        new ToPureNumberFunction('TO_PURE_NUMBER').calculate(str('25%')) as BaseValueObject
      ).getValue(),
    ).toBe(0.25)
    expect(
      (
        new ToPureNumberFunction('TO_PURE_NUMBER').calculate(str('text')) as BaseValueObject
      ).getValue(),
    ).toBe('text')
    const pct = new ToFormattedNumberFunction('TO_PERCENT', '0.00%').calculate(
      num(0.5),
    ) as NumberValueObject
    expect(pct.getValue()).toBe(0.5)
    expect(pct.getPattern()).toBe('0.00%')
    const usd = new ToFormattedNumberFunction('TO_DOLLARS', '$#,##0.00').calculate(
      num(12),
    ) as NumberValueObject
    expect(usd.getValue()).toBe(12)
    expect(usd.getPattern()).toBe('$#,##0.00')

    expect(
      (
        new BinaryArithmeticFunction('ADD', 'add').calculate(num(3), num(4)) as BaseValueObject
      ).getValue(),
    ).toBe(7)
    expect(
      (
        new BinaryArithmeticFunction('DIVIDE', 'divide').calculate(
          num(10),
          num(4),
        ) as BaseValueObject
      ).getValue(),
    ).toBe(2.5)
    expect(
      (
        new BinaryArithmeticFunction('DIVIDE', 'divide').calculate(
          num(1),
          num(0),
        ) as BaseValueObject
      ).getValue(),
    ).toBe(ErrorType.DIV_BY_ZERO)
    expect(
      (
        new BinaryArithmeticFunction('POW', 'pow').calculate(num(2), num(8)) as BaseValueObject
      ).getValue(),
    ).toBe(256)

    expect(
      (
        new BinaryCompareFunction('EQ', 'eq').calculate(str('abc'), str('ABC')) as BaseValueObject
      ).getValue(),
    ).toBe(true)
    expect(
      (
        new BinaryCompareFunction('NE', 'ne').calculate(num(1), num(2)) as BaseValueObject
      ).getValue(),
    ).toBe(true)
    expect(
      (
        new BinaryCompareFunction('GT', 'gt').calculate(num(5), num(3)) as BaseValueObject
      ).getValue(),
    ).toBe(true)
    expect(
      (
        new BinaryCompareFunction('GTE', 'gte').calculate(num(3), num(3)) as BaseValueObject
      ).getValue(),
    ).toBe(true)
    expect(
      (
        new BinaryCompareFunction('LT', 'lt').calculate(num(1), num(3)) as BaseValueObject
      ).getValue(),
    ).toBe(true)
    expect(
      (
        new BinaryCompareFunction('LTE', 'lte').calculate(num(3), num(3)) as BaseValueObject
      ).getValue(),
    ).toBe(true)

    expect(
      (
        new UnaryArithmeticFunction('UMINUS', 'uminus').calculate(num(7)) as BaseValueObject
      ).getValue(),
    ).toBe(-7)
    expect(
      (
        new UnaryArithmeticFunction('UPLUS', 'uplus').calculate(num(-7)) as BaseValueObject
      ).getValue(),
    ).toBe(-7)
    expect(
      (
        new UnaryArithmeticFunction('UNARY_PERCENT', 'percent').calculate(
          num(45),
        ) as BaseValueObject
      ).getValue(),
    ).toBe(0.45)
  })
})
