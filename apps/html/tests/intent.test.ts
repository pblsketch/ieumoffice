import { describe, expect, it } from 'vitest'
import { createIntentSkill, type PageIntent } from '../src/renderer/ai/intent'

const contextOf = (intent: PageIntent, blank: boolean): string => {
  const skill = createIntentSkill(
    () => intent,
    () => blank,
  )
  return String(skill.buildContext?.() ?? '')
}

describe('the write intent of a blank document', () => {
  it('steers to write_document and keeps plan_page out', () => {
    const directive = contextOf('write', true)
    expect(directive).toContain('write_document')
    expect(directive).toMatch(/Do not call plan_page/)
  })

  it('no longer forbids asking: a truly unclear request may ask by the shared rule', () => {
    const directive = contextOf('write', true)
    expect(directive).not.toContain('ask_clarification')
    expect(directive).not.toMatch(/Do not call ask_questions/)
    expect(directive).not.toMatch(/ask_questions[^.\n]*(?:or|and) plan_page unless/)
  })

  it('says nothing for a designed page or once the page has content', () => {
    expect(contextOf('design', true)).toBe('')
    expect(contextOf('write', false)).toBe('')
  })
})
