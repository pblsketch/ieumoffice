/**
 * Slides asks through the shared `ask_questions` card only (spec 6): the old
 * `ask_clarification` tool is gone, and the prompt no longer forces a
 * questionnaire before every new deck — when to ask follows the shared rule of
 * the ask-questions skill.
 */
import { describe, expect, it } from 'vitest'
import type { RenderSlide } from '@genoffice/pptx-render'
import { createSlidesSkill, type DeckAccess } from '../src/renderer/ai/slides-skill'

const deck = { widthPx: 1280, heightPx: 720, nodes: [] } as unknown as RenderSlide

function mkAccess(): DeckAccess {
  return {
    getSlides: () => [deck],
    getCurrent: () => 0,
    getSelectedIds: () => [],
    applySlide: () => {},
    applyDeck: () => {},
    fitWidthPx: 1280,
    retryBackoffMs: 0,
  } as unknown as DeckAccess
}

describe('slides questions follow the shared rule', () => {
  it('offers no ask_clarification tool', () => {
    const names = createSlidesSkill(mkAccess()).tools.map((t) => t.name)
    expect(names).not.toContain('ask_clarification')
  })

  it('treats an ask_clarification call as an unknown tool', async () => {
    const r = await createSlidesSkill(mkAccess()).executeTool!({
      id: 't',
      name: 'ask_clarification',
      input: { questions: [{ id: 'a', label: 'Audience?', options: ['Kids', 'Adults'] }] },
    })
    expect(r.isError).toBe(true)
    expect(r.output).toContain('Unknown tool')
  })

  it('does not force a questionnaire before a new deck', () => {
    const prompt = createSlidesSkill(mkAccess()).systemPrompt
    expect(prompt).not.toContain('ask_clarification')
    expect(prompt).not.toMatch(/Questionnaire \(mandatory/i)
    expect(prompt).not.toMatch(/Step 0/)
    // the planning steps themselves stay
    expect(prompt).toContain('Step A Research')
    expect(prompt).toContain('Step D Generate')
  })

  it('no tool description or prompt mentions the old tool', () => {
    const skill = createSlidesSkill(mkAccess())
    for (const tool of skill.tools) {
      expect(String(tool.description), tool.name).not.toContain('ask_clarification')
      expect(String(tool.description), tool.name).not.toMatch(/Step 0/)
    }
  })
})
