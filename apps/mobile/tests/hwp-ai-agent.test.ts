import { describe, expect, it, vi } from 'vitest'
import { composeSkills, createAskQuestionsSkill } from '@genoffice/agent-core'
import { wrapSkillWithViewEditGate } from '@genoffice/mobile-bridge/view-edit-gate'
import { createMobileHwpAgent } from '../src/renderer/ai/hwpAgent'
import { WEB_TOOLS } from '../../hwp/src/renderer/ai/hwp-skill'

/** The page editor's plugin as the agent calls it: a few answers, the rest refused. */
function fakePlugin() {
  let text = '제목\n본문입니다'
  const answers: Record<string, (...args: unknown[]) => unknown> = {
    foreignChanges: () => 0,
    readText: () => text,
    listFields: () => [],
    listTables: () => ({ count: 0, partial: false, tables: [] }),
    pageCount: () => 1,
    cutCells: () => [],
    replaceText: (find, replace) => {
      text = text.replace(String(find), String(replace))
      return { ok: true, count: 1, inTable: false }
    },
    undo: (steps) => ({ ok: true, undone: steps }),
  }
  const call = vi.fn(async (method: string, ...args: unknown[]) => {
    const answer = answers[method]
    if (!answer) throw new Error(`not in this test: ${method}`)
    return answer(...args)
  })
  return { call, text: () => text }
}

describe('the Hangul AI tools on mobile', () => {
  it('offers the PC tools except what the phone cannot do, in the UI language', () => {
    const { call } = fakePlugin()
    const agent = createMobileHwpAgent(call, () => 'ko')
    const names = agent.skill.tools.map((tool) => tool.name)
    expect(names).toEqual(
      expect.arrayContaining(['read_document', 'replace_text', 'insert_paragraphs']),
    )
    for (const name of [...WEB_TOOLS, 'generate_image', 'analyze_picture']) {
      expect(names).not.toContain(name)
    }
    expect(agent.skill.systemPrompt).toContain('사용자 메시지와 같은 언어로 답변하세요')
    // the plugin is only reached when a run starts
    expect(call).not.toHaveBeenCalled()
  })

  it('edits through the plugin and takes the whole run back in one go', async () => {
    const { call, text } = fakePlugin()
    const agent = createMobileHwpAgent(call, () => 'ko')
    await agent.begin()
    expect(call).toHaveBeenCalledWith('foreignChanges')
    expect(agent.skill.buildContext?.()).toContain('## Open document')

    const done = await agent.skill.executeTool({
      id: '1',
      name: 'replace_text',
      input: { find: '본문', replace: '내용' },
    })
    expect(done.isError).toBeFalsy()
    expect(text()).toBe('제목\n내용입니다')

    const changed = agent.finish()
    expect(changed?.places).toBe(1)
    // a second look finds nothing new
    expect(agent.finish()).toBeNull()
    expect(await changed!.undo()).toBe('reverted')
    expect(call).toHaveBeenCalledWith('undo', 1, 0)
  })

  it('reports nothing changed after a run that only read', async () => {
    const { call } = fakePlugin()
    const agent = createMobileHwpAgent(call, () => 'en')
    await agent.begin()
    await agent.skill.executeTool({ id: '1', name: 'read_document', input: {} })
    expect(agent.finish()).toBeNull()
  })

  it('keeps the edit tools away from a protected document, and asks through the card', () => {
    const { call } = fakePlugin()
    const agent = createMobileHwpAgent(call, () => 'ko')
    const gated = wrapSkillWithViewEditGate(agent.skill, {
      isMutatingTool: (name) => agent.editTools.has(name),
      getMode: () => 'view',
      getCapabilities: () => ({ writable: true, encrypted: true, distribution: false }),
      switchToEdit: () => {},
    })
    const ask = createAskQuestionsSkill({ ask: async () => ({ action: 'skip' }) as never })
    const names = composeSkills(gated.id, '', [gated, ask]).tools.map((tool) => tool.name)
    expect(names).toContain('read_document')
    expect(names).toContain('ask_questions')
    expect(names).not.toContain('replace_text')
    expect(names).not.toContain('insert_paragraphs')
  })
})
