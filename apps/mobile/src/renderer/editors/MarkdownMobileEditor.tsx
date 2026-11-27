import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type ChangeEvent,
  type CompositionEvent,
} from 'react'
import { Markdown } from '@genoffice/ui'
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import {
  inlineImageToMarkdown,
  MAX_MOBILE_INLINE_IMAGE_BYTES,
  revealHiddenSpans,
} from '@genoffice/mobile-bridge/markdown'
import { attachPinchZoom } from './pinchZoom'

export type MarkdownQuickAction =
  | 'undo'
  | 'redo'
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'heading'
  | 'heading2'
  | 'heading3'
  | 'list'
  | 'numberedList'
  | 'taskList'
  | 'quote'
  | 'codeBlock'
  | 'link'
  | 'insertImage'

/** A line's block marker: heading, task, bullet, number, or quote. */
const BLOCK_MARKER = /^(#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+\. |> )/

export interface MarkdownMobileEditorHandle {
  readonly runAction: (action: MarkdownQuickAction) => void
  readonly getMarkdown: () => string
  /** Replaces the whole text as one undo step (also how find's replace and replace-all write). */
  readonly setMarkdown: (next: string) => void
  /**
   * Edit mode: selects `[start, end)` of the source and scrolls it into view. `focus`
   * moves the focus into the text (a selection in an unfocused field is not drawn on phones).
   */
  readonly selectRange: (start: number, end: number, options?: { focus?: boolean }) => void
  /** View mode: the rendered preview, for find; null in edit mode. */
  readonly getPreviewElement: () => HTMLElement | null
  /** Edit mode: the textarea's selection; null in view mode. */
  readonly getSelection: () => { readonly start: number; readonly end: number } | null
}

/** CSS properties that decide where text wraps inside the textarea. */
const MIRROR_PROPS = [
  'box-sizing',
  'width',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-style',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'line-height',
  'text-transform',
  'word-spacing',
  'tab-size',
  'text-indent',
] as const

/** The top of the line holding `offset` in the textarea's content, measured on a hidden copy. */
function textOffsetTop(el: HTMLTextAreaElement, offset: number): number {
  const doc = el.ownerDocument
  const style = doc.defaultView?.getComputedStyle(el)
  if (!style) return 0
  const mirror = doc.createElement('div')
  for (const prop of MIRROR_PROPS) mirror.style.setProperty(prop, style.getPropertyValue(prop))
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.top = '0'
  mirror.style.left = '-99999px'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'
  mirror.textContent = el.value.slice(0, offset)
  const marker = doc.createElement('span')
  marker.textContent = el.value.slice(offset, offset + 1) || '.'
  mirror.appendChild(marker)
  doc.body.appendChild(mirror)
  const top = marker.offsetTop
  mirror.remove()
  return top
}

export interface MarkdownMobileEditorProps {
  readonly value: string
  readonly mode: DocumentMode
  readonly isPlainText?: boolean
  readonly onChange: (next: string) => void
  readonly onErrorNotice?: (messageKey: 'imageTooLargeError' | 'imageUnsupportedTypeError') => void
  readonly maxInlineImageBytes?: number
  readonly zoomScale?: number
  readonly onZoomChange?: (next: number) => void
  /** Edit mode: the selection of the source moved (caret moves, selecting, typing). */
  readonly onSelectionChange?: (start: number, end: number) => void
  /** Localized accessible name for the edit textarea. */
  readonly editorLabel?: string
}

const HISTORY_LIMIT = 50
const MD_ZOOM_MIN = 0.8
const MD_ZOOM_MAX = 2.4

export const MarkdownMobileEditor = forwardRef<
  MarkdownMobileEditorHandle,
  MarkdownMobileEditorProps
>(function MarkdownMobileEditor(
  {
    value,
    mode,
    isPlainText = false,
    onChange,
    onErrorNotice,
    maxInlineImageBytes = MAX_MOBILE_INLINE_IMAGE_BYTES,
    zoomScale = 1,
    onZoomChange,
    onSelectionChange,
    editorLabel = 'Markdown document editor',
  },
  ref,
) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const previewRef = useRef<HTMLElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const undoStackRef = useRef<string[]>([])
  const redoStackRef = useRef<string[]>([])
  const valueRef = useRef(value)
  valueRef.current = value
  const zoomScaleRef = useRef(zoomScale)
  zoomScaleRef.current = zoomScale
  const onZoomChangeRef = useRef(onZoomChange)
  onZoomChangeRef.current = onZoomChange

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    return attachPinchZoom(el, {
      getScale: () => zoomScaleRef.current,
      min: MD_ZOOM_MIN,
      max: MD_ZOOM_MAX,
      onPreview: (next) => {
        zoomScaleRef.current = next
        onZoomChangeRef.current?.(next)
      },
      onCommit: (next) => {
        zoomScaleRef.current = next
        onZoomChangeRef.current?.(next)
      },
    })
  }, [])

  // Reports the textarea's selection: whether the hide-from-AI entry offers hide or unhide depends on it.
  const onSelectionChangeRef = useRef(onSelectionChange)
  onSelectionChangeRef.current = onSelectionChange

  const commitValue = useCallback(
    (next: string) => {
      if (next === valueRef.current) return
      undoStackRef.current = [...undoStackRef.current.slice(-(HISTORY_LIMIT - 1)), valueRef.current]
      redoStackRef.current = []
      valueRef.current = next
      onChange(next)
      const el = textareaRef.current
      if (el && !composingRef.current) {
        onSelectionChangeRef.current?.(
          el.selectionStart ?? next.length,
          el.selectionEnd ?? next.length,
        )
      }
    },
    [onChange],
  )

  const wrapSelection = useCallback(
    (before: string, after: string, placeholder: string) => {
      const el = textareaRef.current
      const cur = valueRef.current
      if (!el) {
        commitValue(`${cur}${before}${placeholder}${after}`)
        return
      }
      const start = el.selectionStart ?? cur.length
      const end = el.selectionEnd ?? cur.length
      const selected = cur.slice(start, end) || placeholder
      const next = `${cur.slice(0, start)}${before}${selected}${after}${cur.slice(end)}`
      commitValue(next)
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(start + before.length, start + before.length + selected.length)
      })
    },
    [commitValue],
  )

  /** Sets the current line's block marker, replacing any other marker; the same marker toggles off. */
  const setLinePrefix = useCallback(
    (prefix: string) => {
      const el = textareaRef.current
      const cur = valueRef.current
      const pos = el?.selectionStart ?? 0
      const lineStart = cur.lastIndexOf('\n', Math.max(0, pos - 1)) + 1
      const line = cur.slice(lineStart)
      const existing = BLOCK_MARKER.exec(line)?.[0] ?? ''
      const nextPrefix = existing === prefix ? '' : prefix
      const next = `${cur.slice(0, lineStart)}${nextPrefix}${cur.slice(lineStart + existing.length)}`
      commitValue(next)
      if (el) {
        const caret = Math.max(lineStart, pos + nextPrefix.length - existing.length)
        requestAnimationFrame(() => {
          el.focus()
          el.setSelectionRange(caret, caret)
        })
      }
    },
    [commitValue],
  )

  const handleImagePicked = useCallback(
    async (ev: ChangeEvent<HTMLInputElement>) => {
      const file = ev.target.files?.[0]
      ev.target.value = ''
      if (!file) return
      try {
        const buffer = await file.arrayBuffer()
        const snippet = inlineImageToMarkdown({
          bytes: new Uint8Array(buffer),
          mime: file.type,
          alt: file.name.replace(/\.[^.]+$/, ''),
          maxBytes: maxInlineImageBytes,
        })
        const cur = valueRef.current
        const sep = cur.endsWith('\n') || cur.length === 0 ? '' : '\n\n'
        commitValue(`${cur}${sep}${snippet}\n`)
      } catch (err) {
        const code = (err as { code?: string })?.code
        if (code === 'FILE_TOO_LARGE') {
          onErrorNotice?.('imageTooLargeError')
        } else {
          onErrorNotice?.('imageUnsupportedTypeError')
        }
      }
    },
    [commitValue, maxInlineImageBytes, onErrorNotice],
  )

  const applyAction = useCallback(
    (action: MarkdownQuickAction) => {
      switch (action) {
        case 'undo': {
          const prev = undoStackRef.current.pop()
          if (prev !== undefined) {
            redoStackRef.current.push(valueRef.current)
            valueRef.current = prev
            onChange(prev)
          }
          break
        }
        case 'redo': {
          const next = redoStackRef.current.pop()
          if (next !== undefined) {
            undoStackRef.current.push(valueRef.current)
            valueRef.current = next
            onChange(next)
          }
          break
        }
        case 'bold':
          wrapSelection('**', '**', 'bold')
          break
        case 'italic':
          wrapSelection('*', '*', 'italic')
          break
        case 'strikethrough':
          wrapSelection('~~', '~~', 'text')
          break
        case 'heading':
          setLinePrefix('# ')
          break
        case 'heading2':
          setLinePrefix('## ')
          break
        case 'heading3':
          setLinePrefix('### ')
          break
        case 'list':
          setLinePrefix('- ')
          break
        case 'numberedList':
          setLinePrefix('1. ')
          break
        case 'taskList':
          setLinePrefix('- [ ] ')
          break
        case 'quote':
          setLinePrefix('> ')
          break
        case 'codeBlock':
          wrapSelection('```\n', '\n```', 'code')
          break
        case 'link':
          wrapSelection('[', '](https://)', 'link')
          break
        case 'insertImage':
          fileInputRef.current?.click()
          break
      }
    },
    [onChange, setLinePrefix, wrapSelection],
  )

  // Formatting during Hangul (IME) composition would break the syllable being
  // typed; hold commands until the composition ends.
  const composingRef = useRef(false)
  const pendingActionsRef = useRef<MarkdownQuickAction[]>([])
  const onCompositionStart = useCallback(() => {
    composingRef.current = true
  }, [])
  const onCompositionEnd = useCallback(
    (e: CompositionEvent<HTMLTextAreaElement>) => {
      composingRef.current = false
      const el = e.currentTarget
      commitValue(el.value)
      if (el.value === valueRef.current) {
        onSelectionChangeRef.current?.(el.selectionStart ?? 0, el.selectionEnd ?? 0)
      }
      setTimeout(() => {
        const queued = pendingActionsRef.current.splice(0)
        for (const action of queued) applyAction(action)
      }, 0)
    },
    [applyAction, commitValue],
  )

  useImperativeHandle(
    ref,
    () => ({
      runAction(action) {
        if (composingRef.current) {
          pendingActionsRef.current.push(action)
          return
        }
        applyAction(action)
      },
      getMarkdown: () => valueRef.current,
      setMarkdown: (next) => commitValue(next),
      selectRange(start, end, options) {
        const el = textareaRef.current
        if (!el) return
        if (options?.focus) el.focus({ preventScroll: true })
        el.setSelectionRange(start, end)
        // a third of the way down, so the match is not hidden under the find sheet
        el.scrollTop = Math.max(0, textOffsetTop(el, start) - el.clientHeight / 3)
      },
      getPreviewElement: () => previewRef.current,
      getSelection() {
        const el = textareaRef.current
        if (!el) return null
        return { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 }
      },
    }),
    [applyAction, commitValue],
  )

  useEffect(() => {
    if (mode === 'edit') {
      textareaRef.current?.focus()
    }
  }, [mode])

  const hasSelectionListener = Boolean(onSelectionChange)
  useEffect(() => {
    const el = textareaRef.current
    if (mode !== 'edit' || !el || !hasSelectionListener) return
    const doc = el.ownerDocument
    const report = () => {
      // Skip reporting while IME composition is active or before React has committed the
      // current textarea value; triggering a parent re-render mid-input resets el.value.
      if (composingRef.current || el.value !== valueRef.current) return
      onSelectionChangeRef.current?.(el.selectionStart ?? 0, el.selectionEnd ?? 0)
    }
    const onDocSelection = () => {
      if (doc.activeElement === el) report()
    }
    const events = ['select', 'keyup', 'pointerup', 'focus'] as const
    for (const name of events) el.addEventListener(name, report)
    doc.addEventListener('selectionchange', onDocSelection)
    report()
    return () => {
      for (const name of events) el.removeEventListener(name, report)
      doc.removeEventListener('selectionchange', onDocSelection)
    }
  }, [mode, hasSelectionListener])

  // The preview shows hidden words as plain text; the source keeps the span markup.
  const previewText = useMemo(
    () => (mode === 'view' ? revealHiddenSpans(value) : value),
    [mode, value],
  )

  const contentStyle = useMemo(
    () => ({
      fontSize: zoomScale === 1 ? undefined : `calc(var(--m-text-body) * ${zoomScale})`,
    }),
    [zoomScale],
  )

  return (
    <div
      ref={viewportRef}
      className="mobile-md-viewport"
      data-editor="markdown"
      data-mode={mode}
      data-zoom={String(zoomScale)}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="mobile-sr-only"
        onChange={handleImagePicked}
        aria-label="Insert image"
      />
      {mode === 'view' ? (
        <article ref={previewRef} className="mobile-markdown-preview" style={contentStyle}>
          {isPlainText ? (
            <pre className="mobile-plain-text-view" style={contentStyle}>
              {previewText}
            </pre>
          ) : (
            <Markdown text={previewText} />
          )}
        </article>
      ) : (
        <textarea
          ref={textareaRef}
          className="mobile-markdown-textarea"
          style={contentStyle}
          value={value}
          onChange={(e) => commitValue(e.target.value)}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          spellCheck={false}
          placeholder="# "
          aria-label={editorLabel}
        />
      )}
    </div>
  )
})
