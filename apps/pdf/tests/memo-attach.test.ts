import { describe, expect, it } from 'vitest'
import { formatPdfMemoDelegation, pdfNotesToReviewMemos } from '../src/renderer/ai/memo-attach'

describe('PDF review memo attachment', () => {
  it('lists open notes with page numbers and never leaks redacted quotes', () => {
    const notes = [
      {
        id: 'n1',
        page: 4,
        author: 'Editor',
        text: 'Check compliance wording.',
        quote: 'SENSITIVE-NAME',
        redactedQuote: '{{client-name}}',
      },
      {
        id: 'n2',
        page: 5,
        author: 'Editor',
        text: 'Resolved note',
        resolved: true,
      },
    ]
    const items = pdfNotesToReviewMemos(notes)
    expect(items).toHaveLength(1)
    expect(items[0]!.location).toBe('p.4')
    const prompt = formatPdfMemoDelegation(items, notes)
    expect(prompt).toContain('{{client-name}}')
    expect(prompt).not.toContain('SENSITIVE-NAME')
    expect(prompt).toContain('reply_note')
  })
})
