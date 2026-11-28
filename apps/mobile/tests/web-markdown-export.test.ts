import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'

// Word and ODT do not start the HWP engine; keep its loader out of the test like the HWPX test does.
vi.mock('../src/renderer/editors/rhwpEngine', () => ({ loadRhwpEngine: async () => {} }))

const SOURCE = '﻿# 회의 안건\n\n- 예산 계획\n- 일정 조정\n\n본문 문단입니다.\n'

async function zipText(bytes: Uint8Array, path: string): Promise<string> {
  const zip = await JSZip.loadAsync(bytes)
  const file = zip.file(path)
  expect(file, `${path} is in the package`).not.toBeNull()
  return file!.async('string')
}

describe('Markdown → Word and ODT (real converters, same path as the PC editor)', () => {
  it('markdownToDocx writes the heading and list texts into word/document.xml', async () => {
    const { markdownToDocx } = await import('../src/renderer/editors/markdownToHwp')
    const bytes = await markdownToDocx(SOURCE)
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK')
    const xml = await zipText(bytes, 'word/document.xml')
    expect(xml).toContain('회의 안건')
    expect(xml).toContain('예산 계획')
    expect(xml).toContain('일정 조정')
    expect(xml).toContain('본문 문단입니다.')
    // the BOM in front of the heading does not end up in the document
    expect(xml).not.toContain('﻿')
  }, 60_000)

  it('markdownToOdt writes the same texts into content.xml and returns the report', async () => {
    const { markdownToOdt } = await import('../src/renderer/editors/markdownToHwp')
    const { bytes, report } = await markdownToOdt(SOURCE)
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK')
    const mimetype = await zipText(bytes, 'mimetype')
    expect(mimetype).toBe('application/vnd.oasis.opendocument.text')
    const xml = await zipText(bytes, 'content.xml')
    expect(xml).toContain('회의 안건')
    expect(xml).toContain('예산 계획')
    expect(xml).toContain('일정 조정')
    expect(Array.isArray(report)).toBe(true)
    for (const item of report) {
      expect(['converted', 'dropped']).toContain(item.kind)
      expect(item.count).toBeGreaterThan(0)
    }
  }, 60_000)
})
