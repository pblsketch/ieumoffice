import { describe, expect, it } from 'vitest'
import {
  HIDING_NAME_PATTERN,
  buildHidingName,
  hidingNameLabel,
  isHidingName,
  nextHidingName,
  parseHidingName,
} from '../src/hiding-name'

/**
 * A workbook-scoped defined name is the sheet's hiding mark, and its shape is
 * a file contract: `IeumHide[<n>]_<label>`, read with `^IeumHide(\d*)_(.+)$`
 * without case. Excel shows the name in its Name Box, so the label is written
 * in the characters a name may hold.
 */

describe('the label part of a name', () => {
  it('keeps letters of any script, digits, underscores and periods', () => {
    expect(hidingNameLabel('학생이름', 'ko')).toBe('학생이름')
    expect(hidingNameLabel('score.v2_final', 'en')).toBe('score.v2_final')
    expect(hidingNameLabel('ชื่อนักเรียน', 'th')).toBe('ชื่อนักเรียน')
    expect(hidingNameLabel('छात्र नाम', 'hi')).toBe('छात्र_नाम')
  })

  it('turns everything else into an underscore, one for one', () => {
    expect(hidingNameLabel('학생 이름', 'ko')).toBe('학생_이름')
    expect(hidingNameLabel('전화-번호', 'ko')).toBe('전화_번호')
    expect(hidingNameLabel('a+b,c', 'en')).toBe('a_b_c')
    expect(hidingNameLabel('학번·사번', 'ko')).toBe('학번_사번')
  })

  it('cleans the label first with the shared rule', () => {
    expect(hidingNameLabel('  학생   {이름}  ', 'ko')).toBe('학생_이름')
  })

  it('stores the language word for "sensitive info" when the label is empty', () => {
    expect(hidingNameLabel('  ', 'ko')).toBe('민감정보')
    expect(hidingNameLabel('', 'en')).toBe('Sensitive_info')
  })
})

describe('building a name', () => {
  it('has no number for the first mark of a label', () => {
    expect(buildHidingName('학생 이름', 'ko')).toBe('IeumHide_학생_이름')
    expect(buildHidingName('학생 이름', 'ko', 1)).toBe('IeumHide_학생_이름')
  })

  it('puts the duplicate number in front of the label', () => {
    expect(buildHidingName('학생이름', 'ko', 2)).toBe('IeumHide2_학생이름')
    expect(buildHidingName('학생이름', 'ko', 12)).toBe('IeumHide12_학생이름')
  })

  it('never carries a per-value number', () => {
    expect(buildHidingName('이름', 'ko')).not.toMatch(/-\d/)
  })
})

describe('reading a name', () => {
  it('reads the label and the duplicate number', () => {
    expect(parseHidingName('IeumHide_학생이름')).toEqual({ n: 1, label: '학생이름' })
    expect(parseHidingName('IeumHide2_학생이름')).toEqual({ n: 2, label: '학생이름' })
    expect(parseHidingName('IeumHide10_x')).toEqual({ n: 10, label: 'x' })
  })

  it('keeps digits and periods inside the label apart from the number', () => {
    expect(parseHidingName('IeumHide_2학년.성적')).toEqual({ n: 1, label: '2학년.성적' })
    expect(parseHidingName('IeumHide3_2학년.성적')).toEqual({ n: 3, label: '2학년.성적' })
    expect(parseHidingName(buildHidingName('2024 성적', 'ko', 2))).toEqual({
      n: 2,
      label: '2024_성적',
    })
  })

  it('does not turn underscores back into spaces', () => {
    expect(parseHidingName('IeumHide_학생_이름')?.label).toBe('학생_이름')
  })

  it('ignores case, as Excel does', () => {
    expect(parseHidingName('ieumhide_name')).toEqual({ n: 1, label: 'name' })
    expect(parseHidingName('IEUMHIDE2_Name')).toEqual({ n: 2, label: 'Name' })
    expect(isHidingName('iEuMhIdE_x')).toBe(true)
  })

  it('takes any digits the pattern takes, so nothing slips through', () => {
    expect(parseHidingName('IeumHide1_x')).toEqual({ n: 1, label: 'x' })
    expect(parseHidingName('IeumHide0_x')?.label).toBe('x')
  })

  it('leaves other names alone', () => {
    for (const name of [
      'IeumHide',
      'IeumHide_',
      'IeumHidex_y',
      'IeumHide2',
      'xIeumHide_y',
      '_IeumHide_y',
      'Ieum_Hide_y',
      'Print_Area',
      '학생이름',
      '',
    ]) {
      expect(isHidingName(name), name).toBe(false)
      expect(parseHidingName(name), name).toBeNull()
    }
  })

  it('reads with the pattern the spec names', () => {
    expect(HIDING_NAME_PATTERN.source).toBe('^IeumHide(\\d*)_(.+)$')
    expect(HIDING_NAME_PATTERN.flags).toContain('i')
  })

  it('round-trips what it builds', () => {
    for (const label of ['학생 이름', 'a.b', 'Ünïcödé', '전화-02', 'x']) {
      const built = buildHidingName(label, 'ko', 3)
      expect(parseHidingName(built)).toEqual({ n: 3, label: hidingNameLabel(label, 'ko') })
    }
  })
})

describe('picking the next free name', () => {
  it('starts without a number', () => {
    expect(nextHidingName('이름', 'ko', [])).toBe('IeumHide_이름')
    expect(nextHidingName('이름', 'ko', ['IeumHide_전화', 'Print_Area'])).toBe('IeumHide_이름')
  })

  it('gives the second mark of a label the number 2', () => {
    expect(nextHidingName('이름', 'ko', ['IeumHide_이름'])).toBe('IeumHide2_이름')
  })

  it('fills the lowest free number', () => {
    expect(nextHidingName('이름', 'ko', ['IeumHide_이름', 'IeumHide3_이름'])).toBe('IeumHide2_이름')
    expect(nextHidingName('이름', 'ko', ['IeumHide2_이름'])).toBe('IeumHide_이름')
  })

  it('compares without case, as Excel does', () => {
    expect(nextHidingName('Name', 'en', ['ieumhide_NAME', 'IEUMHIDE2_name'])).toBe('IeumHide3_Name')
  })

  it('compares the label as it will be written', () => {
    expect(nextHidingName('학생 이름', 'ko', ['IeumHide_학생_이름'])).toBe('IeumHide2_학생_이름')
  })
})
