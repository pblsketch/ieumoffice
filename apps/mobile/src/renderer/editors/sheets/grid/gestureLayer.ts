/**
 * The phone's gesture layer over Univer's mobile grid (spec 2.8-1). It
 * listens in the capture phase, before Univer's canvas sees the press, and:
 *
 * - keeps the press history the double-tap judge reads (gestureJudge.ts);
 *   mobileGrid.ts refuses Univer's double-click edit when the judge says the
 *   two presses were not a double tap;
 * - opens our row/column menu on a long press over a header (Univer's mobile
 *   long-press menu only covers the cell area);
 * - decides, per press, whether the selection handles or the freeze divider
 *   may be grabbed (handleGuard.ts) by turning the losing objects' `evented`
 *   off until the finger lifts.
 *
 * Univer's own handling is untouched otherwise: a tap still selects, a header
 * press still selects the line, one finger still scrolls.
 */
import { IUniverInstanceService, UniverInstanceType } from '@univerjs/core'
import {
  IRenderManagerService,
  Vector2,
  type BaseObject,
  type IRender,
  type Scene,
} from '@univerjs/engine-render'
import { SheetSkeletonManagerService, getCoordByOffset } from '@univerjs/sheets-ui'
import type { UniverRuntime } from '../../../../../../sheets/src/renderer/univer-state'
import { LONG_PRESS_MS, PressTracker, TAP_SLOP_PX, isLongPress } from './gestureJudge'
import { decideHandleGuard, reachPoints, type HandleGuard } from './handleGuard'
import { isHeaderLineSelected, type HeaderAxis } from './headerMenu'

/** Univer's freeze divider shapes (HeaderFreezeRenderController). */
const FREEZE_OBJECT_KEYS = [
  '__SpreadsheetFreezeRowMainName__',
  '__SpreadsheetFreezeRowHeaderName__',
  '__SpreadsheetFreezeColumnMainName__',
  '__SpreadsheetFreezeColumnHeaderName__',
] as const
/** Univer's mobile selection corner handles (MobileSelectionControl). */
const FILL_HANDLE_PREFIX = '__SpreadsheetSelectionFillControl'

const ROW_HEADER_VIEWPORTS = new Set(['viewRowTop', 'viewRowBottom'])
const COLUMN_HEADER_VIEWPORTS = new Set(['viewColumnLeft', 'viewColumnRight'])

export interface GestureLayerOptions {
  /** View mode: no header menu (the grid opens to read). */
  readonly isViewMode: () => boolean
  /**
   * A still press on a header outlived LONG_PRESS_MS. `wasSelected`: the line
   * was inside a whole-line selection before the press (Univer's own press
   * handling may change the selection in between).
   */
  readonly onHeaderLongPress: (axis: HeaderAxis, index: number, wasSelected: boolean) => void
  readonly now?: () => number
}

export interface GestureLayer {
  /** Whether the press now down began as a real double tap (see gestureJudge.ts). */
  acceptsDoubleTap(): boolean
  dispose(): void
}

interface SheetRenderParts {
  readonly scene: Scene
  readonly canvas: HTMLCanvasElement
  readonly render: IRender
}

function sheetRender(runtime: UniverRuntime): SheetRenderParts | null {
  const injector = runtime.univer.__getInjector()
  const workbook = injector
    .get(IUniverInstanceService)
    .getCurrentUnitOfType(UniverInstanceType.UNIVER_SHEET)
  if (!workbook) return null
  const render = injector.get(IRenderManagerService).getRenderById(workbook.getUnitId())
  if (!render) return null
  return { scene: render.scene, canvas: render.engine.getCanvasElement(), render }
}

function canvasOffset(parts: SheetRenderParts, clientX: number, clientY: number) {
  const rect = parts.canvas.getBoundingClientRect()
  return { x: clientX - rect.left, y: clientY - rect.top }
}

/** The header line under a canvas point, or null outside the headers. */
export function headerLineAt(
  runtime: UniverRuntime,
  clientX: number,
  clientY: number,
): { axis: HeaderAxis; index: number } | null {
  const parts = sheetRender(runtime)
  if (!parts) return null
  const { x, y } = canvasOffset(parts, clientX, clientY)
  const viewport = parts.scene.getActiveViewportByCoord(Vector2.FromArray([x, y]))
  if (!viewport) return null
  const axis: HeaderAxis | null = ROW_HEADER_VIEWPORTS.has(viewport.viewportKey)
    ? 'row'
    : COLUMN_HEADER_VIEWPORTS.has(viewport.viewportKey)
      ? 'column'
      : null
  if (!axis) return null
  const skeleton = parts.render.with(SheetSkeletonManagerService).getCurrentParam()?.skeleton
  if (!skeleton) return null
  const coord = getCoordByOffset(x, y, parts.scene, skeleton, viewport)
  const index = axis === 'row' ? coord.row : coord.column
  return index >= 0 ? { axis, index } : null
}

function objectKey(picked: unknown): string {
  return picked && typeof picked === 'object' && 'oKey' in picked
    ? String((picked as { oKey: unknown }).oKey)
    : ''
}

function setEvented(objects: readonly BaseObject[], evented: boolean): void {
  for (const object of objects) object.evented = evented
}

/**
 * Decides the press's handle guard and switches the losing objects off.
 * Returns the objects to switch back on when the finger lifts.
 */
function guardPress(runtime: UniverRuntime, clientX: number, clientY: number): BaseObject[] {
  const parts = sheetRender(runtime)
  if (!parts) return []
  const { scene } = parts
  const freeze = FREEZE_OBJECT_KEYS.flatMap((key) => {
    const object = scene.getObject(key)
    return object && object.evented ? [object] : []
  })
  // The corner handles live inside the selection's group: list all objects.
  const handles = scene
    .getAllObjects()
    .filter((object) => object.oKey.startsWith(FILL_HANDLE_PREFIX) && object.evented)
  if (handles.length === 0) return []
  const { x, y } = canvasOffset(parts, clientX, clientY)
  // Look past the freeze bars for a handle within reach.
  setEvented(freeze, false)
  let handleNear: boolean
  try {
    handleNear = reachPoints(x, y).some(([px, py]) =>
      objectKey(scene.pick(Vector2.FromArray([px, py]))).startsWith(FILL_HANDLE_PREFIX),
    )
  } finally {
    setEvented(freeze, true)
  }
  const guard: HandleGuard = decideHandleGuard({
    clientX,
    viewportWidth: window.innerWidth,
    handleNear,
  })
  if (guard === 'freeze-off') {
    setEvented(freeze, false)
    return freeze
  }
  if (guard === 'handles-off') {
    setEvented(handles, false)
    return handles
  }
  return []
}

export function installGestureLayer(
  element: HTMLElement,
  runtime: UniverRuntime,
  options: GestureLayerOptions,
): GestureLayer {
  const now = options.now ?? (() => performance.now())
  const tracker = new PressTracker()
  let pointerId: number | null = null
  let longPressTimer: ReturnType<typeof setTimeout> | null = null
  let switchedOff: BaseObject[] = []
  // The menu opened under the finger: its lift must not reach the page as a
  // click (it would land on the new sheet's backdrop and close it at once).
  let longPressFired = false

  const clearLongPress = () => {
    if (longPressTimer) clearTimeout(longPressTimer)
    longPressTimer = null
  }
  const restore = () => {
    setEvented(switchedOff, true)
    switchedOff = []
  }

  const onDown = (event: PointerEvent) => {
    if (!event.isPrimary) {
      // A second finger (pinch): the first press is no tap.
      tracker.cancel()
      clearLongPress()
      return
    }
    pointerId = event.pointerId
    longPressFired = false
    tracker.down(event.clientX, event.clientY, now())
    clearLongPress()
    restore()
    try {
      switchedOff = guardPress(runtime, event.clientX, event.clientY)
    } catch {
      switchedOff = []
    }
    if (options.isViewMode()) return
    let found: ReturnType<typeof headerLineAt>
    try {
      found = headerLineAt(runtime, event.clientX, event.clientY)
    } catch {
      found = null
    }
    if (!found) return
    const line = found
    let wasSelected: boolean
    try {
      wasSelected = isHeaderLineSelected(runtime, line.axis, line.index)
    } catch {
      wasSelected = false
    }
    longPressTimer = setTimeout(() => {
      longPressTimer = null
      const press = tracker.press
      if (!press || !isLongPress(press, now()) || options.isViewMode()) return
      longPressFired = true
      options.onHeaderLongPress(line.axis, line.index, wasSelected)
    }, LONG_PRESS_MS)
  }
  const onMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    tracker.move(event.clientX, event.clientY)
    const press = tracker.press
    if (press && press.travel > TAP_SLOP_PX) clearLongPress()
  }
  const onUp = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    tracker.up(now())
    clearLongPress()
    restore()
    pointerId = null
  }
  const onCancel = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    tracker.cancel()
    clearLongPress()
    restore()
    pointerId = null
  }

  const onTouchEnd = (event: TouchEvent) => {
    if (!longPressFired) return
    longPressFired = false
    if (event.cancelable) event.preventDefault()
  }

  element.addEventListener('pointerdown', onDown, true)
  element.addEventListener('touchend', onTouchEnd, { capture: true, passive: false })
  element.addEventListener('pointermove', onMove, true)
  element.addEventListener('pointerup', onUp, true)
  element.addEventListener('pointercancel', onCancel, true)
  return {
    acceptsDoubleTap: () => tracker.lastDoubleTap,
    dispose() {
      clearLongPress()
      restore()
      element.removeEventListener('pointerdown', onDown, true)
      element.removeEventListener('pointermove', onMove, true)
      element.removeEventListener('pointerup', onUp, true)
      element.removeEventListener('pointercancel', onCancel, true)
      element.removeEventListener('touchend', onTouchEnd, { capture: true })
    },
  }
}
