import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cacheTrustedPresetImagesInOutput,
  extractTrustedPresetImageUrls,
  isTrustedPresetImageUrl,
  normalizeImageForEditors,
  sniffImageFormat,
  storeMcpImageBase64,
} from '../src/main/mcp-client/mcp-images'
import { executeObsidianTool } from '../src/main/mcp-client/obsidian-vault'

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
])

describe('mcp-images', () => {
  it('sniffs valid raster image headers and rejects non-image payloads', () => {
    expect(sniffImageFormat(PNG_BYTES)).toEqual({ mime: 'image/png', ext: 'png' })
    expect(sniffImageFormat(WEBP_BYTES)).toEqual({ mime: 'image/webp', ext: 'webp' })
    expect(sniffImageFormat(Buffer.from('<html>403 Forbidden</html>'))).toBeNull()
  })

  it('converts WebP to PNG when a converter is provided', () => {
    const converted = normalizeImageForEditors(WEBP_BYTES, () => PNG_BYTES)
    expect(converted).toEqual({ bytes: PNG_BYTES, mime: 'image/png', ext: 'png' })
  })

  it('validates base64 MCP image blocks before writing to the store', () => {
    const store = vi.fn(() => 'file:///tmp/genoffice-ai-images/uuid-1.png')
    const ok = storeMcpImageBase64(Buffer.from(PNG_BYTES).toString('base64'), { store })
    expect(ok).toBe('file:///tmp/genoffice-ai-images/uuid-1.png')
    expect(store).toHaveBeenCalledTimes(1)

    const bad = storeMcpImageBase64(Buffer.from('not-an-image').toString('base64'), { store })
    expect(bad).toBeNull()
    expect(store).toHaveBeenCalledTimes(1)
  })

  it('restricts automatic preset image caching to official Notion/Canva HTTPS hosts', () => {
    expect(
      isTrustedPresetImageUrl(
        'notion',
        'https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/img.png?X-Amz-Signature=1',
      ),
    ).toBe(true)
    expect(isTrustedPresetImageUrl('notion', 'https://img.notionusercontent.com/a.png')).toBe(true)
    expect(isTrustedPresetImageUrl('notion', 'https://evil.example/track.png')).toBe(false)
    expect(isTrustedPresetImageUrl('notion', 'http://img.notionusercontent.com/a.png')).toBe(false)

    expect(isTrustedPresetImageUrl('canva', 'https://export-download.canva.com/x/page1.png')).toBe(
      true,
    )
    expect(isTrustedPresetImageUrl('canva', 'https://document-export.canva.com/y.jpg')).toBe(true)
    expect(isTrustedPresetImageUrl('canva', 'https://evil.example/x.png')).toBe(false)
    expect(isTrustedPresetImageUrl('canva', 'https://127.0.0.1/x.png')).toBe(false)
    expect(isTrustedPresetImageUrl(null, 'https://export-download.canva.com/x.png')).toBe(false)
  })

  it('extracts and caches trusted preset images and appends local file:// mappings', async () => {
    const output = [
      '# Meeting Notes',
      '<image source="https://prod-files-secure.s3.us-west-2.amazonaws.com/a.png" />',
      '![Untrusted](https://evil.example/leak.png)',
    ].join('\n')

    expect(extractTrustedPresetImageUrls('notion', output)).toEqual([
      'https://prod-files-secure.s3.us-west-2.amazonaws.com/a.png',
    ])

    const downloadImage = vi.fn(async () => ({
      bytes: PNG_BYTES,
      mime: 'image/png' as const,
      ext: 'png' as const,
    }))
    const storeImage = vi.fn(() => 'file:///tmp/genoffice-ai-images/cached-1.png')

    const enriched = await cacheTrustedPresetImagesInOutput('notion', output, {
      downloadImage,
      storeImage,
    })

    expect(downloadImage).toHaveBeenCalledTimes(1)
    expect(enriched).toContain('Cached images')
    expect(enriched).toContain(
      'https://prod-files-secure.s3.us-west-2.amazonaws.com/a.png -> file:///tmp/genoffice-ai-images/cached-1.png',
    )
    expect(enriched).not.toContain('evil.example/leak.png ->')
  })
})

describe('Obsidian read_note embedded image caching', () => {
  let tempDir: string
  let vaultDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ieum-obs-img-'))
    vaultDir = join(tempDir, 'Vault')
    await mkdir(join(vaultDir, 'media'), { recursive: true })
    await writeFile(join(vaultDir, 'media', 'arch.png'), PNG_BYTES)
    await writeFile(
      join(vaultDir, 'Spec.md'),
      '# Spec\n\nSee architecture:\n![[arch.png]]\n',
      'utf8',
    )
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('caches referenced local vault images and includes file:// URLs in read_note output', async () => {
    const cacheImageBytes = vi.fn(() => 'file:///tmp/genoffice-ai-images/obs-1.png')
    const res = await executeObsidianTool(
      'read_note',
      { path: 'Spec.md' },
      [{ id: 'v1', name: 'Vault', path: vaultDir, enabled: true }],
      {
        isFileOpen: () => false,
        hasUnsavedChanges: () => false,
        parseFileToText: async (absPath) => ({
          ok: true,
          text: '# Spec\n\nSee architecture:\n![[arch.png]]\n' + (absPath ? '' : ''),
        }),
        trashItem: async () => {},
        cacheImageBytes,
      },
    )

    expect(res.isError).toBe(false)
    expect(cacheImageBytes).toHaveBeenCalledTimes(1)
    expect(res.output).toContain('Embedded images')
    expect(res.output).toContain(
      '![[arch.png]] (media/arch.png) -> file:///tmp/genoffice-ai-images/obs-1.png',
    )
  })
})
