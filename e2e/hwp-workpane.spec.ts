/**
 * Left workpane (Outline & Find) end-to-end tests in the built Electron app.
 *
 * Covers spec §11 built-app E2E checklist for Bundle 1:
 * - Opening/closing the workpane (top-bar button + Ctrl+F focusing Find input)
 * - Outline tab: listing headings, level filtering, clicking to jump, dragging a
 *   section to reorder, and single-step Ctrl+Z undo
 * - Find tab: searching, selecting a match to replace in a single undo step,
 *   auto-refreshing results, and Ctrl+Z undo
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'

type RhwpCore = typeof import('@rhwp/core')
let rhwpReady: Promise<RhwpCore> | null = null

async function loadRhwp(): Promise<RhwpCore> {
  if (!rhwpReady) {
    rhwpReady = (async () => {
      const mod = await import('@rhwp/core')
      const wasm = join(__dirname, '..', 'vendor', 'rhwp-core', 'rhwp_bg.wasm')
      await mod.default({ module_or_path: readFileSync(wasm) })
      return mod
    })()
  }
  return rhwpReady
}

async function createWorkpaneFixture(): Promise<string> {
  const { HwpDocument } = await loadRhwp()
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  const styles = JSON.parse(doc.getStyleList()) as Array<{ id: number; name: string }>
  const idOf = (name: string) => styles.find((s) => s.name === name)?.id
  const h1 = idOf('개요 1')!
  const h2 = idOf('개요 2')!
  const lines: Array<[string, number | undefined]> = [
    ['문서 표지 머리말입니다.', undefined],
    ['첫째 장 서론', h1],
    ['서론 본문에 핵심 키워드가 들어 있습니다.', undefined],
    ['연구 배경', h2],
    ['배경 설명에도 키워드가 있습니다.', undefined],
    ['둘째 장 방법론', h1],
    ['방법론 본문의 키워드 분석입니다.', undefined],
  ]
  lines.forEach(([line, styleId], idx) => {
    if (idx > 0) doc.splitParagraph(0, idx - 1, doc.getParagraphLength(0, idx - 1))
    doc.insertText(0, idx, 0, line)
    doc.applyStyle(0, idx, styleId ?? 0)
  })
  const bytes = doc.exportHwpx()
  doc.free()
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-hwp-workpane-'))
  const file = join(dir, 'thesis-workpane.hwpx')
  writeFileSync(file, bytes)
  return file
}

async function hwpPage(app: Awaited<ReturnType<typeof launchShell>>['app']): Promise<Page> {
  const page = await waitForPageWithUrl(app, '://hwp/')
  await page.waitForSelector('.hwp-app[data-phase="ready"]', { timeout: 90_000 })
  await expect(
    page.frameLocator('.hwp-editor-host iframe').locator('[data-cmd="ext:ieum-save"]'),
  ).toHaveCount(1)
  return page
}

async function editorUndo(page: Page): Promise<void> {
  const frame = page.locator('.hwp-editor-host iframe')
  const box = (await frame.boundingBox())!
  await page.mouse.click(box.x + box.width * 0.5, box.y + 180)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
}

test('opens workpane via button and Ctrl+F, navigates and drag-moves outline with undo, and replaces from Find list with undo', async () => {
  const file = await createWorkpaneFixture()
  const launched = await launchShell({
    onboardingSeen: true,
    lang: 'ko',
    openFile: file,
    videoDir: 'hwp-workpane',
    recordVideo: false,
  })
  try {
    const page = await hwpPage(launched.app)

    // 1. Open workpane via top-bar button and verify Outline tab lists headings
    const toggle = page.locator('.workpane-toggle')
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(page.locator('.workpane-side')).not.toHaveClass(/collapsed/)

    const outlineTabBtn = page.locator('[data-workpane-tab="outline"]')
    await outlineTabBtn.click()
    const outlineRows = page.locator('[data-outline-row]')
    await expect(outlineRows).toHaveCount(3, { timeout: 15_000 })
    await expect(outlineRows.nth(0)).toContainText('첫째 장 서론')
    await expect(outlineRows.nth(1)).toContainText('연구 배경')
    await expect(outlineRows.nth(2)).toContainText('둘째 장 방법론')

    // Level filter 1 hides level-2 subheading, All restores it
    await page.locator('[data-outline-level-filter="1"]').click()
    await expect(outlineRows).toHaveCount(2)
    await page.locator('[data-outline-level-filter="all"]').click()
    await expect(outlineRows).toHaveCount(3)

    // Click a heading row to jump
    await outlineRows.nth(2).click()
    await expect(outlineRows.nth(2)).toHaveClass(/active/)

    // Drag heading 2 ("둘째 장 방법론") before heading 0 ("첫째 장 서론")
    const srcRow = outlineRows.nth(2)
    const dstRow = outlineRows.nth(0)
    const dstBox = (await dstRow.boundingBox())!
    await srcRow.dragTo(dstRow, {
      targetPosition: { x: dstBox.width / 2, y: Math.max(2, dstBox.height * 0.2) },
    })

    await expect(outlineRows.nth(0)).toContainText('둘째 장 방법론', { timeout: 15_000 })
    await expect(outlineRows.nth(1)).toContainText('첫째 장 서론')
    await expect(outlineRows.nth(2)).toContainText('연구 배경')

    // Single Ctrl+Z undo restores the original outline order
    await editorUndo(page)
    await expect(outlineRows.nth(0)).toContainText('첫째 장 서론', { timeout: 15_000 })
    await expect(outlineRows.nth(1)).toContainText('연구 배경')
    await expect(outlineRows.nth(2)).toContainText('둘째 장 방법론')

    // 2. Close workpane, then press Ctrl+F to open Find tab with focused query input
    await page.locator('.workpane-close-btn').click()
    await expect(page.locator('.workpane-side')).toHaveClass(/collapsed/)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f')
    await expect(page.locator('.workpane-side')).not.toHaveClass(/collapsed/)
    await expect(page.locator('[data-workpane-tab="find"]')).toHaveAttribute(
      'aria-selected',
      'true',
    )

    const queryInput = page.locator('[data-find-input="query"]')
    await expect(queryInput).toBeFocused()
    await queryInput.fill('키워드')
    await page.locator('[data-find-action="search"]').click()

    await expect(page.locator('[data-find-total]')).toHaveAttribute('data-find-total', '3', {
      timeout: 15_000,
    })
    await expect(page.locator('[data-find-row]')).toHaveCount(3)

    // Click second row to reveal without toggling checkbox, then check first two and replace selected
    await page.locator('[data-find-row="1"]').click()
    await page.locator('[data-find-row-check="0"]').check()
    await page.locator('[data-find-row-check="1"]').check()
    await page.locator('[data-find-input="replace"]').fill('핵심어')
    await page.locator('[data-find-action="replace-selected"]').click()

    // Auto-refreshes to 1 remaining match for '키워드'
    await expect(page.locator('[data-find-total]')).toHaveAttribute('data-find-total', '1', {
      timeout: 15_000,
    })

    // Single Ctrl+Z undoes both replacements at once; re-searching finds 3 again
    await editorUndo(page)
    await page.locator('[data-find-action="search"]').click()
    await expect(page.locator('[data-find-total]')).toHaveAttribute('data-find-total', '3', {
      timeout: 15_000,
    })
  } finally {
    await closeAndSaveVideo(launched, 'hwp-workpane')
  }
})
