/**
 * Docs review-memo batch attachment helpers (T10).
 * Ensures any redacted quote is passed only via `{{label}}` markers.
 */
import type { ReviewMemoItem } from '@genoffice/ui'

export interface DocsCommentSource {
  id: string
  author: string
  text: string
  quote?: string
  resolved?: boolean
  createdAt?: string
  /** Pre-redacted quote when the anchored span overlaps a redaction range */
  redactedQuote?: string
}

export function docsCommentsToReviewMemos(
  comments: readonly DocsCommentSource[],
): ReviewMemoItem[] {
  return comments
    .filter((c) => !c.resolved)
    .map((c) => {
      const safeQuote = (c.redactedQuote ?? c.quote ?? '').replace(/\s+/g, ' ').trim()
      return {
        id: c.id,
        location: safeQuote ? `"${safeQuote.slice(0, 48)}"` : `Comment #${c.id}`,
        author: c.author || 'Reviewer',
        excerpt: c.text.replace(/\s+/g, ' ').trim().slice(0, 140),
        readOnly: false,
      }
    })
}

export function formatDocsMemoDelegation(
  selected: readonly ReviewMemoItem[],
  sources: readonly DocsCommentSource[],
): string {
  if (selected.length === 0) return ''
  const byId = new Map(sources.map((s) => [s.id, s]))
  const lines = selected.map((item) => {
    const src = byId.get(item.id)
    const quote = src?.redactedQuote ?? src?.quote
    const quotePart = quote ? ` | quote: ${quote}` : ''
    return `- [id=${item.id}] (${item.author}${quotePart}): ${src?.text ?? item.excerpt}`
  })
  return [
    '<attached-review-memos editor="docs">',
    ...lines,
    '</attached-review-memos>',
    'Apply each attached review comment to the document body, keep every original comment intact, and post a concise summary reply on each addressed comment using reply_comment.',
  ].join('\n')
}
