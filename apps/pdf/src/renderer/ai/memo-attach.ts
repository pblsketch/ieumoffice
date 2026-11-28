/**
 * PDF review-memo batch attachment helpers (T10).
 * Redacted quotes are passed strictly via `{{label}}` markers.
 */
import type { ReviewMemoItem } from '@genoffice/ui'

export interface PdfNoteSource {
  id: string
  page: number
  author: string
  text: string
  quote?: string
  redactedQuote?: string
  resolved?: boolean
}

export function pdfNotesToReviewMemos(notes: readonly PdfNoteSource[]): ReviewMemoItem[] {
  return notes
    .filter((n) => !n.resolved)
    .map((n) => ({
      id: n.id,
      location: `p.${n.page}`,
      author: n.author || 'Reviewer',
      excerpt: n.text.replace(/\s+/g, ' ').trim().slice(0, 140),
      readOnly: false,
    }))
}

export function formatPdfMemoDelegation(
  selected: readonly ReviewMemoItem[],
  sources: readonly PdfNoteSource[],
): string {
  if (selected.length === 0) return ''
  const byId = new Map(sources.map((s) => [s.id, s]))
  const lines = selected.map((item) => {
    const src = byId.get(item.id)
    const quote = src?.redactedQuote ?? src?.quote
    const quotePart = quote ? ` | quote: ${quote}` : ''
    return `- [id=${item.id}] (${item.location}, ${item.author}${quotePart}): ${src?.text ?? item.excerpt}`
  })
  return [
    '<attached-review-memos editor="pdf">',
    ...lines,
    '</attached-review-memos>',
    'Address each attached review note, keep the original note intact, and post a concise completion reply on each addressed note using reply_note.',
  ].join('\n')
}
