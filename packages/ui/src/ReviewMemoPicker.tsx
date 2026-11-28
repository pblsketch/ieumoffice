import React, { useMemo, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import { reviewMemoText } from './strings-review-memo'
import './review-memo-picker.css'

export interface ReviewMemoItem {
  readonly id: string
  readonly location: string
  readonly author?: string | undefined
  readonly excerpt: string
  readonly quote?: string | undefined
  readonly readOnly?: boolean | undefined
  readonly readOnlyReason?: string | undefined
}

export interface MemoAttachSource {
  readonly listMemos: () => readonly ReviewMemoItem[] | Promise<readonly ReviewMemoItem[]>
  readonly onAttachMemos: (items: readonly ReviewMemoItem[]) => void
}

/**
 * Formats attached review memos into a structured AI prompt section.
 * Callers must already apply document redaction (`{{label}}`) to `excerpt` and `quote`.
 */
export function buildMemoBatchPromptSection(items: readonly ReviewMemoItem[]): string {
  if (items.length === 0) return ''
  const lines: string[] = [
    '## Attached Document Review Memos',
    'For each memo below:',
    '1. Apply the requested edits to the document body.',
    '2. Keep the original memo intact — do NOT delete it.',
    '3. For editable memos, leave a concise completion summary reply on the memo.',
    '4. For memos marked `[READ-ONLY]`, do NOT call memo-reply tools; summarize the completed change in your chat response instead.',
    '',
  ]
  for (const item of items) {
    const meta = [item.location, item.author ? `by ${item.author}` : ''].filter(Boolean).join(' · ')
    const roTag = item.readOnly ? ' [READ-ONLY]' : ''
    lines.push(`- Memo \`${item.id}\` (${meta})${roTag}: ${item.excerpt}`)
    if (item.quote) lines.push(`  Quote: "${item.quote}"`)
  }
  return lines.join('\n')
}

export interface ReviewMemoPickerProps {
  readonly items: readonly ReviewMemoItem[]
  readonly lang: Lang
  readonly pos?: { readonly left: number; readonly bottom: number } | null | undefined
  readonly onConfirm: (selected: readonly ReviewMemoItem[]) => void
  readonly onClose: () => void
}

export function ReviewMemoPicker({
  items,
  lang,
  pos,
  onConfirm,
  onClose,
}: ReviewMemoPickerProps): React.JSX.Element {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(items.map((i) => i.id)))

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds],
  )

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div
      className="ai-memo-picker"
      role="dialog"
      aria-label={reviewMemoText(lang, 'pickerTitle')}
      data-testid="review-memo-picker"
      style={pos ? { left: pos.left, bottom: pos.bottom } : undefined}
    >
      <div className="ai-memo-picker-head">
        <span>{reviewMemoText(lang, 'pickerTitle')}</span>
      </div>
      <div className="ai-memo-picker-bar">
        <button
          type="button"
          className="ai-memo-picker-link"
          onClick={() => setSelectedIds(new Set(items.map((i) => i.id)))}
        >
          {reviewMemoText(lang, 'selectAll')}
        </button>
        <button
          type="button"
          className="ai-memo-picker-link"
          onClick={() => setSelectedIds(new Set())}
        >
          {reviewMemoText(lang, 'clearSelection')}
        </button>
      </div>
      <div className="ai-memo-picker-list">
        {items.map((item) => (
          <label key={item.id} className="ai-memo-picker-row">
            <input
              type="checkbox"
              checked={selectedIds.has(item.id)}
              onChange={() => toggle(item.id)}
            />
            <div>
              <div className="ai-memo-picker-meta">
                <span>{item.location}</span>
                {item.author && <span>· {item.author}</span>}
                {item.readOnly && (
                  <span className="ai-memo-picker-ro" title={item.readOnlyReason}>
                    {reviewMemoText(lang, 'readOnlyBadge')}
                  </span>
                )}
              </div>
              <div className="ai-memo-picker-excerpt">{item.excerpt}</div>
            </div>
          </label>
        ))}
      </div>
      <div className="ai-memo-picker-foot">
        <button type="button" className="ai-memo-picker-cancel" onClick={onClose}>
          {reviewMemoText(lang, 'close')}
        </button>
        <button
          type="button"
          className="ai-memo-picker-confirm"
          disabled={selectedItems.length === 0}
          onClick={() => onConfirm(selectedItems)}
        >
          {reviewMemoText(lang, 'attachSelected', { n: selectedItems.length })}
        </button>
      </div>
    </div>
  )
}
