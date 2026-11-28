/**
 * Engine-level text box hit-testing and editing (vendor/rhwp-core patch 0057).
 *
 * Verifies that:
 * - A shape text box nested inside a table cell emits a full depth-2 cellPath
 *   ([TableCell, ShapeTextBox]) for hit-testing, cursor lookup, text insert/delete,
 *   paragraph split/merge, and save round-trips without modifying outer table cells.
 * - Clicking line spacing or empty padding inside a multi-line body text box
 *   resolves to the nearest visual line/offset instead of snapping to offset 0.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'

const require = createRequire(import.meta.url)
const LETTER_FIXTURE = join(__dirname, 'fixtures', 'shape-in-cell-letter.hwp')

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

interface ControlBox {
  type: string
  paraIdx: number
  controlIdx: number
  x: number
  y: number
  w: number
  h: number
}

function loadLetter(): HwpDocument {
  const bytes = new Uint8Array(readFileSync(LETTER_FIXTURE))
  return new HwpDocument(bytes)
}

describe('rhwp patch 0057: in-cell text box editing and textbox hit-test', () => {
  it('hit-tests, resolves cursor rect, edits, splits, merges, and round-trips a text box inside a table cell', () => {
    const doc = loadLetter()
    const layout = JSON.parse(doc.getPageControlLayout(0)) as { controls: ControlBox[] }
    const cellShape = layout.controls.find((c) => c.type === 'shape' && c.paraIdx === 7)
    expect(cellShape).toBeDefined()

    // Click top, middle, and lower area inside the in-cell text box: all must hit the depth-2 textbox path.
    for (const [dx, dy] of [
      [30, 15],
      [30, 35],
      [30, 65],
    ]) {
      const hit = JSON.parse(doc.hitTest(0, cellShape!.x + dx, cellShape!.y + dy))
      expect(hit.isTextBox, `(${dx},${dy})`).toBe(true)
      expect(hit.parentParaIndex, `(${dx},${dy})`).toBe(7)
      expect(hit.cellPath, `(${dx},${dy})`).toHaveLength(2)
      expect(hit.cellPath[0]).toMatchObject({ controlIndex: 0, cellIndex: 3, cellParaIndex: 0 })
      expect(hit.cellPath[1]).toMatchObject({ controlIndex: 0, cellIndex: 0 })
    }

    const inCellPath = JSON.stringify([
      { controlIndex: 0, cellIndex: 3, cellParaIndex: 0 },
      { controlIndex: 0, cellIndex: 0, cellParaIndex: 0 },
    ])
    const outerCell0Path = JSON.stringify([{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }])
    const outerCell0Before = doc.getTextInCellByPath(0, 7, outerCell0Path, 0, 100)

    // Cursor rect lookup succeeds on the depth-2 path.
    const rect = JSON.parse(doc.getCursorRectByPathNear(0, 7, inCellPath, 0, 0))
    expect(rect.pageIndex).toBe(0)
    expect(rect.x).toBeGreaterThanOrEqual(cellShape!.x)
    expect(rect.x).toBeLessThanOrEqual(cellShape!.x + cellShape!.w)

    // Insert, split (Enter), merge (Backspace), and delete inside the in-cell text box.
    doc.insertTextInCellByPath(0, 7, inCellPath, 0, 'EDIT')
    expect(doc.getTextInCellByPath(0, 7, inCellPath, 0, 100).startsWith('EDIT')).toBe(true)
    expect(doc.getTextInCellByPath(0, 7, outerCell0Path, 0, 100)).toBe(outerCell0Before)

    const splitRes = JSON.parse(doc.splitParagraphInCellByPath(0, 7, inCellPath, 4))
    expect(splitRes.ok).toBe(true)
    expect(doc.getCellParagraphCountByPath(0, 7, inCellPath)).toBeGreaterThanOrEqual(2)

    const para1Path = JSON.stringify([
      { controlIndex: 0, cellIndex: 3, cellParaIndex: 0 },
      { controlIndex: 0, cellIndex: 0, cellParaIndex: 1 },
    ])
    doc.insertTextInCellByPath(0, 7, para1Path, 0, 'SECOND_')
    expect(doc.getTextInCellByPath(0, 7, para1Path, 0, 100).startsWith('SECOND_')).toBe(true)

    const mergeRes = JSON.parse(doc.mergeParagraphInCellByPath(0, 7, para1Path))
    expect(mergeRes.ok).toBe(true)
    expect(doc.getTextInCellByPath(0, 7, inCellPath, 0, 100).startsWith('EDITSECOND_')).toBe(true)

    // Save and reopen preserves the edited in-cell text box content.
    const saved = doc.exportHwp()
    const reopened = new HwpDocument(new Uint8Array(saved))
    expect(reopened.getTextInCellByPath(0, 7, inCellPath, 0, 100).startsWith('EDITSECOND_')).toBe(
      true,
    )
    expect(reopened.getTextInCellByPath(0, 7, outerCell0Path, 0, 100)).toBe(outerCell0Before)

    reopened.free()
    doc.free()
  })

  it('resolves clicks on line spacing or right padding inside a multi-line body text box to the nearest line/offset', () => {
    const doc = loadLetter()
    const layout = JSON.parse(doc.getPageControlLayout(0)) as { controls: ControlBox[] }
    const bodyShape = layout.controls.find((c) => c.type === 'shape' && c.paraIdx === 2)
    expect(bodyShape).toBeDefined()

    // Clicking near the bottom-right empty area inside the multi-line text box must not snap to (para 0, offset 0).
    const hitBottomRight = JSON.parse(
      doc.hitTest(0, bodyShape!.x + bodyShape!.w - 10, bodyShape!.y + bodyShape!.h - 8),
    )
    expect(hitBottomRight.isTextBox).toBe(true)
    expect(hitBottomRight.parentParaIndex).toBe(2)
    expect(
      (hitBottomRight.cellPath?.[0]?.cellParaIndex ?? hitBottomRight.cellParaIndex ?? 0) > 0 ||
        hitBottomRight.charOffset > 0,
    ).toBe(true)

    doc.free()
  })
})
