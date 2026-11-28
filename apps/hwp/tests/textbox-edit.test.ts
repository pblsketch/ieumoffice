import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  STUDIO_PATCHES,
  TEXTBOX_EDIT_MODULE,
  applyPatch,
  missingPluginHooks,
  patchTargets,
} from '../scripts/rhwp-patches.mjs'
import { nestedTableAt } from '../studio-plugin/hancom-keys.mjs'
import {
  enterCreatedTextBox,
  enterTextBoxOnDblClick,
  enterTextBoxOnEnterKey,
  finishPendingTextBoxEnter,
  isPointNearBoxBorder,
  isSameTextBoxTarget,
  isTableCellPosition,
  isTableLeafAt,
  moveHorizontalInTextBox,
  preparePendingTextBoxEnter,
  selectTextBoxOnBorderClick,
  shapeHasTextBox,
} from '../studio-plugin/textbox-edit.mjs'

const CORE_MANIFEST = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'vendor', 'rhwp-core', 'package.json'), 'utf8'),
)
const STUDIO_ROOT = join(
  __dirname,
  '..',
  'node_modules',
  '.cache',
  'rhwp-studio',
  CORE_MANIFEST.rhwp.tag,
  'rhwp-studio',
)

describe('textbox-edit helpers', () => {
  it('separates a table inside a text box ([Shape, Table]) from a text box inside a table ([Table, Shape])', () => {
    const tablePath = [
      { controlIndex: 0, cellIndex: 0, cellParaIndex: 0 },
      { controlIndex: 0, cellIndex: 2, cellParaIndex: 0 },
    ]
    const inCellTextBoxPath = [
      { controlIndex: 0, cellIndex: 3, cellParaIndex: 0 },
      { controlIndex: 0, cellIndex: 0, cellParaIndex: 0 },
    ]
    const wasm = {
      getTableDimensionsByPath: vi.fn((_sec: number, _ppi: number, pathJson: string) => {
        const parsed = JSON.parse(pathJson)
        if (parsed[0].cellIndex === 0) return { rows: 2, cols: 2 }
        throw new Error('not a table')
      }),
    }

    expect(isTableLeafAt(wasm, 0, 2, tablePath, true)).toBe(true)
    expect(isTableLeafAt(wasm, 0, 7, inCellTextBoxPath, true)).toBe(false)
    expect(isTableLeafAt(wasm, 0, 2, [tablePath[0]], true)).toBe(false)
    expect(isTableLeafAt(wasm, 0, 7, [inCellTextBoxPath[0]], false)).toBe(true)
    expect(isTableCellPosition(wasm, { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 })).toBe(
      false,
    )

    // nestedTableAt returns null for [Table, Shape] and 'textBox' for [Shape, Table].
    const makeIh = (cellPath: typeof tablePath) => ({
      wasm,
      cursor: {
        isInHeaderFooter: () => false,
        isInFootnote: () => false,
        isInTableObjectSelection: () => false,
        isInCellSelectionMode: () => false,
        isInTextBox: () => true,
        getPosition: () => ({
          sectionIndex: 0,
          parentParaIndex: 7,
          controlIndex: 0,
          cellIndex: cellPath[0].cellIndex,
          cellParaIndex: 0,
          cellPath,
          isTextBox: true,
        }),
      },
    })
    expect(nestedTableAt(makeIh(inCellTextBoxPath))).toBeNull()
    expect(nestedTableAt(makeIh(tablePath))).toBe('textBox')
  })

  it('matches selected body shapes, groups, and in-cell shapes against text box hits', () => {
    const bodyRef = { sec: 0, ppi: 2, ci: 0, type: 'shape' }
    const bodyHit = {
      sectionIndex: 0,
      parentParaIndex: 2,
      controlIndex: 0,
      cellIndex: 0,
      cellPath: [{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }],
      isTextBox: true,
    }
    expect(isSameTextBoxTarget(bodyRef, bodyHit)).toBe(true)
    expect(isSameTextBoxTarget({ ...bodyRef, type: 'group' }, { ...bodyHit, cellIndex: 1 })).toBe(
      true,
    )
    expect(isSameTextBoxTarget({ ...bodyRef, ci: 1 }, bodyHit)).toBe(false)

    const inCellRef = {
      sec: 0,
      ppi: 7,
      ci: 0,
      type: 'shape',
      cellPath: [{ controlIndex: 0, cellIndex: 3, cellParaIndex: 0 }],
    }
    const inCellHit = {
      sectionIndex: 0,
      parentParaIndex: 7,
      controlIndex: 0,
      cellIndex: 3,
      cellPath: [
        { controlIndex: 0, cellIndex: 3, cellParaIndex: 0 },
        { controlIndex: 0, cellIndex: 0, cellParaIndex: 0 },
      ],
      isTextBox: true,
    }
    expect(isSameTextBoxTarget(inCellRef, inCellHit)).toBe(true)
    expect(isSameTextBoxTarget(bodyRef, inCellHit)).toBe(false)
    expect(
      isSameTextBoxTarget(
        { ...inCellRef, cellPath: [{ controlIndex: 0, cellIndex: 1, cellParaIndex: 0 }] },
        inCellHit,
      ),
    ).toBe(false)
  })

  it('scales border tolerance down for thin single-line text boxes', () => {
    // 100x16 thin box: vertical tolerance clamps to 4px, leaving y=8 in the editable interior.
    const thin = { x: 100, y: 50, width: 100, height: 16 }
    expect(isPointNearBoxBorder(150, 58, thin)).toBe(false)
    expect(isPointNearBoxBorder(150, 51, thin)).toBe(true)
    expect(isPointNearBoxBorder(102, 58, thin)).toBe(true)

    // Standard 200x100 box keeps the 5px tolerance.
    const wide = { x: 100, y: 50, width: 200, height: 100 }
    expect(isPointNearBoxBorder(150, 54, wide)).toBe(true)
    expect(isPointNearBoxBorder(150, 60, wide)).toBe(false)
  })

  it('enters text editing on click without drag for a selected floating text box, and skips when dragged', () => {
    const hit = {
      sectionIndex: 0,
      parentParaIndex: 2,
      controlIndex: 0,
      cellIndex: 0,
      cellParaIndex: 0,
      charOffset: 4,
      cellPath: [{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }],
      isTextBox: true,
    }
    const ref = { sec: 0, ppi: 2, ci: 0, type: 'shape' }
    const ih = {
      wasm: {
        hitTest: vi.fn(() => hit),
      },
      findPictureBbox: vi.fn(() => ({ pageIndex: 0, x: 100, y: 100, w: 200, h: 80 })),
      cursor: {
        exitPictureObjectSelection: vi.fn(),
        clearSelection: vi.fn(),
        moveToHit: vi.fn(),
        resetPreferredX: vi.fn(),
      },
      pictureObjectRenderer: { clear: vi.fn() },
      eventBus: { emit: vi.fn() },
      active: false,
      updateCaret: vi.fn(),
      emitCursorFormatState: vi.fn(),
      textarea: { focus: vi.fn() },
    }

    // Border click does not arm pending text entry.
    expect(preparePendingTextBoxEnter(ih, ref, 0, 102, 140)).toBeNull()

    // Interior click arms pending text entry.
    const pending = preparePendingTextBoxEnter(ih, ref, 0, 150, 140)
    expect(pending).toBe(hit)

    // If the user actually dragged, mouseup does not enter editing.
    expect(
      finishPendingTextBoxEnter(ih, {
        pendingEnterTextBoxHit: pending,
        totalDeltaH: 150,
        totalDeltaV: 0,
      }),
    ).toBe(false)
    expect(ih.cursor.moveToHit).not.toHaveBeenCalled()

    // Zero-delta mouseup enters editing at the clicked offset.
    expect(
      finishPendingTextBoxEnter(ih, {
        pendingEnterTextBoxHit: pending,
        totalDeltaH: 0,
        totalDeltaV: 0,
      }),
    ).toBe(true)
    expect(ih.cursor.exitPictureObjectSelection).toHaveBeenCalledTimes(1)
    expect(ih.cursor.moveToHit).toHaveBeenCalledWith(hit)
    expect(ih.updateCaret).toHaveBeenCalledTimes(1)
    expect(ih.textarea.focus).toHaveBeenCalledTimes(1)
  })

  it('enters text editing immediately for newly created text boxes and Enter/double-click on in-cell shapes', () => {
    const moveTo = vi.fn()
    const ih = {
      wasm: {
        getCellParagraphCountByPath: vi.fn(() => 1),
        getCursorRectByPathNear: vi.fn(() => ({ pageIndex: 0, x: 120, y: 200, height: 14 })),
      },
      cursor: {
        exitPictureObjectSelection: vi.fn(),
        clearSelection: vi.fn(),
        moveTo,
        moveToHit: vi.fn(),
        resetPreferredX: vi.fn(),
      },
      pictureObjectRenderer: { clear: vi.fn() },
      eventBus: { emit: vi.fn() },
      active: false,
      updateCaret: vi.fn(),
      emitCursorFormatState: vi.fn(),
      textarea: { focus: vi.fn() },
      pagePointFromClientPoint: vi.fn(() => ({ pageIdx: 0, pageX: 150, pageY: 220 })),
      hitTestFromEvent: vi.fn(() => ({
        sectionIndex: 0,
        parentParaIndex: 7,
        controlIndex: 0,
        cellIndex: 3,
        cellParaIndex: 0,
        charOffset: 2,
        cellPath: [
          { controlIndex: 0, cellIndex: 3, cellParaIndex: 0 },
          { controlIndex: 0, cellIndex: 0, cellParaIndex: 0 },
        ],
        isTextBox: true,
      })),
    }

    expect(enterCreatedTextBox(ih, 0, 0, 1)).toBe(true)
    expect(moveTo).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sectionIndex: 0,
        parentParaIndex: 0,
        controlIndex: 1,
        isTextBox: true,
        cellPath: [{ controlIndex: 1, cellIndex: 0, cellParaIndex: 0 }],
      }),
    )

    const inCellRef = {
      sec: 0,
      ppi: 7,
      ci: 0,
      type: 'shape',
      cellPath: [{ controlIndex: 0, cellIndex: 3, cellParaIndex: 0 }],
    }
    expect(enterTextBoxOnEnterKey(ih, inCellRef)).toBe(true)
    expect(moveTo).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sectionIndex: 0,
        parentParaIndex: 7,
        controlIndex: 0,
        cellIndex: 3,
        isTextBox: true,
        cellPath: [
          { controlIndex: 0, cellIndex: 3, cellParaIndex: 0 },
          { controlIndex: 0, cellIndex: 0, cellParaIndex: 0 },
        ],
      }),
    )

    const preventDefault = vi.fn()
    expect(
      enterTextBoxOnDblClick(ih, inCellRef, { clientX: 150, clientY: 220, preventDefault }),
    ).toBe(true)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(ih.cursor.moveToHit).toHaveBeenCalledTimes(1)

    // Plain shape without a text box returns false on Enter and shapeHasTextBox.
    ih.wasm.getCellParagraphCountByPath.mockImplementationOnce(() => {
      throw new Error('no textbox')
    })
    expect(enterTextBoxOnEnterKey(ih, { sec: 0, ppi: 1, ci: 0, type: 'shape' })).toBe(false)
    ih.wasm.getCellParagraphCountByPath.mockImplementationOnce(() => 0)
    expect(shapeHasTextBox(ih.wasm, { sec: 0, ppi: 1, ci: 0, type: 'shape' })).toBe(false)
  })

  it('selects an in-cell shape by its parent cellPath on border clicks', () => {
    const enterPictureObjectSelectionDirect = vi.fn()
    const ih = {
      wasm: {
        getTableDimensionsByPath: vi.fn(() => {
          throw new Error('not a table')
        }),
      },
      findPictureBbox: vi.fn(() => ({ pageIndex: 0, x: 200, y: 300, w: 120, h: 60 })),
      cursor: {
        clearSelection: vi.fn(),
        enterPictureObjectSelectionDirect,
      },
      exitPictureObjectSelectionIfNeeded: vi.fn(),
      active: false,
      caret: { hide: vi.fn() },
      selectionRenderer: { clear: vi.fn() },
      renderPictureObjectSelection: vi.fn(),
      eventBus: { emit: vi.fn() },
      textarea: { focus: vi.fn() },
    }
    const hit = {
      sectionIndex: 0,
      parentParaIndex: 7,
      controlIndex: 0,
      cellIndex: 3,
      cellPath: [
        { controlIndex: 0, cellIndex: 3, cellParaIndex: 0 },
        { controlIndex: 0, cellIndex: 0, cellParaIndex: 0 },
      ],
      isTextBox: true,
    }

    // Interior click is not treated as a border click.
    expect(selectTextBoxOnBorderClick(ih, 0, 250, 330, hit)).toBe(false)
    // Border click selects the inner shape with its parent cellPath.
    expect(selectTextBoxOnBorderClick(ih, 0, 202, 330, hit)).toBe(true)
    expect(enterPictureObjectSelectionDirect).toHaveBeenCalledWith(
      0,
      7,
      0,
      'shape',
      undefined,
      undefined,
      undefined,
      undefined,
      [{ controlIndex: 0, cellIndex: 3, cellParaIndex: 0 }],
      undefined,
      undefined,
      0,
    )
  })

  it('moves horizontally inside nested and grouped text boxes without leaving the box', () => {
    const lengths = [3, 4]
    let pos = {
      sectionIndex: 0,
      paragraphIndex: 0,
      charOffset: 3,
      parentParaIndex: 7,
      controlIndex: 0,
      cellIndex: 3,
      cellParaIndex: 0,
      cellPath: [
        { controlIndex: 0, cellIndex: 3, cellParaIndex: 0 },
        { controlIndex: 0, cellIndex: 0, cellParaIndex: 0 },
      ],
      isTextBox: true,
    }
    const cursor = {
      wasm: {
        getTableDimensionsByPath: () => {
          throw new Error('not a table')
        },
        getCellParagraphLengthByPath: (_s: number, _p: number, pathJson: string) => {
          const parsed = JSON.parse(pathJson)
          return lengths[parsed[parsed.length - 1].cellParaIndex]
        },
        getCellParagraphCountByPath: () => lengths.length,
      },
      getPosition: () => pos,
      moveTo: (next: typeof pos) => {
        pos = next
      },
    }

    // Moving right past end of para 0 advances to para 1 offset 0.
    expect(moveHorizontalInTextBox(cursor, 1)).toBe(true)
    expect(pos.cellParaIndex).toBe(1)
    expect(pos.charOffset).toBe(0)
    expect(pos.cellPath[1].cellParaIndex).toBe(1)

    // Moving left from para 1 offset 0 goes back to para 0 end.
    expect(moveHorizontalInTextBox(cursor, -1)).toBe(true)
    expect(pos.cellParaIndex).toBe(0)
    expect(pos.charOffset).toBe(3)

    // At start of para 0, moving left stays inside the box.
    pos = { ...pos, charOffset: 0 }
    expect(moveHorizontalInTextBox(cursor, -1)).toBe(true)
    expect(pos.cellParaIndex).toBe(0)
    expect(pos.charOffset).toBe(0)
  })
})

describe('textbox-edit studio patches', () => {
  const patchNames = [
    'studio-textbox-edit-mouse',
    'studio-textbox-edit-picture',
    'studio-textbox-edit-keyboard',
    'studio-textbox-edit-handler',
    'studio-textbox-edit-cursor',
  ] as const

  it('are all registered in STUDIO_PATCHES', () => {
    for (const name of patchNames) {
      expect(STUDIO_PATCHES, name).toContain(name)
    }
  })

  it.skipIf(!existsSync(STUDIO_ROOT))(
    'apply cleanly in STUDIO_PATCHES order to the pinned rhwp-studio checkout',
    () => {
      const files = [
        'src/engine/input-handler-mouse.ts',
        'src/engine/input-handler-picture.ts',
        'src/engine/input-handler-keyboard.ts',
        'src/engine/input-handler.ts',
        'src/engine/cursor.ts',
      ]
      for (const rel of files) {
        const full = join(STUDIO_ROOT, rel)
        let code = readFileSync(full, 'utf8')
        for (const name of STUDIO_PATCHES) {
          if (patchTargets(name, full)) {
            code = applyPatch(name, code)
          }
        }
        expect(code, rel).toContain(TEXTBOX_EDIT_MODULE)
      }
      expect(
        missingPluginHooks((rel) => {
          const full = join(STUDIO_ROOT, rel)
          return existsSync(full) ? readFileSync(full, 'utf8') : null
        }),
      ).toEqual([])
    },
  )
})
