import { describe, expect, it } from 'vitest'
import {
  ALLOWED_CRAFT_SLUGS,
  IEUM_CRAFT_KEY,
  IEUM_EXAMPLE_KEY,
  parseCraftSlugs,
  parseSkillMd,
  renderSkillMd,
} from '../src/user-skills'

describe('ieum-craft and ieum-example frontmatter contract', () => {
  it('round-trips ieum-craft and ieum-example losslessly', () => {
    const rendered = renderSkillMd({
      name: 'general-report',
      description: 'Write structured reports',
      title: 'Report Writer',
      craft: 'typography color anti-ai-slop korean-office',
      example: 'Write a Q3 sales summary report from the attached sheet',
      body: '# Steps\n1. Draft report.\n',
    })
    const parsed = parseSkillMd(rendered)
    expect(parsed).toBeDefined()
    expect(parsed?.metadata[IEUM_CRAFT_KEY]).toBe('typography color anti-ai-slop korean-office')
    expect(parsed?.metadata[IEUM_EXAMPLE_KEY]).toBe(
      'Write a Q3 sales summary report from the attached sheet',
    )
    expect(parseCraftSlugs(parsed?.metadata[IEUM_CRAFT_KEY])).toEqual([
      'typography',
      'color',
      'anti-ai-slop',
      'korean-office',
    ])
  })

  it('silently ignores unknown craft slugs and deduplicates valid ones', () => {
    expect(ALLOWED_CRAFT_SLUGS).toEqual([
      'typography',
      'color',
      'anti-ai-slop',
      'layout-hierarchy',
      'korean-office',
      'cjk-typography',
    ])
    expect(parseCraftSlugs('typography unknown-future-slug color typography')).toEqual([
      'typography',
      'color',
    ])
    expect(parseCraftSlugs('unknown-only')).toBeUndefined()
  })
})
