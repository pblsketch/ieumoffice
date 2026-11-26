/**
 * Scrolls the cell being edited above the keyboard and its keyboard bar
 * (spec 2.8-1; prototype: device-small-typed.png, B1985 typed off screen).
 */

/** Space (CSS px) kept between the edited cell and the keyboard bar. */
export const REVEAL_MARGIN_PX = 8

/**
 * How far (CSS px, positive = scroll down) the view must move so the cell
 * `[cellTop, cellBottom]` sits inside `[viewTop, viewBottom]`. A cell taller
 * than the view keeps its top in sight.
 */
export function revealScrollDelta(input: {
  readonly cellTop: number
  readonly cellBottom: number
  readonly viewTop: number
  readonly viewBottom: number
  readonly margin?: number
}): number {
  const margin = input.margin ?? REVEAL_MARGIN_PX
  const top = input.viewTop + margin
  const bottom = input.viewBottom - margin
  if (bottom <= top) return 0
  if (input.cellTop < top) return input.cellTop - top
  if (input.cellBottom > bottom) {
    const down = input.cellBottom - bottom
    // never push the cell's top above the view
    return Math.min(down, input.cellTop - top)
  }
  return 0
}

/**
 * The bottom of the part of the page the person can see while typing: the
 * visual viewport (it shrinks with the keyboard on iOS), less the keyboard
 * inset the shell publishes (`--m-kb`, Android may resize the web view
 * instead) and the keyboard bar.
 */
export function visibleBottom(input: {
  readonly visualViewportBottom: number
  readonly keyboardInset: number
  readonly keyboardBarHeight: number
}): number {
  return input.visualViewportBottom - input.keyboardInset - input.keyboardBarHeight
}
