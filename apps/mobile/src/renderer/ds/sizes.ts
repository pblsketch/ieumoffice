// Line icon sizes of the mobile design system (docs/plans/mobile-v1/DSN.md).
// This table is the source; --m-icon-s|m|l|xl in styles/m-tokens.css mirror it, and
// tests/ds-components.test.tsx keeps the two equal.

export const ICON_SIZE = {
  /** Inside a line: chips, badges. */
  s: 16,
  /** Every bar, toolbar and list row icon. */
  m: 20,
  /** Floating buttons. */
  l: 24,
  /** Empty states and the first run. */
  xl: 32,
} as const

export type IconSize = keyof typeof ICON_SIZE

/** Pixel size for a size name, for icon functions that take a number (`<IconX size={iconPx('m')} />`). */
export function iconPx(size: IconSize): number {
  return ICON_SIZE[size]
}

/** Opening and waiting states stay invisible when they finish within this time. */
export const PROGRESS_DELAY_MS = 300
