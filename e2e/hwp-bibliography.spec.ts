/**
 * Hangul bibliography management, citation insertion, bibliography generation,
 * citation style switching (APA -> IEEE), and single-step undo end-to-end tests
 * in the built Electron app.
 *
 * Covers Bundle 3 built-app E2E checklist:
 * - Adding a Korean reference entry in the left workpane References tab
 * - Selecting the entry and inserting an APA 7 in-text citation
 * - Inserting a formatted bibliography block with hanging indent
 * - Switching document citation style from APA 7 to IEEE
 * - Undoing once to revert both the citation and bibliography back to APA 7
 */
import { test, expect } from '@playwright/test'
import type { Frame, Page } from '@playwright/test'
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
  }
  getInputHandler(): {
    cursor: {
      moveTo(pos: { sectionIndex: number; paragraphIndex: number; charOffset: number }): void
    }
  }
}

interface StudioLike {
  automation: {
    registerCommand(def: {
      id: string
      label: string
      execute(services: StudioProbeServices): void
    }): void
    unregisterCommand?(id: string): void
    execute(id: string): unknown
  }
}

async function createBibliographyFixture(): Promise<string> {
  const { HwpDocument } = await loadRhwp()
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  const lines = ['참고문헌 시험 문서', '선행 연구에 따르면 교육 효과가 크다.', '']
  lines.forEach((line, idx) => {
    if (idx > 0) doc.splitParagraph(0, idx - 1, doc.getParagraphLength(0, idx - 1))
    if (line.length > 0) doc.insertText(0, idx, 0, line)
    doc.applyStyle(0, idx, 0)
  })
  const bytes = doc.exportHwpx()
  doc.free()
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-hwp-bib-'))
  const file = join(dir, 'thesis-bibliography.hwpx')
  writeFileSync(file, bytes)
  return file
}

async function hwpPage(app: Awaited<ReturnType<typeof launchShell>>['app']): Promise<Page> {
  const page = await waitForPageWithUrl(app, '://hwp/')
  await page.waitForSelector('.hwp-app[data-phase="ready"]', { timeout: 90_000 })
  await expect(
    page.frameLocator('.hwp-editor-host iframe').locator('[data-cmd="ext:ieum-bib-open-tab"]'),
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

async function readBodyParagraphs(frame: Frame): Promise<string[]> {
  return frame.evaluate(() => {
    const scope = window as unknown as {
      rhwpStudio: StudioLike
      __e2eBibParas?: string[]
    }
    try {
      scope.rhwpStudio.automation.unregisterCommand?.('ext:e2e-bib-read-paras')
    } catch {
      // Command not yet registered.
    }
    scope.rhwpStudio.automation.registerCommand({
      id: 'ext:e2e-bib-read-paras',
      label: 'E2E bibliography paragraph read',
      execute(services) {
        const count = services.wasm.getParagraphCount(0)
        const paras: string[] = []
        for (let p = 0; p < count; p++) {
          const len = services.wasm.getParagraphLength(0, p)
          paras.push(len > 0 ? services.wasm.getTextRange(0, p, 0, len) : '')
        }
        scope.__e2eBibParas = paras
      },
    })
    scope.rhwpStudio.automation.execute('ext:e2e-bib-read-paras')
    return scope.__e2eBibParas!
  })
}

async function moveCaret(frame: Frame, paragraphIndex: number, toEnd = false): Promise<void> {
  await frame.evaluate(
    ({ targetPara, end }) => {
      const scope = window as unknown as { rhwpStudio: StudioLike }
      try {
        scope.rhwpStudio.automation.unregisterCommand?.('ext:e2e-bib-move-caret')
      } catch {
        // Command not yet registered.
      }
      scope.rhwpStudio.automation.registerCommand({
        id: 'ext:e2e-bib-move-caret',
        label: 'E2E bibliography move caret',
        execute(services) {
          const charOffset = end ? services.wasm.getParagraphLength(0, targetPara) : 0
          services.getInputHandler().cursor.moveTo({
            sectionIndex: 0,
            paragraphIndex: targetPara,
            charOffset,
          })
        },
      })
      scope.rhwpStudio.automation.execute('ext:e2e-bib-move-caret')
    },
    { targetPara: paragraphIndex, end: toEnd },
  )
}

test('adds a reference in the Bibliography tab, inserts a citation, inserts a bibliography list, switches style (APA -> IEEE), and undoes in one step', async () => {
  test.setTimeout(180_000)
  const file = await createBibliographyFixture()
  const launched = await launchShell({
    onboardingSeen: true,
    lang: 'ko',
    openFile: file,
    videoDir: 'hwp-bibliography',
    recordVideo: false,
  })
  try {
    const page = await hwpPage(launched.app)
    const frame = await studioFrame(page)

    // 1. Open left workpane and switch to the References tab
    await page.locator('.workpane-toggle').click()
    await expect(page.locator('.workpane-side')).not.toHaveClass(/collapsed/)
    await page.locator('[data-workpane-tab="bibliography"]').click()
    await expect(page.locator('[data-testid="bib-tab"]')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-testid="bib-style-select"]')).toHaveValue('apa')

    // 2. Add a Korean book reference via the BibliographyTab form
    await page.locator('[data-testid="bib-add-btn"]').click()
    const form = page.locator('[data-testid="bib-entry-form"]')
    await expect(form).toBeVisible({ timeout: 10_000 })
    await form.locator('[data-testid="bib-type-select"]').selectOption('book')
    await form.locator('[data-testid="bib-title-input"]').fill('실천교육학의 이해')
    await form.locator('[data-testid="bib-author-input"]').fill('홍길동')
    await form.locator('[data-testid="bib-year-input"]').fill('2020')
    await form.locator('[data-testid="bib-more-fields-btn"]').click()
    await form.getByLabel('출판사').fill('학지사')
    await form.locator('[data-testid="bib-save-btn"]').click()
    await expect(form).toBeHidden({ timeout: 10_000 })

    const entryRow = page.locator('[data-testid="bib-entry-row"]').first()
    await expect(entryRow).toBeVisible({ timeout: 10_000 })
    await expect(entryRow).toContainText('실천교육학의 이해')
    await expect(entryRow).toContainText('홍길동')

    // 3. Move caret to end of body sentence, select the entry, and insert an APA citation
    await moveCaret(frame, 1, true)
    await entryRow.locator('input[type="checkbox"]').check()
    await page.locator('[data-testid="bib-insert-citation-btn"]').click()
    const composer = page.locator('[data-testid="bib-citation-composer"]')
    await expect(composer).toBeVisible({ timeout: 10_000 })
    await composer.locator('[data-testid="bib-composer-submit-btn"]').click()
    await expect(composer).toBeHidden({ timeout: 10_000 })

    await expect
      .poll(async () => (await readBodyParagraphs(frame))[1], { timeout: 10_000 })
      .toContain('(홍길동, 2020)')

    // 4. Move caret to trailing paragraph and insert the bibliography list
    await moveCaret(frame, 2, false)
    await page.locator('[data-testid="bib-insert-list-btn"]').click()

    await expect
      .poll(
        async () => {
          const paras = await readBodyParagraphs(frame)
          return (
            paras.includes('참고문헌') && paras.includes('홍길동(2020). 실천교육학의 이해. 학지사.')
          )
        },
        { timeout: 15_000 },
      )
      .toBe(true)

    // 5. Switch document citation style from APA 7 to IEEE and verify citation + bibliography update
    await page.locator('[data-testid="bib-style-select"]').selectOption('ieee')

    await expect
      .poll(
        async () => {
          const paras = await readBodyParagraphs(frame)
          const bodyLine = paras[1] ?? ''
          return (
            bodyLine.includes('[1]') &&
            !bodyLine.includes('(홍길동, 2020)') &&
            paras.includes('[1] 홍길동(2020). 실천교육학의 이해. 학지사.')
          )
        },
        { timeout: 15_000 },
      )
      .toBe(true)

    // 6. Trigger a single Undo step and confirm both citation and bibliography revert to APA 7
    await frame.evaluate(() => {
      const scope = window as unknown as { rhwpStudio: StudioLike }
      scope.rhwpStudio.automation.execute('edit:undo')
    })

    await expect
      .poll(
        async () => {
          const paras = await readBodyParagraphs(frame)
          const bodyLine = paras[1] ?? ''
          return (
            bodyLine.includes('(홍길동, 2020)') &&
            !bodyLine.includes('[1]') &&
            paras.includes('홍길동(2020). 실천교육학의 이해. 학지사.') &&
            !paras.includes('[1] 홍길동(2020). 실천교육학의 이해. 학지사.')
          )
        },
        { timeout: 15_000 },
      )
      .toBe(true)
  } finally {
    await closeAndSaveVideo(launched, 'hwp-bibliography')
  }
})
