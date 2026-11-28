import { describe, expect, it } from 'vitest'
import { buildCodingAgentGuide } from '../src/renderer/src/agent-guide-text'

describe('buildCodingAgentGuide', () => {
  it('documents CLI, MCP, and skill usage with zero secrets or local paths', () => {
    for (const lang of ['ko', 'en'] as const) {
      const text = buildCodingAgentGuide(lang)
      expect(text).toContain('ieumoffice')
      expect(text).toContain('MCP')
      expect(text).not.toMatch(/sk-[a-z0-9]/i)
      expect(text).not.toMatch(/[A-Za-z]:\\Users\\/i)
      expect(text).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i)
    }
  })
})
