// Icons of track T1 sheets. Draw them with SvgIcon from './svgIcon' (not from MobileIcons, which
// imports this folder's index). File-type pictures go in the map below.
import { SvgIcon, type IconProps } from './svgIcon'
import type { DocTypeIconMap } from './types'

export const sheetsDocTypeIcons: DocTypeIconMap = {}

/** Grid with its top row held (freeze top row). */
export function IconFreezeRow(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M3.5 9h17" strokeWidth={2.6} />
      <path d="M9.5 9v11.5M15 9v11.5M3.5 14.5h17" />
    </SvgIcon>
  )
}

/** Grid with its first column held (freeze first column). */
export function IconFreezeColumn(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M9 3.5v17" strokeWidth={2.6} />
      <path d="M9 9.5h11.5M9 15h11.5M14.5 3.5v17" />
    </SvgIcon>
  )
}

/** Plain grid (no frozen panes). */
export function IconUnfreeze(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M3.5 9.5h17M3.5 15h17M9.5 3.5v17M15 3.5v17" />
    </SvgIcon>
  )
}
