// @vitest-environment jsdom
import React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import {
  AiReplyProgress,
  AiTypingIndicator,
  SLOW_RESPONSE_HINT_AFTER_S,
} from '../src/AiTypingIndicator'
import { aiDiagnosticsText } from '../src/strings-ai-diagnostics'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('AiTypingIndicator slow-response hint', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('keeps the 3s elapsed timer and shows the 15s slow-response hint in the chosen language', () => {
    expect(SLOW_RESPONSE_HINT_AFTER_S).toBe(15)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    act(() => {
      root.render(<AiTypingIndicator label="생각 중" lang="ko" />)
    })
    expect(host.querySelector('.ai-typing-slow-hint')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(4_000)
    })
    expect(host.textContent).toContain('4s')
    expect(host.querySelector('.ai-typing-slow-hint')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(11_000)
    })
    const hint = host.querySelector('.ai-typing-slow-hint')
    expect(hint).not.toBeNull()
    expect(hint?.textContent).toBe(aiDiagnosticsText('ko', 'slowResponseHint'))

    act(() => {
      root.unmount()
    })
  })

  it('stops counting while paused and resumes from the held value', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    act(() => {
      root.render(<AiTypingIndicator label="생각 중" lang="ko" />)
    })
    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(host.textContent).toContain('5s')

    act(() => {
      root.render(<AiTypingIndicator label="생각 중" lang="ko" paused />)
    })
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(host.textContent).toContain('5s')
    expect(host.querySelector('.ai-typing-slow-hint')).toBeNull()

    act(() => {
      root.render(<AiTypingIndicator label="생각 중" lang="ko" paused={false} />)
    })
    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(host.textContent).toContain('7s')

    act(() => {
      root.unmount()
    })
  })

  it('passes paused through the reply progress row', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    act(() => {
      root.render(
        <AiReplyProgress reply={{ streaming: true }} thinking="생각 중" working="작업 중" paused />,
      )
    })
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(host.textContent).not.toContain('10s')

    act(() => {
      root.unmount()
    })
  })

  it('provides localized slow-response hints across all 22 languages', () => {
    const en = aiDiagnosticsText('en', 'slowResponseHint')
    for (const lang of LANGS) {
      const text = aiDiagnosticsText(lang, 'slowResponseHint')
      expect(text, lang).toBeTruthy()
      if (lang !== 'en') expect(text, lang).not.toBe(en)
    }
  })
})
