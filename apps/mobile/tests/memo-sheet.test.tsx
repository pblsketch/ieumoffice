import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoSheet, type MemoSheetProps } from '../src/renderer/components/MemoSheet'
import type { FlowMemo } from '../src/renderer/editors/flowEditing'
import { MobileLocaleProvider } from '../src/renderer/i18n'

const containers: HTMLElement[] = []
afterEach(() => {
  while (containers.length > 0) containers.pop()?.remove()
  window.localStorage.clear()
})

function render(props: Partial<MemoSheetProps>): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  containers.push(el)
  const all: MemoSheetProps = {
    open: true,
    onClose: vi.fn(),
    memos: [],
    canEdit: true,
    defaultAuthor: 'IeumOffice',
    onAdd: vi.fn(() => true),
    onReply: vi.fn(() => true),
    onEdit: vi.fn(() => true),
    onRemove: vi.fn(() => true),
    onReveal: vi.fn(),
    ...props,
  }
  act(() =>
    createRoot(el).render(
      <MobileLocaleProvider lang="ko">
        <MemoSheet {...all} />
      </MobileLocaleProvider>,
    ),
  )
  return document.body
}

const memo = (id: number, parentId: number | null, text: string): FlowMemo => ({
  id,
  parentId,
  author: '홍길동',
  date: null,
  text,
  at: { sec: 0, para: 0, path: null },
  start: 0,
  end: 1,
  editable: true,
})

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!
  act(() => {
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('MemoSheet', () => {
  it('lists memos with their replies and shows one when tapped', () => {
    const onReveal = vi.fn()
    const onClose = vi.fn()
    const body = render({ memos: [memo(1, null, '첫 메모'), memo(2, 1, '답')], onReveal, onClose })
    const items = [...body.querySelectorAll('.mobile-memo')]
    expect(items.map((li) => li.getAttribute('data-reply'))).toEqual([null, 'true'])
    act(() => (items[0].querySelector('.mobile-memo-body') as HTMLButtonElement).click())
    expect(onReveal).toHaveBeenCalledWith(1)
    expect(onClose).toHaveBeenCalled()
  })

  it('adds a memo with the typed name and remembers the name', () => {
    const onAdd = vi.fn(() => true)
    const body = render({ onAdd })
    const [name] = body.querySelectorAll<HTMLInputElement>('.mobile-memo-composer input')
    type(name, '김철수')
    type(
      body.querySelector<HTMLTextAreaElement>('.mobile-memo-composer textarea')!,
      '확인 바랍니다',
    )
    act(() => body.querySelector<HTMLButtonElement>('[data-testid="hwp-memo-submit"]')!.click())
    expect(onAdd).toHaveBeenCalledWith('확인 바랍니다', '김철수')
    expect(window.localStorage.getItem('ieum.mobile.memoAuthor')).toBe('김철수')
  })

  it('says to select text when the memo could not be added', () => {
    const body = render({ onAdd: vi.fn(() => false) })
    type(body.querySelector<HTMLTextAreaElement>('.mobile-memo-composer textarea')!, '메모')
    act(() => body.querySelector<HTMLButtonElement>('[data-testid="hwp-memo-submit"]')!.click())
    expect(body.querySelector('.mobile-memo-error')?.textContent).toBe(
      '메모를 달 글을 문서에서 먼저 고르세요.',
    )
  })

  it('only lists memos in view mode', () => {
    const body = render({ memos: [memo(1, null, '첫 메모')], canEdit: false })
    expect(body.querySelector('.mobile-memo-composer')).toBeNull()
    expect(body.querySelector('.mobile-memo-actions')).toBeNull()
  })
})
