import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type ChangeEvent,
} from 'react'
import { Markdown } from '@genoffice/ui'
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import {
  inlineImageToMarkdown,
  MAX_MOBILE_INLINE_IMAGE_BYTES,
} from '@genoffice/mobile-bridge/markdown'

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
  readonly setMarkdown: (next: string) => void
}

export interface MarkdownMobileEditorProps {
  readonly value: string
  readonly mode: DocumentMode
  readonly isPlainText?: boolean
  readonly onChange: (next: string) => void
  readonly onErrorNotice?: (messageKey: 'imageTooLargeError' | 'imageUnsupportedTypeError') => void
  readonly maxInlineImageBytes?: number
  readonly zoomScale?: number
}

const HISTORY_LIMIT = 50

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
  },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const undoStackRef = useRef<string[]>([])
  const redoStackRef = useRef<string[]>([])
  const valueRef = useRef(value)
  valueRef.current = value

  const commitValue = useCallback(
    (next: string) => {
      if (next === valueRef.current) return
      undoStackRef.current = [...undoStackRef.current.slice(-(HISTORY_LIMIT - 1)), valueRef.current]
      redoStackRef.current = []
      valueRef.current = next
      onChange(next)
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
  const onCompositionEnd = useCallback(() => {
    composingRef.current = false
    setTimeout(() => {
      const queued = pendingActionsRef.current.splice(0)
      for (const action of queued) applyAction(action)
    }, 0)
  }, [applyAction])

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
    }),
    [applyAction, commitValue],
  )

  useEffect(() => {
    if (mode === 'edit') {
      textareaRef.current?.focus()
    }
  }, [mode])

  const contentStyle = useMemo(
    () => ({
      transform: zoomScale === 1 ? undefined : `scale(${zoomScale})`,
      transformOrigin: 'top left',
    }),
    [zoomScale],
  )

  return (
    <div className="mobile-md-viewport" data-editor="markdown" data-mode={mode}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="mobile-sr-only"
        onChange={handleImagePicked}
        aria-label="Insert image"
      />
      {mode === 'view' ? (
        <article className="mobile-markdown-preview" style={contentStyle}>
          {isPlainText ? (
            <pre className="mobile-plain-text-view">{value}</pre>
          ) : (
            <Markdown text={value} />
          )}
        </article>
      ) : (
        <textarea
          ref={textareaRef}
          className="mobile-markdown-textarea"
          value={value}
          onChange={(e) => commitValue(e.target.value)}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          spellCheck={false}
          placeholder="# "
          aria-label="Markdown document editor"
        />
      )}
    </div>
  )
})
