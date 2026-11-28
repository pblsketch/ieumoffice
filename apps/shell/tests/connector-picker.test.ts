import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  listObsidianPickerItems,
  resolveObsidianSelection,
  resolveObsidianSelectionWithImages,
} from '../src/main/connector-picker/obsidian-picker'
import {
  cleanupOldNotionSnapshots,
  extractNotionImageTargets,
  fetchNotionPagesToTemp,
  findNotionTools,
  parseNotionSearchResults,
  unwrapNotionFetchMarkdown,
} from '../src/main/connector-picker/notion-picker'
import {
  buildCanvaSearchInput,
  cleanupOldCanvaFiles,
  exportCanvaDesignToTemp,
  fetchCanvaDesignsToTemp,
  findCanvaTools,
  formatCanvaDesignMarkdown,
  isAllowedCanvaDownloadUrl,
  parseCanvaSearchResults,
} from '../src/main/connector-picker/canva-picker'

const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])
const TINY_JPG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
])

let tempDir: string
let vaultDir: string
let attachDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ieum-connector-picker-'))
  vaultDir = join(tempDir, 'MyVault')
  attachDir = join(tempDir, 'ieumoffice-notion-attach')
  await mkdir(vaultDir, { recursive: true })
  await mkdir(attachDir, { recursive: true })
  await writeFile(join(vaultDir, 'Alpha.md'), '# Alpha\n#tag1', 'utf8')
  await writeFile(join(vaultDir, 'Beta.md'), '# Beta\n#tag2', 'utf8')
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('Obsidian note picker backend', () => {
  it('marks unsaved open notes as disabled and caps selection at 20', async () => {
    const unsavedPath = join(vaultDir, 'Beta.md')
    const listed = await listObsidianPickerItems(
      [{ id: 'v1', name: 'MyVault', path: vaultDir, enabled: false }],
      async (p) => p.toLowerCase() === unsavedPath.toLowerCase(),
    )
    expect(listed.items).toHaveLength(2)
    const alpha = listed.items.find((i) => i.title === 'Alpha')!
    const beta = listed.items.find((i) => i.title === 'Beta')!
    expect(alpha.disabledReason).toBeUndefined()
    expect(beta.disabledReason).toBe('unsaved')

    // Submitting unsaved id or unknown id drops them safely
    const picked = resolveObsidianSelection([alpha.id, beta.id, 'bogus'], listed.items)
    expect(picked.paths).toEqual([alpha.id])
    expect(picked.skipped).toBe(2)

    // Selection is capped at 20
    const many = Array.from({ length: 25 }, (_, idx) => ({
      id: `C:/v/${idx}.md`,
      title: `N${idx}`,
      subtitle: `N${idx}.md`,
    }))
    const capped = resolveObsidianSelection(
      many.map((m) => m.id),
      many,
    )
    expect(capped.paths).toHaveLength(20)
  })

  it('automatically attaches local vault images referenced in picked notes while refusing hidden and escaping paths', async () => {
    await mkdir(join(vaultDir, 'assets'), { recursive: true })
    await mkdir(join(vaultDir, '.obsidian'), { recursive: true })
    const wikiImg = join(vaultDir, 'assets', 'diagram.png')
    const relImg = join(vaultDir, 'assets', 'chart.jpg')
    const hiddenImg = join(vaultDir, '.obsidian', 'secret.png')
    const outsideImg = join(tempDir, 'outside.png')
    await writeFile(wikiImg, TINY_PNG)
    await writeFile(relImg, TINY_JPG)
    await writeFile(hiddenImg, TINY_PNG)
    await writeFile(outsideImg, TINY_PNG)

    await writeFile(
      join(vaultDir, 'Alpha.md'),
      [
        '# Alpha',
        '![[diagram.png|400]]',
        '![Chart](assets/chart.jpg)',
        '![Hidden](.obsidian/secret.png)',
        '![Escape](../outside.png)',
        '![Remote](https://example.com/remote.png)',
      ].join('\n'),
      'utf8',
    )

    const vaults = [{ id: 'v1', name: 'MyVault', path: vaultDir, enabled: true }]
    const listed = await listObsidianPickerItems(vaults, async () => false)
    const alpha = listed.items.find((i) => i.title === 'Alpha')!

    const resolved = await resolveObsidianSelectionWithImages([alpha.id], listed.items, vaults)
    expect(resolved.paths).toEqual([alpha.id, wikiImg, relImg])
    expect(resolved.skipped).toBe(0)
  })
})

describe('Notion page picker backend', () => {
  it('finds official search and fetch tools and filters out databases from search results', () => {
    const tools = findNotionTools([
      {
        name: 'notion-search',
        description: 'Search Notion',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      },
      {
        name: 'notion-fetch',
        description: 'Fetch Notion page',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      },
    ])
    expect(tools?.searchTool.name).toBe('notion-search')
    expect(tools?.fetchTool.name).toBe('notion-fetch')

    const parsed = parseNotionSearchResults(
      JSON.stringify({
        results: [
          { id: 'p1', type: 'page', title: 'Roadmap 2026', timestamp: '2026-11-20T10:00:00Z' },
          { id: 'db1', type: 'database', title: 'Tasks DB', timestamp: '2026-11-20T10:00:00Z' },
          {
            id: 'ds1',
            object: 'data_source',
            title: 'CRM Data',
            timestamp: '2026-11-20T10:00:00Z',
          },
          {
            id: 'p2',
            object: 'page',
            title: 'Meeting Notes',
            last_edited_time: '2026-11-19T08:00:00Z',
          },
        ],
      }),
    )
    expect(parsed.map((p) => p.id)).toEqual(['p1', 'p2'])
  })

  it('fetches selected pages to temp .md snapshots, counts omitted non-text items, and cleans files older than 7 days', async () => {
    // Plant an 8-day-old file and a fresh file
    const oldFile = join(attachDir, 'stale.md')
    const freshFile = join(attachDir, 'fresh.md')
    await writeFile(oldFile, 'old', 'utf8')
    await writeFile(freshFile, 'fresh', 'utf8')
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    await utimes(oldFile, eightDaysAgo, eightDaysAgo)

    await cleanupOldNotionSnapshots(attachDir)
    await expect(readFile(oldFile, 'utf8')).rejects.toThrow()
    expect(await readFile(freshFile, 'utf8')).toBe('fresh')

    const callForUserPicker = vi.fn(async () => ({
      ok: true as const,
      output:
        '# Roadmap 2026\n\nGoals for Q4.\n<image src="https://img.example/a.png" />\n<file url="https://f.example/b.pdf" />',
      isError: false,
    }))
    const res = await fetchNotionPagesToTemp({
      serverId: 'notion-1',
      selectedItems: [{ id: 'page-123', title: 'Roadmap / 2026', subtitle: '2026-11-20' }],
      fetchTool: {
        name: 'notion-fetch',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      },
      callForUserPicker,
      attachDir,
      downloadImage: async () => null,
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.paths).toHaveLength(1)
      expect(res.paths[0]).toMatch(/\.md$/)
      expect(res.omittedNonText).toBe(2)
      const saved = await readFile(res.paths[0]!, 'utf8')
      expect(saved).toContain('# Roadmap 2026')
    }
  })

  it('automatically downloads embedded Notion images alongside snapshots and omits only truly unavailable items', async () => {
    const markdown = [
      '# Product Spec',
      '![Hero](https://prod-files-secure.s3.us-west-2.amazonaws.com/hero.png)',
      '<image source="https://img.notionusercontent.com/flow.jpg" />',
      '<file url="https://f.example/report.pdf" />',
    ].join('\n\n')
    expect(extractNotionImageTargets(markdown)).toHaveLength(2)

    const downloadImage = vi.fn(async (url: string) =>
      url.endsWith('.jpg')
        ? { bytes: TINY_JPG, mime: 'image/jpeg' as const, ext: 'jpg' as const }
        : { bytes: TINY_PNG, mime: 'image/png' as const, ext: 'png' as const },
    )

    const res = await fetchNotionPagesToTemp({
      serverId: 'notion-1',
      selectedItems: [{ id: 'page-999', title: 'Product Spec', subtitle: '2026-11-24' }],
      fetchTool: {
        name: 'notion-fetch',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      },
      callForUserPicker: async () => ({ ok: true, output: markdown, isError: false }),
      attachDir,
      downloadImage,
    })

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.paths).toHaveLength(3)
      expect(res.paths[0]).toMatch(/\.md$/)
      expect(res.paths[1]).toMatch(/\.png$/)
      expect(res.paths[2]).toMatch(/\.jpg$/)
      // Only the <file> tag remains omitted; both images were downloaded
      expect(res.omittedNonText).toBe(1)
      const saved = await readFile(res.paths[0]!, 'utf8')
      expect(saved).toContain('[Attached image:')
      expect(downloadImage).toHaveBeenCalledTimes(2)
    }
  })

  it('unwraps Notion MCP JSON and <page>/<content> XML envelopes into clean Markdown', () => {
    const raw = JSON.stringify({
      metadata: { type: 'page' },
      title: '강의안 요약',
      url: 'https://www.notion.so/example-123',
      text: 'Here is the result of "fetch" for the Page:\n<page url="https://www.notion.so/example-123"><ancestor-path>Root</ancestor-path><properties>{"title":"강의안 요약"}</properties><content>\n## 개요\n- 첫째 항목\n- 둘째 항목\n</content></page>',
    })
    const cleaned = unwrapNotionFetchMarkdown(raw, 'fallback')
    expect(cleaned).toBe('# 강의안 요약\n\n## 개요\n- 첫째 항목\n- 둘째 항목\n')
    expect(cleaned).not.toContain('"metadata"')
    expect(cleaned).not.toContain('<ancestor-path>')
  })
})

describe('Canva design picker backend', () => {
  it('builds schema-valid search inputs and parses search results with epoch timestamps', () => {
    expect(buildCanvaSearchInput('')).toMatchObject({ sort_by: 'modified_descending', limit: 30 })
    expect(buildCanvaSearchInput('')).not.toHaveProperty('query')
    expect(buildCanvaSearchInput('수행평가')).toMatchObject({
      query: '수행평가',
      sort_by: 'relevance',
      limit: 30,
    })

    const items = parseCanvaSearchResults(
      JSON.stringify({
        items: [
          {
            design_id: 'DAHCFRp2u74',
            title: 'PBL 수행평가 설계하기',
            updated_at: 1771856225,
            page_count: 47,
            design_types: ['presentation'],
          },
        ],
      }),
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'DAHCFRp2u74',
      title: 'PBL 수행평가 설계하기',
      pageCount: 47,
      designTypes: ['presentation'],
    })
    expect(items[0]!.subtitle).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('formats read-design JSON into compact Markdown and exports presentations as PPTX', async () => {
    const tools = findCanvaTools([
      { name: 'search-designs' },
      { name: 'read-design' },
      { name: 'get-export-formats' },
      { name: 'export-design' },
    ])!
    expect(tools.exportTool?.name).toBe('export-design')

    const md = formatCanvaDesignMarkdown(
      JSON.stringify({
        design_metadata: { title: '수업 자료', page_count: 2 },
        design_content: [
          { page_number: 1, elements: [{ text: '1쪽 제목' }, { text: '핵심 내용' }] },
          { page_number: 2, elements: [{ text: '2쪽 정리' }] },
        ],
        presenter_notes: [{ note: '학생 질문 유도' }],
      }),
      'fallback',
    )
    expect(md).toContain('# 수업 자료')
    expect(md).toContain('## Page 1')
    expect(md).toContain('1쪽 제목')
    expect(md).toContain('## Presenter Notes')
    expect(md).toContain('학생 질문 유도')

    const canvaDir = join(tempDir, 'canva')
    const attachRes = await fetchCanvaDesignsToTemp({
      serverId: 'canva-1',
      selectedItems: [{ id: 'DAHCFRp2u74', title: '수업 자료', subtitle: '' }],
      readTool: tools.readTool,
      callForUserPicker: async () => ({
        ok: true,
        output: JSON.stringify({
          design_metadata: { title: '수업 자료' },
          design_content: [{ text: '본문' }],
        }),
        isError: false,
      }),
      attachDir: canvaDir,
    })
    expect(attachRes.ok).toBe(true)
    if (attachRes.ok) {
      expect(await readFile(attachRes.paths[0]!, 'utf8')).toContain('# 수업 자료')
    }

    expect(isAllowedCanvaDownloadUrl('https://export-download.canva.com/abc/file.pptx')).toBe(true)
    expect(isAllowedCanvaDownloadUrl('http://export-download.canva.com/abc/file.pptx')).toBe(false)
    expect(isAllowedCanvaDownloadUrl('https://127.0.0.1/file.pptx')).toBe(false)

    const exportRes = await exportCanvaDesignToTemp({
      serverId: 'canva-1',
      item: { id: 'DAHCFRp2u74', title: '수업 자료', subtitle: '', designTypes: ['presentation'] },
      tools,
      callForUserPicker: async (_sid, toolName) => {
        if (toolName === 'get-export-formats') {
          return {
            ok: true,
            output: JSON.stringify({ formats: ['pdf', 'pptx', 'png'] }),
            isError: false,
          }
        }
        return {
          ok: true,
          output: JSON.stringify({ urls: ['https://export-download.canva.com/file.pptx'] }),
          isError: false,
        }
      },
      fetchBytes: async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      attachDir: canvaDir,
    })
    expect(exportRes.ok).toBe(true)
    if (exportRes.ok) {
      expect(exportRes.format).toBe('pptx')
      expect(exportRes.path).toMatch(/\.pptx$/)
    }
  })

  it('automatically attaches Canva page PNG images alongside Markdown and falls back to thumbnails', async () => {
    const tools = findCanvaTools([
      { name: 'search-designs' },
      { name: 'read-design' },
      { name: 'get-design-pages' },
      { name: 'export-design' },
    ])!
    expect(tools.pagesTool?.name).toBe('get-design-pages')

    const canvaDir = join(tempDir, 'canva-images')
    const attachRes = await fetchCanvaDesignsToTemp({
      serverId: 'canva-1',
      selectedItems: [{ id: 'DAHCFRp2u74', title: '수업 자료', subtitle: '', pageCount: 2 }],
      readTool: tools.readTool,
      tools,
      callForUserPicker: async (_sid, toolName) => {
        if (toolName === 'export-design') {
          return {
            ok: true,
            output: JSON.stringify({
              urls: [
                'https://export-download.canva.com/page-1.png',
                'https://export-download.canva.com/page-2.png',
              ],
            }),
            isError: false,
          }
        }
        return {
          ok: true,
          output: JSON.stringify({
            design_metadata: { title: '수업 자료', page_count: 2 },
            design_content: [
              { page_number: 1, elements: [{ text: '1쪽 제목' }] },
              { page_number: 2, elements: [{ text: '2쪽 정리' }] },
            ],
          }),
          isError: false,
        }
      },
      downloadImage: async () => ({ bytes: TINY_PNG, mime: 'image/png', ext: 'png' }),
      attachDir: canvaDir,
    })

    expect(attachRes.ok).toBe(true)
    if (attachRes.ok) {
      expect(attachRes.paths).toHaveLength(3)
      expect(attachRes.paths[0]).toMatch(/\.md$/)
      expect(attachRes.paths[1]).toMatch(/-p1\.png$/)
      expect(attachRes.paths[2]).toMatch(/-p2\.png$/)
      const md = await readFile(attachRes.paths[0]!, 'utf8')
      expect(md).toContain('[Attached page image:')
    }

    // Cleanup removes stale images as well as markdown/exports
    const oldPng = join(canvaDir, 'stale.png')
    await writeFile(oldPng, TINY_PNG)
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    await utimes(oldPng, eightDaysAgo, eightDaysAgo)
    await cleanupOldCanvaFiles(canvaDir)
    await expect(readFile(oldPng)).rejects.toThrow()
  })
})
