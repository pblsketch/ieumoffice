/**
 * Table of contents (dotted-tab) creation, refresh, and Ctrl+click heading link
 * navigation end-to-end tests in the built Electron app.
 *
 * Covers Bundle 2 built-app E2E checklist:
 * - Creating a dotted-tab TOC via Tool menu > Create Table of Contents
 * - Ctrl+clicking a TOC entry link to jump caret and viewport to the heading
 * - Refreshing the TOC after editing a heading via Tool menu > Refresh TOC
 */
import { test, expect } from '@playwright/test'
import type { Frame, FrameLocator, Page } from '@playwright/test'
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

interface StudioProbeServices {
  wasm: {
    getParagraphCount(sec: number): number
    getParagraphLength(sec: number, para: number): number
    getTextRange(sec: number, para: number, offset: number, count: number): string
    getSelectionRects(
      sec: number,
      startPara: number,
      startChar: number,
      endPara: number,
      endChar: number,
    ): Array<{ pageIndex: number; x: number; y: number; width: number; height: number }>
  }
  getInputHandler(): {
    container: HTMLElement
    cursor: {
      getPosition(): { sectionIndex: number; paragraphIndex: number; charOffset: number }
    }
    virtualScroll: {
      getPageLeftResolved(page: number, containerWidth: number): number
      getPageOffset(page: number): number
    }
    viewportManager: { getZoom(): number }
  }
}

interface StudioLike {
  automation: {
    registerCommand(def: {
      id: string
      label: string
      execute(services: StudioProbeServices): void
    }): void
    execute(id: string): unknown
  }
}

async function createTocFixture(): Promise<string> {
  const { HwpDocument } = await loadRhwp()
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  const styles = JSON.parse(doc.getStyleList()) as Array<{ id: number; name: string }>
  const idOf = (name: string) => styles.find((s) => s.name === name)?.id
  const h1 = idOf('개요 1')!
  const h2 = idOf('개요 2')!
  const lines: Array<[string, number | undefined, boolean?]> = [
    ['차례 자리', undefined, false],
    ['첫째 장 서론', h1, false],
    ['서론 본문 설명입니다.', undefined, false],
    ['연구 배경', h2, false],
    ['둘째 장 방법론', h1, true],
    ['방법론 본문 설명입니다.', undefined, false],
  ]
  lines.forEach(([line, styleId, pageBreak], idx) => {
    if (idx > 0) doc.splitParagraph(0, idx - 1, doc.getParagraphLength(0, idx - 1))
    doc.insertText(0, idx, 0, line)
    doc.applyStyle(0, idx, styleId ?? 0)
    if (pageBreak) {
      doc.applyParaFormat(0, idx, JSON.stringify({ pageBreakBefore: true }))
    }
  })
  const bytes = doc.exportHwpx()
  doc.free()
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-hwp-toc-'))
  const file = join(dir, 'thesis-toc.hwpx')
  writeFileSync(file, bytes)
  return file
}

async function hwpPage(app: Awaited<ReturnType<typeof launchShell>>['app']): Promise<Page> {
  const page = await waitForPageWithUrl(app, '://hwp/')
  await page.waitForSelector('.hwp-app[data-phase="ready"]', { timeout: 90_000 })
  await expect(
    page.frameLocator('.hwp-editor-host iframe').locator('[data-cmd="ext:ieum-toc-create"]'),
  ).toHaveCount(1, { timeout: 15_000 })
  return page
}

async function studioFrame(page: Page): Promise<Frame> {
  const deadline = Date.now() + 60_000
  for (;;) {
    const frame = page.frames().find((f) => f.url().includes('/studio/'))
    if (frame) return frame
    if (Date.now() > deadline) throw new Error('studio frame never loaded')
    await page.waitForTimeout(100)
  }
}

async function clickToolMenuItem(studio: FrameLocator, commandId: string): Promise<void> {
  const toolButton = studio.locator('#menu-bar .menu-item[data-menu="tool"] .menu-title')
  await expect(toolButton).toBeVisible({ timeout: 10_000 })
  await toolButton.click()
  const menuItem = studio.locator(`.md-item[data-cmd="${commandId}"]`)
  await expect(menuItem).toBeVisible({ timeout: 10_000 })
  await menuItem.click()
}

test('creates dotted-tab TOC via Tool menu, Ctrl+clicks TOC link to jump to page 2 heading, and refreshes TOC', async () => {
  test.setTimeout(180_000)
  const file = await createTocFixture()
  const launched = await launchShell({
    onboardingSeen: true,
    lang: 'ko',
    openFile: file,
    videoDir: 'hwp-toc-index',
    recordVideo: false,
  })
  try {
    const page = await hwpPage(launched.app)
    const studio = page.frameLocator('.hwp-editor-host iframe')
    const frame = await studioFrame(page)

    // Open the Outline workpane to verify headings before & after TOC creation/navigation
    await page.locator('.workpane-toggle').click()
    await expect(page.locator('.workpane-side')).not.toHaveClass(/collapsed/)
    await page.locator('[data-workpane-tab="outline"]').click()
    const outlineRows = page.locator('[data-outline-row]')
    await expect(outlineRows).toHaveCount(3, { timeout: 15_000 })
    await expect(outlineRows.nth(0)).toContainText('첫째 장 서론')
    await expect(outlineRows.nth(1)).toContainText('연구 배경')
    await expect(outlineRows.nth(2)).toContainText('둘째 장 방법론')

    // 1. Create a dotted-tab TOC via Tool menu > Create Table of Contents
    await clickToolMenuItem(studio, 'ext:ieum-toc-create')
    const modal = studio.locator('.modal-overlay .dialog-wrap')
    await expect(modal).toBeVisible({ timeout: 10_000 })
    await expect(modal.locator('select[data-field="layout"]')).toHaveValue('dotted-tab')
    await expect(modal.locator('input[data-field="links"]')).toBeChecked()
    await modal.locator('.dialog-btn-primary').click()
    await expect(modal).toBeHidden({ timeout: 10_000 })

    // 2. Inspect created TOC paragraphs and exact screen coords of the entry link for "둘째 장 방법론"
    const tocProbe = await frame.evaluate(() => {
      const scope = window as unknown as {
        rhwpStudio: StudioLike
        __e2eTocProbe?: {
          paras: string[]
          tocEntryPara: number
          headingPara: number
          linkCenter: { x: number; y: number }
        }
      }
      scope.rhwpStudio.automation.registerCommand({
        id: 'ext:e2e-toc-probe',
        label: 'E2E TOC probe',
        execute(services) {
          const ih = services.getInputHandler()
          const count = services.wasm.getParagraphCount(0)
          const paras: string[] = []
          for (let p = 0; p < count; p++) {
            const len = services.wasm.getParagraphLength(0, p)
            paras.push(len > 0 ? services.wasm.getTextRange(0, p, 0, len) : '')
          }
          // Dotted-tab TOC line contains the heading text + tab + printed page number
          const tocEntryPara = paras.findIndex(
            (t) => t.includes('둘째 장 방법론') && t.includes('\t'),
          )
          const headingPara = paras.findIndex(
            (t, i) => i > tocEntryPara && t.includes('둘째 장 방법론'),
          )
          const content = ih.container.querySelector('#scroll-content')!
          const box = content.getBoundingClientRect()
          const zoom = ih.viewportManager.getZoom()
          const titleLen = paras[tocEntryPara].indexOf('\t')
          const rect = services.wasm.getSelectionRects(
            0,
            tocEntryPara,
            0,
            tocEntryPara,
            Math.max(1, titleLen),
          )[0]
          const pageLeft = ih.virtualScroll.getPageLeftResolved(rect.pageIndex, content.clientWidth)
          const pageTop = ih.virtualScroll.getPageOffset(rect.pageIndex)
          scope.__e2eTocProbe = {
            paras,
            tocEntryPara,
            headingPara,
            linkCenter: {
              x: box.left + pageLeft + (rect.x + Math.min(rect.width * 0.4, 40)) * zoom,
              y: box.top + pageTop + (rect.y + rect.height / 2) * zoom,
            },
          }
        },
      })
      scope.rhwpStudio.automation.execute('ext:e2e-toc-probe')
      return scope.__e2eTocProbe!
    })

    expect(tocProbe.paras[0]).toBe('차례')
    expect(tocProbe.tocEntryPara).toBeGreaterThan(0)
    expect(tocProbe.paras[tocProbe.tocEntryPara]).toMatch(/둘째 장 방법론\t2/)
    expect(tocProbe.headingPara).toBeGreaterThan(tocProbe.tocEntryPara)

    // 3. Ctrl+click the TOC entry link and verify caret jumps to the heading paragraph on page 2
    const iframeBox = (await page.locator('.hwp-editor-host iframe').boundingBox())!
    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.down(modKey)
    await page.mouse.click(iframeBox.x + tocProbe.linkCenter.x, iframeBox.y + tocProbe.linkCenter.y)
    await page.keyboard.up(modKey)

    // Verify caret moved directly to the target heading paragraph on page 2
    const caretAfterJump = await frame.evaluate(() => {
      const scope = window as unknown as {
        rhwpStudio: StudioLike
        __e2eCaretAfterJump?: { sectionIndex: number; paragraphIndex: number; charOffset: number }
      }
      scope.rhwpStudio.automation.registerCommand({
        id: 'ext:e2e-caret-read',
        label: 'E2E caret read',
        execute(services) {
          scope.__e2eCaretAfterJump = services.getInputHandler().cursor.getPosition()
        },
      })
      scope.rhwpStudio.automation.execute('ext:e2e-caret-read')
      return scope.__e2eCaretAfterJump!
    })
    expect(caretAfterJump.sectionIndex).toBe(0)
    expect(caretAfterJump.paragraphIndex).toBe(tocProbe.headingPara)
    await expect(outlineRows.nth(2)).toHaveClass(/active/, { timeout: 10_000 })

    // 4. Edit the jumped-to heading ("둘째 장 방법론" -> "둘째 장 방법론 수정") and refresh TOC via Tool menu
    await page.keyboard.press('End')
    await page.keyboard.type(' 수정')
    await expect(outlineRows.nth(2)).toContainText('둘째 장 방법론 수정', { timeout: 10_000 })

    await clickToolMenuItem(studio, 'ext:ieum-toc-refresh')
    await expect(studio.locator('.modal-overlay .dialog-wrap')).toBeHidden({ timeout: 10_000 })

    // Verify the refreshed TOC entry on page 1 now reflects the updated heading title & page 2
    const refreshedParas = await frame.evaluate(() => {
      const scope = window as unknown as {
        rhwpStudio: StudioLike
        __e2eRefreshedParas?: string[]
      }
      scope.rhwpStudio.automation.registerCommand({
        id: 'ext:e2e-toc-refreshed',
        label: 'E2E TOC refreshed',
        execute(services) {
          const count = services.wasm.getParagraphCount(0)
          const paras: string[] = []
          for (let p = 0; p < count; p++) {
            const len = services.wasm.getParagraphLength(0, p)
            paras.push(len > 0 ? services.wasm.getTextRange(0, p, 0, len) : '')
          }
          scope.__e2eRefreshedParas = paras
        },
      })
      scope.rhwpStudio.automation.execute('ext:e2e-toc-refreshed')
      return scope.__e2eRefreshedParas!
    })
    expect(refreshedParas.some((t) => /둘째 장 방법론 수정\t2/.test(t))).toBe(true)
  } finally {
    await closeAndSaveVideo(launched)
  }
})
