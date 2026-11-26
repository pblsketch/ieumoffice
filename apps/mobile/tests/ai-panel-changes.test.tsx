import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { preloadMobileKeyProviderProtocols } from '@genoffice/mobile-bridge/ai-bridge'
import type { EditorAiContext } from '../src/renderer/editors/editorKind'
import {
  byTestId,
  editSkill,
  makeFakeAiRust,
  mountAi,
  reply,
  settle,
  textTurn,
  typeAndSend,
  unmountAll,
  waitFor,
  type Mounted,
} from './ai-panel-fake'

// The change cards of decision 0151 on mobile: every run that changed the
// document gets the shared AiChangesCard under its last AI reply, without a
// count (title "문서를 고쳤습니다") and with the editor's summary as a line of
// its own. Only the most recent changing run can be taken back; when the
// editor answers the undo with setUndo(null) (as the Hangul kind does at the
// start of its undo) that card turns "reverted" and stays. A document change
// clears every card.

beforeAll(async () => {
  await preloadMobileKeyProviderProtocols()
}, 60_000)

afterEach(() => unmountAll())

const cards = () => [...document.querySelectorAll<HTMLElement>('[data-testid="ai-changes-card"]')]
const revertOf = (card: Element) =>
  card.querySelector<HTMLButtonElement>('[data-action="ai-changes-revert"]')

/** A document whose every run changes it and offers an undo the way hwpKind does. */
function changingDoc(undos: Array<ReturnType<typeof vi.fn>>) {
  let n = 0
  return {
    createAiRun: async (ctx: EditorAiContext) => ({
      skill: editSkill(() => ({ output: 'ok', summary: 'edit' })),
      finish() {
        n += 1
        const undo = vi.fn(() => ctx.setUndo(null))
        undos.push(undo)
        ctx.setUndo({ summary: `AI가 ${n}곳을 고쳤습니다.`, undo })
      },
    }),
  }
}

async function runTwice(mounted: Mounted) {
  await typeAndSend('first')
  await waitFor(() => cards().length === 1)
  await typeAndSend('second')
  await waitFor(() => cards().length === 2)
  void mounted
}

describe('the change cards', () => {
  it('puts a card under each changing run and only the latest can be taken back', async () => {
    const undos: Array<ReturnType<typeof vi.fn>> = []
    const rust = makeFakeAiRust({
      relay: (_s, index) => reply(textTurn(index === 0 ? 'reply one' : 'reply two')),
    })
    const mounted = await mountAi(rust, { doc: changingDoc(undos) })
    await runTwice(mounted)

    const [first, second] = cards()
    expect(first!.textContent).toContain('문서를 고쳤습니다')
    expect(first!.querySelector('.mobile-ai-change-summary')?.textContent).toBe(
      'AI가 1곳을 고쳤습니다.',
    )
    expect(revertOf(first!)).toBeNull()
    expect(revertOf(second!)).not.toBeNull()
    // no [clear marks] on mobile
    expect(document.querySelector('[data-action="ai-changes-unmark"]')).toBeNull()

    // each card sits right under its run's reply
    const list = byTestId('ai-message-list')!
    const order = [...list.children].map((el) =>
      el.matches('[data-testid="ai-changes-card"]')
        ? `card:${el.querySelector('.mobile-ai-change-summary')?.textContent}`
        : (el.textContent ?? ''),
    )
    expect(order).toEqual([
      'first',
      'reply one',
      'card:AI가 1곳을 고쳤습니다.',
      'second',
      'reply two',
      'card:AI가 2곳을 고쳤습니다.',
    ])
  })

  it('turns the card "reverted" when the editor answers the undo with setUndo(null)', async () => {
    const undos: Array<ReturnType<typeof vi.fn>> = []
    const rust = makeFakeAiRust({ relay: () => reply(textTurn('done')) })
    const mounted = await mountAi(rust, { doc: changingDoc(undos) })
    await runTwice(mounted)

    await act(async () => revertOf(cards()[1]!)!.click())
    expect(undos[1]).toHaveBeenCalledOnce()
    expect(undos[0]).not.toHaveBeenCalled()
    expect(cards()).toHaveLength(2)
    expect(cards()[1]!.dataset.state).toBe('reverted')
    expect(cards()[1]!.textContent).toContain('되돌렸습니다')
    expect(revertOf(cards()[1]!)).toBeNull()
    // the earlier run stays summary-only
    expect(cards()[0]!.dataset.state).toBe('applied')
    expect(revertOf(cards()[0]!)).toBeNull()
  })

  it('keeps the card applied with its undo when the editor offers a new one after a refusal', async () => {
    let ctxOf: EditorAiContext | null = null
    const undo = vi.fn()
    const rust = makeFakeAiRust({ relay: () => reply(textTurn('done')) })
    await mountAi(rust, {
      doc: {
        createAiRun: async (ctx) => {
          ctxOf = ctx
          return {
            skill: editSkill(() => ({ output: 'ok', summary: 'edit' })),
            finish: () => ctx.setUndo({ summary: 'changed', undo }),
          }
        },
      },
    })
    await typeAndSend('go')
    await waitFor(() => cards().length === 1)
    await act(async () => revertOf(cards()[0]!)!.click())
    // still waiting for the editor: the button is busy
    expect(revertOf(cards()[0]!)!.disabled).toBe(true)
    await act(async () => ctxOf!.setUndo({ summary: 'changed', undo }))
    expect(cards()[0]!.dataset.state).toBe('applied')
    expect(revertOf(cards()[0]!)!.disabled).toBe(false)
  })

  it('clears every card on a document change', async () => {
    const undos: Array<ReturnType<typeof vi.fn>> = []
    const rust = makeFakeAiRust({ relay: () => reply(textTurn('done')) })
    const mounted = await mountAi(rust, { doc: changingDoc(undos) })
    await runTwice(mounted)
    await act(async () => mounted.ai().resetForDocument('doc-2'))
    await settle()
    expect(cards()).toHaveLength(0)
  })
})
