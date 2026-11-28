import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MarkdownMobileEditor,
  type MarkdownMobileEditorHandle,
} from '../src/renderer/editors/MarkdownMobileEditor'

const containers: HTMLElement[] = []
afterEach(() => {
  vi.useRealTimers()
  while (containers.length > 0) containers.pop()?.remove()
})

function mount(initial: string) {
  let value = initial
  const ref = createRef<MarkdownMobileEditorHandle>()
  const el = document.createElement('div')
  document.body.appendChild(el)
  containers.push(el)
  const root = createRoot(el)
  const renderNow = () =>
    act(() =>
      root.render(
        <MarkdownMobileEditor
          ref={ref}
          value={value}
          mode="edit"
          onChange={(next) => {
            value = next
            renderNow()
          }}
        />,
      ),
    )
  renderNow()
  const textarea = el.querySelector('textarea') as HTMLTextAreaElement
  return {
    ref,
    textarea,
    get value() {
      return value
    },
  }
}

describe('markdown format actions', () => {
  it('replaces a line marker instead of stacking, and the same marker toggles off', () => {
    const ed = mount('first\nsecond line')
    ed.textarea.setSelectionRange(8, 8)
    act(() => ed.ref.current?.runAction('heading'))
    expect(ed.value).toBe('first\n# second line')
    ed.textarea.setSelectionRange(10, 10)
    act(() => ed.ref.current?.runAction('heading2'))
    expect(ed.value).toBe('first\n## second line')
    ed.textarea.setSelectionRange(10, 10)
    act(() => ed.ref.current?.runAction('taskList'))
    expect(ed.value).toBe('first\n- [ ] second line')
    ed.textarea.setSelectionRange(12, 12)
    act(() => ed.ref.current?.runAction('taskList'))
    expect(ed.value).toBe('first\nsecond line')
  })

  it('holds a format command while Hangul is being composed', () => {
    vi.useFakeTimers()
    const ed = mount('가나')
    ed.textarea.setSelectionRange(0, 2)
    act(() => {
      ed.textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    })
    act(() => ed.ref.current?.runAction('bold'))
    expect(ed.value).toBe('가나')
    act(() => {
      ed.textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    })
    act(() => vi.runAllTimers())
    expect(ed.value).toBe('**가나**')
  })

  it('keeps typed characters when selectionchange fires before React onChange or during IME', () => {
    let value = ''
    let selection = { start: 0, end: 0 }
    const el = document.createElement('div')
    document.body.appendChild(el)
    containers.push(el)
    const root = createRoot(el)
    const renderNow = () =>
      act(() =>
        root.render(
          <MarkdownMobileEditor
            value={value}
            mode="edit"
            editorLabel="마크다운 문서 편집기"
            onChange={(next) => {
              value = next
              renderNow()
            }}
            onSelectionChange={(start, end) => {
              // Simulate a parent state update re-rendering the controlled textarea.
              selection = { start, end }
              renderNow()
            }}
          />,
        ),
      )
    renderNow()
    const textarea = el.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.getAttribute('data-testid')).toBe('markdown-editor-textarea')
    expect(textarea.getAttribute('aria-label')).toBe('마크다운 문서 편집기')

    // Simulate Android WebView / Gboard IME updating DOM value and firing selectionchange
    // + native input before React's root-level onChange commits the new value.
    act(() => {
      textarea.focus()
      textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, 'markdownq')
      textarea.setSelectionRange(9, 9)
      document.dispatchEvent(new Event('selectionchange'))
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      textarea.dispatchEvent(
        new CompositionEvent('compositionend', { bubbles: true, data: 'markdownq' }),
      )
    })

    expect(value).toBe('markdownq')
    expect(textarea.value).toBe('markdownq')
    expect(selection).toEqual({ start: 9, end: 9 })
  })
})
