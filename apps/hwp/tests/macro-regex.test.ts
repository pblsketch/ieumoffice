/**
 * Unit, JS RegExp parity, adversarial ReDoS, metering, and refusal tests
 * for the linear-time Thompson NFA / Pike VM regex engine.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_MACRO_REGEX_LENGTH,
  MAX_QUANTIFIER_BOUND,
  compileMacroRegex,
  expandMacroRegexReplacement,
} from '../studio-plugin/macro-regex.mjs'
import type { MacroRegexMatch } from '../studio-plugin/macro-regex.d.mts'

function nativeExecAll(pattern: string, flags: string, text: string): MacroRegexMatch[] {
  const re = new RegExp(pattern, `${flags}g`)
  const unicode = flags.includes('u')
  const out: MacroRegexMatch[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const matchText = m[0]
    const groups: Array<string | undefined> = []
    for (let i = 0; i < m.length; i++) {
      groups.push(m[i])
    }
    out.push({
      index: m.index,
      length: matchText.length,
      matchText,
      groups,
    })
    if (matchText.length === 0) {
      if (re.lastIndex >= text.length) break
      const cp = unicode ? text.codePointAt(re.lastIndex) : undefined
      re.lastIndex += cp !== undefined && cp > 0xffff ? 2 : 1
    }
  }
  return out
}

function applyMacroReplace(pattern: string, flags: string, text: string, template: string): string {
  const compiled = compileMacroRegex(pattern, flags)
  const matches = compiled.execAll(text)
  let out = ''
  let lastEnd = 0
  for (const m of matches) {
    out += text.slice(lastEnd, m.index)
    out += expandMacroRegexReplacement(template, m, text)
    lastEnd = m.index + m.length
  }
  out += text.slice(lastEnd)
  return out
}

describe('macro-regex: JS RegExp parity suite', () => {
  const parityCases: Array<[string, string, string, string]> = [
    ['digits \\d+', '\\d+', '', 'item 12, count 345, zero 0'],
    [
      'chapter heading ^제\\s*\\d+\\s*장',
      '^제\\s*\\d+\\s*장',
      'm',
      '머리말\n제 1 장 서론\n본문\n제12장 결론',
    ],
    ['alternation (foo|bar)', '(foo|bar)', '', 'baz foo bar foobar'],
    ['Korean range [가-힣]+', '[가-힣]+', '', 'Hello 한글 테스트 123 가나다라!'],
    ['word boundary \\b\\w+\\b', '\\b\\w+\\b', '', '  alpha_1, beta-2; gamma3! '],
    [
      'page refs (\\d+)\\s*(쪽|페이지)',
      '(\\d+)\\s*(쪽|페이지)',
      '',
      '참고: 12쪽, 34 페이지, 56쪽.',
    ],
    ['non-capturing (?:ab)+', '(?:ab)+', '', 'a ab abab ababa'],
    ['whitespace/nbsp (\\s|&nbsp;)+', '(\\s|&nbsp;)+', '', 'hello&nbsp;  &nbsp;&nbsp;world'],
    ['repeated capture (\\w+\\s?)+', '(\\w+\\s?)+', '', 'hello world, foo bar baz!'],
    ['newlines (\\r?\\n)+', '(\\r?\\n)+', '', 'line1\n\nline2\r\n\r\nline3\n'],
    ['trailing spaces \\s+$', '\\s+$', 'm', 'hello   \nworld\t \nplain'],
    ['date (\\d{4})-(\\d{2})', '(\\d{4})-(\\d{2})', '', 'Dates: 2026-11 and 1999-01.'],
    [
      'proper names [A-Z][a-z]+\\s[A-Z][a-z]+',
      '[A-Z][a-z]+\\s[A-Z][a-z]+',
      '',
      'By Jane Doe and John Smith.',
    ],
    ['email \\w+@\\w+\\.com', '\\w+@\\w+\\.com', '', 'Send to alice@example.com or bob_2@test.com'],
    ['greedy dot-star .*', '.*', '', 'abc\ndef'],
    ['greedy a.*b', 'a.*b', '', 'axbxb and a123b'],
    ['lazy a.*?b', 'a.*?b', '', 'axbxb and a123b'],
    ['decimal \\d+(\\.\\d+)?', '\\d+(\\.\\d+)?', '', 'vals: 42, 3.14, 0.5, 100'],
    ['sentence end [.!?]\\s+', '[.!?]\\s+', '', 'First. Second! Third?  End.'],
    ['greedy bounded a{2,4}', 'a{2,4}', '', 'a aa aaa aaaa aaaaa'],
    ['lazy bounded a{2,4}?', 'a{2,4}?', '', 'a aa aaa aaaa aaaaa'],
    ['case-insensitive i', '[a-z]+', 'i', 'Hello WORLD MiXeD'],
    ['case-insensitive literal & class', '(?:foo|Bar)[a-c]', 'i', 'FOOA barC fOoB'],
    ['multiline ^ and $', '^\\w+$', 'm', 'one\ntwo\r\nthree\nfour five'],
    ['dotAll s', 'a.+b', 's', 'a1\n2\r\n3b'],
    ['dot without s', 'a.+b', '', 'a1\n2b a3b'],
    ['unicode u with emoji surrogates', '.+', 'u', 'a😀b🎉c'],
    ['unicode u single emoji dot', '.', 'u', 'a😀b'],
    ['unicode u astral range', '[😀-🙏]+', 'u', 'hi 😀😁😂 end'],
    ['unicode u code point escape', '\\u{1F600}+', 'u', 'x😀😀y'],
    ['unicode u surrogate pair escape', '\\uD83D\\uDE00', 'u', 'x😀y'],
    ['empty match ^', '^', 'm', 'a\nb\n'],
    ['empty match $', '$', 'm', 'a\nb\n'],
    ['empty match $ on CRLF', '$', 'm', 'a\r\nb'],
    ['empty match ^ on CRLF', '^', 'm', 'a\r\nb'],
    ['empty match a*', 'a*', '', 'ab'],
    ['empty match a* with unicode', 'a*', 'u', 'a😀'],
    ['empty input ^$', '^$', '', ''],
    ['leftmost-first alternation (a|ab)', '(a|ab)', '', 'ab'],
    ['leftmost-first alternation (ab|a)', '(ab|a)', '', 'ab'],
    ['empty branch first (|a)', '(|a)', '', 'ab'],
    ['empty branch second (a|)', '(a|)', '', 'ab'],
    ['nullable loop (a*)*', '(a*)*', '', 'aaa'],
    ['nullable loop (a*)* on empty', '(a*)*', '', ''],
    ['nullable loop (a|)*', '(a|)*', '', 'a'],
    ['nullable loop (|a)*', '(|a)*', '', 'a'],
    ['nullable loop (a*)+', '(a*)+', '', 'aaa'],
    ['nullable loop (a*)+ on empty', '(a*)+', '', ''],
    ['nullable optional (a?)?', '(a?)?', '', ''],
    ['nullable optional (a?)? on a', '(a?)?', '', 'a'],
    ['nullable optional (|a)?', '(|a)?', '', 'a'],
    ['nullable optional (|a)+', '(|a)+', '', 'a'],
    ['nullable bounded (a|){0,2}', '(a|){0,2}', '', 'a'],
    ['zero quantifier (a){0}', '(a){0}', '', 'a'],
    ['nested capture reset ((a)|(b))+', '((a)|(b))+', '', 'ab'],
    ['negated class [^a-z]+', '[^a-z]+', '', 'abc123DEF456ghi'],
    ['leading/trailing hyphen [-a-c-]', '[-a-c-]+', '', '-a-b-c-d'],
    ['class with shorthands [\\d\\s]+', '[\\d\\s]+', '', 'a 1 2 3 b'],
    ['class with backspace [\\b]', '[\\b]+', '', 'a\b\bc'],
    ['non-word boundary \\B', '\\B\\w\\B', '', 'a ab abc abcd'],
    ['control escapes \\n\\r\\t\\f\\v\\0', '\\t\\n\\r\\f\\v\\0', '', 'x\t\n\r\f\v\0y'],
    ['hex and bmp escapes \\x41\\u0042', '\\x41\\u0042', '', 'AB'],
    ['control letter \\cA\\cZ', '\\cA\\cZ', '', '\x01\x1a'],
    ['unicode property \\p{Script=Hangul}+', '\\p{Script=Hangul}+', 'u', 'abc 한글만 123 가나다'],
    ['unicode property \\P{ASCII}+', '\\P{ASCII}+', 'u', 'hello 세계! 😀'],
    ['unicode property with i \\p{Lu}+', '\\p{Lu}+', 'iu', 'AbCd123'],
    ['non-greedy {n,}?', 'a{2,}?', '', 'aaaaa'],
    ['exact {n}', '\\d{3}', '', '12 123 1234 123456'],
    // T1: lazy quantifiers inside repeated groups & bounded optional iterations
    ['lazy inside star (x*?)*', '(x*?)*', '', 'xxx'],
    ['lazy inside plus end (.*?)+$', '(.*?)+$', '', 'abc'],
    ['lazy inside plus (.*?)+', '(.*?)+', '', 'abc'],
    ['lazy inside star (.*?)*', '(.*?)*', '', 'abc'],
    ['non-capturing lazy inside star (?:.*?)*', '(?:.*?)*', '', 'abc'],
    ['lazy ws inside star (\\s*?)*x', '(\\s*?)*x', '', '  x'],
    ['lazy + optional inside star (a*?b?)*', '(a*?b?)*', '', 'aab'],
    ['lazy inside bounded lazy (\\W+?){0,2}?x', '(\\W+?){0,2}?x', '', '  x'],
    ['lazy inside bounded lazy 3 spaces (\\W+?){0,2}?x', '(\\W+?){0,2}?x', '', '   x'],
    ['lazy inside bounded greedy (\\W+?){0,2}x', '(\\W+?){0,2}x', '', '  x'],
    ['lazy inside bounded greedy 3 spaces (\\W+?){0,2}x', '(\\W+?){0,2}x', '', '   x'],
    ['nested nullable lazy ((?:[^a][a-c]?|B)*?)*', '((?:[^a][a-c]?|B)*?)*', '', 'xbxBy'],
    ['nested alt lazy ((k)*[^a]*?|z)+k+', '((k)*[^a]*?|z)+k+', '', '1 _k'],
    ['nested group lazy ((?:x)*?)*', '((?:x)*?)*', '', 'xxx'],
    ['nested group lazy with suffix ((?:x)*?)*y', '((?:x)*?)*y', '', 'xxxy'],
    ['negated class lazy plus ([^a]*?)+k', '([^a]*?)+k', '', '1 _k'],
    ['nested capture lazy plus ((k)*.*?)+k', '((k)*.*?)+k', '', '12k'],
    ['greedy+lazy inside plus (k*.*?)+k', '(k*.*?)+k', '', '12k'],
    ['lazy inside plus with suffix (.*?)+k', '(.*?)+k', '', '12k'],
    ['non-capturing inner cap (?:(k)*.*?)+', '(?:(k)*.*?)+', '', '12'],
    ['nullable bounded lazy (a*?){0,2}?b', '(a*?){0,2}?b', '', 'aaab'],
    ['nullable bounded greedy (a*?){0,2}b', '(a*?){0,2}b', '', 'aaab'],
    ['deeply nested lazy ((((a*?)*)*)*)*', '((((a*?)*)*)*)*', '', 'aaaa'],
    // T5: \p, \P, \u{...}, \x, lone braces without and with u flag
    ['non-u \\p{L} is literal p{L}', '\\p{L}', '', 'a p{L} b'],
    ['u \\p{L} matches letters', '\\p{L}', 'u', 'a p{L} 한글 1'],
    ['non-u \\P{L} is literal P{L}', '\\P{L}', '', '1 P{L} a'],
    ['u \\P{L} matches non-letters', '\\P{L}', 'u', '1 P{L} 한글'],
    ['non-u \\u{61} is u repeated 61 times', '\\u{61}', '', `a ${'u'.repeat(61)} b`],
    ['non-u \\u{61}? is lazy u{61}', '\\u{61}?', '', `a ${'u'.repeat(61)} b`],
    ['u \\u{61} matches a', '\\u{61}', 'u', `a ${'u'.repeat(61)} b`],
    ['non-u \\u{1F600} is literal u{1F600}', '\\u{1F600}', '', '😀 u{1F600}'],
    ['u \\u{1F600} matches emoji', '\\u{1F600}', 'u', '😀 u{1F600}'],
    ['non-u [\\p{L}] is class of p,{,L,}', '[\\p{L}]', '', 'a p { L } 한글'],
    ['u [\\p{L}] is Unicode letter class', '[\\p{L}]', 'u', 'a p { L } 한글'],
    ['non-u [\\u{61}] is class of u,{,6,1,}', '[\\u{61}]', '', 'a u { 6 1 }'],
    ['u [\\u{61}] matches a', '[\\u{61}]', 'u', 'a u { 6 1 }'],
    [
      'non-u malformed brace quantifiers fall back to literals',
      'a{}|a{,3}|a{1,x}|a{2}{x}|{a}|}',
      '',
      'a{} a{,3} a{1,x} aa{x} {a} }',
    ],
    [
      'non-u incomplete \\x and \\u are identity escapes',
      '\\x1|\\u123|[\\x1\\u123]',
      '',
      'x1 u123 x u',
    ],
    // U5: Annex B non-u \c escapes outside and inside character classes
    ['non-u lone \\c is literal \\c', '\\c', '', '\\c c'],
    ['non-u \\c1 is literal \\c1', '\\c1', '', '\\c1 c1 \x11'],
    ['non-u \\c_ is literal \\c_', '\\c_', '', '\\c_ \x1f'],
    ['non-u \\c* is literal \\ then c*', '\\c*', '', '\\\\c c \\cc'],
    ['non-u [\\c] matches \\ or c', '[\\c]', '', '\\c a'],
    ['non-u [\\c1] matches \\x11 control char', '[\\c1]', '', '\x11 \\ c 1'],
    ['non-u [\\c_] matches \\x1f control char', '[\\c_]', '', '\x1f \\ c _'],
    ['non-u [\\c-z] matches \\ or c..z', '[\\c-z]', '', '\\ a b c d z'],
    ['non-u [A-\\c] matches A..\\ or c', '[A-\\c]', '', 'A [ \\ a c'],
  ]

  it.each(parityCases)('matches JS RegExp identically: %s', (_label, pattern, flags, text) => {
    const compiled = compileMacroRegex(pattern, flags)
    expect(Object.isFrozen(compiled)).toBe(true)
    const actual = compiled.execAll(text)
    const expected = nativeExecAll(pattern, flags, text)
    expect(actual).toEqual(expected)
  })

  it('matches Unicode property escapes only with u flag and treats \\p as literal p without u', () => {
    const withU = compileMacroRegex('\\p{Script=Hangul}+', 'u')
    expect(withU.execAll('abc 한글 123 테스트').map((m) => m.matchText)).toEqual(['한글', '테스트'])
    expect(withU.execAll('p{Script=Hangul}}} 한글')).toEqual(
      nativeExecAll('\\p{Script=Hangul}+', 'u', 'p{Script=Hangul}}} 한글'),
    )

    const withoutU = compileMacroRegex('\\p{Script=Hangul}+')
    const sample = 'abc 한글 p{Script=Hangul} p{Script=Hangul}}}'
    expect(withoutU.execAll(sample)).toEqual(nativeExecAll('\\p{Script=Hangul}+', '', sample))
    expect(withoutU.execAll(sample).map((m) => m.matchText)).toEqual([
      'p{Script=Hangul}',
      'p{Script=Hangul}}}',
    ])
  })

  it('matches JS RegExp identically across a deterministic seeded differential fuzz suite', () => {
    let seed = 0x517cc1b7 >>> 0
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) >>> 0
      let t = seed
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]

    const atomsBase = [
      'a',
      'b',
      'c',
      'A',
      '가',
      ' ',
      '.',
      '\\d',
      '\\w',
      '\\W',
      '\\s',
      '[a-c]',
      '[^a]',
      '[가-힣]',
      '\\u{61}',
      '\\p{L}',
      'k',
    ] as const
    const atomsU = ['\\u{1F600}', '\\p{L}', '\\P{L}', '[\\p{Script=Hangul}]'] as const
    const asserts = ['^', '$', '\\b', '\\B'] as const
    const quantifiers = ['*', '+', '?', '{2}', '{1,3}', '{0,2}', '{2,}', '{0,1}'] as const
    const flagSets = ['', 'i', 'm', 's', 'im', 'u', 'iu', 'msu'] as const
    const alphabet = [
      'a',
      'b',
      'c',
      ' ',
      '\n',
      '가',
      '나',
      'A',
      'B',
      '1',
      '_',
      'k',
      'p',
      'u',
      '{',
      '}',
    ] as const

    function genPattern(depth: number, u: boolean): string {
      const n = 1 + Math.floor(rnd() * 3)
      let out = ''
      for (let i = 0; i < n; i++) {
        const r = rnd()
        let atom: string
        if (depth < 2 && r < 0.3) {
          atom = pick(['(', '(?:']) + genPattern(depth + 1, u) + ')'
        } else if (r < 0.38) {
          out += pick(asserts)
          continue
        } else {
          atom = u && rnd() < 0.25 ? pick(atomsU) : pick(atomsBase)
        }
        if (rnd() < 0.55) {
          let q: string = pick(quantifiers)
          if (rnd() < 0.45) q += '?'
          atom += q
        }
        out += atom
      }
      if (depth < 2 && rnd() < 0.3) {
        out += '|' + genPattern(depth + 1, u)
      }
      return out
    }

    function genText(): string {
      const n = Math.floor(rnd() * 14)
      let s = ''
      for (let i = 0; i < n; i++) s += pick(alphabet)
      return s
    }

    let checked = 0
    for (let i = 0; i < 600; i++) {
      const flags = pick(flagSets)
      const u = flags.includes('u')
      const pat = genPattern(0, u)
      let jsOk = true
      let engOk = true
      let compiled: ReturnType<typeof compileMacroRegex> | null = null
      try {
        new RegExp(pat, `${flags}g`)
      } catch {
        jsOk = false
      }
      try {
        compiled = compileMacroRegex(pat, flags)
      } catch {
        engOk = false
      }
      expect(engOk, `accept/reject mismatch for /${pat}/${flags}`).toBe(jsOk)
      if (!jsOk || !compiled) continue

      for (let k = 0; k < 4; k++) {
        const text = genText()
        checked++
        expect(
          compiled.execAll(text),
          `match mismatch for /${pat}/${flags} on ${JSON.stringify(text)}`,
        ).toEqual(nativeExecAll(pat, flags, text))
      }
    }
    expect(checked).toBeGreaterThan(1500)
  })

  it('matches JS whitespace \\s across all BMP code points', () => {
    const compiled = compileMacroRegex('^\\s$')
    const nativeRe = /^\s$/
    for (let cp = 0; cp <= 0xffff; cp++) {
      const ch = String.fromCharCode(cp)
      const got = compiled.execAll(ch).length === 1
      const want = nativeRe.test(ch)
      if (got !== want) {
        throw new Error(
          `\\s mismatch at U+${cp.toString(16).toUpperCase()}: got=${got}, want=${want}`,
        )
      }
    }
  })

  it('expands replacement templates identically to String.prototype.replace', () => {
    const replacementCases: Array<[string, string, string, string]> = [
      ['(\\d{4})-(\\d{2})', '', 'Date: 2026-11 and 2027-01', '$2/$1'],
      ['(\\d+)\\s*(쪽|페이지)', '', '참고 12쪽, 34 페이지', '[$& -> p.$1 ($2)]'],
      ['(a)(b)', '', 'xxabyy', '$$|$&|$`|$' + "'|$1|$2|$01|$02|$03|$12|$20|$00|$$1"],
      ['(a)(b)?(c)', '', 'ac abc', '<$1-$2-$3>'],
      ['foo', '', 'bar foo baz', '[$`|$&|$' + "'|$$|$1|$x|$]"],
      ['(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)', '', 'abcdefghijk', '$11-$10-$09-$12-$1-$99'],
    ]

    for (const [pattern, flags, text, template] of replacementCases) {
      const actual = applyMacroReplace(pattern, flags, text, template)
      const expected = text.replace(new RegExp(pattern, `${flags}g`), template)
      expect(actual).toBe(expected)
    }
  })

  it('is stateless and re-entrant across repeated execAll calls', () => {
    const compiled = compileMacroRegex('(\\d+)-(\\w+)')
    const r1 = compiled.execAll('1-a 2-b')
    const r2 = compiled.execAll('99-zz')
    const r3 = compiled.execAll('1-a 2-b')
    expect(r1).toEqual(r3)
    expect(r2).toEqual([{ index: 0, length: 5, matchText: '99-zz', groups: ['99-zz', '99', 'zz'] }])
  })
})

describe('macro-regex: adversarial ReDoS suite (linear-time guarantee)', () => {
  const redosCases: Array<[string, string]> = [
    ['(a+)+$', `${'a'.repeat(2999)}!`],
    ['\\w*-?\\w*-?\\w*!', 'a'.repeat(3000)],
    ['\\w*\\s?\\w*!', 'a'.repeat(3000)],
    ['(a|a)*b', 'a'.repeat(3000)],
    ['(a|aa)+$', `${'a'.repeat(2999)}!`],
    ['a*[^b]*a*!', 'a'.repeat(3000)],
    ['[a-z]+[a-z0-9]+!', 'a'.repeat(3000)],
    ['((((((a*?)*)*)*)*)*)*!', 'a'.repeat(3000)],
  ]

  it.each(redosCases)(
    'completes in < 100ms with 0 matches on 3000-char adversarial input: %s',
    (pattern, input) => {
      expect(input.length).toBe(3000)
      const compiled = compileMacroRegex(pattern)
      const t0 = performance.now()
      const matches = compiled.execAll(input)
      const elapsed = performance.now() - t0
      expect(matches).toEqual([])
      expect(elapsed).toBeLessThan(100)
    },
  )
})

describe('macro-regex: mid-scan step & limit metering', () => {
  it('invokes onStep and checkLimit and interrupts scan immediately when checkLimit throws', () => {
    const compiled = compileMacroRegex('(a+)+$')
    const text = 'a'.repeat(2000)
    let totalSteps = 0
    let checks = 0

    expect(() =>
      compiled.execAll(text, {
        onStep(delta) {
          totalSteps += delta
        },
        checkLimit() {
          checks++
          if (totalSteps >= 500) {
            throw new Error('step_limit')
          }
        },
      }),
    ).toThrow('step_limit')

    expect(checks).toBeGreaterThan(0)
    expect(totalSteps).toBeGreaterThanOrEqual(500)
    // Must stop near the threshold, not after scanning the full 2000-char string
    expect(totalSteps).toBeLessThan(2000)
  })

  it('flushes remaining steps on short scans', () => {
    const compiled = compileMacroRegex('abc')
    let totalSteps = 0
    let checks = 0
    const matches = compiled.execAll('abc', {
      onStep(delta) {
        totalSteps += delta
      },
      checkLimit() {
        checks++
      },
    })
    expect(matches).toHaveLength(1)
    expect(totalSteps).toBeGreaterThan(0)
    expect(checks).toBeGreaterThan(0)
  })
})

describe('macro-regex: refused constructs and validation', () => {
  it('refuses backreferences naming "backreference"', () => {
    expect(() => compileMacroRegex('(a)\\1')).toThrow(/backreference/i)
    expect(() => compileMacroRegex('(a)\\9')).toThrow(/backreference/i)
    expect(() => compileMacroRegex('(a)\\10')).toThrow(/backreference/i)
    expect(() => compileMacroRegex('\\k<name>')).toThrow(/backreference/i)
    expect(() => compileMacroRegex('[\\1]')).toThrow(/backreference/i)
  })

  it('refuses lookahead naming "lookahead"', () => {
    expect(() => compileMacroRegex('a(?=b)')).toThrow(/lookahead/i)
    expect(() => compileMacroRegex('a(?!b)')).toThrow(/lookahead/i)
  })

  it('refuses lookbehind naming "lookbehind"', () => {
    expect(() => compileMacroRegex('(?<=a)b')).toThrow(/lookbehind/i)
    expect(() => compileMacroRegex('(?<!a)b')).toThrow(/lookbehind/i)
  })

  it('refuses unsupported (?...) group syntax clearly', () => {
    expect(() => compileMacroRegex('(?<word>\\w+)')).toThrow(/group/i)
    expect(() => compileMacroRegex('(?i:abc)')).toThrow(/group/i)
  })

  it('enforces quantifier bounds and program instruction cap', () => {
    expect(MAX_QUANTIFIER_BOUND).toBe(1000)
    expect(() => compileMacroRegex('a{1001}')).toThrow()
    expect(() => compileMacroRegex('a{0,1001}')).toThrow()
    expect(() => compileMacroRegex('a{5,2}')).toThrow()
    expect(() => compileMacroRegex('(a{200}){200}')).toThrow(/instruction|limit/i)
    expect(() => compileMacroRegex('a{10}', '', { maxQuantifier: 5 })).toThrow()
    expect(compileMacroRegex('a{1000}').captureCount).toBe(0)
  })

  it('enforces pattern length limit', () => {
    expect(MAX_MACRO_REGEX_LENGTH).toBe(256)
    expect(() => compileMacroRegex('a'.repeat(257))).toThrow()
    expect(() => compileMacroRegex('a'.repeat(20), '', { maxLength: 10 })).toThrow()
    expect(compileMacroRegex('a'.repeat(256)).pattern.length).toBe(256)
  })

  it('rejects unknown and duplicate flags', () => {
    expect(() => compileMacroRegex('a', 'g')).toThrow(/flag/i)
    expect(() => compileMacroRegex('a', 'x')).toThrow(/flag/i)
    expect(() => compileMacroRegex('a', 'ii')).toThrow(/flag/i)
  })

  it('rejects invalid syntax', () => {
    const invalidPatterns = [
      '(abc',
      'abc)',
      '[abc',
      '[z-a]',
      '*abc',
      '+abc',
      '?abc',
      '{2}abc',
      'a|*b',
      'a**',
      'a+*',
      'a{2}+',
      'a{2}{3}',
      '\\u{61}+',
      '\\u{110000}',
      'abc\\',
      '^*',
      '$+',
      '\\b*',
      '[\\d-a]',
      '[a-\\d]',
      '[a-\\c]',
    ]
    for (const bad of invalidPatterns) {
      expect(() => compileMacroRegex(bad), `expected "${bad}" to throw`).toThrow()
    }

    const invalidUnicodePatterns = [
      '{',
      '}',
      'a{,3}',
      'a{}',
      'a{1,x}',
      '\\c',
      '\\c1',
      '[\\c]',
      '[\\c1]',
      '\\x1',
      '\\u123',
      '\\u{110000}',
      '\\p{NotARealUnicodeProp}',
      '\\p{',
    ]
    for (const bad of invalidUnicodePatterns) {
      expect(() => compileMacroRegex(bad, 'u'), `expected /${bad}/u to throw`).toThrow()
    }
  })
})
