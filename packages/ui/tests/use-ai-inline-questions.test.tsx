// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useAiInlineQuestions } from '../src/useAiInlineQuestions'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Hook = ReturnType<typeof useAiInlineQuestions>

const INPUT = {
  version: '1.0',
  createSurface: {
    surfaceId: 'deck-scope',
    catalogId: 'ieumoffice.com:question-card/v1',
    components: [
      { id: 'root', component: 'Column', children: ['title', 'audience', 'notes'] },
      { id: 'title', component: 'Text', text: '방향' },
      {
        id: 'audience',
        component: 'ChoicePicker',
        label: '누가 듣나요?',
        options: [
          { label: '학부모', value: 'parents' },
          { label: '교사', value: 'teachers' },
        ],
        value: { '@path': '/audience' },
      },
      { id: 'notes', component: 'TextField', label: '메모', value: { '@path': '/notes' } },
    ],
    dataModel: { audience: [], notes: '' },
  },
}

let root: Root | null = null
let hook: Hook

function Probe(): null {
  hook = useAiInlineQuestions()
  return null
}

function mount(): void {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<Probe />))
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

function ask(signal?: AbortSignal) {
  let result: Promise<{ output: string; isError?: boolean | undefined }> | undefined
  act(() => {
    result = hook.askQuestionsSkill.executeTool!(
      { id: 'c1', name: 'ask_questions', input: INPUT },
      signal,
    )
  })
  return result!
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.body.innerHTML = ''
})

describe('useAiInlineQuestions', () => {
  it('opens the tool card with the checked view and waits for the person', async () => {
    mount()
    expect(hook.waitingForPerson).toBe(false)
    const pending = ask()
    await flush()
    expect(hook.activeToolCard?.status).toBe('open')
    expect(hook.activeToolCard?.view.title).toBe('방향')
    expect(hook.activeToolCard?.view.inputs.map((i) => i.id)).toEqual(['audience', 'notes'])
    expect(hook.waitingForPerson).toBe(true)

    act(() =>
      hook.submitToolCard({
        kind: 'submit',
        answers: { notes: '짧게' },
        decideForMe: ['audience'],
      }),
    )
    const out = await pending
    expect(out.isError).toBe(false)
    const action = JSON.parse(out.output)
    expect(action.action.name).toBe('submit')
    expect(action.action.context).toEqual({ answers: { notes: '짧게' }, decideForMe: ['audience'] })
    expect(hook.activeToolCard?.status).toBe('submitted')
    expect(hook.activeToolCard?.answer).toEqual({
      kind: 'submit',
      answers: { notes: '짧게' },
      decideForMe: ['audience'],
    })
    expect(hook.waitingForPerson).toBe(false)
  })

  it('answers skip from the skip button', async () => {
    mount()
    const pending = ask()
    await flush()
    act(() => hook.skipToolCard())
    const action = JSON.parse((await pending).output)
    expect(action.action.name).toBe('skip')
    expect(hook.activeToolCard?.status).toBe('skipped')
    expect(hook.waitingForPerson).toBe(false)
  })

  it('closes the open card on a new message and answers skip', async () => {
    mount()
    const pending = ask()
    await flush()
    act(() => hook.supersedeOpen())
    const action = JSON.parse((await pending).output)
    expect(action.action.name).toBe('skip')
    expect(hook.activeToolCard?.status).toBe('superseded')
    expect(hook.waitingForPerson).toBe(false)
  })

  it('answers skip and closes the card when the run stops', async () => {
    mount()
    const ctrl = new AbortController()
    const pending = ask(ctrl.signal)
    await flush()
    expect(hook.waitingForPerson).toBe(true)
    act(() => ctrl.abort())
    const action = JSON.parse((await pending).output)
    expect(action.action.name).toBe('skip')
    expect(hook.activeToolCard?.status).toBe('superseded')
    expect(hook.waitingForPerson).toBe(false)
  })

  it('gives each tool card its own id', async () => {
    mount()
    const first = ask()
    await flush()
    const firstId = hook.activeToolCard!.id
    act(() => hook.skipToolCard())
    await first
    act(() => hook.supersedeOpen())
    const second = ask()
    await flush()
    expect(hook.activeToolCard!.id).not.toBe(firstId)
    expect(hook.activeToolCard!.status).toBe('open')
    act(() => hook.skipToolCard())
    await second
  })

  it('closes the open card for a queued message without allowing a second card in the run', async () => {
    mount()
    const pending = ask()
    await flush()
    act(() => hook.markTextCard('m-1', 'open'))
    act(() => hook.closeOpenCard())
    const action = JSON.parse((await pending).output)
    expect(action.action.name).toBe('skip')
    expect(hook.activeToolCard?.status).toBe('superseded')
    expect(hook.waitingForPerson).toBe(false)
    // the text-block cards are left to the next run's supersedeOpen
    expect(hook.textCardStates['m-1']?.status).toBe('open')
    // same run: the one-card limit still holds, no second card opens
    const again = await ask()
    expect(again.isError).toBe(true)
    expect(JSON.parse(again.output).ok).toBe(false)
    expect(hook.activeToolCard?.status).toBe('superseded')
  })

  it('does nothing to a card that is no longer open', async () => {
    mount()
    const pending = ask()
    await flush()
    act(() => hook.skipToolCard())
    await pending
    act(() => hook.closeOpenCard())
    expect(hook.activeToolCard?.status).toBe('skipped')
  })

  it('drops every card of the conversation on a new chat and resets the limit', async () => {
    mount()
    const pending = ask()
    await flush()
    const answer = { kind: 'submit', answers: { a: ['x'] }, decideForMe: [] } as const
    act(() => hook.markTextCard('m-1', 'open'))
    act(() => hook.markTextCard('m-2', 'submitted', answer))
    act(() => hook.resetConversation())
    const action = JSON.parse((await pending).output)
    expect(action.action.name).toBe('skip')
    expect(hook.activeToolCard).toBeNull()
    expect(hook.waitingForPerson).toBe(false)
    expect(hook.textCardStates).toEqual({})
    // the next conversation may ask again
    const next = ask()
    await flush()
    expect(hook.activeToolCard?.status).toBe('open')
    act(() => hook.skipToolCard())
    expect((await next).isError).toBe(false)
  })

  it('keeps a reset conversation empty when the old run stops afterwards', async () => {
    mount()
    const ctrl = new AbortController()
    const pending = ask(ctrl.signal)
    await flush()
    act(() => hook.resetConversation())
    act(() => ctrl.abort())
    await pending
    expect(hook.activeToolCard).toBeNull()
  })

  it('keeps the text-block card states and supersedes open ones', () => {
    mount()
    act(() => hook.markTextCard('m-1', 'open'))
    const answer = { kind: 'submit', answers: { a: ['x'] }, decideForMe: [] } as const
    act(() => hook.markTextCard('m-2', 'submitted', answer))
    act(() => hook.supersedeOpen())
    expect(hook.textCardStates['m-1']?.status).toBe('superseded')
    expect(hook.textCardStates['m-2']).toEqual({ status: 'submitted', answer })
  })

  it('writes the follow-up message as readable lines, not JSON', () => {
    mount()
    const view = {
      surfaceId: 's',
      title: '방향',
      inputs: [
        {
          kind: 'ChoicePicker',
          id: 'who',
          label: '누가 듣나요?',
          required: false,
          variant: 'mutuallyExclusive',
          options: [{ label: '학부모', value: 'parents' }],
          initial: [],
        },
        {
          kind: 'TextField',
          id: 'notes',
          label: '메모',
          required: false,
          variant: 'shortText',
          initial: '',
        },
      ],
    } as const
    expect(
      hook.formatFollowUp('ko', view, {
        kind: 'submit',
        answers: { notes: '짧게' },
        decideForMe: ['who'],
      }),
    ).toBe('[방향]\n- 누가 듣나요?: 알아서 정해 줘\n- 메모: 짧게')
    expect(hook.formatFollowUp('ko', view, { kind: 'skip' })).toMatch(/^\[방향\] /)
  })
})
