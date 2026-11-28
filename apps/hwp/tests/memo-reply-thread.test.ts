import { describe, expect, it } from 'vitest'
import type { AgentMemo } from '../studio-plugin/agent-plugin.mjs'
import {
  HWP_MEMO_MAX_TEXT,
  appendHwpMemoReply,
  formatHwpMemoDelegation,
  hwpMemosToReviewMemos,
  parseHwpMemoThread,
} from '../src/renderer/ai/memo-attach'

const EDITABLE_MEMO: AgentMemo = {
  id: 1,
  index: 0,
  author: 'Park',
  date: '2026-04-10T09:00:00Z',
  page: 2,
  preview: '추진 배경 문단',
  text: '숫자 단위를 억원으로 통일해 주세요.',
  editable: true,
  readOnlyReason: null,
} as AgentMemo

const READONLY_MEMO: AgentMemo = {
  id: 2,
  index: 1,
  author: 'Lee',
  date: '2026-04-10T10:00:00Z',
  page: 3,
  preview: '표 2 요약',
  text: '소계 행 강조 서식을 유지하세요.',
  editable: false,
  readOnlyReason: 'formatted',
} as AgentMemo

describe('HWP Hancom-compatible memo reply threads', () => {
  it('appends divider reply block and round-trips parsed thread entries', () => {
    const appended = appendHwpMemoReply(
      EDITABLE_MEMO.text,
      '전체 금액을 억원 단위로 통일했습니다.',
      'AI',
      new Date(2026, 3, 15, 14, 30),
    )
    expect(appended.ok).toBe(true)
    if (!appended.ok) return
    expect(appended.nextText).toContain(
      '---\n[답글 · AI · 2026-04-15 14:30]\n전체 금액을 억원 단위로 통일했습니다.',
    )
    const parsed = parseHwpMemoThread(appended.nextText)
    expect(parsed.originalText).toBe('숫자 단위를 억원으로 통일해 주세요.')
    expect(parsed.replies).toHaveLength(1)
    expect(parsed.replies[0]).toEqual({
      author: 'AI',
      timestamp: '2026-04-15 14:30',
      text: '전체 금액을 억원 단위로 통일했습니다.',
    })
  })

  it('enforces MAX_MEMO_TEXT limit and flags read-only memos for chat-only fallback', () => {
    const huge = 'a'.repeat(HWP_MEMO_MAX_TEXT)
    const tooLong = appendHwpMemoReply(huge, 'reply', 'AI')
    expect(tooLong).toEqual({ ok: false, reason: 'too-long' })

    const items = hwpMemosToReviewMemos([EDITABLE_MEMO, READONLY_MEMO])
    expect(items[0]!.readOnly).toBe(false)
    expect(items[1]!.readOnly).toBe(true)
    expect(items[1]!.readOnlyReason).toBe('formatted')

    const prompt = formatHwpMemoDelegation(items, [EDITABLE_MEMO, READONLY_MEMO])
    expect(prompt).toContain('READ-ONLY: do not call reply_memo')
  })
})
