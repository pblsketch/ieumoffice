import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication } from '@playwright/test'
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib'
import { closeAndSaveVideo, launchShell, screenshotPath, waitForPageWithUrl } from './helpers'

/**
 * Live built-app verification for the upgraded PDF Split experience (Phase 1+2):
 * - PDF Editor visual SplitDialog (thumbnails, scissor cuts, 4 tabs, file list
 *   preview, real bookmark split into subfolder, thumbnail context-menu shortcut)
 * - PDF Tools window Split (4 tabs, bookmark reading, merged-range output,
 *   bookmark split output, and "Cut visually in editor" handoff)
 * - Dark-theme visual check of SplitDialog
 */

const EVIDENCE_DIR = process.env.PDF_SPLIT_EVIDENCE_DIR
const shot = (name: string) =>
  EVIDENCE_DIR ? join(EVIDENCE_DIR, `${name}.png`) : screenshotPath(name)

const sha = async (path: string) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex')

/** Build a visually distinct 6-page PDF with 3 top-level bookmarks */
async function makeBookmarkedSamplePdf(filePath: string): Promise<void> {
  const doc = await PDFDocument.create()
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const regular = await doc.embedFont(StandardFonts.Helvetica)

  const pageSpecs = [
    {
      title: 'Chapter 1: Overview',
      sub: 'Page 1 - Executive Summary',
      accent: rgb(0.12, 0.45, 0.85),
    },
    { title: 'Chapter 1: Overview', sub: 'Page 2 - Scope & Goals', accent: rgb(0.12, 0.45, 0.85) },
    { title: 'Chapter 2: Analysis', sub: 'Page 3 - Benchmark Data', accent: rgb(0.1, 0.6, 0.42) },
    { title: 'Chapter 2: Analysis', sub: 'Page 4 - Key Findings', accent: rgb(0.1, 0.6, 0.42) },
    { title: 'Chapter 3: Roadmap', sub: 'Page 5 - Phase 1 & 2 Plan', accent: rgb(0.82, 0.46, 0.1) },
    { title: 'Chapter 3: Roadmap', sub: 'Page 6 - Verification', accent: rgb(0.82, 0.46, 0.1) },
  ]

  for (let i = 0; i < pageSpecs.length; i++) {
    const spec = pageSpecs[i]!
    const page = doc.addPage([420, 595])
    // Soft white paper + colored top header band so thumbnails look distinct
    page.drawRectangle({ x: 0, y: 0, width: 420, height: 595, color: rgb(0.99, 0.99, 1) })
    page.drawRectangle({ x: 0, y: 505, width: 420, height: 90, color: spec.accent })
    page.drawText(spec.title, { x: 28, y: 545, size: 20, font: bold, color: rgb(1, 1, 1) })
    page.drawText(spec.sub, { x: 28, y: 520, size: 12, font: regular, color: rgb(0.95, 0.97, 1) })
    // Mock body lines
    for (let line = 0; line < 8; line++) {
      page.drawRectangle({
        x: 28,
        y: 460 - line * 28,
        width: line % 3 === 2 ? 250 : 360,
        height: 10,
        color: rgb(0.86, 0.88, 0.92),
      })
    }
    // Large page number watermark for immediate visual check in thumbnails
    page.drawText(`0${i + 1}`, {
      x: 165,
      y: 120,
      size: 84,
      font: bold,
      color: rgb(0.88, 0.9, 0.94),
    })
  }

  // Add /Outlines with 3 chapters (pages 1, 3, 5)
  const pages = doc.getPages()
  const refs = [doc.context.nextRef(), doc.context.nextRef(), doc.context.nextRef()]
  const rootRef = doc.context.register(
    doc.context.obj({ Type: 'Outlines', First: refs[0], Last: refs[2], Count: 3 }),
  )
  const chapters: [string, number][] = [
    ['1. Overview', 0],
    ['2. Analysis', 2],
    ['3. Roadmap', 4],
  ]
  chapters.forEach(([title, pageIdx], idx) => {
    const dict: Record<string, unknown> = {
      Title: PDFString.of(title),
      Parent: rootRef,
      Dest: [pages[pageIdx]!.ref, PDFName.of('Fit')],
    }
    if (idx > 0) dict.Prev = refs[idx - 1]
    if (idx < refs.length - 1) dict.Next = refs[idx + 1]
    doc.context.assign(refs[idx]!, doc.context.obj(dict))
  })
  doc.catalog.set(PDFName.of('Outlines'), rootRef)

  await writeFile(filePath, await doc.save({ useObjectStreams: false }))
}

/** Stub native dialogs and suppress OS file-manager popup during E2E */
async function stubDialogsAndShell(
  app: ElectronApplication,
  answers: { open?: string[][]; save?: string[] },
): Promise<void> {
  await app.evaluate(({ dialog, shell }, next) => {
    const g = globalThis as Record<string, unknown>
    g.__splitOpen = [...(next.open ?? [])]
    g.__splitSave = [...(next.save ?? [])]
    dialog.showOpenDialog = (async () => {
      const paths = (g.__splitOpen as string[][]).shift()
      return paths ? { canceled: false, filePaths: paths } : { canceled: true, filePaths: [] }
    }) as never
    dialog.showSaveDialog = (async () => {
      const path = (g.__splitSave as string[]).shift()
      return path ? { canceled: false, filePath: path } : { canceled: true, filePath: '' }
    }) as never
    shell.showItemInFolder = (() => {}) as never
  }, answers)
}

test.describe('PDF Split upgrade E2E', () => {
  test('editor visual SplitDialog (scissors, 4 modes, bookmark split, context menu) in Korean', async () => {
    test.setTimeout(180_000)
    const dir = await mkdtemp(join(tmpdir(), 'genoffice-pdf-split-e2e-'))
    const sample = join(dir, 'sample-report.pdf')
    const outDir = join(dir, 'editor-out')
    await makeBookmarkedSamplePdf(sample)
    await mkdir(outDir)
    if (EVIDENCE_DIR) await mkdir(EVIDENCE_DIR, { recursive: true })
    const beforeHash = await sha(sample)

    const launched = await launchShell({
      onboardingSeen: true,
      lang: 'ko',
      openFile: sample,
      videoDir: 'pdf-split-editor',
    })
    const { app } = launched
    try {
      const editor = await waitForPageWithUrl(app, '://pdf/')
      await expect(editor.locator('.pdf-thumb')).toHaveCount(6, { timeout: 30_000 })

      // Open Split dialog from the Pages ribbon tab
      await editor.getByRole('button', { name: '페이지', exact: true }).click()
      await editor.getByRole('button', { name: 'PDF 분할', exact: true }).click()

      const dialog = editor.locator('.pdf-split-modal')
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      await expect(dialog.locator('.pdf-split-tile')).toHaveCount(6)
      // Give PDF.js thumbnails a moment to raster cleanly
      await editor.waitForTimeout(800)

      // Toggle scissor cuts so we have 3 visual groups: 1-2, 3-4, 5-6
      const cuts = dialog.locator('.pdf-split-cut-btn')
      await expect(cuts).toHaveCount(5)
      // Initial cut is after page 3 (index 2); clear it and set cuts after pages 2 & 4
      await cuts.nth(2).click()
      await cuts.nth(1).click()
      await cuts.nth(3).click()
      await expect(dialog.locator('.pdf-split-preview-count')).toContainText('3개')
      await dialog.locator('.pdf-split-link-btn').click()
      await expect(dialog.locator('.pdf-split-file-item')).toHaveCount(3)
      await editor.screenshot({ path: shot('split-editor-ranges-ko') })

      // Switch to Bookmarks tab -> auto-switches naming to bookmark title & previews 3 chapters
      await dialog.getByRole('tab', { name: '책갈피별' }).click()
      await expect(dialog.locator('.pdf-split-preview-count')).toContainText('3개')
      await expect(dialog.locator('.pdf-split-file-name').first()).toContainText(
        '1_1. Overview.pdf',
      )
      await editor.screenshot({ path: shot('split-editor-bookmarks-ko') })

      // Switch to File Size tab -> pick 5 MB preset
      await dialog.getByRole('tab', { name: '파일 크기' }).click()
      await dialog.getByRole('button', { name: '5 MB' }).click()
      await editor.screenshot({ path: shot('split-editor-maxsize-ko') })

      // Switch back to Bookmarks tab and execute a real split to disk into a subfolder
      await dialog.getByRole('tab', { name: '책갈피별' }).click()
      await stubDialogsAndShell(app, { open: [[outDir]] })
      await dialog.getByRole('button', { name: '분할 저장…' }).click()
      await expect(dialog).toBeHidden({ timeout: 30_000 })

      const subDir = join(outDir, 'sample-report-split')
      for (const expectedName of ['1_1. Overview.pdf', '2_2. Analysis.pdf', '3_3. Roadmap.pdf']) {
        const partDoc = await PDFDocument.load(await readFile(join(subDir, expectedName)))
        expect(partDoc.getPageCount()).toBe(2)
      }
      // Original file untouched
      expect(await sha(sample)).toBe(beforeHash)

      // Thumbnail right-click shortcut: "이 페이지 앞에서 분할…" on page 4 sets cut after page 3
      await editor.locator('.pdf-thumb').nth(3).click({ button: 'right' })
      await editor.getByRole('button', { name: '이 페이지 앞에서 분할…' }).click()
      await expect(dialog).toBeVisible()
      await expect(dialog.locator('.pdf-split-cut-btn').nth(2)).toHaveClass(/active/)
      await dialog.getByRole('button', { name: '취소' }).first().click()
      await expect(dialog).toBeHidden()
    } finally {
      await closeAndSaveVideo(launched, 'pdf-split-editor')
    }
  })

  test('PDF tools window Split (4 modes, merged ranges, bookmarks, handoff to editor) in Korean', async () => {
    test.setTimeout(180_000)
    const dir = await mkdtemp(join(tmpdir(), 'genoffice-pdf-split-tools-e2e-'))
    const sample = join(dir, 'sample-report.pdf')
    const mergedOut = join(dir, 'selected-pages.pdf')
    const bmDir = join(dir, 'bm-out')
    await makeBookmarkedSamplePdf(sample)
    await mkdir(bmDir)
    if (EVIDENCE_DIR) await mkdir(EVIDENCE_DIR, { recursive: true })

    const launched = await launchShell({
      onboardingSeen: true,
      lang: 'ko',
      videoDir: 'pdf-split-tools',
    })
    const { app, page: home } = launched
    try {
      await home.getByRole('button', { name: /PDF 도구/ }).click()
      const tools = await waitForPageWithUrl(app, 'pdf-tools.html')
      await expect(tools.locator('.pt-title')).toBeVisible()

      await tools.getByRole('button', { name: /PDF 분할/ }).click()
      await stubDialogsAndShell(app, { open: [[sample], [bmDir]], save: [mergedOut] })
      await tools.getByRole('button', { name: 'PDF 고르기', exact: true }).click()
      await expect(tools.getByText('6페이지', { exact: false })).toBeVisible()

      // Switch to Bookmarks tab, expand file list, capture screenshot
      await tools.getByRole('tab', { name: '책갈피별' }).click()
      await expect(tools.locator('.pt-split-preview-count')).toContainText('3개')
      await tools.locator('.pt-split-link').click()
      await expect(tools.locator('.pt-split-file')).toHaveCount(3)
      await tools.screenshot({ path: shot('split-tools-bookmarks-ko') })

      // Execute bookmark split -> writes 3 chapter files inside subfolder
      await tools.getByRole('button', { name: '새 파일로 저장' }).click()
      await expect(tools.getByText('파일 3개를 만들었습니다.')).toBeVisible({ timeout: 30_000 })
      const subDir = join(bmDir, 'sample-report-split')
      for (const expectedName of ['1_1. Overview.pdf', '2_2. Analysis.pdf', '3_3. Roadmap.pdf']) {
        const partDoc = await PDFDocument.load(await readFile(join(subDir, expectedName)))
        expect(partDoc.getPageCount()).toBe(2)
      }

      // Switch to Ranges tab, set "1-2, 5-6" + merge into one PDF -> writes 4-page single file
      await tools.getByRole('tab', { name: '구간 지정' }).click()
      await tools.locator('.pt-fields input[type="text"]').first().fill('1-2, 5-6')
      await tools.getByRole('checkbox', { name: '지정한 구간을 하나의 PDF로 합치기' }).check()
      await expect(tools.locator('.pt-split-preview-count')).toContainText('1개')
      await tools.screenshot({ path: shot('split-tools-ranges-merge-ko') })

      await tools.getByRole('button', { name: '새 파일로 저장' }).click()
      await expect(tools.getByText('새 파일을 만들었습니다: selected-pages.pdf')).toBeVisible({
        timeout: 30_000,
      })
      const mergedDoc = await PDFDocument.load(await readFile(mergedOut))
      expect(mergedDoc.getPageCount()).toBe(4)

      // Click "페이지를 보며 자르기 (편집기에서 열기)" -> opens PDF editor and launches SplitDialog
      await tools.getByRole('button', { name: /페이지를 보며 자르기/ }).click()
      const editor = await waitForPageWithUrl(app, '://pdf/', 30_000)
      await expect(editor.locator('.pdf-split-modal')).toBeVisible({ timeout: 30_000 })
    } finally {
      await closeAndSaveVideo(launched, 'pdf-split-tools')
    }
  })

  test('dark theme visual check of SplitDialog', async () => {
    test.setTimeout(120_000)
    const dir = await mkdtemp(join(tmpdir(), 'genoffice-pdf-split-dark-e2e-'))
    const sample = join(dir, 'sample-report.pdf')
    await makeBookmarkedSamplePdf(sample)
    if (EVIDENCE_DIR) await mkdir(EVIDENCE_DIR, { recursive: true })

    const launched = await launchShell({
      onboardingSeen: true,
      lang: 'ko',
      settings: { theme: 'dark' },
      openFile: sample,
      videoDir: 'pdf-split-dark',
    })
    const { app } = launched
    try {
      const editor = await waitForPageWithUrl(app, '://pdf/')
      await expect(editor.locator('.pdf-thumb')).toHaveCount(6, { timeout: 30_000 })
      await editor.getByRole('button', { name: '페이지', exact: true }).click()
      await editor.getByRole('button', { name: 'PDF 분할', exact: true }).click()
      const dialog = editor.locator('.pdf-split-modal')
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      await editor.waitForTimeout(800)
      await editor.screenshot({ path: shot('split-editor-dark-ko') })
    } finally {
      await closeAndSaveVideo(launched, 'pdf-split-dark')
    }
  })
})
