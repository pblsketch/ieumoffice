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
})
