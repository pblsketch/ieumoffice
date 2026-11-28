import { describe, expect, it } from 'vitest'
import { docsCommentsToReviewMemos, formatDocsMemoDelegation } from '../src/renderer/ai/memo-attach'

describe('Docs review memo attachment', () => {
  it('excludes resolved comments and preserves redaction markers instead of raw text', () => {
    const sources = [
      {
        id: 'c1',
        author: 'Reviewer',
        text: 'Clarify the budget figure.',
        quote: 'SECRET-BUDGET-1234',
        redactedQuote: '{{budget-figure}}',
        resolved: false,
      },
      {
        id: 'c2',
        author: 'Reviewer',
        text: 'Already done',
        resolved: true,
      },
    ]
    const items = docsCommentsToReviewMemos(sources)
    expect(items).toHaveLength(1)
    expect(items[0]!.location).toContain('{{budget-figure}}')
    expect(items[0]!.location).not.toContain('SECRET-BUDGET-1234')

    const prompt = formatDocsMemoDelegation(items, sources)
    expect(prompt).toContain('{{budget-figure}}')
    expect(prompt).not.toContain('SECRET-BUDGET-1234')
    expect(prompt).toContain('reply_comment')
  })
})
