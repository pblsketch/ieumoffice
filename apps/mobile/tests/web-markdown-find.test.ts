import { describe, expect, it } from 'vitest'
import {
  FIND_IGNORE_CASE,
  countHiddenSpans,
  findInRenderedText,
  findInSource,
  findInText,
  hiddenSpanTagRanges,
  matchIndexFrom,
  replaceKeepsHiddenSpans,
  replaceMatches,
  stepMatch,
} from '../src/renderer/editors/markdownFind'

const SPAN_OPEN = '<span class="redact-span" data-redaction="" data-label="가림1">'
const SPAN = `${SPAN_OPEN}비밀 번호</span>`

const starts = (matches: ReadonlyArray<{ start: number }>) => matches.map((m) => m.start)

describe('find (spec 4.2): literal, case-insensitive by default', () => {
  it('ignores case by default and the default is a named value', () => {
    expect(FIND_IGNORE_CASE).toBe(true)
    expect(starts(findInText('Apple apple APPLE', 'apple'))).toEqual([0, 6, 12])
  })

  it('can match case exactly', () => {
    expect(starts(findInText('Apple apple APPLE', 'apple', { ignoreCase: false }))).toEqual([6])
  })

  it('is literal, not a regular expression', () => {
    expect(starts(findInText('a.b axb (x) [y]', 'a.b'))).toEqual([0])
    expect(starts(findInText('a.b axb (x) [y]', '(x)'))).toEqual([8])
    expect(starts(findInText('a.b axb (x) [y]', '[y]'))).toEqual([12])
    expect(findInText('a+b', '.*')).toEqual([])
  })

  it('an empty query finds nothing', () => {
    expect(findInText('anything', '')).toEqual([])
    expect(findInSource('anything', '')).toEqual([])
  })

  it('finds Hangul and keeps source offsets', () => {
    const text = '# 제목\n\n회의 내용과 회의 결과'
    const found = findInSource(text, '회의')
    expect(found).toEqual([
      { start: 6, end: 8 },
      { start: 13, end: 15 },
    ])
    for (const m of found) expect(text.slice(m.start, m.end)).toBe('회의')
  })

  it('matches do not overlap', () => {
    expect(starts(findInText('aaaa', 'aa'))).toEqual([0, 2])
  })
})

describe('moving between matches wraps around at the ends', () => {
  it('next from the last goes to the first, previous from the first to the last', () => {
    expect(stepMatch(2, 3, 1)).toBe(0)
    expect(stepMatch(0, 3, -1)).toBe(2)
    expect(stepMatch(0, 3, 1)).toBe(1)
    expect(stepMatch(-1, 3, 1)).toBe(0)
    expect(stepMatch(-1, 3, -1)).toBe(2)
    expect(stepMatch(0, 0, 1)).toBe(-1)
  })

  it('the first match at or after an offset, wrapping to the first', () => {
    const matches = findInText('x a x a x', 'x')
    expect(matchIndexFrom(matches, 0)).toBe(0)
    expect(matchIndexFrom(matches, 1)).toBe(1)
    expect(matchIndexFrom(matches, 9)).toBe(0)
    expect(matchIndexFrom([], 0)).toBe(-1)
  })
})

describe('hidden spans: their tag markup is never found nor replaced', () => {
  it('locates the opening and closing tag of each hidden span', () => {
    const text = `앞 ${SPAN} 뒤`
    const ranges = hiddenSpanTagRanges(text)
    expect(ranges).toHaveLength(2)
    expect(text.slice(ranges[0]!.start, ranges[0]!.end)).toBe(SPAN_OPEN)
    expect(text.slice(ranges[1]!.start, ranges[1]!.end)).toBe('</span>')
    expect(countHiddenSpans(text)).toBe(1)
    expect(countHiddenSpans('no spans <span>plain</span>')).toBe(0)
  })

  it('skips matches that overlap a tag, finds the hidden words themselves', () => {
    const text = `span 앞 ${SPAN} 뒤 span`
    const found = findInSource(text, 'span')
    // the two plain words, none inside `<span …>` or `</span>`
    expect(found.map((m) => m.start)).toEqual([0, text.length - 4])
    expect(findInSource(text, 'data-label')).toEqual([])
    expect(findInSource(text, '">비밀')).toEqual([])
    expect(findInSource(text, '번호</')).toEqual([])
    // the hidden words are ordinary text to a person
    const hidden = findInSource(text, '비밀 번호')
    expect(hidden).toHaveLength(1)
    expect(text.slice(hidden[0]!.start, hidden[0]!.end)).toBe('비밀 번호')
  })

  it('a match skipped over a tag does not hide a later one starting inside it', () => {
    // "n>" overlaps the opening tag, but the search goes on right after its start
    const text = `${SPAN}`
    expect(findInSource(text, 'redact')).toEqual([])
    expect(findInSource(text, '호')).toHaveLength(1)
  })
})

describe('replace', () => {
  it('replaces the given matches in one pass', () => {
    const text = 'cat Cat cAt dog'
    expect(replaceMatches(text, findInSource(text, 'cat'), 'fox')).toBe('fox fox fox dog')
    expect(replaceMatches(text, findInSource(text, 'cat').slice(1, 2), 'X')).toBe('cat X cAt dog')
  })

  it('accepts a replace that keeps every hidden span intact', () => {
    const before = `회의 ${SPAN} 회의`
    const after = replaceMatches(before, findInSource(before, '비밀'), '숨긴')
    expect(after).toContain('숨긴 번호</span>')
    expect(replaceKeepsHiddenSpans(before, after)).toBe(true)
  })

  it('rejects a replace that adds a raw "<" inside a hidden span (the reader would fail)', () => {
    const before = `회의 ${SPAN}`
    const after = replaceMatches(before, findInSource(before, '비밀'), 'a<b')
    expect(replaceKeepsHiddenSpans(before, after)).toBe(false)
  })

  it('rejects a replace that closes a hidden span early', () => {
    const before = `회의 ${SPAN}`
    const after = replaceMatches(before, findInSource(before, '비밀'), '</span>')
    expect(replaceKeepsHiddenSpans(before, after)).toBe(false)
  })

  it('rejects a replace after which fewer hidden spans are read', () => {
    const before = `${SPAN}\n\n${SPAN}`
    // a text edit that removes the second span's markup (as a raw source edit could)
    const after = `${SPAN}\n\n비밀 번호`
    expect(countHiddenSpans(after)).toBe(1)
    expect(replaceKeepsHiddenSpans(before, after)).toBe(false)
  })

  it('in a document with hidden spans, rejects a replace that adds span markup elsewhere', () => {
    const before = `${SPAN} 회의`
    expect(replaceKeepsHiddenSpans(before, `${SPAN} <span>`)).toBe(false)
    expect(replaceKeepsHiddenSpans(before, `${SPAN} </span>`)).toBe(false)
    expect(replaceKeepsHiddenSpans(before, `${SPAN} data-redaction`)).toBe(false)
  })

  it('rejects a replace after which the hidden spans cannot be read at all', () => {
    // a new, never closed hidden span
    expect(replaceKeepsHiddenSpans('회의', `${SPAN_OPEN}회의`)).toBe(false)
  })

  it('a document without hidden spans accepts ordinary replaces', () => {
    expect(replaceKeepsHiddenSpans('a b', 'a <b')).toBe(true)
    expect(replaceKeepsHiddenSpans('a b', 'a </span>')).toBe(true)
  })
})

describe('view mode: matches on the rendered text', () => {
  function render(html: string): HTMLElement {
    const root = document.createElement('article')
    root.innerHTML = html
    document.body.appendChild(root)
    return root
  }

  it('maps matches to DOM ranges, also across inline formatting', () => {
    const root = render('<h1>Title</h1><p>a <strong>bo</strong>ld and BOLD</p>')
    const ranges = findInRenderedText(root, 'bold')
    expect(ranges.map((r) => r.toString())).toEqual(['bold', 'BOLD'])
    root.remove()
  })

  it('does not join the end of one block with the start of the next', () => {
    const root = render('<p>ab</p><p>cd</p>')
    expect(findInRenderedText(root, 'bc')).toEqual([])
    expect(findInRenderedText(root, 'cd').map((r) => r.toString())).toEqual(['cd'])
    root.remove()
  })

  it('an empty query finds nothing', () => {
    const root = render('<p>text</p>')
    expect(findInRenderedText(root, '')).toEqual([])
    root.remove()
  })
})
