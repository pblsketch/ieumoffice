/**
 * HWP review-memo batch attachment & Hancom-compatible reply helpers (T10).
 * Preserves read-only memo visibility (attachable for body edits, reply disallowed)
 * and formats replies as `---\n[답글 · {author} · {YYYY-MM-DD HH:mm}]\n{text}`
 * without modifying rhwp core or triggering MemoApprovalGate.
 */
import type { ReviewMemoItem } from '@genoffice/ui'
import type { AgentMemo } from '../../../studio-plugin/agent-plugin.mjs'

export const HWP_MEMO_MAX_TEXT = 100_000

const REPLY_BLOCK_RE = /\n?---\n\[답글\s*·\s*([^·\]]+?)\s*·\s*([^\]]+?)\]\n/g

export interface HwpMemoReplyEntry {
  author: string
  timestamp: string
  text: string
}

export interface ParsedHwpMemoThread {
  originalText: string
  replies: HwpMemoReplyEntry[]
}

export function formatHwpReplyTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function appendHwpMemoReply(
  existingText: string,
  replyText: string,
  author: string,
  now: Date = new Date(),
): { ok: true; nextText: string } | { ok: false; reason: 'empty' | 'too-long' } {
  const cleanReply = replyText.replace(/\r\n?/g, '\n').trim()
  if (!cleanReply) return { ok: false, reason: 'empty' }
  const cleanAuthor = author.trim() || 'AI'
  const block = `---\n[답글 · ${cleanAuthor} · ${formatHwpReplyTimestamp(now)}]\n${cleanReply}`
  const base = existingText.replace(/\r\n?/g, '\n').trimEnd()
  const nextText = base ? `${base}\n${block}` : block
  if (nextText.length > HWP_MEMO_MAX_TEXT) {
    return { ok: false, reason: 'too-long' }
  }
  return { ok: true, nextText }
}

export function parseHwpMemoThread(text: string): ParsedHwpMemoThread {
  const normalized = text.replace(/\r\n?/g, '\n')
  const matches = [...normalized.matchAll(REPLY_BLOCK_RE)]
  if (matches.length === 0) {
    return { originalText: normalized, replies: [] }
  }
  const firstIndex = matches[0]!.index ?? 0
  const originalText = normalized.slice(0, firstIndex).trimEnd()
  const replies: HwpMemoReplyEntry[] = []
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!
    const bodyStart = (m.index ?? 0) + m[0].length
    const bodyEnd =
      i + 1 < matches.length ? (matches[i + 1]!.index ?? normalized.length) : normalized.length
    replies.push({
      author: (m[1] ?? '').trim(),
      timestamp: (m[2] ?? '').trim(),
      text: normalized.slice(bodyStart, bodyEnd).trim(),
    })
  }
  return { originalText, replies }
}

export function hwpMemosToReviewMemos(memos: readonly AgentMemo[]): ReviewMemoItem[] {
  return memos.map((m) => {
    const parsed = parseHwpMemoThread(m.text ?? '')
    const locationParts: string[] = []
    if (typeof m.page === 'number' && m.page > 0) locationParts.push(`p.${m.page}`)
    const preview = (m.preview ?? '').replace(/\s+/g, ' ').trim()
    if (preview) locationParts.push(`"${preview.slice(0, 36)}"`)
    const readOnly = m.editable !== true
    return {
      id: String(m.id),
      location: locationParts.join(' · ') || `Memo #${m.id}`,
      author: m.author || 'Reviewer',
      excerpt: parsed.originalText.replace(/\s+/g, ' ').trim().slice(0, 140),
      readOnly,
      ...(readOnly && m.readOnlyReason ? { readOnlyReason: String(m.readOnlyReason) } : {}),
    }
  })
}

export function formatHwpMemoDelegation(
  selected: readonly ReviewMemoItem[],
  memos: readonly AgentMemo[],
): string {
  if (selected.length === 0) return ''
  const byId = new Map(memos.map((m) => [String(m.id), m]))
  const lines = selected.map((item) => {
    const src = byId.get(item.id)
    const roFlag = item.readOnly
      ? ' [READ-ONLY: do not call reply_memo; summarize in chat instead]'
      : ''
    const body = src ? parseHwpMemoThread(src.text ?? '').originalText : item.excerpt
    return `- [memoId=${item.id}] (${item.location}, ${item.author})${roFlag}: ${body}`
  })
  return [
    '<attached-review-memos editor="hwp">',
    ...lines,
    '</attached-review-memos>',
    'Apply each attached Hangul memo to the document body without deleting the original memo. For editable memos, append a concise reply using reply_memo(memoId, text). For read-only memos, do not call reply_memo — instead list how each read-only memo was addressed in your chat reply.',
  ].join('\n')
}
