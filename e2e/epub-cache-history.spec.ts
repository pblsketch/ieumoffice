import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import JSZip from 'jszip'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl, type LaunchedApp } from './helpers'
import type { EpubApi } from '../apps/epub/src/shared/ipc'

async function removeScratch(dir: string): Promise<void> {
  const inside = relative(resolve(tmpdir()), resolve(dir))
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`))
    throw new Error('Scratch cleanup outside temp root')
  await rm(dir, { recursive: true, force: true })
}

test('EPUB cache churn preserves current editing, undo/redo and saved content after reopening', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ieum-epub-cache-gui-'))
  const path = join(dir, 'cache-history.epub')
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  )
  let manifest = ''
  let spine = ''
  for (let index = 0; index < 36; index++) {
    manifest += `<item id="c${index}" href="c${index}.xhtml" media-type="application/xhtml+xml"/>`
    spine += `<itemref idref="c${index}"/>`
    zip.file(
      `c${index}.xhtml`,
      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${index}</title></head><body><h1>Chapter ${index}</h1><p>Original paragraph ${index}.</p></body></html>`,
    )
  }
  zip.file(
    'book.opf',
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:epub-cache-history-test</dc:identifier><dc:title>Cache history</dc:title><dc:language>en</dc:language></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`,
  )
  await writeFile(path, await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))
  let launched: LaunchedApp | undefined
  try {
    launched = await launchShell({
      onboardingSeen: true,
      openFile: path,
      videoDir: 'epub-cache-history',
      recordVideo: false,
    })
    const page = await waitForPageWithUrl(launched.app, '://epub/')
    const paragraph = page.frameLocator('iframe.epub-frame').locator('p').first()
    await expect(paragraph).toHaveText('Original paragraph 0.')
    await expect(paragraph).toHaveAttribute('contenteditable', 'true')
    // The visible untouched model can leave the cache while its DOM stays editable.
    const churn = async () =>
      page.evaluate(async () => {
        const api = (window as unknown as { epubApi: EpubApi }).epubApi
        for (let index = 1; index < 36; index++) {
          const chapter = await api.readChapter(index)
          if (!chapter.ok) throw new Error('background chapter failed')
        }
      })
    await churn()
    await paragraph.fill('Edited paragraph zero.')
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const result = await (window as unknown as { epubApi: EpubApi }).epubApi.readChapter(0)
          return result.ok && result.source.includes('Edited paragraph zero.')
        }),
      )
      .toBe(true)
    await churn()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(paragraph).toHaveText('Original paragraph 0.')
    await churn()
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect(paragraph).toHaveText('Edited paragraph zero.')
    await page.keyboard.press('ControlOrMeta+s')
    await expect
      .poll(async () => {
        const saved = await JSZip.loadAsync(await readFile(path))
        return (await saved.file('c0.xhtml')!.async('string')).includes('Edited paragraph zero.')
      })
      .toBe(true)
    await closeAndSaveVideo(launched, 'epub-cache-history')
    launched = undefined
    launched = await launchShell({
      onboardingSeen: true,
      openFile: path,
      videoDir: 'epub-cache-history-reopen',
      recordVideo: false,
    })
    const reopened = await waitForPageWithUrl(launched.app, '://epub/')
    await expect(reopened.frameLocator('iframe.epub-frame').locator('p').first()).toHaveText(
      'Edited paragraph zero.',
    )
  } finally {
    if (launched) await closeAndSaveVideo(launched, 'epub-cache-history-final')
    await removeScratch(dir)
  }
})
