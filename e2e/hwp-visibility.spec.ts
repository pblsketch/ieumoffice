import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'

test('shell tab visibility reaches HWP even when Chromium still reports visible', async () => {
  const launched = await launchShell({
    onboardingSeen: true,
    openFile: join(__dirname, '../apps/hwp/src/renderer/assets/blank.hwp'),
    recordVideo: false,
    videoDir: 'hwp-visibility',
  })
  try {
    const page = await waitForPageWithUrl(launched.app, '://hwp/')
    await page.locator('.hwp-app[data-phase="ready"]').waitFor({ timeout: 90_000 })
    const frame = page.frames().find((candidate) => candidate.url().includes('/studio/'))!
    const pixels = () =>
      frame
        .locator('#scroll-content canvas')
        .evaluateAll((canvases) =>
          canvases.reduce(
            (sum, canvas) =>
              sum + (canvas as HTMLCanvasElement).width * (canvas as HTMLCanvasElement).height,
            0,
          ),
        )
    await expect.poll(pixels).toBeGreaterThan(0)
    const visible = () =>
      page.evaluate(() =>
        (
          window as unknown as { aiOfficeViewVisibility: { getVisible(): Promise<boolean> } }
        ).aiOfficeViewVisibility.getVisible(),
      )
    await expect.poll(visible).toBe(true)
    const shell = await launched.app.firstWindow()
    await shell.locator('.tab-bar .tab-item.tab-home').click()
    await expect.poll(visible).toBe(false)
    await expect.poll(pixels).toBe(0)
    await shell.locator('.tab-bar .tab-item:not(.tab-home)', { hasText: 'blank.hwp' }).click()
    await expect.poll(visible).toBe(true)
    await expect.poll(pixels).toBeGreaterThan(0)
  } finally {
    await closeAndSaveVideo(launched, 'hwp-visibility')
  }
})
