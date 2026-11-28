import { test, expect } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl, screenshotPath } from './helpers'

test('pdf: Pages tab fits at 125% scaling (1536px) and shows scroll chevrons when narrow', async () => {
  test.setTimeout(180_000)
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-pdf-ribbon-overflow-'))
  const pdfPath = join(dir, 'sample.pdf')
  const blank = await PDFDocument.create()
  blank.addPage([595, 842])
  blank.addPage([595, 842])
  await writeFile(pdfPath, await blank.save({ useObjectStreams: false }))

  const launched = await launchShell({
    onboardingSeen: true,
    lang: 'ko',
    videoDir: 'pdf-ribbon-overflow',
    openFile: pdfPath,
  })

  try {
    const page = await waitForPageWithUrl(launched.app, '://pdf/')
    await page.waitForSelector('.ribbon-body', { timeout: 30_000 })
    await page.waitForTimeout(800)

    const setWinWidth = async (width: number, height = 820) => {
      await launched.app.evaluate(
        ({ BrowserWindow }, { w, h }) => {
          const win = BrowserWindow.getAllWindows()[0]
          if (win) {
            if (win.isMaximized()) win.unmaximize()
            win.setContentSize(w, h)
          }
        },
        { w: width, h: height },
      )
      await page.waitForTimeout(400)
    }

    const measureRibbon = () =>
      page.evaluate(() => {
        const body = document.querySelector('.ribbon-body') as HTMLElement | null
        if (!body) return null
        return {
          clientWidth: body.clientWidth,
          scrollWidth: body.scrollWidth,
          clientHeight: body.clientHeight,
          scrollHeight: body.scrollHeight,
          scrollLeft: body.scrollLeft,
          hasLeftBtn: !!document.querySelector('.ribbon-scroll-left'),
          hasRightBtn: !!document.querySelector('.ribbon-scroll-right'),
        }
      })

    // 1. 1920x1080 @ 125% Windows display scaling = 1536px logical width
    await setWinWidth(1536)
    await page.getByRole('button', { name: '페이지', exact: true }).click()
    await page.waitForTimeout(300)

    const at1536 = (await measureRibbon())!
    expect(at1536.scrollWidth, 'Pages tab should fit cleanly at 1536px').toBeLessThanOrEqual(
      at1536.clientWidth + 1,
    )
    expect(at1536.scrollHeight, 'Pages tab should not clip vertically').toBeLessThanOrEqual(
      at1536.clientHeight + 1,
    )
    expect(at1536.hasLeftBtn).toBe(false)
    expect(at1536.hasRightBtn).toBe(false)
    await expect(page.getByRole('button', { name: 'PDF 도구', exact: true })).toBeVisible()
    await page.screenshot({ path: screenshotPath('pdf-pages-tab-1536') })

    // 2. 1920x1080 @ 150% display scaling = 1280px logical width
    await setWinWidth(1280)
    const at1280 = (await measureRibbon())!
    expect(at1280.scrollWidth, 'Pages tab should also fit at 1280px').toBeLessThanOrEqual(
      at1280.clientWidth + 1,
    )
    expect(at1280.hasRightBtn).toBe(false)
    await page.screenshot({ path: screenshotPath('pdf-pages-tab-1280') })

    // 3. Narrow window (760px): overflow chevrons appear and scroll cleanly
    await setWinWidth(760)
    const narrowStart = (await measureRibbon())!
    expect(narrowStart.scrollWidth).toBeGreaterThan(narrowStart.clientWidth)
    expect(narrowStart.hasLeftBtn).toBe(false)
    expect(narrowStart.hasRightBtn).toBe(true)
    await page.screenshot({ path: screenshotPath('pdf-pages-tab-760-start') })

    await page.locator('.ribbon-scroll-right').click()
    await expect.poll(async () => (await measureRibbon())!.scrollLeft).toBeGreaterThan(0)
    await expect(page.locator('.ribbon-scroll-left')).toBeVisible()
    await page.screenshot({ path: screenshotPath('pdf-pages-tab-760-scrolled') })

    // Scroll back to start via left chevron
    await page.locator('.ribbon-scroll-left').click()
    await expect.poll(async () => (await measureRibbon())!.scrollLeft).toBe(0)
    await expect(page.locator('.ribbon-scroll-left')).toHaveCount(0)

    // Mouse wheel over the overflowing ribbon scrolls horizontally
    const box = (await page.locator('.ribbon-body').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, 180)
    await expect.poll(async () => (await measureRibbon())!.scrollLeft).toBeGreaterThan(0)
  } finally {
    await closeAndSaveVideo(launched, 'pdf-ribbon-overflow')
  }
})
