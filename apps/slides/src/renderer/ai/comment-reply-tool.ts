/**
 * PowerPoint-compatible comment reply threading for Slides (T10).
 * Uses standard classic `<p:cm>` comments via `AddCommentOp` with a human-readable
 * leading marker `↳ [#{parentIdx}] ` (or `↳ [#{parentIdx} · {parentAuthor}] `).
 * Zero modifications to `packages/pptx-engine`.
 */
import type { SlideComment } from '../../shared/ipc'
import type { AgentToolDef, ToolExecution } from '@genoffice/agent-core'

const REPLY_MARKER_RE = /^↳\s*\[#(\d+)(?:\s*·\s*([^\]]+))?\]\s*/

export interface ParsedSlideCommentReply {
  parentIdx: number
  parentAuthor?: string
  body: string
}

export interface SlideCommentThread {
  root: SlideComment
  replies: Array<{ comment: SlideComment; body: string; parentAuthor?: string }>
}

export function formatSlideCommentReply(
  parentIdx: number,
  text: string,
  parentAuthor?: string,
): string {
  const cleanText = text.trim()
  const author = parentAuthor?.trim()
  const marker = author ? `↳ [#${parentIdx} · ${author}] ` : `↳ [#${parentIdx}] `
  return `${marker}${cleanText}`
}

export function parseSlideCommentReply(text: string): ParsedSlideCommentReply | null {
  const match = REPLY_MARKER_RE.exec(text)
  if (!match) return null
  const parentIdx = Number(match[1])
  if (!Number.isInteger(parentIdx) || parentIdx < 0) return null
  const parentAuthor = match[2]?.trim() || undefined
  const body = text.slice(match[0].length).trim()
  return {
    parentIdx,
    ...(parentAuthor ? { parentAuthor } : {}),
    body,
  }
}

export function groupSlideCommentThreads(comments: readonly SlideComment[]): SlideCommentThread[] {
  const byIdx = new Map<number, SlideCommentThread>()
  const roots: SlideCommentThread[] = []
  const deferredReplies: Array<{ comment: SlideComment; parsed: ParsedSlideCommentReply }> = []

  for (const comment of comments) {
    const parsed = parseSlideCommentReply(comment.text)
    if (parsed) {
      deferredReplies.push({ comment, parsed })
    } else {
      const thread: SlideCommentThread = { root: comment, replies: [] }
      roots.push(thread)
      byIdx.set(comment.idx, thread)
    }
  }

  for (const { comment, parsed } of deferredReplies) {
    const parent = byIdx.get(parsed.parentIdx)
    if (parent) {
      parent.replies.push({
        comment,
        body: parsed.body || comment.text,
        ...(parsed.parentAuthor ? { parentAuthor: parsed.parentAuthor } : {}),
      })
    } else {
      const orphan: SlideCommentThread = { root: comment, replies: [] }
      roots.push(orphan)
      byIdx.set(comment.idx, orphan)
    }
  }

  return roots
}

export const REPLY_COMMENT_TOOL: AgentToolDef = {
  name: 'reply_comment',
  description:
    'Add a PowerPoint-compatible reply under an existing slide comment without deleting or modifying the original comment.',
  inputSchema: {
    type: 'object',
    properties: {
      slide: { type: 'number', description: '1-based slide number' },
      commentIdx: { type: 'number', description: 'Original comment idx to reply to' },
      text: { type: 'string', description: 'Concise reply summarizing the applied change' },
    },
    required: ['slide', 'commentIdx', 'text'],
  },
}

export interface ReplyCommentDeps {
  getSlideComments(slideIndex: number): Promise<SlideComment[]> | SlideComment[]
  addComment(op: {
    slideIndex: number
    text: string
    xPx: number
    yPx: number
    fitWidthPx: number
  }): Promise<void>
  fitWidthPx(): number
}

export async function executeReplyCommentTool(
  args: Record<string, unknown>,
  deps: ReplyCommentDeps,
): Promise<ToolExecution> {
  const slideNum = Number(args.slide)
  const commentIdx = Number(args.commentIdx)
  const text = typeof args.text === 'string' ? args.text.trim() : ''

  if (!Number.isInteger(slideNum) || slideNum < 1) {
    return {
      output: JSON.stringify({ ok: false, error: 'slide must be a 1-based integer' }),
      isError: true,
      summary: 'reply_comment: invalid slide',
    }
  }
  if (!Number.isInteger(commentIdx) || commentIdx < 0) {
    return {
      output: JSON.stringify({ ok: false, error: 'commentIdx must be a non-negative integer' }),
      isError: true,
      summary: 'reply_comment: invalid commentIdx',
    }
  }
  if (!text) {
    return {
      output: JSON.stringify({ ok: false, error: 'text must be non-empty' }),
      isError: true,
      summary: 'reply_comment: empty reply text',
    }
  }

  const slideIndex = slideNum - 1
  const comments = await deps.getSlideComments(slideIndex)
  const parent = comments.find((c) => c.idx === commentIdx)
  if (!parent) {
    return {
      output: JSON.stringify({
        ok: false,
        error: `Comment #${commentIdx} not found on slide ${slideNum}`,
      }),
      isError: true,
      summary: `reply_comment: comment #${commentIdx} not found`,
    }
  }

  const formatted = formatSlideCommentReply(parent.idx, text, parent.author)
  const fitWidth = Math.max(320, deps.fitWidthPx())
  // Place reply beside parent comment coordinates in standard `<p:cm>` when present
  const rawParent = parent as unknown as { x?: number; y?: number; xPx?: number; yPx?: number }
  const xPx =
    typeof rawParent.xPx === 'number'
      ? Math.round(rawParent.xPx)
      : typeof rawParent.x === 'number'
        ? Math.round((rawParent.x / 12700) * (96 / 72))
        : 32
  const yPx =
    typeof rawParent.yPx === 'number'
      ? Math.round(rawParent.yPx)
      : typeof rawParent.y === 'number'
        ? Math.round((rawParent.y / 12700) * (96 / 72))
        : 32

  await deps.addComment({
    slideIndex,
    text: formatted,
    xPx: Math.max(0, xPx),
    yPx: Math.max(0, yPx),
    fitWidthPx: fitWidth,
  })

  return {
    output: JSON.stringify({ ok: true, slide: slideNum, parentIdx: parent.idx }),
    mutated: true,
    summary: `Replied to comment #${parent.idx} on slide ${slideNum}`,
  }
}
