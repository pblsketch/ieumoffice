import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { PDFDocument, degrees, rgb } from 'pdf-lib'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'

for (const available of [false, true]) {
  test(`system OCR ${available ? 'uses the file renderer and survives save' : 'skips unavailable preparation'}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ieum-pdf-ocr-view-'))
    const target = resolve(dir)
    if (!target.startsWith(resolve(tmpdir()) + sep) || !target.includes('ieum-pdf-ocr-view-'))
      throw new Error('Unexpected scratch directory')
    const file = join(dir, 'scanned.pdf')
    const doc = await PDFDocument.create()
    const sheet = doc.addPage([612, 792])
    sheet.setRotation(degrees(90))
    sheet.drawRectangle({ x: 72, y: 100, width: 200, height: 300, color: rgb(1, 0, 0) })
    await writeFile(file, await doc.save())
    const before = createHash('sha256')
      .update(await readFile(file))
      .digest('hex')
    const launched = await launchShell({
      onboardingSeen: true,
      recordVideo: false,
      videoDir: 'pdf-ocr-view',
    })
    try {
      await launched.app.evaluate(({ ipcMain, nativeImage }, enabled) => {
        const state = {
          renders: [] as { width: number; height: number; thumbnail: boolean }[],
          images: [] as { width: number; height: number; colored: boolean }[],
        }
        ;(globalThis as any).__ocrViewTest = state
        const recognize = (_event: unknown, png: string) => {
          if (!enabled) throw new Error('Unavailable OCR must not render a page')
          const image = nativeImage.createFromBuffer(Buffer.from(png, 'base64'))
          const size = image.getSize()
          const pixels = image.toBitmap()
          let colored = false
          for (let offset = 0; offset < pixels.length; offset += 400)
            if (Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]) < 200) {
              colored = true
              break
            }
          state.images.push({ ...size, colored })
          return [{ text: 'Recognized', confidence: 0.99, box: [0.1, 0.8, 0.8, 0.9] }]
        }
        // PDF channels register lazily when the first PDF tab is created.
        const handle = ipcMain.handle.bind(ipcMain)
        ipcMain.handle = (channel, listener) => {
          handle(
            channel,
            channel === 'pdf:ocr-available'
              ? () => enabled
              : channel === 'pdf:ocr-page'
                ? recognize
                : listener,
          )
        }
        ipcMain.on('pdf:render-view-page', (_event, _ticket, request) => {
          if (request.thumbnail && Math.max(request.width, request.height) >= 2047)
            state.renders.push({ width: request.width, height: request.height, thumbnail: true })
        })
      }, available)
      await launched.page.evaluate((path) => (window as any).aiOffice.openPath(path), file)
      const page = await waitForPageWithUrl(launched.app, '://pdf/')
      await expect(page.locator('.pdf-page-content canvas').first()).toHaveAttribute(
        'data-pdf-view-backend',
        'file',
      )
      if (available) {
        await expect(page.locator('.pdf-ocr-layer')).toContainText('Recognized')
        const state = await launched.app.evaluate(() => (globalThis as any).__ocrViewTest)
        expect(state.renders).toHaveLength(1)
        expect(state.images).toHaveLength(1)
        expect(state.renders[0].width).toBe(2048)
        expect(state.images[0].width).toBe(2048)
        expect(state.images[0].height).toBeGreaterThan(1500)
        expect(state.images[0].colored).toBe(true)
        await page.keyboard.press('Control+f')
        await page.locator('.pdf-search-input').fill('Recognized')
        await expect(page.locator('.pdf-search-hit')).toHaveCount(1)
        await page.keyboard.press('Escape')
        await page.keyboard.press('Control+s')
        await expect
          .poll(async () =>
            createHash('sha256')
              .update(await readFile(file))
              .digest('hex'),
          )
          .not.toBe(before)
        await expect(page.locator('.pdf-page-content .textLayer')).toContainText('Recognized')
      } else {
        await page.waitForTimeout(500)
        const state = await launched.app.evaluate(() => (globalThis as any).__ocrViewTest)
        expect(state.images).toEqual([])
        expect(state.renders).toEqual([])
        expect(
          createHash('sha256')
            .update(await readFile(file))
            .digest('hex'),
        ).toBe(before)
      }
    } finally {
      await closeAndSaveVideo(launched)
      await rm(target, { recursive: true, force: true })
    }
  })
}
