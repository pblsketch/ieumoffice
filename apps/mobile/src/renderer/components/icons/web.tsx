// Icons of track T4 html and markdown. Draw them with SvgIcon from './svgIcon' (not from MobileIcons, which
// imports this folder's index). File-type pictures go in the map below.
import { SvgIcon, type IconProps } from './svgIcon'
import type { DocTypeIconMap } from './types'

export const webDocTypeIcons: DocTypeIconMap = {}

/** Find and replace (magnifier). */
export function IconWebFind(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <line x1="20" y1="20" x2="15.6" y2="15.6" />
    </SvgIcon>
  )
}

/** Previous match (chevron up). */
export function IconWebFindPrev(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <polyline points="6 15 12 9 18 15" />
    </SvgIcon>
  )
}

/** Next match (chevron down). */
export function IconWebFindNext(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <polyline points="6 9 12 15 18 9" />
    </SvgIcon>
  )
}
