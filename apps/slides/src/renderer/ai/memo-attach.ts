/**
 * Slides review-comment batch attachment helpers (T10).
 * Groups out existing reply entries so users pick root review threads cleanly.
 */
import type { ReviewMemoItem } from '@genoffice/ui'
import type { SlideComment } from '../../shared/ipc'
import { parseSlideCommentReply } from './comment-reply-tool'

export interface SlidesCommentRef {
  slideIndex: number
  comment: SlideComment
  /** Optional redacted replacement text if the slide carries redacted markers */
  redactedText?: string
}

export function slideCommentKey(slideIndex: number, commentIdx: number): string {
  return `${slideIndex}:${commentIdx}`
}

export function slidesCommentsToReviewMemos(
  allComments: readonly (readonly SlideComment[])[],
): ReviewMemoItem[] {
  const items: ReviewMemoItem[] = []
  for (let slideIndex = 0; slideIndex < allComments.length; slideIndex++) {
    const list = allComments[slideIndex] ?? []
    for (const c of list) {
      if (parseSlideCommentReply(c.text)) continue
      items.push({
        id: slideCommentKey(slideIndex, c.idx),
        location: `Slide ${slideIndex + 1}`,
        author: c.author || 'Reviewer',
        excerpt: c.text.replace(/\s+/g, ' ').trim().slice(0, 140),
        readOnly: false,
      })
    }
  }
  return items
}

export function formatSlidesMemoDelegation(
  selected: readonly ReviewMemoItem[],
  allComments: readonly (readonly SlideComment[])[],
): string {
  if (selected.length === 0) return ''
  const lines = selected.map((item) => {
    const [sStr, idxStr] = item.id.split(':')
    const slideIndex = Number(sStr)
    const commentIdx = Number(idxStr)
    const found = (allComments[slideIndex] ?? []).find((c) => c.idx === commentIdx)
    const body = found?.text ?? item.excerpt
    return `- [slide=${slideIndex + 1} commentIdx=${commentIdx}] (${item.author}): ${body}`
  })
  return [
    '<attached-review-memos editor="slides">',
    ...lines,
    '</attached-review-memos>',
    'Apply each attached slide review comment to the corresponding slide, keep every original comment intact, and record a concise reply on each addressed comment using reply_comment(slide, commentIdx, text).',
  ].join('\n')
}
