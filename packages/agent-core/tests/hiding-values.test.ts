import { describe, expect, it } from 'vitest'
import { createValueNumbering, dependentPlaceholder, serialText } from '../src/hiding-values'
import { checkPlaceholders, collectPlaceholders, MAX_LABEL_LENGTH } from '../src/redact-core'

/**
 * A hidden sheet column carries one label, so the model would see the same
 * marker on every row and could not tell rows apart. Each value gets its own
 * number instead: the same value always the same number, for as long as the
 * document stays open.
 */

describe('per-value numbers', () => {
  it('gives the same value the same number and a new value the next one', () => {
    const numbering = createValueNumbering()
    expect(numbering.placeholder('이름', '홍길동')).toBe('{{이름-01}}')
    expect(numbering.placeholder('이름', '김철수')).toBe('{{이름-02}}')
    expect(numbering.placeholder('이름', '홍길동')).toBe('{{이름-01}}')
  })

  it('counts an empty cell as one value of its own', () => {
    const numbering = createValueNumbering()
    expect(numbering.placeholder('이름', null)).toBe('{{이름-01}}')
    expect(numbering.placeholder('이름', '')).toBe('{{이름-01}}')
    expect(numbering.placeholder('이름', undefined)).toBe('{{이름-01}}')
    expect(numbering.placeholder('이름', '홍길동')).toBe('{{이름-02}}')
  })

  it('numbers each label on its own', () => {
    const numbering = createValueNumbering()
    expect(numbering.placeholder('이름', 'a')).toBe('{{이름-01}}')
    expect(numbering.placeholder('전화', 'a')).toBe('{{전화-01}}')
    expect(numbering.placeholder('전화', 'b')).toBe('{{전화-02}}')
    expect(numbering.placeholder('이름', 'b')).toBe('{{이름-02}}')
  })

  it('stays the same for the life of one numbering', () => {
    const numbering = createValueNumbering()
    const first = numbering.placeholder('x', 'first')
    for (let i = 0; i < 150; i++) numbering.placeholder('x', `v${i}`)
    expect(numbering.placeholder('x', 'first')).toBe(first)
    expect(numbering.numberOf('x', 'first')).toBe(1)
  })

  it('starts again in a new numbering (a document opened again)', () => {
    const one = createValueNumbering()
    one.placeholder('x', 'a')
    const two = createValueNumbering()
    expect(two.placeholder('x', 'b')).toBe('{{x-01}}')
  })

  it('grows past two digits when it has to', () => {
    const numbering = createValueNumbering()
    for (let i = 1; i <= 99; i++) numbering.placeholder('x', `v${i}`)
    expect(numbering.placeholder('x', 'v99')).toBe('{{x-99}}')
    expect(numbering.placeholder('x', 'v100')).toBe('{{x-100}}')
    expect(serialText(7)).toBe('07')
    expect(serialText(1234)).toBe('1234')
  })

  it('tells a number from the same digits written as text', () => {
    const numbering = createValueNumbering()
    expect(numbering.placeholder('x', 1)).toBe('{{x-01}}')
    expect(numbering.placeholder('x', '1')).toBe('{{x-02}}')
    expect(numbering.placeholder('x', true)).toBe('{{x-03}}')
    expect(numbering.placeholder('x', 1)).toBe('{{x-01}}')
  })

  it('treats two dates at the same moment as one value', () => {
    const numbering = createValueNumbering()
    expect(numbering.placeholder('d', new Date(2020, 0, 1))).toBe('{{d-01}}')
    expect(numbering.placeholder('d', new Date(2020, 0, 1))).toBe('{{d-01}}')
  })

  it('cleans the label, falls back to the shared default, and keeps the number past the cap', () => {
    const numbering = createValueNumbering()
    expect(numbering.placeholder('  ', 'a')).toBe('{{private-01}}')
    expect(numbering.placeholder('a{b}', 'a')).toBe('{{ab-01}}')
    const long = 'x'.repeat(MAX_LABEL_LENGTH + 5)
    expect(numbering.placeholder(long, 'a')).toBe(`{{${'x'.repeat(MAX_LABEL_LENGTH)}-01}}`)
  })

  it('makes markers the shared checks treat as whole markers', () => {
    const numbering = createValueNumbering()
    const marker = numbering.placeholder('학생 이름', 'v')
    expect(collectPlaceholders(`a ${marker} b`)).toEqual([marker])
    expect(checkPlaceholders(marker, marker)).toEqual([])
  })

  it('never puts the value into the marker', () => {
    const numbering = createValueNumbering()
    expect(numbering.placeholder('이름', '홍길동')).not.toContain('홍길동')
  })
})

describe('a cell that leans on hidden cells', () => {
  it('shows the label with no number', () => {
    expect(dependentPlaceholder(['성적'])).toBe('{{성적}}')
  })

  it('joins several labels with + in code point order', () => {
    expect(dependentPlaceholder(['이름', '성적'])).toBe('{{성적+이름}}')
    expect(dependentPlaceholder(['성적', '이름'])).toBe('{{성적+이름}}')
    expect(dependentPlaceholder(['b', 'A', 'a'])).toBe('{{A+a+b}}')
  })

  it('orders by code point, not by UTF-16 unit', () => {
    // U+1F600 sorts after U+FF01 by code point, before it by UTF-16 unit
    expect(dependentPlaceholder(['\u{1F600}', '！'])).toBe('{{！+\u{1F600}}}')
  })

  it('names each label once', () => {
    expect(dependentPlaceholder(['이름', '이름', '성적'])).toBe('{{성적+이름}}')
  })

  it('cleans each label and falls back to the shared default', () => {
    expect(dependentPlaceholder(['{이름}', ' '])).toBe('{{private+이름}}')
    expect(dependentPlaceholder([])).toBe('{{private}}')
  })
})
