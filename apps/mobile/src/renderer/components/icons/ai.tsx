// Icons of track T7 ai. Draw them with SvgIcon from './svgIcon' (not from MobileIcons, which
// imports this folder's index). File-type pictures go in the map below.
import { SvgIcon, type IconProps } from './svgIcon'
import type { DocTypeIconMap } from './types'

export const aiDocTypeIcons: DocTypeIconMap = {}

/** A photo to attach to the next AI message. */
export function IconAiPhoto(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="3" y="5" width="18" height="15" rx="2.5" />
      <circle cx="9" cy="10.5" r="1.6" />
      <path d="m21 16-4.5-4.5L7 20" />
    </SvgIcon>
  )
}

/** Move a queued message one place earlier. */
export function IconAiMoveUp(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 19V5" />
      <path d="m6 11 6-6 6 6" />
    </SvgIcon>
  )
}

/** Move a queued message one place later. */
export function IconAiMoveDown(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 5v14" />
      <path d="m18 13-6 6-6-6" />
    </SvgIcon>
  )
}

/** Let a held queue go on. */
export function IconAiResume(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M8 5.5v13l10-6.5z" />
    </SvgIcon>
  )
}
