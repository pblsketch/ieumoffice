/**
 * Which grid objects a press may grab (design system 5.3, spec 2.8-1):
 *
 * - No drag handle within 24 px of the screen's left or right edge: the
 *   system back gesture starts there. A press in that band does not grab the
 *   selection's corner handles (it still scrolls and selects).
 * - Near a selection handle, the handle wins over the freeze divider. Univer
 *   draws the freeze bars above the selection, so a handle sitting on the
 *   divider used to move the freeze line instead of growing the selection
 *   (prototype: dragging from B6 changed the frozen columns from 2 to 3).
 */

/** Width of the screen-edge band without drag handles (CSS px). */
export const EDGE_BAND_PX = 24
/** How close (CSS px) to a handle a press still counts as grabbing it. */
export const HANDLE_REACH_PX = 16

export type HandleGuard = 'none' | 'handles-off' | 'freeze-off'

export function decideHandleGuard(input: {
  readonly clientX: number
  readonly viewportWidth: number
  /** A selection corner handle lies within reach of the press. */
  readonly handleNear: boolean
}): HandleGuard {
  const { clientX, viewportWidth, handleNear } = input
  if (clientX < EDGE_BAND_PX || clientX > viewportWidth - EDGE_BAND_PX) {
    return handleNear ? 'handles-off' : 'none'
  }
  return handleNear ? 'freeze-off' : 'none'
}

/** The press point and the ring around it checked for a handle (canvas offsets). */
export function reachPoints(x: number, y: number, reach = HANDLE_REACH_PX): [number, number][] {
  const points: [number, number][] = [[x, y]]
  for (let step = 0; step < 8; step += 1) {
    const angle = (step * Math.PI) / 4
    points.push([x + Math.cos(angle) * reach, y + Math.sin(angle) * reach])
  }
  return points
}
