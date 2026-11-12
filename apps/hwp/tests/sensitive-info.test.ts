/**
 * The Hangul editor's 민감정보 가리기 helpers: the reasons a selection cannot be hidden, the
 * candidate rows (dismissed ones out, labels numbered after the document's own), and the
 * count of candidates in the attachments.
 */
import { describe, expect, it } from 'vitest'
import type { AgentSensitiveCandidate } from '../studio-plugin/agent-plugin.mjs'
import {
  attachmentCandidateCount,
  candidateRowsOf,
  hidingErrorKey,
  hidingLabelOfMemo,
  isHidingMemo,
  placeOfAnchor,
} from '../src/renderer/sensitive-info'

const anchor = {
  place: 'body' as const,
  sectionIndex: 0,
  paraIndex: 2,
  startCharIdx: 4,
  endCharIdx: 17,
  path: null,
}

const candidate = (over: Partial<AgentSensitiveCandidate>): AgentSensitiveCandidate => ({
  kind: 'phone',
  value: '010-1234-5678',
  before: '연락처 ',
  after: '',
  page: 1,
  anchor,
  hideable: true,
  ...over,
})

describe('hidingErrorKey', () => {
  it('names each reason a selection cannot be hidden', () => {
    expect(hidingErrorKey('none')).toBe('hidingErrNone')
    expect(hidingErrorKey('overlap')).toBe('hidingErrOverlap')
    expect(hidingErrorKey('memo_overlap')).toBe('hidingErrOverlap')
    expect(hidingErrorKey('unsupported_place')).toBe('hidingErrPlace')
    expect(hidingErrorKey('protected')).toBe('hidingErrProtected')
    expect(hidingErrorKey('anything else')).toBe('hidingErrFailed')
  })
})

describe('hiding memos', () => {
  it('are told apart from ordinary ones in any screen language', () => {
    expect(isHidingMemo({ text: '[민감정보 가리기] 학생' })).toBe(true)
    expect(isHidingMemo({ text: '[Hide sensitive info] student' })).toBe(true)
    expect(isHidingMemo({ text: '확인 필요' })).toBe(false)
    expect(hidingLabelOfMemo({ text: '[민감정보 가리기] 학생' })).toBe('학생')
  })

  it('reveal their anchor at its place', () => {
    expect(placeOfAnchor(anchor)).toEqual({ sec: 0, para: 2, offset: 4, length: 13 })
  })
})

describe('candidateRowsOf', () => {
  it('leaves dismissed ones out and numbers labels after the ones the document has', () => {
    const { rows, byId } = candidateRowsOf(
      [
        candidate({}),
        candidate({ value: '010-9999-0000' }),
        candidate({ value: '010 1234 5678', page: 2 }),
        candidate({ kind: 'email', value: 'a@b.kr', hideable: false, reason: 'memo-overlap' }),
      ],
      {
        lang: 'ko',
        excluded: [false, true, false, false],
        marks: [{ label: '전화-03', value: '010-5555-6666' }],
        location: (page) => `${page}쪽`,
      },
    )
    expect(rows.map((row) => row.label)).toEqual(['전화-04', '전화-04', '이메일-01'])
    expect(rows.map((row) => row.location)).toEqual(['1쪽', '2쪽', '1쪽'])
    expect(rows[2]).toMatchObject({ hideable: false, reason: 'memo-overlap' })
    expect(byId.get(rows[0]!.id)?.anchor).toEqual(anchor)
    expect(rows.some((row) => row.value === '010-9999-0000')).toBe(false)
  })

  it('keeps a spot without an anchor in the list, but not as one to hide', () => {
    const { rows } = candidateRowsOf([candidate({ anchor: null, reason: 'header-footer' })], {
      lang: 'ko',
      excluded: [],
      marks: [],
      location: () => '',
    })
    expect(rows[0]).toMatchObject({ hideable: false, reason: 'header-footer' })
  })
})

describe('attachmentCandidateCount', () => {
  it('counts what the same rules find in the attachments’ text', () => {
    expect(
      attachmentCandidateCount(['연락처 010-1234-5678', '메일 test@example.com', '없음']),
    ).toBe(2)
    expect(attachmentCandidateCount([])).toBe(0)
  })
})
