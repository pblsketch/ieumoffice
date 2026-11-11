/** Caption menu, history and form protection in the built HWP editor. */
import { test, expect } from '@playwright/test'
import type { Frame } from '@playwright/test'
import { copyFile, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ARTIFACTS_DIR, closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'

async function execute(frame: Frame, id: string, params?: Record<string, unknown>) {
  return frame.evaluate(
    ({ id, params }) => (window as any).rhwpStudio.automation.execute(id, params),
    { id, params },
  )
}

async function state(frame: Frame) {
  await execute(frame, 'ext:e2e-caption-probe')
  return frame.evaluate(() => (window as any).__captionState)
}

async function select(frame: Frame) {
  expect(await execute(frame, 'ext:e2e-caption-probe', { select: true })).toMatchObject({
    ok: true,
  })
}

test('caption menus preserve text through movement, removal, undo and redo', async () => {
  test.setTimeout(150_000)
  const file = join(await mkdtemp(join(tmpdir(), 'ieum-caption-e2e-')), 'blank.hwp')
  await copyFile(join(__dirname, '../apps/hwp/src/renderer/assets/blank.hwp'), file)
  const launched = await launchShell({
    onboardingSeen: true,
    openFile: file,
    videoDir: 'hwp-captions',
    recordVideo: false,
  })
  try {
    const hwp = await waitForPageWithUrl(launched.app, '://hwp/')
    await hwp.locator('.hwp-app[data-phase="ready"]').waitFor({ timeout: 90_000 })
    const frame = hwp.frames().find((candidate) => candidate.url().includes('/studio/'))!
    await frame.locator('#scroll-content canvas').first().waitFor({ timeout: 60_000 })
    await frame.evaluate(() => {
      const studio = (window as any).rhwpStudio
      let ref: { sec: number; ppi: number; ci: number } | null = null
      studio.automation.registerCommand({
        id: 'ext:e2e-caption-probe',
        label: 'E2E caption probe',
        execute(services: any, params?: Record<string, unknown>) {
          const input = services.getInputHandler()
          const pos = input.getCursorPosition()
          ref ??=
            input.getSelectedTableRef() ??
            (pos.parentParaIndex === undefined
              ? null
              : { sec: pos.sectionIndex, ppi: pos.parentParaIndex, ci: pos.controlIndex })
          if (!ref) {
            ;(window as any).__captionState = null
            return
          }
          if (params?.select) {
            input.cursor.enterTableObjectSelectionDirect(ref.sec, ref.ppi, ref.ci)
            input.updateCaret()
          }
          if (typeof params?.form === 'boolean') input.setEditMode(params.form ? 'form' : 'normal')
          if (params?.focus) input.focus()
          const props = services.wasm.getTableProperties(ref.sec, ref.ppi, ref.ci)
          const length = props.hasCaption
            ? services.wasm.getCellParagraphLength(ref.sec, ref.ppi, ref.ci, 65534, 0)
            : 0
          ;(window as any).__captionState = {
            ...props,
            text: length
              ? services.wasm.getTextInCell(ref.sec, ref.ppi, ref.ci, 65534, 0, 0, length)
              : '',
          }
        },
      })
    })
    expect(
      await frame.evaluate(() =>
        (window as any).rhwpStudio.automation.isEnabled('insert:caption-top'),
      ),
    ).toBe(false)
    await frame.locator('#menu-bar .menu-item[data-menu="table"] .menu-title').click()
    await frame.locator('.md-item[data-cmd="table:create"]').click()
    const grid = frame.locator('div[data-row="1"][data-col="1"]')
    await grid.hover()
    await grid.click()
    expect((await state(frame)).hasCaption).toBe(false)

    // Open the actual submenu: registry activation alone would miss a disabled parent.
    await frame.locator('#menu-bar .menu-item[data-menu="insert"] .menu-title').click()
    const top = frame.locator('.md-item[data-cmd="insert:caption-top"]')
    const submenu = top.locator('xpath=../..')
    await expect(submenu).not.toHaveClass(/disabled/)
    await submenu.hover()
    await expect(top).not.toHaveClass(/disabled/)
    await top.click()
    expect(await state(frame)).toMatchObject({ hasCaption: true, captionDirection: 2 })

    await select(frame)
    expect(await execute(frame, 'table:caption-toggle')).toMatchObject({ ok: true })
    await execute(frame, 'ext:e2e-caption-probe', { focus: true })
    await hwp.keyboard.type('Caption body survives')
    await expect.poll(async () => (await state(frame)).text).toContain('Caption body survives')
    const body = (await state(frame)).text
    await select(frame)
    expect(await execute(frame, 'insert:caption-rm')).toMatchObject({ ok: true })
    expect(await state(frame)).toMatchObject({
      hasCaption: true,
      captionDirection: 1,
      captionVertAlign: 1,
      text: body,
    })
    expect(await execute(frame, 'edit:undo')).toMatchObject({ ok: true })
    expect(await state(frame)).toMatchObject({ captionDirection: 2, text: body })
    expect(await execute(frame, 'edit:redo')).toMatchObject({ ok: true })
    expect(await state(frame)).toMatchObject({ captionDirection: 1, text: body })

    await select(frame)
    expect(await execute(frame, 'insert:caption-none')).toMatchObject({ ok: true })
    expect((await state(frame)).hasCaption).toBe(false)
    expect(await execute(frame, 'edit:undo')).toMatchObject({ ok: true })
    expect(await state(frame)).toMatchObject({ hasCaption: true, text: body })
    expect(await execute(frame, 'edit:redo')).toMatchObject({ ok: true })
    expect((await state(frame)).hasCaption).toBe(false)
    await execute(frame, 'edit:undo')

    await select(frame)
    await execute(frame, 'ext:e2e-caption-probe', { form: true })
    expect(await execute(frame, 'insert:caption-none')).toMatchObject({ ok: false })
    expect(await state(frame)).toMatchObject({ hasCaption: true, text: body })
    await execute(frame, 'ext:e2e-caption-probe', { form: false })
    const directory = join(ARTIFACTS_DIR, 'screenshots')
    await mkdir(directory, { recursive: true })
    await hwp.screenshot({ path: join(directory, 'hwp-caption-position.png') })
  } finally {
    await closeAndSaveVideo(launched, 'hwp-captions')
  }
})
