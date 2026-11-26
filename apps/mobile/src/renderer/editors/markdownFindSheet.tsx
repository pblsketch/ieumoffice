import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import { Sheet } from '../components/Sheet'
import type { ToastRequest } from '../components/Toast'
import { IconWebFindNext, IconWebFindPrev } from '../components/icons/web'
import { useMobileLocale } from '../i18n'
import type { MarkdownMobileEditorHandle } from './MarkdownMobileEditor'
import {
  FIND_IGNORE_CASE,
  blockOf,
  clearFindHighlights,
  findInRenderedText,
  findInSource,
  matchIndexFrom,
  paintFindHighlights,
  replaceKeepsHiddenSpans,
  replaceMatches,
  stepMatch,
} from './markdownFind'
import './markdownFindSheet.css'

export interface MarkdownFindSheetProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly mode: DocumentMode
  /** The document can be changed now (App's rule: writable, not protected, kind and document editable). */
  readonly canEdit: boolean
  /** The source text (what edit mode searches and replace writes). */
  readonly text: string
  readonly getEditor: () => MarkdownMobileEditorHandle | null
  /** [편집]: view → edit, as the app bar's button does. */
  readonly onEnterEdit: () => void
  readonly notify: (toast: ToastRequest) => void
  readonly ignoreCase?: boolean
}

/** A move to the current match still to be shown (selected or scrolled to). */
interface PendingReveal {
  /** Edit mode: put the focus in the text, so the selection is drawn. */
  readonly focus: boolean
  /** Shown only once the text is this (after a replace); null: the text as it is. */
  readonly text: string | null
}

/**
 * Find and replace for the Markdown and plain-text editor (spec 4.2). Non-modal: the
 * document stays usable and the sheet rides above the keyboard (Sheet does that).
 * Edit mode finds in the source and selects; view mode finds in the rendered text and
 * paints with the CSS Custom Highlight API. Replace is offered only in edit mode of an
 * editable document; in view mode a button enters edit mode first.
 */
export function MarkdownFindSheet({
  open,
  onClose,
  mode,
  canEdit,
  text,
  getEditor,
  onEnterEdit,
  notify,
  ignoreCase = FIND_IGNORE_CASE,
}: MarkdownFindSheetProps) {
  const { t } = useMobileLocale()
  const [draft, setDraft] = useState('')
  /** The query searched; it lags `draft` while a Hangul syllable is being composed. */
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [current, setCurrent] = useState(0)
  /** Bumped by every move that should show the current match. */
  const [revealSeq, setRevealSeq] = useState(0)
  const pendingRef = useRef<PendingReveal | null>(null)
  const composingRef = useRef(false)
  const queryInputRef = useRef<HTMLInputElement | null>(null)
  const replacementInputRef = useRef<HTMLInputElement | null>(null)
  const focusReplacementRef = useRef(false)

  const canReplace = mode === 'edit' && canEdit

  const requestReveal = useCallback((reveal: PendingReveal) => {
    pendingRef.current = reveal
    setRevealSeq((n) => n + 1)
  }, [])

  // ---- matches ----

  const sourceMatches = useMemo(
    () => (open && mode === 'edit' ? findInSource(text, query, ignoreCase) : []),
    [open, mode, text, query, ignoreCase],
  )

  /** View mode: matches on the rendered preview, read after it is in the DOM. */
  const [view, setView] = useState<{ readonly query: string; readonly ranges: Range[] } | null>(
    null,
  )
  useLayoutEffect(() => {
    if (!open || mode !== 'view') {
      setView(null)
      return
    }
    const root = getEditor()?.getPreviewElement() ?? null
    setView({ query, ranges: root ? findInRenderedText(root, query, ignoreCase) : [] })
  }, [open, mode, query, text, ignoreCase, getEditor])

  const total = mode === 'edit' ? sourceMatches.length : (view?.ranges.length ?? 0)
  const shown = total === 0 ? -1 : Math.min(Math.max(current, 0), total - 1)

  // ---- showing the current match ----

  const previewWindow = useCallback(
    () => getEditor()?.getPreviewElement()?.ownerDocument.defaultView ?? window,
    [getEditor],
  )

  // the highlights belong to view mode and to the open sheet only
  useEffect(() => {
    if (!open || mode !== 'view') return
    const win = previewWindow()
    return () => clearFindHighlights(win)
  }, [open, mode, previewWindow])

  useEffect(() => {
    if (!open || mode !== 'view' || !view) return
    paintFindHighlights(previewWindow(), view.ranges, shown)
  }, [open, mode, view, shown, previewWindow])

  useEffect(() => {
    const pending = pendingRef.current
    if (!open || !pending) return
    if (pending.text !== null && pending.text !== text) return
    if (mode === 'edit') {
      pendingRef.current = null
      const match = sourceMatches[shown]
      if (match) getEditor()?.selectRange(match.start, match.end, { focus: pending.focus })
      return
    }
    // view mode: wait for the matches of this query
    if (!view || view.query !== query) return
    pendingRef.current = null
    const range = view.ranges[shown]
    const root = getEditor()?.getPreviewElement()
    if (!range || !root) return
    const block = blockOf(range.startContainer, root)
    if (block && typeof block.scrollIntoView === 'function') {
      block.scrollIntoView({ block: 'center' })
    }
  }, [open, mode, text, query, sourceMatches, view, shown, revealSeq, getEditor])

  // Entering edit mode (from the sheet's button or the app bar) shows the query's
  // first match in the source.
  const lastModeRef = useRef(mode)
  useEffect(() => {
    if (lastModeRef.current === mode) return
    lastModeRef.current = mode
    if (!open) return
    setCurrent(0)
    requestReveal({ focus: false, text: null })
    if (mode === 'edit' && focusReplacementRef.current) {
      focusReplacementRef.current = false
      replacementInputRef.current?.focus()
    }
  }, [mode, open, requestReveal])

  useEffect(() => {
    if (open) queryInputRef.current?.focus()
  }, [open])

  // ---- input ----

  const commitQuery = (next: string) => {
    setQuery(next)
    // a changed query starts at its first match
    setCurrent(0)
    requestReveal({ focus: false, text: null })
  }

  const step = (delta: 1 | -1) => {
    if (total === 0) return
    setCurrent(stepMatch(shown, total, delta))
    requestReveal({ focus: mode === 'edit', text: null })
  }

  const onQueryKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || composingRef.current || e.nativeEvent.isComposing) return
    e.preventDefault()
    step(e.shiftKey ? -1 : 1)
  }

  // ---- replace ----

  /** Writes `next` unless it would break a hidden span; true when written. */
  const writeReplaced = (next: string): boolean => {
    if (!replaceKeepsHiddenSpans(text, next)) {
      notify({ message: t('webFindReplaceBlocked'), tone: 'error' })
      return false
    }
    getEditor()?.setMarkdown(next)
    return true
  }

  const replaceCurrent = () => {
    if (!canReplace) return
    const match = sourceMatches[shown]
    if (!match) return
    const next = replaceMatches(text, [match], replacement)
    if (!writeReplaced(next)) return
    // on to the next match after the replaced text
    const after = findInSource(next, query, ignoreCase)
    setCurrent(Math.max(0, matchIndexFrom(after, match.start + replacement.length)))
    requestReveal({ focus: true, text: next })
  }

  const replaceAll = () => {
    if (!canReplace || sourceMatches.length === 0) return
    const next = replaceMatches(text, sourceMatches, replacement)
    // one write, so one undo step brings the whole text back
    if (!writeReplaced(next)) return
    notify({ message: t('webFindReplacedCount', { count: String(sourceMatches.length) }) })
    setCurrent(0)
  }

  const countText =
    query.length === 0 ? '' : total === 0 ? t('webFindNoMatch') : `${shown + 1}/${total}`

  return (
    <Sheet
      open={open}
      title={t('webFindReplace')}
      closeLabel={t('webFindClose')}
      onClose={onClose}
      modal={false}
      testId="web-find-sheet"
    >
      <div className="web-find-sheet">
        <div className="web-find-row">
          <input
            ref={queryInputRef}
            className="mobile-input web-find-input"
            type="search"
            enterKeyHint="search"
            value={draft}
            placeholder={t('webFindQuery')}
            aria-label={t('webFindQuery')}
            data-testid="web-find-query"
            onChange={(e) => {
              setDraft(e.target.value)
              // during composition the syllable is not final: search once it ends
              if (!composingRef.current) commitQuery(e.target.value)
            }}
            onCompositionStart={() => {
              composingRef.current = true
            }}
            onCompositionEnd={(e) => {
              composingRef.current = false
              setDraft(e.currentTarget.value)
              commitQuery(e.currentTarget.value)
            }}
            onKeyDown={onQueryKeyDown}
          />
          <span className="web-find-count" aria-live="polite" data-testid="web-find-count">
            {countText}
          </span>
          <button
            type="button"
            className="mobile-icon-btn"
            aria-label={t('webFindPrev')}
            title={t('webFindPrev')}
            disabled={total === 0}
            data-testid="web-find-prev"
            onClick={() => step(-1)}
          >
            <IconWebFindPrev size={20} />
          </button>
          <button
            type="button"
            className="mobile-icon-btn"
            aria-label={t('webFindNext')}
            title={t('webFindNext')}
            disabled={total === 0}
            data-testid="web-find-next"
            onClick={() => step(1)}
          >
            <IconWebFindNext size={20} />
          </button>
        </div>
        {canReplace ? (
          <div className="web-find-row">
            <input
              ref={replacementInputRef}
              className="mobile-input web-find-input"
              type="text"
              value={replacement}
              placeholder={t('webFindReplacement')}
              aria-label={t('webFindReplacement')}
              data-testid="web-find-replacement"
              onChange={(e) => setReplacement(e.target.value)}
            />
            <button
              type="button"
              className="mobile-pill-btn mobile-btn-ghost"
              disabled={shown < 0}
              data-testid="web-find-replace-one"
              onClick={replaceCurrent}
            >
              {t('webFindReplaceOne')}
            </button>
            <button
              type="button"
              className="mobile-pill-btn mobile-btn-primary"
              disabled={total === 0}
              data-testid="web-find-replace-all"
              onClick={replaceAll}
            >
              {t('webFindReplaceAll')}
            </button>
          </div>
        ) : mode === 'view' && canEdit ? (
          <div className="web-find-row web-find-row-end">
            <button
              type="button"
              className="mobile-pill-btn mobile-btn-ghost"
              data-testid="web-find-edit-to-replace"
              onClick={() => {
                focusReplacementRef.current = true
                onEnterEdit()
              }}
            >
              {t('webFindEditToReplace')}
            </button>
          </div>
        ) : null}
      </div>
    </Sheet>
  )
}
