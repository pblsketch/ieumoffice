import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateQuestionSurface } from '@genoffice/agent-core'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { AiSheetPanel, type AiSheetPanelProps } from '../src/renderer/components/AiSheetPanel'

const SURFACE = {
  version: '1.0',
  createSurface: {
    surfaceId: 'report-scope',
    catalogId: 'ieumoffice.com:question-card/v1',
    components: [
      { id: 'root', component: 'Column', children: ['title', 'audience'] },
      { id: 'title', component: 'Text', text: '보고서 방향을 정해 주세요' },
      {
        id: 'audience',
        component: 'ChoicePicker',
        label: '누가 읽나요?',
        variant: 'mutuallyExclusive',
        options: [
          { label: '학부모', value: 'parents' },
          { label: '동료', value: 'colleagues' },
        ],
        value: { '@path': '/audience' },
      },
    ],
    dataModel: { audience: [] },
  },
}

const containers: HTMLElement[] = []
afterEach(() => {
  while (containers.length > 0) containers.pop()?.remove()
})

function renderPanel(overrides: Partial<AiSheetPanelProps>): HTMLElement {
  const props: AiSheetPanelProps = {
    aiEnabled: true,
    aiSettings: null,
    chatgptStatus: null,
    messages: [{ role: 'user', text: '보고서 써 줘' }],
    streaming: true,
    canMutate: true,
    autoSwitchedNotice: false,
    recoveryNotice: null,
    onSend: () => {},
    onStop: () => {},
    onOpenSettings: () => {},
    onAcknowledgeSubscriptionNotice: () => {},
    onChatgptReconsent: () => {},
    onChatgptReconnect: () => {},
    ...overrides,
  }
  const div = document.createElement('div')
  document.body.appendChild(div)
  containers.push(div)
  act(() => {
    createRoot(div).render(
      <MobileLocaleProvider lang="ko">
        <AiSheetPanel {...props} />
      </MobileLocaleProvider>,
    )
  })
  return div
}

describe('the AI question card on mobile (A2UI, decision 0164)', () => {
  it('draws the shared card under the messages and hands the skip back', () => {
    const checked = validateQuestionSurface(SURFACE)
    if (!checked.ok) throw new Error('fixture surface must be valid')
    const onQuestionSkip = vi.fn()
    const div = renderPanel({
      questionCard: { id: 1, view: checked.view, status: 'open' },
      onQuestionSubmit: vi.fn(),
      onQuestionSkip,
    })
    const list = div.querySelector('[data-testid="ai-message-list"]')!
    expect(list.textContent).toContain('보고서 방향을 정해 주세요')
    expect(list.textContent).toContain('학부모')
    const skip = [...div.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('건너뛰기'),
    )!
    act(() => skip.click())
    expect(onQuestionSkip).toHaveBeenCalledOnce()
  })

  it('shows no card when the AI is not asking', () => {
    const div = renderPanel({ questionCard: null })
    expect(div.textContent).not.toContain('건너뛰기')
  })
})
