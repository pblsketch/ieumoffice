/**
 * Editing text inside HWP text boxes (floating, newly inserted, and nested
 * inside table cells) as Hancom Hangul does.
 */
import { test, expect } from '@playwright/test'
import type { Frame, Page } from '@playwright/test'
import { copyFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'

const STUDIO_IFRAME = '.hwp-editor-host iframe'
const LETTER_ASSET = join(
  __dirname,
  '..',
  'apps',
  'hwp',
  'tests',
  'fixtures',
  'shape-in-cell-letter.hwp',
)
const OBJECTS_ASSET = join(__dirname, 'assets', 'hwp-picture-table.hwp')

interface LayoutControl {
  type: string
  paraIdx: number
  controlIdx: number
  cellPath?: Array<{ controlIndex: number; cellIndex: number; cellParaIndex: number }>
  x: number
  y: number
  w: number
  h: number
}

interface Probe {
  inPicSel: boolean
  inTextBox: boolean
  pos: {
    sectionIndex: number
    paragraphIndex: number
    charOffset: number
    parentParaIndex?: number
    controlIndex?: number
    cellIndex?: number
    cellParaIndex?: number
    cellPath?: Array<{ controlIndex: number; cellIndex: number; cellParaIndex: number }>
    isTextBox?: boolean
  }
  pageWidth: number
  controls: LayoutControl[]
}

async function openHwp(
  asset: string,
  videoDir: string,
): Promise<{
  launched: Awaited<ReturnType<typeof launchShell>>
  hwp: Page
  frame: Frame
}> {
  const dir = await mkdtemp(join(tmpdir(), `${videoDir}-`))
  const file = join(dir, 'doc.hwp')
  await copyFile(asset, file)
  const launched = await launchShell({
    onboardingSeen: true,
    videoDir,
    openFiles: [file],
  })
  const hwp = await waitForPageWithUrl(launched.app, '://hwp/')
  await hwp.waitForSelector('.hwp-app[data-phase="ready"]', { timeout: 90_000 })
  const deadline = Date.now() + 60_000
  let frame: Frame | undefined
  while (!(frame = hwp.frames().find((f) => f.url().includes('/studio/')))) {
    if (Date.now() > deadline) throw new Error('studio frame never loaded')
    await hwp.waitForTimeout(100)
  }
  await frame.locator('#scroll-content canvas').first().waitFor({ timeout: 60_000 })
  await frame.evaluate(() => {
    const w = window as unknown as {
      rhwpStudio: {
        automation: {
          registerCommand(def: {
            id: string
            label: string
            execute(services: unknown): void
          }): void
        }
        __textboxProbe?: boolean
      }
      __tbServices?: unknown
      __tbState?: Probe
    }
    if (w.rhwpStudio.__textboxProbe) return
    w.rhwpStudio.automation.registerCommand({
      id: 'ext:e2e-textbox-probe',
      label: 'E2E textbox probe',
      execute(services: unknown) {
        const s = services as {
          wasm: {
            getPageInfo(page: number): { width: number }
            getPageControlLayout(page: number): { controls: LayoutControl[] }
          }
          getInputHandler(): {
            cursor: {
              isInPictureObjectSelection(): boolean
              isInTextBox(): boolean
              getPosition(): Probe['pos']
            }
          }
        }
        const ih = s.getInputHandler()
        w.__tbServices = services
        w.__tbState = {
          inPicSel: ih.cursor.isInPictureObjectSelection(),
          inTextBox: ih.cursor.isInTextBox(),
          pos: ih.cursor.getPosition(),
          pageWidth: s.wasm.getPageInfo(0).width,
          controls: s.wasm.getPageControlLayout(0).controls,
        }
      },
    })
    w.rhwpStudio.__textboxProbe = true
  })
  await expect.poll(async () => (await probe(frame)).controls.length).toBeGreaterThan(0)
  return { launched, hwp, frame }
}

async function probe(frame: Frame): Promise<Probe> {
  return frame.evaluate(() => {
    const w = window as unknown as {
      rhwpStudio: { automation: { execute(id: string): void } }
      __tbState: Probe
    }
    w.rhwpStudio.automation.execute('ext:e2e-textbox-probe')
    return w.__tbState
  })
}

async function readTextByPath(
  frame: Frame,
  sec: number,
  ppi: number,
  path: Array<{ controlIndex: number; cellIndex: number; cellParaIndex: number }>,
): Promise<string> {
  return frame.evaluate(
    ({ sec, ppi, path }) => {
      const s = (
        window as unknown as {
          __tbServices: {
            wasm: {
              getTextInCellByPath(
                sec: number,
                ppi: number,
                pathJson: string,
                offset: number,
                count: number,
              ): string
            }
          }
        }
      ).__tbServices
      return s.wasm.getTextInCellByPath(sec, ppi, JSON.stringify(path), 0, 200)
    },
    { sec, ppi, path },
  )
}

async function screen(hwp: Page, frame: Frame, x: number, y: number) {
  const { pageWidth } = await probe(frame)
  const canvas = hwp.frameLocator(STUDIO_IFRAME).locator('#scroll-content canvas').first()
  const box = (await canvas.boundingBox())!
  const scale = box.width / pageWidth
  return { x: box.x + x * scale, y: box.y + y * scale }
}

test.describe('HWP text box editing', () => {
  test.setTimeout(240_000)

  test('edits a selected floating text box and a text box inside a table cell', async () => {
    const { launched, hwp, frame } = await openHwp(LETTER_ASSET, 'hwp-textbox-edit-letter')
    try {
      const st0 = await probe(frame)
      const bodyShape = st0.controls.find((c) => c.type === 'shape' && c.paraIdx === 2)!
      const cellShape = st0.controls.find((c) => c.type === 'shape' && c.paraIdx === 7)!
      expect(bodyShape).toBeTruthy()
      expect(cellShape).toBeTruthy()

      // 1. Select the floating body text box on its border, then click inside once and type.
      const border = await screen(hwp, frame, bodyShape.x + 1, bodyShape.y + bodyShape.h / 2)
      await hwp.mouse.click(border.x, border.y)
      await expect.poll(async () => (await probe(frame)).inPicSel).toBe(true)

      const insideBody = await screen(hwp, frame, bodyShape.x + 50, bodyShape.y + 12)
      await hwp.mouse.click(insideBody.x, insideBody.y)
      await expect.poll(async () => (await probe(frame)).inTextBox).toBe(true)
      expect((await probe(frame)).inPicSel).toBe(false)

      await hwp.keyboard.type('AAA')
      await expect
        .poll(() =>
          readTextByPath(frame, 0, 2, [{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }]),
        )
        .toContain('AAA')

      // 2. Click inside the shape text box nested inside table cell 3 and edit with text, Enter, Backspace.
      const outerCell0Before = await readTextByPath(frame, 0, 7, [
        { controlIndex: 0, cellIndex: 0, cellParaIndex: 0 },
      ])
      const insideCellShape = await screen(hwp, frame, cellShape.x + 30, cellShape.y + 15)
      await hwp.mouse.click(insideCellShape.x, insideCellShape.y)
      await expect.poll(async () => (await probe(frame)).inTextBox).toBe(true)
      const inCellState = await probe(frame)
      expect(inCellState.pos.cellPath?.length).toBe(2)

      await hwp.keyboard.type('ZZZ')
      const inCellPath = [
        { controlIndex: 0, cellIndex: 3, cellParaIndex: 0 },
        { controlIndex: 0, cellIndex: 0, cellParaIndex: 0 },
      ]
      await expect.poll(() => readTextByPath(frame, 0, 7, inCellPath)).toContain('ZZZ')
      // Outer table cell 0 must stay untouched.
      expect(
        await readTextByPath(frame, 0, 7, [{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }]),
      ).toBe(outerCell0Before)

      // Enter splits the paragraph inside the in-cell text box; Backspace merges it back.
      await hwp.keyboard.press('Enter')
      await hwp.keyboard.type('LINE2')
      const inCellPathPara1 = [
        { controlIndex: 0, cellIndex: 3, cellParaIndex: 0 },
        { controlIndex: 0, cellIndex: 0, cellParaIndex: 1 },
      ]
      await expect.poll(() => readTextByPath(frame, 0, 7, inCellPathPara1)).toContain('LINE2')

      for (let i = 0; i < 5; i += 1) {
        await hwp.keyboard.press('ArrowLeft')
      }
      await hwp.keyboard.press('Backspace')
      await expect.poll(() => readTextByPath(frame, 0, 7, inCellPath)).toContain('ZZZLINE2')
    } finally {
      await closeAndSaveVideo(launched, 'hwp-textbox-edit-letter')
    }
  })

  test('enters text editing immediately after inserting a new text box', async () => {
    const { launched, hwp, frame } = await openHwp(OBJECTS_ASSET, 'hwp-textbox-edit-insert')
    try {
      await frame.evaluate(() => {
        const w = window as unknown as {
          rhwpStudio: { automation: { execute(id: string): void } }
        }
        w.rhwpStudio.automation.execute('insert:textbox')
      })
      await hwp.waitForTimeout(100)
      const p1 = await screen(hwp, frame, 150, 350)
      const p2 = await screen(hwp, frame, 350, 450)
      await hwp.mouse.move(p1.x, p1.y)
      await hwp.mouse.down()
      await hwp.mouse.move(p2.x, p2.y, { steps: 5 })
      await hwp.mouse.up()

      await expect.poll(async () => (await probe(frame)).inTextBox).toBe(true)
      const afterInsert = await probe(frame)
      expect(afterInsert.inPicSel).toBe(false)

      await hwp.keyboard.type('NEWBOX')
      const pos = afterInsert.pos
      await expect
        .poll(() =>
          readTextByPath(frame, pos.sectionIndex, pos.parentParaIndex!, [
            { controlIndex: pos.controlIndex!, cellIndex: 0, cellParaIndex: 0 },
          ]),
        )
        .toBe('NEWBOX')
    } finally {
      await closeAndSaveVideo(launched, 'hwp-textbox-edit-insert')
    }
  })
})
