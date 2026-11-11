// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PdfViewSources } from '../src/main/view-sources'

const roots: string[] = []
const managers: PdfViewSources[] = []
afterEach(async () => {
  await Promise.all(
    managers.splice(0).flatMap((manager) => [manager.closeOwner(1), manager.closeOwner(2)]),
  )
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pdf-view-sources-test-'))
  roots.push(root)
  const path = join(root, 'source.pdf')
  await writeFile(path, 'original bytes')
  const renderer = {
    render: vi.fn(async () => ({ width: 1, height: 1, rgba: new Uint8Array(4) })),
    cancel: vi.fn(),
    close: vi.fn(async () => {}),
  }
  const manager = new PdfViewSources(join(root, 'cache'), renderer)
  managers.push(manager)
  return { manager, renderer, path }
}

describe('view-owned PDF source capabilities', () => {
  it('rejects another view for range reads, rendering, cancellation and closing', async () => {
    const { manager, renderer, path } = await fixture()
    const { source } = await manager.open(1, path)
    const request = {
      sourceId: source.id,
      requestId: 'job',
      page: 1,
      width: 1,
      height: 1,
      rotation: 0,
    }
    expect(() => manager.read(2, source.id, 0, 1)).toThrow('not granted')
    expect(() => manager.render(2, request)).toThrow('not granted')
    expect(() => manager.cancel(2, source.id, 'job')).toThrow('not granted')
    await expect(manager.close(2, source.id)).rejects.toThrow('not granted')
    expect(renderer.render).not.toHaveBeenCalled()
    expect(renderer.close).not.toHaveBeenCalled()
    expect(JSON.stringify(source)).not.toContain(path)
    expect(source).not.toHaveProperty('fd')
    expect(new Uint8Array(await manager.read(1, source.id, 0, 8))).toEqual(
      new TextEncoder().encode('original'),
    )
  })

  it('keeps the descriptor alive until native rendering has acknowledged closing', async () => {
    const { manager, renderer, path } = await fixture()
    const { source, file } = await manager.open(1, path)
    let nativeClosed!: () => void
    renderer.close.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          nativeClosed = resolve
        }),
    )
    const pending = manager.close(1, source.id)
    const bytes = new Uint8Array(1)
    expect(readSync(file.fd, bytes, 0, 1, 0)).toBe(1)
    expect(() => manager.read(1, source.id, 0, 1)).toThrow('not granted')
    nativeClosed()
    await pending
    expect(() => readSync(file.fd, bytes, 0, 1, 0)).toThrow()
  })

  it('rejects an open completing after the renderer reloads and bounds pending sources', async () => {
    const { manager, path } = await fixture()
    const opening = manager.open(1, path)
    await manager.closeOwner(1)
    await expect(opening).rejects.toThrow('closed while opening')
    const sources = await Promise.all(Array.from({ length: 4 }, () => manager.open(1, path)))
    await expect(manager.open(1, path)).rejects.toThrow('too many')
    expect(new Set(sources.map((s) => s.source.id)).size).toBe(4)
  })
})
