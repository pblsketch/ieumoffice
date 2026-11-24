import { useEffect, useState } from 'react'
import type { FlowMemo } from '../editors/flowEditing'
import { useMobileLocale } from '../i18n'
import { Sheet } from './Sheet'

/** The memo author name is kept on the device and offered next time. */
const AUTHOR_KEY = 'ieum.mobile.memoAuthor'

function storedAuthor(fallback: string): string {
  try {
    return window.localStorage.getItem(AUTHOR_KEY)?.trim() || fallback
  } catch {
    return fallback
  }
}

function rememberAuthor(author: string) {
  try {
    window.localStorage.setItem(AUTHOR_KEY, author)
  } catch {
    // not remembered: the field starts from the fallback next time
  }
}

export interface MemoSheetProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly memos: readonly FlowMemo[]
  /** Edit mode: memos can be added, answered, changed and removed. */
  readonly canEdit: boolean
  /** Name used when the person has not typed one. */
  readonly defaultAuthor: string
  readonly onAdd: (text: string, author: string) => boolean
  readonly onReply: (parentId: number, text: string, author: string) => boolean
  readonly onEdit: (id: number, text: string) => boolean
  readonly onRemove: (id: number) => boolean
  readonly onReveal: (id: number) => void
}

type Draft = { readonly kind: 'add' } | { readonly kind: 'reply' | 'edit'; readonly id: number }

/**
 * Memos (comments) of the open HWP document (design system 5.x sheet). Lists
 * top-level memos with their replies; tapping one shows its text in the flow.
 */
export function MemoSheet({
  open,
  onClose,
  memos,
  canEdit,
  defaultAuthor,
  onAdd,
  onReply,
  onEdit,
  onRemove,
  onReveal,
}: MemoSheetProps) {
  const { t } = useMobileLocale()
  const [draft, setDraft] = useState<Draft>({ kind: 'add' })
  const [text, setText] = useState('')
  const [author, setAuthor] = useState(() => storedAuthor(defaultAuthor))
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!open) {
      setDraft({ kind: 'add' })
      setText('')
      setFailed(false)
    }
  }, [open])

  const tops = memos.filter((memo) => memo.parentId === null)
  const repliesOf = (id: number) => memos.filter((memo) => memo.parentId === id)

  const submit = () => {
    const body = text.trim()
    if (!body) return
    const name = author.trim() || defaultAuthor
    const ok =
      draft.kind === 'add'
        ? onAdd(body, name)
        : draft.kind === 'reply'
          ? onReply(draft.id, body, name)
          : onEdit(draft.id, body)
    setFailed(!ok)
    if (!ok) return
    rememberAuthor(name)
    setText('')
    setDraft({ kind: 'add' })
  }

  const renderMemo = (memo: FlowMemo, reply: boolean) => (
    <li key={memo.id} className="mobile-memo" data-reply={reply ? 'true' : undefined}>
      <button
        type="button"
        className="mobile-memo-body"
        onClick={() => {
          onReveal(memo.id)
          onClose()
        }}
      >
        <span className="mobile-memo-meta">
          {memo.author}
          {memo.date ? ` · ${new Date(memo.date).toLocaleDateString()}` : ''}
        </span>
        <span className="mobile-memo-text">{memo.text}</span>
      </button>
      {canEdit && memo.editable && (
        <div className="mobile-memo-actions">
          {!reply && (
            <button
              type="button"
              className="mobile-pill-btn mobile-btn-ghost"
              onClick={() => {
                setDraft({ kind: 'reply', id: memo.id })
                setText('')
              }}
            >
              {t('memoReply')}
            </button>
          )}
          <button
            type="button"
            className="mobile-pill-btn mobile-btn-ghost"
            onClick={() => {
              setDraft({ kind: 'edit', id: memo.id })
              setText(memo.text)
            }}
          >
            {t('memoEdit')}
          </button>
          <button
            type="button"
            className="mobile-pill-btn mobile-btn-ghost mobile-btn-danger-text"
            onClick={() => onRemove(memo.id)}
          >
            {t('memoDelete')}
          </button>
        </div>
      )}
    </li>
  )

  return (
    <Sheet
      open={open}
      title={t('memoTitle')}
      closeLabel={t('cancel')}
      onClose={onClose}
      testId="hwp-memo-sheet"
    >
      <div className="mobile-memo-sheet">
        {tops.length === 0 ? (
          <p className="mobile-memo-empty">{t('memoEmpty')}</p>
        ) : (
          <ul className="mobile-memo-list">
            {tops.map((memo) => [
              renderMemo(memo, false),
              ...repliesOf(memo.id).map((r) => renderMemo(r, true)),
            ])}
          </ul>
        )}
        {canEdit && (
          <div className="mobile-memo-composer">
            {draft.kind !== 'edit' && (
              <input
                className="mobile-input"
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
                aria-label={t('memoAuthor')}
                placeholder={t('memoAuthor')}
              />
            )}
            <textarea
              className="mobile-input mobile-memo-input"
              value={text}
              onChange={(event) => setText(event.target.value)}
              aria-label={t('memoPlaceholder')}
              placeholder={t('memoPlaceholder')}
              rows={3}
            />
            {failed && draft.kind === 'add' && (
              <p className="mobile-memo-error" role="alert">
                {t('memoNeedsSelection')}
              </p>
            )}
            <div className="mobile-memo-actions">
              {draft.kind !== 'add' && (
                <button
                  type="button"
                  className="mobile-pill-btn mobile-btn-ghost"
                  onClick={() => {
                    setDraft({ kind: 'add' })
                    setText('')
                  }}
                >
                  {t('cancel')}
                </button>
              )}
              <button
                type="button"
                className="mobile-pill-btn mobile-btn-primary"
                disabled={!text.trim()}
                onClick={submit}
                data-testid="hwp-memo-submit"
              >
                {draft.kind === 'add'
                  ? t('memoAdd')
                  : draft.kind === 'reply'
                    ? t('memoReply')
                    : t('save')}
              </button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )
}
