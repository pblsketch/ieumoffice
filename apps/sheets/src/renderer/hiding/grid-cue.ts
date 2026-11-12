/**
 * A screen-only cue on cells hidden by sensitive-info hiding: a corner mark in
 * the bottom-left, drawn through Univer's cell-content interceptor like the
 * note and comment markers. Nothing of it reaches the workbook data, the save
 * or the clipboard's cell styles.
 *
 * The marks are read from the name table again after any mutation (names
 * shift with inserted rows and renamed sheets), lazily when a cell is drawn.
 */
import { InterceptorEffectEnum, ICommandService, CommandType } from '@univerjs/core'
import { IRenderManagerService } from '@univerjs/engine-render'
import { SheetSkeletonManagerService } from '@univerjs/preset-sheets-core'
import { INTERCEPTOR_POINT, SheetInterceptorService } from '@univerjs/sheets'
import type { UniverRuntime } from '../univer-state'
import { markAt, readHidingMarks, type SheetHidingMark } from './marks'

/** Canvas chrome colors, kept out of document data and keyed by UI theme. */
export const HIDING_CUE_CANVAS_COLORS = {
  light: { marker: '#5b6b7f' },
  dark: { marker: '#9aa9bb' },
} as const

export type HidingCueTheme = keyof typeof HIDING_CUE_CANVAS_COLORS

export function installHidingGridCue(
  runtime: UniverRuntime,
  theme: () => HidingCueTheme,
): { dispose(): void } {
  const injector = runtime.univer.__getInjector()
  let marks: readonly SheetHidingMark[] | null = null
  const current = (): readonly SheetHidingMark[] => {
    if (marks) return marks
    const read = readHidingMarks(runtime, null)
    marks = read.ok ? read.marks : []
    return marks
  }
  const interceptor = injector
    .get(SheetInterceptorService)
    .intercept(INTERCEPTOR_POINT.CELL_CONTENT, {
      // below the comment (101) and note (100) markers: they keep their corners
      priority: 99,
      effect: InterceptorEffectEnum.Style,
      handler: (cell, position, next) => {
        const list = current()
        if (list.length === 0 || !markAt(list, position.subUnitId, position.row, position.col)) {
          return next(cell)
        }
        const base = !cell || cell === position.rawData ? { ...position.rawData } : cell
        return next({
          ...base,
          markers: {
            ...base?.markers,
            bl: { color: HIDING_CUE_CANVAS_COLORS[theme()].marker, size: 6 },
          },
        })
      },
    })

  const refresh = (): void => {
    const workbookId = runtime.univerAPI.getActiveWorkbook()?.getId()
    if (!workbookId) return
    try {
      const render = injector.get(IRenderManagerService).getRenderById(workbookId)
      render?.with(SheetSkeletonManagerService).reCalculate()
      render?.mainComponent?.makeDirty(true)
    } catch {
      // Render modules may not exist yet during workbook replacement.
    }
  }

  let before = ''
  const listener = injector.get(ICommandService).onCommandExecuted((command) => {
    if (command.type !== CommandType.MUTATION) return
    marks = null
    const key = JSON.stringify(current().map((mark) => [mark.name, mark.areas]))
    if (key !== before) {
      before = key
      refresh()
    }
  })

  return {
    dispose() {
      interceptor.dispose()
      listener.dispose()
    },
  }
}
