import { describe, expect, it, vi } from 'vitest'
import type { SlideComment } from '../src/shared/ipc'
import {
  executeReplyCommentTool,
  formatSlideCommentReply,
  groupSlideCommentThreads,
  parseSlideCommentReply,
} from '../src/renderer/ai/comment-reply-tool'
import {
  formatSlidesMemoDelegation,
  slidesCommentsToReviewMemos,
} from '../src/renderer/ai/memo-attach'

const ROOT: SlideComment = {
  idx: 1,
  author: 'Kim',
  authorId: 1,
  initials: 'K',
  dt: '2026-04-10T09:00:00Z',
  text: 'Please tighten the Q2 headline.',
}

describe('Slides PowerPoint-compatible comment threads', () => {
  it('round-trips reply markers and groups replies under root comments', () => {
    const formatted = formatSlideCommentReply(1, 'Tightened the headline to one line.', 'Kim')
    expect(formatted).toBe('↳ [#1 · Kim] Tightened the headline to one line.')
    const parsed = parseSlideCommentReply(formatted)
    expect(parsed).toEqual({
      parentIdx: 1,
      parentAuthor: 'Kim',
      body: 'Tightened the headline to one line.',
    })
    const reply: SlideComment = {
      ...ROOT,
      idx: 2,
      author: 'AI',
      text: formatted,
    }
    const threads = groupSlideCommentThreads([ROOT, reply])
    expect(threads).toHaveLength(1)
    expect(threads[0]!.root.idx).toBe(1)
    expect(threads[0]!.replies).toHaveLength(1)
    expect(threads[0]!.replies[0]!.body).toBe('Tightened the headline to one line.')
  })

  it('adds standard classic <p:cm> reply via AddCommentOp without deleting parent', async () => {
    const addComment = vi.fn().mockResolvedValue(undefined)
    const res = await executeReplyCommentTool(
      { slide: 1, commentIdx: 1, text: 'Updated Q2 metric.' },
      {
        getSlideComments: () => [ROOT],
        addComment,
        fitWidthPx: () => 960,
      },
    )
    expect(res.isError).toBeFalsy()
    expect(res.mutated).toBe(true)
    expect(addComment).toHaveBeenCalledTimes(1)
    expect(addComment.mock.calls[0]![0].text).toContain('↳ [#1 · Kim] Updated Q2 metric.')
  })

  it('lists only root review comments for batch AI attachment', () => {
    const reply: SlideComment = { ...ROOT, idx: 2, text: formatSlideCommentReply(1, 'Done') }
    const memos = slidesCommentsToReviewMemos([[ROOT, reply]])
    expect(memos).toHaveLength(1)
    const prompt = formatSlidesMemoDelegation(memos, [[ROOT, reply]])
    expect(prompt).toContain('<attached-review-memos editor="slides">')
    expect(prompt).toContain('reply_comment')
  })
})
