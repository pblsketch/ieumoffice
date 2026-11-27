/**
 * Hangul key-recording and script macro end-to-end tests in the built Electron app.
 *
 * Covers Bundle 4 built-app E2E checklist:
 * 1. Key recording -> save -> replay from Macro Manager -> single-step undo:
 *    - Start key recording via Tool menu command (`ext:ieum-macro-record-toggle`)
 *    - Confirm top-bar recording badge appears, type text and press Enter
 *    - Stop recording via the top-bar Stop button and verify recorded script in Macro Editor
 *    - Save the recorded macro, replay it from Macro Manager, and revert in one undo step
 * 2. Script macro with compatible objects (`HAction` / `HParameterSet`) -> run -> single-step undo:
 *    - Create a new script macro in Macro Manager using `HAction` and `HParameterSet`
 *    - Run the script macro, verify text insertion, and revert in one undo step
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
    getCharPropertiesAt?(sec: number, para: number, offset: number): string
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

async function createMacroFixture(): Promise<string> {
  const { HwpDocument } = await loadRhwp()
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  doc.insertText(0, 0, 0, '초기 문장')
  doc.applyStyle(0, 0, 0)
  const bytes = doc.exportHwpx()
  doc.free()
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-hwp-macros-'))
  const file = join(dir, 'macro-test.hwpx')
  writeFileSync(file, bytes)
  return file
}

async function hwpPage(app: Awaited<ReturnType<typeof launchShell>>['app']): Promise<Page> {
  const page = await waitForPageWithUrl(app, '://hwp/')
  await page.waitForSelector('.hwp-app[data-phase="ready"]', { timeout: 90_000 })
  await expect(
    page.frameLocator('.hwp-editor-host iframe').locator('[data-cmd="ext:ieum-macro-manage"]'),
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
      __e2eMacroParas?: string[]
    }
    try {
      scope.rhwpStudio.automation.unregisterCommand?.('ext:e2e-macro-read-paras')
    } catch {
      // Command not yet registered.
    }
    scope.rhwpStudio.automation.registerCommand({
      id: 'ext:e2e-macro-read-paras',
      label: 'E2E macro paragraph read',
      execute(services) {
        const count = services.wasm.getParagraphCount(0)
        const paras: string[] = []
        for (let p = 0; p < count; p++) {
          const len = services.wasm.getParagraphLength(0, p)
          paras.push(len > 0 ? services.wasm.getTextRange(0, p, 0, len) : '')
        }
        scope.__e2eMacroParas = paras
      },
    })
    scope.rhwpStudio.automation.execute('ext:e2e-macro-read-paras')
    return scope.__e2eMacroParas!
  })
}

async function moveCaret(frame: Frame, paragraphIndex: number, toEnd = false): Promise<void> {
  await frame.evaluate(
    ({ targetPara, end }) => {
      const scope = window as unknown as { rhwpStudio: StudioLike }
      try {
        scope.rhwpStudio.automation.unregisterCommand?.('ext:e2e-macro-move-caret')
      } catch {
        // Command not yet registered.
      }
      scope.rhwpStudio.automation.registerCommand({
        id: 'ext:e2e-macro-move-caret',
        label: 'E2E macro move caret',
        execute(services) {
          const charOffset = end ? services.wasm.getParagraphLength(0, targetPara) : 0
          services.getInputHandler().cursor.moveTo({
            sectionIndex: 0,
            paragraphIndex: targetPara,
            charOffset,
          })
        },
      })
      scope.rhwpStudio.automation.execute('ext:e2e-macro-move-caret')
    },
    { targetPara: paragraphIndex, end: toEnd },
  )
}

async function executeStudioCommand(frame: Frame, commandId: string): Promise<void> {
  await frame.evaluate((id) => {
    const scope = window as unknown as { rhwpStudio: StudioLike }
    scope.rhwpStudio.automation.execute(id)
  }, commandId)
}

async function ensureMacroManagerOpen(page: Page, frame: Frame): Promise<void> {
  const manager = page.locator('[data-testid="macro-manager-modal"]')
  if (!(await manager.isVisible())) {
    await executeStudioCommand(frame, 'ext:ieum-macro-manage')
    await expect(manager).toBeVisible({ timeout: 15_000 })
  }
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0
  return text.split(needle).length - 1
}

test('records a key macro, replays it, creates and runs a compatible script macro, and reverts each in one undo step', async () => {
  test.setTimeout(180_000)
  const file = await createMacroFixture()
  const launched = await launchShell({
    onboardingSeen: true,
    lang: 'ko',
    openFile: file,
    videoDir: 'hwp-macros',
    recordVideo: false,
  })
  try {
    const page = await hwpPage(launched.app)
    const frame = await studioFrame(page)

    // Focus the editor canvas and place the caret at the end of the initial paragraph.
    const canvas = frame.locator('#scroll-content canvas').first()
    await canvas.waitFor({ state: 'visible', timeout: 60_000 })
    const box = (await canvas.boundingBox())!
    await page.mouse.click(box.x + box.width / 3, box.y + 80)
    await moveCaret(frame, 0, true)

    // Flow 1: Key recording -> save -> replay -> single undo.
    await executeStudioCommand(frame, 'ext:ieum-macro-record-toggle')
    const badge = page.locator('[data-testid="macro-recording-badge"]')
    await expect(badge).toBeVisible({ timeout: 15_000 })

    await page.keyboard.type(' [REC]')
    await page.keyboard.press('Enter')

    await expect
      .poll(async () => (await readBodyParagraphs(frame)).join('\n'), { timeout: 10_000 })
      .toContain('초기 문장 [REC]')

    await page.locator('[data-testid="macro-recording-stop-btn"]').click()
    await expect(badge).toBeHidden({ timeout: 10_000 })

    const editorModal = page.locator('[data-testid="macro-editor-modal"]')
    await expect(editorModal).toBeVisible({ timeout: 15_000 })
    const scriptInput = editorModal.locator('[data-testid="macro-script-input"]')
    await expect(scriptInput).toHaveValue(/insertText\(/)

    await editorModal.locator('[data-testid="macro-name-input"]').fill('기록 매크로')
    await editorModal.locator('[data-testid="macro-save-btn"]').click()
    await expect(editorModal).toBeHidden({ timeout: 10_000 })

    // Replay the recorded macro from Macro Manager.
    await ensureMacroManagerOpen(page, frame)
    const recordedRow = page.locator('[data-testid="macro-row"][data-macro-name="기록 매크로"]')
    await expect(recordedRow).toBeVisible({ timeout: 10_000 })
    await recordedRow.locator('[data-testid="macro-run-btn"]').click()

    await expect
      .poll(async () => countOccurrences((await readBodyParagraphs(frame)).join('\n'), '[REC]'), {
        timeout: 15_000,
      })
      .toBe(2)

    // Trigger Undo once and verify the replayed macro reverts completely in one step.
    await executeStudioCommand(frame, 'edit:undo')

    await expect
      .poll(
        async () => {
          const paras = await readBodyParagraphs(frame)
          return {
            recCount: countOccurrences(paras.join('\n'), '[REC]'),
            paraCount: paras.length,
          }
        },
        { timeout: 15_000 },
      )
      .toEqual({ recCount: 1, paraCount: 2 })

    // Flow 2: Create and run a script macro using compatible HAction / HParameterSet objects.
    await ensureMacroManagerOpen(page, frame)
    await page.locator('[data-testid="macro-new-btn"]').click()
    await expect(editorModal).toBeVisible({ timeout: 10_000 })

    const compatScript = [
      'HAction.GetDefault("InsertText", HParameterSet.HInsertText.HSet);',
      'HParameterSet.HInsertText.Text = " [매크로적용]";',
      'HAction.Execute("InsertText", HParameterSet.HInsertText.HSet);',
    ].join('\n')

    await editorModal.locator('[data-testid="macro-name-input"]').fill('스크립트 매크로')
    await editorModal.locator('[data-testid="macro-script-input"]').fill(compatScript)
    await editorModal.locator('[data-testid="macro-save-btn"]').click()
    await expect(editorModal).toBeHidden({ timeout: 10_000 })

    await ensureMacroManagerOpen(page, frame)
    const scriptRow = page.locator('[data-testid="macro-row"][data-macro-name="스크립트 매크로"]')
    await expect(scriptRow).toBeVisible({ timeout: 10_000 })
    await scriptRow.locator('[data-testid="macro-run-btn"]').click()

    await expect
      .poll(async () => (await readBodyParagraphs(frame)).join('\n'), { timeout: 15_000 })
      .toContain('[매크로적용]')

    // Trigger Undo once and verify the script macro's edit disappears completely in one step.
    await executeStudioCommand(frame, 'edit:undo')

    await expect
      .poll(async () => (await readBodyParagraphs(frame)).join('\n'), { timeout: 15_000 })
      .not.toContain('[매크로적용]')

    // Flow 3 (B2): Record Backspace + Shift-selection + Ctrl+B, replay, verify exact text and bold range.
    const manager = page.locator('[data-testid="macro-manager-modal"]')
    if (await manager.isVisible()) {
      await manager.locator('.macro-modal-close').click()
      await expect(manager).toBeHidden({ timeout: 10_000 })
    }
    await page.mouse.click(box.x + box.width / 3, box.y + 80)
    const parasBeforeB2 = await readBodyParagraphs(frame)
    await moveCaret(frame, parasBeforeB2.length - 1, true)
    await page.keyboard.press('Enter')

    await executeStudioCommand(frame, 'ext:ieum-macro-record-toggle')
    await expect(badge).toBeVisible({ timeout: 15_000 })

    await page.keyboard.type('abcd')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('e')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Control+b')

    await expect
      .poll(async () => (await readBodyParagraphs(frame)).at(-1) ?? '', { timeout: 10_000 })
      .toBe('abce')

    await page.locator('[data-testid="macro-recording-stop-btn"]').click()
    await expect(badge).toBeHidden({ timeout: 10_000 })
    await expect(editorModal).toBeVisible({ timeout: 15_000 })

    const b2Script = await scriptInput.inputValue()
    expect(b2Script).toContain('deleteBackward();')
    expect(b2Script).toContain('selectLeft();')
    expect(b2Script).toContain('setCharFormat({ bold: true });')

    await editorModal.locator('[data-testid="macro-name-input"]').fill('편집 기록 매크로')
    await editorModal.locator('[data-testid="macro-save-btn"]').click()
    await expect(editorModal).toBeHidden({ timeout: 10_000 })

    // Move to a fresh unbolded paragraph (split from paragraph 0, which has plain text) and replay.
    await page.mouse.click(box.x + box.width / 3, box.y + 80)
    await moveCaret(frame, 0, true)
    await page.keyboard.press('Enter')
    const replayParaIdx = 1

    await ensureMacroManagerOpen(page, frame)
    const b2Row = page.locator('[data-testid="macro-row"][data-macro-name="편집 기록 매크로"]')
    await expect(b2Row).toBeVisible({ timeout: 10_000 })
    await b2Row.locator('[data-testid="macro-run-btn"]').click()

    await expect
      .poll(async () => (await readBodyParagraphs(frame))[replayParaIdx] ?? '', {
        timeout: 15_000,
      })
      .toBe('abce')

    const boldCheck = await frame.evaluate((paraIndex) => {
      const scope = window as unknown as {
        rhwpStudio: StudioLike
        __e2eBoldCheck?: { at0: boolean; at2: boolean }
      }
      try {
        scope.rhwpStudio.automation.unregisterCommand?.('ext:e2e-macro-bold-check')
      } catch {
        // Command not yet registered.
      }
      scope.rhwpStudio.automation.registerCommand({
        id: 'ext:e2e-macro-bold-check',
        label: 'E2E macro bold check',
        execute(services) {
          const readBold = (off: number): boolean => {
            const raw = services.wasm.getCharPropertiesAt?.(0, paraIndex, off)
            if (!raw) return false
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
            return Boolean(parsed?.bold)
          }
          scope.__e2eBoldCheck = { at0: readBold(0), at2: readBold(2) }
        },
      })
      scope.rhwpStudio.automation.execute('ext:e2e-macro-bold-check')
      return scope.__e2eBoldCheck!
    }, replayParaIdx)
    expect(boldCheck).toEqual({ at0: false, at2: true })

    // Flow 4 (B1): Failing macro preserves action name and line 2, rolls back, and leaves editor ready.
    await ensureMacroManagerOpen(page, frame)
    await page.locator('[data-testid="macro-new-btn"]').click()
    await expect(editorModal).toBeVisible({ timeout: 10_000 })

    const failingScript = ['insertText("SHOULD_ROLLBACK");', 'HAction.Run("Undo");'].join('\n')
    await editorModal.locator('[data-testid="macro-name-input"]').fill('실패 매크로')
    await editorModal.locator('[data-testid="macro-script-input"]').fill(failingScript)
    await editorModal.locator('[data-testid="macro-save-btn"]').click()
    await expect(editorModal).toBeHidden({ timeout: 10_000 })

    await ensureMacroManagerOpen(page, frame)
    const failRow = page.locator('[data-testid="macro-row"][data-macro-name="실패 매크로"]')
    await expect(failRow).toBeVisible({ timeout: 10_000 })
    await failRow.locator('[data-testid="macro-run-btn"]').click()

    const managerNotice = page.locator('[data-testid="macro-notice"]')
    await expect(managerNotice).toBeVisible({ timeout: 15_000 })
    const noticeText = (await managerNotice.textContent()) ?? ''
    expect(noticeText).toContain('Undo')
    expect(noticeText).toContain('2행')
    expect(noticeText).not.toContain('Studio 편집 명령을 완료하지 못했습니다')

    // Confirm atomic rollback: text inserted before line 2 is not present.
    expect((await readBodyParagraphs(frame)).join('\n')).not.toContain('SHOULD_ROLLBACK')

    // Confirm editor is immediately ready after rollback recovery (run another valid macro right away).
    await scriptRow.locator('[data-testid="macro-run-btn"]').click()
    await expect
      .poll(async () => (await readBodyParagraphs(frame)).join('\n'), { timeout: 15_000 })
      .toContain('[매크로적용]')
  } finally {
    await closeAndSaveVideo(launched, 'hwp-macros')
  }
})
