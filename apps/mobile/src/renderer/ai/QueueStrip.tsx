import { useEffect, useRef, useState } from 'react'
import { IconChevronDown, IconClose, IconEdit } from '../components/MobileIcons'
import { IconAiMoveDown, IconAiMoveUp, IconAiResume } from '../components/icons/ai'
import { useMobileLocale } from '../i18n'
import './aiPanelParts.css'

export interface QueueStripItem {
  readonly id: string
  readonly text: string
}

export interface QueueStripProps {
  readonly items: readonly QueueStripItem[]
  /** the queue is held (a Stop, or a message not sent because of hidden content) */
  readonly paused: boolean
  readonly onResume: () => void
  readonly onClear: () => void
  readonly onUpdate: (id: string, text: string) => void
  readonly onMove: (id: string, toIndex: number) => void
  readonly onRemove: (id: string) => void
}

/**
 * The messages waiting above the composer (PC's useChatRunQueue rules, drawn
 * for touch): a count row that folds the list, and per message buttons to
 * edit, move one place up or down, and take it out. While the queue is held a
 * [resume] button lets it go on.
 */
export function QueueStrip({
  items,
  paused,
  onResume,
  onClear,
  onUpdate,
  onMove,
  onRemove,
}: QueueStripProps) {
  const { t } = useMobileLocale()
  const [open, setOpen] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const editRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (editingId) editRef.current?.focus()
  }, [editingId])

  if (items.length === 0) return null

  const commit = () => {
    if (!editingId) return
    if (draft.trim()) onUpdate(editingId, draft)
    setEditingId(null)
  }

  return (
    <div
      className="mobile-ai-queue"
      data-testid="ai-queue-strip"
      data-paused={paused ? 'true' : undefined}
    >
      <div className="mobile-ai-queue-head">
        <button
          type="button"
          className="mobile-ai-queue-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="mobile-ai-queue-chevron" data-open={open ? 'true' : undefined}>
            <IconChevronDown size={16} />
          </span>
          <span data-testid="ai-queue-count">{t('aiQueueCount', { count: items.length })}</span>
          {paused && <span className="mobile-ai-queue-paused">{t('aiQueuePaused')}</span>}
        </button>
        {paused && (
          <button
            type="button"
            className="mobile-pill-btn mobile-btn-secondary"
            data-testid="ai-queue-resume"
            onClick={onResume}
          >
            <IconAiResume size={14} />
            {t('aiQueueResume')}
          </button>
        )}
        <button
          type="button"
          className="mobile-pill-btn mobile-btn-ghost"
          data-testid="ai-queue-clear"
          onClick={onClear}
        >
          {t('aiQueueClear')}
        </button>
      </div>
      {open && (
        <ol className="mobile-ai-queue-list">
          {items.map((item, index) => (
            <li key={item.id} className="mobile-ai-queue-item" data-testid="ai-queue-item">
              {editingId === item.id ? (
                <form
                  className="mobile-ai-queue-edit"
                  onSubmit={(e) => {
                    e.preventDefault()
                    commit()
                  }}
                >
                  <input
                    ref={editRef}
                    className="mobile-ai-queue-input"
                    value={draft}
                    aria-label={t('aiQueueEdit')}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <button type="submit" className="mobile-pill-btn mobile-btn-primary">
                    {t('aiQueueEditDone')}
                  </button>
                </form>
              ) : (
                <>
                  <span className="mobile-ai-queue-text" dir="auto">
                    {item.text}
                  </span>
                  <span className="mobile-ai-queue-actions">
                    <button
                      type="button"
                      className="mobile-icon-btn"
                      aria-label={t('aiQueueEdit')}
                      title={t('aiQueueEdit')}
                      data-action="edit"
                      onClick={() => {
                        setDraft(item.text)
                        setEditingId(item.id)
                      }}
                    >
                      <IconEdit size={18} />
                    </button>
                    <button
                      type="button"
                      className="mobile-icon-btn"
                      aria-label={t('aiQueueMoveUp')}
                      title={t('aiQueueMoveUp')}
                      data-action="up"
                      disabled={index === 0}
                      onClick={() => onMove(item.id, index - 1)}
                    >
                      <IconAiMoveUp size={18} />
                    </button>
                    <button
                      type="button"
                      className="mobile-icon-btn"
                      aria-label={t('aiQueueMoveDown')}
                      title={t('aiQueueMoveDown')}
                      data-action="down"
                      disabled={index === items.length - 1}
                      onClick={() => onMove(item.id, index + 1)}
                    >
                      <IconAiMoveDown size={18} />
                    </button>
                    <button
                      type="button"
                      className="mobile-icon-btn"
                      aria-label={t('aiQueueRemove')}
                      title={t('aiQueueRemove')}
                      data-action="remove"
                      onClick={() => onRemove(item.id)}
                    >
                      <IconClose size={18} />
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
