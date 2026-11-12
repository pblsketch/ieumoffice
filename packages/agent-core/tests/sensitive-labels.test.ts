import { describe, expect, it } from 'vitest'
import { HIDING_LANGS } from '../src/hiding-langs'
import { MAX_LABEL_LENGTH, sanitizeLabel } from '../src/redact-core'
import { createCandidateLabeler } from '../src/sensitive-labels'
import {
  SENSITIVE_KINDS,
  SENSITIVE_KIND_NAMES,
  normalizeSensitiveValue,
  sensitiveKindName,
} from '../src/sensitive-kinds'

describe('kind names', () => {
  it('exist for every kind in every language, distinct within a language', () => {
    for (const lang of HIDING_LANGS) {
      const names = SENSITIVE_KINDS.map((kind) => SENSITIVE_KIND_NAMES[lang][kind])
      for (const name of names) expect(name, lang).toBeTruthy()
      expect(new Set(names.map((n) => n.toLowerCase())).size, lang).toBe(names.length)
    }
  })

  it('survive label cleaning with room for a number', () => {
    for (const lang of HIDING_LANGS) {
      for (const kind of SENSITIVE_KINDS) {
        const name = SENSITIVE_KIND_NAMES[lang][kind]
        expect(sanitizeLabel(name), `${lang} ${kind}`).toBe(name)
        expect(name.length, `${lang} ${kind}`).toBeLessThanOrEqual(MAX_LABEL_LENGTH - 4)
        expect(name, `${lang} ${kind}`).not.toMatch(/-\d+$/)
      }
    }
  })

  it('reads as the spec writes them in Korean', () => {
    expect(sensitiveKindName('name', 'ko')).toBe('이름')
    expect(sensitiveKindName('phone', 'ko')).toBe('전화')
    expect(sensitiveKindName('vehicle', 'ko')).toBe('차량번호')
    expect(sensitiveKindName('phone', 'xx')).toBe(SENSITIVE_KIND_NAMES.en.phone)
  })
})

describe('comparing values', () => {
  it('drops spaces and hyphens from number-like kinds', () => {
    expect(normalizeSensitiveValue('phone', '010-1234-5678')).toBe(
      normalizeSensitiveValue('phone', '010 1234 5678'),
    )
    expect(normalizeSensitiveValue('resident-number', '900101 - 1234567')).toBe('9001011234567')
    expect(normalizeSensitiveValue('vehicle', '12가 3456')).toBe('12가3456')
    expect(normalizeSensitiveValue('passport', 'm12345678')).toBe('M12345678')
  })

  it('keeps words as words', () => {
    expect(normalizeSensitiveValue('name', ' 홍  길동 ')).toBe('홍 길동')
    expect(normalizeSensitiveValue('email', 'Hong@Example.COM')).toBe('hong@example.com')
  })
})

describe('candidate labels', () => {
  it('are kind name and a two-digit number', () => {
    const labeler = createCandidateLabeler({ lang: 'ko' })
    expect(labeler.labelFor('name', '홍길동')).toBe('이름-01')
    expect(labeler.labelFor('name', '김철수')).toBe('이름-02')
    expect(labeler.labelFor('phone', '010-1234-5678')).toBe('전화-01')
  })

  it('give the same value the same number within a document', () => {
    const labeler = createCandidateLabeler({ lang: 'ko' })
    expect(labeler.labelFor('name', '홍길동')).toBe('이름-01')
    expect(labeler.labelFor('phone', '010-1234-5678')).toBe('전화-01')
    expect(labeler.labelFor('phone', '010 1234 5678')).toBe('전화-01')
    expect(labeler.labelFor('phone', '01012345678')).toBe('전화-01')
    expect(labeler.labelFor('name', '홍길동')).toBe('이름-01')
  })

  it('continue after numbers the document already has', () => {
    const labeler = createCandidateLabeler({
      lang: 'ko',
      existingLabels: ['이름-03', '이름-01', '전화-07', '학생 이름', '이름-x', '주소-2'],
    })
    expect(labeler.labelFor('name', 'a')).toBe('이름-04')
    expect(labeler.labelFor('phone', '1')).toBe('전화-08')
    expect(labeler.labelFor('address', 'x')).toBe('주소-03')
    expect(labeler.labelFor('email', 'x@y.zz')).toBe('이메일-01')
  })

  it('grow past two digits', () => {
    const labeler = createCandidateLabeler({ lang: 'ko', existingLabels: ['이름-99'] })
    expect(labeler.labelFor('name', 'a')).toBe('이름-100')
  })

  it('use the screen language', () => {
    const labeler = createCandidateLabeler({ lang: 'en' })
    expect(labeler.labelFor('name', 'Jane')).toBe(`${SENSITIVE_KIND_NAMES.en.name}-01`)
  })

  it('never carry the value', () => {
    const labeler = createCandidateLabeler({ lang: 'ko' })
    expect(labeler.labelFor('name', '홍길동')).not.toContain('홍길동')
  })
})

describe('candidate labels next to marks the document already has', () => {
  it('reuse the label a value is already hidden under', () => {
    const labeler = createCandidateLabeler({
      lang: 'ko',
      existingMarks: [
        { label: '전화-01', value: '010-1234-5678' },
        { label: '이름-02', value: '홍길동' },
      ],
    })
    expect(labeler.labelFor('phone', '01012345678')).toBe('전화-01')
    expect(labeler.labelFor('phone', '010 1234 5678')).toBe('전화-01')
    expect(labeler.labelFor('name', '홍길동')).toBe('이름-02')
    expect(labeler.labelFor('phone', '010-9999-0000')).toBe('전화-02')
    expect(labeler.labelFor('name', '김철수')).toBe('이름-03')
  })

  it('use the kind a mark gives, or the kind its label names in any language', () => {
    const labeler = createCandidateLabeler({
      lang: 'ko',
      existingMarks: [
        { label: 'Phone-04', value: '01012345678' },
        { label: '연락', value: '02-123-4567', kind: 'phone' },
      ],
    })
    expect(labeler.labelFor('phone', '010-1234-5678')).toBe('Phone-04')
    expect(labeler.labelFor('phone', '021234567')).toBe('연락')
    expect(labeler.labelFor('phone', '010-0000-0000')).toBe('전화-01')
  })

  it('keep a label whose value is unknown out of the way', () => {
    const labeler = createCandidateLabeler({
      lang: 'ko',
      existingLabels: ['전화-05'],
      existingMarks: [{ label: '전화-02', value: '010-1111-2222' }],
    })
    expect(labeler.labelFor('phone', '010-3333-4444')).toBe('전화-06')
    expect(labeler.labelFor('phone', '01011112222')).toBe('전화-02')
  })

  it('do not take a label from a mark of another kind', () => {
    const labeler = createCandidateLabeler({
      lang: 'ko',
      existingMarks: [{ label: '계좌-01', value: '01012345678' }],
    })
    expect(labeler.labelFor('phone', '01012345678')).toBe('전화-01')
  })
})
