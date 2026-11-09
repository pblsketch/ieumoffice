import { test, expect, type Page } from '@playwright/test'

import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'

/// Regression for the 2026-11-09 report: typing a Korean consonant and then
/// using the IME's Hanja special-character picker typed the consonant twice in
/// AI Sheets. The IME commits the consonant with compositionend and then sends
/// one more plain input event carrying the same text; Univer inserted both.
/// This spec drives that trailing input event directly, since the candidate
/// window itself cannot be scripted.
test.describe('sheets: IME composition commit', () => {
  test('a trailing input event does not insert the committed consonant again', async () => {
    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'sheets-ime-duplicate',
      env: { GENOFFICE_DEBUG_HOOKS: '1' },
    })
    try {
      const { app, page } = launched
      await expect(
        page.locator('.quick-card').filter({ hasText: 'AI Sheets' }).first(),
      ).toBeVisible()
      await page.locator('.quick-card').filter({ hasText: 'AI Sheets' }).first().click()

      const sheets = await waitForPageWithUrl(app, '://sheets/')
      await sheets.waitForFunction(() => document.body.textContent?.includes('Sheet1'), null, {
        timeout: 30_000,
      })
      await sheets.waitForTimeout(1_500)

      const grid = await sheets.evaluate(() => {
        for (const canvas of document.querySelectorAll('canvas')) {
          const rect = canvas.getBoundingClientRect()
          if (rect.width > 500 && rect.height > 300) return { x: rect.x, y: rect.y }
        }
        return null
      })
      if (!grid) throw new Error('worksheet canvas not found')
      await sheets.mouse.dblclick(grid.x + 46 + 43, grid.y + 24 + 12)
      await expect(sheets.locator('[data-u-comp="defined-name"] input')).toHaveValue('A1')

      const cdp = await sheets.context().newCDPSession(sheets)
      await cdp.send('Input.imeSetComposition', {
        text: 'ㅁ',
        selectionStart: 1,
        selectionEnd: 1,
      })
      await sheets.waitForTimeout(150)
      await cdp.send('Input.insertText', { text: 'ㅁ' })
      await sheets.waitForTimeout(150)

      // The IME's Hanja picker follows the commit with an ordinary input event
      // that still carries the consonant. The document is updated before the
      // event fires, exactly as the browser does it.
      await sheets.evaluate(() => {
        const editor = document.activeElement
        if (!(editor instanceof HTMLElement) || !editor.isContentEditable) {
          throw new Error('the hidden sheet editor is not focused')
        }
        editor.textContent = 'ㅁ'
        editor.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: 'ㅁ',
            inputType: 'insertText',
            isComposing: false,
          }),
        )
      })
      await sheets.keyboard.press('Enter')

      await expect.poll(() => cellValue(sheets, 'A1')).toBe('ㅁ')

      // Normal typing after the composition must still land (the guard only
      // drops the trailing event of that one commit).
      await sheets.keyboard.insertText('ㅁ')
      await sheets.keyboard.press('Enter')
      await expect.poll(() => cellValue(sheets, 'A2')).toBe('ㅁ')
    } finally {
      await closeAndSaveVideo(launched, 'sheets-ime-duplicate')
    }
  })
})

async function cellValue(page: Page, address: string): Promise<unknown> {
  return page.evaluate((a) => {
    const api = (
      window as unknown as {
        __genofficeDebug?: {
          univerAPI?: {
            getActiveWorkbook?: () => {
              getActiveSheet?: () => {
                getRange?: (a: string) => { getValue?: () => unknown } | null
              }
            } | null
          }
        }
      }
    ).__genofficeDebug?.univerAPI
    return api?.getActiveWorkbook?.()?.getActiveSheet?.()?.getRange?.(a)?.getValue?.() ?? null
  }, address)
}
