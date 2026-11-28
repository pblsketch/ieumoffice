// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { AiAttachMenu } from '../src/AiAttachMenu'
import { buildMemoBatchPromptSection, type ReviewMemoItem } from '../src/ReviewMemoPicker'
import { reviewMemoText } from '../src/strings-review-memo'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const MEMOS: ReviewMemoItem[] = [
  { id: 'm1', location: 'Slide 2', author: 'Kim', excerpt: 'Shorten title', quote: '{{person_1}}' },
  {
    id: 'm2',
    location: 'Page 4',
    author: 'Lee',
    excerpt: 'Fix date',
    readOnly: true,
    readOnlyReason: 'formatted',
  },
]

describe('ReviewMemoPicker and AiAttachMenu memoAttach', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders AiAttachMenu when only memoAttach is provided (PDF editor case) and attaches selected memos', async () => {
    const onAttachMemos = vi.fn()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    act(() => {
      root.render(
        <AiAttachMenu
          lang="ko"
          memoAttach={{
            listMemos: () => MEMOS,
            onAttachMemos,
          }}
        />,
      )
    })

    const trigger = host.querySelector('.ai-attach-menu-btn') as HTMLButtonElement
    expect(trigger).not.toBeNull()

    await act(async () => {
      trigger.click()
      await Promise.resolve()
    })

    const memoItem = host.querySelector('[data-source="memo"]') as HTMLButtonElement
    expect(memoItem).not.toBeNull()
    expect(memoItem.disabled).toBe(false)

    await act(async () => {
      memoItem.click()
      await Promise.resolve()
    })

    const picker = host.querySelector('[data-testid="review-memo-picker"]')
    expect(picker).not.toBeNull()
    expect(picker?.textContent).toContain(reviewMemoText('ko', 'readOnlyBadge'))

    const confirmBtn = host.querySelector('.ai-memo-picker-confirm') as HTMLButtonElement
    act(() => {
      confirmBtn.click()
    })
    expect(onAttachMemos).toHaveBeenCalledWith(MEMOS)

    act(() => {
      root.unmount()
    })
  })

  it('formats redacted quotes and read-only reply rules in batch prompt section', () => {
    const prompt = buildMemoBatchPromptSection(MEMOS)
    expect(prompt).toContain('{{person_1}}')
    expect(prompt).toContain('[READ-ONLY]')
    expect(prompt).toContain('Keep the original memo intact')
  })

  it('has native translations across all 22 languages', () => {
    const en = reviewMemoText('en', 'attachFromMemos')
    for (const lang of LANGS) {
      const text = reviewMemoText(lang, 'attachFromMemos')
      expect(text, lang).toBeTruthy()
      if (lang !== 'en') expect(text, lang).not.toBe(en)
    }
  })
})
