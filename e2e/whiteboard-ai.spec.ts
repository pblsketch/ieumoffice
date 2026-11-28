import { mkdirSync, rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'

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
  return found!
}

const GOOD_EDIT_CALL = {
  type: 'tool-call',
  toolCall: {
    id: 'wb-call-1',
    name: 'edit_board',
    input: {
      ops: [
        {
          op: 'add',
          id: 'ai-1',
          kind: 'sticky',
          x: 80,
          y: 80,
          width: 200,
          height: 140,
          text: 'AI Sticky One',
        },
        {
          op: 'add',
          id: 'ai-2',
          kind: 'sticky',
          x: 360,
          y: 80,
          width: 200,
          height: 140,
          text: 'AI Sticky Two',
        },
        { op: 'add', id: 'ai-conn', kind: 'connector', from: 'ai-1', to: 'ai-2' },
      ],
    },
  },
}

const BAD_EDIT_CALL = {
  type: 'tool-call',
  toolCall: {
    id: 'wb-call-2',
    name: 'edit_board',
    input: {
      ops: [
        {
          op: 'add',
          id: 'ai-3',
          kind: 'sticky',
          x: 80,
          y: 300,
          width: 200,
          height: 140,
          text: 'Should Not Exist',
        },
        { op: 'delete', id: 'no-such-object' },
      ],
    },
  },
}

async function scriptWhiteboardAi(app: ElectronApplication): Promise<void> {
  await app.evaluate(
    ({ ipcMain, webContents }, { good, bad }) => {
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
      for (const ch of ['ai:subscription-statuses', 'ai:subscription-recheck']) {
        ipcMain.removeHandler(ch)
        ipcMain.handle(ch, () => statuses)
      }
      const seen: Array<{ messages: unknown[]; tools?: Array<{ name: string }> }> = []
      ;(globalThis as unknown as { __wbAiRequests?: unknown[] }).__wbAiRequests = seen
      ipcMain.removeHandler('ai:stream')
      ipcMain.handle(
        'ai:stream',
        (
          event,
          request: { requestId: string; messages: unknown[]; tools?: Array<{ name: string }> },
        ) => {
          seen.push(request)
          const last = JSON.stringify(request.messages[request.messages.length - 1] ?? '')
          const chunks = last.includes('GOOD-WB-TURN')
            ? [
                good,
                { type: 'usage', usage: { inputTokens: 120, outputTokens: 45 } },
                { type: 'done' },
              ]
            : last.includes('BAD-WB-TURN')
              ? [bad, { type: 'done' }]
              : [
                  {
                    type: 'delta',
                    text: 'Updated the whiteboard with **two connected stickies**.',
                  },
                  { type: 'usage', usage: { inputTokens: 210, outputTokens: 64 } },
                  { type: 'done' },
                ]
          setTimeout(() => {
            for (const chunk of chunks as Array<Record<string, unknown>>) {
              realSend.call(event.sender, 'ai:stream-chunk', {
                requestId: request.requestId,
                ...chunk,
              })
            }
          }, 150)
        },
      )
      for (const wc of webContents.getAllWebContents()) {
        if (!wc.isDestroyed()) realSend.call(wc, 'ai:subscription-changed', statuses)
      }
    },
    { good: GOOD_EDIT_CALL, bad: BAD_EDIT_CALL },
  )
}

test.describe('Whiteboard AI panel', () => {
  test('hides AI panel completely when AI features are disabled', async () => {
    test.setTimeout(120_000)
    const dir = await mkdtemp(join(tmpdir(), 'genoffice-wb-aioff-'))
    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'whiteboard-ai-off',
      settings: { aiFeatures: false, defaultSaveDir: dir },
    })
    const { app, page: shell } = launched
    try {
      const card = shell.locator('.quick-card', {
        has: shell.locator('.quick-title', { hasText: /^Whiteboard$/ }),
      })
      const before = new Set(app.windows())
      await card.click()
      const board = await waitWhiteboardPage(app, before)

      await expect(board.locator('.copilot')).toHaveCount(0)
      await expect(board.locator('.ai-rail')).toHaveCount(0)
    } finally {
      await closeAndSaveVideo(launched, 'whiteboard-ai-off')
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('applies atomic tool call with highlights, reverts in one Undo, and rejects invalid batch without partial edits', async () => {
    test.setTimeout(180_000)
    const dir = await mkdtemp(join(tmpdir(), 'genoffice-wb-ai-'))
    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'whiteboard-ai',
      settings: { defaultSaveDir: dir },
    })
    const { app, page: shell } = launched
    try {
      await scriptWhiteboardAi(app)

      const card = shell.locator('.quick-card', {
        has: shell.locator('.quick-title', { hasText: /^Whiteboard$/ }),
      })
      const before = new Set(app.windows())
      await card.click()
      const board = await waitWhiteboardPage(app, before)

      // Open AI dock if collapsed
      if ((await board.locator('.ai-rail').count()) > 0) {
        await board.locator('.ai-rail').click()
      }
      const textarea = board.locator('.ai-input-box textarea')
      const sendBtn = board.locator('.ai-send-btn')
      await expect(textarea).toBeVisible()

      // Send good edit batch
      await textarea.fill('GOOD-WB-TURN: add two connected stickies')
      await sendBtn.click()

      await expect(board.locator('[data-object-id="ai-1"]')).toHaveCount(1, { timeout: 20_000 })
      await expect(board.locator('[data-object-id="ai-2"]')).toHaveCount(1)
      await expect(board.locator('[data-object-id="ai-conn"]')).toHaveCount(1)
      await expect(board.locator('.wb-ai-highlight-rect').first()).toBeVisible()

      // Verify tool definitions exposed to model
      const reqs = await app.evaluate(
        () =>
          (globalThis as unknown as { __wbAiRequests?: Array<{ tools?: Array<{ name: string }> }> })
            .__wbAiRequests ?? [],
      )
      expect(reqs[0]?.tools?.map((t) => t.name)).toEqual(
        expect.arrayContaining(['read_board', 'edit_board', 'apply_template']),
      )

      // Send bad edit batch (all-or-nothing: ai-3 must not be added)
      const countBeforeBad = reqs.length
      await textarea.fill('BAD-WB-TURN: invalid delete batch')
      await sendBtn.click()
      await expect
        .poll(async () =>
          app.evaluate(
            () =>
              (globalThis as unknown as { __wbAiRequests?: unknown[] }).__wbAiRequests?.length ?? 0,
          ),
        )
        .toBeGreaterThanOrEqual(countBeforeBad + 2)
      await expect(board.locator('[data-object-id="ai-3"]')).toHaveCount(0)
      await expect(board.locator('[data-object-id="ai-1"]')).toHaveCount(1)

      // One Undo reverts the entire first tool call (all 3 objects)
      await board.getByRole('button', { name: 'Undo', exact: true }).click()
      await expect(board.locator('[data-object-id="ai-1"]')).toHaveCount(0)
      await expect(board.locator('[data-object-id="ai-2"]')).toHaveCount(0)
      await expect(board.locator('[data-object-id="ai-conn"]')).toHaveCount(0)
    } finally {
      await closeAndSaveVideo(launched, 'whiteboard-ai')
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('matches shared AI panel design system, side swap, resize, collapse, changes card, and dark theme', async () => {
    test.setTimeout(180_000)
    const dir = await mkdtemp(join(tmpdir(), 'genoffice-wb-aidesign-'))
    const shotDir = process.env.WB_AI_SHOT_DIR
    if (shotDir) mkdirSync(shotDir, { recursive: true })
    const launched = await launchShell({
      onboardingSeen: true,
      lang: 'ko',
      videoDir: 'whiteboard-ai-design',
      settings: { defaultSaveDir: dir },
    })
    const { app, page: shell } = launched
    try {
      await scriptWhiteboardAi(app)

      // Open a Whiteboard tab via shell home API and a Docs tab for style comparison
      const beforeWb = new Set(app.windows())
      await shell.evaluate(() =>
        (
          window as unknown as {
            aiOffice: { newWhiteboard(): Promise<void> }
          }
        ).aiOffice.newWhiteboard(),
      )
      const board = await waitWhiteboardPage(app, beforeWb)

      const pageErrors: string[] = []
      const consoleErrors: string[] = []
      board.on('pageerror', (err) => pageErrors.push(err.message))
      board.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text())
      })

      if ((await board.locator('.ai-rail').count()) > 0) {
        await board.locator('.ai-rail').click()
      }

      // Wait for the empty state title & starters (the badge tile is hidden by design)
      await expect(board.locator('.ai-panel-header')).toBeVisible()
      await expect(board.locator('.ai-chat-empty-title')).toBeVisible()
      await expect(board.locator('.ai-starter')).toHaveCount(4)
      await expect(board.locator('.ai-chat-empty-hints')).toBeVisible()

      if (shotDir) {
        await board.screenshot({ path: join(shotDir, '01-wb-light-empty-left.png') })
      }

      // Measure Whiteboard AI panel computed styles
      const readPanelStyles = (p: Page) =>
        p.evaluate(() => {
          const get = (sel: string) => {
            const el = document.querySelector(sel)
            if (!el) return null
            const s = getComputedStyle(el)
            return {
              bg: s.backgroundColor,
              color: s.color,
              fontSize: s.fontSize,
              borderRadius: s.borderRadius,
              borderTopWidth: s.borderTopWidth,
              width: Math.round(el.getBoundingClientRect().width),
              height: Math.round(el.getBoundingClientRect().height),
            }
          }
          return {
            copilot: get('.copilot, .ai-panel'),
            header: get('.ai-panel-header'),
            chat: get('.ai-chat'),
            starter: get('.ai-starter'),
            composer: get('.ai-composer:last-of-type'),
            inputBox: get('.ai-input-box'),
            sendBtn: get('.ai-send-btn'),
          }
        })

      const wbStyles = await readPanelStyles(board)

      // Open Docs tab and compare computed styles against Whiteboard AI panel
      await shell.evaluate(() =>
        (
          window as unknown as {
            aiOffice: { newDoc(): Promise<void> }
          }
        ).aiOffice.newDoc(),
      )
      const docs = await waitForPageWithUrl(app, '://docs/')
      await expect(docs.locator('.ai-panel-header')).toBeVisible({ timeout: 20_000 })
      if (shotDir) {
        await docs.screenshot({ path: join(shotDir, '02-docs-light-empty-left.png') })
      }
      const docsStyles = await readPanelStyles(docs)

      expect(wbStyles.copilot?.bg).toBe(docsStyles.copilot?.bg)
      expect(wbStyles.header?.bg).toBe(docsStyles.header?.bg)
      expect(wbStyles.header?.height).toBe(docsStyles.header?.height)
      expect(wbStyles.chat?.fontSize).toBe(docsStyles.chat?.fontSize)
      expect(wbStyles.starter?.bg).toBe(docsStyles.starter?.bg)
      expect(wbStyles.starter?.borderRadius).toBe(docsStyles.starter?.borderRadius)
      expect(wbStyles.composer?.borderTopWidth).toBe('0px')
      expect(wbStyles.composer?.bg).toBe(docsStyles.composer?.bg)
      expect(wbStyles.inputBox?.bg).toBe(docsStyles.inputBox?.bg)
      expect(wbStyles.inputBox?.borderRadius).toBe(docsStyles.inputBox?.borderRadius)
      expect(wbStyles.sendBtn?.width).toBe(docsStyles.sendBtn?.width)
      expect(wbStyles.sendBtn?.height).toBe(docsStyles.sendBtn?.height)
      expect(wbStyles.sendBtn?.borderRadius).toBe(docsStyles.sendBtn?.borderRadius)

      // Switch back to Whiteboard tab
      await shell.evaluate(async () => {
        const api = (
          window as unknown as {
            aiOfficeTabs: {
              list(): Promise<Array<{ id: string; kind: string }>>
              activate(id: string): Promise<void>
            }
          }
        ).aiOfficeTabs
        const wb = (await api.list()).find((t) => t.kind === 'whiteboard')
        if (wb) await api.activate(wb.id)
      })
      await expect(board.locator('.ai-panel-header')).toBeVisible()

      // 1. Default side = left: dock is to the left of .wb-main
      const dock = board.locator('.ai-dock')
      const main = board.locator('.wb-main')
      const resizer = board.locator('.ai-panel-resizer')
      const leftDockBox = (await dock.boundingBox())!
      const leftMainBox = (await main.boundingBox())!
      expect(leftDockBox.x).toBeLessThan(leftMainBox.x)
      const leftHandleBox = (await resizer.boundingBox())!
      expect(
        Math.abs(leftHandleBox.x + leftHandleBox.width - (leftDockBox.x + leftDockBox.width)),
      ).toBeLessThanOrEqual(4)

      // 2. Click side-swap button -> moves to right side
      await board.locator('.ai-panel-side-button').click()
      await expect
        .poll(async () => {
          const d = await dock.boundingBox()
          const m = await main.boundingBox()
          return d && m ? d.x > m.x : false
        })
        .toBe(true)
      const rightDockBox = (await dock.boundingBox())!
      const rightHandleBox = (await resizer.boundingBox())!
      expect(Math.abs(rightHandleBox.x - rightDockBox.x)).toBeLessThanOrEqual(4)
      const collapseFlip = await board
        .locator('.ai-panel-collapse svg')
        .evaluate((el) => getComputedStyle(el).transform)
      expect(collapseFlip).toBe('matrix(-1, 0, 0, 1, 0, 0)')

      if (shotDir) {
        await board.screenshot({ path: join(shotDir, '03-wb-light-right.png') })
      }

      // Move back to left side
      await board.locator('.ai-panel-side-button').click()
      await expect
        .poll(async () => {
          const d = await dock.boundingBox()
          const m = await main.boundingBox()
          return d && m ? d.x < m.x : false
        })
        .toBe(true)

      // 3. Resize by dragging .ai-panel-resizer
      const beforeResize = (await dock.boundingBox())!
      const handle = (await resizer.boundingBox())!
      await board.mouse.move(handle.x + handle.width / 2, handle.y + 120)
      await board.mouse.down()
      await board.mouse.move(handle.x + 80, handle.y + 120, { steps: 5 })
      await board.mouse.up()
      await expect
        .poll(async () => Math.round((await dock.boundingBox())!.width))
        .toBeGreaterThan(beforeResize.width + 50)

      // 4. Test attach menu (+), skill button (/), and model picker popovers
      await board.locator('.ai-attach-menu button').click()
      await expect(board.locator('.ai-attach-menu-pop')).toBeVisible()
      await board.keyboard.press('Escape')
      await expect(board.locator('.ai-attach-menu-pop')).toHaveCount(0)

      // 5. Click starter -> fills composer -> send stubbed turn with tool + usage + changes card
      await board.locator('.ai-starter').first().click()
      const textarea = board.locator('.ai-input-box textarea')
      await expect(textarea).not.toHaveValue('')
      await textarea.fill('GOOD-WB-TURN: create two connected stickies')
      await board.locator('.ai-send-btn').click()

      await expect(board.locator('.ai-msg-user')).toHaveCount(1)
      await expect(board.locator('.ai-work-group')).toBeVisible({ timeout: 20_000 })
      await expect(board.locator('.ai-run-changes[data-state="applied"]')).toBeVisible({
        timeout: 20_000,
      })
      await expect(board.locator('.ai-reply-footer')).toBeVisible()
      await expect(board.locator('.ai-reply-footer .ai-usage-chip')).toBeVisible()
      await expect(board.locator('.ai-input-below .ai-usage-chip')).toBeVisible()
      await expect(board.locator('.wb-ai-highlight-rect').first()).toBeVisible()

      if (shotDir) {
        await board.screenshot({ path: join(shotDir, '04-wb-light-chat-changes.png') })
      }

      // 6. Dark theme check
      await board.evaluate(() => {
        document.documentElement.setAttribute('data-theme', 'dark')
      })
      const darkBg = await board
        .locator('.copilot')
        .evaluate((el) => getComputedStyle(el).backgroundColor)
      expect(darkBg).toBe('rgb(30, 30, 30)')
      if (shotDir) {
        await board.screenshot({ path: join(shotDir, '05-wb-dark-chat.png') })
      }
      await board.evaluate(() => {
        document.documentElement.removeAttribute('data-theme')
      })

      // 7. Clear highlights & Revert via AiChangesCard
      await board.locator('[data-action="ai-changes-unmark"]').click()
      await expect(board.locator('.wb-ai-highlight-rect')).toHaveCount(0)
      await board.locator('[data-action="ai-changes-revert"]').click()
      await expect(board.locator('.ai-run-changes[data-state="reverted"]')).toBeVisible()
      await expect(board.locator('[data-object-id="ai-1"]')).toHaveCount(0)

      // 8. New chat restores empty state
      await board.locator('.ai-panel-header-actions .ai-header-btn').nth(1).click()
      await expect(board.locator('.ai-chat-empty')).toBeVisible()

      // 9. Collapse to rail and reopen
      await board.locator('.ai-panel-collapse').click()
      await expect(board.locator('.ai-dock.collapsed')).toHaveCount(1)
      await expect(board.locator('.ai-rail')).toBeVisible()
      await expect.poll(async () => Math.round((await dock.boundingBox())!.width)).toBe(34)
      if (shotDir) {
        await board.screenshot({ path: join(shotDir, '06-wb-light-collapsed-rail.png') })
      }
      await board.locator('.ai-rail').click()
      await expect(board.locator('.ai-dock.collapsed')).toHaveCount(0)
      await expect(board.locator('.ai-panel-header')).toBeVisible()

      expect(pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])
    } finally {
      await closeAndSaveVideo(launched, 'whiteboard-ai-design')
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
