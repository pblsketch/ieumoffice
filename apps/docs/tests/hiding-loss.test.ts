import type { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { allowHidingLoss, hiddenSpanCount } from '../src/renderer/hiding-loss'

const hidden = (text: string, label: string) => ({
  type: 'text',
  text,
  marks: [{ type: 'redaction', attrs: { label, rawRPr: '<w:rPr/>' } }],
})
const editorOf = (content: unknown[]) =>
  ({ getJSON: () => ({ type: 'doc', content }) }) as unknown as Editor

const MARKED = editorOf([
  { type: 'paragraph', content: [{ type: 'text', text: '담임 ' }, hidden('홍길동', '이름')] },
  { type: 'paragraph', content: [hidden('010', '전화'), { type: 'text', text: ' 끝' }] },
])

const desktop = (answer: boolean) => {
  const confirmHidingLoss = vi.fn(async () => answer)
  ;(window as unknown as { desktop: unknown }).desktop = { confirmHidingLoss }
  return confirmHidingLoss
}
afterEach(() => {
  delete (window as unknown as { desktop?: unknown }).desktop
})

describe('Save As ODT of a document with hidden spans', () => {
  it('counts each hidden span', () => {
    expect(hiddenSpanCount(MARKED)).toBe(2)
  })

  it('asks once with the count; Cancel stops the conversion', async () => {
    const ask = desktop(false)
    expect(await allowHidingLoss(MARKED)).toBe(false)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledWith(2)
  })

  it('goes on with Continue', async () => {
    desktop(true)
    expect(await allowHidingLoss(MARKED)).toBe(true)
  })

  it('does not ask for a document without hidden spans', async () => {
    const ask = desktop(false)
    const plain = editorOf([{ type: 'paragraph', content: [{ type: 'text', text: '홍길동' }] }])
    expect(await allowHidingLoss(plain)).toBe(true)
    expect(ask).not.toHaveBeenCalled()
  })
})
