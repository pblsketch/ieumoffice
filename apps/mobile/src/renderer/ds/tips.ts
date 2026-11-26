// Where and when a first-use tip may show (rule 4.12): one tip per screen, never over an
// open sheet, dialog, AI panel or keyboard, and never covering a bar, input or main button.

export interface TipScreenState {
  readonly sheetOpen: boolean
  readonly dialogOpen: boolean
  readonly aiPanelOpen: boolean
  readonly keyboardOpen: boolean
  /** Another tip is already on screen. */
  readonly tipShowing: boolean
}

/** True when a tip may show now; false means "wait for the next chance", not "drop it". */
export function canShowTip(state: TipScreenState): boolean {
  return (
    !state.sheetOpen &&
    !state.dialogOpen &&
    !state.aiPanelOpen &&
    !state.keyboardOpen &&
    !state.tipShowing
  )
}

export interface Box {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** True when the two boxes share any area (touching edges do not count). */
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/**
 * Picks the first candidate box for the tip that covers none of the protected boxes
 * (bars, inputs, main buttons). Null means the tip must not show at this moment.
 */
export function pickTipBox(candidates: readonly Box[], protectedBoxes: readonly Box[]): Box | null {
  for (const candidate of candidates) {
    if (!protectedBoxes.some((box) => boxesOverlap(candidate, box))) return candidate
  }
  return null
}
