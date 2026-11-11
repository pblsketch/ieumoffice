import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'

test('viewport tiles retain text selection, editable fields, scrolling and save', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ieum-pdf-tiles-'))
  const target = resolve(dir)
  if (!target.startsWith(resolve(tmpdir()) + sep) || !target.includes('ieum-pdf-tiles-'))
    throw new Error('Unexpected scratch directory')
  const file = join(dir, 'editable.pdf')
  const doc = await PDFDocument.create()
  const sheet = doc.addPage([612, 792])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  sheet.drawText('Selectable tile document', { x: 24, y: 745, size: 14, font })
  sheet.drawRectangle({ x: 50, y: 90, width: 300, height: 400, color: rgb(0.2, 0.4, 0.7) })
  doc
    .getForm()
    .createTextField('editable')
    .addToPage(sheet, { x: 24, y: 690, width: 180, height: 30, font })
  await writeFile(file, await doc.save())
  const launched = await launchShell({
    onboardingSeen: true,
    openFile: file,
    videoDir: 'pdf-view-tiles',
    recordVideo: false,
  })
  try {
    const page = await waitForPageWithUrl(launched.app, '://pdf/')
    await expect(page.locator('.pdf-page-content canvas').first()).toHaveAttribute(
      'data-pdf-view-backend',
      'file',
    )
    await page.locator('.zoom-slider').evaluate((element) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        element,
        '400',
      )
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await expect(page.locator('.zoom-value')).toHaveText('400%')
    const tiles = page.locator('[data-pdf-tile-surface] canvas')
    await expect(tiles.first()).toHaveAttribute('data-pdf-view-backend', 'file')
    const pixels = await tiles.evaluateAll((canvases) =>
      canvases.reduce(
        (n, canvas) =>
          n + (canvas as HTMLCanvasElement).width * (canvas as HTMLCanvasElement).height,
        0,
      ),
    )
    expect(pixels).toBeLessThan(2448 * 3168)
    await expect(page.locator('.pdf-page-content .textLayer')).toContainText(
      'Selectable tile document',
    )
    expect(
      await page.locator('.textLayer').evaluate((element) => {
        window.getSelection()!.selectAllChildren(element)
        return window.getSelection()!.toString()
      }),
    ).toContain('Selectable tile document')
    await page.locator('.pdf-form-input').fill('Saved through tiles')
    await page.keyboard.press('Control+s')
    await expect
      .poll(async () =>
        (await PDFDocument.load(await readFile(file))).getForm().getTextField('editable').getText(),
      )
      .toBe('Saved through tiles')
    await expect(page.locator('.pdf-form-input')).toHaveValue('Saved through tiles')
    await page.locator('.pdf-scroll').evaluate((element) => {
      element.scrollTop = 1400
    })
    await expect.poll(async () => tiles.count()).toBeGreaterThan(0)
    expect(
      await tiles.evaluateAll((canvases) =>
        canvases.every(
          (canvas) =>
            (canvas as HTMLCanvasElement).width <= 512 &&
            (canvas as HTMLCanvasElement).height <= 512,
        ),
      ),
    ).toBe(true)
    await page.locator('.pdf-form-input').fill('Unsaved through hide')
    const shell = await launched.app.firstWindow()
    await shell.locator('.tab-bar .tab-item.tab-home').click()
    await expect
      .poll(async () =>
        page
          .locator('.pdf-page-content canvas')
          .evaluateAll((canvases) =>
            canvases.reduce(
              (sum, canvas) =>
                sum + (canvas as HTMLCanvasElement).width * (canvas as HTMLCanvasElement).height,
              0,
            ),
          ),
      )
      .toBe(0)
    await shell.locator('.tab-bar .tab-item:not(.tab-home)', { hasText: 'editable.pdf' }).click()
    await expect(page.locator('.pdf-form-input')).toHaveValue('Unsaved through hide')
  } finally {
    await closeAndSaveVideo(launched)
    await rm(target, { recursive: true, force: true })
  }
})
