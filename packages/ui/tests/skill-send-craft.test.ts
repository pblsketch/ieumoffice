import { describe, expect, it } from 'vitest'
import {
  SKILL_SEND_MAX_CHARS,
  buildSkillRequest,
  skillForRequestOf,
  skillRequestText,
} from '../src/skill-send'

describe('skill-send craft synthesis', () => {
  it('injects deduplicated craft fragments once before skill blocks and enforces max chars', () => {
    const s1 = skillForRequestOf({
      ok: true,
      skill: {
        id: 'builtin:general-report',
        title: 'Report',
        body: 'Report body',
        files: [],
        mcpServers: [],
        craftTexts: [
          { slug: 'typography', body: 'Use clean scale.' },
          { slug: 'anti-ai-slop', body: 'No placeholders.' },
        ],
      },
    })!
    const s2 = skillForRequestOf({
      ok: true,
      skill: {
        id: 'builtin:table-summary',
        title: 'Table',
        body: 'Table body',
        files: [],
        mcpServers: [],
        craftTexts: [
          { slug: 'typography', body: 'Use clean scale.' },
          { slug: 'korean-office', body: 'Lead with summary.' },
        ],
      },
    })!

    const text = skillRequestText([s1, s2])
    expect(text.match(/<craft id="typography">/g)).toHaveLength(1)
    expect(text).toContain('<craft id="anti-ai-slop">')
    expect(text).toContain('<craft id="korean-office">')
    expect(text.indexOf('<craft-guidelines>')).toBeLessThan(text.indexOf('<skill id='))

    const tooLarge = buildSkillRequest(
      [
        {
          ...s1,
          craftTexts: [{ slug: 'typography', body: 'x'.repeat(SKILL_SEND_MAX_CHARS + 10) }],
        },
      ],
      SKILL_SEND_MAX_CHARS,
    )
    expect(tooLarge.ok).toBe(false)
  })
})
