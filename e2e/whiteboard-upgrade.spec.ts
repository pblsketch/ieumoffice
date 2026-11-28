import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeAndSaveVideo, launchShell } from './helpers'

interface ShellApis {
  aiOffice: {
    setTheme(theme: 'light' | 'dark'): Promise<void>
  }
}

async function waitWhiteboardPage(app: ElectronApplication, before: Set<Page>): Promise<Page> {
  let found: Page | undefined
  await expect
    .poll(
      () => {
        found = app.windows().find((p) => !before.has(p) && p.url().includes('://whiteboard/'))
        return found !== undefined
      },
      { timeout: 30_000 },
    )
    .toBe(true)
  await expect(found!.locator('.wb-stage-svg')).toHaveCount(1, { timeout: 30_000 })
  await expect(found!.locator('.wb-error-view')).toHaveCount(0)
  return found!
}

async function snap(board: Page, name: string): Promise<void> {
  const dir = process.env.WB_CAPTURE_DIR
  if (!dir) return
  await board.screenshot({ path: join(dir, name) })
}

test.describe('Whiteboard editor Miro-style upgrades (live Electron verification)', () => {
  test('marquee multi-select, multi-move/align/group, context menu, templates, table edit, minimap, search, dark theme', async () => {
    test.setTimeout(180_000)
    const launched = await launchShell({
      lang: 'ko',
      onboardingSeen: true,
      videoDir: 'whiteboard-upgrade',
      recordVideo: false,
    })
    const { app, page: shell } = launched

    try {
      // Open new Whiteboard from Home card.
      const card = shell.locator('.quick-card', {
        has: shell.locator('.quick-title', { hasText: /^화이트보드$/ }),
      })
      await expect(card).toHaveCount(1)
      const before = new Set(app.windows())
      await card.click()
      const board = await waitWhiteboardPage(app, before)

      // Collapse AI panel if open so full whiteboard canvas is visible.
      const collapseAi = board.getByRole('button', { name: '패널 접기' })
      if ((await collapseAi.count()) > 0) {
        await collapseAi.click()
        await board.waitForTimeout(150)
      }

      const svg = board.locator('.wb-stage-svg')
      const box = (await svg.boundingBox())!
      expect(box).not.toBeNull()

      // 1. Place 3 sticky notes cleanly spaced on the canvas.
      const positions = [
        { x: box.x + 250, y: box.y + 270, text: '아이디어 1' },
        { x: box.x + 500, y: box.y + 310, text: '아이디어 2' },
        { x: box.x + 750, y: box.y + 250, text: '아이디어 3' },
      ]
      for (const pos of positions) {
        await board.getByRole('button', { name: '포스트잇' }).click()
        await board.mouse.click(pos.x, pos.y)
        const editor = board.locator('.wb-inline-editor')
        await expect(editor).toBeVisible()
        await editor.fill(pos.text)
        await board.keyboard.press('Escape')
      }
      await expect(board.locator('[data-object-kind="sticky"]')).toHaveCount(3)

      // Clear selection by clicking empty top-left area.
      await board.mouse.click(box.x + 110, box.y + 80)
      await expect(board.locator('.wb-format-bar')).toHaveCount(0)

      // 2. Drag marquee selection box across all 3 stickies (capture mid-drag!).
      await board.mouse.move(box.x + 110, box.y + 90)
      await board.mouse.down()
      await board.mouse.move(box.x + 890, box.y + 450, { steps: 12 })
      await expect(board.locator('.wb-marquee-rect')).toHaveCount(1)
      await snap(board, '01-marquee-drag.png')
      await board.mouse.up()

      // Multi-selection unified bounding box + multi-select format bar visible.
      await expect(board.locator('.wb-group-selection-rect')).toHaveCount(1)
      await expect(board.locator('.wb-sel-count-chip')).toContainText('3')
      await snap(board, '02-multi-selected-bar.png')

      // 3. Align top + distribute horizontally via compact Align popover in format bar.
      await board.getByRole('button', { name: '정렬 및 분배' }).click()
      await board.getByRole('button', { name: '위쪽 정렬' }).click()
      await board.getByRole('button', { name: '정렬 및 분배' }).click()
      await board.getByRole('button', { name: '가로 균등 분배' }).click()

      // 4. Right-click on selection to open Context Menu.
      await board.mouse.click(box.x + 500, box.y + 250, { button: 'right' })
      await expect(board.locator('.wb-ctx-menu')).toBeVisible()
      await snap(board, '03-context-menu-aligned.png')
      await board.keyboard.press('Escape')

      // 5. Open Template Gallery modal (12 templates + category tabs), capture, and test templates.
      await board.getByRole('button', { name: '템플릿' }).click()
      await expect(board.locator('.wb-template-modal')).toBeVisible()
      await expect(board.locator('.wb-template-card')).toHaveCount(12)
      await snap(board, '04-template-gallery-12.png')
      // Insert Mind Map template.
      await board.locator('.wb-template-card', { hasText: '마인드맵' }).click()
      await expect(board.locator('.wb-page-tab')).toHaveCount(2)
      await board.waitForTimeout(300)
      await snap(board, '09-mindmap-template.png')
      // Insert Meeting Notes & Action Plan template.
      await board.getByRole('button', { name: '템플릿' }).click()
      await board.locator('.wb-template-card', { hasText: '회의록' }).click()
      await expect(board.locator('.wb-page-tab')).toHaveCount(3)
      await board.waitForTimeout(300)
      await snap(board, '10-meeting-notes-template.png')
      // Insert Business Model Canvas template.
      await board.getByRole('button', { name: '템플릿' }).click()
      await board.locator('.wb-template-card', { hasText: '비즈니스 모델' }).click()
      await expect(board.locator('.wb-page-tab')).toHaveCount(4)
      await board.waitForTimeout(300)
      await snap(board, '11-bmc-template.png')

      // 6. Add a Table on a new 5th page, inline edit a cell, open Minimap + Line Grid + Ctrl+F Search.
      await board.getByRole('button', { name: '+ 쪽 추가' }).click()
      await expect(board.locator('.wb-page-tab')).toHaveCount(5)
      await board.getByRole('button', { name: '표', exact: true }).click()
      const tbl = board.locator('[data-object-kind="table"]')
      await expect(tbl).toHaveCount(1)

      // Toggle line grid & minimap.
      await board.getByRole('button', { name: '점 격자' }).click()
      await board.getByRole('button', { name: '미니맵' }).click()
      await expect(board.locator('.wb-minimap')).toBeVisible()

      // Double-click inside the table body rect to open inline table cell editor and type Korean text.
      const tblRectBox = (await tbl.locator('rect').nth(1).boundingBox())!
      await board.mouse.dblclick(tblRectBox.x + 50, tblRectBox.y + 28)
      const cellInput = board.locator('.wb-table-cell-editor')
      await expect(cellInput).toBeVisible()
      await cellInput.fill('기능 항목')
      await cellInput.press('Tab')
      const nextCellInput = board.locator('.wb-table-cell-editor')
      await expect(nextCellInput).toBeVisible()
      await nextCellInput.fill('진행 상태')
      await snap(board, '06-table-edit-grid-minimap.png')
      await nextCellInput.press('Escape')

      // 7. Open Ctrl+F Search bar and search across pages ("아이디어": 3 on page 1 + 8 in mindmap = 11).
      await board.keyboard.press('Control+f')
      const searchInput = board.locator('.wb-search-input')
      await expect(searchInput).toBeVisible()
      await searchInput.fill('아이디어')
      await expect(board.locator('.wb-search-count')).toContainText('1 / 11')
      await board.waitForTimeout(200)
      await snap(board, '07-search-and-dark-check-light.png')

      // 8. Switch to dark theme and capture chrome adaptation with light paper.
      await shell.evaluate(() => (window as unknown as ShellApis).aiOffice.setTheme('dark'))
      await board.waitForTimeout(250)
      await snap(board, '08-dark-theme-minimap-search.png')
    } finally {
      await closeAndSaveVideo(launched, 'whiteboard-upgrade')
    }
  })
})
