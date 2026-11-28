// The main-process answer to a UI-font URL, shared by installRendererProtocol
// and the diagram tab's isolated session: listed files only, with CORS headers.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { UI_FONT_FILES, uiFontUrl } from '@genoffice/ui/ui-fonts'

import { uiFontResponse } from '../src/ui-font-response'
import { UI_FONTS_DIR_NAME, UI_FONTS_REPO_DIR, uiFontsDir } from '../src/ui-fonts-dir'

const FOLDER = resolve(import.meta.dirname, '../../ui/ui-fonts')

describe('uiFontResponse', () => {
  it('serves every listed file with its own bytes, woff2 MIME, and CORS header', async () => {
    for (const file of UI_FONT_FILES) {
      const res = await uiFontResponse(uiFontUrl(file), FOLDER)
      expect(res?.status, file).toBe(200)
      expect(res!.headers.get('Content-Type')).toBe('font/woff2')
      expect(res!.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(res!.headers.get('X-Content-Type-Options')).toBe('nosniff')
      const body = Buffer.from(await res!.arrayBuffer())
      expect(body.equals(readFileSync(join(FOLDER, file))), file).toBe(true)
    }
  })

  it('leaves every other URL alone without touching the disk', async () => {
    const read = vi.fn(() => Promise.resolve(new Uint8Array(4)))
    const urls = [
      'genoffice-app://ui-fonts/README.md',
      'genoffice-app://ui-fonts/Pretendard-OFL.txt',
      'genoffice-app://ui-fonts/..%2F..%2Fpackage.json',
      'genoffice-app://docs/index.html',
      'genoffice-docx-media://ui-fonts/PretendardVariable.woff2',
      'not a url',
    ]
    for (const url of urls) expect(await uiFontResponse(url, FOLDER, read), url).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })

  it('answers 404 when the folder lacks a listed file', async () => {
    const missing = await uiFontResponse(
      uiFontUrl('PretendardVariable.woff2'),
      join(FOLDER, 'no-such-folder'),
    )
    expect(missing?.status).toBe(404)
  })
})

describe('uiFontsDir', () => {
  it('resolves to resources/ui-fonts when packaged', () => {
    const dir = uiFontsDir({
      isPackaged: true,
      getAppPath: () => '/app/resources/app.asar',
      resourcesPath: '/app/resources',
    })
    expect(dir).toBe(join('/app/resources', UI_FONTS_DIR_NAME))
  })

  it('resolves to packages/ui/ui-fonts in a dev run', () => {
    const appPath = resolve('/repo/apps/shell')
    const dir = uiFontsDir({
      isPackaged: false,
      getAppPath: () => appPath,
      resourcesPath: '',
    })
    expect(dir).toBe(resolve('/repo', UI_FONTS_REPO_DIR))
  })
})
