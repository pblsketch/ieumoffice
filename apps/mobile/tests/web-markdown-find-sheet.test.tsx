import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import type { ToastRequest } from '../src/renderer/components/Toast'
import {
  MarkdownMobileEditor,
  type MarkdownMobileEditorHandle,
} from '../src/renderer/editors/MarkdownMobileEditor'
import { MarkdownFindSheet } from '../src/renderer/editors/markdownFindSheet'
import { FIND_HIGHLIGHT, FIND_HIGHLIGHT_CURRENT } from '../src/renderer/editors/markdownFind'
import { translateMobile } from '../src/renderer/i18n'

const SPAN = '<span class="redact-span" data-redaction="" data-label="가림1">비밀 번호</span>'
const en = (key: Parameters<typeof translateMobile>[1], params?: Record<string, string>) =>
  translateMobile('en', key, params)

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
  vi.restoreAllMocks()
})

interface Harness {
  readonly el: HTMLElement
  readonly ref: React.RefObject<MarkdownMobileEditorHandle | null>
  readonly notices: ToastRequest[]
  readonly onEnterEdit: ReturnType<typeof vi.fn>
  readonly value: string
  readonly mode: DocumentMode
  q(testId: string): HTMLElement | null
  textarea(): HTMLTextAreaElement | null
}

function mount(options: { text: string; mode: DocumentMode; canEdit: boolean }): Harness {
  let value = options.text
  let mode = options.mode
  const ref = createRef<MarkdownMobileEditorHandle>()
  const notices: ToastRequest[] = []
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root: Root = createRoot(el)
  const onEnterEdit = vi.fn(() => {
    mode = 'edit'
    renderNow()
  })
  function renderNow() {
    act(() =>
      root.render(
        <>
          <MarkdownMobileEditor
            ref={ref}
            value={value}
            mode={mode}
            onChange={(next) => {
              value = next
              renderNow()
            }}
          />
          <MarkdownFindSheet
            open
            onClose={() => {}}
            mode={mode}
            canEdit={options.canEdit}
            text={value}
            getEditor={() => ref.current}
            onEnterEdit={onEnterEdit}
            notify={(toast) => notices.push(toast)}
          />
        </>,
      ),
    )
  }
  renderNow()
  cleanups.push(() => {
    act(() => root.unmount())
    el.remove()
  })
  return {
    el,
    ref,
    notices,
    onEnterEdit,
    get value() {
      return value
    },
    get mode() {
      return mode
    },
    q: (testId) => el.querySelector<HTMLElement>(`[data-testid="${testId}"]`),
    textarea: () => el.querySelector<HTMLTextAreaElement>('[data-editor="markdown"] textarea'),
  }
}

const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!

function typeInto(input: HTMLElement | null, value: string) {
  expect(input).not.toBeNull()
  act(() => {
    inputSetter.call(input, value)
    input!.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function click(el: HTMLElement | null) {
  expect(el).not.toBeNull()
  act(() => el!.click())
}

function selection(h: Harness): string {
  const ta = h.textarea()!
  return `${ta.selectionStart}-${ta.selectionEnd}`
}

describe('find in edit mode selects the match in the source', () => {
  it('typing a query goes to the first match, case-insensitively, and shows the position', () => {
    const h = mount({ text: 'Plan plan PLAN', mode: 'edit', canEdit: true })
    typeInto(h.q('web-find-query'), 'plan')
    expect(h.q('web-find-count')?.textContent).toBe('1/3')
    expect(selection(h)).toBe('0-4')
  })

  it('next and previous wrap around at the ends', () => {
    const h = mount({ text: 'ab ab ab', mode: 'edit', canEdit: true })
    typeInto(h.q('web-find-query'), 'ab')
    click(h.q('web-find-next'))
    click(h.q('web-find-next'))
    expect(h.q('web-find-count')?.textContent).toBe('3/3')
    expect(selection(h)).toBe('6-8')
    click(h.q('web-find-next'))
    expect(h.q('web-find-count')?.textContent).toBe('1/3')
    click(h.q('web-find-prev'))
    expect(h.q('web-find-count')?.textContent).toBe('3/3')
  })

  it('changing the query jumps back to the first match', () => {
    const h = mount({ text: 'x1 x2 x1', mode: 'edit', canEdit: true })
    typeInto(h.q('web-find-query'), 'x')
    click(h.q('web-find-next'))
    click(h.q('web-find-next'))
    typeInto(h.q('web-find-query'), 'x1')
    expect(h.q('web-find-count')?.textContent).toBe('1/2')
    expect(selection(h)).toBe('0-2')
  })

  it('says so when nothing matches', () => {
    const h = mount({ text: 'abc', mode: 'edit', canEdit: true })
    typeInto(h.q('web-find-query'), 'zzz')
    expect(h.q('web-find-count')?.textContent).toBe(en('webFindNoMatch'))
  })

  it('does not search during Hangul composition, only after it ends', () => {
    const h = mount({ text: '회의 회의', mode: 'edit', canEdit: true })
    const input = h.q('web-find-query')!
    h.textarea()!.setSelectionRange(1, 1)
    act(() => {
      input.dispatchEvent(new Event('compositionstart', { bubbles: true }))
    })
    typeInto(input, '회')
    expect(h.q('web-find-count')?.textContent).toBe('')
    expect(selection(h)).toBe('1-1')
    typeInto(input, '회의')
    expect(h.q('web-find-count')?.textContent).toBe('')
    act(() => {
      input.dispatchEvent(new Event('compositionend', { bubbles: true }))
    })
    expect(h.q('web-find-count')?.textContent).toBe('1/2')
    expect(selection(h)).toBe('0-2')
  })
})

describe('replace (edit mode, editable document)', () => {
  it('replaces the current match and moves on to the next', () => {
    const h = mount({ text: 'cat cat cat', mode: 'edit', canEdit: true })
    typeInto(h.q('web-find-query'), 'cat')
    typeInto(h.q('web-find-replacement'), 'dog')
    click(h.q('web-find-replace-one'))
    expect(h.value).toBe('dog cat cat')
    expect(h.q('web-find-count')?.textContent).toBe('1/2')
    expect(selection(h)).toBe('4-7')
  })

  it('replace all is one undo step and says how many were replaced', () => {
    const original = 'Cat cat\n\ncAT dog'
    const h = mount({ text: original, mode: 'edit', canEdit: true })
    typeInto(h.q('web-find-query'), 'cat')
    typeInto(h.q('web-find-replacement'), 'fox')
    click(h.q('web-find-replace-all'))
    expect(h.value).toBe('fox fox\n\nfox dog')
    expect(h.notices.at(-1)).toEqual({ message: en('webFindReplacedCount', { count: '3' }) })
    act(() => h.ref.current?.runAction('undo'))
    expect(h.value).toBe(original)
  })

  it('refuses a replace that would break a hidden span and leaves the text as it was', () => {
    const original = `회의 ${SPAN}`
    const h = mount({ text: original, mode: 'edit', canEdit: true })
    typeInto(h.q('web-find-query'), '비밀')
    typeInto(h.q('web-find-replacement'), '</span>')
    click(h.q('web-find-replace-one'))
    expect(h.value).toBe(original)
    expect(h.notices.at(-1)).toEqual({ message: en('webFindReplaceBlocked'), tone: 'error' })
    click(h.q('web-find-replace-all'))
    expect(h.value).toBe(original)
    // nothing was pushed on the undo stack
    act(() => h.ref.current?.runAction('undo'))
    expect(h.value).toBe(original)
  })

  it('never finds the tag markup of a hidden span, so it is never replaced', () => {
    const h = mount({ text: `span ${SPAN}`, mode: 'edit', canEdit: true })
    typeInto(h.q('web-find-query'), 'span')
    expect(h.q('web-find-count')?.textContent).toBe('1/1')
    typeInto(h.q('web-find-replacement'), 'X')
    click(h.q('web-find-replace-all'))
    expect(h.value).toBe(`X ${SPAN}`)
  })
})

describe('a read-only document has no replace controls', () => {
  it('in view mode', () => {
    const h = mount({ text: 'abc', mode: 'view', canEdit: false })
    expect(h.q('web-find-query')).not.toBeNull()
    expect(h.q('web-find-replacement')).toBeNull()
    expect(h.q('web-find-replace-one')).toBeNull()
    expect(h.q('web-find-replace-all')).toBeNull()
    expect(h.q('web-find-edit-to-replace')).toBeNull()
  })

  it('in edit mode', () => {
    const h = mount({ text: 'abc', mode: 'edit', canEdit: false })
    expect(h.q('web-find-replacement')).toBeNull()
    expect(h.q('web-find-replace-one')).toBeNull()
    expect(h.q('web-find-replace-all')).toBeNull()
  })
})

describe('view mode', () => {
  function stubHighlights() {
    class FakeHighlight {
      readonly ranges: Range[]
      constructor(...ranges: Range[]) {
        this.ranges = ranges
      }
    }
    const registry = new Map<string, FakeHighlight>()
    const w = window as unknown as Record<string, unknown>
    const hadCss = 'CSS' in w
    const prevCss = w.CSS
    w.CSS = { ...(prevCss as object), highlights: registry }
    w.Highlight = FakeHighlight
    cleanups.push(() => {
      if (hadCss) w.CSS = prevCss
      else delete w.CSS
      delete w.Highlight
    })
    return registry
  }

  it('paints the matches of the rendered text with the Custom Highlight API, DOM unchanged', () => {
    const registry = stubHighlights()
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    cleanups.push(() => {
      delete (Element.prototype as Partial<Element>).scrollIntoView
    })
    const h = mount({ text: '# Note\n\na **no**te and NOTE', mode: 'view', canEdit: true })
    const preview = h.el.querySelector('.mobile-markdown-preview')!
    const before = preview.innerHTML
    typeInto(h.q('web-find-query'), 'note')
    expect(h.q('web-find-count')?.textContent).toBe('1/3')
    const all = registry.get(FIND_HIGHLIGHT)?.ranges ?? []
    const current = registry.get(FIND_HIGHLIGHT_CURRENT)?.ranges ?? []
    expect([...all, ...current].map((r) => r.toString()).sort()).toEqual(['NOTE', 'Note', 'note'])
    expect(current.map((r) => r.toString())).toEqual(['Note'])
    expect(preview.innerHTML).toBe(before)
    expect(scroll).toHaveBeenCalled()

    click(h.q('web-find-next'))
    expect(registry.get(FIND_HIGHLIGHT_CURRENT)?.ranges.map((r) => r.toString())).toEqual(['note'])
  })

  it('without the API still counts and scrolls to the block', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    cleanups.push(() => {
      delete (Element.prototype as Partial<Element>).scrollIntoView
    })
    const h = mount({ text: 'one\n\ntwo one', mode: 'view', canEdit: true })
    typeInto(h.q('web-find-query'), 'one')
    expect(h.q('web-find-count')?.textContent).toBe('1/2')
    click(h.q('web-find-next'))
    expect(scroll).toHaveBeenCalled()
    const target = scroll.mock.contexts.at(-1) as Element
    expect(target.textContent).toBe('two one')
  })

  it('clears its highlights when the sheet closes', () => {
    const registry = stubHighlights()
    const h = mount({ text: 'abc abc', mode: 'view', canEdit: true })
    typeInto(h.q('web-find-query'), 'abc')
    expect(registry.get(FIND_HIGHLIGHT)).toBeDefined()
    cleanups.pop()?.()
    expect(registry.has(FIND_HIGHLIGHT)).toBe(false)
    expect(registry.has(FIND_HIGHLIGHT_CURRENT)).toBe(false)
  })

  it('offers no replace fields; its replace toggle enters edit mode, then replace is there', () => {
    const h = mount({ text: 'cat cat', mode: 'view', canEdit: true })
    expect(h.q('web-find-replacement')).toBeNull()
    typeInto(h.q('web-find-query'), 'cat')
    click(h.q('web-find-edit-to-replace'))
    expect(h.onEnterEdit).toHaveBeenCalledTimes(1)
    expect(h.mode).toBe('edit')
    expect(h.q('web-find-replacement')).not.toBeNull()
    // the query carries over and now finds in the source
    expect(h.q('web-find-count')?.textContent).toBe('1/2')
    typeInto(h.q('web-find-replacement'), 'dog')
    click(h.q('web-find-replace-all'))
    expect(h.value).toBe('dog dog')
  })
})
