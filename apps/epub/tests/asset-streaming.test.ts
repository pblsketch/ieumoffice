// @vitest-environment node
import JSZip from 'jszip'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { IDPF_FONT_OBFUSCATION, obfuscateFont, openEpub } from '@genoffice/epub-engine'
import { EpubBookSession } from '../src/main/book-session'
import { serveEpubAsset } from '../src/main/asset-protocol'
import { buildBook, BOOK_ID } from './helpers/book'

const token = '0123456789abcdef0123456789abcdef'
const request = (path: string, method = 'GET') => ({ url: `epub-asset://${token}/${path}`, method })

describe('streamed asset bodies', () => {
  it('does not read or decode an entry for HEAD', async () => {
    const opened = await openEpub(await buildBook({ extras: true }))
    if (!opened.ok) throw new Error('fixture refused')
    const read = vi.spyOn(opened.book, 'readForRendering')
    const stream = vi.spyOn(opened.book, 'streamForRendering')
    const response = await serveEpubAsset(
      request('OEBPS/images/pic.png', 'HEAD'),
      () => opened.book,
    )
    expect(response.status).toBe(200)
    expect(response.body).toBeNull()
    expect(read).not.toHaveBeenCalled()
    expect(stream).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'pins a source across close until its body is consumed or cancelled (cancel=%s)',
    async (cancel) => {
      const dir = await mkdtemp(join(tmpdir(), 'ieum-epub-assets-test-'))
      const cache = join(dir, 'cache')
      let session: EpubBookSession | undefined
      try {
        const bytes = new Uint8Array(3 * 1024 * 1024 + 1041)
        for (let i = 0; i < bytes.length; i++) bytes[i] = i & 255
        const zip = await JSZip.loadAsync(await buildBook({ extras: true }))
        zip.file('OEBPS/fonts/a.otf', obfuscateFont(bytes, IDPF_FONT_OBFUSCATION, BOOK_ID)!, {
          compression: 'STORE',
        })
        const path = join(dir, 'book.epub')
        await writeFile(path, await zip.generateAsync({ type: 'uint8array' }))
        const opened = await EpubBookSession.openFile(path, cache, 0)
        if (!opened.ok) throw new Error(opened.reason)
        session = opened.session
        const book = session.book
        const response = await serveEpubAsset(request('OEBPS/fonts/a.otf'), () => book)
        expect(response.status).toBe(200)
        const closing = session.dispose()
        if (cancel) await response.body!.cancel()
        else expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
        await closing
        expect(await readdir(cache)).toEqual([])
      } finally {
        await session?.dispose()
        await rm(dir, { recursive: true, force: true })
      }
    },
  )
})
