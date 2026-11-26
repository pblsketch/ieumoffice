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

/** Hide from AI (eye struck through). */
export function IconWebHide(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M3 12s3.5-6 9-6c1.6 0 3 .5 4.2 1.2M21 12s-3.5 6-9 6c-1.6 0-3-.5-4.2-1.2" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <line x1="4" y1="20" x2="20" y2="4" />
    </SvgIcon>
  )
}

/** Unhide (open eye). */
export function IconWebUnhide(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z" />
      <circle cx="12" cy="12" r="3" />
    </SvgIcon>
  )
}
