import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'

/** Build a real, visible 280x160 PNG banner (bar-chart graphic) using built-in zlib */
function makeSamplePng(width = 280, height = 160): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4)
    raw[rowStart] = 0 // filter type None
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4
      // Soft gradient background
      let r = Math.round(238 - (y / height) * 28)
      let g = Math.round(244 - (x / width) * 18)
      let b = 255
      // Top header bar (indigo)
      if (y < 28) {
        r = 59
        g = 91
        b = 219
      }
      // Subtle border
      if (x < 3 || x >= width - 3 || y < 3 || y >= height - 3) {
        r = 59
        g = 91
        b = 219
      }
      // Three colorful chart bars inside
      if (y >= 88 && y <= 138 && x >= 36 && x <= 78) {
        r = 66
        g = 133
        b = 244
      } else if (y >= 56 && y <= 138 && x >= 108 && x <= 150) {
        r = 16
        g = 185
        b = 129
      } else if (y >= 42 && y <= 138 && x >= 180 && x <= 222) {
        r = 245
        g = 158
        b = 11
      }
      // Baseline
      if (y >= 138 && y <= 141 && x >= 24 && x <= 252) {
        r = 71
        g = 85
        b = 105
      }
      raw[px] = r
      raw[px + 1] = g
      raw[px + 2] = b
      raw[px + 3] = 255
    }
  }

  const crcTable = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const t = Buffer.from(type, 'ascii')
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
    return Buffer.concat([len, t, data, crc])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const SAMPLE_PNG = makeSamplePng(280, 160)

interface RecordedToolOutcome {
  editorKind: string
  tool: string
  isError: boolean
  output: string
  cachedUrl?: string
}

/**
 * Install a deterministic AI stub that never calls any real model or spends
 * subscription quota. On turn 1 it invokes `mcp__obsidian__read_note`; on turn 2
 * it extracts the locally cached `file://` image URL returned by the hub and
 * invokes the active editor's real image insertion tool; on turn 3 it finishes
 * and records every tool outcome in main-process memory for assertion.
 */
async function installImportFlowAiStub(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain, webContents }) => {
    const g = globalThis as { __ieumImportOutcomes?: RecordedToolOutcome[] }
    g.__ieumImportOutcomes = []

    const proto = Object.getPrototypeOf(webContents.getAllWebContents()[0]) as {
      send: (channel: string, ...args: unknown[]) => void
    }
    const realSend = proto.send
    proto.send = function (this: unknown, channel: string, ...args: unknown[]) {
      if (channel === 'ai:subscription-changed') return
      return realSend.call(this, channel, ...args)
    }

    const statuses = {
      'claude-code': { provider: 'claude-code', state: 'ready', meteredAccepted: false },
      codex: { provider: 'codex', state: 'not-installed', meteredAccepted: false },
    }
    for (const channel of ['ai:subscription-statuses', 'ai:subscription-recheck']) {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, () => statuses)
    }

    interface ToolResultMsg {
      role: string
      results?: Array<{ id: string; name: string; output: string; isError?: boolean }>
    }
    interface StreamReq {
      requestId: string
      messages?: ToolResultMsg[]
      tools?: Array<{ name: string }>
    }

    ipcMain.removeHandler('ai:stream')
    ipcMain.handle('ai:stream', (event, request: StreamReq) => {
      const send = (chunk: Record<string, unknown>) =>
        realSend.call(event.sender, 'ai:stream-chunk', { requestId: request.requestId, ...chunk })

      const toolNames = new Set((request.tools ?? []).map((t) => t.name))
      const senderUrl = event.sender.getURL()
      const editorKind = senderUrl.includes('://docs/')
        ? 'docs'
        : senderUrl.includes('://hwp/')
          ? 'hwp'
          : senderUrl.includes('://slides/')
            ? 'slides'
            : senderUrl.includes('://html/')
              ? 'html'
              : senderUrl.includes('://markdown/')
                ? 'markdown'
                : 'other'

      const allToolResults = (request.messages ?? [])
        .filter((m) => m.role === 'tool' && Array.isArray(m.results))
        .flatMap((m) => m.results ?? [])

      const readRes = allToolResults.find((r) => r.name.endsWith('__read_note'))
      const insertRes = allToolResults.find(
        (r) => r.name === 'insert_image' || r.name === 'insert_web_image' || r.name === 'apply_ops',
      )

      if (!readRes) {
        const readTool = [...toolNames].find((n) => n.endsWith('__read_note'))
        if (!readTool) {
          g.__ieumImportOutcomes!.push({
            editorKind,
            tool: 'missing_read_note',
            isError: true,
            output: `No Obsidian read_note tool in [${[...toolNames].join(', ')}]`,
          })
          send({ type: 'delta', text: 'Missing read_note tool.' })
          send({ type: 'done' })
          return
        }
        send({
          type: 'tool-call',
          toolCall: { id: 'tc-read', name: readTool, input: { path: 'LaunchNote.md' } },
        })
        send({ type: 'done' })
        return
      }

      if (!insertRes) {
        const urlMatch = readRes.output.match(/file:\/\/\/[^\s"'<>]+?\.png/i)
        const cachedUrl = urlMatch?.[0] ?? ''
        g.__ieumImportOutcomes!.push({
          editorKind,
          tool: readRes.name,
          isError: readRes.isError === true || !cachedUrl,
          output: readRes.output,
          cachedUrl,
        })
        if (!cachedUrl) {
          send({ type: 'delta', text: 'No cached image URL found in read_note result.' })
          send({ type: 'done' })
          return
        }
        if (editorKind === 'slides' && toolNames.has('insert_web_image')) {
          send({
            type: 'tool-call',
            toolCall: {
              id: 'tc-insert',
              name: 'insert_web_image',
              input: { slideIndex: 0, url: cachedUrl, x: 80, y: 80, w: 220, h: 160 },
            },
          })
        } else if (editorKind === 'html' && toolNames.has('apply_ops')) {
          send({
            type: 'tool-call',
            toolCall: {
              id: 'tc-insert',
              name: 'apply_ops',
              input: {
                ops: [
                  {
                    op: 'str_replace',
                    old: '</body>',
                    new: `<img id="imported-hero" src="${cachedUrl}" alt="Hero" />\n</body>`,
                  },
                ],
                summary: 'Insert imported image',
              },
            },
          })
        } else if (toolNames.has('insert_image')) {
          send({
            type: 'tool-call',
            toolCall: {
              id: 'tc-insert',
              name: 'insert_image',
              input:
                editorKind === 'markdown'
                  ? { url: cachedUrl, alt: 'Hero' }
                  : editorKind === 'hwp'
                    ? { where: 'end', url: cachedUrl }
                    : { url: cachedUrl },
            },
          })
        } else {
          g.__ieumImportOutcomes!.push({
            editorKind,
            tool: 'missing_insert_tool',
            isError: true,
            output: `No image insert tool in [${[...toolNames].join(', ')}]`,
          })
          send({ type: 'delta', text: 'Missing insert tool.' })
          send({ type: 'done' })
          return
        }
        send({ type: 'done' })
        return
      }

      g.__ieumImportOutcomes!.push({
        editorKind,
        tool: insertRes.name,
        isError: insertRes.isError === true,
        output: insertRes.output,
      })
      send({ type: 'delta', text: `Imported image in ${editorKind}.` })
      send({ type: 'done' })
    })

    for (const wc of webContents.getAllWebContents()) {
      if (!wc.isDestroyed()) realSend.call(wc, 'ai:subscription-changed', statuses)
    }
  })
}

async function readRecordedOutcomes(app: ElectronApplication): Promise<RecordedToolOutcome[]> {
  return app.evaluate(
    () =>
      (globalThis as { __ieumImportOutcomes?: RecordedToolOutcome[] }).__ieumImportOutcomes ?? [],
  )
}

async function ensureAiComposerVisible(editor: Page): Promise<void> {
  const textarea = editor.locator('.ai-composer textarea').first()
  if (await textarea.isVisible().catch(() => false)) return
  const openBtn = editor
    .locator('button[aria-label*="AI"], button[title*="AI"], .ai-rail-toggle')
    .first()
  if (await openBtn.isVisible().catch(() => false)) {
    await openBtn.click()
  }
  await expect(textarea).toBeVisible({ timeout: 20_000 })
}

async function sendAiPromptAndWait(editor: Page, expectedReply: string): Promise<void> {
  await ensureAiComposerVisible(editor)
  const textarea = editor.locator('.ai-composer textarea').first()
  await textarea.fill('Import LaunchNote with its image')
  await textarea.press('Enter')
  await expect(editor.getByText(expectedReply)).toBeVisible({ timeout: 30_000 })
}

test.describe('Connector image import across Docs, Hangul, Slides, HTML, and Markdown', () => {
  test('auto-attaches vault images via picker and embeds cached MCP images across all 5 editors', async () => {
    test.setTimeout(300_000)

    const workDirParent = join(process.cwd(), 'e2e', 'artifacts')
    await mkdir(workDirParent, { recursive: true })
    const workDir = await mkdtemp(join(workDirParent, 'connector-import-'))
    const vaultDir = join(workDir, 'TestVault')
    await mkdir(join(vaultDir, '.obsidian'), { recursive: true })
    await mkdir(join(vaultDir, 'assets'), { recursive: true })
    await writeFile(join(vaultDir, 'assets', 'hero.png'), SAMPLE_PNG)
    await writeFile(
      join(vaultDir, 'LaunchNote.md'),
      '# Launch Plan\n\nArchitecture preview:\n![[hero.png]]\n',
      'utf8',
    )

    const htmlPath = join(workDir, 'sample.html')
    await writeFile(
      htmlPath,
      '<!doctype html>\n<html><head><title>Sample</title></head><body><h1>Hello</h1></body></html>\n',
      'utf8',
    )

    const mdPath = join(workDir, 'sample.md')
    await writeFile(mdPath, '# Sample Markdown\n\nInitial paragraph.\n', 'utf8')

    const captureDir = process.env.IEUM_CAPTURE_DIR?.trim() || ''
    if (captureDir) await mkdir(captureDir, { recursive: true })
    const capture = async (page: Page, name: string) => {
      if (!captureDir) return
      await page.waitForTimeout(450)
      await page.screenshot({ path: join(captureDir, name) })
    }

    const launched = await launchShell({
      onboardingSeen: true,
      lang: 'en',
      recordVideo: false,
      videoDir: 'connector-image-import',
      openFiles: [htmlPath, mdPath],
    })

    try {
      // Locate the shell main window (the one exposing `window.aiOfficeMcpServers`)
      const findShellPage = async (): Promise<Page> => {
        for (let attempt = 0; attempt < 40; attempt++) {
          for (const win of launched.app.windows()) {
            const hasBridge = await win
              .evaluate(() =>
                Boolean((window as { aiOfficeMcpServers?: unknown }).aiOfficeMcpServers),
              )
              .catch(() => false)
            if (hasBridge) return win
          }
          await new Promise((r) => setTimeout(r, 250))
        }
        throw new Error('Could not find shell window with aiOfficeMcpServers bridge')
      }
      const shellPage = await findShellPage()
      const addRes = await shellPage.evaluate(async (dir) => {
        const api = (
          window as unknown as {
            aiOfficeMcpServers?: {
              addVault: (input: { path: string; name: string }) => Promise<unknown>
            }
          }
        ).aiOfficeMcpServers
        if (!api) return { ok: false, error: `no-bridge at ${window.location.href}` }
        return api.addVault({ path: dir, name: 'TestVault' })
      }, vaultDir)
      expect(addRes, JSON.stringify(addRes)).toMatchObject({ ok: true })

      await installImportFlowAiStub(launched.app)

      // 1. HTML editor (already opened via openFiles)
      const htmlPage = await waitForPageWithUrl(launched.app, '://html/')
      await sendAiPromptAndWait(htmlPage, 'Imported image in html.')
      const htmlOutcomes = (await readRecordedOutcomes(launched.app)).filter(
        (o) => o.editorKind === 'html',
      )
      expect(htmlOutcomes.some((o) => o.tool.endsWith('__read_note') && !o.isError)).toBe(true)
      expect(htmlOutcomes.some((o) => o.tool === 'apply_ops' && !o.isError)).toBe(true)
      // Verify image was persisted to assets/ next to sample.html (no raw file:// src left)
      const htmlAssets = await readdir(join(workDir, 'assets')).catch(() => [])
      expect(htmlAssets.some((f) => f.endsWith('.png'))).toBe(true)
      await capture(htmlPage, '4-html.png')

      // 2. Markdown editor (already opened via openFiles)
      const mdPage = await waitForPageWithUrl(launched.app, '://markdown/')
      await sendAiPromptAndWait(mdPage, 'Imported image in markdown.')
      const mdOutcomes = (await readRecordedOutcomes(launched.app)).filter(
        (o) => o.editorKind === 'markdown',
      )
      expect(mdOutcomes.some((o) => o.tool.endsWith('__read_note') && !o.isError)).toBe(true)
      expect(mdOutcomes.some((o) => o.tool === 'insert_image' && !o.isError)).toBe(true)
      const mdImages = await mdPage.locator('.ProseMirror img').count()
      expect(mdImages).toBeGreaterThan(0)
      await capture(mdPage, '5-markdown.png')

      // Helper to switch back to Home tab and open a new document card
      const openHomeCard = async (label: string) => {
        await shellPage.locator('.tab-home, [data-tab-id="home"]').first().click()
        const card = shellPage.locator('.quick-card').filter({ hasText: label }).first()
        await expect(card).toBeVisible({ timeout: 15_000 })
        await card.click()
      }

      // 3. Docs (Word) editor: test BOTH direct picker auto-image-attach AND MCP read_note -> insert_image
      await openHomeCard('AI Docs')
      const docsPage = await waitForPageWithUrl(launched.app, '://docs/')
      await expect(docsPage.locator('.ProseMirror').first()).toBeVisible({ timeout: 30_000 })
      await ensureAiComposerVisible(docsPage)

      // 3a. Direct connector picker attaches BOTH LaunchNote.md AND hero.png automatically
      await docsPage.locator('.ai-attach-menu-btn').click()
      const obsMenuItem = docsPage.locator('[data-source="obsidian"]')
      await expect(obsMenuItem).toBeVisible({ timeout: 10_000 })
      await obsMenuItem.click()
      const pickerWin = await waitForPageWithUrl(launched.app, 'connector-picker')
      const noteRow = pickerWin.locator('.cp-item').filter({ hasText: 'LaunchNote' }).first()
      await expect(noteRow).toBeVisible({ timeout: 15_000 })
      await noteRow.click()
      await pickerWin.locator('.cp-primary').click()
      await expect(docsPage.getByText('LaunchNote.md')).toBeVisible({ timeout: 15_000 })
      await expect(docsPage.getByRole('img', { name: 'hero.png' })).toBeVisible({ timeout: 15_000 })
      await capture(docsPage, '0-docs-auto-attach.png')

      // 3b. MCP read_note -> Docs insert_image(url: file://...)
      await sendAiPromptAndWait(docsPage, 'Imported image in docs.')
      const docsOutcomes = (await readRecordedOutcomes(launched.app)).filter(
        (o) => o.editorKind === 'docs',
      )
      expect(docsOutcomes.some((o) => o.tool.endsWith('__read_note') && !o.isError)).toBe(true)
      expect(docsOutcomes.some((o) => o.tool === 'insert_image' && !o.isError)).toBe(true)
      expect(await docsPage.locator('.ProseMirror img').count()).toBeGreaterThan(0)
      await capture(docsPage, '1-docs.png')

      // 4. Hangul (HWP) editor: MCP read_note -> HWP insert_image(url: file://...)
      await openHomeCard('AI HWP')
      const hwpPage = await waitForPageWithUrl(launched.app, '://hwp/')
      await ensureAiComposerVisible(hwpPage)
      await sendAiPromptAndWait(hwpPage, 'Imported image in hwp.')
      const hwpOutcomes = (await readRecordedOutcomes(launched.app)).filter(
        (o) => o.editorKind === 'hwp',
      )
      expect(hwpOutcomes.some((o) => o.tool.endsWith('__read_note') && !o.isError)).toBe(true)
      expect(
        hwpOutcomes.some((o) => o.tool === 'insert_image' && !o.isError),
        JSON.stringify(hwpOutcomes),
      ).toBe(true)
      await capture(hwpPage, '2-hwp.png')

      // 5. Slides (PPT) editor: MCP read_note (keepResultsInside=true) -> insert_web_image(url: file://...)
      await openHomeCard('AI Slides')
      const slidesPage = await waitForPageWithUrl(launched.app, '://slides/')
      await ensureAiComposerVisible(slidesPage)
      await sendAiPromptAndWait(slidesPage, 'Imported image in slides.')
      const slidesOutcomes = (await readRecordedOutcomes(launched.app)).filter(
        (o) => o.editorKind === 'slides',
      )
      expect(
        slidesOutcomes.some((o) => o.tool.endsWith('__read_note') && !o.isError),
        JSON.stringify(slidesOutcomes),
      ).toBe(true)
      expect(
        slidesOutcomes.some((o) => o.tool === 'insert_web_image' && !o.isError),
        JSON.stringify(slidesOutcomes),
      ).toBe(true)
      await capture(slidesPage, '3-slides.png')

      // Confirm sample.html on disk or live DOM never kept a broken file:// URL
      const htmlText = await readFile(htmlPath, 'utf8')
      expect(htmlText).not.toContain('file:///')
    } finally {
      await closeAndSaveVideo(launched, 'connector-image-import')
      await rm(workDir, { recursive: true, force: true }).catch(() => {})
    }
  })
})
