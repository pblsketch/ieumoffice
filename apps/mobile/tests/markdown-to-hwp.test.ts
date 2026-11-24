import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { HwpDocument, initSync } from '@rhwp/core'

// the engine is started here from its file; the app starts it from the studio's copy
vi.mock('../src/renderer/editors/rhwpEngine', () => ({ loadRhwpEngine: async () => {} }))

const require = createRequire(import.meta.url)

beforeAll(() => {
  initSync({ module: readFileSync(join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')) })
})

describe('Markdown → HWPX (real converter and rhwp engine)', () => {
  it('converts headings, lists and tables into a HWPX the engine opens', async () => {
    const { markdownToHwpx } = await import('../src/renderer/editors/markdownToHwp')
    const { bytes } = await markdownToHwpx(
      '﻿# 회의 안건\n\n- 예산 계획\n- 일정 조정\n\n| 항목 | 내용 |\n|---|---|\n| 장소 | 본관 |\n',
    )
    // HWPX is a ZIP
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK')
    const doc = new HwpDocument(bytes)
    try {
      const texts: string[] = []
      let tables = 0
      for (let p = 0; p < doc.getParagraphCount(0); p += 1) {
        const len = doc.getParagraphLength(0, p)
        if (len) texts.push(doc.getTextRange(0, p, 0, len))
        for (let c = 0; c < JSON.parse(doc.getControlTextPositions(0, p)).length; c += 1) {
          try {
            doc.getTableDimensions(0, p, c)
            tables += 1
          } catch {
            // not a table
          }
        }
      }
      // the heading keeps no BOM in front of it
      expect(texts[0]).toBe('회의 안건')
      expect(texts).toContain('예산 계획')
      expect(tables).toBe(1)
    } finally {
      doc.free()
    }
  }, 60_000)
})
